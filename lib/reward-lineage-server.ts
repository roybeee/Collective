// B4-2b 보상 계보 서버(GET /api/reward-lineage, docs/REWARD-LINEAGE.ko.md 9절). 소유자(owner) 범위 records를 읽어 B4-2a 순수 모듈(lib/reward-lineage.ts rewardLineage)에 넘긴다.
// 읽기 전용: 쓰기·잠금·모델(HERMES·OpenAI)·커넥터 호출이 없다(토큰 0). 결과로 프롬프트 버전·규칙을 자동으로 올리거나 내리지 않는다.
// 스위치 b4_reward_lineage(기본 꺼짐)는 이 파일에서만 읽고 읽기 실패는 꺼짐으로 본다. 권한(대표·관리자 200, 직원 403)은 호출자(route)와 이 파일이 같이 막는다.
// 범위: 브랜드(필수, 지점·캠페인에서 끌어올 수 있음) → 캠페인 목록. 지점 범위는 그 지점 캠페인과 브랜드 공통 캠페인(lib/customer-report-server.ts와 같은 규칙), 캠페인 범위는 그 캠페인만.
// 판정은 캠페인을 지워도 남으므로 브랜드 범위에서는 판정의 brandId로, 지점·캠페인 범위에서는 판정의 campaignId로 거른다(지운 캠페인은 지점을 알 수 없어 지점 범위에서 빠진다).
// 규칙 계보: 역할 실행 스냅샷은 roleArtifactId(작업 id)로, 회의 작업물은 그 회의 snapshot.learning으로 작업물에 잇는다. 사건이 있는 작업물의 스냅샷만 넘긴다.
// D1 한도: 종류별 최근 REWARD_ROW_LIMIT행만 읽고 넘으면 partial.kinds에 종류를 남긴다. 목록 조건은 JSON 배열 하나(json_each)로 바인드해 바인드 수가 고정이다.
import {ApiError,database,readRecord,str} from './server';
import {isEnabled} from './feature-flags';
import {roleArtifactId} from './role-execution';
import {addDays} from './store-attribution';
import {rewardLineage,type RewardArtifact,type RewardInput,type RewardLineage,type RewardPublication,type RewardSnapshot} from './reward-lineage';
import type {ReviewDecision} from './review-decisions';
import type {Brand,Campaign} from './agency';
import type {Store} from './store-marketing';

export const REWARD_DEFAULT_DAYS=28,REWARD_MAX_DAYS=180,REWARD_ROW_LIMIT=5000;
// 결정 16 첫 실게시 상태. 저장 기록이 없는 운영 판정이라(docs/STATUS.md·REWARD-LINEAGE 6절) 코드 상수로 두고, 판정이 real이 되면 이 값만 바꾼다.
export const DECISION16_STATE:RewardInput['decision16']='not_run';
export const REWARD_LINEAGE_MESSAGES={
 off:'보상 계보 기능이 꺼져 있습니다. 소유자가 기능 스위치 b4_reward_lineage를 켜야 합니다.',
 adminOnly:'보상 계보는 대표·관리자만 볼 수 있습니다.',
 scope:'브랜드(brandId)·지점(storeId)·캠페인(campaignId) 중 하나를 정하세요.',
 period:'기간은 YYYY-MM-DD 형식의 한국 시간 날짜(시작일 ≤ 종료일)로 입력하세요.',
 range:`기간은 최대 ${REWARD_MAX_DAYS}일까지 조회할 수 있습니다.`,
} as const;
const M=REWARD_LINEAGE_MESSAGES;
export type RewardKind='campaign'|'review_decision'|'execution_publication'|'store_order'|'viral_experiment'|'learning_rule'|'artifact'|'history'|'learning_snapshot'|'team_meeting';
export type RewardLineageResponse={enabled:true;decision16:RewardInput['decision16'];partial:{kinds:RewardKind[]};lineage:RewardLineage};

export async function rewardLineageOn(owner:string){
 return isEnabled(owner,'b4_reward_lineage').catch(()=>{console.error('b4_reward_lineage_flag_unreadable');return false});
}

// ── 기간(한국 날짜, 양 끝 포함) ──
const DAY_RE=/^\d{4}-\d{2}-\d{2}$/;
const dayMs=(day:string)=>Date.parse(day+'T00:00:00Z');
const validDay=(day:string)=>DAY_RE.test(day)&&Number.isFinite(dayMs(day))&&new Date(dayMs(day)).toISOString().slice(0,10)===day;
const kstToday=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,10);
function periodOf(params:URLSearchParams,now=Date.now()){
 const to=params.get('to')||kstToday(now);
 if(!validDay(to))throw new ApiError(400,M.period);
 const from=params.get('from')||addDays(to,1-REWARD_DEFAULT_DAYS);
 if(!validDay(from)||from>to)throw new ApiError(400,M.period);
 if((dayMs(to)-dayMs(from))/86400000+1>REWARD_MAX_DAYS)throw new ApiError(400,M.range);
 // SQL 창은 앞뒤 하루씩 넓힌 UTC 시각이다. 한국 날짜 경계는 순수 모듈이 다시 거른다.
 return {from,to,start:addDays(from,-1),end:addDays(to,2)};
}
type Period=ReturnType<typeof periodOf>;

