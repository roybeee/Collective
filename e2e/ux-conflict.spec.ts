import {test,expect} from '@playwright/test';
// UX-PLAN-3 5차원 4점 조건 '충돌은 선택지 2개': 다른 곳에서 먼저 바뀐 기록을 저장하면 최신 기록 불러오기 / 최신 판 위에 내 입력 유지를 고른다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
test('저장 충돌 때 두 선택지로 내 입력을 지키고 다시 저장한다',async({browser},info)=>{
 test.skip((info.project.use.viewport?.width??1280)<768,'데스크톱 한 번으로 충분');
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`conflict-${Date.now()}`}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const {id:campaignId}=await (await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title:'충돌 확인',goal:'충돌'}}})).json();
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=growth`);
  const panel=page.getByRole('region',{name:'판매 기본 기록',exact:true});await expect(panel.getByLabel('근거 제목',{exact:true})).toBeVisible();
  await panel.getByLabel('근거 제목',{exact:true}).fill('처음 제목');await panel.getByLabel('공개 출처 URL',{exact:true}).fill('https://example.com/c');
  await panel.getByLabel('근거 유효기한',{exact:true}).fill('2099-01-01');await panel.getByLabel('관측 요약',{exact:true}).fill('관측');
  await panel.getByRole('button',{name:'시장 근거 저장',exact:true}).click();await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  // 다른 곳(API)에서 먼저 바꾼다.
  const view=await (await page.request.get(`/api/growth?campaignId=${campaignId}`)).json(),row=view.signals[0];
  const changed=await page.request.post('/api/growth',{data:{action:'save_signal',campaignId,campaignVersion:view.campaignVersion,id:row.id,expectedVersion:row.version,input:{...row.input,title:'다른 곳 제목'}}});expect(changed.status(),await changed.text()).toBe(200);
  // 화면에서 저장하면 충돌과 두 선택지가 보인다.
  await panel.getByLabel('근거 제목',{exact:true}).fill('내 제목');await panel.getByRole('button',{name:'시장 근거 저장',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('다른 곳에서 먼저 바뀌었습니다');
  const choices=panel.getByRole('group',{name:'변경 충돌 처리',exact:true});await expect(choices.getByRole('button')).toHaveCount(2);
  await choices.getByRole('button',{name:'최신 판 위에 내 입력 유지',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('내 입력은 그대로입니다');await expect(panel.getByLabel('근거 제목',{exact:true})).toHaveValue('내 제목');
  await panel.getByRole('button',{name:'시장 근거 저장',exact:true}).click();await expect(panel.getByRole('status')).toHaveText('서버에 저장했습니다.');
  const after=await (await page.request.get(`/api/growth?campaignId=${campaignId}`)).json();expect(after.signals[0].input.title).toBe('내 제목');expect(after.signals[0].version).toBe(3);
 }finally{await context.close()}
});
