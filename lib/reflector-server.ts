// B3-2 Reflector 서버(스위치 b3_reflector 기본 꺼짐, 이 파일에서만 읽고 읽기 실패는 꺼짐). 흐름과 형식은 docs/PLAYBOOK.ko.md 'B3-2 Reflector', 데이터 처리는 docs/DATA-PROCESSING.ko.md DP-1~DP-9.
// 운영자(대표·관리자)만 쓴다. 미리보기(reflector_preview)는 보낼 본문과 DP-3 탐지 결과만 돌려주고 보내지 않는다. 실행(reflector_run)은 미리보기 해시가 같고 탐지가 0건일 때만
// Reflector 전용 HERMES 연결(대표가 따로 저장, 운영 연결과 다른 호스트)로 보낸다. 대표의 격리 확인 기록(세션 메모리·스킬 축적 꺼짐, 도구 없음)이 없으면 409다. OpenAI 직접 경로는 없다(DP-7).
// 결과 확인(reflector_check)은 응답에 도구 흔적이 있으면 결과를 버리고, 후보를 playbook_create와 같은 검사로 걸러 초안(draft)으로만 저장한다(승인은 기존 사람 승인 흐름).
// DP-4: 본문·탐지값을 콘솔·오류 문구·이벤트에 남기지 않는다. 오류와 차단 응답에는 필드·종류·건수만 싣는다. 저장하는 제출 원문은 전송한 본문 그대로다.
import {ApiError,str,stamp,uid,database,readRecord,listRecords,recordStatement,encrypt,decrypt,configuration,connection,type Connection} from './server';
import {hermesEndpoint,hermesRequest,verifyHermes} from './hermes';
import {isEnabled} from './feature-flags';
import {citedDecisions,auditStatement,signalDecisions,type PlaybookActor} from './learning-server';
import {correctionClusters,playbookExpiry,ruleTitle} from './playbook-curator';
import {PLAYBOOK_CLUSTER_MIN,ANY_CHANNEL,type LearningRule} from './learning';
import {aiBrand} from './ai-context';
import {preferencePair} from './review-decisions-server';
import type {ReviewDecision} from './review-decisions';
import {reserveTokenBudget,releaseTokenReservation,markTokenReservationRun,settleTokenReservation,TokenBudgetExceeded} from './token-budget';
import {recordProviderUsage} from './usage-ledger';
import {roles,type Brand} from './agency';
import {reflectorInput,reflectorBody,bodyHash,inputFindings,toolTrace,parseCandidates,checkCandidates,REFLECTOR_RETENTION_DAYS,type CorrectionSource,type ReflectorInput,type RejectReason} from './reflector';
import type {PiiFieldFinding} from './pii-scan';

type Who={id:string;role:'owner'|'admin'|'member'};
// 차단(409) 사유 코드. 화면과 테스트가 이 코드로 판정한다. detail에는 필드·종류·건수 같은 값 없는 정보만 둔다.
export type BlockedCode='switch_off'|'not_eligible'|'no_connection'|'connection_not_ready'|'isolation_unconfirmed'|'same_host'|'preview_mismatch'|'pii_detected'|'in_progress'|'budget_exceeded'|'connection_changed';
export class ReflectorBlocked extends ApiError{constructor(public blocked:BlockedCode,message:string,public detail?:Record<string,unknown>){super(409,message)}}
export const ISOLATION_STATEMENT='이 Reflector 프로필은 세션 메모리·스킬 축적이 꺼져 있고 도구(웹·브라우저·MCP)가 없습니다.';
// 진행 중 상태. 브랜드×역할당 1건만 둔다. submitting은 저장 뒤 전송 전·전송 실패(접수 불확실)라 같은 키로 다시 보낸다.
const ACTIVE=new Set(['submitting','queued','in_progress']);
type Conn={endpoint:string;key:string};
type StoredConnection={secret:string;host:string;status:'ready'|'blocked';statusReason:string|null;model:string|null;checkedAt:string;updatedAt:string;updatedBy:Who};
type Isolation={host:string;connectionUpdatedAt:string;statement:string;confirmedBy:Who;confirmedAt:string};
// 제출·응답 원문 보존: expiresAt(만든 날부터 90일, 법률 검토 뒤 확정)이 지나면 읽기·쓰기 때 지운다. labels(라벨 → 판정 id)는 모델에 보내지 않는다.
export type ReflectorRun={id:string;brandId:string;role:string;status:'submitting'|'queued'|'in_progress'|'completed'|'discarded'|'failed'|'blocked';previewHash:string;campaignIds:string[];decisionIds:string[];labels:Record<string,string>;
 submission:{key:string;body:string};host:string;providerRunId:string|null;response?:{status:string;model:string|null;output:string|null;totalTokens:number|null};toolTrace?:boolean;
 ruleIds:string[];rejected:{index:number;reason:RejectReason}[];failure?:string;createdBy:Who;createdAt:string;updatedAt:string;completedAt?:string;expiresAt:string};

