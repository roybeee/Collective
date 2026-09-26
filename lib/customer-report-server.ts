// 주간 고객 보고서 서버(A8-2, docs/CUSTOMER-REPORT.ko.md 3·5·10절). 미리보기(저장 안 함)·동결(freeze)·대표 검토(review)·동결본 목록·다운로드·사실 팩.
// 스위치 a8_customer_report(기본 꺼짐)는 이 파일에서만 읽고 읽기 실패는 꺼짐으로 본다. 꺼지면 미리보기·동결·검토·사실 팩은 409이고, 동결본 목록·다운로드는 계속 읽힌다.
// 권한(대표 결정 D2): 미리보기·목록·다운로드·사실 팩·동결은 대표·관리자(직원 403), 검토는 대표만. 호출자(app/api/customer-reports/route.ts)가 쓰기에 소유자 잠금·빈도 제한을 잡는다. 외부 공유 링크는 없다(D1).
// 숫자는 점포 귀속 보고(lib/store-operations-server.ts attributionReport)와 같은 입력이다: 주문은 게시 관문을 지금 게시 상태로 다시 본 것(publicationGateView), 일별 합계는 regateDays를 거친 것.
// payload는 lib/customer-report.ts 순수 빌더가 지표 사전 키만으로 만든다. 모델·외부 네트워크 호출은 0이다(토큰 0).
import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str,type Actor} from './server';
import type {Brand} from './agency';
import type {Store} from './store-marketing';
import type {Publication} from './execution';
import type {MeasurementDraft} from './measurement-collection';
import type {DataRequest} from './data-requests';
import type {PlaceSnapshot} from './place-check';
import {effectiveBrandFacts} from './brand-facts';
import {canonicalFactKey} from './fact-catalog';
import {koreaToday,type StoreOrder,type StoreSpend} from './store-operations';
import {addDays,publicationGateView,regateDays,weeklyCompletenessFromDays,type DayTotal,type PosWeeklyTotal} from './store-attribution';
import {gatesOf,ledgerDays,publicationOrders,recordsByIds} from './store-operations-server';
import {isEnabled} from './feature-flags';
import {REPORT_TRAILING_WEEKS,aggregateLedger,buildReport,reportCsv,reportFileName,reportMarkdown,reportWeek,weekClosed,type ConnectorDraftInput,type CustomerReport,type ReportWeek} from './customer-report';
import {buildFactPack,factPackCsv,factPackInput,factPackMarkdown,type PackSourceFact} from './fact-pack';

// 동결 payload 상한(UTF-8 바이트). 행에는 이전 판 5개까지 두므로 행은 약 1.2MB 이하다(D1 행 상한 2MB 안).
export const REPORT_MAX_BYTES=200_000,REPORT_HISTORY=5,LIST_MAX_WEEKS=26;
const ROW_LIMIT=5000;
export const CUSTOMER_REPORT_MESSAGES={
 off:'고객 보고서 기능이 꺼져 있습니다. 소유자가 기능 스위치 a8_customer_report를 켜야 합니다.',
 adminOnly:'고객 보고서 미리보기·목록·다운로드·동결과 사실 팩은 대표·관리자만 할 수 있습니다.',
 ownerOnly:'고객 보고서 검토는 대표만 할 수 있습니다.',
 scope:'지점(storeId) 또는 브랜드(brandId)를 정하세요.',
 week:'보고 주는 있는 ISO 주(YYYY-Www)로 정하세요.',
 future:'아직 시작하지 않은 주입니다. 이번 주까지 미리 볼 수 있습니다.',
 open:'끝난 주(일요일까지, 한국 날짜)만 동결할 수 있습니다.',
 confirm:'동결할 보고서를 확인한 뒤(confirmed:true) 확인한 값(주문 수·순매출·POS 대조 상태)을 함께 보내세요.',
 changed:'확인한 뒤 장부가 바뀌어 보고서가 달라졌습니다. 다시 불러와 확인한 뒤 동결하세요.',
 tooLarge:`보고서가 ${REPORT_MAX_BYTES.toLocaleString('ko-KR')}바이트를 넘어 동결하지 않았습니다. 열린 자료 요청 등 할 일을 정리한 뒤 다시 시도하세요.`,
 version:'보고서 판이 바뀌었습니다. 새로 불러와 지금 판을 검토하세요.',
 id:'보고서 id는 <store|brand>:<id>:<YYYY-Www>입니다.',
 format:'형식은 json·md·csv 중 하나입니다.',
 range:`목록 기간은 시작 주(from)부터 끝 주(to)까지 ${LIST_MAX_WEEKS}주 이하로 정하세요.`,
} as const;
const M=CUSTOMER_REPORT_MESSAGES;

