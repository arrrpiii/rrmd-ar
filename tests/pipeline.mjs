import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const waitReady=()=>expect(page.locator('button.primary')).toBeEnabled({timeout:60000});
const generate=async()=>{await waitReady();await page.locator('button.primary').click();await expect(page.getByAltText('Generated jewellery try-on')).toBeVisible({timeout:60000});};
const pixels=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return page.locator('canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));};
const results=[];const pass=(name,data={})=>{results.push({name,...data});console.log('PASS',name,JSON.stringify(data));};
try{
 await page.goto('http://localhost:3002/',{waitUntil:'networkidle'});
 await expect(page.locator('button.primary')).toBeDisabled();
 await page.getByLabel('Upload portrait').setInputFiles('tests/fixtures/portrait.jpg');
 await expect(page.getByText('Face detected',{exact:true})).toBeVisible({timeout:60000});pass('Actual pretrained face detection');
 await page.getByLabel('Upload jewellery model').setInputFiles('../RDLB501-0.50CT.3dm');
 await expect(page.getByRole('alert')).toContainText('116 CAD objects',{timeout:60000});await expect(page.locator('button.primary')).toBeDisabled();pass('Incomplete CAD rejected instead of silently omitting parts');
 for(const file of ['RDLR556.3dm','RDLR851.3dm','RDWT284.3dm']){
  await page.getByLabel('Upload jewellery model').setInputFiles('../'+file);await waitReady();await generate();
  const after=await pixels();await page.getByRole('button',{name:'Show original',exact:true}).click();const before=await pixels();assert.equal(before.length,after.length);
  let changed=0;for(let i=0;i<before.length;i+=4)if(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])>12)changed++;
  assert.ok(changed>100,'Jewellery must actually change the output pixels');assert.ok(changed<before.length/4*.4,'Photo must remain intact outside jewellery');
  await page.getByRole('button',{name:'Show try-on',exact:true}).click();pass('Rhino import, render and original comparison: '+file,{changedPixels:changed});
 }
 await page.getByLabel('Try-on type').selectOption('pendant');await expect(page.getByRole('link',{name:'Download PNG'})).toHaveCount(0);await generate();await expect(page.locator('.anchor')).toHaveCount(1);pass('Pendant mode and stale export invalidation');
 await page.getByLabel('Size',{exact:true}).fill('8');await expect(page.getByRole('link',{name:'Download PNG'})).toHaveCount(0);await generate();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download PNG'}).click()]);await download.saveAs('test-results/try-on-verified.png');
 const bytes=await fs.readFile('test-results/try-on-verified.png');assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.ok(bytes.length>10000);
 const exportMatch=await page.evaluate(async()=>{const img=document.querySelector('.result-image');await img.decode();const source=document.querySelector('canvas');const copy=document.createElement('canvas');copy.width=img.naturalWidth;copy.height=img.naturalHeight;copy.getContext('2d').drawImage(img,0,0);return source.width===copy.width&&source.height===copy.height&&source.toDataURL()===copy.toDataURL();});assert.ok(exportMatch);pass('PNG download matches composite pixels and dimensions exactly, no markers',{bytes:bytes.length});
 await page.getByRole('button',{name:'Reset placement'}).click();await expect(page.getByRole('link',{name:'Download PNG'})).toHaveCount(0);pass('Placement reset invalidates download');
 await page.getByLabel('Upload jewellery model').setInputFiles({name:'broken.glb',mimeType:'application/octet-stream',buffer:Buffer.from('not a glb')});await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('button.primary')).toBeDisabled();pass('Corrupt model rejected');
 // A small tetrahedron exercises binary GLB and ASCII STL independently of Rhino.
 const points=[0,0,0, 1,0,0, 0,1,0, 0,0,1],indices=[0,2,1,0,1,3,0,3,2,1,2,3];
 const bin=Buffer.alloc(72);points.forEach((n,i)=>bin.writeFloatLE(n,i*4));indices.forEach((n,i)=>bin.writeUInt16LE(n,48+i*2));
 const spec={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{byteLength:72}],bufferViews:[{buffer:0,byteOffset:0,byteLength:48,target:34962},{buffer:0,byteOffset:48,byteLength:24,target:34963}],accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3',min:[0,0,0],max:[1,1,1]},{bufferView:1,componentType:5123,count:12,type:'SCALAR'}]};
 let json=JSON.stringify(spec);json+=' '.repeat((4-json.length%4)%4);const glb=Buffer.alloc(12+8+json.length+8+bin.length);glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(json.length,12);glb.writeUInt32LE(0x4e4f534a,16);glb.write(json,20);glb.writeUInt32LE(bin.length,20+json.length);glb.writeUInt32LE(0x004e4942,24+json.length);bin.copy(glb,28+json.length);
 let stl='solid sample\n';for(let i=0;i<indices.length;i+=3){stl+='facet normal 0 0 0\nouter loop\n';for(const idx of indices.slice(i,i+3))stl+=`vertex ${points.slice(idx*3,idx*3+3).join(' ')}\n`;stl+='endloop\nendfacet\n';}stl+='endsolid sample';
 for(const [name,buffer]of [['sample.glb',glb],['sample.stl',Buffer.from(stl)]]){await page.getByLabel('Upload jewellery model').setInputFiles({name,mimeType:'application/octet-stream',buffer});await generate();pass('Upload and generation: '+name);}
 await page.getByText('Orientation & finish').click();await page.getByLabel('Finish',{exact:true}).selectOption('gold');await page.getByRole('slider',{name:'Turn Y',exact:true}).fill('45');await generate();pass('Material and orientation controls');
 const blank=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=400;c.getContext('2d').fillRect(0,0,400,400);return c.toDataURL().split(',')[1];});await page.getByLabel('Upload portrait').setInputFiles({name:'no-face.png',mimeType:'image/png',buffer:Buffer.from(blank,'base64')});await expect(page.getByText('Manual placement',{exact:true})).toBeVisible({timeout:60000});await generate();pass('No-face fallback still allows manual generation');
 await page.getByLabel('Upload portrait').setInputFiles({name:'bad.jpg',mimeType:'image/jpeg',buffer:Buffer.from('invalid image')});await expect(page.getByRole('alert')).toBeVisible();pass('Invalid photo rejected');
 await page.getByLabel('Upload portrait').setInputFiles('tests/fixtures/portrait.jpg');await expect(page.getByText('Face detected',{exact:true})).toBeVisible({timeout:60000});await page.getByLabel('Upload jewellery model').setInputFiles('../RDLR851.3dm');await waitReady();await page.getByLabel('Try-on type').selectOption('earrings');await generate();await page.screenshot({path:'test-results/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));pass('Mobile layout: no horizontal overflow');
 assert.deepEqual(errors,[]);pass('No uncaught browser errors');
 const external=requests.filter(x=>!x.startsWith('http://localhost:3002')&&!x.startsWith('blob:')&&!x.startsWith('data:'));assert.deepEqual(external,[]);pass('No third-party requests during processing');
 await fs.writeFile('test-results/report.json',JSON.stringify(results,null,2));
}finally{await browser.close();}
