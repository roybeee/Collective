import {readBoundedText,HttpBodyError} from '@/lib/http-limits';
import {ImportError} from '@/lib/order-import';
import {StorefrontInputError} from '@/lib/storefront-orders';
import {POS_WEBHOOK_MAX_BYTES,receivePosWebhook} from '@/lib/pos/server';
import {ApiError,failure,json} from '@/lib/server';
// 토스플레이스 웹훅 수신(C7). 브라우저 인증이 아니라 서명(x-toss-signature)·시각 창·멱등 키로만 받는다. 응답에 주문 ID를 싣지 않는다.
export async function POST(req:Request){
 try{const raw=await readBoundedText(req,POS_WEBHOOK_MAX_BYTES);return json(await receivePosWebhook(raw,req.headers))}
 catch(e){return failure(e instanceof HttpBodyError?new ApiError(e.status,e.message):e instanceof StorefrontInputError||e instanceof ImportError?new ApiError(400,e.message):e)}
}
