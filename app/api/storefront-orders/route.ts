import {prepareStorefrontImport} from '@/lib/storefront-orders-server';
import type {Store} from '@/lib/store-marketing';
import {koreaToday,ledgerSummary} from '@/lib/store-operations';
import {getStoreOperations} from '@/lib/store-operations-server';
import {ImportError} from '@/lib/order-import';
import {parseStorefrontOrders,storefrontSource,StorefrontInputError,type StorefrontOrderLink} from '@/lib/storefront-orders';
import {ApiError,acquireLock,actor,body,database,failure,json,listRecords,readRecord,releaseLock,requireAdminActor,secureMutation,str} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),p=new URL(req.url).searchParams,id=str(p.get('storeId'),'지점',100,true);const store=await readRecord<Store>(who.owner,'store',id),rows=await listRecords<StorefrontOrderLink>(who.owner,'storefront_order_link',id),ops=await getStoreOperations(who.owner,id,p.get('from')??undefined,p.get('to')??undefined);return json({canEdit:who.role!=='member',storeName:store.name,linkedOrders:rows.length,sources:[...new Set(rows.map(x=>x.sourceKey))],from:ops.from,to:ops.to,summary:ledgerSummary(ops.orders,[]),orders:ops.orders.slice(0,50),scope:'store_all_channels',externalTransmissions:0})}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);if(b.action!=='preview'&&b.action!=='import')throw new ApiError(400,'지원하지 않는 주문 작업입니다.');
 const sourceKey=storefrontSource(b.sourceKey),rows=parseStorefrontOrders(b.csv,koreaToday());owner=who.owner;lock=await acquireLock(owner);
 const store=await readRecord<Store>(owner,'store',str(b.storeId,'지점',100,true));if(store.status!=='active')throw new ApiError(409,'보관된 지점에는 주문을 가져올 수 없습니다.');
 const {writes,result}=await prepareStorefrontImport(owner,store,sourceKey,rows,who.id),{previewKey}=result;
 if(b.action==='preview')return json(result);
 if(b.previewKey!==previewKey)throw new ApiError(409,'미리보기 이후 입력이나 장부가 바뀌었습니다. 내용을 다시 확인하세요.');
 if(writes.length)await database().batch(writes);
 return json({...result,externalTransmissions:0});
 }catch(e){return failure(e instanceof StorefrontInputError||e instanceof ImportError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
