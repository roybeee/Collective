// A4-2 게시별 추적 코드(서버). 실행 쪽(발행 캡션)이 게시마다 쿠폰·POS 태그 코드를 받아 캡션에 넣을 때 부르는 공용 인터페이스다.
// 코드 형식(워크스페이스 유일·혼동 문자 제외)과 캠페인 규칙(그 지점 캠페인이나 같은 브랜드 공통 캠페인)은 점포 화면의 코드 만들기(lib/store-operations-server.ts)와 같다.
// 게시 상태·예약 시각은 여기서 보지 않는다. 게시 전에 코드를 만들어 캡션에 넣어야 하므로 주문을 귀속할 때(가져오기·주문 수정) 검사한다(lib/store-attribution.ts publicationRefusal).
// 권한(관리자)과 워크스페이스 쓰기 잠금은 부르는 쪽이 확인한다.
import type {Campaign} from './agency';
import type {Store} from './store-marketing';
import {ApiError,database,readRecord,recordStatement,stamp,str} from './server';
import {koreaToday} from './store-operations';
import {freeCode,linkedPublication,validateOrderAttribution} from './store-operations-server';
import {trackingCodeTypes,type TrackingCode} from './tracking-codes';

export type PublicationCodeType='coupon'|'pos_tag';
const PUBLICATION_CODE_TYPES:readonly string[]=['coupon','pos_tag'];
// 게시 코드로 귀속한 주문의 유입 채널. 발행 채널이 Instagram(Buffer)이라 SNS · 숏폼이다.
const PUBLICATION_CHANNEL='social';

// 캡션에 넣는 게시 코드(쿠폰·POS 태그 중 먼저 만든 것). 점포 화면에서 같은 게시에 묶은 QR·UTM 코드는 캡션 코드가 아니다.
export async function publicationCodeFor(owner:string,publicationId:string):Promise<TrackingCode|null>{
 const row=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='tracking_code' AND json_extract(data,'$.publicationId')=? AND json_extract(data,'$.type') IN ('coupon','pos_tag') ORDER BY json_extract(data,'$.createdAt'), id LIMIT 1").bind(owner,publicationId).first<{data:string}>();
 return row?JSON.parse(row.data) as TrackingCode:null;
}

// 멱등: 같은 게시에 캡션 코드가 이미 있으면 새로 만들지 않고 그 코드를 돌려준다(종류가 달라도). 다른 캠페인·소재·지점으로 다시 부르면 409다.
export async function issuePublicationCode(owner:string,input:{campaign:Campaign;publicationId:string;creativeId:string;storeId:string;type:PublicationCodeType;who:{id:string;email:string|null}}):Promise<TrackingCode>{
 if(!PUBLICATION_CODE_TYPES.includes(input.type))throw new ApiError(400,'게시 코드는 쿠폰 또는 POS 태그로 고르세요.');
 const publicationId=str(input.publicationId,'게시',100,true),creativeId=str(input.creativeId,'소재',100,true),storeId=str(input.storeId,'지점',100,true),campaignId=input.campaign.id;
 const existing=await publicationCodeFor(owner,publicationId);
 if(existing){if(existing.campaignId!==campaignId||existing.creativeId!==creativeId||existing.storeId!==storeId)throw new ApiError(409,'이 게시에는 다른 캠페인·소재·지점의 코드가 이미 있습니다.');return existing}
 const store=await readRecord<Store>(owner,'store',storeId);
 if(store.status!=='active')throw new ApiError(409,'보관한 지점입니다.');
 await validateOrderAttribution(owner,store,{campaignId,creativeId,experimentId:''});
 await linkedPublication(owner,publicationId,campaignId,creativeId,false);
 const code=await freeCode(owner,input.type,undefined);
 const record:TrackingCode={id:code,code,type:input.type,storeId:store.id,campaignId,creativeId,publicationId,channel:PUBLICATION_CHANNEL,label:`게시 캡션 ${trackingCodeTypes[input.type]}`,validFrom:koreaToday(),createdAt:stamp(),createdBy:{id:input.who.id,email:input.who.email},version:1};
 await recordStatement(owner,'tracking_code',code,record,store.id).run();
 return record;
}
