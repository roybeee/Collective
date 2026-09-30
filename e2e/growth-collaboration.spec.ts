import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Real local D1/API/Chromium. The creator demand sequence is a local fixture; no contact, send or payment happens.
function fixture(owner:string,kind:string,id:string,parent:string,data:unknown){
 const quote=(value:string)=>`'${value.replaceAll("'","''")}'`,folder=mkdtempSync(join(tmpdir(),'collective-collab-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true})}
}
test('크리에이터 협업 계획·단계 영수증·광고 표시 승인 게이트',async({browser},info)=>{
 const owner=`collab-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'협업 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'협업'}});
  const title=`협업 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'협업'}});
  const at=new Date().toISOString(),step={id:'creator-step',channel:'organic',placement:'creator',message:'리뷰',useScene:'점심',creativeBrief:'실사',keywords:[],audience:'직장인',purchaseUrl:'https://example.com/buy',sourceUrls:['https://example.com/r'],rightsStatus:'confirmed',rightsEvidence:'계약',authenticityConfirmed:true,partnerRole:'리뷰',partnerTerms:'고정비',plannedCost:300000,performanceStatus:'not_measured',performanceEvidence:'',performanceNote:''};
  fixture(owner,'growth_demand','collab-seq',campaignId,{id:'collab-seq',brandId:'ofd',campaignId,campaignVersion:1,version:1,input:{title:'협업 수요',offerId:'offer',offerVersion:1,missionId:'mission',missionVersion:1,objective:'첫 구매',steps:[step]},requestDigest:'x',createdAt:at,updatedAt:at,updatedBy:owner});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^크리에이터·파트너 협업$/}).click();const panel=page.getByRole('region',{name:'크리에이터 파트너 협업',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await panel.getByRole('button',{name:'새 협업',exact:true}).click();await panel.getByRole('combobox',{name:'수요 단계',exact:true}).selectOption('collab-seq|creator-step');
  await panel.getByRole('textbox',{name:'협업자 별칭(가명 ID)',exact:true}).fill('creator-alpha');await panel.getByRole('textbox',{name:'청중 적합 근거',exact:true}).fill('직장인 비중 자료');await panel.getByRole('textbox',{name:'브리프',exact:true}).fill('점심 준비 장면');
  await panel.getByRole('textbox',{name:'사용 권리 범위',exact:true}).fill('자사 계정 재게시');await panel.getByRole('textbox',{name:'조건',exact:true}).fill('1회 게시');await panel.getByRole('spinbutton',{name:'고정 수수료(원)',exact:true}).fill('250000');
  await panel.getByLabel('납품 기한',{exact:true}).fill('2099-01-10');await panel.getByLabel('게시 기한',{exact:true}).fill('2099-01-20');
  await panel.getByRole('button',{name:'협업 계획 저장',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'협업 계획을 저장했습니다'})).toBeVisible();await expect(panel).toContainText('추적 코드가 없어');
  const id=(await panel.locator('legend').filter({hasText:/^협업 collab-/}).innerText()).replace('협업 ','').trim();
  const now=new Date(Date.now()-60000),local=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const stage=async(s:string,extra?:()=>Promise<void>)=>{await panel.getByRole('combobox',{name:'다음 단계',exact:true}).selectOption(s);await panel.getByLabel('발생 시각',{exact:true}).fill(local);await panel.getByRole('textbox',{name:'증빙 ID',exact:true}).fill('ev-'+s);if(extra)await extra();await panel.getByRole('button',{name:`${id} 단계 기록`,exact:true}).click();};
  await stage('agreed');await expect(panel).toContainText(`${id} · 합의`);await stage('delivered');await expect(panel).toContainText(`${id} · 콘텐츠 납품`);
  await stage('approved');await expect(panel.getByRole('alert')).toContainText('광고·협찬 표시');
  await panel.getByLabel('광고·협찬 표시 확인').check();await panel.getByLabel('가짜 참여·후기 없음 확인').check();await panel.getByRole('button',{name:`${id} 단계 기록`,exact:true}).click();await expect(panel).toContainText(`${id} · 브랜드 승인`);
  await expect(panel).toContainText('인과 효과: 미측정');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