// ── 범위: 다른 워크스페이스·없는 기록은 404, 서로 맞지 않는 범위도 404 ──
type Scope={brandId:string;storeId:string|null;campaignId:string|null};
const optional=(v:string|null,label:string)=>v===null||v===''?null:str(v,label,100,true);
async function scopeOf(owner:string,params:URLSearchParams):Promise<Scope>{
 const brandParam=optional(params.get('brandId'),'브랜드'),storeId=optional(params.get('storeId'),'지점'),campaignId=optional(params.get('campaignId'),'캠페인');
 const [store,campaign]=await Promise.all([storeId?readRecord<Store>(owner,'store',storeId):null,campaignId?readRecord<Campaign>(owner,'campaign',campaignId):null]);
 const brandId=brandParam||store?.brandId||campaign?.brandId;
 if(!brandId)throw new ApiError(400,M.scope);
 if(store&&store.brandId!==brandId)throw new ApiError(404,'해당 브랜드의 지점이 아닙니다.');
 if(campaign&&(campaign.brandId!==brandId||(store&&campaign.storeId&&campaign.storeId!==store.id)))throw new ApiError(404,'해당 범위의 캠페인이 아닙니다.');
 await readRecord<Brand>(owner,'brand',brandId);
 return {brandId,storeId:store?.id??null,campaignId:campaign?.id??null};
}

// ── 읽기 도우미 ──
const field=(path:string,table='')=>`json_extract(${table}data,'$.${path}')`;
const inList=(column:string)=>`${column} IN (SELECT value FROM json_each(?))`;
type Read<T>={rows:T[];truncated:boolean};
async function rows<T>(owner:string,kind:RewardKind,select:string,where:string,binds:unknown[],order:string):Promise<Read<T>>{
 const result=(await database().prepare(`SELECT ${select} AS data FROM records WHERE owner=? AND kind=? AND ${where} ORDER BY ${order} LIMIT ?`).bind(owner,kind,...binds,REWARD_ROW_LIMIT+1).all<{data:string}>()).results;
 return {rows:result.slice(0,REWARD_ROW_LIMIT).map(r=>JSON.parse(r.data) as T),truncated:result.length>REWARD_ROW_LIMIT};
}
const recent=(at:string)=>`${field(at)} DESC, id DESC`;
const ids=(list:readonly (string|null|undefined)[])=>JSON.stringify([...new Set(list.filter((x):x is string=>!!x))].sort());
// 규칙 사본은 id·판·등급만 읽는다(규칙 본문·제목은 읽지 않는다).
const ruleRefs=(path:string)=>`(SELECT json_group_array(json_object('id',json_extract(r.value,'$.id'),'version',json_extract(r.value,'$.version'),'grade',json_extract(r.value,'$.grade'))) FROM json_each(records.data,'$.${path}') r)`;
const ARTIFACT_FIELDS=`'role',${field('role')},'origin',${field('origin')},'promptVersion',${field('promptVersion')},'meetingId',${field('meetingId')},'campaignId',parent_id,`
 +`'aiSource',json(CASE WHEN ${field('aiSource')} IS NULL THEN NULL ELSE json_object('version',${field('aiSource.version')},'promptVersion',${field('aiSource.promptVersion')}) END)`;
type ArtifactRow=RewardArtifact&{meetingId?:string|null;campaignId:string};

