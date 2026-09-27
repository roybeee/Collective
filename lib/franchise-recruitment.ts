// 트랙 R 모집 코드·채널·코드 귀속·모집 비용 순수 모듈(R5a). 판정만 한다: 저장·API·화면·kind·스위치·권한 연결은 R5b(서버)·R5c(화면)가 맡는다.
// 모듈은 시계·난수·조회를 읽지 않는다. 현재 날짜(today, KST)·난수·조회 결과(taken, 코드 목록, 비용 행)는 모두 인자로 받는다. 외부 호출이 없다.
// 근거: R5 구현 명세 초안 2의 2.1~2.5·3절(docs/FRANCHISE-RECRUITMENT-PLAN.ko.md R5 절 C1~C5·A1~A4·S1~S5). 모든 기한·한도·판정은 COLLECTIVE 휴리스틱이며 법률 자문이 아니다(결정 20 보류).
// 모델 경계: 앱 경로 어디에서도 import하지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN, tests/recruitment-codes.test.mjs RC-S1). 점포 모듈은 CODE_ALPHABET·normalizeCode만 가져온다.
import {CODE_ALPHABET,normalizeCode} from './tracking-codes';
import {scanText} from './pii-scan';
import {isDate,isInstant,parseInstant,toKstDate,addDays} from './franchise-rules';
import {GATE_DISCLAIMER} from './franchise-gates';
import {isRecruitmentObjective} from './agency';

function deepFreeze<T>(value:T):T{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const k of Object.keys(value))deepFreeze((value as Record<string,unknown>)[k])}
 return value;
}
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sortedUnique=<T extends string>(xs:readonly T[]):T[]=>[...new Set(xs)].sort(ascii);
const oneOf=<T extends string>(list:readonly T[],v:unknown):v is T=>typeof v==='string'&&(list as readonly string[]).includes(v);
// 사용자 입력 객체는 Object.keys로만 돌고 허용 목록과 대조한다('__proto__'·'constructor' 같은 자기 키도 허용 목록 밖이면 거부). 값은 Object.hasOwn으로만 읽는다.
const keysOk=(o:Record<string,unknown>,allowed:readonly string[])=>Object.keys(o).every(k=>allowed.includes(k));
const get=(o:Record<string,unknown>,k:string):unknown=>Object.hasOwn(o,k)?o[k]:undefined;
const absent=(v:unknown)=>v===undefined||v===null;
const ID_RE=/^[A-Za-z0-9._:-]{1,128}$/;
const validId=(v:unknown):v is string=>typeof v==='string'&&ID_RE.test(v);
const posInt=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1;
const countInt=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
// 라벨·증빙에 넣을 수 없는 문자: 제어(Cc, 줄바꿈·탭 포함)·서식(Cf, 폭 없는 문자)·미할당(Cn)·사용자 정의(Co)·짝 없는 서로게이트(Cs)·줄·문단 구분.
const HIDDEN=/[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\u2028\u2029]/u;
function textOf(v:unknown,max:number):string|null{
 if(typeof v!=='string')return null;
 const s=v.normalize('NFC').trim();
 return s.length>=1&&s.length<=max&&!HIDDEN.test(s)?s:null;
}
const piiClean=(s:string)=>scanText(s).length===0;
const msOf=(v:unknown):number|null=>isInstant(v)?parseInstant(v):null;
// 'YYYY-MM-DD'의 일 번호(달력 산술만, 시계를 읽지 않는다). 기간 길이는 양 끝을 포함한 일수다.
const dayNum=(d:string)=>Date.UTC(Number(d.slice(0,4)),Number(d.slice(5,7))-1,Number(d.slice(8,10)))/864e5;
const spanDays=(from:string,to:string)=>dayNum(to)-dayNum(from)+1;
// asOf(시점 고정): 없으면 제한 없음. 있으면 시간대 있는 ISO 시각이어야 한다(아니면 던지고 호출 함수가 닫는다).
function asOfMs(opts:unknown):number|null{
 if(!isRecord(opts)||absent(get(opts,'asOf')))return null;
 const t=msOf(get(opts,'asOf'));
 if(t===null)throw new Error('asOf');
 return t;
}
const notAfter=(at:unknown,asOf:number|null)=>{if(asOf===null)return true;const t=msOf(at);return t!==null&&t<=asOf};

// ── 버전·면책·고정 문구 ──
// 코드 형식·채널·귀속·비용 규칙의 판. 모든 판정의 ruleVersion이고 코드·비용 행과 가져오기 기록에 저장한다. 규칙을 바꾸면 판을 올린다(R5b-2가 2.7을 더할 때 포함).
export const RECRUITMENT_VERSION='fr-recruitment@2026-09-27.1';
export const RECRUITMENT_DISCLAIMER=GATE_DISCLAIMER;
export const RECRUITMENT_ATTRIBUTION_NOTE='귀속≠증분: 모집 코드로 귀속된 리드는 그 채널·자료가 없었어도 들어왔을 수 있습니다. 귀속 수치는 채널·자료의 인과 효과를 증명하지 않습니다.';
export const PLATFORM_REPORTED_NOTE='플랫폼 보고, 원장 리드 아님';
export const NO_PRORATION_NOTE='기간 비용은 일할하지 않습니다. 보고 기간에 일부만 걸친 비용은 따로 보입니다.';
export const UNATTRIBUTED_LABEL='유입 미확인';
export const LATE_TOKEN_HOURS=72;

// ── 모집 채널(계획 :738 순서) ──
// 키는 점포 채널 키(점포 마케팅 모듈 channelCatalog의 11개)와 겹치지 않는다. 리드 접수 방식(sourceChannel)과는 다른 축이다.
export const RECRUITMENT_CHANNELS=deepFreeze([
 {key:'portal',label:'창업 포털'},{key:'search_ad',label:'네이버 검색광고'},{key:'expo',label:'박람회'},
 {key:'briefing',label:'사업설명회'},{key:'lead_ad',label:'메타 리드광고'},{key:'youtube',label:'유튜브'},
 {key:'blog_post',label:'블로그'},{key:'store_qr',label:'매장 QR'},{key:'owner_referral',label:'점주 추천'},
 {key:'community',label:'커뮤니티'}] as const);
export type RecruitmentChannel=typeof RECRUITMENT_CHANNELS[number]['key'];
export const RECRUITMENT_CHANNEL_KEYS:readonly RecruitmentChannel[]=deepFreeze(RECRUITMENT_CHANNELS.map(c=>c.key));
export const RECRUITMENT_CHANNEL_LABELS:Readonly<Record<RecruitmentChannel,string>>=deepFreeze(Object.fromEntries(RECRUITMENT_CHANNELS.map(c=>[c.key,c.label])) as Record<RecruitmentChannel,string>);
export const isRecruitmentChannel=(v:unknown):v is RecruitmentChannel=>oneOf(RECRUITMENT_CHANNEL_KEYS,v);
// 동의 증빙 참조가 필수인 채널(가져오기), 행사 연결·날짜만 접수 시각을 받는 채널.
export const PROVENANCE_CHANNELS=deepFreeze(['portal','expo'] as const);
export const EVENT_CHANNELS=deepFreeze(['expo','briefing'] as const);
// R15a 자료 유형 → 채널(경고용, 차단 아님). startup_page·first_call_script는 채널 제한이 없다.
export const ASSET_TYPE_CHANNELS:Readonly<Record<string,RecruitmentChannel>>=deepFreeze({naver_search:'search_ad',meta_lead_ad:'lead_ad',portal_intro:'portal',expo_banner:'expo',event_deck:'briefing'} as Record<string,RecruitmentChannel>);
const assetMismatch=(type:string|null,channel:RecruitmentChannel)=>type!==null&&Object.hasOwn(ASSET_TYPE_CHANNELS,type)&&ASSET_TYPE_CHANNELS[type]!==channel;

