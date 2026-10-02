import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Real local D1/API/Chromium. The failed experiment result is a local fixture; no prompt registry or evaluation call.
function fixture(owner:string,kind:string,id:string,parent:string,data:unknown){
 const quote=(value:string)=>`'${value.replaceAll("'","''")}'`,folder=mkdtempSync(join(tmpdir(),'collective-opt-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true})}
}
test('실패 근거 최적화 후보·예산 상한·동결·오프라인≠매출',async({browser},info)=>{
 const owner=`opt-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'최적화 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'최적화'}});
  const title=`최적화 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'최적화'}});
  fixture(owner,'growth_experiment_result','bad-exp:1',campaignId,{id:'bad-exp:1',designId:'bad-exp',campaignId,brandId:'ofd',analysisNumber:1,designDigest:'d',inputDigest:'i',analysis:{status:'rejected',analysisVersion:'growth_sales_v1',reasons:['악화'],assigned:{control:10,treatment:10},analysed:{control:10,treatment:10},excluded:{notExposed:0,trackingIncomplete:0,contaminated:0,unknownValue:0},srm:{chi2:0,p:1,mismatch:false},statistics:null,descriptive:{controlMean:0.2,treatmentMean:0.1},causalScope:'범위'},lineage:[],recordedAt:new Date().toISOString(),recordedBy:owner});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^최적화 후보 샌드박스$/}).click();const panel=page.getByRole('region',{name:'최적화 후보 샌드박스',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await panel.getByRole('textbox',{name:'실패 근거 ID',exact:true}).fill('bad-exp:1');await panel.getByRole('textbox',{name:'실패 원인 요약',exact:true}).fill('문구 실험 악화');await panel.getByRole('textbox',{name:'대상 참조',exact:true}).fill('channel.commerce');await panel.getByRole('textbox',{name:'개선 제안',exact:true}).fill('배송 확실성을 먼저 제시');
  const tokens=panel.getByRole('spinbutton',{name:'토큰 예산',exact:true});await tokens.fill('900000');await panel.getByRole('button',{name:'후보 저장',exact:true}).click();expect(await tokens.evaluate(e=>(e as HTMLInputElement).validity.rangeOverflow)).toBe(true);await expect(panel).toContainText('최적화 후보가 없습니다');
  await panel.getByRole('spinbutton',{name:'토큰 예산',exact:true}).fill('50000');await panel.getByRole('button',{name:'후보 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'후보를 저장했습니다'})).toBeVisible();
  const id=(await panel.locator('li').first().innerText()).split(/\s*,\s+/)[1].trim();await panel.getByRole('button',{name:`${id} 동결`,exact:true}).click();await expect(panel).toContainText(`${id}, 동결`);await expect(panel).toContainText('오프라인: 미실행, 판매: 미연결');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
