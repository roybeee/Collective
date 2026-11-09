// G8 셀프 가입 여정(docs/SELF-SIGNUP.ko.md, 이메일 인증 설정 playwright.auth.config.ts). 스위치 꺼짐: 가입 버튼 없음·API 404 →
// 운영자(첫 관리자)가 self_signup을 켬 → 새 브라우저에서 가입(동의 칸은 비어 있음) → 화면에 보인 확인 링크로 확인 → 예시 브랜드 없는 빈 워크스페이스에 로그인.
// HTTPS·Chromium·workerd·로컬 D1 real. 메일 발송은 없다(확인 링크를 화면에 보이는 방식). 외부 호출 없음.
import {test,expect} from '@playwright/test';
const adminPassword='Test-only-password-2026!',bootstrapToken='e2e-only-bootstrap-token-do-not-use-in-production';
const password='Signup-test-password-2026!';

test('셀프 가입 → 이메일 확인 → 빈 워크스페이스',async({page,browser,baseURL})=>{
 const headers={origin:baseURL!};
 const admin=await browser.newContext({baseURL,ignoreHTTPSErrors:true});
 // 이메일 여정(email-auth.spec.ts)이 먼저 돌았으면 첫 관리자가 이미 있으므로 로그인한다.
 let signedIn=await admin.request.post('/api/auth',{headers,data:{action:'bootstrap',email:'admin@example.test',password:adminPassword,token:bootstrapToken}});
 if(signedIn.status()!==200)signedIn=await admin.request.post('/api/auth',{headers,data:{action:'login',email:'admin@example.test',password:adminPassword}});
 expect(signedIn.status()).toBe(200);

 await page.goto('/');
 await expect(page.getByRole('heading',{name:'다시 만나 반갑습니다'})).toBeVisible();
 expect((await (await page.request.get('/api/auth/signup')).json()).enabled).toBe(false);
 // 꺼져 있으면 404다. 서버가 본문을 읽기 전에 거절하므로 본문을 싣지 않는다(wrangler dev 로컬 프록시 멈춤 회피, docs/EMAIL-AUTH.ko.md).
 expect((await page.request.post('/api/auth/signup',{headers})).status()).toBe(404);
 await expect(page.getByRole('button',{name:'새 워크스페이스 만들기(가입)'})).toHaveCount(0);

 expect((await admin.request.post('/api/feature-flags',{headers,data:{action:'set',flag:'self_signup',enabled:true}})).status()).toBe(200);
 await page.reload();
 await page.getByRole('button',{name:'새 워크스페이스 만들기(가입)'}).click();
 await expect(page.getByRole('heading',{name:'새 워크스페이스 만들기'})).toBeVisible();
 const terms=page.getByLabel('(필수) 이용약관에 동의합니다'),privacy=page.getByLabel('(필수) 개인정보 수집·이용',{exact:false}),marketing=page.getByLabel('(선택) 마케팅 정보 수신',{exact:false});
 for(const box of [terms,privacy,marketing])await expect(box).not.toBeChecked();
 const email=`owner-${Date.now()}@example.test`;
 await page.getByLabel('이메일',{exact:true}).fill(email);
 await page.getByLabel('비밀번호',{exact:true}).fill(password);
 await page.getByLabel('비밀번호 확인',{exact:true}).fill(password);
 await terms.check();await privacy.check();
 await page.screenshot({path:'e2e/artifacts/signup-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'가입하고 확인 링크 받기'}).click();
 await expect(page.getByRole('heading',{name:'이메일 확인'})).toBeVisible();
 expect(await page.getByLabel('이메일 확인 링크').inputValue()).toContain('#verify=');
 // 확인 전에는 로그인할 수 없다.
 const other=await browser.newContext({baseURL,ignoreHTTPSErrors:true});
 expect((await other.request.post('/api/auth',{headers,data:{action:'login',email,password}})).status()).toBe(401);
 await other.close();
 await page.getByRole('button',{name:'이메일 확인하고 시작'}).click();
 await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
 const ws=await (await page.request.get('/api/workspace')).json();
 expect(ws.brands).toEqual([]);expect(ws.campaigns).toEqual([]);
 const me=await (await page.request.get('/api/auth')).json();
 expect(me.user).toMatchObject({email,role:'owner'});
 await page.screenshot({path:'e2e/artifacts/signup-empty-workspace-mobile.png',fullPage:true});

 // 스위치를 다시 끄면 가입은 닫히고 가입한 계정 로그인은 그대로다.
 expect((await admin.request.post('/api/feature-flags',{headers,data:{action:'set',flag:'self_signup',enabled:false}})).status()).toBe(200);
 expect((await page.request.post('/api/auth/signup',{headers})).status()).toBe(404);
 await admin.close();
});
