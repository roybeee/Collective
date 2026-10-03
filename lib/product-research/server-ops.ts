// 상품 리서치 운영 보강(서버 전용, 평가 1회차). 외부 호출 없음.
// - 재계산 감싸기(refreshScores): 자사 판매 스냅샷(own_sales) → 이상치 격리(관측 한 점 단위, 상대값은 표시 우선) → 재계산(server-pipeline.ts) → 소싱 연결 보존 → 점수표 색인
//   → 보정 보고·출시 뒤 결과(수집 상태 pr_collect_state에 덧붙여 저장, 화면 응답 calibration·launchOutcomes).
// - 화면 응답 보조: 점수표 색인으로 '지난주' 판 찾기(전체 점수표를 읽지 않음), 출처별 신선도(30일 성공률·마지막 정상 수집·격리 수), 경보, 랭킹 가져오기 상태.
// - 주간 MD 리포트: 한국 날짜 기준 주 1회 결정형 메모(모델 호출 없음)를 pr_brief로 저장.
import {database,stamp} from '../server';
import {SOURCES} from './sources';
import {buildSeries,RELATIVE_METRICS,timeOf} from './analytics/series';
import {sha256Hex,shortId,stableJson} from './analytics/hash';
import {kstDayKey,kstWeekKey} from './collectors/quota';
import {K,bulkDelete,bulkPut,countKind,ensureSnapshotRoom,forgetSnapshotReuse,optional,putStatement,readMany,snapshotStatement,withSnapshotReuse,type QuarantineRow} from './server-store';
import {loadDecisions,loadProducts,loadRecomputeSnapshots,loadScores,recompute,referencedSnapshots,RECOMPUTE_WINDOW_DAYS,type CalibrationReport,type CollectVideo,type StoredProduct} from './server-pipeline';
import {briefInputs,templateBrief} from './server-brief';
import type {LaunchOutcome,ResearchAlert,RankingImportStatus,SourceFreshness,WeightsProposalView} from './api';
import {proposeWeights,RECALIBRATION_WEEKS,type RecalibrationRow} from './analytics/backtest';
import {WEIGHT_SETS} from './analytics/score';
import type {MdDecision,MetricKey,Observation,ScoreCard,Series,Snapshot,SourceId} from './types';

const DAY=86400000;

// ── 점수표 색인(pr_score_index): 상품마다 점수표 판 요약을 계산 날짜(UTC)마다 가장 늦은 1개씩 최근 30개(최신순, 현재 판은 늘 맨 앞).
// 하루에 판이 여러 번 바뀌어도 '6일 이상 앞선 판'(지난주 대비)이 색인에 남는다. 화면은 상품 수만큼만 읽는다(평가 1회차 H6).
export type ScoreIndexEntry={id:string;total:number|null;momentum:number|null;computedAt:string};
export type ScoreIndex={productId:string;entries:ScoreIndexEntry[];updatedAt:string};
export const SCORE_INDEX_DEPTH=30;
// 현재 판을 맨 앞에 두고, 나머지는 계산 날짜마다 가장 늦은 판 하나만 남긴다.
function thin(entries:readonly ScoreIndexEntry[],currentId:string|null){
 const sorted=[...entries].sort(byNewest),out:ScoreIndexEntry[]=[],days=new Set<string>(),seen=new Set<string>();
 const head=currentId?sorted.find(e=>e.id===currentId):undefined;
 if(head){out.push(head);seen.add(head.id);days.add(head.computedAt.slice(0,10))}
 for(const e of sorted){if(out.length>=SCORE_INDEX_DEPTH)break;const d=e.computedAt.slice(0,10);if(seen.has(e.id)||days.has(d))continue;out.push(e);seen.add(e.id);days.add(d)}
 return out;
}
const entryOf=(c:ScoreCard):ScoreIndexEntry=>({id:c.id,total:c.total,momentum:c.subScores.find(s=>s.key==='momentum')?.value??null,computedAt:c.computedAt});
const byNewest=(a:ScoreIndexEntry,b:ScoreIndexEntry)=>timeOf(b.computedAt)-timeOf(a.computedAt)||(a.id<b.id?1:-1);

