// 캠페인 상세 '성과' 탭의 주문 장부 귀속 집계와 그 스냅샷(PR 4b-2, loop-3 잔여·exec-loop-4 권고 (5)). 기준은 점포 귀속 보고(lib/store-operations-server.ts attributionReport)와 같다.
// 주문 집합: 데이터의 campaignId가 이 캠페인인 주문. 캠페인 삭제 차단(lib/record-kinds.ts store_order의 data_campaign)과 같은 기준이라 보관한 지점의 주문도 남아 있으면 센다.
// 범위: 지점 캠페인은 그 지점, 브랜드 공통 캠페인은 같은 브랜드의 모든 지점 주문을 합친다. 다른 브랜드·지점 주문(어긋난 기록)은 빼고 건수를 알린다.
// 게시 관문은 지금 게시 상태로 다시 본다(publicationGateView). 원가를 모르는 주문이 있으면 공헌이익은 null이다(추정하지 않고 0으로 바꾸지 않는다). 광고비는 배분하지 않는다. 귀속≠증분.
import type {Campaign,Metric} from './agency';
import {ApiError,database,listRecords} from './server';
import type {Publication} from './execution';
import type {Store} from './store-marketing';
import {koreaToday,type StoreOrder} from './store-operations';
import {gatesOf,operationDate,recordsByIds,reportLabels} from './store-operations-server';
import type {TrackingCode} from './tracking-codes';
import {ATTRIBUTION_NOT_INCREMENTAL,addDays,attributionBreakdown,groupBy,orderMetrics,publicationGateView,weekStart,weeksBetween} from './store-attribution';
import {campaignMeasurement} from './campaign-measurements';

// 기본은 이번 주를 포함한 최근 8주, 최대 26주(182일, 점포 귀속 보고와 같은 한도)다. 주문 행은 5,000건까지 읽는다.
export const ATTRIBUTION_WEEKS={default:8,max:26} as const;
const ROW_LIMIT=5000;
export const SNAPSHOT_SOURCE='주문 장부 귀속';
// 스냅샷의 비교 범위는 캠페인마다 하나다. 같은 기간을 두 번 저장하면 campaignMeasurement의 기간 겹침 규칙이 409로 막는다.
// 지점 캠페인은 그 지점, 브랜드 공통은 같은 브랜드 지점 합산이라 실제 지점은 정의(definition)에 적고, 범위 이름은 두 경우에 모두 맞는 문구로 둔다(지점 연결이 바뀌어도 겹침 판정이 이어진다).
export const SNAPSHOT_SCOPE='주문 장부 귀속 · 이 캠페인 범위 지점의 귀속 주문(정의 참고)';
const blank=(v:unknown)=>v===undefined||v===null||v==='';
const money=(n:number)=>Math.round(n*100)/100;

// 한국 날짜(YYYY-MM-DD). 시작일을 비우면 종료 주의 7주 전 월요일, 종료일을 비우면 오늘이다.
export function attributionPeriod(input:{from?:unknown;to?:unknown}){
 const to=blank(input.to)?koreaToday():operationDate(input.to,'집계 종료일'),from=blank(input.from)?addDays(weekStart(to),-7*(ATTRIBUTION_WEEKS.default-1)):operationDate(input.from,'집계 시작일');
 if(from>to)throw new ApiError(400,'집계 기간을 확인하세요.');
 if(addDays(from,ATTRIBUTION_WEEKS.max*7-1)<to)throw new ApiError(400,`집계 기간은 ${ATTRIBUTION_WEEKS.max*7}일(${ATTRIBUTION_WEEKS.max}주) 이하로 정하세요.`);
 return {from,to};
}
async function campaignRows<T>(owner:string,kind:'store_order'|'tracking_code',campaignId:string,period?:{from:string;to:string}){
 const dated=period?" AND json_extract(data,'$.orderDate') >= ? AND json_extract(data,'$.orderDate') <= ?":'';
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.campaignId')=?${dated} LIMIT ${ROW_LIMIT+1}`).bind(owner,kind,campaignId,...(period?[period.from,period.to]:[])).all<{data:string}>();
 if(rows.results.length>ROW_LIMIT)throw new ApiError(400,'집계할 주문이 5,000건을 넘습니다. 기간을 좁혀 주세요.');
 return rows.results.map(r=>JSON.parse(r.data) as T);
}

