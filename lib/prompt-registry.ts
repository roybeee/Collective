import {ApiError,database,listRecords,readRecord,recordStatement,stamp,uid} from './server';
import {HttpBodyError,readBoundedJson} from './http-limits';
import {promptUnits,unitOf,unitFile,unitVersionId,versionUnit,canonicalBody,parseUnitFile,validateUnitBody,brandTermsFromCode,PromptUnitError,PROMPT_FILE_MAX_BYTES,type UnitBody} from './prompt-units';
import {channelSkillIds,type PromptSet,type RoleSkill} from './practice';
import type {Campaign,Artifact,Brand} from './agency';
import type {Publication} from './execution';
import type {Store} from './store-marketing';

// 프롬프트 레지스트리(F3a, 대표 결정 2·3). git prompts/가 정본이다. 소유자가 단위와 sourceSha를 지정하면 공개 저장소 raw 경로에서 그 SHA와 현재 main의 같은 파일을 가져와
// 본문이 같을 때만 불변 prompt_version으로 등록한다. 새 기계 자격증명·업로드 대체 경로는 없다. 활성화 게이트(평가 쌍 비교·대표 승인·지정 캠페인 staged)는 F3b다.
// 해석: 캠페인 단위로 한 번 고정(campaign_prompt_pin)하고 역할 실행·회의가 같이 쓴다. 비어 있거나 active가 없으면 코드 상수(바이트 동일), 조회 실패·손상은 코드 폴백 + fallback 표시.
export type Who={id:string;email:string|null};
export type PromptVersionRecord={id:string;unit:string;body:UnitBody;sha256:string;sourceSha:string;sourceMeta:{repo:string;path:string;mainRef:'main';fetchedAt:string};registeredBy:Who;registeredAt:string};
export type ReleaseEvent={action:'rollback'|'activate'|'stage';from:string|null;to:string|null;at:string;by:Who|null};
// active: 단위별 활성 버전 포인터. previous: 롤백 대상(없으면 롤백 시 코드 상수). targets·evalRunId·approvedBy는 F3b 활성화가 채운다(F3a 해석은 targets를 쓰지 않는다).
// stagedCampaignIds가 비어 있지 않으면 그 캠페인에만 적용한다(캠페인 없는 바이럴 학습에는 적용하지 않는다).
export type PromptRelease={id:string;unit:string;active:string|null;previous:string|null;targets:string[];stagedCampaignIds:string[];evalRunId:string|null;approvedBy:Who|null;updatedAt:string;history:ReleaseEvent[]};
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
 if(!r||typeof r!=='object'||!unitOf(r.unit)||r.id!==r.unit||!pointer(r.active)||!pointer(r.previous)||!strings(r.stagedCampaignIds)||!strings(r.targets)||!Array.isArray(r.history))throw new CorruptRecord();
 return r;
}
const releases=async(owner:string)=>(await listRecords<unknown>(owner,'prompt_release')).map(releaseShape);
const applies=(r:PromptRelease,campaignId?:string)=>!!r.active&&(!r.stagedCampaignIds.length||!!campaignId&&r.stagedCampaignIds.includes(campaignId));
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
  const units:Record<string,string>=pinned?pin.units:Object.fromEntries((await releases(owner)).filter(r=>unitOf(r.unit)?.kind!=='viral'&&applies(r,c.id)).map(r=>[r.unit,r.active!]));
  if(!Object.keys(units).length)return {source:'code',units:{}};
  const versions=await Promise.all(Object.entries(units).map(([unit,id])=>verifiedVersion(owner,unit,id)));
  if(!pinned)await recordStatement(owner,'campaign_prompt_pin',c.id,{id:c.id,campaignId:c.id,campaignVersion:c.version,units,promptVersion:joinVersions(Object.values(units)),pinnedAt:stamp()},c.id).run();
  return {source:'registry',units,set:toSet(versions)};
 }catch(error){return {source:'code',units:{},fallback:fallbackOf(error)}}
}
// 캠페인이 없는 단위(바이럴 발견 지시)의 해석. 지정 캠페인(staged)에만 적용하는 릴리스는 쓰지 않는다.
export async function resolveUnitPrompt(owner:string,unit:string):Promise<{versionId?:string;body?:UnitBody;fallback?:PromptFallback}>{
 try{
  const release=(await releases(owner)).find(r=>r.unit===unit&&applies(r));
  if(!release)return {};
  const v=await verifiedVersion(owner,unit,release.active!);
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
// 소유자 D1의 브랜드·지점 이름. 코드 시드 목록과 함께 브랜드 식별어로 막는다.
async function workspaceTerms(owner:string){
 const [brands,stores]=await Promise.all([listRecords<Brand>(owner,'brand'),listRecords<Store>(owner,'store')]);
 return [...brands.flatMap(b=>[b.name,...(typeof b.short==='string'&&b.short.length>=3?[b.short]:[])]),...stores.map(s=>s.name)].filter((t):t is string=>typeof t==='string');
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
 const next:PromptRelease={...release,active:to,previous:null,updatedAt:at,history:[...release.history,{action:'rollback' as const,from,to,at,by:who}].slice(-50)};
 const recheck=JSON.stringify({version:from,reason:'prompt_rollback',at});
 await database().batch([recordStatement(owner,'prompt_release',unit,next),
  ...impact.artifacts.map(a=>database().prepare("UPDATE records SET data=json_set(data,'$.promptRecheck',json(?)) WHERE id=? AND owner=? AND kind='artifact'").bind(recheck,`${owner}:artifact:${a.id}`,owner)),
  database().prepare("DELETE FROM records WHERE owner=? AND kind='campaign_prompt_pin' AND EXISTS (SELECT 1 FROM json_each(data,'$.units') WHERE value=?)").bind(owner,from)]);
 return {release:next,impact:{counts:impact.counts,artifacts:impact.artifacts.map(a=>a.id),publications:impact.publications.map(p=>p.id)}};
}
export async function promptRegistryAction(owner:string,input:Record<string,unknown>,who:Who){
 if(input.action==='register')return register(owner,input,who);
 if(input.action==='rollback')return rollback(owner,input,who);
 if(input.action==='activate'||input.action==='stage')throw new ApiError(409,'활성화·지정 캠페인 적용은 서버 평가 쌍 비교와 대표 승인이 필요합니다(F3b에서 제공). 지금은 등록·조회·롤백만 할 수 있습니다.');
 throw new ApiError(400,'지원하지 않는 프롬프트 레지스트리 작업입니다.');
}
// /api/version용 active 매니페스트 해시: 단위별 active 버전 목록(단위 순 정렬)의 sha256. active가 하나도 없으면 null이다.
export async function promptManifest(owner:string){
 const active=(await listRecords<PromptRelease>(owner,'prompt_release')).filter(r=>typeof r?.active==='string').map(r=>({unit:r.unit,active:r.active})).sort((a,b)=>a.unit.localeCompare(b.unit));
 return active.length?sha256Hex(JSON.stringify(active)):null;
}
export async function promptRegistryRead(owner:string,params:URLSearchParams){
 const impact=params.get('impact'),version=params.get('version');
 if(impact)return promptImpact(owner,versionIdOf(impact));
 if(version)return {version:await readRecord<PromptVersionRecord>(owner,'prompt_version',versionIdOf(version))};
 const [versions,rels,registrations]=await Promise.all([listRecords<PromptVersionRecord>(owner,'prompt_version'),listRecords<PromptRelease>(owner,'prompt_release'),listRecords<object>(owner,'prompt_registration')]);
 return {units:promptUnits.map(u=>({...u,file:'prompts/'+unitFile(u.unit),release:rels.find(r=>r?.unit===u.unit)??null})),versions:versions.map(publicVersion),registrations:registrations.slice(0,50),manifest:await promptManifest(owner)};
}
