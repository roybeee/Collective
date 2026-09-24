import {ApiError,database,listRecords,readRecord,recordStatement,stamp,uid,str} from './server';
import {HttpBodyError,readBoundedJson} from './http-limits';
import {promptUnits,unitOf,unitFile,unitVersionId,versionUnit,canonicalBody,parseUnitFile,validateUnitBody,brandTermsFromCode,brandShort,PromptUnitError,PROMPT_FILE_MAX_BYTES,type UnitBody} from './prompt-units';
import {channelSkillIds,type PromptSet,type RoleSkill} from './practice';
import type {Campaign,Artifact,Brand} from './agency';
import type {Publication} from './execution';
import type {Store} from './store-marketing';
import type {EvalRun} from './eval-server';
import {pairGate} from './eval-stats';
import {alarmState,alarmAckStatement} from './usage-model-alarm';

// 프롬프트 레지스트리(F3a, 대표 결정 2·3). git prompts/가 정본이다. 소유자가 단위와 sourceSha를 지정하면 공개 저장소 raw 경로에서 그 SHA와 현재 main의 같은 파일을 가져와
// 본문이 같을 때만 불변 prompt_version으로 등록한다. 새 기계 자격증명·업로드 대체 경로는 없다.
// 활성화 게이트(F3b): 서버 eval_run 쌍 비교(pair) + 대표(owner) 승인 + 지정 캠페인 staged → promote. 비율 카나리·자동 승격은 없다. 모델·게이트웨이 경보가 열려 있으면 동결한다.
// 해석: 캠페인 단위로 한 번 고정(campaign_prompt_pin)하고 역할 실행·회의가 같이 쓴다. 비어 있거나 active가 없으면 코드 상수(바이트 동일), 조회 실패·손상은 코드 폴백 + fallback 표시.
export type Who={id:string;email:string|null};
export type PromptVersionRecord={id:string;unit:string;body:UnitBody;sha256:string;sourceSha:string;sourceMeta:{repo:string;path:string;mainRef:'main';fetchedAt:string};registeredBy:Who;registeredAt:string};
export type ReleaseEvent={action:'rollback'|'activate'|'stage'|'promote';from:string|null;to:string|null;at:string;by:Who|null;evalRunId?:string};
// active: 단위별 활성 버전 포인터. previous: 롤백 대상(없으면 롤백 시 코드 상수). evalRunId·approvedBy는 F3b 활성화가 채운다. targets는 쓰지 않는다(비율 카나리 없음, 대표 결정 2).
// stagedCampaignIds가 비어 있지 않으면 active는 그 캠페인에만 적용하고, 나머지 캠페인과 캠페인 없는 바이럴 학습은 baseline(스테이징 전 전체 적용 버전, 없으면 코드 상수)을 쓴다.
export type PromptRelease={id:string;unit:string;active:string|null;previous:string|null;targets:string[];stagedCampaignIds:string[];baseline?:string|null;evalRunId:string|null;approvedBy:Who|null;updatedAt:string;history:ReleaseEvent[]};
export type CampaignPromptPin={id:string;campaignId:string;campaignVersion:number;units:Record<string,string>;promptVersion:string;pinnedAt:string};
export type PromptFallback='lookup_failed'|'corrupt_record';
export type PromptResolution={source:'code'|'registry';units:Record<string,string>;set?:PromptSet;fallback?:PromptFallback};
export const PROMPT_REPO='roybeee/Collective';
const RAW_BASE=`https://raw.githubusercontent.com/${PROMPT_REPO}/`;
class CorruptRecord extends Error{}
class Blocked extends Error{}
const bad=(message:string):never=>{throw new ApiError(400,message)};

