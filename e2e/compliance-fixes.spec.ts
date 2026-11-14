// 규정 수정 제안(docs/COMPLIANCE-FIXES.ko.md) 여정(모바일·데스크톱): 협찬 표기·가상인물·AI 이미지 표시가 빠진 AI 작업물 → 패널에 규칙별 제안(어절 비교) →
// 고르고 확인 카드(무엇·어디·되돌림)로 적용 → 새 판의 점검 결과에서 걸린 표현이 사라짐 → 캠페인 이력 탭에 '규정 수정 제안 3건 적용'.
// 근거: real Chromium·빌드 결과·로컬 D1(wrangler --local)·실제 API / mocked 인증(legacy 로그인 헤더). AI 작업물은 로컬 D1 fixture로 넣는다(모델 호출 없음).
import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
function runSql(sql:string){
 const folder=mkdtempSync(join(tmpdir(),'collective-fixes-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,sql);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'})}finally{rmSync(folder,{recursive:true,force:true})}
}
const record=(owner:string,kind:string,id:string,parent:string,data:unknown)=>`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`;

test('규정 수정 제안: 제안 보기 → 골라 적용 → 새 버전 점검 통과 → 이력 문구',async({browser},info)=>{
 const owner=`fixes-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  await page.request.get('/api/workspace');
  await post('/api/feature-flags',{action:'set',flag:'compliance_fixes',enabled:true});
  const title=`규정 수정 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'표기 점검'}}) as {id:string};
  const aid=`fix-${info.project.name}-${Date.now()}`,now=new Date().toISOString(),name=`콘텐츠 표기 ${info.project.name}`;
  const content='## 게시물 카피\n인플루언서에게 제품을 무상 제공하고 후기 게시를 요청한다.\n가상 인플루언서 루나가 매장을 소개하는 릴스를 게시한다.\n생성형 AI로 만든 매장 이미지를 메인 배너에 쓴다.';
  runSql(record(owner,'artifact',aid,campaignId,{id:aid,campaignId,campaignVersion:1,role:'content',title:name,content,version:1,status:'review',origin:'ai',createdAt:now}));

  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=outputs`);
  const card=page.locator('.artifact-item').filter({hasText:name});
  await expect(card).toBeVisible({timeout:30_000});
  await card.locator('.artifact-row').click();
  const dialog=page.getByRole('dialog');
  const panel=dialog.getByRole('region',{name:'규정 점검'});
  await expect(panel).toContainText('협찬·광고 관계 표기 누락');await expect(panel).toContainText('가상인물 추천·보증 표시 누락');
  const fixes=panel.getByRole('region',{name:'수정 제안'});
  await expect(fixes).toBeVisible();
  // 규칙마다 제안과 어절 비교(추가 표시)가 있다.
  await expect(fixes.locator('[data-rule="sponsorship_undisclosed"] .vd-ins')).toContainText('#광고');
  await expect(fixes.locator('[data-rule="virtual_person_undisclosed"] .vd-ins')).toContainText('가상인물이 포함된 게시물');
  await expect(fixes.locator('[data-rule="ai_generated_unlabeled"]')).toContainText('확인 필요');
  const apply=fixes.getByRole('button',{name:'선택한 수정 적용'});
  await expect(apply).toBeDisabled();
  for(const box of await fixes.getByRole('checkbox').all())await box.click();
  await expect(apply).toBeEnabled();
  await apply.click();
  const ask=page.getByRole('alertdialog',{name:'규정 수정 제안 3건을 적용할까요?'});
  await expect(ask).toContainText('이전 버전으로 되돌릴 수 있음');await expect(ask).toContainText('v1');await expect(ask).toContainText('v2');
  await page.screenshot({path:`e2e/artifacts/${info.project.name}-compliance-fixes-confirm.png`});
  const request=page.waitForRequest(r=>r.url().endsWith('/api/action')&&r.method()==='POST'&&(r.postData()??'').includes('apply_compliance_fixes'));
  await ask.getByRole('button',{name:'적용',exact:true}).click();
  const sent=JSON.parse((await request).postData()??'{}');
  expect(sent.version).toBe(1);expect(sent.fixIds).toHaveLength(3);expect(sent.content).toBeUndefined();
  await expect(panel.getByRole('status').filter({hasText:'v2 점검 결과입니다'})).toBeVisible();
  await expect(panel).not.toContainText('협찬·광고 관계 표기 누락');await expect(panel).not.toContainText('가상인물 추천·보증 표시 누락');await expect(panel).not.toContainText('AI 생성 소재 표시 필요');
  await expect(panel.getByRole('region',{name:'수정 제안'})).toHaveCount(0);
  await page.screenshot({path:`e2e/artifacts/${info.project.name}-compliance-fixes-applied.png`});

  // 저장된 새 버전: 서버가 적용한 본문과 ai_edited 출처.
  const detail=await (await page.request.get('/api/campaigns/'+encodeURIComponent(campaignId))).json() as {artifacts:{id:string;version:number;origin:string;content:string}[]};
  const saved=detail.artifacts.find(a=>a.id===aid)!;
  expect(saved.version).toBe(2);expect(saved.origin).toBe('ai_edited');
  expect(saved.content).toContain('#광고 인플루언서에게');expect(saved.content).toContain('AI를 기반으로 생성된 가상인물이 포함된 게시물입니다.');

  await page.keyboard.press('Escape');
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=history`);
  // 변경 이력은 사건 문구 '규정 수정 제안 3건 적용 · v2'를 한 문장과 덧붙임('…, v2')으로 보인다(lib/history-labels.ts).
  const history=page.getByRole('region',{name:'변경 이력'});
  await expect(history.getByText('규정 수정 제안 3건 적용, v2')).toBeVisible({timeout:30_000});
  await page.screenshot({path:`e2e/artifacts/${info.project.name}-compliance-fixes-history.png`,fullPage:true});
 }finally{await context.close()}
});
