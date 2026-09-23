import {identity,actor,secureMutation,body,str,json,failure,database,readRecord,acquireLock,releaseLock} from '@/lib/server';
import {executionRate} from '@/lib/execution-rate';
import {listDirectives,changeDirective,DIRECTIVE_MAX_LENGTH,DIRECTIVE_LIMIT} from '@/lib/campaign-directives';
import {evidenceContext,evidenceSummary} from '@/lib/ai-context';
import type {Campaign} from '@/lib/agency';

// 캠페인 상세의 상시 지시 목록과 'AI 팀에 전달되는 근거' 요약.
export async function GET(req:Request){
 try{
  const owner=await identity(req);
  const campaign=await readRecord<Campaign>(owner,'campaign',str(new URL(req.url).searchParams.get('campaignId')??'','캠페인',100,true));
  const [directives,evidence]=await Promise.all([listDirectives(owner,campaign.id),evidenceContext(database(),owner,campaign)]);
  return json({directives,limits:{maxLength:DIRECTIVE_MAX_LENGTH,count:DIRECTIVE_LIMIT},evidence:evidenceSummary(evidence)});
 }catch(error){return failure(error)}
}

// 직원도 추가·삭제할 수 있다(브리프 작성과 같은 권한). 단 관리자가 남긴 지시는 관리자만 지운다. 행위자와 이력을 남기고 브리프 version은 올리지 않는다.
// 상시 지시는 사실 근거가 아니다. AI 지시문이 사실 확정·금지 표현 해제를 막는다(lib/campaign-policy.ts directivePolicy).
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  lock=await acquireLock(owner);
  await executionRate(owner,'directives');
  return json(await changeDirective(owner,input,who));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
