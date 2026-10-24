"""Service contract tests. Model inference is covered by local-pipeline.mjs."""
import os
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock
from PIL import Image
from fastapi.testclient import TestClient
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-runtime'))
import server

def png(size=(32,32)):
    out=io.BytesIO();Image.new('RGB',size,'gray').save(out,format='PNG');return out.getvalue()

class Service(unittest.TestCase):
    def setUp(self):
        server.records.clear();server.active=None
        self.client=TestClient(server.app)
        self.temp=tempfile.TemporaryDirectory()
        self.jobs=patch.object(server,'JOBS',Path(self.temp.name));self.jobs.start()
        self.ready=patch.object(server,'ready',return_value=True);self.ready.start()
    def tearDown(self):
        self.jobs.stop();self.ready.stop();self.temp.cleanup()
    def submit(self,settings=None,files=None):
        settings=settings or {'kind':'earrings','regions':[[.1,.1,.2,.2]]}
        files=files or {key:(key+'.png',png(),'image/png') for key in ['photo','guide','product']}
        return self.client.post('/jobs',data={'settings':json.dumps(settings)},files=files)
    def test_local_only(self):
        self.assertEqual(self.client.get('/status',headers={'Origin':'https://example.com'}).status_code,403)
        r=self.client.get('/status',headers={'Origin':'http://127.0.0.1:3002'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.headers['access-control-allow-origin'],'http://127.0.0.1:3002')
        self.assertEqual(r.headers['cache-control'],'no-store')
    def test_internal_token(self):
        with patch.dict(os.environ, {'TRYON_SERVICE_TOKEN':'test-only-secret'}):
            self.assertEqual(self.client.get('/status').status_code,401)
            self.assertEqual(self.client.get('/status',headers={'Authorization':'Bearer wrong'}).status_code,401)
            self.assertEqual(self.client.get('/status',headers={'Authorization':'Bearer test-only-secret'}).status_code,200)
    def test_not_ready(self):
        with patch.object(server,'ready',return_value=False):self.assertEqual(self.submit().status_code,503)
    def test_invalid_region(self):
        self.assertEqual(self.submit({'kind':'earrings','regions':[[.9,.1,.2,.2]]}).status_code,422)
    def test_bad_image(self):
        files={key:(key+'.png',b'not an image','image/png') for key in ['photo','guide','product']}
        self.assertEqual(self.submit(files=files).status_code,422)
    def test_mismatched_guide(self):
        files={key:(key+'.png',png((48,32) if key=='guide' else (32,32)),'image/png') for key in ['photo','guide','product']}
        self.assertEqual(self.submit(files=files).status_code,422)
    def test_single_job(self):
        server.active='busy'
        self.assertEqual(self.submit().status_code,409)
    def test_queued_cancel_prevents_inference(self):
        import asyncio
        job_id='a'*32
        server.records[job_id]={'id':job_id,'state':'queued'};server.active=job_id
        self.assertEqual(self.client.post('/jobs/'+job_id+'/cancel').json()['state'],'cancelled')
        with patch('asyncio.create_subprocess_exec',new_callable=AsyncMock) as spawn:
            asyncio.run(server.run_job(job_id));spawn.assert_not_called()
        self.assertIsNone(server.active)
        self.assertEqual(self.client.get('/jobs/'+job_id+'/result').status_code,409)
    def test_five_categories(self):
        for kind in ['ring','earrings','pendant','necklace','bracelet']:
            server.active=None
            with patch.object(server,'run_job',new_callable=AsyncMock):
                self.assertEqual(self.submit({'kind':kind,'regions':[[.1,.1,.2,.2]]}).status_code,202)
        server.active=None
        self.assertEqual(self.submit({'kind':'single','regions':[[.1,.1,.2,.2]]}).status_code,422)
    def test_unknown_job(self):
        self.assertEqual(self.client.get('/jobs/'+'f'*32).status_code,404)

if __name__=='__main__':unittest.main(verbosity=2)
