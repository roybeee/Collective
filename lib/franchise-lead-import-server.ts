// 트랙 R R5b-2 리드 CSV 가져오기 서버: /api/franchise 작업 3개(lead_import_inspect·lead_import_preview·lead_import_confirm)와 GET imports.
// 대표 결정 32(B안, 2026-09-27): 매핑한 이름·전화·이메일 열에서만 연락처를 받아 결정 22의 R4b 경로로 저장한다(필드 'v1.' 암호문, HMAC 중복 키, 열람 감사, 모델 전송 0건, H11 180일 파기).
// 대표 결정(2026-09-27, 교차 파일 중복 병합): '리드 1건, 집계는 파일별'. 연락처 중복 키가 기존 리드와 겹치면 새 리드를 만들지 않고 그 리드에 제공처 기록만 덧붙인다.
// 판정은 순수 모듈 lib/franchise-lead-import.ts가 하고 이 모듈은 문맥 읽기(프로필·이전 가져오기·행사·코드 장부·중복 키)·쓰기·영수증만 한다.
// lib/franchise-server.ts가 잠금(확정만)·요청 제한·영수증 재생(입력 해시)·스위치·브랜드·역할·암호화 키를 먼저 보고 작업을 넘긴다. commit·영수증·파기·리드·이벤트 문장은 port로 받아 이 모듈은 franchise-server를 import하지 않는다.
// 모델 경계(DP-10): 모델 경로가 이 모듈에 닿지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN). 외부 호출·모델 호출이 없다. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {ApiError,database,readRecord,listRecords,uid} from './server';
import {sealField,leadKeyHmac} from './franchise-crypto';
import {GATE_DISCLAIMER} from './franchise-gates';
import {toKstDate} from './franchise-rules';
import {FRANCHISE_ERRORS,isAdminRole,isContactExpired,leadSystemCode,type FranchiseErrorKey,type AuditAction,type LeadRecord,type LeadBasis,type LeadImportRef,type ActorSnapshot,type Role,type SourceChannel,type BudgetBand,type TimingBand} from './franchise';
import {inspectLeadFile,leadImportDecision,base64Bytes,providerKeyOf,LEAD_IMPORT_MESSAGES,LEAD_IMPORT_VERSION,type LeadDecision,type LeadImportPlan,type NormalizedLeadRow,type ExistingMatch,type ImportBasis,type Provenance} from './franchise-lead-import';
import {RECRUITMENT_CHANNEL_LABELS,type RecruitmentChannel} from './franchise-recruitment';
import {codeBook} from './franchise-recruitment-server';

type Json=Record<string,unknown>;
type ActorLite={id:string;role:string};
export const IMPORT_ACTIONS=['lead_import_inspect','lead_import_preview','lead_import_confirm'] as const;
export type ImportAction=typeof IMPORT_ACTIONS[number];
// 검사·미리보기는 쓰기·영수증이 없어 잠금을 잡지 않는다(12,000칸 검사가 직원의 리드 작업을 409로 막지 않게, 명세 4.3). 확정은 잠금 안에서 모든 판정을 다시 하고 계획 해시로 대조한다.
export const IMPORT_NO_LOCK:readonly string[]=['lead_import_inspect','lead_import_preview'];
// 같은 요청 번호로 다른 파일·설정을 확정하면 옛 결과를 재생하지 않고 409다(영수증 입력 해시, 명세 4.3).
export const IMPORT_INPUT_BOUND:readonly string[]=['lead_import_confirm'];
// 파일 검사는 연락처를 복호화·키 계산하지 않아 암호화 키 없이 된다. 미리보기·확정은 중복 키(HMAC)와 암호화가 필요하다.
export const IMPORT_KEY_EXEMPT:readonly string[]=['lead_import_inspect'];
// 감사 행에 더하는 필드(값 없음: 해시·건수·사유 코드·규칙 버전만). 제공처 라벨·머리글·칸 값은 넣지 않는다(명세 4.5).
export type LeadImportAuditExtra={recordId?:string;channel?:string;fileSha256?:string;planSha256?:string;count?:number;skipped?:{overlap:number;duplicateInFile:number};reasons?:string[];ruleVersion?:string;importVersion?:string};
export type LeadImportEvent={id:string;leadId:string;brandId:string;type:'created'|'import_merged';at:string;actor:ActorSnapshot;basis?:Json;importId:string};
export type LeadImportPort={
 commit:(stmts:D1PreparedStatement[],stale:FranchiseErrorKey)=>Promise<unknown>;
 receipt:(action:AuditAction,result:Json,extra:LeadImportAuditExtra,target:string|null)=>D1PreparedStatement;
 plainAudit:(action:AuditAction,extra:LeadImportAuditExtra)=>D1PreparedStatement;
 purgeLead:(lead:LeadRecord)=>Promise<unknown>;
 leadStmt:(lead:LeadRecord)=>D1PreparedStatement;
 eventStmt:(event:LeadImportEvent)=>D1PreparedStatement;
};
export type LeadImportArgs={owner:string;brandId:string;now:string;enabled:boolean;actor:ActorLite;input:Json;action:ImportAction;port:LeadImportPort};
type Outcome={result:Json;extra?:Json};
export type ImportRow={id:string;importId:string;brandId:string;fileSha256:string;hadBom:boolean;encoding:'utf-8';transcodedFrom:string|null;planSha256:string;channel:RecruitmentChannel;
 provider:string;providerKey:string;providedOn:string;period:{from:string;to:string};consentRef:{sha256:string;storageLabel:string}|null;eventId:string|null;
 basis:{type:ImportBasis['type'];referralFrom?:'franchisee';declaredBy:'admin';note:string};mapping:Json;
 counts:{rows:number;created:number;mergedExisting:number;mergedInFile:number;providerLeadCount:number;skipped:{overlap:number;duplicateInFile:number};warnings:Json;attribution:Json};
 receivedRange:{from:string;to:string}|null;ruleVersion:string;importVersion:string;importedAt:string;importedBy:ActorLite};
