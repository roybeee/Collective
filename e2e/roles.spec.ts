// G7 범위 역할 여정(이메일 로그인, 모의 로컬 D1): 대표가 scoped_roles를 켜고 팀 계정 관리에서 브랜드 매니저를 OFD 한 브랜드로 초대한다.
// 초대받은 계정은 OFD 캠페인만 보고 OFD 작업물은 승인되며, ODA 작업물 승인은 403과 범위 안내 문구다. 실행: playwright.roles.config.ts.
import {test,expect,type Page} from '@playwright/test';
test.skip(!process.env.E2E_ROLES,'이메일 로그인 서버가 필요합니다(playwright.roles.config.ts).');
const password='Test-only-password-2026!';
const SCOPE_DENIED='배정된 브랜드·지점 밖이거나 이 역할로 할 수 없는 작업입니다. 대표나 관리자에게 범위를 요청하세요.';
async function setup(page:Page,email:string){
 await page.getByLabel('이메일',{exact:true}).fill(email);
 await page.getByLabel('비밀번호',{exact:true}).fill(password);
 await page.getByLabel('비밀번호 확인',{exact:true}).fill(password);
 await page.getByRole('button',{name:'비밀번호 설정하고 시작'}).click();
 await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
}
test('대표가 브랜드 매니저를 한 브랜드에 배정하면 그 브랜드만 보이고 승인된다',async({page,browser,baseURL},info)=>{
 const headers={origin:baseURL!};
 const post=(path:string,data:object,on=page)=>on.request.post(path,{data,headers});
 // 첫 프로젝트는 bootstrap으로 대표 계정을 만들고, 다음 프로젝트는 같은 서버에 로그인한다(서버·D1 공유).
 const boot=await post('/api/auth',{action:'bootstrap',email:'admin@example.test',password,token:'e2e-only-bootstrap-token-do-not-use-in-production'});
 if(boot.status()!==200)expect((await post('/api/auth',{action:'login',email:'admin@example.test',password})).status()).toBe(200);
 expect((await page.request.get('/api/workspace')).status()).toBe(200);
 expect((await post('/api/feature-flags',{action:'set',flag:'scoped_roles',enabled:true})).status()).toBe(200);
 const tag=info.project.name,odaTitle=`ODA 범위 확인 ${tag}`;
 const oda=await (await post('/api/action',{action:'save_campaign',data:{brandId:'oda',title:odaTitle,goal:'ODA 평일 방문을 늘립니다.',budget:0}})).json();
 const artifact=async(campaignId:string)=>(await (await post('/api/action',{action:'save_artifact',campaignId,role:'cmo',title:`범위 작업물 ${tag}`,content:'검토할 내용'})).json()).id as string;
 const ofdArtifact=await artifact('ofd-pilot-01'),odaArtifact=await artifact(oda.id);

 await page.goto('/');
 await page.getByRole('button',{name:'팀 계정 관리',exact:true}).click();
 const email=`bm-${tag}@example.test`;
 await page.getByLabel('초대할 이메일').fill(email);
 await page.getByLabel('계정 권한').selectOption('brand_manager');
 await expect(page.getByText('배정한 브랜드 안에서만 작성·AI 실행·작업물 승인·발행합니다.',{exact:false})).toBeVisible();
 await page.getByRole('checkbox',{name:'Old Ferry Donut'}).click();
 await page.getByRole('button',{name:'초대 링크 만들기'}).click();
 const invite=await page.getByLabel('초대·재설정 링크').inputValue();
 await expect(page.getByText('브랜드 매니저(Old Ferry Donut)',{exact:false}).first()).toBeVisible();
 await expect(page.getByRole('region',{name:'최근 범위 변경'})).toBeVisible();
 await page.screenshot({path:`e2e/artifacts/roles-owner-${tag}.png`,fullPage:true});

 const context=await browser.newContext({baseURL,ignoreHTTPSErrors:true,viewport:page.viewportSize()!});
 const manager=await context.newPage();
 await manager.goto(invite);await setup(manager,email);
 const view=await (await manager.request.get('/api/workspace')).json();
 expect(view.access).toEqual({role:'brand_manager',brandIds:['ofd'],storeIds:[]});
 expect(view.brands.map((b:{id:string})=>b.id)).toEqual(['ofd']);
 expect(view.campaigns.some((c:{id:string})=>c.id===oda.id)).toBe(false);
 await manager.goto('/?view=campaigns');
 await expect(manager.getByRole('button',{name:'평일의 도넛 리추얼 열기',exact:true})).toBeVisible();
 await expect(manager.getByRole('button',{name:odaTitle+' 열기',exact:true})).toHaveCount(0);
 await manager.screenshot({path:`e2e/artifacts/roles-manager-${tag}.png`,fullPage:true});
 const approve=(id:string)=>post('/api/action',{action:'review_artifact',id,version:1,decision:'approved'},manager);
 const ok=await approve(ofdArtifact);expect(ok.status()).toBe(200);
 const denied=await approve(odaArtifact);expect(denied.status()).toBe(403);
 expect((await denied.json()).error).toBe(SCOPE_DENIED);
 expect((await post('/api/accounts',{action:'set_access',userId:'x',role:'member'},manager)).status()).toBe(403);
 await context.close();
});
