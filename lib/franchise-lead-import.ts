// 트랙 R 리드 CSV 가져오기 순수 모듈(R5a): 전송·해독(UTF-8만), 구조, 민감 열 이름, 칸 값 개인정보 검사, 매핑, 행 정규화, 제공 증빙 형식, 기간 겹침, 파일 해시·계획 해시.
// R5b-2(대표 결정 32 B안): 이름·전화·이메일 머리글 열을 연락처 대상으로 매핑할 수 있다. 매핑한 연락처 열에서만 이름·전화·이메일을 받고, 매핑하지 않은 열의 개인정보는 파일 전체를 거부한다.
// 수집 근거(명세 2.7.1)와 파일 안·기존 리드 연락처 병합(대표 결정 '리드 1건, 집계는 파일별')도 여기서 판정한다. 기존 리드 대조(HMAC 조회)는 서버가 mergeExisting으로 넘긴다.
// 저장·API·화면은 서버(lib/franchise-lead-import-server.ts)·R5c가 한다. 가명 코드(leadSystemCode)도 서버가 만든다. 모듈은 시계·난수·조회를 읽지 않고 외부 호출이 없다.
// 브라우저 사전 검사(localFileCheck)와 서버 판정이 같은 함수를 쓴다. 칸 값·탐지 종류는 문구·오류 어디에도 싣지 않는다(행 번호와 열 번호 또는 통과한 머리글 이름만).
// 근거: R5 구현 명세 초안 2의 2.6·3절(계획 R5 I1~I5·P1~P3). 값 패턴 검사는 최선 노력이며(lib/pii-scan.ts 한계), 모든 판정은 COLLECTIVE 휴리스틱이고 법률 자문이 아니다.
import {parseCsv,IMPORT_LIMITS} from './order-import';
import {RECRUITMENT_VERSION,RECRUITMENT_DISCLAIMER,RECRUITMENT_ATTRIBUTION_NOTE,PROVENANCE_CHANNELS,EVENT_CHANNELS,isRecruitmentChannel,recruitmentTokens,attributeLead,type RecruitmentChannel,type CodeBook,type EventLite,type RecruitmentActor} from './franchise-recruitment';
import {scanText} from './pii-scan';
import {isDate,isInstant,parseInstant,toKstDate,addDays} from './franchise-rules';
import {BUDGET_LABELS,TIMING_LABELS,UNCONVERTED_RETENTION_DAYS,normalizeName,normalizePhone,normalizeEmail} from './franchise';

function deepFreeze<T>(value:T):T{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const k of Object.keys(value))deepFreeze((value as Record<string,unknown>)[k])}
 return value;
}
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sortedUnique=<T extends string>(xs:readonly T[]):T[]=>[...new Set(xs)].sort(ascii);
const keysOk=(o:Record<string,unknown>,allowed:readonly string[])=>Object.keys(o).every(k=>allowed.includes(k));
const get=(o:Record<string,unknown>,k:string):unknown=>Object.hasOwn(o,k)?o[k]:undefined;
const absent=(v:unknown)=>v===undefined||v===null;
const includes=(list:readonly string[],v:unknown)=>typeof v==='string'&&list.includes(v);
const ID_RE=/^[A-Za-z0-9._:-]{1,128}$/,HEX64=/^[0-9a-f]{64}$/;
const validId=(v:unknown):v is string=>typeof v==='string'&&ID_RE.test(v);
const countInt=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const HIDDEN=/[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\u2028\u2029]/u;
function textOf(v:unknown,max:number):string|null{
 if(typeof v!=='string')return null;
 const s=v.normalize('NFC').trim();
 return s.length>=1&&s.length<=max&&!HIDDEN.test(s)?s:null;
}
const piiClean=(s:string)=>scanText(s).length===0;
const dayNum=(d:string)=>Date.UTC(Number(d.slice(0,4)),Number(d.slice(5,7))-1,Number(d.slice(8,10)))/864e5;
const spanDays=(from:string,to:string)=>dayNum(to)-dayNum(from)+1;
const iso=(ms:number)=>new Date(ms).toISOString();
const decodeOnce=(v:string)=>{try{return decodeURIComponent(v)}catch{return v}};
async function sha256Hex(data:Uint8Array):Promise<string>{
 const b=await crypto.subtle.digest('SHA-256',new Uint8Array(data));
 return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
}

// ── 버전·한도·대상 ──
// 인코딩·대상·금지 대상·민감 열 이름·가져오기 전용 탐지·시각 문법·지역 규칙·한도의 판. 가져오기 기록에 저장한다.
export const LEAD_IMPORT_VERSION='fr-lead-import@2026-09-27.2';
// 바이트·행 한도는 IMPORT_LIMITS(주문 가져오기)보다 작거나 같다. 결정 32로 새 리드는 리드·중복 키 두 개·생성 이벤트 네 문장이라 100행이면 확정 한 batch가 402문장이다(명세의 200행·402문장 예산을 지킨다). base64 133,336자 = 100,000바이트.
export const LEAD_IMPORT_LIMITS=deepFreeze({maxBytes:100000,maxBase64:133336,maxRows:100,maxCodesPerRow:5,maxErrors:50,maxPiiPositions:20,
 maxAgeDays:UNCONVERTED_RETENTION_DAYS,maxPeriodDays:180,futureToleranceMs:300000,expiringWarnDays:14});
export const LEAD_IMPORT_TARGETS=deepFreeze({receivedAt:'접수 시각',region:'희망 시·도·시·군·구',budgetBand:'예산 구간',timingBand:'희망 시기',codes:'모집 코드',landingUrl:'유입 주소(utm_content)',contactName:'이름(연락처)',contactPhone:'전화(연락처)',contactEmail:'이메일(연락처)'});
export type LeadImportTarget=keyof typeof LEAD_IMPORT_TARGETS;
const TARGET_KEYS=Object.keys(LEAD_IMPORT_TARGETS) as LeadImportTarget[];
// 연락처 대상(결정 32): 이름·전화·이메일 머리글 열만 연결할 수 있고 결정 22의 R4b 원장과 같이 암호화해 저장한다.
export const CONTACT_TARGETS=deepFreeze(['contactName','contactPhone','contactEmail'] as const);
export type ContactTarget=typeof CONTACT_TARGETS[number];
// 연락처 머리글: NFKC → 소문자 → 공백·_·-·.·· 제거 뒤 아래 값과 정확히 같아야 한다. '휴대폰1'·'이름(한자)'·'연락번호'처럼 조금이라도 다르면 연락처 열이 아니고 민감 열 이름 검사로 파일 전체를 거부한다.
export const CONTACT_HEADER_ALIASES=deepFreeze({contactName:['이름','성명','성함','신청자','신청자명','신청인','고객명','문의자','name','fullname'],
 contactPhone:['연락처','전화','전화번호','휴대폰','휴대폰번호','핸드폰','핸드폰번호','휴대전화','휴대전화번호','phone','phonenumber','mobile','mobilenumber','tel','hp','cellphone'],
 contactEmail:['이메일','이메일주소','메일','email','emailaddress']} as Record<ContactTarget,readonly string[]>);
const contactHeaderKey=(h:string)=>h.normalize('NFKC').toLowerCase().replace(/[\s_.·-]+/g,'');
export function contactColumnKind(header:unknown):ContactTarget|null{
 try{
  if(typeof header!=='string')return null;
  const k=contactHeaderKey(header);
  return CONTACT_TARGETS.find(t=>CONTACT_HEADER_ALIASES[t].includes(k))??null;
 }catch{return null}
}
// 민감·고유식별 열과 문의 내용 같은 자유 텍스트는 매핑할 대상 자체가 없다(계획 I4). 이름·전화·이메일은 위 연락처 대상으로만 연결한다.
export const FORBIDDEN_TARGETS=deepFreeze(['name','phone','email','address','birthDate','residentId','gender','account','card','memo','message','externalId','ip']);
// 17개 시·도의 정식·약칭. 지역 칸의 첫 토큰이어야 한다(사람 이름이 '동'으로 끝나도 통과하지 못하게).
export const SIDO_NAMES=deepFreeze(['서울','서울시','서울특별시','부산','부산시','부산광역시','대구','대구시','대구광역시','인천','인천시','인천광역시','광주','광주시','광주광역시','대전','대전시','대전광역시','울산','울산시','울산광역시',
 '세종','세종시','세종특별자치시','경기','경기도','강원','강원도','강원특별자치도','충북','충청북도','충남','충청남도','전북','전라북도','전북특별자치도','전남','전라남도','경북','경상북도','경남','경상남도','제주','제주도','제주특별자치도']);

// ── 민감 열 이름(모든 머리글, 매핑과 무관) ──
// 맨 '문의'·'상담'은 넣지 않는다(접수 시각 열 '문의일시'·'상담신청일시'를 막지 않으려고). 상담은 '상담내용'·'상담요청'만 넣는다.
export const SENSITIVE_HEADER_TERMS_KO=deepFreeze(['이름','성명','성함','신청자','고객명','회원명','대표자','예비창업자','문의자','담당자','닉네임','아이디','연락처','전화','휴대폰','핸드폰','휴대전화','이메일','메일','카카오','카톡','주소','거주','생년','생일','나이','연령','주민','성별','계좌','카드','직업','직장','소득','자산','재산','건강','종교','문의내용','내용','메모','비고','요청사항','질문','의견','남기실',
 '신청인','작성자','예금주','고객','사항','상담내용','상담요청','제목','휴대','연락','폰번호','전번','출생','우편']);
