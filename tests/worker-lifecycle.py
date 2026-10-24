"""Worker reuse/cancellation and crop correctness without loading model weights."""
import asyncio
import json
import tempfile
import time
import unittest
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'local-runtime'))
import server
from imaging import crop_box, working_size

class FakeProcess:
    def __init__(self):
        self.returncode=None
        self.stdin=self
        self.completed=True
    def write(self, data):
        folder=Path(json.loads(data)['folder'])
        if self.completed:
            (folder/'result.png').write_bytes(b'png')
            (folder/'progress.json').write_text(json.dumps({'stage':'Complete'}))
    async def drain(self): pass
    def terminate(self): self.returncode=-15
    def kill(self): self.returncode=-9
    async def wait(self): return self.returncode

class Lifecycle(unittest.IsolatedAsyncioTestCase):
    async def test_reuse_and_cancel_and_restart(self):
        with tempfile.TemporaryDirectory() as temp:
            server.worker=None;server.records.clear()
            spawned=[]
            async def spawn(*args,**kwargs):
                p=FakeProcess();spawned.append(p);return p
            with patch.object(server,'JOBS',Path(temp)),patch('asyncio.create_subprocess_exec',spawn):
                def setup(i):
                    key=f'{i:032x}';(Path(temp)/key).mkdir()
                    server.records[key]={'state':'queued','started':time.time()}
                    server.active=key
                    return key
                await server.run_job(setup(1));await server.run_job(setup(2))
                self.assertEqual(len(spawned),1)
                spawned[0].completed=False
                key=setup(3)
                task=asyncio.create_task(server.run_job(key))
                await asyncio.sleep(.01)
                await server.cancel_job(key)
                await task
                self.assertEqual(spawned[0].returncode,-15)
                self.assertEqual(server.records[key]['state'],'cancelled')
                self.assertIsNone(server.active)
                await server.run_job(setup(4))
                self.assertEqual(len(spawned),2)
                self.assertEqual(server.records[f'{4:032x}']['state'],'succeeded')
                await server.stop_worker()

class Crops(unittest.TestCase):
    def test_contains_regions_at_edges_and_pair(self):
        for regions in [[[0,0,.1,.1]],[[.9,.9,.1,.1]],[[.1,.4,.1,.2],[.8,.4,.1,.2]]]:
            box=crop_box((1000,1500),regions)
            self.assertTrue(0<=box[0]<box[2]<=1000 and 0<=box[1]<box[3]<=1500)
            for x,y,w,h in regions:
                self.assertLessEqual(box[0],x*1000);self.assertLessEqual(box[1],y*1500)
                self.assertGreaterEqual(box[2],(x+w)*1000);self.assertGreaterEqual(box[3],(y+h)*1500)
    def test_tighter_crop_reduces_work_and_preserves_context(self):
        regions=[[.12,.46,.19,.084],[.70,.46,.19,.084]]
        tight=crop_box((988,1484),regions)
        balanced=crop_box((988,1484),regions,mode='balanced')
        def pixels(box):
            w,h=working_size((box[2]-box[0],box[3]-box[1]),768)
            return w*h
        self.assertLess(pixels(tight),pixels(balanced)*.7)
        for x,y,w,h in regions:
            self.assertGreaterEqual(y*1484-tight[1],988*.028)
            self.assertGreaterEqual(tight[3]-(y+h)*1484,988*.028)
    def test_full_frame_and_working_dimensions(self):
        self.assertEqual(crop_box((988,1484),[[.2,.3,.1,.1]],False),(0,0,988,1484))
        w,h=working_size((988,595),768)
        self.assertEqual((w,h),(768,448))

if __name__=='__main__':unittest.main(verbosity=2)
