import type {Campaign} from './agency';
import type {OrderMoneyAllocation} from './growth-order-bridge';
import {ApiError,database} from './server';
export async function bundleOrderMoneyRows(owner:string,c:Campaign){
 const result=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_bundle_order' AND json_extract(data,'$.storeId')=? LIMIT 1001").bind(owner,c.storeId).all<{data:string}>();
 if(result.results.length>1000)throw new ApiError(409,'번들 주문 이력 한도를 대사하세요.');
 const rows=result.results.map(x=>JSON.parse(x.data) as {id:string;brandId:string;storeId:string;input:OrderMoneyAllocation});
 if(rows.some(r=>r.brandId!==c.brandId||r.storeId!==c.storeId))throw new ApiError(409,'번들 주문 범위를 확인하세요.');return rows;
}
