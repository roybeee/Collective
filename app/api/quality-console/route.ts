import {actor,ApiError,failure,json} from '@/lib/server';
import {consoleDigest,consoleView,consoleWeek} from '@/lib/quality-console-server';

// B2 품질 콘솔(읽기 전용 GET, 잠금·쓰기·모델 호출 없음). 소유자·관리자만: 비로그인 401, 직원 403, 다른 워크스페이스의 캠페인(campaignId)은 404.
// 기본: from·to(KST YYYY-MM-DD, 기본 최근 28일, 최대 180일)의 지표·기준별 κ·주간 추이 JSON.
// week=YYYY-Www: 그 주·전주 요약과 누적 κ JSON {week,summary,previous,kappa}. 로컬 스크립트 scripts/quality-digest.mjs가 이 JSON을 읽는다.
// format=digest(&week=, 기본 지난주): 같은 주간 묶음의 한국어 마크다운 첨부 파일.
export async function GET(req:Request){
 try{
  const who=await actor(req),params=new URL(req.url).searchParams,format=params.get('format');
  if(who.role==='member')throw new ApiError(403,'품질 콘솔은 소유자·관리자만 볼 수 있습니다.');
  if(format==='digest'){
   const digest=await consoleDigest(who.owner,params);
   return new Response(digest.markdown,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${digest.filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(format&&format!=='json')throw new ApiError(400,'지원하지 않는 형식입니다.');
  return json(params.has('week')?await consoleWeek(who.owner,params):await consoleView(who.owner,params));
 }catch(error){return failure(error)}
}
