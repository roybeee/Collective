// 상품 리서치 화면(app/product-research-*.tsx) 여정. 데스크톱·모바일 두 프로젝트에서 돈다.
// 1) 스위치 꺼짐: 빈 상태에 이유와 소유자 할 일이 보인다.
// 2) 스위치 켜기(기존 기능 스위치 API) → 출처와 가져오기 탭에서 작은 랭킹 CSV 가져오기(잘못된 파일은 전부 거절) → 점수 다시 계산
//    → 후보 목록 행(총점·신뢰도) → 후보 상세(이동 경로·손익 시뮬레이터) → '보류'와 사유 기록 → 설정 기능표 '상품 리서치·MD 선정' 행.
// 근거: real Chromium·빌드 결과·로컬 D1(wrangler --local) / mocked 인증(legacy 로그인 헤더). 외부 API 호출 없음(자동 수집은 켜지 않는다).
// 서버(GET/POST /api/product-research)가 없는 빌드에서는 건너뛴다(404). CSV 열 이름은 서버 가져오기 해석기와 맞춰야 한다(아래 RANK_CSV).
import {test,expect,type Browser,type Page,type Response,type TestInfo} from '@playwright/test';

const IDENTITY_HEADER='oai-authenticated-user-id';
// 가상 랭킹 3행. 'E2E약과'는 후보 행을 찾는 표식이다. 실제 상품·브랜드가 아니다.
const RANK_CSV=['rank,title,brand,price,review_count,rating,external_id,url','1,가상브랜드 E2E약과 300g,가상브랜드,12900,321,4.8,e2e-yakgwa-1,','2,가상브랜드 E2E누룽지칩 200g,가상브랜드,8900,120,4.6,e2e-nurungji-1,','3,가상브랜드 E2E쌀과자 150g,가상브랜드,5900,45,4.4,e2e-ricecake-1,'].join('\n');
// 한 행이 틀린 파일(순위가 숫자가 아니고 상품명이 비었다). 파일 전체가 거절돼야 한다.
const BAD_CSV=['rank,title,brand,price,review_count,rating,external_id,url','1,가상브랜드 E2E정상 100g,가상브랜드,1000,1,5,e2e-ok-1,','첫째,,가상브랜드,abc,,,e2e-bad-1,'].join('\n');
const MARK='E2E약과';

