import {actor,identity,secureMutation,body,failure} from '@/lib/server';
import {executeMeeting} from '@/lib/meeting-execution';
import {assertCampaignNotArchived,assertMeetingCampaignNotArchived} from '@/lib/campaign-archive';
import {assertAutonomy,markAutonomy} from '@/lib/autonomy-server';
import {requireAccess,campaignResource,requireCampaignRead,requireRecordAction} from '@/lib/server-access';
import {GET as meetingsGet} from '@/lib/meeting-execution';

// 회의 목록 읽기: 범위 역할은 캠페인 범위를 먼저 본다(범위 없는 역할은 이전과 같은 lib/meeting-execution.ts GET).
export async function GET(req:Request){
 try{await identity(req);await requireCampaignRead(req,new URL(req.url).searchParams.get('campaignId'))}catch(error){return failure(error)}
 return meetingsGet(req);
}

export async function POST(req:Request){
 try{
  const who=await actor(req);
  secureMutation(req);
  const b=await body(req);
  // 보관 캠페인에는 새 팀 회의·실패 회의 재시도를 시작하지 않는다(409). 잠금 밖 빠른 거절이다. 보관과 경합해 통과한 요청은 lib/meeting-execution.ts start·retry_failed가 소유자 잠금 안에서 다시 검사해 409로 막는다(PR 4a-2).
  // G7: 팀 회의 시작은 run_ai 권한이다(대표·관리자·직원 그대로, 브랜드 매니저는 배정 브랜드만, 점포 매니저·검토자 403).
  if(b.action==='start')await requireAccess(req,'run_ai',()=>campaignResource(who.owner,b.campaignId));
  // 범위 가드: 진행·복구·중지·재시도·이견 선택도 그 회의 캠페인의 run_ai다(대표·관리자·직원 그대로).
  else await requireRecordAction(req,'run_ai','team_meeting',b.id);
  if(b.action==='start')await assertCampaignNotArchived(who.owner,b.campaignId);
  if(b.action==='retry_failed')await assertMeetingCampaignNotArchived(who.owner,b.id);
  // G3 자율성 규칙: 회의 시작이 금지(never)면 403, 자동(auto)이면 응답에 autonomy:'auto'만 덧붙인다(확인 후·꺼짐은 그대로).
  const autonomy=b.action==='start'?await assertAutonomy(who.owner,'meeting_start'):null;
  return await markAutonomy(await executeMeeting(who.owner,b,{id:who.id,email:who.email}),autonomy);
 }catch(error){return failure(error)}
}