export async function sha256Hex(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
// F2a 규칙: <스킬 버전>:<지시 sha256 앞 12자>, 스킬 버전이 없으면 inline. 코드 상수로 실행한 기록의 promptVersion이다.
export const f2aPromptVersion=async(skillVersion:string|null|undefined,instructions:string)=>`${skillVersion||'inline'}:${(await sha256Hex(instructions)).slice(0,12)}`;
const unitIndex=(id:string)=>promptUnits.findIndex(u=>u.unit===versionUnit(id));
export const joinVersions=(ids:string[])=>[...ids].sort((a,b)=>unitIndex(a)-unitIndex(b)).join('+');
// 한 역할 실행(또는 회의 단계)이 쓰는 단위: 역할 스킬과 이 캠페인에 적용되는 채널 스킬.
export const roleRunUnits=(role:string,c:Pick<Campaign,'channels'|'products'|'stores'|'goal'>)=>['role.'+role,...channelSkillIds(c).map(k=>'channel.'+k)];
// 레지스트리 promptVersion: 이 실행이 쓴 레지스트리 단위 버전(unit@sha256 앞 12자)을 '+'로 잇는다. 모두 코드 상수면 null이고 호출자가 F2a 규칙을 쓴다.
export function runPromptVersion(r:Pick<PromptResolution,'units'>,units:string[]){const ids=units.map(u=>r.units[u]).filter((id):id is string=>!!id);return ids.length?joinVersions(ids):null}
export const usesVersion=(promptVersion:unknown,id:string)=>typeof promptVersion==='string'&&promptVersion.split('+').includes(id);

async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(error){if(error instanceof ApiError&&error.status===404)return undefined;throw error}}
// 저장된 버전을 다시 검사한다: 단위·id·본문 형식·sha256이 모두 맞아야 한다. 어긋나면 손상(corrupt)이다.
async function verifiedVersion(owner:string,unit:string,id:string):Promise<PromptVersionRecord>{
 const v=await optional<PromptVersionRecord>(owner,'prompt_version',id);
 if(!v||v.id!==id||v.unit!==unit||versionUnit(id)!==unit)throw new CorruptRecord();
 let body:UnitBody;try{body=canonicalBody(unit,v.body)}catch{throw new CorruptRecord()}
 const sha=await sha256Hex(JSON.stringify(body));
 if(v.sha256!==sha||unitVersionId(unit,sha)!==id)throw new CorruptRecord();
 return {...v,body};
}
const strings=(x:unknown)=>Array.isArray(x)&&x.every(v=>typeof v==='string');
function releaseShape(value:unknown):PromptRelease{
 const r=value as PromptRelease|null,pointer=(p:unknown)=>p===null||typeof p==='string'&&versionUnit(p)===r?.unit;
 if(!r||typeof r!=='object'||!unitOf(r.unit)||r.id!==r.unit||!pointer(r.active)||!pointer(r.previous)||!pointer(r.baseline??null)||!strings(r.stagedCampaignIds)||!strings(r.targets)||!Array.isArray(r.history))throw new CorruptRecord();
 return r;
}
const releases=async(owner:string)=>(await listRecords<unknown>(owner,'prompt_release')).map(releaseShape);
// 이 캠페인(없으면 캠페인 없는 해석)에 적용할 버전. 스테이징 중이면 지정 캠페인은 active, 나머지는 baseline이다.
const versionFor=(r:PromptRelease,campaignId?:string)=>!r.stagedCampaignIds.length?r.active:campaignId&&r.stagedCampaignIds.includes(campaignId)?r.active:r.baseline??null;
// 지금 전체 캠페인에 적용되는 버전(쌍 평가의 active 쪽 기준).
const globalVersion=(r:PromptRelease|null)=>r?versionFor(r):null;
function toSet(versions:PromptVersionRecord[]):PromptSet{
 const roles:Record<string,RoleSkill>={},channels:Record<string,string>={};let viral:string|undefined;
 for(const v of versions){const u=unitOf(v.unit)!;if(u.kind==='role')roles[u.key]=v.body as RoleSkill;else if(u.kind==='channel')channels[u.key]=v.body as string;else viral=v.body as string}
 return {...(Object.keys(roles).length?{roles}:{}),...(Object.keys(channels).length?{channels}:{}),...(viral!==undefined?{viral}:{})};
}
const fallbackOf=(error:unknown):PromptFallback=>{const reason=error instanceof CorruptRecord?'corrupt_record':'lookup_failed';console.error('prompt_registry_fallback',reason);return reason};
// 공용 해석기: 역할 실행과 회의가 같이 쓴다. 같은 브리프 버전의 고정(pin)이 있으면 그 버전을, 없으면 지금 적용되는 active를 읽어 고정한다.
// 캠페인 단위는 역할·채널 스킬뿐이다(바이럴 발견 지시는 브랜드 단위라 resolveUnitPrompt가 따로 해석한다).
export async function resolveCampaignPrompts(owner:string,c:Pick<Campaign,'id'|'version'>):Promise<PromptResolution>{
 try{
  const pin=await optional<CampaignPromptPin>(owner,'campaign_prompt_pin',c.id),pinned=pin&&pin.campaignVersion===c.version;
  if(pinned&&(!pin.units||typeof pin.units!=='object'))throw new CorruptRecord();
  const units:Record<string,string>=pinned?pin.units:Object.fromEntries((await releases(owner)).filter(r=>unitOf(r.unit)?.kind!=='viral').map(r=>[r.unit,versionFor(r,c.id)]).filter(([,id])=>!!id));
  if(!Object.keys(units).length)return {source:'code',units:{}};
  const versions=await Promise.all(Object.entries(units).map(([unit,id])=>verifiedVersion(owner,unit,id)));
  if(!pinned)await recordStatement(owner,'campaign_prompt_pin',c.id,{id:c.id,campaignId:c.id,campaignVersion:c.version,units,promptVersion:joinVersions(Object.values(units)),pinnedAt:stamp()},c.id).run();
  return {source:'registry',units,set:toSet(versions)};
 }catch(error){return {source:'code',units:{},fallback:fallbackOf(error)}}
}
// 캠페인이 없는 단위(바이럴 발견 지시)의 해석. 스테이징 중인 릴리스는 지정 캠페인 밖이므로 baseline(전체 적용 버전, 없으면 코드 상수)을 쓴다.
export async function resolveUnitPrompt(owner:string,unit:string):Promise<{versionId?:string;body?:UnitBody;fallback?:PromptFallback}>{
 try{
  const release=(await releases(owner)).find(r=>r.unit===unit),id=release?versionFor(release):null;
  if(!id)return {};
  const v=await verifiedVersion(owner,unit,id);
  return {versionId:v.id,body:v.body};
 }catch(error){return {fallback:fallbackOf(error)}}
}
// 실행 기록(learning_snapshot)에 해석 결과를 덧붙인다. 학습 규칙 사본은 그대로 두고 같은 배치에서 쓴다.
export function promptSnapshotStatement(owner:string,id:string,p:{promptVersion:string;promptSource:'code'|'registry';promptFallback?:PromptFallback}){
 const fallback=p.promptFallback?",'$.promptFallback',?":'';
 return database().prepare(`UPDATE records SET data=json_set(data,'$.promptVersion',?,'$.promptSource',?${fallback}) WHERE id=? AND owner=? AND kind='learning_snapshot'`).bind(p.promptVersion,p.promptSource,...(p.promptFallback?[p.promptFallback]:[]),`${owner}:learning_snapshot:${id}`,owner);
}

