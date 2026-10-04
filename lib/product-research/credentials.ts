// 상품 리서치 출처별 자격증명 모양과 검증(순수 모듈). 저장(암호화·pr_credential)은 서버가 한다. 여기서는 형식만 본다.
// 키가 맞는지는 실제 호출로만 알 수 있으므로, 여기서는 빈 값·공백·길이·문자 종류처럼 호출 전에 확실히 틀린 값만 막는다.
// 오류 문구는 운영자가 바로 고칠 수 있게 한국어로 쓰고, 입력값(비밀)은 문구에 넣지 않는다.
import type {SourceId} from './types';

export type NaverSearchadCredential={kind:'naver_searchad';apiKey:string;secretKey:string;customerId:string};
// 기존 개발자센터 데이터랩 연결을 보존한다. 새 HUB 연결은 별도로 저장하고 우선 사용한다.
export type NaverDevelopersCredential={kind:'naver_developers';clientId:string;clientSecret:string};
export type NaverApiHubCredential={kind:'naver_api_hub';clientId:string;clientSecret:string};
export type NaverDatalabCredential=NaverDevelopersCredential|NaverApiHubCredential;
export type YoutubeCredential={kind:'youtube';apiKey:string};
export type CoupangPartnersCredential={kind:'coupang_partners';accessKey:string;secretKey:string};
// 계약 데이터: 계약 전에는 내보내기 파일 가져오기만 하므로 키가 없을 수 있다. 계약으로 호스트가 정해지면 모양을 확정한다.
export type LicensedCredential={kind:'licensed';vendor:string;apiKey:string|null};
export type ResearchCredential=NaverSearchadCredential|NaverDevelopersCredential|NaverApiHubCredential|YoutubeCredential|CoupangPartnersCredential|LicensedCredential;
export type CredentialKind=ResearchCredential['kind'];

export const CREDENTIAL_KINDS:readonly CredentialKind[]=['naver_searchad','naver_developers','naver_api_hub','youtube','coupang_partners','licensed'];

// 출처 → 필요한 자격증명. manual·internal 출처는 자격증명이 없다(null).
export const CREDENTIAL_FOR_SOURCE:Readonly<Record<SourceId,CredentialKind|null>>={
 naver_searchad_keyword:'naver_searchad',
 naver_datalab_search:'naver_developers',
 naver_datalab_shopping:'naver_developers',
 naver_shop_search:'naver_developers',
 youtube_data:'youtube',
 coupang_partners:'coupang_partners',
 licensed_ranking:'licensed',
 coupang_ranking_manual:null,
 musinsa_ranking_manual:null,
 oliveyoung_ranking_manual:null,
 own_sales:null,
};

export function credentialKeyForSource(sourceId:SourceId,available:readonly CredentialKind[]):CredentialKind|null{
 if((sourceId==='naver_datalab_search'||sourceId==='naver_datalab_shopping')&&available.includes('naver_api_hub'))return 'naver_api_hub';
 return CREDENTIAL_FOR_SOURCE[sourceId];
}

export class CredentialError extends Error{
 status=400;
 constructor(message:string){super(message)}
}

// 공백 없는 토큰. 붙여넣기에서 흔한 앞뒤 공백은 지우고, 가운데 공백·줄바꿈은 잘못 복사한 것으로 본다.
function token(value:unknown,label:string,pattern:RegExp,hint:string):string{
 if(typeof value!=='string'||!value.trim())throw new CredentialError(`${label}을 입력하세요.`);
 const v=value.trim();
 if(/\s/.test(v))throw new CredentialError(`${label}에 공백이나 줄바꿈이 들어 있습니다. 발급 화면에서 다시 복사해 주세요.`);
 if(!pattern.test(v))throw new CredentialError(`${label} 형식이 올바르지 않습니다. ${hint}`);
 return v;
}

export function parseNaverSearchadCredential(input:Record<string,unknown>):NaverSearchadCredential{
 return {
  kind:'naver_searchad',
  apiKey:token(input.apiKey,'검색광고 API 키',/^[A-Za-z0-9+/=_-]{16,200}$/,'광고시스템 > 도구 > API 사용 관리의 액세스 라이선스를 넣으세요.'),
  secretKey:token(input.secretKey,'검색광고 비밀키',/^[A-Za-z0-9+/=_-]{16,400}$/,'같은 화면의 비밀키를 넣으세요.'),
  customerId:token(input.customerId,'검색광고 고객 ID',/^\d{1,20}$/,'고객 ID는 숫자입니다.'),
 };
}

