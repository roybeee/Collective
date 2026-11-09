import {requireAdminActor,secureMutation,body,json,failure,ApiError} from '@/lib/server';
import {applyProposal,approveProposal,createManualProposal,generateProposals,proposalsView,reconcileProposal,rejectProposal} from '@/lib/ads-proposals-server';

// C4 네이버 검색광고 제안→승인→반영. 읽기·쓰기 모두 소유자·관리자(직원 403, 비로그인 401, 다른 출처 403).
// 스위치 naver_ads_write가 꺼져 있으면 approve·apply는 409 '쓰기 스위치 꺼짐'. generate·create·reject·reconcile은 스위치와 무관(외부 쓰기 없음).
// C8: channel 'daangn_ads'(GET 쿼리·POST 본문)는 당근 광고 제안이다. 스위치 daangn_ads가 꺼져 있으면 generate·approve·apply가 409이고 reject·reconcile·조회는 계속된다(docs/DAANGN-ADS.ko.md).
const optional=(value:string|null)=>value&&value.length<=100?value:null;
const channel=(value:unknown)=>value==='naver_ads'||value==='daangn_ads'?value:null;
export async function GET(req:Request){
 try{
  const who=await requireAdminActor(req),url=new URL(req.url);
  return json(await proposalsView(who,{campaignId:optional(url.searchParams.get('campaignId')),storeId:optional(url.searchParams.get('storeId')),channel:channel(url.searchParams.get('channel'))}));
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 try{
  const who=await requireAdminActor(req);secureMutation(req);const input=await body(req);
  const view=()=>proposalsView(who,{campaignId:typeof input.campaignId==='string'?input.campaignId:null,storeId:typeof input.storeId==='string'?input.storeId:null,channel:channel(input.channel)});
  if(input.action==='generate')return json({...await generateProposals(who,input),...await view()});
  if(input.action==='create')return json({proposal:await createManualProposal(who,input),...await view()});
  if(input.action==='approve')return json({...await approveProposal(who,input),...await view()});
  if(input.action==='reject')return json({proposal:await rejectProposal(who,input),...await view()});
  if(input.action==='apply')return json({proposal:await applyProposal(who,input),...await view()});
  if(input.action==='reconcile')return json({proposal:await reconcileProposal(who,input),...await view()});
  throw new ApiError(400,'지원하지 않는 작업입니다. generate·create·approve·reject·apply·reconcile 중 하나를 보내세요.');
 }catch(error){return failure(error)}
}
