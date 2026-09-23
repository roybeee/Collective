import {requireAdmin,requireOwnerActor,ApiError,body,database,failure,identity,json,secureMutation,str} from '@/lib/server';
import {aliasPricingContext,listUsagePricing,saveAliasPricing,saveUsagePricing} from '@/lib/usage-ledger';
import {aliasPricingWarning} from '@/lib/usage-summary';
import {setTokenBudget,tokenBudgetSummary} from '@/lib/token-budget';
import {usageView} from '@/lib/usage-export';
import {recentModelChanges,reportedModels} from '@/lib/usage-model-alarm';
import {gatewayStatus} from '@/lib/gateway-snapshot';
import {campaignGradings} from '@/lib/online-grading';

export async function GET(req:Request){
 try{
  const owner=await identity(req),params=new URL(req.url).searchParams;
  // 캠페인 상세 작업물 옆 온라인 채점 요약(F2b). 사용량 화면 응답과 따로 읽는다.
  if(params.has('grading'))return json({gradings:await campaignGradings(owner,str(params.get('grading'),'캠페인',100,true))});
  // budget: 이번 달(한국 시간) 토큰 예산 요약(loop-4). aliasPricing: 별칭 단가 선언과 경보 경고(loop-5).
  const [view,pricing,modelChanges,models,gateway,budget,alias]=await Promise.all([usageView(owner),listUsagePricing(owner),recentModelChanges(owner,20),reportedModels(owner),gatewayStatus(owner),tokenBudgetSummary(database(),owner),aliasPricingContext(owner)]);
  return json({entries:view.entries,campaigns:view.campaigns,pricing,modelChanges,reportedModels:models,gateway,budget,aliasPricing:alias.declarations,aliasPricingWarning:aliasPricingWarning(alias.declarations,alias.changes),notice:'비용은 직접 등록한 단가로 계산한 추정치입니다. 도구 요금·할인·캐시 요금·세금은 포함하지 않습니다. 단가나 토큰 정보가 없으면 금액은 미확인입니다.'});
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 try{
  const owner=await identity(req);secureMutation(req);await requireAdmin(req);const input=await body(req);
  // 토큰 상한과 별칭 단가 선언은 워크스페이스 소유자만(관리자·직원 403). 모델 단가 등록은 기존대로 관리자 이상.
  if(input?.action==='set_budget'||input?.action==='set_alias_pricing'){
   const who=await requireOwnerActor(req);
   return json(input.action==='set_budget'?{budget:await setTokenBudget(database(),who.owner,input,{id:who.id,email:who.email})}:{aliasPricing:await saveAliasPricing(who.owner,input)});
  }
  if(!input||input.action!=='set_pricing')throw new ApiError(400,'지원하지 않는 사용량 설정입니다.');
  return json({pricing:await saveUsagePricing(owner,input)});
 }catch(error){return failure(error)}
}
