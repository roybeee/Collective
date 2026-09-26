// 트랙 R 가맹 모집 서버(R1a 가맹 설정 + R4b 리드 원장·법정 절차 게이트). /api/franchise(app/api/franchise/route.ts)가 이 모듈만 부른다.
// 대표 결정 22(2026-09-25): 리드에 이름·연락처를 저장한다. 값은 'v1.' 암호문으로만 저장하고(lib/franchise-crypto.ts) 목록은 읽을 때 가린다. 원문 열람·찾기·내보내기는 매번 감사 기록(값 없음)을 남긴다.
// 결정 20(법률 검토 보류): 게이트·보존 기한·처리 기한은 모두 COLLECTIVE 휴리스틱이고 결과마다 GATE_DISCLAIMER를 붙인다. 법적 적합성을 주장하지 않는다.
// 모델 경계(DP-10): 이 모듈과 lib/franchise*.ts는 HERMES·OpenAI 제출 경로가 import하지 않는다(tests/franchise-model-boundary.test.mjs).
// 쓰기 순서: 행위자 → 출처 검사 → 작업·요청 번호 → 잠금(owner+':franchise') → 요청 제한(분당 60) → 영수증 재생 → 기능 스위치 → 브랜드 → 역할 → 암호화 키 → 리드 → 검증 → 게이트 → 한 번의 batch.
// 오류 문구에 입력 값을 끼워 넣지 않고, 알 수 없는 오류는 메시지 없이 'franchise_request_failed'만 남긴다.
import {ApiError,actor,secureMutation,body,json,database,readRecord,listRecords,recordStatement,stamp,uid,str,runtime,acquireLock,releaseLock,type Actor} from './server';
import {AuthError} from './auth-errors';
import {authMode} from './auth-session';
import {isEnabled} from './feature-flags';
import {executionRate} from './execution-rate';
import {scanText} from './pii-scan';
import {requireContactKey,sealField,openField,leadKeyHmac} from './franchise-crypto';
import {checkTransition,earliestContractAt,assessDelivery,checkAgreement,contractWindowAsOf,forecastDuty,LEAD_STAGES,DELIVERY_DOCS,DELIVERY_METHODS,ALLOWED_METHODS,ELECTRONIC_CHANNELS,ADVISOR_TYPES,ESCROW_INSTITUTIONS,FEE_CATEGORIES,LIMITS,CONTRACT_ITEM_COUNT,GATE_DISCLAIMER,
 type LeadStage,type GateContext,type GateResult,type FranchiseLead,type FranchiseDelivery,type AdviceEvidence,type FeeRecord,type PreContractAgreement,type BackdateApproval,type ContractWindow,type ContractWindowInput,type DisclosureVersion,type ContractTemplate} from './franchise-gates';
import {isInstant,isDate,parseInstant,toKstDate,kstMidnight,addDays} from './franchise-rules';
import {versionStates,type VersionLite} from './franchise-facts';
import {flagPublicationsForFactChange} from './execution-server';
import {ASSET_ACTIONS,EVENT_ACTIONS,FranchiseAssetError,runAssetAction,replayAssetExport,assetView,markAssetsForVersionChange,type AssetAction,type AssetAuditExtra} from './franchise-assets-server';
import type {BrandFact} from './brand-facts';
import {FRANCHISE_ERRORS,FRANCHISE_LABELS,CONTACT_FIELDS,BUDGET_BANDS,TIMING_BANDS,SOURCE_CHANNELS,BASIS_TYPES,REFERRAL_FROM,MARKETING_METHODS,CLOSE_REASONS,REVEAL_PURPOSES,EXPORT_PURPOSES,BACKDATE_REASONS,CORRECTION_REASONS,REGISTRY_AMEND_REASONS,BOARD_TODOS,SUBJECT_REQUEST_TYPES,SUBJECT_REQUEST_STATUS,SUBJECT_RESOLUTIONS,SUBJECT_CHANNELS,BRANCHES,EXPORT_COLUMNS,
 STAGE_LABELS,SOURCE_LABELS,BUDGET_LABELS,TIMING_LABELS,BASIS_LABELS,MARKETING_STATUS_LABELS,CONTACT_NOTE,DUE_LABEL,RETENTION_LABEL,RECHECK_LABEL,MEMO_HINT,ACTIVITY_EVENTS,
 normalizePhone,normalizeEmail,normalizeName,formatPhone,maskName,maskPhone,maskEmail,stageOrder,retentionUntil,isContactExpired,marketingRecheckDue,subjectDueAt,auditCutoff,isAdminRole,isOwnLead,canSeeLead,canEditLead,canReveal,canClose,
 leadActions,allowedMoves,marketingOptions,eligibilityScore,csvFile,leadSystemCode,codeMessages,describeGate,describeWindow,isGeneralStage,isEvidenceStage,isBoardQuery,
 type FranchiseErrorKey,type LeadRecord,type ActorSnapshot,type Who,type Branch,type EligibilityCriteria,type ContactField,type LeadTask,type LeadBasis,type LeadMarketing,type EvidenceType,type CorrectionReason,type LeadEventType,type AuditAction,type ContactState} from './franchise';

type Json=Record<string,unknown>;
// ── 오류 ──
// extra는 게이트 사유·경고·창·면책(FranchiseGateError 역할)이나 중복 리드 코드(DuplicateContactError 역할)다. 값이 든 필드는 싣지 않는다.
export class FranchiseError extends ApiError{constructor(status:number,message:string,readonly extra:Json={}){super(status,message)}}
function fail(key:FranchiseErrorKey,extra?:Json):never{const e=FRANCHISE_ERRORS[key];throw new FranchiseError(e.status,e.text,extra)}
function bad(message:string):never{throw new ApiError(400,message)}
export function franchiseFailure(error:unknown){
 if(error instanceof FranchiseError||error instanceof FranchiseAssetError)return json({error:error.message,...error.extra},error.status);
 if(error instanceof ApiError||error instanceof AuthError)return json({error:error.message},error.status);
 console.error('franchise_request_failed');
 return json({error:'처리하지 못했습니다. 입력한 내용을 유지한 채 다시 시도해 주세요.'},500);
}

// ── 레코드 모양 ──
export type FranchiseProfile={id:string;brandId:string;branch:Branch;forecastInputs:{sme:boolean|null;storesAtFyEnd:number|null;fiscalYearEnd:string|null};holidays:{list:string[];source:string;verifiedAt:string}|null;storageLabels:string[];eligibility:EligibilityCriteria|null;version:number;updatedAt:string;updatedBy:ActorSnapshot};
// 정정·다시 사용 이력: 바꾸기 전 값만 남긴다(추가 전용). 개인정보는 없다(날짜·확인 항목·라벨).
type Amendment={at:string;by:ActorSnapshot;reasonCode:string;before:Json};
type Registered={id:string;brandId:string;status:'active'|'retired';createdAt:string;createdBy:ActorSnapshot;retiredAt?:string;amendments?:Amendment[]};
type VersionRow=Registered&{label:string;sha256:string;registeredAt:string|null;validFrom:string;validUntil:string;storageLabel:string;version:number};
type TemplateRow=Registered&{label:string;sha256:string;checkedItems:number[];storageLabel:string;version:number};
type NoticeRow=Registered&{versionLabel:string;text:string;sha256:string;controllerName:string;processorNames:string[]};
type EvidenceRow={id:string;leadId:string;brandId:string;evidenceType:EvidenceType;recordedAt:string;recordedBy:ActorSnapshot;backdateApproval:BackdateApproval|null;supersedes:string|null;correctionReason:CorrectionReason|null;docSha256:string|null;storageLabel:string|null;payload:Json|null;voided?:true};
type Receipt={requestAction?:string;status?:number;result?:Json;target?:string|null};
type EventRow={id:string;leadId:string;brandId:string;type:LeadEventType;at:string;actor:ActorSnapshot;from?:LeadStage;to?:LeadStage;reasonCodes?:string[];fields?:ContactField[];taskFields?:string[];basis?:Json;consent?:Json;withdrawnAt?:string;evidenceId?:string;evidenceType?:EvidenceType;supersedes?:string|null;voided?:true;closeReason?:string|null;assigneeId?:string|null}&Receipt;
type AuditRow={id:string;brandId:string;action:AuditAction;actor:ActorSnapshot;at:string;leadId?:string;recordId?:string;fields?:ContactField[];purpose?:string;contactMode?:'masked'|'full';count?:number;matchedLeadIds?:string[];counts?:{leads:number;keys:number;audits:number;remaining:number};byBrand?:Record<string,number>;trigger?:'board_open'|'manual'|'inline';reasonCode?:string;changedFields?:string[];assigneeId?:string|null;alreadyErased?:boolean;
 // 재생 묶음: 열람은 그때 리드 버전, 내보내기는 내보낸 리드 id·버전·연락처 유무의 SHA-256. 재생은 이 값이 같을 때만 값을 다시 만든다.
 leadVersion?:number;leadSetSha256?:string;requestIds?:string[]}&AssetAuditExtra&Receipt;
type SubjectRequestRow={id:string;brandId:string;leadId:string|null;type:string;channel:string;receivedAt:string;dueAt:string;status:string;resolution:string|null;resolvedAt:string|null;version:number;createdAt:string;createdBy:ActorSnapshot};
type KeyRow={id:string;leadId:string;brandId:string;type:'phone'|'email';createdAt:string};

// ── 공통 보조 ──
const isRecord=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const oneOf=<T extends string>(list:readonly T[],v:unknown):v is T=>typeof v==='string'&&(list as readonly string[]).includes(v);
function pick<T extends string>(list:readonly T[],v:unknown,message:string):T{if(!oneOf(list,v))bad(message);return v}
const clean=(text:string)=>{if(scanText(text).length)fail('PII_IN_TEXT');return text};
const ms=(t:string)=>parseInstant(t);
const snap=(who:Actor):ActorSnapshot=>({id:who.id,role:who.role});
const SYSTEM:ActorSnapshot={id:'system',role:'system'};
const hexOf=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const sha256Hex=async(s:string)=>hexOf(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
const byId=<T extends {id:string}>(a:T,b:T)=>a.id<b.id?-1:a.id>b.id?1:0;
const keyPresent=()=>!!runtime.AGENCY_ENCRYPTION_KEY;
// 'now'는 서버 시각(기록 시각)으로 바꾼다. 그 밖은 시간대가 있는 ISO 8601만 받는다.
function timeOf(v:unknown,now:string,message='시각 형식을 확인해 주세요.'):string{if(v==='now')return now;if(!isInstant(v))bad(message);return v}
function pastTime(v:unknown,now:string,message?:string){const t=timeOf(v,now,message);if(ms(t)>ms(now))fail('FUTURE_TIME');return t}
function shaOf(v:unknown,required:boolean):string|null{
 if(v===undefined||v===null||v===''){if(required)bad('문서 해시를 입력해 주세요.');return null}
 if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))bad('문서 해시를 확인해 주세요.');
 return v;
}
async function optionalRecord<T>(owner:string,kind:string,id:string):Promise<T|null>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const insertRow=(owner:string,kind:string,id:string,data:unknown,parent:string,now:string)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),now);
const eventStmt=(owner:string,e:EventRow)=>insertRow(owner,'franchise_lead_event',e.id,e,e.leadId,e.at);
const auditStmt=(owner:string,a:AuditRow)=>insertRow(owner,'franchise_audit',a.id,a,a.brandId,a.at);
const leadStmt=(owner:string,lead:LeadRecord)=>recordStatement(owner,'franchise_lead',lead.id,lead,lead.brandId);
const deleteKeys=(owner:string,leadId:string)=>database().prepare("DELETE FROM records WHERE owner=? AND kind='franchise_lead_key' AND parent_id=?").bind(owner,leadId);
// 영수증 행은 upsert가 아닌 INSERT다. 잠금(120초)이 요청 도중 풀려 같은 요청이 겹치면 UNIQUE 실패로 409가 된다(500이 아니다).
// stale: UNIQUE 실패를 바꿀 409 키(모집 자료·행사는 ASSET_STALE·EVENT_STALE, 조건부 쓰기 보호 rowGuard가 같은 UNIQUE로 되돌린다).
async function commit(stmts:D1PreparedStatement[],stale:FranchiseErrorKey='STALE'){
 try{return await database().batch(stmts)}
 catch(e){const message=typeof (e as {message?:unknown})?.message==='string'?(e as {message:string}).message:'';if(/UNIQUE/i.test(message))fail(stale);throw e}
}
const changesOf=(r:D1Result|undefined)=>Number(r?.meta?.changes??0);

// ── 작업 목록 ──
const SETTINGS_ACTIONS=['save_profile','register_disclosure_version','retire_disclosure_version','amend_disclosure_version','register_contract_template','retire_contract_template','amend_contract_template','register_privacy_notice','retire_privacy_notice'] as const;
const EVIDENCE_ACTIONS=['record_delivery','record_advice','record_forecast','record_contract','record_fee','record_agreement','void_evidence'] as const;
const LEAD_MUTATIONS=['update_contact','update_task','move_stage','reopen_lead','claim_lead','assign_lead','record_source_notice','set_marketing_consent'] as const;
const OTHER_ACTIONS=['create_lead','reveal_contact','find_contact','export_leads','purge','erase_lead','add_subject_request','update_subject_request'] as const;
// 트랙 R R15a-2a 모집 자료·행사 작업 9개(lib/franchise-assets-server.ts).
export const FRANCHISE_ACTIONS=[...SETTINGS_ACTIONS,...EVIDENCE_ACTIONS,...LEAD_MUTATIONS,...OTHER_ACTIONS,...ASSET_ACTIONS,...EVENT_ACTIONS] as const;
type Action=typeof FRANCHISE_ACTIONS[number];
const has=(list:readonly string[],action:string)=>list.includes(action);
// leadId로 기존 리드를 읽는 작업.
const ON_LEAD:readonly string[]=[...EVIDENCE_ACTIONS,...LEAD_MUTATIONS,'reveal_contact','erase_lead'];
// 모집 자료 승인·내보내기·게시 위치·폐기와 행사 등록·변경·취소는 대표·관리자만(직원 403). 초안 저장·신청·참석은 모든 역할.
const ADMIN_ACTIONS:readonly string[]=[...SETTINGS_ACTIONS,...EVIDENCE_ACTIONS,'export_leads','purge','erase_lead','update_subject_request','assign_lead','reopen_lead','asset_approve','asset_export','asset_place','asset_retire','event_save','event_cancel'];
// 연락처 키가 없어도 되는 작업(설정, 파기·삭제, 정보주체 요청, 광고성 정보 철회, 모집 자료·행사 9개). 그 밖은 리드 조회 전에 503이다.
const KEY_EXEMPT:readonly string[]=[...SETTINGS_ACTIONS,'purge','erase_lead','add_subject_request','update_subject_request',...ASSET_ACTIONS,...EVENT_ACTIONS];
// 스위치가 꺼져도 되는 작업. 광고성 정보 철회도 된다. 대표·관리자는 정보주체 요청 처리(정정·출처 고지·종결)도 한다. 모집 자료 폐기·행사 취소는 보호 방향이라 된다.
const OFF_EXEMPT:readonly string[]=['reveal_contact','find_contact','export_leads','purge','erase_lead','add_subject_request','update_subject_request','asset_retire','event_cancel'];
const NO_VERSION:readonly string[]=['reveal_contact','erase_lead'];

