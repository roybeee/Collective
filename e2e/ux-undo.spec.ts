import {test,expect,type Browser,type TestInfo} from '@playwright/test';
// UX-PLAN-3 5차원 5점 조건 '되돌릴 수 있는 작업은 알림에서 되돌리기': 성공 알림(lib/ui/notify.ts notifySaved)의 '되돌리기'가 서버에 이미 있는 반대 동작으로 바로 원래 상태를 돌린다.
// 캠페인 보관 → 해제, 보관 해제 → 다시 보관, 상시 지시 저장 → 같은 지시 삭제, 자료 일괄 검토 → 검토 대기, 가맹 모집 스위치 → 앞 상태.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
async function open(browser:Browser,info:TestInfo,name:string){
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`undo-${name}-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
 await page.request.get('/api/workspace');
 return {context,page,post,undo:page.getByRole('button',{name:'되돌리기',exact:true})};
}
test('캠페인 보관 알림의 되돌리기로 보관을 바로 해제한다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'archive');
 try{
  const title=`되돌리기 ${info.project.name}`;
  const {id}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'되돌리기 확인',budget:0}});
  await post('/api/action',{action:'save_artifact',campaignId:id,role:'cmo',title:'작업물',content:'원문'});
  await page.goto('/?view=campaigns');
  const opened=page.getByRole('button',{name:title+' 열기',exact:true});
  await page.getByRole('button',{name:title+' 더 보기',exact:true}).click();
  await page.getByRole('menuitem',{name:'삭제…',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'보관(권장)',exact:true}).click();
  await expect(opened).toHaveCount(0);
  await undo.click();
  await expect(opened).toBeVisible();await expect(page.getByText('보관을 해제했습니다.',{exact:true})).toBeVisible();
  expect((await (await page.request.get('/api/campaigns/'+id)).json()).campaign.archivedAt).toBeUndefined();
 }finally{await context.close()}
});
test('보관 해제 알림의 되돌리기로 캠페인을 다시 보관한다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'unarchive');
 try{
  const title=`보관 해제 되돌리기 ${info.project.name}`;
  const {id}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'되돌리기 확인',budget:0}});
  await post('/api/campaigns',{action:'archive_campaign',id});
  await page.goto('/?view=campaigns');
  await page.getByRole('combobox',{name:'브랜드 필터',exact:true}).selectOption({label:'보관함'});
  await page.getByRole('button',{name:title+' 더 보기',exact:true}).click();
  await page.getByRole('menuitem',{name:'보관 해제',exact:true}).click();
  await expect(page.getByText('보관을 해제했습니다.',{exact:true})).toBeVisible();
  expect((await (await page.request.get('/api/campaigns/'+id)).json()).campaign.archivedAt).toBeUndefined();
  await undo.click();
  await expect(page.getByText('다시 보관했습니다.',{exact:true})).toBeVisible();
  expect((await (await page.request.get('/api/campaigns/'+id)).json()).campaign.archivedAt).toBeTruthy();
 }finally{await context.close()}
});
test('상시 지시 저장 알림의 되돌리기로 방금 저장한 지시를 지운다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'directive');
 try{
  const {id}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`지시 되돌리기 ${info.project.name}`,goal:'되돌리기 확인',budget:0}});
  // 상시 지시는 캠페인의 AI 팀 탭에 있다.
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=team`);
  const text='할인 문구는 확인 전에 쓰지 않는다.';
  await page.getByRole('textbox',{name:'상시 지시',exact:true}).fill(text);await page.getByRole('button',{name:'지시 저장',exact:true}).click();
  await expect(page.getByText(text,{exact:true})).toBeVisible();
  const list=async()=>((await (await page.request.get('/api/directives?campaignId='+id)).json()) as {directives:{text:string}[]}).directives.map(d=>d.text);
  expect(await list()).toEqual([text]);
  await undo.click();
  await expect(page.getByText('상시 지시 저장을 되돌렸습니다.',{exact:true})).toBeVisible();await expect(page.getByText(text,{exact:true})).toHaveCount(0);
  expect(await list()).toEqual([]);
 }finally{await context.close()}
});
test('자료 일괄 검토 알림의 되돌리기로 자료를 검토 대기로 돌린다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'review');
 try{
  const title=`되돌리기 자료 ${info.project.name}`;
  const {id}=await post('/api/archive',{action:'add_source',brandId:'ofd',data:{title,category:'market',url:'https://example.com/undo',content:'공개 자료에서 저녁 주문 증가를 관측했습니다.',scope:'공개 웹 자료'}});
  const status=async()=>((await (await page.request.get('/api/archive?brandId=ofd')).json()) as {sources:{id:string;status:string}[]}).sources.find(s=>s.id===id)?.status;
  const before=await status();
  await page.goto('/?view=brands&brand=ofd');await page.getByRole('tab',{name:/^자료 아카이브/}).click();
  await page.getByRole('button',{name:'후보 일괄 검토',exact:true}).click();
  const bulk=page.getByRole('dialog',{name:'후보 자료 일괄 검토'});
  await bulk.locator('label',{hasText:title}).getByRole('checkbox').check();
  await bulk.getByRole('button',{name:'선택 자료 확인하고 사용',exact:true}).click();
  await expect(page.getByText('1건을 확인했습니다.',{exact:true})).toBeVisible();expect(await status()).toBe('confirmed');
  await undo.click();
  await expect(page.getByText('검토 대기로 되돌렸습니다.',{exact:true})).toBeVisible();
  expect(await status()).toBe(before);
 }finally{await context.close()}
});
test('가맹 모집 스위치 알림의 되돌리기로 앞 상태로 돌린다',async({browser},info)=>{
 const {context,page,undo}=await open(browser,info,'franchise');
 try{
  const on=async()=>((await (await page.request.get('/api/feature-flags')).json()) as {flags:{flag:string;enabled:boolean}[]}).flags.find(f=>f.flag==='r_franchise')?.enabled;
  expect(await on()).toBe(false);
  await page.goto('/?view=settings');
  await page.getByRole('button',{name:'가맹 모집 켜기',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'켜기',exact:true}).click();
  await expect(page.getByText('가맹 모집을 켰습니다.',{exact:true})).toBeVisible();expect(await on()).toBe(true);
  await undo.click();
  await expect(page.getByText('가맹 모집을 다시 껐습니다.',{exact:true})).toBeVisible();
  expect(await on()).toBe(false);await expect(page.getByRole('button',{name:'가맹 모집 켜기',exact:true})).toBeVisible();
 }finally{await context.close()}
});
