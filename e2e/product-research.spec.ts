// 상품 리서치 화면(app/product-research-*.tsx) 여정. 데스크톱·모바일 두 프로젝트에서 돈다.
// 1) 스위치 꺼짐: 빈 상태에 이유와 소유자 할 일이 보인다.
// 2) 스위치 켜기(기존 기능 스위치 API) → 출처와 가져오기 탭에서 작은 랭킹 CSV 가져오기(잘못된 파일은 전부 거절, 쿠팡 오늘·무신사 어제) → 점수 다시 계산
//    → 후보 목록 행(총점·신뢰도) → 후보 상세(이동 경로·출처별 추세 막대·근거 스냅샷 상세·경쟁 구조 표·가정값 표시) → '보류'와 사유 기록 → 설정 기능표 '상품 리서치·MD 선정' 행.
// 3) 승인 관문·소싱 연결·전역 중단(두 번째 테스트): 리스크 높음 후보는 리스크 검토 저장 전 승인 버튼이 이유와 함께 막히고 API도 409, 선정 금지 후보는 승인 선택지가 없고 API 409,
//    성장2 소싱 후보(공개 API로 만든 합성 견적) 연결 → 손익 시뮬레이터 '소싱 견적', 승인 뒤 전역 실행 중단이면 넘기기가 이유와 함께 막히고 API 409,
//    재개 뒤 카탈로그 상품이 둘이면 소싱 견적과 다른 상품은 409·오퍼 생성 없음, 연결된 상품으로 다시 넘기면 판매 오퍼 초안(가격 없음·승인 전)이 생긴다(평가 3회차 M6·⑩).
// 근거: real Chromium·빌드 결과·로컬 D1(wrangler --local) / mocked 인증(legacy 로그인 헤더). 외부 API 호출 없음(자동 수집은 켜지 않는다).
// 서버(GET/POST /api/product-research)가 없는 빌드에서는 건너뛴다(404). CSV 열 이름은 서버 가져오기 해석기와 맞춰야 한다(아래 RANK_CSV).
import {test,expect,type Browser,type Page,type Response,type TestInfo} from '@playwright/test';

