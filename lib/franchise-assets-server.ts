// 트랙 R R15a-2a 모집 자료·행사 서버: D1 `recruitment_asset`(판마다 한 행, id <자료 id>:<판>)·`recruitment_event`(행사마다 한 행) 저장, /api/franchise 작업 9개·GET 보기 3개,
// 사실·정보공개서 버전 변경 재검토 훅(R15a-1 남은 위험 1), 조건부 쓰기 보호(rowGuard·reviewStatement). 판정은 순수 모듈 lib/franchise-assets.ts가 하고 이 모듈은 문맥 읽기·쓰기·영수증만 한다.
// lib/franchise-server.ts가 잠금(owner+':franchise')·요청 제한·영수증 재생·스위치·브랜드·역할을 먼저 보고 작업을 넘긴다. commit·영수증은 port로 받아 이 모듈은 franchise-server를 import하지 않는다(순환 없음).
// 오류 문구(명세 4.2 결정): 실시간 판정 실패 응답은 판정기 원문 발췌(franchiseGateError)를 담을 수 있다(요청자 본인의 모집 문안, 기존 발행 게이트와 같음).
// 감사·영수증 행과 콘솔에는 사유 코드와 고정 문구만 남기고 원문·발췌·게시 위치 라벨·장소 라벨·가명 코드를 남기지 않는다. 자료 원문은 개인정보 검사를 하지 않고(문의 경로 절의 브랜드 대표번호), 라벨·장소는 검사한다.
// 모델 경계(DP-10): 모델 경로가 이 모듈에 닿지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN). 외부 호출·모델 호출이 없다. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {ApiError,database,readRecord,listRecords,recordStatement,stamp,uid,str} from './server';
import {isEnabled} from './feature-flags';
import {scanText} from './pii-scan';
import {loadFranchiseContext} from './franchise-facts-server';
import {factCaption,factLine,versionStates,type VersionLite} from './franchise-facts';
import {franchiseIssueLabels} from './franchise-compliance';
import {GATE_DISCLAIMER} from './franchise-gates';
import {toKstDate} from './franchise-rules';
import {franchiseItem,factLabel} from './fact-catalog';
import {isRecruitmentObjective,type Campaign,type Artifact} from './agency';
import type {BrandFact} from './brand-facts';
import {FRANCHISE_ERRORS,type FranchiseErrorKey,type AuditAction} from './franchise';
import {ASSET_TYPE_ORDER,ASSET_TYPE_LABELS,EVENT_TYPE_LABELS as ASSET_EVENT_TYPE_LABELS,ASSET_MESSAGES,ASSET_RULES,ID_PATTERN,STARTUP_PAGE_SECTIONS,EVENT_DECK_SECTIONS,
 validateAssetInput,draftAsset,approveDecision,exportDecision,placementDecision,assetGateIssues,approvalChecklist,h7Notice,effectiveAssetFacts,sectionTemplate,markAssetsForReview,changedVersionIds,
 validateEvent,registerDecision,attendanceDecision,type RecruitmentAsset,type RecruitmentEvent,type AssetReview,type AssetType,type EventCounts,type Decision} from './franchise-assets';

type Json=Record<string,unknown>;
type ActorLite={id:string;role:string};
// 출처 작업물(같은 캠페인의 승인된 현재 판). origin은 작업물 origin이고 모르면 null. aiGenerated는 origin이 ai·ai_edited일 때 참.
export type AssetSource={artifactId:string;version:number;origin:'manual'|'ai'|'ai_edited'|null};
// rev: 쓰기 순번(1부터, 잠금 밖 재검토 표시도 올린다). exports는 최대 50개(첫 기록은 게시 확인일 하한이라 남긴다), 전체 건수는 exportCount.
export type AssetRow=RecruitmentAsset&{rev:number;source:AssetSource|null;aiGenerated:boolean;savedBy:ActorLite;exportCount:number;retiredAt?:string;retiredBy?:ActorLite};
export type EventRow=RecruitmentEvent&{createdBy:ActorLite;cancelledAt?:string;cancelledBy?:ActorLite};
export const ASSET_ACTIONS=['asset_save','asset_approve','asset_export','asset_place','asset_retire'] as const;
export const EVENT_ACTIONS=['event_save','event_cancel','event_register','event_attendance'] as const;
export type AssetAction=typeof ASSET_ACTIONS[number]|typeof EVENT_ACTIONS[number];
// 넘기면 LIMIT 409.
export const ASSET_LIMITS=Object.freeze({assetsPerBrand:100,versionsPerAsset:10,eventsPerBrand:200,exportsKept:50});
// 감사 행에 더하는 필드(값 없음: id·판·해시·방식·버전·사유 코드·건수만).
export type AssetAuditExtra={recordId?:string;assetVersion?:number;bodyHash?:string;mode?:'copy'|'download';checklistVersion?:string;judgeVersion?:string;reasons?:string[];eventVersion?:number;eventCounts?:EventCounts;withCode?:boolean;aiGenerated?:boolean;placementCount?:number};
// franchise-server가 넘기는 쓰기 창구: commit은 UNIQUE 실패를 stale 키의 409로 바꾸고, receipt는 영수증 감사 행(au-<rid>)을 만든다.
export type AssetPort={commit:(stmts:D1PreparedStatement[],stale:FranchiseErrorKey)=>Promise<unknown>;receipt:(action:AuditAction,result:Json,extra:AssetAuditExtra,target:string|null,status?:number)=>D1PreparedStatement};
export type AssetArgs={owner:string;brandId:string;now:string;enabled:boolean;actor:ActorLite;input:Json;action:AssetAction;port:AssetPort};
type Outcome={result:Json;extra?:Json};
type Failure=Extract<Decision<unknown>,{ok:false}>;
export class FranchiseAssetError extends ApiError{constructor(status:number,message:string,readonly extra:Json={}){super(status,message)}}

