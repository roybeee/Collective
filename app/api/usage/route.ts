import {requireAdmin,ApiError,body,failure,identity,json,secureMutation,str} from '@/lib/server';
import {listUsagePricing,saveUsagePricing} from '@/lib/usage-ledger';
import {usageView} from '@/lib/usage-export';
import {recentModelChanges,reportedModels} from '@/lib/usage-model-alarm';
import {gatewayStatus} from '@/lib/gateway-snapshot';
import {campaignGradings} from '@/lib/online-grading';

export async function GET(req:Request){
 try{
  const owner=await identity(req),params=new URL(req.url).searchParams;
  // 캠페인 상세 작업물 옆 온라인 채점 요약(F2b). 사용량 화면 응답과 따로 읽는다.
  if(params.has('grading'))return json({gradings:await campaignGradings(owner,str(params.get('grading'),'캠페인',100,true))});
  const [view,pricing,modelChanges,models,gateway]=await Promise.all([usageView(owner),listUsagePricing(owner),recentModelChanges(owner,20),reportedModels(owner),gatewayStatus(owner)]);
  return json({entries:view.entries,campaigns:view.campaigns,pricing,modelChanges,reportedModels:models,gateway,notice:'비용은 직접 등록한 단가로 계산한 추정치입니다. 도구 요금·할인·캐시 요금·세금은 포함하지 않습니다. 단가나 토큰 정보가 없으면 금액은 미확인입니다.'});
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 try{
  const owner=await identity(req);secureMutation(req);await requireAdmin(req);const input=await body(req);
  if(!input||input.action!=='set_pricing')throw new ApiError(400,'지원하지 않는 사용량 설정입니다.');
  return json({pricing:await saveUsagePricing(owner,input)});
 }catch(error){return failure(error)}
}
