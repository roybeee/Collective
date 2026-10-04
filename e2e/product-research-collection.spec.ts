// 실제 Chromium·로컬 D1. 인증은 legacy 헤더 모의, 실패/관리자 화면 응답은 명시적으로 모의.
// 키가 없는 새 워크스페이스이므로 스위치를 켜도 외부 API 호출은 없다.
import {test,expect,type Browser,type Page,type TestInfo} from '@playwright/test';

async function open(browser:Browser,info:TestInfo){
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`e2e-collect-${info.project.name}-${crypto.randomUUID()}`}});
 const page=await context.newPage();
 await page.request.get('/api/workspace');
 expect((await page.request.post('/api/feature-flags',{data:{action:'set',flag:'product_research',enabled:true}})).status()).toBe(200);
 await page.goto('/?view=research&tab=sources');
 await expect(page.getByRole('heading',{name:'자동 수집',exact:true})).toBeVisible();
 return {context,page};
}
async function toggle(page:Page,on:boolean){
 await page.getByRole('button',{name:`자동 수집 ${on?'켜기':'끄기'}`,exact:true}).click({timeout:5000});
 await page.getByRole('alertdialog').getByRole('button',{name:on?'켜기':'끄기',exact:true}).click();
}

test('수집 스위치: 소유자 변경은 새로고침 뒤에도 유지되며 키 미연결을 따로 안내한다',async({browser},info)=>{
 const {context,page}=await open(browser,info);
 try{
  await toggle(page,true);
  await expect(page.getByRole('button',{name:'자동 수집 끄기',exact:true})).toBeEnabled();
  await expect(page.getByText('API 키가 연결되지 않아 실제 수집은 시작되지 않습니다.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'지금 수집',exact:true})).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button',{name:'자동 수집 끄기',exact:true})).toBeEnabled();
  await toggle(page,false);
  await page.reload();
  await expect(page.getByRole('button',{name:'자동 수집 켜기',exact:true})).toBeEnabled();
  const input=page.getByLabel('네이버 검색광고 API 키',{exact:true}).first();
  await expect(input).toHaveAttribute('autocomplete','new-password');
  await expect(input).toHaveAttribute('name',/^pr-credential-/);
  const hub=page.getByRole('region',{name:'NAVER API HUB 연결',exact:true});
  await expect(hub.getByLabel('NAVER API HUB Client ID',{exact:true})).toBeVisible();
  await expect(hub.getByLabel('NAVER API HUB Client Secret',{exact:true})).toHaveAttribute('type','password');
  await expect(hub.getByLabel('NAVER API HUB Client Secret',{exact:true})).toHaveAttribute('autocomplete','new-password');
  await expect(hub).toContainText('검색어 트렌드와 쇼핑인사이트 권한을 모두 확인한 뒤 연결을 저장합니다.');
  await expect(page.getByRole('region',{name:'네이버 개발자센터(기존 연결용) 연결',exact:true})).toBeVisible();
  const retired=page.getByRole('table',{name:'상품 리서치 출처',exact:true}).getByRole('row').filter({hasText:'네이버 쇼핑 검색'});
  await expect(retired).toContainText('서비스 종료');
  await expect(retired).not.toContainText('연결됨');
  await expect(retired.getByRole('button',{name:/수집/})).toHaveCount(0);
 }finally{await context.close()}
});

test('수집 스위치: 저장 거절은 기존 상태를 유지하고 실패 사유를 보인다',async({browser},info)=>{
 const {context,page}=await open(browser,info);
 try{
  await page.route('**/api/feature-flags',route=>route.request().method()==='POST'?route.fulfill({status:403,json:{error:'소유자만 변경할 수 있습니다.'}}):route.continue());
  await toggle(page,true);
  await expect(page.getByRole('alert').filter({hasText:'저장하지 못했습니다.'})).toContainText('소유자만 변경할 수 있습니다.');
  await expect(page.getByRole('button',{name:'자동 수집 켜기',exact:true})).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button',{name:'자동 수집 켜기',exact:true})).toBeEnabled();
 }finally{await context.close()}
});