type Ctx={who:Actor;owner:string;action:Action;input:Json;rid:string;now:string;brandId:string;enabled:boolean;by:ActorSnapshot};
type Outcome={result:Json;lead?:LeadRecord|null;extra?:Json;leadView?:false};
const receipt=(c:Ctx,result:Json,target?:string|null):Receipt=>({requestAction:c.action,status:200,result,...(target!==undefined?{target}:{})});
const receiptEvent=(c:Ctx,lead:{id:string;brandId:string},type:LeadEventType,result:Json,extra:Partial<EventRow>={}):EventRow=>({id:'ev-'+c.rid,leadId:lead.id,brandId:lead.brandId,type,at:c.now,actor:c.by,...extra,...receipt(c,result,lead.id)});
const plainEvent=(c:Ctx,lead:{id:string;brandId:string},type:LeadEventType,extra:Partial<EventRow>={}):EventRow=>({id:'ev-'+uid(),leadId:lead.id,brandId:lead.brandId,type,at:c.now,actor:c.by,...extra});
const receiptAudit=(c:Ctx,action:AuditAction,result:Json,extra:Partial<AuditRow>={},target?:string|null):AuditRow=>({id:'au-'+c.rid,brandId:c.brandId,action,actor:c.by,at:c.now,...extra,...receipt(c,result,target)});
const plainAudit=(c:Ctx,action:AuditAction,extra:Partial<AuditRow>={}):AuditRow=>({id:'au-'+uid(),brandId:c.brandId,action,actor:c.by,at:c.now,...extra});
// 리드를 바꾸는 작업은 버전을 올린다. 가맹희망자 활동(ACTIVITY_EVENTS)만 마지막 활동 시각을 바꾼다.
const bump=(c:Ctx,lead:LeadRecord,patch:Partial<LeadRecord>,activity:LeadEventType|null):LeadRecord=>({...lead,...patch,version:lead.version+1,updatedAt:c.now,...(activity&&ACTIVITY_EVENTS.includes(activity)?{lastActivityAt:c.now}:{})});
// 요청 번호가 이미 쓰인 대상과 같아야 재생한다. undefined는 대상 비교가 없는 작업이다(등록·저장·파기·내보내기).
function targetOf(action:string,input:Json):string|null|undefined{
 if(has(ON_LEAD,action))return String(input.leadId??'');
 if(action==='retire_disclosure_version'||action==='retire_contract_template'||action==='retire_privacy_notice'||action==='amend_disclosure_version'||action==='amend_contract_template'||action==='update_subject_request')return String(input.id??'').trim();
 if(action==='add_subject_request')return typeof input.leadId==='string'&&input.leadId.trim()?input.leadId:null;
 // 모집 자료·행사: 새 자료·새 행사 저장은 null, 그 밖은 자료·행사 id.
 if(action==='asset_save')return typeof input.assetId==='string'&&input.assetId?input.assetId:null;
 if(has(ASSET_ACTIONS,action))return String(input.assetId??'');
 if(action==='event_save')return typeof input.eventId==='string'&&input.eventId?input.eventId:null;
 if(has(EVENT_ACTIONS,action))return String(input.eventId??'');
 return undefined;
}

// ── 설정 읽기 ──
const profileOf=(owner:string,brandId:string)=>optionalRecord<FranchiseProfile>(owner,'franchise_profile',brandId);
const versionsOf=async(owner:string,brandId:string)=>(await listRecords<VersionRow>(owner,'franchise_disclosure_version',brandId)).filter(v=>v.brandId===brandId);
const templatesOf=async(owner:string,brandId:string)=>(await listRecords<TemplateRow>(owner,'franchise_contract_template',brandId)).filter(t=>t.brandId===brandId);
const noticesOf=async(owner:string,brandId:string)=>(await listRecords<NoticeRow>(owner,'franchise_privacy_notice',brandId)).filter(n=>n.brandId===brandId);
async function activeNotice(owner:string,brandId:string,id:unknown){
 if(typeof id!=='string'||!id)fail('NOTICE_REQUIRED');
 const n=(await noticesOf(owner,brandId)).find(x=>x.id===id);
 if(!n||n.status!=='active')fail('NOTICE_REQUIRED');
 return n;
}
// 판정 맥락(D1): 버전·템플릿은 사용 중지돼도 과거 제공 판정에 남긴다. 산정서 입력을 모르면 null(게이트는 필요로 본다, O15).
async function gateContext(owner:string,brandId:string){
 const [versions,templates,profile]=await Promise.all([versionsOf(owner,brandId),templatesOf(owner,brandId),profileOf(owner,brandId)]);
 const ctx:GateContext={
  disclosureVersions:versions.map((v):DisclosureVersion=>({id:v.id,registeredAt:v.registeredAt,validFrom:v.validFrom,validUntil:v.validUntil})).sort(byId),
  contractTemplates:templates.map((t):ContractTemplate=>({id:t.id,checkedItems:t.checkedItems})).sort(byId),
  holidays:profile?.holidays?.list??null,
  forecast:{sme:profile?.forecastInputs?.sme??null,storesAtFyEnd:profile?.forecastInputs?.storesAtFyEnd??null},
 };
 return {ctx,profile,versions,templates};
}
async function evidenceRows(owner:string,lead:LeadRecord){return (await listRecords<EvidenceRow>(owner,'franchise_delivery',lead.id)).filter(r=>r.leadId===lead.id&&r.brandId===lead.brandId)}
// 정정된(다른 행의 supersedes) 행과 무효화 행을 뺀 현재 기록.
function activeEvidence(rows:readonly EvidenceRow[]){const replaced=new Set(rows.map(r=>r.supersedes).filter((x):x is string=>!!x));return rows.filter(r=>!r.voided&&!replaced.has(r.id))}
const payloadOf=(r:EvidenceRow)=>(r.payload??{}) as Json;
function deliveryOf(r:EvidenceRow):FranchiseDelivery{
 const p=payloadOf(r);
 return {id:r.id,doc:p.doc as FranchiseDelivery['doc'],method:String(p.method),deliveredAt:String(p.deliveredAt),recordedAt:r.recordedAt,...(typeof p.versionId==='string'?{versionId:p.versionId}:{}),...(typeof p.templateId==='string'?{templateId:p.templateId}:{}),evidence:(p.evidence??{}) as FranchiseDelivery['evidence'],backdateApproval:r.backdateApproval};
}
function feeOf(r:EvidenceRow):FeeRecord{
 const p=payloadOf(r);
 return {id:r.id,category:p.category as FeeRecord['category'],recordedAt:r.recordedAt,...(p.paidAt!==undefined?{paidAt:p.paidAt as string|null}:{}),...(p.escrow!==undefined?{escrow:p.escrow as FeeRecord['escrow']}:{}),...(p.insurance!==undefined?{insurance:p.insurance as FeeRecord['insurance']}:{}),backdateApproval:r.backdateApproval};
}
function agreementOf(r:EvidenceRow):PreContractAgreement{const p=payloadOf(r);return {id:r.id,signedAt:String(p.signedAt),recordedAt:r.recordedAt,clauses:p.clauses as PreContractAgreement['clauses'],backdateApproval:r.backdateApproval}}
const latest=(rows:readonly EvidenceRow[])=>rows.reduce<EvidenceRow|null>((best,r)=>!best||ms(r.recordedAt)>=ms(best.recordedAt)?r:best,null);
// 저장된 backdateApproval을 그대로 넘긴다. 없으면 기록 시각보다 이른 증빙이 뒤 판정에서 다시 backdate_unapproved가 된다.
// 산정서: 판정하는 계약 서명 시각(signedAt, 없으면 현재 계약 기록의 서명 시각) 이전에 준 산정서 가운데 가장 최근 기록을 쓴다. 그런 것이 없을 때만 가장 최근 기록을 쓴다
// (서명 뒤에 다시 준 산정서가 서명 전에 준 산정서를 가려 계약·개점을 거짓으로 막지 않게).
function leadGateOf(rows:readonly EvidenceRow[],signedAt?:string):FranchiseLead{
 const active=activeEvidence(rows),of=(t:EvidenceType)=>active.filter(r=>r.evidenceType===t);
 const contract=latest(of('contract')),signed=signedAt??(contract?String(payloadOf(contract).signedAt):null),forecasts=of('forecast');
 const before=signed&&isInstant(signed)?forecasts.filter(r=>{const p=payloadOf(r).providedAt;return isInstant(p)&&ms(p)<=ms(signed)}):[];
 const forecast=latest(before.length?before:forecasts);
 return {
  deliveries:of('delivery').map(deliveryOf),
  advice:of('advice').map((r):AdviceEvidence=>{const p=payloadOf(r);return {id:r.id,advisorType:String(p.advisorType),registrationVerified:p.registrationVerified===true,advisedOn:String(p.advisedOn),targetDoc:p.targetDoc as AdviceEvidence['targetDoc'],hqPaid:p.hqPaid as boolean|null,hqReferred:p.hqReferred as boolean|null}}),
  forecastStatement:forecast?{providedAt:String(payloadOf(forecast).providedAt),recordedAt:forecast.recordedAt,written:true,backdateApproval:forecast.backdateApproval}:null,
  contract:contract?{signedAt:String(payloadOf(contract).signedAt),recordedAt:contract.recordedAt,backdateApproval:contract.backdateApproval}:null,
  fees:of('fee').map(feeOf),
  agreements:of('agreement').map(agreementOf),
 };
}
const windowInputOf=(ctx:GateContext,gate:FranchiseLead):ContractWindowInput=>({deliveries:gate.deliveries,advice:gate.advice,disclosureVersions:ctx.disclosureVersions,contractTemplates:ctx.contractTemplates,holidays:ctx.holidays});
const gatePayload=(gate:GateResult,window?:ContractWindow)=>{const w=window??gate.window;return {reasons:codeMessages(gate.reasons),warnings:codeMessages(gate.warnings),...(w?{window:describeWindow(w)}:{}),earliestContractAt:w?.at??null,disclaimer:GATE_DISCLAIMER}};

// ── 가림 보기 ──
type LeadSummary=Json&{id:string;contactState:ContactState};
async function maskedContact(lead:LeadRecord,now:string,full:boolean){
 if(lead.contactState!=='present'||!lead.contact||isContactExpired(lead,now))return null;
 const c=lead.contact,name=maskName(await openField(c.name));
 const phone=c.phone?maskPhone(await openField(c.phone)):null;
 const email=c.email&&(full||!c.phone)?maskEmail(await openField(c.email)):null;
 return {name,phone,email,hasPhone:!!c.phone,hasEmail:!!c.email};
}
const stateOf=(lead:LeadRecord,now:string):ContactState=>isContactExpired(lead,now)?'expired':lead.contactState;
// 보드 행은 이름과 표시할 연락처 하나(전화 우선)만 복호화한다.
async function leadSummary(who:Who,lead:LeadRecord,now:string,criteria:EligibilityCriteria|null,full:boolean):Promise<LeadSummary>{
 const state=stateOf(lead,now);
 return {id:lead.id,systemCode:lead.systemCode,stage:lead.stage,closeReason:lead.closeReason,assigneeId:lead.assigneeId,assignedToMe:lead.assigneeId===who.id,contactState:state,
  contact:await maskedContact(lead,now,full),task:lead.task,basisType:lead.basis.type,sourceNoticePending:state==='present'&&lead.basis.type==='referral'&&!lead.basis.sourceNoticedAt,
  marketingStatus:lead.marketing.status,eligibility:eligibilityScore(lead,criteria),lastActivityAt:lead.lastActivityAt,retentionUntil:retentionUntil(lead),retentionLabel:RETENTION_LABEL,version:lead.version,createdAt:lead.createdAt};
}
function eventView(e:EventRow){
 return {id:e.id,type:e.type,at:e.at,actor:{id:e.actor.id,role:e.actor.role},...(e.from?{from:e.from}:{}),...(e.to?{to:e.to}:{}),...(e.reasonCodes?{reasons:codeMessages(e.reasonCodes)}:{}),...(e.fields?{fields:e.fields}:{}),...(e.taskFields?{taskFields:e.taskFields}:{}),
  ...(e.basis?{basis:e.basis}:{}),...(e.consent?{consent:e.consent}:{}),...(e.withdrawnAt?{withdrawnAt:e.withdrawnAt}:{}),...(e.evidenceId?{evidenceId:e.evidenceId}:{}),...(e.evidenceType?{evidenceType:e.evidenceType}:{}),...(e.supersedes?{supersedes:e.supersedes}:{}),
  ...(e.voided?{voided:true}:{}),...(e.closeReason?{closeReason:e.closeReason}:{}),...(e.assigneeId!==undefined?{assigneeId:e.assigneeId}:{})};
}
async function leadDetail(who:Who,owner:string,lead:LeadRecord,now:string,enabled:boolean){
 const admin=isAdminRole(who.role),{ctx,profile}=await gateContext(owner,lead.brandId);
 const summary=await leadSummary(who,lead,now,profile?.eligibility??null,true);
 const events=(await listRecords<EventRow>(owner,'franchise_lead_event',lead.id)).filter(e=>e.leadId===lead.id).sort((a,b)=>ms(b.at)-ms(a.at)||(a.id<b.id?1:-1)).slice(0,200).map(eventView);
 const actionLead={...lead,contactState:summary.contactState};
 const detail:Json={...summary,hasMemo:summary.contactState==='present'&&lead.memo!==null,basis:lead.basis,marketing:lead.marketing,marketingRecheck:marketingRecheckDue(lead,now),firstContactAt:lead.firstContactAt,contractedAt:lead.contractedAt,closedAt:lead.closedAt,closedFrom:lead.closedFrom,
  events,allowedActions:leadActions(who,actionLead,enabled),allowedMoves:allowedMoves(who,actionLead,enabled),marketingOptions:marketingOptions(who,actionLead,enabled),disclaimer:GATE_DISCLAIMER};
 if(!admin)return detail;
 const rows=await evidenceRows(owner,lead),active=new Set(activeEvidence(rows).map(r=>r.id)),gate=leadGateOf(rows);
 detail.evidence=rows.sort((a,b)=>ms(a.recordedAt)-ms(b.recordedAt)||byId(a,b)).map(r=>({...r,superseded:!r.voided&&!active.has(r.id),...(r.evidenceType==='delivery'&&!r.voided?{assessment:(a=>({accepted:a.accepted,counted:a.counted,reasons:codeMessages(a.reasons)}))(assessDelivery(deliveryOf(r),ctx,now))}:{})}));
 // 개점 판정은 계약·가맹금 예치 단계에서만 보인다(계약 기록이 없으면 판정할 것이 없다).
 const openable=lead.stage==='contracted'||lead.stage==='fee_escrowed';
 detail.gate={window:describeWindow(earliestContractAt(windowInputOf(ctx,gate),now)),forecastDuty:forecastDuty(ctx.forecast),stageChecks:{opened:openable?describeGate(checkTransition(gate,'opened',now,ctx)):null},disclaimer:GATE_DISCLAIMER};
 return detail;
}

