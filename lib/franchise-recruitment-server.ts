// 트랙 R R5b-1 모집 코드·모집 비용 서버: D1 `recruitment_code`(코드마다 한 행, id=코드)·`recruitment_spend`(비용마다 한 행, id rs-<uuid>) 저장, /api/franchise 작업 4개(code_issue·code_retire·spend_record·spend_void),
// GET 보기 2개(codes·spend), 리드 보드·상세의 코드 귀속 계산, 리드 모집 코드 입력 검사, 행사 비용 참조(spendRef) 존재 확인. 판정은 순수 모듈 lib/franchise-recruitment.ts가 하고 이 모듈은 문맥 읽기·쓰기·영수증만 한다.
// lib/franchise-server.ts가 잠금(owner+':franchise')·요청 제한·영수증 재생(입력 해시 포함)·스위치·브랜드·역할을 먼저 보고 작업을 넘긴다. commit·영수증은 port로 받아 이 모듈은 franchise-server를 import하지 않는다(순환 없음).
// 코드·비용 행은 upsert가 아니라 INSERT다(같은 코드 경쟁은 UNIQUE → CODE_TAKEN 409). 사용 중지·무효화는 판 대조 보호(guard)로 쓴다(어긋나면 CODE_STALE·SPEND_STALE 409).
// 귀속은 저장하지 않고 읽을 때 계산한다(점포 쪽 코드 생성과 잠금이 달라 충돌은 읽을 때에만 빠짐없이 드러난다, 명세 2.4). 감사·영수증 행에는 라벨·증빙 문구·금액을 남기지 않는다(명세 4.5).
// 모델 경계(DP-10): 모델 경로가 이 모듈에 닿지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN). 외부 호출·모델 호출이 없다. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {ApiError,database,readRecord,listRecords,recordStatement,uid} from './server';
import {isEnabled} from './feature-flags';
import {loadFranchiseContext} from './franchise-facts-server';
import {toKstDate,isDate} from './franchise-rules';
import {GATE_DISCLAIMER} from './franchise-gates';
import {FRANCHISE_ERRORS,isAdminRole,type FranchiseErrorKey,type AuditAction,type LeadRecord} from './franchise';
import {RECRUITMENT_CHANNELS,RECRUITMENT_CHANNEL_LABELS,RECRUITMENT_MESSAGES,RECRUITMENT_ATTRIBUTION_NOTE,FILE_BASIS_LABEL,RECRUITMENT_VERSION,PLATFORM_REPORTED_NOTE,NO_PRORATION_NOTE,MAX_CODES_PER_LEAD,
 normalizeRecruitmentCode,isRecruitmentCode,generateRecruitmentCode,recruitmentUtmQuery,codeIssueDecision,codeRetireDecision,spendDecision,spendVoidDecision,spendInWindow,alignedWindow,attributeLead,attributionLabel,receivedAtOf,
 type RecruitmentDecision,type CodeIssueValue,type SpendValue,type SpendVoidReason,type RecruitmentCodeLite,type TrackingValue,type CodeBook,type LeadAttribution,type AssetRef,type SpendRow,type UnattributedReason} from './franchise-recruitment';

type Json=Record<string,unknown>;
type ActorLite={id:string;role:string};
export const RECRUITMENT_ACTIONS=['code_issue','code_retire','spend_record','spend_void'] as const;
export type RecruitmentAction=typeof RECRUITMENT_ACTIONS[number];
// 같은 요청 번호로 다른 입력을 보내면 옛 결과를 재생하지 않고 409다(대상이 null인 작업). franchise-server가 영수증에 입력 해시를 넣고 재생 때 대조한다(명세 4.3).
export const INPUT_BOUND:readonly string[]=['code_issue','spend_record'];
// 감사 행에 더하는 필드(값 없음: 기록 id·채널·기간·사유 코드·규칙 버전만). 라벨·증빙 문구·금액은 넣지 않는다.
export type RecruitmentAuditExtra={recordId?:string;channel?:string;periodFrom?:string;periodTo?:string;reasons?:string[];ruleVersion?:string};
export type RecruitmentPort={commit:(stmts:D1PreparedStatement[],stale:FranchiseErrorKey)=>Promise<unknown>;receipt:(action:AuditAction,result:Json,extra:RecruitmentAuditExtra,target:string|null)=>D1PreparedStatement};
export type RecruitmentArgs={owner:string;brandId:string;now:string;enabled:boolean;actor:ActorLite;input:Json;action:RecruitmentAction;port:RecruitmentPort};
type Outcome={result:Json;extra?:Json};
export type CodeRow=CodeIssueValue&{brandId:string;status:'active'|'retired';retiredOn:string|null;retiredAt:string|null;retiredBy:ActorLite|null;version:number;createdAt:string;createdBy:ActorLite;ruleVersion:string};
export type SpendStored=Omit<SpendValue,'duplicates'>&{id:string;brandId:string;currency:'KRW';status:'active'|'voided';voided:{at:string;by:ActorLite;reason:SpendVoidReason|'replaced'}|null;version:number;createdAt:string;createdBy:ActorLite;ruleVersion:string};
export class FranchiseRecruitmentError extends ApiError{constructor(status:number,message:string,readonly extra:Json={}){super(status,message)}}

