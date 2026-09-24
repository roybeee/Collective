// F4b-2 학습 자산 비식별 이관(대표 결정 7: 평가 신호는 비식별로 90일 보관, 대표가 완전 삭제를 고를 수 있다). 순수 모듈이며 저장·정리·삭제 연쇄는 lib/server.ts가 한다.
// 캠페인을 지울 때 AI 작업물마다 평가 신호(역할·출처·판·스킬/출력 계약/프롬프트 버전·보고 모델·토큰 합계·온라인 채점 통과/실패 채점기·규제 보류 건수·AI 품질 검수 기준별 판정)와
// 캠페인 단위 사용량 요약(실행 종류별 횟수·토큰·모델·결과)을 만든다. 사람 판정(사유 코드·1차 승인·기준별 판정)은 review_decision이 이미 보존하므로 담지 않는다(B1).
// 토큰 합계는 유효숫자 2자리로 줄여 담는다(사용량 원장의 정확한 합계와 바로 맞춰 보지 못하게).
// 담지 않는 것: 작업물 본문·제목·검토 메모, 캠페인 제목·목표·메모, 브랜드 이름·id, 캠페인·작업물·실행 id, URL, 주문 정보, 채점기 상세(detail)·규제 발췌(excerpt).
// 캠페인 id 대신 가명 키(subject)를 쓴다. 호출자가 소유자 범위에서 무작위로 만들고(signalSubject) 어디에도 캠페인과의 대응을 남기지 않는다.
// 만들고 나서 scanSignal로 입력에서 온 값 필드를 다시 검사해 매치된 필드는 버리고(null 또는 목록에서 제외) 경로만 droppedFields에 남긴다.
// id·가명 키·판·출처·날짜·건수·허용 목록 값은 코드가 만든 구조 값이라 검사하지 않는다(우연히 겹친 금지 문자열로 버리면 행 id가 겹치거나 만료일이 사라진다).
import {roles} from './agency';
import {qualityCriteria} from './quality';
import {legacyHumanEdit} from './review-decisions';
import type {UsageKind,UsageOutcome} from './usage-ledger';

export const SIGNAL_VERSION='deidentified-signal-v1' as const;
export const SIGNAL_RETENTION_DAYS=90;
const DAY_MS=86400000,MAX_GRADINGS=10,MAX_TOKENS_LIST=5;
export type SignalUsage={runs:number;inputTokens:number|null;outputTokens:number|null;totalTokens:number|null;models:string[]};
export type SignalGrading={artifactVersion:number;status:string;gradersVersion:string|null;passed:string[];failed:string[];errored:string[];complianceBlock:number|null;complianceWarn:number|null};
export type SignalQuality={verdict:string|null;checks:{criterion:string;status:string}[]};
type SignalBase={id:string;v:typeof SIGNAL_VERSION;subject:string;category:string|null;storeScoped:boolean;archivedOn:string;expiresAt:string;droppedFields:string[]};
export type ArtifactSignal=SignalBase&{unit:'artifact';role:string|null;origin:'ai'|'ai_edited';artifactVersion:number;skillVersion:string|null;outputContractVersion:string|null;promptVersions:string[];gradings:SignalGrading[];complianceHold:number|null;quality:SignalQuality|null;usage:SignalUsage|null};
export type CampaignSignal=SignalBase&{unit:'campaign';aiArtifacts:number;usage:(SignalUsage&{kind:string;outcomes:Record<string,number>})[]};
export type DeidentifiedSignal=ArtifactSignal|CampaignSignal;

// 입력은 저장된 레코드를 그대로 받는다(모양이 어긋나도 버리기만 하고 던지지 않는다).
type Rec=Record<string,unknown>;
export type SignalCampaign={id:string;title:string;brandId:string;storeId?:string;goal?:string;audience?:string;constraints?:string;sources?:string;products?:string;stores?:string};
export type SignalSources={brand:{name?:string;short?:string;category?:string}|null;artifacts:readonly Rec[];gradings:readonly Rec[];usage:readonly Rec[];metrics?:readonly Rec[]};

