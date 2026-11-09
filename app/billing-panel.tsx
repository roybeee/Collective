'use client';
// 선불 크레딧 요금제 카드(G8, 설정 → 사용량·비용 탭에서 내려받는다). 현재 요금제·잔액·원장·주문·알림과 크레딧 충전(토스페이먼츠 테스트 결제)·환불 요청.
// 다크패턴 점검(tests/billing-dark-patterns.test.mjs): 가격은 처음부터 부가세 포함 총액으로 보이고, 미리 고른 선택지가 없으며, 구매가 있는 곳에는 같은 크기의 환불 요청이 있다.
// 충전은 한 번 결제로 끝난다(자동 갱신·자동 결제 없음). 토스 결제창 스크립트는 이 카드에서 구매를 누를 때만 불러온다(https://js.tosspayments.com/v2/standard).
import {useCallback,useEffect,useState} from 'react';
import {Coins,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {krw,ledgerLabels,orderStatusLabels,type BillingOrder,type LedgerEntry} from '@/lib/billing';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {canChange,useAccount} from './account-context';

type Price={supplyKrw:number;vatKrw:number;totalKrw:number};
type PlanView={id:string;name:string;monthlyCredits:number;placeholder:boolean;summary:string;price:Price};
type PackView={id:string;name:string;credits:number;placeholder:boolean;price:Price};
type Alert={id:string;title:string;detail:string;level:number};
type Summary={enabled:boolean;plans:PlanView[];packs:PackView[];currentPlan:string;tokensPerCredit:number;priceNote:string;balance:number|null;month:string;monthUsed:number|null;ledger:LedgerEntry[];orders:Omit<BillingOrder,'paymentKey'|'createdBy'>[];alerts:Alert[];mode:'test'|'live'|null;canPurchase:boolean};
type Checkout={order:{orderId:string;orderName:string;amountKrw:number};clientKey:string|null;customerKey:string};
type TossPayment={requestPayment:(input:Record<string,unknown>)=>Promise<void>};
type TossFactory=((clientKey:string)=>{payment:(input:{customerKey:string})=>TossPayment})&{ANONYMOUS?:string};
const TOSS_SDK='https://js.tosspayments.com/v2/standard';

async function call<T>(path:string,input?:Record<string,unknown>):Promise<T>{
 const response=await fetch(path,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',...(input?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});
 const data=await response.json().catch(()=>null) as (T&{error?:string})|null;
 if(!response.ok||!data)throw new Error(data?.error||'요청을 처리하지 못했습니다. 다시 시도해 주세요.');
 return data;
}
// 가격 표기: 총액(부가세 포함)을 먼저, 공급가와 부가세를 함께 적는다. 0원은 0원으로만 적는다.
const priceText=(p:Price)=>p.totalKrw===0?'0원':`${krw(p.totalKrw)} (부가세 포함, 공급가 ${krw(p.supplyKrw)} + 부가세 ${krw(p.vatKrw)})`;
function loadToss():Promise<TossFactory>{
 const existing=(window as unknown as {TossPayments?:TossFactory}).TossPayments;
 if(existing)return Promise.resolve(existing);
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=TOSS_SDK;script.async=true;
  script.onload=()=>{const f=(window as unknown as {TossPayments?:TossFactory}).TossPayments;if(f)resolve(f);else reject(new Error('결제창을 불러오지 못했습니다.'))};
  script.onerror=()=>reject(new Error('결제창 스크립트를 불러오지 못했습니다. 네트워크를 확인해 주세요.'));
  document.head.appendChild(script);
 });
}
// 토스 결제창에서 돌아온 주소(?billing=success&paymentKey&orderId&amount 또는 ?billing=fail&code&message)를 읽고 지운다.
function readReturn(){
 const params=new URLSearchParams(window.location.search),state=params.get('billing');
 if(state!=='success'&&state!=='fail')return null;
 const out={state,paymentKey:params.get('paymentKey')||'',orderId:params.get('orderId')||'',amount:Number(params.get('amount')),message:params.get('message')||''};
 for(const k of ['billing','paymentKey','orderId','amount','code','message','paymentType'])params.delete(k);
 const query=params.toString();history.replaceState(history.state,'',location.pathname+(query?'?'+query:''));
 return out;
}