// ── 공통 보조 ──
const isRecord=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ID_RE=/^[A-Za-z0-9._:-]{1,128}$/;
const idOk=(v:unknown):v is string=>typeof v==='string'&&ID_RE.test(v);
function fail(key:FranchiseErrorKey):never{const e=FRANCHISE_ERRORS[key];throw new FranchiseRecruitmentError(e.status,e.text)}
type Failure=Extract<RecruitmentDecision<unknown>,{ok:false}>;
const reasonMessages=(codes:readonly string[])=>codes.map(code=>({code,message:(RECRUITMENT_MESSAGES as Readonly<Record<string,string>>)[code]??code}));
// 판정 실패를 HTTP로: 첫 사유의 고정 문구와 사유 코드·고정 사유 문구·규칙 버전·면책. 중복·겹침 409는 기존 행의 id·기간·금액만 싣는다.
const decisionError=(d:Failure)=>new FranchiseRecruitmentError(d.status,d.message,{reasons:reasonMessages(d.reasons),...(d.duplicates?{duplicates:d.duplicates}:{}),ruleVersion:d.ruleVersion,disclaimer:d.disclaimer});
const keyOf=(owner:string,kind:'recruitment_code'|'recruitment_spend',id:string)=>`${owner}:${kind}:${id}`;
async function optionalRecord<T>(owner:string,kind:string,id:string):Promise<T|null>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
// 사용자 입력에서 파이프라인 칸(작업·브랜드·요청 번호)을 뺀 나머지만 판정에 넘긴다(판정은 허용 목록 밖 키를 invalid_input으로 거부한다).
function payload(input:Json,drop:readonly string[]=[]):Json{const out:Json={};for(const k of Object.keys(input))if(!['action','brandId','requestId',...drop].includes(k))out[k]=input[k];return out}
// 판 대조 보호: 읽은 뒤 행의 판이 바뀌었으면 같은 id 행을 다시 INSERT해 UNIQUE 실패로 batch 전체를 되돌린다. port.commit이 stale 키 409로 바꾼다.
const guard=(owner:string,key:string,version:number)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT id,owner,kind,parent_id,data,updated_at FROM records WHERE id=? AND owner=? AND json_extract(data,\'$.version\') IS NOT ?').bind(key,owner,version);
const insertCode=(owner:string,row:CodeRow,now:string)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:recruitment_code:${row.code}`,owner,'recruitment_code',row.brandId,JSON.stringify(row),now);
const insertSpend=(owner:string,row:SpendStored,now:string)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:recruitment_spend:${row.id}`,owner,'recruitment_spend',row.brandId,JSON.stringify(row),now);
const chunks=<T>(xs:readonly T[],n=90)=>Array.from({length:Math.ceil(xs.length/n)},(_,i)=>xs.slice(i*n,i*n+n));

