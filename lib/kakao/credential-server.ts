// C6 딜러 자격증명 서버(연결·검증·해제·상태). 저장은 lib/channel-credentials.ts의 외부 채널 경로(kind channel_credential, 암호화)다. 비밀값은 응답·로그에 싣지 않는다.
// 연결은 소유자만(라우트가 막는다). 저장 전에 딜러 verify()로 발신프로필을 확인한다(실패하면 저장하지 않는다).
import {ApiError,str} from '../server';
import {externalCredentialStatus,loadExternalCredential,revokeExternalCredential,saveExternalCredential,type CredentialScope} from '../channel-credentials';
import {genericDealer} from './dealer-generic';
import type {BizMessageProvider,DealerCredential} from './types';

export const KAKAO_CHANNEL='kakao_bizmessage' as const;
const OPTOUT_RE=/^080-?\d{3,4}-?\d{4}$/;
const httpsUrl=(v:unknown)=>{const s=str(v,'딜러 API 주소',300,true);let u:URL;try{u=new URL(s)}catch{throw new ApiError(400,'딜러 API 주소 입력을 확인해 주세요.')}if(u.protocol!=='https:')throw new ApiError(400,'딜러 API 주소는 https여야 합니다.');return u.origin+u.pathname.replace(/\/+$/,'')};

// 입력 검증(수동). 딜러 종류는 지금 참고 구현(generic) 하나다. 실제 딜러 계약 뒤 매핑을 더하면 여기 목록에 추가한다.
export function parseDealerInput(input:Record<string,unknown>):DealerCredential{
 if(input.dealer!=='generic')throw new ApiError(400,"딜러 종류는 'generic'(참고 구현)만 지원합니다. 계약한 딜러사 매핑은 docs/KAKAO-BIZMESSAGE.ko.md 2절을 따라 추가합니다.");
 const optoutNumber=str(input.optoutNumber,'080 수신거부 번호',20,true).replace(/\s/g,'');
 if(!OPTOUT_RE.test(optoutNumber))throw new ApiError(400,'080 수신거부 번호는 080-XXX-XXXX 형식이어야 합니다.');
 const adminKey=input.adminKey===undefined||input.adminKey===null||input.adminKey===''?undefined:str(input.adminKey,'카카오 Admin 키',500,true);
 return {dealer:'generic',baseUrl:httpsUrl(input.baseUrl),apiKey:str(input.apiKey,'딜러 API 키',500,true),senderKey:str(input.senderKey,'발신프로필 키',200,true),senderName:str(input.senderName,'전송자 명칭',100,true),optoutNumber,...(adminKey?{adminKey}:{})};
}
export type ProviderFactory=(credential:DealerCredential)=>BizMessageProvider;
export const defaultProviderFactory:ProviderFactory=credential=>genericDealer(credential);

export async function connectDealer(owner:string,input:Record<string,unknown>,scope?:CredentialScope,make:ProviderFactory=defaultProviderFactory){
 const credential=parseDealerInput(input),verified=await make(credential).verify();
 if(!verified.ok)throw new ApiError(400,`딜러 연결을 확인하지 못했습니다: ${verified.detail}`);
 return saveExternalCredential(owner,KAKAO_CHANNEL,credential,verified.account,scope);
}
export async function loadDealer(owner:string,scope?:CredentialScope){
 const hit=await loadExternalCredential<DealerCredential>(owner,KAKAO_CHANNEL,scope);
 if(!hit)throw new ApiError(409,'카카오 비즈메시지 딜러 연결이 필요합니다. 소유자가 연결 및 설정에서 등록해 주세요.');
 return hit;
}
export async function verifyDealer(owner:string,scope?:CredentialScope,make:ProviderFactory=defaultProviderFactory){
 const {credential,resolvedScope}=await loadDealer(owner,scope);
 const verified=await make(credential).verify();
 return {ok:verified.ok,account:verified.account,detail:verified.detail,resolvedScope};
}
export const disconnectDealer=(owner:string,scope?:CredentialScope)=>revokeExternalCredential(owner,KAKAO_CHANNEL,scope);
export const dealerStatus=(owner:string,scope?:CredentialScope)=>externalCredentialStatus(owner,KAKAO_CHANNEL,scope);
