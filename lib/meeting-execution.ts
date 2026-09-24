import {markUsageOutcomeSafely as markUsageOutcome} from './usage-outcome';
import {brandArchiveContext} from '@/lib/archive-server';
import {PRACTICE_VERSION,campaignPractice} from '@/lib/practice';
import {qualityMarkdown} from '@/lib/quality';
import {roles,aiBudget,type Campaign,type Brand,type Artifact,type Metric} from '@/lib/agency';
import type {BriefDraft} from '@/lib/brief';
import {initialSteps,meetingActive,publicMeeting,parseMeetingStep,meetingInstructions,candidateArtifacts,respondsToHandles,discussionRef,meetingAgenda,meetingLabels,artifactRef,type Meeting,type MeetingStep,type Contribution,type Synthesis,type Revision,type QualityReview} from '@/lib/meetings';
import {labelArchive} from '@/lib/role-output';
import {claimGuard,unverifiedClaims} from '@/lib/campaign-policy';
import {sameEvidenceFactRefs} from '@/lib/brand-facts';
import {meetingSubmissionId,requireMeetingWorker,retryFailedMeeting,meetingBasis,meetingStale,type MeetingBasis} from './meeting-repair';
import {learningContext} from '@/lib/learning-server';
import {gradeMeetingArtifacts} from './online-grading';
import {aiBrand,evidenceContext,currentFactRefs} from '@/lib/ai-context';
import {hermesSubmissionStatement,submitHermes,pollHermes} from '@/lib/hermes';
import type {UsageContext} from '@/lib/usage-ledger';
// 프롬프트 레지스트리(F3a): 역할 실행과 같은 공용 해석기로 회의 시작 때 캠페인 해석을 스냅샷에 고정한다.
import {resolveCampaignPrompts,runPromptVersion,roleRunUnits,joinVersions,f2aPromptVersion} from './prompt-registry';
import {ApiError,identity,str,json,failure,database,readRecord,listRecords,recordStatement,eventStatement,connection,acquireLock,releaseLock,stamp,type EventActor} from '@/lib/server';