export async function updateScoreIndex(owner:string,at=stamp()){
 const products=await loadProducts(owner),ids=new Set(products.map(p=>p.id));
 const index=await readMany<ScoreIndex>(owner,K.scoreIndex,[...ids]);
 // 색인이 없는 상품(배포 직후 등)은 그 상품의 점수표 판에서 날짜마다 가장 늦은 판을 최근 30일치만 창 함수로 한 번 채운다.
 const missing=products.filter(p=>p.scoreId&&!index.has(p.id)).map(p=>p.id),boot=new Map<string,ScoreIndexEntry[]>();
 for(let i=0;i<missing.length;i+=200){
  const r=await database().prepare(`SELECT p,id,t,m,c FROM (SELECT p,id,t,m,c,ROW_NUMBER() OVER (PARTITION BY p ORDER BY u DESC,id DESC) r2 FROM (SELECT parent_id p,json_extract(data,'$.id') id,json_extract(data,'$.total') t,json_extract(data,'$.subScores[1].value') m,json_extract(data,'$.computedAt') c,updated_at u,ROW_NUMBER() OVER (PARTITION BY parent_id,substr(updated_at,1,10) ORDER BY updated_at DESC,id DESC) r1 FROM records WHERE owner=? AND kind=? AND parent_id IN (SELECT value FROM json_each(?))) WHERE r1=1) WHERE r2<=?`)
   .bind(owner,K.score,JSON.stringify(missing.slice(i,i+200)),SCORE_INDEX_DEPTH).all<{p:string;id:string;t:number|null;m:number|null;c:string}>();
  for(const x of r.results)boot.set(x.p,[...(boot.get(x.p)??[]),{id:x.id,total:x.t??null,momentum:x.m??null,computedAt:x.c}]);
 }
 const pending=products.filter(p=>p.scoreId&&((boot.get(p.id)??index.get(p.id)?.entries??[]).sort(byNewest)[0]?.id!==p.scoreId));
 const cards=await loadScores(owner,pending.map(p=>p.scoreId as string));
 const rows:{key:string;data:ScoreIndex;at:string}[]=[];
 for(const p of products){
  if(!p.scoreId)continue;
  const prior=(boot.get(p.id)??index.get(p.id)?.entries??[]).slice(),card=cards.get(p.scoreId);
  if(!boot.has(p.id)&&!card)continue;
  const entries=thin([...(card?[entryOf(card)]:[]),...prior.filter(e=>e.id!==card?.id)],p.scoreId);
  rows.push({key:p.id,data:{productId:p.id,entries,updatedAt:at},at});
 }
 const all=await database().prepare('SELECT id FROM records WHERE owner=? AND kind=? LIMIT 5000').bind(owner,K.scoreIndex).all<{id:string}>();
 const prefix=`${owner}:${K.scoreIndex}:`,stale=all.results.map(r=>r.id.slice(prefix.length)).filter(id=>!ids.has(id));
 const writes=[...bulkPut(owner,K.scoreIndex,rows),...bulkDelete(owner,K.scoreIndex,stale)];
 if(writes.length)await database().batch(writes);
 return {updated:rows.length,removed:stale.length};
}
// 현재 판보다 6일 이상 먼저 계산된 판 중 가장 최근 것(지난주 대비 표시용).
export function previousFromIndex(entries:readonly ScoreIndexEntry[]|undefined,current:Pick<ScoreCard,'id'|'computedAt'>){
 const cut=timeOf(current.computedAt)-6*DAY;
 const e=(entries??[]).slice().sort(byNewest).find(x=>x.id!==current.id&&timeOf(x.computedAt)<=cut);
 return e?{total:e.total,momentum:e.momentum,computedAt:e.computedAt}:null;
}

