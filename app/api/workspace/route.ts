import type {Artifact,Campaign,Metric} from '@/lib/agency';
import type {BriefDraft} from '@/lib/brief';
import {campaignRuns,type CampaignSequence} from '@/lib/campaign-detail';
import {statusRecordsQuery,withDerivedStatus,type StatusMeeting,type StatusPublication} from '@/lib/campaign-status';
import {actor,json,failure,seedBrands,listRecords,publicConnection,database} from '@/lib/server';
import {workerStatus} from '@/lib/research-worker';

export async function GET(req:Request){
 try{
  const who=await actor(req),owner=who.owner,admin=who.role==='owner'||who.role==='admin';
  await seedBrands(owner);
  const [brands,campaigns,artifacts,metrics,events,settings,runs,briefDrafts,sequences,worker,meetings,publications]=await Promise.all([
   listRecords(owner,'brand'),listRecords<Campaign>(owner,'campaign'),listRecords<Artifact>(owner,'artifact'),listRecords<Metric>(owner,'metric'),listRecords(owner,'event'),
   publicConnection(owner),campaignRuns(owner),listRecords<BriefDraft>(owner,'brief_draft'),listRecords<CampaignSequence>(owner,'campaign_sequence'),workerStatus(owner),
   database().prepare(statusRecordsQuery('team_meeting')).bind(owner).all<StatusMeeting&{campaignId:string}>(),database().prepare(statusRecordsQuery('execution_publication')).bind(owner).all<StatusPublication&{campaignId:string}>(),
  ]);
  // 연결 주소(HERMES endpoint)는 관리자에게만 보낸다.
  const {endpoint,...shared}=settings;
  return json({
   briefDrafts:briefDrafts.filter(d=>!d.savedCampaignId&&d.status!=='cancelled').slice(0,10).map(d=>({id:d.id,status:d.status,title:d.input.title||d.input.goal,brandId:d.input.brandId,campaignId:d.campaignId,createdAt:d.createdAt})),
   // campaigns[].status는 저장값 그대로 두고 화면용 파생 상태(derivedStatus·statusReason, lib/campaign-status.ts)를 더한다.
   brands,campaigns:withDerivedStatus(campaigns,{artifacts,runs,sequences,meetings:meetings.results,publications:publications.results,metrics}),artifacts,metrics,events:events.slice(0,60),runs,sequences,worker,connection:{...shared,...(admin?{endpoint}:{}),canConfigure:shared.canConfigure&&admin},preview:process.env.NODE_ENV==='development',
  });
 }catch(e){return failure(e)}
}
