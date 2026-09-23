// 점포 추적 코드(A4). 순수 모듈: 코드 형식·생성·정규화·UTM 파싱·매칭만 한다. 저장·권한·귀속 적용은 lib/store-operations-server.ts.
// 코드는 쿠폰·QR·POS 태그·UTM에 인쇄·입력되는 짧은 문자열이다. 직원이 손으로 옮겨 적어도 틀리지 않게 혼동 문자를 뺀다.
export const trackingCodeTypes={coupon:'쿠폰',qr:'QR',pos_tag:'POS 태그',utm:'UTM'} as const;
export type TrackingCodeType=keyof typeof trackingCodeTypes;
// 대문자 영숫자에서 혼동 문자(0·O·1·I·L)를 뺀 31자.
export const CODE_ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_MIN=4,CODE_MAX=12;
const CODE_PATTERN=new RegExp(`^[${CODE_ALPHABET}]{${CODE_MIN},${CODE_MAX}}$`);
// 생성 코드의 첫 글자는 유형이다. 매장에서 코드만 보고도 어느 경로의 코드인지 알 수 있다.
const TYPE_PREFIX:Record<TrackingCodeType,string>={coupon:'C',qr:'Q',pos_tag:'P',utm:'U'};
// 코드가 가리키는 대상. storeId·campaignId는 필수, 나머지는 선택이다. channel은 귀속된 주문의 유입 채널(lib/store-marketing.ts ChannelKey)이다.
export type TrackingLink={storeId:string;campaignId:string;creativeId?:string;publicationId?:string;arm?:string;channel?:string};
export type TrackingCode=TrackingLink&{id:string;code:string;type:TrackingCodeType;label:string;utmCampaign?:string;validFrom:string;createdAt:string;createdBy:{id:string;email:string|null};version:number};
// 셀에서 꺼낸 코드 후보. utmCampaign이 있으면 UTM 조합(utm_campaign+utm_content)에서 나온 것이다.
export type CodeToken={code:string;utmCampaign?:string};

export const isTrackingCodeType=(value:unknown):value is TrackingCodeType=>typeof value==='string'&&Object.hasOwn(trackingCodeTypes,value);
// 대소문자·공백·하이픈을 무시한다. 전각 문자는 NFKC로 반각이 된다.
export function normalizeCode(raw:unknown){return typeof raw==='string'?raw.normalize('NFKC').toUpperCase().replace(/[\s\-‐-―]/g,''):''}
export const isValidCode=(code:string)=>CODE_PATTERN.test(code);
// 결정론적 입력(유형 접두어·길이)과 호출자가 준 난수 바이트로 만든다. 248 이상 바이트는 버려 31자에 고르게 나눈다.
export function generateCode(type:TrackingCodeType,random:Uint8Array,length=8){
 if(!isTrackingCodeType(type))throw new Error('알 수 없는 코드 유형입니다.');
 if(!Number.isInteger(length)||length<CODE_MIN||length>CODE_MAX)throw new Error(`코드 길이는 ${CODE_MIN}~${CODE_MAX}자입니다.`);
 const limit=256-256%CODE_ALPHABET.length,chars=Array.from(random).filter(b=>b<limit).slice(0,length-1).map(b=>CODE_ALPHABET[b%CODE_ALPHABET.length]);
 if(chars.length<length-1)throw new Error('코드 생성에 필요한 난수가 부족합니다.');
 return TYPE_PREFIX[type]+chars.join('');
}
// utm_campaign 값: 소문자 영숫자와 _ . - 만, 60자 이하. 맞지 않으면 빈 문자열.
export function normalizeUtmCampaign(raw:unknown){const v=typeof raw==='string'?raw.trim().toLowerCase():'';return /^[a-z0-9][a-z0-9_.-]{0,59}$/.test(v)?v:''}
const decode=(v:string)=>{try{return decodeURIComponent(v.replace(/\+/g,' '))}catch{return v}};
// URL이나 쿼리 문자열에서 utm_campaign/utm_content 조합을 꺼낸다. 둘 중 하나라도 없거나 형식이 틀리면 null.
export function parseUtm(input:string){
 const query=input.includes('?')?input.slice(input.indexOf('?')+1):input,params=new Map<string,string>();
 for(const part of query.split('#')[0].split('&')){const i=part.indexOf('=');if(i>0)params.set(decode(part.slice(0,i)).trim().toLowerCase(),decode(part.slice(i+1)))}
 const campaign=normalizeUtmCampaign(params.get('utm_campaign')),content=normalizeCode(params.get('utm_content'));
 return campaign&&isValidCode(content)?{campaign,content}:null;
}
// 한 셀에 여러 코드가 있으면 , ; | / 줄바꿈으로 나눈다. 형식에 맞는 코드만 나온 순서대로, 중복 없이 돌려준다.
export function codeTokens(cell:string):CodeToken[]{
 if(/utm_/i.test(cell)){const utm=parseUtm(cell.trim());return utm?[{code:utm.content,utmCampaign:utm.campaign}]:[]}
 return [...new Set(cell.split(/[,;|/\n]+/).map(normalizeCode).filter(isValidCode))].map(code=>({code}));
}
// 일반 코드는 코드 문자열로, UTM 조합은 UTM 유형이면서 utm_campaign이 같은 코드와만 맞춘다.
export function matchCode(token:CodeToken,codes:readonly TrackingCode[]){return codes.find(c=>c.code===token.code&&(token.utmCampaign===undefined||c.type==='utm'&&c.utmCampaign===token.utmCampaign))}
// UTM 코드의 링크 쿼리. UTM이 아닌 코드는 빈 문자열.
export function utmQuery(code:Pick<TrackingCode,'type'|'code'|'utmCampaign'>){return code.type==='utm'&&code.utmCampaign?`utm_campaign=${encodeURIComponent(code.utmCampaign)}&utm_content=${code.code}`:''}
