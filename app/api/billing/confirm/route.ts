// 토스페이먼츠 결제 승인(소유자, 멱등). 금액이 주문과 다르면 승인하지 않는다. 시크릿 키는 테스트 키(test_)만 쓴다(BILLING_LIVE=1은 대표 결정).
import {body,database,failure,json,requireOwnerActor,secureMutation} from '@/lib/server';
import {confirmPayment} from '@/lib/billing-server';

export async function POST(req:Request){
 try{secureMutation(req);const who=await requireOwnerActor(req);return json(await confirmPayment(database(),who,await body(req)))}catch(error){return failure(error)}
}