// 범위 캠페인 id. 지점 범위는 그 지점 캠페인과 브랜드 공통 캠페인, 캠페인 범위는 그 캠페인만이다.
async function scopeCampaigns(owner:string,s:Scope){
 const store=s.storeId?` AND COALESCE(${field('storeId')},'') IN ('',?)`:'',one=s.campaignId?` AND ${field('id')}=?`:'';
 return rows<string>(owner,'campaign',`json_quote(${field('id')})`,`${field('brandId')}=?${store}${one}`,[s.brandId,...(s.storeId?[s.storeId]:[]),...(s.campaignId?[s.campaignId]:[])],'id');
}
// 판정: 기간 창에 판정한 작업물의 모든 판정(1차 판정을 기록 순서로 정한다). 브랜드 범위는 brandId, 지점·캠페인 범위는 campaignId로 거른다.
function readDecisions(owner:string,s:Scope,p:Period,campaigns:string){
 const narrow=!!(s.storeId||s.campaignId),scope=narrow?inList(field('campaignId')):`${field('brandId')}=?`,bind=narrow?campaigns:s.brandId;
 const window=`SELECT ${field('targetId')} FROM records WHERE owner=? AND kind='review_decision' AND ${field('targetKind')}='artifact' AND ${scope} AND ${field('createdAt')}>=? AND ${field('createdAt')}<?`;
 return rows<ReviewDecision>(owner,'review_decision','data',`${field('targetKind')}='artifact' AND ${scope} AND ${field('targetId')} IN (${window})`,[bind,owner,bind,p.start,p.end],recent('createdAt'));
}
// 주문: 범위 지점(지점 범위는 그 지점, 아니면 브랜드의 모든 지점)의 기간 주문. 캠페인 범위는 그 캠페인에 귀속된 주문만이다.
function readOrders(owner:string,s:Scope,p:Period){
 const stores=s.storeId?'parent_id=?':`parent_id IN (SELECT ${field('id')} FROM records WHERE owner=? AND kind='store' AND parent_id=?)`,storeBinds=s.storeId?[s.storeId]:[owner,s.brandId];
 const one=s.campaignId?` AND ${field('campaignId')}=?`:'';
 return rows<NonNullable<RewardInput['orders']>[number]>(owner,'store_order','data',`${stores} AND ${field('orderDate')}>=? AND ${field('orderDate')}<=?${one}`,[...storeBinds,p.from,p.to,...(s.campaignId?[s.campaignId]:[])],recent('orderDate'));
}
// 발행: 범위 캠페인의 기간 창 발행과, 기간 주문의 게시 코드가 가리키는 발행(게시 관문 재검사). 캡션·코드 원문은 읽지 않는다.
function readPublications(owner:string,p:Period,campaigns:string,orderPubs:string){
 const select=`json_object('id',${field('id')},'version',${field('version')},'status',${field('status')},'scheduledAt',${field('scheduledAt')},'approvedAt',${field('approvedAt')},`
  +`'copy',json(CASE WHEN ${field('copy')} IS NULL THEN NULL ELSE json_object('artifactId',${field('copy.artifactId')},'artifactVersion',${field('copy.artifactVersion')},'index',${field('copy.index')}) END))`;
 return rows<RewardPublication>(owner,'execution_publication',select,`${inList('parent_id')} AND ((${field('scheduledAt')}>=? AND ${field('scheduledAt')}<?) OR ${inList(field('id'))})`,[campaigns,p.start,p.end,orderPubs],recent('scheduledAt'));
}
function readExperiments(owner:string,p:Period,campaigns:string){
 const select=`json_object('id',${field('id')},'version',${field('version')},'status',${field('status')},'createdAt',${field('createdAt')},'source',json(${field('source')}))`;
 return rows<NonNullable<RewardInput['experiments']>[number]>(owner,'viral_experiment',select,`${inList('parent_id')} AND ${field('createdAt')}>=? AND ${field('createdAt')}<?`,[campaigns,p.start,p.end],recent('createdAt'));
}
function readRules(owner:string,s:Scope,experiments:string){
 const select=`json_object('id',${field('id')},'version',${field('version')},'experimentId',${field('experimentId')},'status',${field('status')})`;
 return rows<NonNullable<RewardInput['rules']>[number]>(owner,'learning_rule',select,`parent_id=? AND ${inList(field('experimentId'))}`,[s.brandId,experiments],'id');
}
// 작업물 판: 사건이 가리키는 작업물의 현재 판과 이전 판(kind 'history'). 본문은 읽지 않는다.
function readArtifacts(owner:string,artifactIds:string){
 return rows<ArtifactRow>(owner,'artifact',`json_object('id',${field('id')},'version',${field('version')},${ARTIFACT_FIELDS})`,inList(field('id')),[artifactIds],recent('createdAt'));
}
function readHistory(owner:string,artifactIds:string){
 return rows<ArtifactRow>(owner,'history',`json_object('id',${field('originalId')},'version',${field('version')},${ARTIFACT_FIELDS})`,inList(field('originalId')),[artifactIds],recent('createdAt'));
}
function readSnapshots(owner:string,campaigns:string){
 return rows<RewardSnapshot>(owner,'learning_snapshot',`json_object('id',${field('id')},'artifactId',${field('artifactId')},'rules',json(${ruleRefs('rules')}),'operatorPreferences',json(${ruleRefs('operatorPreferences')}))`,inList('parent_id'),[campaigns],recent('createdAt'));
}
function readMeetings(owner:string,meetingIds:string){
 return rows<{id:string;learning:RewardSnapshot['rules']}>(owner,'team_meeting',`json_object('id',${field('id')},'learning',json(${ruleRefs('snapshot.learning')}))`,inList(field('id')),[meetingIds],recent('createdAt'));
}

