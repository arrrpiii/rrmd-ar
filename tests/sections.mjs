import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.goto('http://127.0.0.1:3003/');
 await expect(page.getByLabel('Upload jewellery model')).toBeEnabled({timeout:30000});
 await page.getByLabel('Upload jewellery model').setInputFiles('../RDLR851.3dm');
 await expect(page.getByLabel('Upload portrait')).toBeEnabled({timeout:60000});
 await page.getByLabel('Upload portrait').setInputFiles('tests/fixtures/portrait.jpg');
 await expect(page.getByRole('button',{name:'Preview placement',exact:true})).toBeEnabled({timeout:60000});
 await page.getByRole('button',{name:'Preview placement',exact:true}).click();
 await expect(page.getByRole('slider',{name:'Size',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Generate try-on',exact:true})).toBeEnabled();
 // Stub only GPU work: verify relocated controls, job polling, display and download wiring.
 await page.route('http://127.0.0.1:8765/jobs',r=>r.fulfill({json:{id:'layout-test'}}));
 await page.route('http://127.0.0.1:8765/jobs/layout-test',r=>r.fulfill({json:{state:'succeeded'}}));
 await page.route('http://127.0.0.1:8765/jobs/layout-test/result',async r=>r.fulfill({contentType:'image/png',body:await fs.readFile('test-results/local-ai-try-on.png')}));
 await page.getByRole('button',{name:'Generate try-on',exact:true}).click();
 await expect(page.getByAltText('Locally generated natural jewellery try-on')).toBeVisible({timeout:15000});
 await expect(page.getByRole('link',{name:'Download PNG'})).toBeVisible();
 await page.screenshot({path:'test-results/sections-desktop.png',fullPage:true});
 await page.getByRole('slider',{name:'Size',exact:true}).fill('9');
 await expect(page.getByRole('link',{name:'Download PNG'})).toHaveCount(0);
 console.log('PASS CAD upload, photo upload, preview controls, try-on result/download wiring (stubbed inference), stale result clearing');
}finally{await browser.close();}