// ── 모집 코드 형식 ──
// 'R' + CODE_ALPHABET 7자(8자). 9자 R 코드는 여권 후보 패턴(lib/pii-scan.ts)에 걸린다. 점포 접두어(C·Q·P·U)와 리드 코드(L, 알파벳 밖)와 겹치지 않는다.
export const RECRUITMENT_CODE_PREFIX='R',RECRUITMENT_CODE_BODY=7;
const CODE_RE=new RegExp(`^${RECRUITMENT_CODE_PREFIX}[${CODE_ALPHABET}]{${RECRUITMENT_CODE_BODY}}$`);
// 판정은 비공개 정규식으로 한다. 내보내는 값은 얼린 사본이다.
export const RECRUITMENT_CODE_PATTERN:RegExp=Object.freeze(new RegExp(CODE_RE.source));
// 점포 normalizeCode 그대로: NFKC·대문자·공백·하이픈 제거. 문자열이 아니면 ''.
export function normalizeRecruitmentCode(raw:unknown):string{return normalizeCode(raw)}
export const isRecruitmentCode=(code:unknown):code is string=>typeof code==='string'&&CODE_RE.test(code);
// 점포 generateCode는 접두어가 비공개라 R을 만들 수 없어 같은 거부 표집을 다시 구현한다(leadSystemCode 선례). 248 이상 바이트는 버린다. 모자라면 null.
export function generateRecruitmentCode(random:Uint8Array):string|null{
 if(!(random instanceof Uint8Array))return null;
 const n=CODE_ALPHABET.length,limit=256-256%n,chars=Array.from(random).filter(b=>b<limit).slice(0,RECRUITMENT_CODE_BODY).map(b=>CODE_ALPHABET[b%n]);
 return chars.length===RECRUITMENT_CODE_BODY?RECRUITMENT_CODE_PREFIX+chars.join(''):null;
}
export const MAX_CODES_PER_LEAD=5;
const decodeOnce=(v:string)=>{try{return decodeURIComponent(v)}catch{return v}};
// 칸에서 모집 코드를 꺼낸다. 칸을 공백·, ; |로 덩어리로 나누고, '='가 든 덩어리(쿼리)는 '#' 앞에서 모든 utm_content 값(키 대소문자 무시, 퍼센트 해독 한 번)만 꺼낸다.
// '#' 뒤는 조각이라 해시 라우팅 주소('/#/apply?utm_content=…')의 값은 꺼내지 않는다(명세 6.2 RC-T '# 뒤 무시'의 해석).
// 나머지 덩어리(쿼리 없는 주소 포함)는 '/'로 더 나눈다('https://x.test/r/R2345678'의 경로 코드를 꺼내고 스킴·호스트·경로 조각은 버린 수에 든다).
// 칸 안 위치 순서로 정규화해 R 형식만 먼저 나온 것을 남기고(중복 제거) 5개까지 쓴다. dropped: R 형식이 아닌 토큰 수(점포 코드 포함), truncated: 5개 초과.
export function recruitmentTokens(cell:string):{codes:string[];dropped:number;truncated:boolean}{
 try{
  if(typeof cell!=='string')return {codes:[],dropped:0,truncated:false};
  const text=cell.normalize('NFKC'),found:{at:number;raw:string}[]=[];
  for(const m of text.matchAll(/[^\s,;|]+/g)){
   const chunk=m[0],at=m.index??0;
   if(chunk.includes('=')){
    for(const u of chunk.split('#')[0].matchAll(/(?:^|[?&])utm_content=([^&]*)/gi))found.push({at:at+(u.index??0),raw:decodeOnce(u[1])});
   }else{
    let off=0;
    for(const piece of chunk.split('/')){if(piece)found.push({at:at+off,raw:piece});off+=piece.length+1}
   }
  }
  found.sort((a,b)=>a.at-b.at);
  const codes:string[]=[];let dropped=0,truncated=false;
  for(const f of found){
   const c=normalizeRecruitmentCode(f.raw);
   if(!isRecruitmentCode(c)){if(c)dropped++;continue}
   if(codes.includes(c))continue;
   if(codes.length>=MAX_CODES_PER_LEAD){truncated=true;continue}
   codes.push(c);
  }
  return {codes,dropped,truncated};
 }catch{return {codes:[],dropped:0,truncated:false}}
}
// utmCampaign이 있을 때만 링크 쿼리를 만든다. 귀속은 코드 값으로만 맞춘다(utm_campaign이 달라도 막지 않는다).
export function recruitmentUtmQuery(code:{code:string;utmCampaign:string|null}):string{
 try{return isRecord(code)&&isRecruitmentCode(code.code)&&typeof code.utmCampaign==='string'&&code.utmCampaign?`utm_campaign=${encodeURIComponent(code.utmCampaign)}&utm_content=${code.code}`:''}catch{return ''}
}
const UTM_RE=/^[a-z0-9][a-z0-9_.-]{0,59}$/;

// ── 사유 코드·상태·문구 ──
export const RECRUITMENT_WARNING_CODES=deepFreeze(['agency_fee_wording','asset_channel_mismatch','clicks_exceed_impressions','duplicate_acknowledged','search_ad_manual'] as const);
export const RECRUITMENT_CODES=deepFreeze([
 'invalid_input','channel_unknown','code_format','valid_from_invalid','valid_from_out_of_range','retire_date_invalid','label_invalid','label_pii','utm_campaign_invalid','campaign_other_brand','asset_other_brand','event_other_brand',
 'period_invalid','period_future','period_too_long','amount_negative','amount_invalid','vat_invalid','original_invalid','funding_invalid','ad_fund_forbidden','referral_reward_forbidden','evidence_required','evidence_pii','platform_metric_invalid','void_reason_invalid',
 'role_forbidden',
 'switch_off','branch_not_a','campaign_not_recruitment','asset_not_approved','asset_review_needed','asset_superseded','event_cancelled','code_taken','code_already_retired','spend_already_voided','spend_possible_duplicate','spend_period_overlap','spend_referenced','spend_replace_invalid',
 ...RECRUITMENT_WARNING_CODES] as const);
