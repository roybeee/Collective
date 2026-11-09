// 선불 크레딧 요금제(G8) 순수 모듈. 요금제·충전 상품·크레딧 환산·원장 계산·사용량 알림·결제 입력 검증만 둔다(DB·네트워크 없음, 브라우저 번들 공용).
// 가격은 모두 자리 표시 상수다: '가격 미정 — 대표 확정 필요'. 화면은 이 표시와 부가세 포함 총액을 함께 보인다(docs/BILLING.ko.md).
// 원장 항목 종류: grant(요금제 월 기본 제공) · purchase(충전) · usage(AI 사용, provider_usage 토큰 환산) · refund(환불) · expiry(월말 소멸, 기본 제공분만).
// 크레딧 환산: 1크레딧 = 1,000토큰(보고 토큰 합계, 모든 공급자). 한국 시간 달력 월마다 그 달 토큰 합계를 1,000으로 나눠 올림한다.
// 소멸 규칙: 그 달 사용은 그 달 기본 제공분에서 먼저 빠지고, 남은 기본 제공분만 월말에 소멸한다. 충전 크레딧은 소멸하지 않는다(이 판 기준, 유효기간 정책은 대표 확정 필요).

export const PRICE_PLACEHOLDER_NOTE='가격 미정 — 대표 확정 필요';
export const TOKENS_PER_CREDIT=1000;
export const VAT_RATE_PERCENT=10;
export type PlanId='free'|'starter'|'growth';
export type Plan={id:PlanId;name:string;monthlyCredits:number;supplyKrw:number;placeholder:boolean;summary:string};
// 월 기본 제공 크레딧과 가격은 자리 표시다. Free는 0원이 확정이고 나머지 금액은 대표 확정 전이다.
export const PLANS:readonly Plan[]=[
 {id:'free',name:'Free',monthlyCredits:200,supplyKrw:0,placeholder:false,summary:'매달 200크레딧(약 20만 토큰) 기본 제공'},
 {id:'starter',name:'Starter',monthlyCredits:2000,supplyKrw:49000,placeholder:true,summary:'매달 2,000크레딧 기본 제공'},
 {id:'growth',name:'Growth',monthlyCredits:10000,supplyKrw:199000,placeholder:true,summary:'매달 10,000크레딧 기본 제공'},
];
// 이 판에서 모든 워크스페이스는 Free다. 유료 요금제 전환은 가격·정기결제(자동결제 별도 동의) 확정 뒤 연다.
export const CURRENT_PLAN:PlanId='free';
export type CreditPack={id:string;name:string;credits:number;supplyKrw:number;placeholder:boolean};
export const CREDIT_PACKS:readonly CreditPack[]=[
 {id:'pack-1000',name:'크레딧 1,000',credits:1000,supplyKrw:10000,placeholder:true},
 {id:'pack-5000',name:'크레딧 5,000',credits:5000,supplyKrw:45000,placeholder:true},
];
export const planOf=(id:string)=>PLANS.find(p=>p.id===id)??PLANS[0];
export const packOf=(id:unknown)=>typeof id==='string'?CREDIT_PACKS.find(p=>p.id===id)??null:null;
// 공급가액에 부가세 10%를 더한 총액(원 단위 반올림). 화면과 결제 금액은 늘 총액이다(순차 공개 가격 금지).
export function priceWithVat(supplyKrw:number){const vat=Math.round(supplyKrw*VAT_RATE_PERCENT/100);return {supplyKrw,vatKrw:vat,totalKrw:supplyKrw+vat}}
export const krw=(n:number)=>`${n.toLocaleString('ko-KR')}원`;
export const priceLabel=(supplyKrw:number)=>{const p=priceWithVat(supplyKrw);return `${krw(p.totalKrw)} (부가세 포함, 공급가 ${krw(p.supplyKrw)} + 부가세 ${krw(p.vatKrw)})`};
export const creditsForTokens=(tokens:number)=>tokens>0?Math.ceil(tokens/TOKENS_PER_CREDIT):0;