export async function reflectorOn(owner:string){
 return isEnabled(owner,'b3_reflector').catch(()=>{console.error('b3_reflector_flag_unreadable');return false});
}
async function assertOn(owner:string){if(!await reflectorOn(owner))throw new ReflectorBlocked('switch_off','Reflector 스위치(b3_reflector)가 꺼져 있습니다. 소유자가 켠 뒤 사용하세요.')}
const operator=(by:Who)=>{if(by.role!=='owner'&&by.role!=='admin')throw new ApiError(403,'대표·관리자만 Reflector를 쓸 수 있습니다.')};
const ownerOnly=(by:Who)=>{if(by.role!=='owner')throw new ApiError(403,'대표만 Reflector 연결과 격리 확인을 저장할 수 있습니다.')};
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const purgeExpired=(owner:string)=>database().prepare("DELETE FROM records WHERE owner=? AND kind='reflector_run' AND json_extract(data,'$.expiresAt')<=?").bind(owner,stamp()).run();

// ── Reflector 전용 연결(대표). 운영 HERMES·평가 연결과 따로 저장하고 키는 기존 연결과 같은 방식(AES-GCM, lib/server.ts encrypt)으로 암호화한다.
const hostKey=(host:string)=>host.toLowerCase().replace(/\.+$/,'');
async function operationalHost(owner:string){
 if(!(await configuration(owner))?.secret)return null;
 const cfg=await connection(owner);
 return cfg.provider==='hermes'&&cfg.endpoint?hostKey(new URL(hermesEndpoint(cfg.endpoint)).hostname):null;
}
const publicConnection=(s:StoredConnection|null,iso:Isolation|null)=>({configured:!!s,...(s?{host:s.host,status:s.status,statusReason:s.statusReason,model:s.model,checkedAt:s.checkedAt,updatedAt:s.updatedAt}:{}),
 isolation:iso&&s&&iso.connectionUpdatedAt===s.updatedAt?{confirmed:true,statement:iso.statement,confirmedAt:iso.confirmedAt}:{confirmed:false,statement:ISOLATION_STATEMENT}});
