import {test,expect,type Page} from '@playwright/test';

// Local D1 persistence and actual UI/API; only legacy authenticated identity is a fixture.
// No external collection, publishing, advertisement, or sales success is simulated.
type RecordRow={id:string;version:number;input:Record<string,unknown>};
type GrowthView={campaignVersion:number;signals:RecordRow[];needs:RecordRow[];catalogs:RecordRow[];missions:RecordRow[]};

async function openGrowth(page:Page,title:string){
 await page.goto('/');
 if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();
 await page.getByRole('button',{name:'캠페인',exact:true}).click();
 if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');
 await page.getByRole('button',{name:`${title} 열기`,exact:true}).click();
 await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
 const panel=page.getByRole('region',{name:'판매 기본 기록',exact:true});
 await expect(panel.getByRole('navigation',{name:'성장 작업 단계'})).toBeVisible();
 return panel;
}

test('성장 판매 근거·니즈 연결·불완전 미션·충돌 입력 보존·화면 너비',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`growth-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 try{
  expect((await page.request.get('/api/workspace')).status()).toBe(200);
  const title=`성장 워크스페이스 ${info.project.name}`;
  const created=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'합성 근거와 판매 준비 기록'}}});
  expect(created.status()).toBe(200);
  const {id:campaignId}=await created.json() as {id:string};
  const read=async()=>{
   const response=await page.request.get(`/api/growth?campaignId=${encodeURIComponent(campaignId)}`);
   expect(response.status()).toBe(200);
   return await response.json() as GrowthView;
  };
  let panel=await openGrowth(page,title);
  const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  await panel.getByLabel('근거 제목',{exact:true}).fill('수요 조사 출처');
  await panel.getByLabel('공개 출처 URL',{exact:true}).fill('https://example.com/market-research');
  await panel.getByLabel('근거 유효기한',{exact:true}).fill(future);
  await panel.getByRole('textbox',{name:'관측 요약',exact:true}).fill('공개 자료에서 간편 조리 선호를 관측');
  await expect(panel.getByLabel('표본 수 (미확인은 빈칸)',{exact:true})).toHaveValue('');
  await panel.getByRole('button',{name:'시장 근거 저장',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  let view=await read();
  expect(view.signals).toHaveLength(1);
  expect(view.signals[0].input.sampleSize).toBeNull();
  const signalId=view.signals[0].id;

  // A fresh browser page must recover the saved input from local D1.
  await page.reload();
  panel=await openGrowth(page,title);
  // 기록이 있으면 아직 빈 첫 단계(고객·기회)에서 열린다. 저장한 근거를 보려면 시장 근거 단계로 간다.
  await expect(panel.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'고객·기회',exact:true})).toHaveAttribute('aria-pressed','true');
  await panel.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'시장 근거',exact:true}).click();
  await panel.getByRole('group',{name:'시장 근거 기록 목록'}).getByRole('button',{name:/수요 조사 출처/}).click();
  await expect(panel.getByRole('textbox',{name:'관측 요약',exact:true})).toHaveValue('공개 자료에서 간편 조리 선호를 관측');
  await expect(panel.getByLabel('표본 수 (미확인은 빈칸)',{exact:true})).toHaveValue('');

  // Concurrent API edit creates a real version conflict. The browser draft must survive.
  view=await read();
  const concurrent=await page.request.post('/api/growth',{data:{action:'save_signal',campaignId,campaignVersion:view.campaignVersion,id:signalId,expectedVersion:view.signals[0].version,input:{...view.signals[0].input,summary:'다른 운영자가 근거 설명을 갱신'}}});
  expect(concurrent.status()).toBe(200);
  await panel.getByRole('textbox',{name:'관측 요약',exact:true}).fill('현재 창에서 검토한 근거 설명');
  await panel.getByRole('button',{name:'시장 근거 저장',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다.');
  await expect(panel.getByRole('textbox',{name:'관측 요약',exact:true})).toHaveValue('현재 창에서 검토한 근거 설명');
  await panel.getByRole('button',{name:'새로고침',exact:true}).click();
  await expect(panel.getByRole('button',{name:'현재 입력 유지 · 최신 버전 기준 사용',exact:true})).toBeVisible();
  await expect(panel.getByRole('textbox',{name:'관측 요약',exact:true})).toHaveValue('현재 창에서 검토한 근거 설명');
  await panel.getByRole('button',{name:'현재 입력 유지 · 최신 버전 기준 사용',exact:true}).click();
  await panel.getByRole('button',{name:'시장 근거 저장',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  view=await read();
  expect(view.signals[0].version).toBe(3);
  expect(view.signals[0].input.summary).toBe('현재 창에서 검토한 근거 설명');

  await panel.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'고객·기회',exact:true}).click();
  await panel.getByLabel('니즈 가설 제목',{exact:true}).fill('빠른 저녁 준비 가설');
  await panel.getByRole('textbox',{name:'발생 상황',exact:true}).fill('퇴근 후 저녁 준비');
  await panel.getByRole('textbox',{name:'원하는 결과',exact:true}).fill('준비 시간 단축');
  await panel.getByRole('textbox',{name:'현재 대안',exact:true}).fill('배달 주문');
  await panel.getByRole('textbox',{name:'구매 장애물',exact:true}).fill('배송 시간');
  await panel.getByRole('textbox',{name:'반례·반대 근거',exact:true}).fill('직접 조리를 선호하는 고객도 있음');
  await panel.getByRole('group',{name:'연결할 시장 근거',exact:true}).getByRole('checkbox',{name:/수요 조사 출처/}).check();
  await panel.getByLabel('니즈 검토 기한',{exact:true}).fill(future);
  await panel.getByRole('textbox',{name:'다음 검증 행동',exact:true}).fill('인터뷰로 반례 확인');
  await panel.getByLabel('검토 담당 역할',{exact:true}).fill('리서치 담당');
  await panel.getByRole('button',{name:'고객·기회 저장',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  view=await read();
  expect(view.needs).toHaveLength(1);
  expect(view.needs[0].input.signalIds).toEqual([signalId]);
  await expect(panel).toContainText('검증 전 가설');

  await panel.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'상품',exact:true}).click();
  await panel.getByLabel('상품명',{exact:true}).fill('비용 확인 전 상품 초안');
  await panel.getByRole('button',{name:'상품 저장',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  view=await read();
  expect(view.catalogs[0].input.price).toBeNull();
  expect(view.catalogs[0].input.unitCost).toBeNull();
  expect(view.catalogs[0].input.stock).toBeNull();
  await expect(panel.getByLabel('저장된 준비 상태')).toContainText('판매 단가를 확인하세요.');

  await panel.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'판매 미션',exact:true}).click();
  await panel.getByLabel('미션 제목',{exact:true}).fill('준비가 필요한 판매 미션');
  await panel.getByRole('button',{name:'판매 미션 저장',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  await expect(panel.getByRole('button',{name:'미션 준비 요청',exact:true})).toBeDisabled();
  await expect(panel.getByLabel('저장된 준비 상태')).toContainText('탐색 예산 한도');
  await expect(panel).toContainText('자동 집행이나 실제 매출 증명이 아닙니다.');
  view=await read();
  expect(view.missions).toHaveLength(1);
  expect(view.missions[0].input.budget).toBeNull();
  expect(view.missions[0].input.lossLimit).toBeNull();
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await panel.getByRole('navigation',{name:'성장 작업 단계'}).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await panel.getByRole('heading',{name:'운영자 확인 기록',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`e2e/artifacts/growth-workspace-${info.project.name}.png`});
 }finally{await context.close();}
});

test('판매 위임 서명·재조회·철회와 사업 지표의 미확인 구분',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`authority-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const title=`위임 범위 ${info.project.name}`;
  expect((await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'합성 로컬 위임'}}})).status()).toBe(200);
  let panel=await openGrowth(page,title);
  await expect(panel.getByRole('region',{name:'성장 사업 지표'})).toContainText('미확인');
  await panel.locator('summary').filter({hasText:'판매 위임·예산 한도'}).click();
  let scope=panel.getByRole('region',{name:'판매 위임과 예산 한도'});
  await expect(scope.getByRole('combobox',{name:'위임 채널',exact:true})).toHaveValue('manual');
  await scope.getByLabel('계정 식별자',{exact:true}).fill('test-account');
  await scope.getByRole('combobox',{name:'위임 단계',exact:true}).selectOption('T3');
  await scope.getByRole('combobox',{name:'위임 상태',exact:true}).selectOption('active');
  const start=new Date(Date.now()-60000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
  for(const label of ['위임 시작','예산 기간 시작'])await scope.getByLabel(`${label} (ISO 시각)`,{exact:true}).fill(start);
  for(const label of ['위임 만료','예산 기간 종료'])await scope.getByLabel(`${label} (ISO 시각)`,{exact:true}).fill(end);
  for(const label of ['기간 총한도','하루 한도','한 주 한도','탐색 손실 한도'])await scope.getByLabel(`${label} (원)`,{exact:true}).fill('1000');
  await scope.getByRole('checkbox',{name:'지출',exact:true}).check();
  await expect(scope.getByRole('button',{name:'판매 위임 저장',exact:true})).toBeDisabled();
  await scope.getByRole('checkbox',{name:'소유자로서 이 계정·기간·행동·금액의 위임을 확인합니다.',exact:true}).check();
  await scope.getByRole('button',{name:'판매 위임 저장',exact:true}).click();
  await expect(scope.getByRole('status')).toHaveText('위임 기록을 저장했습니다.');
  await page.reload();panel=await openGrowth(page,title);
  await panel.locator('summary').filter({hasText:'판매 위임·예산 한도'}).click();
  scope=panel.getByRole('region',{name:'판매 위임과 예산 한도'});
  await scope.getByRole('button',{name:'test-account · 유효 · v1',exact:true}).click();
  await expect(scope.getByLabel('기간 총한도 (원)',{exact:true})).toHaveValue('1000');
  await scope.getByRole('button',{name:'선택 위임 철회',exact:true}).click();
  await expect(scope.getByRole('button',{name:'test-account · 철회 · v2',exact:true})).toBeVisible();
  expect(await scope.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await scope.getByRole('heading',{name:'판매 위임과 예산 한도'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`e2e/artifacts/growth-authority-${info.project.name}.png`});
 }finally{await context.close();}
});
