// 충전 주문 만들기(소유자). 금액은 서버 상수의 부가세 포함 총액이다. 결제 승인은 /api/billing/confirm.
import {body,database,failure,json,requireOwnerActor,secureMutation} from '@/lib/server';
import {createCheckout} from '@/lib/billing-server';

export async function POST(req:Request){
 try{secureMutation(req);const who=await requireOwnerActor(req);return json(await createCheckout(database(),who,await body(req)))}catch(error){return failure(error)}
}
