// G3 예약 실행 서버. 워커 tick 'scheduled_runs' 큐가 부른다(lib/research-worker.ts). 스위치 scheduled_runs가 꺼져 있으면 큐에 들어가지도 않는다(scheduledRunsQueue).
// 켜져 있으면 KST 오늘 차례가 된 예약마다 (예약 id, 날짜) 실행 기록 1행을 남긴다. 이미 있으면 읽기만 한다(멱등).
// 전역 중단(lib/growth-stop.ts) 중이면 실행하지 않고 skipped 사유를 기록한다. 회의 안건 초안은 자율성 규칙 meeting_start가 never면 skipped다.
// 쓰기: scheduled_run(예약), scheduled_run_execution(실행 기록), meeting_agenda_draft(안건 초안) 또는 growth_detected_signal(오늘의 안건 신호). HERMES·외부 호출 0회.
import type {Campaign,Metric} from './agency';
import {evaluateAutonomyFor} from './autonomy-server';
import {sendDailyDigest} from './digest-server';
import {isEnabled} from './feature-flags';
import {readGrowthStop} from './growth-stop-server';
import {ScheduledRunError,agendaSignalText,kstParts,meetingDraftAgenda,parseScheduleInput,periodFor,scheduledRunId,summarizeMetrics,type Schedule,type ScheduledRun} from './scheduled-runs';
import {ApiError,acquireLock,database,listRecords,readRecord,recordStatement,releaseLock,stamp,uid,type Actor} from './server';

const kinds={schedule:'scheduled_run',run:'scheduled_run_execution',draft:'meeting_agenda_draft'} as const;
export const SCHEDULED_RUNS_PER_TICK=5,RUN_LIST_LIMIT=30;
export type MeetingAgendaDraft={id:string;scheduleId:string;period:string;brandId:string;campaignId:string;agenda:string;status:'draft';createdAt:string};
type ScheduledSignal={id:string;version:number;brandId:string;campaignId:string;detection:{key:string;kind:'scheduled_review';title:string;detail:string;window:{from:string;to:string};evidence:Record<string,never>;dueBy:string};status:'new';triage:null;dismissReason:'';detectedAt:string;detectedBy:'scheduled_run';updatedAt:string;updatedBy:string};

