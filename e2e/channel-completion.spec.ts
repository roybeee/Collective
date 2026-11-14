import {test,expect,type Browser,type TestInfo} from '@playwright/test';
// 레인 C 채널 마감 화면. 실제 로컬 D1·API·Chromium. 외부 공급자(카카오 딜러·Instagram Graph)는 부르지 않는다.
// 1) 카카오 '메시지 보내기': real — 스위치·수신동의 가져오기·수신자 묶음 읽기·초안 판정·승인은 로컬 API 그대로다. 전송(딜러 호출)은 하지 않는다.
// 2) 캐러셀 승인 카드: mocked — Instagram 직접 게시 연결은 Graph /me 검증이 필요해(이 환경에서 닿지 않음) GET /api/execution 상태와 approve 응답,
//    캠페인 승인 상태(/api/workspace·/api/campaigns/<id>의 이 캠페인 status·기간)를 page.route로 바꾼다. 확인 사실·캠페인 생성은 real이다.
const owner=async(browser:Browser,info:TestInfo,tag:string)=>{const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`lc-${tag}-${info.project.name}-${Date.now()}`}});const page=await context.newPage();return {context,page}};

test('카카오 메시지 보내기: 수신자 묶음 수·추정 비용·초안 판정·승인 확인 카드',async({browser},info)=>{
 test.setTimeout(90_000);
 const {context,page}=await owner(browser,info,'kakao');
 try{
  const ws=await(await page.request.get('/api/workspace')).json() as {brands:{id:string}[]};const brandId=ws.brands[0].id;
  expect((await page.request.post('/api/feature-flags',{data:{action:'set',flag:'kakao_bizmessage',enabled:true}})).status()).toBe(200);
  const csv='phone,consentedAt,source,nightConsent\n010-1111-2222,2026-10-01,form,true\n010-3333-4444,2026-10-01,form,false';
  const imported=await page.request.post('/api/kakao',{data:{action:'consent_import',brandId,csv}});expect(imported.status()).toBe(200);
  await page.goto('/?view=settings&section=channels');
  const card=page.locator('[data-channel="kakao"]');await expect(card).toBeVisible({timeout:15_000});
  const panel=card.locator('details',{has:page.getByText('메시지 보내기',{exact:true})});
  await panel.locator('summary').click();
  await expect(panel.getByText('이 묶음 2명(해시로만 셉니다)',{exact:true})).toBeVisible();
  await expect(panel.getByLabel('추정 비용',{exact:true})).toContainText('2명 ×');
  const recipient=panel.getByRole('combobox',{name:'수신자(해시 앞 8자)',exact:true});
  await expect(recipient.locator('option')).toHaveCount(2);
  expect(await panel.textContent()).not.toContain('010-');
  await panel.getByRole('textbox',{name:'메시지 본문',exact:true}).fill('(광고) ODA\n이번 주 신메뉴 안내\n무료 수신거부 080-123-4567');
  const drafted=page.waitForResponse(r=>r.url().endsWith('/api/kakao')&&r.request().postDataJSON()?.action==='draft');
  await panel.getByRole('button',{name:'초안 저장·판정',exact:true}).click();expect((await drafted).status()).toBe(200);
  await expect(panel.getByRole('status',{name:'판정 결과'})).toBeVisible();
  const list=panel.getByRole('region',{name:'전송 상태',exact:true});
  const row=list.locator('li[data-status="draft"]').first();await expect(row).toBeVisible();
  const approveButton=row.getByRole('button',{name:'전송 승인',exact:true});
  if(await approveButton.isEnabled()){
   await approveButton.click();
   const dialog=page.getByRole('alertdialog').or(page.getByRole('dialog'));
   await expect(dialog.getByText('이 메시지 전송을 승인할까요?')).toBeVisible();
   await expect(dialog).toContainText('1건 추정');
   const approved=page.waitForResponse(r=>r.url().endsWith('/api/kakao')&&r.request().postDataJSON()?.action==='approve');
   await dialog.getByRole('button',{name:'전송 승인',exact:true}).click();expect((await approved).status()).toBe(200);
   await expect(list.locator('li[data-status="approved"]').first()).toBeVisible();
   await expect(list.locator('li[data-status="approved"]').first().getByRole('button',{name:'보내기'})).toBeDisabled();
  }else{
   // 야간(KST 20:50~08:00)에는 판정이 막혀 승인 단추가 막히고 사유가 보인다.
   await expect(row.getByRole('list',{name:'막힌 사유'})).toBeVisible();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});

test('캐러셀 승인 카드는 장마다 해시를 보이고 승인 요청에 같은 해시 목록을 싣는다',async({browser},info)=>{
 test.setTimeout(90_000);
 const {context,page}=await owner(browser,info,'carousel');
 try{
  await page.request.get('/api/workspace');
  const title='캐러셀 카드 '+info.project.name;
  const campaign=await(await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'캐러셀 확인',budget:0}}})).json() as {id:string};
  const fact=await page.request.post('/api/brand-facts',{data:{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'signature_menu',value:'딸기 도넛',status:'confirmed',source:'E2E 합성 검증',verifiedAt:new Date(Date.now()-60000).toISOString(),validUntil:new Date(Date.now()+30*86400000).toISOString()}}});expect(fact.status()).toBe(200);
  const day=(n:number)=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
  await page.route('**/api/workspace*',async route=>{const r=await route.fetch();const j=await r.json();j.campaigns=j.campaigns.map((c:{id:string})=>c.id===campaign.id?{...c,status:'approved',startDate:day(-1),endDate:day(30)}:c);await route.fulfill({status:r.status(),contentType:'application/json',body:JSON.stringify(j)})});
  const approve=(c:Record<string,unknown>)=>({...c,status:'approved',startDate:day(-1),endDate:day(30)});
  await page.route(`**/api/campaigns/${campaign.id}*`,async route=>{if(route.request().method()!=='GET')return route.continue();const r=await route.fetch();const j=await r.json();const k=j.id===campaign.id?approve(j):j.campaign?.id===campaign.id?{...j,campaign:approve(j.campaign)}:j;await route.fulfill({status:r.status(),contentType:'application/json',body:JSON.stringify(k)})});
  const h=(c:string)=>c.repeat(64),IG='instagram_direct:17841400000000000',scheduledAt=new Date(Date.now()+2*86400000).toISOString();
  const creative=(id:string,c:string)=>({id,campaignId:campaign.id,campaignVersion:1,brandId:'ofd',version:1,factRefs:[],caption:'대표 메뉴: 딸기 도넛',pngHash:h(c),objectKey:'',materialHash:'m',createdAt:new Date().toISOString(),current:true,title:'소재 '+c});
  const draft={id:'pub-carousel',campaignId:campaign.id,creativeId:'cr-a',creativeVersion:1,campaignVersion:1,pngHash:h('a'),factRefs:[],caption:'대표 메뉴: 딸기 도넛',mediaUrl:'',mediaMode:'auto',scheduledAt,plannedCostKRW:0,version:1,status:'draft',createdAt:new Date().toISOString(),
   mediaSet:{type:'CAROUSEL',items:[{creativeId:'cr-b',creativeVersion:1,pngHash:h('b'),mediaUrl:''},{creativeId:'cr-c',creativeVersion:1,pngHash:h('c'),mediaUrl:''}]}};
  let publication:Record<string,unknown>=draft;let approveBody:Record<string,unknown>|null=null;
  await page.route('**/api/execution?campaignId=*',route=>route.fulfill({json:{creatives:[creative('cr-a','a'),creative('cr-b','b'),creative('cr-c','c')],publications:[publication],limits:{id:campaign.id,version:1,maxPublications:5,maxPlannedCostKRW:0,paused:false},publisher:{connected:true,channelId:IG,account:'oda_official · Instagram 직접 게시(Graph API)',version:1},copies:[],copyCaptions:false,experimentLinks:[]}}));
  await page.route('**/api/execution',async route=>{const body=route.request().postDataJSON();if(body?.action!=='approve')return route.continue();approveBody=body;publication={...draft,status:'approved',version:2,channelId:IG,mediaUrl:`https://app.test/media/${h('a')}.png`};await route.fulfill({json:publication})});
  await page.goto('/');await page.getByRole('button',{name:title+' 열기',exact:true}).click();
  await page.getByRole('tab',{name:'제작·발행',exact:true}).click();
  const media=page.getByRole('region',{name:'캐러셀 미디어',exact:true});await expect(media).toBeVisible({timeout:15_000});
  await expect(media.getByText('캐러셀 3장 (Instagram 직접 게시)')).toBeVisible();
  for(const [i,c] of [['1','a'],['2','b'],['3','c']])await expect(media.getByText(`${i}번째 · 해시 ${h(c).slice(0,12)}`)).toBeVisible();
  const article=page.locator('article',{has:media});
  await article.getByRole('checkbox').first().check();
  await article.getByRole('button',{name:'이 버전 발행 승인',exact:true}).click();
  const dialog=page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toContainText(`캐러셀 3장(미디어 해시 ${h('a').slice(0,12)}, ${h('b').slice(0,12)}, ${h('c').slice(0,12)})`);
  await dialog.getByRole('button',{name:'발행 승인',exact:true}).click();
  await expect.poll(()=>approveBody?.mediaHashes).toEqual([h('a'),h('b'),h('c')]);
  expect(approveBody!.channelId).toBe(IG);
  await expect(article.locator('strong',{hasText:'실행 승인'})).toBeVisible();
 }finally{await context.close()}
});