export type RecruitmentCode=typeof RECRUITMENT_CODES[number];
export type RecruitmentWarning=typeof RECRUITMENT_WARNING_CODES[number];
// 한 판정 단계의 코드는 모두 같은 상태다. 400: 입력, 403: 역할, 409: 서버 상태(스위치·분기·연결 상태·중복). 경고는 성공 결과(200)의 warnings에만 나온다.
export const RECRUITMENT_CODE_STATUS:Readonly<Record<RecruitmentCode,200|400|403|409>>=deepFreeze({
 invalid_input:400,channel_unknown:400,code_format:400,valid_from_invalid:400,valid_from_out_of_range:400,retire_date_invalid:400,label_invalid:400,label_pii:400,utm_campaign_invalid:400,campaign_other_brand:400,asset_other_brand:400,event_other_brand:400,
 period_invalid:400,period_future:400,period_too_long:400,amount_negative:400,amount_invalid:400,vat_invalid:400,original_invalid:400,funding_invalid:400,ad_fund_forbidden:400,referral_reward_forbidden:400,evidence_required:400,evidence_pii:400,platform_metric_invalid:400,void_reason_invalid:400,
 role_forbidden:403,
 switch_off:409,branch_not_a:409,campaign_not_recruitment:409,asset_not_approved:409,asset_review_needed:409,asset_superseded:409,event_cancelled:409,code_taken:409,code_already_retired:409,spend_already_voided:409,spend_possible_duplicate:409,spend_period_overlap:409,spend_referenced:409,spend_replace_invalid:409,
 agency_fee_wording:200,asset_channel_mismatch:200,clicks_exceed_impressions:200,duplicate_acknowledged:200,search_ad_manual:200,
});
// 고정 문구. 입력 값을 끼워 넣지 않는다.
export const RECRUITMENT_MESSAGES:Readonly<Record<RecruitmentCode,string>>=deepFreeze({
 invalid_input:'입력 형식을 확인하세요.',
 channel_unknown:'모집 채널을 확인하세요. 점포 유입 채널은 쓸 수 없습니다.',
 code_format:'모집 코드는 R로 시작하는 8자(혼동 문자 0·O·1·I·L 제외)여야 합니다.',
 valid_from_invalid:'적용 시작일은 YYYY-MM-DD 날짜여야 합니다.',
 valid_from_out_of_range:'적용 시작일은 오늘(KST) 90일 전부터 180일 뒤까지만 고를 수 있습니다.',
 retire_date_invalid:'사용 중지일은 오늘(KST)과 적용 시작일 가운데 늦은 날부터 180일 뒤까지의 날짜여야 합니다. 과거로 소급하지 않습니다.',
 label_invalid:'라벨은 1~60자이고 제어 문자나 보이지 않는 문자를 넣을 수 없습니다.',
 label_pii:'라벨에 개인정보로 보이는 값이 있습니다. 지우고 다시 입력하세요.',
 utm_campaign_invalid:'utm_campaign은 소문자 영숫자와 _ . - 만 써서 60자 이하로 적어 주세요.',
 campaign_other_brand:'이 브랜드의 캠페인이 아닙니다.',
 asset_other_brand:'이 브랜드의 모집 자료 판이 아닙니다.',
 event_other_brand:'이 브랜드의 행사가 아닙니다.',
 period_invalid:'비용 날짜(date) 또는 기간(period, 시작 ≤ 끝) 가운데 하나만 YYYY-MM-DD로 적어 주세요.',
 period_future:'비용 기간은 오늘(KST)을 넘을 수 없습니다. 이미 소진한 비용만 적습니다.',
 period_too_long:'비용 기간은 366일 이하여야 합니다.',
 amount_negative:'금액은 음수일 수 없습니다. 환불은 기존 행을 교체해 순액으로 다시 적어 주세요.',
 amount_invalid:'금액은 0 이상 1,000억 이하의 원 단위 정수여야 합니다.',
 vat_invalid:'부가세 포함 여부(포함·제외)를 골라 주세요. 계산서 공급가액을 알면 제외로 그 값을 넣으세요.',
 original_invalid:'외화 원금은 KRW가 아닌 세 글자 통화 코드와 소수 둘째 자리까지의 금액이어야 합니다. 원화 금액이 0이면 외화 원금을 적지 않습니다.',
 funding_invalid:'비용 출처는 본부 모집 예산만 고를 수 있습니다.',
 ad_fund_forbidden:'광고분담금은 모집 비용 출처로 쓸 수 없습니다(결정 27 기본값).',
 referral_reward_forbidden:'점주 추천에는 금전 보상을 기록하지 않습니다(결정 27 기본값). 추천 활동은 금액 0으로 적고, 추천 카드 제작비는 해당 매체 채널로 적어 주세요.',
 evidence_required:'금액의 근거(예: 관리 화면 월 소진 내역)를 1~200자로 적어 주세요. 제어 문자는 넣을 수 없습니다.',
 evidence_pii:'근거 문구에 개인정보로 보이는 값이 있습니다. 지우고 다시 입력하세요.',
 platform_metric_invalid:'플랫폼 노출·클릭·양식 제출 수는 비우거나 0 이상의 정수로 적어 주세요.',
 void_reason_invalid:'무효화 사유는 입력 오류·중복·환불 가운데 하나여야 합니다(교체는 새 비용 기록으로 합니다).',
 role_forbidden:'모집 코드 발급·사용 중지와 모집 비용 기록·무효화는 대표·관리자만 할 수 있습니다.',
 switch_off:'가맹 모집 기능이 꺼져 있어 모집 코드를 발급하거나 모집 비용을 기록할 수 없습니다.',
 branch_not_a:`가맹 준비도 분기가 A(모집 가능)로 기록된 브랜드만 모집 코드를 발급할 수 있습니다(H7). ${GATE_DISCLAIMER}`,
 campaign_not_recruitment:'가맹 모집 목적 캠페인만 연결할 수 있습니다.',
 asset_not_approved:'승인된 모집 자료 판만 연결할 수 있습니다.',
 asset_review_needed:'재검토가 걸린 모집 자료 판에는 연결할 수 없습니다. 새 판을 승인한 뒤 연결하세요.',
 asset_superseded:'모집 자료의 지금 판이 아닙니다. 새로고침한 뒤 지금 판을 고르세요.',
 event_cancelled:'취소된 행사입니다.',
 code_taken:'이미 쓰고 있는 코드입니다(점포 추적 코드 포함). 다른 코드를 쓰세요.',
 code_already_retired:'이미 사용 중지한 코드입니다.',
 spend_already_voided:'이미 무효화한 비용입니다.',
 spend_possible_duplicate:'같은 채널·기간·금액의 비용이 이미 있습니다. 같은 비용이 아니면 확인하고 다시 기록하세요.',
 spend_period_overlap:'같은 채널·캠페인·자료의 비용 기간이 기존 행과 겹칩니다. 월 청구와 주 청구를 둘 다 적지 않았는지 확인하세요.',
 spend_referenced:'행사가 이 비용을 참조하고 있습니다. 행사의 비용 연결을 먼저 바꾸세요.',
 spend_replace_invalid:'같은 브랜드·같은 채널의 유효한 비용 행만 교체할 수 있습니다.',
 agency_fee_wording:'모집 위탁 계약 밖 성과 수수료형 영업대행은 1차에 쓰지 않습니다(결정 27).',
 asset_channel_mismatch:'연결한 모집 자료 유형과 채널이 다릅니다.',
 clicks_exceed_impressions:'플랫폼 보고 클릭 수가 노출 수보다 큽니다. 값을 확인하세요.',
 duplicate_acknowledged:'같은 비용으로 보이는 행이나 겹치는 기간을 확인하고 기록했습니다.',
 search_ad_manual:'네이버 검색광고 비용은 수기 입력입니다(API 연동 없음).',
});

// ── 결정 객체(R15a-1과 같은 모양, 이 모듈이 따로 정의한다) ──
export type SpendDuplicate={id:string;period:{from:string;to:string};amountExVat:number};
export type RecruitmentDecision<T>=
 |{ok:true;status:200;value:T;warnings:string[];ruleVersion:string;disclaimer:string}
 |{ok:false;status:400|403|409;reasons:RecruitmentCode[];message:string;duplicates?:SpendDuplicate[];ruleVersion:string;disclaimer:string};