// ── 파기(H11) ──
function purgeStatements(owner:string,lead:LeadRecord,now:string,by:ActorSnapshot){
 const next:LeadRecord={...lead,contact:null,memo:null,contactState:'purged',purgedAt:now,version:lead.version+1,updatedAt:now};
 return {next,stmts:[leadStmt(owner,next),deleteKeys(owner,lead.id),eventStmt(owner,{id:'ev-'+uid(),leadId:lead.id,brandId:lead.brandId,type:'purged',at:now,actor:by})]};
}
export type PurgeResult={counts:{leads:number;keys:number;audits:number;remaining:number};byBrand:Record<string,number>};
// 만료된 연락처(보존 기한이 지난 present 리드)를 한 번에 100건까지 20건씩 파기하고, 365일 지난 감사 기록(backdate 제외)을 지운다.
// 감사 행: manual은 언제나(영수증), board_open·inline은 지운 것이 있을 때만. 값은 담지 않는다.
export async function purgeFranchise(owner:string,o:{now:string;trigger:'board_open'|'manual'|'inline';brandId:string;by:ActorSnapshot;receipt?:{id:string}&Receipt;only?:LeadRecord}):Promise<PurgeResult>{
 const eventActor=o.trigger==='manual'?o.by:SYSTEM;
 let expired:LeadRecord[];
 if(o.only)expired=[o.only];
 else{
  const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='franchise_lead' AND json_extract(data,'$.contactState')='present'").bind(owner).all<{data:string}>();
  expired=rows.results.map(r=>JSON.parse(r.data) as LeadRecord).filter(l=>isContactExpired(l,o.now)).sort((a,b)=>Date.parse(retentionUntil(a)??'')-Date.parse(retentionUntil(b)??''));
 }
 const take=expired.slice(0,100),byBrand:Record<string,number>={};
 let leads=0,keys=0;
 for(let i=0;i<take.length;i+=20){
  const chunk=take.slice(i,i+20),results=await database().batch(chunk.flatMap(l=>purgeStatements(owner,l,o.now,eventActor).stmts));
  chunk.forEach((l,j)=>{keys+=changesOf(results[j*3+1]);byBrand[l.brandId]=(byBrand[l.brandId]??0)+1});leads+=chunk.length;
 }
 const audits=o.only?0:changesOf(await database().prepare("DELETE FROM records WHERE owner=? AND kind='franchise_audit' AND json_extract(data,'$.action')<>'backdate' AND json_extract(data,'$.at')<?").bind(owner,auditCutoff(o.now)).run());
 const result:PurgeResult={counts:{leads,keys,audits,remaining:expired.length-take.length},byBrand};
 if(o.receipt||leads||keys||audits)await commit([auditStmt(owner,{id:o.receipt?.id??'au-'+uid(),brandId:o.brandId,action:'purge',actor:o.by,at:o.now,counts:result.counts,byBrand,trigger:o.trigger,...(o.receipt?{requestAction:o.receipt.requestAction,status:200,result:{...result},target:undefined}:{})})]);
 return result;
}
// 요청 도중 만료된 연락처를 만나면 먼저 그 리드만 파기해 커밋한다(새 활동이 만료 연락처를 되살리지 않게).
async function purgeInline(c:Ctx,lead:LeadRecord){await purgeFranchise(c.owner,{now:c.now,trigger:'inline',brandId:lead.brandId,by:c.by,only:lead});return {...purgeStatements(c.owner,lead,c.now,SYSTEM).next}}