// 규칙 계보: 역할 실행 스냅샷은 roleArtifactId(작업 id), 회의 작업물은 회의 snapshot.learning. 사건이 있는 작업물에 이어지는 스냅샷만 남긴다.
async function ruleLinks(snapshots:readonly RewardSnapshot[],meetings:readonly {id:string;learning:RewardSnapshot['rules']}[],artifacts:readonly ArtifactRow[],eventIds:ReadonlySet<string>){
 const mapped=await Promise.all(snapshots.map(async s=>({s,artifactId:s.artifactId||await roleArtifactId(s.id)})));
 const role=mapped.filter(m=>eventIds.has(m.artifactId)),byMeeting=new Map(meetings.map(m=>[m.id,m.learning]));
 const meetingPairs=[...new Set(artifacts.filter(a=>a.meetingId&&eventIds.has(a.id)&&byMeeting.has(a.meetingId)).map(a=>`${a.meetingId}\u0000${a.id}`))].sort();
 const fromMeetings:RewardSnapshot[]=meetingPairs.map(pair=>{const [meetingId,artifactId]=pair.split('\u0000');return {id:`meeting:${meetingId}:${artifactId}`,artifactId,rules:byMeeting.get(meetingId)||[]}});
 return {snapshots:[...role.map(m=>({id:m.s.id,rules:m.s.rules,...(m.s.operatorPreferences?.length?{operatorPreferences:m.s.operatorPreferences}:{})})),...fromMeetings],
  roleArtifactIds:Object.fromEntries(role.filter(m=>!m.s.artifactId).map(m=>[m.s.id,m.artifactId]))};
}
const artifactOf=({id,version,role,origin,promptVersion,aiSource}:ArtifactRow):RewardArtifact=>({id,version,role,origin,promptVersion,aiSource});

async function lineageInput(owner:string,s:Scope,p:Period){
 const campaignRead=await scopeCampaigns(owner,s),campaigns=ids(campaignRead.rows);
 const [decisions,orders,experiments]=await Promise.all([readDecisions(owner,s,p,campaigns),readOrders(owner,s,p),readExperiments(owner,p,campaigns)]);
 const [publications,rules]=await Promise.all([readPublications(owner,p,campaigns,ids(orders.rows.map(o=>o.codeAttribution?.publicationId))),readRules(owner,s,ids(experiments.rows.map(e=>e.id)))]);
 const eventIds=new Set([...decisions.rows.map(d=>d.targetId),...publications.rows.map(x=>x.copy?.artifactId),...experiments.rows.map(e=>e.source?.kind==='artifact'?e.source.artifactId:null)].filter((x):x is string=>!!x));
 const artifactIds=ids([...eventIds]),[current,history]=await Promise.all([readArtifacts(owner,artifactIds),readHistory(owner,artifactIds)]);
 const versions=[...current.rows,...history.rows];
 const [snapshots,meetings]=await Promise.all([readSnapshots(owner,ids(versions.map(a=>a.campaignId))),readMeetings(owner,ids(versions.map(a=>a.meetingId)))]);
 const links=await ruleLinks(snapshots.rows,meetings.rows,versions,eventIds);
 const read:Record<RewardKind,Read<unknown>>={campaign:campaignRead,review_decision:decisions,execution_publication:publications,store_order:orders,viral_experiment:experiments,learning_rule:rules,artifact:current,history,learning_snapshot:snapshots,team_meeting:meetings};
 const input:RewardInput={period:{from:p.from,to:p.to},scope:s,decision16:DECISION16_STATE,decisions:decisions.rows,artifacts:versions.map(artifactOf),snapshots:links.snapshots,roleArtifactIds:links.roleArtifactIds,
  publications:publications.rows,orders:orders.rows,experiments:experiments.rows,rules:rules.rows};
 return {input,partial:(Object.keys(read) as RewardKind[]).filter(k=>read[k].truncated)};
}

// 판정 순서: 권한 403 → 스위치 꺼짐 409 → 기간 400 → 범위(없음·다른 워크스페이스 404, 빠짐 400). 저장하지 않는다.
export async function rewardLineageReport(owner:string,params:URLSearchParams,role:'owner'|'admin'|'member'):Promise<RewardLineageResponse>{
 if(role==='member')throw new ApiError(403,M.adminOnly);
 if(!await rewardLineageOn(owner))throw new ApiError(409,M.off);
 const period=periodOf(params),scope=await scopeOf(owner,params),{input,partial}=await lineageInput(owner,scope,period);
 return {enabled:true,decision16:DECISION16_STATE,partial:{kinds:partial},lineage:await rewardLineage(input)};
}
