import {database,listRecords,readRecord,recordStatement,stamp,ApiError} from './server';
import {executeRole} from './role-execution';
import {executeMeeting} from './meeting-execution';
import {executeLearning} from './learning-execution';
import {executeBrief} from './brief-execution';
import {roles} from './agency';
import type {Meeting} from './meetings';
import type {BriefDraft} from './brief';
import type {CampaignSequence} from './campaign-sequence';

type Work={id:string;run:()=>Promise<Response>};
type Attempt={id:string;attempts:number;retryAt:string;error?:string};
const active=['starting','queued','in_progress','uncertain'];

async function pendingWork(owner:string):Promise<Work[]>{
 const [jobs,meetings,drafts,sequences]=await Promise.all([
  database().prepare("SELECT id,role,provider_id,campaign_id FROM jobs WHERE owner=? AND status IN ('starting','queued','in_progress','uncertain') ORDER BY created_at,id").bind(owner).all<{id:string;role:string;provider_id:string|null;campaign_id:string}>(),
  listRecords<Meeting>(owner,'team_meeting'),listRecords<BriefDraft & {providerId?:string}>(owner,'brief_draft'),listRecords<CampaignSequence>(owner,'campaign_sequence'),
 ]);
 const work:Work[]=jobs.results.flatMap(job=>{
  const action=job.provider_id?'poll':'recover';
  if(roles.some(r=>r.id===job.role))return [{id:'role:'+job.id,run:()=>executeRole(owner,{action,id:job.id})}];
  if(['viral_analysis','viral_discovery','viral_guidance'].includes(job.role))return [{id:'learning:'+job.id,run:()=>executeLearning(owner,{action,id:job.id})}];
  return [];
 });
 for(const meeting of meetings.filter(m=>['running','uncertain'].includes(m.status))){
  const step=meeting.steps.find(s=>s.status!=='completed');
  const action=step&&step.status!=='pending'&&!step.providerId?'recover':'advance';
  work.push({id:'meeting:'+meeting.id,run:()=>executeMeeting(owner,{action,id:meeting.id})});
 }
 for(const draft of drafts.filter(d=>active.includes(d.status)))work.push({id:'brief:'+draft.id,run:()=>executeBrief(owner,{action:draft.providerId?'poll':'recover',id:draft.id})});
 for(const sequence of sequences.filter(s=>s.status==='running')){
  if(jobs.results.some(j=>j.campaign_id===sequence.campaignId))continue;
  work.push({id:'sequence:'+sequence.campaignId,run:()=>executeRole(owner,{action:'advance_sequence',campaignId:sequence.campaignId})});
 }
 return work.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}

// The machine principal is checked by workerTick. No browser identity header is manufactured.
export async function advanceBackgroundWork(owner:string){
 const [pending,attempts]=await Promise.all([pendingWork(owner),listRecords<Attempt>(owner,'background_attempt')]);
 const due=pending.filter(w=>!attempts.some(a=>a.id===w.id&&Date.parse(a.retryAt)>Date.now()));
 if(!due.length)return {status:'idle'};
 let last='';
 try{last=(await readRecord<{last:string}>(owner,'background_cursor','current')).last}catch(error){if(!(error instanceof ApiError&&error.status===404))throw error}
 const work=due.find(w=>w.id>last)||due[0];
 await recordStatement(owner,'background_cursor','current',{last:work.id,updatedAt:stamp()}).run();
 try{
  const response=await work.run();
  if(!response.ok)throw new ApiError(response.status,'진행 상태를 확인하세요. HTTP '+response.status);
  await database().prepare("DELETE FROM records WHERE owner=? AND kind='background_attempt' AND id=?").bind(owner,`${owner}:background_attempt:${work.id}`).run();
  return {status:'processed'};
 }catch(error){
  const count=(attempts.find(a=>a.id===work.id)?.attempts||0)+1;
  await recordStatement(owner,'background_attempt',work.id,{id:work.id,attempts:count,retryAt:new Date(Date.now()+Math.min(300000,15000*2**Math.min(count,5))).toISOString(),error:error instanceof ApiError?error.message:'작업 진행을 확인하지 못했습니다.'}).run();
  return {status:'retry'};
 }
}
