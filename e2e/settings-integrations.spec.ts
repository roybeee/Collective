import {test,expect,type Browser,type Page,type TestInfo} from '@playwright/test';
// X-F 연결 및 설정 재구성. 실제 로컬 D1·API·Chromium. 외부 공급자는 부르지 않는다.
// mocked 부분: Instagram 직접 게시 연결 저장은 서버가 Graph /me를 부르므로(이 환경에서 닿지 않음) 앱 자신의 POST /api/channels(connect_publisher)와
// 그 뒤 브랜드 상태 GET(/api/channels?brandId=)만 page.route로 성공 응답을 돌려준다. 나머지(탭·카드 상태·자율성 규칙·광고 제안 시드)는 real이다.
const owner=async(browser:Browser,info:TestInfo,tag:string)=>{const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`xf-${tag}-${info.project.name}-${Date.now()}`}});const page=await context.newPage();await page.request.get('/api/workspace');return {context,page}};
const mobile=(page:Page)=>(page.viewportSize()?.width??1280)<768;
const tab=(page:Page,name:string)=>page.getByRole('navigation',{name:'설정 바로가기',exact:true}).getByRole('tab',{name,exact:true});
const noOverflow=async(page:Page)=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);

test('설정 섹션 탭은 키보드로 옮기고 주소에 남으며 옛 카드 id 링크도 연다',async({browser},info)=>{
 const {context,page}=await owner(browser,info,'tabs');
 try{
  await page.goto('/?view=settings');
  const first=tab(page,'연결(AI·작업자)');await expect(first).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('region',{name:'전역 실행 중단',exact:true})).toBeVisible();
  await first.focus();await page.keyboard.press(mobile(page)?'ArrowRight':'ArrowDown');
  await expect(tab(page,'채널 연결')).toHaveAttribute('aria-selected','true');await expect(page).toHaveURL(/[?&]view=settings&section=channels/);
  await expect(tab(page,'채널 연결')).toBeFocused();
  await page.keyboard.press('End');await expect(tab(page,'기능표')).toHaveAttribute('aria-selected','true');await expect(page).toHaveURL(/section=features/);
  await expect(page.getByRole('heading',{name:'현재 사용할 수 있는 기능',exact:true})).toBeVisible();
  await page.keyboard.press('Home');await expect(first).toHaveAttribute('aria-selected','true');await expect(page).not.toHaveURL(/section=/);
  // 새로고침하면 같은 탭, 옛 카드 id(settings-worker·settings-channels)는 그 카드가 든 탭.
  await page.goto('/?view=settings&section=usage');await expect(tab(page,'사용량·비용')).toHaveAttribute('aria-selected','true');await expect(page.getByRole('heading',{name:'AI 사용량과 비용',exact:true})).toBeVisible();
  await page.goto('/?view=settings&section=settings-channels');await expect(tab(page,'채널 연결')).toHaveAttribute('aria-selected','true');await expect(page.locator('#settings-channels')).toBeVisible();
  await page.goto('/?view=settings&section=settings-worker');await expect(first).toHaveAttribute('aria-selected','true');await expect(page.locator('#settings-worker')).toBeVisible();
  // 기능표의 '성과 자동 수집 연결로 이동'은 채널 연결 탭을 열고 그 카드로 간다.
  await page.goto('/?view=settings&section=features');
  await page.locator('[data-feature="measurement"]').getByRole('button',{name:'성과 자동 수집 연결로 이동',exact:true}).click();
  await expect(tab(page,'채널 연결')).toHaveAttribute('aria-selected','true');await expect(page.locator('#settings-channels')).toBeInViewport();
  // 팀·권한 탭: 내 역할과 역할별 권한.
  await tab(page,'팀·권한').click();await expect(page.getByRole('region',{name:'팀·권한'})).toContainText('대표');
  // 섹션 높이(각 탭 내용). 예전 한 화면(모든 카드를 쌓음)은 이 값들의 합에 가깝다.
  const heights:Record<string,number>={};
  for(const name of ['연결(AI·작업자)','채널 연결','자동화 규칙','사용량·비용','팀·권한','기능표']){
   await tab(page,name).click();await page.waitForLoadState('networkidle');await page.waitForTimeout(300);
   await page.screenshot({path:`e2e/artifacts/settings-${info.project.name}-${Object.keys(heights).length}.png`,fullPage:true});
   heights[name]=await page.locator('.settings-tabs>[data-slot=tabs-content][data-state=active]').evaluate(el=>Math.round(el.getBoundingClientRect().height));
   await noOverflow(page);
  }
  const total=Object.values(heights).reduce((a,b)=>a+b,0);
  info.annotations.push({type:'settings-section-heights',description:JSON.stringify({...heights,sum:total})});
  // 기능표는 기존 카드 하나(행 수만큼 길다)라 따로 둔다. 나머지 탭은 예전 한 화면(4,800px 안팎)보다 짧아야 한다.
  for(const [name,h] of Object.entries(heights))if(name!=='기능표')expect(h,`${name} ${h}px`).toBeLessThan(4000);
 }finally{await context.close()}
});

