// C6 카카오 비즈메시지 어댑터의 공통 계약(순수 선언, docs/KAKAO-BIZMESSAGE.ko.md). 카카오 비즈메시지는 공개 API로 보낼 수 없고 공식 딜러사(NHN Cloud·Kakao i Connect Message·SOLAPI형 집계사 등) API로만 보낸다.
// 그래서 이 계약은 딜러사에 무관한 모양으로 두고, 딜러별 REST 매핑은 lib/kakao/dealer-generic.ts(참고 구현)·lib/kakao/dealer-mock.ts(테스트)에 둔다.
// 전송 결과는 success·failed·unknown 셋뿐이다. 보낸 뒤 타임아웃·5xx처럼 상대에 도달했을 수 있는 실패는 unknown이며 자동 재시도하지 않는다(lib/connectors/rate-queue.ts와 같은 규율).
import type {AttemptResult} from '../connectors/rate-queue';

export type MessageType='alimtalk'|'brand';
export const MESSAGE_TYPE_LABELS:Readonly<Record<MessageType,string>>={alimtalk:'알림톡(정보성)',brand:'브랜드 메시지(광고성)'};
export type SendOutcome='success'|'failed'|'unknown';

// 알림톡: 사전 검수된 템플릿 코드와 변수만 보낸다(본문은 딜러·카카오가 템플릿으로 조립). 발신프로필(senderKey)은 비즈니스 인증 채널에 묶인다.
export type AlimtalkRequest={senderKey:string;templateCode:string;to:string;variables:Readonly<Record<string,string>>;idempotencyKey:string};
export type BrandMessageButton={name:string;url:string};
// 브랜드 메시지: 광고성. adFlag는 상수 true라 광고 표시 없는 호출이 형식상 불가능하다. 친구톡은 2025-12-31 종료(호환 발송 2026-12-31까지)라 새 전송 유형으로 두지 않는다.
export type BrandMessageRequest={senderKey:string;to:string;text:string;buttons?:readonly BrandMessageButton[];adFlag:true;idempotencyKey:string};
export type SendResult={outcome:SendOutcome;messageId:string|null;costKrw:number|null;detail:string;attempts:number};
export type ResultStatus='delivered'|'failed'|'pending'|'unknown';
export type MessageResult={messageId:string;status:ResultStatus;detail:string;costKrw:number|null};
export type VerifyResult={ok:boolean;account:string;detail:string};

export type BizMessageProvider={
 readonly name:string;
 sendAlimtalk(request:AlimtalkRequest):Promise<SendResult>;
 sendBrandMessage(request:BrandMessageRequest):Promise<SendResult>;
 getResult(messageId:string):Promise<MessageResult>;
 verify():Promise<VerifyResult>;
};

// 딜러 자격증명(암호화 저장, lib/channel-credentials.ts saveExternalCredential). adminKey는 카카오톡 채널 API(친구 관계 조회) 전용이며 메시지 전송에는 쓰지 않는다.
export type DealerCredential={dealer:'generic';baseUrl:string;apiKey:string;senderKey:string;senderName:string;optoutNumber:string;adminKey?:string};

// 딜러 응답 한 번을 한도 큐가 분류할 수 있는 모양으로 바꾼 것. value에 딜러가 준 메시지 id·비용을 싣는다.
export type DealerAttempt=AttemptResult&{value?:{messageId?:string;costKrw?:number|null;detail?:string}};