// ── 자사 판매(own_sales, internal): 성장 주문 품목(growth_order_line)과 지점 주문(store_order)을 SKU·주(월요일 시작, 한국 날짜)로 합산한다.
// 읽는 열은 주문 ID·SKU·상품명·수량·결제/환불 배분·주문일·주문 상태뿐이다(고객 정보 없음, 읽기 전용). 진행 중인 이번 주와 취소 주문은 뺀다.
export const OWN_SALES_MAX_LINES=5000;
type LineRow={o:string|null;sku:string|null;title:string|null;p:number|null;r:number|null};
const mondayOf=(day:string)=>{const t=Date.parse(`${day}T00:00:00Z`),dow=(new Date(t).getUTCDay()+6)%7;return new Date(t-dow*DAY).toISOString().slice(0,10)};
export async function ownSalesSnapshot(owner:string,now:Date):Promise<Snapshot|null>{
 const lines=(await database().prepare("SELECT json_extract(data,'$.input.orderId') o,json_extract(data,'$.snapshot.catalog.sku') sku,json_extract(data,'$.snapshot.catalog.title') title,json_extract(data,'$.input.paidAllocation') p,json_extract(data,'$.input.refundAllocation') r FROM records WHERE owner=? AND kind='growth_order_line' ORDER BY updated_at DESC LIMIT ?").bind(owner,OWN_SALES_MAX_LINES+1).all<LineRow>()).results;
 if(!lines.length)return null;
 const truncated=lines.length>OWN_SALES_MAX_LINES,used=lines.slice(0,OWN_SALES_MAX_LINES).filter(l=>typeof l.o==='string'&&l.o&&typeof l.sku==='string'&&l.sku.trim());
 const orderIds=[...new Set(used.map(l=>l.o as string))],orders=new Map<string,{day:string;status:string}>();
 for(let i=0;i<orderIds.length;i+=200){
  const r=await database().prepare("SELECT json_extract(data,'$.id') id,json_extract(data,'$.orderDate') d,json_extract(data,'$.status') st FROM records WHERE owner=? AND kind='store_order' AND id IN (SELECT value FROM json_each(?))").bind(owner,JSON.stringify(orderIds.slice(i,i+200).map(id=>`${owner}:store_order:${id}`))).all<{id:string;d:string|null;st:string|null}>();
  for(const x of r.results)if(typeof x.d==='string'&&/^\d{4}-\d{2}-\d{2}/.test(x.d))orders.set(x.id,{day:x.d.slice(0,10),status:x.st??''});
 }
 const thisWeek=kstWeekKey(now),from=kstDayKey(new Date(now.getTime()-RECOMPUTE_WINDOW_DAYS*DAY));
 const buckets=new Map<string,{sku:string;title:string;week:string;orders:Set<string>;revenue:number;unknown:boolean}>();
 for(const l of used){
  const o=orders.get(l.o as string);if(!o||o.status==='cancelled'||o.day<from)continue;
  const week=mondayOf(o.day);if(week>=thisWeek)continue;
  const sku=(l.sku as string).trim().slice(0,80),key=`${sku}|${week}`;
  const b=buckets.get(key)??{sku,title:(typeof l.title==='string'&&l.title.trim()?l.title.trim():sku).slice(0,200),week,orders:new Set<string>(),revenue:0,unknown:false};
  b.orders.add(l.o as string);
  if(typeof l.p==='number'&&typeof l.r==='number')b.revenue+=l.p-l.r;else b.unknown=true;
  buckets.set(key,b);
 }
 if(!buckets.size)return null;
 const observations:Observation[]=[];
 for(const b of [...buckets.values()].sort((a,b)=>a.sku<b.sku?-1:a.sku>b.sku?1:a.week<b.week?-1:1)){
  const subject={type:'listing' as const,sourceId:'own_sales' as const,externalId:b.sku,title:b.title,brand:null,price:null,url:null,categoryPath:null};
  const period={from:b.week,to:new Date(Date.parse(`${b.week}T00:00:00Z`)+6*DAY).toISOString().slice(0,10)};
  observations.push({subject,metric:'own_orders',value:b.orders.size,period},{subject,metric:'own_revenue',value:b.unknown?null:b.revenue,period});
 }
 const digest=sha256Hex(stableJson(observations));
 const last=await database().prepare("SELECT json_extract(data,'$.bodyDigest') d FROM records WHERE owner=? AND parent_id=? AND kind=? ORDER BY updated_at DESC LIMIT 1").bind(owner,'own_sales',K.snapshot).first<{d:string|null}>();
 if(last?.d===digest)return null;
 const limitations=['앱 안 주문 장부(성장 주문 품목·지점 주문)를 SKU·주(월요일 시작, 한국 날짜) 단위로 합산했습니다. 고객 정보는 읽지 않습니다.','진행 중인 이번 주와 취소 주문은 뺐습니다. 금액 배분이 빈 품목이 있는 주의 매출은 미확인(null)입니다.'];
 if(truncated)limitations.push(`주문 품목이 ${OWN_SALES_MAX_LINES.toLocaleString('ko-KR')}개를 넘어 최근 ${OWN_SALES_MAX_LINES.toLocaleString('ko-KR')}개만 합산했습니다(부분 자료).`);
 return {id:crypto.randomUUID(),sourceId:'own_sales',method:'internal',request:{weeks:new Set([...buckets.values()].map(b=>b.week)).size,skus:new Set([...buckets.values()].map(b=>b.sku)).size,lines:used.length},
  fetchedAt:now.toISOString(),bodyDigest:digest,bodyBytes:new TextEncoder().encode(stableJson(observations)).byteLength,status:truncated?'partial':'ok',limitations,importedBy:null,observations};
}