async function saveConnection(owner:string,b:Record<string,unknown>,by:Who){
 ownerOnly(by);
 const endpoint=hermesEndpoint(str(b.endpoint,'Reflector HERMES 주소',500,true)),key=str(b.key,'Reflector 연결 키',2000,true),host=new URL(endpoint).hostname;
 if(hostKey(host)===await operationalHost(owner))throw new ApiError(400,'운영 HERMES 연결과 같은 주소는 Reflector에 쓸 수 없습니다. 세션 메모리·스킬 축적·도구를 끈 Reflector 전용 프로필 주소를 등록하세요.');
 let check:{status:'ready'|'blocked';statusReason:string|null;model:string|null};
 try{check={status:'ready',statusReason:null,model:await verifyHermes({provider:'hermes',endpoint,key,model:'reflector'})}}
 catch(e){check={status:'blocked',statusReason:e instanceof ApiError?e.message:'Reflector HERMES 연결을 확인하지 못했습니다.',model:null}}
 // 연결을 바꾸면 이전 격리 확인은 새 연결에 적용되지 않는다(connectionUpdatedAt이 달라진다).
 const at=stamp(),record:StoredConnection={secret:await encrypt(JSON.stringify({endpoint,key} satisfies Conn)),host,...check,checkedAt:at,updatedAt:at,updatedBy:by};
 await recordStatement(owner,'reflector_connection','current',record).run();
 return publicConnection(record,null);
}
async function confirmIsolation(owner:string,b:Record<string,unknown>,by:Who){
 ownerOnly(by);
 if(b.confirmed!==true)throw new ApiError(400,`격리 확인(confirmed: true)이 필요합니다: ${ISOLATION_STATEMENT}`);
 const s=await optional<StoredConnection>(owner,'reflector_connection','current');
 if(!s)throw new ReflectorBlocked('no_connection','Reflector 전용 HERMES 연결을 먼저 저장하세요.');
 const iso:Isolation={host:s.host,connectionUpdatedAt:s.updatedAt,statement:ISOLATION_STATEMENT,confirmedBy:by,confirmedAt:stamp()};
 await recordStatement(owner,'reflector_isolation','current',iso).run();
 return publicConnection(s,iso);
}
// 실행·결과 확인 직전마다 다시 본다: 연결 없음·확인 실패·격리 확인 없음(또는 다른 연결의 확인)·운영과 같은 호스트면 막는다.
async function connectionGate(owner:string):Promise<{cfg:Connection;host:string}>{
 const [s,iso]=await Promise.all([optional<StoredConnection>(owner,'reflector_connection','current'),optional<Isolation>(owner,'reflector_isolation','current')]);
 if(!s)throw new ReflectorBlocked('no_connection','Reflector 전용 HERMES 연결이 없습니다. 대표가 운영 연결과 다른 격리 프로필을 저장해야 합니다.');
 if(s.status!=='ready')throw new ReflectorBlocked('connection_not_ready','Reflector 연결 확인에 실패했습니다. 대표가 연결을 다시 저장하세요.');
 if(!iso||iso.connectionUpdatedAt!==s.updatedAt||hostKey(iso.host)!==hostKey(s.host))throw new ReflectorBlocked('isolation_unconfirmed',`대표의 격리 확인 기록이 없습니다: ${ISOLATION_STATEMENT}`);
 if(hostKey(s.host)===await operationalHost(owner))throw new ReflectorBlocked('same_host','Reflector 연결이 운영 HERMES와 같은 호스트입니다. 격리 프로필 주소로 다시 저장하세요.');
 const conn=JSON.parse(await decrypt(s.secret)) as Conn;
 return {cfg:{provider:'hermes',endpoint:conn.endpoint,key:conn.key,model:'reflector'},host:s.host};
}
async function gateState(owner:string){try{await connectionGate(owner);return {ready:true as const}}catch(e){if(e instanceof ReflectorBlocked)return {ready:false as const,blocked:e.blocked,reason:e.message};throw e}}

// ── 발동 조건과 본문. 교정 묶음은 B3-2a와 같은 계산(correctionClusters, 90일·5건)이고 인용 후보는 묶음의 decisionIds(최신순, 20건까지)다.
async function clustersOf(owner:string,brandId?:string){
 const [decisions,rules]=await Promise.all([signalDecisions(owner),listRecords<LearningRule>(owner,'learning_rule')]);
 return correctionClusters(decisions,rules).filter(c=>!brandId||c.brandId===brandId);
}
function target(b:Record<string,unknown>){
 const brandId=str(b.brandId,'대상 브랜드',100,true),role=str(b.role,'역할',30,true);
 if(!roles.some(r=>r.id===role))throw new ApiError(400,'역할을 확인해 주세요.');
 return {brandId,role};
}
async function eligibleCluster(owner:string,brandId:string,role:string){
 const cluster=(await clustersOf(owner,brandId)).find(c=>c.role===role);
 if(!cluster?.eligible)throw new ReflectorBlocked('not_eligible',`같은 브랜드·역할의 교정이 ${cluster?.corrections??0}건입니다. 90일 안에 ${PLAYBOOK_CLUSTER_MIN}건 이상이어야 규칙 초안을 제안받을 수 있습니다.`,{corrections:cluster?.corrections??0,min:PLAYBOOK_CLUSTER_MIN});
 return cluster;
}
// 교정 한 건의 입력 재료: 판정 요약과 선호 쌍(AI 원본·사람 확정본). 작업물이 지워졌으면 발췌 없이 사유 코드만 간다.
async function correctionSource(owner:string,id:string):Promise<CorrectionSource>{
 const d=await readRecord<ReviewDecision>(owner,'review_decision',id);
 const pair=await preferencePair(owner,d.targetId).catch((e:unknown)=>{if(e instanceof ApiError&&e.status===404)return null;throw e});
 return {decisionId:d.id,campaignId:d.campaignId,decision:d.decision,reasonCodes:d.reasonCodes??[],skillVersion:d.skillVersion,ai:pair?.ai?.content??null,human:pair?.human?.content??null};
}
async function buildBody(owner:string,brandId:string,role:string){
 const cluster=await eligibleCluster(owner,brandId,role),brand=await readRecord<Brand>(owner,'brand',brandId);
 const sources=await Promise.all(cluster.decisionIds.map(id=>correctionSource(owner,id)));
 const built=reflectorInput(role,aiBrand(brand).identity,sources),body=reflectorBody(built.input);
 return {...built,body,hash:await bodyHash(body),findings:inputFindings(built.input),corrections:cluster.corrections};
}
const piiBlocked=(findings:PiiFieldFinding[])=>new ReflectorBlocked('pii_detected',`개인정보로 보이는 값이 있어 보내지 않습니다(${findings.map(f=>`${f.field} ${f.kind} ${f.count}건`).join(', ')}). 원 작업물·브랜드 정보를 고친 뒤 다시 미리 보세요.`,{findings});