// 게시 읽기·게시 관문·소재·게시 이름은 점포 귀속 보고(lib/store-operations-server.ts)와 같은 도우미를 써서 두 화면의 숫자·이름이 갈라지지 않게 한다.
export async function campaignAttribution(owner:string,campaign:Campaign,input:{from?:unknown;to?:unknown}={}){
 const {from,to}=attributionPeriod(input);
 const [stored,stores,codes]=await Promise.all([campaignRows<StoreOrder>(owner,'store_order',campaign.id,{from,to}),listRecords<Store>(owner,'store',campaign.brandId),campaignRows<TrackingCode>(owner,'tracking_code',campaign.id)]);
 const names=new Map(stores.filter(s=>!campaign.storeId||s.id===campaign.storeId).map(s=>[s.id,s.name+(s.status==='archived'?' · 보관':'')]));
 const inScope=stored.filter(o=>names.has(o.storeId)),outOfScope=stored.length-inScope.length;
 const found=await recordsByIds<Publication>(owner,'execution_publication',inScope.flatMap(o=>o.codeAttribution?.publicationId?[o.codeAttribution.publicationId]:[])),gates=gatesOf(found);
 const viewed=inScope.map(o=>publicationGateView(o,gates)),orders=viewed.filter(o=>o.campaignId===campaign.id),gated=viewed.filter((o,i)=>o!==inScope[i]).length,unattributed=viewed.length-orders.length;
 const {creativeLabels,publicationNames}=await reportLabels(owner,orders,found);
 const weeks=weeksBetween(from,to).map(w=>({weekStart:w,start:w<from?from:w,end:[addDays(w,6),to].sort()[0],...orderMetrics(orders.filter(o=>weekStart(o.orderDate)===w))}));
 const notes=[ATTRIBUTION_NOT_INCREMENTAL,campaign.storeId?'지점 캠페인이라 그 지점의 주문만 셉니다.':'브랜드 공통 캠페인이라 같은 브랜드의 모든 지점(보관한 지점 포함) 주문을 합칩니다.','원가를 적지 않은 주문이 있으면 공헌이익은 미확인으로 둡니다(0으로 계산하지 않습니다). 광고비·제작비는 캠페인에 배분하지 않습니다.','POS 합계 대조(주별 완전성)와 north-star는 지점의 주문 장부 → 귀속 보고에서 확인하세요. 이 집계는 대조 전 장부 기준입니다.',
  ...(gated?[`게시 관문 밖 ${gated}건: 게시가 취소·발행 실패·확인 전 상태이거나 주문일이 예약일 전이라 게시·코드 귀속에서 뺐습니다.${unattributed?` 근거를 직접 적지 않은 코드 귀속 ${unattributed}건은 이 캠페인 집계에서도 뺐습니다.`:''} 확인 전 게시가 예약 접수·게시 확인되면 다시 셉니다.`]:[]),
  ...(outOfScope?[`이 캠페인의 브랜드·지점 밖 주문 ${outOfScope}건은 뺐습니다.`]:[])];
 return {campaign:{id:campaign.id,title:campaign.title,storeId:campaign.storeId??null},period:{from,to},scope:campaign.storeId?'store' as const:'brand' as const,stores:[...names].map(([id,name])=>({id,name})),totals:orderMetrics(orders),weeks,
  byStore:groupBy(orders,o=>o.storeId,id=>names.get(id)||'지점 '+id),
  byCreative:groupBy(orders,o=>o.creativeId||'',id=>id?creativeLabels[id]||'소재 '+id:'소재 미지정 · 캠페인만 귀속'),
  byPublication:attributionBreakdown(orders,codes,undefined,publicationNames).byPublication,
  byMethod:groupBy(orders,o=>o.codeAttribution?'code':'manual',key=>key==='code'?'추적 코드 귀속':'수동 귀속'),
  excluded:{outOfScope,publicationGate:gated,unattributedByGate:unattributed},snapshot:{source:SNAPSHOT_SOURCE,scope:SNAPSHOT_SCOPE},notes};
}
export type CampaignAttribution=Awaited<ReturnType<typeof campaignAttribution>>;

