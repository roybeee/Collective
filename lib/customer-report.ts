// 점포 브랜드 주간 고객 보고서(A8-1, docs/CUSTOMER-REPORT.ko.md). 순수 모듈: 상대 import만 쓰고 서버·기능 스위치·모델·네트워크·시계에 의존하지 않는다(tests/customer-report.test.mjs가 import 경계를 고정).
// 지표 정의는 A4 순수 함수(orderMetrics·ledgerSummary·unitEconomics·weeklyCompletenessFromDays·northStar)를 그대로 쓴다(data-truth-9). 변동비율(economics)은 어디에도 넘기지 않는다.
// 두 단계로 만든다. aggregateLedger(주문·비용 행 → 숫자만 남은 장부 집계)가 행 필드를 떨어뜨리고, buildReport(집계 → payload)는 지표 사전에 있는 키만으로 payload를 새로 조립한다.
// 남는 문자열(지점 이름·채널 이름·커넥터 정의·한계·자료 요청 라벨)은 maskFields로 가리고, 지점 주소·확정 사업장 전화·확정 사실 값은 허용 목록으로 둔다. 가린 기록은 필드·종류·건수만 남긴다.
// Markdown·CSV는 payload에서만 만든다. 같은 입력이면 바이트가 같다(시각·난수를 쓰지 않고 배열을 정해진 순서로 정렬한다).
import {ATTRIBUTION_NOT_INCREMENTAL,addDays,isAttributed,koreaMinute,northStar,orderMetrics,unitEconomics,weeklyCompletenessFromDays,type ChannelEconomics,type DayTotal,type PosWeeklyTotal} from './store-attribution';
import {ledgerSummary,type StoreOrder,type StoreSpend} from './store-operations';
import {factLabel} from './fact-catalog';
import {maskFields,type PiiFieldFinding} from './pii-scan';
import {csvText,mdCell,type FactPackCounts} from './fact-pack';

export const REPORT_SCHEMA='collective.customer-report.v1';
// POS 대조·north-star를 보는 주 수(보고 주 포함, 지난 4주).
export const REPORT_TRAILING_WEEKS=4;
export const AUTO_JUDGEMENT_NOTICE='자동 판정 아님: 이 보고서는 장부·POS 합계·커넥터 값을 정해진 규칙으로 모은 집계입니다. 성과의 좋고 나쁨이나 원인을 판정하지 않으며, 판단은 대표가 합니다.';
export const REPORT_NOTICES:readonly string[]=[ATTRIBUTION_NOT_INCREMENTAL,AUTO_JUDGEMENT_NOTICE,
 '공헌이익은 주문 원가가 모두 적힌 경우만 계산합니다. 원가를 모르는 주문이 있으면 미확인이며 변동비율로 추정하지 않습니다.',
 'north-star는 POS 합계와 1% 이내로 맞은 주의 귀속 주문·공헌이익만 셉니다. POS 합계가 없는 주(missing_pos)는 통과로 보지 않습니다.',
 '커넥터 값은 참고용이며 비교할 수 없습니다(comparable:false). 계정·정의·기간이 장부와 달라 장부 숫자와 견주지 마세요.'];