const activeStates=['starting','queued','in_progress','uncertain'];
const jobId=(owner:string,m:Meeting)=>owner+':meeting:'+m.id;
function writes(owner:string,m:Meeting){
 const status=m.status==='running'?'in_progress':m.status;
 return [recordStatement(owner,'team_meeting',m.id,m,m.campaignId),database().prepare('UPDATE jobs SET status=?,error=?,tokens=?,updated_at=? WHERE owner=? AND id=?').bind(status,m.error||null,m.steps.reduce((n,s)=>n+(s.tokens||0)+(s.attempts||[]).reduce((total,a)=>total+(a.tokens||0),0),0),m.updatedAt,owner,jobId(owner,m))];
}
// 사용량 조인 키(F2a). 회의 시작 때 고정한 스냅샷의 캠페인·스킬 버전을 쓴다. 회의 산출물 계약 버전은 따로 없어 null이다.
// 레지스트리 단위를 쓴 단계는 그 버전(unit@sha256 앞 12자)을 promptVersion으로, 조회 실패·손상 폴백은 promptFallback으로 남긴다.
const meetingUsage=(owner:string,m:Meeting,s:MeetingStep):UsageContext=>({kind:'meeting',submissionId:meetingSubmissionId(s),jobId:jobId(owner,m),campaignId:m.campaignId,campaignVersion:m.campaignVersion,brandId:m.snapshot?.campaign?.brandId??null,storeId:m.snapshot?.campaign?.storeId??null,role:s.role,skillVersion:m.skillVersion??null,...(m.snapshot?.prompts?.source==='registry'&&s.promptVersion?.includes('@')?{promptVersion:s.promptVersion}:{}),...(m.snapshot?.prompts?.fallback?{promptFallback:m.snapshot.prompts.fallback}:{})});
// 단계 제출의 promptVersion: 이 단계 역할·채널의 레지스트리 단위가 있으면 그 버전, 없으면 F2a 규칙(스킬 버전:지시 해시).
async function stepPromptVersion(m:Meeting,s:MeetingStep,instructions:string){return runPromptVersion({units:m.snapshot.prompts?.units||{}},roleRunUnits(s.role,m.snapshot.campaign))??f2aPromptVersion(m.skillVersion,instructions)}
function context(m:Meeting,s:MeetingStep){
 const snapshot=m.snapshot,ref=(id:string)=>discussionRef(m.steps.find(t=>t.id===id)?.role||'');
 return {skillVersion:m.skillVersion,channelPractice:campaignPractice(snapshot.campaign,snapshot.prompts?.set?.channels),agenda:m.agenda,role:s.role,phase:s.phase,allowedRespondsTo:respondsToHandles(s,m.steps),correction:s.correction,brand:aiBrand(snapshot.brand),...(snapshot.evidence?{evidence:{facts:snapshot.evidence.facts,directives:snapshot.evidence.directives}}:{}),brandArchive:snapshot.brandArchive&&labelArchive(snapshot.brandArchive),campaign:{...snapshot.campaign,...aiBudget(snapshot.campaign)},trialLearning:snapshot.learning,recordedMetrics:snapshot.metrics,previousMeeting:snapshot.previous,
  originalArtifacts:snapshot.artifacts.map(a=>({ref:artifactRef(a),...a,content:a.content.slice(0,8000),excerpt:a.content.length>8000})),
  discussion:m.steps.filter(t=>t.phase==='discussion'&&t.status==='completed').map(t=>{const o=t.output as Contribution;return {ref:discussionRef(t.role),role:t.role,...o,respondsTo:o.respondsTo.map(ref)}}),
  synthesis:m.steps.find(t=>t.phase==='synthesis')?.output,
  completedRevisions:m.steps.filter(t=>t.phase==='revision'&&t.status==='completed').map(t=>({role:t.role,...t.output})),
  task:s.task,...(s.phase==='quality'?{candidateArtifacts:candidateArtifacts(m).artifacts.map(a=>({ref:artifactRef(a),...a})),invalidatedRoles:candidateArtifacts(m).invalidatedRoles}:{})};
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
 // 회의 입력에 쓴 사실 스냅샷을 개선본에 남기고, 회의 중 사실이 바뀌었으면 바로 표시한다. 광고 표현 역할의 개선본은 저장 전 결정적으로 검사한다.
 const factRefs=m.snapshot.evidence?.factRefs,factsChanged=!!factRefs&&!sameEvidenceFactRefs(factRefs,await currentFactRefs(database(),owner,c));
 const guard=m.snapshot.evidence?claimGuard(m.snapshot.evidence.facts):undefined,flagged:string[]=[];
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
  const claims=guard&&s.phase==='revision'&&['creative','content','growth'].includes(s.role)?unverifiedClaims(content,guard):[];
  if(claims.length)flagged.push(`${roles.find(r=>r.id===s.role)?.name||s.role}: ${claims.join(', ')}`);
  const a={skillVersion:m.skillVersion,...(s.promptVersion?{promptVersion:s.promptVersion}:{}),...(m.snapshot.prompts?.fallback?{promptFallback:m.snapshot.prompts.fallback}:{}),...(s.phase==='quality'?{qualityReview:quality}:{}),...(factRefs?{factRefs}:{}),...(factsChanged?{factsChanged:true}:{}),...(claims.length?{unverifiedClaims:claims}:{}),id,campaignId:c.id,campaignVersion:c.version,role:s.role,title:s.phase==='quality'?'팀 회의 · 품질 재검토':result.title,content,version:(old?.version||0)+1,status:'review',origin:'ai',createdAt:stamp(),meetingId:m.id};
  // Multiple manual artifacts for one role are retained as previous versions.
  for(const duplicate of current.filter(a=>a.role===s.role&&a.id!==old?.id))statements.push(recordStatement(owner,'artifact',duplicate.id,{...duplicate,status:'outdated'},c.id));
  statements.push(recordStatement(owner,'artifact',id,a,c.id));m.artifactIds.push(id);
 }
 m.invalidatedRoles=candidateArtifacts(m).invalidatedRoles;m.status='completed';m.updatedAt=stamp();m.error=undefined;
 statements.push(...writes(owner,m),recordStatement(owner,'campaign',c.id,{...c,status:quality.verdict==='ready_for_review'&&!m.invalidatedRoles.length?'review':'revision',updatedAt:stamp()}),eventStatement(owner,c.id,`팀 회의 완료 · ${changes.length}개 담당 개선본과 품질 재검토를 저장했습니다.`),...(flagged.length?[eventStatement(owner,c.id,`회의 개선본에 확인 전 금지 표현이 [확인 필요] 없이 쓰였습니다 · ${flagged.join(' · ')}. 검토 후 수정 요청하세요.`)]:[]));
 await database().batch(statements);
}

