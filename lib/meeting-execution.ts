import {markUsageOutcomeSafely as markUsageOutcome} from './usage-outcome';
import {brandArchiveContext} from '@/lib/archive-server';
import {PRACTICE_VERSION,campaignPractice} from '@/lib/practice';
import {qualityMarkdown} from '@/lib/quality';
import {roles,type Campaign,type Brand,type Artifact,type Metric} from '@/lib/agency';
import type {BriefDraft} from '@/lib/brief';
import {initialSteps,meetingActive,publicMeeting,parseMeetingOutput,meetingInstructions,candidateArtifacts,allowedRespondsTo,type Meeting,type MeetingStep,type Contribution,type Synthesis,type Revision,type QualityReview} from '@/lib/meetings';
import {meetingSubmissionId,requireMeetingWorker,retryFailedMeeting} from './meeting-repair';
import {learningContext} from '@/lib/learning-server';
import {hermesSubmissionStatement,submitHermes,pollHermes} from '@/lib/hermes';
import {ApiError,identity,str,json,failure,database,readRecord,listRecords,recordStatement,eventStatement,connection,acquireLock,releaseLock,stamp} from '@/lib/server';

const activeStates=['starting','queued','in_progress','uncertain'];
const jobId=(owner:string,m:Meeting)=>owner+':meeting:'+m.id;
function writes(owner:string,m:Meeting){
 const status=m.status==='running'?'in_progress':m.status;
 return [recordStatement(owner,'team_meeting',m.id,m,m.campaignId),database().prepare('UPDATE jobs SET status=?,error=?,tokens=?,updated_at=? WHERE owner=? AND id=?').bind(status,m.error||null,m.steps.reduce((n,s)=>n+(s.tokens||0)+(s.attempts||[]).reduce((total,a)=>total+(a.tokens||0),0),0),m.updatedAt,owner,jobId(owner,m))];
}
function context(m:Meeting,s:MeetingStep){
 const snapshot=m.snapshot;
 return {skillVersion:m.skillVersion,channelPractice:campaignPractice(snapshot.campaign),agenda:m.agenda,role:s.role,phase:s.phase,allowedRespondsTo:allowedRespondsTo(s,m.steps),correction:s.correction,brand:snapshot.brand,brandArchive:snapshot.brandArchive,campaign:snapshot.campaign,trialLearning:snapshot.learning,recordedMetrics:snapshot.metrics,previousMeeting:snapshot.previous,
  originalArtifacts:snapshot.artifacts.map(a=>({...a,content:a.content.slice(0,8000),excerpt:a.content.length>8000})),
  discussion:m.steps.filter(t=>t.phase==='discussion'&&t.status==='completed').map(t=>({id:t.id,role:t.role,...t.output})),
  synthesis:m.steps.find(t=>t.phase==='synthesis')?.output,
  completedRevisions:m.steps.filter(t=>t.phase==='revision'&&t.status==='completed').map(t=>({role:t.role,...t.output})),
  task:s.task,...(s.phase==='quality'?{candidateArtifacts:candidateArtifacts(m).artifacts,invalidatedRoles:candidateArtifacts(m).invalidatedRoles}:{})};
}
async function finish(owner:string,m:Meeting){
 const c=await readRecord<Campaign>(owner,'campaign',m.campaignId);
 const current=(await listRecords<Artifact>(owner,'artifact',c.id)).filter(a=>a.status!=='outdated');
 const signature=(aa:Artifact[])=>JSON.stringify(aa.map(a=>[a.id,a.version,a.status]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
 if(c.version!==m.campaignVersion||signature(current)!==signature(m.snapshot.artifacts))throw new ApiError(409,'회의 중 기준 자료가 변경되어 수정본을 반영하지 않았습니다. 최신 자료로 후속 회의를 시작해 주세요.');
 const changes=m.steps.filter(s=>s.phase==='revision');
 const quality=m.steps.find(s=>s.phase==='quality')!.output as QualityReview;
 const first=Math.min(...changes.map(s=>roles.findIndex(r=>r.id===s.role)));
 const changedRoles=new Set([...changes.map(s=>s.role),'quality']);
 const statements:D1PreparedStatement[]=[];
 for(const a of current){
  if(changedRoles.has(a.role)||roles.findIndex(r=>r.id===a.role)>=first){
   statements.push(recordStatement(owner,'history',`${m.id}:${a.id}:${a.version}`,{...a,id:`${m.id}:${a.id}:${a.version}`,originalId:a.id},c.id));
   if(!changedRoles.has(a.role))statements.push(recordStatement(owner,'artifact',a.id,{...a,status:'outdated'},c.id));
  }
 }
 for(const s of [...changes,m.steps.find(s=>s.phase==='quality')!]){
  const old=current.find(a=>a.role===s.role);const id=old?.id||`meeting-${m.id}-${s.role}`;
  const result=s.output as Revision;
  const content=s.phase==='quality'?qualityMarkdown(quality):result.content;
  const a={skillVersion:m.skillVersion,...(s.phase==='quality'?{qualityReview:quality}:{}),id,campaignId:c.id,campaignVersion:c.version,role:s.role,title:s.phase==='quality'?'팀 회의 · 품질 재검토':result.title,content,version:(old?.version||0)+1,status:'review',origin:'ai',createdAt:stamp(),meetingId:m.id};
  // Multiple manual artifacts for one role are retained as previous versions.
  for(const duplicate of current.filter(a=>a.role===s.role&&a.id!==old?.id))statements.push(recordStatement(owner,'artifact',duplicate.id,{...duplicate,status:'outdated'},c.id));
  statements.push(recordStatement(owner,'artifact',id,a,c.id));m.artifactIds.push(id);
 }
 m.invalidatedRoles=candidateArtifacts(m).invalidatedRoles;m.status='completed';m.updatedAt=stamp();m.error=undefined;
 statements.push(...writes(owner,m),recordStatement(owner,'campaign',c.id,{...c,status:quality.verdict==='ready_for_review'&&!m.invalidatedRoles.length?'review':'revision',updatedAt:stamp()}),eventStatement(owner,c.id,`팀 회의 완료 · ${changes.length}개 담당 개선본과 품질 재검토를 저장했습니다.`));
 await database().batch(statements);
}

export async function GET(req:Request){try{
 const owner=identity(req),id=str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true);await readRecord<Campaign>(owner,'campaign',id);
 return json({meetings:(await listRecords<Meeting>(owner,'team_meeting',id)).map(publicMeeting)});
}catch(e){return failure(e)}}

export async function executeMeeting(owner:string,b:Record<string,unknown>){let lock='',prepared:Meeting|undefined,recovering=false;
 try{
 lock=await acquireLock(owner);
  const id=str(b.id,'회의',100,true);if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new ApiError(400,'회의 번호가 올바르지 않습니다.');
  if(b.action==='start'){
   const existing=(await listRecords<Meeting>(owner,'team_meeting')).find(m=>m.id===id);
   if(existing){if(existing.campaignId!==b.campaignId)throw new ApiError(409,'다른 캠페인에서 사용한 회의 번호입니다.');return json(publicMeeting(existing))}
   const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'팀 회의는 HERMES 연결이 필요합니다. 연결 및 설정을 확인하세요.');
   await requireMeetingWorker(owner);
   const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));if(c.version!==b.campaignVersion)throw new ApiError(409,'캠페인이 변경됐습니다. 최신 브리프에서 회의를 시작하세요.');
   const busy=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain')").bind(owner,c.id).first();if(busy)throw new ApiError(409,'이 캠페인에서 AI 작업 또는 회의가 진행 중입니다. 먼저 완료하거나 중지해 주세요.');
   const drafts=await listRecords<BriefDraft>(owner,'brief_draft');if(drafts.some(d=>(d.campaignId===c.id||d.savedCampaignId===c.id)&&activeStates.includes(d.status)))throw new ApiError(409,'캠페인 초안 작성이 진행 중입니다. 먼저 완료하거나 중지해 주세요.');
   const brand=await readRecord<Brand>(owner,'brand',c.brandId),artifacts=(await listRecords<Artifact>(owner,'artifact',c.id)).filter(a=>a.status!=='outdated');
   if(artifacts.length>80)throw new ApiError(400,'현재 작업물이 너무 많습니다. 캠페인을 나누어 회의 범위를 정해 주세요.');
   const metrics=(await listRecords<Metric>(owner,'metric',c.id)).slice(0,6),learning=await learningContext(owner,c);
   let previous:Meeting|undefined;
   if(b.previousMeetingId){previous=await readRecord<Meeting>(owner,'team_meeting',str(b.previousMeetingId,'이전 회의',100,true));if(previous.campaignId!==c.id||meetingActive(previous))throw new ApiError(409,'완료 또는 종료된 같은 캠페인의 회의만 이어갈 수 있습니다.')}
   const previousFailure=previous?.steps.find(s=>s.status==='failed');
   const m:Meeting={skillVersion:PRACTICE_VERSION,id,campaignId:c.id,campaignVersion:c.version,agenda:str(b.agenda,'회의 안건',5000,true),status:'running',steps:initialSteps(id),createdAt:stamp(),updatedAt:stamp(),model:cfg.model,stopRequested:false,artifactIds:[],invalidatedRoles:[],previousMeetingId:previous?.id,snapshot:{brandArchive:await brandArchiveContext(owner,c.brandId,c.storeId),campaign:c,brand,artifacts,metrics,learning,...(previous?{previous:{id:previous.id,agenda:previous.agenda,decisions:previous.steps.find(s=>s.phase==='synthesis')?.output as Synthesis,quality:previous.steps.find(s=>s.phase==='quality')?.output as QualityReview,discussion:previous.steps.filter(s=>s.phase==='discussion'&&s.status==='completed').map(s=>({id:s.id,role:s.role,output:s.output as Contribution})),...(previousFailure?{failure:{role:previousFailure.role,phase:previousFailure.phase,error:previousFailure.error||previous.error||'응답 검증 실패'}}:{})}}:{})}};
   await database().batch([database().prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(jobId(owner,m),owner,c.id,'meeting','in_progress',cfg.model,c.version,m.createdAt,m.updatedAt),recordStatement(owner,'team_meeting',m.id,m,c.id),eventStatement(owner,c.id,'팀 회의를 시작했습니다. 8명 의견 교환 → 개선 과제 → 품질 재검토.')]);
   return json(publicMeeting(m));
  }
  if(!['advance','recover','cancel','retry_failed'].includes(String(b.action)))throw new ApiError(400,'지원하지 않는 회의 작업입니다.');
  const m=await readRecord<Meeting>(owner,'team_meeting',id);
  if(b.action==='retry_failed'){
   const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'회의를 시작한 HERMES 연결이 필요합니다.');
   const retried=await retryFailedMeeting(owner,m,b);
   await database().batch(writes(owner,retried));return json(publicMeeting(retried));
  }
  if(!meetingActive(m))return json(publicMeeting(m));
  const s=m.steps.find(s=>s.status!=='completed');if(!s)throw new ApiError(409,'회의 진행 상태를 확인해 주세요.');
  if(b.action==='cancel'){m.stopRequested=true;m.updatedAt=stamp();await database().batch(writes(owner,m))}
  if(m.stopRequested&&s.status==='pending'){m.status='cancelled';m.updatedAt=stamp();await database().batch(writes(owner,m));return json(publicMeeting(m))}
  const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'회의를 시작한 HERMES 연결이 필요합니다.');
  if(s.status==='pending'){
   if(m.steps.length>13)throw new ApiError(409,'회의의 최대 실행 범위를 초과했습니다.');
   s.status='starting';s.startedAt=stamp();m.updatedAt=stamp();m.error=undefined;
   const correction=s.correction?'\n이전 응답은 검증에 실패했습니다. correction.error를 고치고, allowedRespondsTo의 실제 ID만 사용하세요. 요청 선택지를 묻지 말고 이 단계의 완성된 결과를 반환하세요.':'';
   await database().batch([...writes(owner,m),hermesSubmissionStatement(owner,meetingSubmissionId(s),{instructions:meetingInstructions(s,!!m.skillVersion)+correction,input:JSON.stringify(context(m,s))},m.campaignId)]);
   prepared=m;
   const r=await submitHermes(owner,meetingSubmissionId(s),cfg);s.providerId=r.id;s.status='running';m.status='running';m.updatedAt=stamp();
   await database().batch(writes(owner,m));return json(publicMeeting(m));
  }
  if(!s.providerId){
   if(b.action!=='recover'){s.status='uncertain';m.status='uncertain';m.error='HERMES 접수 여부를 확인해야 합니다. 기존 요청 확인을 누르면 같은 요청으로 복구합니다.';m.updatedAt=stamp();await database().batch(writes(owner,m));return json(publicMeeting(m))}
   recovering=true;prepared=m;const r=await submitHermes(owner,meetingSubmissionId(s),cfg);s.providerId=r.id;s.status='running';m.status='running';m.error=undefined;m.updatedAt=stamp();await database().batch(writes(owner,m));return json(publicMeeting(m));
  }
  const result=await pollHermes(cfg,s.providerId,m.stopRequested,30000,owner);
  m.updatedAt=stamp();m.error=undefined;m.status='running';s.status='running';if(['completed','cancelled','failed'].includes(result.status))s.tokens=Number.isSafeInteger(result.usage.total_tokens)?Math.max(0,result.usage.total_tokens):s.tokens;
  if(m.stopRequested){
   if(['completed','cancelled','failed'].includes(result.status)){s.status='cancelled';m.status='cancelled';await markUsageOutcome(owner,'hermes',s.providerId,result.invalidOutput?'invalid_output':'cancelled')}
   await database().batch(writes(owner,m));return json(publicMeeting(m));
  }
  if(result.status==='completed'){
   s.raw=result.output[0].content[0].text;s.tokens=result.usage.total_tokens;
   try{s.output=parseMeetingOutput(s.raw!,s,m.steps,!!m.skillVersion,candidateArtifacts(m).invalidatedRoles);s.status='completed';s.completedAt=stamp()}
   catch(e){await markUsageOutcome(owner,'hermes',s.providerId,'invalid_output');s.status='failed';s.failureKind='invalid_output';s.completedAt=stamp();s.error=(e as Error).message;m.status='failed';m.error=s.error;await database().batch(writes(owner,m));return json(publicMeeting(m))}
   if(s.phase==='synthesis'){
    const tasks=(s.output as Synthesis).tasks;
    m.steps.push(...tasks.map(t=>({id:`${m.id}:revision:${t.role}`,role:t.role,phase:'revision' as const,status:'pending' as const,task:t})),{id:`${m.id}:quality`,role:'quality',phase:'quality',status:'pending'});
   }
   if(s.phase==='quality'){
    try{await finish(owner,m)}catch(e){if(!(e instanceof ApiError))throw e;m.status='failed';m.error=e.message;await database().batch(writes(owner,m))}
   }else await database().batch(writes(owner,m));
   await markUsageOutcome(owner,'hermes',s.providerId,m.status==='failed'?'storage_failed':'completed');
  }else if(result.status==='failed'||result.status==='cancelled'){
   await markUsageOutcome(owner,'hermes',s.providerId,result.invalidOutput?'invalid_output':result.status==='cancelled'?'cancelled':'provider_failed');s.status=result.status;s.failureKind=result.invalidOutput?'invalid_output':'provider_failed';s.completedAt=stamp();s.error=result.invalidOutput?'응답 본문: 올바른 텍스트 형식이 아닙니다.':undefined;m.status=result.status;m.error=s.error||'담당자 작업이 종료되어 회의를 멈췄습니다. 기록을 바탕으로 후속 회의를 시작할 수 있습니다.';await database().batch(writes(owner,m));
  }else await database().batch(writes(owner,m));
  return json(publicMeeting(m));
 }catch(e){
  if(prepared){
   const s=prepared.steps.find(s=>s.status!=='completed')!;
   const unknown=recovering||!(e instanceof ApiError)||e.status>=500;
   s.status=unknown?'uncertain':'failed';prepared.status=unknown?'uncertain':'failed';prepared.error=unknown?'HERMES 접수 확인이 필요합니다. 기존 요청 확인으로 복구하세요.':(e as Error).message;prepared.updatedAt=stamp();await database().batch(writes(owner,prepared));return json(publicMeeting(prepared));
  }
  return failure(e);
 }finally{if(lock)await releaseLock(owner,lock)}
}
