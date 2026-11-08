import {actor,identity,secureMutation,body,failure,json,database} from '@/lib/server';
import {executeRole} from '@/lib/role-execution';
import {assertCampaignNotArchived} from '@/lib/campaign-archive';
import {assertAutonomy,markAutonomy} from '@/lib/autonomy-server';
import {roles} from '@/lib/agency';

// 실행 전 계획 카드(X3)의 근거: 소유자의 최근 종료 역할 실행(접수·종료 시각·보고 토큰). 실행 내용은 바꾸지 않고 읽기만 한다. 캠페인 번호를 주면 그 캠페인을 먼저 세운다.
const RECENT_LIMIT=40;
export async function GET(req:Request){
 try{
  const owner=await identity(req),campaignId=new URL(req.url).searchParams.get('campaignId')||'';
  const rows=await database().prepare(`SELECT id,campaign_id,role,status,tokens,created_at,updated_at FROM jobs WHERE owner=? AND role IN (SELECT value FROM json_each(?)) AND status IN ('completed','failed','cancelled','incomplete') ORDER BY (campaign_id=?) DESC,updated_at DESC LIMIT ${RECENT_LIMIT}`).bind(owner,JSON.stringify(roles.map(r=>r.id)),campaignId).all<{id:string;campaign_id:string;role:string;status:string;tokens:number|null;created_at:string;updated_at:string}>();
  const recent=rows.results.map(r=>{const start=Date.parse(r.created_at),end=Date.parse(r.updated_at),ok=Number.isFinite(start)&&Number.isFinite(end)&&end>=start;
   return {id:r.id,campaignId:r.campaign_id,role:r.role,status:r.status,tokens:typeof r.tokens==='number'&&r.tokens>0?r.tokens:null,startedAt:r.created_at,finishedAt:r.updated_at,durationMs:ok&&r.status==='completed'?end-start:null}});
  return json({recent});
 }catch(error){return failure(error)}
}

export async function POST(req:Request){
 try{
  const who=await actor(req);
  secureMutation(req);
  const b=await body(req);
  // 보관 캠페인에는 새 역할 실행을 시작하지 않는다(409). 연속 실행 시작·진행은 lib/campaign-sequence.ts가 잠금 안에서 막는다.
  // 역할 start 검사는 잠금 밖 빠른 거절이다. 보관과 경합해 통과한 시작은 lib/role-execution.ts start가 소유자 잠금 안에서 캠페인을 읽은 직후 다시 검사해 409로 막는다(PR 4a-2).
  if(b.action==='start')await assertCampaignNotArchived(who.owner,b.campaignId);
  // G3 자율성 규칙: 역할 실행 시작(단독·연속)이 금지(never)면 403, 자동(auto)이면 응답에 autonomy:'auto'만 덧붙인다(확인 후·꺼짐은 그대로).
  const autonomy=b.action==='start'||b.action==='start_sequence'?await assertAutonomy(who.owner,'role_run'):null;
  return await markAutonomy(await executeRole(who.owner,b,{id:who.id,email:who.email}),autonomy);
 }catch(error){return failure(error)}
}