// 등록: 지정 SHA와 main의 같은 파일을 공개 raw 경로에서 가져온다. 연결 실패·HTTP 오류는 blocked로 기록하고 업로드 대체 없이 502로 끝낸다.
const refLabel=(ref:string)=>ref==='main'?'main의':`커밋 ${ref.slice(0,7)}의`;
async function fetchUnitFile(ref:string,unit:string):Promise<unknown>{
 let r:Response;
 try{r=await fetch(`${RAW_BASE}${ref}/prompts/${unitFile(unit)}`,{signal:AbortSignal.timeout(10000),redirect:'manual'})}catch{throw new Blocked(`${refLabel(ref)} prompts/${unitFile(unit)}을(를) 가져오지 못했습니다(연결 실패·시간 초과).`)}
 if(!r.ok)throw new Blocked(`${refLabel(ref)} prompts/${unitFile(unit)}을(를) 가져오지 못했습니다(HTTP ${r.status}).`);
 try{return await readBoundedJson(r,PROMPT_FILE_MAX_BYTES)}catch(error){if(error instanceof HttpBodyError)bad(`${refLabel(ref)} 프롬프트 파일이 ${error.status===413?'너무 큽니다':'JSON 형식이 아닙니다'}.`);throw error}
}
function unitCheck<T>(fn:()=>T):T{try{return fn()}catch(error){if(error instanceof PromptUnitError)bad(error.message);throw error}}
// 소유자 D1의 브랜드·지점 이름과 약칭(영문 3자·한글 2자 이상). 코드 시드 목록과 함께 브랜드 식별어로 막는다. D1 이름은 CI가 볼 수 없어 등록 때만 검사한다.
async function workspaceTerms(owner:string){
 const [brands,stores]=await Promise.all([listRecords<Brand>(owner,'brand'),listRecords<Store>(owner,'store')]);
 return [...brands.flatMap(b=>[b.name,...brandShort(b.short)]),...stores.map(s=>s.name)].filter((t):t is string=>typeof t==='string');
}
const registrationStatement=(owner:string,entry:{unit:string;sourceSha:string;status:'registered'|'idempotent'|'blocked';reason?:string;versionId?:string},who:Who)=>{const id=uid();return recordStatement(owner,'prompt_registration',id,{id,...entry,by:who,at:stamp()})};
// 목록·등록 응답에는 본문을 빼고 보낸다(본문은 ?version=<id>로 읽는다).
const publicVersion=(v:PromptVersionRecord)=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='body')) as Omit<PromptVersionRecord,'body'>;
async function fetchBoth(owner:string,unit:string,sourceSha:string,who:Who){
 try{return await Promise.all([fetchUnitFile(sourceSha,unit),fetchUnitFile('main',unit)])}
 catch(error){if(!(error instanceof Blocked))throw error;await registrationStatement(owner,{unit,sourceSha,status:'blocked',reason:error.message},who).run();throw new ApiError(502,error.message+' 업로드로 대신 등록하는 경로는 없습니다. 잠시 뒤 같은 SHA로 다시 등록하세요.')}
}
async function register(owner:string,input:Record<string,unknown>,who:Who){
 const unit=unitOf(input.unit)?.unit??bad('등록할 프롬프트 단위를 확인하세요.');
 const sourceSha=typeof input.sourceSha==='string'&&/^[0-9a-f]{40}$/.test(input.sourceSha)?input.sourceSha:bad('sourceSha는 40자리 소문자 16진수 커밋 SHA여야 합니다.');
 const [atSha,atMain]=await fetchBoth(owner,unit,sourceSha,who);
 const body=unitCheck(()=>parseUnitFile(atSha,unit).body),mainBody=unitCheck(()=>parseUnitFile(atMain,unit).body);
 if(JSON.stringify(body)!==JSON.stringify(mainBody))bad('지정한 SHA의 본문이 현재 main의 같은 파일과 다릅니다. main에 병합된 본문만 등록할 수 있습니다.');
 const terms=[...brandTermsFromCode(),...await workspaceTerms(owner)];
 unitCheck(()=>validateUnitBody(unit,body,terms));
 const sha=await sha256Hex(JSON.stringify(body)),id=unitVersionId(unit,sha),existing=await optional<PromptVersionRecord>(owner,'prompt_version',id);
 if(existing&&existing.sha256!==sha)throw new ApiError(409,'같은 버전 id에 다른 본문이 저장돼 있습니다. 등록을 멈추고 기록을 확인하세요.');
 if(existing){await registrationStatement(owner,{unit,sourceSha,status:'idempotent',versionId:id},who).run();return {version:publicVersion(existing),idempotent:true}}
 const at=stamp(),record:PromptVersionRecord={id,unit,body,sha256:sha,sourceSha,sourceMeta:{repo:PROMPT_REPO,path:'prompts/'+unitFile(unit),mainRef:'main',fetchedAt:at},registeredBy:who,registeredAt:at};
 // 불변: 같은 id가 이미 있으면 덮어쓰지 않는다(INSERT OR IGNORE).
 await database().batch([database().prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:prompt_version:${id}`,owner,'prompt_version','',JSON.stringify(record),at),registrationStatement(owner,{unit,sourceSha,status:'registered',versionId:id},who)]);
 const saved=await readRecord<PromptVersionRecord>(owner,'prompt_version',id);
 if(saved.sha256!==sha)throw new ApiError(409,'같은 버전 id에 다른 본문이 저장돼 있습니다. 등록을 멈추고 기록을 확인하세요.');
 return {version:publicVersion(saved),idempotent:saved.registeredAt!==at};
}

// 영향 범위: 이 버전으로 만든 현행 작업물과 그 작업물 카피를 쓴 발행물.
const versionIdOf=(value:unknown)=>typeof value==='string'&&/^[a-z]+\.[a-z]+@[0-9a-f]{12}$/.test(value)&&unitOf(versionUnit(value))?value:bad('프롬프트 버전 id를 확인하세요.');
export async function promptImpact(owner:string,versionId:string){
 const version=await readRecord<PromptVersionRecord>(owner,'prompt_version',versionId);
 const artifacts=(await listRecords<Artifact&{promptVersion?:string;promptRecheck?:unknown}>(owner,'artifact')).filter(a=>usesVersion(a.promptVersion,versionId)),ids=new Set(artifacts.map(a=>a.id));
 const publications=(await listRecords<Publication>(owner,'execution_publication')).filter(p=>!!p.copy&&ids.has(p.copy.artifactId));
 return {version:publicVersion(version),counts:{artifacts:artifacts.length,publications:publications.length},
  artifacts:artifacts.map(a=>({id:a.id,campaignId:a.campaignId,role:a.role,version:a.version,status:a.status,promptVersion:a.promptVersion,promptRecheck:a.promptRecheck??null})),
  publications:publications.map(p=>({id:p.id,campaignId:p.campaignId,status:p.status,artifactId:p.copy!.artifactId}))};
}
// 롤백: prompt_release 포인터 한 번 조작(active ← previous, 없으면 코드 상수). 같은 배치에서 영향 작업물에 재확인 표시만 남기고(본문 불변),
// 그 버전을 고정한 캠페인 해석(pin)을 풀어 다음 실행이 새 active로 다시 고정한다. 이미 제출한 작업의 재제출은 저장된 원문을 그대로 보낸다.
async function rollback(owner:string,input:Record<string,unknown>,who:Who){
 const unit=unitOf(input.unit)?.unit??bad('롤백할 프롬프트 단위를 확인하세요.');
 const release=releaseShape(await readRecord(owner,'prompt_release',unit));
 if(!release.active)throw new ApiError(409,'이 단위에는 활성 버전이 없습니다.');
 if(input.expectedActive!==release.active)throw new ApiError(409,'활성 버전이 바뀌었습니다. 새로고침 후 현재 활성 버전을 확인하고 다시 롤백하세요.');
 const from=release.active,to=release.previous,at=stamp(),impact=await promptImpact(owner,from);
 // 스테이징 중 롤백은 스테이징 전 상태(previous = 스테이징 전 전체 적용 버전)로 되돌리고 지정 캠페인 목록을 비운다.
 const next:PromptRelease={...release,active:to,previous:null,stagedCampaignIds:[],baseline:null,updatedAt:at,history:[...release.history,{action:'rollback' as const,from,to,at,by:who}].slice(-50)};
 const recheck=JSON.stringify({version:from,reason:'prompt_rollback',at});
 await database().batch([recordStatement(owner,'prompt_release',unit,next),
  ...impact.artifacts.map(a=>database().prepare("UPDATE records SET data=json_set(data,'$.promptRecheck',json(?)) WHERE id=? AND owner=? AND kind='artifact'").bind(recheck,`${owner}:artifact:${a.id}`,owner)),
  database().prepare("DELETE FROM records WHERE owner=? AND kind='campaign_prompt_pin' AND EXISTS (SELECT 1 FROM json_each(data,'$.units') WHERE value=?)").bind(owner,from)]);
 return {release:next,impact:{counts:impact.counts,artifacts:impact.artifacts.map(a=>a.id),publications:impact.publications.map(p=>p.id)}};
}

// ── 활성화 게이트(F3b, 대표 결정 2·5·10) ──
// 쌍 평가 두 쪽 본문: 후보 버전과 지금 전체 캠페인에 적용되는 버전(없으면 코드 상수). eval-server가 pair run 시작 때 한 번 읽어 run에 고정한다.
export type PairPrompts={unit:string;candidateVersionId:string;activeVersionId:string|null;candidateSet:PromptSet;activeSet:PromptSet|null};
type GateSummary={cases:number;sealedCases:number;passes:{pairs:number;active:number;candidate:number};inputBudget:{pass:number;total:number};models:string[];gateway:{start:string|null;end:string|null}};
// 레지스트리 이벤트(docs/PUBLISH.ko.md 7절 registry-active 기록의 근거): 조작 전·후 매니페스트와 승인·평가 근거를 남긴다. 추가만 하고 고치지 않는다.
export type ReleaseEventRecord={id:string;unit:string|null;action:'activate'|'stage'|'promote'|'reset_pins';from:string|null;to:string|null;sourceSha:string|null;evalRunId:string|null;approval:{reason:string|null;by:Who;at:string}|null;stagedCampaignIds:string[];gate?:GateSummary;pins?:{campaignId:string;campaignVersion:number;promptVersion:string}[];by:Who;manifestBefore:string|null;manifestAfter:string|null;at:string};
const MAX_CAMPAIGNS=50,CANARY=['percent','percentage','ratio','canary','weight','traffic','rollout'];
const conflict=(message:string):never=>{throw new ApiError(409,message)};
async function releaseOf(owner:string,unit:string){
 const value=await optional<unknown>(owner,'prompt_release',unit);
 try{return value===undefined?null:releaseShape(value)}catch{return conflict('프롬프트 릴리스 기록이 손상됐습니다. 기록을 확인하세요.')}
}
// 등록된 버전을 다시 검사해 읽는다. 없으면 404, 손상이면 409다.
async function registeredVersion(owner:string,unit:string,id:string){
 await readRecord<PromptVersionRecord>(owner,'prompt_version',id);
 try{return await verifiedVersion(owner,unit,id)}catch(error){if(error instanceof CorruptRecord)conflict('저장된 프롬프트 버전이 손상됐습니다. 기록을 확인하세요.');throw error}
}
const unitVersion=(unit:string,value:unknown)=>{const id=versionIdOf(value);return versionUnit(id)===unit?id:bad('버전이 이 단위의 버전이 아닙니다.')};
export async function pairPrompts(owner:string,value:unknown):Promise<PairPrompts>{
 const o=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:bad('쌍 평가 대상(pair)은 {unit, candidateVersionId} 형식이어야 합니다.');
 const unit=unitOf(o.unit)?.unit??bad('쌍 평가할 프롬프트 단위를 확인하세요.');
 if(unitOf(unit)!.kind==='viral')bad('바이럴 발견 지시는 역할 평가 케이스로 쌍 평가할 수 없습니다.');
 const candidateVersionId=unitVersion(unit,o.candidateVersionId),activeVersionId=globalVersion(await releaseOf(owner,unit));
 if(activeVersionId===candidateVersionId)bad('후보 버전이 지금 전체 적용 중인 active와 같습니다.');
 const [candidate,active]=await Promise.all([registeredVersion(owner,unit,candidateVersionId),activeVersionId?registeredVersion(owner,unit,activeVersionId):null]);
 return {unit,candidateVersionId,activeVersionId,candidateSet:toSet([candidate]),activeSet:active?toSet([active]):null};
}
function noCanary(input:Record<string,unknown>){if(CANARY.some(k=>k in input))bad('비율(%) 카나리는 지원하지 않습니다(대표 결정 2). 지정 캠페인(stage)으로만 나눠 적용하고 promote로 전체 적용하세요.')}
function approvalReason(value:unknown){
 const o=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:bad('대표 승인 사유(approval.reason)를 입력하세요.');
 return str(o.reason,'대표 승인 사유',500,true);
}
async function campaignsOf(owner:string,value:unknown){
 if(!Array.isArray(value)||!value.length||value.length>MAX_CAMPAIGNS)bad(`캠페인(campaignIds)을 1~${MAX_CAMPAIGNS}개 고르세요.`);
 const ids=[...new Set((value as unknown[]).map(v=>str(v,'캠페인',100,true)))].sort();
 return Promise.all(ids.map(id=>readRecord<Campaign>(owner,'campaign',id)));
}
// 게이트: 이 단위·버전의 pair run이 끝났고 조건(lib/eval-stats.ts pairGate)을 모두 만족하며, 그 run의 active 쪽이 지금 전체 적용 버전과 같고,
// 모델·게이트웨이 경보(결정 10)가 마지막 확인 이후 열려 있지 않아야 한다. 사유를 모두 모아 409로 답한다.
async function passGate(owner:string,unit:string,versionId:string,evalRunId:string,release:PromptRelease|null){
 const run=await optional<EvalRun>(owner,'eval_run',evalRunId);
 if(!run)throw new ApiError(409,`활성화 게이트를 통과하지 못했습니다: 쌍 평가 실행 ${evalRunId}을(를) 찾을 수 없습니다.`);
 if(run.variant!=='pair'||!run.pair)throw new ApiError(409,'활성화 게이트를 통과하지 못했습니다: 쌍 평가(pair) 실행이 아닙니다.');
 const gate=pairGate(run),alarms=(await alarmState(owner)).open,current=globalVersion(release),basis=run.pair.activeVersionId;
 const reasons=[
  ...(run.pair.unit!==unit||run.pair.candidateVersionId!==versionId?['이 단위·버전의 쌍 평가(pair) 실행이 아닙니다.']:[]),
  ...(basis!==current?[`평가 뒤 active가 바뀌었습니다(평가 기준 ${basis??'코드 상수'} · 현재 ${current??'코드 상수'}). 현재 active로 쌍 평가를 다시 하세요.`]:[]),
  ...gate.reasons.map(r=>r.message),
  ...(alarms.length?[`모델·게이트웨이 변경 경보 ${alarms.length}건이 열려 있어 동결 중입니다(결정 10). 골든 스모크를 다시 돌려 확인하고 acknowledge_alarms로 해제하세요.`]:[]),
 ];
 if(reasons.length)throw new ApiError(409,'활성화 게이트를 통과하지 못했습니다: '+reasons.join(' / '));
 const models=[...new Set([...gate.models.active,...gate.models.candidate].filter((m):m is string=>!!m))];
 return {cases:gate.cases,sealedCases:gate.sealedCases,passes:gate.passes,inputBudget:gate.inputBudget,models,gateway:gate.gateway};
}
// 매니페스트: 단위별 적용 상태(단위 순)의 sha256. 스테이징 중인 단위는 baseline과 지정 캠페인까지 넣어 stage·promote 전후가 구분된다.
const manifestEntry=(r:PromptRelease)=>Array.isArray(r.stagedCampaignIds)&&r.stagedCampaignIds.length?{unit:r.unit,active:r.active,baseline:r.baseline??null,stagedCampaignIds:r.stagedCampaignIds}:{unit:r.unit,active:r.active};
async function manifestOf(rels:PromptRelease[]){const active=rels.filter(r=>typeof r?.active==='string').map(manifestEntry).sort((a,b)=>a.unit.localeCompare(b.unit));return active.length?sha256Hex(JSON.stringify(active)):null}
// 포인터와 이벤트를 한 배치로 쓴다. POST 라우트가 소유자 잠금 안에서 부르므로 조작 전 매니페스트와 쓰기 사이에 다른 조작이 끼지 않는다.
async function commitRelease(owner:string,next:PromptRelease,event:Omit<ReleaseEventRecord,'id'|'manifestBefore'|'manifestAfter'>){
 const rels=await listRecords<PromptRelease>(owner,'prompt_release'),after=[...rels.filter(r=>r?.unit!==next.unit),next];
 const record:ReleaseEventRecord={id:uid(),...event,manifestBefore:await manifestOf(rels),manifestAfter:await manifestOf(after)};
 await database().batch([recordStatement(owner,'prompt_release',next.unit,next),recordStatement(owner,'prompt_release_event',record.id,record)]);
 return {release:next,event:record};
}
const pinsOf=(owner:string,campaigns:Campaign[])=>Promise.all(campaigns.map(c=>optional<CampaignPromptPin>(owner,'campaign_prompt_pin',c.id)));
// activate: 전체 캠페인에 적용. stage: 지정 캠페인에만 적용하고 나머지는 baseline(지금 전체 적용 버전)을 계속 쓴다. 이미 고정(pin)한 캠페인은 reset_pins 전까지 고정 버전을 쓴다.
async function activate(owner:string,input:Record<string,unknown>,who:Who,mode:'activate'|'stage'){
 noCanary(input);
 const unit=unitOf(input.unit)?.unit??bad('활성화할 프롬프트 단위를 확인하세요.'),versionId=unitVersion(unit,input.versionId),evalRunId=str(input.evalRunId,'평가 실행',160,true),reason=approvalReason(input.approval);
 const campaigns=mode==='stage'?await campaignsOf(owner,input.campaignIds):[],version=await registeredVersion(owner,unit,versionId),release=await releaseOf(owner,unit);
 if(release?.stagedCampaignIds.length)conflict('이 단위는 지정 캠페인 적용(staged) 중입니다. promote로 전체 적용하거나 rollback한 뒤 다시 하세요.');
 if(release?.active===versionId)conflict('이미 active인 버전입니다.');
 const gate=await passGate(owner,unit,versionId,evalRunId,release),at=stamp(),from=release?.active??null,ids=campaigns.map(c=>c.id),pins=await pinsOf(owner,campaigns);
 const next:PromptRelease={id:unit,unit,active:versionId,previous:from,targets:[],stagedCampaignIds:ids,baseline:mode==='stage'?from:null,evalRunId,approvedBy:who,updatedAt:at,history:[...(release?.history||[]),{action:mode,from,to:versionId,at,by:who,evalRunId}].slice(-50)};
 const result=await commitRelease(owner,next,{unit,action:mode,from,to:versionId,sourceSha:version.sourceSha,evalRunId,approval:{reason,by:who,at},stagedCampaignIds:ids,gate,by:who,at});
 return mode==='stage'?{...result,pinnedCampaignIds:campaigns.filter((c,i)=>pins[i]?.campaignVersion===c.version).map(c=>c.id)}:result;
}
// promote: 스테이징한 버전을 전체 캠페인에 적용한다. 같은 평가 run으로 게이트를 다시 확인하고(기준 = baseline) 경보 동결을 다시 본다. 자동 승격은 없다.
async function promote(owner:string,input:Record<string,unknown>,who:Who){
 noCanary(input);
 const unit=unitOf(input.unit)?.unit??bad('승격할 프롬프트 단위를 확인하세요.'),release=await releaseOf(owner,unit),reason=input.approval===undefined?null:approvalReason(input.approval);
 if(!release)throw new ApiError(404,'항목을 찾을 수 없습니다.');
 if(!release.stagedCampaignIds.length||!release.active||!release.evalRunId)throw new ApiError(409,'지정 캠페인 적용(staged) 중인 버전이 없습니다. stage 뒤에 promote하세요.');
 const gate=await passGate(owner,unit,release.active,release.evalRunId,release),version=await registeredVersion(owner,unit,release.active),at=stamp(),from=release.baseline??null;
 const next:PromptRelease={...release,stagedCampaignIds:[],baseline:null,approvedBy:who,updatedAt:at,history:[...release.history,{action:'promote' as const,from,to:release.active,at,by:who,evalRunId:release.evalRunId}].slice(-50)};
 return commitRelease(owner,next,{unit,action:'promote',from,to:release.active,sourceSha:version.sourceSha,evalRunId:release.evalRunId,approval:{reason,by:who,at},stagedCampaignIds:release.stagedCampaignIds,gate,by:who,at});
}
// reset_pins: 지정한 캠페인의 해석 고정(pin)을 명시적으로 푼다. 다음 역할 실행·회의가 그때 적용되는 버전으로 다시 고정한다. 진행 중 작업은 저장된 원문을 그대로 쓴다.
async function resetPins(owner:string,input:Record<string,unknown>,who:Who){
 const campaigns=await campaignsOf(owner,input.campaignIds),pins=await pinsOf(owner,campaigns),held=pins.filter((p):p is CampaignPromptPin=>!!p),at=stamp(),manifest=await promptManifest(owner);
 const event:ReleaseEventRecord={id:uid(),unit:null,action:'reset_pins',from:null,to:null,sourceSha:null,evalRunId:null,approval:null,stagedCampaignIds:[],pins:held.map(p=>({campaignId:p.campaignId,campaignVersion:p.campaignVersion,promptVersion:p.promptVersion})),by:who,manifestBefore:manifest,manifestAfter:manifest,at};
 await database().batch([...held.map(p=>database().prepare("DELETE FROM records WHERE owner=? AND kind='campaign_prompt_pin' AND id=?").bind(owner,`${owner}:campaign_prompt_pin:${p.id}`)),recordStatement(owner,'prompt_release_event',event.id,event)]);
 return {reset:campaigns.filter((_,i)=>!!pins[i]).map(c=>c.id),unpinned:campaigns.filter((_,i)=>!pins[i]).map(c=>c.id),event};
}
// 경보 해제: 열린 model_change·gateway_change를 확인 처리한다. 근거로 골든 스모크를 다시 돌린 평가 run을 붙이기를 권한다(있으면 끝난 run이어야 한다).
async function acknowledgeAlarms(owner:string,input:Record<string,unknown>,who:Who){
 const reason=str(input.reason,'경보 확인 사유',500,true),evalRunId=input.evalRunId===undefined||input.evalRunId===null?null:str(input.evalRunId,'근거 평가 실행',160,true);
 if(evalRunId){const run=await readRecord<EvalRun>(owner,'eval_run',evalRunId);if(run.status!=='completed'||run.deleted)conflict('근거로 붙일 평가 실행이 끝나지 않았거나 삭제됐습니다.')}
 const {open}=await alarmState(owner);
 if(!open.length)conflict('확인할 열린 모델·게이트웨이 경보가 없습니다.');
 const ack={id:uid(),alarms:open.map(a=>({kind:a.kind,id:a.id})),reason,evalRunId,by:who,at:stamp()};
 await alarmAckStatement(owner,ack).run();
 return {acknowledged:ack};
}
const ACTIONS:Record<string,(owner:string,input:Record<string,unknown>,who:Who)=>Promise<unknown>>={
 register,rollback,activate:(owner,input,who)=>activate(owner,input,who,'activate'),stage:(owner,input,who)=>activate(owner,input,who,'stage'),promote,reset_pins:resetPins,acknowledge_alarms:acknowledgeAlarms,
};
export async function promptRegistryAction(owner:string,input:Record<string,unknown>,who:Who){
 const name=String(input.action);
 if(!Object.hasOwn(ACTIONS,name))throw new ApiError(400,'지원하지 않는 프롬프트 레지스트리 작업입니다.');
 return ACTIONS[name](owner,input,who);
}
// /api/version용 매니페스트 해시(manifestOf). active가 하나도 없으면 null이다.
export async function promptManifest(owner:string){return manifestOf(await listRecords<PromptRelease>(owner,'prompt_release'))}
export async function promptRegistryRead(owner:string,params:URLSearchParams){
 const impact=params.get('impact'),version=params.get('version');
 if(impact)return promptImpact(owner,versionIdOf(impact));
 if(version)return {version:await readRecord<PromptVersionRecord>(owner,'prompt_version',versionIdOf(version))};
 const [versions,rels,registrations,events,alarms]=await Promise.all([listRecords<PromptVersionRecord>(owner,'prompt_version'),listRecords<PromptRelease>(owner,'prompt_release'),listRecords<object>(owner,'prompt_registration'),listRecords<ReleaseEventRecord>(owner,'prompt_release_event'),alarmState(owner)]);
 return {units:promptUnits.map(u=>({...u,file:'prompts/'+unitFile(u.unit),release:rels.find(r=>r?.unit===u.unit)??null})),versions:versions.map(publicVersion),registrations:registrations.slice(0,50),events:events.slice(0,50),alarms,manifest:await promptManifest(owner)};
}