// 미리보기: 전송 0회. 본문(지시문·입력)·해시·탐지 결과(필드·종류·건수)·연결 상태를 돌려준다. 저장하지 않는다.
async function preview(owner:string,b:Record<string,unknown>,by:Who){
 operator(by);await assertOn(owner);
 const {brandId,role}=target(b),built=await buildBody(owner,brandId,role);
 return {brandId,role,corrections:built.corrections,cited:Object.keys(built.labels).length,previewHash:built.hash,body:built.body,findings:built.findings,blocked:built.findings.length>0,gate:await gateState(owner)};
}
async function activeRun(owner:string,brandId:string,role:string){
 return (await listRecords<ReflectorRun>(owner,'reflector_run',brandId)).find(r=>r.role===role&&ACTIVE.has(r.status))??null;
}
// 화면·응답용 요약: 제출 원문·라벨 대응표·응답 원문을 뺀다.
const HIDDEN=['submission','labels','response'];
const runSummary=(run:ReflectorRun)=>({...Object.fromEntries(Object.entries(run).filter(([k])=>!HIDDEN.includes(k))) as Omit<ReflectorRun,'submission'|'labels'|'response'>,...(run.response?{response:{status:run.response.status,model:run.response.model,totalTokens:run.response.totalTokens}}:{})});
// HERMES 제출(같은 키 재전송은 같은 실행, 영구 멱등). 토큰 예산 가드가 먼저 예약하고 넘으면 409로 막아 보내지 않는다(loop-4). 확정 거절(4xx, 429 제외)만 이번 예약을 푼다.
async function submit(owner:string,run:ReflectorRun,cfg:Connection):Promise<ReflectorRun>{
 const budget=await reserveTokenBudget(database(),owner,run.id,run.submission).catch((e:unknown)=>{if(e instanceof TokenBudgetExceeded)throw new ReflectorBlocked('budget_exceeded',e.message);throw e});
 try{
  const r=await hermesRequest(cfg,'/v1/runs',{method:'POST',headers:{'Idempotency-Key':run.submission.key,'X-Hermes-Session-Key':run.submission.key},body:run.submission.body});
  if(typeof r.run_id!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(r.run_id))return {...run,updatedAt:stamp()};
  await markTokenReservationRun(database(),owner,run.id,r.run_id);
  return {...run,status:'queued',providerRunId:r.run_id,updatedAt:stamp()};
 }catch(e){
  if(e instanceof ApiError&&e.status<500&&e.status!==429){if(budget.created)await releaseTokenReservation(database(),owner,run.id);return {...run,status:'failed',failure:`HERMES가 요청을 거절했습니다(${e.status}).`,updatedAt:stamp()}}
  // 429·5xx·연결 오류: 접수됐을 수 있어 예약과 submitting을 남긴다. 결과 확인이 같은 키로 다시 보낸다.
  return {...run,updatedAt:stamp()};
 }
}
// 실행: 미리보기와 같은 본문(해시 일치)·탐지 0건·격리 연결·예산 안일 때만 보낸다. 같은 브랜드×역할에 진행 중 실행이 있으면 같은 해시는 그 실행을 돌려주고(멱등) 다른 해시는 409다.
async function runReflector(owner:string,b:Record<string,unknown>,by:Who){
 operator(by);await assertOn(owner);
 const {brandId,role}=target(b),previewHash=str(b.previewHash,'미리보기 해시',100,true);
 if(b.confirmed!==true)throw new ApiError(400,'미리보기에서 보낼 본문을 확인했다는 표시(confirmed: true)가 필요합니다.');
 const active=await activeRun(owner,brandId,role);
 if(active){if(active.previewHash===previewHash)return {...runSummary(active),duplicate:true};throw new ReflectorBlocked('in_progress','같은 브랜드·역할의 Reflector 실행이 진행 중입니다. 결과를 확인한 뒤 다시 실행하세요.',{id:active.id})}
 const built=await buildBody(owner,brandId,role);
 if(built.hash!==previewHash)throw new ReflectorBlocked('preview_mismatch','미리보기 뒤 보낼 본문이 바뀌었습니다. 다시 미리 보고 확인하세요.');
 if(built.findings.length)throw piiBlocked(built.findings);
 const {cfg,host}=await connectionGate(owner),id='reflector-'+uid(),key='collective-reflector-'+uid(),at=stamp();
 // 저장하는 제출 원문 = 전송 본문(지시문·입력·세션 키·빈 대화 기록). 복구 재전송도 이 원문을 같은 키로 보낸다.
 const run:ReflectorRun={id,brandId,role,status:'submitting',previewHash,campaignIds:built.campaignIds,decisionIds:Object.values(built.labels),labels:built.labels,submission:{key,body:JSON.stringify({...built.body,session_id:key,conversation_history:[]})},host,providerRunId:null,ruleIds:[],rejected:[],createdBy:by,createdAt:at,updatedAt:at,expiresAt:new Date(Date.now()+REFLECTOR_RETENTION_DAYS*86400000).toISOString()};
 await recordStatement(owner,'reflector_run',id,run,brandId).run();
 const next=await submit(owner,run,cfg).catch(async(e:unknown)=>{if(e instanceof ReflectorBlocked)await database().prepare("DELETE FROM records WHERE id=? AND owner=? AND kind='reflector_run'").bind(`${owner}:reflector_run:${id}`,owner).run();throw e});
 await recordStatement(owner,'reflector_run',id,next,brandId).run();
 return runSummary(next);
}
// 초안 저장: 통과한 후보만 playbook_create와 같은 모양(draft, operator_preference, 60일, 인용 2~20건·같은 브랜드)으로 저장하고 감사 기록(create, source reflector)을 남긴다.
async function saveDrafts(owner:string,run:ReflectorRun,output:string,by:Who){
 const raw=parseCandidates(output);
 if(!raw)return {status:'failed' as const,failure:'HERMES 응답이 규칙 후보 JSON 형식이 아니어서 버렸습니다.',ruleIds:[],rejected:[]};
 const input=JSON.parse(JSON.parse(run.submission.body).input) as ReflectorInput,checked=checkCandidates(raw,run.labels,input);
 const rejected:ReflectorRun['rejected']=[],writes:D1PreparedStatement[]=[],ruleIds:string[]=[];
 for(const [index,c] of checked.entries()){
  if(!c.ok){rejected.push({index,reason:c.reason});continue}
  const citations=await citedDecisions(owner,run.brandId,c.citations,'review').catch((e:unknown)=>{if(e instanceof ApiError&&e.status===400)return null;throw e});
  if(!citations){rejected.push({index,reason:'citations'});continue}
  const at=stamp(),rule:LearningRule={origin:'review',grade:'operator_preference',id:'playbook:'+uid(),brandId:run.brandId,channel:ANY_CHANNEL,role:run.role,experimentId:'',experimentVersion:0,caseId:'',title:ruleTitle(c.text),guidance:c.text,scope:`사람 판정 ${citations.length}건 인용 · Reflector 초안`,citations,feedback:{helpful:0,harmful:0},status:'draft',version:1,expiresAt:playbookExpiry(),createdAt:at,updatedAt:at};
  writes.push(recordStatement(owner,'learning_rule',rule.id,rule,run.brandId),auditStatement(owner,rule,'create','',{id:by.id,email:null,role:by.role} as PlaybookActor,{source:'reflector',reflectorRunId:run.id}));ruleIds.push(rule.id);
 }
 if(writes.length)await database().batch(writes);
 return {status:'completed' as const,ruleIds,rejected};
}
const RUN_STATUS:Record<string,'completed'|'failed'|'in_progress'>={completed:'completed',cancelled:'failed',canceled:'failed',stopped:'failed',interrupted:'failed',failed:'failed',error:'failed',incomplete:'failed',started:'in_progress',queued:'in_progress',running:'in_progress',stopping:'in_progress',waiting:'in_progress',pending:'in_progress'};
// 결과 확인: 진행 중이면 같은 격리 연결(같은 호스트)로 조회하고, 끝나면 사용량을 기록한다. 도구 흔적이 있으면 결과를 버리고(discarded) 초안을 만들지 않는다.
async function checkRun(owner:string,b:Record<string,unknown>,by:Who){
 operator(by);await assertOn(owner);
 const run=await readRecord<ReflectorRun>(owner,'reflector_run',str(b.id,'Reflector 실행',100,true));
 if(!ACTIVE.has(run.status))return runSummary(run);
 const {cfg,host}=await connectionGate(owner);
 if(hostKey(host)!==hostKey(run.host)){const blocked={...run,status:'blocked' as const,failure:'Reflector 연결이 바뀌어 이 실행의 결과를 확인하지 않습니다.',updatedAt:stamp()};await recordStatement(owner,'reflector_run',run.id,blocked,run.brandId).run();return runSummary(blocked)}
 let next:ReflectorRun;
 if(run.status==='submitting')next=await submit(owner,run,cfg);
 else{
  const r=await hermesRequest(cfg,'/v1/runs/'+run.providerRunId) as Record<string,unknown>;
  if(r.run_id!==run.providerRunId||r.object!=='hermes.run')throw new ApiError(502,'HERMES 실행 결과가 일치하지 않습니다.');
  const status=RUN_STATUS[String(r.status)]??'in_progress';
  if(status==='in_progress')next={...run,status:'in_progress',updatedAt:stamp()};
  else{
   await recordProviderUsage(owner,'hermes',run.providerRunId!,r,{kind:'learning',submissionId:run.id,brandId:run.brandId,role:'reflector'});
   await settleTokenReservation(database(),owner,run.providerRunId!,run.id);
   const output=typeof r.output==='string'&&r.output.length<=300000?r.output:null,trace=toolTrace(r),usage=r.usage&&typeof r.usage==='object'?(r.usage as {total_tokens?:unknown}).total_tokens:null;
   const base={...run,toolTrace:trace,response:{status:String(r.status).slice(0,40),model:typeof r.model==='string'?r.model.slice(0,100):null,output,totalTokens:typeof usage==='number'?usage:null},completedAt:stamp(),updatedAt:stamp()};
   if(status==='failed')next={...base,status:'failed',failure:'HERMES 실행이 실패하거나 중단됐습니다.'};
   else if(trace)next={...base,status:'discarded',failure:'응답에 도구 사용 흔적이 있어 결과를 버렸습니다(DP-7). 규칙 초안을 만들지 않았습니다.'};
   else if(output===null)next={...base,status:'failed',failure:'HERMES 응답이 올바른 텍스트 형식이 아니어서 버렸습니다.'};
   else next={...base,...await saveDrafts(owner,run,output,by)};
  }
 }
 await recordStatement(owner,'reflector_run',run.id,next,run.brandId).run();
 return runSummary(next);
}