export class FranchiseImportError extends ApiError{constructor(status:number,message:string,readonly extra:Json={}){super(status,message)}}

// ── 공통 보조 ──
const isRecord=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ID_RE=/^[A-Za-z0-9._:-]{1,128}$/;
function fail(key:FranchiseErrorKey):never{const e=FRANCHISE_ERRORS[key];throw new FranchiseImportError(e.status,e.text)}
type Failure=Extract<LeadDecision<unknown>,{ok:false}>;
const reasonMessages=(codes:readonly string[])=>codes.map(code=>({code,message:(LEAD_IMPORT_MESSAGES as Readonly<Record<string,string>>)[code]??code}));
// 판정 실패를 HTTP로: 첫 사유의 고정 문구(개인정보는 건수만 든 고정 문구)와 사유 코드·위치(행·열 번호 또는 통과한 머리글 이름)·규칙 버전·면책.
const decisionError=(d:Failure)=>new FranchiseImportError(d.status,d.message,{reasons:reasonMessages(d.reasons),...(d.errors?{errors:d.errors}:{}),ruleVersion:d.ruleVersion,disclaimer:d.disclaimer});
async function optionalRecord<T>(owner:string,kind:string,id:string):Promise<T|null>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function payload(input:Json):Json{const out:Json={};for(const k of Object.keys(input))if(!['action','brandId','requestId'].includes(k))out[k]=input[k];return out}
const chunks=<T>(xs:readonly T[],n=90)=>Array.from({length:Math.ceil(xs.length/n)},(_,i)=>xs.slice(i*n,i*n+n));
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const snap=(a:ActorLite):ActorSnapshot=>({id:a.id,role:a.role as Role});
const later=(a:string,b:string)=>Date.parse(b)>Date.parse(a)?b:a;
// 모집 채널 → 리드 접수 방식(SOURCE_LABELS, 명세 2.7.2).
const SOURCE_OF:Readonly<Record<string,SourceChannel>>={portal:'portal',expo:'expo',owner_referral:'referral',briefing:'other'};
const BASIS_NOTE='관리자 선언(열린 질문 14 미정)';