const IDENTITY_HEADER='oai-authenticated-user-id';
// 가상 랭킹 3행. 'E2E약과'는 후보 행을 찾는 표식이다. 실제 상품·브랜드가 아니다.
const RANK_CSV=['rank,title,brand,price,review_count,rating,external_id,url','1,가상브랜드 E2E약과 300g,가상브랜드,12900,321,4.8,e2e-yakgwa-1,','2,가상브랜드 E2E누룽지칩 200g,가상브랜드,8900,120,4.6,e2e-nurungji-1,','3,가상브랜드 E2E쌀과자 150g,가상브랜드,5900,45,4.4,e2e-ricecake-1,'].join('\n');
// 한 행이 틀린 파일(순위가 숫자가 아니고 상품명이 비었다). 파일 전체가 거절돼야 한다.
const BAD_CSV=['rank,title,brand,price,review_count,rating,external_id,url','1,가상브랜드 E2E정상 100g,가상브랜드,1000,1,5,e2e-ok-1,','첫째,,가상브랜드,abc,,,e2e-bad-1,'].join('\n');
const MARK='E2E약과';
// 승인 관문용 가상 랭킹: 다이어트 효능 표현(리스크 높음, 사람 검토 필요)과 가품 신호(선정 금지). 실제 상품이 아니다.
const GATE_CSV=['rank,title,brand,price,review_count,rating,external_id,url','1,가상브랜드 E2E관문약과 300g,가상브랜드,12900,321,4.8,e2e-gate-yakgwa,','2,가상브랜드 E2E다이어트차 다이어트 효과 100g,가상브랜드,8900,120,4.6,e2e-gate-diet,','3,가상브랜드 E2E짝퉁과자 150g,가상브랜드,5900,45,4.4,e2e-gate-fake,'].join('\n');
// 한국 날짜(가져오기 기준일은 한국 날짜 기준 최근 14일).
const kstDay=(back=0)=>new Date(Date.now()+9*3600000-back*86400000).toISOString().slice(0,10);

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
  // 랭킹 출처별 '이번 주 가져옴' 표시.
  await expect(page.getByLabel('랭킹 가져오기 이번 주 상태')).toContainText('이번 주 가져옴');

  // 같은 파일을 다른 랭킹 출처(무신사)의 어제 관측으로 한 번 더: 두 출처의 추세가 같은 시간축(이틀)에 그려진다.
  await form.getByRole('combobox',{name:'출처'}).selectOption('musinsa_ranking_manual');
  await form.getByLabel(/^관측 날짜/).fill(kstDay(1));
  await file.setInputFiles({name:'e2e-rank-musinsa.csv',mimeType:'text/csv',buffer:Buffer.from(RANK_CSV,'utf8')});
  const importedAgain=page.waitForResponse(researchAction('import_file'));
  await form.getByRole('button',{name:'파일 가져오기'}).click();
  const againResponse=await importedAgain;
  expect(againResponse.status(),await againResponse.text()).toBe(200);
  await expect(page.locator('td').filter({hasText:'e2e-rank-musinsa.csv'}).first()).toBeVisible();

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
  // 출처별 추세: 판매 목록 키(ls:출처:외부ID)로 맞춘 시계열이 같은 시간축 막대로 그려진다(평가 H1).
  const trends=detail.getByTestId('pr-trend-grid').locator('figure.trend-bars');
  await expect(trends.first()).toBeVisible();
  expect(await trends.count()).toBeGreaterThan(0);
  await expect(detail.getByTestId('pr-trend-grid').locator('.trend-bar').first()).toBeVisible();
  // 근거 칩 → 같은 페이지 안의 스냅샷 상세(출처·수집 방식·관측 행).
  await detail.locator('[title="근거 스냅샷 상세 열기"]').first().click();
  const snap=detail.getByTestId('pr-snapshot-panel');
  await expect(snap.getByRole('heading',{name:'근거 스냅샷 상세'})).toBeVisible();
  await expect(snap.getByLabel('스냅샷 요약')).toContainText('운영자 가져오기');
  await expect(snap).toContainText('랭킹 순위');
  await snap.getByRole('button',{name:'닫기'}).click();
  await expect(snap).toHaveCount(0);
  // 경쟁 구조 표: 모르는 칸은 미확인.
  await expect(detail.getByLabel('경쟁 구조 표')).toContainText('판매처 수');
  await expect(detail.getByLabel('경쟁 구조 표')).toContainText('신규 진입 비율');
  // 손익 시뮬레이터: 미리 채운 기본값은 '가정값' 표시.
  await expect(detail.locator('label').filter({hasText:'배송비(원)'}).getByText('가정값')).toBeVisible();
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

