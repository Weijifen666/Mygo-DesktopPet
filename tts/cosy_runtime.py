"""The accepted jointly trained CosyVoice pipeline, one GPU owner and one output."""
import hashlib
import io
import json
import os
from pathlib import Path
from pronunciations import normalize_spoken_names, spoken_reading
from speech_pause_policy import POLICY,shorten_long_pauses
from speech_content_check import POLICY as CONTENT_POLICY,check as check_content,score as content_score
import random
import sys
import threading
import time

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'runtime/cosy-models/Fun-CosyVoice3-0.5B-2512'
CONFIG=ROOT/'tts/cosy-production.json'
CACHE=ROOT/'tts/cache/cosy-prosody-v1'
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',PYTHONUTF8='1')
sys.path[:0]=[str(ROOT/'runtime/CosyVoice'),str(ROOT/'runtime/CosyVoice/third_party/Matcha-TTS')]

FIELDS=('pitch','variation','energy','pace','pauses')
MEASURED=('pitch_median_st','pitch_range_st','active_rms_db','kana_per_active_second','longest_internal_pause_s')
WORDS=(('音调较低','音调处于角色通常范围','音调较高'),('音高变化较小','音高变化适中','音高变化较大'),
       ('声音力度较轻','声音力度适中','声音力度较强'),('语速较慢','语速适中','语速较快'),('停顿较短','保留适当停顿','保留较明显的停顿'))
NAMES=dict(tomori='高松灯',anon='千早爱音',rana='要乐奈',soyo='长崎素世',taki='椎名立希')


def normalize_delivery(role,style,provided):
    values=[1,1,1,1,1]
    if style=='quiet' or role=='tomori' and style=='neutral':values=[0,0,0,0,1]
    if style=='gentle':values=[1,1,0,1,1]
    if style=='plain':values=[0,0,1,1,1]
    if style=='excited':values=[2,2,2,2,0]
    if role=='rana' and style!='excited':values[1]=0
    result=dict(zip(FIELDS,values))
    for key in FIELDS:
        value=(provided or {}).get(key)
        if type(value) is int and 0<=value<=2:result[key]=value
    result['emotion']=str((provided or {}).get('emotion','neutral'))[:24]
    result['intensity']=str((provided or {}).get('intensity','medium'))[:12]
    return result