// ── 이상치 격리: 시계열의 마지막 관측이 직전 8개 점의 중앙값에서 강건 z(MAD) 5배를 넘게 벗어나면 격리한다.
// 강건 척도 = max(1.4826×MAD, |중앙값|×10%, 1). 누적값(영상 조회수·리뷰 수)과 순위·평점·경쟁 지수는 검사하지 않는다(정상 변화가 크거나 범위가 좁다).
export const ANOMALY_Z=5,ANOMALY_WINDOW=8,MAX_NEW_QUARANTINE=200;
const ANOMALY_METRICS:ReadonlySet<MetricKey>=new Set<MetricKey>(['search_volume_month','search_volume_pc','search_volume_mobile','search_trend','shopping_click_trend','product_count','seller_count','price_min','price_median','video_count','sales_estimate','own_orders','own_revenue']);
const median=(xs:readonly number[])=>{const s=[...xs].sort((a,b)=>a-b),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2};
export function robustZ(value:number,window:readonly number[]){
 const m=median(window),mad=median(window.map(x=>Math.abs(x-m))),scale=Math.max(1.4826*mad,Math.abs(m)*0.1,1);
 return {median:m,mad,z:Math.abs(value-m)/scale};
}
// 평가 2회차 M1: 격리 단위는 관측 한 점(스냅샷·대상·지표·기간 끝)이다. 상대값(데이터랩 검색 추세·쇼핑 클릭 추세)의 급등은 진짜 상승일 수 있어
// 두 번째 출처(같은 키워드의 검색광고 30일 실측)가 반박할 때(실측은 평소 수준, 강건 z ≤ 2)만 격리하고, 아니면 표시(flagged)만 한다(점수에 그대로 들어간다).
export const SECOND_SOURCE_Z=2;
function secondSource(s:Series,lastAt:string,all:readonly Series[]):{disagree:boolean;basis:string}{
 const abs=s.subjectKey.startsWith('kw:')?all.find(x=>x.subjectKey===s.subjectKey&&x.metric==='search_volume_month'):undefined;
 const pts=(abs?.points??[]).filter(p=>typeof p.value==='number'&&timeOf(p.at)<=timeOf(lastAt)+7*DAY);
 if(pts.length<4)return {disagree:false,basis:'같은 키워드의 검색광고 실측이 모자라 다른 출처로 대조하지 못해 빼지 않고 표시만 했습니다.'};
 const cur=pts[pts.length-1],r=robustZ(cur.value as number,pts.slice(-ANOMALY_WINDOW-1,-1).map(p=>p.value as number));
 return r.z<=SECOND_SOURCE_Z?{disagree:true,basis:`검색광고 30일 실측은 평소 수준(강건 z ${Math.round(r.z*10)/10})이라 상대값 급등을 반박해 격리했습니다.`}
  :{disagree:false,basis:`검색광고 30일 실측도 함께 올라(강건 z ${Math.round(r.z*10)/10}) 실제 상승일 수 있어 빼지 않고 표시만 했습니다.`};
}
export function findAnomalies(snapshots:readonly Snapshot[],at:string):QuarantineRow[]{
 const out:QuarantineRow[]=[],all=buildSeries(snapshots);
 for(const s of all){
  if(!ANOMALY_METRICS.has(s.metric))continue;
  const pts=s.points.filter(p=>typeof p.value==='number');
  if(pts.length<ANOMALY_WINDOW+1)continue;
  const last=pts[pts.length-1],window=pts.slice(-ANOMALY_WINDOW-1,-1).map(p=>p.value as number),r=robustZ(last.value as number,window);
  if(!(r.z>ANOMALY_Z))continue;
  const chk=RELATIVE_METRICS.has(s.metric)?secondSource(s,last.at,all):null;
  out.push({id:shortId('prq',{s:last.snapshotId,k:s.subjectKey,m:s.metric,p:last.at}),sourceId:s.sourceId,snapshotId:last.snapshotId,subjectKey:s.subjectKey,metric:s.metric,periodTo:last.at,value:last.value as number,median:r.median,robustZ:Math.round(r.z*10)/10,window,
   status:chk&&!chk.disagree?'flagged':'active',createdAt:at,cleared:null,basis:chk?.basis??null});
 }
 return out.sort((a,b)=>b.robustZ-a.robustZ||(a.id<b.id?-1:1)).slice(0,MAX_NEW_QUARANTINE);
}
// 이미 기록한 관측은 다시 만들지 않는다: 같은 스냅샷·대상·지표·기간 끝(기간 끝이 없는 옛 행은 같은 스냅샷이면 같다), 사람이 해제한 같은 출처·대상·지표·기간 끝,
// 그리고 상대값은 같은 출처·대상·지표·기간 끝이면 상태와 스냅샷에 관계없이 같다(매일 같은 주를 다시 받아도 날마다 새로 격리·표시하지 않는다).
async function freshAnomalies(owner:string,found:readonly QuarantineRow[]){
 if(!found.length)return [];
 const r=await database().prepare("SELECT json_extract(data,'$.sourceId') src,json_extract(data,'$.snapshotId') s,json_extract(data,'$.subjectKey') k,json_extract(data,'$.metric') m,json_extract(data,'$.periodTo') p,json_extract(data,'$.status') st FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.subjectKey') IN (SELECT value FROM json_each(?)) LIMIT 20000").bind(owner,K.quarantine,JSON.stringify([...new Set(found.map(q=>q.subjectKey))])).all<{src:string;s:string;k:string;m:string;p:string|null;st:string}>();
 return found.filter(q=>!r.results.some(x=>x.k===q.subjectKey&&x.m===q.metric&&(x.p?x.p===q.periodTo&&(x.s===q.snapshotId||(x.src===q.sourceId&&(x.st==='cleared'||RELATIVE_METRICS.has(q.metric as MetricKey)))):x.s===q.snapshotId)));
}