export const SENSITIVE_HEADER_TOKENS_EN=deepFreeze(['phone','mobile','tel','telephone','email','mail','address','addr','birth','birthday','birthdate','dob','gender','sex','age','account','card','memo','message','comment','note','notes','nickname','username','kakao','income','job','occupation',
 'fullname','firstname','lastname','surname','ssn','rrn','passport','ip','hp','cell','contact','zip','zipcode','postal','postcode']);
// 붙여 쓴 영어 머리글(phonenumber·dateofbirth·kakaotalk 등): 토큰 안에 이 조각이 있으면 민감하다. content는 utm_content 때문에 조각에 넣지 않는다(토큰이 content 하나인 머리글만 민감하다).
export const SENSITIVE_HEADER_STEMS_EN=deepFreeze(['phone','mail','birth','contact','comment','remark','inquir','question','kakao','passport','address']);
export const NAME_QUALIFIERS=deepFreeze(['full','first','last','user','customer','applicant','contact','given','family','real','nick']);
export const ID_QUALIFIERS=deepFreeze(['lead','user','member','customer','applicant','kakao','external','leadgen']);
// 한국어: NFKC·공백 제거 뒤 포함 검사. 영어: 소문자 토큰(영숫자 밖 문자와 camelCase 경계로 나눔) 하나라도 목록에 있거나 조각을 품으면 민감하다. 토큰을 이어 붙인 값이 목록에 있어도 민감하다('H.P'·'E.Mail').
// name은 토큰이 name 하나이거나 앞 토큰이 NAME_QUALIFIERS일 때만, id는 토큰이 id 하나이거나 앞 토큰이 ID_QUALIFIERS일 때만, content는 토큰이 content 하나일 때만 민감하다(campaign_name·form_id·utm_content는 통과).
export function isSensitiveHeader(header:unknown):boolean{
 try{
  if(typeof header!=='string')return false;
  const n=header.normalize('NFKC'),ko=n.replace(/\s+/g,'');
  if(SENSITIVE_HEADER_TERMS_KO.some(t=>ko.includes(t)))return true;
  const tokens=n.replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if(SENSITIVE_HEADER_TOKENS_EN.includes(tokens.join('')))return true;
  return tokens.some((t,i)=>SENSITIVE_HEADER_TOKENS_EN.includes(t)||SENSITIVE_HEADER_STEMS_EN.some(x=>t.includes(x))
   ||t==='content'&&tokens.length===1
   ||t==='name'&&(tokens.length===1||i>0&&NAME_QUALIFIERS.includes(tokens[i-1]))
   ||t==='id'&&(tokens.length===1||i>0&&ID_QUALIFIERS.includes(tokens[i-1])));
 }catch{return true}
}
// 추천 매핑: NFKC·공백 제거·소문자로 별칭과 정확히 같은 머리글만. 민감 머리글은 고르지 않는다. 한 열은 한 대상에만.
export const LEAD_MAPPING_ALIASES=deepFreeze({receivedAt:['접수일시','신청일시','문의일시','등록일시','접수일'],region:['희망지역','창업희망지역','지역'],budgetBand:['예산','창업예산'],timingBand:['희망시기','창업시기'],codes:['모집코드','유입코드','코드'],landingUrl:['유입URL','랜딩URL'],
 contactName:[...CONTACT_HEADER_ALIASES.contactName],contactPhone:[...CONTACT_HEADER_ALIASES.contactPhone],contactEmail:[...CONTACT_HEADER_ALIASES.contactEmail]} as Record<LeadImportTarget,readonly string[]>);
const aliasKey=(h:string)=>h.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
export function suggestLeadMapping(headers:readonly string[]):Partial<Record<LeadImportTarget,number>>{
 const out:Partial<Record<LeadImportTarget,number>>=Object.create(null);
 try{
  if(!Array.isArray(headers))return out;
  const list=Array.from(headers as unknown[]),used=new Set<number>();
  for(const target of TARGET_KEYS){
   const aliases=LEAD_MAPPING_ALIASES[target].map(aliasKey),contact=(CONTACT_TARGETS as readonly string[]).includes(target);
   // 연락처 대상은 같은 종류의 연락처 머리글만, 그 밖 대상은 민감하지 않은 머리글만 고른다.
   const i=list.findIndex((h,j)=>!used.has(j)&&typeof h==='string'&&(contact?contactColumnKind(h)===target:!isSensitiveHeader(h)&&aliases.includes(aliasKey(h))));
   if(i>=0){out[target]=i;used.add(i)}
  }
  return out;
 }catch{return Object.create(null)}
}
// 제공처 키: NFKC → 공백 제거 → 소문자('창업포털A'와 '창업 포털a'는 같은 키).
export const providerKeyOf=(label:unknown):string=>{try{return typeof label==='string'?label.normalize('NFKC').replace(/\s+/g,'').toLowerCase():''}catch{return ''}};

// ── 사유 코드·상태·문구 ──
export const LEAD_IMPORT_ROW_CODES=deepFreeze(['received_missing','received_invalid','received_date_only','received_future','received_too_old','received_after_provided','received_outside_period','region_invalid','contact_missing','contact_name_invalid','contact_phone_invalid','contact_email_invalid'] as const);
export const LEAD_IMPORT_SKIP_CODES=deepFreeze(['overlap','duplicate_in_file'] as const);
export const LEAD_IMPORT_WARNING_CODES=deepFreeze(['budget_unmapped','timing_unmapped','dropped_tokens','truncated_tokens','possible_duplicate_in_file','expiring_within_14d','period_includes_export_day'] as const);
const ERROR_CODES=['file_too_large','encoding_invalid','csv_invalid','too_many_rows','sensitive_column_in_file','pii_in_file','channel_unknown','mapping_invalid','mapping_forbidden','provenance_required','provenance_invalid','provider_pii','period_invalid','storage_labels_unset','event_channel_mismatch','event_other_brand','confirm_required','row_invalid','invalid_input','contact_mapping_invalid','basis_invalid',
 'role_forbidden','switch_off','branch_not_a','event_cancelled','file_duplicate','no_new_rows','expected_mismatch'] as const;