// ── 지표 사전: payload의 숫자 키는 모두 여기 id다. source: user_record(사용자 기록)·derived(파생)·connector(커넥터 실측)·app_record(앱 기록) ──
export type MetricUnit='count'|'krw'|'ratio'|'people'|'weeks'|'flag';
export type MetricSource='user_record'|'derived'|'connector'|'app_record';
export type ReportMetric={id:string;section:'ledger'|'completeness'|'northStar'|'channel'|'connector'|'publication'|'todo'|'fact';label:string;unit:MetricUnit;source:MetricSource;definition:string;basis:string};
const metric=(section:ReportMetric['section'],id:string,label:string,unit:MetricUnit,source:MetricSource,definition:string,basis:string):ReportMetric=>({id,section,label,unit,source,definition,basis});
export const REPORT_METRICS:readonly ReportMetric[]=[
 metric('ledger','records','주문 기록','count','user_record','보고 주(한국 날짜 월~일)의 주문 기록 전체(취소·전액 환불 포함).','store-attribution.ts orderMetrics records'),
 metric('ledger','orders','주문 수','count','user_record','결제 완료이고 전액 환불이 아닌 주문.','store-attribution.ts countedOrder'),
 metric('ledger','cancelled','취소','count','user_record','상태가 취소인 주문 기록.','store-operations.ts ledgerSummary cancelled'),
 metric('ledger','refunded','전액 환불','count','user_record','상태가 전액 환불인 주문 기록.','store-operations.ts ledgerSummary refunded'),
 metric('ledger','netRevenue','순매출','krw','user_record','모든 주문 기록의 결제액−환불액 합.','store-attribution.ts orderMetrics netRevenue = ledgerSummary netRevenue'),
 metric('ledger','contribution','공헌이익','krw','derived','순매출−주문 원가(식재료·포장·수수료·배달비·증정) 합. 원가를 모르는 주문이 1건이라도 있으면 null(추정 없음).','store-operations.ts orderContribution'),
 metric('ledger','unknownCostOrders','원가 미입력 주문','count','user_record','원가 항목 중 하나라도 비어 있는 주문 기록.','store-attribution.ts orderMetrics unknownCostOrders'),
 metric('ledger','newCustomers','신규 고객','people','user_record','센 주문 중 신규 여부가 참인 주문. 하나라도 모르면 null.','store-attribution.ts orderMetrics newCustomers'),
 metric('ledger','attributedOrders','귀속 주문','count','derived','센 주문 중 유입 채널·캠페인·소재가 하나라도 있는 주문. 귀속≠증분.','store-attribution.ts isAttributed'),
 metric('ledger','adSpend','광고비','krw','user_record','비용 장부 광고비 합. 네이버 검색광고 수집값을 옮긴 기록은 수집 기간 합계를 종료일 한 건으로 적는다(배분 없음).','store-operations.ts ledgerSummary adSpend'),
 metric('ledger','productionCost','제작·협찬비','krw','user_record','비용 장부 제작·협찬비 합.','store-operations.ts ledgerSummary productionCost'),
 metric('ledger','spendTotal','비용 합계','krw','derived','광고비+제작·협찬비.','store-attribution.ts unitEconomics spendTotal'),
 metric('completeness','ledgerNet','장부 순매출','krw','user_record','그 주 일별 장부 합계의 순매출.','store-attribution.ts weeklyCompletenessFromDays'),
 metric('completeness','ledgerOrders','장부 주문 수','count','user_record','그 주 일별 장부 합계의 주문 수.','store-attribution.ts weeklyCompletenessFromDays'),
 metric('completeness','posNet','POS 순매출','krw','user_record','매장 POS가 낸 그 주 순매출 합계. 없으면 null(missing_pos).','store-attribution.ts PosWeeklyTotal netSales'),
 metric('completeness','posOrders','POS 주문 수','count','user_record','매장 POS가 낸 그 주 주문 수. 없으면 null.','store-attribution.ts PosWeeklyTotal orderCount'),
 metric('completeness','diffRate','POS 차이율','ratio','derived','|장부 순매출−POS 순매출|÷POS 순매출. 허용 오차 1% 안이면 pass.','store-attribution.ts COMPLETENESS_TOLERANCE'),
 metric('completeness','attributedContribution','귀속 공헌이익','krw','derived','그 주 귀속 주문의 공헌이익. 원가를 모르는 귀속 주문이 있으면 null.','store-attribution.ts weeklyCompletenessFromDays'),
 metric('northStar','measured','north-star 측정','flag','derived','POS 대조를 통과한 주가 하나라도 있는가.','store-attribution.ts northStar measured'),
 metric('northStar','passedWeeks','대조 통과 주','weeks','derived','지난 4주 중 POS 대조 pass인 주.','store-attribution.ts northStar'),
 metric('northStar','excludedWeeks','제외한 주','weeks','derived','지난 4주 중 fail·missing_pos인 주.','store-attribution.ts northStar'),
 metric('northStar','northStarOrders','north-star 귀속 주문','count','derived','통과한 주의 귀속 주문 합.','store-attribution.ts northStar attributedOrders'),
 metric('northStar','northStarContribution','north-star 귀속 공헌이익','krw','derived','통과한 주의 귀속 공헌이익 합. 하나라도 null이거나 통과 주가 없으면 null.','store-attribution.ts northStar attributedContribution'),
 metric('channel','contributionAfterSpend','비용 뺀 공헌이익','krw','derived','채널 공헌이익−같은 채널 비용 합계. 공헌이익이 null이면 null.','store-attribution.ts unitEconomics'),
 metric('channel','costPerOrder','주문당 비용','krw','derived','채널 비용 합계÷주문 수.','store-attribution.ts unitEconomics'),
 metric('channel','costPerNewCustomer','신규 고객당 비용','krw','derived','채널 비용 합계÷신규 고객.','store-attribution.ts unitEconomics'),
 metric('channel','revenuePerSpend','비용 대비 순매출','ratio','derived','순매출÷채널 비용 합계(ROAS). 귀속≠증분.','store-attribution.ts unitEconomics'),
 metric('connector','connectorAdSpend','커넥터 광고비','krw','connector','커넥터가 수집 기간 합계로 준 광고비. 모르면 null.','measurement_draft storeValues.adSpend'),
 metric('connector','connectorConversions','커넥터 전환','count','connector','커넥터가 준 전환 수(광고 계정 전환 정의).','measurement_draft storeValues.orders'),
 metric('connector','controlNumerator','대조안 분자','count','connector','대조안 수집 값의 분자(정의 참고).','measurement_draft arms.control.value'),
 metric('connector','controlDenominator','대조안 분모','count','connector','대조안 수집 값의 분모(정의 참고).','measurement_draft arms.control.value'),
 metric('connector','treatmentNumerator','실험안 분자','count','connector','실험안 수집 값의 분자(정의 참고).','measurement_draft arms.treatment.value'),
 metric('connector','treatmentDenominator','실험안 분모','count','connector','실험안 수집 값의 분모(정의 참고).','measurement_draft arms.treatment.value'),
 metric('publication','publications','발행 건수','count','app_record','예약 시각(한국 날짜)이 보고 주인 발행을 상태별로 센다.','execution.ts Publication status'),
 metric('todo','openDataRequests','열린 자료 요청','count','app_record','열린 자료 요청(라벨만).','data-requests.ts DataRequest'),
 metric('todo','placeMismatches','플레이스 불일치','count','derived','플레이스 대조에서 일치가 아닌 항목(항목·상태만).','place-check.ts PlaceCheckResult'),
 metric('fact','factCounts','사실 건수','count','app_record','사실 팩의 확정·14일 안 만료·거절·제외 건수.','fact-pack.ts FactPackCounts'),
];
const METRIC=new Map(REPORT_METRICS.map(m=>[m.id,m]));
const LEDGER_KEYS=['records','orders','cancelled','refunded','netRevenue','contribution','unknownCostOrders','newCustomers','attributedOrders','adSpend','productionCost','spendTotal'] as const;
const CHANNEL_KEYS=['orders','netRevenue','contribution','newCustomers','adSpend','productionCost','spendTotal','contributionAfterSpend','costPerOrder','costPerNewCustomer','revenuePerSpend'] as const;
const CHECK_KEYS=['ledgerNet','ledgerOrders','posNet','posOrders','diffRate','attributedOrders','attributedContribution'] as const;
export type LedgerValues=Record<typeof LEDGER_KEYS[number],number|null>;
export type ChannelRow={key:string;label:string}&Record<typeof CHANNEL_KEYS[number],number|null>;
export type SpendWindow={channel:string;from:string;to:string;adSpend:number;counted:boolean};
export type ReportLedger={week:string;current:LedgerValues;previous:LedgerValues;channels:ChannelRow[];spendWindows:SpendWindow[]};