// ── 소싱 연결 보존: 재계산이 상품을 다시 쓸 때 사람이 이은 소싱 후보(sourcing)를 잃지 않게 되돌린다(재계산이 이미 보존하면 아무것도 쓰지 않는다).
type Linked=StoredProduct&{sourcing?:unknown};
async function sourcingLinks(owner:string){
 const r=await database().prepare("SELECT json_extract(data,'$.id') id,json_extract(data,'$.sourcing') s FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.sourcing') IS NOT NULL LIMIT 2000").bind(owner,K.product).all<{id:string;s:string}>();
 return new Map(r.results.map(x=>[x.id,x.s]));
}
async function restoreSourcing(owner:string,links:ReadonlyMap<string,string>,at:string){
 if(!links.size)return 0;
 const now=await readMany<Linked>(owner,K.product,[...links.keys()]),rows:{key:string;data:Linked;at:string}[]=[];
 for(const [id,s] of links){const p=now.get(id);if(p&&JSON.stringify(p.sourcing??null)!==s)rows.push({key:id,data:{...p,sourcing:JSON.parse(s)},at})}
 if(rows.length)await database().batch(bulkPut(owner,K.product,rows));
 return rows.length;
}

// ── 출시 뒤 결과(평가 2회차 M5): 성장2로 넘긴 결정 → 소싱 후보(넘기기 때 만든 초안 또는 상품에 연결한 후보) → 성장2 카탈로그 상품의 SKU → 자사 주문 장부.
// 넘긴 시각부터 4·8·12주 동안의 주문 수·수량·순매출을 센다. SKU를 알 수 없으면 값은 null(0 아님)과 까닭. 장부에 그 SKU 주문이 없으면 0이다(장부가 있으므로 사실).
// 수량·매출은 품목 하나라도 값이 비면 그 창은 null이다. 취소 주문은 뺀다. 운영자가 SKU를 직접 잇는 작업은 범위 밖이다.
// 평가 3회차(낮음): 주문 품목은 SKU·ID 순으로 OUTCOME_MAX_LINES개까지만 읽는다(결정형). 한도를 넘으면 마지막 SKU와 읽지 못한 SKU의 값은 null이고 까닭은 '집계 한도 초과'다(0으로 쓰지 않는다).
export const OUTCOME_WEEKS=[4,8,12] as const,OUTCOME_MAX_DECISIONS=200,OUTCOME_MAX_LINES=OWN_SALES_MAX_LINES,OUTCOME_TRUNCATED='집계 한도 초과';
type Handoff=NonNullable<MdDecision['handoff']>&{candidateId?:string|null;at?:string};
export async function launchOutcomes(owner:string,now:Date):Promise<LaunchOutcome[]>{
 const handed=(await loadDecisions(owner)).filter(d=>d.handoff).sort((a,b)=>a.decidedAt<b.decidedAt?1:-1).slice(0,OUTCOME_MAX_DECISIONS);
 if(!handed.length)return [];
 const products=await readMany<StoredProduct>(owner,K.product,handed.map(d=>d.productId));
 const candidateOf=(d:MdDecision)=>{const h=d.handoff as Handoff,p=products.get(d.productId);return h.candidateId??(p?.sourcing&&p.sourcing.campaignId===h.campaignId?p.sourcing.candidateId:null)};
 const cands=await readMany<{campaignId:string;input:{catalogId?:string}}>(owner,'growth_sourcing_candidate',handed.map(candidateOf).filter((x):x is string=>!!x));
 const catalogs=await readMany<{campaignId:string;input:{sku?:string}}>(owner,'growth_catalog',[...cands.values()].map(c=>c.input?.catalogId??'').filter(Boolean));
 const skuOf=(d:MdDecision):{sku:string|null;reason:string|null}=>{
  const id=candidateOf(d);if(!id)return {sku:null,reason:'연결한 소싱 후보가 없어 카탈로그 SKU를 알 수 없습니다.'};
  const c=cands.get(id);if(!c)return {sku:null,reason:'연결한 소싱 후보를 찾을 수 없습니다.'};
  const cat=c.input?.catalogId?catalogs.get(c.input.catalogId):undefined;if(!cat)return {sku:null,reason:'소싱 후보의 카탈로그 상품을 찾을 수 없습니다.'};
  const sku=typeof cat.input?.sku==='string'?cat.input.sku.trim():'';return sku?{sku:sku.slice(0,80),reason:null}:{sku:null,reason:'카탈로그 상품에 SKU가 비어 있습니다.'};
 };
 const resolved=handed.map(d=>({d,...skuOf(d),at:(d.handoff as Handoff).at??d.decidedAt}));
 const skus=[...new Set(resolved.map(r=>r.sku).filter((x):x is string=>!!x))];
 const ledger=skus.length?await database().prepare("SELECT 1 x FROM records WHERE owner=? AND kind='growth_order_line' LIMIT 1").bind(owner).first<{x:number}>():null;
 const lines=skus.length&&ledger?(await database().prepare("SELECT json_extract(data,'$.input.orderId') o,trim(json_extract(data,'$.snapshot.catalog.sku')) sku,json_extract(data,'$.input.units') u,json_extract(data,'$.input.paidAllocation') p,json_extract(data,'$.input.refundAllocation') r FROM records WHERE owner=? AND kind='growth_order_line' AND trim(json_extract(data,'$.snapshot.catalog.sku')) IN (SELECT value FROM json_each(?)) ORDER BY sku,id LIMIT ?").bind(owner,JSON.stringify(skus),OUTCOME_MAX_LINES+1).all<{o:string|null;sku:string;u:number|null;p:number|null;r:number|null}>()).results:[];
 // 한도를 넘었으면: SKU 순으로 읽었으므로 마지막 행의 SKU는 일부만 읽었고, 읽지 못한 SKU는 아예 없다. 다 읽은 SKU만 센다.
 const truncated=lines.length>OUTCOME_MAX_LINES;if(truncated)lines.length=OUTCOME_MAX_LINES;
 const lastSku=truncated?lines[lines.length-1]?.sku:undefined,counted=new Set(lines.map(l=>l.sku).filter(x=>x!==lastSku));
 const orderIds=[...new Set(lines.map(l=>l.o).filter((x):x is string=>typeof x==='string'&&!!x))],orders=new Map<string,{day:string;status:string}>();
 for(let i=0;i<orderIds.length;i+=200){
  const r=await database().prepare("SELECT json_extract(data,'$.id') id,json_extract(data,'$.orderDate') d,json_extract(data,'$.status') st FROM records WHERE owner=? AND kind='store_order' AND id IN (SELECT value FROM json_each(?))").bind(owner,JSON.stringify(orderIds.slice(i,i+200).map(id=>`${owner}:store_order:${id}`))).all<{id:string;d:string|null;st:string|null}>();
  for(const x of r.results)if(typeof x.d==='string'&&/^\d{4}-\d{2}-\d{2}/.test(x.d))orders.set(x.id,{day:x.d.slice(0,10),status:x.st??''});
 }
 return resolved.map(({d,sku,reason,at}):LaunchOutcome=>{
  const start=timeOf(at),h=d.handoff as Handoff;
  const windows=OUTCOME_WEEKS.map(weeks=>{
   const end=start+weeks*7*DAY,complete=now.getTime()>=end;
   if(!sku)return {weeks,complete,orders:null,units:null,revenue:null};
   if(!ledger||(truncated&&!counted.has(sku)))return {weeks,complete,orders:null,units:null,revenue:null};
   const from=kstDayKey(new Date(start)),to=kstDayKey(new Date(Math.min(end,now.getTime())));
   const hit=lines.filter(l=>{const o=l.sku===sku&&l.o?orders.get(l.o):undefined;return !!o&&o.status!=='cancelled'&&o.day>=from&&(complete?o.day<kstDayKey(new Date(end)):o.day<=to)});
   const units=hit.every(l=>typeof l.u==='number')?hit.reduce((s,l)=>s+(l.u as number),0):null;
   const revenue=hit.every(l=>typeof l.p==='number'&&typeof l.r==='number')?hit.reduce((s,l)=>s+(l.p as number)-(l.r as number),0):null;
   return {weeks,complete,orders:new Set(hit.map(l=>l.o)).size,units,revenue};
  });
  return {decisionId:d.id,productId:d.productId,campaignId:h.campaignId,handedOffAt:new Date(start).toISOString(),sku,reason:sku&&!ledger?'자사 주문 장부(성장 주문 품목)가 없어 판매 결과를 셀 수 없습니다.':sku&&truncated&&!counted.has(sku)?`${OUTCOME_TRUNCATED}: 넘긴 SKU의 주문 품목이 ${OUTCOME_MAX_LINES.toLocaleString('ko-KR')}개를 넘어 이 SKU의 판매를 모두 세지 못했습니다(0이 아니라 미확인).`:reason,windows};
 });
}

