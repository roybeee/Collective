// C6 커넥터 레지스트리 서술자(순수). lib/connectors/registry.ts가 이 서술자를 목록에 덧붙이고, 모의 딜러·계약 하네스가 같은 능력 목록을 쓴다.
// 고객에게 보이는 유료 메시지 전송은 돈·노출이 함께 움직이는 T4(customer_send)다. 결과 조회·친구 관계 조회는 T1이다. 스위치 kakao_bizmessage는 기본 꺼짐이다.
import type {ConnectorCapability,ConnectorDescriptor} from '../connectors/types';

const capability=(c:Omit<ConnectorCapability,'defaultOff'|'retryUnknown'>):ConnectorCapability=>({...c,defaultOff:true,retryUnknown:false});
export const KAKAO_CONNECTOR_KEY='kakao_bizmessage';
export const KAKAO_FLAG='kakao_bizmessage';
export const kakaoCapabilities:readonly ConnectorCapability[]=[
 capability({key:'kakao_bizmessage.alimtalk.send',reads:[],writes:['alimtalk_message'],riskTier:'T4',rateLimit:{perSecond:5,perMinute:100,perDay:10000},credentialScope:'brand',flag:KAKAO_FLAG}),
 capability({key:'kakao_bizmessage.brand.send',reads:[],writes:['brand_message'],riskTier:'T4',rateLimit:{perSecond:5,perMinute:100,perDay:10000},credentialScope:'brand',flag:KAKAO_FLAG}),
 capability({key:'kakao_bizmessage.result.read',reads:['message_result'],writes:[],riskTier:'T1',rateLimit:{perSecond:10,perMinute:300},credentialScope:'brand',flag:KAKAO_FLAG}),
 capability({key:'kakao_bizmessage.friend.read',reads:['friend_relation'],writes:[],riskTier:'T1',rateLimit:{perSecond:5,perMinute:100},credentialScope:'brand',flag:KAKAO_FLAG}),
];
export const kakaoDescriptor:ConnectorDescriptor={key:KAKAO_CONNECTOR_KEY,label:'카카오 비즈메시지(딜러사 API)',module:'lib/kakao/*.ts',capabilities:kakaoCapabilities};