// ── 주: KST ISO 주(월~일). 날짜는 한국 날짜 문자열(YYYY-MM-DD)이라 시간대 계산이 없다. lib/quality-console.ts isoWeekOf와 같은 라벨(테스트에서만 교차 확인) ──
const DATE=/^\d{4}-\d{2}-\d{2}$/,DAY_MS=86400000;
const dayMs=(date:string)=>Date.parse(date+'T00:00:00Z'),mondayIndex=(t:number)=>(new Date(t).getUTCDay()+6)%7;
const week1Monday=(year:number)=>{const jan4=Date.UTC(year,0,4);return jan4-mondayIndex(jan4)*DAY_MS};
export function isoWeekOfDate(date:string):string{
 const t=DATE.test(date)?dayMs(date):NaN;if(!Number.isFinite(t))throw new RangeError('날짜는 YYYY-MM-DD로 정하세요.');
 const thursday=t+(3-mondayIndex(t))*DAY_MS,year=new Date(thursday).getUTCFullYear();
 return `${year}-W${String(Math.floor((thursday-week1Monday(year))/(7*DAY_MS))+1).padStart(2,'0')}`;
}
export type ReportWeek={week:string;from:string;to:string;timeZone:'Asia/Seoul'};
// 없는 주(W00·W54·그해에 없는 W53)나 형식이 틀리면 null.
export function reportWeek(week:string):ReportWeek|null{
 const m=/^(\d{4})-W(\d{2})$/.exec(week);if(!m||Number(m[2])<1)return null;
 const from=new Date(week1Monday(Number(m[1]))+(Number(m[2])-1)*7*DAY_MS).toISOString().slice(0,10);
 return isoWeekOfDate(from)===week?{week,from,to:addDays(from,6),timeZone:'Asia/Seoul'}:null;
}
// 끝난 주: 일요일(한국 날짜)이 오늘보다 앞이다. 동결(A8-2)은 끝난 주만 받는다.
export const weekClosed=(week:string,today:string)=>{const r=reportWeek(week);return !!r&&r.to<today};
function requireWeek(week:string):ReportWeek{const r=reportWeek(week);if(!r)throw new RangeError('보고 주는 있는 ISO 주(YYYY-Www)로 정하세요.');return r}
const previousWeekOf=(w:ReportWeek)=>isoWeekOfDate(addDays(w.from,-7));

