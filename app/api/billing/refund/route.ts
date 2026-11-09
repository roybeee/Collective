// 환불 요청(소유자). 구매 크레딧이 남아 있으면 결제를 취소하고, 일부를 썼으면 막지 않고 담당자 확인 요청으로 접수한다.
import {body,database,failure,json,requireOwnerActor,secureMutation} from '@/lib/server';
import {requestRefund} from '@/lib/billing-server';

export async function POST(req:Request){
 try{secureMutation(req);const who=await requireOwnerActor(req);return json(await requestRefund(database(),who,await body(req)))}catch(error){return failure(error)}
}