export function BillingPanel(){
 const owner=canChange(useAccount(),true);
 const [data,setData]=useState<Summary|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{try{setData(await call<Summary>('/api/billing'));setError('')}catch(e){setError(e instanceof Error?e.message:'요금제를 불러오지 못했습니다.')}},[]);
 const run=useCallback(async(task:()=>Promise<string>)=>{setBusy(true);setError('');setNotice('');try{setNotice(await task())}catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.')}finally{setBusy(false);await refresh()}},[refresh]);
 useEffect(()=>{
  const back=readReturn();let gone=false;
  // 결제창에서 돌아왔으면 승인을 확인한 뒤 요약을 다시 읽는다. 상태는 응답을 받은 뒤에만 바꾼다.
  const confirmed=back?.state==='success'?call('/api/billing/confirm',{paymentKey:back.paymentKey,orderId:back.orderId,amount:back.amount}).then(()=>{if(!gone)setNotice('결제를 확인했습니다. 크레딧이 잔액에 더해졌습니다.')},e=>{if(!gone)setError(e instanceof Error?e.message:'결제를 확인하지 못했습니다.')}):Promise.resolve();
  void confirmed.then(()=>back?.state==='success'?refresh():refresh().then(()=>{if(!gone&&back?.state==='fail')setError(`결제가 완료되지 않았습니다. ${back.message}`.trim())}));
  return()=>{gone=true};
 },[refresh]);
 const buy=(pack:PackView)=>run(async()=>{
  const checkout=await call<Checkout>('/api/billing/checkout',{packId:pack.id});
  if(!checkout.clientKey)return `주문 ${checkout.order.orderId}을 만들었지만 테스트 결제 클라이언트 키가 설정되지 않아 결제창을 열지 않았습니다. 청구되지 않았습니다.`;
  const factory=await loadToss(),base=`${location.origin}/?view=settings&section=usage`;
  await factory(checkout.clientKey).payment({customerKey:factory.ANONYMOUS??checkout.customerKey}).requestPayment({method:'CARD',amount:{currency:'KRW',value:checkout.order.amountKrw},orderId:checkout.order.orderId,orderName:checkout.order.orderName,successUrl:`${base}&billing=success`,failUrl:`${base}&billing=fail`});
  return '결제창으로 이동합니다.';
 });
 const refund=(orderId:string)=>run(async()=>{const r=await call<{manual?:boolean;duplicate?:boolean}>('/api/billing/refund',{orderId,reason:'고객 요청'});return r.manual?'환불 요청을 접수했습니다. 일부 크레딧을 사용해 담당자가 확인한 뒤 처리합니다.':'환불을 처리했습니다.'});
 return <section className="settings-card col-span-full min-w-0" aria-labelledby="settings-billing-title">
  <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="settings-icon"><Coins/></div><h2 id="settings-billing-title">요금제와 크레딧</h2></div><Button variant="outline" disabled={busy} onClick={()=>void refresh()}><RefreshCw/>새로고침</Button></div>
  <p>AI 사용량은 크레딧으로 셉니다. 1크레딧은 {data?.tokensPerCredit.toLocaleString('ko-KR')??'1,000'}토큰입니다. 충전은 한 번 결제로 끝나며 자동 갱신·자동 결제는 없습니다.</p>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {notice&&<p className="notice" role="status">{notice}</p>}
  {!data?<p role="status">요금제를 불러오는 중…</p>:<>
   {!data.enabled&&<p className="subtle-note">크레딧 요금제가 아직 꺼져 있습니다(운영자가 켭니다). 아래 요금표는 미리보기이며 잔액 차감·결제는 일어나지 않습니다.</p>}
   <h3>요금제</h3>
   <ul className="grid gap-2" aria-label="요금제">{data.plans.map(p=><li key={p.id}><MetaLine items={[<strong key="n">{p.name}{p.id===data.currentPlan?' (현재 요금제)':''}</strong>,p.summary,`월 ${priceText(p.price)}`,p.placeholder&&data.priceNote]}/></li>)}</ul>
   <p className="subtle-note">유료 요금제 전환은 가격이 확정된 뒤 엽니다. 정기 결제가 생기면 별도 동의를 받은 뒤에만 갱신합니다.</p>
   {data.enabled&&<>
    <p><MetaLine items={[<strong key="b">잔액 {data.balance?.toLocaleString('ko-KR')}크레딧</strong>,`${data.month} 사용 ${data.monthUsed?.toLocaleString('ko-KR')}크레딧`,`결제 모드 ${data.mode==='test'?'테스트(실제 청구 없음)':data.mode==='live'?'실결제':'키 미설정'}`]}/></p>
    {data.alerts.length>0&&<ul aria-label="크레딧 알림">{data.alerts.map(a=><li key={a.id} className="notice">{a.title}: {a.detail}</li>)}</ul>}
    <h3>크레딧 충전</h3>
    <ul className="grid gap-2" aria-label="충전 상품">{data.packs.map(p=><li key={p.id} className="flex flex-wrap items-center justify-between gap-2"><MetaLine items={[p.name,priceText(p.price),p.placeholder&&data.priceNote]}/>
     {owner&&data.canPurchase?<Button variant="outline" disabled={busy} onClick={()=>void buy(p)}>{p.name} 구매 ({krw(p.price.totalKrw)}, 부가세 포함)</Button>:<span className="subtle-note">소유자만 충전할 수 있습니다.</span>}</li>)}</ul>
    <p className="subtle-note">구매한 크레딧을 쓰지 않았으면 아래 결제 내역의 ‘환불 요청’ 한 번으로 결제가 취소됩니다. 일부를 썼으면 요청이 접수되고 담당자가 확인합니다.</p>
    <h3>결제 내역</h3>
    {data.orders.length?<ul className="grid gap-2" aria-label="결제 내역">{data.orders.map(o=><li key={o.orderId} className="flex flex-wrap items-center justify-between gap-2"><MetaLine items={[o.orderName,`${krw(o.amountKrw)}(부가세 포함)`,orderStatusLabels[o.status]]}/>
     {owner&&(o.status==='paid'||o.status==='refund_unknown')&&<Button variant="outline" disabled={busy} onClick={()=>void refund(o.orderId)}>환불 요청</Button>}</li>)}</ul>:<EmptyLine className="subtle-note" next="위 충전 상품에서 크레딧을 충전할 수 있습니다.">아직 결제 내역이 없습니다.</EmptyLine>}
    <h3>크레딧 기록</h3>
    {data.ledger.length?<ul className="grid gap-1" aria-label="크레딧 기록">{data.ledger.map(e=><li key={e.id}><MetaLine items={[ledgerLabels[e.type],e.month,`${e.credits>0?'+':''}${e.credits.toLocaleString('ko-KR')}크레딧${typeof e.tokens==='number'?` (${e.tokens.toLocaleString('ko-KR')}토큰)`:''}`]}/></li>)}</ul>:<EmptyLine className="subtle-note" next="AI를 실행하면 이번 달 사용 크레딧이 기록됩니다.">아직 크레딧 기록이 없습니다.</EmptyLine>}
   </>}
  </>}
 </section>;
}
