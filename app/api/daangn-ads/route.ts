import {requireAdminActor,secureMutation,body,json,failure,ApiError} from '@/lib/server';
import {collectDaangn,connectDaangn,daangnStatus,listDaangnPerformance,revokeDaangn,verifyDaangnConnection,requireDaangn,requireDaangnAdmin} from '@/lib/daangn-ads-server';
import {listDaangnConversions,queueDaangnConversions,resolveDaangnConversion,sendDaangnConversions} from '@/lib/daangn-conversions-server';

// C8 당근 광고 연결·확인·해제·성과 수집. 읽기·쓰기 모두 소유자·관리자(직원 403, 비로그인 401, 다른 출처 403).
// 스위치 daangn_ads가 꺼져 있으면 connect·verify·collect는 409, revoke와 GET(연결 상태·저장된 성과)은 계속된다. 제안·승인·반영은 /api/ads-proposals에 channel 'daangn_ads'로 보낸다.
// 응답에 API 키 원문은 없다(docs/DAANGN-ADS.ko.md).
const scope=(url:URL)=>({brandId:url.searchParams.get('brandId')||undefined,storeId:url.searchParams.get('storeId')||undefined});
export async function GET(req:Request){
 try{
  const who=await requireAdminActor(req),url=new URL(req.url),s=scope(url);
  return json({status:await daangnStatus(who.owner,s),performance:await listDaangnPerformance(who.owner,s.storeId??null),conversions:await listDaangnConversions(who.owner,s.storeId??null)});
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 try{
  const who=await requireAdminActor(req);secureMutation(req);const input=await body(req);
  if(input.action==='connect')return json({connection:await connectDaangn(who,input)});
  if(input.action==='verify')return json({verification:await verifyDaangnConnection(who,input)});
  if(input.action==='revoke')return json(await revokeDaangn(who,input));
  if(input.action==='collect')return json({performance:await collectDaangn(who,input)});
  // 주문 장부 → 전환 이벤트(C8 후속): 대기열 넣기(워커와 같은 동작, 외부 호출 없음)·사람이 보냄(자율성 conversion_send, 자동 없음)·미확인 행 확인으로 닫기.
  if(input.action==='queue_conversions'){requireDaangnAdmin(who);await requireDaangn(who.owner);return json(await queueDaangnConversions(who.owner,who.id))}
  if(input.action==='send_conversions')return json(await sendDaangnConversions(who,input));
  if(input.action==='resolve_conversion')return json(await resolveDaangnConversion(who,input));
  throw new ApiError(400,'지원하지 않는 작업입니다. connect·verify·revoke·collect·queue_conversions·send_conversions·resolve_conversion 중 하나를 보내세요.');
 }catch(error){return failure(error)}
}
