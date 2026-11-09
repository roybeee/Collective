import type {Artifact,Campaign,Metric} from '@/lib/agency';
import type {BriefDraft} from '@/lib/brief';
import {campaignRuns,type CampaignSequence} from '@/lib/campaign-detail';
import {statusRecordsQuery,withDerivedStatus,type StatusMeeting,type StatusPublication} from '@/lib/campaign-status';
import {json,failure,seedBrands,listRecords,publicConnection,database} from '@/lib/server';
import {workerStatus} from '@/lib/research-worker';
import {franchiseWorkspaceTasks} from '@/lib/franchise-workspace-server';
import {refreshGrowthLessonArtifacts} from '@/lib/growth-lesson-context-server';
import {accessOf,scopeByBrand,scopePayload,scopeWorkspace} from '@/lib/server-access';

export async function GET(req:Request){
 try{
  const {actor:who,principal}=await accessOf(req),owner=who.owner,admin=who.role==='owner'||who.role==='admin';
  await seedBrands(owner);
  const [allBrands,allCampaigns,allArtifacts,allMetrics,allEvents,settings,allRuns,briefDrafts,allSequences,worker,allMeetings,allPublications]=await Promise.all([
   listRecords(owner,'brand'),listRecords<Campaign>(owner,'campaign'),listRecords<Artifact>(owner,'artifact'),listRecords<Metric>(owner,'metric'),listRecords(owner,'event'),
   publicConnection(owner),campaignRuns(owner),listRecords<BriefDraft>(owner,'brief_draft'),listRecords<CampaignSequence>(owner,'campaign_sequence'),workerStatus(owner),
   database().prepare(statusRecordsQuery('team_meeting')).bind(owner).all<StatusMeeting&{campaignId:string}>(),database().prepare(statusRecordsQuery('execution_publication')).bind(owner).all<StatusPublication&{campaignId:string}>(),
  ]);
  // G7: 범위 역할(브랜드·점포 매니저·검토자)은 볼 수 있는 브랜드·캠페인과 그 캠페인에 이어진 항목만 받는다. 범위 없는 역할은 그대로다(lib/server-access.ts).
  const {brands,campaigns,artifacts,metrics,events,runs,sequences,meetings,publications}=scopeWorkspace(principal,{brands:allBrands as {id?:unknown}[],campaigns:allCampaigns,artifacts:allArtifacts,metrics:allMetrics,events:allEvents as {campaignId?:unknown}[],runs:allRuns,sequences:allSequences,meetings:allMeetings.results,publications:allPublications.results});
  // 연결 주소(HERMES endpoint)는 관리자에게만 보낸다.
  const {endpoint,...shared}=settings;
  return json(scopePayload(principal,{
   briefDrafts:scopeByBrand(principal,briefDrafts.filter(d=>!d.savedCampaignId&&d.status!=='cancelled').map(d=>({id:d.id,status:d.status,title:d.input.title||d.input.goal,brandId:d.input.brandId,campaignId:d.campaignId,createdAt:d.createdAt}))).slice(0,10),
   // campaigns[].status는 저장값 그대로 두고 화면용 파생 상태(derivedStatus·statusReason, lib/campaign-status.ts)를 더한다.
   ...await franchiseWorkspaceTasks(who),
   brands,campaigns:withDerivedStatus(campaigns,{artifacts,runs,sequences,meetings,publications,metrics}),artifacts:await refreshGrowthLessonArtifacts(owner,campaigns,artifacts),metrics,events:events.slice(0,60),runs,sequences,worker,connection:{...shared,...(admin?{endpoint}:{}),canConfigure:shared.canConfigure&&admin},preview:process.env.NODE_ENV==='development',
  }));
 }catch(e){return failure(e)}
}
