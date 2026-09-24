import {requireOwnerActor,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {promptRegistryAction,promptRegistryRead} from '@/lib/prompt-registry';

// 프롬프트 레지스트리(F3a). 읽기·쓰기 모두 워크스페이스 소유자만 한다: 비로그인 401, 관리자·직원 403, 다른 소유자의 버전·단위는 404(소유자 범위 records).
// 등록은 공개 저장소 raw 경로 두 번을 읽으므로 소유자 잠금 밖에서 하고(불변 INSERT OR IGNORE), 롤백은 잠금 안에서 포인터를 한 번 바꾼다.
export async function GET(req:Request){
 try{const who=await requireOwnerActor(req);return json(await promptRegistryRead(who.owner,new URL(req.url).searchParams))}catch(error){return failure(error)}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await requireOwnerActor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  if(input.action!=='register')lock=await acquireLock(owner);
  return json(await promptRegistryAction(owner,input,{id:who.id,email:who.email}));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
