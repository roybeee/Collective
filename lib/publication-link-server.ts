import {ApiError,str,stamp,json,readRecord,listRecords,recordStatement,database,decrypt,acquireLock,releaseLock} from './server';
import {authEnv} from './auth-session';
import {isEnabled} from './feature-flags';
import {inspectBuffer} from './publisher-buffer';
import {koreaDay,providerPublicationStatus,type Publication} from './execution';
import {externalMediaReview,optionalRecord,publicationKeepingReview,retireMedia,type PublisherCredential} from './execution-server';
import {channelNameForConnector} from './channels';
import {COLLECT_INTERVAL_MS} from './measurement-status';
import type {Campaign} from './agency';
import type {ViralExperiment} from './learning';
import type {MeasurementSource} from './measurement-collection';

// loop-2: 발행(execution_publication)을 바이럴 실험의 한 안(arm)과 잇고, 게시된 Instagram 게시물 ID를 받아 loop-1 자동 수집 대상(measurement_source)으로 넘긴다.
// - 연결 필드 이름은 학습 규칙·보상 계보와 같은 experimentId를 쓴다. 안은 arm(control|treatment)이다.
// - Buffer 게시 조회가 주는 필드는 id·status·channelId뿐이라(lib/publisher-buffer.ts inspectBuffer, 공급자 문서의 PostStatus) Instagram 게시물 ID는 관리자가 게시 확인 뒤 한 번 입력한다.
// - 스위치 publication_auto_link(기본 꺼짐)가 켜지면 워커 tick(lib/background-execution.ts)이 예약 접수 발행의 Buffer 상태를 30분마다 확인하고,
//   게시 확인·실험 연결·게시물 ID가 모두 있는 발행을 자동 수집 대상으로 등록한다. 꺼지면 워커는 발행을 읽지도 Buffer를 부르지도 않는다.
export type Arm='control'|'treatment';
export type ExperimentLink={experimentId:string;arm:Arm};
const ARMS:readonly Arm[]=['control','treatment'];
const INSTAGRAM=channelNameForConnector('instagram');
// 워커가 같은 발행의 Buffer 상태를 다시 보는 최소 간격과 확인 기간(예약 1시간 전 ~ 7일 뒤). 기간 밖은 화면의 '실제 게시 상태 조회'로 확인한다.
export const PUBLICATION_CHECK_MS=30*60000;
const CHECK_BEFORE_MS=3600000,CHECK_AFTER_MS=7*86400000;
// 연결을 막는 발행 상태. 취소·실패한 발행은 새 연결을 받지 않고 같은 안의 중복 판정에서도 뺀다.
const CLOSED=['cancelled','failed'];
const armLabel=(arm:Arm)=>arm==='control'?'대조안':'실험안';

export async function autoLinkEnabled(owner:string){try{return await isEnabled(owner,'publication_auto_link')}catch{return false}}

// 같은 캠페인·브랜드의 진행 중 Instagram 실험만 연결한다. 한 실험 안에는 살아 있는 발행 하나만 잇는다(두 게시물이 한 안의 수치를 나누지 않게).
export async function experimentLinkFor(owner:string,campaign:Pick<Campaign,'id'|'brandId'>,raw:unknown,publicationId?:string):Promise<ExperimentLink>{
 const input=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
 if(!input)throw new ApiError(400,'연결할 실험과 안을 선택하세요.');
 const arm=ARMS.find(a=>a===input.arm);
 if(!arm)throw new ApiError(400,'대조안 또는 실험안을 선택하세요.');
 const experiment=await readRecord<ViralExperiment>(owner,'viral_experiment',str(input.experimentId,'실험',200,true));
 if(experiment.campaignId!==campaign.id||experiment.brandId!==campaign.brandId)throw new ApiError(400,'이 캠페인의 실험만 발행에 연결할 수 있습니다.');
 if(experiment.channel!==INSTAGRAM)throw new ApiError(400,`Buffer 발행은 Instagram 게시물입니다. ${experiment.channel} 실험에는 연결할 수 없습니다.`);
 if(experiment.status!=='running')throw new ApiError(409,'진행 중인 실험에만 발행을 연결할 수 있습니다. 실험 계획을 확정(측정 시작)한 뒤 연결하세요.');
 const taken=(await listRecords<Publication>(owner,'execution_publication',campaign.id)).find(p=>p.id!==publicationId&&p.experimentId===experiment.id&&p.arm===arm&&!CLOSED.includes(p.status));
 if(taken)throw new ApiError(409,`이 실험의 ${armLabel(arm)}에는 이미 다른 발행이 연결돼 있습니다. 그 발행의 연결을 먼저 해제하세요.`);
 return {experimentId:experiment.id,arm};
}

