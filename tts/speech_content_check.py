"""Private CPU ASR check for newly generated chat audio, before delivery.

The original recording bank is exempt. A check is an intelligibility proxy;
it is not a human voice-quality assessment. Offline models only.
"""
import json,os,subprocess,sys,uuid
from pathlib import Path
from speech_text_metrics import metrics

ROOT=Path(__file__).resolve().parents[1]
POLICY='chat-full-text-check-v1'


def score(value):return .6*min(2.,value['kana_error'])+.4*min(1.,value['tail_error'])


def check(data,text):
    folder=ROOT/'tts/cache/content-checks';folder.mkdir(parents=True,exist_ok=True)
    identity=uuid.uuid4().hex;audio=folder/(identity+'.wav');request=folder/(identity+'.json')
    try:
        audio.write_bytes(data);request.write_text(json.dumps(dict(audio=str(audio),text=text),ensure_ascii=False),encoding='utf-8')
        python = sys.executable if os.environ.get('MYGO_COSY_CPU') == '1' else str(ROOT/'runtime/venv/Scripts/python.exe')
        environment={**os.environ,'PYTHONUTF8':'1','PYTHONIOENCODING':'utf-8'}
        result=subprocess.run([python,str(Path(__file__).resolve()),'--request',str(request)],
                              cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='strict',env=environment,timeout=300,creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:raise RuntimeError('Local speech-content check failed')
        return json.loads(result.stdout)
    finally:
        audio.unlink(missing_ok=True);request.unlink(missing_ok=True)


def main():
    assert sys.argv[1]=='--request'
    request=Path(sys.argv[2]).resolve();assert request.is_relative_to(ROOT/'tts/cache/content-checks')
    payload=json.loads(request.read_text(encoding='utf-8'));audio=Path(payload['audio']).resolve()
    assert audio.is_relative_to(ROOT/'tts/cache/content-checks') and audio.suffix=='.wav'
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
    from faster_whisper import WhisperModel
    snapshot=next((ROOT/'runtime/asr-models/models--Systran--faster-whisper-small/snapshots').glob('*/model.bin')).parent
    model=WhisperModel(str(snapshot),device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)
    segments,_=model.transcribe(str(audio),language='ja',beam_size=3,vad_filter=True,condition_on_previous_text=False,
                               vad_parameters=dict(threshold=.35,min_silence_duration_ms=500,speech_pad_ms=150))
    actual=''.join(s.text for s in segments)
    print(json.dumps(dict(policy=POLICY,transcript=actual,**metrics(payload['text'],actual)),ensure_ascii=True),flush=True)


if __name__=='__main__':main()