export type ReportActor={id:string;role:Actor['role']};
export type ReportReview={status:'reviewed';reportVersion:number;by:{id:string;role:'owner'};at:string};
type FrozenVersion={version:number;report:CustomerReport;inputHash:string;frozenAt:string;frozenBy:ReportActor;review:ReportReview|null};
export type FrozenReport=FrozenVersion&{id:string;scope:{type:'store'|'brand';id:string;brandId:string};week:string;history:FrozenVersion[]};
type Scope={type:'store'|'brand';id:string;brand:Brand;stores:Store[]};

export async function customerReportOn(owner:string){
 return isEnabled(owner,'a8_customer_report').catch(()=>{console.error('a8_customer_report_flag_unreadable');return false});
}
async function requireOn(owner:string){if(!await customerReportOn(owner))throw new ApiError(409,M.off)}
const blank=(v:unknown)=>v===undefined||v===null||v==='';
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length;
async function sha256(text:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')}
async function readOptional<T>(owner:string,kind:string,id:string):Promise<T|undefined>{
 try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return undefined;throw e}
}

// ── 범위·주 ──
// storeId가 있으면 지점 범위(brandId를 함께 보내면 같은 브랜드여야 한다), 없으면 브랜드 범위(보관 지점 포함 브랜드의 모든 지점). 다른 워크스페이스·없는 기록은 404다.
async function scopeOf(owner:string,raw:{storeId?:unknown;brandId?:unknown}):Promise<Scope>{
 const storeId=blank(raw.storeId)?'':str(raw.storeId,'지점',100,true),brandId=blank(raw.brandId)?'':str(raw.brandId,'브랜드',100,true);
 if(storeId){
  const store=await readRecord<Store>(owner,'store',storeId);
  if(brandId&&store.brandId!==brandId)throw new ApiError(404,'해당 브랜드의 지점이 아닙니다.');
  return {type:'store',id:store.id,brand:await readRecord<Brand>(owner,'brand',store.brandId),stores:[store]};
 }
 if(!brandId)throw new ApiError(400,M.scope);
 const brand=await readRecord<Brand>(owner,'brand',brandId);
 return {type:'brand',id:brand.id,brand,stores:await listRecords<Store>(owner,'store',brand.id)};
}
function weekOf(raw:unknown):ReportWeek{const w=typeof raw==='string'?reportWeek(raw.trim()):null;if(!w)throw new ApiError(400,M.week);return w}
// 보고 주·전주(장부), 보고 주를 포함한 최근 4주(POS 대조·north-star)의 날짜 경계.
const span=(w:ReportWeek)=>({first:addDays(w.from,-7*(REPORT_TRAILING_WEEKS-1)),prev:addDays(w.from,-7),to:w.to});
export const reportId=(type:'store'|'brand',id:string,week:string)=>`${type}:${id}:${week}`;
function parseId(raw:unknown){const m=/^(store|brand):([^:]{1,100}):(\d{4}-W\d{2})$/.exec(typeof raw==='string'?raw:'');if(!m||!reportWeek(m[3]))throw new ApiError(400,M.id);return m[0]}