// ── 문맥 ──
async function profileOf(owner:string,brandId:string){
 const p=await optionalRecord<{brandId?:string;branch?:string;storageLabels?:unknown}>(owner,'franchise_profile',brandId);
 const ok=!!p&&p.brandId===brandId;
 return {branch:ok?String(p!.branch??''):null,storageLabels:ok&&Array.isArray(p!.storageLabels)?(p!.storageLabels as unknown[]).filter((x):x is string=>typeof x==='string'):[]};
}
async function eventLite(owner:string,raw:unknown){
 if(typeof raw!=='string'||!ID_RE.test(raw))return null;
 const e=await optionalRecord<{id:string;brandId:string;status:string}>(owner,'recruitment_event',raw);
 return e?{id:e.id,brandId:e.brandId,status:e.status}:null;
}
const importsOf=async(owner:string,brandId:string)=>(await listRecords<ImportRow>(owner,'recruitment_import',brandId)).filter(r=>r.brandId===brandId);
// 파일 해시(원본 바이트 SHA-256)가 이미 기록돼 있는지. base64가 틀리면 false(판정이 인코딩 오류로 닫는다).
async function fileExists(owner:string,csvBase64:unknown){
 const bytes=base64Bytes(csvBase64);
 if(!bytes)return false;
 const sha=hex(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));
 return !!await database().prepare("SELECT 1 FROM records WHERE owner=? AND kind='recruitment_import' AND id=?").bind(owner,`${owner}:recruitment_import:${sha}`).first();
}

// ── 기존 리드 대조(연락처 중복 키) ──
// 새로 만들 대표 행마다 전화·이메일 HMAC 키로 기존 리드를 찾는다(90개씩 한 번에 조회, D1 바인드 한도 100). 전화 키가 먼저다.
// 연락처가 있고 보존 기한 안인 같은 브랜드 리드만 병합 대상이다. 보존 기한이 지난 리드는 대상이 아니고(확정 때 먼저 파기), 리드가 없거나 연락처가 없는 키는 낡은 키다(확정 때 지운다).
type Matches={mergeExisting:ExistingMatch[];leads:Map<string,LeadRecord>;expired:LeadRecord[];staleKeys:string[]};
async function existingMatches(x:LeadImportArgs,rows:readonly NormalizedLeadRow[]):Promise<Matches>{
 const want:{line:number;keys:string[]}[]=[];
 for(const r of rows){
  if(r.merge?.type!=='create'||!r.contact)continue;
  const keys:string[]=[];
  if(r.contact.phone)keys.push(await leadKeyHmac(x.owner,x.brandId,'phone',r.contact.phone));
  if(r.contact.email)keys.push(await leadKeyHmac(x.owner,x.brandId,'email',r.contact.email));
  want.push({line:r.line,keys});
 }
 const ids=[...new Set(want.flatMap(w=>w.keys))].map(k=>`${x.owner}:franchise_lead_key:${k}`),owners=new Map<string,string>();
 for(const part of chunks(ids)){
  const found=await database().prepare(`SELECT id,data FROM records WHERE owner=? AND kind='franchise_lead_key' AND id IN (${part.map(()=>'?').join(',')})`).bind(x.owner,...part).all<{id:string;data:string}>();
  for(const row of found.results)owners.set(row.id,String((JSON.parse(row.data) as {leadId?:unknown}).leadId??''));
 }
 const leads=new Map<string,LeadRecord>(),expired=new Map<string,LeadRecord>(),staleKeys:string[]=[];
 for(const [keyId,leadId] of owners){
  if(leads.has(leadId)||expired.has(leadId))continue;
  const lead=leadId?await optionalRecord<LeadRecord>(x.owner,'franchise_lead',leadId):null;
  if(!lead||lead.brandId!==x.brandId||lead.contactState!=='present')staleKeys.push(keyId);
  else if(isContactExpired(lead,x.now))expired.set(lead.id,lead);
  else leads.set(lead.id,lead);
 }
 const mergeExisting:ExistingMatch[]=[];
 for(const w of want){
  const hit=w.keys.map(k=>owners.get(`${x.owner}:franchise_lead_key:${k}`)).find(id=>id!==undefined&&leads.has(id));
  if(hit)mergeExisting.push({line:w.line,leadId:hit});
 }
 return {mergeExisting,leads,expired:[...expired.values()],staleKeys};
}