export const LEAD_IMPORT_CODES=deepFreeze([...ERROR_CODES,...LEAD_IMPORT_ROW_CODES,...LEAD_IMPORT_SKIP_CODES,...LEAD_IMPORT_WARNING_CODES] as const);
export type LeadImportCode=typeof LEAD_IMPORT_CODES[number];
type ErrorCode=typeof ERROR_CODES[number];
export type LeadRowCode=typeof LEAD_IMPORT_ROW_CODES[number];
// 한 단계의 코드는 같은 상태다. 행 코드는 row_invalid(400) 안에만 나오고, 건너뜀·경고는 성공 결과(200)의 건수다.
export const LEAD_IMPORT_CODE_STATUS:Readonly<Record<LeadImportCode,200|400|403|409>>=deepFreeze({
 file_too_large:400,encoding_invalid:400,csv_invalid:400,too_many_rows:400,sensitive_column_in_file:400,pii_in_file:400,channel_unknown:400,mapping_invalid:400,mapping_forbidden:400,provenance_required:400,provenance_invalid:400,provider_pii:400,period_invalid:400,storage_labels_unset:400,event_channel_mismatch:400,event_other_brand:400,confirm_required:400,row_invalid:400,invalid_input:400,contact_mapping_invalid:400,basis_invalid:400,
 role_forbidden:403,switch_off:409,branch_not_a:409,event_cancelled:409,file_duplicate:409,no_new_rows:409,expected_mismatch:409,
 received_missing:400,received_invalid:400,received_date_only:400,received_future:400,received_too_old:400,received_after_provided:400,received_outside_period:400,region_invalid:400,contact_missing:400,contact_name_invalid:400,contact_phone_invalid:400,contact_email_invalid:400,
 overlap:200,duplicate_in_file:200,budget_unmapped:200,timing_unmapped:200,dropped_tokens:200,truncated_tokens:200,possible_duplicate_in_file:200,expiring_within_14d:200,period_includes_export_day:200,
});
// 고정 문구. 입력 값을 끼워 넣지 않는다. pii_in_file의 {count}만 걸린 칸 수로 바꾼다. csv_invalid는 parseCsv 문구(줄 번호·한도만)를 그대로 쓰고 주문 문구 하나만 리드 문구로 바꾼다.
export const LEAD_IMPORT_MESSAGES:Readonly<Record<LeadImportCode,string>>=deepFreeze({
 file_too_large:'파일은 100,000바이트 이하여야 합니다. 파일을 나누어 올려 주세요.',
 encoding_invalid:'이 파일은 UTF-8 CSV가 아닙니다. 표 계산기에서 "CSV UTF-8"로 다시 저장하거나, 화면의 "EUC-KR로 읽기"를 눌러 주세요.',
 csv_invalid:'CSV 형식을 확인하세요.',
 too_many_rows:'한 번에 200행까지 가져올 수 있습니다. 파일을 나누어 주세요.',
 sensitive_column_in_file:'이름·연락처·주소·생년월일·문의 내용 같은 열이 있어 파일 전체를 가져오지 않았습니다. 해당 열을 지운 파일로 다시 올려 주세요.',
 pii_in_file:'{count}개 칸에서 개인정보 형식(전화·이메일·주소·고유식별번호·결제정보 등)이 보여 파일 전체를 가져오지 않았습니다. 해당 열을 지운 파일로 다시 올려 주세요. 숫자만 이어 쓴 날짜·13자리 이상 번호도 걸립니다(날짜는 YYYY-MM-DD HH:mm로 바꿔 주세요). 모집 코드 열이 걸렸다면 코드가 R로 시작하는 8자인지 확인해 주세요.',
 channel_unknown:'모집 채널을 확인하세요.',
 mapping_invalid:'열 연결을 확인하세요. 접수 시각은 필수이고, 한 열은 한 항목에만 연결합니다.',
 mapping_forbidden:'이름·연락처·주민등록번호·메모·외부 식별자 같은 항목은 연결할 수 없습니다.',
 provenance_required:'제공처·제공일·내보내기 기간을 적어 주세요. 창업 포털·박람회 파일은 제공자 측 동의 증빙 참조도 필요합니다.',
 provenance_invalid:'제공 증빙 형식을 확인하세요(제공처 1~60자, 제공일은 오늘 이하, 동의 증빙은 SHA-256 소문자 64자와 등록한 보관 위치 라벨).',
 provider_pii:'제공처 라벨에 개인정보로 보이는 값이 있습니다. 회사·서비스 이름만 적어 주세요.',
 period_invalid:'내보내기 기간은 시작 ≤ 끝 ≤ 제공일이고 180일 이하이며, 시작은 오늘(KST)부터 179일 전 이후여야 합니다.',
 storage_labels_unset:'설정에서 보관 위치 라벨을 먼저 등록해 주세요.',
 event_channel_mismatch:'행사는 박람회·사업설명회 채널의 가져오기에만 연결할 수 있습니다.',
 event_other_brand:'이 브랜드의 행사가 아닙니다.',
 confirm_required:'확정하려면 미리보기에서 받은 계획 해시와 생성 건수를 함께 보내 주세요.',
 row_invalid:'고칠 행이 있어 가져오지 않았습니다. 행 번호와 열을 확인해 파일을 고친 뒤 다시 올려 주세요.',
 invalid_input:'입력 형식을 확인하세요.',
 contact_mapping_invalid:'연락처는 이름·전화·이메일 머리글 열에만 연결하고, 이름 열과 전화·이메일 열 가운데 하나 이상을 함께 연결해 주세요(결정 32).',
 basis_invalid:'수집 근거를 확인하세요. 창업 포털·박람회는 제3자 제공 수령 또는 위탁 수집(문의 응대), 점주 추천은 제3자 소개(가맹점주) 또는 문의 응대, 그 밖 채널은 문의 응대만 고를 수 있습니다. 동의는 가져오기에서 고를 수 없습니다.',
 role_forbidden:'리드 파일 검사·미리보기·가져오기는 대표·관리자만 할 수 있습니다.',
 switch_off:'가맹 모집 기능이 꺼져 있어 리드 파일을 가져올 수 없습니다.',
 branch_not_a:`가맹 준비도 분기가 A(모집 가능)로 기록된 브랜드만 리드 파일을 가져올 수 있습니다(H7). ${RECRUITMENT_DISCLAIMER}`,
 event_cancelled:'취소된 행사입니다.',
 file_duplicate:'이미 가져온 파일입니다(같은 파일 해시).',
 no_new_rows:'새로 만들 리드가 없습니다. 모든 행이 이전 가져오기 기간과 겹치거나 파일 안 중복으로 건너뛰었습니다.',
 expected_mismatch:'미리보기 뒤 파일·설정·날짜가 바뀌었습니다. 미리보기를 다시 하세요.',
 received_missing:'접수 시각이 비어 있습니다.',
 received_invalid:'접수 시각 형식을 확인하세요(예: 2026-10-05 14:05).',
 received_date_only:'날짜만 있는 접수 시각은 박람회·사업설명회 파일에서만 받습니다.',
 received_future:'접수 시각이 지금보다 뒤입니다.',
 received_too_old:'접수 시각이 보존 기한(접수 후 180일)을 넘었습니다.',
 received_after_provided:'접수일이 제공일보다 뒤입니다.',
 received_outside_period:'접수일이 선언한 내보내기 기간 밖입니다.',
 region_invalid:'지역은 시·도로 시작하고 시·군·구·읍·면·동으로 끝나는 행정구역만 적어 주세요.',
 contact_missing:'이름과 전화번호·이메일 중 하나 이상이 있어야 합니다.',
 contact_name_invalid:'이름 형식을 확인하세요(40자 이하, 숫자·<> 없음).',
 contact_phone_invalid:'전화번호 형식을 확인하세요.',
 contact_email_invalid:'이메일 형식을 확인하세요.',
 overlap:'이전 가져오기의 내보내기 기간과 겹쳐 건너뛴 행입니다.',
 duplicate_in_file:'파일 안 중복으로 건너뛴 행입니다.',
 budget_unmapped:'예산 값을 알 수 없어 미정으로 둔 행입니다.',
 timing_unmapped:'희망 시기 값을 알 수 없어 미정으로 둔 행입니다.',
 dropped_tokens:'모집 코드가 아닌 토큰(점포 코드 포함)을 버렸습니다.',
 truncated_tokens:'한 행의 모집 코드는 5개까지만 씁니다.',
 possible_duplicate_in_file:'접수 시각·지역·예산·시기·코드가 같은 행이 파일 안에 있습니다(건너뛰지 않음).',
 expiring_within_14d:'보존 기한이 14일 안에 끝나는 행입니다.',
 period_includes_export_day:'내보내기 기간 끝 날이 제공일과 같습니다. 그날 이후 접수분은 다음 파일에서 건너뜁니다.',
});
export const piiMessage=(count:number):string=>LEAD_IMPORT_MESSAGES.pii_in_file.replace('{count}',String(count));

// ── 결정 객체(R15a-1과 같은 모양, 이 모듈이 따로 정의한다) ──
export type LeadImportError={row?:number;column:string;code?:LeadRowCode};
export type LeadDecision<T>=
 |{ok:true;status:200;value:T;warnings:string[];ruleVersion:string;disclaimer:string}
 |{ok:false;status:400|403|409;reasons:ErrorCode[];message:string;errors?:LeadImportError[];ruleVersion:string;disclaimer:string};
type Failure=Extract<LeadDecision<never>,{ok:false}>;
function fail(codes:readonly ErrorCode[],x:{message?:string;errors?:LeadImportError[]}={}):Failure{
 const reasons=sortedUnique(codes);
 return {ok:false,status:LEAD_IMPORT_CODE_STATUS[reasons[0]] as 400|403|409,reasons,message:x.message??LEAD_IMPORT_MESSAGES[reasons[0]],...(x.errors?.length?{errors:x.errors}:{}),ruleVersion:RECRUITMENT_VERSION,disclaimer:RECRUITMENT_DISCLAIMER};
}
const pass=<T>(value:T,warnings:readonly string[]=[]):LeadDecision<T>=>({ok:true,status:200,value,warnings:sortedUnique(warnings),ruleVersion:RECRUITMENT_VERSION,disclaimer:RECRUITMENT_DISCLAIMER});
async function guardedAsync<T>(run:()=>Promise<LeadDecision<T>>):Promise<LeadDecision<T>>{try{return await run()}catch{return fail(['invalid_input'])}}
const ctxOf=(v:unknown):Record<string,unknown>=>isRecord(v)?v:{};
const adminActor=(a:unknown)=>isRecord(a)&&typeof a.id==='string'&&a.id.length>=1&&a.id.length<=200&&!HIDDEN.test(a.id)&&(a.role==='owner'||a.role==='admin');

