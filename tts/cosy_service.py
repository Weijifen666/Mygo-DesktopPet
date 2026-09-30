"""Private loopback synthesis for the user-accepted combined voice model."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import os
import time
from fastapi import FastAPI,HTTPException
from fastapi.responses import Response
from pydantic import BaseModel,Field
from cosy_runtime import CosyRuntime
from cosy_io import atomic_json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
runtime=None
pool=ThreadPoolExecutor(max_workers=1)
gate=asyncio.Lock()


@asynccontextmanager
async def lifespan(app):
    global runtime
    runtime=await asyncio.get_running_loop().run_in_executor(pool,CosyRuntime)
    atomic_json(ROOT/'experiments/cosy-service.json',dict(status='ready',pid=os.getpid(),revision=runtime.config['revision'],ready_unix=time.time()))
    yield
    pool.shutdown(wait=True)


app=FastAPI(lifespan=lifespan)


class Synthesis(BaseModel):
    character:str
    text:str=Field(min_length=1,max_length=300)
    emotion:str='neutral'
    speechDelivery:dict|None=None
    kana:str|None=Field(default=None,max_length=1000)
    speed:float=1.0
    requestId:str=Field(default='',max_length=80)
    referenceSampleId:str|None=Field(default=None,max_length=40)
    referenceMode:str|None=None
    generationSeed:int|None=Field(default=None,ge=0,le=2147483647)
    checkContent:bool=False


@app.get('/health')
async def health():
    return dict(status='ready',backend_ready=runtime is not None,model='CosyVoice3 combined',revision=runtime.config['revision'],
                project_root=str(ROOT),user_voice_quality_accepted=True,voices={r:dict(ready=True) for r in runtime.weights})


@app.post('/synthesize')
async def synthesize(body:Synthesis):
    if body.character not in runtime.weights:raise HTTPException(422,'Unknown character')
    if body.emotion not in ('neutral','quiet','gentle','plain','excited'):raise HTTPException(422,'Unknown speech style')
    async with gate:
        try:
            data,meta=await asyncio.get_running_loop().run_in_executor(pool,lambda:runtime.synthesize(body.character,body.text,body.emotion,body.speechDelivery,body.kana,body.referenceSampleId,body.referenceMode,body.generationSeed,body.checkContent))
        except ValueError as error:raise HTTPException(422,str(error)) from error
        except Exception as error:
            atomic_json(ROOT/'experiments/cosy-service-last-error.json',dict(error=type(error).__name__,message=str(error),time_unix=time.time()))
            raise HTTPException(503,'角色语音生成失败，请重试') from error
    return Response(data,media_type='audio/wav',headers={'X-Voice-Mode':'accepted','X-Voice-Revision':meta['revision'],'X-Cache':meta['cache'],
        'X-Reference-Id':meta['reference_id'],'X-Reference-Mode':meta['mode'],
        'X-Generation-Seed':str(meta['seed']),'X-Generation-Retries':str(meta['retry_count']),
        'X-Content-Check':meta.get('content_validation',{}).get('status','not-requested')})


if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=9881,access_log=False,log_level='warning')