// 사용자가 화면에서 확인한 집계를 schemaVersion 2 metric(method 'export', source '주문 장부 귀속')으로 저장할 값. 저장 직전에 서버가 다시 집계한다.
// confirmed:true(확인 대화)와 확인한 값(expected: 주문 수·순매출·공헌이익)이 있어야 하고, 확인한 값은 지금 집계와 같아야 한다(없으면 400, 다르면 409). 검증·기간 겹침(409)은 campaignMeasurement가 한다.
// 종료일이 오늘(한국)이면 400이다. 끝나지 않은 날을 저장하면 그 뒤 들어온 이 기간 주문을 겹침 규칙 때문에 다시 담을 수 없다(수집 광고비 옮기기의 당일 부분 집계 거절과 같은 기준).
const list=(items:readonly string[],limit=10)=>items.slice(0,limit).join(', ')+(items.length>limit?` 외 ${items.length-limit}곳`:'');
export async function attributionSnapshot(owner:string,campaign:Campaign,b:Record<string,unknown>):Promise<Metric>{
 if(blank(b.from)||blank(b.to))throw new ApiError(400,'스냅샷의 집계 기간(시작일·종료일)을 정하세요.');
 if(b.confirmed!==true)throw new ApiError(400,'저장할 집계를 확인한 뒤 저장하세요.');
 const expected=b.expected&&typeof b.expected==='object'&&!Array.isArray(b.expected)?b.expected as Record<string,unknown>:null;
 if(!expected)throw new ApiError(400,'확인한 집계 값(주문 수·순매출·공헌이익)을 함께 보내세요.');
 const period=attributionPeriod({from:b.from,to:b.to});
 if(period.to>=koreaToday())throw new ApiError(400,'오늘 주문은 아직 확정 전입니다. 종료일을 어제까지로 정해 저장하세요.');
 const r=await campaignAttribution(owner,campaign,period),t=r.totals;
 if(!t.records)throw new ApiError(400,'이 기간에 이 캠페인에 귀속된 주문이 없어 저장하지 않았습니다.');
 if(expected.orders!==t.orders||expected.netRevenue!==t.netRevenue||(expected.contribution??null)!==t.contribution)throw new ApiError(409,'확인한 뒤 주문 장부가 바뀌어 집계가 달라졌습니다. 다시 불러와 확인한 뒤 저장하세요.');
 const {from,to}=r.period,count=(key:string)=>r.byMethod.find(g=>g.key===key)?.orders??0,stores=r.stores.map(s=>s.name);
 const definition=[`기간: 한국시간 주문일 ${from} ~ ${to}(주는 월~일).`,`범위: ${campaign.storeId?`지점 캠페인 · ${list(stores)}`:`브랜드 공통 캠페인 · 같은 브랜드 지점 ${stores.length}곳 합산(${list(stores)})`}.`,
  '대상: 주문 장부에서 이 캠페인에 귀속된 주문(추적 코드 귀속과 유입 확인 근거를 적은 수동 귀속). 게시 코드 귀속은 저장할 때의 게시 상태로 게시 관문(예약 접수·게시 확인, 예약일 이후 주문)을 다시 봤다.',
  '계산: 주문 수는 결제 완료이고 전액 환불이 아닌 주문, 순매출은 결제액−환불액, 변동비는 주문 원가(식재료·포장·수수료·배달비·증정)의 합이다. 원가를 적지 않은 주문이 있으면 변동비는 미확인이고 추정하지 않는다. 광고비·제작비는 캠페인에 배분하지 않았다(미확인). POS 합계 대조 전 장부 기준이다.',
  ATTRIBUTION_NOT_INCREMENTAL].join(' ');
 const notes=[`추적 코드 귀속 ${count('code')}건 · 수동 귀속 ${count('manual')}건(취소·전액 환불 제외).`,`지점별: ${r.byStore.map(g=>`${g.label} ${g.orders}건`).join(' · ')}.`,...(t.unknownCostOrders?[`원가 미입력 주문 ${t.unknownCostOrders}건이 있어 변동비·공헌이익은 미확인입니다.`]:[]),...r.notes.filter(x=>x.startsWith('게시 관문 밖')||x.includes('밖 주문'))].join('\n').slice(0,5000);
 return campaignMeasurement(owner,campaign,{schemaVersion:2,periodStart:from,periodEnd:to,scope:SNAPSHOT_SCOPE,source:SNAPSHOT_SOURCE,method:'export',definition,revenue:t.netRevenue,variableCosts:t.contribution===null?null:money(t.netRevenue-t.contribution),adSpend:null,productionCost:null,orders:t.orders,notes});
}
