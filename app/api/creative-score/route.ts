import {actor,requireAdminActor,secureMutation,body,json,failure,ApiError,str} from '@/lib/server';
import {artifactCreativeScore,recomputeCreativeScore,calibrateCreativeScores,brandCalibration} from '@/lib/creative-score-server';
import {requireArtifactRead,requireBrandRead} from '@/lib/server-access';

// 소재 예측 점수(G2, docs/CREATIVE-SCORE.ko.md). 읽기는 로그인한 모든 역할(작업물 점수 ?artifactId= 또는 보정표 ?brandId=&channel=).
// 쓰기(다시 계산·보정표 만들기)는 대표·관리자만(직원 403, 비로그인 401). 다시 계산은 스위치 creative_score가 꺼져 있으면 409다. 모델·외부 호출은 없다.
export async function GET(req:Request){
 try{
  const who=await actor(req),params=new URL(req.url).searchParams;
  if(params.has('artifactId'))await requireArtifactRead(req,params.get('artifactId'));
  if(params.has('artifactId'))return json(await artifactCreativeScore(who.owner,str(params.get('artifactId'),'작업물',200,true)));
  if(params.has('brandId'))await requireBrandRead(req,params.get('brandId'));
  if(params.has('brandId'))return json({calibration:await brandCalibration(who.owner,str(params.get('brandId'),'브랜드',100,true),str(params.get('channel'),'채널',100,true))});
  throw new ApiError(400,'artifactId 또는 brandId와 channel을 지정하세요.');
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 try{
  const who=await requireAdminActor(req);secureMutation(req);const input=await body(req);
  if(input.action==='recompute')return json(await recomputeCreativeScore(who.owner,str(input.artifactId,'작업물',200,true)));
  if(input.action==='calibrate')return json(await calibrateCreativeScores(who.owner,input));
  throw new ApiError(400,'지원하지 않는 소재 점수 작업입니다.');
 }catch(error){return failure(error)}
}