// ── 지점 장부 입력(attributionReport와 같은 게시 관문 재검사) ──
const field=(path:string)=>`json_extract(data,'$.${path}')`;
async function storeRows<T>(owner:string,kind:string,storeId:string,where:string,binds:unknown[]):Promise<T[]>{
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? AND ${where} LIMIT ${ROW_LIMIT+1}`).bind(owner,kind,storeId,...binds).all<{data:string}>();
 if(rows.results.length>ROW_LIMIT)throw new ApiError(400,'조회 결과가 5,000건을 초과합니다. 보고 주의 주문·비용 기록을 확인해 주세요.');
 return rows.results.map(r=>JSON.parse(r.data) as T);
}
type StoreData={orders:StoreOrder[];spend:StoreSpend[];days:DayTotal[];pos:PosWeeklyTotal[]};
// 주문: 전주~보고 주(게시 관문 재검사). 비용: 전주~보고 주와, 보고 주 안에서 시작해 뒤 주 날짜(종료일)로 기록된 네이버 수집 광고비(주를 걸친 창 경고용, 장부에는 들어가지 않는다).
// 일별 합계·POS: 최근 4주. 일별 합계는 SQL 합계(ledgerDays)에 게시 관문으로 귀속이 바뀐 주문만큼만 고친다(regateDays).
async function storeData(owner:string,storeId:string,w:ReportWeek):Promise<StoreData>{
 const {first,prev,to}=span(w),date=field('date'),id=field('id');
 const [stored,spend,days,coded,pos]=await Promise.all([
  storeRows<StoreOrder>(owner,'store_order',storeId,`${field('orderDate')} >= ? AND ${field('orderDate')} <= ?`,[prev,to]),
  storeRows<StoreSpend>(owner,'store_spend',storeId,`((${date} >= ? AND ${date} <= ?) OR (${date} > ? AND ${id} LIKE 'naver-%' AND substr(${id},-10) <= ?))`,[prev,to,to,to]),
  ledgerDays(owner,storeId,first,to),publicationOrders(owner,storeId,first,to),listRecords<PosWeeklyTotal>(owner,'pos_weekly_total',storeId)]);
 const gates=gatesOf(await recordsByIds<Publication>(owner,'execution_publication',coded.flatMap(o=>o.codeAttribution?.publicationId?[o.codeAttribution.publicationId]:[])));
 const moved=coded.filter(o=>publicationGateView(o,gates)!==o);
 return {orders:stored.map(o=>publicationGateView(o,gates)),spend,days:regateDays(days,moved,moved.map(o=>publicationGateView(o,gates))),pos:pos.filter(p=>p.weekStart>=first&&p.weekStart<=w.from)};
}

// 브랜드 범위 POS 합산 규칙(A8-1 남은 과제, 지점별 대조 후 합산). 주마다 그 주에 장부 일별 합계나 POS 합계가 있는 지점(참여 지점)만 본다.
// 참여 지점 하나라도 POS 합계가 없으면 브랜드 POS를 두지 않는다(missing_pos). 모두 있으면 지점마다 먼저 대조하고, 합을 브랜드 POS로 둔다(주문 수는 하나라도 없으면 null).
// 모든 참여 지점이 통과면 합도 통과다(허용 오차 합이 합의 허용 오차 안). 지점 불일치가 합에서 상쇄돼 통과로 보이면 브랜드 POS를 두지 않는다(통과로 세지 않고 north-star에서 뺀다).
export function brandPosTotals(parts:readonly Pick<StoreData,'days'|'pos'>[],weeks:readonly string[]):PosWeeklyTotal[]{
 const sum=(ns:number[])=>Math.round(ns.reduce((a,b)=>a+b,0)*100)/100;
 return weeks.flatMap(start=>{
  const end=addDays(start,6),active=parts.flatMap(p=>{const pos=p.pos.find(x=>x.weekStart===start),days=p.days.filter(d=>d.day>=start&&d.day<=end);return pos||days.length?[{pos,days}]:[]});
  if(!active.length||active.some(a=>!a.pos))return [];
  const list=active.map(a=>a.pos as PosWeeklyTotal);
  const total:PosWeeklyTotal={id:`brand-${start}`,storeId:'',weekStart:start,netSales:sum(list.map(p=>p.netSales)),orderCount:list.some(p=>p.orderCount===null)?null:sum(list.map(p=>p.orderCount??0)),source:'지점 POS 합계',note:'',version:1,createdAt:'',updatedAt:'',updatedBy:{id:'',email:null}};
  if(active.every((a,i)=>weeklyCompletenessFromDays([start],a.days,[list[i]])[0].status==='pass'))return [total];
  return weeklyCompletenessFromDays([start],active.flatMap(a=>a.days),[total])[0].status==='pass'?[]:[total];
 });
}

// ── 보고서 문맥: 커넥터 초안·발행·자료 요청·플레이스 대조·사실 ──
// 지점 범위는 그 지점 캠페인과 브랜드 공통 캠페인(수집 광고비 옮기기와 같은 범위), 브랜드 범위는 브랜드의 모든 캠페인. 원문 행을 넘겨도 빌더는 사전 키만 읽는다.
const scopedFacts=(facts:readonly PackSourceFact[],scope:Scope)=>facts.filter(f=>!f.storeId||(scope.type==='store'&&f.storeId===scope.id));
async function contextOf(owner:string,scope:Scope,w:ReportWeek){
 const one=scope.type==='store'?scope.id:null,campaignStore=one?" AND COALESCE(json_extract(c.data,'$.storeId'),'') IN ('',?)":'',storeBind=one?[one]:[];
 const [drafts,publications,requests,snapshots,facts]=await Promise.all([
  database().prepare(`SELECT d.data AS data FROM records d JOIN records e ON e.id=d.owner||':viral_experiment:'||json_extract(d.data,'$.experimentId') AND e.owner=d.owner AND e.kind='viral_experiment' JOIN records c ON c.id=d.owner||':campaign:'||json_extract(e.data,'$.campaignId') AND c.owner=d.owner AND c.kind='campaign' WHERE d.owner=? AND d.kind='measurement_draft' AND json_extract(d.data,'$.channel') IN ('naver_ads','instagram') AND json_extract(c.data,'$.brandId')=?${campaignStore} AND json_extract(d.data,'$.window.from') <= ? AND json_extract(d.data,'$.window.to') >= ? LIMIT 200`).bind(owner,scope.brand.id,...storeBind,w.to,w.from).all<{data:string}>(),
  database().prepare(`SELECT p.data AS data FROM records p JOIN records c ON c.id=p.owner||':campaign:'||json_extract(p.data,'$.campaignId') AND c.owner=p.owner AND c.kind='campaign' WHERE p.owner=? AND p.kind='execution_publication' AND json_extract(c.data,'$.brandId')=?${campaignStore} AND json_extract(p.data,'$.scheduledAt') >= ? AND json_extract(p.data,'$.scheduledAt') < ? LIMIT 2000`).bind(owner,scope.brand.id,...storeBind,addDays(w.from,-1),addDays(w.to,2)).all<{data:string}>(),
  listRecords<DataRequest>(owner,'data_request',scope.brand.id),Promise.all(scope.stores.map(s=>listRecords<PlaceSnapshot>(owner,'place_snapshot',s.id))),listRecords<PackSourceFact>(owner,'brand_fact',scope.brand.id)]);
 const now=Date.now(),mine=scopedFacts(facts,scope),storeId=one??undefined,store=one?scope.stores[0]:null,input=factPackInput(mine,scope.brand.id,storeId,now);
 const pack=buildFactPack({...input,scope:{brandId:scope.brand.id,brandName:scope.brand.name,...(store?{storeId:store.id,storeName:store.name,storeAddress:store.address}:{})},now});
 const connectors=drafts.results.map(r=>{const d=JSON.parse(r.data) as MeasurementDraft;return {channel:d.channel,window:d.window,definition:d.definition,limitations:d.limitations,fetchedAt:d.fetchedAt,storeValues:d.storeValues,arms:d.arms} as ConnectorDraftInput});
 return {connectors,publications:publications.results.map(r=>{const p=JSON.parse(r.data) as Publication;return {status:p.status,scheduledAt:p.scheduledAt}}),
  dataRequests:requests.filter(r=>!one||!r.storeId||r.storeId===one).map(r=>({status:r.status,label:r.label})),placeChecks:snapshots.flat().flatMap(s=>s.result.map(x=>({field:x.field,state:x.state}))),
  facts:pack.counts,allow:input.confirmed.map(f=>f.value),phone:effectiveBrandFacts(mine,scope.brand.id,storeId,now).find(f=>canonicalFactKey(f.key)==='phone')?.value};
}

async function reportFor(owner:string,scope:Scope,w:ReportWeek):Promise<CustomerReport>{
 const [parts,ctx]=await Promise.all([Promise.all(scope.stores.map(s=>storeData(owner,s.id,w))),contextOf(owner,scope,w)]);
 const {first}=span(w),weeks=Array.from({length:REPORT_TRAILING_WEEKS},(_,i)=>addDays(first,7*i)),store=scope.type==='store'?scope.stores[0]:null;
 return buildReport({scope:{type:scope.type,id:scope.id,brandId:scope.brand.id,name:store?store.name:scope.brand.name,...(store?.address?{address:store.address}:{}),...(ctx.phone?{businessPhone:ctx.phone}:{})},
  week:w.week,ledger:aggregateLedger(w.week,parts.flatMap(p=>p.orders),parts.flatMap(p=>p.spend)),days:parts.flatMap(p=>p.days),posTotals:store?parts[0].pos:brandPosTotals(parts,weeks),
  connectors:ctx.connectors,publications:ctx.publications,dataRequests:ctx.dataRequests,placeChecks:ctx.placeChecks,facts:ctx.facts,allow:ctx.allow});
}
// 동결 확인 값: 보고 주의 주문 수·순매출·POS 대조 상태.
const confirmOf=(r:CustomerReport)=>({orders:r.ledger.current.orders,netRevenue:r.ledger.current.netRevenue,posStatus:r.completeness.find(c=>c.week===r.period.week)?.status??null});

// ── 입력 지문(변경 감지) ──
// 동결 때와 읽을 때 같은 함수로 만든다. 주문(최근 4주)·비용(전주~보고 주)은 날짜별 행 수·판 합·마지막 저장 시각, 주를 걸친 네이버 수집 광고비·POS 합계는 행별 판·저장 시각,
// 게시 코드 주문의 게시는 {id, 판, 상태}(게시 관문이 바뀌면 귀속이 바뀐다), 사실은 {id, 판}이다. 어느 하나라도 바뀌면 stale이다(값이 같게 되돌아와도 바뀐 것으로 본다).
type Stamp={day:string;n:number;v:number;at:string};
type Prints={storeId:string;orders:Stamp[];spend:Stamp[];naver:{id:string;v:number;day:string;at:string}[];pos:{week:string;v:number;at:string}[];coded:{day:string;p:string}[]};
async function storePrints(owner:string,storeId:string,from:string,to:string):Promise<Prints>{
 const db=database(),stamps=(kind:string,key:string,a:string,b:string)=>db.prepare(`SELECT ${field(key)} AS day, COUNT(*) AS n, SUM(COALESCE(${field('version')},0)) AS v, MAX(updated_at) AS at FROM records WHERE owner=? AND kind=? AND parent_id=? AND ${field(key)} >= ? AND ${field(key)} <= ? GROUP BY day`).bind(owner,kind,storeId,a,b).all<Stamp>().then(r=>r.results.map(x=>({day:String(x.day),n:Number(x.n),v:Number(x.v),at:String(x.at)})).sort((x,y)=>x.day<y.day?-1:1));
 const [orders,spend,naver,pos,coded]=await Promise.all([stamps('store_order','orderDate',from,to),stamps('store_spend','date',from,to),
  db.prepare(`SELECT ${field('id')} AS id, ${field('version')} AS v, ${field('date')} AS day, updated_at AS at FROM records WHERE owner=? AND kind='store_spend' AND parent_id=? AND ${field('id')} LIKE 'naver-%' AND ${field('date')} > ? ORDER BY id`).bind(owner,storeId,from).all<{id:string;v:number;day:string;at:string}>(),
  db.prepare(`SELECT ${field('weekStart')} AS week, ${field('version')} AS v, updated_at AS at FROM records WHERE owner=? AND kind='pos_weekly_total' AND parent_id=? ORDER BY week`).bind(owner,storeId).all<{week:string;v:number;at:string}>(),
  db.prepare(`SELECT DISTINCT ${field('orderDate')} AS day, ${field('codeAttribution.publicationId')} AS p FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND ${field('orderDate')} >= ? AND ${field('orderDate')} <= ? AND ${field('codeAttribution.publicationId')} IS NOT NULL`).bind(owner,storeId,from,to).all<{day:string;p:string}>()]);
 return {storeId,orders,spend,naver:naver.results.map(x=>({...x})),pos:pos.results.map(x=>({...x})),coded:coded.results.map(x=>({...x}))};
}
type PrintSet={stores:Map<string,Prints>;publications:Map<string,Publication>;facts:PackSourceFact[]};
async function printSet(owner:string,brandId:string,storeIds:readonly string[],from:string,to:string):Promise<PrintSet>{
 const [prints,facts]=await Promise.all([Promise.all(storeIds.map(id=>storePrints(owner,id,from,to))),listRecords<PackSourceFact>(owner,'brand_fact',brandId)]);
 const publications=await recordsByIds<Publication>(owner,'execution_publication',prints.flatMap(p=>p.coded.map(c=>c.p)));
 return {stores:new Map(prints.map(p=>[p.storeId,p])),publications,facts};
}
function fingerprint(set:PrintSet,scope:Pick<Scope,'type'|'id'>&{storeIds:readonly string[]},w:ReportWeek){
 const {first,prev,to}=span(w),inside=(day:string,a:string,b:string)=>day>=a&&day<=b;
 const stores=scope.storeIds.flatMap(id=>{const p=set.stores.get(id);if(!p)return [];
  const body={orders:p.orders.filter(s=>inside(s.day,first,to)),spend:p.spend.filter(s=>inside(s.day,prev,to)),naver:p.naver.filter(n=>n.day>to&&n.id.slice(-10)<=to),pos:p.pos.filter(x=>inside(x.week,first,w.from)),
   publications:[...new Set(p.coded.filter(c=>inside(c.day,first,to)).map(c=>c.p))].sort().map(id=>{const x=set.publications.get(id);return [id,x?.version??null,x?.status??null]})};
  return Object.values(body).some(v=>v.length)?[{store:id,...body}]:[]});
 const facts=set.facts.filter(f=>!f.storeId||(scope.type==='store'&&f.storeId===scope.id)).map(f=>[f.id,f.version] as const).sort((a,b)=>a[0]<b[0]?-1:1);
 return sha256(JSON.stringify({week:w.week,stores,facts}));
}
const scopeHash=async(owner:string,scope:Scope,w:ReportWeek)=>{const ids=scope.stores.map(s=>s.id),{first}=span(w);return fingerprint(await printSet(owner,scope.brand.id,ids,first,w.to),{type:scope.type,id:scope.id,storeIds:ids},w)};

// ── 조회 ──
const versionOf=(r:FrozenVersion):FrozenVersion=>({version:r.version,report:r.report,inputHash:r.inputHash,frozenAt:r.frozenAt,frozenBy:r.frozenBy,review:r.review});
const entryOf=(r:FrozenReport,stale:boolean)=>({id:r.id,scope:r.scope,week:r.week,version:r.version,frozenAt:r.frozenAt,frozenBy:r.frozenBy,review:r.review,stale,versions:[r,...r.history].map(v=>({version:v.version,frozenAt:v.frozenAt,review:v.review}))});
// 미리보기: 요청할 때 계산하고 저장하지 않는다. 진행 중인 주도 볼 수 있다(closed:false, 동결은 400). 같은 id의 동결본과 stale을 함께 준다.
export async function previewReport(owner:string,p:URLSearchParams){
 await requireOn(owner);
 const scope=await scopeOf(owner,{storeId:p.get('storeId'),brandId:p.get('brandId')}),w=weekOf(p.get('week')),today=koreaToday();
 if(w.from>today)throw new ApiError(400,M.future);
 const id=reportId(scope.type,scope.id,w.week),[report,frozen]=await Promise.all([reportFor(owner,scope,w),readOptional<FrozenReport>(owner,'customer_report',id)]),size=bytes(report);
 return {enabled:true,id,closed:weekClosed(w.week,today),preview:report,confirm:confirmOf(report),bytes:size,maxBytes:REPORT_MAX_BYTES,tooLarge:size>REPORT_MAX_BYTES,frozen:frozen?[entryOf(frozen,frozen.inputHash!==await scopeHash(owner,scope,w))]:[]};
}
// 동결본 목록: 브랜드(brandId)의 지점·브랜드 보고서, storeId로 한 지점만. from·to는 ISO 주, 최대 26주. 스위치가 꺼져도 읽는다.
export async function listReports(owner:string,p:URLSearchParams){
 const brand=await readRecord<Brand>(owner,'brand',str(p.get('brandId')??'','브랜드',100,true)),storeId=str(p.get('storeId')??'','지점',100);
 if(storeId&&(await readRecord<Store>(owner,'store',storeId)).brandId!==brand.id)throw new ApiError(404,'해당 브랜드의 지점이 아닙니다.');
 const from=weekOf(p.get('from')),to=weekOf(p.get('to')),weeks=Math.round((Date.parse(to.from)-Date.parse(from.from))/(7*86400000))+1;
 if(weeks<1||weeks>LIST_MAX_WEEKS)throw new ApiError(400,M.range);
 const rows=(await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='customer_report' AND parent_id=? AND ${field('week')} >= ? AND ${field('week')} <= ? ORDER BY id`).bind(owner,brand.id,from.week,to.week).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as FrozenReport).filter(r=>!storeId||(r.scope.type==='store'&&r.scope.id===storeId));
 const stores=rows.some(r=>r.scope.type==='brand')?(await listRecords<Store>(owner,'store',brand.id)).map(s=>s.id):[...new Set(rows.map(r=>r.scope.id))];
 const set=rows.length?await printSet(owner,brand.id,stores,span(from).first,to.to):null;
 const frozen=await Promise.all(rows.map(async r=>{const w=weekOf(r.week),hash=await fingerprint(set!,{type:r.scope.type,id:r.scope.id,storeIds:r.scope.type==='store'?[r.scope.id]:stores},w);return entryOf(r,hash!==r.inputHash)}));
 return {enabled:await customerReportOn(owner),preview:null,frozen};
}

