import {ImportError} from '@/lib/order-import';
import {StorefrontInputError} from '@/lib/storefront-orders';
import {pullOnce,saveStorefrontPull,storefrontPullView} from '@/lib/storefront-pull-server';
import {ApiError,requireAdminActor,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
const error=(e:unknown)=>failure(e instanceof StorefrontInputError||e instanceof ImportError?new ApiError(400,e.message):e);
export async function GET(req:Request){try{const c=new URL(req.url).searchParams.get('campaignId');if(c!==null&&!/^[A-Za-z0-9_-]{1,100}$/.test(c))throw new ApiError(400,'캠페인을 확인하세요.');return json(await storefrontPullView(await requireAdminActor(req),c??undefined))}catch(e){return error(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);
 if(b.action==='pull_now'){if(who.role!=='owner')throw new ApiError(403,'수동 조회는 소유자만 합니다.');const id=String(b.id??'');if(!/^[a-f0-9-]{36}$/.test(id))throw new ApiError(400,'연결 ID를 확인하세요.');return json({recorded:true,...await pullOnce(owner,id)})}
 return json(await saveStorefrontPull(who,b))}catch(e){return error(e)}finally{if(lock)await releaseLock(owner,lock)}}