type Failure=Extract<RecruitmentDecision<never>,{ok:false}>;
// 사유는 정렬·중복 제거하고, 상태는 첫 사유의 상태, 문구는 첫 사유의 고정 문구다.
function fail(codes:readonly RecruitmentCode[],duplicates?:SpendDuplicate[]):Failure{
 const reasons=sortedUnique(codes);
 return {ok:false,status:RECRUITMENT_CODE_STATUS[reasons[0]] as 400|403|409,reasons,message:RECRUITMENT_MESSAGES[reasons[0]],...(duplicates?.length?{duplicates}:{}),ruleVersion:RECRUITMENT_VERSION,disclaimer:GATE_DISCLAIMER};
}
const pass=<T>(value:T,warnings:readonly string[]=[]):RecruitmentDecision<T>=>({ok:true,status:200,value,warnings:sortedUnique(warnings),ruleVersion:RECRUITMENT_VERSION,disclaimer:GATE_DISCLAIMER});
// 판정 함수는 던지지 않는다. 예상하지 못한 예외(잘못된 문맥·기록)는 invalid_input으로 닫는다.
function guarded<T>(run:()=>RecruitmentDecision<T>):RecruitmentDecision<T>{try{return run()}catch{return fail(['invalid_input'])}}
const ctxOf=(v:unknown):Record<string,unknown>=>isRecord(v)?v:{};
// 대표·관리자만. 그 밖의 역할과 형식이 틀린 actor는 모두 403(fail closed).
const adminActor=(a:unknown)=>isRecord(a)&&typeof a.id==='string'&&a.id.length>=1&&a.id.length<=200&&!HIDDEN.test(a.id)&&(a.role==='owner'||a.role==='admin');

// ── 문맥 타입 ──
export type RecruitmentActor={id:string;role:string};
export type AssetRef={id:string;version:number};
export type CampaignLite={id:string;brandId:string;objective?:unknown};
// current: assetRef.version이 그 자료의 지금 판인지. type: R15a 자료 유형(채널 불일치 경고용, 선택).
export type AssetLite={id:string;version:number;brandId:string;status:'draft'|'approved'|'retired';reviewNeeded:boolean;current:boolean;type?:string};
export type EventLite={id:string;brandId:string;status:string};

// 연결(캠페인·자료·행사) 검사. 입력 단계(400)와 상태 단계(409) 코드를 따로 모은다. 못 찾은 연결은 다른 브랜드와 같은 400이다(다른 소유자의 id인지 드러내지 않는다).
type Links={input:RecruitmentCode[];state:RecruitmentCode[]};
function campaignLink(raw:unknown,campaign:unknown,brandId:string,out:Links):string|null{
 if(absent(raw))return null;
 if(!validId(raw)){out.input.push('invalid_input');return null}
 if(!isRecord(campaign)||campaign.id!==raw||campaign.brandId!==brandId){out.input.push('campaign_other_brand');return null}
 if(!isRecruitmentObjective(campaign))out.state.push('campaign_not_recruitment');
 return raw;
}
function assetLink(raw:unknown,asset:unknown,brandId:string,out:Links):{ref:AssetRef;type:string|null}|null{
 if(absent(raw))return null;
 if(!isRecord(raw)||!keysOk(raw,['id','version'])||!validId(raw.id)||!posInt(raw.version)){out.input.push('invalid_input');return null}
 if(!isRecord(asset)||asset.id!==raw.id||asset.version!==raw.version||asset.brandId!==brandId){out.input.push('asset_other_brand');return null}
 // 폐기했거나 사실 변경으로 재검토가 걸린 판, 옛 판에는 잇지 않는다. 값이 빠진 기록도 막는다(fail closed).
 if(asset.status!=='approved')out.state.push('asset_not_approved');
 if(asset.reviewNeeded!==false)out.state.push('asset_review_needed');
 if(asset.current!==true)out.state.push('asset_superseded');
 return {ref:{id:raw.id,version:raw.version},type:typeof asset.type==='string'?asset.type:null};
}
function eventLink(raw:unknown,event:unknown,brandId:string,out:Links):string|null{
 if(absent(raw))return null;
 if(!validId(raw)){out.input.push('invalid_input');return null}
 if(!isRecord(event)||event.id!==raw||event.brandId!==brandId){out.input.push('event_other_brand');return null}
 if(event.status==='cancelled')out.state.push('event_cancelled');
 return raw;
}

// ── 코드 발급 ──
export const VALID_FROM_PAST_DAYS=90,VALID_FROM_FUTURE_DAYS=180,RETIRE_FUTURE_DAYS=180,LABEL_CHARS=60;
// taken: 직접 입력 코드이거나 서버가 만든 후보 코드(candidate)를 서버가 점포 추적 코드·모집 코드 두 기록 종류에서 조회한 결과.
// candidate: customCode가 없을 때 서버가 generateRecruitmentCode로 만든 후보. 형식이 틀리면 invalid_input으로 닫는다.
export type CodeIssueContext={enabled:boolean;brandId:string;branch:string|null;actor:RecruitmentActor;today:string;campaign:CampaignLite|null;asset:AssetLite|null;event:EventLite|null;taken:{tracking:boolean;recruitment:boolean};candidate?:string|null};
export type CodeIssueValue={code:string;channel:RecruitmentChannel;label:string;validFrom:string;campaignId:string|null;assetRef:AssetRef|null;eventId:string|null;utmCampaign:string|null};
const ISSUE_KEYS=['channel','label','validFrom','customCode','campaignId','assetRef','eventId','utmCampaign'];
// 단계: 스위치(409) → 역할(403) → 입력(400) → 상태(409: 분기 A 아님, 캠페인 목적 아님, 자료 상태, 행사 취소, 코드 사용 중). 첫 실패 단계의 코드를 모두 돌려준다.
export function codeIssueDecision(input:unknown,ctx:CodeIssueContext):RecruitmentDecision<CodeIssueValue>{
 return guarded(()=>{
  const c=ctxOf(ctx);
  if(c.enabled!==true)return fail(['switch_off']);
  if(!adminActor(c.actor))return fail(['role_forbidden']);
  const today=c.today,taken=c.taken,brandId=c.brandId;
  if(typeof brandId!=='string'||!brandId||!isDate(today)||!isRecord(taken)||typeof taken.tracking!=='boolean'||typeof taken.recruitment!=='boolean')return fail(['invalid_input']);
  if(!isRecord(input)||!keysOk(input,ISSUE_KEYS))return fail(['invalid_input']);
  const bad:RecruitmentCode[]=[],links:Links={input:bad,state:[]};
  const channel=get(input,'channel');
  if(!isRecruitmentChannel(channel))bad.push('channel_unknown');
  const label=textOf(get(input,'label'),LABEL_CHARS);
  if(label===null)bad.push('label_invalid');else if(!piiClean(label))bad.push('label_pii');
  const vf=get(input,'validFrom');let validFrom=today;
  if(!absent(vf)){
   if(!isDate(vf))bad.push('valid_from_invalid');
   else if(vf<addDays(today,-VALID_FROM_PAST_DAYS)||vf>addDays(today,VALID_FROM_FUTURE_DAYS))bad.push('valid_from_out_of_range');
   else validFrom=vf;
  }
  const custom=get(input,'customCode');let code='';
  if(!absent(custom)&&custom!==''){const n=normalizeRecruitmentCode(custom);if(isRecruitmentCode(n))code=n;else bad.push('code_format')}
  else if(isRecruitmentCode(c.candidate))code=c.candidate;
  else bad.push('invalid_input');
  const utm=get(input,'utmCampaign');let utmCampaign:string|null=null;
  if(!absent(utm)&&utm!==''){const u=typeof utm==='string'?utm.trim().toLowerCase():'';if(UTM_RE.test(u))utmCampaign=u;else bad.push('utm_campaign_invalid')}
  const campaignId=campaignLink(get(input,'campaignId'),c.campaign,brandId,links);
  const asset=assetLink(get(input,'assetRef'),c.asset,brandId,links);
  const eventId=eventLink(get(input,'eventId'),c.event,brandId,links);
  if(bad.length)return fail(bad);
  const state=[...links.state];
  // 분기 B·C·판정 불가(H7)는 유료 모집·박람회·설명회를 하지 않으므로 코드를 발급하지 않는다(명세 0.2의 8).
  if(c.branch!=='A')state.push('branch_not_a');
  if(taken.tracking||taken.recruitment)state.push('code_taken');
  if(state.length)return fail(state);
  const ch=channel as RecruitmentChannel;
  return pass({code,channel:ch,label:label as string,validFrom,campaignId,assetRef:asset?.ref??null,eventId,utmCampaign},assetMismatch(asset?.type??null,ch)?['asset_channel_mismatch']:[]);
 });
}