const obj=(v:unknown):Rec=>v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};
const text=(v:unknown)=>typeof v==='string'?v:'';
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
// 버전·모델·채점기 id처럼 코드·공급자가 만드는 짧은 토큰만 받는다. 공백·한글이 든 값은 원문일 수 있어 버린다(URL 모양은 아래 검사가 버린다).
const token=(v:unknown,max=120)=>typeof v==='string'&&v.length<=max&&/^[A-Za-z0-9][A-Za-z0-9._:@+/-]*$/.test(v)?v:null;
const tokens=(values:readonly unknown[],max=MAX_TOKENS_LIST)=>[...new Set(values.map(v=>token(v)).filter((v):v is string=>!!v))].slice(0,max);
const ROLE_IDS=new Set(roles.map(r=>r.id));
// 토큰 합계는 유효숫자 2자리(예: 2,015 → 2,000). 사용량 원장(캠페인 삭제 뒤에도 campaignId·artifactId와 남는다)의 정확한 합계로 이관 레코드를 되짚기 어렵게 한다.
const coarse=(n:number|null)=>n===null?null:Number(n.toPrecision(2));
const sum=(rows:readonly Rec[],key:string)=>{const n=rows.map(r=>count(r[key])).filter((x):x is number=>x!==null);return n.length?coarse(n.reduce((a,b)=>a+b,0)):null};
function usageOf(rows:readonly Rec[]):SignalUsage|null{
 if(!rows.length)return null;
 return {runs:rows.length,inputTokens:sum(rows,'inputTokens'),outputTokens:sum(rows,'outputTokens'),totalTokens:sum(rows,'totalTokens'),models:tokens(rows.map(r=>r.model))};
}
// 허용 목록 값: 채점 상태(lib/online-grading.ts)·사용량 실행 종류와 결과(lib/usage-ledger.ts)·품질 검수 판정(lib/quality.ts). 목록 밖 값은 담지 않는다.
const GRADING_STATUSES=new Set(['graded','grader_error','not_run']),USAGE_KINDS=new Set<string>(['role','meeting','brief','research','learning'] satisfies UsageKind[]);
const OUTCOMES=new Set<string>(['completed','thin_output','invalid_output','cancelled','provider_failed','storage_failed'] satisfies UsageOutcome[]);
const VERDICTS=new Set(['ready_for_review','revise','needs_data']),CHECK_STATUSES=new Set(['pass','revise','needs_data']),CRITERIA=new Set(Object.keys(qualityCriteria));
const allowed=(set:ReadonlySet<string>,v:unknown)=>typeof v==='string'&&set.has(v)?v:null;
function gradingOf(g:Rec):SignalGrading{
 const graders=(Array.isArray(g.graders)?g.graders:[]).map(obj),ids=(status:string)=>tokens(graders.filter(x=>x.status===status).map(x=>x.id),40),compliance=obj(g.compliance);
 return {artifactVersion:count(g.artifactVersion)??0,status:allowed(GRADING_STATUSES,g.status)??'unknown',gradersVersion:token(g.gradersVersion),passed:ids('pass'),failed:ids('fail'),errored:ids('grader_error'),complianceBlock:count(compliance.block),complianceWarn:count(compliance.warn)};
}
// AI가 만든 작업물(ai)과 사람이 고친 AI 작업물(ai_edited, B1 이전 사람 수정본 포함)만 평가 신호가 된다. 직접 작성은 모델·스킬 판정이 아니다.
function aiOrigin(a:Rec):'ai'|'ai_edited'|null{
 const version=count(a.version)??0,view={origin:text(a.origin),version,meetingId:typeof a.meetingId==='string'?a.meetingId:null};
 return legacyHumanEdit(view)||view.origin==='ai_edited'?'ai_edited':view.origin==='ai'?'ai':null;
}
// 품질 검수 작업물의 AI 판정(B1 판정 로그는 사람이 판정할 때만 AI 값을 복사한다). 판정·기준·상태 코드만 담고 발견·수정·위치 원문은 담지 않는다.
function qualityOf(a:Rec):SignalQuality|null{
 const q=obj(a.qualityReview);
 if(!Object.keys(q).length)return null;
 const checks=(Array.isArray(q.checks)?q.checks:[]).map(obj).flatMap(c=>{const criterion=allowed(CRITERIA,c.criterion),status=allowed(CHECK_STATUSES,c.status);return criterion&&status?[{criterion,status}]:[]});
 return {verdict:allowed(VERDICTS,q.verdict),checks};
}
// 회의 사용량의 작업 id는 '<소유자>:meeting:<회의 id>'다(lib/meeting-execution.ts). 회의 작업물은 사용량에 artifactId가 없어 회의 id·역할로 잇는다(lib/quality-console.ts와 같은 기준).
const meetingOf=(jobId:unknown)=>{const j=text(jobId),i=j.lastIndexOf(':meeting:');return i>=0?j.slice(i+9):null};
const usageRowsOf=(a:Rec,usage:readonly Rec[])=>usage.filter(u=>u.artifactId===a.id||typeof a.meetingId==='string'&&!!a.meetingId&&u.kind==='meeting'&&u.role===a.role&&meetingOf(u.jobId)===a.meetingId);
const utcDay=(at:string)=>at.slice(0,10);
// 보관 기한: 이관한 날(UTC) 0시부터 90일. 시각을 날짜로 줄여 삭제 기록(tombstone)의 삭제 시각과 바로 맞춰 보지 못하게 한다.
export const signalExpiry=(at:string)=>new Date(Date.parse(utcDay(at)+'T00:00:00.000Z')+SIGNAL_RETENTION_DAYS*DAY_MS).toISOString();
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
// 가명 키: 소유자 범위의 무작위 128비트. 캠페인 id·제목에서 만들지 않아 되돌릴 수 없고, 대응표도 저장하지 않는다.
export const signalSubject=()=>'anon_'+hex(crypto.getRandomValues(new Uint8Array(16)));

