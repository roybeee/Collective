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
  expect(new Set(calls).size,calls.join(',')).toBeLessThanOrEqual(2);
  const before=calls.length;await growth.locator('summary').filter({hasText:/^고객 문의·약속 기한$/}).click();await expect(growth.getByRole('region',{name:'고객 문의 처리',exact:true})).toBeVisible();
  expect(calls.slice(before)).toContain('/api/growth/cs');
  // 연 패널과 섹션도 주소(#)에 남아 새로고침 뒤 같은 곳이 열린다(UX-PLAN-3 Q1).
  await expect.poll(()=>page.evaluate(()=>decodeURIComponent(location.hash))).toBe('#panel-고객 문의·약속 기한');
  await page.reload();await expect(page.getByRole('region',{name:'고객 문의 처리',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'성장 섹션 바로가기',exact:true}).getByRole('link',{name:/^실행/}).click();await expect.poll(()=>page.evaluate(()=>location.hash)).toBe('#growth-section-execute');
  // 2b) 작업 단계·Meta 하위 탭도 주소(csub)에 남고 새로고침 뒤 같은 단계를 연다. 이동 경로가 현재 탭을 보인다(UX-PLAN-3 Q1).
  await growth.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'상품',exact:true}).click();await expect(page).toHaveURL(/ctab=growth&csub=catalog/);
  await page.reload();await expect(page.getByRole('navigation',{name:'성장 작업 단계'}).getByRole('button',{name:'상품',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('navigation',{name:'이동 경로',exact:true})).toContainText('성장·판매');
  await page.getByRole('tab',{name:'Meta 광고 준비',exact:true}).click();await expect(page).not.toHaveURL(/csub=/);
  await page.getByRole('tab',{name:'광고 성과',exact:true}).click();await expect(page).toHaveURL(/ctab=meta-ads&csub=insights/);
  await page.reload();await expect(page.getByRole('tab',{name:'광고 성과',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('navigation',{name:'이동 경로',exact:true})).toContainText('Meta 광고 준비');
  // 3) 안쪽 탭을 바꾸면 주소도 바뀐다.
  await page.getByRole('tab',{name:'성과',exact:true}).click();await expect(page).toHaveURL(/ctab=results/);
  // 3b) 모바일: 스크롤로 머리글 동작이 사라지면 같은 버튼 묶음이 화면 아래에 고정된다(UX-PLAN-3 Q8). 첫 화면에서는 고정하지 않는다.
  if(mobile){const edit=page.getByRole('button',{name:'브리프 수정',exact:true});await expect(edit).toHaveCount(1);await page.getByRole('navigation',{name:'이동 경로',exact:true}).scrollIntoViewIfNeeded();await expect(page.locator('[data-floating]')).toHaveCount(0);
   await page.mouse.wheel(0,1500);await expect(page.locator('[data-floating]')).toHaveCount(1);await expect(edit).toBeInViewport();
   const box=await edit.boundingBox(),vh=page.viewportSize()!.height;expect(box!.y+box!.height).toBeGreaterThan(vh-80);expect(box!.height).toBeGreaterThanOrEqual(44);await page.getByRole('navigation',{name:'이동 경로',exact:true}).scrollIntoViewIfNeeded();await expect(page.locator('[data-floating]')).toHaveCount(0)}
  // 4) 명령 팔레트(데스크톱 단축키)로 설정 이동 → 운영 안전에 전역 중단.
  await page.keyboard.press('Escape');
  if(!mobile){await page.keyboard.press('Control+k');const palette=page.getByRole('dialog',{name:'바로 가기'});await expect(palette).toBeVisible();await palette.getByPlaceholder('화면·캠페인·작업물 검색').fill('연결 및 설정');await page.keyboard.press('Enter');}
  else await page.goto('/?view=settings');
  await expect(page.getByRole('navigation',{name:'설정 바로가기',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'전역 실행 중단',exact:true})).toBeVisible();
  // 5) 키보드 단축키(데스크톱): g c → 캠페인, / → 바로 가기, 입력란 안에서는 단축키가 아니다.
  if(!mobile){
   await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('g');await page.keyboard.press('c');await expect(page).toHaveURL(/view=campaigns/);
   await page.keyboard.press('/');await expect(page.getByRole('dialog',{name:'바로 가기'})).toBeVisible();
   // 용어 도움말·브랜드 검색(UX-PLAN-3 Q6·Q1): 검색하면 용어 정의가 보이고, 브랜드를 고르면 브랜드 아카이브로 간다.
   const palette=page.getByRole('dialog',{name:'바로 가기'});await palette.getByPlaceholder('화면·캠페인·작업물 검색').fill('공헌이익');await expect(palette.getByRole('option',{name:/공헌이익.*판매 금액에서/})).toBeVisible();
   await palette.getByPlaceholder('화면·캠페인·작업물 검색').fill('Old Ferry');await palette.getByRole('option',{name:/Old Ferry Donut/}).first().click();await expect(page).toHaveURL(/view=brands&brand=/);
   await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('?');await expect(page.getByRole('dialog',{name:'바로 가기'}).getByRole('option',{name:/^ROAS/})).toBeVisible();await page.keyboard.press('Escape');
   await page.keyboard.press('g');await page.keyboard.press('c');await expect(page).toHaveURL(/view=campaigns/);
   await page.getByRole('textbox',{name:'캠페인 검색',exact:true}).fill('gh');await expect(page).toHaveURL(/view=campaigns/);
   // 캠페인 표 머리글 정렬(UX-PLAN-3 Q7): 누르면 오름차순, 다시 누르면 내림차순으로 aria-sort가 바뀐다.
   await page.getByRole('textbox',{name:'캠페인 검색',exact:true}).fill('');const sortHead=page.locator('.campaign-table').getByRole('columnheader',{name:/^캠페인/});
   await expect(sortHead).toHaveAttribute('aria-sort','none');await sortHead.getByRole('button').click();await expect(sortHead).toHaveAttribute('aria-sort','ascending');await sortHead.getByRole('button').click();await expect(sortHead).toHaveAttribute('aria-sort','descending');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
