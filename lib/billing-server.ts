// 선불 크레딧 요금제 서버(G8, docs/BILLING.ko.md). 원장 동기화·잔액·사용량 알림·AI 실행 정지 가드·테스트 결제(토스페이먼츠) 주문·승인·환불.
// 스위치 credit_billing(기본 꺼짐)은 플랫폼 스위치다: 운영자 워크스페이스(가장 먼저 만든 관리자 계정의 workspace_owner, 계정이 없으면 요청 워크스페이스)의 값을 읽는다.
// 셀프 가입 워크스페이스 소유자가 자기 워크스페이스에서 끄더라도 정지 가드를 벗어나지 못하게 하려는 것이다. 꺼져 있으면 원장을 만들지 않고 가드는 아무것도 하지 않는다.
// 저장: records kind credit_ledger(원장 항목, id=항목 id), billing_account(과금 시작 시각 1행), billing_order(주문, id=orderId), billing_alert(월·단계당 1행 알림).
// 외부 호출: 토스페이먼츠 결제 승인 POST /v1/payments/confirm, 결제 취소 POST /v1/payments/{paymentKey}/cancel. 시크릿 키가 test_로 시작하지 않으면 BILLING_LIVE=1 없이는 부르지 않는다.
import {env} from 'cloudflare:workers';
import {ApiError,str,stamp,uid,type Actor} from './server';
import {isEnabled,type FeatureFlag} from './feature-flags';
import {CREDIT_PACKS,CREDIT_STOP_MESSAGE,CURRENT_PLAN,PLANS,PRICE_PLACEHOLDER_NOTE,TOKENS_PER_CREDIT,alertLevels,alertText,balanceOf,basicAuth,checkSecretKey,clientKeyFor,confirmedPayment,isOrderId,isPaymentKey,kstMonthOf,monthlyEntries,newOrderId,packOf,planOf,priceWithVat,signedCredits,type BillingOrder,type LedgerEntry,type OrderStatus} from './billing';

