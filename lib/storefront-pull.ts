import {parseStorefrontWebhook} from './storefront-webhook';
import {StorefrontInputError} from './storefront-orders';
/**
 * Pull contract (G2-04/18): GET {baseUrl}?cursor=<opaque>&limit=100 with a bearer token returns
 * {"orders":[<the same 7-field COLLECTIVE order rows as the signed webhook>],"nextCursor":string|null,"hasMore":boolean}.
 * Customer data is not accepted; the cursor only advances in the same batch that stores the orders.
 */
export type PullConfigInput={storeId:string;sourceKey:string;baseUrl:string;token:string;intervalMinutes:number};
export const PULL_LIMIT=100,PULL_MAX_BYTES=256_000,PULL_TIMEOUT_MS=10_000,PULL_MAX_BACKOFF_MS=24*3600000;
const privateHost=/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;
export function parsePullConfig(value:unknown,requireToken:boolean):PullConfigInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new StorefrontInputError('가져오기 연결 입력을 확인하세요.');const b=value as Record<string,unknown>;
 const id=(v:unknown,label:string)=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))throw new StorefrontInputError(`${label}를 확인하세요.`);return v};
 if(typeof b.baseUrl!=='string'||b.baseUrl.length>500)throw new StorefrontInputError('판매처 주문 조회 URL을 확인하세요.');let url:URL;try{url=new URL(b.baseUrl)}catch{throw new StorefrontInputError('판매처 주문 조회 URL 형식을 확인하세요.')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||privateHost.test(url.hostname)||!/\.[a-z]{2,63}$/i.test(url.hostname))throw new StorefrontInputError('공개 HTTPS 주소만 쓸 수 있습니다(쿼리·인증정보·사설 주소 금지).');
 const token=b.token===undefined||b.token===''?'':String(b.token);if((requireToken||token)&&(token.length<16||token.length>500||/\s/.test(token)))throw new StorefrontInputError('조회 토큰은 공백 없는 16~500자입니다.');
 const interval=typeof b.intervalMinutes==='number'&&Number.isSafeInteger(b.intervalMinutes)&&b.intervalMinutes>=15&&b.intervalMinutes<=1440?b.intervalMinutes:(()=>{throw new StorefrontInputError('조회 간격은 15~1440분입니다.')})();
 return {storeId:id(b.storeId,'지점'),sourceKey:id(b.sourceKey,'판매처 키'),baseUrl:url.toString(),token,intervalMinutes:interval};
}
export function pullUrl(baseUrl:string,cursor:string|null){const u=new URL(baseUrl);if(cursor)u.searchParams.set('cursor',cursor);u.searchParams.set('limit',String(PULL_LIMIT));return u.toString()}
export function parsePullResponse(raw:string,today:string){
 let value:unknown;try{value=JSON.parse(raw)}catch{throw new StorefrontInputError('판매처 응답이 JSON이 아닙니다.')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new StorefrontInputError('판매처 응답 형식을 확인하세요.');const b=value as Record<string,unknown>;
 const keys=Object.keys(b).sort().join(',');if(keys!=='hasMore,nextCursor,orders')throw new StorefrontInputError('orders·nextCursor·hasMore만 받습니다. 고객 정보는 받지 않습니다.');
 if(b.nextCursor!==null&&(typeof b.nextCursor!=='string'||!/^[A-Za-z0-9_.:=-]{1,200}$/.test(b.nextCursor)))throw new StorefrontInputError('다음 커서 형식을 확인하세요.');
 if(typeof b.hasMore!=='boolean'||!Array.isArray(b.orders)||b.orders.length>PULL_LIMIT)throw new StorefrontInputError('주문 배열과 추가 여부를 확인하세요.');
 if(b.hasMore&&!b.nextCursor)throw new StorefrontInputError('추가 주문이 있으면 다음 커서가 필요합니다.');
 return {orders:b.orders.length?parseStorefrontWebhook(JSON.stringify({orders:b.orders}),today):null,count:b.orders.length,nextCursor:b.nextCursor as string|null,hasMore:b.hasMore};
}
export const backoffMs=(failures:number,intervalMinutes:number)=>Math.min(intervalMinutes*60000*2**Math.max(0,failures-1),PULL_MAX_BACKOFF_MS);
