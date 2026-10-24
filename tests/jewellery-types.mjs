import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=(await fs.readFile('lib/tryon/camera-fit.ts','utf8')).replace(/import \{ usesHand, usesBody, type Landmark \} from '.\/landmarks';/, `const usesHand = k => ['ring','bracelet'].includes(k); const usesBody = k => ['pendant','necklace'].includes(k);`);
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {assessCamera}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const hand=Array.from({length:21},()=>({x:.5,y:.4,z:0}));
Object.assign(hand,{0:{x:.5,y:.75,z:0},5:{x:.3,y:.5,z:0},9:{x:.45,y:.45,z:0},13:{x:.55,y:.5,z:0},14:{x:.55,y:.38,z:0},15:{x:.55,y:.27,z:0},16:{x:.55,y:.17,z:0},17:{x:.7,y:.5,z:0},10:{x:.42,y:.38,z:0},18:{x:.7,y:.38,z:0}});
for(const kind of ['ring','bracelet']){
 assert.ok(assessCamera([hand],kind,1).every(c=>c.pass),JSON.stringify(assessCamera([hand],kind,1)));
 assert.ok(!assessCamera([],kind,1).every(c=>c.pass));
 assert.ok(!assessCamera([hand,hand],kind,1).every(c=>c.pass));
}
const curled=structuredClone(hand);curled[16].y=.49;assert.ok(!assessCamera([curled],'ring',1).every(c=>c.pass));
const cut=structuredClone(hand);cut[0].y=.94;assert.ok(!assessCamera([cut],'bracelet',1).every(c=>c.pass));
const body=Array.from({length:33},()=>({x:.5,y:.4,z:0,visibility:1}));body[0]={x:.5,y:.2,z:0,visibility:1};body[11]={x:.25,y:.45,z:0,visibility:1};body[12]={x:.75,y:.45,z:0,visibility:1};
for(const kind of ['pendant','necklace']){assert.ok(assessCamera([body],kind,1).every(c=>c.pass));const occluded=structuredClone(body);occluded[11].visibility=.1;assert.ok(!assessCamera([occluded],kind,1).every(c=>c.pass));}
console.log('PASS ring finger, wrist margins, body visibility, multiple/missing subjects, curled finger');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:3003/');
await expect(page.getByLabel('Upload portrait')).toBeEnabled();
assert.deepEqual(await page.getByLabel('Try-on type').locator('option').allTextContents(),['Ring','Earring','Pendant','Necklace','Bracelet']);
const photo=(await fs.readFile('tests/fixtures/portrait.jpg')).toString('base64');
const result=await page.evaluate(async photo=>{
 const {createLandmarkDetector}=await import('/lib/tryon/landmarks.ts');
 const {suggestPoints}=await import('/lib/tryon/face.ts');
 const image=new Image();image.src='data:image/jpeg;base64,'+photo;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);
 const out={};
 for(const kind of ['ring','bracelet','pendant','necklace','earrings']) {
  const d=await createLandmarkDetector(kind,'IMAGE');try {const found=d.detect(c);const points=suggestPoints(found.length===1?found[0]:null,kind);out[kind]={counts:found.map(f=>f.length),points};}finally{d.close();}
 }
 return out;
},photo);
assert.ok(result.earrings.counts[0]>=468);assert.equal(result.pendant.counts[0],33);assert.equal(result.necklace.counts[0],33);
for(const r of Object.values(result))assert.ok(r.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));
console.log('PASS actual local hand/body/face model loading and inference',JSON.stringify(result));
const handPhoto=(await fs.readFile('tests/fixtures/hands.jpg')).toString('base64');
const hands=await page.evaluate(async data=>{
 const {createLandmarkDetector}=await import('/lib/tryon/landmarks.ts');const {suggestPoints}=await import('/lib/tryon/face.ts');const {assessCamera}=await import('/lib/tryon/camera-fit.ts');
 const image=new Image();image.src='data:image/jpeg;base64,'+data;await image.decode();
 const c=document.createElement('canvas');c.width=c.height=640;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,640);ctx.drawImage(image,360,0,360,382,100,80,440,467);
 const d=await createLandmarkDetector('ring','IMAGE');try {const found=d.detect(c);return {counts:found.map(f=>f.length),ring:suggestPoints(found[0],'ring'),bracelet:suggestPoints(found[0],'bracelet'),checks:assessCamera(found,'ring',1)};}finally{d.close();}
},handPhoto);
assert.deepEqual(hands.counts,[21]);assert.notDeepEqual(hands.ring,hands.bracelet);assert.ok(hands.checks.every(c=>c.pass),JSON.stringify(hands));console.log('PASS real hand detection and distinct finger/wrist anchors',JSON.stringify(hands));
await page.getByLabel('Upload portrait').setInputFiles('tests/fixtures/portrait.jpg');
for(const kind of ['ring','bracelet','necklace','pendant','earrings']) {
 await expect(page.getByLabel('Try-on type')).toBeEnabled({timeout:60000});await page.getByLabel('Try-on type').selectOption(kind);await expect(page.getByRole('button',{name:'Use camera',exact:true})).toBeEnabled({timeout:60000});
}
assert.deepEqual(errors,[]);console.log('PASS all five type changes re-detect uploaded photo without browser errors');
} finally {await browser.close();}
