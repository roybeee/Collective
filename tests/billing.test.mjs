// G8 선불 크레딧 요금제 회귀(docs/BILLING.ko.md). 실제 SQLite(node:sqlite)·실제 라우트(/api/billing/*), 헤더(legacy) 인증, 합성 데이터.
// 순수 계산(부가세·환산·월별 소멸·알림·키 판정), 스위치 꺼짐(원장·가드·결제 없음), 원장·알림·잔액 0 정지(토큰 예산 가드 경유), 주문·승인 멱등·금액 불일치·테스트 키 강제·결과 미확인 재시도·환불.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더, 토스페이먼츠 fetch 스텁). 실제 결제·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let handler=async()=>{throw new Error('외부 호출 금지')};const calls=[];
const rt=testRuntime(async(url,init)=>{calls.push({url:String(url),init});return handler(url,init)});
const {sql,env}=rt;
const pure=await rt.load('lib/billing.ts'),server=await rt.load('lib/billing-server.ts'),flags=await rt.load('lib/feature-flags.ts'),budget=await rt.load('lib/token-budget.ts');
const registry=await rt.load('lib/record-kinds.ts'),core=await rt.load('lib/server.ts');
const summaryRoute=await rt.load('app/api/billing/route.ts'),checkoutRoute=await rt.load('app/api/billing/checkout/route.ts'),confirmRoute=await rt.load('app/api/billing/confirm/route.ts'),refundRoute=await rt.load('app/api/billing/refund/route.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const ORIGIN='https://agency.test',O='g8-owner';
const headers=(who=O,extra={})=>({'oai-authenticated-user-id':who,origin:ORIGIN,'content-type':'application/json',...extra});
const call=async res=>{const text=await res.text();let body=null;try{body=JSON.parse(text)}catch{body=text}return {status:res.status,body}};
const post=(route,path,data,who=O,extra={})=>route.POST(new Request(`${ORIGIN}${path}`,{method:'POST',headers:headers(who,extra),body:JSON.stringify(data)})).then(call);
const summary=(who=O)=>summaryRoute.GET(new Request(`${ORIGIN}/api/billing`,{headers:headers(who)})).then(call);
const by={id:O,email:null};
const ledgerRows=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='credit_ledger'").all(O).map(r=>JSON.parse(r.data));
const addUsage=(id,tokens,owner=O)=>sql.prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,'provider_usage','',?,?)").run(`${owner}:provider_usage:hermes:${id}`,owner,JSON.stringify({id,provider:'hermes',providerRunId:id,totalTokens:tokens,observedAt:new Date().toISOString()}),new Date().toISOString());
const order=id=>JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='billing_order' AND id=?").get(O,`${O}:billing_order:${id}`).data);