// ── 코드 사용 중지 ──
// 코드는 발급 뒤 고치지 않고 사용 중지만 한다. 오늘 이후 접수분의 귀속만 멈추고 과거로 소급하지 않는다(과거 리드는 리드별 제외로 고친다).
// 역할은 대표·관리자이고 스위치가 꺼져도 된다(보호 방향).
export type CodeRetireContext={actor:RecruitmentActor;today:string;enabled?:boolean};
export type RetirableCode={code:string;validFrom:string;retiredOn:string|null};
export function codeRetireDecision(code:unknown,input:unknown,ctx:CodeRetireContext):RecruitmentDecision<{retiredOn:string}>{
 return guarded(()=>{
  const c=ctxOf(ctx);
  if(!adminActor(c.actor))return fail(['role_forbidden']);
  const today=c.today;
  if(!isDate(today))return fail(['invalid_input']);
  if(!isRecord(code)||!isRecruitmentCode(code.code)||!isDate(code.validFrom)||!(absent(code.retiredOn)||isDate(code.retiredOn)))return fail(['invalid_input']);
  if(!isRecord(input)||!keysOk(input,['retiredOn']))return fail(['invalid_input']);
  const raw=get(input,'retiredOn'),retiredOn=absent(raw)?today:raw;
  const floor=code.validFrom>today?code.validFrom:today;
  if(!isDate(retiredOn)||retiredOn<floor||retiredOn>addDays(today,RETIRE_FUTURE_DAYS))return fail(['retire_date_invalid']);
  if(!absent(code.retiredOn))return fail(['code_already_retired']);
  return pass({retiredOn});
 });
}

// ── 코드 귀속 ──
export type TrackingValue={value:string;createdAt:string};
export type RecruitmentCodeLite={code:string;brandId:string;channel:RecruitmentChannel;validFrom:string;createdAt:string;retiredOn:string|null;retiredAt:string|null;campaignId:string|null;assetRef:AssetRef|null;eventId:string|null};
export type CodeBook={codes:readonly RecruitmentCodeLite[];tracking:readonly TrackingValue[]};
export type LeadCodes={brandId:string;receivedAt:string;codes:readonly {code:string;at:string;source?:'manual'|'import'}[];strikes:readonly {code:string;at:string}[]};
export type UnattributedReason='no_code'|'unknown_code'|'other_brand'|'before_valid_from'|'after_retired';
export type LeadAttribution=
 |{state:'attributed';basis:'code';code:string;channel:RecruitmentChannel;campaignId:string|null;assetRef:AssetRef|null;eventId:string|null;alsoMatched:number;retroactive:boolean;late:boolean}
 |{state:'conflict';code:string}
 |{state:'unattributed';reason:UnattributedReason};
