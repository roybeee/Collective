// POS 공급자 추상화(C7). 공급자는 외부 POS의 주문·결제를 읽어 기존 외부 몰 주문 모양(StorefrontRow)으로 정규화한다.
// 그 뒤 장부 반영(lib/order-ingest-server.ts)·귀속·증분 계산은 공급자와 무관하게 기존 경로를 그대로 쓴다. 외부 쓰기는 없다.
import type {StorefrontRow} from '../storefront-orders';

export type PosProviderKey='tossplace';
// 저장된 자격증명(암호문을 푼 형태). webhookSecret은 개발자센터 앱의 웹훅 서명 키다(비우면 웹훅을 받지 않는다).
export type PosCredential={accessKey:string;secretKey:string;webhookSecret:string};
// 조회 커서. since~to 범위(결제 내역 변동 시각)를 page 단위로 읽는다. 한 바퀴가 끝나면 since를 마지막 변동 시각(겹침 포함)으로 올리고 page를 1로 되돌린다.
export type PosCursor={since:string;to:string;page:number};
export type PosOrderPage={rows:StorefrontRow[];count:number;skipped:number;skipReasons:Record<string,number>;nextCursor:PosCursor;hasMore:boolean};
export type PosFailureKind='unauthorized'|'rate_limited'|`http_${number}`|'network'|'timeout'|'too_large'|'invalid_response';
export type PosFailure={kind:PosFailureKind;retryAt:number|null};
export type PosListResult={ok:true;page:PosOrderPage}|{ok:false;failure:PosFailure};
export type PosPayment={id:string;orderId:string;state:'APPROVED'|'CANCELLED'|'UNDEFINED';amount:number};
export type PosPaymentsResult={ok:true;payments:PosPayment[]}|{ok:false;failure:PosFailure};
export type PosWebhookVerdict={ok:true;webhookId:string;timestamp:number}|{ok:false;reason:'missing_headers'|'stale'|'bad_signature'};
export type PosNormalized={row:StorefrontRow;updatedAt:number}|{skip:string};

export interface PosProvider{
 readonly key:PosProviderKey;
 /** 한 페이지를 읽는다. 읽기 전용 GET이며 실패하면 커서를 바꾸지 않는다. */
 listOrders(credential:PosCredential,merchantId:string,cursor:PosCursor|null,today:string,now:number):Promise<PosListResult>;
 /** 한 주문의 결제 내역. 대조용이며 장부 반영에는 쓰지 않는다. */
 listPayments(credential:PosCredential,merchantId:string,orderId:string):Promise<PosPaymentsResult>;
 /** 웹훅 서명·시각 창 검증. 본문은 원문 그대로 넘긴다. */
 verifyWebhook(secret:string,headers:Headers,raw:string,now:number):Promise<PosWebhookVerdict>;
 /** 공급자 주문 하나를 장부 행으로 바꾼다. 미확정 주문은 skip 사유를 돌려준다. */
 normalize(order:unknown,today:string):PosNormalized;
}