// 한국 시간(UTC+9, 일광절약 없음) 달력 월 'YYYY-MM'.
const KST_MS=9*3600*1000;
export function kstMonthOf(at:Date|string){const d=new Date(new Date(at).getTime()+KST_MS);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`}
// from부터 to까지(둘 다 포함) 월 목록. 순서가 뒤집혔거나 형식이 틀리면 빈 목록.
export function monthsBetween(from:string,to:string){
 const parse=(m:string)=>/^\d{4}-\d{2}$/.test(m)?Number(m.slice(0,4))*12+Number(m.slice(5))-1:NaN;
 const a=parse(from),b=parse(to);if(!Number.isFinite(a)||!Number.isFinite(b)||a>b)return [];
 return Array.from({length:b-a+1},(_,i)=>{const n=a+i;return `${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`});
}

export type LedgerType='grant'|'purchase'|'usage'|'refund'|'expiry';
export type LedgerEntry={id:string;type:LedgerType;credits:number;month:string|null;at:string;orderId?:string;tokens?:number;amountKrw?:number;note?:string};
// 원장 항목의 부호: 받는 것(grant·purchase)은 +, 쓰는 것(usage·refund·expiry)은 -. 저장값은 이미 부호가 붙어 있어 합계만 하면 된다.
export const ledgerSign:Record<LedgerType,1|-1>={grant:1,purchase:1,usage:-1,refund:-1,expiry:-1};
export const ledgerLabels:Record<LedgerType,string>={grant:'월 기본 제공',purchase:'충전',usage:'AI 사용',refund:'환불',expiry:'기본 제공분 소멸'};
export function signedCredits(type:LedgerType,credits:number){return ledgerSign[type]*Math.abs(Math.trunc(credits))}
export const balanceOf=(entries:readonly Pick<LedgerEntry,'credits'>[])=>entries.reduce((sum,e)=>sum+e.credits,0);

// 월별 파생 항목(grant·usage·expiry). 저장 행과 같은 id를 써서 다시 계산해도 같은 행을 덮어쓴다(멱등).
// 지난달은 소멸을 확정하고, 이번 달은 소멸이 없다. usageByMonth는 월 → 그 달 보고 토큰 합계(과금 시작 시각 이후)다.
// grants는 이미 저장된 달의 기본 제공량이다(요금제 상수가 바뀌어도 지난달 기록을 다시 쓰지 않는다). 없으면 allowance를 쓴다.
export function monthlyEntries(input:{startMonth:string;currentMonth:string;allowance:number;usageByMonth:Record<string,number>;at:string;grants?:Record<string,number>}):LedgerEntry[]{
 return monthsBetween(input.startMonth,input.currentMonth).flatMap(month=>{
  const stored=input.grants?.[month],tokens=Math.max(0,Number(input.usageByMonth[month])||0),used=creditsForTokens(tokens),grant=Math.max(0,Math.trunc(typeof stored==='number'?stored:input.allowance));
  const rows:LedgerEntry[]=[{id:`grant-${month}`,type:'grant',credits:grant,month,at:input.at},{id:`usage-${month}`,type:'usage',credits:signedCredits('usage',used),month,at:input.at,tokens}];
  if(month<input.currentMonth)rows.push({id:`expiry-${month}`,type:'expiry',credits:signedCredits('expiry',Math.max(0,grant-used)),month,at:input.at});
  return rows;
 });
}

// 이번 달 사용률 알림. 이번 달 쓸 수 있던 크레딧(이번 달 사용 + 현재 잔액) 중 쓴 비율이 80%·100% 이상이면 그 단계를 돌려준다. 잔액이 0 이하이면 100%.
export const ALERT_LEVELS=[80,100] as const;
export type AlertLevel=typeof ALERT_LEVELS[number];
export function usagePercent(monthUsedCredits:number,balance:number){
 const used=Math.max(0,monthUsedCredits);
 if(balance<=0)return used>0||balance<0?100:0;
 return Math.floor(used*100/(used+balance));
}
export const alertLevels=(monthUsedCredits:number,balance:number):AlertLevel[]=>{const p=usagePercent(monthUsedCredits,balance);return ALERT_LEVELS.filter(l=>p>=l)};
export const alertText=(level:AlertLevel,month:string)=>level===100?`${month} 크레딧을 모두 사용했습니다. 크레딧 요금제가 켜져 있으면 새 AI 실행이 멈춥니다. 사용량·비용에서 충전하세요.`:`${month} 쓸 수 있는 크레딧의 80% 이상을 사용했습니다. 사용량·비용에서 잔액을 확인하세요.`;
export const CREDIT_STOP_MESSAGE='크레딧 잔액이 0입니다. 새 AI 실행을 시작하지 않았습니다(아무것도 보내지 않음). 연결 및 설정 → 사용량·비용에서 크레딧을 충전하세요.';

// 토스페이먼츠 orderId 규칙: 6~64자, 영문 대소문자·숫자·-·_만.
export const isOrderId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{6,64}$/.test(v);
export const newOrderId=(uuid:string)=>`col_${uuid.replace(/-/g,'')}`;
// paymentKey는 토스가 만든 불투명 문자열이다. 길이·문자만 확인한다(최대 200자).
export const isPaymentKey=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
// 시크릿 키 판정: 테스트 키(test_ 접두어)만 허용한다. 라이브 키는 BILLING_LIVE=1일 때만(실결제 전환은 대표 결정).
export type KeyCheck={ok:true;mode:'test'|'live'}|{ok:false;status:number;message:string};
export function checkSecretKey(key:unknown,live:unknown):KeyCheck{
 if(typeof key!=='string'||!key)return {ok:false,status:503,message:'결제 시크릿 키(TOSS_PAYMENTS_SECRET_KEY)가 설정되지 않았습니다. 결제를 진행하지 않았습니다.'};
 if(key.startsWith('test_'))return {ok:true,mode:'test'};
 if(live==='1')return {ok:true,mode:'live'};
 return {ok:false,status:503,message:'테스트 키(test_)가 아닌 결제 키는 실결제 전환(BILLING_LIVE=1, 대표 결정) 전에는 쓰지 않습니다. 결제를 진행하지 않았습니다.'};
}
// 클라이언트 키는 공개 값이지만 시크릿 키와 같은 모드여야 한다(테스트 키끼리, 라이브 키끼리).
export const clientKeyFor=(key:unknown,mode:'test'|'live')=>typeof key==='string'&&(mode==='test'?key.startsWith('test_'):key.startsWith('live_'))?key:null;
export const basicAuth=(secretKey:string)=>'Basic '+btoa(secretKey+':');

export type OrderStatus='pending'|'confirming'|'unknown'|'paid'|'failed'|'refunding'|'refund_unknown'|'refund_requested'|'refunded';
export type BillingOrder={orderId:string;packId:string;orderName:string;credits:number;supplyKrw:number;vatKrw:number;amountKrw:number;status:OrderStatus;mode:'test'|'live';createdAt:string;createdBy:{id:string;email:string|null};paymentKey?:string;approvedAt?:string;failure?:string;refundReason?:string;refundedAt?:string;updatedAt:string};
export const orderStatusLabels:Record<OrderStatus,string>={pending:'결제 대기',confirming:'승인 확인 중',unknown:'승인 결과 미확인',paid:'결제 완료',failed:'결제 실패',refunding:'환불 처리 중',refund_unknown:'환불 결과 미확인',refund_requested:'환불 요청 접수(담당자 확인)',refunded:'환불 완료'};
// 결제 승인 응답 판정: 상태 DONE, 같은 orderId, 총액이 주문 금액과 같아야 성공이다.
export function confirmedPayment(response:unknown,order:Pick<BillingOrder,'orderId'|'amountKrw'>){
 if(!response||typeof response!=='object')return false;
 const r=response as Record<string,unknown>;
 return r.status==='DONE'&&r.orderId===order.orderId&&r.totalAmount===order.amountKrw;
}