// ── 판정(미리보기·확정 공통) ──
// 1차 판정(코드 장부·기존 리드 없이)으로 행과 파일 안 병합을 얻고, 그 행의 코드 장부와 기존 리드 대조를 넣어 2차 판정을 한다. 확정은 2차 판정이 미리보기의 계획 해시·생성 건수와 같아야 한다.
async function decide(x:LeadImportArgs):Promise<{d:LeadDecision<LeadImportPlan>;matches:Matches|null}>{
 const input=payload(x.input),prof=await profileOf(x.owner,x.brandId);
 const prov=isRecord(input.provenance)?input.provenance:{},providerKey=providerKeyOf(prov.provider);
 const [imports,event,exists]=await Promise.all([importsOf(x.owner,x.brandId),eventLite(x.owner,input.eventId),fileExists(x.owner,input.csvBase64)]);
 const base={enabled:x.enabled,brandId:x.brandId,branch:prof.branch,actor:x.actor,now:x.now,today:toKstDate(x.now),storageLabels:prof.storageLabels,
  coveredPeriods:providerKey?imports.filter(r=>r.providerKey===providerKey).map(r=>r.period):[],event,fileExists:exists,bind:null,requireContact:true};
 const probe:Json={};for(const k of Object.keys(input))if(k!=='confirm'&&k!=='expected')probe[k]=input[k];
 const first=await leadImportDecision(probe,{...base,book:{codes:[],tracking:[]}});
 if(!first.ok)return {d:first,matches:null};
 const rows=first.value.normalizedRows,[book,matches]=await Promise.all([codeBook(x.owner,rows.flatMap(r=>r.codes)),existingMatches(x,rows)]);
 return {d:await leadImportDecision(input,{...base,book,mergeExisting:matches.mergeExisting}),matches};
}
// 응답에 싣는 계획 요약: 정규화한 행(연락처 포함)은 서버 전용이라 뺀다. 병합은 건수와 행 번호만이다.
function planView(p:LeadImportPlan):Json{
 return {fileSha256:p.fileSha256,hadBom:p.hadBom,planSha256:p.planSha256,rows:p.rows,toCreate:p.toCreate,providerLeadCount:p.providerLeadCount,merged:p.merged,skipped:p.skipped,warnings:p.warnings,receivedRange:p.receivedRange,
  mapping:p.mapping,provenance:p.provenance,providerKey:p.providerKey,eventId:p.eventId,channel:p.channel,channelLabel:RECRUITMENT_CHANNEL_LABELS[p.channel],basis:p.basis,dropInFileDuplicates:p.dropInFileDuplicates,transcodedFrom:p.transcodedFrom,
  attribution:p.attribution,headers:p.headers,ruleVersion:p.ruleVersion,importVersion:p.importVersion,note:p.note};
}