// ── 공통 보조 ──
const isRecord=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const posInt=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1;
const idOk=(v:unknown):v is string=>typeof v==='string'&&ID_PATTERN.test(v);
// 저장의 자료·행사 id: undefined·null·''만 '새 자료·새 행사'다. 그 밖의 값(숫자·객체 등)은 주어진 id로 보고 로더가 형식 검사로 404를 낸다(새 행으로 만들지 않는다).
const given=(v:unknown)=>v!==undefined&&v!==null&&v!=='';
function fail(key:FranchiseErrorKey):never{const e=FRANCHISE_ERRORS[key];throw new FranchiseAssetError(e.status,e.text)}
const reasonMessages=(codes:readonly string[])=>codes.map(code=>({code,message:(ASSET_MESSAGES as Readonly<Record<string,string>>)[code]??code}));
// 판정 실패를 HTTP로: 실시간 응답은 판정 문구(발췌 포함 가능)와 사유 코드·고정 사유 문구·규칙 버전·면책.
const decisionError=(d:Failure)=>new FranchiseAssetError(d.status,d.message,{reasons:reasonMessages(d.reasons),ruleVersion:d.ruleVersion,disclaimer:d.disclaimer});
const assetKey=(owner:string,rowId:string)=>`${owner}:recruitment_asset:${rowId}`;
const rowIdOf=(a:{id:string;version:number})=>`${a.id}:${a.version}`;
const revOf=(a:{rev?:unknown}):number|null=>typeof a.rev==='number'?a.rev:null;
const nextRev=(a:{rev?:unknown})=>(revOf(a)??0)+1;
const exportCountOf=(a:{exportCount?:unknown;exports:readonly unknown[]})=>typeof a.exportCount==='number'?a.exportCount:a.exports.length;
const actorOf=(a:ActorLite):ActorLite=>({id:a.id,role:a.role});
const typeRank=(t:string)=>{const i=(ASSET_TYPE_ORDER as readonly string[]).indexOf(t);return i<0?ASSET_TYPE_ORDER.length:i};
const typeLabel=(t:string)=>(ASSET_TYPE_LABELS as Readonly<Record<string,string>>)[t]??t;
const byId=<T extends {id:string}>(a:T,b:T)=>a.id<b.id?-1:a.id>b.id?1:0;
async function optionalRecord<T>(owner:string,kind:string,id:string):Promise<T|null>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
// 요청 번호가 이미 쓰인 대상과 같아야 재생한다(lib/franchise-server.ts targetOf와 같은 규칙): 새 자료·새 행사 저장은 null.
const assetTarget=(x:AssetArgs)=>x.action==='asset_save'?(typeof x.input.assetId==='string'&&x.input.assetId?x.input.assetId:null):String(x.input.assetId??'');
const eventTarget=(x:AssetArgs)=>x.action==='event_save'?(typeof x.input.eventId==='string'&&x.input.eventId?x.input.eventId:null):String(x.input.eventId??'');

