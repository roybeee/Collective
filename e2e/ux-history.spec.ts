import {test,expect} from '@playwright/test';
// UX-PLAN-3 11차원 5점 조건 '변경 이력을 사람이 읽는 문장으로'(평가 10회차 ⑪): 캠페인 이력 탭의 각 항목은 '…습니다.'로 끝나는 한 문장이다.
// 버전 비교 선택 상자 글자는 짧은 형식(쉼표)을 그대로 두고, 상자 아래에 고른 버전을 문장으로 보인다(lib/history-labels.ts historySentence).
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
test('이력 탭의 변경 이력과 버전 설명이 한 문장으로 보인다',async({browser},info)=>{
 const owner=`history-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(data:unknown)=>{const r=await page.request.post('/api/action',{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  await page.request.get('/api/workspace');
  const title=`이력 문장 ${info.project.name}`,{id}=await post({action:'save_campaign',data:{brandId:'ofd',title,goal:'변경 이력 문장 확인',budget:0}});
  const first=await post({action:'save_artifact',campaignId:id,role:'strategy',title:'전략 초안',content:'첫 원문'});
  await post({action:'save_artifact',id:first.id,campaignId:id,version:1,role:'strategy',title:'전략 초안',content:'고친 원문'});
  await post({action:'review_artifact',id:first.id,version:2,decision:'approved',note:''});
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=history`);
  const log=page.getByRole('region',{name:'변경 이력',exact:true});
  await expect(log.getByText(/「전략 초안」 v2를 승인했습니다\.$/)).toBeVisible();
  await expect(log.getByText(/브랜드 전략 담당 작업물 v2를 수정했습니다\.$/)).toBeVisible();
  await expect(log.getByText(/브랜드 전략 담당 작업물 v1을 등록했습니다\.$/)).toBeVisible();
  const lines=await log.locator('p').allTextContents();
  expect(lines.length).toBeGreaterThanOrEqual(4);
  for(const line of lines)expect(line).toMatch(/습니다\.$/);
  expect((await log.textContent())??'').not.toMatch(/ · |tokens/);
  // 선택 상자는 짧은 형식, 그 아래는 문장.
  await expect(page.getByRole('combobox',{name:'비교할 버전',exact:true}).locator('option:checked')).toHaveText(/^브랜드 전략 v2, 기획 승인, /);
  await expect(page.getByText(/^브랜드 전략 담당 v2를 \d{1,2}월 \d{1,2}일 오[전후] \d{1,2}:\d{2}에 승인했습니다\.$/)).toBeVisible();
  await expect(page.getByText(/^브랜드 전략 담당 v1은 \d{1,2}월 \d{1,2}일 오[전후] \d{1,2}:\d{2}에 직접 등록됐고 직접 수정으로 교체됐습니다\.$/)).toBeVisible();
 }finally{await context.close()}
});