// ── 전송과 인코딩 ──
const B64_ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',B64_RE=/^[A-Za-z0-9+/]*={0,2}$/;
// 표준 base64 알파벳·패딩만, 133,336자 이하. 아니면 null.
export function base64Bytes(s:unknown):Uint8Array|null{
 try{
  if(typeof s!=='string'||s.length>LEAD_IMPORT_LIMITS.maxBase64||s.length%4!==0||!B64_RE.test(s))return null;
  const pad=s.endsWith('==')?2:s.endsWith('=')?1:0,out=new Uint8Array(s.length/4*3-pad),val=(c:string)=>c==='='?0:B64_ALPHABET.indexOf(c);
  let o=0;
  for(let i=0;i<s.length;i+=4){
   const n=(val(s[i])<<18)|(val(s[i+1])<<12)|(val(s[i+2])<<6)|val(s[i+3]);
   for(const b of [(n>>16)&255,(n>>8)&255,n&255])if(o<out.length)out[o++]=b;
  }
  return out;
 }catch{return null}
}
// 100,000바이트 초과는 file_too_large. UTF-16 BOM(FF FE·FE FF), UTF-8이 아닌 바이트(CP949 등), U+FFFD·U+0000은 encoding_invalid.
// UTF-8 BOM은 하나만 떼고 hadBom:true. fileSha256은 받은 원본 바이트(BOM 포함)의 SHA-256이다(디스크의 sha256sum과 같다).
export async function decodeLeadCsv(bytes:Uint8Array):Promise<{ok:true;text:string;hadBom:boolean;fileSha256:string}|{ok:false;reason:'file_too_large'|'encoding_invalid'}>{
 try{
  if(!(bytes instanceof Uint8Array))return {ok:false,reason:'encoding_invalid'};
  if(bytes.length>LEAD_IMPORT_LIMITS.maxBytes)return {ok:false,reason:'file_too_large'};
  if(bytes.length>=2&&(bytes[0]===0xff&&bytes[1]===0xfe||bytes[0]===0xfe&&bytes[1]===0xff))return {ok:false,reason:'encoding_invalid'};
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{return {ok:false,reason:'encoding_invalid'}}
  const hadBom=text.startsWith('\ufeff');
  if(hadBom)text=text.slice(1);
  if(text.includes('\ufffd')||text.includes('\u0000'))return {ok:false,reason:'encoding_invalid'};
  return {ok:true,text,hadBom,fileSha256:await sha256Hex(bytes)};
 }catch{return {ok:false,reason:'encoding_invalid'}}
}

// ── 가져오기 전용 개인정보 탐지(lib/pii-scan.ts는 고치지 않는다) ──
const ND=/\p{Nd}/u;
// 유니코드 숫자(Nd)를 ASCII로 바꾼다. Nd는 0~9가 연속한 10자 묶음으로만 부호화되므로 앞으로 이어진 Nd 수의 10 나머지가 자릿값이다.
function asciiDigits(s:string):string{
 let out='';
 for(const ch of s){
  if(ch>='0'&&ch<='9'||!ND.test(ch)){out+=ch;continue}
  const cp=ch.codePointAt(0) as number;let k=0;
  while(k<60&&ND.test(String.fromCodePoint(cp-k-1)))k++;
  out+=String(k%10);
 }
 return out;
}
const LEADING_ZERO_PHONE=[/^1[016789]\d{8}$/,/^1[016789][-. ]\d{3,4}[-. ]\d{4}$/];
const COUNTRY_00=/(?<!\d)00[-. ]?82[-. ]?0?1[016789]/;
const EXPONENT=/^\d(\.\d+)?E\+\d+$/i;
const MASKED_PHONE=/(?<!\d)01[016789][-. ]?[\d*]{3,4}[-. ]?[\d*]{4}(?!\d)/g;
const MASKED_RRN=/(?<!\d)\d{6}[-. _]?[1-8*]\*{6}(?!\d)/;
const EMAIL_VARIANT=/\(at\)|\[at\]|골뱅이|\s@\s|%40/i;
const EMAIL_NO_TLD=/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?![.\w])/;
// 압축 사본: 숫자 20자 이하 덩어리 안의 구분자를 지운다. 휴대폰(덩어리 전체)과 주민등록번호(13자리, 유효한 YYMMDD, 7번째 1~8)만 본다. 카드 탐지는 쓰지 않는다(접수 시각·기간 오탐 방지).
const CHUNK=/\d(?:[\s~_,.*/-]*\d)*/g;
function validYymmdd(s:string){const m=Number(s.slice(2,4)),d=Number(s.slice(4,6));return m>=1&&m<=12&&d>=1&&d<=[31,29,31,30,31,30,31,31,30,31,30,31][m-1]}
function compressedHits(copy:string):number{
 let n=0;
 for(const m of copy.matchAll(CHUNK)){
  const digits=m[0].replace(/\D/g,'');
  if(digits.length>20)continue;
  if(/^01[016789]\d{7,8}$/.test(digits))n++;
  else if(digits.length===13&&validYymmdd(digits.slice(0,6))&&/[1-8]/.test(digits[6]))n++;
 }
 return n;
}
const findings=(s:string)=>scanText(s).reduce((a,f)=>a+f.count,0);
// 칸 하나의 탐지 건수(값·종류는 돌려주지 않는다). 원문 scanText → 정규화 사본(숫자 ASCII화, '%'가 있으면 퍼센트 해독 한 번) scanText → 가져오기 전용 탐지 → 압축 사본.
// 이 함수가 던지면 걸린 것으로 본다(fail closed).
export function importPiiHits(cell:unknown):number{
 try{
  if(typeof cell!=='string')return 0;
  let copy=asciiDigits(cell);
  if(copy.includes('%'))copy=decodeOnce(copy);
  const whole=copy.trim();
  let n=findings(cell)+findings(copy);
  if(LEADING_ZERO_PHONE.some(r=>r.test(whole)))n++;
  if(COUNTRY_00.test(copy))n++;
  if(EXPONENT.test(whole))n++;
  if([...copy.matchAll(MASKED_PHONE)].some(m=>m[0].includes('*')))n++;
  if(MASKED_RRN.test(copy))n++;
  if(EMAIL_VARIANT.test(copy))n++;
  if(EMAIL_NO_TLD.test(copy))n++;
  return n+compressedHits(copy);
 }catch{return 1}
}
// 연락처 머리글 열의 칸(결정 32): 이름 열은 개인정보 형식이 하나도 없어야 한다. 전화·이메일 열은 전화·이메일만 그 열의 값으로 받고,
// 고유식별번호·결제정보·주소·고객 id, 가린 휴대폰·주민등록번호, 구분자를 지운 주민등록번호는 어느 열에서도 걸린다. 던지면 걸린 것으로 본다(fail closed).
function rrnCompressed(copy:string):boolean{
 for(const m of copy.matchAll(CHUNK)){const d=m[0].replace(/\D/g,'');if(d.length===13&&validYymmdd(d.slice(0,6))&&/[1-8]/.test(d[6]))return true}
 return false;
}
export function contactCellHits(cell:unknown,target:ContactTarget):number{
 try{
  if(typeof cell!=='string')return 0;
  if(target==='contactName')return importPiiHits(cell);
  let copy=asciiDigits(cell);
  if(copy.includes('%'))copy=decodeOnce(copy);
  const other=(s:string)=>scanText(s).filter(f=>f.kind!=='phone'&&f.kind!=='email').reduce((a,f)=>a+f.count,0);
  let n=other(cell)+other(copy);
  if([...copy.matchAll(MASKED_PHONE)].some(m=>m[0].includes('*')))n++;
  if(MASKED_RRN.test(copy))n++;
  if(rrnCompressed(copy))n++;
  return n;
 }catch{return 1}
}
// 같은 행에서 이웃한 세 칸이 010 / 1234 / 5678 꼴이면(머리글이 일반 이름인 분리 휴대폰 열) 세 칸 모두 걸린 것으로 본다.
function splitPhoneColumns(cells:readonly string[]):number[]{
 const out:number[]=[];
 for(let c=0;c+2<cells.length;c++)if(/^01[016789]$/.test(cells[c].trim())&&/^\d{3,4}$/.test(cells[c+1].trim())&&/^\d{4}$/.test(cells[c+2].trim()))out.push(c,c+1,c+2);
 return out;
}

