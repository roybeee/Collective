import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Real local D1/API/Chromium. Demand sequence, intent and approved publication are local fixtures; only one response loss is injected.
function fixture(owner:string,kind:string,id:string,parent:string,data:unknown){
 const quote=(value:string)=>`'${value.replaceAll("'","''")}'`,folder=mkdtempSync(join(tmpdir(),'collective-demand-evidence-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true})}
}
test('수요 단계 발행 근거 연결·크리에이터 차단·응답 유실 재시도·판 충돌 입력 보존',async({browser},info)=>{
 const owner=`demand-evidence-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'수요 근거 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'수요 근거'}});
  const title=`수요 근거 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'단계 근거'}});
  const at=new Date().toISOString(),step={id:'owned-step',channel:'organic',placement:'owned',message:'점심 한 그릇',useScene:'평일 점심',creativeBrief:'실사',keywords:[],audience:'직장인',purchaseUrl:'https://example.com/buy',sourceUrls:['https://example.com/r'],rightsStatus:'confirmed',rightsEvidence:'자체 촬영',authenticityConfirmed:true,partnerRole:'',partnerTerms:'',plannedCost:0,performanceStatus:'not_measured',performanceEvidence:'',performanceNote:''};
  const seq={id:'demand-seq',brandId:'ofd',campaignId,campaignVersion:1,version:1,input:{title:'점심 수요',offerId:'offer',offerVersion:1,missionId:'mission',missionVersion:2,objective:'첫 구매',steps:[step,{...step,id:'creator-step',placement:'creator',partnerRole:'리뷰',partnerTerms:'고정비'}]},requestDigest:'x',createdAt:at,updatedAt:at,updatedBy:owner};
  fixture(owner,'growth_demand','demand-seq',campaignId,seq);
  fixture(owner,'growth_action_intent','intent-one',campaignId,{id:'intent-one',campaignId,brandId:'ofd',storeId,input:{missionId:'mission',missionVersion:2},snapshot:{mission:{channel:'organic',offerId:'offer',offerVersion:1}}});
  fixture(owner,'growth_publication_link','intent-one',campaignId,{id:'intent-one',version:1,campaignId,brandId:'ofd',intentId:'intent-one',publicationId:'pub-one',status:'scheduled',lastPublicationVersion:1,currentIntentVersion:1,currentMissionVersion:2,releaseEvidence:null,snapshot:{approvedPublicationVersion:1,publication:{id:'pub-one',campaignId,campaignVersion:1,caption:'합성 캡션',scheduledAt:at,plannedCostKRW:0},intentVersion:1,missionVersion:2,commitmentVersion:1,inventoryVersion:1,publisher:'buffer',evidenceRef:'publication-check',confirmedBy:owner,confirmedAt:at},snapshotDigest:'d'.repeat(64),createdAt:at,updatedAt:at});
  fixture(owner,'execution_publication','pub-one',campaignId,{id:'pub-one',campaignId,status:'accepted',scheduledAt:at});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^수요 단계 ↔ 발행 근거$/}).click();const panel=page.getByRole('region',{name:'수요 단계 발행 근거',exact:true});await expect(panel).toBeVisible({timeout:5000});
  const sequence=panel.getByRole('combobox',{name:'수요 시퀀스',exact:true}),stepBox=panel.getByRole('combobox',{name:'수요 단계',exact:true}),link=panel.getByRole('combobox',{name:'승인된 발행 연결',exact:true}),evidence=panel.getByRole('textbox',{name:'연결 확인 근거 (개인정보 제외)',exact:true}),submit=panel.getByRole('button',{name:'근거 연결',exact:true});
  await sequence.selectOption('demand-seq');await stepBox.selectOption('creator-step');await link.selectOption('intent-one');await evidence.fill('check-001');
  await expect(panel).toContainText('크리에이터·파트너·광고 단계는 자체 계정 발행 근거로 대체할 수 없습니다.');await expect(submit).toBeDisabled();
  await stepBox.selectOption('owned-step');await expect(submit).toBeEnabled();
  const attempts:string[]=[];let lose=true;await page.route('**/api/growth/demand-evidence',async route=>{if(route.request().method()==='POST'){attempts.push(route.request().postDataJSON().requestId);if(lose){lose=false;await route.fetch();await route.abort('failed');return;}}await route.continue();});
  await submit.click();await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다');await expect(evidence).toHaveValue('check-001');
  await submit.click();await expect(panel.getByRole('status').filter({hasText:'연결했습니다'})).toBeVisible();expect(attempts.length).toBe(2);expect(attempts[0]).toBe(attempts[1]);
  await expect(panel).toContainText('공급자 접수(게시 아님)');await expect(panel).toContainText('게시 완료 전');await expect(panel).toContainText('인과 효과: 미측정');
  fixture(owner,'growth_demand','demand-seq',campaignId,{...seq,version:2});
  await stepBox.selectOption('creator-step');await stepBox.selectOption('owned-step');await evidence.fill('check-002');await panel.getByRole('button',{name:'다른 단계로 다시 연결',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('변경');await expect(evidence).toHaveValue('check-002');
  await panel.getByRole('button',{name:'단계 근거 새로고침',exact:true}).click();await expect(panel.getByRole('button',{name:'현재 입력 유지 · 최신 판 채택',exact:true})).toBeVisible();await panel.getByRole('button',{name:'현재 입력 유지 · 최신 판 채택',exact:true}).click();await expect(evidence).toHaveValue('check-002');
  await panel.getByRole('button',{name:'다른 단계로 다시 연결',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'연결했습니다'})).toBeVisible();
  await panel.getByRole('button',{name:'연결 해제',exact:true}).click();await expect(panel).toContainText('연결된 단계 근거가 없습니다');await panel.locator('summary').filter({hasText:'연결 이력'}).click();await expect(panel).toContainText('v3 · 해제');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