// 1) 순수 계산
check('VAT is added to the supply price and shown as a total',JSON.stringify(plain(pure.priceWithVat(10000)))===JSON.stringify({supplyKrw:10000,vatKrw:1000,totalKrw:11000})&&/부가세 포함/.test(pure.priceLabel(10000)));
check('tokens convert to credits by ceiling (1 credit = 1,000 tokens)',pure.creditsForTokens(0)===0&&pure.creditsForTokens(1)===1&&pure.creditsForTokens(1000)===1&&pure.creditsForTokens(1001)===2&&pure.TOKENS_PER_CREDIT===1000);
check('months between two KST months include both ends and reject reversed input',JSON.stringify(plain(pure.monthsBetween('2026-11','2027-01')))==='["2026-11","2026-12","2027-01"]'&&pure.monthsBetween('2027-01','2026-11').length===0);
check('KST month boundary: 2026-11-30T15:00Z is December in Korea',pure.kstMonthOf('2026-11-30T15:00:00.000Z')==='2026-12'&&pure.kstMonthOf('2026-11-30T14:59:59.000Z')==='2026-11');
const derived=plain(pure.monthlyEntries({startMonth:'2026-10',currentMonth:'2026-11',allowance:200,usageByMonth:{'2026-10':50_000,'2026-11':300_000},at:'2026-11-09T00:00:00.000Z'}));
check('past month: unused allowance expires, overuse does not expire anything',derived.find(e=>e.id==='expiry-2026-10').credits===-150&&!derived.some(e=>e.id==='expiry-2026-11')&&derived.find(e=>e.id==='usage-2026-11').credits===-300);
check('balance sums signed entries (grant 200 + 200, usage 50 + 300, expiry 150 → -100)',pure.balanceOf(derived)===-100);
check('stored grants are kept even if the plan constant differs',plain(pure.monthlyEntries({startMonth:'2026-11',currentMonth:'2026-11',allowance:999,usageByMonth:{},at:'x',grants:{'2026-11':200}}))[0].credits===200);
check('alerts fire at 80% and 100% of credits available this month',JSON.stringify(plain(pure.alertLevels(79,21)))==='[]'&&JSON.stringify(plain(pure.alertLevels(80,20)))==='[80]'&&JSON.stringify(plain(pure.alertLevels(10,0)))==='[80,100]'&&JSON.stringify(plain(pure.alertLevels(0,0)))==='[]');
check('secret key check: missing 503, test_ ok, live refused unless BILLING_LIVE=1',pure.checkSecretKey(undefined,undefined).status===503&&pure.checkSecretKey('test_sk_x',undefined).mode==='test'&&pure.checkSecretKey('live_sk_x',undefined).ok===false&&pure.checkSecretKey('live_sk_x','1').mode==='live'&&pure.checkSecretKey('live_sk_x','true').ok===false);
check('client key must match the secret key mode',pure.clientKeyFor('test_ck_1','test')==='test_ck_1'&&pure.clientKeyFor('live_ck_1','test')===null&&pure.clientKeyFor(undefined,'test')===null);
check('basic auth is base64 of "secret:"',pure.basicAuth('test_sk_abc')==='Basic '+Buffer.from('test_sk_abc:').toString('base64'));
check('orderId follows Toss rules (6~64, letters digits - _)',pure.isOrderId(pure.newOrderId(crypto.randomUUID()))&&!pure.isOrderId('abc')&&!pure.isOrderId('x'.repeat(65))&&!pure.isOrderId('order#1234'));
check('payment confirmation requires DONE, the same orderId and the same total',pure.confirmedPayment({status:'DONE',orderId:'col_1',totalAmount:11000},{orderId:'col_1',amountKrw:11000})&&!pure.confirmedPayment({status:'DONE',orderId:'col_1',totalAmount:10000},{orderId:'col_1',amountKrw:11000})&&!pure.confirmedPayment({status:'WAITING_FOR_DEPOSIT',orderId:'col_1',totalAmount:11000},{orderId:'col_1',amountKrw:11000}));
check('every price constant except Free is marked as a placeholder',pure.PLANS.filter(p=>p.id!=='free').every(p=>p.placeholder)&&pure.CREDIT_PACKS.every(p=>p.placeholder)&&pure.PRICE_PLACEHOLDER_NOTE==='가격 미정 — 대표 확정 필요'&&pure.PLANS[0].supplyKrw===0);

// 2) 등록
const kinds=plain(registry.recordKinds).map(k=>k.kind);
check('new record kinds are registered',['credit_ledger','billing_account','billing_order','billing_alert','workspace_origin','signup_consent'].every(k=>kinds.includes(k)));
check('both switches are known and off by default',flags.FEATURE_FLAGS.credit_billing?.defaultEnabled===false&&flags.FEATURE_FLAGS.self_signup?.defaultEnabled===false);

