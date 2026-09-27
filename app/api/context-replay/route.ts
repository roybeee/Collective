import {actor,ApiError,failure,json} from '@/lib/server';
import {contextReplay,contextReplayMarkdown} from '@/lib/context-replay-server';

// B5 맥락 정책 리플레이(읽기 전용 GET, 잠금·쓰기·모델 호출 없음, 설계 docs/CONTEXT-REPLAY.ko.md). 소유자·관리자만: 비로그인 401, 직원 403.
// limit(1~200, 기본 50)·kind(role|meeting|all, 기본 all): 최근 역할·회의 제출 입력의 키별 문자 수·정책별 절약량·보존 지표 JSON {filter,read,replay,notice}. 원문은 싣지 않는다.
// format=markdown: 같은 비교표의 한국어 마크다운 첨부(collective-context-replay-YYYY-MM-DD.md, 한국 시간 날짜). 로컬 스크립트 scripts/eval/context-replay.mjs가 JSON 응답으로 같은 표를 낸다.
export async function GET(req:Request){
 try{
  const who=await actor(req),params=new URL(req.url).searchParams,format=params.get('format');
  if(who.role==='member')throw new ApiError(403,'맥락 리플레이는 소유자·관리자만 볼 수 있습니다.');
  if(format==='markdown'){
   const report=await contextReplayMarkdown(who.owner,params);
   return new Response(report.markdown,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${report.filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(format&&format!=='json')throw new ApiError(400,'지원하지 않는 형식입니다.');
  return json(await contextReplay(who.owner,params));
 }catch(error){return failure(error)}
}