export function parseNaverDevelopersCredential(input:Record<string,unknown>):NaverDevelopersCredential{
 return {
  kind:'naver_developers',
  clientId:token(input.clientId,'네이버 개발자센터 Client ID',/^[A-Za-z0-9_-]{8,100}$/,'애플리케이션 정보의 Client ID를 넣으세요.'),
  clientSecret:token(input.clientSecret,'네이버 개발자센터 Client Secret',/^[A-Za-z0-9_-]{6,100}$/,'애플리케이션 정보의 Client Secret을 넣으세요.'),
 };
}

export function parseNaverApiHubCredential(input:Record<string,unknown>):NaverApiHubCredential{
 return {kind:'naver_api_hub',clientId:token(input.clientId,'네이버 API HUB Client ID',/^[A-Za-z0-9_-]{8,100}$/,'API HUB 애플리케이션의 Client ID를 넣으세요.'),clientSecret:token(input.clientSecret,'네이버 API HUB Client Secret',/^[A-Za-z0-9+/=_-]{6,200}$/,'같은 애플리케이션의 Client Secret을 넣으세요.')};
}

export function parseYoutubeCredential(input:Record<string,unknown>):YoutubeCredential{
 return {kind:'youtube',apiKey:token(input.apiKey,'YouTube API 키',/^[A-Za-z0-9_-]{20,100}$/,'Google Cloud 콘솔 > 사용자 인증 정보의 API 키를 넣으세요(OAuth 클라이언트 ID가 아닙니다).')};
}

export function parseCoupangPartnersCredential(input:Record<string,unknown>):CoupangPartnersCredential{
 return {
  kind:'coupang_partners',
  accessKey:token(input.accessKey,'쿠팡 파트너스 Access Key',/^[A-Za-z0-9-]{8,100}$/,'파트너스 > 추가 기능 > 오픈 API의 Access Key를 넣으세요.'),
  secretKey:token(input.secretKey,'쿠팡 파트너스 Secret Key',/^[A-Za-z0-9-]{8,200}$/,'같은 화면의 Secret Key를 넣으세요.'),
 };
}

// 계약 확정 전 자리표시. 공급사 이름만 필수이고, API 키는 계약으로 자동 수집이 열릴 때 넣는다.
export function parseLicensedCredential(input:Record<string,unknown>):LicensedCredential{
 if(typeof input.vendor!=='string'||!input.vendor.trim())throw new CredentialError('계약 데이터 공급사 이름을 입력하세요.');
 const vendor=input.vendor.trim();
 if(vendor.length>40||/[<>]/.test(vendor)||[...vendor].some(c=>c.charCodeAt(0)<32))throw new CredentialError('공급사 이름은 40자 이내 일반 문자로 입력하세요.');
 const raw=input.apiKey;
 const apiKey=raw===undefined||raw===null||(typeof raw==='string'&&!raw.trim())?null:token(raw,'계약 데이터 API 키',/^[A-Za-z0-9+/=_.-]{8,400}$/,'공급사가 준 키를 그대로 넣으세요.');
 return {kind:'licensed',vendor,apiKey};
}

export function parseResearchCredential(kind:CredentialKind,input:Record<string,unknown>):ResearchCredential{
 switch(kind){
  case 'naver_searchad':return parseNaverSearchadCredential(input);
  case 'naver_developers':return parseNaverDevelopersCredential(input);
  case 'naver_api_hub':return parseNaverApiHubCredential(input);
  case 'youtube':return parseYoutubeCredential(input);
  case 'coupang_partners':return parseCoupangPartnersCredential(input);
  case 'licensed':return parseLicensedCredential(input);
  default:throw new CredentialError('알 수 없는 자격증명 종류입니다.');
 }
}

// 화면·기록에 보여 줄 비밀 아닌 식별자. 키 원문을 노출하지 않는다(끝 4자리만).
export function credentialAccount(credential:ResearchCredential):string{
 const tail=(v:string)=>`…${v.slice(-4)}`;
 switch(credential.kind){
  case 'naver_searchad':return `고객 ${credential.customerId}`;
  case 'naver_api_hub':
  case 'naver_developers':return `Client ${tail(credential.clientId)}`;
  case 'youtube':return `API 키 ${tail(credential.apiKey)}`;
  case 'coupang_partners':return `Access ${tail(credential.accessKey)}`;
  case 'licensed':return credential.vendor;
 }
}
