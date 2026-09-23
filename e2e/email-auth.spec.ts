import {test,expect,type Page} from '@playwright/test';
const password='Test-only-password-2026!';
async function setup(page:Page,email:string){
 await page.getByLabel('이메일',{exact:true}).fill(email);
 await page.getByLabel('비밀번호',{exact:true}).fill(password);
 await page.getByLabel('비밀번호 확인',{exact:true}).fill(password);
 await page.getByRole('button',{name:'비밀번호 설정하고 시작'}).click();
 await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
}
test('이메일 로그인·초대·세션 유지·권한 제한·폐기',async({page,browser,baseURL})=>{
 const post=(path:string,data:object)=>page.request.post(path,{data,headers:{origin:baseURL!}});
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'다시 만나 반갑습니다'})).toBeVisible();
 await page.screenshot({path:'e2e/artifacts/email-login-mobile.png',fullPage:true});
 expect((await page.request.get('/api/workspace',{headers:{'oai-authenticated-user-id':'e2e-email-owner'}})).status()).toBe(401);
 await page.goto('/#setup=e2e-only-bootstrap-token-do-not-use-in-production');
 await setup(page,'admin@example.test');
 expect(page.url()).not.toContain('#');
 const cookies=await page.context().cookies();
 expect(cookies.find(c=>c.name==='__Host-collective_session')).toMatchObject({secure:true,httpOnly:true,sameSite:'Lax'});
 await page.reload();
 await expect(page.getByRole('button',{name:'팀 계정 관리',exact:true})).toBeVisible();
 expect((await page.request.get('/api/workspace')).status()).toBe(200);
 await page.getByRole('button',{name:'팀 계정 관리',exact:true}).click();
 await page.getByLabel('초대할 이메일').fill('member@example.test');
 await page.getByRole('button',{name:'초대 링크 만들기'}).click();
 const invite=await page.getByLabel('초대·재설정 링크').inputValue();
 await expect(page.getByRole('button',{name:'초대 링크 재발급',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'초대 취소',exact:true})).toBeVisible();
 const token=new URLSearchParams(new URL(invite).hash.slice(1)).get('invite');
 const context=await browser.newContext({baseURL,ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
 const member=await context.newPage();
 await member.goto(invite);await setup(member,'member@example.test');
 await expect(member.getByRole('button',{name:'팀 계정 관리',exact:true})).toHaveCount(0);
 expect((await member.request.get('/api/workspace')).status()).toBe(200);
 expect((await member.request.get('/api/accounts')).status()).toBe(403);
 expect((await member.request.post('/api/action',{headers:{origin:baseURL!},data:{action:'disconnect'}})).status()).toBe(403);
 expect((await member.request.post('/api/auth',{headers:{origin:baseURL!},data:{action:'accept',token,email:'member@example.test',password}})).status()).toBe(401);
 // Origin 없는 변경 요청은 본문을 읽기 전에 403으로 거절된다. 그래서 이 확인에는 본문을 싣지 않는다.
 // wrangler dev 4.92 로컬 프록시는 워커가 본문을 읽지 않고 응답하면 뒤따르는 요청(다음 줄 reload)을 붙잡는다.
 // 로컬에서는 멈춤, CI에서는 'Network connection lost'(HTTP 500)로 드러났다. 운영 Workers와 무관한 로컬 환경 문제다(docs/EMAIL-AUTH.ko.md).
 expect((await member.request.post('/api/action')).status()).toBe(403);
 await member.reload();await expect(member.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
 // 직원 화면에는 관리자 전용 버튼(캠페인 삭제, 채널 연결)을 그리지 않고 관리자에게 요청하라고 안내한다. 서버 403은 위 API 확인과 tests/execution-auth가 맡는다.
 const starter='평일의 도넛 리추얼';
 await expect(member.getByRole('button',{name:starter+' 열기',exact:true})).toBeVisible();
 // 삭제 진입점은 캠페인 목록 행의 '⋯ 더 보기' 메뉴다(ux-9 권고 1). 직원 목록에는 그 메뉴가 없어야 한다. 대시보드 표에는 누구에게도 없다.
 await expect(member.getByRole('button',{name:starter+' 더 보기',exact:true})).toHaveCount(0);
 await member.goto('/?view=campaigns');await expect(member.getByRole('button',{name:starter+' 열기',exact:true})).toBeVisible();
 await expect(member.getByRole('button',{name:starter+' 더 보기',exact:true})).toHaveCount(0);
 await member.getByRole('button',{name:starter+' 열기',exact:true}).click();
 await expect(member.getByRole('button',{name:'브리프 수정',exact:true})).toBeVisible();
 await expect(member.getByRole('button',{name:'삭제',exact:true})).toHaveCount(0);
 await member.getByRole('tab',{name:'제작·발행',exact:true}).click();
 await expect(member.getByText('채널 연결과 발행 횟수 한도는 관리자만 바꿀 수 있습니다.',{exact:false})).toBeVisible();
 await expect(member.getByRole('button',{name:'채널 확인·연결',exact:true})).toHaveCount(0);
 await member.keyboard.press('Escape');
 const accounts=await (await page.request.get('/api/accounts')).json() as {accounts:{id:string;email:string}[]};
 const userId=accounts.accounts.find(a=>a.email==='member@example.test')!.id;
 const reset=await (await post('/api/accounts',{action:'reset',userId})).json() as {token:string};
 const other=await browser.newContext({baseURL,ignoreHTTPSErrors:true});
 expect((await other.request.post('/api/auth',{headers:{origin:baseURL!},data:{action:'accept',token:reset.token,email:'member@example.test',password}})).status()).toBe(200);
 expect((await member.request.get('/api/workspace')).status()).toBe(401);
 expect((await post('/api/accounts',{action:'disable',userId})).status()).toBe(200);
 expect((await other.request.get('/api/workspace')).status()).toBe(401);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();
 await expect(page.getByRole('heading',{name:'다시 만나 반갑습니다'})).toBeVisible();
 await page.getByLabel('이메일',{exact:true}).fill('admin@example.test');
 await page.getByLabel('비밀번호',{exact:true}).fill(password);
 await page.getByRole('button',{name:'로그인',exact:true}).click();
 await expect(page.getByRole('button',{name:'팀 계정 관리',exact:true})).toBeVisible();
 // 삭제는 캠페인 목록 행의 '⋯' 메뉴에만 있다(ux-9 권고 1). 대시보드 표에는 없다.
 await page.goto('/?view=campaigns');await expect(page.getByRole('button',{name:starter+' 더 보기',exact:true})).toBeVisible();
 await context.close();await other.close();
});