// 완료된 단계의 후속 처리: 합의 단계는 개선 과제와 품질 재검토 단계를 추가하고, 품질 재검토는 작업물을 저장한다.
// 품질 재검토가 작업물을 저장해 회의가 완료되면 그 회의를 돌려준다. 온라인 채점(F2b)은 executeMeeting이 잠금을 푼 뒤 한다.
async function applyStep(owner:string,m:Meeting,s:MeetingStep):Promise<Meeting|undefined>{
 if(s.phase==='synthesis'){
  const tasks=(s.output as Synthesis).tasks;
  m.steps.push(...tasks.map(t=>({id:`${m.id}:revision:${t.role}`,role:t.role,phase:'revision' as const,status:'pending' as const,task:t})),{id:`${m.id}:quality`,role:'quality',phase:'quality',status:'pending'});
 }
 if(s.phase==='quality'){
  try{await finish(owner,m)}catch(e){if(!(e instanceof ApiError))throw e;m.status='failed';m.error=e.message;await database().batch(writes(owner,m))}
  return m.status==='completed'?m:undefined;
 }
 await database().batch(writes(owner,m));
}

// 안건 초안: 연속 실행 수정 목록(같은 브리프 버전)·최신 품질 검수 작업물의 미통과 항목·캠페인 상시 지시.
async function agendaDraft(owner:string,{campaign,artifacts,evidence}:MeetingBasis){
 let sequence:{campaignVersion?:number;fixes?:unknown;updatedAt?:string;source?:{id:string;version:number}}|undefined;
 try{sequence=await readRecord(owner,'campaign_sequence',campaign.id)}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e}
 const quality=(artifacts as (Artifact&{qualityReview?:QualityReview})[]).filter(a=>a.role==='quality'&&a.qualityReview).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
 // 수정 목록은 그 목록을 만든 품질 검수 작업물이 아직 현재일 때만 쓴다. 회의·재실행으로 검수가 바뀌면 해결된 옛 지적을 다시 제안하지 않는다.
 const sameReview=!!sequence&&(sequence.source?sequence.source.id===quality?.id&&sequence.source.version===quality?.version:!quality||String(sequence.updatedAt)>=String(quality.createdAt));
 const fixes=sequence&&sameReview&&(sequence.campaignVersion??campaign.version)===campaign.version&&Array.isArray(sequence.fixes)?sequence.fixes.filter((f):f is {role:string|null;fix:string}=>!!f&&(f.role===null||typeof f.role==='string')&&typeof f.fix==='string'):[];
 return meetingAgenda({fixes,review:quality?.qualityReview,directives:evidence.directives.map(d=>d.text)});
}
export async function GET(req:Request){try{
 const owner=await identity(req),id=str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true);await readRecord<Campaign>(owner,'campaign',id);
 const meetings=await listRecords<Meeting>(owner,'team_meeting',id);
 // 진행 중인 회의가 있으면 시작 화면과 재시도가 모두 막혀 있으므로 기준 자료를 다시 읽지 않는다.
 if(meetings.some(meetingActive))return json({meetings:meetings.map(m=>publicMeeting(m))});
 const basis=await meetingBasis(owner,id);
 return json({meetings:meetings.map(m=>publicMeeting(m,m.status==='failed'&&meetingStale(m,basis))),agendaDraft:await agendaDraft(owner,basis)});
}catch(e){return failure(e)}}