const withLink=(p:Publication,link:ExperimentLink|null):Publication=>{const {experimentId,arm,...rest}=p;void experimentId;void arm;return link?{...rest,experimentId:link.experimentId,arm:link.arm}:rest};

// 발행 준비(save_publication) 직후: 방금 만든 초안(판 1)에 연결을 붙인다. 검증은 준비 전에 끝냈다.
export async function attachLink(owner:string,campaignId:string,p:Publication,link:ExperimentLink){
 const linked=withLink(p,link);await recordStatement(owner,'execution_publication',p.id,linked,campaignId).run();return linked;
}

// link_experiment(관리자): 연결하거나(experiment 객체) 해제한다(experiment:null). 게시된 발행이면 자동 수집 대상 등록을 시도한다(스위치).
export async function linkExperiment(owner:string,campaign:Campaign,p:Publication,raw:unknown){
 if(CLOSED.includes(p.status))throw new ApiError(409,'취소·실패한 발행은 실험에 연결할 수 없습니다.');
 const link=raw===null?null:await experimentLinkFor(owner,campaign,raw,p.id);
 const updated:Publication={...withLink(p,link),version:p.version+1,updatedAt:stamp()};
 await publicationKeepingReview(owner,updated,campaign.id).run();
 return {publication:updated,measurementSource:await registerIfEnabled(owner,updated)};
}

// Instagram 게시물 ID는 숫자다(lib/connectors/instagram.ts collect와 같은 규칙). 주소는 instagram.com의 게시물·릴스 주소만 받는다(열지 않는다).
function mediaInput(input:Record<string,unknown>){
 const mediaId=str(input.mediaId,'Instagram 게시물 ID',30,true);
 if(!/^\d{1,30}$/.test(mediaId))throw new ApiError(400,'Instagram 게시물 ID는 숫자입니다. 게시물 인사이트나 Graph API의 미디어 ID를 입력하세요.');
 const raw=str(input.permalink??'','게시물 주소',300);
 if(!raw)return {mediaId};
 let url:URL;try{url=new URL(raw)}catch{throw new ApiError(400,'게시물 주소를 확인하세요.')}
 if(url.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(url.hostname)||!/^\/(p|reel|tv)\/[\w-]+\/?$/.test(url.pathname))throw new ApiError(400,'게시물 주소는 https://www.instagram.com/p/… 또는 /reel/… 형식이어야 합니다.');
 return {mediaId,permalink:`https://www.instagram.com${url.pathname}`};
}

// link_media(관리자): 게시 확인된 발행에 Instagram 게시물 ID(·주소)를 한 번 적는다. 다른 발행이 이미 쓴 게시물 ID는 받지 않는다.
export async function linkMedia(owner:string,campaign:Campaign,p:Publication,input:Record<string,unknown>,who:{id:string}){
 if(p.status!=='published')throw new ApiError(409,'게시 확인된 발행에만 Instagram 게시물 ID를 적을 수 있습니다. 먼저 실제 게시 상태를 조회하세요.');
 const media=mediaInput(input);
 const others=await database().prepare("SELECT id FROM records WHERE owner=? AND kind='execution_publication' AND id<>? AND json_extract(data,'$.media.mediaId')=? LIMIT 1").bind(owner,`${owner}:execution_publication:${p.id}`,media.mediaId).first<{id:string}>();
 if(others)throw new ApiError(409,'이 Instagram 게시물 ID는 다른 발행에 이미 연결돼 있습니다.');
 const updated:Publication={...p,media:{...media,linkedBy:who.id,linkedAt:stamp()},version:p.version+1,updatedAt:stamp()};
 await publicationKeepingReview(owner,updated,campaign.id).run();
 return {publication:updated,measurementSource:await registerIfEnabled(owner,updated)};
}