// ── 다운로드(첨부) ──
const TYPES={json:'application/json; charset=utf-8',md:'text/markdown; charset=utf-8',csv:'text/csv; charset=utf-8'} as const;
type Format=keyof typeof TYPES;
export type Attachment={body:string;type:string;fileName:string};
function formatOf(raw:unknown):Format{if(typeof raw!=='string'||!Object.hasOwn(TYPES,raw))throw new ApiError(400,M.format);return raw as Format}
const render=(r:CustomerReport,f:Format)=>f==='json'?JSON.stringify(r,null,1):f==='md'?reportMarkdown(r):reportCsv(r);
// 동결본만 받는다(미리보기는 받지 않는다). version을 주면 이전 판(최대 5개)에서 찾는다. 스위치가 꺼져도 받는다.
export async function downloadReport(owner:string,p:URLSearchParams):Promise<Attachment>{
 const id=parseId(p.get('id')),format=formatOf(p.get('format')),row=await readRecord<FrozenReport>(owner,'customer_report',id);
 const want=blank(p.get('version'))?row.version:Number(p.get('version')),found=[row,...row.history].find(v=>v.version===want);
 if(!found)throw new ApiError(404,'그 판의 보고서가 없습니다. 이전 판은 최근 5개까지 남습니다.');
 return {body:render(found.report,format),type:TYPES[format],fileName:reportFileName(found.report,format)};
}
// 사실 팩: 브랜드(선택 지점) 확정 사실. 스위치가 꺼지면 409다(새로 계산해 내보내는 기능이다).
export async function factPackFile(owner:string,p:URLSearchParams):Promise<Attachment>{
 await requireOn(owner);
 const brandId=str(p.get('brandId')??'','브랜드',100,true),scope=await scopeOf(owner,{storeId:p.get('storeId'),brandId}),format=formatOf(p.get('format')),now=Date.now();
 const store=scope.type==='store'?scope.stores[0]:null,facts=scopedFacts(await listRecords<PackSourceFact>(owner,'brand_fact',scope.brand.id),scope);
 const pack=buildFactPack({...factPackInput(facts,scope.brand.id,store?.id,now),scope:{brandId:scope.brand.id,brandName:scope.brand.name,...(store?{storeId:store.id,storeName:store.name,storeAddress:store.address}:{})},now});
 const safe=(s:string)=>s.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80),name=['fact-pack',safe(scope.brand.id),...(store?[safe(store.id)]:[]),koreaToday()].join('-');
 return {body:format==='json'?JSON.stringify(pack,null,1):format==='md'?factPackMarkdown(pack):factPackCsv(pack),type:TYPES[format],fileName:`${name}.${format}`};
}

