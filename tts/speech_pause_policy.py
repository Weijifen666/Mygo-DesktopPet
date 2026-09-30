"""Shorten only long, low-energy gaps which local VAD also calls non-speech.

Original recordings are exempt. No pitch, tempo, voiced samples or trailing
speech are changed. Every removed sample range is recorded for verification.
"""
from functools import lru_cache
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
POLICY='tomori-natural-pauses-v2'


@lru_cache(maxsize=1)
def vad_session():
    import onnxruntime as ort
    model=ROOT/'runtime/venv/Lib/site-packages/faster_whisper/assets/silero_vad_v6.onnx'
    opts=ort.SessionOptions();opts.intra_op_num_threads=1;opts.inter_op_num_threads=1
    return ort.InferenceSession(str(model),sess_options=opts,providers=['CPUExecutionProvider'])


def speech_probabilities(audio,rate):
    from scipy.signal import resample_poly
    from math import gcd
    factor=gcd(rate,16000)
    samples=resample_poly(audio,16000//factor,rate//factor).astype('float32')
    samples=np.pad(samples,(0,(-len(samples))%512))
    chunks=samples.reshape(-1,512)
    context=np.roll(chunks[:,-64:],1,axis=0).copy();context[0]=0
    inputs=np.concatenate([context,chunks],axis=1)
    out,_,_=vad_session().run(None,{'input':inputs,'h':np.zeros((1,1,128),np.float32),'c':np.zeros((1,1,128),np.float32)})
    return np.asarray(out).reshape(-1)


def shorten_long_pauses(audio,rate,role,style='neutral'):
    audio=np.asarray(audio)
    if role!='tomori' or len(audio)<rate:return audio,[]
    probs=speech_probabilities(audio,rate)
    hop=round(rate*.02);quiet=[]
    for start in range(0,len(audio),hop):
        chunk=audio[start:start+hop]
        left=max(0,int(start/rate/.032)-1)
        right=min(len(probs),int((start+len(chunk))/rate/.032)+2)
        quiet.append(np.sqrt(np.mean(chunk**2))<.0015 and np.max(np.abs(chunk))<.008
                     and np.max(probs[left:right])<.15)
    edges=np.diff(np.r_[False,quiet,False].astype(int));cuts=[]
    retained=.32 if style=='excited' else .42
    for a,b in zip(np.where(edges==1)[0],np.where(edges==-1)[0]):
        # Internal pauses only. Preserve at least 100ms of either boundary.
        begin=a*hop;end=min(b*hop,len(audio));duration=(end-begin)/rate
        if begin<rate*.16 or end>len(audio)-rate*.16 or duration<=.58:continue
        remove=round((duration-retained)*rate);cut_start=begin+(end-begin-remove)//2
        cut_end=cut_start+remove
        assert cut_start-begin>=rate*.1 and end-cut_end>=rate*.1
        cuts.append(dict(start_sample=int(cut_start),end_sample=int(cut_end),
                         gap_start_s=begin/rate,gap_end_s=end/rate,retained_s=retained))
    if not cuts:return audio,[]
    pieces=[];position=0
    for cut in cuts:
        pieces.append(audio[position:cut['start_sample']]);position=cut['end_sample']
    pieces.append(audio[position:]);result=np.concatenate(pieces)
    # The splice lies entirely within low-energy non-speech. All samples
    # outside the recorded cuts are retained byte-for-byte, including breaths
    # which either energy or VAD identifies as speech.
    assert len(result)==len(audio)-sum(c['end_sample']-c['start_sample'] for c in cuts)
    return result,cuts