// ── 파일 단계(해독 → 구조 → 머리글 → 칸 값). 브라우저 사전 검사와 서버가 같은 결과를 낸다 ──
type Parsed={text:string;hadBom:boolean;fileSha256:string;headers:string[];rows:string[][];lines:number[]};
const csvMessage=(m:string)=>m.replace('가져올 주문 행이 없습니다.','가져올 리드 행이 없습니다.');
async function fileStage(bytes:Uint8Array):Promise<Parsed|Failure>{
 const d=await decodeLeadCsv(bytes);
 if(!d.ok)return fail([d.reason]);
 let parsed:{headers:string[];rows:string[][];lines:number[]};
 try{parsed=parseCsv(d.text)}
 catch(e){
  const m=isRecord(e)&&typeof e.message==='string'?e.message:'';
  // parseCsv 자체의 행 상한(IMPORT_LIMITS.maxRows) 문구도 행 한도 초과로 본다.
  if(m.startsWith(`한 번에 ${IMPORT_LIMITS.maxRows.toLocaleString('ko-KR')}행까지`))return fail(['too_many_rows']);
  return fail(['csv_invalid'],{message:m?csvMessage(m):LEAD_IMPORT_MESSAGES.csv_invalid});
 }
 if(parsed.rows.length>LEAD_IMPORT_LIMITS.maxRows)return fail(['too_many_rows']);
 // 1단계 머리글: 이름이 민감하거나 머리글 값 자체에 개인정보 형식이 있으면 거부한다. 열 번호만 싣는다(머리글 자체가 이름·연락처일 수 있다).
 // 연락처 머리글(결정 32)은 이 단계를 통과하고, 판정 단계에서 연락처 대상으로 매핑하지 않았으면 파일 전체를 거부한다.
 const kinds=parsed.headers.map(contactColumnKind);
 const headerErrors=parsed.headers.flatMap((h,i)=>(isSensitiveHeader(h)&&!kinds[i])||importPiiHits(h)>0?[{column:`${i+1}번째 열`}]:[]);
 if(headerErrors.length)return fail(['sensitive_column_in_file'],{errors:headerErrors.slice(0,LEAD_IMPORT_LIMITS.maxErrors)});
 // 2단계 칸 값: 매핑과 관계없이 모든 칸. 위치는 parseCsv의 실제 줄 번호와 1단계를 통과한 머리글 이름이다.
 const hits:LeadImportError[]=[];
 parsed.rows.forEach((cells,r)=>{
  const flagged=new Set<number>(splitPhoneColumns(cells));
  cells.forEach((v,c)=>{const k=kinds[c];if((k?contactCellHits(v,k):importPiiHits(v))>0)flagged.add(c)});
  for(const c of [...flagged].sort((a,b)=>a-b))hits.push({row:parsed.lines[r],column:parsed.headers[c]});
 });
 if(hits.length)return fail(['pii_in_file'],{message:piiMessage(hits.length),errors:hits.slice(0,LEAD_IMPORT_LIMITS.maxPiiPositions)});
 return {text:d.text,hadBom:d.hadBom,fileSha256:d.fileSha256,...parsed};
}
const isFailure=(x:unknown):x is Failure=>isRecord(x)&&x.ok===false;
export type LocalFileValue={fileSha256:string;hadBom:boolean;headers:string[];rowCount:number;suggestedMapping:Partial<Record<LeadImportTarget,number>>};
const localValue=(p:Parsed):LocalFileValue=>({fileSha256:p.fileSha256,hadBom:p.hadBom,headers:p.headers,rowCount:p.rows.length,suggestedMapping:suggestLeadMapping(p.headers)});
// 브라우저 사전 검사: 역할·스위치 없이 파일 단계만 돈다. 걸리면 화면은 보내지 않는다(개인정보 열이 기기를 떠나지 않게). 서버는 같은 검사를 다시 한다.
export async function localFileCheck(bytes:Uint8Array):Promise<LeadDecision<LocalFileValue>>{
 return guardedAsync(async()=>{
  const p=await fileStage(bytes);
  return isFailure(p)?p:pass(localValue(p));
 });
}
// base64 전송을 원본 바이트로 되돌린다. 133,336자 초과는 file_too_large, 알파벳·패딩 오류는 encoding_invalid.
function bytesOf(v:unknown):Uint8Array|Failure{
 if(typeof v==='string'&&v.length>LEAD_IMPORT_LIMITS.maxBase64)return fail(['file_too_large']);
 return base64Bytes(v)??fail(['encoding_invalid']);
}
const TRANSCODED=['euc-kr'];
function transcodedOf(v:unknown):string|null|false{return absent(v)?null:includes(TRANSCODED,v)?v as string:false}

// ── 파일 검사(매핑 없는 첫 단계) ──
export type InspectContext={enabled:boolean;brandId:string;branch:string|null;actor:RecruitmentActor};
export type LeadFileInspection=LocalFileValue&{transcodedFrom:string|null};
// 단계: 스위치(409) → 역할(403) → 분기(409) → 파일(400) → 머리글(400) → 칸 값(400) → 입력(400). headers는 두 검사를 통과했을 때만 싣는다.
export async function inspectLeadFile(input:unknown,ctx:InspectContext):Promise<LeadDecision<LeadFileInspection>>{
 return guardedAsync(async()=>{
  const c=ctxOf(ctx);
  if(c.enabled!==true)return fail(['switch_off']);
  if(!adminActor(c.actor))return fail(['role_forbidden']);
  if(c.branch!=='A')return fail(['branch_not_a']);
  if(!isRecord(input))return fail(['invalid_input']);
  const bytes=bytesOf(get(input,'csvBase64'));
  if(isFailure(bytes))return bytes;
  const p=await fileStage(bytes);
  if(isFailure(p))return p;
  const transcodedFrom=transcodedOf(get(input,'transcodedFrom'));
  if(!keysOk(input,['csvBase64','transcodedFrom'])||transcodedFrom===false)return fail(['invalid_input']);
  return pass({...localValue(p),transcodedFrom});
 });
}

// ── 행 정규화 ──
// 시간대 있는 ISO 8601, 또는 KST로 읽는 로컬 시각 'YYYY[-./]M[-./]D[.]' + 공백·T + 선택 오전·오후 + 'H:mm[:ss]'(월·일·시 1~2자리, 구분자 뒤 공백 허용).
const LOCAL_RE=/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?(?:\s+|T)(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY_RE=/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/;
// KST 로컬 시각의 epoch ms. Date.UTC로 만든 뒤 연·월·일·시·분·초가 같아야 한다(왕복 비교: 02-30·24:00·:60 거부). 연 2000~2199.
function kstMs(y:number,mo:number,d:number,h:number,mi:number,s:number):number|null{
 if(y<2000||y>2199)return null;
 const u=Date.UTC(y,mo-1,d,h,mi,s),x=new Date(u);
 if(x.getUTCFullYear()!==y||x.getUTCMonth()!==mo-1||x.getUTCDate()!==d||x.getUTCHours()!==h||x.getUTCMinutes()!==mi||x.getUTCSeconds()!==s)return null;
 return u-9*3600e3;
}
export type ReceivedParse={ok:true;at:string;precision:'time'|'day'}|{ok:false;code:'received_missing'|'received_invalid'|'received_date_only'};
// 저장은 UTC ISO. 날짜만 있는 값은 박람회·설명회만 받고 그 날 KST 00:00(정밀도 day)이다. 숫자만 이어 쓴 시각은 형식이 아니다.
export function parseReceivedAt(raw:unknown,channel:unknown):ReceivedParse{
 try{
  const v=typeof raw==='string'?raw.trim():'';
  if(!v)return {ok:false,code:'received_missing'};
  if(isInstant(v))return {ok:true,at:iso(parseInstant(v)),precision:'time'};
  const m=LOCAL_RE.exec(v);
  if(m){
   const hour=Number(m[5]),ap=m[4];
   let h=hour;
   // 오전·오후가 있으면 시는 1~12다. 오전 12시는 0시, 오후 12시는 12시, 오후 1~11시는 +12.
   if(ap){if(hour<1||hour>12)return {ok:false,code:'received_invalid'};h=ap==='오전'?hour%12:hour%12+12}
   const t=kstMs(Number(m[1]),Number(m[2]),Number(m[3]),h,Number(m[6]),m[7]===undefined?0:Number(m[7]));
   return t===null?{ok:false,code:'received_invalid'}:{ok:true,at:iso(t),precision:'time'};
  }
  const d=DATE_ONLY_RE.exec(v);
  if(d){
   const t=kstMs(Number(d[1]),Number(d[2]),Number(d[3]),0,0,0);
   if(t===null)return {ok:false,code:'received_invalid'};
   return includes(EVENT_CHANNELS,channel)?{ok:true,at:iso(t),precision:'day'}:{ok:false,code:'received_date_only'};
  }
  return {ok:false,code:'received_invalid'};
 }catch{return {ok:false,code:'received_invalid'}}
}
// 지역: 비우면 ''. NFKC·공백 정리 뒤 한글·공백 2~40자, scanText 0건(R4b readRegion 규칙), 첫 토큰이 시·도, 나머지 0~3개 토큰은 2자 이상이고 시·군·구·읍·면·동으로 끝난다. 아니면 null.
export function normalizeRegion(raw:unknown):string|null{
 try{
  if(typeof raw!=='string')return null;
  const v=raw.normalize('NFKC').replace(/\s+/g,' ').trim();
  if(!v)return '';
  if(!/^[가-힣 ]{2,40}$/.test(v)||!piiClean(v))return null;
  const [first,...rest]=v.split(' ');
  if(!SIDO_NAMES.includes(first)||rest.length>3)return null;
  return rest.every(t=>t.length>=2&&/[시군구읍면동]$/.test(t))?v:null;
 }catch{return null}
}
const bandKey=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'');
// 키나 한국어 라벨과 정확히 같으면(NFKC·공백 제거) 그 값, 비우면 unknown(경고 없음), 그 밖은 unknown과 경고(값은 돌려주지 않는다).
function bandOf(raw:string,labels:Readonly<Record<string,string>>):{value:string;unmapped:boolean}{
 const v=bandKey(raw);
 if(!v)return {value:'unknown',unmapped:false};
 const hit=Object.keys(labels).find(k=>bandKey(k)===v||bandKey(labels[k])===v);
 return hit?{value:hit,unmapped:false}:{value:'unknown',unmapped:true};
}