export type SourceRegistration={status:'registered'|'exists'|'conflict'|'not_ready'|'experiment_closed'|'switch_off';message:string};
async function registerIfEnabled(owner:string,p:Publication):Promise<SourceRegistration>{
 if(!(await autoLinkEnabled(owner)))return {status:'switch_off',message:'자동 수집 대상 등록 스위치(publication_auto_link)가 꺼져 있습니다. 실험 카드의 성과 가져오기로 이 게시물 ID를 수집할 수 있습니다.'};
 return registerSource(owner,p);
}

// 게시 확인·실험 연결·게시물 ID가 모두 있으면 그 안의 자동 수집 대상(id <실험>:<안>)을 만든다. 이미 있으면 쓰지 않는다(같은 게시물 중복 등록 0).
// 첫 수집은 다음 워커 tick이 한다(마지막 수집 시각을 수집 간격만큼 앞당겨 둔다). 기간은 예약일(한국 날짜)부터 롤링이다(Instagram 값은 누적이라 기간이 값에 영향을 주지 않는다).
export async function registerSource(owner:string,p:Publication):Promise<SourceRegistration>{
 if(p.status!=='published'||!p.experimentId||!p.arm||!p.media)return {status:'not_ready',message:'게시 확인·실험 연결·Instagram 게시물 ID가 모두 있어야 자동 수집 대상을 만듭니다.'};
 const experiment=await optionalRecord<ViralExperiment>(owner,'viral_experiment',p.experimentId);
 if(!experiment||experiment.status!=='running')return {status:'experiment_closed',message:'연결한 실험이 진행 중이 아니어서 자동 수집 대상을 만들지 않았습니다.'};
 const id=`${p.experimentId}:${p.arm}`,existing=await optionalRecord<MeasurementSource>(owner,'measurement_source',id);
 if(existing)return existing.target===p.media.mediaId?{status:'exists',message:'이 게시물은 이미 자동 수집 대상입니다.'}:{status:'conflict',message:`이 실험의 ${armLabel(p.arm)}은 다른 대상(${existing.target})으로 수집 중입니다. 실험 카드에서 확인하세요.`};
 const from=koreaDay(p.scheduledAt),yesterday=koreaDay(new Date(Date.now()-86400000).toISOString());
 const source:MeasurementSource={id,experimentId:p.experimentId,channel:'instagram',arm:p.arm,target:p.media.mediaId,window:{from,to:yesterday>from?yesterday:from},lastFetchedAt:new Date(Date.now()-COLLECT_INTERVAL_MS).toISOString(),lastError:null,rolling:true,publicationId:p.id,pending:true};
 await recordStatement(owner,'measurement_source',id,source,p.experimentId).run();
 return {status:'registered',message:'자동 수집 대상으로 등록했습니다. 다음 워커 실행 때 성과를 가져옵니다.'};
}

// 화면 선택지: 이 캠페인의 진행 중 Instagram 실험과 안별로 이미 연결된 발행.
export async function experimentLinkOptions(owner:string,campaign:Pick<Campaign,'id'|'brandId'>){
 const experiments=(await listRecords<ViralExperiment>(owner,'viral_experiment',campaign.id)).filter(e=>e.status==='running'&&e.channel===INSTAGRAM&&e.brandId===campaign.brandId);
 return experiments.map(e=>({id:e.id,title:e.title}));
}

type PublicationCheck={id:string;publicationId:string;checkedAt:string;status?:string;error?:string};
const inWindow=(p:Publication,now:number)=>{const t=Date.parse(p.scheduledAt);return t-CHECK_BEFORE_MS<=now&&now<=t+CHECK_AFTER_MS};