// ── 1단계: 장부 집계(주문·비용 행 → 숫자). 여기서 주문 행 필드(주문번호·메모·근거·추적 코드·입력자)와 비용 출처 문구가 떨어진다 ──
// orders는 게시 관문을 다시 본 주문(publicationGateView)이어야 귀속 주문이 점포 귀속 보고와 같다. spend는 보고 주 앞뒤의 네이버 수집 기록까지 넘기면 주를 걸친 창을 찾는다.
const money=(n:number)=>Math.round(n*100)/100,num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
function ledgerValues(orders:readonly StoreOrder[],spend:readonly StoreSpend[]):LedgerValues{
 const m=orderMetrics(orders),s=ledgerSummary([...orders],[...spend]);
 return {records:m.records,orders:m.orders,cancelled:s.cancelled,refunded:s.refunded,netRevenue:m.netRevenue,contribution:m.contribution,unknownCostOrders:m.unknownCostOrders,newCustomers:m.newCustomers,attributedOrders:orders.filter(isAttributed).length,adSpend:money(s.adSpend),productionCost:money(s.productionCost),spendTotal:money(s.adSpend+s.productionCost)};
}
const channelRow=(c:ChannelEconomics):ChannelRow=>({key:c.key,label:c.label,...Object.fromEntries(CHANNEL_KEYS.map(k=>[k,num(c[k])])) as Record<typeof CHANNEL_KEYS[number],number|null>});
// 네이버 수집 광고비를 옮긴 비용 기록(lib/spend-transfer.ts): id 'naver-<대상 해시 24자>-<수집 시작일>', 비용일 = 수집 종료일. 창이 보고 주를 걸치면 경고만 달고 배분하지 않는다.
const NAVER_SPEND_ID=/^naver-[0-9a-f]{24}-(\d{4}-\d{2}-\d{2})$/;
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
function spendWindows(spend:readonly StoreSpend[],w:ReportWeek):SpendWindow[]{
 return spend.flatMap(s=>{
  const m=NAVER_SPEND_ID.exec(s.id),from=m?.[1]??'',to=s.date;
  if(!m||from>w.to||to<w.from||(from>=w.from&&to<=w.to))return [];
  return [{channel:s.channel,from,to,adSpend:money(s.adSpend),counted:to>=w.from&&to<=w.to}];
 }).sort((a,b)=>cmp(a.from,b.from)||cmp(a.to,b.to)||a.adSpend-b.adSpend);
}
export function aggregateLedger(week:string,orders:readonly StoreOrder[],spend:readonly StoreSpend[]):ReportLedger{
 const w=requireWeek(week),p=requireWeek(previousWeekOf(w)),sorted=[...orders].sort((a,b)=>cmp(a.id,b.id)),costs=[...spend].sort((a,b)=>cmp(a.id,b.id));
 const pick=(r:ReportWeek)=>({orders:sorted.filter(o=>o.orderDate>=r.from&&o.orderDate<=r.to),spend:costs.filter(s=>s.date>=r.from&&s.date<=r.to)}),cur=pick(w),before=pick(p);
 return {week:w.week,current:ledgerValues(cur.orders,cur.spend),previous:ledgerValues(before.orders,before.spend),channels:unitEconomics(cur.orders,cur.spend).byChannel.map(channelRow),spendWindows:spendWindows(costs,w)};
}

// ── 2단계: payload ──
// ReportInput의 원문 기록(POS 합계·커넥터 초안·발행·자료 요청·플레이스 대조)에서 빌더는 사전에 있는 키만 읽는다. 그 밖의 필드(메모·입력자·계정·광고 대상·원문 값)는 payload에 들어가지 않는다.
export type ReportScope={type:'store'|'brand';id:string;brandId:string;name:string;address?:string;businessPhone?:string};
type ArmValue={numerator?:number|null;denominator?:number|null};
export type ConnectorDraftInput={channel:string;window:{from:string;to:string};definition?:string;limitations?:readonly string[];fetchedAt?:string;storeValues?:Partial<Record<string,number|null>>;arms?:Partial<Record<'control'|'treatment',{value?:ArmValue}>>};
export type ReportInput={scope:ReportScope;week:string;ledger:ReportLedger;days:readonly DayTotal[];posTotals:readonly PosWeeklyTotal[];connectors?:readonly ConnectorDraftInput[];
 publications?:readonly {status:string;scheduledAt?:unknown}[];dataRequests?:readonly {status:string;label:string}[];placeChecks?:readonly {field:string;state:string}[];facts?:FactPackCounts|null;allow?:readonly string[]};