// ── 매핑·제공 증빙 ──
// 매핑은 {대상: 열 번호(0부터)}. 키는 Object.keys로만 돌고 대상 목록과 Object.hasOwn으로 대조한다. 결과는 원형 없는 객체다.
function mappingOf(raw:unknown,headerCount:number):Partial<Record<LeadImportTarget,number>>|ErrorCode[]{
 if(!isRecord(raw))return ['mapping_invalid'];
 const codes=new Set<ErrorCode>(),used=new Set<number>(),out:Partial<Record<LeadImportTarget,number>>=Object.create(null);
 for(const k of Object.keys(raw)){
  if(FORBIDDEN_TARGETS.includes(k)){codes.add('mapping_forbidden');continue}
  if(!Object.hasOwn(LEAD_IMPORT_TARGETS,k)){codes.add('mapping_invalid');continue}
  const i=get(raw,k);
  if(typeof i!=='number'||!Number.isSafeInteger(i)||i<0||i>=headerCount||used.has(i)){codes.add('mapping_invalid');continue}
  used.add(i);out[k as LeadImportTarget]=i;
 }
 if(out.receivedAt===undefined)codes.add('mapping_invalid');
 return codes.size?[...codes]:out;
}
export type Provenance={provider:string;providedOn:string;period:{from:string;to:string};consentRef:{sha256:string;storageLabel:string}|null};
// provider·providedOn·period는 모든 가져오기에 필수(기간 겹침 규칙의 키). consentRef는 포털·박람회에 필수이고 다른 채널은 선택(주면 같은 검사).
// 동의 증빙 해시는 CSV 칸이 아니라 요청 칸이라 scanText를 돌리지 않고 형식만 본다. 보관 위치는 등록한 라벨 목록 안이어야 한다(목록이 비면 storage_labels_unset).
function provenanceOf(raw:unknown,channel:unknown,today:string,storageLabels:readonly string[]):{value:Provenance;providerKey:string}|ErrorCode[]{
 if(!isRecord(raw))return ['provenance_required'];
 const codes:ErrorCode[]=[];
 if(!keysOk(raw,['provider','providedOn','period','consentRef']))codes.push('provenance_invalid');
 const provider=get(raw,'provider'),providedOn=get(raw,'providedOn'),period=get(raw,'period'),consent=get(raw,'consentRef');
 if(absent(provider)||absent(providedOn)||absent(period))codes.push('provenance_required');
 let label:string|null=null,on:string|null=null,span:{from:string;to:string}|null=null,consentRef:Provenance['consentRef']=null;
 if(!absent(provider)){label=textOf(provider,60);if(label===null)codes.push('provenance_invalid');else if(!piiClean(label)){codes.push('provider_pii');label=null}}
 if(!absent(providedOn)){if(isDate(providedOn)&&providedOn<=today)on=providedOn;else codes.push('provenance_invalid')}
 if(!absent(period)){
  const from=isRecord(period)?get(period,'from'):undefined,to=isRecord(period)?get(period,'to'):undefined,limit=on??today;
  if(!isRecord(period)||!keysOk(period,['from','to'])||!isDate(from)||!isDate(to)||from>to||to>limit||spanDays(from,to)>LEAD_IMPORT_LIMITS.maxPeriodDays||from<addDays(today,1-LEAD_IMPORT_LIMITS.maxAgeDays))codes.push('period_invalid');
  else span={from,to};
 }
 if(absent(consent)){if(includes(PROVENANCE_CHANNELS,channel))codes.push('provenance_required')}
 else{
  const sha=isRecord(consent)?get(consent,'sha256'):undefined,where=isRecord(consent)?get(consent,'storageLabel'):undefined;
  if(!isRecord(consent)||!keysOk(consent,['sha256','storageLabel'])||typeof sha!=='string'||!HEX64.test(sha)||typeof where!=='string')codes.push('provenance_invalid');
  else if(!storageLabels.length)codes.push('storage_labels_unset');
  else if(!storageLabels.includes(where))codes.push('provenance_invalid');
  else consentRef={sha256:sha,storageLabel:where};
 }
 if(codes.length||label===null||on===null||span===null)return codes.length?codes:['provenance_invalid'];
 return {value:{provider:label,providedOn:on,period:span,consentRef},providerKey:providerKeyOf(label)};
}

// 연락처 매핑(결정 32): 연락처 대상은 같은 종류의 연락처 머리글 열에만, 이름은 전화·이메일 가운데 하나 이상과 함께 연결한다. 원장 가져오기(requireContact)는 연락처가 필수다.
function contactMappingOk(map:Partial<Record<LeadImportTarget,number>>,headers:readonly string[],required:boolean):boolean{
 if(CONTACT_TARGETS.some(t=>map[t]!==undefined&&contactColumnKind(headers[map[t] as number])!==t))return false;
 const name=map.contactName!==undefined,reach=map.contactPhone!==undefined||map.contactEmail!==undefined;
 return name===reach&&(!required||name);
}
// 매핑하지 않은 연락처 머리글 열: 파일 전체를 거부한다(열 번호만).
function unmappedContactColumns(map:Partial<Record<LeadImportTarget,number>>,headers:readonly string[]):LeadImportError[]{
 const used=new Set(Object.values(map));
 return headers.flatMap((h,i)=>contactColumnKind(h)&&!used.has(i)?[{column:`${i+1}번째 열`}]:[]);
}

// ── 가져오기 수집 근거(명세 2.7.1, R5b-2) ──
// 창업 포털·박람회: 제3자 제공 수령(provided) 또는 위탁 수집(inquiry_response). 어느 쪽이든 동의 증빙 참조가 필수다(제공 증빙 규칙). 점주 추천: 제3자 소개(가맹점주) 또는 문의 응대.
// 그 밖 채널: 문의 응대만. 동의(consent)는 받지 않는다(COLLECTIVE가 보지 않은 안내 사실을 기록하지 않는다). 열린 질문 14가 풀릴 때까지 관리자가 가져오기마다 선언한다.
export type ImportBasis={type:'provided'}|{type:'inquiry_response'}|{type:'referral';referralFrom:'franchisee'};
export const IMPORT_BASIS_BY_CHANNEL:Readonly<Record<string,readonly string[]>>=deepFreeze({portal:['provided','inquiry_response'],expo:['provided','inquiry_response'],owner_referral:['referral','inquiry_response']});
export function importBasisDecision(channel:unknown,raw:unknown):{ok:true;basis:ImportBasis}|{ok:false}{
 try{
  if(!isRecruitmentChannel(channel)||!isRecord(raw)||!keysOk(raw,['type','referralFrom']))return {ok:false};
  const type=get(raw,'type'),from=get(raw,'referralFrom'),allowed=Object.hasOwn(IMPORT_BASIS_BY_CHANNEL,channel)?IMPORT_BASIS_BY_CHANNEL[channel]:['inquiry_response'];
  if(typeof type!=='string'||!allowed.includes(type))return {ok:false};
  if(type==='referral')return absent(from)||from==='franchisee'?{ok:true,basis:{type:'referral',referralFrom:'franchisee'}}:{ok:false};
  if(!absent(from))return {ok:false};
  return {ok:true,basis:{type} as ImportBasis};
 }catch{return {ok:false}}
}