// ── 판정 문맥 ──
async function campaignLite(owner:string,raw:unknown){
 if(!idOk(raw))return null;
 const c=await optionalRecord<{id:string;brandId:string;objective?:unknown}>(owner,'campaign',raw);
 return c?{id:c.id,brandId:c.brandId,objective:c.objective}:null;
}
// 자료 판: 같은 판 행과 그 자료의 최신 판 번호(지금 판인지). 없거나 형식이 틀리면 null(판정이 asset_other_brand 400으로 닫는다).
async function assetLite(owner:string,raw:unknown){
 if(!isRecord(raw)||!idOk(raw.id)||typeof raw.version!=='number'||!Number.isSafeInteger(raw.version)||raw.version<1)return null;
 const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='recruitment_asset'").bind(`${owner}:recruitment_asset:${raw.id}:${raw.version}`,owner).first<{data:string}>();
 if(!row)return null;
 const a=JSON.parse(row.data) as {id:string;version:number;brandId:string;status:string;type?:string;review?:{needed?:unknown}};
 const latest=await database().prepare("SELECT MAX(json_extract(data,'$.version')) AS v FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=? AND json_extract(data,'$.id')=?").bind(owner,a.brandId,a.id).first<{v:number}>();
 return {id:a.id,version:a.version,brandId:a.brandId,status:a.status as 'draft'|'approved'|'retired',reviewNeeded:a.review?.needed===true,current:Number(latest?.v)===a.version,type:a.type};
}
async function eventLite(owner:string,raw:unknown){
 if(!idOk(raw))return null;
 const e=await optionalRecord<{id:string;brandId:string;status:string}>(owner,'recruitment_event',raw);
 return e?{id:e.id,brandId:e.brandId,status:e.status}:null;
}
// 발급 충돌 조회: 한 문장으로 점포 추적 코드·모집 코드 두 id를 본다(명세 4.3). 다른 잠금에서 점포 코드가 동시에 생기는 경우는 읽을 때 충돌 표시가 맡는다.
async function takenOf(owner:string,code:string){
 const rows=await database().prepare('SELECT id FROM records WHERE owner=? AND id IN (?,?)').bind(owner,`${owner}:tracking_code:${code}`,`${owner}:recruitment_code:${code}`).all<{id:string}>();
 const ids=new Set(rows.results.map(r=>r.id));
 return {tracking:ids.has(`${owner}:tracking_code:${code}`),recruitment:ids.has(`${owner}:recruitment_code:${code}`)};
}
// 이 비용을 가리키는 취소되지 않은 같은 브랜드 행사 수(비용 무효화·교체를 막는다).
async function referencedBy(owner:string,brandId:string,spendId:string){
 const r=await database().prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='recruitment_event' AND parent_id=? AND json_extract(data,'$.spendRef')=? AND json_extract(data,'$.status')<>'cancelled'").bind(owner,brandId,spendId).first<{n:number}>();
 return Number(r?.n??0);
}
async function loadCode(owner:string,brandId:string,raw:unknown):Promise<CodeRow>{
 const code=normalizeRecruitmentCode(raw);
 const row=isRecruitmentCode(code)?await optionalRecord<CodeRow>(owner,'recruitment_code',code):null;
 if(!row||row.brandId!==brandId||row.code!==code)fail('CODE_NOT_FOUND');
 return row;
}
async function loadSpend(owner:string,brandId:string,raw:unknown):Promise<SpendStored>{
 const row=idOk(raw)?await optionalRecord<SpendStored>(owner,'recruitment_spend',raw):null;
 if(!row||row.brandId!==brandId||row.id!==raw)fail('SPEND_NOT_FOUND');
 return row;
}
// 행사 비용 참조(event_save): 같은 브랜드의 무효화되지 않은 모집 비용 기록이어야 한다(lib/franchise-assets-server.ts가 부른다).
export async function spendUsable(owner:string,brandId:string,spendId:unknown){
 if(!idOk(spendId))return false;
 const row=await optionalRecord<SpendStored>(owner,'recruitment_spend',spendId);
 return !!row&&row.brandId===brandId&&row.id===spendId&&row.status==='active';
}