// ── 조건부 쓰기 보호 ──
// 읽은 뒤 행이 바뀌었으면 같은 id 행을 다시 INSERT해 UNIQUE 실패로 batch 전체를 되돌린다. commit이 ASSET_STALE·EVENT_STALE 409로 바꾼다. path는 두 리터럴 중 하나(사용자 입력 아님).
// batch의 첫 문장으로 둔다(자료: 저장(바로 앞 판)·승인·내보내기·게시 위치·폐기의 $.rev, 행사: 기존 행을 바꾸는 모든 작업의 $.version). 운영 D1 batch와 로컬 런타임 batch 모두 트랜잭션이다.
export const rowGuard=(owner:string,kind:'recruitment_asset'|'recruitment_event',rowId:string,path:'$.rev'|'$.version',expected:number|null)=>
 database().prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT id,owner,kind,parent_id,data,updated_at FROM records WHERE id=? AND owner=? AND json_extract(data,'${path}') IS NOT ?`).bind(`${owner}:${kind}:${rowId}`,owner,expected);
// 재검토 표시(가맹 잠금 밖, owner 잠금 아래에서 돈다). 읽은 rev와 같을 때만 바꾸는 조건부 UPDATE이고 rev를 올린다. 테스트용으로 export.
export const reviewStatement=(owner:string,rowId:string,review:AssetReview,expectedRev:number|null,now:string)=>
 database().prepare("UPDATE records SET data=json_set(data,'$.review',json(?),'$.rev',?,'$.updatedAt',?),updated_at=? WHERE id=? AND owner=? AND kind='recruitment_asset' AND json_extract(data,'$.rev') IS ?").bind(JSON.stringify(review),(expectedRev??0)+1,now,now,assetKey(owner,rowId),owner,expectedRev);

// ── 행 읽기 ──
// version이 없으면 최신 판. 형식이 틀린 id·없는 행·다른 브랜드 행은 모두 ASSET_NOT_FOUND 404다.
async function loadAsset(owner:string,brandId:string,assetId:unknown,version?:unknown):Promise<AssetRow>{
 if(!idOk(assetId))fail('ASSET_NOT_FOUND');
 let data:string|undefined;
 if(version===undefined)data=(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=? AND json_extract(data,'$.id')=? ORDER BY json_extract(data,'$.version') DESC LIMIT 1").bind(owner,brandId,assetId).first<{data:string}>())?.data;
 else{
  if(!posInt(version))fail('ASSET_NOT_FOUND');
  data=(await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='recruitment_asset'").bind(assetKey(owner,`${assetId}:${version}`),owner).first<{data:string}>())?.data;
 }
 const row=data?JSON.parse(data) as AssetRow:null;
 if(!row||row.brandId!==brandId||row.id!==assetId)fail('ASSET_NOT_FOUND');
 return row;
}
async function loadEvent(owner:string,brandId:string,eventId:unknown):Promise<EventRow>{
 const row=idOk(eventId)?await optionalRecord<EventRow>(owner,'recruitment_event',eventId):null;
 if(!row||row.brandId!==brandId||row.id!==eventId)fail('EVENT_NOT_FOUND');
 return row;
}
const countOf=async(sql:string,...binds:unknown[])=>Number((await database().prepare(sql).bind(...binds).first<{n:number}>())?.n??0);
const assetCount=(owner:string,brandId:string)=>countOf("SELECT COUNT(DISTINCT json_extract(data,'$.id')) AS n FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=?",owner,brandId);
const versionRowCount=(owner:string,brandId:string,assetId:string)=>countOf("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=? AND json_extract(data,'$.id')=?",owner,brandId,assetId);
const eventCount=(owner:string,brandId:string)=>countOf("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='recruitment_event' AND parent_id=?",owner,brandId);

// ── 판정 문맥(명세 4.6) ──
type FactContext={branch:string|null;versions:VersionLite[];facts:BrandFact[]};
// 분기·정보공개서 버전은 가맹 문맥 로더, 사실은 이 브랜드 행 전부 + 참조 id 가운데 목록에 없는 것(앞에서부터 최대 20개, 다른 브랜드 사실이면 fact_other_brand 400이 나오게).
async function factContext(owner:string,brandId:string,refs:unknown):Promise<FactContext>{
 const [fr,facts]=await Promise.all([loadFranchiseContext(owner,brandId),listRecords<BrandFact>(owner,'brand_fact',brandId)]);
 if(Array.isArray(refs)){
  const have=new Set(facts.map(f=>f.id)),missing=[...new Set(refs.map(r=>isRecord(r)?r.id:undefined).filter((id):id is string=>typeof id==='string'&&id.length>0&&id.length<=100&&!have.has(id)))].slice(0,20);
  for(const id of missing){const f=await optionalRecord<BrandFact>(owner,'brand_fact',id);if(f)facts.push(f)}
 }
 return {branch:fr.profile?.branch??null,versions:fr.versions,facts};
}
const campaignOf=(owner:string,id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=100?optionalRecord<Campaign>(owner,'campaign',id):Promise.resolve(null);
const liteOf=(c:Campaign|null)=>c?{id:c.id,brandId:c.brandId,objective:c.objective}:null;
async function decisionContext(x:{owner:string;brandId:string;now:string;enabled:boolean},row:AssetRow){
 const [ctx,campaign]=await Promise.all([factContext(x.owner,x.brandId,row.factRefs),campaignOf(x.owner,row.campaignId)]);
 return {enabled:x.enabled,brandId:x.brandId,branch:ctx.branch,campaign:liteOf(campaign),facts:ctx.facts,versions:ctx.versions,now:x.now};
}
// 행사 연결 후보: 이 브랜드 자료 판의 요약 ∪ 참조 id·판의 레코드 키 조회(최대 10개, 같은 소유자의 다른 브랜드 자료면 record_other_brand).
type PoolRow=Pick<RecruitmentAsset,'id'|'version'|'brandId'|'status'|'type'>;
const POOL_COLUMNS="json_extract(data,'$.id') AS id,json_extract(data,'$.version') AS version,json_extract(data,'$.brandId') AS brandId,json_extract(data,'$.status') AS status,json_extract(data,'$.type') AS type";
async function assetPool(owner:string,brandId:string,refs:unknown):Promise<PoolRow[]>{
 const own=(await database().prepare(`SELECT ${POOL_COLUMNS} FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=?`).bind(owner,brandId).all<PoolRow>()).results;
 const keys=Array.isArray(refs)?[...new Set(refs.filter((r):r is {id:string;version:number}=>isRecord(r)&&idOk(r.id)&&posInt(r.version)).map(r=>assetKey(owner,rowIdOf(r))))].slice(0,10):[];
 const other=keys.length?(await database().prepare(`SELECT ${POOL_COLUMNS} FROM records WHERE owner=? AND kind='recruitment_asset' AND id IN (${keys.map(()=>'?').join(',')})`).bind(owner,...keys).all<PoolRow>()).results:[];
 const seen=new Set<string>();
 return [...own,...other].filter(r=>{const k=r.id+':'+r.version;if(seen.has(k))return false;seen.add(k);return true});
}

// ── 작업 ──
export async function runAssetAction(x:AssetArgs):Promise<Outcome>{
 switch(x.action){
  case 'asset_save':return assetSave(x);
  case 'asset_approve':return assetApprove(x);
  case 'asset_export':return assetExport(x);
  case 'asset_place':return assetPlace(x);
  case 'asset_retire':return assetRetire(x);
  case 'event_save':return eventSave(x);
  case 'event_cancel':return eventCancel(x);
  case 'event_register':return eventRegister(x);
  case 'event_attendance':return eventAttendance(x);
  default:return fail('UNKNOWN_ACTION');
 }
}
// 출처: 입력에 source가 없으면(null 포함) 이전 판 값을 이어받는다(지울 수 없다). 주면 같은 캠페인의 승인된 현재 판 작업물이어야 한다.
async function sourceOf(owner:string,raw:unknown,campaignId:string,inherited:AssetSource|null):Promise<AssetSource|null>{
 if(raw===undefined||raw===null)return inherited;
 if(!isRecord(raw)||!idOk(raw.artifactId)||!posInt(raw.version))fail('SOURCE_INVALID');
 const a=await optionalRecord<Artifact>(owner,'artifact',raw.artifactId);
 if(!a||a.campaignId!==campaignId||a.status!=='approved'||a.version!==raw.version)fail('SOURCE_INVALID');
 return {artifactId:a.id,version:a.version,origin:a.origin==='manual'||a.origin==='ai'||a.origin==='ai_edited'?a.origin:null};
}
const aiOf=(s:AssetSource|null)=>s?.origin==='ai'||s?.origin==='ai_edited';
// 초안 저장(모든 역할): 최신 판 CAS(baseVersion) → 캠페인(기존 자료는 이전 값) → 문맥 → 입력 검사(분기는 보지 않는다) → 출처 → 같은 값이면 쓰기 없음 → 한도.
// 바로 앞 판이 증빙이 아닌 초안(승인·내보내기 없음)이면 같은 batch에서 지운다. 저장도 바로 앞 판의 $.rev 보호를 batch 첫 문장으로 둔다.
async function assetSave(x:AssetArgs):Promise<Outcome>{
 const i=x.input,prev=given(i.assetId)?await loadAsset(x.owner,x.brandId,i.assetId):null;
 if(prev&&i.baseVersion!==prev.version)fail('ASSET_STALE');
 const campaignId=prev?prev.campaignId:str(i.campaignId,'캠페인',100,true);
 const [ctx,campaign]=await Promise.all([factContext(x.owner,x.brandId,i.factRefs),campaignOf(x.owner,campaignId)]);
 const d=validateAssetInput(i,{enabled:x.enabled,brandId:x.brandId,branch:ctx.branch,campaign:liteOf(campaign),facts:ctx.facts,versions:ctx.versions,now:x.now});
 if(!d.ok)throw decisionError(d);
 const source=await sourceOf(x.owner,i.source,campaignId,prev?.source??null);
 const draft=await draftAsset(prev,d.value,{id:prev?.id??'ra-'+uid(),brandId:x.brandId,campaignId,now:x.now});
 if(prev&&draft===prev)return {result:{assetId:prev.id,version:prev.version,unchanged:true}};
 const removable=!!prev&&prev.status==='draft'&&prev.approval===null&&prev.exports.length===0;
 if(prev){if(await versionRowCount(x.owner,x.brandId,prev.id)-(removable?1:0)>=ASSET_LIMITS.versionsPerAsset)fail('LIMIT')}
 else if(await assetCount(x.owner,x.brandId)>=ASSET_LIMITS.assetsPerBrand)fail('LIMIT');
 const row:AssetRow={...draft,rev:1,source,aiGenerated:aiOf(source),savedBy:actorOf(x.actor),exportCount:0};
 const result={assetId:row.id,version:row.version,bodyHash:row.bodyHash,status:row.status};
 // 잠금(120초)이 도중에 풀려 다른 요청이 끼어들어도(교차 검토 C1) 승인·내보낸 판을 지우거나 먼저 쓴 새 판을 덮어쓰지 않는다:
 // 바로 앞 판의 rev 보호(첫 문장) → 읽은 상태 그대로인 초안만 지우는 조건부 DELETE → 새 판은 upsert가 아닌 INSERT(같은 판이 이미 있으면 UNIQUE → ASSET_STALE 409).
 await x.port.commit([
  ...(prev?[rowGuard(x.owner,'recruitment_asset',rowIdOf(prev),'$.rev',revOf(prev))]:[]),
  ...(removable&&prev?[database().prepare("DELETE FROM records WHERE id=? AND owner=? AND kind='recruitment_asset' AND json_extract(data,'$.status')='draft' AND json_extract(data,'$.approval') IS NULL AND json_array_length(data,'$.exports')=0 AND json_extract(data,'$.rev') IS ?").bind(assetKey(x.owner,rowIdOf(prev)),x.owner,revOf(prev))]:[]),
  database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(assetKey(x.owner,rowIdOf(row)),x.owner,'recruitment_asset',x.brandId,JSON.stringify(row),x.now),
  x.port.receipt('asset_save',result,{recordId:row.id,assetVersion:row.version,bodyHash:row.bodyHash,aiGenerated:row.aiGenerated},assetTarget(x)),
 ],'ASSET_STALE');
 return {result,extra:{warnings:d.warnings,ruleVersion:d.ruleVersion,disclaimer:d.disclaimer}};
}
// 승인·내보내기의 409 판정 실패는 막힘 영수증(asset_blocked, 사유 코드·고정 문구만)을 먼저 커밋하고 던진다. 같은 요청 번호로 다시 보내면 같은 사유의 409가 재생된다. 400·403은 쓰지 않는다.
async function blocked(x:AssetArgs,row:AssetRow,d:Failure):Promise<never>{
 if(d.status===409)await x.port.commit([x.port.receipt('asset_blocked',{error:FRANCHISE_ERRORS.ASSET_BLOCKED.text,reasons:reasonMessages(d.reasons),ruleVersion:d.ruleVersion,disclaimer:d.disclaimer},{recordId:row.id,assetVersion:row.version,reasons:[...d.reasons]},assetTarget(x),409)],'ASSET_STALE');
 throw decisionError(d);
}
// 승인·내보내기는 최신 판만(옛 승인 판은 증빙과 행사 연결용).
async function latestAsset(x:AssetArgs){
 const row=await loadAsset(x.owner,x.brandId,x.input.assetId);
 if(x.input.version!==row.version)fail('ASSET_STALE');
 return row;
}
async function assetApprove(x:AssetArgs):Promise<Outcome>{
 const row=await latestAsset(x);
 const d=await approveDecision(row,x.input,{...await decisionContext(x,row),actor:x.actor});
 if(!d.ok)return blocked(x,row,d);
 const approval=d.value.approval,next:AssetRow={...row,status:'approved',approval,rev:nextRev(row),updatedAt:x.now};
 const result={assetId:row.id,version:row.version,status:'approved',approvedAt:approval.at,checklistVersion:approval.checklist.version};
 await x.port.commit([rowGuard(x.owner,'recruitment_asset',rowIdOf(row),'$.rev',revOf(row)),recordStatement(x.owner,'recruitment_asset',rowIdOf(row),next,x.brandId),
  x.port.receipt('asset_approve',result,{recordId:row.id,assetVersion:row.version,bodyHash:row.bodyHash,checklistVersion:approval.checklist.version,aiGenerated:!!row.aiGenerated},assetTarget(x))],'ASSET_STALE');
 return {result,extra:{aiGenerated:!!row.aiGenerated,warnings:d.warnings,ruleVersion:d.ruleVersion,disclaimer:d.disclaimer}};
}
const exportFilename=(type:AssetType,brandId:string,now:string,version:number)=>`recruitment-${type}-${brandId.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80)}-${toKstDate(now).replace(/-/g,'')}-v${version}.txt`;
// 내보낸 원문은 판정이 돌려준 body(해시한 바이트와 같음)만 준다. BOM·줄바꿈 변환 없음.
const exportPayload=(row:AssetRow,d:{value:{body:string};warnings:string[];ruleVersion:string;disclaimer:string},brandId:string,now:string)=>({body:d.value.body,filename:exportFilename(row.type,brandId,now,row.version),contentType:'text/plain;charset=utf-8',aiGenerated:!!row.aiGenerated,warnings:d.warnings,ruleVersion:d.ruleVersion,disclaimer:d.disclaimer});
async function assetExport(x:AssetArgs):Promise<Outcome>{
 const mode=x.input.mode;
 if(mode!=='copy'&&mode!=='download')fail('EXPORT_MODE');
 const row=await latestAsset(x);
 const d=await exportDecision(row,{...await decisionContext(x,row),actor:x.actor});
 if(!d.ok)return blocked(x,row,d);
 const record=d.value.record,all=[...row.exports,record],exports=all.length>ASSET_LIMITS.exportsKept?[all[0],...all.slice(-(ASSET_LIMITS.exportsKept-1))]:all;
 const next:AssetRow={...row,exports,exportCount:exportCountOf(row)+1,rev:nextRev(row)};
 const result={assetId:row.id,version:row.version,bodyHash:row.bodyHash,mode,exportedAt:record.at};
 await x.port.commit([rowGuard(x.owner,'recruitment_asset',rowIdOf(row),'$.rev',revOf(row)),recordStatement(x.owner,'recruitment_asset',rowIdOf(row),next,x.brandId),
  x.port.receipt('asset_export',result,{recordId:row.id,assetVersion:row.version,bodyHash:row.bodyHash,mode,judgeVersion:record.judgeVersion,checklistVersion:record.checklistVersion,aiGenerated:!!row.aiGenerated},assetTarget(x))],'ASSET_STALE');
 return {result,extra:exportPayload(row,d,x.brandId,x.now)};
}
// 내보내기 재생(lib/franchise-server.ts replay가 5분 안·대표·관리자일 때 부른다): 행을 다시 읽고 스위치·문맥을 새로 읽어 판정을 다시 돌린다(읽기 전용). exports는 늘리지 않는다.
// 행이 없거나, 판정이 ok가 아니거나(폐기·재검토·분기 변경 등), 행의 해시가 감사 행 해시와 다르면 REPLAY_EXPIRED 409다.
// 판정은 지금 시각(now)으로 다시 돌리고, 파일 이름의 날짜만 처음 내보낸 시각(감사 행 at)으로 만든다(KST 자정을 넘는 재생도 같은 파일 이름, 교차 검토 C4).
export async function replayAssetExport(owner:string,brandId:string,who:ActorLite,audit:{recordId?:unknown;assetVersion?:unknown;bodyHash?:unknown;at?:unknown},now:string):Promise<Json>{
 let row:AssetRow;
 try{row=await loadAsset(owner,brandId,audit.recordId,audit.assetVersion)}catch(e){if(e instanceof FranchiseAssetError)fail('REPLAY_EXPIRED');throw e}
 const d=await exportDecision(row,{...await decisionContext({owner,brandId,now,enabled:await isEnabled(owner,'r_franchise')},row),actor:actorOf(who)});
 if(!d.ok||row.bodyHash!==audit.bodyHash)fail('REPLAY_EXPIRED');
 const exportedAt=typeof audit.at==='string'&&Number.isFinite(Date.parse(audit.at))?audit.at:now;
 return exportPayload(row,d,brandId,exportedAt);
}
// 게시 위치(대표·관리자): 어느 판이든(내보낸 승인 판). 라벨은 개인정보 검사를 한다(값은 감사에 남기지 않는다).
async function assetPlace(x:AssetArgs):Promise<Outcome>{
 const row=await loadAsset(x.owner,x.brandId,x.input.assetId,x.input.version??0);
 if(typeof x.input.label==='string'&&scanText(x.input.label).length)fail('PII_IN_TEXT');
 const d=placementDecision(row,x.input,{enabled:x.enabled,brandId:x.brandId,actor:x.actor,now:x.now});
 if(!d.ok)throw decisionError(d);
 const next:AssetRow={...row,placements:[...row.placements,d.value.placement],rev:nextRev(row)};
 const result={assetId:row.id,version:row.version,placements:next.placements.length};
 await x.port.commit([rowGuard(x.owner,'recruitment_asset',rowIdOf(row),'$.rev',revOf(row)),recordStatement(x.owner,'recruitment_asset',rowIdOf(row),next,x.brandId),
  x.port.receipt('asset_place',result,{recordId:row.id,assetVersion:row.version,placementCount:next.placements.length},assetTarget(x))],'ASSET_STALE');
 return {result};
}
// 폐기(대표·관리자, 스위치가 꺼져도 된다): 어느 판이든. 이미 폐기면 쓰기 없음.
async function assetRetire(x:AssetArgs):Promise<Outcome>{
 const row=await loadAsset(x.owner,x.brandId,x.input.assetId,x.input.version??0);
 if(row.status==='retired')return {result:{assetId:row.id,version:row.version,status:'retired',unchanged:true}};
 const next:AssetRow={...row,status:'retired',retiredAt:x.now,retiredBy:actorOf(x.actor),rev:nextRev(row)};
 const result={assetId:row.id,version:row.version,status:'retired'};
 await x.port.commit([rowGuard(x.owner,'recruitment_asset',rowIdOf(row),'$.rev',revOf(row)),recordStatement(x.owner,'recruitment_asset',rowIdOf(row),next,x.brandId),
  x.port.receipt('asset_retire',result,{recordId:row.id,assetVersion:row.version},assetTarget(x))],'ASSET_STALE');
 return {result};
}
// 행사 등록·변경(대표·관리자, 분기 A): 판 CAS → 비용 참조(R5 전에는 null만) → 장소 개인정보 → 캠페인·연결 후보·분기 → 판정 → 한도.
async function eventSave(x:AssetArgs):Promise<Outcome>{
 const i=x.input,prev=given(i.eventId)?await loadEvent(x.owner,x.brandId,i.eventId):null;
 if(prev&&i.version!==prev.version)fail('EVENT_STALE');
 const spendRef=i.spendRef===undefined?null:i.spendRef;
 if(spendRef!==null)fail('SPEND_REF_UNAVAILABLE');
 if(typeof i.placeLabel==='string'&&scanText(i.placeLabel).length)fail('PII_IN_TEXT');
 const [campaign,pool,fr]=await Promise.all([campaignOf(x.owner,i.campaignId),assetPool(x.owner,x.brandId,i.assetRefs),loadFranchiseContext(x.owner,x.brandId)]);
 const d=validateEvent({...i,spendRef},{enabled:x.enabled,brandId:x.brandId,branch:fr.profile?.branch??null,campaign:liteOf(campaign),assets:pool,actor:x.actor,now:x.now},prev);
 if(!d.ok)throw decisionError(d);
 if(!prev&&await eventCount(x.owner,x.brandId)>=ASSET_LIMITS.eventsPerBrand)fail('LIMIT');
 const row:EventRow=prev?{...prev,...d.value,version:prev.version+1,updatedAt:x.now}
  :{id:'re-'+uid(),brandId:x.brandId,campaignId:campaign!.id,...d.value,counts:{applied:0,attended:0,noShow:0},codes:[],status:'scheduled',version:1,createdAt:x.now,updatedAt:x.now,createdBy:actorOf(x.actor)};
 const result={eventId:row.id,version:row.version,status:row.status};
 await x.port.commit([...(prev?[rowGuard(x.owner,'recruitment_event',prev.id,'$.version',prev.version)]:[]),recordStatement(x.owner,'recruitment_event',row.id,row,x.brandId),
  x.port.receipt('event_save',result,{recordId:row.id,eventVersion:row.version},eventTarget(x))],'EVENT_STALE');
 return {result,extra:{warnings:d.warnings,ruleVersion:d.ruleVersion,disclaimer:d.disclaimer}};
}
async function eventCancel(x:AssetArgs):Promise<Outcome>{
 const row=await loadEvent(x.owner,x.brandId,x.input.eventId);
 if(x.input.version!==row.version)fail('EVENT_STALE');
 if(row.status==='cancelled')return {result:{eventId:row.id,version:row.version,status:'cancelled',unchanged:true}};
 const next:EventRow={...row,status:'cancelled',cancelledAt:x.now,cancelledBy:actorOf(x.actor),version:row.version+1,updatedAt:x.now};
 const result={eventId:row.id,version:next.version,status:'cancelled'};
 await x.port.commit([rowGuard(x.owner,'recruitment_event',row.id,'$.version',row.version),recordStatement(x.owner,'recruitment_event',row.id,next,x.brandId),
  x.port.receipt('event_cancel',result,{recordId:row.id,eventVersion:next.version},eventTarget(x))],'EVENT_STALE');
 return {result};
}
// 신청(모든 역할): 판 번호 없이 추가만 한다. 정원·시작·중복은 잠금 안에서 최신 행으로 다시 판정한다. 가명 코드를 리드 기록과 대조하지 않는다(리드를 읽지 않는다).
async function eventRegister(x:AssetArgs):Promise<Outcome>{
 const row=await loadEvent(x.owner,x.brandId,x.input.eventId),fr=await loadFranchiseContext(x.owner,x.brandId);
 const d=registerDecision(row,{code:x.input.code},{enabled:x.enabled,brandId:x.brandId,branch:fr.profile?.branch??null,now:x.now});
 if(!d.ok)throw decisionError(d);
 const next:EventRow={...row,counts:d.value.counts,codes:d.value.codes,version:row.version+1,updatedAt:x.now};
 const result={eventId:row.id,version:next.version,counts:next.counts};
 await x.port.commit([rowGuard(x.owner,'recruitment_event',row.id,'$.version',row.version),recordStatement(x.owner,'recruitment_event',row.id,next,x.brandId),
  x.port.receipt('event_register',result,{recordId:row.id,eventVersion:next.version,withCode:x.input.code!==undefined&&x.input.code!==null},eventTarget(x))],'EVENT_STALE');
 return {result};
}
// 참석(모든 역할): 건수를 덮어쓰므로 판 CAS가 필요하다.
async function eventAttendance(x:AssetArgs):Promise<Outcome>{
 const row=await loadEvent(x.owner,x.brandId,x.input.eventId);
 if(x.input.version!==row.version)fail('EVENT_STALE');
 const fr=await loadFranchiseContext(x.owner,x.brandId);
 const d=attendanceDecision(row,x.input,{enabled:x.enabled,brandId:x.brandId,branch:fr.profile?.branch??null,now:x.now});
 if(!d.ok)throw decisionError(d);
 const next:EventRow={...row,counts:d.value.counts,codes:d.value.codes,version:row.version+1,updatedAt:x.now};
 const result={eventId:row.id,version:next.version,counts:next.counts};
 await x.port.commit([rowGuard(x.owner,'recruitment_event',row.id,'$.version',row.version),recordStatement(x.owner,'recruitment_event',row.id,next,x.brandId),
  x.port.receipt('event_attendance',result,{recordId:row.id,eventVersion:next.version,eventCounts:next.counts},eventTarget(x))],'EVENT_STALE');
 return {result};
}

// ── 사실·정보공개서 버전 변경 재검토 훅(명세 5절) ──
// 참조 사실의 판이 오르거나(affectsPublications와 무관) 저장 당시 정보공개서 버전이 바뀌면 초안·승인 판에 재검토를 표시한다(폐기 판 제외, 두 번 적용해도 같다). 스위치를 읽지 않는다(보호만 한다).
// 후보를 SQL로 먼저 거르고(목록은 JSON 배열 바인드 하나라 바인드 수가 늘지 않는다) 조건부 UPDATE로 표시한다. 바뀐 행이 0인 항목은 한 번만 다시 읽고 다시 적용한다. 바뀐 행 수를 돌려준다.
const CANDIDATES="SELECT data FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=? AND json_extract(data,'$.status') IN ('draft','approved') AND (EXISTS(SELECT 1 FROM json_each(data,'$.factRefs') j WHERE json_extract(j.value,'$.id') IN (SELECT value FROM json_each(?))) OR json_extract(data,'$.disclosureVersionId') IN (SELECT value FROM json_each(?)))";
async function applyReview(owner:string,rows:readonly AssetRow[],change:{factIds:string[];versionIds:string[]},now:string){
 const byKey=new Map(rows.map(r=>[rowIdOf(r),r])),marks=markAssetsForReview(rows,change,now);
 if(!marks.length)return {changed:0,missed:[] as string[]};
 const results=await database().batch(marks.map(m=>reviewStatement(owner,rowIdOf(m),m.review,revOf(byKey.get(rowIdOf(m))!),now)));
 let changed=0;const missed:string[]=[];
 marks.forEach((m,k)=>{const n=Number(results[k]?.meta?.changes??0);changed+=n;if(!n)missed.push(rowIdOf(m))});
 return {changed,missed};
}
export async function markAssetsForChange(owner:string,brandId:string,change:{factIds?:string[];versionIds?:string[]},now:string):Promise<number>{
 const factIds=[...new Set(change.factIds??[])],versionIds=[...new Set(change.versionIds??[])];
 if(!factIds.length&&!versionIds.length)return 0;
 const parse=(r:{data:string})=>JSON.parse(r.data) as AssetRow;
 const rows=(await database().prepare(CANDIDATES).bind(owner,brandId,JSON.stringify(factIds),JSON.stringify(versionIds)).all<{data:string}>()).results.map(parse);
 const first=await applyReview(owner,rows,{factIds,versionIds},now);
 if(!first.missed.length)return first.changed;
 const reread=(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=? AND id IN (SELECT value FROM json_each(?))").bind(owner,brandId,JSON.stringify(first.missed.map(k=>assetKey(owner,k)))).all<{data:string}>()).results.map(parse);
 return first.changed+(await applyReview(owner,reread,{factIds,versionIds},now)).changed;
}
// 정보공개서 버전 등록·정정·사용 중지(lib/franchise-server.ts versionFactReview): current에서 벗어나거나 각주가 바뀐 버전 id와 그 버전을 근거로 쓴 확정 사실 id로 표시한다.
export async function markAssetsForVersionChange(owner:string,brandId:string,before:readonly VersionLite[],after:readonly VersionLite[],now:string,noteChangedId:string|null,factIds:readonly string[]):Promise<number>{
 const versionIds=changedVersionIds(before,after,now,noteChangedId);
 if(!versionIds.length&&!factIds.length)return 0;
 return markAssetsForChange(owner,brandId,{factIds:[...factIds],versionIds},now);
}

// ── GET 보기(모든 역할, 연락처 키 불필요) ──
type Viewer={owner:string;id:string;role:string};
// 보관한 캠페인(lib/campaign-archive.ts archivedAt)은 새 자료·행사 후보에서 뺀다.
const isArchived=(c:Campaign)=>{const at=(c as unknown as {archivedAt?:unknown}).archivedAt;return typeof at==='string'&&at!==''};
const recruitCampaigns=(all:readonly Campaign[],brandId:string)=>all.filter(c=>c.brandId===brandId&&isRecruitmentObjective(c)&&!isArchived(c)).sort(byId).map(c=>({id:c.id,title:c.title}));
export async function assetView(who:Viewer,brandId:string,view:'assets'|'asset'|'events',params:URLSearchParams):Promise<Json>{
 if(view==='assets')return assetsView(who,brandId);
 if(view==='asset')return assetDetailView(who,brandId,params);
 return eventsView(who,brandId);
}
// 목록: 원문을 뺀 요약 쿼리. 판정기는 돌리지 않는다. 템플릿의 창업비용 표는 유효하고 현재 버전인 총 창업비용 사실의 사실 줄·각주로 채운다(id 순).
async function assetsView(who:Viewer,brandId:string):Promise<Json>{
 const owner=who.owner,now=stamp();
 const [rows,campaigns,ctx,enabled]=await Promise.all([database().prepare("SELECT json_remove(data,'$.body') AS data FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=?").bind(owner,brandId).all<{data:string}>(),listRecords<Campaign>(owner,'campaign'),factContext(owner,brandId,null),isEnabled(owner,'r_franchise')]);
 const groups=new Map<string,Omit<AssetRow,'body'>[]>();
 for(const a of rows.results.map(r=>JSON.parse(r.data) as Omit<AssetRow,'body'>).filter(a=>a.brandId===brandId))groups.set(a.id,[...(groups.get(a.id)??[]),a]);
 const campaignById=new Map(campaigns.map(c=>[c.id,c]));
 const assets=[...groups.values()].map(g=>{
  const versions=[...g].sort((a,b)=>b.version-a.version),l=versions[0],c=campaignById.get(l.campaignId),approval=l.approval;
  return {assetId:l.id,type:l.type,typeLabel:typeLabel(l.type),campaignId:l.campaignId,campaignTitle:c?.title??null,campaignMissing:!c,
   latest:{version:l.version,status:l.status,bodyHash:l.bodyHash,review:l.review,approval:approval?{by:approval.by,role:approval.role,at:approval.at}:null,exportCount:exportCountOf(l),lastExportAt:l.exports.length?l.exports[l.exports.length-1].at:null,placements:l.placements,updatedAt:l.updatedAt,aiGenerated:!!l.aiGenerated},
   versions:versions.map(a=>({version:a.version,status:a.status,exportCount:exportCountOf(a)}))};
 }).sort((a,b)=>typeRank(a.type)-typeRank(b.type)||Date.parse(b.latest.updatedAt)-Date.parse(a.latest.updatedAt)||(a.assetId<b.assetId?-1:1));
 const effective=effectiveAssetFacts(ctx.facts,brandId,now),states=versionStates(ctx.versions,now);
 const costFacts=effective.filter(f=>franchiseItem(f.key)?.key==='startup_cost_total'&&!!f.sourceRef&&states[f.sourceRef.disclosureVersionId]==='current').sort(byId);
 const caption=costFacts.length?factCaption(costFacts,ctx.versions):null;
 const template=(type:'startup_page'|'event_deck')=>{
  const text=sectionTemplate(type),cost=(type==='startup_page'?STARTUP_PAGE_SECTIONS:EVENT_DECK_SECTIONS).find(s=>s.costLines);
  return caption&&cost?text.replace(cost.heading,()=>cost.heading+'\n'+caption):text;
 };
 return {assets,campaigns:recruitCampaigns(campaigns,brandId),types:ASSET_TYPE_ORDER.map(t=>({type:t,label:ASSET_TYPE_LABELS[t]})),templates:{startup_page:template('startup_page'),event_deck:template('event_deck')},
  templateFactRefs:costFacts.map(f=>({id:f.id,version:f.version})),costFactsMissing:!costFacts.length,
  facts:effective.map(f=>({id:f.id,version:f.version,key:f.key,label:factLabel(f.key),line:factLine(f),hasSource:!!f.sourceRef})),
  branch:ctx.branch,h7Notice:h7Notice(ctx.branch),enabled,role:who.role,limits:ASSET_LIMITS,rules:ASSET_RULES,disclaimer:GATE_DISCLAIMER};
}
// 상세: 원문 포함(rev 제외). 판정기는 이 보기에서만 돈다. drift는 참조 판과 현재 사실 판의 차이이고, 재검토 표시가 없어도 '현재 사실로 새 판 저장'을 안내한다.
async function assetDetailView(who:Viewer,brandId:string,params:URLSearchParams):Promise<Json>{
 const owner=who.owner,now=stamp(),v=params.get('version');
 const row=await loadAsset(owner,brandId,params.get('assetId')??'',v===null||v===''?undefined:Number(v));
 const [ctx,campaign,enabled,versions]=await Promise.all([factContext(owner,brandId,row.factRefs),campaignOf(owner,row.campaignId),isEnabled(owner,'r_franchise'),
  database().prepare("SELECT json_extract(data,'$.version') AS version,json_extract(data,'$.status') AS status FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=? AND json_extract(data,'$.id')=? ORDER BY json_extract(data,'$.version') DESC").bind(owner,brandId,row.id).all<{version:number;status:string}>()]);
 const g=assetGateIssues(row,{brandId,facts:ctx.facts,versions:ctx.versions,now});
 const drift=row.factRefs.map(r=>{const cur=ctx.facts.find(f=>f.id===r.id&&f.brandId===brandId);return {factId:r.id,refVersion:r.version,currentVersion:cur?cur.version:null,changed:!cur||cur.version!==r.version}});
 const resaveSuggested=row.review.needed||drift.some(d=>d.changed)||g.codes.some(c=>c==='fact_changed'||c==='version_not_current');
 return {asset:Object.fromEntries(Object.entries(row).filter(([k])=>k!=='rev')),latestVersion:versions.results[0]?.version??row.version,versions:versions.results.map(x=>({version:x.version,status:x.status})),
  gate:{status:g.status,reasons:reasonMessages(g.codes),message:g.message,warnings:g.judgement?franchiseIssueLabels(g.judgement).warnings:[]},checklist:approvalChecklist(g.judgement,ctx.branch),
  drift,resaveSuggested,source:row.source??null,aiGenerated:!!row.aiGenerated,campaign:campaign?{id:campaign.id,title:campaign.title}:null,branch:ctx.branch,h7Notice:h7Notice(ctx.branch),enabled,disclaimer:GATE_DISCLAIMER};
}
// 행사: 행 전부(시작 시각 내림차순, 최대 200). followUps는 시작 뒤 48시간 안의 예정 행사 합계(가명 코드 없음).
async function eventsView(who:Viewer,brandId:string):Promise<Json>{
 const owner=who.owner,now=stamp(),t=Date.parse(now);
 const [rows,pool,campaigns,fr,enabled]=await Promise.all([listRecords<EventRow>(owner,'recruitment_event',brandId),assetPool(owner,brandId,null),listRecords<Campaign>(owner,'campaign'),loadFranchiseContext(owner,brandId),isEnabled(owner,'r_franchise')]);
 const own=rows.filter(e=>e.brandId===brandId),latest=new Map<string,number>();
 for(const p of pool)if(p.brandId===brandId)latest.set(p.id,Math.max(latest.get(p.id)??0,p.version));
 const due=own.filter(e=>e.status==='scheduled'&&Date.parse(e.startsAt)<=t&&t<Date.parse(e.startsAt)+48*3600000);
 const events=[...own].sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt)||byId(a,b)).slice(0,ASSET_LIMITS.eventsPerBrand).map(e=>({...e,typeLabel:(ASSET_EVENT_TYPE_LABELS as Readonly<Record<string,string>>)[e.type]??e.type,
  assetRefs:e.assetRefs.map(r=>{const p=pool.find(a=>a.id===r.id&&a.version===r.version&&a.brandId===brandId);return {id:r.id,version:r.version,type:p?.type??null,status:p?.status??null}})}));
 return {events,followUps:{count:due.length,attended:due.reduce((n,e)=>n+e.counts.attended,0),noShow:due.reduce((n,e)=>n+e.counts.noShow,0)},
  approvedAssets:pool.filter(p=>p.brandId===brandId&&p.status==='approved').sort((a,b)=>typeRank(a.type)-typeRank(b.type)||byId(a,b)||b.version-a.version).map(p=>({id:p.id,version:p.version,type:p.type,typeLabel:typeLabel(p.type),latest:latest.get(p.id)===p.version})),
  campaigns:recruitCampaigns(campaigns,brandId),branch:fr.profile?.branch??null,h7Notice:h7Notice(fr.profile?.branch??null),enabled,disclaimer:GATE_DISCLAIMER};
}