// ── 계획 해시 ──
// 키 정렬한 정본 JSON. undefined 키는 빼고, 배열 순서는 지킨다.
function canonical(v:unknown,depth=0):string{
 if(depth>32)throw new Error('depth');
 if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number')return JSON.stringify(v)??'null';
 if(Array.isArray(v))return '['+Array.from(v as unknown[]).map(x=>canonical(x===undefined?null:x,depth+1)).join(',')+']';
 if(typeof v==='object'){const o=v as Record<string,unknown>;return '{'+Object.keys(o).sort(ascii).filter(k=>o[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(o[k],depth+1)).join(',')+'}'}
 return 'null';
}
// contact·merge는 연락처를 매핑했을 때만 있다(연락처 없는 파일의 행·계획 해시는 R5a와 같다). merge: create(새 리드), in_file(같은 파일의 앞 행과 같은 사람), existing(연락처 중복 키가 기존 리드와 겹침).
export type LeadRowContact={name:string;phone:string|null;email:string|null};
export type LeadRowMerge={type:'create'}|{type:'in_file';line:number}|{type:'existing';leadId:string};
export type NormalizedLeadRow={line:number;receivedAt:string;receivedPrecision:'time'|'day';region:string;budgetBand:string;timingBand:string;codes:string[];contact?:LeadRowContact;merge?:LeadRowMerge};
export type PlanHashInput={brandId:string;channel:string;mapping:Partial<Record<LeadImportTarget,number>>;provenance:Provenance;providerKey:string;eventId:string|null;dropInFileDuplicates:boolean;transcodedFrom:string|null;bind:unknown;today:string;fileSha256:string;rows:readonly NormalizedLeadRow[];basis?:ImportBasis};
// 계획 해시: 브랜드·채널·매핑·제공 증빙(정규화 값과 providerKey)·행사·파일 안 중복 선택·변환 표시·서버 판정 값(bind)·오늘·두 규칙 판·파일 해시·정규화 행(접수 시각 순, 동률은 줄 번호 순).
export async function leadImportPlanSha256(p:PlanHashInput):Promise<string>{
 try{
  if(!isRecord(p))return '';
  const body=canonical({...p,ruleVersion:RECRUITMENT_VERSION,importVersion:LEAD_IMPORT_VERSION});
  return await sha256Hex(new TextEncoder().encode(body));
 }catch{return ''}
}

// ── 연락처 병합 ──
// 행마다 merge를 채운다(rows를 고친다). 전화는 정규화한 숫자, 이메일은 소문자로 대조한다. 기존 리드 대조(existing)는 이 파일의 대표 행(create)만 가리킬 수 있다.
// existing이 형식에 맞지 않거나(배열·행 번호·리드 id) 대표 행이 아닌 행을 가리키면 null(호출자가 invalid_input).
function mergeRows(rows:NormalizedLeadRow[],existing:unknown):true|null{
 const owner=new Map<string,number>();
 for(const r of rows){
  if(!r.contact)return null;
  const keys=[r.contact.phone?'p:'+r.contact.phone:'',r.contact.email?'e:'+r.contact.email:''].filter(Boolean);
  const hit=keys.map(k=>owner.get(k)).find(x=>x!==undefined);
  r.merge=hit===undefined?{type:'create'}:{type:'in_file',line:hit};
  for(const k of keys)if(!owner.has(k))owner.set(k,hit??r.line);
 }
 if(absent(existing))return true;
 if(!Array.isArray(existing))return null;
 const target=new Map<number,string>(),primary=new Set(rows.filter(r=>r.merge?.type==='create').map(r=>r.line));
 for(const m of Array.from(existing as unknown[])){
  const line=isRecord(m)?m.line:undefined,leadId=isRecord(m)?m.leadId:undefined;
  if(!isRecord(m)||!keysOk(m,['line','leadId'])||typeof line!=='number'||!primary.has(line)||target.has(line)||!validId(leadId))return null;
  target.set(line,leadId);
 }
 const claimed=new Map<string,number>();
 for(const r of rows){
  const leadId=r.merge?.type==='create'?target.get(r.line):undefined;
  if(leadId===undefined)continue;
  const first=claimed.get(leadId);
  if(first!==undefined)r.merge={type:'in_file',line:first};else{r.merge={type:'existing',leadId};claimed.set(leadId,r.line)}
 }
 return true;
}

// ── 판정 ──
// requireContact: 원장 가져오기(결정 32 B안)는 연락처 매핑과 수집 근거가 필수다(서버가 true로 넘긴다). mergeExisting: 서버가 HMAC 중복 키로 찾은 기존 리드(행 번호 → 리드 id).
export type ExistingMatch={line:number;leadId:string};
export type LeadImportContext={enabled:boolean;brandId:string;branch:string|null;actor:RecruitmentActor;now:string;today:string;storageLabels:readonly string[];coveredPeriods:readonly {from:string;to:string}[];event:EventLite|null;fileExists:boolean;book:CodeBook;bind:unknown;requireContact?:boolean;mergeExisting?:readonly ExistingMatch[]};
// rows: 파일의 데이터 행 수(= toCreate + skipped 합). normalizedRows: 만들 행의 정규화 목록(서버 전용, R5b-2는 응답에서 뺀다, 명세 2.6.6).
export type LeadImportPlan={fileSha256:string;hadBom:boolean;planSha256:string;rows:number;normalizedRows:NormalizedLeadRow[];toCreate:number;skipped:{overlap:number;duplicateInFile:number};
 warnings:{budgetUnmapped:number;timingUnmapped:number;droppedTokens:number;truncatedTokens:number;possibleDuplicateInFile:number;expiringWithin14d:number;periodIncludesExportDay:boolean};
 receivedRange:{from:string;to:string}|null;mapping:Partial<Record<LeadImportTarget,number>>;provenance:Provenance;providerKey:string;eventId:string|null;channel:RecruitmentChannel;dropInFileDuplicates:boolean;transcodedFrom:string|null;
 basis:ImportBasis|null;merged:{existing:{count:number;rows:number[]};inFile:{count:number;rows:number[]}};providerLeadCount:number;
 attribution:{code:Record<string,number>;unattributed:Record<string,number>;conflict:number;fileBasis:Record<string,number>};headers:string[];ruleVersion:string;importVersion:string;note:string};
const DECISION_KEYS=['csvBase64','transcodedFrom','channel','mapping','provenance','eventId','dropInFileDuplicates','confirm','expected','basis'];
const periodOk=(p:unknown):p is {from:string;to:string}=>isRecord(p)&&isDate(p.from)&&isDate(p.to);
function contextOk(c:Record<string,unknown>):boolean{
 return typeof c.brandId==='string'&&!!c.brandId&&isInstant(c.now)&&isDate(c.today)&&Array.isArray(c.storageLabels)&&Array.from(c.storageLabels as unknown[]).every(x=>typeof x==='string')
  &&Array.isArray(c.coveredPeriods)&&Array.from(c.coveredPeriods as unknown[]).every(periodOk)&&typeof c.fileExists==='boolean'&&isRecord(c.book);
}
// 단계: 스위치(409) → 역할(403) → 분기(409, A만) → 파일(400) → 머리글(400) → 칸 값(400) → 입력(400: 채널·매핑·제공 증빙·기간·보관 위치·행사 브랜드·확정 표시) → 행(400) →
// 상태(409: 행사 취소, 같은 파일, 새 행 없음, 확인 값 불일치). 미리보기와 확정이 같은 판정을 쓰고, 확정은 미리보기의 planSha256·toCreate와 같아야 한다.
export async function leadImportDecision(input:unknown,ctx:LeadImportContext):Promise<LeadDecision<LeadImportPlan>>{
 return guardedAsync(async()=>{
  const c=ctxOf(ctx);
  if(c.enabled!==true)return fail(['switch_off']);
  if(!adminActor(c.actor))return fail(['role_forbidden']);
  if(c.branch!=='A')return fail(['branch_not_a']);
  if(!contextOk(c)||!isRecord(input))return fail(['invalid_input']);
  const brandId=c.brandId as string,today=c.today as string,nowMs=parseInstant(c.now);
  const bytes=bytesOf(get(input,'csvBase64'));
  if(isFailure(bytes))return bytes;
  const file=await fileStage(bytes);
  if(isFailure(file))return file;
  // 입력
  const bad:ErrorCode[]=[],state:ErrorCode[]=[];
  if(!keysOk(input,DECISION_KEYS))bad.push('invalid_input');
  const channel=get(input,'channel');
  if(!isRecruitmentChannel(channel))bad.push('channel_unknown');
  const mapping=mappingOf(get(input,'mapping'),file.headers.length);
  if(Array.isArray(mapping))bad.push(...mapping);
  const prov=provenanceOf(get(input,'provenance'),channel,today,c.storageLabels as string[]);
  if(Array.isArray(prov))bad.push(...prov);
  const ev=get(input,'eventId');let eventId:string|null=null;
  if(!absent(ev)){
   const event=c.event;
   if(!includes(EVENT_CHANNELS,channel))bad.push('event_channel_mismatch');
   else if(!validId(ev)||!isRecord(event)||event.id!==ev||event.brandId!==brandId)bad.push('event_other_brand');
   else{eventId=ev;if(event.status==='cancelled')state.push('event_cancelled')}
  }
  const dropRaw=get(input,'dropInFileDuplicates');
  if(!absent(dropRaw)&&typeof dropRaw!=='boolean')bad.push('invalid_input');
  const drop=dropRaw===true;
  const transcodedFrom=transcodedOf(get(input,'transcodedFrom'));
  if(transcodedFrom===false)bad.push('invalid_input');
  const confirm=get(input,'confirm'),expected=get(input,'expected');let want:{planSha256:string;toCreate:number}|null=null;
  if(!absent(confirm)&&confirm!==true)bad.push('invalid_input');
  else if(confirm===true||!absent(expected)){
   const ps=isRecord(expected)?get(expected,'planSha256'):undefined,tc=isRecord(expected)?get(expected,'toCreate'):undefined;
   if(confirm!==true||!isRecord(expected)||!keysOk(expected,['planSha256','toCreate'])||typeof ps!=='string'||!HEX64.test(ps)||!countInt(tc))bad.push('confirm_required');
   else want={planSha256:ps,toCreate:tc};
  }
  // 연락처 매핑(결정 32)과 수집 근거(명세 2.7.1). 원장 가져오기는 둘 다 필수다.
  const required=c.requireContact===true;
  if(!Array.isArray(mapping)&&!contactMappingOk(mapping,file.headers,required))bad.push('contact_mapping_invalid');
  const basisRaw=get(input,'basis');let basis:ImportBasis|null=null;
  if(required||!absent(basisRaw)){
   const b=importBasisDecision(channel,basisRaw);
   if(b.ok)basis=b.basis;else if(isRecruitmentChannel(channel))bad.push('basis_invalid');
  }
  if(bad.length)return fail(bad);
  const ch=channel as RecruitmentChannel,map=mapping as Partial<Record<LeadImportTarget,number>>,{value:provenance,providerKey}=prov as {value:Provenance;providerKey:string},transcoded=transcodedFrom as string|null;
  // 매핑하지 않은 연락처 머리글 열이 있으면 파일 전체를 거부한다(매핑하지 않은 열의 개인정보, 결정 32).
  const unmapped=unmappedContactColumns(map,file.headers);
  if(unmapped.length)return fail(['sensitive_column_in_file'],{errors:unmapped.slice(0,LEAD_IMPORT_LIMITS.maxErrors)});
  const withContact=map.contactName!==undefined;
  // 행
  const L=LEAD_IMPORT_LIMITS,oldest=addDays(today,-L.maxAgeDays),expiringBy=addDays(today,L.expiringWarnDays);
  const errors:LeadImportError[]=[],normalized:(NormalizedLeadRow&{kstDay:string;dropped:number;truncated:boolean;budgetUnmapped:boolean;timingUnmapped:boolean})[]=[];
  const cellOf=(cells:readonly string[],t:LeadImportTarget)=>map[t]===undefined?'':cells[map[t] as number]??'';
  const columnOf=(t:LeadImportTarget)=>file.headers[map[t] as number];
  // 연락처 칸: 이름은 필수, 전화·이메일은 하나 이상. 정규화는 R4b 수기 등록과 같은 함수다(값은 오류에 싣지 않는다).
  const rowContact=(cells:readonly string[],rowErr:(t:LeadImportTarget,code:LeadRowCode)=>void):LeadRowContact=>{
   const raw=(t:LeadImportTarget)=>cellOf(cells,t).trim(),nameRaw=raw('contactName'),phoneRaw=raw('contactPhone'),emailRaw=raw('contactEmail');
   const name=nameRaw?normalizeName(nameRaw):null,phone=phoneRaw?normalizePhone(phoneRaw):null,email=emailRaw?normalizeEmail(emailRaw):null;
   if(!nameRaw)rowErr('contactName','contact_missing');else if(!name)rowErr('contactName','contact_name_invalid');
   if(phoneRaw&&!phone)rowErr('contactPhone','contact_phone_invalid');
   if(emailRaw&&!email)rowErr('contactEmail','contact_email_invalid');
   if(!phoneRaw&&!emailRaw)rowErr(map.contactPhone!==undefined?'contactPhone':'contactEmail','contact_missing');
   return {name:name??'',phone,email};
  };
  file.rows.forEach((cells,r)=>{
   const line=file.lines[r],rowErr=(t:LeadImportTarget,code:LeadRowCode)=>errors.push({row:line,column:columnOf(t),code});
   const rec=parseReceivedAt(cellOf(cells,'receivedAt'),ch);
   let kstDay='';
   if(!rec.ok)rowErr('receivedAt',rec.code);
   else{
    kstDay=toKstDate(rec.at);
    if(parseInstant(rec.at)>nowMs+L.futureToleranceMs)rowErr('receivedAt','received_future');
    if(kstDay<=oldest)rowErr('receivedAt','received_too_old');
    if(kstDay>provenance.providedOn)rowErr('receivedAt','received_after_provided');
    if(kstDay<provenance.period.from||kstDay>provenance.period.to)rowErr('receivedAt','received_outside_period');
   }
   const region=map.region===undefined?'':normalizeRegion(cellOf(cells,'region'));
   if(region===null)rowErr('region','region_invalid');
   const budget=bandOf(cellOf(cells,'budgetBand'),BUDGET_LABELS),timing=bandOf(cellOf(cells,'timingBand'),TIMING_LABELS);
   // 코드 열 먼저, 유입 주소 다음(칸 안 위치 순서), 최대 5개.
   const tokens=recruitmentTokens(cellOf(cells,'codes')+'\n'+cellOf(cells,'landingUrl'));
   const contact=withContact?rowContact(cells,rowErr):undefined;
   if(rec.ok)normalized.push({line,receivedAt:rec.at,receivedPrecision:rec.precision,region:region??'',budgetBand:budget.value,timingBand:timing.value,codes:tokens.codes,...(contact?{contact}:{}),
    kstDay,dropped:tokens.dropped,truncated:tokens.truncated,budgetUnmapped:budget.unmapped,timingUnmapped:timing.unmapped});
  });
  if(errors.length)return fail(['row_invalid'],{errors:errors.slice(0,L.maxErrors)});
  // 건너뜀: 같은 브랜드·같은 제공처 키의 이전 가져오기가 선언한 기간들의 합집합 안에 KST 접수일이 드는 행(overlap). 파일 안 중복은 선택했을 때만 뒤 행을 건너뛴다.
  const covered=Array.from(c.coveredPeriods as {from:string;to:string}[]),seen=new Set<string>();
  let overlap=0,duplicateInFile=0,possibleDuplicateInFile=0;
  const created:typeof normalized=[];
  for(const row of normalized){
   if(covered.some(p=>p.from<=row.kstDay&&row.kstDay<=p.to)){overlap++;continue}
   const key=JSON.stringify([row.receivedAt,row.receivedPrecision,row.region,row.budgetBand,row.timingBand,row.codes]);
   if(seen.has(key)){if(drop){duplicateInFile++;continue}possibleDuplicateInFile++}
   seen.add(key);created.push(row);
  }
  const rows:NormalizedLeadRow[]=created.map(r=>({line:r.line,receivedAt:r.receivedAt,receivedPrecision:r.receivedPrecision,region:r.region,budgetBand:r.budgetBand,timingBand:r.timingBand,codes:r.codes,...(r.contact?{contact:r.contact}:{})}));
  // 연락처 병합(대표 결정 2026-09-27 '리드 1건, 집계는 파일별'): 같은 파일의 앞 행과 전화·이메일이 같으면 그 행의 사람이고(in_file),
  // 서버가 중복 키로 찾은 기존 리드와 겹치면 새 리드를 만들지 않는다(existing). 같은 기존 리드를 가리키는 두 번째 행은 같은 사람이라 in_file이다.
  if(withContact&&!mergeRows(rows,c.mergeExisting))return fail(['invalid_input']);
  const creates=rows.filter(r=>!r.merge||r.merge.type==='create');
  const hashRows=[...rows].sort((a,b)=>ascii(a.receivedAt,b.receivedAt)||a.line-b.line);
  const planSha256=await leadImportPlanSha256({brandId,channel:ch,mapping:map,provenance,providerKey,eventId,dropInFileDuplicates:drop,transcodedFrom:transcoded,bind:c.bind??null,today,fileSha256:file.fileSha256,rows:hashRows,...(basis?{basis}:{})});
  // 상태
  if(c.fileExists!==false)state.push('file_duplicate');
  if(!rows.length)state.push('no_new_rows');
  if(want&&(want.planSha256!==planSha256||want.toCreate!==creates.length))state.push('expected_mismatch');
  if(state.length)return fail(state);
  const warnings={budgetUnmapped:created.filter(r=>r.budgetUnmapped).length,timingUnmapped:created.filter(r=>r.timingUnmapped).length,droppedTokens:created.reduce((a,r)=>a+r.dropped,0),truncatedTokens:created.filter(r=>r.truncated).length,
   possibleDuplicateInFile,expiringWithin14d:created.filter(r=>addDays(r.kstDay,L.maxAgeDays)<=expiringBy).length,periodIncludesExportDay:provenance.period.to===provenance.providedOn};
  const warningCodes=[warnings.budgetUnmapped?'budget_unmapped':'',warnings.timingUnmapped?'timing_unmapped':'',warnings.droppedTokens?'dropped_tokens':'',warnings.truncatedTokens?'truncated_tokens':'',
   warnings.possibleDuplicateInFile?'possible_duplicate_in_file':'',warnings.expiringWithin14d?'expiring_within_14d':'',warnings.periodIncludesExportDay?'period_includes_export_day':''].filter(Boolean);
  // 코드 귀속 요약(명세 2.4, 새로 만들 리드만). 가져온 파일의 토큰은 가져오기 시각의 'import' 토큰이라 늦은 입력이 아니다.
  // 코드로 귀속되지 않은 행(충돌 제외)은 제공처 파일 기준(명세 2.7.3, Q-R5-2 권고안)으로 이 가져오기의 채널에 따로 센다.
  const attribution={code:Object.create(null) as Record<string,number>,unattributed:Object.create(null) as Record<string,number>,conflict:0,fileBasis:Object.create(null) as Record<string,number>},at=iso(nowMs);
  for(const r of creates){
   const a=attributeLead({brandId,receivedAt:r.receivedAt,codes:r.codes.map(code=>({code,at,source:'import' as const})),strikes:[]},c.book as CodeBook);
   if(a.state==='attributed')attribution.code[a.channel]=(attribution.code[a.channel]??0)+1;
   else if(a.state==='conflict')attribution.conflict++;
   else{attribution.unattributed[a.reason]=(attribution.unattributed[a.reason]??0)+1;attribution.fileBasis[ch]=(attribution.fileBasis[ch]??0)+1}
  }
  const linesOf=(type:LeadRowMerge['type'])=>rows.filter(r=>r.merge?.type===type).map(r=>r.line);
  const existingLines=linesOf('existing'),inFileLines=linesOf('in_file');
  const times=rows.map(r=>r.receivedAt).sort(ascii);
  return pass({fileSha256:file.fileSha256,hadBom:file.hadBom,planSha256,rows:file.rows.length,normalizedRows:rows,toCreate:creates.length,skipped:{overlap,duplicateInFile},warnings,
   receivedRange:times.length?{from:times[0],to:times[times.length-1]}:null,mapping:map,provenance,providerKey,eventId,channel:ch,dropInFileDuplicates:drop,transcodedFrom:transcoded,
   basis,merged:{existing:{count:existingLines.length,rows:existingLines},inFile:{count:inFileLines.length,rows:inFileLines}},providerLeadCount:creates.length+existingLines.length,
   attribution,headers:file.headers,ruleVersion:RECRUITMENT_VERSION,importVersion:LEAD_IMPORT_VERSION,note:RECRUITMENT_ATTRIBUTION_NOTE},warningCodes);
 });
}