// ── 연락처 입력 ──
function readName(v:unknown){const n=normalizeName(v);if(!n)bad('이름 입력을 확인해 주세요.');return clean(n)}
const blank=(v:unknown)=>v===undefined||v===null||(typeof v==='string'&&!v.trim());
function readPhone(v:unknown){if(blank(v))return null;const p=normalizePhone(v);if(!p)bad('전화번호 입력을 확인해 주세요.');return p}
function readEmail(v:unknown){if(blank(v))return null;const e=normalizeEmail(v);if(!e)bad('이메일 입력을 확인해 주세요.');return e}
// 메모: 1000자 이하. 연락처·주소·고유식별번호·계좌·카드 패턴이 있으면 400(연락처는 연락처 칸에 적는다). 민감정보는 패턴으로 잡지 못해 화면이 MEMO_HINT를 보인다.
function readMemo(v:unknown){if(blank(v))return null;return clean(str(v,'메모',1000))}
function readRegion(v:unknown){
 if(blank(v))return '';
 if(typeof v!=='string'||v.length>40)bad('지역 입력을 확인해 주세요.');
 const t=v.normalize('NFKC').trim().replace(/\s+/g,' ');
 if(/\d/.test(t))fail('PII_IN_TEXT');
 if(!/^[가-힣 ]{2,40}$/.test(t))bad('지역 입력을 확인해 주세요.');
 return clean(t);
}
async function readTask(c:Ctx,raw:unknown,current:LeadTask|null):Promise<LeadTask>{
 const t=isRecord(raw)?raw:{},given=(k:string)=>Object.hasOwn(t,k)&&t[k]!==undefined;
 const budgetBand=given('budgetBand')||!current?pick(BUDGET_BANDS,t.budgetBand,'예산 입력을 확인해 주세요.'):current.budgetBand;
 const timingBand=given('timingBand')||!current?pick(TIMING_BANDS,t.timingBand,'시기 입력을 확인해 주세요.'):current.timingBand;
 const sourceChannel=given('sourceChannel')||!current?pick(SOURCE_CHANNELS,t.sourceChannel,'유입 경로를 확인해 주세요.'):current.sourceChannel;
 const region=given('region')?readRegion(t.region):current?.region??'';
 let campaignId=current?.campaignId??null;
 if(given('campaignId')){
  if(blank(t.campaignId))campaignId=null;
  else{
   if(typeof t.campaignId!=='string'||t.campaignId.length>100)bad('캠페인 입력을 확인해 주세요.');
   const campaign=await optionalRecord<{brandId?:string}>(c.owner,'campaign',t.campaignId);
   if(!campaign||campaign.brandId!==c.brandId)bad('캠페인 입력을 확인해 주세요.');
   campaignId=t.campaignId;
  }
 }
 return {region,budgetBand,timingBand,sourceChannel,campaignId};
}
async function readBasis(c:Ctx,raw:unknown):Promise<LeadBasis>{
 const b=isRecord(raw)?raw:{},type=pick(BASIS_TYPES,b.type,'수집 근거를 골라 주세요.');
 if(type==='consent'){
  const notice=await activeNotice(c.owner,c.brandId,b.noticeId);
  if(b.noticeGivenAt!=='now'&&!isInstant(b.noticeGivenAt))fail('NOTICE_REQUIRED');
  return {type,noticeId:notice.id,noticeGivenAt:pastTime(b.noticeGivenAt,c.now)};
 }
 if(type==='referral')return {type,referralFrom:pick(REFERRAL_FROM,b.referralFrom,'소개 유형을 골라 주세요.'),sourceNoticedAt:null};
 return {type};
}
async function readMarketingGiven(c:Ctx,raw:Json):Promise<LeadMarketing>{
 if(raw.status!=='given')bad('광고성 정보 동의 입력을 확인해 주세요.');
 const method=pick(MARKETING_METHODS,raw.method,'동의 방법을 골라 주세요.'),at=pastTime(raw.at,c.now,'동의 시각을 확인해 주세요.'),notice=await activeNotice(c.owner,c.brandId,raw.noticeId);
 return {status:'given',method,at,noticeId:notice.id};
}
// 담당자: 직원은 언제나 자신. 대표·관리자는 자신·null(담당 없음)·같은 워크스페이스의 활성 계정(이메일 로그인 모드). legacy 모드는 자신만.
async function readAssignee(c:Ctx,v:unknown,defaultSelf:boolean):Promise<string|null>{
 if(!isAdminRole(c.who.role))return c.who.id;
 if(v===undefined)return defaultSelf?c.who.id:bad('담당자 입력을 확인해 주세요.');
 if(v===null||v===c.who.id)return v as string|null;
 if(typeof v!=='string'||v.length>200||authMode()!=='email')bad('담당자 입력을 확인해 주세요.');
 const row=await database().prepare("SELECT id FROM auth_users WHERE id=? AND workspace_owner=? AND status='active'").bind(v,c.owner).first();
 if(!row)bad('담당자 입력을 확인해 주세요.');
 return v;
}
// 중복 키(소유자·브랜드 범위 HMAC). 다른 리드의 키가 있으면: 그 연락처가 만료됐으면 먼저 파기하고 비어 있는 키로 보며, 아니면 409와 그 리드 코드만 돌려준다(연락처 값·리드 id 없음).
async function contactKeys(c:Ctx,values:{phone?:string|null;email?:string|null},leadId:string){
 const keys:{id:string;type:'phone'|'email'}[]=[];
 for(const type of ['phone','email'] as const){const v=values[type];if(v)keys.push({id:await leadKeyHmac(c.owner,c.brandId,type,v),type})}
 if(!keys.length)return keys;
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='franchise_lead_key' AND id IN (${keys.map(()=>'?').join(',')})`).bind(c.owner,...keys.map(k=>`${c.owner}:franchise_lead_key:${k.id}`)).all<{data:string}>();
 for(const row of rows.results){
  const k=JSON.parse(row.data) as KeyRow;
  if(k.leadId===leadId)continue;
  const other=await optionalRecord<LeadRecord>(c.owner,'franchise_lead',k.leadId);
  if(!other||other.contactState!=='present'){await database().prepare("DELETE FROM records WHERE owner=? AND kind='franchise_lead_key' AND id=?").bind(c.owner,`${c.owner}:franchise_lead_key:${k.id}`).run();continue}
  if(isContactExpired(other,c.now)){await purgeInline(c,other);continue}
  throw new FranchiseError(FRANCHISE_ERRORS.DUPLICATE.status,FRANCHISE_ERRORS.DUPLICATE.text,{duplicateOf:{systemCode:other.systemCode}});
 }
 return keys;
}
// 키 행은 upsert가 아니라 INSERT OR IGNORE로 넣고 다시 읽는다(기존 키를 덮어쓰지 않는다).
const keyInsert=(c:Ctx,leadId:string,k:{id:string;type:'phone'|'email'})=>database().prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${c.owner}:franchise_lead_key:${k.id}`,c.owner,'franchise_lead_key',leadId,JSON.stringify({id:k.id,leadId,brandId:c.brandId,type:k.type,createdAt:c.now}),c.now);
async function verifyKeys(c:Ctx,keys:readonly {id:string}[],leadId:string,undo:D1PreparedStatement[]){
 if(!keys.length)return;
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='franchise_lead_key' AND id IN (${keys.map(()=>'?').join(',')})`).bind(c.owner,...keys.map(k=>`${c.owner}:franchise_lead_key:${k.id}`)).all<{data:string}>();
 const other=rows.results.map(r=>JSON.parse(r.data) as KeyRow).find(k=>k.leadId!==leadId);
 if(!other)return;
 await database().batch(undo);
 const code=(await optionalRecord<LeadRecord>(c.owner,'franchise_lead',other.leadId))?.systemCode??null;
 throw new FranchiseError(FRANCHISE_ERRORS.DUPLICATE.status,FRANCHISE_ERRORS.DUPLICATE.text,{duplicateOf:{systemCode:code}});
}
async function newSystemCode(owner:string){
 for(let i=0;i<5;i++){
  const code=leadSystemCode(crypto.getRandomValues(new Uint8Array(32)));
  if(code&&!await database().prepare("SELECT 1 FROM records WHERE owner=? AND kind='franchise_lead' AND json_extract(data,'$.systemCode')=?").bind(owner,code).first())return code;
 }
 throw new ApiError(409,'리드 코드를 만들지 못했습니다. 다시 시도해 주세요.');
}

// ── 설정(대표·관리자) ──
function storageLabelOf(v:unknown,profile:FranchiseProfile|null,required:boolean):string|null{
 if(blank(v)){if(required)bad('보관 위치를 입력해 주세요.');return null}
 if(typeof v!=='string')fail('STORAGE_LABEL');
 const t=v.trim();
 if(profile?.storageLabels?.length){if(!profile.storageLabels.includes(t))fail('STORAGE_LABEL');return t}
 if(t.length>40)fail('STORAGE_LABEL');
 return clean(t);
}
const labelOf=(v:unknown,name:string,max:number)=>clean(str(v,name,max,true));
function labelList(v:unknown,name:string,max:number,each:number,region=false):string[]{
 if(v===undefined||v===null)return [];
 if(!Array.isArray(v)||v.length>max)bad(`${name} 입력을 확인해 주세요.`);
 return [...new Set(v.map(x=>region?readRegion(x):labelOf(x,name,each)).filter(Boolean))];
}
function subset<T extends string>(list:readonly T[],v:unknown,name:string):T[]{if(v===undefined||v===null)return [];if(!Array.isArray(v))bad(`${name} 입력을 확인해 주세요.`);return [...new Set(v.map(x=>pick(list,x,`${name} 입력을 확인해 주세요.`)))]}
const lastDay=(y:number,m:number)=>new Date(Date.UTC(y,m,0)).getUTCDate();
async function saveProfile(c:Ctx):Promise<Outcome>{
 const old=await profileOf(c.owner,c.brandId);
 if(c.input.version!==(old?.version??0))fail('STALE');
 const p=isRecord(c.input.profile)?c.input.profile:bad('가맹 프로필 입력을 확인해 주세요.');
 const branch=pick(BRANCHES,p.branch,'분기를 골라 주세요.'),fi=isRecord(p.forecastInputs)?p.forecastInputs:{};
 const sme=fi.sme===undefined||fi.sme===null?null:typeof fi.sme==='boolean'?fi.sme:bad('중소기업 여부를 확인해 주세요.');
 const stores=fi.storesAtFyEnd===undefined||fi.storesAtFyEnd===null||fi.storesAtFyEnd===''?null:typeof fi.storesAtFyEnd==='number'&&Number.isSafeInteger(fi.storesAtFyEnd)&&fi.storesAtFyEnd>=0?fi.storesAtFyEnd:bad('가맹점 수를 확인해 주세요.');
 const fy=blank(fi.fiscalYearEnd)?null:isDate(fi.fiscalYearEnd)&&Number(fi.fiscalYearEnd.slice(8,10))===lastDay(Number(fi.fiscalYearEnd.slice(0,4)),Number(fi.fiscalYearEnd.slice(5,7)))?fi.fiscalYearEnd:bad('사업연도 종료일은 월말 날짜로 입력해 주세요.');
 let holidays:FranchiseProfile['holidays']=null;
 if(isRecord(p.holidays)){
  const list=p.holidays.list;
  if(!Array.isArray(list)||list.length>LIMITS.holidays||!list.every(isDate))bad('공휴일 목록을 확인해 주세요.');
  if(list.length){const source=labelOf(p.holidays.source,'공휴일 출처',200);holidays={list:[...new Set(list)].sort(),source,verifiedAt:c.now}}
 }else if(p.holidays!==undefined&&p.holidays!==null)bad('공휴일 목록을 확인해 주세요.');
 const storageLabels=labelList(p.storageLabels,'보관 위치',20,40);
 let eligibility:EligibilityCriteria|null=null;
 if(isRecord(p.eligibility)){
  const e=p.eligibility,next={budgetBands:subset(BUDGET_BANDS,e.budgetBands,'예산 구간'),regions:labelList(e.regions,'모집 지역',50,40,true),timingBands:subset(TIMING_BANDS,e.timingBands,'시기 구간')};
  const prev=old?.eligibility,same=prev&&JSON.stringify([prev.budgetBands,prev.regions,prev.timingBands])===JSON.stringify([next.budgetBands,next.regions,next.timingBands]);
  eligibility={version:same?prev.version:(prev?.version??0)+1,...next};
 }else if(p.eligibility!==undefined&&p.eligibility!==null)bad('적격 기준 입력을 확인해 주세요.');
 const profile:FranchiseProfile={id:c.brandId,brandId:c.brandId,branch,forecastInputs:{sme,storesAtFyEnd:stores,fiscalYearEnd:fy},holidays,storageLabels,eligibility,version:(old?.version??0)+1,updatedAt:c.now,updatedBy:c.by};
 const fields=['branch','forecastInputs','holidays','storageLabels','eligibility'] as const;
 const changedFields=fields.filter(k=>!old||JSON.stringify(k==='holidays'?old.holidays?.list??null:old[k])!==JSON.stringify(k==='holidays'?profile.holidays?.list??null:profile[k]));
 const result={version:profile.version,changedFields,branch};
 await commit([recordStatement(c.owner,'franchise_profile',c.brandId,profile,c.brandId),auditStmt(c.owner,receiptAudit(c,'profile_save',result,{changedFields}))]);
 return {result};
}
// 날짜만 주면 시작은 그날 KST 0시, 끝은 다음 날 KST 0시로 저장한다(유효 기간 [시작, 끝) — 화면의 '유효 기간 끝' 날짜도 유효한 날로 센다).
const instantOrDate=(v:unknown,message:string)=>isDate(v)?kstMidnight(v):isInstant(v)?v:bad(message);
const untilOf=(v:unknown,message:string)=>isDate(v)?kstMidnight(addDays(v,1)):isInstant(v)?v:bad(message);
const sameInstant=(a:string|null,b:string|null)=>a===b||(a!==null&&b!==null&&ms(a)===ms(b));
const sameItems=(a:readonly number[],b:readonly number[])=>JSON.stringify([...a].sort((x,y)=>x-y))===JSON.stringify([...b].sort((x,y)=>x-y));
const AMEND_LIMIT=50;
function readVersionMeta(c:Ctx,i:Json,current?:VersionRow){
 const given=(k:string)=>!current||(Object.hasOwn(i,k)&&i[k]!==undefined);
 const registeredAt=given('registeredAt')?(blank(i.registeredAt)?null:pastTime(i.registeredAt,c.now,'등록 시각을 확인해 주세요.')):current!.registeredAt;
 const validFrom=given('validFrom')?instantOrDate(i.validFrom,'유효 기간을 확인해 주세요.'):current!.validFrom,validUntil=given('validUntil')?untilOf(i.validUntil,'유효 기간을 확인해 주세요.'):current!.validUntil;
 if(ms(validFrom)>=ms(validUntil))bad('유효 기간을 확인해 주세요.');
 return {registeredAt,validFrom,validUntil};
}
function readItems(v:unknown):number[]{
 if(!Array.isArray(v)||v.length>CONTRACT_ITEM_COUNT||!v.every(x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=1&&x<=CONTRACT_ITEM_COUNT)||new Set(v).size!==v.length)bad('확인한 기재 항목을 확인해 주세요.');
 return [...v as number[]].sort((a,b)=>a-b);
}
// 트랙 R R1b: 버전 등록·정정·사용 중지로 확정 가맹 사실의 근거 버전이 현재 등록 버전에서 벗어나거나(교체), 현재 버전의 라벨·등록일이 바뀌면(각주가 바뀜)
// 그 사실을 쓴 승인·접수 발행에 재검토를 표시한다. 이미 교체돼 있던 사실은 다시 표시하지 않는다. 사실 자체는 고치지 않는다(사람이 save_fact·rebase_facts로 옮긴다).
// 표시한 건이 없으면 extra를 만들지 않아 응답이 이전과 같다. 조건부 UPDATE라 owner 잠금이 필요 없다. 실패하면 null과 기록만 남긴다(버전 변경은 유지).
const versionLite=(v:VersionRow):VersionLite=>({id:v.id,brandId:v.brandId,label:v.label,registeredAt:v.registeredAt,validFrom:v.validFrom,validUntil:v.validUntil,status:v.status});
// 트랙 R R15a-2a: 같은 변경으로 모집 자료(초안·승인 판)에도 재검토를 표시한다(바뀐 버전 id와 그 버전을 근거로 쓴 확정 사실 id). 표시한 자료가 없으면 reviewAssets 키가 없다. 실패하면 null(버전 변경은 유지).
async function versionFactReview(c:Ctx,before:readonly VersionRow[],after:readonly VersionRow[],noteChanged:string|null):Promise<Json|undefined>{
 const facts=(await listRecords<BrandFact>(c.owner,'brand_fact',c.brandId)).filter(f=>f.brandId===c.brandId&&f.status==='confirmed'&&!!f.sourceRef);
 const was=versionStates(before.map(versionLite),c.now),now=versionStates(after.map(versionLite),c.now);
 const ids=facts.filter(f=>{const id=f.sourceRef!.disclosureVersionId;return was[id]==='current'&&(now[id]!=='current'||id===noteChanged)}).map(f=>f.id);
 const out:Json={};
 if(ids.length)out.reviewPublications=await flagPublicationsForFactChange(database(),c.owner,ids).catch(()=>{console.error('franchise_fact_flag_failed');return null});
 const reviewAssets=await markAssetsForVersionChange(c.owner,c.brandId,before.map(versionLite),after.map(versionLite),c.now,noteChanged,ids).catch(()=>{console.error('franchise_asset_flag_failed');return null});
 if(reviewAssets!==0)out.reviewAssets=reviewAssets;
 return Object.keys(out).length?out:undefined;
}
// 같은 파일(해시)을 다시 등록하면: 사용 중이고 판정에 쓰는 값(등록일·유효 기간 / 확인 항목)이 같으면 기존 항목(쓰기 없음), 다르면 409(정정을 쓴다),
// 사용 중지된 항목이면 요청 값으로 다시 사용한다(바꾸기 전 값은 amendments에, 감사 행은 register에 reasonCode 'reactivate').
async function registerVersion(c:Ctx):Promise<Outcome>{
 const i=c.input,label=labelOf(i.label,'라벨',60),sha256=shaOf(i.sha256,true) as string,meta=readVersionMeta(c,i);
 const [versions,profile]=await Promise.all([versionsOf(c.owner,c.brandId),profileOf(c.owner,c.brandId)]);
 const storageLabel=storageLabelOf(i.storageLabel,profile,true) as string;
 const same=versions.find(v=>v.sha256===sha256);
 if(same){
  const sameMeta=sameInstant(same.registeredAt,meta.registeredAt)&&sameInstant(same.validFrom,meta.validFrom)&&sameInstant(same.validUntil,meta.validUntil);
  if(same.status==='active'){if(!sameMeta)fail('REGISTRY_CONFLICT');return {result:{id:same.id,existing:true,status:same.status}}}
  if((same.amendments?.length??0)>=AMEND_LIMIT)fail('LIMIT');
  const next:VersionRow={...same,label,storageLabel,...meta,status:'active',retiredAt:undefined,version:same.version+1,amendments:[...(same.amendments??[]),{at:c.now,by:c.by,reasonCode:'reactivate',before:{status:same.status,registeredAt:same.registeredAt,validFrom:same.validFrom,validUntil:same.validUntil,label:same.label,storageLabel:same.storageLabel}}]};
  const result={id:same.id,existing:true,reactivated:true,status:next.status,version:next.version};
  await commit([recordStatement(c.owner,'franchise_disclosure_version',same.id,next,c.brandId),auditStmt(c.owner,receiptAudit(c,'version_register',result,{recordId:same.id,reasonCode:'reactivate'}))]);
  const extra=await versionFactReview(c,versions,versions.map(v=>v.id===same.id?next:v),null);
  return {result,...(extra?{extra}:{})};
 }
 if(versions.length>=LIMITS.versions)fail('LIMIT');
 const row:VersionRow={id:'dv-'+uid(),brandId:c.brandId,label,sha256,...meta,storageLabel,status:'active',version:1,createdAt:c.now,createdBy:c.by};
 const result={id:row.id,existing:false,status:row.status,version:row.version};
 await commit([recordStatement(c.owner,'franchise_disclosure_version',row.id,row,c.brandId),auditStmt(c.owner,receiptAudit(c,'version_register',result,{recordId:row.id}))]);
 const extra=await versionFactReview(c,versions,[...versions,row],null);
 return {result,...(extra?{extra}:{})};
}
async function registerTemplate(c:Ctx):Promise<Outcome>{
 const i=c.input,label=labelOf(i.label,'라벨',60),sha256=shaOf(i.sha256,true) as string,checkedItems=readItems(i.checkedItems);
 const [templates,profile]=await Promise.all([templatesOf(c.owner,c.brandId),profileOf(c.owner,c.brandId)]);
 const storageLabel=storageLabelOf(i.storageLabel,profile,true) as string;
 const same=templates.find(t=>t.sha256===sha256);
 if(same){
  if(same.status==='active'){if(!sameItems(same.checkedItems,checkedItems))fail('REGISTRY_CONFLICT');return {result:{id:same.id,existing:true,status:same.status,complete:same.checkedItems.length===CONTRACT_ITEM_COUNT}}}
  if((same.amendments?.length??0)>=AMEND_LIMIT)fail('LIMIT');
  const next:TemplateRow={...same,label,storageLabel,checkedItems,status:'active',retiredAt:undefined,version:same.version+1,amendments:[...(same.amendments??[]),{at:c.now,by:c.by,reasonCode:'reactivate',before:{status:same.status,checkedItems:same.checkedItems,label:same.label,storageLabel:same.storageLabel}}]};
  const result={id:same.id,existing:true,reactivated:true,status:next.status,version:next.version,complete:checkedItems.length===CONTRACT_ITEM_COUNT};
  await commit([recordStatement(c.owner,'franchise_contract_template',same.id,next,c.brandId),auditStmt(c.owner,receiptAudit(c,'template_register',result,{recordId:same.id,reasonCode:'reactivate'}))]);
  return {result};
 }
 if(templates.length>=LIMITS.templates)fail('LIMIT');
 const row:TemplateRow={id:'ct-'+uid(),brandId:c.brandId,label,sha256,checkedItems,storageLabel,status:'active',version:1,createdAt:c.now,createdBy:c.by};
 const result={id:row.id,existing:false,status:row.status,version:row.version,complete:row.checkedItems.length===CONTRACT_ITEM_COUNT};
 await commit([recordStatement(c.owner,'franchise_contract_template',row.id,row,c.brandId),auditStmt(c.owner,receiptAudit(c,'template_register',result,{recordId:row.id}))]);
 return {result};
}
// 정정(대표·관리자, 사유 필수): 같은 id에 값을 고치고 버전을 올린다. 바꾸기 전 값은 amendments에 남고 감사 행에 바뀐 항목 이름·사유가 남는다(추가 전용 이력).
// 판정은 언제나 현재 값으로 다시 한다(이미 기록한 제공도 정정한 등록일·유효 기간·확인 항목으로 다시 센다).
async function amendRegistry(c:Ctx,kind:'version'|'template'):Promise<Outcome>{
 const i=c.input,id=str(i.id,'항목',100,true),reasonCode=pick(REGISTRY_AMEND_REASONS,i.reasonCode,'정정 사유를 골라 주세요.');
 const [rows,profile]=await Promise.all([kind==='version'?versionsOf(c.owner,c.brandId):templatesOf(c.owner,c.brandId),profileOf(c.owner,c.brandId)]);
 const row=(rows as (VersionRow|TemplateRow)[]).find(r=>r.id===id);
 if(!row)throw new ApiError(404,'항목을 찾을 수 없습니다.');
 if(i.version!==row.version)fail('STALE');
 if((row.amendments?.length??0)>=AMEND_LIMIT)fail('LIMIT');
 const given=(k:string)=>Object.hasOwn(i,k)&&i[k]!==undefined;
 const label=given('label')?labelOf(i.label,'라벨',60):row.label,storageLabel=given('storageLabel')?storageLabelOf(i.storageLabel,profile,true) as string:row.storageLabel;
 const before:Json={label:row.label,storageLabel:row.storageLabel},after:Json={label,storageLabel};
 if(kind==='version'){const v=row as VersionRow;Object.assign(before,{registeredAt:v.registeredAt,validFrom:v.validFrom,validUntil:v.validUntil});Object.assign(after,readVersionMeta(c,i,v))}
 else{const t=row as TemplateRow;before.checkedItems=t.checkedItems;after.checkedItems=given('checkedItems')?readItems(i.checkedItems):t.checkedItems}
 const differs=(k:string)=>k==='checkedItems'?!sameItems(before[k] as number[],after[k] as number[]):k==='label'||k==='storageLabel'?before[k]!==after[k]:!sameInstant(before[k] as string|null,after[k] as string|null);
 const changedFields=Object.keys(after).filter(differs);
 if(!changedFields.length)bad('바뀐 내용이 없습니다.');
 const next={...row,...after,version:row.version+1,amendments:[...(row.amendments??[]),{at:c.now,by:c.by,reasonCode,before:Object.fromEntries(changedFields.map(k=>[k,before[k]]))}]};
 const result={id,version:next.version,changedFields,...(kind==='template'?{complete:(next as TemplateRow).checkedItems.length===CONTRACT_ITEM_COUNT}:{})};
 await commit([recordStatement(c.owner,kind==='version'?'franchise_disclosure_version':'franchise_contract_template',id,next,c.brandId),auditStmt(c.owner,receiptAudit(c,kind==='version'?'version_amend':'template_amend',result,{recordId:id,reasonCode,changedFields},id))]);
 if(kind!=='version')return {result};
 const prior=rows as VersionRow[],extra=await versionFactReview(c,prior,prior.map(v=>v.id===id?next as VersionRow:v),changedFields.some(f=>f==='label'||f==='registeredAt')?id:null);
 return {result,...(extra?{extra}:{})};
}
async function registerNotice(c:Ctx):Promise<Outcome>{
 const i=c.input,versionLabel=labelOf(i.versionLabel,'버전 이름',20),text=str(i.text,'안내문 본문',20000,true),controllerName=str(i.controllerName,'개인정보처리자 이름',100,true);
 const names=i.processorNames===undefined||i.processorNames===null?[]:i.processorNames;
 if(!Array.isArray(names)||names.length>10)bad('수탁자 이름을 확인해 주세요.');
 const processorNames=names.map(n=>str(n,'수탁자 이름',100,true));
 const sha256=await sha256Hex(text),notices=await noticesOf(c.owner,c.brandId);
 const same=notices.find(n=>n.sha256===sha256);
 if(same){
  // 같은 본문: 처리자·수탁자 이름까지 같으면 기존 안내문(사용 중지였으면 다시 사용), 다르면 409.
  if(same.controllerName!==controllerName||JSON.stringify(same.processorNames)!==JSON.stringify(processorNames))fail('NOTICE_CONFLICT');
  if(same.status==='active')return {result:{id:same.id,existing:true,status:same.status}};
  const next:NoticeRow={...same,status:'active',retiredAt:undefined,amendments:[...(same.amendments??[]),{at:c.now,by:c.by,reasonCode:'reactivate',before:{status:same.status}}]};
  const result={id:same.id,existing:true,reactivated:true,status:next.status,versionLabel:same.versionLabel};
  await commit([recordStatement(c.owner,'franchise_privacy_notice',same.id,next,c.brandId),auditStmt(c.owner,receiptAudit(c,'notice_register',result,{recordId:same.id,reasonCode:'reactivate'}))]);
  return {result};
 }
 if(notices.some(n=>n.versionLabel===versionLabel))throw new ApiError(409,'같은 버전 이름의 안내문이 이미 있습니다.');
 if(notices.length>=LIMITS.versions)fail('LIMIT');
 const row:NoticeRow={id:'pn-'+uid(),brandId:c.brandId,versionLabel,text,sha256,controllerName,processorNames,status:'active',createdAt:c.now,createdBy:c.by};
 const result={id:row.id,existing:false,status:row.status,sha256};
 await commit([recordStatement(c.owner,'franchise_privacy_notice',row.id,row,c.brandId),auditStmt(c.owner,receiptAudit(c,'notice_register',result,{recordId:row.id}))]);
 return {result};
}
async function retire(c:Ctx,kind:'version'|'template'|'notice'):Promise<Outcome>{
 const id=str(c.input.id,'항목',100,true);
 const rows:(Registered&{version?:number})[]=kind==='version'?await versionsOf(c.owner,c.brandId):kind==='template'?await templatesOf(c.owner,c.brandId):await noticesOf(c.owner,c.brandId);
 const row=rows.find(r=>r.id===id);
 if(!row)throw new ApiError(404,'항목을 찾을 수 없습니다.');
 if(kind!=='notice'&&c.input.version!==row.version)fail('STALE');
 if(row.status==='retired')return {result:{id,status:'retired',alreadyRetired:true}};
 const next={...row,status:'retired' as const,retiredAt:c.now,...(kind!=='notice'?{version:(row.version??1)+1}:{})};
 const result={id,status:'retired',...(kind!=='notice'?{version:next.version}:{})};
 const stmt=kind==='version'?recordStatement(c.owner,'franchise_disclosure_version',id,next,c.brandId):kind==='template'?recordStatement(c.owner,'franchise_contract_template',id,next,c.brandId):recordStatement(c.owner,'franchise_privacy_notice',id,next,c.brandId);
 await commit([stmt,auditStmt(c.owner,receiptAudit(c,kind==='version'?'version_retire':kind==='template'?'template_retire':'notice_retire',result,{recordId:id},id))]);
 if(kind!=='version')return {result};
 const prior=rows as VersionRow[],extra=await versionFactReview(c,prior,prior.map(v=>v.id===id?next as VersionRow:v),null);
 return {result,...(extra?{extra}:{})};
}

// ── 리드 ──
async function createLead(c:Ctx):Promise<Outcome>{
 const profile=await profileOf(c.owner,c.brandId);
 if(!profile||profile.branch!=='A')fail('BRANCH_BLOCKED');
 const i=c.input,ci=isRecord(i.contact)?i.contact:{};
 const name=readName(ci.name),phone=readPhone(ci.phone),email=readEmail(ci.email);
 if(!phone&&!email)fail('CONTACT_REQUIRED');
 const memo=readMemo(i.memo),task=await readTask(c,i.task,null),basis=await readBasis(c,i.basis);
 const marketing:LeadMarketing=i.marketing===undefined||i.marketing===null||(isRecord(i.marketing)&&i.marketing.status==='none')?{status:'none'}:isRecord(i.marketing)?await readMarketingGiven(c,i.marketing):bad('광고성 정보 동의 입력을 확인해 주세요.');
 const assigneeId=await readAssignee(c,i.assigneeId,true),leadId=uid();
 const keys=await contactKeys(c,{phone,email},leadId),systemCode=await newSystemCode(c.owner);
 const lead:LeadRecord={id:leadId,brandId:c.brandId,systemCode,stage:'inquiry',closeReason:null,closedFrom:null,assigneeId,
  contact:{name:await sealField(name),phone:phone?await sealField(phone):null,email:email?await sealField(email):null},memo:memo?await sealField(memo):null,contactState:'present',
  task,basis,marketing,firstContactAt:null,lastActivityAt:c.now,contractedAt:null,closedAt:null,version:1,createdAt:c.now,createdBy:c.by,updatedAt:c.now};
 const result={leadId,systemCode,version:1,stage:'inquiry'};
 const basisEvent={type:basis.type,...(basis.noticeId?{noticeId:basis.noticeId,noticeGivenAt:basis.noticeGivenAt}:{}),...(basis.referralFrom?{referralFrom:basis.referralFrom}:{})};
 await commit([leadStmt(c.owner,lead),...keys.map(k=>keyInsert(c,leadId,k)),eventStmt(c.owner,receiptEvent(c,lead,'created',result,{basis:basisEvent})),
  ...(marketing.status==='given'?[eventStmt(c.owner,plainEvent(c,lead,'marketing_given',{consent:{method:marketing.method,at:marketing.at,noticeId:marketing.noticeId}}))]:[])]);
 await verifyKeys(c,keys,leadId,[database().prepare("DELETE FROM records WHERE owner=? AND kind='franchise_lead' AND id=?").bind(c.owner,`${c.owner}:franchise_lead:${leadId}`),database().prepare("DELETE FROM records WHERE owner=? AND kind='franchise_lead_event' AND parent_id=?").bind(c.owner,leadId),deleteKeys(c.owner,leadId)]);
 return {result,lead};
}
async function updateContact(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const i=c.input,ci=isRecord(i.contact)?i.contact:{},given=(k:string)=>Object.hasOwn(ci,k)&&ci[k]!==undefined,cur=lead.contact!;
 const old={name:await openField(cur.name),phone:cur.phone?await openField(cur.phone):null,email:cur.email?await openField(cur.email):null};
 const next={...old},changed:ContactField[]=[];
 if(given('name')){next.name=readName(ci.name);if(next.name!==old.name)changed.push('name')}
 if(given('phone')){next.phone=readPhone(ci.phone);if(next.phone!==old.phone)changed.push('phone')}
 if(given('email')){next.email=readEmail(ci.email);if(next.email!==old.email)changed.push('email')}
 let memo=lead.memo;
 const replaceMemo=Object.hasOwn(i,'memo')&&i.memo!==undefined,appendMemo=Object.hasOwn(i,'memoAppend')&&i.memoAppend!==undefined&&i.memoAppend!==null;
 if(replaceMemo&&appendMemo)bad('메모는 바꾸기와 덧붙이기 중 하나만 보내 주세요.');
 if(replaceMemo){const m=readMemo(i.memo),old=lead.memo?await openField(lead.memo):null;if(m!==old){memo=m?await sealField(m):null;changed.push('memo')}}
 // 덧붙이기: 기존 메모(복호화) 뒤에 줄을 바꿔 붙인다. 합친 메모도 1000자·개인정보 패턴 검사를 한다. 화면은 기존 메모를 보지 않고도 통화 메모를 더한다.
 if(appendMemo){const add=readMemo(i.memoAppend);if(add){const old=lead.memo?await openField(lead.memo):null,next=old?old+'\n'+add:add;if(next.length>1000)bad('메모는 1000자까지입니다. 기존 메모를 줄인 뒤 다시 시도해 주세요.');memo=await sealField(clean(next));changed.push('memo')}}
 if(!next.phone&&!next.email)fail('CONTACT_REQUIRED');
 if(!changed.length)bad('바뀐 내용이 없습니다.');
 const rekey=(['phone','email'] as const).filter(t=>changed.includes(t));
 const keys=await contactKeys(c,Object.fromEntries(rekey.map(t=>[t,next[t]])),lead.id);
 const contact={name:changed.includes('name')?await sealField(next.name):cur.name,phone:changed.includes('phone')?next.phone?await sealField(next.phone):null:cur.phone,email:changed.includes('email')?next.email?await sealField(next.email):null:cur.email};
 const updated=bump(c,lead,{contact,memo},'contact_updated'),result={leadId:lead.id,version:updated.version,fields:changed};
 await commit([leadStmt(c.owner,updated),...rekey.map(t=>database().prepare("DELETE FROM records WHERE owner=? AND kind='franchise_lead_key' AND parent_id=? AND json_extract(data,'$.type')=?").bind(c.owner,lead.id,t)),...keys.map(k=>keyInsert(c,lead.id,k)),eventStmt(c.owner,receiptEvent(c,lead,'contact_updated',result,{fields:changed}))]);
 // 잠금 아래에서는 생기지 않는 경합의 보상: 리드를 이전 연락처로 되돌리고 새 키를 지우고 이전 키를 다시 넣는다.
 const oldKeys:{id:string;type:'phone'|'email'}[]=[];
 for(const t of rekey){const value=old[t];if(value)oldKeys.push({id:await leadKeyHmac(c.owner,c.brandId,t,value),type:t})}
 await verifyKeys(c,keys,lead.id,[leadStmt(c.owner,{...lead,version:updated.version+1,updatedAt:c.now}),...keys.map(k=>database().prepare("DELETE FROM records WHERE owner=? AND kind='franchise_lead_key' AND id=? AND parent_id=?").bind(c.owner,`${c.owner}:franchise_lead_key:${k.id}`,lead.id)),...oldKeys.map(k=>keyInsert(c,lead.id,k))]);
 return {result,lead:updated};
}
async function updateTask(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const task=await readTask(c,c.input.task,lead.task),taskFields=(Object.keys(task) as (keyof LeadTask)[]).filter(k=>task[k]!==lead.task[k]);
 if(!taskFields.length)bad('바뀐 내용이 없습니다.');
 const updated=bump(c,lead,{task},'task_updated'),result={leadId:lead.id,version:updated.version,taskFields};
 await commit([leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'task_updated',result,{taskFields}))]);
 return {result,lead:updated};
}
// 게이트 409는 실패 가운데 유일하게 쓴다: transition_blocked 이벤트 1행(영수증, 버전·마지막 활동 불변). 같은 요청 번호로 다시 보내면 같은 409가 재생된다.
async function blocked(c:Ctx,lead:LeadRecord,gate:GateResult,to:LeadStage|null,window?:ContractWindow):Promise<never>{
 const payload=gatePayload(gate,window),result={error:FRANCHISE_ERRORS.GATE_BLOCKED.text,...payload};
 await commit([eventStmt(c.owner,{...receiptEvent(c,lead,'transition_blocked',result,{...(to?{to}:{}),reasonCodes:gate.reasons}),status:409})]);
 throw new FranchiseError(409,FRANCHISE_ERRORS.GATE_BLOCKED.text,payload);
}
async function moveStage(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const to=pick(LEAD_STAGES,c.input.to,'단계를 골라 주세요.');
 if(isEvidenceStage(to))fail('EVIDENCE_ONLY');
 if(lead.stage==='closed')fail('CLOSED');
 if(to===lead.stage)bad('이미 그 단계입니다.');
 if(isGeneralStage(to)&&(isEvidenceStage(lead.stage)||lead.stage==='opened'))fail('NO_BACKWARD');
 let closeReason:LeadRecord['closeReason']=null;
 if(to==='closed'){
  closeReason=pick(CLOSE_REASONS,c.input.closeReason,'종결 사유를 골라 주세요.');
  if(closeReason==='contract_ended'&&!lead.contractedAt)bad('계약 종료는 계약한 리드에만 고를 수 있습니다.');
 }
 const [{ctx},rows]=await Promise.all([gateContext(c.owner,lead.brandId),evidenceRows(c.owner,lead)]);
 const gate=checkTransition(leadGateOf(rows),to,c.now,ctx);
 if(!gate.ok)await blocked(c,lead,gate,to);
 if(to==='opened'&&lead.stage!=='contracted'&&lead.stage!=='fee_escrowed')await blocked(c,lead,{...gate,ok:false,reasons:['invalid_stage']},to);
 const patch:Partial<LeadRecord>={stage:to,...(to==='closed'?{closeReason,closedAt:c.now,closedFrom:lead.stage}:{}),...(isGeneralStage(to)&&to!=='inquiry'&&!lead.firstContactAt?{firstContactAt:c.now}:{})};
 const updated=bump(c,lead,patch,'stage_changed'),result={leadId:lead.id,version:updated.version,from:lead.stage,to};
 await commit([leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'stage_changed',result,{from:lead.stage,to,...(closeReason?{closeReason}:{})}))]);
 return {result,lead:updated};
}
// 다시 열기: 종결 전 단계로 되돌리고, 그 단계를 지금 설정(공휴일·산정서 입력·버전)으로 checkTransition에 다시 건다. 증빙이 이미 있어 되돌림은 막지 않되
// 통과하지 못하면 사유를 응답(recheck)과 reopened 이벤트(reasonCodes)에 남겨 대표·관리자가 확인하게 한다.
async function reopenLead(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 if(lead.stage!=='closed')bad('종결된 리드만 다시 열 수 있습니다.');
 const stage=lead.closedFrom??'inquiry',[{ctx},rows]=await Promise.all([gateContext(c.owner,lead.brandId),evidenceRows(c.owner,lead)]);
 const gate=checkTransition(leadGateOf(rows),stage,c.now,ctx),recheck={ok:gate.ok,reasons:codeMessages(gate.reasons),warnings:codeMessages(gate.warnings),disclaimer:GATE_DISCLAIMER};
 const updated=bump(c,lead,{stage,closedAt:null,closeReason:null,closedFrom:null},'reopened'),result={leadId:lead.id,version:updated.version,stage,recheck};
 await commit([leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'reopened',result,{from:'closed',to:stage,...(gate.ok?{}:{reasonCodes:gate.reasons})}))]);
 return {result,lead:updated};
}
async function claimLead(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 if(lead.assigneeId!==null)fail('ALREADY_ASSIGNED');
 const updated=bump(c,lead,{assigneeId:c.who.id},'claimed'),result={leadId:lead.id,version:updated.version,assigneeId:c.who.id};
 await commit([leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'claimed',result,{assigneeId:c.who.id})),auditStmt(c.owner,plainAudit(c,'claim',{leadId:lead.id,assigneeId:c.who.id}))]);
 return {result,lead:updated};
}
async function assignLead(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const assigneeId=await readAssignee(c,c.input.assigneeId,false);
 if(assigneeId===lead.assigneeId)bad('바뀐 내용이 없습니다.');
 const updated=bump(c,lead,{assigneeId},'assigned'),result={leadId:lead.id,version:updated.version,assigneeId};
 await commit([leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'assigned',result,{assigneeId})),auditStmt(c.owner,plainAudit(c,'assign',{leadId:lead.id,assigneeId}))]);
 return {result,lead:updated};
}
async function recordSourceNotice(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 if(lead.basis.type!=='referral')bad('출처 고지 대상이 아닙니다.');
 const at=pastTime(c.input.noticedAt,c.now,'고지 시각을 확인해 주세요.');
 if(ms(at)<ms(lead.createdAt))bad('고지 시각을 확인해 주세요.');
 const updated=bump(c,lead,{basis:{...lead.basis,sourceNoticedAt:at}},'source_noticed'),result={leadId:lead.id,version:updated.version,sourceNoticedAt:at};
 await commit([leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'source_noticed',result))]);
 return {result,lead:updated};
}
async function setMarketing(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 if(c.input.status==='withdrawn'){
  if(lead.marketing.status==='withdrawn')bad('이미 철회했습니다.');
  const marketing:LeadMarketing={...lead.marketing,status:'withdrawn',withdrawnAt:c.now},updated=bump(c,lead,{marketing},'marketing_withdrawn'),result={leadId:lead.id,version:updated.version,status:'withdrawn'};
  await commit([leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'marketing_withdrawn',result,{withdrawnAt:c.now})),auditStmt(c.owner,plainAudit(c,'marketing_withdrawn',{leadId:lead.id}))]);
  return {result,lead:updated};
 }
 const marketing=await readMarketingGiven(c,c.input),updated=bump(c,lead,{marketing},'marketing_given'),result={leadId:lead.id,version:updated.version,status:'given'};
 await commit([leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'marketing_given',result,{consent:{method:marketing.method,at:marketing.at,noticeId:marketing.noticeId}}))]);
 return {result,lead:updated};
}
function revealFields(v:unknown):ContactField[]{
 if(!Array.isArray(v)||!v.length||v.length>CONTACT_FIELDS.length||new Set(v).size!==v.length)bad('볼 항목을 골라 주세요.');
 return v.map(f=>pick(CONTACT_FIELDS,f,'볼 항목을 골라 주세요.'));
}
async function contactValues(lead:LeadRecord,fields:readonly ContactField[]){
 const c=lead.contact!,out:Record<string,string|null>={};
 for(const f of fields){
  if(f==='name')out.name=await openField(c.name);
  else if(f==='phone')out.phone=c.phone?formatPhone(await openField(c.phone)):null;
  else if(f==='email')out.email=c.email?await openField(c.email):null;
  else out.memo=lead.memo?await openField(lead.memo):null;
 }
 return out;
}
async function revealContact(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const fields=revealFields(c.input.fields),purpose=pick(REVEAL_PURPOSES,c.input.purpose,'열람 목적을 골라 주세요.');
 const values=await contactValues(lead,fields),result={leadId:lead.id,fields,purpose};
 await commit([auditStmt(c.owner,receiptAudit(c,'reveal',result,{leadId:lead.id,fields,purpose,leadVersion:lead.version},lead.id))]);
 return {result,extra:{values},leadView:false};
}

// ── 증빙(대표·관리자, 추가 전용) ──
const EVIDENCE_LIMITS:Partial<Record<EvidenceType,number>>={delivery:LIMITS.deliveries,advice:LIMITS.advice,fee:LIMITS.fees,agreement:LIMITS.agreements};
type Prelude={rows:EvidenceRow[];ctx:GateContext;profile:FranchiseProfile|null;versions:VersionRow[];templates:TemplateRow[];docSha256:string|null;storageLabel:string|null;supersedes:string|null;correctionReason:CorrectionReason|null};
async function evidencePrelude(c:Ctx,lead:LeadRecord,type:EvidenceType,shaRequired=false):Promise<Prelude>{
 if(lead.stage==='closed')fail('CLOSED');
 const [rows,{ctx,profile,versions,templates}]=await Promise.all([evidenceRows(c.owner,lead),gateContext(c.owner,lead.brandId)]);
 const i=c.input,docSha256=shaOf(i.docSha256,shaRequired),storageLabel=storageLabelOf(i.storageLabel,profile,false);
 let supersedes:string|null=null,correctionReason:CorrectionReason|null=null;
 if(!blank(i.supersedes)||!blank(i.correctionReason)){
  const target=activeEvidence(rows).find(r=>r.id===i.supersedes&&r.evidenceType===type);
  if(!target)bad('정정할 기록을 찾을 수 없습니다.');
  correctionReason=pick(CORRECTION_REASONS.filter(r=>r!=='wrong_lead'),i.correctionReason,'정정 사유를 골라 주세요.');
  supersedes=target.id;
 }
 if(rows.length>=600)fail('LIMIT');
 const limit=EVIDENCE_LIMITS[type];
 if(limit!==undefined&&activeEvidence(rows).filter(r=>r.evidenceType===type&&r.id!==supersedes).length>=limit)fail('LIMIT');
 return {rows,ctx,profile,versions,templates,docSha256,storageLabel,supersedes,correctionReason};
}
// 증빙 시각: 미래면 400. 기록 시각(서버 now)보다 이르면 사유가 있어야 하고, 사유가 있으면 승인 표지와 backdate 감사 행을 같은 batch에 만든다.
function backdate(c:Ctx,times:readonly string[]):{approval:BackdateApproval|null;audit:AuditRow|null}{
 if(times.some(t=>ms(t)>ms(c.now)))fail('FUTURE_TIME');
 if(!times.some(t=>ms(t)<ms(c.now)))return {approval:null,audit:null};
 const reasonCode=oneOf(BACKDATE_REASONS,c.input.backdateReason)?c.input.backdateReason:fail('BACKDATE');
 const audit=plainAudit(c,'backdate',{reasonCode});
 return {approval:{role:c.who.role==='owner'?'owner':'admin',reasonCode,auditEventId:audit.id},audit};
}
const evidenceRow=(c:Ctx,lead:LeadRecord,type:EvidenceType,pre:Prelude,payload:Json,approval:BackdateApproval|null,id='fd-'+uid()):EvidenceRow=>({id,leadId:lead.id,brandId:lead.brandId,evidenceType:type,recordedAt:c.now,recordedBy:c.by,backdateApproval:approval,supersedes:pre.supersedes,correctionReason:pre.correctionReason,docSha256:pre.docSha256,storageLabel:pre.storageLabel,payload});
async function appendEvidence(c:Ctx,lead:LeadRecord,row:EvidenceRow,audit:AuditRow|null,patch:Partial<LeadRecord>,extra:Json={}):Promise<Outcome>{
 const updated=bump(c,lead,patch,'evidence_recorded'),moved=updated.stage!==lead.stage;
 const result={leadId:lead.id,version:updated.version,evidenceId:row.id,evidenceType:row.evidenceType,stage:updated.stage,...extra,disclaimer:GATE_DISCLAIMER};
 await commit([insertRow(c.owner,'franchise_delivery',row.id,row,lead.id,c.now),leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'evidence_recorded',result,{evidenceId:row.id,evidenceType:row.evidenceType,supersedes:row.supersedes})),
  ...(moved?[eventStmt(c.owner,plainEvent(c,lead,'stage_changed',{from:lead.stage,to:updated.stage}))]:[]),...(audit?[auditStmt(c.owner,{...audit,leadId:lead.id,recordId:row.id})]:[])]);
 return {result,lead:updated};
}
const bool=(v:unknown,message:string)=>v===undefined?false:typeof v==='boolean'?v:bad(message);
const nullableBool=(v:unknown,message:string)=>v===undefined||v===null?null:typeof v==='boolean'?v:bad(message);
const HAND_KEYS=['receiptDateTimePlaceHandwritten','nameAddressPhoneHandwritten','signatureHandwritten','hqSigned','confirmationGiven'] as const;
const FRANCHISE_ERRORS_TEXT={method_not_allowed:codeMessages(['method_not_allowed'])[0].message,invalid_record:codeMessages(['invalid_record'])[0].message};
async function recordDelivery(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const i=c.input,doc=pick(DELIVERY_DOCS,i.doc,'문서를 골라 주세요.'),method=pick(DELIVERY_METHODS,i.method,'제공 방법을 골라 주세요.');
 if(!oneOf(ALLOWED_METHODS,method))throw new FranchiseError(400,FRANCHISE_ERRORS_TEXT.method_not_allowed,{reasons:codeMessages(['method_not_allowed']),disclaimer:GATE_DISCLAIMER});
 const pre=await evidencePrelude(c,lead,'delivery'),deliveredAt=timeOf(i.deliveredAt,c.now),ev=isRecord(i.evidence)?i.evidence:{},times=[deliveredAt];
 let evidence:Json;
 if(method==='hand'){const h=isRecord(ev.hand)?ev.hand:{};evidence={hand:Object.fromEntries(HAND_KEYS.map(k=>[k,bool(h[k],'증빙 항목을 확인해 주세요.')]))}}
 else if(method==='certified_mail'){const m=isRecord(ev.certifiedMail)?ev.certifiedMail:{};evidence={certifiedMail:{receiptConfirmed:bool(m.receiptConfirmed,'증빙 항목을 확인해 주세요.')}}}
 else{
  const e=isRecord(ev.electronic)?ev.electronic:{},receivedAt=blank(e.receivedAt)?null:timeOf(e.receivedAt,c.now);
  if(receivedAt)times.push(receivedAt);
  evidence={electronic:{channel:pick(ELECTRONIC_CHANNELS,e.channel,'전자 방식 채널을 골라 주세요.'),receivedAt,printable:bool(e.printable,'증빙 항목을 확인해 주세요.')}};
 }
 let versionId:string|undefined,templateId:string|undefined;
 if(doc==='disclosure'){const v=pre.versions.find(x=>x.id===i.versionId);if(!v)fail('VERSION_NOT_FOUND');if(v.status!=='active')fail('RETIRED');versionId=v.id}
 if(doc==='draft'){const t=pre.templates.find(x=>x.id===i.templateId);if(!t)fail('TEMPLATE_NOT_FOUND');if(t.status!=='active')fail('RETIRED');templateId=t.id}
 const bd=backdate(c,times),payload:Json={doc,method,deliveredAt,...(versionId?{versionId}:{}),...(templateId?{templateId}:{}),evidence};
 const row=evidenceRow(c,lead,'delivery',pre,payload,bd.approval),a=assessDelivery(deliveryOf(row),pre.ctx,c.now);
 if(!a.accepted)throw new FranchiseError(400,codeMessages(a.reasons)[0]?.message??FRANCHISE_ERRORS_TEXT.invalid_record,{reasons:codeMessages(a.reasons),disclaimer:GATE_DISCLAIMER});
 let stage=lead.stage;
 const target=doc==='disclosure'&&stageOrder(lead.stage)<4?'disclosed':doc==='draft'&&stageOrder(lead.stage)<5?'draft_provided':null;
 if(a.counted&&target&&checkTransition(leadGateOf([...pre.rows,row]),target,c.now,pre.ctx).ok)stage=target;
 return appendEvidence(c,lead,row,bd.audit,{stage},{assessment:{accepted:a.accepted,counted:a.counted,reasons:codeMessages(a.reasons)}});
}
async function recordAdvice(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const i=c.input,pre=await evidencePrelude(c,lead,'advice');
 const advisorType=pick(ADVISOR_TYPES,i.advisorType,'자문자 유형을 골라 주세요.'),registrationVerified=bool(i.registrationVerified,'등록 확인 여부를 확인해 주세요.');
 if(!isDate(i.advisedOn))bad('자문일을 확인해 주세요.');
 if(i.advisedOn>toKstDate(c.now))fail('FUTURE_TIME');
 const targetDoc=pick(['disclosure','draft'] as const,i.targetDoc,'자문 대상 문서를 골라 주세요.');
 const payload={advisorType,registrationVerified,advisedOn:i.advisedOn,targetDoc,hqPaid:nullableBool(i.hqPaid,'본부 비용 부담 여부를 확인해 주세요.'),hqReferred:nullableBool(i.hqReferred,'본부 소개 여부를 확인해 주세요.')};
 return appendEvidence(c,lead,evidenceRow(c,lead,'advice',pre,payload,null),null,{});
}
async function recordForecast(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const pre=await evidencePrelude(c,lead,'forecast',true),providedAt=timeOf(c.input.providedAt,c.now),bd=backdate(c,[providedAt]);
 return appendEvidence(c,lead,evidenceRow(c,lead,'forecast',pre,{providedAt,written:true},bd.approval),bd.audit,{});
}
// 계약 전에 예치·보험 증빙이 있는 가맹금이 이미 기록돼 게이트를 통과하면 계약과 함께 가맹금 예치 단계로 간다(증빙과 단계가 어긋나지 않게).
async function recordContract(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const pre=await evidencePrelude(c,lead,'contract');
 if(!pre.supersedes&&activeEvidence(pre.rows).some(r=>r.evidenceType==='contract'))fail('CONTRACT_EXISTS');
 const signedAt=timeOf(c.input.signedAt,c.now),bd=backdate(c,[signedAt]);
 const withContract:FranchiseLead={...leadGateOf(pre.rows,signedAt),contract:{signedAt,recordedAt:c.now,backdateApproval:bd.approval}};
 const gate=checkTransition(withContract,'contracted',c.now,pre.ctx);
 if(!gate.ok)await blocked(c,lead,gate,'contracted');
 const escrowed=(withContract.fees??[]).some(f=>(!!f.escrow||!!f.insurance)&&checkTransition({...withContract,fees:[f]},'fee_escrowed',c.now,pre.ctx).ok);
 const stage=stageOrder(lead.stage)<6?{stage:escrowed?'fee_escrowed' as const:'contracted' as const}:{};
 return appendEvidence(c,lead,evidenceRow(c,lead,'contract',pre,{signedAt},bd.approval),bd.audit,{contractedAt:signedAt,...stage},{earliestContractAt:gate.window?.at??null});
}
async function recordFee(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const i=c.input,pre=await evidencePrelude(c,lead,'fee'),category=pick(FEE_CATEGORIES,i.category,'가맹금 유형을 골라 주세요.'),times:string[]=[];
 const paidAt=blank(i.paidAt)?undefined:timeOf(i.paidAt,c.now);
 if(paidAt)times.push(paidAt);
 if(isRecord(i.escrow)&&isRecord(i.insurance))bad('예치와 보험 중 하나만 기록해 주세요.');
 let escrow:Json|undefined,insurance:Json|undefined;
 if(isRecord(i.escrow)){
  const e=i.escrow,firstDepositAt=timeOf(e.firstDepositAt,c.now);times.push(firstDepositAt);
  escrow={institutionType:pick(ESCROW_INSTITUTIONS,e.institutionType,'예치기관을 골라 주세요.'),firstDepositAt};
  // 예치 합의 시각은 키가 있어야 한다(없으면 게이트가 escrow_unproven). 합의가 따로 없으면 명시적 null.
  if(Object.hasOwn(e,'agreementAt')&&e.agreementAt!==undefined){escrow.agreementAt=e.agreementAt===null?null:timeOf(e.agreementAt,c.now);if(escrow.agreementAt)times.push(escrow.agreementAt as string)}
 }else if(i.escrow!==undefined&&i.escrow!==null)bad('예치 입력을 확인해 주세요.');
 if(isRecord(i.insurance)){
  const from=timeOf(i.insurance.coverageFrom,c.now,'보험 기간을 확인해 주세요.'),to=timeOf(i.insurance.coverageTo,c.now,'보험 기간을 확인해 주세요.');
  if(ms(from)>=ms(to))bad('보험 기간을 확인해 주세요.');
  insurance={coverageFrom:from,coverageTo:to};
 }else if(i.insurance!==undefined&&i.insurance!==null)bad('보험 입력을 확인해 주세요.');
 // 예치가 없으면(증빙 없음·보험) 수령 시각이 있어야 형식이 맞는다. 빠지면 게이트 409가 아니라 400이고 아무것도 쓰지 않는다.
 if(!paidAt&&!escrow)fail('FEE_PAID_AT');
 const bd=backdate(c,times),payload:Json={category,...(paidAt?{paidAt}:{}),...(escrow?{escrow}:{}),...(insurance?{insurance}:{})};
 const row=evidenceRow(c,lead,'fee',pre,payload,bd.approval);
 const gate=checkTransition({...leadGateOf(pre.rows),fees:[feeOf(row)]},'fee_escrowed',c.now,pre.ctx);
 if(!gate.ok)await blocked(c,lead,gate,'fee_escrowed');
 return appendEvidence(c,lead,row,bd.audit,lead.stage==='contracted'&&(escrow||insurance)?{stage:'fee_escrowed'}:{});
}
async function recordAgreement(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 const i=c.input,pre=await evidencePrelude(c,lead,'agreement'),signedAt=timeOf(i.signedAt,c.now),cl=isRecord(i.clauses)?i.clauses:bad('약정 조항을 확인해 주세요.');
 const clauses={fee:bool(cl.fee,'약정 조항을 확인해 주세요.'),construction:bool(cl.construction,'약정 조항을 확인해 주세요.'),training:bool(cl.training,'약정 조항을 확인해 주세요.')};
 const bd=backdate(c,[signedAt]),row=evidenceRow(c,lead,'agreement',pre,{signedAt,clauses},bd.approval);
 const w=contractWindowAsOf(windowInputOf(pre.ctx,leadGateOf(pre.rows)),c.now,signedAt),gate=checkAgreement(agreementOf(row),w,c.now);
 if(!gate.ok)await blocked(c,lead,gate,null,w);
 return appendEvidence(c,lead,row,bd.audit,{});
}
// 다른 리드에 잘못 적은 기록을 무효화한다(O14). 계약 기록은 무효화하지 않고 정정만 한다. 단계는 되돌리지 않고 게이트가 그 기록을 세지 않는다.
async function voidEvidence(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 if(lead.stage==='closed')fail('CLOSED');
 const rows=await evidenceRows(c.owner,lead),target=activeEvidence(rows).find(r=>r.id===c.input.supersedes&&r.evidenceType!=='contract');
 if(!target)bad('정정할 기록을 찾을 수 없습니다.');
 if(rows.length>=600)fail('LIMIT');
 const correctionReason=pick(CORRECTION_REASONS,c.input.correctionReason,'정정 사유를 골라 주세요.');
 const row:EvidenceRow={id:'fd-'+uid(),leadId:lead.id,brandId:lead.brandId,evidenceType:target.evidenceType,recordedAt:c.now,recordedBy:c.by,backdateApproval:null,supersedes:target.id,correctionReason,docSha256:null,storageLabel:null,payload:null,voided:true};
 const updated=bump(c,lead,{},'evidence_voided'),result={leadId:lead.id,version:updated.version,evidenceId:row.id,voidedId:target.id,evidenceType:target.evidenceType};
 await commit([insertRow(c.owner,'franchise_delivery',row.id,row,lead.id,c.now),leadStmt(c.owner,updated),eventStmt(c.owner,receiptEvent(c,lead,'evidence_voided',result,{evidenceId:row.id,evidenceType:target.evidenceType,supersedes:target.id,voided:true})),auditStmt(c.owner,plainAudit(c,'evidence_void',{leadId:lead.id,recordId:target.id,reasonCode:correctionReason}))]);
 return {result,lead:updated};
}

// ── 파기·삭제·정보주체 요청·찾기·내보내기 ──
// 삭제 실행은 이 리드에 연결된 처리 전(접수·처리 중) 삭제 요청을 모두 완료(삭제함)로 기록한다. subjectRequestId를 주면 그 요청(연결 리드 없음도 가능)도 함께 닫는다.
// 이미 삭제된 리드면 연락처는 그대로 두고 요청만 닫는다(요청이 접수로 남아 기한을 넘기지 않게).
const openRequest=(r:SubjectRequestRow)=>r.status==='open'||r.status==='in_progress';
async function eraseLead(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 let request:SubjectRequestRow|null=null;
 if(!blank(c.input.subjectRequestId)){
  request=await optionalRecord<SubjectRequestRow>(c.owner,'franchise_subject_request',String(c.input.subjectRequestId));
  if(!request||request.brandId!==c.brandId||(request.leadId!==null&&request.leadId!==lead.id))throw new ApiError(404,'항목을 찾을 수 없습니다.');
 }
 const linked=(await listRecords<SubjectRequestRow>(c.owner,'franchise_subject_request',c.brandId)).filter(r=>r.brandId===c.brandId&&r.leadId===lead.id&&r.type==='erasure'&&openRequest(r)&&r.id!==request?.id);
 const closing=[...(request&&openRequest(request)?[request]:[]),...linked].sort(byId);
 const requestIds=closing.map(r=>r.id),closeStmts=closing.map(r=>recordStatement(c.owner,'franchise_subject_request',r.id,{...r,...(r.leadId===null?{leadId:lead.id}:{}),status:'done',resolution:'erased',resolvedAt:c.now,version:r.version+1},c.brandId));
 const requestAudit={...(request?{reasonCode:'subject_request',recordId:request.id}:{}),...(requestIds.length?{requestIds}:{})};
 if(lead.contactState==='erased'){
  const result={leadId:lead.id,version:lead.version,alreadyErased:true,closedRequestIds:requestIds};
  await commit([auditStmt(c.owner,receiptAudit(c,'erase',result,{leadId:lead.id,alreadyErased:true,...requestAudit},lead.id)),...closeStmts]);
  return {result,lead};
 }
 const updated:LeadRecord={...lead,contact:null,memo:null,contactState:'erased',erasedAt:c.now,version:lead.version+1,updatedAt:c.now};
 const result={leadId:lead.id,version:updated.version,alreadyErased:false,...(request?{subjectRequestId:request.id}:{}),closedRequestIds:requestIds};
 await commit([leadStmt(c.owner,updated),deleteKeys(c.owner,lead.id),eventStmt(c.owner,plainEvent(c,lead,'erased')),auditStmt(c.owner,receiptAudit(c,'erase',result,{leadId:lead.id,...requestAudit},lead.id)),...closeStmts]);
 return {result,lead:updated};
}
async function addSubjectRequest(c:Ctx):Promise<Outcome>{
 const i=c.input;let leadId:string|null=null;
 if(!blank(i.leadId)){
  const lead=typeof i.leadId==='string'?await optionalRecord<LeadRecord>(c.owner,'franchise_lead',i.leadId):null;
  if(!lead||lead.brandId!==c.brandId)fail('LEAD_NOT_FOUND');
  if(!canSeeLead(c.who,lead))fail('NOT_VISIBLE');
  leadId=lead.id;
 }
 const type=pick(SUBJECT_REQUEST_TYPES,i.type,'요청 유형을 골라 주세요.'),channel=pick(SUBJECT_CHANNELS,i.channel,'접수 경로를 골라 주세요.'),receivedAt=timeOf(i.receivedAt,c.now,'접수 시각을 확인해 주세요.');
 if(ms(receivedAt)>ms(c.now)||ms(receivedAt)<ms(c.now)-30*86400000)bad('접수 시각을 확인해 주세요.');
 const row:SubjectRequestRow={id:'sr-'+uid(),brandId:c.brandId,leadId,type,channel,receivedAt,dueAt:subjectDueAt(receivedAt),status:'open',resolution:null,resolvedAt:null,version:1,createdAt:c.now,createdBy:c.by};
 const result={id:row.id,leadId,type,dueAt:row.dueAt,dueLabel:DUE_LABEL,status:row.status,version:1};
 await commit([recordStatement(c.owner,'franchise_subject_request',row.id,row,c.brandId),auditStmt(c.owner,receiptAudit(c,'subject_request',result,{recordId:row.id,...(leadId?{leadId}:{})},leadId))]);
 return {result};
}
// 연결 리드가 없는 요청은 나중에 리드를 연결할 수 있다(한 번만, 같은 브랜드). 연결한 뒤에는 바꾸지 않는다.
async function updateSubjectRequest(c:Ctx):Promise<Outcome>{
 const id=str(c.input.id,'요청',100,true),row=await optionalRecord<SubjectRequestRow>(c.owner,'franchise_subject_request',id);
 if(!row||row.brandId!==c.brandId)throw new ApiError(404,'항목을 찾을 수 없습니다.');
 if(c.input.version!==row.version)fail('STALE');
 const status=pick(SUBJECT_REQUEST_STATUS,c.input.status,'처리 상태를 골라 주세요.'),resolution=blank(c.input.resolution)?null:pick(SUBJECT_RESOLUTIONS,c.input.resolution,'처리 결과를 골라 주세요.');
 let leadId=row.leadId;
 if(!blank(c.input.leadId)&&c.input.leadId!==row.leadId){
  if(row.leadId!==null)bad('연결 리드는 바꿀 수 없습니다.');
  const lead=typeof c.input.leadId==='string'&&c.input.leadId.length<=100?await optionalRecord<LeadRecord>(c.owner,'franchise_lead',c.input.leadId):null;
  if(!lead||lead.brandId!==c.brandId)fail('LEAD_NOT_FOUND');
  leadId=lead.id;
 }
 const resolved=status==='done'||status==='rejected',next:SubjectRequestRow={...row,leadId,status,resolution,resolvedAt:resolved?c.now:null,version:row.version+1};
 const result={id,status,resolution,version:next.version,leadId};
 await commit([recordStatement(c.owner,'franchise_subject_request',id,next,c.brandId),auditStmt(c.owner,receiptAudit(c,'subject_request_update',result,{recordId:id},id))]);
 return {result};
}
async function purgeAction(c:Ctx):Promise<Outcome>{
 const r=await purgeFranchise(c.owner,{now:c.now,trigger:'manual',brandId:c.brandId,by:c.by,receipt:{id:'au-'+c.rid,...receipt(c,{})}});
 return {result:{...r}};
}
// 연락처로 리드 찾기: 값·HMAC은 감사 행에 남기지 않는다(찾기도 개인정보 조회라 매번 감사). 직원에게는 보이는 리드만 id를 준다. 만료 연락처의 키는 무시한다.
async function findContact(c:Ctx):Promise<Outcome>{
 const phone=readPhone(c.input.phone),email=readEmail(c.input.email);
 if(!phone&&!email)bad('전화번호나 이메일을 입력해 주세요.');
 const keys:{id:string}[]=[];
 if(phone)keys.push({id:await leadKeyHmac(c.owner,c.brandId,'phone',phone)});
 if(email)keys.push({id:await leadKeyHmac(c.owner,c.brandId,'email',email)});
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='franchise_lead_key' AND id IN (${keys.map(()=>'?').join(',')})`).bind(c.owner,...keys.map(k=>`${c.owner}:franchise_lead_key:${k.id}`)).all<{data:string}>();
 const ids=[...new Set(rows.results.map(r=>(JSON.parse(r.data) as KeyRow).leadId))],matches:Json[]=[],matched:string[]=[];
 for(const id of ids){
  const lead=await optionalRecord<LeadRecord>(c.owner,'franchise_lead',id);
  if(!lead||lead.brandId!==c.brandId||lead.contactState!=='present'||isContactExpired(lead,c.now))continue;
  matched.push(lead.id);
  matches.push(canSeeLead(c.who,lead)?{systemCode:lead.systemCode,visible:true,leadId:lead.id}:{systemCode:lead.systemCode,visible:false});
 }
 await commit([auditStmt(c.owner,plainAudit(c,'find',{count:matched.length,matchedLeadIds:matched}))]);
 return {result:{count:matched.length},extra:{matches}};
}
// leadSetSha256: 내보낸 리드 id·버전·연락처 포함 여부의 SHA-256. 감사 행에 남겨 재생이 같은 내용일 때만 파일을 다시 만든다.
async function exportCsv(owner:string,brandId:string,now:string,contactMode:'masked'|'full'){
 const leads=(await listRecords<LeadRecord>(owner,'franchise_lead',brandId)).filter(l=>l.brandId===brandId);
 if(leads.length>5000)fail('LIMIT');
 leads.sort((a,b)=>ms(a.createdAt)-ms(b.createdAt)||byId(a,b));
 const rows:unknown[][]=[],set:string[]=[];
 for(const l of leads){
  const present=l.contactState==='present'&&!!l.contact&&!isContactExpired(l,now),c=l.contact;
  set.push(`${l.id}:${l.version}:${present?1:0}`);
  let name='',phone='',email='';
  if(present&&c){
   const n=await openField(c.name),p=c.phone?await openField(c.phone):null,e=c.email?await openField(c.email):null;
   name=contactMode==='full'?n:maskName(n);phone=p?contactMode==='full'?formatPhone(p):maskPhone(p):'';email=e?contactMode==='full'?e:maskEmail(e):'';
  }
  rows.push([l.systemCode,STAGE_LABELS[l.stage],l.assigneeId??'',SOURCE_LABELS[l.task.sourceChannel],l.task.region,BUDGET_LABELS[l.task.budgetBand],TIMING_LABELS[l.task.timingBand],BASIS_LABELS[l.basis.type],MARKETING_STATUS_LABELS[l.marketing.status],l.createdAt,l.lastActivityAt,name,phone,email]);
 }
 return {filename:`franchise-leads-${brandId.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80)}-${toKstDate(now).replace(/-/g,'')}.csv`,csv:csvFile(EXPORT_COLUMNS,rows),rowCount:rows.length,leadSetSha256:await sha256Hex(set.join('\n'))};
}
async function exportLeads(c:Ctx):Promise<Outcome>{
 const purpose=pick(EXPORT_PURPOSES,c.input.purpose,'내보내기 목적을 골라 주세요.'),contactMode=pick(['masked','full'] as const,c.input.contactMode,'연락처 포함 방식을 골라 주세요.');
 const {leadSetSha256,...file}=await exportCsv(c.owner,c.brandId,c.now,contactMode),result={filename:file.filename,rowCount:file.rowCount,contactMode,purpose};
 await commit([auditStmt(c.owner,receiptAudit(c,'export',result,{purpose,contactMode,count:file.rowCount,leadSetSha256}))]);
 return {result,extra:{...file,contactMode,disclaimer:GATE_DISCLAIMER}};
}