test('수집 스위치: 저장 뒤 조회 실패는 저장 실패와 구분하고 재조회로 복구한다',async({browser},info)=>{
 const {context,page}=await open(browser,info);
 try{
  await page.route('**/api/product-research',route=>route.fulfill({status:503,json:{error:'조회 일시 실패'}}));
  await toggle(page,true);
  await expect(page.getByRole('alert').filter({hasText:'자동 수집 설정은 저장됐지만 최신 상태를 불러오지 못했습니다.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'자동 수집 켜기',exact:true})).toBeDisabled();
  await page.unroute('**/api/product-research');
  await page.getByRole('button',{name:'수집 상태 다시 확인',exact:true}).click();
  await expect(page.getByRole('button',{name:'자동 수집 끄기',exact:true})).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button',{name:'자동 수집 끄기',exact:true})).toBeEnabled();
 }finally{await context.close()}
});

test('수집 스위치: 관리자는 변경 버튼을 사용할 수 없다',async({browser},info)=>{
 const {context,page}=await open(browser,info);
 try{
  const view=await (await page.request.get('/api/product-research')).json();
  await page.route('**/api/auth',route=>route.fulfill({json:{mode:'email',user:{id:'u-admin',email:'admin@example.test',role:'admin'}}}));
  await page.route('**/api/product-research',route=>route.fulfill({json:{...view,canConnect:false}}));
  let writes=0;
  await page.route('**/api/feature-flags',route=>{if(route.request().method()==='POST')writes++;return route.continue()});
  await page.reload();
  await expect(page.getByRole('button',{name:'자동 수집 켜기',exact:true})).toBeDisabled();
  await expect(page.getByText('자동 수집 스위치는 소유자만 변경할 수 있습니다.',{exact:true})).toBeVisible();
  expect(writes).toBe(0);
 }finally{await context.close()}
});

test('수집 스위치: 확인 취소는 쓰지 않고 저장 중 중복 클릭을 막는다',async({browser},info)=>{
 const {context,page}=await open(browser,info);
 let release=()=>{};
 try{
  let writes=0;
  const hold=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/feature-flags',async route=>{if(route.request().method()==='POST'){writes++;await hold}await route.continue()});
  const button=page.getByRole('button',{name:'자동 수집 켜기',exact:true});
  await button.click();
  await expect(button).toBeDisabled();
  await page.getByRole('alertdialog').getByRole('button',{name:'취소',exact:true}).click();
  await expect(button).toBeEnabled();
  expect(writes).toBe(0);
  await toggle(page,true);
  await expect.poll(()=>writes).toBe(1);
  await expect(button).toBeDisabled();
  await button.evaluate((element:HTMLButtonElement)=>element.click());
  release();
  await expect(page.getByRole('button',{name:'자동 수집 끄기',exact:true})).toBeEnabled();
  expect(writes).toBe(1);
 }finally{release();await context.close()}
});

test('수집 스위치: 응답 유실은 저장 여부 미확인으로 알리고 재조회한다',async({browser},info)=>{
 const {context,page}=await open(browser,info);
 try{
  await page.route('**/api/feature-flags',route=>route.request().method()==='POST'?route.abort('failed'):route.continue());
  await toggle(page,true);
  await expect(page.getByRole('alert').filter({hasText:'서버 응답을 확인하지 못했습니다. 저장 여부를 다시 확인하세요.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'자동 수집 켜기',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'수집 상태 다시 확인',exact:true}).click();
  await expect(page.getByRole('button',{name:'자동 수집 켜기',exact:true})).toBeEnabled();
 }finally{await context.close()}
});

test('수집 스위치: 서버 저장 뒤 프록시 502는 실패 확정하지 않고 재조회한다',async({browser},info)=>{
 const {context,page}=await open(browser,info);
 try{
  await page.route('**/api/feature-flags',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   // page.request는 브라우저 route를 거치지 않는다. 실제 D1 저장 후 프록시 오류만 합성한다.
   const saved=await page.request.post('/api/feature-flags',{data:route.request().postDataJSON()});
   expect(saved.status()).toBe(200);
   await route.fulfill({status:502,json:{error:'프록시 응답 오류'}});
  });
  await toggle(page,true);
  await expect(page.getByRole('alert').filter({hasText:'서버 응답을 확인하지 못했습니다. 저장 여부를 다시 확인하세요.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'자동 수집 켜기',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'수집 상태 다시 확인',exact:true}).click();
  await expect(page.getByRole('button',{name:'자동 수집 끄기',exact:true})).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button',{name:'자동 수집 끄기',exact:true})).toBeEnabled();
 }finally{await context.close()}
});
