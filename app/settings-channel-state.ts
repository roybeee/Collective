// 연결 및 설정 '채널 연결' 카드의 순수 판정(X-F). 서버 응답을 화면 상태로만 바꾸고 아무것도 저장하지 않는다.
// 토큰 만료 경고는 14일 전부터다(서버 expiringSoon은 7일 기준이라 화면이 더 일찍 알린다). 만료일을 모르면 경고하지 않는다.
export const TOKEN_WARN_DAYS=14;
const DAY_MS=86_400_000;
export type ConnectionState='connected'|'expiring'|'expired'|'none'|'unknown';
export const connectionLabels:Record<ConnectionState,string>={connected:'연결됨',expiring:'만료 임박',expired:'만료',none:'연결 전',unknown:'확인하지 못함'};
// connected가 null이면 읽지 못한 것이다(권한 없음·응답 실패). 연결 전으로 보이지 않게 따로 둔다.
export function connectionState(connected:boolean|null,expiresAt?:string|null,now=Date.now()):ConnectionState{
 if(connected===null)return 'unknown';
 if(!connected)return 'none';
 const at=expiresAt?Date.parse(expiresAt):NaN;
 if(!Number.isFinite(at))return 'connected';
 return at<=now?'expired':at-now<=TOKEN_WARN_DAYS*DAY_MS?'expiring':'connected';
}
// 남은 일수(올림). 만료일이 없거나 형식이 틀리면 null.
export function daysLeft(expiresAt?:string|null,now=Date.now()):number|null{
 const at=expiresAt?Date.parse(expiresAt):NaN;
 return Number.isFinite(at)?Math.ceil((at-now)/DAY_MS):null;
}
// GET /api/feature-flags의 flags에서 스위치 하나. 목록을 못 읽었거나 없으면 null(확인하지 못함).
export function flagOn(flags:unknown,name:string):boolean|null{
 if(!Array.isArray(flags))return null;
 const hit=flags.find(f=>!!f&&typeof f==='object'&&(f as {flag?:unknown}).flag===name) as {enabled?:unknown}|undefined;
 return hit?hit.enabled===true:null;
}
export const switchLabel=(on:boolean|null)=>on===null?'스위치 확인하지 못함':on?'스위치 켜짐':'스위치 꺼짐';
// 직접 게시 연결 폼의 필수 칸(서버 parsePublisherCredential과 같은 규칙). 빈 문자열이면 통과.
export function publisherIssue(input:{accessToken:string;userId:string;expiresAt:string}):string{
 if(!input.accessToken.trim())return '액세스 토큰을 입력하세요.';
 if(!input.userId.trim())return '계정 ID를 입력하세요.';
 if(!/^\d{1,25}$/.test(input.userId.trim()))return '계정 ID는 숫자입니다.';
 if(input.expiresAt&&!Number.isFinite(Date.parse(input.expiresAt)))return '토큰 만료일을 확인해 주세요.';
 return '';
}
// 카카오 딜러 연결 폼(서버 parseDealerInput과 같은 규칙).
export function dealerIssue(input:{baseUrl:string;apiKey:string;senderKey:string;senderName:string;optoutNumber:string}):string{
 if(!/^https:\/\/\S+$/.test(input.baseUrl.trim()))return '딜러 API 주소는 https://로 시작해야 합니다.';
 if(!input.apiKey.trim()||!input.senderKey.trim()||!input.senderName.trim())return '딜러 API 키, 발신프로필 키, 전송자 명칭을 모두 입력하세요.';
 if(!/^080-?\d{3,4}-?\d{4}$/.test(input.optoutNumber.replace(/\s/g,'')))return '080 수신거부 번호는 080-XXX-XXXX 형식이어야 합니다.';
 return '';
}
// 토스플레이스 POS 연결 폼(서버 parsePosInput과 같은 규칙). 새 연결은 두 키가 모두 필요하다.
export function posIssue(input:{storeId:string;merchantId:string;accessKey:string;secretKey:string;intervalMinutes:string},requireKeys:boolean):string{
 if(!input.storeId)return '지점을 고르세요.';
 if(!/^\d{1,19}$/.test(input.merchantId.trim()))return '매장 ID(merchantId)는 숫자만 입력하세요.';
 const key=(v:string)=>/^\S{8,500}$/.test(v);
 if(requireKeys&&(!key(input.accessKey)||!key(input.secretKey)))return 'Access Key와 Secret Key를 공백 없이 8자 이상 입력하세요.';
 const minutes=Number(input.intervalMinutes);
 if(!Number.isSafeInteger(minutes)||minutes<15||minutes>1440)return '조회 간격은 15~1440분입니다.';
 return '';
}
// 수신동의 CSV의 데이터 줄 수(머리글 제외, 빈 줄 제외). 화면은 미리 줄 수만 보이고 판정은 서버가 한다.
export function csvDataRows(csv:string):number{
 const lines=csv.split(/\r?\n/).filter(l=>l.trim());
 return Math.max(0,lines.length-1);
}
// 광고 제안 diff(before → after)를 키별 한 줄로. 값은 화면용 글자로 바꾼다.
const shown=(v:unknown)=>v===undefined||v===null?'없음':typeof v==='boolean'?(v?'예':'아니요'):typeof v==='object'?JSON.stringify(v):String(v);
const diffKeyLabels:Record<string,string>={bidAmt:'입찰가(원)',userLock:'중지',created:'새로 만들 항목'};
export function diffLines(diff:{before?:Record<string,unknown>;after?:Record<string,unknown>}|null|undefined):{key:string;label:string;before:string;after:string}[]{
 const before=diff?.before??{},after=diff?.after??{};
 return [...new Set([...Object.keys(before),...Object.keys(after)])].map(key=>({key,label:diffKeyLabels[key]??key,before:shown(before[key]),after:shown(after[key])}));
}
// 입찰가 변경 비용 차이(원, 클릭당). 입찰가 제안이 아니면 null.
export function bidDelta(diff:{before?:Record<string,unknown>;after?:Record<string,unknown>}|null|undefined):number|null{
 const a=diff?.before?.bidAmt,b=diff?.after?.bidAmt;
 return typeof a==='number'&&typeof b==='number'?b-a:null;
}