// ── 가중치 재보정 후보(평가 3회차 ⑩ 학습 고리, 읽기 전용): 출시 뒤 8주 창이 다 지나고 순매출을 아는 결과만, 그 결정 때 점수표의 하위 점수와 순위 상관을 잰다.
// 제안만 남기고 가중치 판·점수표는 바꾸지 않는다(analytics/backtest.ts proposeWeights). 결정 때 점수표의 가중치 판(없으면 w1)을 기준으로 제안한다.
export async function weightsCandidate(owner:string,outcomes:readonly LaunchOutcome[],now:Date):Promise<WeightsProposalView>{
 const done=outcomes.flatMap(o=>{const w=o.windows.find(x=>x.weeks===RECALIBRATION_WEEKS);return w&&w.complete&&w.revenue!==null?[{decisionId:o.decisionId,revenue:w.revenue}]:[]});
 const decisions=done.length?new Map((await loadDecisions(owner)).map(d=>[d.id,d])):new Map<string,MdDecision>();
 const cards=await loadScores(owner,done.map(x=>decisions.get(x.decisionId)?.scoreCardId??''));
 const rows:RecalibrationRow[]=[],versions=new Set<string>();
 for(const x of done){const c=cards.get(decisions.get(x.decisionId)?.scoreCardId??'');if(!c)continue;versions.add(c.weightsVersion);rows.push({revenue:x.revenue,subScores:Object.fromEntries(c.subScores.map(s=>[s.key,s.value]))})}
 const baseVersion=versions.size===1?[...versions][0]:'w1',base=WEIGHT_SETS[baseVersion]??WEIGHT_SETS.w1;
 const p=proposeWeights(rows,base,{at:now.toISOString(),baseVersion:WEIGHT_SETS[baseVersion]?baseVersion:'w1'});
 return versions.size>1?{...p,caveats:[...p.caveats,`결정 때 점수표의 가중치 판이 여러 개(${[...versions].sort().join(', ')})라 w1을 기준으로 제안했습니다.`]}:p;
}

