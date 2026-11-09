// 선불 크레딧 요금제 요약(G8). 요금제·충전 상품(부가세 포함 총액)·잔액·원장·주문·알림. 스위치 credit_billing이 꺼져 있으면 표만 준다.
import {actor,database,failure,json} from '@/lib/server';
import {billingSummary} from '@/lib/billing-server';

export async function GET(req:Request){
 try{return json(await billingSummary(database(),await actor(req)))}catch(error){return failure(error)}
}