type Db=D1Database;
const billingEnv=env as unknown as {TOSS_PAYMENTS_SECRET_KEY?:string;TOSS_PAYMENTS_CLIENT_KEY?:string;BILLING_LIVE?:string};
const TOSS_API='https://api.tosspayments.com/v1/payments';
const rid=(owner:string,kind:string,id:string)=>`${owner}:${kind}:${id}`;
const upsert=(db:Db,owner:string,kind:string,id:string,data:unknown,ignore=false)=>db.prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO ${ignore?'NOTHING':'UPDATE SET data=excluded.data,updated_at=excluded.updated_at'}`).bind(rid(owner,kind,id),owner,kind,'',JSON.stringify(data),stamp());

// 운영자 워크스페이스: 가장 먼저 만든 관리자 계정(bootstrap)의 workspace_owner. 계정이 하나도 없으면(legacy) 요청 워크스페이스를 쓴다.
export async function operatorOwner(db:Db){
 const row=await db.prepare("SELECT workspace_owner AS owner FROM auth_users WHERE role='admin' ORDER BY created_at,id LIMIT 1").first<{owner:string}>();
 return row?.owner??null;
}
export async function platformFlag(db:Db,flag:FeatureFlag,fallbackOwner:string|null){
 const operator=await operatorOwner(db)??fallbackOwner;
 return operator?isEnabled(operator,flag):false;
}
export const creditBillingEnabled=(db:Db,owner:string)=>platformFlag(db,'credit_billing',owner);
const requireEnabled=async(db:Db,owner:string)=>{if(!await creditBillingEnabled(db,owner))throw new ApiError(409,'크레딧 요금제(기능 스위치 credit_billing)가 꺼져 있습니다. 운영자 워크스페이스 소유자가 켭니다.')};

// 과금 시작 시각. 처음 동기화할 때 한 번 정하고 바꾸지 않는다. 이 시각 전의 AI 사용은 크레딧에서 빼지 않는다.
async function billingStart(db:Db,owner:string,now:Date){
 await upsert(db,owner,'billing_account','current',{startedAt:now.toISOString(),plan:CURRENT_PLAN},true).run();
 const row=await db.prepare("SELECT json_extract(data,'$.startedAt') AS startedAt FROM records WHERE id=? AND owner=? AND kind='billing_account'").bind(rid(owner,'billing_account','current'),owner).first<{startedAt:string}>();
 return row?.startedAt??now.toISOString();
}
// 과금 시작 뒤 한국 시간 월별 보고 토큰 합계(총 토큰을 모르면 입력+출력, 둘 다 모르면 빼고 셈한다. lib/token-budget.ts와 같은 규칙).
async function usageByMonth(db:Db,owner:string,since:string){
 const t="COALESCE(json_extract(data,'$.totalTokens'),json_extract(data,'$.inputTokens')+json_extract(data,'$.outputTokens'))";
 const rows=await db.prepare(`SELECT strftime('%Y-%m',json_extract(data,'$.observedAt'),'+9 hours') AS month,COALESCE(SUM(${t}),0) AS tokens FROM records WHERE owner=? AND kind='provider_usage' AND json_extract(data,'$.observedAt')>=? GROUP BY month`).bind(owner,since).all<{month:string;tokens:number}>();
 return Object.fromEntries(rows.results.filter(r=>r.month).map(r=>[r.month,Number(r.tokens)||0]));
}
export async function listLedger(db:Db,owner:string){
 const rows=await db.prepare("SELECT data FROM records WHERE owner=? AND kind='credit_ledger' ORDER BY json_extract(data,'$.at') DESC,id DESC").bind(owner).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as LedgerEntry);
}
// 월별 기본 제공·사용·소멸 항목을 다시 계산해 같은 id로 덮어쓴다(멱등). 기본 제공량은 처음 기록한 값을 유지한다.
export async function syncLedger(db:Db,owner:string,now=new Date()){
 const startedAt=await billingStart(db,owner,now),at=now.toISOString(),existing=await listLedger(db,owner);
 const grants=Object.fromEntries(existing.filter(e=>e.type==='grant'&&e.month).map(e=>[e.month!,e.credits]));
 const derived=monthlyEntries({startMonth:kstMonthOf(startedAt),currentMonth:kstMonthOf(now),allowance:planOf(CURRENT_PLAN).monthlyCredits,usageByMonth:await usageByMonth(db,owner,startedAt),at,grants});
 const changed=derived.filter(e=>{const old=existing.find(x=>x.id===e.id);return !old||old.credits!==e.credits||(old.tokens??null)!==(e.tokens??null)});
 if(changed.length)await db.batch(changed.map(e=>upsert(db,owner,'credit_ledger',e.id,e,e.type==='grant')));
 const ledger=changed.length?await listLedger(db,owner):existing,month=kstMonthOf(now);
 return {ledger,balance:balanceOf(ledger),month,monthUsed:-(ledger.find(e=>e.id===`usage-${month}`)?.credits??0),startedAt};
}
// 80%·100% 알림을 월·단계당 1행만 남긴다(이미 있으면 그대로). 오늘의 안건 화면 연결은 docs/BILLING.ko.md '남은 일'.
async function recordAlerts(db:Db,owner:string,month:string,monthUsed:number,balance:number){
 const levels=alertLevels(monthUsed,balance);
 if(levels.length)await db.batch(levels.map(level=>upsert(db,owner,'billing_alert',`${month}-${level}`,{id:`${month}-${level}`,month,level,kind:'signal',title:level===100?'크레딧 모두 사용':'크레딧 80% 사용',detail:alertText(level,month),createdAt:stamp()},true)));
 return levels;
}
export async function listAlerts(db:Db,owner:string){
 const rows=await db.prepare("SELECT data FROM records WHERE owner=? AND kind='billing_alert' ORDER BY updated_at DESC LIMIT 12").bind(owner).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as Record<string,unknown>);
}

// AI 실행 직전 가드(lib/token-budget.ts reserve가 부른다). 꺼져 있으면 null. 운영자 워크스페이스(이메일 모드에서 계정으로 정해진 경우)는 정지하지 않는다.
// 켜져 있으면 원장을 동기화하고 알림을 남긴 뒤 잔액이 0 이하이면 정지 문구를 돌려준다(호출부가 409로 던지고 아무것도 보내지 않는다).
export async function creditStop(db:Db,owner:string,now=new Date()):Promise<string|null>{
 const operator=await operatorOwner(db);
 if(!await isEnabled(operator??owner,'credit_billing'))return null;
 if(operator===owner)return null;
 const {balance,month,monthUsed}=await syncLedger(db,owner,now);
 await recordAlerts(db,owner,month,monthUsed,balance);
 return balance<=0?CREDIT_STOP_MESSAGE:null;
}

const listOrders=async(db:Db,owner:string)=>(await db.prepare("SELECT data FROM records WHERE owner=? AND kind='billing_order' ORDER BY json_extract(data,'$.createdAt') DESC LIMIT 20").bind(owner).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as BillingOrder);
// 화면에는 결제 키와 주문자 계정을 보내지 않는다.
const publicOrder=(order:BillingOrder)=>Object.fromEntries(Object.entries(order).filter(([k])=>k!=='paymentKey'&&k!=='createdBy')) as Omit<BillingOrder,'paymentKey'|'createdBy'>;
// 화면 요약. 꺼져 있으면 원장을 만들지 않고 요금제·상품 표만 돌려준다.
export async function billingSummary(db:Db,who:Actor,now=new Date()){
 const enabled=await creditBillingEnabled(db,who.owner);
 const catalog={plans:PLANS.map(p=>({...p,price:priceWithVat(p.supplyKrw)})),packs:CREDIT_PACKS.map(p=>({...p,price:priceWithVat(p.supplyKrw)})),currentPlan:CURRENT_PLAN,tokensPerCredit:TOKENS_PER_CREDIT,priceNote:PRICE_PLACEHOLDER_NOTE};
 if(!enabled)return {enabled,...catalog,balance:null,month:kstMonthOf(now),monthUsed:null,ledger:[],orders:[],alerts:[],mode:null,canPurchase:false};
 const sync=await syncLedger(db,who.owner,now);
 await recordAlerts(db,who.owner,sync.month,sync.monthUsed,sync.balance);
 const key=checkSecretKey(billingEnv.TOSS_PAYMENTS_SECRET_KEY,billingEnv.BILLING_LIVE);
 return {enabled,...catalog,balance:sync.balance,month:sync.month,monthUsed:sync.monthUsed,startedAt:sync.startedAt,ledger:sync.ledger.slice(0,50),orders:(await listOrders(db,who.owner)).map(publicOrder),alerts:await listAlerts(db,who.owner),mode:key.ok?key.mode:null,canPurchase:who.role==='owner'};
}

async function readOrder(db:Db,owner:string,orderId:unknown){
 if(!isOrderId(orderId))throw new ApiError(400,'주문 번호를 확인해 주세요.');
 const row=await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='billing_order'").bind(rid(owner,'billing_order',orderId),owner).first<{data:string}>();
 if(!row)throw new ApiError(404,'주문을 찾을 수 없습니다.');
 return JSON.parse(row.data) as BillingOrder;
}
// 주문 상태 전이. from 상태일 때만 바꾼다(동시 요청 중 하나만 이긴다). 바뀌었는지 돌려준다.
function transition(db:Db,owner:string,next:BillingOrder,from:readonly OrderStatus[]){
 return db.prepare(`UPDATE records SET data=?,updated_at=? WHERE id=? AND owner=? AND kind='billing_order' AND json_extract(data,'$.status') IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(next),next.updatedAt,rid(owner,'billing_order',next.orderId),owner,JSON.stringify(from));
}
function secretKey(){const key=checkSecretKey(billingEnv.TOSS_PAYMENTS_SECRET_KEY,billingEnv.BILLING_LIVE);if(!key.ok)throw new ApiError(key.status,key.message);return {key:billingEnv.TOSS_PAYMENTS_SECRET_KEY!,mode:key.mode}}

