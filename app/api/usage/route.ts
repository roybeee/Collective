import {ApiError,body,failure,identity,json,secureMutation} from '@/lib/server';
import {listProviderUsage,listUsagePricing,saveUsagePricing} from '@/lib/usage-ledger';

export async function GET(req:Request){
 try{
  const owner=identity(req),[entries,pricing]=await Promise.all([listProviderUsage(owner),listUsagePricing(owner)]);
  return json({entries,pricing,notice:'비용은 직접 등록한 단가로 계산한 추정치입니다. 도구 요금·할인·캐시 요금·세금은 포함하지 않습니다. 단가나 토큰 정보가 없으면 금액은 미확인입니다.'});
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 try{
  const owner=identity(req);secureMutation(req);const input=await body(req);
  if(!input||input.action!=='set_pricing')throw new ApiError(400,'지원하지 않는 사용량 설정입니다.');
  return json({pricing:await saveUsagePricing(owner,input)});
 }catch(error){return failure(error)}
}
