import {identity,json,failure,str,ApiError} from '@/lib/server';
import {artifactSources,campaignScoreSummaries} from '@/lib/artifact-sources-server';
import {requireArtifactRead,requireCampaignRead} from '@/lib/server-access';

// X7 신뢰 UI 읽기(lib/artifact-sources-server.ts). 로그인한 모든 역할이 읽는다(소유자 범위, 다른 소유자·없는 기록은 404). 쓰기·모델·외부 호출은 없다.
// ?artifact=<작업물 id>: 인용 출처 지도·AI 출처 정보·규제 점검 보기. ?campaign=<캠페인 id>: 작업물 목록의 소재 예측 점수 배지(현재 판만).
export async function GET(req:Request){
 try{
  const owner=await identity(req),params=new URL(req.url).searchParams;
  if(params.has('artifact'))await requireArtifactRead(req,params.get('artifact'));
  if(params.has('artifact'))return json(await artifactSources(owner,str(params.get('artifact'),'작업물',200,true)));
  if(params.has('campaign'))await requireCampaignRead(req,params.get('campaign'));
  if(params.has('campaign'))return json({scores:await campaignScoreSummaries(owner,str(params.get('campaign'),'캠페인',100,true))});
  throw new ApiError(400,'artifact 또는 campaign을 지정하세요.');
 }catch(error){return failure(error)}
}