export async function executeMeeting(owner:string,b:Record<string,unknown>,by?:EventActor){let lock='',prepared:Meeting|undefined,recovering=false,graded:Meeting|undefined;
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
   const resolved=await resolveCampaignPrompts(owner,c),registryIds=Object.values(resolved.units);
   const prompts=resolved.source==='registry'?{source:resolved.source,units:resolved.units,promptVersion:joinVersions(registryIds),set:resolved.set}:{source:resolved.source,...(resolved.fallback?{fallback:resolved.fallback}:{})};
   const m:Meeting={skillVersion:PRACTICE_VERSION,id,campaignId:c.id,campaignVersion:c.version,agenda:str(b.agenda,'회의 안건',5000,true),status:'running',steps:initialSteps(id),createdAt:stamp(),updatedAt:stamp(),model:cfg.model,stopRequested:false,artifactIds:[],invalidatedRoles:[],previousMeetingId:previous?.id,snapshot:{prompts,brandArchive:await brandArchiveContext(owner,c.brandId,c.storeId),campaign:c,brand,artifacts,metrics,learning,evidence:await evidenceContext(database(),owner,c),...(previous?{previous:{id:previous.id,agenda:previous.agenda,decisions:previous.steps.find(s=>s.phase==='synthesis')?.output as Synthesis,quality:previous.steps.find(s=>s.phase==='quality')?.output as QualityReview,discussion:previous.steps.filter(s=>s.phase==='discussion'&&s.status==='completed').map(s=>({id:s.id,role:s.role,output:s.output as Contribution})),...(previousFailure?{failure:{role:previousFailure.role,phase:previousFailure.phase,error:previousFailure.error||previous.error||'응답 검증 실패'}}:{})}}:{})}};
   await database().batch([database().prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(jobId(owner,m),owner,c.id,'meeting','in_progress',cfg.model,c.version,m.createdAt,m.updatedAt),recordStatement(owner,'team_meeting',m.id,m,c.id),eventStatement(owner,c.id,'팀 회의를 시작했습니다. 8명 의견 교환 → 개선 과제 → 품질 재검토.',by)]);
   return json(publicMeeting(m));
  }
  if(!['advance','recover','cancel','retry_failed'].includes(String(b.action)))throw new ApiError(400,'지원하지 않는 회의 작업입니다.');
  const m=await readRecord<Meeting>(owner,'team_meeting',id);
  if(b.action==='retry_failed'){
   const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'회의를 시작한 HERMES 연결이 필요합니다.');
   const {meeting:retried,completed}=await retryFailedMeeting(owner,m,b);
   if(completed){graded=await applyStep(owner,retried,completed);if(completed.providerId)await markUsageOutcome(owner,'hermes',completed.providerId,retried.status==='failed'?'storage_failed':'completed');return json(publicMeeting(retried))}
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
   const correction=s.correction?'\n이전 응답은 검증에 실패했습니다. correction.error를 고치고, respondsTo에는 allowedRespondsTo의 ref만 사용하세요. 요청 선택지를 묻지 말고 이 단계의 완성된 결과를 반환하세요.':'';
   const instructions=meetingInstructions(s,!!m.skillVersion,m.snapshot.prompts?.set)+correction;s.promptVersion=await stepPromptVersion(m,s,instructions);
   await database().batch([...writes(owner,m),hermesSubmissionStatement(owner,meetingSubmissionId(s),{instructions,input:JSON.stringify(context(m,s))},m.campaignId)]);
   prepared=m;
   const r=await submitHermes(owner,meetingSubmissionId(s),cfg);s.providerId=r.id;s.status='running';m.status='running';m.updatedAt=stamp();
   await database().batch(writes(owner,m));return json(publicMeeting(m));
  }
  if(!s.providerId){
   if(b.action!=='recover'){s.status='uncertain';m.status='uncertain';m.error='HERMES 접수 여부를 확인해야 합니다. 기존 요청 확인을 누르면 같은 요청으로 복구합니다.';m.updatedAt=stamp();await database().batch(writes(owner,m));return json(publicMeeting(m))}
   recovering=true;prepared=m;const r=await submitHermes(owner,meetingSubmissionId(s),cfg);s.providerId=r.id;s.status='running';m.status='running';m.error=undefined;m.updatedAt=stamp();await database().batch(writes(owner,m));return json(publicMeeting(m));
  }
  const result=await pollHermes(cfg,s.providerId,m.stopRequested,30000,owner,meetingUsage(owner,m,s));
  m.updatedAt=stamp();m.error=undefined;m.status='running';s.status='running';if(['completed','cancelled','failed'].includes(result.status))s.tokens=Number.isSafeInteger(result.usage.total_tokens)?Math.max(0,result.usage.total_tokens):s.tokens;
  if(m.stopRequested){
   if(['completed','cancelled','failed'].includes(result.status)){s.status='cancelled';m.status='cancelled';await markUsageOutcome(owner,'hermes',s.providerId,result.invalidOutput?'invalid_output':'cancelled')}
   await database().batch(writes(owner,m));return json(publicMeeting(m));
  }
  if(result.status==='completed'){
   s.raw=result.output[0].content[0].text;s.tokens=result.usage.total_tokens;
   try{const parsed=parseMeetingStep(s.raw!,s,m.steps,!!m.skillVersion,candidateArtifacts(m).invalidatedRoles,meetingLabels(m));s.output=parsed.output;if(parsed.warnings.length)s.warnings=parsed.warnings;s.status='completed';s.completedAt=stamp()}
   catch(e){await markUsageOutcome(owner,'hermes',s.providerId,'invalid_output');s.status='failed';s.failureKind='invalid_output';s.completedAt=stamp();s.error=(e as Error).message;m.status='failed';m.error=s.error;await database().batch(writes(owner,m));return json(publicMeeting(m))}
   graded=await applyStep(owner,m,s);
   // applyStep이 저장 실패 시 m.status를 failed로 바꾼다.
   await markUsageOutcome(owner,'hermes',s.providerId,(m.status as Meeting['status'])==='failed'?'storage_failed':'completed');
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
 }finally{
  if(lock)await releaseLock(owner,lock);
  // 비차단 온라인 채점(F2b): 회의 작업물 저장·사용량 결과 기록 뒤, 소유자 잠금을 푼 다음에만 부르며 예외를 던지지 않는다. 스위치가 꺼져 있으면 채점 0회.
  if(graded)await gradeMeetingArtifacts(owner,graded);
 }
}