test('채널 연결은 카드 6종을 연결 전 상태로 보이고 Instagram 직접 게시 연결 폼을 검증한다',async({browser},info)=>{
 const {context,page}=await owner(browser,info,'channels');
 try{
  await page.goto('/?view=settings&section=channels');
  const hub=page.getByRole('region',{name:'채널 연결',exact:true});await expect(hub).toBeVisible();
  for(const channel of ['buffer','instagram_direct','threads','kakao','pos_tossplace','naver_ads']){
   const card=hub.locator(`[data-channel="${channel}"]`);
   await expect(card,channel).toHaveAttribute('data-state','none');await expect(card.locator('[data-slot=badge]').first()).toHaveText('연결 전');
  }
  await expect(hub.locator('[data-channel="naver_ads"]')).toContainText('스위치 꺼짐');
  const ig=hub.locator('[data-channel="instagram_direct"]');
  await ig.getByRole('button',{name:'연결',exact:true}).click();
  const form=ig.getByRole('form',{name:'Instagram 직접 게시 연결'}),save=form.getByRole('button',{name:'연결 확인 후 저장',exact:true}),alert=form.getByRole('alert');
  await save.click();await expect(alert).toHaveText('액세스 토큰을 입력하세요.');
  await form.getByLabel('장수명 액세스 토큰').fill('EAAG-e2e-token');await save.click();await expect(alert).toHaveText('계정 ID를 입력하세요.');
  await form.getByLabel('Instagram 비즈니스 계정 ID').fill('abc');await save.click();await expect(alert).toHaveText('계정 ID는 숫자입니다.');
  // 서버 /me 확인 단계는 닿지 않으므로 앱 자신의 연결 저장과 그 뒤 상태 조회만 성공으로 돌려준다(mocked).
  const expiresAt=new Date(Date.now()+10*86_400_000).toISOString();let sent:Record<string,unknown>|null=null;
  await page.route('**/api/channels*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()==='POST'){const body=req.postDataJSON() as Record<string,unknown>;if(body.action==='connect_publisher'){sent=body;return route.fulfill({json:{channel:'instagram_direct',brandId:body.brandId,account:'e2e_shop',userId:'17841400000000000',expiresAt,expiringSoon:false,version:1,updatedAt:new Date().toISOString()}})}}
   if(req.method()==='GET'&&url.searchParams.get('brandId')&&sent){const real=await route.fetch(),json=await real.json() as {publishers?:{channel:string}[]};return route.fulfill({json:{...json,publishers:(json.publishers??[]).map(p=>p.channel==='instagram_direct'?{...p,connected:true,account:'e2e_shop',userId:'17841400000000000',expiresAt,expiringSoon:false,version:1}:p)}})}
   return route.fallback();
  });
  await form.getByLabel('Instagram 비즈니스 계정 ID').fill('17841400000000000');await save.click();
  await expect(page.getByText('Instagram 직접 게시 연결을 확인하고 저장했습니다.',{exact:true})).toBeVisible();
  expect(sent).toMatchObject({action:'connect_publisher',channel:'instagram_direct',data:{accessToken:'EAAG-e2e-token',userId:'17841400000000000',login:'facebook'}});
  await expect(ig).toHaveAttribute('data-state','expiring');await expect(ig).toContainText('토큰 만료까지 10일 남았습니다');await expect(ig).toContainText('e2e_shop');
  // 토큰 칸은 쓰기 전용: 다시 열면 비어 있다.
  await ig.getByRole('button',{name:'새 토큰으로 다시 연결',exact:true}).click();await expect(ig.getByLabel('장수명 액세스 토큰')).toHaveValue('');
  await noOverflow(page);
 }finally{await context.close()}
});

