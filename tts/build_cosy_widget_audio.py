"""Pre-render every fixed line with the accepted combined voice and text delivery."""
import hashlib
import io
import json
import os
from pathlib import Path
import time
import httpx
import soundfile as sf
import numpy as np
from cosy_io import atomic_json
from speech_pause_policy import POLICY,shorten_long_pauses

ROOT=Path(__file__).resolve().parents[1]
BANK=ROOT/'tts/widget-bank'
STATUS=ROOT/'experiments/cosy-fixed-audio.json'
MANIFEST=BANK/'cosy-prosody-v1.manifest.json'


def read(path):return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def main():
    config=read(ROOT/'tts/cosy-production.json');revision=config['revision']
    catalog=read(BANK/'catalog.json');translations=read(BANK/'translations.json')
    assert {r['id'] for r in catalog['rows']}==set(translations)
    state=dict(status='generating',pid=os.getpid(),revision=revision,total=len(translations),completed=0,started_unix=time.time())
    manifest=read(MANIFEST)
    if manifest.get('voice_revision')!=revision:manifest=dict(rows={},voice_revision=revision,model=config['model'],human_reviewed_model=True)
    def save():state['updated_unix']=time.time();atomic_json(STATUS,state)
    save()
    try:
        with httpx.Client(timeout=120,trust_env=False) as client:
            health=client.get('http://127.0.0.1:9881/health').json()
            if health.get('revision')!=revision or health.get('project_root')!=str(ROOT):raise RuntimeError('Unexpected local voice service')
            for role in ('tomori','anon','rana','soyo','taki'):
                for row in [r for r in catalog['rows'] if r['role']==role]:
                    while True:
                        deliveries=read(BANK/'cosy-delivery.json')
                        planned=deliveries.get(row['id'])
                        if planned:break
                        status=read(ROOT/'experiments/cosy-fixed-delivery.json')
                        if status.get('status')=='failed':raise RuntimeError('Fixed delivery planning failed: '+status.get('error',''))
                        state.update(status='waiting_for_delivery',role=role,line_id=row['id']);save();time.sleep(2)
                    text=planned['japanese'];delivery=planned['speechDelivery'];style=planned['speechStyle']
                    synthesis_identity=[text,delivery,style,revision]
                    original_fixed=bool(planned.get('recordedSampleId') or planned.get('recordedOriginalIds'))
                    if planned.get('referenceSampleId') or original_fixed:synthesis_identity.append({k:planned[k] for k in ('referenceSampleId','recordedSampleId','recordedOriginalIds') if k in planned})
                    if planned.get('audioPostprocess'):synthesis_identity.append({k:planned[k] for k in ('audioPostprocess','pauseSourceFile','pauseSourceSha')})
                    if planned.get('synthesisOptions'):synthesis_identity.append(planned['synthesisOptions'])
                    fingerprint=hashlib.sha256(json.dumps(synthesis_identity,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:12]
                    relative=f'wave/cosy-{revision}/{role}/{row["id"]}-{fingerprint}.wav'
                    file=BANK/relative;old=manifest['rows'].get(row['id'])
                    if old and old['file']==relative and file.exists() and hashlib.sha256(file.read_bytes()).hexdigest()==old['wav_sha256']:
                        state['completed']=len(manifest['rows']);continue
                    state.update(status='generating',role=role,line_id=row['id']);save();error=None
                    for attempt in range(4):
                        try:
                            pause_cuts=[]
                            if planned.get('audioPostprocess'):
                                assert not original_fixed and role=='tomori' and planned['audioPostprocess']==POLICY
                                source=(BANK/planned['pauseSourceFile']).resolve()
                                assert source.is_relative_to(BANK/'wave')
                                assert hashlib.sha256(source.read_bytes()).hexdigest()==planned['pauseSourceSha']
                                audio,rate=sf.read(source,dtype='float32')
                                audio,pause_cuts=shorten_long_pauses(audio,rate,role,style)
                                assert pause_cuts,'Expected confirmed non-speech gaps'
                                buffer=io.BytesIO();sf.write(buffer,audio,rate,format='WAV',subtype='PCM_16')
                                previous=manifest['rows'][row['id']]
                                response=httpx.Response(200,content=buffer.getvalue(),headers={'X-Voice-Revision':revision,'X-Reference-Id':previous['reference_id'],'X-Reference-Mode':previous['internal_reference_mode'],'X-Generation-Seed':str(previous.get('generation_seed',1234)),'X-Generation-Retries':str(previous.get('generation_retries',0))})
                            elif original_fixed:
                                # An exact fixed line with an existing original recording.
                                # Never use this path for generated conversational content.
                                import scipy.signal
                                import math
                                if planned.get('recordedOriginalIds'):
                                    registry=read(ROOT/'tts/original-fixed-recordings.json')
                                    originals=[registry[key] for key in planned['recordedOriginalIds']]
                                    assert [r['text'] for r in originals]==planned['recordedOriginalTexts']
                                else:
                                    samples=read(ROOT/f'experiments/cosy-training-v1/{role}.manifest.json')
                                    originals=[next(r for r in samples if r['id']==planned['recordedSampleId'])]
                                    assert text==originals[0]['text'],'Recorded fixed line must use its original transcript'
                                waves=[]
                                for original in originals:
                                    source=(ROOT/original['audio']).resolve()
                                    assert source.is_relative_to(ROOT/'experiments/data/raw'/role)
                                    assert hashlib.sha256(source.read_bytes()).hexdigest()==original['audio_sha256']
                                    audio,rate=sf.read(source,dtype='float32')
                                    if audio.ndim>1:audio=audio.mean(axis=1)
                                    if rate!=24000:
                                        factor=math.gcd(rate,24000);audio=scipy.signal.resample_poly(audio,24000//factor,rate//factor)
                                    waves.append(audio)
                                audio=np.concatenate(waves)
                                buffer=io.BytesIO();sf.write(buffer,audio,24000,format='WAV',subtype='PCM_16')
                                response=httpx.Response(200,content=buffer.getvalue(),headers={'X-Voice-Revision':revision,'X-Reference-Id':','.join(r['id'] for r in originals),'X-Reference-Mode':'original-fixed-recording','X-Generation-Seed':'0','X-Generation-Retries':'0'})
                            else:
                                response=client.post('http://127.0.0.1:9881/synthesize',json=dict(character=role,text=text,emotion=style,speechDelivery=delivery,referenceSampleId=planned.get('referenceSampleId'),**planned.get('synthesisOptions',{})))
                            if not original_fixed and not planned.get('audioPostprocess'):response.raise_for_status()
                            if response.headers.get('X-Voice-Revision')!=revision or not response.content.startswith(b'RIFF'):raise RuntimeError('Unexpected fixed voice output')
                            if planned.get('content_verified_candidate_sha') and not planned.get('audioPostprocess') and hashlib.sha256(response.content).hexdigest()!=planned['content_verified_candidate_sha']:raise RuntimeError('Content-verified candidate audio changed')
                            file.parent.mkdir(parents=True,exist_ok=True)
                            temporary=file.with_suffix('.tmp');temporary.write_bytes(response.content);temporary.replace(file)
                            if sf.info(file).duration<.15:raise RuntimeError('Empty fixed audio')
                            error=None;break
                        except Exception as exc:error=exc;time.sleep(2*(attempt+1))
                    if error:raise error
                    manifest['rows'][row['id']]={**planned,'source':row['source'],'file':relative,
                        'wav_sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'reference_id':response.headers.get('X-Reference-Id'),
                        'internal_reference_mode':response.headers.get('X-Reference-Mode'),'duration_s':sf.info(file).duration,
                        'generation_seed':int(response.headers.get('X-Generation-Seed','1234')),'generation_retries':int(response.headers.get('X-Generation-Retries','0')),
                        'generation_model':'original-private-recording' if original_fixed else config['model'],'generation_revision':revision,
                        **({'pause_cuts':pause_cuts} if pause_cuts else {})}
                    manifest.update(status='building',updated_unix=time.time());atomic_json(MANIFEST,manifest)
                    state['completed']=len(manifest['rows']);save();print(role,state['completed'],'/',state['total'],flush=True)
            if set(manifest['rows'])!=set(translations):raise RuntimeError('Missing fixed lines')
            for row in manifest['rows'].values():
                if hashlib.sha256((BANK/row['file']).read_bytes()).hexdigest()!=row['wav_sha256']:raise RuntimeError('Fixed audio changed')
            manifest.update(status='completed',finished_unix=time.time());atomic_json(MANIFEST,manifest)
            old=BANK/'manifest.json'
            backup=BANK/'manifest-before-cosy.json'
            if old.exists() and not backup.exists():backup.write_bytes(old.read_bytes())
            atomic_json(old,manifest)
            state.update(status='completed',finished_unix=time.time(),complete_unique_ids=len(manifest['rows']));save()
            atomic_json(ROOT/'experiments/cosy-desktop-deployment.json',dict(status='deployed',revision=revision,model=config['model'],
                user_voice_quality_accepted=True,fixed_audio_count=len(manifest['rows']),deployed_unix=time.time(),
                behavior=dict(fixed_pre_generated=True,chat_waits_for_complete_audio=True,context_delivery=True)))
    except BaseException as error:state.update(status='failed',error=str(error));save();raise


if __name__=='__main__':main()