export const UNATTRIBUTED_REASON_LABELS:Readonly<Record<UnattributedReason,string>>=deepFreeze({no_code:'코드 없음',unknown_code:'등록되지 않은 코드',other_brand:'다른 브랜드 코드',before_valid_from:'적용 시작일 전 접수',after_retired:'사용 중지 뒤 접수'});
export const CONFLICT_DETAIL='점포 코드와 같은 값';
// 남은 토큰이 모두 무효일 때 사유 우선순위.
const REASON_ORDER:readonly UnattributedReason[]=['before_valid_from','after_retired','other_brand','unknown_code'];
const list=(v:unknown):unknown[]=>Array.isArray(v)?Array.from(v):[];
type Token={code:string;at:unknown;source:unknown};
type Seen={lead:Record<string,unknown>;asOf:number|null;tokens:Token[];strikes:{code:string;at:unknown}[];codes:Record<string,unknown>[];tracking:Record<string,unknown>[]};
// asOf 이하의 기록만 본다: 리드 토큰·제외 기록은 at ≤ asOf, 모집 코드·점포 코드 값은 createdAt ≤ asOf(사용 중지는 retiredAt ≤ asOf일 때만 적용).
function seen(lead:unknown,book:unknown,opts:unknown):Seen|null{
 if(!isRecord(lead)||!isRecord(book))return null;
 const asOf=asOfMs(opts);
 const tokens=list(lead.codes).filter(isRecord).filter(t=>notAfter(t.at,asOf)).map(t=>({code:normalizeRecruitmentCode(t.code),at:t.at,source:t.source})).filter(t=>isRecruitmentCode(t.code));
 const strikes=list(lead.strikes).filter(isRecord).filter(s=>notAfter(s.at,asOf)).map(s=>({code:normalizeRecruitmentCode(s.code),at:s.at})).filter(s=>isRecruitmentCode(s.code));
 const codes=list(book.codes).filter(isRecord).filter(c=>typeof c.code==='string'&&notAfter(c.createdAt,asOf));
 const tracking=list(book.tracking).filter(isRecord).filter(t=>typeof t.value==='string'&&notAfter(t.createdAt,asOf));
 return {lead,asOf,tokens,strikes,codes,tracking};
}
const retirementApplies=(code:Record<string,unknown>,asOf:number|null)=>typeof code.retiredOn==='string'&&isDate(code.retiredOn)&&notAfter(code.retiredAt,asOf);
const refOf=(v:unknown):AssetRef|null=>isRecord(v)&&typeof v.id==='string'&&typeof v.version==='number'?{id:v.id,version:v.version}:null;
const sameTarget=(a:Record<string,unknown>,b:Record<string,unknown>)=>{const x=refOf(a.assetRef),y=refOf(b.assetRef);return a.channel===b.channel&&(a.campaignId??null)===(b.campaignId??null)&&(x===null?y===null:y!==null&&x.id===y.id&&x.version===y.version)};
// 입력 순서대로 토큰을 본다: 제외 기록된 토큰은 없는 것으로 본다 → 같은 값의 모집 코드가 없거나 다른 브랜드면 건너뛴다 → KST 접수일이 적용 시작일 전이거나 사용 중지일 이후면 건너뛴다
// → 여기까지 온 첫 토큰이 결정한다. 그 값이 점포 코드 값이면 conflict이고 다음 토큰으로 넘어가지 않는다(보수). 결정한 토큰이 없으면 unattributed다.
export function attributeLead(lead:LeadCodes,book:CodeBook,opts?:{asOf?:string}):LeadAttribution{
 try{
  const s=seen(lead,book,opts);
  if(!s||!isInstant(s.lead.receivedAt))return {state:'unattributed',reason:'no_code'};
  const recvMs=parseInstant(s.lead.receivedAt),recvDay=toKstDate(s.lead.receivedAt),brandId=s.lead.brandId;
  const struck=new Set(s.strikes.map(x=>x.code)),live=s.tokens.filter(t=>!struck.has(t.code));
  const judge=(t:Token):{code?:Record<string,unknown>;reason?:UnattributedReason}=>{
   const same=s.codes.filter(c=>normalizeRecruitmentCode(c.code)===t.code),mine=same.find(c=>c.brandId===brandId);
   if(!mine)return {reason:same.length?'other_brand':'unknown_code'};
   if(typeof mine.validFrom!=='string'||recvDay<mine.validFrom)return {reason:'before_valid_from'};
   if(retirementApplies(mine,s.asOf)&&recvDay>=(mine.retiredOn as string))return {reason:'after_retired'};
   return {code:mine};
  };
  const judged=live.map(t=>({t,...judge(t)}));
  const first=judged.findIndex(j=>j.code!==undefined);
  if(first<0){
   if(!live.length)return {state:'unattributed',reason:'no_code'};
   return {state:'unattributed',reason:REASON_ORDER.find(r=>judged.some(j=>j.reason===r))??'unknown_code'};
  }
  const win=judged[first],code=win.code as Record<string,unknown>;
  if(s.tracking.some(t=>normalizeRecruitmentCode(t.value)===win.t.code))return {state:'conflict',code:win.t.code};
  const alsoMatched=judged.slice(first+1).filter(j=>j.code!==undefined&&!sameTarget(j.code,code)).length;
  const created=msOf(code.createdAt),at=msOf(win.t.at);
  const retroactive=created!==null&&at!==null&&created>at;
  const late=win.t.source!=='import'&&at!==null&&at-recvMs>LATE_TOKEN_HOURS*3600e3;
  return {state:'attributed',basis:'code',code:win.t.code,channel:code.channel as RecruitmentChannel,campaignId:typeof code.campaignId==='string'?code.campaignId:null,assetRef:refOf(code.assetRef),eventId:typeof code.eventId==='string'?code.eventId:null,alsoMatched,retroactive,late};
 }catch{return {state:'unattributed',reason:'no_code'}}
}
// 귀속 계산에 쓴 기록을 정렬한 목록(R6 증빙 묶음 해시용). 같은 입력·같은 asOf면 같은 목록이고, asOf 뒤의 기록은 들어가지 않는다.
export function attributionInputs(lead:LeadCodes&{id:string},book:CodeBook,opts?:{asOf?:string}):string[]{
 try{
  const s=seen(lead,book,opts);
  if(!s)return [];
  const out=new Set<string>();
  if(typeof s.lead.id==='string')out.add('lead:'+s.lead.id);
  const values=new Set(s.tokens.map(t=>t.code));
  for(const t of s.tokens)out.add(`token:${t.code}@${String(t.at)}`);
  for(const x of s.strikes)out.add(`strike:${x.code}@${String(x.at)}`);
  for(const c of s.codes){
   const v=normalizeRecruitmentCode(c.code);
   if(!values.has(v))continue;
   out.add(`code:${v}@${String(c.createdAt)}`);
   if(retirementApplies(c,s.asOf))out.add(`retire:${v}@${String(c.retiredOn)}@${String(c.retiredAt)}`);
  }
  for(const t of s.tracking){const v=normalizeRecruitmentCode(t.value);if(values.has(v))out.add(`tracking:${v}@${String(t.createdAt)}`)}
  return [...out].sort(ascii);
 }catch{return []}
}
// 표시: unattributed는 모두 '유입 미확인'이고 사유는 부가 문구다. conflict는 '유입 미확인 · 점포 코드와 같은 값'. 귀속은 채널 라벨과 소급·늦은 입력 배지.
export function attributionLabel(a:LeadAttribution):{label:string;detail:string|null}{
 try{
  if(isRecord(a)&&a.state==='attributed'&&isRecruitmentChannel(a.channel)){
   const badges=[...(a.retroactive===true?['소급 등록 코드']:[]),...(a.late===true?[`접수 ${LATE_TOKEN_HOURS}시간 뒤 입력`]:[])];
   return {label:RECRUITMENT_CHANNEL_LABELS[a.channel],detail:badges.length?badges.join(' · '):null};
  }
  if(isRecord(a)&&a.state==='conflict')return {label:UNATTRIBUTED_LABEL,detail:CONFLICT_DETAIL};
  if(isRecord(a)&&a.state==='unattributed'&&typeof a.reason==='string'&&Object.hasOwn(UNATTRIBUTED_REASON_LABELS,a.reason))return {label:UNATTRIBUTED_LABEL,detail:UNATTRIBUTED_REASON_LABELS[a.reason as UnattributedReason]};
  return {label:UNATTRIBUTED_LABEL,detail:null};
 }catch{return {label:UNATTRIBUTED_LABEL,detail:null}}
}
// 접수 시각: 가져온 리드는 receivedAt(제공처 시각), 수기 리드는 createdAt(서버 시각). R6 코호트 기준이다.
export function receivedAtOf(lead:{receivedAt?:string;createdAt:string}):string{
 try{return isRecord(lead)&&typeof lead.receivedAt==='string'&&lead.receivedAt?lead.receivedAt:isRecord(lead)&&typeof lead.createdAt==='string'?lead.createdAt:''}catch{return ''}
}

// ── 모집 비용 ──
// 정본 금액은 그 서비스 기간에 실제로 소진한 비용의 부가세 제외 원화 금액(amountExVat)이다. 선충전은 비용이 아니다. 날짜는 KST다.
export const SPEND_LIMITS=deepFreeze({maxAmount:1e11,maxPeriodDays:366,evidenceChars:200});
export const SPEND_VOID_REASONS=deepFreeze(['entry_error','duplicate','refunded'] as const);
export type SpendVoidReason=typeof SPEND_VOID_REASONS[number];
// 결정 27 보조 검사: 증빙 문구를 NFKC로 바꾸고 공백·문장부호·기호를 없애고 소문자로 바꾼 뒤 찾는다. 맨 '분담금'은 넣지 않는다('분담금 없음(본부 전액 부담)'을 막지 않으려고).
// 출처 값(funding)이 실제 통제이고 이 검사는 속여 넣는 경우를 잡는 넛지다(완전하지 않다).
export const AD_FUND_TERMS=deepFreeze(['광고분담금','판촉분담금','광고비분담','판촉비분담','광고기금','판촉기금','공동광고','점주부담광고','가맹점부담광고','점주분담','가맹점분담','adfund','애드펀드'] as const);
export const AGENCY_FEE_TERMS=deepFreeze(['영업대행','분양대행','성과수수료','성공보수','커미션','commission'] as const);
const squash=(s:string)=>s.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
const hasTerm=(s:string,terms:readonly string[])=>{const x=squash(s);return terms.some(t=>x.includes(t))};
export type SpendInput={channel:unknown;date?:unknown;period?:{from:unknown;to:unknown};amount:unknown;vat:unknown;funding:unknown;evidence:unknown;
 original?:{currency:unknown;amount:unknown};campaignId?:unknown;assetRef?:unknown;platform?:{impressions?:unknown;clicks?:unknown;formSubmits?:unknown};
 acknowledgeDuplicate?:unknown;replacesSpendId?:unknown};