async function owner(browser:Browser,info:TestInfo){
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{[IDENTITY_HEADER]:`e2e-pr-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 await page.request.get('/api/workspace');
 return {context,page};
}
const researchAction=(action:string)=>(r:Response)=>r.url().endsWith('/api/product-research')&&r.request().method()==='POST'&&(r.request().postDataJSON() as {action?:string}|null)?.action===action;
const toast=(page:Page,text:string)=>page.getByText(text,{exact:true}).first();

test('상품 리서치: 가져오기 → 다시 계산 → 후보 상세 → 보류 결정 → 기능표',async({browser},info)=>{
 test.setTimeout(120_000);
 const {context,page}=await owner(browser,info);
 try{
  const probe=await page.request.get('/api/product-research');
  test.skip(probe.status()===404,'서버 API(/api/product-research)가 아직 없는 빌드입니다.');

  // 1) 스위치 꺼짐: 이유와 소유자 할 일.
  await page.request.post('/api/feature-flags',{data:{action:'set',flag:'product_research',enabled:false}});
  await page.goto('/?view=research');
  await expect(page.getByRole('heading',{name:'상품 리서치가 꺼져 있습니다'})).toBeVisible();
  await expect(page.getByRole('button',{name:'설정 기능표 보기'})).toBeVisible();
  await expect(page.getByRole('button',{name:'상품 리서치 켜기'})).toBeEnabled();

  // 2) 기존 기능 스위치 API로 켠다.
  const flag=await page.request.post('/api/feature-flags',{data:{action:'set',flag:'product_research',enabled:true}});
  expect(flag.status(),await flag.text()).toBe(200);
  await page.goto('/?view=research&tab=sources');
  await expect(page.getByRole('heading',{name:'출처와 가져오기',level:2})).toBeVisible();
  await expect(page.getByText('이 화면은 발주·결제를 하지 않고',{exact:false})).toBeVisible();
  await expect(page.getByRole('note').filter({hasText:'수집 원칙'})).toContainText('운영자가');

  const form=page.locator('form').filter({has:page.getByRole('button',{name:'파일 가져오기'})});
  await form.getByRole('combobox',{name:'출처'}).selectOption('coupang_ranking_manual');
  await form.getByRole('textbox',{name:'범위'}).fill('가상 과자·스낵 랭킹');
  const file=form.getByLabel(/^파일\(CSV 또는 JSON/);

  // 잘못된 파일: 한 행이라도 틀리면 전부 거절하고 행 오류를 보인다.
  await file.setInputFiles({name:'e2e-bad.csv',mimeType:'text/csv',buffer:Buffer.from(BAD_CSV,'utf8')});
  const rejected=page.waitForResponse(researchAction('import_file'));
  await form.getByRole('button',{name:'파일 가져오기'}).click();
  expect((await rejected).status()).toBeGreaterThanOrEqual(400);
  await expect(page.getByRole('alert').filter({hasText:'파일 전체를 반영하지 않았습니다.'})).toBeVisible();

  // 바른 파일.
  await file.setInputFiles({name:'e2e-rank.csv',mimeType:'text/csv',buffer:Buffer.from(RANK_CSV,'utf8')});
  const imported=page.waitForResponse(researchAction('import_file'));
  await form.getByRole('button',{name:'파일 가져오기'}).click();
  const importResponse=await imported;
  expect(importResponse.status(),await importResponse.text()).toBe(200);
  await expect(toast(page,'파일을 가져왔습니다.')).toBeVisible();
  await expect(page.locator('td').filter({hasText:'e2e-rank.csv'}).first()).toBeVisible();

  // 3) 점수 다시 계산(외부 호출 없음).
  const recomputed=page.waitForResponse(researchAction('recompute'));
  await page.getByRole('button',{name:'점수 다시 계산'}).first().click();
  expect((await recomputed).status()).toBe(200);
  await expect(toast(page,'점수표를 다시 계산했습니다.')).toBeVisible();

  // 4) 후보 목록: 행과 총점·신뢰도.
  await page.getByRole('tab',{name:'후보 목록'}).click();
  await expect(page).toHaveURL(/tab=candidates/);
  const row=page.locator('tbody tr').filter({hasText:MARK}).first();
  await expect(row).toBeVisible();
  await expect(row.locator('td[data-label="총점"]')).toHaveText(/^(\d+|미확인)$/);
  await expect(row.locator('td[data-label="신뢰도"]')).toHaveText(/^\d+%$/);
  await expect(row.locator('td[data-label="분류"]')).toHaveText(/도입 검토|관찰|자료 보강|제외/);

  // 5) 후보 상세(같은 화면 안의 페이지): 이동 경로, 하위 점수, 손익 시뮬레이터.
  await row.getByRole('button',{name:/상세 열기$/}).click();
  await expect(page).toHaveURL(/#candidate-/);
  const detail=page.getByRole('article');
  await expect(detail.getByRole('heading',{level:2})).toContainText(MARK);
  await expect(page.getByRole('navigation',{name:'이동 경로'}).getByRole('button',{name:'후보 목록'})).toBeVisible();
  await expect(detail.getByRole('heading',{name:'하위 점수와 근거'})).toBeVisible();
  await detail.getByRole('spinbutton',{name:'판매가(원)'}).fill('12900');
  await detail.getByRole('spinbutton',{name:'원가(원)'}).fill('5000');
  await detail.getByRole('spinbutton',{name:'포장비(원)'}).fill('300');
  await expect(detail.getByRole('definition').filter({hasText:/배$|계산 불가/})).toBeVisible();

  // 6) 보류와 한 문장 사유.
  await detail.getByRole('radio',{name:'보류'}).click();
  await detail.getByRole('textbox',{name:/결정 사유$/}).fill('E2E 확인: 리뷰가 적어 다음 주 랭킹을 더 봅니다.');
  const decided=page.waitForResponse(researchAction('decide'));
  await detail.getByRole('button',{name:'결정 기록'}).click();
  const decideResponse=await decided;
  expect(decideResponse.status(),await decideResponse.text()).toBe(200);
  await expect(toast(page,'보류를 기록했습니다.')).toBeVisible();
  await expect(detail.getByText('지금 결정: 보류',{exact:false})).toBeVisible();

  // 이동 경로로 목록에 돌아가면 결정 상태가 보인다.
  await page.getByRole('navigation',{name:'이동 경로'}).getByRole('button',{name:'후보 목록'}).click();
  await expect(page.locator('tbody tr').filter({hasText:MARK}).first().locator('td[data-label="결정 상태"]')).toContainText('보류');

  // 7) 설정 기능표 행.
  await page.goto('/?view=settings');
  const featureRow=page.locator('[data-feature="product-research"]');
  await expect(featureRow).toContainText('상품 리서치·MD 선정');
  await expect(featureRow).toContainText('사용 가능');
  await page.screenshot({path:`e2e/artifacts/product-research-${info.project.name}.png`,fullPage:true});
 }finally{
  await page.request.post('/api/feature-flags',{data:{action:'reset',flag:'product_research'}}).catch(()=>{});
  await context.close();
 }
});