export type CompletenessRow={week:string;weekStart:string;weekEnd:string;status:'pass'|'fail'|'missing_pos';reason:string}&Record<typeof CHECK_KEYS[number],number|null>;
export type ConnectorEntry={connector:string;label:string;window:{from:string;to:string};fetchedAt:string;relation:'within'|'crosses'|'outside';definition:string;limitations:string[];values:Record<string,number|null>;comparable:false};
export type CustomerReport={schema:typeof REPORT_SCHEMA;scope:{type:'store'|'brand';id:string;brandId:string;name:string;address:string|null;businessPhone:string|null};
 period:ReportWeek&{previousWeek:string};ledger:{current:LedgerValues;previous:LedgerValues};completeness:CompletenessRow[];
 northStar:{measured:boolean;weeks:string[];passedWeeks:number;excludedWeeks:number;northStarOrders:number;northStarContribution:number|null};
 channels:ChannelRow[];spendWarnings:(SpendWindow&{message:string})[];connectors:ConnectorEntry[];publications:{total:number;byStatus:{status:string;label:string;count:number}[]};
 todos:{dataRequests:{label:string}[];placeMismatches:{field:string;label:string;state:string}[]};facts:FactPackCounts|null;notices:string[];masking:PiiFieldFinding[]};

// 원가를 모르는 주문이 있으면 공헌이익을 싣지 않는다(입력이 다른 경로로 추정값을 넣어도 막는다). 사전 키만 옮긴다.
const cleanLedger=(v:LedgerValues):LedgerValues=>{const out=Object.fromEntries(LEDGER_KEYS.map(k=>[k,num(v[k])])) as LedgerValues;return {...out,contribution:out.unknownCostOrders?null:out.contribution}};
const cleanChannel=(c:ChannelRow):ChannelRow=>({key:String(c.key),label:String(c.label),...Object.fromEntries(CHANNEL_KEYS.map(k=>[k,num(c[k])])) as Record<typeof CHANNEL_KEYS[number],number|null>});
// 행(rows)은 사전 키만 옮긴 표시용, checks는 northStar에 그대로 넘기는 원래 판정이다.
function completeness(w:ReportWeek,input:ReportInput){
 const weeks=Array.from({length:REPORT_TRAILING_WEEKS},(_,i)=>addDays(w.from,-7*(REPORT_TRAILING_WEEKS-1-i)));
 const days=[...input.days].sort((a,b)=>cmp(a.day,b.day)),pos=[...input.posTotals].sort((a,b)=>cmp(a.weekStart,b.weekStart)||b.version-a.version);
 const checks=weeklyCompletenessFromDays(weeks,days,pos);
 return {checks,rows:checks.map((c):CompletenessRow=>({week:isoWeekOfDate(c.weekStart),weekStart:c.weekStart,weekEnd:c.weekEnd,status:c.status,reason:c.reason,...Object.fromEntries(CHECK_KEYS.map(k=>[k,num(c[k])])) as Record<typeof CHECK_KEYS[number],number|null>}))};
}
const won=(n:number)=>n.toLocaleString('ko-KR')+'원';
const spendMessage=(s:SpendWindow)=>s.counted?`네이버 검색광고 광고비 ${won(s.adSpend)}은 수집 기간 ${s.from}~${s.to} 합계를 종료일 한 건으로 기록해 이 주에 모두 들어갔습니다. 주 밖 날짜의 광고비가 섞여 있을 수 있습니다(배분하지 않음).`:`네이버 검색광고 광고비 ${won(s.adSpend)}은 수집 기간 ${s.from}~${s.to} 합계가 종료일에 기록돼 이 주에서 빠졌습니다. 이 주 날짜의 광고비가 빠져 있을 수 있습니다(배분하지 않음).`;
export const CONNECTOR_LABELS:Readonly<Record<string,string>>={naver_ads:'네이버 검색광고',instagram:'Instagram'};
function connectorEntry(d:ConnectorDraftInput,w:ReportWeek):ConnectorEntry{
 const from=String(d.window.from),to=String(d.window.to),relation=from>=w.from&&to<=w.to?'within':from<=w.to&&to>=w.from?'crosses':'outside',sv=d.storeValues||{};
 const armValues=(['control','treatment'] as const).flatMap(a=>{const v=d.arms?.[a]?.value;return v?[[`${a}Numerator`,num(v.numerator)],[`${a}Denominator`,num(v.denominator)]] as [string,number|null][]:[]});
 const values=Object.fromEntries([...('adSpend' in sv?[['connectorAdSpend',num(sv.adSpend)]]:[]),...('orders' in sv?[['connectorConversions',num(sv.orders)]]:[]),...armValues]);
 const limitations=[...(d.limitations||[]).filter((l):l is string=>typeof l==='string'),...(relation==='within'?[]:[`수집 기간(${from}~${to})이 보고 주(${w.from}~${w.to})와 달라 이 주만의 값이 아닙니다.`])];
 return {connector:d.channel,label:CONNECTOR_LABELS[d.channel],window:{from,to},fetchedAt:String(d.fetchedAt??''),relation,definition:String(d.definition??''),limitations,values,comparable:false};
}
// lib/execution.ts publicationLabels와 같은 이름(테스트가 같음을 고정한다).
export const PUBLICATION_STATUS_LABELS:Readonly<Record<string,string>>={draft:'승인 전',approved:'실행 승인',submitting:'접수 확인 중',uncertain:'접수 여부 미확인',accepted:'예약 접수',blocked:'공급자 확인 필요',published:'게시 확인',failed:'발행 실패',cancelled:'취소'};
function publicationCounts(list:readonly {status:string;scheduledAt?:unknown}[],w:ReportWeek){
 const inWeek=list.filter(p=>{const day=koreaMinute(p.scheduledAt).slice(0,10);return !!day&&day>=w.from&&day<=w.to&&Object.hasOwn(PUBLICATION_STATUS_LABELS,p.status)});
 const byStatus=[...new Set(inWeek.map(p=>p.status))].sort(cmp).map(status=>({status,label:PUBLICATION_STATUS_LABELS[status],count:inWeek.filter(p=>p.status===status).length}));
 return {total:inWeek.length,byStatus};
}
const PLACE_STATES=new Set(['conflict','place_missing','fact_missing','both_missing']);
const cleanFacts=(f:FactPackCounts|null|undefined):FactPackCounts|null=>f?{effective:num(f.effective)??0,expiringSoon:num(f.expiringSoon)??0,rejected:num(f.rejected)??0,excluded:{candidate:num(f.excluded?.candidate)??0,expired:num(f.excluded?.expired)??0,unsupported:num(f.excluded?.unsupported)??0,franchise:num(f.excluded?.franchise)??0}}:null;
const MASKED_PATHS=['scope.name','channels.*.label','connectors.*.definition','connectors.*.limitations.*','todos.dataRequests.*.label'];