// existing: 같은 브랜드의 유효(무효화 안 된) 비용 행 요약. replaces: replacesSpendId로 서버가 읽은 행(없으면 null, referencedBy는 그 행을 가리키는 행사 수).
export type SpendSummary={id:string;channel:string;period:{from:string;to:string};amountExVat:number;campaignId:string|null;assetRef:AssetRef|null};
export type SpendReplaceTarget={id:string;brandId:string;channel:string;voided:boolean;referencedBy:number};
export type SpendContext={enabled:boolean;brandId:string;actor:RecruitmentActor;today:string;campaign:CampaignLite|null;asset:AssetLite|null;existing:readonly SpendSummary[];replaces:SpendReplaceTarget|null};
export type PlatformMetrics={impressions:number|null;clicks:number|null;formSubmits:number|null};
export type SpendValue={channel:RecruitmentChannel;period:{from:string;to:string};amount:number;vat:'excluded'|'included';amountExVat:number;funding:'hq_budget';evidence:string;
 original:{currency:string;amount:string}|null;campaignId:string|null;assetRef:AssetRef|null;platform:PlatformMetrics;platformNote:string;replaces:{spendId:string;reason:'replaced'}|null;duplicates:SpendDuplicate[]};
const SPEND_KEYS=['channel','date','period','amount','vat','funding','evidence','original','campaignId','assetRef','platform','acknowledgeDuplicate','replacesSpendId'];
const METRIC_KEYS=['impressions','clicks','formSubmits'] as const;
// date 또는 period 가운데 정확히 하나. date는 {from:d,to:d}로 바꾼다. from ≤ to ≤ today, 길이 366일 이하.
function periodOf(input:Record<string,unknown>,today:string):{from:string;to:string}|RecruitmentCode{
 const date=get(input,'date'),period=get(input,'period');
 if(absent(date)===absent(period))return 'period_invalid';
 let from:unknown,to:unknown;
 if(!absent(date)){from=date;to=date}
 else{if(!isRecord(period)||!keysOk(period,['from','to']))return 'period_invalid';from=get(period,'from');to=get(period,'to')}
 if(!isDate(from)||!isDate(to)||from>to)return 'period_invalid';
 if(to>today)return 'period_future';
 if(spanDays(from,to)>SPEND_LIMITS.maxPeriodDays)return 'period_too_long';
 return {from,to};
}
function originalOf(v:unknown):{currency:string;amount:string}|null|false{
 if(absent(v))return null;
 if(!isRecord(v)||!keysOk(v,['currency','amount']))return false;
 const currency=get(v,'currency'),amount=get(v,'amount');
 return typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)&&currency!=='KRW'&&typeof amount==='string'&&/^\d{1,12}(\.\d{1,2})?$/.test(amount)?{currency,amount}:false;
}
// 모르는 수치는 null로 두고 0으로 바꾸지 않는다.
function platformOf(v:unknown):PlatformMetrics|false{
 const out:PlatformMetrics={impressions:null,clicks:null,formSubmits:null};
 if(absent(v))return out;
 if(!isRecord(v)||!keysOk(v,METRIC_KEYS))return false;
 for(const k of METRIC_KEYS){const x=get(v,k);if(absent(x))continue;if(!countInt(x))return false;out[k]=x}
 return out;
}
const sameRef=(a:AssetRef|null,b:AssetRef|null)=>a===null?b===null:b!==null&&a.id===b.id&&a.version===b.version;
const summaryOk=(e:unknown):e is SpendSummary=>isRecord(e)&&typeof e.id==='string'&&typeof e.channel==='string'&&isRecord(e.period)&&isDate(e.period.from)&&isDate(e.period.to)&&countInt(e.amountExVat);
// 단계: 스위치(409) → 역할(403) → 입력(400) → 상태(409: 캠페인 목적 아님, 자료 상태, 교체 대상, 중복·겹침). 비용 기록에는 분기 검사가 없다(쓴 돈은 분기와 관계없이 사실대로 남긴다).
export function spendDecision(input:unknown,ctx:SpendContext):RecruitmentDecision<SpendValue>{
 return guarded(()=>{
  const c=ctxOf(ctx);
  if(c.enabled!==true)return fail(['switch_off']);
  if(!adminActor(c.actor))return fail(['role_forbidden']);
  const today=c.today,brandId=c.brandId,existing=c.existing,replaces=c.replaces;
  if(typeof brandId!=='string'||!brandId||!isDate(today)||!Array.isArray(existing)||!Array.from(existing).every(summaryOk)||!(replaces===null||replaces===undefined||isRecord(replaces)))return fail(['invalid_input']);
  if(!isRecord(input)||!keysOk(input,SPEND_KEYS))return fail(['invalid_input']);
  const bad:RecruitmentCode[]=[],links:Links={input:bad,state:[]},warnings:RecruitmentWarning[]=[];
  const channel=get(input,'channel');
  if(!isRecruitmentChannel(channel))bad.push('channel_unknown');
  const period=periodOf(input,today);
  if(typeof period==='string')bad.push(period);
  const amount=get(input,'amount');
  if(typeof amount==='number'&&amount<0)bad.push('amount_negative');
  else if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount>SPEND_LIMITS.maxAmount)bad.push('amount_invalid');
  const vat=get(input,'vat');
  if(vat!=='excluded'&&vat!=='included')bad.push('vat_invalid');
  const funding=get(input,'funding');
  if(funding==='ad_fund')bad.push('ad_fund_forbidden');
  else if(funding!=='hq_budget')bad.push('funding_invalid');
  const evidence=textOf(get(input,'evidence'),SPEND_LIMITS.evidenceChars);
  if(evidence===null)bad.push('evidence_required');
  else if(!piiClean(evidence))bad.push('evidence_pii');
  else if(hasTerm(evidence,AD_FUND_TERMS))bad.push('ad_fund_forbidden');
  // 결정 27(Q9 전): 점주 추천 금전 보상은 기록하지 않는다. 활동 기록은 금액 0으로 적는다.
  if(channel==='owner_referral'&&typeof amount==='number'&&amount>0)bad.push('referral_reward_forbidden');
  const original=originalOf(get(input,'original'));
  if(original===false)bad.push('original_invalid');
  // 외화 원금은 원화 소진액이 있는 외화 청구에만 적는다(0원 행에 외화 금액을 실으면 원장 비용이 0으로 줄어든다). 점주 추천은 금액 0이라 외화 원금도 금전 보상으로 본다.
  else if(original&&amount===0)bad.push(channel==='owner_referral'?'referral_reward_forbidden':'original_invalid');
  const platform=platformOf(get(input,'platform'));
  if(platform===false)bad.push('platform_metric_invalid');
  const ackRaw=get(input,'acknowledgeDuplicate');
  if(!absent(ackRaw)&&typeof ackRaw!=='boolean')bad.push('invalid_input');
  const replaceId=get(input,'replacesSpendId');
  if(!absent(replaceId)&&!validId(replaceId))bad.push('invalid_input');
  const campaignId=campaignLink(get(input,'campaignId'),c.campaign,brandId,links);
  const asset=assetLink(get(input,'assetRef'),c.asset,brandId,links);
  if(bad.length)return fail(bad);
  const ch=channel as RecruitmentChannel,p=period as {from:string;to:string},amt=amount as number,v=vat as 'excluded'|'included';
  // included면 부가세 제외 금액을 원 미만 버림으로 계산한다(휴리스틱, 정수 산술). 계산서 공급가액을 알면 excluded로 그 값을 넣는다.
  const amountExVat=v==='included'?(amt*10-(amt*10)%11)/11:amt;
  const state=[...links.state],rid=absent(replaceId)?null:replaceId as string;
  if(rid!==null){
   const r=replaces;
   if(!isRecord(r)||r.id!==rid||r.brandId!==brandId||r.channel!==ch||r.voided!==false)state.push('spend_replace_invalid');
   else if(r.referencedBy!==0)state.push('spend_referenced');
  }
  const assetRef=asset?.ref??null,ack=ackRaw===true,duplicates:SpendDuplicate[]=[];
  const others=(existing as SpendSummary[]).filter(e=>e.id!==rid&&e.channel===ch);
  let dup=false,overlap=false;
  for(const e of others){
   const isDup=e.period.from===p.from&&e.period.to===p.to&&e.amountExVat===amountExVat;
   const isOverlap=(e.campaignId??null)===campaignId&&sameRef(refOf(e.assetRef),assetRef)&&e.period.from<=p.to&&p.from<=e.period.to;
   if(isDup)dup=true;
   if(isOverlap)overlap=true;
   if(isDup||isOverlap)duplicates.push({id:e.id,period:{from:e.period.from,to:e.period.to},amountExVat:e.amountExVat});
  }
  if((dup||overlap)&&ack)warnings.push('duplicate_acknowledged');
  else{if(dup)state.push('spend_possible_duplicate');if(overlap)state.push('spend_period_overlap')}
  if(state.length)return fail(state,duplicates);
  const pm=platform as PlatformMetrics;
  if(ch==='search_ad')warnings.push('search_ad_manual');
  if(assetMismatch(asset?.type??null,ch))warnings.push('asset_channel_mismatch');
  if(pm.impressions!==null&&pm.clicks!==null&&pm.clicks>pm.impressions)warnings.push('clicks_exceed_impressions');
  if(hasTerm(evidence as string,AGENCY_FEE_TERMS))warnings.push('agency_fee_wording');
  return pass({channel:ch,period:p,amount:amt,vat:v,amountExVat,funding:'hq_budget',evidence:evidence as string,original:original as {currency:string;amount:string}|null,campaignId,assetRef,platform:pm,platformNote:PLATFORM_REPORTED_NOTE,replaces:rid===null?null:{spendId:rid,reason:'replaced'},duplicates},warnings);
 });
}
// 무효화: 사유는 entry_error·duplicate·refunded만(replaced는 교체로만 생긴다). 이미 무효화한 행, 행사가 참조한 행은 409다. 대표·관리자, 스위치가 꺼져도 된다(보호 방향).
export type SpendVoidContext={actor:RecruitmentActor;referencedBy:number;enabled?:boolean};
export function spendVoidDecision(row:unknown,input:unknown,ctx:SpendVoidContext):RecruitmentDecision<{reason:SpendVoidReason}>{
 return guarded(()=>{
  const c=ctxOf(ctx);
  if(!adminActor(c.actor))return fail(['role_forbidden']);
  if(!isRecord(row)||!validId(row.id)||!(absent(row.voided)||isRecord(row.voided)))return fail(['invalid_input']);
  if(!isRecord(input)||!keysOk(input,['reason']))return fail(['invalid_input']);
  const reason=get(input,'reason');
  if(!oneOf(SPEND_VOID_REASONS,reason))return fail(['void_reason_invalid']);
  const state:RecruitmentCode[]=[];
  if(!absent(row.voided))state.push('spend_already_voided');
  if(c.referencedBy!==0)state.push('spend_referenced');
  if(state.length)return fail(state);
  return pass({reason});
 });
}

