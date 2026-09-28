import {actor,secureMutation,body,json,failure,acquireLock,releaseLock,str} from '@/lib/server';
import {reflectorAction,reflectorState,ReflectorBlocked} from '@/lib/reflector-server';
// B3-2 Reflector(대표·관리자 전용, 직원 403). 차단(409)은 사유 코드(blocked)와 값 없는 detail(필드·종류·건수 등)을 함께 돌려준다. 형식은 docs/PLAYBOOK.ko.md 'B3-2 Reflector'.
const blockedOr=(e:unknown)=>e instanceof ReflectorBlocked?json({error:e.message,blocked:e.blocked,...(e.detail?{detail:e.detail}:{})},409):failure(e);
export async function GET(req:Request){try{const who=await actor(req);return json(await reflectorState(who.owner,str(new URL(req.url).searchParams.get('brandId')??'','브랜드',100,true),{id:who.id,role:who.role}))}catch(e){return blockedOr(e)}}
// 실행·결과 확인은 규칙 쓰기와 같은 소유자 잠금 안에서 한다(같은 브랜드×역할 중복 실행 방지).
export async function POST(req:Request){let owner='',token='';try{const who=await actor(req);owner=who.owner;secureMutation(req);const b=await body(req);token=await acquireLock(owner);return json(await reflectorAction(owner,b,{id:who.id,role:who.role}))}catch(e){return blockedOr(e)}finally{if(token)await releaseLock(owner,token)}}