// ── POST 파이프라인 ──
async function loadLead(c:Ctx){
 const id=c.input.leadId;
 const lead=typeof id==='string'&&id&&id.length<=100?await optionalRecord<LeadRecord>(c.owner,'franchise_lead',id):null;
 if(!lead||lead.brandId!==c.brandId)fail('LEAD_NOT_FOUND');
 if(!canSeeLead(c.who,lead))fail('NOT_VISIBLE');
 return lead;
}
function leadRoleCheck(c:Ctx,lead:LeadRecord){
 const a=c.action,member=!isAdminRole(c.who.role);
 if(!member)return;
 if((a==='update_contact'||a==='update_task'||a==='record_source_notice'||a==='reveal_contact')&&!(a==='reveal_contact'?canReveal(c.who,lead):canEditLead(c.who,lead)))fail('NOT_ASSIGNED');
 if(a==='move_stage'){
  if(!isOwnLead(c.who,lead))fail('NOT_ASSIGNED');
  if(c.input.to==='closed'&&!canClose(c.who,lead))fail('ADMIN_ONLY');
 }
}
// 연락처가 파기·삭제된 리드에 허용하는 작업: 종결, 증빙·무효화, 삭제(멱등), 광고성 정보 철회(보호 방향). 정보주체 요청은 리드 작업이 아니다.
const allowedWithoutContact=(action:string,input:Json)=>action==='erase_lead'||has(EVIDENCE_ACTIONS,action)||(action==='move_stage'&&input.to==='closed')||(action==='set_marketing_consent'&&input.status==='withdrawn');
function offAllowed(action:string,input:Json,who:Actor){
 if(has(OFF_EXEMPT,action)||(action==='set_marketing_consent'&&input.status==='withdrawn'))return true;
 return isAdminRole(who.role)&&(action==='update_contact'||action==='record_source_notice'||(action==='move_stage'&&input.to==='closed'));
}
async function receiptIdOf(userId:string,action:string,requestId:string){return (await sha256Hex(userId+'\n'+action+'\n'+requestId)).slice(0,40)}
// 영수증 재생: 같은 사람·작업·요청 번호면 저장한 상태·결과를 그대로 돌려주고 새 행을 쓰지 않는다. 다른 대상이면 409. 열람·내보내기 값은 5분 안에만, 지금 권한이 있을 때만,
// 감사 행이 적은 것과 같을 때만(열람: 리드 버전, 내보내기: 리드 묶음 해시·건수) 다시 만든다. 그 사이 연락처·리드가 바뀌었으면 REPLAY_EXPIRED다(감사 기록보다 많이 주지 않는다).
async function replay(who:Actor,action:Action,input:Json,rid:string,now:string):Promise<Response|null>{
 const owner=who.owner,row=await database().prepare('SELECT kind,data FROM records WHERE owner=? AND id IN (?,?) LIMIT 1').bind(owner,`${owner}:franchise_lead_event:ev-${rid}`,`${owner}:franchise_audit:au-${rid}`).first<{kind:string;data:string}>();
 if(!row)return null;
 const r=JSON.parse(row.data) as (EventRow|AuditRow)&{leadId?:string},target=targetOf(action,input),brandId=typeof input.brandId==='string'?input.brandId.trim():'';
 if(r.requestAction!==action||r.brandId!==brandId||(target!==undefined&&(r.target??null)!==target))fail('REQUEST_REUSED');
 const status=r.status??200,result=(r.result??{}) as Json;
 if(status!==200)return json({ok:false,...result,result,replayed:true},status);
 const fresh=Date.parse(now)-Date.parse(r.at)<=300000,admin=isAdminRole(who.role);
 const lead=r.leadId&&keyPresent()?await optionalRecord<LeadRecord>(owner,'franchise_lead',r.leadId):null;
 const usable=!!lead&&lead.brandId===brandId&&lead.contactState==='present'&&!isContactExpired(lead,now);
 let extra:Json={};
 if(action==='reveal_contact'){
  if(!fresh||!usable||!lead||!canReveal(who,lead)||!canSeeLead(who,lead)||(r as AuditRow).leadVersion!==lead.version)fail('REPLAY_EXPIRED');
  extra={values:await contactValues(lead,(r as AuditRow).fields??[])};
 }
 if(action==='export_leads'){
  if(!fresh||!admin||!keyPresent())fail('REPLAY_EXPIRED');
  const {leadSetSha256,...file}=await exportCsv(owner,brandId,now,(r as AuditRow).contactMode==='full'?'full':'masked');
  if(leadSetSha256!==(r as AuditRow).leadSetSha256||file.rowCount!==(r as AuditRow).count)fail('REPLAY_EXPIRED');
  extra={...file,contactMode:(r as AuditRow).contactMode,disclaimer:GATE_DISCLAIMER};
 }
 // 모집 자료 내보내기(R15a-2a): 5분 안·지금 대표·관리자일 때만, 감사 행의 해시와 같은 원문을 판정을 다시 돌려 만든다(exports는 늘리지 않는다).
 if(action==='asset_export'){if(!fresh||!admin)fail('REPLAY_EXPIRED');extra=await replayAssetExport(owner,brandId,who,r as AuditRow,now)}
 const view=lead&&action!=='reveal_contact'&&lead.brandId===brandId&&canSeeLead(who,lead)?await leadDetail(who,owner,lead,now,await isEnabled(owner,'r_franchise')):undefined;
 return json({ok:true,result,replayed:true,...extra,...(view?{lead:view}:{})});
}
export async function franchisePost(req:Request):Promise<Response>{
 const who=await actor(req);secureMutation(req);const input=await body(req) as Json;
 const action=input.action;
 if(typeof action!=='string'||!has(FRANCHISE_ACTIONS,action))fail('UNKNOWN_ACTION');
 const requestId=input.requestId;
 if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(requestId))fail('REQUEST_ID');
 const owner=who.owner,lockKey=owner+':franchise',token=await acquireLock(lockKey);
 try{
  await executionRate(owner,'franchise');
  const now=stamp(),rid=await receiptIdOf(who.id,action,requestId);
  const replayed=await replay(who,action as Action,input,rid,now);
  if(replayed)return replayed;
  const enabled=await isEnabled(owner,'r_franchise'),withdrawal=action==='set_marketing_consent'&&input.status==='withdrawn';
  if(!enabled&&!offAllowed(action,input,who))fail('OFF');
  const brandId=str(input.brandId,'브랜드',100,true);
  await readRecord(owner,'brand',brandId);
  const admin=isAdminRole(who.role);
  if(!admin){
   if(has(ADMIN_ACTIONS,action)||(action==='move_stage'&&input.to==='opened')||(action==='set_marketing_consent'&&!withdrawal))fail('ADMIN_ONLY');
   if(action==='create_lead'&&((typeof input.assigneeId==='string'&&input.assigneeId!==who.id)||(isRecord(input.marketing)&&input.marketing.status==='given')))fail('ADMIN_ONLY');
  }
  if(!has(KEY_EXEMPT,action)&&!withdrawal)requireContactKey();
  const c:Ctx={who,owner,action:action as Action,input,rid,now,brandId,enabled,by:snap(who)};
  let out:Outcome;
  if(has(ON_LEAD,action)){
   let lead=await loadLead(c);
   leadRoleCheck(c,lead);
   if(!has(NO_VERSION,action)&&!withdrawal&&input.version!==lead.version)fail('STALE');
   if(isContactExpired(lead,now))lead=await purgeInline(c,lead);
   if(lead.contactState!=='present'&&!allowedWithoutContact(action,input))fail(action==='reveal_contact'||action==='update_contact'?'CONTACT_GONE':'LEAD_ERASED');
   out=await onLead(c,lead);
  }else out=await other(c);
  const view=out.lead&&out.leadView!==false&&keyPresent()&&canSeeLead(who,out.lead)?await leadDetail(who,owner,out.lead,now,enabled):undefined;
  return json({ok:true,result:out.result,...out.extra,...(view?{lead:view}:{})});
 }finally{await releaseLock(lockKey,token)}
}
function onLead(c:Ctx,lead:LeadRecord):Promise<Outcome>{
 switch(c.action){
  case 'update_contact':return updateContact(c,lead);
  case 'update_task':return updateTask(c,lead);
  case 'move_stage':return moveStage(c,lead);
  case 'reopen_lead':return reopenLead(c,lead);
  case 'claim_lead':return claimLead(c,lead);
  case 'assign_lead':return assignLead(c,lead);
  case 'record_source_notice':return recordSourceNotice(c,lead);
  case 'set_marketing_consent':return setMarketing(c,lead);
  case 'reveal_contact':return revealContact(c,lead);
  case 'erase_lead':return eraseLead(c,lead);
  case 'record_delivery':return recordDelivery(c,lead);
  case 'record_advice':return recordAdvice(c,lead);
  case 'record_forecast':return recordForecast(c,lead);
  case 'record_contract':return recordContract(c,lead);
  case 'record_fee':return recordFee(c,lead);
  case 'record_agreement':return recordAgreement(c,lead);
  case 'void_evidence':return voidEvidence(c,lead);
  default:return fail('UNKNOWN_ACTION');
 }
}
function other(c:Ctx):Promise<Outcome>{
 // 모집 자료·행사(R15a-2a): commit·영수증을 port로 넘긴다(새 모듈은 이 모듈을 import하지 않는다).
 if(has(ASSET_ACTIONS,c.action)||has(EVENT_ACTIONS,c.action))return runAssetAction({owner:c.owner,brandId:c.brandId,now:c.now,enabled:c.enabled,actor:{id:c.who.id,role:c.who.role},input:c.input,action:c.action as AssetAction,
  port:{commit:(s,stale)=>commit(s,stale),receipt:(a,r,x,t,s)=>auditStmt(c.owner,{...receiptAudit(c,a,r,x,t),...(s?{status:s}:{})})}});
 switch(c.action){
  case 'save_profile':return saveProfile(c);
  case 'register_disclosure_version':return registerVersion(c);
  case 'retire_disclosure_version':return retire(c,'version');
  case 'register_contract_template':return registerTemplate(c);
  case 'retire_contract_template':return retire(c,'template');
  case 'amend_disclosure_version':return amendRegistry(c,'version');
  case 'amend_contract_template':return amendRegistry(c,'template');
  case 'register_privacy_notice':return registerNotice(c);
  case 'retire_privacy_notice':return retire(c,'notice');
  case 'create_lead':return createLead(c);
  case 'find_contact':return findContact(c);
  case 'export_leads':return exportLeads(c);
  case 'purge':return purgeAction(c);
  case 'add_subject_request':return addSubjectRequest(c);
  case 'update_subject_request':return updateSubjectRequest(c);
  default:return fail('UNKNOWN_ACTION');
 }
}

