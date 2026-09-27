// 트랙 R R6b 모집 주간 보고·증빙 묶음 서버: GET 보기 report(모든 역할, 집계만), /api/franchise 작업 3개(report_freeze·report_export·evidence_export, 대표·관리자),
// D1 `recruitment_report`(행 id = <브랜드 id>:<ISO 주>, 확정본과 이전 판 5개) 저장. 계산은 순수 모듈 lib/franchise-report.ts가 하고 이 모듈은 읽기·쓰기·영수증·묶음 조립만 한다.
// lib/franchise-server.ts가 잠금·요청 제한·영수증 재생·스위치·브랜드·역할을 먼저 보고 작업을 넘긴다. commit·영수증·게이트 판정(증빙 완결·계약 창)은 port로 받아
// 이 모듈은 franchise-server를 import하지 않는다(순환 없음). 확정은 확인한 다이제스트와 지금 다시 계산한 다이제스트가 다르면 409다(재집계 대조).
// 내려받기·증빙 묶음은 감사 행에 파일·묶음 SHA-256만 남기고 본문은 남기지 않는다. 증빙 묶음에는 연락처·메모 값이 없다(리드 시스템 코드·단계·이벤트·증빙 기록만).
// 모델 경계(DP-10): 모델 경로가 이 모듈에 닿지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN). 외부·모델 호출이 없다(LLM 0). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {ApiError,database,readRecord,listRecords,recordStatement} from './server';
import {isEnabled} from './feature-flags';
import {toKstDate,FRANCHISE_RULES_VERSION} from './franchise-rules';
import {GATE_DISCLAIMER} from './franchise-gates';
import {FRANCHISE_ERRORS,type FranchiseErrorKey,type AuditAction,type LeadRecord} from './franchise';
import {RECRUITMENT_VERSION,PLATFORM_REPORTED_NOTE,attributeLead,attributionInputs,type LeadAttribution} from './franchise-recruitment';
import {codeBook,attributionView,type CodeRow,type SpendStored} from './franchise-recruitment-server';
import {REPORT_VERSION,buildRecruitmentReport,reportDigestSource,reportMarkdown,reportCsv,reportFileName,reportWeek,isoWeekOfDate,reportLeadCodes,type RecruitmentReport,type ReportWeek,type ReportSpendRow} from './franchise-report';

type Json=Record<string,unknown>;
type ActorLite={id:string;role:string};
export const REPORT_ACTIONS=['report_freeze','report_export','evidence_export'] as const;
export type ReportAction=typeof REPORT_ACTIONS[number];
// 스위치가 꺼져도 되는 작업: 확정본 내려받기와 증빙 묶음(읽기·입증). 확정은 스위치가 켜져야 한다.
export const REPORT_OFF_EXEMPT:readonly string[]=['report_export','evidence_export'];
export const EVIDENCE_SCHEMA='collective.recruitment-evidence.v1';
export const REPORT_HISTORY=5;
// 감사 행에 더하는 필드(값 없음): 보고 주·판·형식·파일/묶음 해시·묶음 범위·리드 id.
export type ReportAuditExtra={recordId?:string;reportVersion?:number;format?:string;bundleSha256?:string;bundleScope?:'lead'|'asset';leadId?:string};
// 게이트 판정 요약(lib/franchise-server.ts가 만든다): 증빙 기록(정정·무효 표시), 계약 가능 시각 창, 계약 게이트 결과, 산정서 의무. complete는 계약 기록이 없으면 null.
export type LeadGateSummary={complete:boolean|null;evidence:Json[];window:Json;contracted:Json|null;forecastDuty:string};
export type GatePort=(owner:string,brandId:string,leads:readonly LeadRecord[],now:string)=>Promise<Map<string,LeadGateSummary>>;
export type ReportPort={commit:(stmts:D1PreparedStatement[],stale:FranchiseErrorKey)=>Promise<unknown>;receipt:(action:AuditAction,result:Json,extra:ReportAuditExtra,target:string|null)=>D1PreparedStatement;gates:GatePort};
export type ReportArgs={owner:string;brandId:string;now:string;actor:ActorLite;input:Json;action:ReportAction;port:ReportPort};
type Outcome={result:Json;extra?:Json};
type FrozenVersion={version:number;report:RecruitmentReport;digest:string;frozenAt:string;frozenBy:ActorLite};
export type FrozenReport=FrozenVersion&{id:string;brandId:string;week:string;history:FrozenVersion[]};
export class FranchiseReportError extends ApiError{constructor(status:number,message:string,readonly extra:Json={}){super(status,message)}}