// 수집 상태에 파생 값(보정 보고·출시 뒤 결과·가중치 재보정 후보)을 덧붙여 저장한다(다른 필드는 그대로). 상품 리서치 잠금 안에서만 부른다.
export type DerivedState={calibration:CalibrationReport;outcomes:{at:string;rows:LaunchOutcome[]};recalibration?:WeightsProposalView|null};
async function saveDerived(owner:string,derived:DerivedState){
 const cur=await optional<Record<string,unknown>>(owner,K.collectState,'current');
 await putStatement(owner,K.collectState,'current',{...(cur??{}),...derived}).run();
}

// 재계산 감싸기. 모든 재계산 경로(가져오기·확인·브랜드 적합성·격리 해제·재계산 요청·수집 완료)가 이 함수를 쓴다.
// renew(선택, 평가 3회차 M4): 단계마다(쓰기 직전) 부르는 잠금 갱신. 잠금을 잃었으면 ResearchLockLost를 던져 남은 단계를 저장하지 않고 멈춘다.
// 단계: 자사 판매 스냅샷 → 이상치 기록 → 재계산 저장(recompute 안, batch 직전) → 소싱 연결 되돌림 → 점수표 색인 → 파생 값 저장.
export async function refreshScores(owner:string,now:Date,videos:readonly CollectVideo[]=[],opts:{renew?:()=>Promise<void>}={}){
 const renew=opts.renew??(async()=>{});
 return withSnapshotReuse(async()=>{
  await renew();
  const own=await ownSalesSnapshot(owner,now);
  if(own){await ensureSnapshotRoom(owner,1,now,()=>referencedSnapshots(owner));await renew();await snapshotStatement(owner,own).run();forgetSnapshotReuse(owner)}
  const found=findAnomalies(await loadRecomputeSnapshots(owner,now),now.toISOString()),fresh=await freshAnomalies(owner,found);
  // 이미 기록한 관측(같은 스냅샷 또는 해제한 기간·상대값 같은 기간)은 그대로 둔다(insert_only + freshAnomalies).
  if(fresh.length){await renew();await database().batch(bulkPut(owner,K.quarantine,fresh.map(q=>({key:q.id,parent:q.sourceId,data:q,at:q.createdAt})),'insert_only'))}
  const links=await sourcingLinks(owner);
  const summary=await recompute(owner,now,videos,renew);
  await renew();
  const restored=await restoreSourcing(owner,links,now.toISOString());
  await renew();
  await updateScoreIndex(owner,now.toISOString());
  const outcomes=await launchOutcomes(owner,now);
  const derived:DerivedState={calibration:summary.calibration,outcomes:{at:now.toISOString(),rows:outcomes},recalibration:await weightsCandidate(owner,outcomes,now)};
  await renew();
  await saveDerived(owner,derived);
  const {calibration:_c,...rest}=summary;void _c;
  return {...rest,calibration:{groups:summary.calibration.groups,mape:summary.calibration.mape},ownSalesSnapshot:own?own.id:null,anomaliesChecked:found.length,anomaliesNew:fresh.length,sourcingRestored:restored,derived};
 });
}