export function buildReport(input:ReportInput):CustomerReport{
 const w=requireWeek(input.week);if(input.ledger.week!==w.week)throw new RangeError('장부 집계의 주가 보고 주와 다릅니다.');
 const {checks,rows}=completeness(w,input),ns=northStar(checks),s=input.scope;
 const body={scope:{type:s.type,id:String(s.id),brandId:String(s.brandId),name:String(s.name),address:s.address??null,businessPhone:s.businessPhone??null},
  channels:input.ledger.channels.map(cleanChannel),
  connectors:(input.connectors||[]).filter(d=>Object.hasOwn(CONNECTOR_LABELS,d.channel)).map(d=>connectorEntry(d,w)).sort((a,b)=>cmp(a.connector,b.connector)||cmp(a.window.from,b.window.from)||cmp(a.window.to,b.window.to)||cmp(a.fetchedAt,b.fetchedAt)),
  todos:{dataRequests:(input.dataRequests||[]).filter(d=>d.status==='open').map(d=>String(d.label)).sort(cmp).map(label=>({label})),
   placeMismatches:(input.placeChecks||[]).filter(p=>PLACE_STATES.has(p.state)&&/^[a-z_]{1,40}$/.test(p.field)).map(p=>({field:p.field,label:factLabel(p.field),state:p.state})).sort((a,b)=>cmp(a.field,b.field)||cmp(a.state,b.state))}};
 const masked=maskFields(body,MASKED_PATHS,{allow:[s.address,s.businessPhone,...(input.allow||[])]}),v=masked.value;
 return {schema:REPORT_SCHEMA,scope:v.scope,period:{...w,previousWeek:previousWeekOf(w)},ledger:{current:cleanLedger(input.ledger.current),previous:cleanLedger(input.ledger.previous)},completeness:rows,
  northStar:{measured:ns.measured,weeks:ns.weeks.map(isoWeekOfDate),passedWeeks:ns.passedWeeks,excludedWeeks:ns.excludedWeeks,northStarOrders:ns.attributedOrders,northStarContribution:ns.attributedContribution},
  channels:v.channels,spendWarnings:input.ledger.spendWindows.map(x=>({...x,message:spendMessage(x)})),connectors:v.connectors,publications:publicationCounts(input.publications||[],w),todos:v.todos,facts:cleanFacts(input.facts),notices:[...REPORT_NOTICES],masking:masked.findings};
}