// ── 쓰기(호출자가 소유자 잠금·빈도 제한을 잡는다) ──
// 동결: 끝난 주만, 확인 필수(confirmed:true·expected). 지금 계산한 값이 확인 값과 다르면 409, 크기 상한을 넘으면 413. 다시 동결하면 version+1이고 이전 판은 history(최근 5개)에 검토와 함께 남는다.
async function freezeReport(owner:string,input:Record<string,unknown>,who:ReportActor){
 const scope=await scopeOf(owner,input),w=weekOf(input.week);
 if(!weekClosed(w.week,koreaToday()))throw new ApiError(400,M.open);
 const expected=record(input.expected)?input.expected:null;
 if(input.confirmed!==true||!expected)throw new ApiError(400,M.confirm);
 const report=await reportFor(owner,scope,w),confirm=confirmOf(report);
 if(expected.orders!==confirm.orders||expected.netRevenue!==confirm.netRevenue||expected.posStatus!==confirm.posStatus)throw new ApiError(409,M.changed);
 if(bytes(report)>REPORT_MAX_BYTES)throw new ApiError(413,M.tooLarge);
 const id=reportId(scope.type,scope.id,w.week),[old,inputHash]=await Promise.all([readOptional<FrozenReport>(owner,'customer_report',id),scopeHash(owner,scope,w)]);
 const row:FrozenReport={id,scope:{type:scope.type,id:scope.id,brandId:scope.brand.id},week:w.week,version:(old?.version??0)+1,report,inputHash,frozenAt:stamp(),frozenBy:{id:who.id,role:who.role},review:null,history:old?[versionOf(old),...old.history].slice(0,REPORT_HISTORY):[]};
 await recordStatement(owner,'customer_report',id,row,scope.brand.id).run();
 return {id,version:row.version,stale:false};
}
// 대표 검토: 지금 판(version)에만 남긴다. 옛 판·모르는 판은 409, 같은 판을 다시 검토하면 쓰지 않고 그 검토를 돌려준다. 검토자는 id·역할만 남긴다.
async function reviewReport(owner:string,input:Record<string,unknown>,who:ReportActor){
 const id=parseId(input.id),row=await readRecord<FrozenReport>(owner,'customer_report',id);
 if(input.version!==row.version)throw new ApiError(409,M.version);
 if(row.review?.reportVersion===row.version)return {id,version:row.version,review:row.review};
 const review:ReportReview={status:'reviewed',reportVersion:row.version,by:{id:who.id,role:'owner'},at:stamp()};
 await recordStatement(owner,'customer_report',id,{...row,review},row.scope.brandId).run();
 return {id,version:row.version,review};
}
// 판정 순서: 모르는 작업 400 → 권한 403 → 스위치 꺼짐 409 → 범위(없음·다른 워크스페이스 404) → 입력 400 → 확인 값 409 → 크기 413.
export async function customerReportAction(owner:string,input:Record<string,unknown>,who:ReportActor){
 const action=input.action;
 if(action!=='freeze'&&action!=='review')throw new ApiError(400,'지원하지 않는 고객 보고서 작업입니다.');
 if(action==='review'&&who.role!=='owner')throw new ApiError(403,M.ownerOnly);
 if(who.role==='member')throw new ApiError(403,M.adminOnly);
 await requireOn(owner);
 return action==='freeze'?freezeReport(owner,input,who):reviewReport(owner,input,who);
}