// ── 작업 ──
export function runRecruitmentAction(x:RecruitmentArgs):Promise<Outcome>{
 switch(x.action){
  case 'code_issue':return codeIssue(x);
  case 'code_retire':return codeRetire(x);
  case 'spend_record':return spendRecord(x);
  case 'spend_void':return spendVoid(x);
  default:return fail('UNKNOWN_ACTION');
 }
}
// 재생 대상(lib/franchise-server.ts targetOf): 발급·비용 기록은 null(+입력 해시), 사용 중지는 정규화한 코드, 무효화는 비용 id.
export function recruitmentTargetOf(action:string,input:Json):string|null|undefined{
 if(action==='code_issue'||action==='spend_record')return null;
 if(action==='code_retire')return normalizeRecruitmentCode(input.code);
 if(action==='spend_void')return String(input.spendId??'');
 return undefined;
}
// 발급(대표·관리자, 분기 A): 문맥(분기·캠페인·자료 판·행사) → 직접 코드면 두 kind 조회, 아니면 후보 생성(5회) → 판정 → INSERT(UNIQUE → CODE_TAKEN).
async function codeIssue(x:RecruitmentArgs):Promise<Outcome>{
 const input=payload(x.input);
 const [fr,campaign,asset,event]=await Promise.all([loadFranchiseContext(x.owner,x.brandId),campaignLite(x.owner,input.campaignId),assetLite(x.owner,input.assetRef),eventLite(x.owner,input.eventId)]);
 const custom=input.customCode,given=custom!==undefined&&custom!==null&&custom!=='';
 let candidate:string|null=null,taken={tracking:false,recruitment:false};
 if(given){const code=normalizeRecruitmentCode(custom);if(isRecruitmentCode(code))taken=await takenOf(x.owner,code)}
 else{
  for(let i=0;i<5&&candidate===null;i++){const code=generateRecruitmentCode(crypto.getRandomValues(new Uint8Array(32)));if(code&&!Object.values(await takenOf(x.owner,code)).some(Boolean))candidate=code}
  if(candidate===null)fail('CODE_RETRY');
 }
 const d=codeIssueDecision(input,{enabled:x.enabled,brandId:x.brandId,branch:fr.profile?.branch??null,actor:x.actor,today:toKstDate(x.now),campaign,asset,event,taken,candidate});
 if(!d.ok)throw decisionError(d);
 const row:CodeRow={...d.value,brandId:x.brandId,status:'active',retiredOn:null,retiredAt:null,retiredBy:null,version:1,createdAt:x.now,createdBy:{id:x.actor.id,role:x.actor.role},ruleVersion:d.ruleVersion};
 const result={code:row.code,channel:row.channel,validFrom:row.validFrom,version:row.version};
 await x.port.commit([insertCode(x.owner,row,x.now),x.port.receipt('code_issue',result,{recordId:row.code,channel:row.channel,ruleVersion:d.ruleVersion},null)],'CODE_TAKEN');
 return {result,extra:{code:row,utmQuery:recruitmentUtmQuery(row),warnings:d.warnings,ruleVersion:d.ruleVersion,disclaimer:d.disclaimer}};
}
// 사용 중지(대표·관리자, 스위치가 꺼져도 된다): 판 대조 → 판정(오늘 이후만, 과거로 소급하지 않음) → 판 보호 + 새 행 + 영수증.
async function codeRetire(x:RecruitmentArgs):Promise<Outcome>{
 const row=await loadCode(x.owner,x.brandId,x.input.code);
 if(x.input.version!==row.version)fail('CODE_STALE');
 const d=codeRetireDecision(row,Object.hasOwn(x.input,'retiredOn')?{retiredOn:x.input.retiredOn}:{},{actor:x.actor,today:toKstDate(x.now),enabled:x.enabled});
 if(!d.ok)throw decisionError(d);
 const next:CodeRow={...row,status:'retired',retiredOn:d.value.retiredOn,retiredAt:x.now,retiredBy:{id:x.actor.id,role:x.actor.role},version:row.version+1};
 const result={code:row.code,retiredOn:next.retiredOn,version:next.version};
 await x.port.commit([guard(x.owner,keyOf(x.owner,'recruitment_code',row.code),row.version),recordStatement(x.owner,'recruitment_code',row.code,next,x.brandId),x.port.receipt('code_retire',result,{recordId:row.code},row.code)],'CODE_STALE');
 return {result,extra:{ruleVersion:d.ruleVersion,disclaimer:d.disclaimer}};
}
const summaryOf=(s:SpendStored)=>({id:s.id,channel:s.channel,period:s.period,amountExVat:s.amountExVat,campaignId:s.campaignId,assetRef:s.assetRef});
// 비용 기록(대표·관리자, 분기와 무관): 문맥(캠페인·자료 판·같은 브랜드 유효 행·교체 대상과 참조 수) → 판정 → INSERT(+ 교체면 옛 행 판 보호 + 무효화) + 영수증.
async function spendRecord(x:RecruitmentArgs):Promise<Outcome>{
 const input=payload(x.input);
 const [campaign,asset,rows]=await Promise.all([campaignLite(x.owner,input.campaignId),assetLite(x.owner,input.assetRef),listRecords<SpendStored>(x.owner,'recruitment_spend',x.brandId)]);
 const own=rows.filter(r=>r.brandId===x.brandId);
 const target=idOk(input.replacesSpendId)?own.find(r=>r.id===input.replacesSpendId)??null:null;
 const replaces=target?{id:target.id,brandId:target.brandId,channel:target.channel,voided:target.status!=='active',referencedBy:await referencedBy(x.owner,x.brandId,target.id)}:null;
 const d=spendDecision(input,{enabled:x.enabled,brandId:x.brandId,actor:x.actor,today:toKstDate(x.now),campaign,asset,existing:own.filter(r=>r.status==='active').map(summaryOf),replaces});
 if(!d.ok)throw decisionError(d);
 const {duplicates,...value}=d.value;
 const row:SpendStored={...value,id:'rs-'+uid(),brandId:x.brandId,currency:'KRW',status:'active',voided:null,version:1,createdAt:x.now,createdBy:{id:x.actor.id,role:x.actor.role},ruleVersion:d.ruleVersion};
 const result={spendId:row.id,channel:row.channel,periodFrom:row.period.from,periodTo:row.period.to,version:row.version,...(target?{replacedSpendId:target.id}:{})};
 const stmts=[insertSpend(x.owner,row,x.now)];
 if(target)stmts.push(guard(x.owner,keyOf(x.owner,'recruitment_spend',target.id),target.version),recordStatement(x.owner,'recruitment_spend',target.id,{...target,status:'voided',voided:{at:x.now,by:{id:x.actor.id,role:x.actor.role},reason:'replaced'},version:target.version+1},x.brandId));
 stmts.push(x.port.receipt('spend_record',result,{recordId:row.id,channel:row.channel,periodFrom:row.period.from,periodTo:row.period.to,ruleVersion:d.ruleVersion},null));
 await x.port.commit(stmts,'SPEND_STALE');
 return {result,extra:{spend:row,...(duplicates.length?{duplicates}:{}),warnings:d.warnings,ruleVersion:d.ruleVersion,disclaimer:d.disclaimer}};
}
// 무효화(대표·관리자, 스위치가 꺼져도 된다): 판 대조 → 참조 수 → 판정 → 판 보호 + 새 행 + 영수증(사유 코드만).
async function spendVoid(x:RecruitmentArgs):Promise<Outcome>{
 const row=await loadSpend(x.owner,x.brandId,x.input.spendId);
 if(x.input.version!==row.version)fail('SPEND_STALE');
 const d=spendVoidDecision({id:row.id,voided:row.voided},{reason:x.input.reason},{actor:x.actor,referencedBy:await referencedBy(x.owner,x.brandId,row.id),enabled:x.enabled});
 if(!d.ok)throw decisionError(d);
 const next:SpendStored={...row,status:'voided',voided:{at:x.now,by:{id:x.actor.id,role:x.actor.role},reason:d.value.reason},version:row.version+1};
 const result={spendId:row.id,status:'voided',version:next.version};
 await x.port.commit([guard(x.owner,keyOf(x.owner,'recruitment_spend',row.id),row.version),recordStatement(x.owner,'recruitment_spend',row.id,next,x.brandId),x.port.receipt('spend_void',result,{recordId:row.id,reasons:[d.value.reason]},row.id)],'SPEND_STALE');
 return {result,extra:{ruleVersion:d.ruleVersion,disclaimer:d.disclaimer}};
}

