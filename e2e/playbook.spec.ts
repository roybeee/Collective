// B3-1 운영자 선호 규칙 여정: 소유자가 작업물 수정 요청 2건(사람 판정 로그)을 인용해 규칙을 만들고(초안) → 승인 → 중지한다.
// 로컬 빌드(wrangler --local)와 실제 로컬 D1을 쓰고 dispatcher 로그인 헤더를 직접 붙인다(mocked auth, quality-console.spec.ts와 같은 방식). 모델 호출은 없다.
// 모바일(390px) 프로젝트에서는 학습 규칙 탭과 생성 대화상자에 가로 넘침이 없는지 본다.
import {test,expect,type Page} from '@playwright/test';

const noHorizontalOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);

test('소유자는 사람 판정 2건을 인용해 운영자 선호 규칙을 만들고 승인·중지한다',async({browser},testInfo)=>{
 const owner=`e2e-playbook-${testInfo.project.name}-${Date.now()}`;
 const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,viewport:testInfo.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}});
 const page=await context.newPage();
 await page.request.get('/api/workspace');
 const saved=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'oda',title:'플레이북 검증',goal:'교정 판정을 규칙으로 만든다',budget:0}}});
 expect(saved.status()).toBe(200);
 const {id:campaignId}=await saved.json() as {id:string};
 for(const role of ['cmo','insight']){
  const artifact=await page.request.post('/api/action',{data:{action:'save_artifact',campaignId,role,title:'검증 '+role,content:'## 목표\n평일 방문을 늘리는 실행 초안입니다.'}});
  expect(artifact.status()).toBe(200);
  const reviewed=await page.request.post('/api/action',{data:{action:'review_artifact',id:(await artifact.json() as {id:string}).id,version:1,decision:'revision',note:'첫 문장을 더 짧게',reasonCodes:['voice']}});
  expect(reviewed.status()).toBe(200);
 }

 await page.goto('/?view=learning&brand=oda&tab=rules');
 const section=page.getByRole('region',{name:'운영자 선호 규칙'});
 await expect(section).toBeVisible();
 expect(await noHorizontalOverflow(page)).toBe(true);
 await section.getByRole('button',{name:'선호 규칙 만들기'}).click();
 const dialog=page.getByRole('dialog',{name:'운영자 선호 규칙 만들기'});
 await expect(dialog).toBeVisible();
 await dialog.getByPlaceholder('예: 첫 문장은 고객의 평일 상황으로 시작한다.').fill('첫 문장은 스무 자 안쪽으로 쓴다.');
 const citations=dialog.getByRole('group',{name:'인용할 사람 판정'}).getByRole('checkbox');
 await expect(citations).toHaveCount(2);
 await citations.nth(0).click();
 await citations.nth(1).click();
 expect(await noHorizontalOverflow(page)).toBe(true);
 await dialog.getByRole('button',{name:'저장'}).click();
 await expect(dialog).toBeHidden();

 const card=section.locator('.learning-rule').filter({hasText:'첫 문장은 스무 자 안쪽으로 쓴다.'});
 await expect(card.getByText('초안 · 승인 대기')).toBeVisible();
 await card.getByRole('button',{name:'승인',exact:true}).click();
 await expect(card.getByText('적용 중',{exact:true})).toBeVisible();
 await expect(card.getByText('교정 판정 인용 2건',{exact:false})).toBeVisible();
 expect(await noHorizontalOverflow(page)).toBe(true);
 await card.getByRole('button',{name:'적용 중지'}).click();
 await expect(card.locator('.learning-tag')).toHaveText('적용 중지');
 await context.close();
});