// ── 신선도·경보·랭킹 가져오기 상태(화면 응답)
type SourceRow={id:SourceId;method:string;lastFetchedAt:string|null;lastOkAt:string|null};
export async function freshnessView(owner:string,now:Date,sources:readonly SourceRow[]){
 const since=kstDayKey(new Date(now.getTime()-30*DAY));
 const [q,iso]=await Promise.all([
  database().prepare("SELECT parent_id s,SUM(json_extract(data,'$.calls')) c,SUM(coalesce(json_extract(data,'$.ok'),0)) k FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.day')>=? GROUP BY parent_id").bind(owner,K.quota,since).all<{s:SourceId;c:number|null;k:number|null}>(),
  database().prepare("SELECT parent_id s,COUNT(*) n,MIN(json_extract(data,'$.createdAt')) f FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.status')='active' GROUP BY parent_id").bind(owner,K.quarantine).all<{s:SourceId;n:number;f:string}>(),
 ]);
 const calls=new Map(q.results.map(x=>[x.s,x])),quarantined=new Map(iso.results.map(x=>[x.s,x]));
 const freshness:SourceFreshness[]=sources.map(s=>{
  const c=calls.get(s.id),n=Number(c?.c)||0,ok=Number(c?.k)||0;
  return {sourceId:s.id,successRate30d:n>0?Math.round(Math.min(1,ok/n)*1000)/1000:null,calls30d:n,lastOkAt:s.lastOkAt,quarantined:Number(quarantined.get(s.id)?.n)||0};
 });
 const quarantineAlerts:ResearchAlert[]=[...quarantined.values()].map(x=>({sourceId:x.s,message:`이상치로 격리된 관측 ${Number(x.n)}개가 사람 확인을 기다립니다. 확인한 뒤 해제하면 다시 점수에 들어갑니다.`,since:x.f}));
 const thisWeek=kstWeekKey(now);
 const rankingStatus:RankingImportStatus[]=SOURCES.filter(s=>s.scale==='rank'&&(s.method==='manual'||s.method==='licensed')).map(s=>{
  const last=sources.find(x=>x.id===s.id)?.lastFetchedAt??null;
  return {sourceId:s.id,lastImportedAt:last,thisWeek:!!last&&kstWeekKey(new Date(last))===thisWeek};
 });
 return {freshness,quarantineAlerts,rankingStatus};
}

// ── 주간 MD 리포트: 도입 검토·관찰 상위 10개(선정 금지 제외)로 결정형 메모를 만든다(모델 호출 없음).
export const WEEKLY_QUESTION='주간 MD 리포트',WEEKLY_TOP=10;
const TIER_ORDER:Record<ScoreCard['tier'],number>={adopt:0,watch:1,needs_data:2,reject:3};
export async function weeklyReport(owner:string,now:Date):Promise<{briefId:string|null;reason:string|null}>{
 const products=await loadProducts(owner),scores=await loadScores(owner,products.map(p=>p.scoreId??''));
 const top=products.flatMap(p=>{const c=p.scoreId?scores.get(p.scoreId):undefined;return c&&(c.tier==='adopt'||c.tier==='watch')&&!c.blocked?[{p,c}]:[]})
  .sort((a,b)=>TIER_ORDER[a.c.tier]-TIER_ORDER[b.c.tier]||(b.c.total??-1)-(a.c.total??-1)||(a.p.id<b.p.id?-1:1)).slice(0,WEEKLY_TOP);
 if(!top.length)return {briefId:null,reason:'도입 검토·관찰 후보가 없어 이번 주 MD 리포트를 만들지 않았습니다.'};
 if(await countKind(owner,K.brief)>=2000)return {briefId:null,reason:'선정 메모 기록 한도(2,000개)에 도달해 이번 주 MD 리포트를 만들지 않았습니다.'};
 const at=now.toISOString();
 let brief;try{brief=templateBrief(WEEKLY_QUESTION,await briefInputs(owner,top.map(x=>x.p.id)),at)}catch(e){return {briefId:null,reason:e instanceof Error?`주간 MD 리포트를 저장하지 않았습니다: ${e.message}`:'주간 MD 리포트를 만들지 못했습니다.'}}
 await database().batch(bulkPut(owner,K.brief,[{key:brief.id,data:brief,at}],'insert_only'));
 return {briefId:brief.id,reason:null};
}
