"""Real inference smoke test: pass a saved job folder as the first argument."""
import json
import sys
import time
from pathlib import Path
import httpx
from PIL import Image, ImageChops
source=Path(sys.argv[1])
with httpx.Client(base_url='http://127.0.0.1:8765',timeout=30) as client:
    for warm in [False,True]:
        files={k:(k+'.png',(source/(k+'.png')).read_bytes(),'image/png') for k in ['photo','guide','product']}
        response=client.post('/jobs',files=files,data={'settings':(source/'settings.json').read_text()})
        response.raise_for_status();job=response.json()['id']
        deadline=time.time()+180
        while time.time()<deadline:
            data=client.get('/jobs/'+job).json()
            if data['state'] in ['succeeded','failed','cancelled']:break
            time.sleep(.5)
        assert data['state']=='succeeded',data
        assert data['progress']['warm_model']==warm,data
        result=client.get('/jobs/'+job+'/result');result.raise_for_status()
        folder=Path('local-runtime/jobs')/job
        original=Image.open(folder/'photo.png').convert('RGB')
        edited=Image.open(folder/'result.png').convert('RGB')
        mask=Image.open(folder/'edit-mask.png')
        assert original.size==edited.size
        outside=mask.point(lambda x:255 if x==0 else 0)
        diff=ImageChops.difference(original,edited)
        assert Image.composite(diff,Image.new('RGB',original.size),outside).getbbox() is None
        print(json.dumps({'job':job,'elapsed':data['elapsed'],'progress':data['progress'],'outside_mask_unchanged':True}),flush=True)