// 검사에 쓸 원문 문자열: 캠페인 제목·id, 소유자 id, 브랜드 이름·약칭, 캠페인·작업물·성과 메모의 문장 조각. 짧은 조각은 코드 값과 겹쳐 빼고 전체 문자열은 둔다.
export function forbiddenStrings(owner:string,campaign:SignalCampaign,sources:SignalSources){
 const memos=[campaign.goal,campaign.audience,campaign.constraints,campaign.sources,campaign.products,campaign.stores,...sources.artifacts.flatMap(a=>[a.title,a.content,a.reviewNote]),...(sources.metrics||[]).map(m=>m.notes)].map(text).filter(Boolean);
 const pieces=memos.flatMap(m=>[m,...m.split(/[\n.!?。]+/).map(s=>s.trim()).filter(s=>s.length>=10)]);
 return [...new Set([campaign.title,campaign.id,owner,sources.brand?.name,sources.brand?.short,...sources.artifacts.map(a=>a.id),...pieces].map(text).map(s=>s.trim()).filter(s=>s.length>=2))];
}

export type SignalOptions={subject:string;now:string};
// 삭제할 캠페인의 평가 신호. 같은 입력이면 같은 결과다(무작위 키와 시각은 호출자가 준다). 레코드 id는 가명 키와 순번이다.
export function buildSignals(owner:string,campaign:SignalCampaign,sources:SignalSources,{subject,now}:SignalOptions):DeidentifiedSignal[]{
 const base=(i:number):SignalBase=>({id:`${subject}:${i}`,v:SIGNAL_VERSION,subject,category:text(sources.brand?.category).trim().slice(0,60)||null,storeScoped:!!campaign.storeId,archivedOn:utcDay(now),expiresAt:signalExpiry(now),droppedFields:[]});
 const ai=sources.artifacts.flatMap(a=>{const origin=aiOrigin(a);return origin?[{a,origin}]:[]});
 const artifactSignals=ai.map(({a,origin},i):ArtifactSignal=>{
  const source=obj(a.aiSource),rows=usageRowsOf(a,sources.usage),stored=origin==='ai_edited'?source.promptVersion??a.promptVersion:a.promptVersion;
  const gradings=sources.gradings.filter(g=>g.artifactId===a.id).sort((x,y)=>(count(x.artifactVersion)??0)-(count(y.artifactVersion)??0)).slice(-MAX_GRADINGS).map(gradingOf);
  return {...base(i),unit:'artifact',role:typeof a.role==='string'&&ROLE_IDS.has(a.role)?a.role:null,origin,artifactVersion:count(a.version)??0,
   skillVersion:token(origin==='ai_edited'?source.skillVersion??a.skillVersion:a.skillVersion),outputContractVersion:token(origin==='ai_edited'?source.outputContractVersion??a.outputContractVersion:a.outputContractVersion),
   promptVersions:tokens([stored,...rows.map(r=>r.promptVersion)]),gradings,complianceHold:count(obj(a.complianceHold).block),quality:qualityOf(a),usage:usageOf(rows)};
 });
 const kinds=[...new Set(sources.usage.map(u=>allowed(USAGE_KINDS,u.kind)).filter((k):k is string=>!!k))].sort();
 const campaignSignal:CampaignSignal[]=sources.usage.length?[{...base(ai.length),unit:'campaign',aiArtifacts:ai.length,usage:kinds.map(kind=>{
  const rows=sources.usage.filter(u=>u.kind===kind),outcomes:Record<string,number>={};
  for(const o of rows.map(r=>allowed(OUTCOMES,r.domainOutcome)))if(o)outcomes[o]=(outcomes[o]||0)+1;
  return {kind,...usageOf(rows)!,outcomes};
 })}]:[];
 const forbidden=forbiddenStrings(owner,campaign,sources);
 return [...artifactSignals,...campaignSignal].map(s=>{const dropped=scanSignal(s,forbidden);return dropped.length?{...dropPaths(s,dropped),droppedFields:dropped}:s});
}