test('상품 리서치: 승인 관문(리스크 높음·선정 금지) → 소싱 견적 연결 → 승인 → 전역 중단이면 넘기기 막힘',async({browser},info)=>{
 test.setTimeout(150_000);
 const {context,page}=await owner(browser,info);
 const post=(data:Record<string,unknown>)=>page.request.post('/api/product-research',{data:{requestId:crypto.randomUUID(),...data}});
 try{
  const probe=await page.request.get('/api/product-research');
  test.skip(probe.status()===404,'서버 API(/api/product-research)가 아직 없는 빌드입니다.');
  expect((await page.request.post('/api/feature-flags',{data:{action:'set',flag:'product_research',enabled:true}})).status()).toBe(200);
  // 준비(공개 API): 랭킹 두 출처 가져오기 → 다시 계산. 성장2 캠페인·카탈로그·소싱 후보(합성 견적).
  for(const [back,sourceId] of [[1,'musinsa_ranking_manual'],[0,'coupang_ranking_manual']] as const){
   const r=await post({action:'import_file',sourceId,fileName:`e2e-gate-${back}.csv`,text:GATE_CSV,scope:'가상 과자 랭킹',observedDate:kstDay(back)});expect(r.status(),await r.text()).toBe(200);
  }
  expect((await post({action:'recompute'})).status()).toBe(200);
  const title=`상품 리서치 소싱 ${info.project.name}`;
  const created=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'상품 리서치 소싱 연결 확인'}}});expect(created.status(),await created.text()).toBe(200);
  const {id:campaignId}=await created.json() as {id:string};
  const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const catalog=await page.request.post('/api/growth',{data:{action:'save_catalog',id:'pr-e2e-catalog',expectedVersion:0,campaignId,campaignVersion:1,input:{sku:'PR-E2E-SKU',title:'가상 관문약과',taxBasis:'included',validUntil:future}}});expect(catalog.status(),await catalog.text()).toBe(200);
  const quote={catalogId:'pr-e2e-catalog',catalogVersion:1,supplierCode:'PR-E2E-SUPPLIER',currency:'KRW',unit:'piece',unitCost:4200,moq:100,leadDays:7,shippingCost:0,extraCost:0,taxBasis:'included',validUntil:future,evidenceRef:'quote-pr-e2e',note:''};
  const candidate=await page.request.post('/api/growth/sourcing',{data:{action:'save_candidate',id:'pr-e2e-candidate',expectedVersion:0,campaignId,campaignVersion:1,requestId:crypto.randomUUID(),input:quote}});expect(candidate.status(),await candidate.text()).toBe(200);

  const view=await (await page.request.get('/api/product-research')).json() as {products:{id:string;name:string;score:{id:string;needsReview?:boolean;blocked:unknown}|null}[]};
  const find=(mark:string)=>{const p=view.products.find(x=>x.name.includes(mark));expect(p,mark).toBeTruthy();return p!};
  const diet=find('E2E다이어트차'),fake=find('E2E짝퉁과자'),plain=find('E2E관문약과');
  expect(diet.score?.needsReview).toBe(true);
  expect(fake.score?.blocked).toBeTruthy();
  const open=async(id:string)=>{await page.goto(`/?view=research&tab=candidates#candidate-${id}`);const d=page.getByRole('article');await expect(d.getByRole('heading',{level:2})).toBeVisible();return d};

  // 1) 리스크 높음: API로 확인 없이 승인하면 409, 화면은 저장 전 승인 버튼을 이유와 함께 막는다.
  const denied=await post({action:'decide',productId:diet.id,scoreCardId:diet.score!.id,briefId:null,status:'approved',reason:'좋아 보여서 승인합니다.'});
  expect(denied.status()).toBe(409);
  expect((await denied.json() as {error:string}).error).toContain('리스크 검토');
  let detail=await open(diet.id);
  await expect(detail.getByRole('note').filter({hasText:'사람 검토 필요'})).toBeVisible();
  await detail.getByRole('radio',{name:'승인'}).click();
  await detail.getByRole('textbox',{name:/결정 사유$/}).fill('좋아 보여서 승인합니다.');
  const record=detail.getByRole('button',{name:'결정 기록'});
  await expect(record).toBeDisabled();
  await expect(detail.locator('.why-disabled').filter({hasText:'리스크 높음 후보입니다'})).toBeVisible();
  // 위험 확인 표시만으로는 부족하다: 사유에 위험을 적어야 켜진다.
  await detail.getByRole('checkbox',{name:/리스크 높음 항목/}).check();
  await expect(detail.locator('.why-disabled').filter({hasText:'확인한 위험'})).toBeVisible();
  await detail.getByRole('textbox',{name:/결정 사유$/}).fill('다이어트 효능 표현을 판매 페이지에서 빼기로 확인했습니다.');
  await expect(record).toBeEnabled();
  await detail.getByRole('checkbox',{name:/리스크 높음 항목/}).uncheck();
  await expect(record).toBeDisabled();
  // 리스크 검토 체크리스트를 모두 확인해 저장하면 표시 없이 승인할 수 있다.
  const risk=detail.getByRole('group',{name:'리스크 점검 항목'});
  for(const box of await risk.getByRole('checkbox').all())await box.check();
  await detail.getByRole('textbox',{name:'리스크 검토 메모'}).fill('E2E 확인: 다이어트 효능 문구를 빼기로 했습니다.');
  const reviewed=page.waitForResponse(researchAction('save_risk_review'));
  await detail.getByRole('button',{name:'리스크 검토 저장'}).click();
  expect((await reviewed).status()).toBe(200);
  await expect(toast(page,'리스크 검토를 저장했습니다.')).toBeVisible();
  await expect(record).toBeEnabled();
  const approved=page.waitForResponse(researchAction('decide'));
  await record.click();
  await page.getByRole('alertdialog').getByRole('button',{name:'승인 기록'}).click();
  expect((await approved).status()).toBe(200);
  await expect(toast(page,'승인을 기록했습니다.')).toBeVisible();

  // 2) 선정 금지: 승인 선택지가 없고 금지 사유가 보인다. API도 409.
  detail=await open(fake.id);
  await expect(detail.getByRole('note').filter({hasText:'선정 금지'}).first()).toBeVisible();
  await expect(detail.getByRole('radio',{name:'승인'})).toHaveCount(0);
  const blocked=await post({action:'decide',productId:fake.id,scoreCardId:fake.score!.id,briefId:null,status:'approved',reason:'E2E 확인: 선정 금지 후보 승인 시도'});
  expect(blocked.status()).toBe(409);
  expect((await blocked.json() as {error:string}).error).toContain('선정 금지');

  // 3) 소싱 견적 연결: 캠페인 → 소싱 후보 → 연결. 손익 시뮬레이터 원가가 '소싱 견적'으로 채워진다.
  detail=await open(plain.id);
  await detail.getByRole('combobox',{name:'소싱 후보를 찾을 캠페인'}).selectOption(campaignId);
  const pick=detail.getByRole('combobox',{name:'연결할 소싱 후보'});
  await expect(pick.locator('option',{hasText:'PR-E2E-SUPPLIER'})).toHaveCount(1);
  await pick.selectOption('pr-e2e-candidate');
  const linked=page.waitForResponse(researchAction('link_sourcing'));
  await detail.getByRole('button',{name:'소싱 후보 연결'}).click();
  expect((await linked).status()).toBe(200);
  await expect(toast(page,'소싱 후보를 연결했습니다.')).toBeVisible();
  const linkBox=detail.getByRole('note',{name:'연결한 소싱 견적'});
  await expect(linkBox).toContainText('PR-E2E-SUPPLIER');
  await expect(linkBox.getByLabel('견적 요약')).toContainText('4,200원');
  await expect(detail.locator('label').filter({hasText:'원가(원)'}).getByText('소싱 견적')).toBeVisible();
  await expect(detail.getByRole('spinbutton',{name:/^원가\(원\)/})).toHaveValue('4200');

  // 4) 승인 → 전역 실행 중단 → 넘기기 버튼이 이유와 함께 막히고 API도 409.
  await detail.getByRole('radio',{name:'승인'}).click();
  await detail.getByRole('textbox',{name:/결정 사유$/}).fill('E2E 확인: 상온 보관이고 견적 원가가 맞습니다.');
  const approvedPlain=page.waitForResponse(researchAction('decide'));
  await detail.getByRole('button',{name:'결정 기록'}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'승인 기록'}).click();
  expect((await approvedPlain).status()).toBe(200);
  await expect(detail.getByText('지금 결정: 승인',{exact:false})).toBeVisible();
  const stopState=await (await page.request.get('/api/growth/stop')).json() as {state:{version:number}};
  const stopped=await page.request.post('/api/growth/stop',{data:{action:'stop',expectedVersion:stopState.state.version,requestId:crypto.randomUUID(),reason:'상품 리서치 넘기기 차단 확인'}});
  expect(stopped.status(),await stopped.text()).toBe(200);
  detail=await open(plain.id);
  await detail.getByRole('combobox',{name:'시장 근거로 넘길 캠페인'}).selectOption(campaignId);
  await expect(detail.getByRole('button',{name:'시장 근거로 넘기기'})).toBeDisabled();
  await expect(detail.locator('.why-disabled').filter({hasText:'전역 실행 중단 중이라'})).toBeVisible();
  const after=await (await page.request.get('/api/product-research')).json() as {products:{id:string;decision:{id:string}|null}[];campaigns:{id:string;version:number}[]};
  const decision=after.products.find(x=>x.id===plain.id)!.decision!;
  const handoff=await post({action:'handoff',decisionId:decision.id,campaignId,campaignVersion:after.campaigns.find(c=>c.id===campaignId)!.version});
  expect(handoff.status()).toBe(409);
  expect((await handoff.json() as {error:string}).error).toContain('전역 중단');

  // 5) 평가 3회차 M6·⑩: 전역 실행을 재개하고 카탈로그 상품을 하나 더 만들면, 넘기기 칸에서 초안을 이을 상품을 고른다(여럿이면 자동으로 고르지 않음).
  //    소싱 견적과 다른 상품은 거절하고, 같은 화면에서 연결된 상품으로 다시 넘기면 오퍼 초안(가격 없음·가격 승인 전)이 생긴다.
  const stopNow=await (await page.request.get('/api/growth/stop')).json() as {state:{version:number}};
  const resumed=await page.request.post('/api/growth/stop',{data:{action:'resume',expectedVersion:stopNow.state.version,requestId:crypto.randomUUID(),reason:'상품 리서치 넘기기 확인 뒤 재개'}});
  expect(resumed.status(),await resumed.text()).toBe(200);
  const second=await page.request.post('/api/growth',{data:{action:'save_catalog',id:'pr-e2e-catalog-2',expectedVersion:0,campaignId,campaignVersion:1,input:{sku:'PR-E2E-SKU-2',title:'가상 관문약과 선물세트',taxBasis:'included',validUntil:future}}});
  expect(second.status(),await second.text()).toBe(200);
  // 같은 주소(해시만 다름)로 가면 문서를 다시 읽지 않으므로 다른 화면을 거쳐 새 화면 응답을 받는다.
  await page.goto('/?view=research&tab=report');
  detail=await open(plain.id);
  await detail.getByRole('combobox',{name:'시장 근거로 넘길 캠페인'}).selectOption(campaignId);
  const catalogPick=detail.getByRole('combobox',{name:'초안을 이을 카탈로그 상품'});
  await expect(catalogPick).toBeEnabled();
  await expect(catalogPick).toHaveValue('');
  await expect(catalogPick.locator('option',{hasText:'PR-E2E-SKU-2'})).toHaveCount(1);
  await expect(catalogPick.locator('option',{hasText:'PR-E2E-SKU)'})).toHaveCount(1);
  await catalogPick.selectOption('pr-e2e-catalog-2');
  await detail.getByRole('textbox',{name:'시장 근거 주소'}).fill('https://www.coupang.com/vp/products/990001');
  const mismatched=page.waitForResponse(researchAction('handoff'));
  await detail.getByRole('button',{name:'시장 근거로 넘기기'}).click();
  const confirm=page.getByRole('alertdialog');
  await expect(confirm).toContainText('판매 오퍼 초안');
  await confirm.getByRole('button',{name:'시장 근거로 넘기기'}).click();
  const mismatchResponse=await mismatched;
  expect(mismatchResponse.status(),await mismatchResponse.text()).toBe(409);
  expect((mismatchResponse.request().postDataJSON() as {catalogId?:string}).catalogId).toBe('pr-e2e-catalog-2');
  const mismatchError=(await mismatchResponse.json() as {error:string}).error;
  expect(mismatchError).toContain('연결된 소싱 후보와 선택한 카탈로그 상품·판이 일치하지 않습니다.');
  await expect(toast(page,mismatchError)).toBeVisible();
  const rejectedGrowth=await (await page.request.get(`/api/growth?campaignId=${campaignId}`)).json() as {offers:unknown[]};
  expect(rejectedGrowth.offers).toHaveLength(0);

  await catalogPick.selectOption('pr-e2e-catalog');
  const handed=page.waitForResponse(researchAction('handoff'));
  await detail.getByRole('button',{name:'시장 근거로 넘기기'}).click();
  await confirm.getByRole('button',{name:'시장 근거로 넘기기'}).click();
  const handedResponse=await handed;
  expect(handedResponse.status(),await handedResponse.text()).toBe(200);
  expect((handedResponse.request().postDataJSON() as {catalogId?:string}).catalogId).toBe('pr-e2e-catalog');
  await expect(toast(page,'시장 근거로 넘겼습니다.')).toBeVisible();
  const growth=await (await page.request.get(`/api/growth?campaignId=${campaignId}`)).json() as {offers:{input:{catalogId:string;price:number|null;priceApproved:boolean};readiness:{missing:string[]}}[]};
  expect(growth.offers).toHaveLength(1);
  const offerDraft=growth.offers.find(o=>o.input.catalogId==='pr-e2e-catalog');
  expect(offerDraft,'offer draft for the chosen catalog item').toBeTruthy();
  expect(offerDraft!.input.price).toBeNull();
  expect(offerDraft!.input.priceApproved).toBe(false);
  expect(offerDraft!.readiness.missing).toContain('오퍼 가격 승인이 필요합니다.');
  await page.screenshot({path:`e2e/artifacts/product-research-gate-${info.project.name}.png`,fullPage:true});
 }finally{
  await page.request.post('/api/feature-flags',{data:{action:'reset',flag:'product_research'}}).catch(()=>{});
  await context.close();
 }
});
