import {seedCanonicalExpansion} from './canonical-expansion';
import {expect,type Browser,type TestInfo} from '@playwright/test';
// 핵심 8과제 준비 데이터(e2e/ux-tasks.spec.ts 마우스 하네스와 e2e/ux-keyboard-tasks.spec.ts 키보드 하네스가 함께 쓴다). 측정 밖에서 API·로컬 D1 fixture로 넣는다.
// Real local D1/API. 인증 헤더 mocked. 외부 호출·광고비 지출 없음.
// 과업마다 새 소유자·새 브라우저 문맥. prefix로 하네스별 소유자를 나눈다.
export async function taskContext(browser:Browser,info:TestInfo,prefix:string,n:number){
 const owner=`${prefix}-${n}-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
 const get=async(path:string)=>{const r=await page.request.get(path);expect(r.status(),await r.text()).toBe(200);return r.json()};
 await page.request.get('/api/workspace');
 return {owner,context,page,post,get,mobile:(page.viewportSize()?.width??1280)<768};
}
export type TaskContext=Awaited<ReturnType<typeof taskContext>>;
type Seed={owner:string;post:TaskContext['post']};
const store=(post:Seed['post'],name:string)=>post('/api/stores',{action:'save_store',brandId:'ofd',data:{name,address:'합성 주소',tradeArea:'residential',goal:'과업'}}) as Promise<{id:string}>;
const campaign=(post:Seed['post'],data:Record<string,unknown>)=>post('/api/action',{action:'save_campaign',data:{brandId:'ofd',...data}}) as Promise<{id:string}>;
const growthSave=(post:Seed['post'],campaignId:string)=>(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
// 과업 1: 최근 7일 주문이 늘어 '최근 7일 유료 주문 증가' 새 신호가 안건에 뜬다.
export async function seedTask1({post}:Seed,project:string){
 const {id:storeId}=await store(post,'과업1 합성 지점');
 const title=`과업1 ${project}`,{id:campaignId}=await campaign(post,{storeId,title,goal:'안건'});
 const day=(n:number)=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
 const order=(n:number,no:string)=>post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:no,orderDate:day(n),mode:'delivery',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인'}});
 for(let i=0;i<14;i++)await order(i%7,'R'+i);for(let i=0;i<21;i++)await order(7+i,'B'+i);
 await post('/api/growth/detections',{action:'detect',campaignId,campaignVersion:1});
 return {campaignId,title};
}
// 과업 2: 근거·니즈·확정 사실 하나가 있어 성장 탭이 빈 첫 단계(상품)에서 열린다.
export async function seedTask2({post}:Seed,project:string){
 const before=new Date(Date.now()-86400000).toISOString(),day=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 const {id:storeId}=await store(post,'과업2 합성 지점');
 const title=`과업2 ${project}`,{id:campaignId}=await campaign(post,{storeId,title,goal:'판매'});
 await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'과업 상품',value:'근거',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:new Date(Date.now()+30*86400000).toISOString()}});
 const save=growthSave(post,campaignId);
 await save('save_signal','t2-signal',{title:'근거',sourceUrl:'https://example.com/m',observedAt:before,expiresAt:day,sourceType:'market',summary:'관측',sampleSize:null});
 await save('save_need','t2-need',{title:'니즈',situation:'상황',desiredOutcome:'결과',alternative:'대안',barrier:'장애',counterEvidence:'반례',signalIds:['t2-signal'],deadline:day,nextAction:'검증',assignee:'담당'});
 return {campaignId,title};
}
// 과업 3: 약속 기한이 한 시간 지난 고객 문의 하나.
export async function seedTask3({post}:Seed,project:string){
 const {id:storeId}=await store(post,'과업3 합성 지점');
 const title=`과업3 ${project}`,{id:campaignId}=await campaign(post,{storeId,title,goal:'문의'});
 const now=Date.now(),id='cs-task3';
 await post('/api/growth/cs',{action:'save_ticket',id,expectedVersion:0,campaignId,campaignVersion:1,requestId:crypto.randomUUID(),input:{category:'shipping_delay',channel:'chat',summary:'배송 지연 문의, 출고 일정 안내 필요',lineId:'',receivedAt:new Date(now-5*3600000).toISOString(),promisedBy:new Date(now-3600000).toISOString(),assignee:'CS 담당',priority:'normal'}});
 return {campaignId,title,id};
}
// 과업 4: 확증된 실험 결과와 활성 위임이 있는 미션에 관리자가 올린 확대 제안 하나.
export async function seedTask4({owner,post}:Seed,project:string){
 const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString(),day=after.slice(0,10);
 const {id:storeId}=await store(post,'과업4 합성 지점');
 const title=`과업4 ${project}`,{id:campaignId}=await campaign(post,{storeId,title,goal:'확대'});
 const {id:factId}=await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'합성 상품',value:'근거',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:after}});
 const save=growthSave(post,campaignId);
 await save('save_signal','x-signal',{title:'근거',sourceUrl:'https://example.com/m',observedAt:before,expiresAt:day,sourceType:'market',summary:'관측',sampleSize:null});
 await save('save_need','x-need',{title:'니즈',situation:'상황',desiredOutcome:'결과',alternative:'대안',barrier:'장애',counterEvidence:'반례',signalIds:['x-signal'],deadline:day,nextAction:'검증',assignee:'담당'});
 await save('save_catalog','x-catalog',{sku:'X-SKU',title:'상품',price:100,unitCost:20,variableCost:10,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[factId],validUntil:day});
 await save('save_offer','x-offer',{title:'오퍼',catalogId:'x-catalog',catalogVersion:1,needId:'x-need',price:100,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'이유',priceApproved:true});
 await save('save_mission','x-mission',{title:'미션',offerId:'x-offer',offerVersion:1,assignee:'담당',deadline:day,nextAction:'판매',channel:'storefront',budget:1000,lossLimit:1000,stopRule:'한도',fulfillmentOwner:'배송'});
 await post('/api/growth/operations',{action:'create_inventory',campaignId,campaignVersion:1,input:{sku:'X-SKU',locationId:storeId,unit:'piece',onHand:50},observedAt:before,evidenceRef:'stock'});
 await post('/api/growth/authority',{action:'save_authority',id:'x-auth',campaignId,campaignVersion:1,expectedVersion:0,sign:true,input:{accountId:'acct',channel:'storefront',status:'active',maxTier:'T3',allowedActions:['publish','spend'],startsAt:before,expiresAt:after,periodStart:before,periodEnd:after,totalCap:10000,dayCap:10000,weekCap:10000,lossCap:10000}});
 await seedCanonicalExpansion({owner,campaignId,storeId,before,post});
 // 제안은 관리자가 API로 올린 상태로 둔다. 과업은 소유자의 승인·예약이다.
 const id='expansion-task4';
 await post('/api/growth/expansion',{action:'propose',id,expectedVersion:0,campaignId,campaignVersion:1,requestId:crypto.randomUUID(),input:{missionId:'x-mission',missionVersion:1,experimentId:'x-exp',analysisNumber:1,nextBudget:1200,addQuantity:10,rationale:'확증 개선'}});
 return {campaignId,title,id};
}
// 과업 5: 매장 없는 판매 캠페인 하나(Meta 준비 계획은 비어 있다).
export async function seedTask5({post}:Seed,project:string){
 const title=`과업5 ${project}`,{id:campaignId}=await campaign(post,{title,goal:'구매 전환 준비',budget:0});
 return {campaignId,title};
}
// 과업 6: 확정 사실에 근거한 상세페이지 수정안 하나가 승인 대기.
export async function seedTask6({post}:Seed,project:string){
 const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString(),day=after.slice(0,10);
 const {id:storeId}=await store(post,'과업6 합성 지점');
 const title=`과업6 ${project}`,{id:campaignId}=await campaign(post,{storeId,title,goal:'상세 개선'});
 const {id:factId}=await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'배송 조건',value:'평일 당일 출고',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:after}});
 const save=growthSave(post,campaignId);
 await save('save_catalog','landing-catalog',{sku:'LANDING-SKU',title:'상세 상품',price:12000,unitCost:4000,variableCost:1000,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송 조건',refunds:'반품 조건',rightsConfirmed:true,factIds:[factId],validUntil:day});
 await save('save_offer','landing-offer',{title:'상세 오퍼',catalogId:'landing-catalog',catalogVersion:1,needId:'',price:12000,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'준비 단축',priceApproved:true});
 const id='landing-task6';
 await post('/api/growth/landing',{action:'save_proposal',id,expectedVersion:0,campaignId,campaignVersion:1,requestId:crypto.randomUUID(),input:{title:'배송 불안 해소',offerId:'landing-offer',offerVersion:1,journeyId:'',journeyVersion:0,landingUrl:'https://example.com/buy',rationale:'배송 문의가 많음',rollbackPlan:'이전 문구 복구',sections:[{kind:'shipping',before:'',after:'평일 오후 2시 전 주문은 당일 출고',factIds:[factId]}]}});
 return {campaignId,title,id};
}
// 과업 7: 직전 주와 최근 7일(오늘 포함) 성과 기록 두 건. day(n)은 KST n일 전.
export async function seedTask7({post}:Seed,project:string){
 const title=`과업7 ${project}`,{id:campaignId}=await campaign(post,{title,goal:'주간 성과'});
 const day=(n:number)=>new Date(Date.now()-n*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
 for(const [from,to,revenue] of [[13,7,412000],[6,0,538000]] as const)await post('/api/action',{action:'save_metric',campaignId,schemaVersion:2,periodStart:day(from),periodEnd:day(to),scope:'전체 주문',source:'POS 정산서',definition:'KST 순매출',method:'export',revenue,orders:20,variableCosts:100000,adSpend:30000,productionCost:0});
 return {campaignId,title,day};
}
// 과업 8: 캠페인 하나(전역 중단 상태는 running).
export async function seedTask8({post}:Seed,project:string){
 const title=`과업8 ${project}`,{id:campaignId}=await campaign(post,{title,goal:'전역 중단'});
 return {campaignId,title};
}
