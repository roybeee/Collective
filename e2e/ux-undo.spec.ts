import {test,expect} from '@playwright/test';
// UX-PLAN-3 5차원 5점 조건 '되돌릴 수 있는 작업은 알림에서 되돌리기': 캠페인을 보관한 뒤 알림의 '되돌리기'로 바로 보관을 해제한다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
test('캠페인 보관 알림의 되돌리기로 보관을 바로 해제한다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`undo-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const title=`되돌리기 ${info.project.name}`;
  const {id}=await (await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'되돌리기 확인',budget:0}}})).json();
  expect((await page.request.post('/api/action',{data:{action:'save_artifact',campaignId:id,role:'cmo',title:'작업물',content:'원문'}})).status()).toBe(200);
  await page.goto('/?view=campaigns');
  const opened=page.getByRole('button',{name:title+' 열기',exact:true});
  await page.getByRole('button',{name:title+' 더 보기',exact:true}).click();
  await page.getByRole('menuitem',{name:'삭제…',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'보관(권장)',exact:true}).click();
  await expect(opened).toHaveCount(0);
  await page.getByRole('button',{name:'되돌리기',exact:true}).click();
  await expect(opened).toBeVisible();
  expect((await (await page.request.get('/api/campaigns/'+id)).json()).campaign.archivedAt).toBeUndefined();
 }finally{await context.close()}
});
