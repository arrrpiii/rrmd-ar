"""Local-only image-editing service. One persistent MLX subprocess, no cloud inference."""
import asyncio
import io
import json
import os
import re
import secrets
import sys
import time
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError

ROOT=Path(__file__).resolve().parent.parent
JOBS=ROOT/'local-runtime/jobs'
JOBS.mkdir(exist_ok=True)
MODEL=Path(os.getenv('TRYON_MODEL_PATH', str(ROOT/'.local-models/flux2-klein-4b-4bit')))
worker=None

async def stop_worker():
    global worker
    proc, worker = worker, None
    if proc and proc.returncode is None:
        proc.terminate()
        try: await asyncio.wait_for(proc.wait(), 5)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

@asynccontextmanager
async def lifespan(app):
    yield
    await stop_worker()

app=FastAPI(title='Atelier image editor',docs_url=None,redoc_url=None,lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origin_regex=r'^http://(localhost|127\.0\.0\.1):\d+$',allow_methods=['GET','POST'],allow_headers=['Content-Type'])
records={}
active=None
lock=asyncio.Lock()

@app.middleware('http')
async def local_only(request:Request,call_next):
    token=os.getenv('TRYON_SERVICE_TOKEN')
    if token and not secrets.compare_digest(request.headers.get('authorization',''), 'Bearer '+token):
        return JSONResponse({'detail':'Unauthorized'},status_code=401)
    origin=request.headers.get('origin')
    if origin and not re.fullmatch(r'http://(localhost|127\.0\.0\.1):\d+',origin):
        return JSONResponse({'detail':'Use the local Atelier page for local generation.'},status_code=403)
    try: length=int(request.headers.get('content-length','0') or 0)
    except ValueError: return JSONResponse({'detail':'Invalid content length.'},status_code=400)
    if request.method=='POST' and length>25*1024*1024:
        return JSONResponse({'detail':'Upload payload is too large.'},status_code=413)
    response=await call_next(request)
    response.headers['Cache-Control']='no-store'
    return response

def ready():
    return (MODEL/'.download-complete').exists()

def record(job_id):
    if not re.fullmatch('[a-f0-9]{32}',job_id) or job_id not in records: raise HTTPException(404,'Unknown local job.')
    return records[job_id]

@app.get('/status')
async def status():
    return {'available':True,'model_ready':ready(),'model':'FLUX.2 Klein 4B · 4-bit · MLX','active_job':active,'offline':True}

async def save_image(upload:UploadFile,path:Path):
    data=await upload.read(8*1024*1024+1)
    if len(data)>8*1024*1024: raise HTTPException(413,'Each input image must be smaller than 8 MB.')
    try:
        image=Image.open(io.BytesIO(data))
        if image.width*image.height>12_000_000: raise ValueError('Image dimensions too large.')
        image=ImageOps.exif_transpose(image).convert('RGB')
        image.thumbnail((1800,1800),Image.Resampling.LANCZOS)
        image.save(path)
        return image.size
    except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError) as exc:
        raise HTTPException(422,'Invalid or oversized image.') from exc

async def run_job(job_id):
    global active, worker
    rec=records[job_id];folder=JOBS/job_id
    try:
        if rec['state']=='cancelled': return
        rec['state']='running'
        if worker is None or worker.returncode is not None:
            env={**os.environ,'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1','TOKENIZERS_PARALLELISM':'false'}
            worker=await asyncio.create_subprocess_exec(sys.executable,str(ROOT/'local-runtime/worker.py'),'--serve',stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.DEVNULL,env=env,cwd=ROOT)
        proc=worker
        rec['process']=proc
        if rec['state']=='cancelled':
            await stop_worker()
            return
        proc.stdin.write((json.dumps({'folder':str(folder)})+'\n').encode())
        await proc.stdin.drain()
        deadline=time.monotonic()+1200
        while True:
            if rec['state']=='cancelled':
                await stop_worker()
                return
            detail={}
            try: detail=json.loads((folder/'progress.json').read_text())
            except (OSError,ValueError): pass
            if detail.get('stage')=='Complete' and (folder/'result.png').exists():
                rec.update(state='succeeded',elapsed=round(time.time()-rec['started'],2))
                break
            if detail.get('stage')=='Failed' or proc.returncode is not None:
                rec.update(state='failed',error=detail.get('error','Inference stopped. Check available memory and retry.'))
                await stop_worker()
                break
            if time.monotonic()>deadline:
                await stop_worker()
                rec.update(state='failed',error='Generation exceeded 20 minutes.')
                break
            await asyncio.sleep(.2)
    except Exception as exc:
        if rec['state']!='cancelled': rec.update(state='failed',error=str(exc))
        await stop_worker()
    finally:
        rec.pop('process',None)
        if active==job_id: active=None

@app.post('/jobs',status_code=202)
async def create_job(photo:UploadFile=File(...),guide:UploadFile=File(...),product:UploadFile=File(...),settings:str=Form(...)):
    global active
    if not ready():raise HTTPException(503,'The local model has not finished downloading. Run the local setup first.')
    try:
        config=json.loads(settings)
        if config['kind'] not in ['earrings','pendant','necklace','ring','bracelet']:raise ValueError()
        regions=config['regions']
        if not isinstance(regions,list) or not 1<=len(regions)<=2:raise ValueError()
        for r in regions:
            if len(r)!=4 or any(not isinstance(n,(int,float)) or not 0<=n<=1 for n in r) or r[2]<=0 or r[3]<=0 or r[0]+r[2]>1.001 or r[1]+r[3]>1.001:raise ValueError()
        config={'kind':config['kind'],'regions':regions,'seed':int(config.get('seed',42))%2**31}
    except (ValueError,TypeError,KeyError,OverflowError):raise HTTPException(422,'Invalid jewellery placement settings.')
    async with lock:
        if active:raise HTTPException(409,'Another local image is being generated. Wait or cancel it first.')
        job_id=secrets.token_hex(16);folder=JOBS/job_id;folder.mkdir()
        size=await save_image(photo,folder/'photo.png')
        guide_size=await save_image(guide,folder/'guide.png')
        await save_image(product,folder/'product.png')
        if size!=guide_size:raise HTTPException(422,'The photo and placement guide must have the same dimensions.')
        (folder/'settings.json').write_text(json.dumps(config))
        records[job_id]={'id':job_id,'state':'queued','started':time.time()}
        active=job_id
        asyncio.create_task(run_job(job_id))
    return {'id':job_id,'state':'queued'}

@app.get('/jobs/{job_id}')
async def get_job(job_id:str):
    rec=record(job_id)
    data={k:v for k,v in rec.items() if k!='process'}
    try:data['progress']=json.loads((JOBS/job_id/'progress.json').read_text())
    except (OSError,ValueError):pass
    return data

@app.post('/jobs/{job_id}/cancel')
async def cancel_job(job_id:str):
    rec=record(job_id)
    if rec['state'] in ['queued','running']:
        rec['state']='cancelled'
        # run_job owns worker shutdown and releases the slot only after it exits.
    return {'id':job_id,'state':rec['state']}

@app.get('/jobs/{job_id}/result')
async def get_result(job_id:str):
    rec=record(job_id)
    if rec['state']!='succeeded':raise HTTPException(409,'Image is not ready.')
    return FileResponse(JOBS/job_id/'result.png',media_type='image/png',filename='atelier-local-try-on.png')
