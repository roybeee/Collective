import {actor,acquireLock,body,failure,json,releaseLock,secureMutation} from '@/lib/server';
import {executionRate} from '@/lib/execution-rate';
import {listShareLinks,shareLinkAction} from '@/lib/share-links-server';

// 공유 링크 소유자 쪽 API(G4, docs/SHARE-LINKS.ko.md). 대표·관리자만(직원 403, 비로그인 401). 공개 조회는 /api/share/[token]과 /share/[token]이다.
// GET ?kind=customer_report|artifact(&id=): 그 대상의 링크 목록(상태·조회 수·외부 결정 시각). 스위치가 꺼져도 읽는다.
// POST {action:'create',scope:{kind,id},label,days?} · {action:'revoke',id}: 같은 출처 요청, 소유자 변경 잠금, 빈도 제한. 만들기 응답의 token은 이때 한 번만 온다.
export async function GET(req:Request){
 try{
  const who=await actor(req);
  return json(await listShareLinks(who.owner,new URL(req.url).searchParams));
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  lock=await acquireLock(owner);
  await executionRate(owner,'share_links');
  return json(await shareLinkAction(owner,input,who));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