// ── 공통 보조 ──
const isRecord=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ID_RE=/^[A-Za-z0-9._:-]{1,128}$/;
const idOk=(v:unknown):v is string=>typeof v==='string'&&ID_RE.test(v);
function fail(key:FranchiseErrorKey):never{const e=FRANCHISE_ERRORS[key];throw new FranchiseReportError(e.status,e.text)}
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export const sha256Hex=async(s:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
async function optionalRecord<T>(owner:string,kind:string,id:string):Promise<T|null>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const guard=(owner:string,key:string,version:number)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT id,owner,kind,parent_id,data,updated_at FROM records WHERE id=? AND owner=? AND json_extract(data,\'$.version\') IS NOT ?').bind(key,owner,version);
const insertRow=(owner:string,row:FrozenReport,now:string)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:recruitment_report:${row.id}`,owner,'recruitment_report',row.brandId,JSON.stringify(row),now);
function weekOf(raw:unknown,today:string):ReportWeek{
 const w=typeof raw==='string'?reportWeek(raw.trim()):null;
 if(!w)fail('REPORT_WEEK');
 if(w.from>today)fail('REPORT_WEEK_FUTURE');
 return w;
}
const byAt=(a:{at?:unknown;id?:unknown},b:{at?:unknown;id?:unknown})=>String(a.at)<String(b.at)?-1:String(a.at)>String(b.at)?1:String(a.id)<String(b.id)?-1:1;

// ── 보고서 입력 읽기 ──
const spendLite=(r:SpendStored):ReportSpendRow=>({id:r.id,version:r.version,channel:r.channel,period:r.period,amountExVat:r.amountExVat,createdAt:r.createdAt,voided:r.voided?{at:r.voided.at,reason:r.voided.reason}:null,platform:r.platform??null});
async function reportFor(owner:string,brandId:string,w:ReportWeek,now:string,gates:GatePort):Promise<RecruitmentReport>{
 const [leadRows,spendRows,blocked]=await Promise.all([listRecords<LeadRecord>(owner,'franchise_lead',brandId),listRecords<SpendStored>(owner,'recruitment_spend',brandId),
  database().prepare("SELECT json_extract(data,'$.at') AS at FROM records WHERE owner=? AND kind='franchise_lead_event' AND json_extract(data,'$.brandId')=? AND json_extract(data,'$.type')='transition_blocked'").bind(owner,brandId).all<{at:string}>()]);
 const leads=leadRows.filter(l=>l.brandId===brandId),book=await codeBook(owner,leads.flatMap(l=>(l.codes??[]).map(c=>c.code)));
 const summary=await gates(owner,brandId,leads.filter(l=>l.contractedAt),now);
 return buildRecruitmentReport({brandId,week:w.week,asOf:now,leads,book,spend:spendRows.filter(r=>r.brandId===brandId).map(spendLite),blockedAttempts:blocked.results.map(b=>({at:b.at})),
  contractEvidence:[...summary].map(([leadId,g])=>({leadId,complete:g.complete===true}))});
}
const digestOf=(r:RecruitmentReport)=>sha256Hex(reportDigestSource(r));

// ── GET 보기 report(모든 역할, 스위치가 꺼져도 읽는다) ──
type Viewer={owner:string;id:string;role:string};
export async function reportView(who:Viewer,brandId:string,params:URLSearchParams,now:string,gates:GatePort):Promise<Json>{
 const today=toKstDate(now),w=weekOf(params.get('week')||isoWeekOfDate(today),today);
 const [report,frozen,enabled]=await Promise.all([reportFor(who.owner,brandId,w,now,gates),optionalRecord<FrozenReport>(who.owner,'recruitment_report',`${brandId}:${w.week}`),isEnabled(who.owner,'r_franchise')]);
 const digest=await digestOf(report);
 return {enabled,role:who.role,week:w.week,period:w,closed:w.to<today,preview:report,digest,
  frozen:frozen&&frozen.brandId===brandId?{version:frozen.version,digest:frozen.digest,frozenAt:frozen.frozenAt,frozenBy:{id:frozen.frozenBy.id,role:frozen.frozenBy.role},changedSinceFreeze:frozen.digest!==digest,
   versions:[frozen,...frozen.history].map(v=>({version:v.version,frozenAt:v.frozenAt,digest:v.digest}))}:null,
  ruleVersion:REPORT_VERSION,disclaimer:GATE_DISCLAIMER};
}

// ── 작업 ──
export function runReportAction(x:ReportArgs):Promise<Outcome>{
 switch(x.action){
  case 'report_freeze':return reportFreeze(x);
  case 'report_export':return reportExport(x);
  case 'evidence_export':return evidenceExport(x);
  default:return fail('UNKNOWN_ACTION');
 }
}
// 재생 대상(lib/franchise-server.ts targetOf): 확정은 주, 내려받기는 주·형식·판, 증빙 묶음은 범위·대상 id.
export function reportTargetOf(action:string,input:Json):string|undefined{
 if(action==='report_freeze')return String(input.week??'');
 if(action==='report_export')return `${String(input.week??'')}:${String(input.format??'')}:${input.version===undefined?'':String(input.version)}`;
 if(action==='evidence_export')return `${String(input.scope??'')}:${String(input.scope==='asset'?input.assetId??'':input.leadId??'')}`;
 return undefined;
}
// 확정(대표·관리자, 스위치 켜짐): 끝난 주만 → 확인(confirmed·expected.digest) → 다시 계산한 다이제스트 대조(다르면 409) → 판 보호 + 새 판(이전 판 5개) + 영수증.
async function reportFreeze(x:ReportArgs):Promise<Outcome>{
 const today=toKstDate(x.now),w=weekOf(x.input.week,today);
 if(!(w.to<today))fail('REPORT_WEEK_OPEN');
 const expected=isRecord(x.input.expected)?x.input.expected.digest:undefined;
 if(x.input.confirmed!==true||typeof expected!=='string')fail('REPORT_CONFIRM');
 const report=await reportFor(x.owner,x.brandId,w,x.now,x.port.gates),digest=await digestOf(report);
 if(digest!==expected)fail('REPORT_CHANGED');
 const id=`${x.brandId}:${w.week}`,old=await optionalRecord<FrozenReport>(x.owner,'recruitment_report',id);
 const prior=old&&old.brandId===x.brandId?old:null,version=(prior?.version??0)+1;
 const row:FrozenReport={id,brandId:x.brandId,week:w.week,version,report,digest,frozenAt:x.now,frozenBy:{id:x.actor.id,role:x.actor.role},
  history:prior?[{version:prior.version,report:prior.report,digest:prior.digest,frozenAt:prior.frozenAt,frozenBy:prior.frozenBy},...prior.history].slice(0,REPORT_HISTORY):[]};
 const result={week:w.week,version,digest};
 const write=prior?[guard(x.owner,`${x.owner}:recruitment_report:${id}`,prior.version),recordStatement(x.owner,'recruitment_report',id,row,x.brandId)]:[insertRow(x.owner,row,x.now)];
 await x.port.commit([...write,x.port.receipt('report_freeze',result,{recordId:w.week,reportVersion:version},w.week)],'REPORT_STALE');
 return {result,extra:{ruleVersion:REPORT_VERSION,disclaimer:GATE_DISCLAIMER}};
}

// ── 내려받기(확정본만, 대표·관리자, 스위치가 꺼져도 된다) ──
const TYPES={md:'text/markdown; charset=utf-8',csv:'text/csv; charset=utf-8',json:'application/json; charset=utf-8'} as const;
type Format=keyof typeof TYPES;
const formatOf=(v:unknown):Format=>typeof v==='string'&&Object.hasOwn(TYPES,v)?v as Format:fail('REPORT_FORMAT');
const render=(r:RecruitmentReport,f:Format)=>f==='md'?reportMarkdown(r):f==='csv'?reportCsv(r):JSON.stringify(r,null,1);
async function frozenFile(owner:string,brandId:string,week:string,versionRaw:unknown,format:Format){
 const row=await optionalRecord<FrozenReport>(owner,'recruitment_report',`${brandId}:${week}`);
 if(!row||row.brandId!==brandId)fail('REPORT_NOT_FOUND');
 const want=versionRaw===undefined||versionRaw===null?row.version:versionRaw,found=[row,...row.history].find(v=>v.version===want);
 if(!found)fail('REPORT_NOT_FOUND');
 const body=render(found.report,format);
 return {version:found.version,fileName:reportFileName(found.report,format),contentType:TYPES[format],body,sha256:await sha256Hex(body)};
}
async function reportExport(x:ReportArgs):Promise<Outcome>{
 const w=weekOf(x.input.week,toKstDate(x.now)),format=formatOf(x.input.format),file=await frozenFile(x.owner,x.brandId,w.week,x.input.version,format);
 const result={week:w.week,version:file.version,format,fileName:file.fileName};
 await x.port.commit([x.port.receipt('report_export',result,{recordId:w.week,reportVersion:file.version,format,bundleSha256:file.sha256},reportTargetOf('report_export',x.input)??null)],'REPORT_STALE');
 return {result,extra:{...file,disclaimer:GATE_DISCLAIMER}};
}

// ── 증빙 묶음(대표·관리자, 스위치가 꺼져도 된다) ──
type AssetRow={id:string;version:number;brandId:string;campaignId:string;type:string;body:string;bodyHash:string;factRefs:unknown[];disclosureVersionId:string|null;status:string;approval:unknown;placements:unknown[];exports:unknown[];review:unknown;createdAt:string;updatedAt:string};
type EventRowLite={id:string;leadId:string;brandId:string;type:string;at:string;actor:ActorLite;from?:string;to?:string;reasonCodes?:string[];fields?:string[];taskFields?:string[];evidenceId?:string;evidenceType?:string;supersedes?:string|null;voided?:true;closeReason?:string|null;count?:number;importId?:string};
const pickEvent=(e:EventRowLite)=>({id:e.id,type:e.type,at:e.at,actor:{id:e.actor?.id??null,role:e.actor?.role??null},...(e.from?{from:e.from}:{}),...(e.to?{to:e.to}:{}),...(e.reasonCodes?{reasonCodes:e.reasonCodes}:{}),
 ...(e.fields?{fields:e.fields}:{}),...(e.taskFields?{taskFields:e.taskFields}:{}),...(e.evidenceId?{evidenceId:e.evidenceId}:{}),...(e.evidenceType?{evidenceType:e.evidenceType}:{}),...(e.supersedes?{supersedes:e.supersedes}:{}),
 ...(e.voided?{voided:true}:{}),...(e.closeReason?{closeReason:e.closeReason}:{}),...(e.count!==undefined?{count:e.count}:{}),...(e.importId?{importId:e.importId}:{})});
const assetVersionView=(a:AssetRow)=>({version:a.version,type:a.type,status:a.status,bodyHash:a.bodyHash,body:a.body,factRefs:a.factRefs,disclosureVersionId:a.disclosureVersionId,approval:a.approval,exports:a.exports,placements:a.placements,review:a.review,createdAt:a.createdAt,updatedAt:a.updatedAt});
const ruleVersions=()=>({report:REPORT_VERSION,recruitment:RECRUITMENT_VERSION,rules:FRANCHISE_RULES_VERSION});
async function leadBundle(owner:string,brandId:string,leadId:unknown,asOf:string,gates:GatePort):Promise<Json>{
 const lead=idOk(leadId)?await optionalRecord<LeadRecord>(owner,'franchise_lead',leadId):null;
 if(!lead||lead.brandId!==brandId)fail('LEAD_NOT_FOUND');
 const codes=reportLeadCodes(lead),book=await codeBook(owner,(lead.codes??[]).map(c=>c.code)),a:LeadAttribution=attributeLead(codes,book,{asOf});
 const [events,gate]=await Promise.all([listRecords<EventRowLite>(owner,'franchise_lead_event',lead.id),gates(owner,brandId,[lead],asOf)]);
 const ref=a.state==='attributed'&&a.basis==='code'?a.assetRef:null,asset=ref?await optionalRecord<AssetRow>(owner,'recruitment_asset',`${ref.id}:${ref.version}`):null,g=gate.get(lead.id);
 return {schema:EVIDENCE_SCHEMA,scope:'lead',brandId,asOf,
  lead:{id:lead.id,systemCode:lead.systemCode,stage:lead.stage,closedFrom:lead.closedFrom,closeReason:lead.closeReason,contactState:lead.contactState,createdAt:lead.createdAt,receivedAt:codes.receivedAt,receivedPrecision:lead.receivedPrecision??'time',
   importId:lead.importId??null,firstContactAt:lead.firstContactAt,contractedAt:lead.contractedAt,closedAt:lead.closedAt,sourceChannel:lead.task?.sourceChannel??null,campaignId:lead.task?.campaignId??null},
  attribution:{...attributionView(a),inputs:attributionInputs({...codes,id:lead.id},book,{asOf})},
  codes:(lead.codes??[]).map(c=>({code:c.code,at:c.at,source:c.source})),codeStrikes:(lead.codeStrikes??[]).map(s=>({code:s.code,at:s.at,reason:s.reason})),
  imports:(lead.imports??[]).map(i=>({importId:i.importId,channel:i.channel,eventId:i.eventId,provider:i.provider,providedOn:i.providedOn,receivedAt:i.receivedAt,merged:i.merged})),
  asset:asset&&asset.brandId===brandId?{id:asset.id,version:asset.version,type:asset.type,status:asset.status,bodyHash:asset.bodyHash,approval:asset.approval,review:asset.review}:null,
  events:events.filter(e=>e.leadId===lead.id).sort(byAt).map(pickEvent),
  evidence:g?.evidence??[],contractWindow:g?.window??null,contractGate:g?.contracted??null,forecastDuty:g?.forecastDuty??null,
  ruleVersions:ruleVersions(),disclaimer:GATE_DISCLAIMER};
}
async function assetBundle(owner:string,brandId:string,assetId:unknown,asOf:string):Promise<Json>{
 if(!idOk(assetId))fail('ASSET_NOT_FOUND');
 const [assets,codes,spend,events,leads]=await Promise.all([listRecords<AssetRow>(owner,'recruitment_asset',brandId),listRecords<CodeRow>(owner,'recruitment_code',brandId),listRecords<SpendStored>(owner,'recruitment_spend',brandId),
  listRecords<{id:string;brandId:string;type:string;startsAt:string;status:string;counts:unknown;assetRefs?:{id:string;version:number}[]}>(owner,'recruitment_event',brandId),listRecords<LeadRecord>(owner,'franchise_lead',brandId)]);
 const mine=assets.filter(a=>a.brandId===brandId&&a.id===assetId).sort((a,b)=>a.version-b.version);
 if(!mine.length)fail('ASSET_NOT_FOUND');
 const linked=codes.filter(c=>c.brandId===brandId&&c.assetRef?.id===assetId).sort((a,b)=>a.code<b.code?-1:1);
 const own=leads.filter(l=>l.brandId===brandId),book=await codeBook(owner,own.flatMap(l=>(l.codes??[]).map(c=>c.code))),byVersion:Record<string,number>={};
 for(const l of own){const a=attributeLead(reportLeadCodes(l),book,{asOf});if(a.state==='attributed'&&a.basis==='code'&&a.assetRef?.id===assetId)byVersion[String(a.assetRef.version)]=(byVersion[String(a.assetRef.version)]??0)+1}
 return {schema:EVIDENCE_SCHEMA,scope:'asset',brandId,asOf,asset:{id:assetId,type:mine[mine.length-1].type,campaignId:mine[mine.length-1].campaignId},versions:mine.map(assetVersionView),
  codes:linked.map(c=>({code:c.code,channel:c.channel,label:c.label,validFrom:c.validFrom,status:c.status,retiredOn:c.retiredOn??null,assetVersion:c.assetRef?.version??null})),
  attributed:{byVersion,total:Object.values(byVersion).reduce((s,n)=>s+n,0),note:'코드 귀속 리드 수(귀속≠증분)'},
  spend:spend.filter(s=>s.brandId===brandId&&s.assetRef?.id===assetId).sort((a,b)=>a.id<b.id?-1:1).map(s=>({id:s.id,channel:s.channel,period:s.period,amountExVat:s.amountExVat,status:s.status,assetVersion:s.assetRef?.version??null,platform:s.platform??null,note:PLATFORM_REPORTED_NOTE})),
  events:events.filter(e=>e.brandId===brandId&&(e.assetRefs??[]).some(r=>r.id===assetId)).sort((a,b)=>a.id<b.id?-1:1).map(e=>({id:e.id,type:e.type,startsAt:e.startsAt,status:e.status,counts:e.counts,assetVersions:(e.assetRefs??[]).filter(r=>r.id===assetId).map(r=>r.version)})),
  ruleVersions:ruleVersions(),disclaimer:GATE_DISCLAIMER};
}
// 묶음 해시는 asOf를 뺀 JSON의 SHA-256이다(같은 기록이면 같은 해시). 본문은 asOf를 포함한 들여쓴 JSON이다.
async function bundleOf(owner:string,brandId:string,input:Json,asOf:string,gates:GatePort){
 const scope:'lead'|'asset'=input.scope==='lead'?'lead':input.scope==='asset'?'asset':fail('EVIDENCE_SCOPE');
 const bundle=scope==='lead'?await leadBundle(owner,brandId,input.leadId,asOf,gates):await assetBundle(owner,brandId,input.assetId,asOf);
 const sha256=await sha256Hex(JSON.stringify(bundle,(k,v)=>k==='asOf'?undefined:v));
 const target=scope==='lead'?String(input.leadId):String(input.assetId),safe=(s:string)=>s.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80);
 return {scope,target,sha256,body:JSON.stringify(bundle,null,1),fileName:`recruitment-evidence-${safe(brandId)}-${scope}-${safe(target)}.json`,contentType:TYPES.json};
}
async function evidenceExport(x:ReportArgs):Promise<Outcome>{
 const b=await bundleOf(x.owner,x.brandId,x.input,x.now,x.port.gates);
 const result={scope:b.scope,target:b.target,fileName:b.fileName};
 await x.port.commit([x.port.receipt('evidence_export',result,{bundleScope:b.scope,bundleSha256:b.sha256,...(b.scope==='lead'?{leadId:b.target}:{recordId:b.target})},reportTargetOf('evidence_export',x.input)??null)],'REPORT_STALE');
 return {result,extra:{fileName:b.fileName,contentType:b.contentType,body:b.body,sha256:b.sha256,disclaimer:GATE_DISCLAIMER}};
}

// ── 재생(5분 안·지금 대표·관리자, 감사 행의 해시와 같을 때만 다시 만든다) ──
export async function replayReportExport(owner:string,brandId:string,action:string,audit:ReportAuditExtra&{at:string;result?:Json},gates:GatePort):Promise<Json>{
 const r=audit.result??{};
 if(action==='report_export'){
  const file=await frozenFile(owner,brandId,String(r.week??''),audit.reportVersion,formatOf(r.format));
  if(file.sha256!==audit.bundleSha256)fail('REPLAY_EXPIRED');
  return {...file,disclaimer:GATE_DISCLAIMER};
 }
 const scope=audit.bundleScope,input={scope,...(scope==='lead'?{leadId:audit.leadId}:{assetId:audit.recordId})};
 const b=await bundleOf(owner,brandId,input,audit.at,gates);
 if(b.sha256!==audit.bundleSha256)fail('REPLAY_EXPIRED');
 return {fileName:b.fileName,contentType:b.contentType,body:b.body,sha256:b.sha256,disclaimer:GATE_DISCLAIMER};
}