// 워커 작업 목록(lib/background-execution.ts pendingWork). 스위치가 꺼지면 발행 기록도 읽지 않는다.
export async function publicationWork(owner:string):Promise<{id:string;run:()=>Promise<Response>}[]>{
 if(!(await autoLinkEnabled(owner)))return [];
 const [rows,checks,sources]=await Promise.all([
  database().prepare("SELECT data FROM records WHERE owner=? AND kind='execution_publication' AND json_extract(data,'$.status') IN ('accepted','published')").bind(owner).all<{data:string}>(),
  listRecords<PublicationCheck>(owner,'publication_check'),listRecords<MeasurementSource>(owner,'measurement_source'),
 ]);
 const now=Date.now(),recent=(id:string)=>checks.some(c=>c.publicationId===id&&now-Date.parse(c.checkedAt)<PUBLICATION_CHECK_MS);
 return rows.results.map(r=>JSON.parse(r.data) as Publication).filter(p=>!recent(p.id)&&(
  p.status==='accepted'&&!!p.providerId&&inWindow(p,now)||
  p.status==='published'&&!!p.experimentId&&!!p.arm&&!!p.media&&!sources.some(s=>s.id===`${p.experimentId}:${p.arm}`)
 )).map(p=>({id:'publication:'+p.id,run:()=>checkPublication(owner,p.id)}));
}

// 발행 하나: 예약 접수면 Buffer 상태를 확인하고(화면 '실제 게시 상태 조회'와 같은 판정), 게시 확인이면 자동 수집 대상을 등록한다.
// 결과는 publication_check에 남기고 30분 안에는 다시 보지 않는다. Buffer·계정 문제는 기록만 하고 성공으로 돌려 재시도 폭주를 막는다.
export async function checkPublication(owner:string,id:string){
 let p=await readRecord<Publication>(owner,'execution_publication',id),error:string|undefined;
 if(p.status==='accepted'&&p.providerId){
  const campaign=await readRecord<Campaign>(owner,'campaign',p.campaignId),credential=await optionalRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId);
  if(!credential||credential.channelId!==p.channelId)error='원래 발행 계정 연결이 없어 상태를 확인하지 않았습니다.';
  else try{
   const remote=await inspectBuffer(await decrypt(credential.secret),p.providerId);
   if(remote.channelId!==p.channelId)error='공급자 게시 계정이 다릅니다.';
   else if(providerPublicationStatus(remote.status)!==p.status)p=await saveStatus(owner,campaign,p,remote.status);
  }catch(e){error=e instanceof ApiError?e.message:'Buffer 게시 상태를 확인하지 못했습니다.'}
 }
 const registration=p.status==='published'?await locked(owner,()=>registerSource(owner,p)):null;
 await recordStatement(owner,'publication_check',p.id,{id:p.id,publicationId:p.id,checkedAt:stamp(),status:p.status,...(error?{error}:{}),...(registration?{registration:registration.status}:{})},p.campaignId).run();
 return json({status:p.status,...(registration?{registration:registration.status}:{})});
}

async function locked<T>(owner:string,work:()=>Promise<T>){const lock=await acquireLock(owner);try{return await work()}finally{await releaseLock(owner,lock)}}
// 상태가 바뀔 때만 발행을 다시 쓴다(판 +1). 잠금 안에서 다시 읽어 그 사이 사람이 바꿨으면 쓰지 않는다.
async function saveStatus(owner:string,campaign:Campaign,read:Publication,providerStatus:string){
 const lock=await acquireLock(owner);
 try{
  const p=await readRecord<Publication>(owner,'execution_publication',read.id);
  if(p.version!==read.version||p.status!=='accepted')return p;
  const status=providerPublicationStatus(providerStatus),origin=authEnv.AUTH_ORIGIN,review=origin?await externalMediaReview(p,status,origin):undefined;
  const updated:Publication={...p,status,providerStatus,...(review?{needsReview:review}:{}),version:p.version+1,updatedAt:stamp()};
  await publicationKeepingReview(owner,updated,campaign.id).run();
  if(status==='failed')await retireMedia(owner,[p]);
  return updated;
 }finally{await releaseLock(owner,lock)}
}
