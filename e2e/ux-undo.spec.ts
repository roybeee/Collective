import {test,expect,type Browser,type Page,type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {emptyCatalogInput,emptyOfferInput} from '../lib/growth-catalog';
import {emptyMissionInput} from '../lib/growth-mission';
import {emptyDecisionInput} from '../lib/growth-decisions';
// UX-PLAN-3 5차원 5점 조건 '되돌릴 수 있는 작업은 알림에서 되돌리기': 성공 알림(lib/ui/notify.ts notifySaved)의 '되돌리기'가 서버에 이미 있는 반대 동작으로 바로 원래 상태를 돌린다.
// 캠페인 보관 → 해제, 보관 해제 → 다시 보관, 상시 지시 저장 → 같은 지시 삭제, 자료 일괄 검토 → 검토 대기, 가맹 모집 스위치 → 앞 상태.
// X3: 자료 한 건 확인 → 검토 대기, 브리프 수정 → 앞 판 내용, 상시 지시 삭제 → 같은 지시 다시 저장, 원인 연결 → 해제, 원인 연결 해제 → 다시 연결,
// 플레이스 할 일 완료 → 다시 열기, 매장 확인 기록 수정 → 앞 내용.
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
test('자료 한 건 확인 알림의 되돌리기로 자료를 검토 대기로 돌린다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'source');
 try{
  const title=`한 건 확인 되돌리기 ${info.project.name}`;
  const {id}=await post('/api/archive',{action:'add_source',brandId:'ofd',data:{title,category:'market',url:'https://example.com/undo-one',content:'공개 자료에서 점심 포장 주문 증가를 관측했습니다.',scope:'공개 웹 자료'}});
  const status=async()=>((await (await page.request.get('/api/archive?brandId=ofd')).json()) as {sources:{id:string;status:string}[]}).sources.find(s=>s.id===id)?.status;
  expect(await status()).toBe('candidate');
  await page.goto('/?view=brands&brand=ofd');await page.getByRole('tab',{name:/^자료 아카이브/}).click();
  await page.getByRole('button').filter({hasText:title}).click();
  await page.getByRole('dialog',{name:title}).getByRole('button',{name:'내용을 확인하고 사용',exact:true}).click();
  await expect(page.getByText('자료를 확인했습니다.',{exact:true})).toBeVisible();expect(await status()).toBe('confirmed');
  await undo.click();
  await expect(page.getByText('검토 대기로 되돌렸습니다.',{exact:true})).toBeVisible();
  expect(await status()).toBe('candidate');
 }finally{await context.close()}
});
test('브리프 수정 알림의 되돌리기로 앞 판 내용을 다음 판에 다시 저장한다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'brief');
 try{
  const title=`브리프 되돌리기 ${info.project.name}`,goal='처음 목표';
  const {id}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal,budget:0}});
  const campaign=async()=>((await (await page.request.get('/api/campaigns/'+id)).json()) as {campaign:{goal:string;version:number}}).campaign;
  await page.goto(`/?view=campaigns&campaign=${id}`);
  const sheet=page.getByRole('region',{name:title});
  await sheet.getByRole('button',{name:'브리프 수정',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'캠페인을 더 구체적으로'});
  await dialog.getByRole('textbox',{name:'브리프 목표'}).fill('바꾼 목표');
  await dialog.getByRole('button',{name:'브리프 수정 저장',exact:true}).click();
  await expect(page.getByText('캠페인 브리프를 저장했습니다.',{exact:true})).toBeVisible();await expect(dialog).toBeHidden();
  expect(await campaign()).toMatchObject({goal:'바꾼 목표',version:2});
  await undo.click();
  await expect(page.getByText('브리프를 앞 판 내용으로 되돌렸습니다.',{exact:true})).toBeVisible();
  expect(await campaign()).toMatchObject({goal,version:3});
  await expect(sheet.getByRole('heading',{level:2,name:goal,exact:true})).toBeVisible();
 }finally{await context.close()}
});
test('상시 지시 삭제 알림의 되돌리기로 같은 지시를 다시 저장한다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'directive-remove');
 try{
  const {id}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`지시 삭제 되돌리기 ${info.project.name}`,goal:'되돌리기 확인',budget:0}});
  const text='가격 문구는 확정 사실만 씁니다.';
  await post('/api/directives',{action:'add',campaignId:id,text});
  const list=async()=>((await (await page.request.get('/api/directives?campaignId='+id)).json()) as {directives:{text:string}[]}).directives.map(d=>d.text);
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=team`);
  await expect(page.getByText(text,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'상시 지시 삭제',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'삭제',exact:true}).click();
  await expect(page.getByText('상시 지시를 삭제했습니다.',{exact:true})).toBeVisible();expect(await list()).toEqual([]);
  await undo.click();
  await expect(page.getByText('상시 지시를 다시 저장했습니다.',{exact:true})).toBeVisible();await expect(page.getByText(text,{exact:true})).toBeVisible();
  expect(await list()).toEqual([text]);
 }finally{await context.close()}
});
// 반품 원인 연결의 바탕: 지점 캠페인, 상품·오퍼·미션, 주문 품목, 환불 1건과 원인 기록, 일일 결정 1건(e2e/growth-cause-links.spec.ts와 같은 합성 기록).
async function causeSeed(page:Page,post:Awaited<ReturnType<typeof open>>['post'],project:string){
 const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'원인 되돌리기 지점',address:'합성 주소',tradeArea:'residential',goal:'원인 연결'}});
 const {id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title:`원인 되돌리기 ${project}`,goal:'원인 개선'}});
 const save=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
 await save('save_catalog','undo-catalog',{...emptyCatalogInput(),title:'원인 상품',sku:'UNDO-SKU',stockUnit:'piece'});
 await save('save_offer','undo-offer',{...emptyOfferInput(),title:'원인 오퍼',catalogId:'undo-catalog',catalogVersion:1});
 await save('save_mission','undo-mission',{...emptyMissionInput(),title:'원인 미션',offerId:'undo-offer',offerVersion:1});
 const {ids:[orderId]}=await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:'UNDO',orderDate:new Date().toISOString().slice(0,10),mode:'delivery',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인'}});
 const stock=await post('/api/growth/operations',{action:'create_inventory',campaignId,campaignVersion:1,input:{sku:'UNDO-SKU',locationId:storeId,unit:'piece',onHand:5},observedAt:new Date().toISOString(),evidenceRef:'count-sheet'});
 const linked=await post('/api/growth/operations',{action:'link_order',campaignId,campaignVersion:1,expectedVersion:0,inventoryVersion:stock.inventory[0].version,input:{orderId,orderVersion:1,sourceKey:'shop',accountId:'seller',externalLineId:'undo-line',inventoryId:stock.inventory[0].id,units:2,missionId:'undo-mission',missionVersion:1,offerId:'undo-offer',offerVersion:1,paidAllocation:10000,refundAllocation:0,currency:'KRW',taxBasis:'included',evidenceRef:'line-check',source:'operator_attested'}});
 const lineId=linked.orderLines[0].id;
 await post('/api/growth/operations',{action:'record_operation',campaignId,campaignVersion:1,id:'undo-refund',inventoryVersion:linked.inventory[0].version,lineId,kind:'refund',quantity:1,evidenceRef:'refund-evidence',observedAt:new Date().toISOString()});
 const reasons=await (await page.request.get(`/api/growth/return-reasons?campaignId=${campaignId}`)).json(),e=reasons.events.find((x:{eventId:string})=>x.eventId==='undo-refund');
 await post('/api/growth/return-reasons',{campaignId,campaignVersion:1,eventId:'undo-refund',eventVersion:e.eventVersion,lineId,lineVersion:e.lineVersion,expectedVersion:0,requestId:randomUUID(),input:{reasonCode:'product_defect',evidenceRef:'case-undo'}});
 await post('/api/growth/decisions',{action:'save_decision',campaignId,campaignVersion:1,id:'undo-decision',expectedVersion:0,input:{...emptyDecisionInput(),title:'결함 대응 결정',missionId:'undo-mission',missionVersion:1}});
 const links=async()=>((await (await page.request.get(`/api/growth/cause-links?campaignId=${campaignId}`)).json()) as {records:{status:string;version:number}[]}).records;
 await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=growth`);
 await page.locator('summary').filter({hasText:/^반품 원인 → 개선 검토 연결$/}).click();
 const panel=page.getByRole('region',{name:'반품 원인 개선 연결',exact:true});await expect(panel).toBeVisible({timeout:5000});
 return {campaignId,panel,links};
}
test('원인 연결 알림의 되돌리기로 방금 만든 연결을 해제한다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'cause-link');
 try{
  const {panel,links}=await causeSeed(page,post,info.project.name);
  await panel.getByRole('combobox',{name:'원인 기록된 사건',exact:true}).selectOption('undo-refund');await panel.getByRole('combobox',{name:'검토 종류',exact:true}).selectOption('decision');await panel.getByRole('combobox',{name:'검토 기록',exact:true}).selectOption('undo-decision');
  await panel.getByRole('button',{name:'원인 연결',exact:true}).click();
  await expect(page.getByText('원인과 검토 기록을 연결했습니다.',{exact:true})).toBeVisible();expect(await links()).toMatchObject([{status:'active',version:1}]);
  await undo.click();
  await expect(page.getByText('원인 연결을 해제했습니다.',{exact:true})).toBeVisible();
  expect(await links()).toMatchObject([{status:'retired',version:2}]);await expect(panel.getByRole('button',{name:'undo-refund→undo-decision 해제',exact:true})).toHaveCount(0);
 }finally{await context.close()}
});
test('원인 연결 해제 알림의 되돌리기로 같은 연결을 다시 만든다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'cause-retire');
 try{
  const {campaignId,panel,links}=await causeSeed(page,post,info.project.name);
  await post('/api/growth/cause-links',{campaignId,campaignVersion:1,action:'link',expectedVersion:0,requestId:randomUUID(),input:{eventId:'undo-refund',reasonVersion:1,targetKind:'decision',targetId:'undo-decision',targetVersion:1,note:''}});
  await panel.getByRole('button',{name:'원인 연결 새로고침',exact:true}).click();
  await panel.getByRole('button',{name:'undo-refund→undo-decision 해제',exact:true}).click();
  await expect(page.getByText('원인 연결을 해제했습니다.',{exact:true})).toBeVisible();expect(await links()).toMatchObject([{status:'retired',version:2}]);
  await undo.click();
  await expect(page.getByText('해제한 원인 연결을 다시 연결했습니다.',{exact:true})).toBeVisible();
  expect(await links()).toMatchObject([{status:'active',version:3}]);await expect(panel.getByRole('button',{name:'undo-refund→undo-decision 해제',exact:true})).toBeVisible();
 }finally{await context.close()}
});
test('플레이스 할 일 완료 알림의 되돌리기로 할 일을 다시 연다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'place-task');
 try{
  await post('/api/feature-flags',{action:'set',flag:'a6_place_check',enabled:true});
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'플레이스 되돌리기 지점',address:'합성 주소',tradeArea:'residential',goal:'플레이스 대조'}});
  await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',storeId,key:'phone',value:'02-1234-5678',status:'confirmed',source:'합성 운영 확인',verifiedAt:new Date(Date.now()-86400000).toISOString(),validUntil:new Date(Date.now()+30*86400000).toISOString()}});
  await post('/api/place-checks',{action:'save_snapshot',storeId,platform:'naver_place',url:'https://map.naver.com/p/entry/place/1',checkedAt:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),fields:{phone:'02-9999-0000'}});
  const task=async()=>((await (await page.request.get('/api/place-checks?storeId='+encodeURIComponent(storeId))).json()) as {tasks:{title:string;status:string;source?:{field:string}}[]}).tasks.find(t=>t.source?.field==='phone')!;
  const opened=await task();expect(opened.status).toBe('open');
  await page.goto(`/?view=stores&brand=ofd&store=${encodeURIComponent(storeId)}&tab=channels`);
  const row=page.getByRole('region',{name:'플레이스 정보 대조',exact:true}).getByRole('listitem').filter({hasText:opened.title});
  await row.getByRole('textbox',{name:'완료 근거',exact:true}).fill('플레이스 전화번호 수정');
  await row.getByRole('button',{name:'완료 기록',exact:true}).click();
  await expect(page.getByText('할 일을 완료로 기록했습니다.',{exact:true})).toBeVisible();expect((await task()).status).toBe('done');
  await undo.click();
  await expect(page.getByText('할 일을 다시 열었습니다.',{exact:true})).toBeVisible();
  expect((await task()).status).toBe('open');await expect(row).toBeVisible();
 }finally{await context.close()}
});
test('매장 확인 기록 수정 알림의 되돌리기로 앞 내용을 다시 저장한다',async({browser},info)=>{
 const {context,page,post,undo}=await open(browser,info,'diagnostic');
 try{
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'확인 기록 되돌리기 지점',address:'합성 주소',tradeArea:'residential',goal:'확인 기록'}});
  await post('/api/store-operations',{action:'save_diagnostic',storeId,storeVersion:1,data:{key:'customer',status:'todo',observation:'점심 직장인 방문',evidence:'',checkedAt:'',nextAction:'저녁 방문 관찰',assignee:'처음 담당'}});
  const record=async()=>((await (await page.request.get(`/api/store-operations?storeId=${encodeURIComponent(storeId)}&part=diagnosis`)).json()) as {diagnostics:{key:string;assignee:string;version:number}[]}).diagnostics.find(d=>d.key==='customer');
  await page.goto(`/?view=stores&brand=ofd&store=${encodeURIComponent(storeId)}&tab=diagnosis`);
  await page.locator('article').filter({has:page.getByRole('heading',{name:'고객과 이용 상황',exact:true})}).getByRole('button',{name:'확인·기록',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'고객과 이용 상황'});
  await dialog.getByRole('textbox',{name:'담당자',exact:true}).fill('바꾼 담당');
  await dialog.getByRole('button',{name:'확인 기록 저장',exact:true}).click();
  await expect(page.getByText('매장 확인 기록을 저장했습니다.',{exact:true})).toBeVisible();expect(await record()).toMatchObject({assignee:'바꾼 담당',version:2});
  await undo.click();
  await expect(page.getByText('매장 확인 기록을 앞 내용으로 되돌렸습니다.',{exact:true})).toBeVisible();
  expect(await record()).toMatchObject({assignee:'처음 담당',version:3});
 }finally{await context.close()}
});
