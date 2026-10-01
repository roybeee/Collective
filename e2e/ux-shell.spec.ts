import {test,expect} from '@playwright/test';
// UX-PLAN P4·P5·P7: 홈 '오늘의 안건' → 캠페인 성장·판매 섹션, 캠페인 탭 주소 복원, 접힌 패널 지연 로딩(요청 수), 명령 팔레트, 전역 중단의 설정 이동.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
test('오늘의 안건·캠페인 탭 주소·지연 로딩·명령 팔레트·운영 안전 설정',async({browser},info)=>{
 const owner=`ux-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 const mobile=(page.viewportSize()?.width??1280)<768;
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const title=`안건 캠페인 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'안건 확인'}});
  const g=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await g('save_catalog','ux-cat',{sku:'UX-SKU',title:'상품',price:10000,unitCost:3000,variableCost:1000,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[],validUntil:'2099-01-01'});
  await g('save_offer','ux-offer',{title:'오퍼',catalogId:'ux-cat',catalogVersion:1,needId:'',price:10000,quantity:1,landingUrl:'https://example.com/p',purchaseReason:'이유',priceApproved:true});
  const tomorrow=new Date(Date.now()+33*3600000).toISOString().slice(0,10);
  await g('save_mission','ux-mission',{title:'내일 마감 미션',offerId:'ux-offer',offerVersion:1,assignee:'담당',deadline:tomorrow,nextAction:'발행',channel:'storefront',budget:0,lossLimit:0,stopRule:'한도',fulfillmentOwner:'물류'});
  // 1) 홈 안건 → 성장·판매 탭(주소에 ctab=growth).
  await page.goto('/');const agenda=page.getByRole('region',{name:'오늘의 안건',exact:true});
  await expect(agenda.getByRole('list',{name:'안건 요약',exact:true})).toContainText('다가오는 기한');
  await agenda.getByRole('button',{name:/판매 미션 기한 3일 이내/}).click();
  await expect(page.getByRole('tab',{name:'성장·판매',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page).toHaveURL(/ctab=growth/);await expect(page).toHaveURL(new RegExp(`campaign=${campaignId}`));
  // 2) 새로고침해도 같은 탭. 탭을 열 때 성장 API 요청은 4건 이하(접힌 패널은 열 때만 읽는다).
  const calls:string[]=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/growth')||u.pathname==='/api/storefront-pulls')calls.push(u.pathname)});
  await page.reload();await expect(page.getByRole('tab',{name:'성장·판매',exact:true})).toHaveAttribute('aria-selected','true');
  const growth=page.getByRole('region',{name:'성장2 판매 워크스페이스',exact:true});await expect(growth.getByRole('navigation',{name:'성장 섹션 바로가기',exact:true})).toBeVisible();
  await expect(growth.getByRole('heading',{name:/^판단/})).toBeVisible();await page.waitForTimeout(1500);
  expect(new Set(calls).size,calls.join(',')).toBeLessThanOrEqual(4);
  const before=calls.length;await growth.locator('summary').filter({hasText:/^고객 문의·약속 기한$/}).click();await expect(growth.getByRole('region',{name:'고객 문의 처리',exact:true})).toBeVisible();
  expect(calls.slice(before)).toContain('/api/growth/cs');
  // 3) 안쪽 탭을 바꾸면 주소도 바뀐다.
  await page.getByRole('tab',{name:'성과',exact:true}).click();await expect(page).toHaveURL(/ctab=results/);
  // 4) 명령 팔레트(데스크톱 단축키)로 설정 이동 → 운영 안전에 전역 중단.
  await page.keyboard.press('Escape');
  if(!mobile){await page.keyboard.press('Control+k');const palette=page.getByRole('dialog',{name:'바로 가기'});await expect(palette).toBeVisible();await palette.getByPlaceholder('화면·캠페인 검색').fill('연결 및 설정');await page.keyboard.press('Enter');}
  else await page.goto('/?view=settings');
  await expect(page.getByRole('navigation',{name:'설정 바로가기',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'전역 실행 중단',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