// ── 렌더러: payload에서만 만든다 ──
const unitText=(unit:MetricUnit,v:number|boolean|null)=>v===null?'미확인':typeof v==='boolean'?(v?'예':'아니오'):unit==='krw'?won(v):unit==='count'?`${v}건`:unit==='people'?`${v}명`:unit==='weeks'?`${v}주`:String(v);
const show=(id:string,v:number|boolean|null)=>unitText(METRIC.get(id)?.unit??'count',v);
const label=(id:string)=>METRIC.get(id)?.label??id;
const RELATION={within:'보고 주 안',crosses:'보고 주를 걸침',outside:'보고 주 밖'} as const;
const STATUS={pass:'통과',fail:'불일치',missing_pos:'POS 합계 없음'} as const;
function markdownTables(r:CustomerReport):string[]{
 const ledger=LEDGER_KEYS.map(k=>`| ${label(k)} | ${show(k,r.ledger.current[k])} | ${show(k,r.ledger.previous[k])} |`);
 const checks=r.completeness.map(c=>`| ${c.week} | ${c.weekStart}~${c.weekEnd} | ${STATUS[c.status]} | ${show('ledgerNet',c.ledgerNet)} | ${show('posNet',c.posNet)} | ${show('diffRate',c.diffRate)} | ${show('attributedOrders',c.attributedOrders)} | ${show('attributedContribution',c.attributedContribution)} | ${mdCell(c.reason)} |`);
 const channels=r.channels.map(c=>`| ${mdCell(c.label)} | ${CHANNEL_KEYS.map(k=>show(k,c[k])).join(' | ')} |`);
 return ['## 장부','',`| 지표 | ${r.period.week} | 전주 ${r.period.previousWeek} |`,'|---|---|---|',...ledger,'',
  `## POS 대조 (최근 ${REPORT_TRAILING_WEEKS}주)`,'','| 주 | 기간 | 상태 | 장부 순매출 | POS 순매출 | 차이율 | 귀속 주문 | 귀속 공헌이익 | 사유 |','|---|---|---|---|---|---|---|---|---|',...checks,'',
  '## north-star','',`- 측정: ${show('measured',r.northStar.measured)} · 통과 주: ${r.northStar.weeks.join(', ')||'없음'} · 제외한 주 ${r.northStar.excludedWeeks}주`,`- ${label('northStarOrders')} ${show('northStarOrders',r.northStar.northStarOrders)} · ${label('northStarContribution')} ${show('northStarContribution',r.northStar.northStarContribution)}`,'',
  '## 채널 단위경제','',`| 채널 | ${CHANNEL_KEYS.map(label).join(' | ')} |`,`|---|${CHANNEL_KEYS.map(()=>'---').join('|')}|`,...channels,''];
}
function markdownLists(r:CustomerReport):string[]{
 const connectors=r.connectors.flatMap(c=>[`- ${c.label} · 수집 기간 ${c.window.from}~${c.window.to}(${RELATION[c.relation]}) · 수집 시각 ${c.fetchedAt||'미확인'} · 비교 불가`,`  - 값: ${Object.entries(c.values).map(([k,v])=>`${label(k)} ${show(k,v)}`).join(' · ')||'없음'}`,`  - 정의: ${mdCell(c.definition)}`,...c.limitations.map(l=>`  - 한계: ${mdCell(l)}`)]);
 const f=r.facts,list=(items:string[])=>items.length?items:['- 없음'];
 return ['## 광고비 경고','',...list(r.spendWarnings.map(s=>`- ${s.message}`)),'','## 커넥터 값 (참고 · 비교 불가)','',...list(connectors),'',
  '## 발행','',`- 이번 주 예약 발행 ${r.publications.total}건${r.publications.byStatus.length?': '+r.publications.byStatus.map(p=>`${p.label} ${p.count}건`).join(' · '):''}`,'',
  '## 할 일','',...list([...r.todos.dataRequests.map(d=>`- 열린 자료 요청: ${mdCell(d.label)}`),...r.todos.placeMismatches.map(p=>`- 플레이스 불일치: ${p.label}(${p.state})`)]),'',
  '## 사실','',f?`- 확정 ${f.effective}건 · 14일 안 만료 ${f.expiringSoon}건 · 거절 ${f.rejected}건 · 제외(후보 ${f.excluded.candidate} · 만료 ${f.excluded.expired} · 근거 없음 ${f.excluded.unsupported} · 가맹 ${f.excluded.franchise})`:'- 사실 건수 없음','',
  '## 가림 기록','',...list(r.masking.map(m=>`- ${mdCell(m.field)} · ${m.kind} ${m.count}건`)),'','## 안내','',...r.notices.map(n=>`- ${n}`),''];
}
export function reportMarkdown(r:CustomerReport):string{
 const where=[r.scope.address&&`주소 ${mdCell(r.scope.address)}`,r.scope.businessPhone&&`전화 ${mdCell(r.scope.businessPhone)}`].filter(Boolean).join(' · ');
 return [`# 주간 고객 보고서 · ${mdCell(r.scope.name)} · ${r.period.week}`,'',`기간: ${r.period.from} ~ ${r.period.to} (${r.period.timeZone}, 월~일) · 형식: ${r.schema}`,...(where?['',where]:[]),'',...r.notices.slice(0,2).map(n=>`> ${n}`),'',...markdownTables(r),...markdownLists(r)].join('\n');
}