// GET /api/reflector?brandId=: 운영자 전용 상태(스위치·연결·격리 확인·역할별 발동 조건·최근 실행). 꺼져 있으면 enabled:false만 돌려준다. 본문·응답 원문·라벨은 담지 않는다.
export async function reflectorState(owner:string,brandId:string,by:Who){
 operator(by);
 if(!await reflectorOn(owner))return {enabled:false};
 await purgeExpired(owner);
 const [s,iso,clusters,runs,gate]=await Promise.all([optional<StoredConnection>(owner,'reflector_connection','current'),optional<Isolation>(owner,'reflector_isolation','current'),clustersOf(owner,brandId),listRecords<ReflectorRun>(owner,'reflector_run',brandId),gateState(owner)]);
 return {enabled:true,min:PLAYBOOK_CLUSTER_MIN,connection:publicConnection(s,iso),gate,clusters:clusters.filter(c=>c.role).map(c=>({role:c.role,corrections:c.corrections,eligible:c.eligible,window:c.window})),runs:runs.slice(0,10).map(runSummary)};
}
const actions:Record<string,(owner:string,b:Record<string,unknown>,by:Who)=>Promise<unknown>>={reflector_preview:preview,reflector_run:runReflector,reflector_check:checkRun,reflector_save_connection:saveConnection,reflector_confirm_isolation:confirmIsolation};
export async function reflectorAction(owner:string,b:Record<string,unknown>,by:Who){
 const act=actions[String(b.action)];if(!act)throw new ApiError(400,'지원하지 않는 Reflector 작업입니다.');
 await purgeExpired(owner);
 return act(owner,b,by);
}