class CosyRuntime:
    def __init__(self):
        import logging
        logging.getLogger('numba').setLevel(logging.WARNING)
        import torch
        from cosyvoice.cli.cosyvoice import AutoModel
        from cosy_adapters import attach
        from cosy_flow_adapter import attach_flow
        from gpu_lock import gpu_lock
        self.lock=gpu_lock()
        cpu_mode=not torch.cuda.is_available()
        torch.set_num_threads(min(8, max(1, os.cpu_count() or 4)) if cpu_mode else 4)
        self.config=json.loads(CONFIG.read_text(encoding='utf-8'))
        if not self.config['approved_private_use'] or not self.config['user_voice_quality_accepted']:raise RuntimeError('This voice deployment is not accepted')
        self.weights={};self.references={}
        for role,info in self.config['roles'].items():
            self.weights[role]={}
            for stage in ('llm','flow'):
                entry=info[stage];file=ROOT/entry['adapter']
                if hashlib.sha256(file.read_bytes()).hexdigest()!=entry['sha256']:raise RuntimeError('Production adapter checksum mismatch')
                self.weights[role][stage]=torch.load(file,map_location='cpu',weights_only=True)
            for ref in info['references']:
                if hashlib.sha256((ROOT/ref['audio']).read_bytes()).hexdigest()!=ref['audio_sha256']:raise RuntimeError('Production reference checksum mismatch')
            self.references[role]=info['references']
        sys.modules['wetext']=None
        self.model=AutoModel(model_dir=str(BASE),fp16=not cpu_mode,load_trt=False,load_vllm=False)
        self.model.frontend.speech_tokenizer_session.set_providers(['CPUExecutionProvider'])
        attach(self.model.model.llm);attach_flow(self.model.model.flow)
        self.model.model.llm.requires_grad_(False);self.model.model.flow.requires_grad_(False)
        self.model.model.llm.eval();self.model.model.flow.eval()
        self.current_role=None;self.prompt_cache={};self.gate=threading.RLock()
        CACHE.mkdir(parents=True,exist_ok=True)

    def synthesize(self,role,text,style='neutral',delivery=None,kana=None,reference_sample_id=None,reference_mode=None,generation_seed=None,validate_content=False):
        import numpy as np
        import soundfile as sf
        import torch
        import pyopenjtalk
        from cosy_adapters import adapter_state
        from cosy_flow_adapter import flow_state
        if role not in self.weights:raise ValueError('Unknown role')
        text=str(text).strip()
        if not text or len(text)>300:raise ValueError('Invalid Japanese text')
        attrs=normalize_delivery(role,style,delivery)
        def distance(ref):
            return sum((attrs[k]-ref['bins'].get(m,1))**2*(2 if k in ('variation','energy') else 1)
                       for k,m in zip(FIELDS,MEASURED) if ref['bins'].get(m) is not None)
        ref=min(self.references[role],key=lambda r:(distance(r),r['id']))
        if not reference_sample_id and role=='taki' and ('あのん' in text or 'アノン' in text):
            reference_sample_id='85cffee24e2cece29a02' if attrs['emotion']=='frustrated' else '8b7c545cf86e1fe2d240'
        if reference_sample_id:
            samples=json.loads((ROOT/f'experiments/cosy-training-v1/{role}.manifest.json').read_text(encoding='utf-8'))
            source=next((r for r in samples if r['id']==reference_sample_id),None)
            if source is None:raise ValueError('Unknown original reference sample')
            audio=(ROOT/source['audio']).resolve()
            if not audio.is_relative_to(ROOT/'experiments/data/raw'/role) or hashlib.sha256(audio.read_bytes()).hexdigest()!=source['audio_sha256']:raise ValueError('Invalid original reference audio')
            ref={**source,'mode':'instruct'}
        if reference_mode is not None:
            if reference_mode not in ('sequence','instruct'):raise ValueError('Invalid reference mode')
            ref={**ref,'mode':reference_mode}
            if reference_mode=='sequence' and not ref.get('katakana'):ref['katakana']=spoken_reading(ref['text'],pyopenjtalk.g2p)
        reading=normalize_spoken_names(kana) if kana else spoken_reading(text,pyopenjtalk.g2p)
        if not reading.strip():raise ValueError('Empty Japanese reading')
        instruction='You are a helpful assistant. 请使用'+NAMES[role]+'的声音说话，'+('，'.join(WORDS[i][attrs[k]] for i,k in enumerate(FIELDS)))+'。<|endofprompt|>'
        identity=[self.config['revision'],role,text,reading,attrs,ref['id'],ref['mode'],instruction]
        if role=='tomori':identity.append(POLICY)
        if validate_content:identity.append({'content_check':CONTENT_POLICY})
        if generation_seed is not None:
            if type(generation_seed) is not int or not 0<=generation_seed<=2147483647:raise ValueError('Invalid generation seed')
            identity.append({'generation_seed':generation_seed})
        signature=json.dumps(identity,ensure_ascii=False,sort_keys=True)
        key=hashlib.sha256(signature.encode('utf-8')).hexdigest();file=CACHE/(key+'.wav')
        metadata=dict(revision=self.config['revision'],character=role,reference_id=ref['id'],mode=ref['mode'],speechDelivery=attrs,reading=reading,cache_key=key)
        def cached():
            if not file.exists():return None
            data=file.read_bytes()
            if sf.info(io.BytesIO(data)).duration<.15:return None
            info=file.with_suffix('.json')
            extra=json.loads(info.read_text(encoding='utf-8')) if info.exists() else dict(seed=1234,retry_count=0)
            return data,{**metadata,**extra,'cache':'hit'}
        hit=cached()
        if hit:return hit
        with self.gate:
            hit=cached()
            if hit:return hit
            if self.current_role!=role:
                for stage,module,extract in (('llm',self.model.model.llm,adapter_state),('flow',self.model.model.flow,flow_state)):
                    weights=self.weights[role][stage]
                    if set(weights)!=set(extract(module)):raise RuntimeError('Production adapter structure mismatch')
                    module.load_state_dict(weights,strict=False)
                self.current_role=role
            prompt_key=(role,ref['id'],ref['mode'])
            if prompt_key not in self.prompt_cache:
                base=self.model.frontend.frontend_zero_shot(reading,'',str(ROOT/ref['audio']),self.model.sample_rate,'')
                if ref['mode']=='instruct':
                    del base['llm_prompt_speech_token'];del base['llm_prompt_speech_token_len']
                self.prompt_cache[prompt_key]={k:v for k,v in base.items() if k not in ('text','text_len','prompt_text','prompt_text_len')}
            tokens,length=self.model.frontend._extract_text_token(reading)
            prompt_text=instruction+ref['katakana'] if ref['mode']=='sequence' else instruction
            prompt_tokens,prompt_length=self.model.frontend._extract_text_token(prompt_text)
            inputs={**self.prompt_cache[prompt_key],'text':tokens,'text_len':length,'prompt_text':prompt_tokens,'prompt_text_len':prompt_length}
            started=time.time()
            seeds=(generation_seed,1234,1337,2026,42,3407,17) if generation_seed is not None else (1234,1337,2026,42,3407,17)
            for retry,seed in enumerate(dict.fromkeys(seeds)):
                random.seed(seed);np.random.seed(seed);torch.manual_seed(seed)
                chunks=[part['tts_speech'].detach().float().cpu() for part in self.model.model.tts(**inputs,stream=False,speed=1.)]
                wave=torch.cat(chunks,dim=1).squeeze(0).numpy() if chunks else np.array([])
                if len(wave)>=self.model.sample_rate*.15 and np.isfinite(wave).all() and np.sqrt(np.mean(wave**2))>1e-5:break
            else:raise RuntimeError('No valid production waveform after bounded resampling')
            wave,pause_cuts=shorten_long_pauses(wave,self.model.sample_rate,role,style)
            buffer=io.BytesIO();sf.write(buffer,wave,self.model.sample_rate,format='WAV',subtype='PCM_16')
            data=buffer.getvalue();content_checks=[];content_attempts=0
            extra=dict(seed=seed,retry_count=retry,elapsed_s=time.time()-started,pause_policy=POLICY if role=='tomori' else None,pause_cuts=pause_cuts)
            if validate_content and len(reading)>=14:
                verified=check_content(data,text);content_checks.append(verified)
                if verified['suspect']:
                    best_data=data;best_meta=extra;best_check=verified
                    alternatives=[('instruct',1234 if ref['mode']=='sequence' else 1337),('instruct',2026)]
                    for candidate_mode,candidate_seed in alternatives:
                        candidate,candidate_meta=self.synthesize(role,text,style,delivery,kana,reference_sample_id,candidate_mode,candidate_seed,False)
                        candidate_check=check_content(candidate,text);content_checks.append(candidate_check);content_attempts+=1
                        if content_score(candidate_check)<content_score(best_check):best_data,best_meta,best_check=candidate,candidate_meta,candidate_check
                        if not best_check['suspect']:break
                    if best_check['suspect']:raise RuntimeError('Could not verify complete generated speech after bounded retries')
                    data=best_data
                    for field in ('seed','retry_count','pause_policy','pause_cuts','mode','reference_id'):
                        if field in best_meta:extra[field]=best_meta[field]
                extra['content_validation']=dict(policy=CONTENT_POLICY,status='passed',attempts=1+content_attempts,checks=content_checks)
                extra['retry_count']+=content_attempts
                extra['elapsed_s']=time.time()-started
            elif validate_content:extra['content_validation']=dict(policy=CONTENT_POLICY,status='short_utterance')
            temporary=file.with_suffix('.tmp');temporary.write_bytes(data);temporary.replace(file)
            file.with_suffix('.json').write_text(json.dumps(extra),encoding='utf-8')
            return data,{**metadata,**extra,'cache':'miss'}