// CSV: 한 줄에 값 하나(section,key,label,unit,value,previous). 셀 수식 방지·BOM·CRLF는 fact-pack csvText가 한다.
type CsvRow=[string,string,string,string,unknown,unknown];
const unitOf=(id:string)=>METRIC.get(id)?.unit??'';
function csvRows(r:CustomerReport):CsvRow[]{
 return [
  ['scope','name','이름','text',r.scope.name,null],['scope','address','주소','text',r.scope.address,null],['scope','businessPhone','사업장 전화','text',r.scope.businessPhone,null],
  ['period','week','보고 주','text',r.period.week,r.period.previousWeek],['period','from','시작일','text',r.period.from,null],['period','to','종료일','text',r.period.to,null],
  ...LEDGER_KEYS.map(k=>['ledger',k,label(k),unitOf(k),r.ledger.current[k],r.ledger.previous[k]] as CsvRow),
  ...r.completeness.flatMap(c=>[['completeness',`${c.week}.status`,`${c.week} 상태`,'text',c.status,null] as CsvRow,...CHECK_KEYS.map(k=>['completeness',`${c.week}.${k}`,`${c.week} ${label(k)}`,unitOf(k),c[k],null] as CsvRow)]),
  ['northStar','measured',label('measured'),'flag',r.northStar.measured,null],['northStar','weeks','통과 주','text',r.northStar.weeks.join(' '),null],
  ...(['passedWeeks','excludedWeeks','northStarOrders','northStarContribution'] as const).map(k=>['northStar',k,label(k),unitOf(k),r.northStar[k],null] as CsvRow),
  ...r.channels.flatMap(c=>CHANNEL_KEYS.map(k=>['channel',`${c.key}.${k}`,`${c.label} · ${label(k)}`,unitOf(k),c[k],null] as CsvRow)),
  ...r.spendWarnings.map((s,i)=>['warning',`spend.${i}`,s.message,'krw',s.adSpend,null] as CsvRow),
  ...r.connectors.flatMap((c,i)=>[...Object.entries(c.values).map(([k,v])=>['connector',`${c.connector}.${i}.${k}`,`${c.label} ${c.window.from}~${c.window.to} ${label(k)}`,unitOf(k),v,null] as CsvRow),...c.limitations.map((l,j)=>['connector',`${c.connector}.${i}.limitation.${j}`,l,'text',null,null] as CsvRow)]),
  ...r.publications.byStatus.map(p=>['publication',p.status,p.label,'count',p.count,null] as CsvRow),['publication','total','이번 주 예약 발행','count',r.publications.total,null],
  ...r.todos.dataRequests.map((d,i)=>['todo',`dataRequest.${i}`,d.label,'text','open',null] as CsvRow),...r.todos.placeMismatches.map(p=>['todo',`place.${p.field}`,p.label,'text',p.state,null] as CsvRow),
  ...(r.facts?[['fact','effective','확정 사실','count',r.facts.effective,null],['fact','expiringSoon','14일 안 만료','count',r.facts.expiringSoon,null],['fact','rejected','거절 사실','count',r.facts.rejected,null],...(['candidate','expired','unsupported','franchise'] as const).map(k=>['fact',`excluded.${k}`,`제외 ${k}`,'count',r.facts!.excluded[k],null] as CsvRow)] as CsvRow[]:[]),
  ...r.masking.map(m=>['masking',m.field,m.kind,'count',m.count,null] as CsvRow),
  ...r.notices.map((n,i)=>['notice',`notice.${i}`,n,'text',null,null] as CsvRow),
 ];
}
export const reportCsv=(r:CustomerReport)=>csvText([['section','key','label','unit','value','previous'],...csvRows(r)]);

const FORMATS=['json','md','csv'] as const;
const safeId=(s:string)=>s.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80);
export function reportFileName(r:Pick<CustomerReport,'scope'|'period'>,format:string):string{
 if(!(FORMATS as readonly string[]).includes(format))throw new Error('보고서 형식은 json·md·csv 중 하나입니다.');
 return `customer-report-${r.scope.type}-${safeId(r.scope.id)}-${r.period.week}.${format}`;
}