const admin=(who:Actor)=>who.role==='owner'||who.role==='admin';
async function campaignOf(owner:string,brandId:string,campaignId:string){
 const c=await readRecord<Campaign&{archivedAt?:string|null}>(owner,'campaign',campaignId);
 if(c.brandId!==brandId)throw new ApiError(400,'캠페인이 그 브랜드에 속하지 않습니다.');
 if(c.archivedAt||c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 예약을 만들 수 없습니다.');
 return c;
}
export async function listSchedules(owner:string){return (await listRecords<Schedule>(owner,kinds.schedule)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))}
async function recentRuns(owner:string){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT ?").bind(owner,kinds.run,RUN_LIST_LIMIT).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as ScheduledRun);
}
export async function scheduledRunsView(who:Actor,now=Date.now()){
 const campaigns=(await listRecords<Campaign&{archivedAt?:string|null}>(who.owner,'campaign')).filter(c=>!c.archivedAt&&c.status!=='archived').map(c=>({id:c.id,brandId:c.brandId,title:c.title}));
 return {schedules:await listSchedules(who.owner),runs:await recentRuns(who.owner),campaigns,enabled:await isEnabled(who.owner,'scheduled_runs'),canEdit:admin(who),today:kstParts(now).day,
  notice:'예약은 정한 요일·시각(KST)이 지나면 조사 작업자가 하루 1회 실행합니다. 회의 안건 초안과 오늘의 안건 항목만 만들며 회의 시작·게시·지출은 사람이 합니다.'};
}
export type ScheduledRunsView=Awaited<ReturnType<typeof scheduledRunsView>>;
export async function saveSchedule(who:Actor,input:Record<string,unknown>){
 if(!admin(who))throw new ApiError(403,'소유자·관리자만 예약을 바꿀 수 있습니다.');
 // 라우트 동사(action:'save')와 예약의 행동(action)이 겹치지 않게 예약 본문은 schedule 안에 받는다.
 let parsed;try{parsed=parseScheduleInput(input.schedule)}catch(e){if(e instanceof ScheduledRunError)throw new ApiError(400,e.message);throw e}
 await campaignOf(who.owner,parsed.brandId,parsed.campaignId);
 const at=stamp(),id=typeof input.id==='string'&&input.id?input.id:'sched-'+uid();
 let previous:Schedule|null=null;
 try{previous=await readRecord<Schedule>(who.owner,kinds.schedule,id)}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e}
 if(previous&&input.expectedVersion!==undefined&&input.expectedVersion!==previous.version)throw new ApiError(409,'예약이 다른 곳에서 바뀌었습니다. 최신 판을 확인하세요.');
 const row:Schedule={...parsed,id,version:(previous?.version??0)+1,enabled:previous?.enabled??true,createdAt:previous?.createdAt??at,updatedAt:at,createdBy:previous?.createdBy??who.id};
 await recordStatement(who.owner,kinds.schedule,id,row,row.campaignId).run();
 return row;
}
export async function setScheduleEnabled(who:Actor,input:Record<string,unknown>){
 if(!admin(who))throw new ApiError(403,'소유자·관리자만 예약을 바꿀 수 있습니다.');
 if(typeof input.id!=='string'||typeof input.enabled!=='boolean')throw new ApiError(400,'예약 id와 켜기/끄기 값을 확인하세요.');
 const previous=await readRecord<Schedule>(who.owner,kinds.schedule,input.id);
 const row:Schedule={...previous,enabled:input.enabled,version:previous.version+1,updatedAt:stamp()};
 await recordStatement(who.owner,kinds.schedule,row.id,row,row.campaignId).run();
 return row;
}
export async function removeSchedule(who:Actor,input:Record<string,unknown>){
 if(!admin(who))throw new ApiError(403,'소유자·관리자만 예약을 지울 수 있습니다.');
 if(typeof input.id!=='string'||!input.id)throw new ApiError(400,'예약 id를 확인하세요.');
 const result=await database().prepare('DELETE FROM records WHERE id=? AND owner=? AND kind=?').bind(`${who.owner}:${kinds.schedule}:${input.id}`,who.owner,kinds.schedule).run();
 if(!result.meta.changes)throw new ApiError(404,'항목을 찾을 수 없습니다.');
 return {removed:input.id};
}
async function existingRun(owner:string,id:string){
 try{return await readRecord<ScheduledRun>(owner,kinds.run,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
}
async function createMeetingDraft(owner:string,s:Schedule,period:string,runId:string,now:number){
 const metrics=await listRecords<Metric>(owner,'metric',s.campaignId);
 const draft:MeetingAgendaDraft={id:runId,scheduleId:s.id,period,brandId:s.brandId,campaignId:s.campaignId,agenda:meetingDraftAgenda(s,summarizeMetrics(metrics,now)),status:'draft',createdAt:stamp()};
 await recordStatement(owner,kinds.draft,draft.id,draft,s.campaignId).run();
 return draft.id;
}
async function createAgendaSignal(owner:string,s:Schedule,period:string,runId:string,now:number){
 const at=stamp(),text=agendaSignalText(s,period),from=kstParts(now-6*86400000).day;
 const row:ScheduledSignal={id:'sched-'+runId,version:1,brandId:s.brandId,campaignId:s.campaignId,detection:{key:`scheduled:${runId}`,kind:'scheduled_review',title:text.title,detail:text.detail,window:{from,to:period},evidence:{},dueBy:kstParts(now+3*86400000).day},
  status:'new',triage:null,dismissReason:'',detectedAt:at,detectedBy:'scheduled_run',updatedAt:at,updatedBy:'scheduled_run'};
 await recordStatement(owner,'growth_detected_signal',row.id,row,s.campaignId).run();
 return row.id;
}
async function skipReason(owner:string,s:Schedule,stopped:boolean){
 if(stopped)return '전역 중단 중이라 예약을 실행하지 않았습니다.';
 if(s.action==='create_meeting_draft'){const d=await evaluateAutonomyFor(owner,'meeting_start');if(d.mode==='never')return d.reason}
 return null;
}
async function executeOne(owner:string,s:Schedule,period:string,stopped:boolean,now:number):Promise<ScheduledRun>{
 const started=Date.now(),id=scheduledRunId(s.id,period),base={id,scheduleId:s.id,period,kind:s.kind,action:s.action,brandId:s.brandId,campaignId:s.campaignId};
 const finish=(status:ScheduledRun['status'],reason:string,outputId:string|null):ScheduledRun=>({...base,status,reason,outputId,generatedAt:stamp(),durationMs:Date.now()-started});
 try{
  const skipped=await skipReason(owner,s,stopped);
  if(skipped)return finish('skipped',skipped,null);
  await campaignOf(owner,s.brandId,s.campaignId);
  const outputId=s.action==='create_meeting_draft'?await createMeetingDraft(owner,s,period,id,now):await createAgendaSignal(owner,s,period,id,now);
  return finish('completed','',outputId);
 }catch(e){return finish('failed',e instanceof ApiError?e.message:'예약 실행에 실패했습니다.',null)}
}
async function runLocked(owner:string,now:number){
 const due=(await listSchedules(owner)).map(s=>({s,period:periodFor(s,now)})).filter((x):x is {s:Schedule;period:string}=>!!x.period);
 let stopped=false;try{stopped=(await readGrowthStop(owner)).status!=='running'}catch{stopped=true}
 const runs:ScheduledRun[]=[];
 for(const {s,period} of due){
  if(runs.length>=SCHEDULED_RUNS_PER_TICK)break;
  const id=scheduledRunId(s.id,period);
  if(await existingRun(owner,id))continue;
  const run=await executeOne(owner,s,period,stopped,now);
  await recordStatement(owner,kinds.run,id,run,s.campaignId).run();
  runs.push(run);
 }
 const digest=await sendDailyDigest(owner,now);
 return runs.length||digest.status==='processed'?{status:'processed' as const,runs:runs.length,digest:digest.status}:{status:'idle' as const,reason:'nothing_due' as const};
}
export async function runScheduledRuns(owner:string,now=Date.now()){
 if(!await isEnabled(owner,'scheduled_runs'))return {status:'idle' as const,reason:'disabled' as const};
 let token:string;
 try{token=await acquireLock(owner+':scheduled-runs')}catch(e){if(e instanceof ApiError&&e.status===409)return {status:'idle' as const,reason:'busy' as const};throw e}
 try{return await runLocked(owner,now)}finally{await releaseLock(owner+':scheduled-runs',token)}
}
// 워커 순환에 넣을 콜백. 스위치가 꺼진 소유자는 undefined라 큐 이름 'scheduled_runs'가 순환에 나타나지 않는다(lib/product-research/server-maintenance.ts와 같은 방식).
export async function scheduledRunsQueue(owner:string):Promise<((owner:string)=>Promise<{status:string}>)|undefined>{
 if(!await isEnabled(owner,'scheduled_runs'))return undefined;
 return current=>current===owner?runScheduledRuns(owner):Promise.resolve({status:'idle'});
}