// ── 기간 합계·정렬 창(R6이 수정 없이 쓴다) ──
export type SpendRow={id:string;version:number;channel:string;period:{from:string;to:string};amountExVat:number;createdAt:string;voided:{at:string;reason:string}|null};
export type ChannelSpend={total:number;rowCount:number;straddlingCount:number};
const rowOk=(r:unknown):r is SpendRow=>isRecord(r)&&validId(r.id)&&posInt(r.version)&&typeof r.channel==='string'&&isRecord(r.period)&&isDate(r.period.from)&&isDate(r.period.to)&&r.period.from<=r.period.to&&countInt(r.amountExVat)&&(absent(r.voided)||isRecord(r.voided));
// asOf가 있으면 createdAt ≤ asOf인 행만 보고, voided.at > asOf인 무효화는 아직 없던 것으로 본다.
const activeAt=(r:SpendRow,asOf:number|null)=>asOf===null?absent(r.voided):notAfter(r.createdAt,asOf)&&!(r.voided&&notAfter(r.voided.at,asOf));
// 창 [from,to] 안에 기간이 완전히 들어간 행만 합계에 넣는다. 일부만 걸친 행은 straddling으로 따로 돌려주고 나누지 않는다(일할 없음).
// byChannel은 행이 하나라도 있는 채널만 담는다(키 없음 = 비용 모름, 합계 0과 다르다). inputs는 쓴 행의 'id@version' 정렬 목록(R6 증빙 해시).
// R6 CPL 규칙: 채널의 straddlingCount > 0이면 그 창의 CPL은 null('비용 기간 불일치')이다. 대안은 alignedWindow다.
export function spendInWindow(rows:readonly SpendRow[],from:string,to:string,opts?:{asOf?:string}):{included:SpendRow[];straddling:SpendRow[];byChannel:Record<string,ChannelSpend>;inputs:string[]}{
 const byChannel:Record<string,ChannelSpend>=Object.create(null);
 try{
  if(!Array.isArray(rows)||!isDate(from)||!isDate(to)||from>to)return {included:[],straddling:[],byChannel,inputs:[]};
  const asOf=asOfMs(opts),included:SpendRow[]=[],straddling:SpendRow[]=[];
  for(const r of Array.from(rows as unknown[])){
   if(!rowOk(r)||!activeAt(r,asOf))continue;
   if(r.period.from>to||r.period.to<from)continue;
   const b=byChannel[r.channel]??(byChannel[r.channel]={total:0,rowCount:0,straddlingCount:0});
   if(r.period.from>=from&&r.period.to<=to){included.push(r);b.total+=r.amountExVat;b.rowCount++}
   else{straddling.push(r);b.straddlingCount++}
  }
  return {included,straddling,byChannel,inputs:[...included,...straddling].map(r=>`${r.id}@${r.version}`).sort(ascii)};
 }catch{return {included:[],straddling:[],byChannel:Object.create(null),inputs:[]}}
}
// 걸친 행을 모두 품도록 창을 넓힌다(넓힌 창에 새로 걸치는 행이 없을 때까지). 366일을 넘으면 null. 걸친 행이 없으면 원래 창과 expanded:false.
export function alignedWindow(rows:readonly SpendRow[],channel:string,from:string,to:string,opts?:{asOf?:string}):{from:string;to:string;expanded:boolean}|null{
 try{
  if(!Array.isArray(rows)||typeof channel!=='string'||!isDate(from)||!isDate(to)||from>to)return null;
  const asOf=asOfMs(opts),live=Array.from(rows as unknown[]).filter((r):r is SpendRow=>rowOk(r)&&r.channel===channel&&activeAt(r,asOf));
  let f=from,t=to,expanded=false;
  for(let round=0;round<=live.length;round++){
   const straddling=live.filter(r=>r.period.from<=t&&r.period.to>=f&&(r.period.from<f||r.period.to>t));
   if(!straddling.length)break;
   for(const r of straddling){if(r.period.from<f)f=r.period.from;if(r.period.to>t)t=r.period.to}
   expanded=true;
  }
  return spanDays(f,t)>SPEND_LIMITS.maxPeriodDays?null:{from:f,to:t,expanded};
 }catch{return null}
}