// ── 작업 ──
export function runLeadImportAction(x:LeadImportArgs):Promise<Outcome>{
 switch(x.action){
  case 'lead_import_inspect':return inspect(x);
  case 'lead_import_preview':return preview(x);
  case 'lead_import_confirm':return confirm(x);
  default:return fail('UNKNOWN_ACTION');
 }
}
async function inspect(x:LeadImportArgs):Promise<Outcome>{
 const prof=await profileOf(x.owner,x.brandId);
 const d=await inspectLeadFile(payload(x.input),{enabled:x.enabled,brandId:x.brandId,branch:prof.branch,actor:x.actor});
 if(!d.ok)throw decisionError(d);
 return {result:{...d.value},extra:{warnings:d.warnings,ruleVersion:d.ruleVersion,importVersion:LEAD_IMPORT_VERSION,disclaimer:d.disclaimer}};
}
async function preview(x:LeadImportArgs):Promise<Outcome>{
 const {d}=await decide(x);
 if(!d.ok)throw decisionError(d);
 return {result:planView(d.value),extra:{warnings:d.warnings,ruleVersion:d.ruleVersion,disclaimer:d.disclaimer}};
}
// 새 리드 코드 n개: 기존 리드 코드와 90개씩 한 번에 대조하고, 이 가져오기 안에서도 겹치지 않게 다시 뽑는다. 다섯 번 뽑아도 모자라면 IMPORT_RETRY 409(제공처 값을 코드로 쓰지 않는다).
async function systemCodes(owner:string,n:number):Promise<string[]>{
 const out:string[]=[];
 for(let round=0;round<5&&out.length<n;round++){
  const draw:string[]=[];
  for(let i=0;i<(n-out.length)*2&&draw.length<n-out.length;i++){const c=leadSystemCode(crypto.getRandomValues(new Uint8Array(32)));if(c&&!out.includes(c)&&!draw.includes(c))draw.push(c)}
  const taken=new Set<string>();
  for(const part of chunks(draw)){
   const rows=await database().prepare(`SELECT json_extract(data,'$.systemCode') AS c FROM records WHERE owner=? AND kind='franchise_lead' AND json_extract(data,'$.systemCode') IN (${part.map(()=>'?').join(',')})`).bind(owner,...part).all<{c:string}>();
   rows.results.forEach(r=>taken.add(r.c));
  }
  out.push(...draw.filter(c=>!taken.has(c)));
 }
 if(out.length<n)fail('IMPORT_RETRY');
 return out.slice(0,n);
}
const PII_REJECT=['sensitive_column_in_file','pii_in_file'];
function basisOf(b:ImportBasis,importId:string,prov:Provenance):LeadBasis{
 if(b.type==='provided')return {type:'provided',importId,provider:prov.provider,providedOn:prov.providedOn,sourceNoticedAt:null};
 if(b.type==='referral')return {type:'referral',referralFrom:'franchisee',sourceNoticedAt:null};
 return {type:'inquiry_response'};
}
// 확정(대표·관리자, 잠금 안): 판정·기존 리드 대조를 다시 한다 → 개인정보 거부면 일반 감사(건수·사유 코드만) → 보존 기한 지난 대상 파기·낡은 키 삭제 → 한 batch:
// 새 리드마다 리드·중복 키·생성 이벤트, 병합 리드마다 제공처 기록 덧붙임·병합 이벤트, 가져오기 기록 INSERT(같은 파일 UNIQUE), 영수증 감사.
async function confirm(x:LeadImportArgs):Promise<Outcome>{
 const {d,matches}=await decide(x);
 if(!d.ok){
  if(d.reasons.some(r=>PII_REJECT.includes(r)))await x.port.commit([x.port.plainAudit('lead_import_rejected',{count:d.errors?.length??0,reasons:[...d.reasons]})],'STALE');
  throw decisionError(d);
 }
 const plan=d.value,m=matches as Matches,basis=plan.basis as ImportBasis,by=snap(x.actor),now=x.now,importId='ri-'+uid();
 for(const lead of m.expired)await x.port.purgeLead(lead);
 if(m.staleKeys.length)await database().batch(m.staleKeys.map(id=>database().prepare("DELETE FROM records WHERE owner=? AND kind='franchise_lead_key' AND id=?").bind(x.owner,id)));
 const creates=plan.normalizedRows.filter(r=>r.merge?.type==='create'),codes=await systemCodes(x.owner,creates.length);
 const refOf=(r:NormalizedLeadRow,merged:boolean):LeadImportRef=>({importId,channel:plan.channel,eventId:plan.eventId,provider:plan.provenance.provider,providerKey:plan.providerKey,providedOn:plan.provenance.providedOn,receivedAt:r.receivedAt,receivedPrecision:r.receivedPrecision,at:now,merged});
 const stmts:D1PreparedStatement[]=[],leadBasis=basisOf(basis,importId,plan.provenance),basisEvent:Json={type:basis.type,...(basis.type==='referral'?{referralFrom:basis.referralFrom}:{})};
 for(const [i,r] of creates.entries()){
  const c=r.contact!,id=uid();
  const lead:LeadRecord={id,brandId:x.brandId,systemCode:codes[i],stage:'inquiry',closeReason:null,closedFrom:null,assigneeId:null,
   contact:{name:await sealField(c.name),phone:c.phone?await sealField(c.phone):null,email:c.email?await sealField(c.email):null},memo:null,contactState:'present',
   task:{region:r.region,budgetBand:r.budgetBand as BudgetBand,timingBand:r.timingBand as TimingBand,sourceChannel:SOURCE_OF[plan.channel]??'online_form_manual',campaignId:null},
   basis:leadBasis,marketing:{status:'none'},firstContactAt:null,lastActivityAt:r.receivedAt,contractedAt:null,closedAt:null,
   ...(r.codes.length?{codes:r.codes.map(code=>({code,at:now,by,source:'import' as const}))}:{}),
   receivedAt:r.receivedAt,receivedPrecision:r.receivedPrecision,importId,imports:[refOf(r,false)],version:1,createdAt:now,createdBy:by,updatedAt:now};
  stmts.push(x.port.leadStmt(lead));
  for(const [type,value] of [['phone',c.phone],['email',c.email]] as const){
   if(!value)continue;
   const key=await leadKeyHmac(x.owner,x.brandId,type,value);
   stmts.push(database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${x.owner}:franchise_lead_key:${key}`,x.owner,'franchise_lead_key',id,JSON.stringify({id:key,leadId:id,brandId:x.brandId,type,createdAt:now}),now));
  }
  stmts.push(x.port.eventStmt({id:'ev-'+uid(),leadId:id,brandId:x.brandId,type:'created',at:now,actor:by,basis:basisEvent,importId}));
 }
 // 병합: 연락처·수집 근거·첫 가져오기는 그대로 두고 제공처 기록만 덧붙인다. 마지막 활동은 더 늦은 접수 시각으로만 옮긴다(가맹희망자의 새 문의).
 for(const r of plan.normalizedRows){
  if(r.merge?.type!=='existing')continue;
  const lead=m.leads.get(r.merge.leadId) as LeadRecord;
  const next:LeadRecord={...lead,imports:[...(lead.imports??[]),refOf(r,true)],lastActivityAt:later(lead.lastActivityAt,r.receivedAt),version:lead.version+1,updatedAt:now};
  stmts.push(x.port.leadStmt(next),x.port.eventStmt({id:'ev-'+uid(),leadId:lead.id,brandId:lead.brandId,type:'import_merged',at:now,actor:by,importId}));
 }
 const counts={rows:plan.rows,created:creates.length,mergedExisting:plan.merged.existing.count,mergedInFile:plan.merged.inFile.count,providerLeadCount:plan.providerLeadCount,skipped:plan.skipped,warnings:{...plan.warnings},attribution:JSON.parse(JSON.stringify(plan.attribution))};
 const record:ImportRow={id:plan.fileSha256,importId,brandId:x.brandId,fileSha256:plan.fileSha256,hadBom:plan.hadBom,encoding:'utf-8',transcodedFrom:plan.transcodedFrom,planSha256:plan.planSha256,channel:plan.channel,
  provider:plan.provenance.provider,providerKey:plan.providerKey,providedOn:plan.provenance.providedOn,period:plan.provenance.period,consentRef:plan.provenance.consentRef,eventId:plan.eventId,
  basis:{...basisEvent as {type:ImportBasis['type'];referralFrom?:'franchisee'},declaredBy:'admin',note:BASIS_NOTE},mapping:{...plan.mapping},counts,receivedRange:plan.receivedRange,ruleVersion:d.ruleVersion,importVersion:plan.importVersion,importedAt:now,importedBy:{id:x.actor.id,role:x.actor.role}};
 stmts.push(database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${x.owner}:recruitment_import:${plan.fileSha256}`,x.owner,'recruitment_import',x.brandId,JSON.stringify(record),now));
 const result={importId,channel:plan.channel,created:creates.length,leadCodes:codes,merged:plan.merged,providerLeadCount:plan.providerLeadCount,skipped:plan.skipped};
 stmts.push(x.port.receipt('lead_import',result,{recordId:importId,channel:plan.channel,fileSha256:plan.fileSha256,planSha256:plan.planSha256,count:creates.length,skipped:plan.skipped,ruleVersion:d.ruleVersion,importVersion:plan.importVersion},null));
 await x.port.commit(stmts,'IMPORT_DUPLICATE');
 return {result,extra:{warnings:d.warnings,ruleVersion:d.ruleVersion,disclaimer:d.disclaimer}};
}

// 리드 보기의 제공처 파일 기록: 가져오기 id·채널과 라벨·행사·제공처 라벨·제공일·접수 시각·병합 여부. 동의 증빙 해시는 리드에 없다.
export function importRefsView(refs:readonly LeadImportRef[]):Json[]{
 return refs.map(i=>({importId:i.importId,channel:i.channel,channelLabel:(RECRUITMENT_CHANNEL_LABELS as Readonly<Record<string,string>>)[i.channel]??i.channel,eventId:i.eventId,provider:i.provider,providedOn:i.providedOn,receivedAt:i.receivedAt,receivedPrecision:i.receivedPrecision,merged:i.merged,at:i.at}));
}

// ── GET imports(대표·관리자) ──
// 가져오기 기록(제공 증빙·건수·버전)과 제공처 키별 선언 기간. 칸 값·머리글은 기록에 없다.
export async function importsView(who:{owner:string;role:string},brandId:string):Promise<Json>{
 if(!isAdminRole(who.role))fail('ADMIN_ONLY');
 const rows=(await importsOf(who.owner,brandId)).sort((a,b)=>Date.parse(b.importedAt)-Date.parse(a.importedAt)||(a.importId<b.importId?-1:1));
 const coverage:Record<string,{from:string;to:string}[]>={};
 for(const r of rows)(coverage[r.providerKey]??=[]).push(r.period);
 return {imports:rows.map(r=>({...r,channelLabel:RECRUITMENT_CHANNEL_LABELS[r.channel]??r.channel})),coverage,importVersion:LEAD_IMPORT_VERSION,disclaimer:GATE_DISCLAIMER};
}