// ── 리드 모집 코드 ──
// 추가만 한다: 1~5개, 정규화 뒤 R 형식, 이미 있는 코드는 건너뛰고 합계 5개 이하. 아니면 LEAD_CODE_INVALID 400. 돌려준 목록이 비면 호출자가 '바뀐 내용이 없습니다'를 낸다.
export function readLeadCodes(raw:unknown,current:readonly {code:string}[]):string[]{
 if(!Array.isArray(raw)||raw.length<1||raw.length>MAX_CODES_PER_LEAD)fail('LEAD_CODE_INVALID');
 const have=new Set(current.map(c=>c.code)),out:string[]=[];
 for(const v of raw){const code=normalizeRecruitmentCode(v);if(!isRecruitmentCode(code))fail('LEAD_CODE_INVALID');if(!have.has(code)&&!out.includes(code))out.push(code)}
 if(current.length+out.length>MAX_CODES_PER_LEAD)fail('LEAD_CODE_INVALID');
 return out;
}
// 등록되지 않은(또는 다른 브랜드) 코드 수. 저장은 하고 응답 경고로만 알린다(인쇄물에 먼저 쓴 코드를 나중에 등록하는 경로).
export async function unregisteredCount(owner:string,brandId:string,codes:readonly string[]){
 if(!codes.length)return 0;
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='recruitment_code' AND id IN (${codes.map(()=>'?').join(',')})`).bind(owner,...codes.map(c=>`${owner}:recruitment_code:${c}`)).all<{data:string}>();
 const mine=new Set(rows.results.map(r=>JSON.parse(r.data) as CodeRow).filter(c=>c.brandId===brandId).map(c=>c.code));
 return codes.filter(c=>!mine.has(c)).length;
}

// ── 귀속(읽을 때 계산) ──
const liteOf=(c:CodeRow):RecruitmentCodeLite=>({code:c.code,brandId:c.brandId,channel:c.channel,validFrom:c.validFrom,createdAt:c.createdAt,retiredOn:c.retiredOn??null,retiredAt:c.retiredAt??null,campaignId:c.campaignId??null,assetRef:c.assetRef??null,eventId:c.eventId??null});
// 가져온 리드(R5b-2)는 리드를 만든 가져오기의 채널·행사로 제공처 파일 기준 귀속을 받는다(명세 2.7.3). 병합으로 덧붙은 제공처 기록은 귀속을 바꾸지 않는다.
const importOf=(l:LeadRecord)=>{const i=l.importId?(l.imports??[]).find(x=>x.importId===l.importId&&!x.merged):undefined;return i?{importId:i.importId,channel:i.channel,eventId:i.eventId??null}:null};
const leadCodesOf=(l:LeadRecord)=>({brandId:l.brandId,receivedAt:receivedAtOf(l),codes:(l.codes??[]).map(c=>({code:c.code,at:c.at,source:c.source})),strikes:(l.codeStrikes??[]).map(s=>({code:s.code,at:s.at})),import:importOf(l)});
// 코드 장부: 값 목록의 모집 코드(모든 브랜드, 다른 브랜드 사유용)와 점포 추적 코드 값·생성 시각만 id로 90개씩 읽는다. 점포 코드 전체를 읽지 않는다.
export async function codeBook(owner:string,values:readonly string[]):Promise<CodeBook>{
 const ids=[...new Set(values)].flatMap(v=>[`${owner}:recruitment_code:${v}`,`${owner}:tracking_code:${v}`]);
 const codes:RecruitmentCodeLite[]=[],tracking:TrackingValue[]=[];
 for(const part of chunks(ids)){
  const rows=await database().prepare(`SELECT kind,data FROM records WHERE owner=? AND kind IN ('recruitment_code','tracking_code') AND id IN (${part.map(()=>'?').join(',')})`).bind(owner,...part).all<{kind:string;data:string}>();
  for(const r of rows.results){const d=JSON.parse(r.data) as Json;if(r.kind==='recruitment_code')codes.push(liteOf(d as unknown as CodeRow));else if(typeof d.code==='string')tracking.push({value:d.code,createdAt:String(d.createdAt??'')})}
 }
 return {codes,tracking};
}
export function attributionView(a:LeadAttribution):Json{
 const {label,detail}=attributionLabel(a);
 if(a.state==='attributed'&&a.basis==='import')return {state:a.state,basis:a.basis,label,detail,channel:a.channel,channelLabel:RECRUITMENT_CHANNEL_LABELS[a.channel],importId:a.importId,eventId:a.eventId};
 if(a.state==='attributed')return {state:a.state,basis:a.basis,label,detail,code:a.code,channel:a.channel,channelLabel:RECRUITMENT_CHANNEL_LABELS[a.channel],campaignId:a.campaignId,assetRef:a.assetRef,eventId:a.eventId,retroactive:a.retroactive,late:a.late,alsoMatched:a.alsoMatched};
 if(a.state==='conflict')return {state:a.state,label,detail,code:a.code};
 return {state:a.state,label,detail,reason:a.reason};
}
// 리드별 귀속(보드·상세·코드 보기가 같은 계산을 쓴다).
export async function attributionsOf(owner:string,leads:readonly LeadRecord[]):Promise<Map<string,LeadAttribution>>{
 const book=await codeBook(owner,leads.flatMap(l=>(l.codes??[]).map(c=>c.code)));
 return new Map(leads.map(l=>[l.id,attributeLead(leadCodesOf(l),book)]));
}
// 보드 필터 inflow: 모집 채널 키(코드 귀속만) · import(제공처 파일 기준, R5b-2) · unattributed · conflict.
export const INFLOW_FILTERS:readonly string[]=[...RECRUITMENT_CHANNELS.map(c=>c.key),'import','unattributed','conflict'];
export function inflowMatch(a:LeadAttribution|undefined,filter:string){
 if(!a)return false;
 if(filter==='unattributed')return a.state==='unattributed';
 if(filter==='conflict')return a.state==='conflict';
 if(filter==='import')return a.state==='attributed'&&a.basis==='import';
 return a.state==='attributed'&&a.basis==='code'&&a.channel===filter;
}

// ── GET 보기 ──
type Viewer={owner:string;id:string;role:string};
export async function recruitmentView(who:Viewer,brandId:string,view:'codes'|'spend',params:URLSearchParams):Promise<Json>{return view==='codes'?codesView(who,brandId):spendView(who,brandId,params)}
type Tally={attributed:number;retroactive:number;late:number};
const tally=():Tally=>({attributed:0,retroactive:0,late:0});
// 코드 보기(모든 역할): 귀속≠증분 문구를 맨 앞에 두고, 코드 목록(연결·상태·점포 코드 충돌)·코드별·채널별 귀속 건수(소급·늦은 입력 따로)·사유별 '유입 미확인' 건수를 준다. 리드 값은 싣지 않는다.
async function codesView(who:Viewer,brandId:string):Promise<Json>{
 const owner=who.owner;
 const [codeRows,leadRows,campaigns,assets,enabled]=await Promise.all([listRecords<CodeRow>(owner,'recruitment_code',brandId),listRecords<LeadRecord>(owner,'franchise_lead',brandId),listRecords<{id:string;title?:string}>(owner,'campaign'),
  database().prepare("SELECT json_extract(data,'$.id') AS id,json_extract(data,'$.version') AS version,json_extract(data,'$.status') AS status,json_extract(data,'$.review.needed') AS needed FROM records WHERE owner=? AND kind='recruitment_asset' AND parent_id=?").bind(owner,brandId).all<{id:string;version:number;status:string;needed:number|null}>(),
  isEnabled(owner,'r_franchise')]);
 const codes=codeRows.filter(c=>c.brandId===brandId),leads=leadRows.filter(l=>l.brandId===brandId);
 const book=await codeBook(owner,[...codes.map(c=>c.code),...leads.flatMap(l=>(l.codes??[]).map(c=>c.code))]);
 const clash=new Set(book.tracking.map(t=>normalizeRecruitmentCode(t.value)));
 const byCode=new Map<string,Tally>(),byChannel:Record<string,Tally>=Object.fromEntries(RECRUITMENT_CHANNELS.map(c=>[c.key,tally()]));
 const unattributed:Record<UnattributedReason|'conflict',number>={no_code:0,unknown_code:0,other_brand:0,before_valid_from:0,after_retired:0,conflict:0};
 // 제공처 파일 기준(R5b-2, 명세 2.7.3): 코드 귀속과 다른 열로 채널별 건수만 센다.
 const fileBasis:Record<string,number>=Object.fromEntries(RECRUITMENT_CHANNELS.map(c=>[c.key,0]));
 for(const l of leads){
  const a=attributeLead(leadCodesOf(l),book);
  if(a.state==='conflict'){unattributed.conflict++;continue}
  if(a.state==='unattributed'){unattributed[a.reason]++;continue}
  if(a.basis==='import'){fileBasis[a.channel]++;continue}
  for(const t of [byCode.get(a.code)??(byCode.set(a.code,tally()),byCode.get(a.code)!),byChannel[a.channel]]){t.attributed++;if(a.retroactive)t.retroactive++;if(a.late)t.late++}
 }
 const titles=new Map(campaigns.map(c=>[c.id,c.title??null])),latest=new Map<string,number>();
 for(const a of assets.results)latest.set(a.id,Math.max(latest.get(a.id)??0,Number(a.version)));
 const assetState=(ref:AssetRef|null)=>{if(!ref)return null;const a=assets.results.find(x=>x.id===ref.id&&Number(x.version)===ref.version);return a?{status:a.status,reviewNeeded:a.needed===1,current:latest.get(a.id)===ref.version}:null};
 const list=[...codes].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||(a.code<b.code?-1:1)).map(c=>({code:c.code,channel:c.channel,channelLabel:RECRUITMENT_CHANNEL_LABELS[c.channel]??c.channel,label:c.label,validFrom:c.validFrom,status:c.status,retiredOn:c.retiredOn??null,
  campaignId:c.campaignId??null,campaignTitle:c.campaignId?titles.get(c.campaignId)??null:null,campaignMissing:!!c.campaignId&&!titles.has(c.campaignId),assetRef:c.assetRef??null,assetState:assetState(c.assetRef??null),eventId:c.eventId??null,utmCampaign:c.utmCampaign??null,utmQuery:recruitmentUtmQuery({code:c.code,utmCampaign:c.utmCampaign??null}),
  createdAt:c.createdAt,createdBy:c.createdBy?{id:c.createdBy.id,role:c.createdBy.role}:null,version:c.version,conflict:clash.has(c.code),attributed:{total:byCode.get(c.code)?.attributed??0,retroactive:byCode.get(c.code)?.retroactive??0,late:byCode.get(c.code)?.late??0}}));
 return {attributionNote:RECRUITMENT_ATTRIBUTION_NOTE,codes:list,byChannel,fileBasis,fileBasisLabel:FILE_BASIS_LABEL,unattributed,leadCount:leads.length,channels:RECRUITMENT_CHANNELS.map(c=>({key:c.key,label:c.label})),enabled,role:who.role,ruleVersion:RECRUITMENT_VERSION,disclaimer:GATE_DISCLAIMER};
}
// 비용 보기(대표·관리자): 비용 목록(무효화·교체 표시)과 선택 창의 채널별 합계·걸친 행 수·정렬 창. 일할하지 않는다.
async function spendView(who:Viewer,brandId:string,params:URLSearchParams):Promise<Json>{
 if(!isAdminRole(who.role))fail('ADMIN_ONLY');
 const from=params.get('from')||'',to=params.get('to')||'';
 if((from||to)&&(!isDate(from)||!isDate(to)||from>to))throw new ApiError(400,'기간을 확인해 주세요.');
 const rows=(await listRecords<SpendStored>(who.owner,'recruitment_spend',brandId)).filter(r=>r.brandId===brandId);
 const lite:SpendRow[]=rows.map(r=>({id:r.id,version:r.version,channel:r.channel,period:r.period,amountExVat:r.amountExVat,createdAt:r.createdAt,voided:r.voided?{at:r.voided.at,reason:r.voided.reason}:null}));
 let window:Json|null=null;
 if(from){
  const w=spendInWindow(lite,from,to),channels=Object.keys(w.byChannel);
  window={from,to,byChannel:{...w.byChannel},included:w.included.map(r=>r.id),straddling:w.straddling.map(r=>r.id),aligned:Object.fromEntries(channels.map(ch=>[ch,alignedWindow(lite,ch,from,to)])),inputs:w.inputs};
 }
 const spend=[...rows].sort((a,b)=>(a.period.from<b.period.from?1:a.period.from>b.period.from?-1:0)||Date.parse(b.createdAt)-Date.parse(a.createdAt));
 return {spend,window,noProrationNote:NO_PRORATION_NOTE,platformNote:PLATFORM_REPORTED_NOTE,channels:RECRUITMENT_CHANNELS.map(c=>({key:c.key,label:c.label})),ruleVersion:RECRUITMENT_VERSION,disclaimer:GATE_DISCLAIMER};
}
