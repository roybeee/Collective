import {ImportError} from '@/lib/order-import';
import {StorefrontInputError} from '@/lib/storefront-orders';
import {posConnectionView,pullOnce,savePosConnection} from '@/lib/pos/server';
import {ApiError,requireAdminActor,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
// 토스플레이스 POS 연결(C7). 조회는 대표·관리자, 설정·수동 조회는 소유자만. 비밀값은 응답에 싣지 않는다.
const error=(e:unknown)=>failure(e instanceof StorefrontInputError||e instanceof ImportError?new ApiError(400,e.message):e);
export async function GET(req:Request){try{return json(await posConnectionView(await requireAdminActor(req)))}catch(e){return error(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);
 if(b.action==='pull_now'){if(who.role!=='owner')throw new ApiError(403,'수동 조회는 소유자만 합니다.');const id=String(b.id??'');if(!/^[a-f0-9-]{36}$/.test(id))throw new ApiError(400,'연결 ID를 확인하세요.');return json({recorded:true,...await pullOnce(owner,id)})}
 return json(await savePosConnection(who,b))}catch(e){return error(e)}finally{if(lock)await releaseLock(owner,lock)}}