test('자동화 규칙 탭은 자율성 규칙을 보이고 고위험 행동의 자동은 이유와 함께 막는다',async({browser},info)=>{
 const {context,page}=await owner(browser,info,'autonomy');
 try{
  await page.goto('/?view=settings&section=automation');
  const rules=page.getByRole('region',{name:'자율성 규칙',exact:true});await expect(rules.getByRole('table')).toBeVisible();
  const auto=rules.getByRole('button',{name:'자동',exact:true}).first();await expect(auto).toBeDisabled();
  await expect(rules.locator('[data-slot=button-reason] .why-disabled').first()).not.toHaveText('');
  await expect(page.getByRole('region',{name:'예약 실행',exact:true})).toBeVisible();
  await noOverflow(page);
 }finally{await context.close()}
});

test('캠페인 성과 탭의 광고 제안 카드는 시드한 제안을 보이고 쓰기 스위치가 꺼져 있으면 승인을 이유와 함께 막는다',async({browser},info)=>{
 const {context,page}=await owner(browser,info,'ads');
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  // 스위치 꺼짐에서도 제안 생성(create)은 된다(외부 쓰기 없음).
  const seeded=await post('/api/ads-proposals',{action:'create',kind:'resume',campaignId:'e2e-ncc-1',operation:{op:'set_user_lock',target:'keyword',ids:['nkw-e2e-1'],userLock:false},rationale:'E2E 다시 켜기 제안'});
  expect(seeded.enabled).toBe(false);
  const {id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`광고 제안 ${info.project.name}`,goal:'광고 제안 확인'}});
  const day=(n:number)=>new Date(Date.now()-n*86_400_000).toISOString().slice(0,10);
  await post('/api/action',{action:'save_metric',campaignId,schemaVersion:2,periodStart:day(13),periodEnd:day(7),scope:'전체 주문',source:'POS 정산서',definition:'KST 순매출',method:'export',revenue:412000,orders:20,variableCosts:100000,adSpend:30000,productionCost:0});
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=results`);
  const card=page.getByRole('region',{name:'네이버 검색광고 제안',exact:true});await expect(card).toBeVisible();
  await expect(card).toContainText('추정·규칙 기반, 자동 적용 없음');
  const item=card.locator(`[data-proposal="${seeded.proposal.id}"]`);await expect(item).toContainText('다시 켜기');await expect(item).toContainText('위험 T3');await expect(item).toContainText('E2E 다시 켜기 제안');
  await expect(item.getByRole('list',{name:'바뀌는 값'})).toContainText('중지');
  const approve=item.getByRole('button',{name:'승인',exact:true});await expect(approve).toBeDisabled();
  await expect(item.locator('[data-slot=button-reason]').filter({has:page.getByRole('button',{name:'승인',exact:true})}).locator('.why-disabled')).toContainText('쓰기 스위치 꺼짐');
  // 서버도 같은 이유로 막는다(409).
  const denied=await page.request.post('/api/ads-proposals',{data:{action:'approve',id:seeded.proposal.id}});expect(denied.status()).toBe(409);expect((await denied.json()).error).toContain('쓰기 스위치 꺼짐');
  await noOverflow(page);
 }finally{await context.close()}
});
