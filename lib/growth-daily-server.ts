// G2-00/28 일일 운영 루프. 워커 tick의 'growth_daily' 큐가 부르며 기능 스위치 growth_daily_loop가 꺼져 있으면 스위치 1행만 읽고 끝난다.
// 켜져 있으면 KST 하루 안건을 이어서: 보관하지 않은 지점 캠페인(최대 20개, 30초 예산)마다 자사 장부 감지를 돌리고 담당이 처리할 안건을 모은다.
// 제안만 만든다: 게시·지출·발주·고객 발송·프롬프트 승격·재고/예산 변경 0회. 전역 중단 중에도 읽기·감지는 하고 중단 상태를 기록한다.
import type {Campaign} from './agency';
import type {GrowthCommitmentRecord} from './growth-authority-server';
import type {GrowthExperimentRecord,GrowthExperimentResult} from './growth-experiment-server';
import type {LessonApplicationRecord} from './growth-lesson-applications-server';
import type {DetectedSignalRecord} from './growth-detection-server';
import {runGrowthDetection} from './growth-detection-server';
import {createGrowthOpportunityDrafts} from './growth-opportunity-drafts-server';
import {createGrowthOfferReviewDrafts,growthOfferReviewDraftsView} from './growth-offer-review-drafts-server';
import {createGrowthFailureDrafts} from './growth-failure-drafts-server';
import {collectGrowthLessonOutcomes} from './growth-lesson-outcomes-server';
import {growthCsView} from './growth-cs-server';
import {readGrowthStop} from './growth-stop-server';
import {campaignRows} from './growth-ledger-server';
import {isEnabled} from './feature-flags';
import {ApiError,acquireLock,releaseLock,database,listRecords,stamp,type Actor} from './server';
export const DAILY_TIME_BUDGET_MS=30000,DAILY_CAMPAIGN_LIMIT=20,DAILY_RETRY_MS=3600000,DAILY_MAX_RETRY_MS=21600000,STALE_RESERVATION_DAYS=7;
export type AgendaItem={kind:'cs_overdue'|'signal_new'|'signal_overdue'|'lesson_check_overdue'|'experiment_ready'|'reservation_unreconciled'|'mission_overdue';count:number;action:string};
export type DailyCampaign={campaignId:string;title:string;detection:{detected:number;created:number}|null;drafts?:number;failureDrafts?:number;offerDrafts?:number;offerRemaining?:boolean;offerIntakeHeld?:boolean;offerSourceErrors?:number;lessonCollected?:number;lessonRemaining?:boolean;agenda:AgendaItem[];error:string|null;attempts?:number;retryAt?:string};
export type GrowthDailyRun={id:string;day:string;status:'completed'|'partial'|'failed';trigger:'worker'|'operator';generatedAt:string;durationMs:number;stop:'running'|'stopped'|'unknown';campaigns:DailyCampaign[];skipped:number;attempts:number;retryAt?:string;pendingIds?:string[];notice:string};
const NOTICE='기록된 장부를 규칙으로 읽어 만든 오늘의 검토 안건입니다. 게시·지출·발주·고객 발송·프롬프트 승격을 하지 않으며, 각 안건은 담당자가 해당 화면에서 처리합니다.';
export const kstDay=(t=Date.now())=>new Date(t+9*3600000).toISOString().slice(0,10);
const runId=(owner:string,day:string)=>`${owner}:growth_daily_run:${day}`;
async function agendaFor(who:Actor,c:Campaign,now:number):Promise<AgendaItem[]>{
 const today=new Date(now).toISOString().slice(0,10),items:AgendaItem[]=[];
 const [cs,signals,apps,experiments,results,commitments,missions]=await Promise.all([growthCsView(who,c),campaignRows<DetectedSignalRecord>(who.owner,c,'growth_detected_signal',2000),campaignRows<LessonApplicationRecord>(who.owner,c,'growth_lesson_application',1000),campaignRows<GrowthExperimentRecord>(who.owner,c,'growth_experiment',200),campaignRows<GrowthExperimentResult>(who.owner,c,'growth_experiment_result',2000),campaignRows<GrowthCommitmentRecord>(who.owner,c,'growth_commitment',1000),campaignRows<{status?:string;input:{deadline:string}}>(who.owner,c,'growth_mission',500)]);
 const push=(kind:AgendaItem['kind'],count:number,action:string)=>{if(count>0)items.push({kind,count,action})};
 push('cs_overdue',cs.overdue,'약속 기한이 지난 고객 문의를 처리하세요.');
 push('signal_new',signals.filter(s=>s.status==='new').length,'새 감지 신호에 담당·기한을 지정하거나 기각하세요.');
 push('signal_overdue',signals.filter(s=>s.status==='acknowledged'&&s.triage&&s.triage.dueBy<today).length,'기한이 지난 신호 검토를 마무리하세요.');
 push('lesson_check_overdue',apps.filter(a=>!a.outcome&&a.input.checkAt<today).length,'확인일이 지난 교훈 적용의 결과를 회수하세요.');
 push('experiment_ready',experiments.filter(e=>e.status==='registered'&&now>=Date.parse(e.input.endAt)+e.input.maturityDays*86400000&&!results.some(r=>r.designId===e.id)).length,'성숙 대기가 끝난 판매 실험을 분석하세요.');
 push('reservation_unreconciled',commitments.filter(r=>['reserved','unknown'].includes(r.commitment.status)&&now-Date.parse(r.commitment.at)>STALE_RESERVATION_DAYS*86400000).length,`${STALE_RESERVATION_DAYS}일 넘게 대사되지 않은 예산 예약을 확인하세요.`);
 push('mission_overdue',missions.filter(m=>!['observed','failed','cancelled'].includes(m.status??'draft')&&m.input.deadline&&m.input.deadline<today).length,'기한이 지난 판매 미션의 결과·중단을 정리하세요.');
 return items;
}
/** Completed campaigns run once per KST day; incomplete chunks resume under the same owner lease. */
export async function runGrowthDaily(owner:string,trigger:'worker'|'operator'='worker',now=Date.now()){
 if(trigger==='worker'&&!await isEnabled(owner,'growth_daily_loop'))return {status:'idle' as const,reason:'disabled' as const};
 let token:string;
 try{token=await acquireLock(owner+':growth-daily')}catch(e){if(e instanceof ApiError&&e.status===409)return {status:'idle' as const,reason:'busy' as const};throw e}
 try{return await runLocked(owner,trigger,now,token)}finally{await releaseLock(owner+':growth-daily',token)}
}
async function persistRun(owner:string,row:GrowthDailyRun,token:string){
 // A slow read must not overwrite progress after its lease has expired or been replaced.
 const result=await database().prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,'growth_daily_run','',?,? WHERE EXISTS(SELECT 1 FROM mutation_locks WHERE owner=? AND token=? AND expires_at>=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE records.owner=excluded.owner")
  .bind(runId(owner,row.day),owner,JSON.stringify(row),stamp(),owner+':growth-daily',token,Date.now()).run();
 if(!result.meta.changes)throw new ApiError(409,'일일 루프 실행 잠금이 만료되었습니다. 다음 실행에서 이어갑니다.');
}
function nextRetry(campaigns:DailyCampaign[],pendingIds:string[],now:number){
 if(pendingIds.length||campaigns.some(c=>(c.lessonRemaining||c.offerRemaining)))return new Date(now).toISOString();
 const times=campaigns.filter(c=>c.error).map(c=>Date.parse(c.retryAt??new Date(now).toISOString()));
 return times.length?new Date(Math.min(...times)).toISOString():undefined;
}
async function runLocked(owner:string,trigger:'worker'|'operator',now:number,token:string){
 const day=kstDay(now),existing=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='growth_daily_run'").bind(runId(owner,day),owner).first<{data:string}>(),prev=existing?JSON.parse(existing.data) as GrowthDailyRun:null;
 if(prev?.status==='completed')return {status:'idle' as const,reason:'completed' as const};
 if(prev?.retryAt&&Date.parse(prev.retryAt)>now)return {status:'idle' as const,reason:'retry_wait' as const,retryAt:prev.retryAt};
 const started=Date.now(),who:Actor={owner,id:'growth_daily_loop',email:null,role:'owner'};
 let stop:GrowthDailyRun['stop']='unknown';try{stop=(await readGrowthStop(owner)).status==='running'?'running':'stopped'}catch{stop='unknown'}
 let done=prev?.campaigns??[],pendingIds=prev?.pendingIds??[],processed=0;
 const row=(status:GrowthDailyRun['status'],retryAt?:string):GrowthDailyRun=>({id:day,day,status,trigger,generatedAt:stamp(),durationMs:Date.now()-started,stop,campaigns:done,skipped:pendingIds.length,pendingIds,attempts:(prev?.attempts??0)+1,retryAt,notice:NOTICE});
 try{
  const campaigns=(await listRecords<Campaign>(owner,'campaign')).filter(c=>c.status!=='archived'&&!!c.storeId).sort((a,b)=>a.id.localeCompare(b.id));
  done=done.filter(d=>campaigns.some(c=>c.id===d.campaignId));
  const older=!prev?await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_daily_run' AND json_extract(data,'$.day')<? ORDER BY id DESC LIMIT 1").bind(owner,day).first<{data:string}>():null;
  const prior=older?JSON.parse(older.data) as GrowthDailyRun:null;
  const previousPending=prev?.pendingIds??(prior&&prior.status!=='completed'?(prior.pendingIds??campaigns.filter(c=>!prior.campaigns.some(d=>d.campaignId===c.id)).map(c=>c.id)):[]);
  const order=[...new Set([...previousPending,...(prior?.campaigns.filter(c=>c.error).map(c=>c.campaignId)??[]),...campaigns.map(c=>c.id)])],rank=new Map(order.map((id,i)=>[id,i]));
  pendingIds=campaigns.filter(c=>!done.some(d=>d.campaignId===c.id&&!d.lessonRemaining&&!d.offerRemaining)).map(c=>c.id).sort((a,b)=>rank.get(a)!-rank.get(b)!);
  const queue=campaigns.filter(c=>{const d=done.find(d=>d.campaignId===c.id);return !d||(d.lessonRemaining||d.offerRemaining)||(d.error&&(!d.retryAt||Date.parse(d.retryAt)<=now))}).sort((a,b)=>Number(!pendingIds.includes(a.id))-Number(!pendingIds.includes(b.id))||rank.get(a.id)!-rank.get(b.id)!);
  for(const c of queue){
   if(processed>=DAILY_CAMPAIGN_LIMIT||Date.now()-started>=DAILY_TIME_BUDGET_MS)break;
   const attempts=(done.find(d=>d.campaignId===c.id)?.attempts??0)+1;let result:DailyCampaign;
   try{const detection=await runGrowthDetection(who,c,'daily_loop',now),drafts=await createGrowthOpportunityDrafts(who,c,now),failureDrafts=await createGrowthFailureDrafts(who,c),lessons=await collectGrowthLessonOutcomes(who,c),offerReviews=await createGrowthOfferReviewDrafts(who,c);result={campaignId:c.id,title:c.title,detection,drafts:drafts.created,failureDrafts:failureDrafts.created,offerDrafts:(done.find(d=>d.campaignId===c.id)?.offerDrafts??0)+offerReviews.created,offerRemaining:offerReviews.remaining,offerIntakeHeld:offerReviews.intakeHeld,offerSourceErrors:offerReviews.sourceErrors,lessonCollected:(done.find(d=>d.campaignId===c.id)?.lessonCollected??0)+lessons.collected,lessonRemaining:lessons.remaining,agenda:await agendaFor(who,c,now),error:null,attempts}}
   catch(e){result={campaignId:c.id,title:c.title,detection:null,agenda:[],error:e instanceof ApiError?e.message:'이 캠페인 집계에 실패했습니다.',attempts,retryAt:new Date(now+Math.min(DAILY_MAX_RETRY_MS,DAILY_RETRY_MS*2**Math.min(attempts-1,3))).toISOString()}}
   done=[...done.filter(d=>d.campaignId!==c.id),result];pendingIds=(result.lessonRemaining||result.offerRemaining)?[...new Set([...pendingIds,c.id])]:pendingIds.filter(id=>id!==c.id);processed++;
   await persistRun(owner,row('partial',nextRetry(done,pendingIds,now)),token);
  }
  const status=pendingIds.length||done.some(d=>d.error||d.lessonRemaining||d.offerRemaining)?'partial':'completed';
  const retryAt=nextRetry(done,pendingIds,now);await persistRun(owner,row(status,retryAt),token);
  return {status:'processed' as const,day,campaigns:processed,skipped:pendingIds.length,runStatus:status,retryAt};
 }catch{
  const retryAt=new Date(now+DAILY_RETRY_MS).toISOString();await persistRun(owner,row('failed',retryAt),token);
  return {status:'retry' as const,day,retryAt};
 }
}
export async function growthDailyView(who:Actor,c:Campaign){
 const runs=(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_daily_run' ORDER BY id DESC LIMIT 14").bind(who.owner).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as GrowthDailyRun);
 return {offerReviews:await growthOfferReviewDraftsView(who,c),campaignId:c.id,today:kstDay(),enabled:await isEnabled(who.owner,'growth_daily_loop'),runs:runs.map(r=>({day:r.day,status:r.status,trigger:r.trigger,generatedAt:r.generatedAt,durationMs:r.durationMs,stop:r.stop,skipped:r.skipped,retryAt:r.retryAt??null,campaign:r.campaigns.find(x=>x.campaignId===c.id)??null,campaigns:r.campaigns.length})),notice:NOTICE,canRun:who.role!=='member',mayExecute:false as const};
}
export type GrowthDailyView=Awaited<ReturnType<typeof growthDailyView>>;