// 주문 만들기(소유자). 금액은 서버 상수에서 계산한 부가세 포함 총액이고, 승인 때 이 금액과 다르면 거절한다.
export async function createCheckout(db:Db,who:Actor,input:Record<string,unknown>){
 await requireEnabled(db,who.owner);
 const pack=packOf(input.packId);if(!pack)throw new ApiError(400,'충전 상품을 확인해 주세요.');
 const {mode}=secretKey(),price=priceWithVat(pack.supplyKrw),at=stamp();
 const order:BillingOrder={orderId:newOrderId(uid()),packId:pack.id,orderName:`COLLECTIVE ${pack.name}`,credits:pack.credits,supplyKrw:price.supplyKrw,vatKrw:price.vatKrw,amountKrw:price.totalKrw,status:'pending',mode,createdAt:at,createdBy:{id:who.id,email:who.email},updatedAt:at};
 await upsert(db,who.owner,'billing_order',order.orderId,order,true).run();
 return {order:publicOrder(order),clientKey:clientKeyFor(billingEnv.TOSS_PAYMENTS_CLIENT_KEY,mode),customerKey:'ANONYMOUS'};
}

type TossResult={ok:true;body:unknown}|{ok:false;definite:boolean;code:string};
async function callToss(path:string,secret:string,idempotencyKey:string,payload:Record<string,unknown>):Promise<TossResult>{
 try{
  const response=await fetch(`${TOSS_API}${path}`,{method:'POST',headers:{Authorization:basicAuth(secret),'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(15_000)});
  const body:unknown=await response.json().catch(()=>null);
  if(response.ok)return {ok:true,body};
  const code=body&&typeof body==='object'&&typeof (body as {code?:unknown}).code==='string'?String((body as {code:string}).code).slice(0,80):`HTTP_${response.status}`;
  // 4xx(429 제외)는 확정 거절, 429·5xx는 결과 미확인이다.
  return {ok:false,definite:response.status>=400&&response.status<500&&response.status!==429,code};
 }catch{return {ok:false,definite:false,code:'NETWORK'}}
}

// 결제 승인(소유자). 멱등: 이미 같은 paymentKey로 승인된 주문은 토스를 다시 부르지 않고 같은 결과를 준다. 금액이 주문과 다르면 부르지 않고 400.
export async function confirmPayment(db:Db,who:Actor,input:Record<string,unknown>){
 await requireEnabled(db,who.owner);
 if(!isPaymentKey(input.paymentKey))throw new ApiError(400,'결제 키를 확인해 주세요.');
 const order=await readOrder(db,who.owner,input.orderId),paymentKey=input.paymentKey;
 if(order.status==='paid'||order.status==='refunded'||order.status==='refund_requested'||order.status==='refunding'||order.status==='refund_unknown'){
  if(order.paymentKey===paymentKey)return {order:publicOrder(order),duplicate:true};
  throw new ApiError(409,'이미 다른 결제로 처리된 주문입니다.');
 }
 if(input.amount!==order.amountKrw)throw new ApiError(400,`결제 금액이 주문 금액(${order.amountKrw.toLocaleString('ko-KR')}원)과 다릅니다. 결제를 승인하지 않았습니다.`);
 if(order.status==='failed')throw new ApiError(409,'실패한 주문입니다. 새로 주문해 주세요.');
 const {key}=secretKey(),claimed:BillingOrder={...order,status:'confirming',paymentKey,updatedAt:stamp()};
 if(!(await transition(db,who.owner,claimed,['pending','unknown']).run()).meta.changes)throw new ApiError(409,'승인을 처리하고 있습니다. 잠시 후 다시 확인해 주세요.');
 const result=await callToss('/confirm',key,`confirm-${order.orderId}`,{paymentKey,orderId:order.orderId,amount:order.amountKrw});
 if(result.ok&&confirmedPayment(result.body,order)){
  const at=stamp(),paid:BillingOrder={...claimed,status:'paid',approvedAt:at,updatedAt:at};
  const entry:LedgerEntry={id:`purchase-${order.orderId}`,type:'purchase',credits:signedCredits('purchase',order.credits),month:kstMonthOf(at),at,orderId:order.orderId,amountKrw:order.amountKrw};
  await db.batch([transition(db,who.owner,paid,['confirming']),upsert(db,who.owner,'credit_ledger',entry.id,entry,true)]);
  return {order:publicOrder(paid),duplicate:false};
 }
 const definite=result.ok||result.definite,next:BillingOrder={...claimed,status:definite?'failed':'unknown',failure:result.ok?'RESPONSE_MISMATCH':result.code,updatedAt:stamp()};
 await transition(db,who.owner,next,['confirming']).run();
 throw new ApiError(definite?402:502,definite?'결제가 승인되지 않았습니다. 청구되지 않았는지 카드사·토스 결제 내역에서 확인해 주세요.':'결제 승인 결과를 확인하지 못했습니다. 같은 화면에서 다시 확인을 누르면 중복 결제 없이 다시 확인합니다.');
}

// 환불 요청(소유자). 구매만큼 크레딧이 남아 있으면(미사용) 바로 결제를 취소하고 환불 항목을 남긴다.
// 일부를 이미 썼으면 막지 않고 '환불 요청 접수'로 남겨 담당자가 확인한다(환불 정책은 docs/BILLING.ko.md, 대표 확정 필요).
export async function requestRefund(db:Db,who:Actor,input:Record<string,unknown>){
 await requireEnabled(db,who.owner);
 const order=await readOrder(db,who.owner,input.orderId),reason=str(input.reason??'',"환불 사유",200)||'고객 요청';
 if(order.status==='refunded'||order.status==='refund_requested')return {order:publicOrder(order),duplicate:true};
 if(order.status!=='paid'&&order.status!=='refund_unknown')throw new ApiError(409,'결제 완료된 주문만 환불할 수 있습니다.');
 const {balance}=await syncLedger(db,who.owner);
 if(balance<order.credits){
  const requested:BillingOrder={...order,status:'refund_requested',refundReason:reason,updatedAt:stamp()};
  await transition(db,who.owner,requested,['paid','refund_unknown']).run();
  return {order:publicOrder(requested),duplicate:false,manual:true};
 }
 const {key}=secretKey(),claimed:BillingOrder={...order,status:'refunding',refundReason:reason,updatedAt:stamp()};
 if(!(await transition(db,who.owner,claimed,['paid','refund_unknown']).run()).meta.changes)throw new ApiError(409,'환불을 처리하고 있습니다. 잠시 후 다시 확인해 주세요.');
 const result=await callToss(`/${encodeURIComponent(order.paymentKey??'')}/cancel`,key,`refund-${order.orderId}`,{cancelReason:reason});
 if(result.ok){
  const at=stamp(),refunded:BillingOrder={...claimed,status:'refunded',refundedAt:at,updatedAt:at};
  const entry:LedgerEntry={id:`refund-${order.orderId}`,type:'refund',credits:signedCredits('refund',order.credits),month:kstMonthOf(at),at,orderId:order.orderId,amountKrw:order.amountKrw};
  await db.batch([transition(db,who.owner,refunded,['refunding']),upsert(db,who.owner,'credit_ledger',entry.id,entry,true)]);
  return {order:publicOrder(refunded),duplicate:false,manual:false};
 }
 const next:BillingOrder={...claimed,status:result.definite?'paid':'refund_unknown',failure:result.code,updatedAt:stamp()};
 await transition(db,who.owner,next,['refunding']).run();
 throw new ApiError(result.definite?409:502,result.definite?'결제 취소가 거절됐습니다. 담당자에게 문의해 주세요.':'환불 결과를 확인하지 못했습니다. 다시 누르면 중복 환불 없이 다시 확인합니다.');
}