// ── GET 보기 ──
export const FRANCHISE_VIEWS=['status','intake','board','lead','settings','requests','audit','assets','asset','events'] as const;
async function statusView(who:Actor){
 const any=await database().prepare("SELECT 1 FROM records WHERE owner=? AND kind IN ('franchise_lead','franchise_subject_request') LIMIT 1").bind(who.owner).first();
 return {enabled:await isEnabled(who.owner,'r_franchise'),role:who.role,hasRecords:!!any,contactKey:keyPresent()?'ready':'missing',disclaimer:GATE_DISCLAIMER};
}
async function intakeView(who:Actor,brandId:string){
 const [notices,profile]=await Promise.all([noticesOf(who.owner,brandId),profileOf(who.owner,brandId)]);
 return {enabled:await isEnabled(who.owner,'r_franchise'),notices:notices.filter(n=>n.status==='active').map(n=>({id:n.id,versionLabel:n.versionLabel,sha256:n.sha256,createdAt:n.createdAt})),profileBranch:profile?.branch??null,
  ...(isAdminRole(who.role)?{storageLabels:profile?.storageLabels??[]}:{}),labels:FRANCHISE_LABELS,memoHint:MEMO_HINT,contactNote:CONTACT_NOTE,disclaimer:GATE_DISCLAIMER};
}
async function assigneesOf(who:Actor){
 if(!isAdminRole(who.role)||authMode()!=='email')return [{id:who.id,label:'나'}];
 const rows=await database().prepare("SELECT id,email FROM auth_users WHERE workspace_owner=? AND status='active' ORDER BY created_at,id").bind(who.owner).all<{id:string;email:string}>();
 return rows.results.map(r=>({id:r.id,label:r.id===who.id?'나':r.email}));
}
async function boardView(who:Actor,brandId:string,params:URLSearchParams){
 const owner=who.owner,admin=isAdminRole(who.role);
 const stage=params.get('stage')||'',assignee=params.get('assignee')||'',source=params.get('source')||'',q=(params.get('q')||'').trim(),sort=params.get('sort')||'activity',todo=params.get('todo')||'';
 if((stage&&!oneOf(LEAD_STAGES,stage))||(source&&!oneOf(SOURCE_CHANNELS,source))||(todo&&!oneOf(BOARD_TODOS,todo))||!['activity','eligibility'].includes(sort)||q.length>40||assignee.length>200)bad('필터를 확인해 주세요.');
 // 검색어는 리드 코드 앞부분이나 지역 이름만 받는다. 전화·이메일·숫자가 든 검색어는 주소에 실리므로 400(값은 되돌려주지 않는다).
 if(q&&(!isBoardQuery(q)||scanText(q).length))fail('SEARCH_INPUT');
 // 대표·관리자가 보드를 열면 만료 연락처를 먼저 파기한다(잠금이 잡혀 있으면 건너뛴다). 스위치·키와 관계없이 돈다.
 if(admin){
  let token='';try{token=await acquireLock(owner+':franchise')}catch{token=''}
  if(token)try{await purgeFranchise(owner,{now:stamp(),trigger:'board_open',brandId,by:snap(who)})}finally{await releaseLock(owner+':franchise',token)}
 }
 requireContactKey();
 const now=stamp(),[enabled,profile,all,requests]=await Promise.all([isEnabled(owner,'r_franchise'),profileOf(owner,brandId),listRecords<LeadRecord>(owner,'franchise_lead',brandId),listRecords<SubjectRequestRow>(owner,'franchise_subject_request',brandId)]);
 const visible=all.filter(l=>l.brandId===brandId&&canSeeLead(who,l)),criteria=profile?.eligibility??null;
 const byStage=Object.fromEntries(LEAD_STAGES.map(s=>[s,visible.filter(l=>l.stage===s).length]));
 const soon=(t:string|null,days:number)=>t!==null&&Date.parse(t)>Date.parse(now)&&Date.parse(t)<=Date.parse(now)+days*86400000;
 // 할 일 칩과 같은 판정으로 보드를 거른다(todo 필터). 파기 대기는 대표·관리자만.
 const TODO:Record<string,(l:LeadRecord)=>boolean>={
  source_notice:l=>l.contactState==='present'&&!isContactExpired(l,now)&&l.basis.type==='referral'&&!l.basis.sourceNoticedAt,
  expiring:l=>soon(retentionUntil(l),14),
  marketing_recheck:l=>marketingRecheckDue(l,now),
  purge_pending:l=>admin&&isContactExpired(l,now),
 };
 const todos={
  sourceNoticePending:visible.filter(TODO.source_notice).length,
  subjectRequestsDueSoon:requests.filter(r=>r.brandId===brandId&&(admin||r.createdBy.id===who.id)&&(r.status==='open'||r.status==='in_progress')&&Date.parse(r.dueAt)<=Date.parse(now)+3*86400000).length,
  contactsExpiringSoon:visible.filter(TODO.expiring).length,
  marketingRecheck:visible.filter(TODO.marketing_recheck).length,
  ...(admin?{purgePending:visible.filter(TODO.purge_pending).length}:{}),
 };
 const needle=q.normalize('NFKC');
 const filtered=visible.filter(l=>(!stage||l.stage===stage)&&(!source||l.task.sourceChannel===source)&&(!todo||TODO[todo](l))&&(!assignee||(assignee==='me'?l.assigneeId===who.id:assignee==='unassigned'?l.assigneeId===null:l.assigneeId===assignee))&&(!needle||l.systemCode.startsWith(needle.toUpperCase())||(!!l.task.region&&l.task.region.includes(needle))));
 const score=(l:LeadRecord)=>eligibilityScore(l,criteria)?.met??0;
 filtered.sort((a,b)=>(sort==='eligibility'?score(b)-score(a):0)||Date.parse(b.lastActivityAt)-Date.parse(a.lastActivityAt)||byId(a,b));
 const leads:LeadSummary[]=[];
 for(const l of filtered.slice(0,500))leads.push(await leadSummary(who,l,now,criteria,false));
 return {enabled,branch:profile?.branch??null,leads,total:filtered.length,counts:{byStage},todos,recheckLabel:RECHECK_LABEL,assignees:await assigneesOf(who),disclaimer:GATE_DISCLAIMER,contactNote:CONTACT_NOTE};
}
async function leadGetView(who:Actor,brandId:string,params:URLSearchParams){
 requireContactKey();
 const id=params.get('leadId')||'',lead=id&&id.length<=100?await optionalRecord<LeadRecord>(who.owner,'franchise_lead',id):null;
 if(!lead||lead.brandId!==brandId)fail('LEAD_NOT_FOUND');
 if(!canSeeLead(who,lead))fail('NOT_VISIBLE');
 return leadDetail(who,who.owner,lead,stamp(),await isEnabled(who.owner,'r_franchise'));
}
async function settingsView(who:Actor,brandId:string){
 if(!isAdminRole(who.role))fail('ADMIN_ONLY');
 const [profile,versions,templates,notices]=await Promise.all([profileOf(who.owner,brandId),versionsOf(who.owner,brandId),templatesOf(who.owner,brandId),noticesOf(who.owner,brandId)]);
 const newest=<T extends {createdAt:string;id:string}>(a:T,b:T)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||byId(a,b);
 return {profile,versions:versions.sort(newest),templates:templates.sort(newest).map(t=>({...t,complete:t.checkedItems.length===CONTRACT_ITEM_COUNT})),notices:notices.sort(newest),forecastDuty:forecastDuty(profile?.forecastInputs??null),disclaimer:GATE_DISCLAIMER};
}
async function requestsView(who:Actor,brandId:string){
 const now=stamp(),admin=isAdminRole(who.role),[rows,leads]=await Promise.all([listRecords<SubjectRequestRow>(who.owner,'franchise_subject_request',brandId),listRecords<LeadRecord>(who.owner,'franchise_lead',brandId)]);
 const byLead=new Map(leads.filter(l=>l.brandId===brandId).map(l=>[l.id,l]));
 return {requests:rows.filter(r=>r.brandId===brandId&&(admin||r.createdBy.id===who.id)).sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt)||byId(a,b))
  .map(r=>{const l=r.leadId?byLead.get(r.leadId):undefined;return {...r,leadCode:l?.systemCode??null,leadContactState:l?stateOf(l,now):null,dueLabel:DUE_LABEL,overdue:(r.status==='open'||r.status==='in_progress')&&Date.parse(r.dueAt)<Date.parse(now)}}),dueLabel:DUE_LABEL,disclaimer:GATE_DISCLAIMER};
}
async function auditView(who:Actor,brandId:string){
 if(!isAdminRole(who.role))fail('ADMIN_ONLY');
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='franchise_audit' AND parent_id=?").bind(who.owner,brandId).all<{data:string}>();
 return {audit:rows.results.map(r=>JSON.parse(r.data) as AuditRow).filter(a=>a.brandId===brandId).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||(a.id<b.id?1:-1)).slice(0,200),disclaimer:GATE_DISCLAIMER};
}
export async function franchiseGet(req:Request):Promise<Response>{
 const who=await actor(req),params=new URL(req.url).searchParams,view=params.get('view')||'';
 if(!oneOf(FRANCHISE_VIEWS,view))fail('UNKNOWN_VIEW');
 if(view==='status')return json(await statusView(who));
 const brandId=str(params.get('brandId')??'','브랜드',100,true);
 await readRecord(who.owner,'brand',brandId);
 if(view==='intake')return json(await intakeView(who,brandId));
 if(view==='board')return json(await boardView(who,brandId,params));
 if(view==='lead')return json(await leadGetView(who,brandId,params));
 if(view==='settings')return json(await settingsView(who,brandId));
 if(view==='requests')return json(await requestsView(who,brandId));
 // 모집 자료·행사 보기(R15a-2a): 모든 역할, 연락처 키 불필요.
 if(view==='assets'||view==='asset'||view==='events')return json(await assetView(who,brandId,view,params));
 return json(await auditView(who,brandId));
}