// DP-3 수준 원문 패턴(docs/DATA-PROCESSING.ko.md 4.3). 레인 A의 lib/pii-scan.ts가 생기면 이 검사를 그 함수로 바꾼다(입력: 객체와 금지 문자열, 출력: 매치된 필드 경로).
// 앞뒤 경계는 영숫자·밑줄로 본다. 그래서 가명 키·버전 해시 속 숫자열은 잡지 않고, 문장 속 번호는 잡는다.
const B='(?<![0-9A-Za-z_])',E='(?![0-9A-Za-z_])';
export const RAW_PATTERNS:readonly {kind:string;re:RegExp}[]=[
 {kind:'phone',re:new RegExp(`${B}(?:\\+82[ .-]?1[016789]|01[016789]|0(?:2|[3-6][1-5]|70|50\\d?|80))[ .)-]?\\d{3,4}[ .-]?\\d{4}${E}`)},
 {kind:'email',re:/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/},
 {kind:'url',re:/https?:\/\/|\bwww\.|(?<![@\w-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|kr|io|ai|ly|xyz|biz|info|shop|me)(?![a-z0-9-])/i},
 // 도로명(○○로 12, ○○길 3-1), 지번(○○동 123-4, ○○리 56번지), 건물 동·호수(101동 1203호).
 {kind:'address',re:/\S*(?:로|길)\s?\d{1,5}(?:-\d{1,5})?(?![0-9])|[가-힣]+(?:동|리|가)\s?\d{1,5}(?:-\d{1,5}|\s?번지)|\d{1,4}\s?동\s?\d{1,5}\s?호/},
 // 주문번호: 8자리 이상 숫자열(order_number), '주문번호' 표기, ORD-·order# 형식, 64자리 16진(orderRefs 해시).
 {kind:'order_number',re:new RegExp(`${B}\\d{8,}${E}`)},
 {kind:'order',re:new RegExp(`주문\\s*번호|${B}(?:order|ord)[-_ #:]*[A-Za-z0-9-]*\\d{3,}|(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])`,'i')},
];
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// 짧은 금지 문자열(3자 이하, 예: 브랜드 약칭)은 단어 경계로, 긴 것은 부분 문자열로 찾는다. 대소문자는 가리지 않는다. 값보다 긴 금지 문자열은 들어 있을 수 없어 건너뛴다.
const forbiddenMatcher=(s:string)=>{if(s.length<=3)return new RegExp(`(?<![0-9A-Za-z가-힣])${escape(s)}(?![0-9A-Za-z가-힣])`,'i');const lower=s.toLowerCase();return {test:(v:string)=>v.length>=lower.length&&v.toLowerCase().includes(lower)}};
// text: 모든 패턴과 금지 문자열. code: token()으로 공백·한글 없는 짧은 토큰만 받은 버전·모델·채점기 id. 숫자열 주문번호 규칙(날짜 접미사 모델 id·숫자뿐인 해시와 겹친다)과
// 3자 이하 금지 문자열(약칭이 날짜·버전 조각과 겹친다)은 보지 않고, 전화·이메일·URL·주문 형식·64자리 16진·4자 이상 금지 문자열은 그대로 본다.
export type ScanMode='text'|'code';
// fields를 주면 그 이름의 필드(와 그 아래 값)만 정한 방식으로 검사하고 나머지는 건너뛴다. 없으면 모든 문자열 값을 mode로 검사한다. 객체 키는 보지 않는다(이관 레코드의 동적 키는 허용 목록 값뿐이다).
export function scanForRawPatterns(value:unknown,{forbidden=[],mode='text',fields}:{forbidden?:readonly string[];mode?:ScanMode;fields?:ReadonlyMap<string,ScanMode>}={}):string[]{
 const matchers=forbidden.map(s=>s.trim()).filter(s=>s.length>=2).map(s=>({long:s.length>3,m:forbiddenMatcher(s)})),found:string[]=[];
 const hit=(v:string,m:ScanMode)=>RAW_PATTERNS.some(p=>(m==='text'||p.kind!=='order_number')&&p.re.test(v))||matchers.some(x=>(m==='text'||x.long)&&x.m.test(v));
 const walk=(v:unknown,path:string,m:ScanMode|null)=>{
  if(typeof v==='string'){if(m&&hit(v,m))found.push(path);return}
  if(Array.isArray(v)){v.forEach((x,i)=>walk(x,path?`${path}.${i}`:String(i),m));return}
  if(v&&typeof v==='object')for(const [k,x] of Object.entries(v))walk(x,path?`${path}.${k}`:k,fields?.get(k)??m);
 };
 walk(value,'',fields?null:mode);
 return found;
}
// 이관 레코드에서 입력에서 온 값 필드. 업종 범주는 브랜드가 적는 자유 텍스트라 전체 검사, 버전·모델·채점기 id는 코드 값 검사다.
// 나머지(id·가명 키·판·출처·역할·날짜·건수·채점 상태·실행 종류·결과·품질 판정)는 코드가 만들거나 허용 목록에서 고른 값이라 검사하지 않는다.
export const SIGNAL_SCAN_FIELDS:ReadonlyMap<string,ScanMode>=new Map<string,ScanMode>([['category','text'],...['skillVersion','outputContractVersion','promptVersions','models','gradersVersion','passed','failed','errored'].map(k=>[k,'code'] as [string,ScanMode])]);
export const scanSignal=(value:unknown,forbidden:readonly string[])=>scanForRawPatterns(value,{forbidden,fields:SIGNAL_SCAN_FIELDS});
// 매치된 경로를 버린다: 객체 필드는 null, 목록 원소는 목록에서 뺀다. 원본은 바꾸지 않는다.
function dropPaths<T>(value:T,paths:readonly string[]):T{
 const drop=new Set(paths);
 const walk=(v:unknown,path:string):unknown=>{
  if(Array.isArray(v))return v.flatMap((x,i)=>{const p=path?`${path}.${i}`:String(i);return drop.has(p)?[]:[walk(x,p)]});
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>{const p=path?`${path}.${k}`:k;return [k,drop.has(p)?null:walk(x,p)]}));
  return v;
 };
 return walk(value,'') as T;
}
