import {actor,acquireLock,body,failure,json,releaseLock,secureMutation} from '@/lib/server';
import {executionRate} from '@/lib/execution-rate';
import {apiKeyAction,listApiKeys} from '@/lib/api-keys-server';

// API 키 소유자 쪽 API(G9, docs/MCP-SERVER.ko.md). 대표·관리자만(직원 403, 비로그인 401). 키를 쓰는 곳은 /api/mcp다.
// GET: 키 목록(라벨·범위·접두어·끝 4자·만료·취소·마지막 사용). 키 원문·해시는 없다. 스위치가 꺼져도 읽는다.
// POST {action:'create',label,scope:'read'|'draft',days?} · {action:'revoke',id}: 같은 출처 요청, 소유자 변경 잠금, 빈도 제한. 만들기 응답의 token은 이때 한 번만 온다.
export async function GET(req:Request){
 try{return json(await listApiKeys(await actor(req)))}catch(error){return failure(error)}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  lock=await acquireLock(owner);
  await executionRate(owner,'api_keys');
  return json(await apiKeyAction(who,input));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