// 3) 스위치 꺼짐: 아무것도 바뀌지 않는다
let r=await summary();
check('switch off: summary shows the price table only and writes no ledger',r.status===200&&r.body.enabled===false&&r.body.balance===null&&r.body.plans.length===3&&ledgerRows().length===0);
check('switch off: the credit guard does nothing and writes nothing',await server.creditStop(core.database(),O)===null&&ledgerRows().length===0);
addUsage('before-billing',5_000_000);
const reserved=await budget.reserveDirectCall(core.database(),O,{submissionId:'off-1',campaignId:null,kind:'role',body:'{}'});
check('switch off: a large usage does not block AI runs',reserved.created===true);
r=await post(checkoutRoute,'/api/billing/checkout',{packId:'pack-1000'});
check('switch off: checkout is a 409 naming the switch',r.status===409&&/credit_billing/.test(r.body.error));

// 4) 스위치 켜짐: 원장·알림·정지
await flags.setFeatureFlag(O,{flag:'credit_billing',enabled:true},by);
r=await summary();
check('switch on: first sync grants the Free allowance; usage before billing started is not charged',r.body.enabled===true&&r.body.balance===200&&ledgerRows().some(e=>e.type==='grant'&&e.credits===200)&&r.body.monthUsed===0);
addUsage('run-1',170_000);
r=await summary();
check('usage maps to credits (170,000 tokens → 170, 85% used) and the 80% alert is recorded once',r.body.balance===30&&r.body.monthUsed===170&&r.body.alerts.length===1&&r.body.alerts[0].level===80);
await summary();
check('alerts are idempotent per month and level',sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='billing_alert'").get(O).n===1);
check('balance above zero lets AI runs through',await server.creditStop(core.database(),O)===null);
addUsage('run-2',60_000);
const stop=await server.creditStop(core.database(),O);
check('balance at or below zero stops new AI runs and records the 100% alert',stop===pure.CREDIT_STOP_MESSAGE&&sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='billing_alert'").get(O).n===2);
await assert.rejects(()=>budget.reserveDirectCall(core.database(),O,{submissionId:'on-1',campaignId:null,kind:'role',body:'{}'}),e=>e.status===409&&e instanceof budget.TokenBudgetExceeded&&/크레딧 잔액이 0/.test(e.message));
passed.push('the token budget reservation throws a definite 409 before sending anything');
check('no reservation row was written for the blocked run',!sql.prepare("SELECT 1 FROM records WHERE owner=? AND kind='token_reservation' AND id=?").get(O,`${O}:token_reservation:on-1`));
await flags.setFeatureFlag(O,{flag:'credit_billing',enabled:false},by);
check('turning the switch off releases the stop',(await budget.reserveDirectCall(core.database(),O,{submissionId:'off-2',campaignId:null,kind:'role',body:'{}'})).created===true);
await flags.setFeatureFlag(O,{flag:'credit_billing',enabled:true},by);

// 5) 결제: 키 강제
r=await post(checkoutRoute,'/api/billing/checkout',{packId:'pack-1000'});
check('no secret key: checkout refuses with 503 and creates no order',r.status===503&&/TOSS_PAYMENTS_SECRET_KEY/.test(r.body.error)&&!sql.prepare("SELECT 1 FROM records WHERE kind='billing_order'").get());
env.TOSS_PAYMENTS_SECRET_KEY='live_sk_dummy';
r=await post(checkoutRoute,'/api/billing/checkout',{packId:'pack-1000'});
check('a non-test key is refused without BILLING_LIVE=1',r.status===503&&/BILLING_LIVE/.test(r.body.error));
env.TOSS_PAYMENTS_SECRET_KEY='test_sk_dummy_key';env.TOSS_PAYMENTS_CLIENT_KEY='test_ck_dummy_key';
r=await post(checkoutRoute,'/api/billing/checkout',{packId:'nope'});
check('unknown pack is a 400',r.status===400);
r=await post(checkoutRoute,'/api/billing/checkout',{packId:'pack-1000'},O,{origin:'https://evil.test'});
check('foreign origin is a 403',r.status===403);
r=await post(checkoutRoute,'/api/billing/checkout',{packId:'pack-1000'});
const first=r.body.order;
check('checkout creates a pending order with the VAT-inclusive server amount and returns the test client key',r.status===200&&first.amountKrw===11000&&first.vatKrw===1000&&first.credits===1000&&first.status==='pending'&&r.body.clientKey==='test_ck_dummy_key'&&first.paymentKey===undefined&&first.createdBy===undefined&&order(first.orderId).mode==='test');

// 6) 승인
const before=calls.length;
r=await post(confirmRoute,'/api/billing/confirm',{paymentKey:'pk_test_1',orderId:first.orderId,amount:1000});
check('amount mismatch is a 400 and Toss is not called',r.status===400&&calls.length===before&&order(first.orderId).status==='pending');
handler=async()=>new Response(JSON.stringify({code:'PROVIDER_ERROR'}),{status:500});
r=await post(confirmRoute,'/api/billing/confirm',{paymentKey:'pk_test_1',orderId:first.orderId,amount:11000});
check('a 5xx leaves the order unknown (no ledger entry) and asks to retry',r.status===502&&order(first.orderId).status==='unknown'&&!ledgerRows().some(e=>e.type==='purchase'));
handler=async(url,init)=>new Response(JSON.stringify({status:'DONE',orderId:JSON.parse(init.body).orderId,totalAmount:JSON.parse(init.body).amount,paymentKey:'pk_test_1'}),{status:200});
const balanceBefore=(await summary()).body.balance;
r=await post(confirmRoute,'/api/billing/confirm',{paymentKey:'pk_test_1',orderId:first.orderId,amount:11000});
const last=calls.at(-1);
check('retry after unknown confirms with Basic auth, the Toss confirm URL and an idempotency key',r.status===200&&r.body.order.status==='paid'&&last.url==='https://api.tosspayments.com/v1/payments/confirm'&&last.init.headers.Authorization==='Basic '+Buffer.from('test_sk_dummy_key:').toString('base64')&&last.init.headers['Idempotency-Key']===`confirm-${first.orderId}`&&JSON.stringify(JSON.parse(last.init.body))===JSON.stringify({paymentKey:'pk_test_1',orderId:first.orderId,amount:11000}));
check('a purchase ledger entry adds the credits once',(await summary()).body.balance===balanceBefore+1000&&ledgerRows().filter(e=>e.type==='purchase').length===1);
const n=calls.length;
r=await post(confirmRoute,'/api/billing/confirm',{paymentKey:'pk_test_1',orderId:first.orderId,amount:11000});
check('confirming again is idempotent: same result, no second Toss call, no second entry',r.status===200&&r.body.duplicate===true&&calls.length===n&&ledgerRows().filter(e=>e.type==='purchase').length===1);
r=await post(confirmRoute,'/api/billing/confirm',{paymentKey:'pk_other',orderId:first.orderId,amount:11000});
check('a different paymentKey on a paid order is a 409',r.status===409);
r=await post(confirmRoute,'/api/billing/confirm',{paymentKey:'pk_x',orderId:'col_missing_order',amount:11000});
check('unknown order is a 404',r.status===404);
const second=(await post(checkoutRoute,'/api/billing/checkout',{packId:'pack-1000'})).body.order;
let release;const gate=new Promise(res=>{release=res});
handler=async(url,init)=>{await gate;return new Response(JSON.stringify({status:'DONE',orderId:JSON.parse(init.body).orderId,totalAmount:11000}),{status:200})};
const racing=[post(confirmRoute,'/api/billing/confirm',{paymentKey:'pk_race',orderId:second.orderId,amount:11000}),post(confirmRoute,'/api/billing/confirm',{paymentKey:'pk_race',orderId:second.orderId,amount:11000})];
await new Promise(res=>setTimeout(res,20));release();
const raced=await Promise.all(racing);
check('concurrent confirms: one wins, the other is a 409 or a duplicate, credits added once',raced.filter(x=>x.status===200).length>=1&&raced.every(x=>x.status===200||x.status===409)&&ledgerRows().filter(e=>e.type==='purchase'&&e.orderId===second.orderId).length===1);
const third=(await post(checkoutRoute,'/api/billing/checkout',{packId:'pack-1000'})).body.order;
handler=async()=>new Response(JSON.stringify({code:'REJECT_CARD_COMPANY'}),{status:400});
r=await post(confirmRoute,'/api/billing/confirm',{paymentKey:'pk_rej',orderId:third.orderId,amount:11000});
check('a definite rejection marks the order failed without credits',r.status===402&&order(third.orderId).status==='failed'&&order(third.orderId).failure==='REJECT_CARD_COMPANY');

// 7) 환불
handler=async()=>new Response(JSON.stringify({status:'CANCELED'}),{status:200});
const balanceBeforeRefund=(await summary()).body.balance;
r=await post(refundRoute,'/api/billing/refund',{orderId:second.orderId});
check('refund of unused credits cancels the payment and adds a refund entry',r.status===200&&r.body.manual===false&&calls.at(-1).url===`https://api.tosspayments.com/v1/payments/pk_race/cancel`&&calls.at(-1).init.headers['Idempotency-Key']===`refund-${second.orderId}`&&(await summary()).body.balance===balanceBeforeRefund-1000&&order(second.orderId).status==='refunded');
r=await post(refundRoute,'/api/billing/refund',{orderId:second.orderId});
check('refunding twice is idempotent',r.status===200&&r.body.duplicate===true&&ledgerRows().filter(e=>e.type==='refund').length===1);
addUsage('run-3',2_000_000);
const m=calls.length;
r=await post(refundRoute,'/api/billing/refund',{orderId:first.orderId});
check('refund after the credits were used is accepted as a manual request, not blocked, no Toss call',r.status===200&&r.body.manual===true&&calls.length===m&&order(first.orderId).status==='refund_requested');
r=await post(refundRoute,'/api/billing/refund',{orderId:third.orderId});
check('refund of a failed order is a 409',r.status===409);
const view=(await summary()).body;
check('the summary hides payment keys and buyer accounts',view.orders.length>=3&&view.orders.every(o=>o.paymentKey===undefined&&o.createdBy===undefined)&&view.canPurchase===true&&view.mode==='test');
env.TOSS_PAYMENTS_SECRET_KEY=undefined;env.TOSS_PAYMENTS_CLIENT_KEY=undefined;

// 8) 플랫폼 스위치: 계정이 있으면 운영자 워크스페이스 값을 읽고, 운영자 워크스페이스는 정지하지 않는다
const now=Date.now();
sql.prepare("INSERT INTO auth_users(id,email,password_hash,workspace_owner,role,status,created_at) VALUES('op','op@example.test',NULL,'operator-ws','admin','active',?)").run(now);
sql.prepare("INSERT INTO auth_users(id,email,password_hash,workspace_owner,role,status,created_at) VALUES('self','self@example.test',NULL,'self','admin','active',?)").run(now+1);
check('the operator is the first admin account workspace',await server.operatorOwner(core.database())==='operator-ws');
check('a workspace switch alone does not enable billing when the operator switch is off',await server.creditBillingEnabled(core.database(),'self')===false&&await server.creditStop(core.database(),'self')===null);
await flags.setFeatureFlag('operator-ws',{flag:'credit_billing',enabled:true},{id:'op',email:null});
addUsage('self-run',1_000_000,'self');
await flags.setFeatureFlag('self',{flag:'credit_billing',enabled:false},{id:'self',email:null});
// 과금 시작 뒤 사용량을 세도록 먼저 동기화한 다음 다시 사용량을 넣는다.
await server.syncLedger(core.database(),'self');addUsage('self-run-2',1_000_000,'self');
check('a self-signup owner cannot turn the stop off in its own workspace',await server.creditStop(core.database(),'self')===pure.CREDIT_STOP_MESSAGE);
addUsage('op-run',9_000_000,'operator-ws');
check('the operator workspace is never stopped',await server.creditStop(core.database(),'operator-ws')===null);

console.log(JSON.stringify({passed:passed.length}));
