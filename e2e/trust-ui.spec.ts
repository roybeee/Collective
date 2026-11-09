// X7 신뢰 UI(docs/GLOBAL-PLAN.ko.md 에픽 X7) 여정(모바일·데스크톱): 작업물 상세에서 인용 pill을 키보드로 열고 닫기, AI 출처 배지 팝오버(담당·작성 시각),
// '근거 부족' 작업물은 '직접 확인했습니다' 표시 뒤에만 승인, 규정 점검 패널의 차단 표현과 '다시 점검'.
// 근거: real Chromium·빌드 결과·로컬 D1(wrangler --local)·실제 API / mocked 인증(legacy 로그인 헤더). AI 실행 기록(jobs·role_output_contract)과 AI 작업물은 로컬 D1 fixture로 넣는다(모델 호출 없음).
import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
function runSql(sql:string){
 const folder=mkdtempSync(join(tmpdir(),'collective-trust-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,sql);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'})}finally{rmSync(folder,{recursive:true,force:true})}
}
const record=(owner:string,kind:string,id:string,parent:string,data:unknown)=>`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`;

test('인용 pill·AI 출처 배지·근거 부족 확인 승인·규정 점검 다시 점검',async({browser},info)=>{
 const owner=`trust-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  await page.request.get('/api/workspace');
  const title=`신뢰 UI ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'근거 확인'}}) as {id:string};
  const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString(),now=new Date().toISOString();
  const {id:factId}=await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'주소',value:'합성동 12',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:after}}) as {id:string};
  const job=`trust-job-${info.project.name}-${Date.now()}`,aid='ai-'+createHash('sha256').update(job).digest('hex').slice(0,32),src=`trust-src-${info.project.name}-${Date.now()}`;
  const content='## 게시물 카피\n브랜드 자료 #1에 따르면 평일 오후 방문이 많습니다. 매장은 확정 사실 주소에 있습니다.\n영수증 리뷰 이벤트로 음료를 증정합니다.\n지금 바로 포장 주문하시면 따뜻하게 받아 가실 수 있습니다.';
  runSql([
   `INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(${[job,owner,campaignId,'content','completed','synthetic-model'].map(quote).join(',')},1,${quote(now)},${quote(now)});`,
   record(owner,'brand_source',src,'ofd',{id:src,brandId:'ofd',title:'합성 상권 조사',category:'market',origin:'manual',status:'confirmed',url:'https://example.com/market',content:'합성',observedAt:before,createdAt:before,version:1,scope:'brand'}),
   record(owner,'role_output_contract',job,campaignId,{version:'role-output-v1',role:'content',sections:[],idLabels:{[src]:'브랜드 자료 #1'}}),
   record(owner,'learning_snapshot',job,campaignId,{id:job,campaignId,role:'content',rules:[],createdAt:now}),
   record(owner,'artifact',aid,campaignId,{id:aid,campaignId,campaignVersion:1,role:'content',title:`콘텐츠 신뢰 ${info.project.name}`,content,version:1,status:'review',origin:'ai',factRefs:[{id:factId,version:1,status:'confirmed'}],createdAt:now}),
  ].join('\n'));

  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=outputs`);
  const card=page.locator('.artifact-item').filter({hasText:`콘텐츠 신뢰 ${info.project.name}`});
  await expect(card).toBeVisible({timeout:30_000});
  // 목록 카드: 출처는 배지 버튼이다(카드 버튼 밖).
  await expect(card.getByRole('button',{name:/^AI 작성, 작성 출처 보기/})).toBeVisible();
  await card.locator('.artifact-row').click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // 인용 pill: 키보드로 열고 Esc로 닫으면 포커스가 pill로 돌아간다.
  const pill=dialog.getByRole('button',{name:/^인용 브랜드 자료 #1/});
  await expect(pill).toHaveText('자료 1');
  await pill.focus();await page.keyboard.press('Enter');
  const pop=page.locator('.citation-popover').filter({hasText:'합성 상권 조사'});
  await expect(pop).toBeVisible();await expect(pop).toContainText('내 브랜드 자료');await expect(pop.getByRole('button',{name:'브랜드 아카이브에서 열기'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();await expect(pill).toBeFocused();await expect(dialog).toBeVisible();
  const factPill=dialog.getByRole('button',{name:/^인용 확정 사실 주소/});
  await factPill.focus();await page.keyboard.press('Enter');
  const factPop=page.locator('.citation-popover').filter({hasText:'합성동 12'});
  await expect(factPop).toContainText('확정 사실');await expect(factPop).toContainText('유효기한');
  await page.keyboard.press('Escape');await expect(factPop).toBeHidden();
  // 인용 없는 주장 문장에는 '근거 없음' 표시가 있고, '근거 표시'를 끄면 사라진다.
  await expect(dialog.locator('.no-evidence').first()).toBeVisible();
  await dialog.getByRole('switch',{name:'근거 표시'}).click();
  await expect(dialog.locator('.no-evidence')).toHaveCount(0);
  await dialog.getByRole('switch',{name:'근거 표시'}).click();

  // AI 출처 배지 팝오버: 담당·작성 시각.
  const badge=dialog.getByRole('button',{name:/^AI 작성, 작성 출처 보기/});
  await badge.focus();await page.keyboard.press('Enter');
  const origin=page.locator('.citation-popover').filter({hasText:'작성 경로'});
  await expect(origin).toContainText('콘텐츠 스튜디오');await expect(origin).toContainText('AI 작성 시각');await expect(origin).toContainText('synthetic-model');
  await page.keyboard.press('Escape');await expect(origin).toBeHidden();await expect(badge).toBeFocused();

  // 규정 점검 패널: 차단 표현과 다시 점검.
  const panel=dialog.getByRole('region',{name:'규정 점검'});
  await expect(panel).toContainText('영수증·리뷰 이벤트');await expect(panel).toContainText('차단');
  await expect(panel.getByRole('link',{name:/^법령 근거/}).first()).toHaveAttribute('rel','noopener noreferrer');
  await panel.getByRole('button',{name:'다시 점검'}).click();
  await expect(panel.getByRole('status').filter({hasText:'다시 점검했습니다'})).toBeVisible();

  await page.screenshot({path:`e2e/artifacts/${info.project.name}-trust-ui-dialog.png`});
  // 근거 부족: 직접 확인 표시 전에는 승인할 수 없다.
  await expect(dialog.locator('.confidence-label')).toContainText('근거 부족');
  const approve=dialog.getByRole('button',{name:'이 버전 승인'});
  await expect(approve).toBeDisabled();
  await expect(dialog.getByText('직접 확인했습니다를 먼저 표시하세요.')).toBeVisible();
  await dialog.getByRole('checkbox',{name:'직접 확인했습니다'}).click();
  await expect(approve).toBeEnabled();
  const request=page.waitForRequest(r=>r.url().endsWith('/api/action')&&r.method()==='POST'&&(r.postData()??'').includes('review_artifact'));
  await approve.click();
  const sent=JSON.parse((await request).postData()??'{}');
  expect(sent.manuallyVerified).toBe(true);
  await expect(page.getByText('현재 버전을 승인했습니다.')).toBeVisible();
  await page.screenshot({path:`e2e/artifacts/${info.project.name}-trust-ui.png`,fullPage:true});
 }finally{await context.close()}
});
