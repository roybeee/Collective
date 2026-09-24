import {practices,channelSkills,defaultChannelSkill,viralPractice,type RoleSkill} from './practice';
import {factDiscipline,claimPolicy,copyCompliancePolicy,answerDiscipline,measurementDiscipline,directivePolicy} from './campaign-policy';
import {brandDefaults} from './agency';

// 프롬프트 레지스트리(F3a) 단위 목록과 본문 검사. 순수 모듈(상대 import만): 등록 API(lib/prompt-registry.ts)와 CI 검사(scripts/check-prompts.mjs)가 같은 규칙을 쓴다.
// 대표 결정 3(2026-09-24): 레지스트리로 바꿀 수 있는 것은 역할 스킬(초점·방법·산출물·검토·인계 문구), 채널·업종 스킬, 바이럴 발견 지시뿐이다.
// 근거 규율·사실 정책·출력 계약 섹션·외부 행동 금지·JSON 계약 지시는 코드 소유라 그 문구를 담은 본문은 거부한다. prompts/에는 브랜드를 식별할 수 없는 일반 스킬만 둔다.
export type PromptUnitKind='role'|'channel'|'viral';
export type PromptUnit={unit:string;kind:PromptUnitKind;key:string};
export type UnitBody=RoleSkill|string;
export type PromptUnitFile={schema:1;unit:string;body:UnitBody};
export const PROMPT_UNIT_MAX_CHARS=6000;
export const PROMPT_FILE_MAX_BYTES=32000;
export const promptUnits:readonly PromptUnit[]=[
 ...Object.keys(practices).map(key=>({unit:'role.'+key,kind:'role' as const,key})),
 ...channelSkills.map(s=>({unit:'channel.'+s.id,kind:'channel' as const,key:s.id})),
 {unit:'channel.default',kind:'channel',key:'default'},
 {unit:'viral.discovery',kind:'viral',key:'discovery'},
];
export const unitOf=(unit:unknown)=>promptUnits.find(u=>u.unit===unit);
export const unitFile=(unit:string)=>`${unit}.json`;
// 버전 id이자 레지스트리 promptVersion: <단위>@<본문 sha256 앞 12자>. 한 실행이 여러 레지스트리 단위를 쓰면 '+'로 잇는다.
export const unitVersionId=(unit:string,sha256:string)=>`${unit}@${sha256.slice(0,12)}`;
export const versionUnit=(id:string)=>id.slice(0,id.lastIndexOf('@'));

export type PromptUnitErrorReason='schema'|'hidden'|'length'|'code_owned'|'injection'|'url'|'brand'|'price';
export class PromptUnitError extends Error{constructor(public reason:PromptUnitErrorReason,message:string){super(message)}}
const fail=(reason:PromptUnitErrorReason,message:string):never=>{throw new PromptUnitError(reason,message)};

// 코드 상수(폴백)에서 만든 단위 본문. prompts/의 정본 파일과 비교하는 기준이다.
export function codeUnitBody(unit:string):UnitBody{
 const u=unitOf(unit)??fail('schema',`알 수 없는 프롬프트 단위입니다: ${unit}`);
 if(u.kind==='role'){const p=practices[u.key];return {focus:p.focus,methods:[...p.methods],outputs:[...p.outputs],review:[...p.review],handoff:p.handoff}}
 if(u.kind==='viral')return viralPractice;
 return u.key==='default'?defaultChannelSkill:channelSkills.find(s=>s.id===u.key)!.body;
}
// 리뷰 화면에 보이지 않는 문자는 받지 않는다: 줄바꿈·제어(Cc), 형식(Cf: 너비 없는 공백·양방향 제어·Unicode Tags), 사용자 정의 영역(Co), 미할당(Cn), 줄·문단 구분(Zl·Zp),
// 이체 선택자(데이터 밀반입에 쓰는 U+FE00대·U+E0100대), 결합 자소 접합자, 한글 채움 문자. NFC가 아닌 본문도 거부한다. 정본 16개 파일에는 이런 문자가 없다.
const hiddenChars=/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u034F\u115F\u1160\u180B-\u180F\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/u;
function text(value:unknown,label:string,max:number):string{
 if(typeof value!=='string'||!value.trim()||value.length>max||value!==value.trim())return fail('schema',`${label}은(는) 앞뒤 공백 없는 ${max}자 이하 문자열이어야 합니다.`);
 if(hiddenChars.test(value)||value!==value.normalize('NFC'))return fail('hidden',`${label}에 줄바꿈·제어 문자나 보이지 않는 문자(너비 없는 공백·양방향 제어·Unicode Tags·이체 선택자·사용자 정의 영역)가 있거나 NFC 정규형이 아닙니다.`);
 return value;
}
function list(value:unknown,label:string,min:number,max:number){
 if(!Array.isArray(value)||value.length<min||value.length>max)return fail('schema',`${label}은(는) ${min}~${max}개 문자열 목록이어야 합니다.`);
 return value.map((x,i)=>text(x,`${label} ${i+1}`,1500));
}
// 역할 스킬 산출물 수는 출력 계약 섹션 수(코드 소유, lib/role-output.ts)와 같아야 한다. 계약 섹션 제목은 코드 상수를 그대로 쓴다.
function roleBody(key:string,value:unknown):RoleSkill{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('schema','역할 스킬 본문은 객체여야 합니다.');
 const b=value as Record<string,unknown>,extra=Object.keys(b).filter(k=>!['focus','methods','outputs','review','handoff'].includes(k));
 if(extra.length)fail('code_owned',`역할 스킬 본문에는 초점·방법·산출물·검토·인계만 둡니다(코드 소유 또는 알 수 없는 항목: ${extra.join(', ')}).`);
 const outputs=list(b.outputs,'산출물',1,12);
 if(outputs.length!==practices[key].outputs.length)fail('code_owned',`산출물 수는 출력 계약 섹션 수(${practices[key].outputs.length})와 같아야 합니다.`);
 return {focus:text(b.focus,'초점',300),methods:list(b.methods,'방법',1,8),outputs,review:list(b.review,'검토',1,8),handoff:text(b.handoff,'인계',1500)};
}
// 정규화한 본문(항목 순서 고정, 새 객체). sha256과 main 비교는 이 값의 JSON으로 한다.
export function canonicalBody(unit:string,value:unknown):UnitBody{
 const u=unitOf(unit)??fail('schema',`알 수 없는 프롬프트 단위입니다: ${unit}`);
 // 형식 검사의 길이 한도는 파일 한도다. 단위당 6,000자 상한은 validateUnitBody가 length 사유로 따로 본다.
 return u.kind==='role'?roleBody(u.key,value):text(value,'본문',PROMPT_FILE_MAX_BYTES);
}
export const canonicalJson=(unit:string,value:unknown)=>JSON.stringify(canonicalBody(unit,value));
export const bodyText=(body:UnitBody)=>typeof body==='string'?body:[body.focus,...body.methods,...body.outputs,...body.review,body.handoff].join('\n');
// 파일 형식: {"schema":1,"unit":"role.cmo","body":...}. expectedUnit이 있으면 파일의 unit이 같아야 한다.
export function parseUnitFile(value:unknown,expectedUnit?:string):{unit:string;body:UnitBody}{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('schema','프롬프트 파일은 JSON 객체여야 합니다.');
 const f=value as Record<string,unknown>,extra=Object.keys(f).filter(k=>!['schema','unit','body'].includes(k));
 if(f.schema!==1||extra.length)fail('schema','프롬프트 파일은 schema 1과 unit·body만 가집니다.');
 const u=unitOf(f.unit)??fail('schema',`알 수 없는 프롬프트 단위입니다: ${String(f.unit).slice(0,80)}`);
 if(expectedUnit&&u.unit!==expectedUnit)fail('schema',`파일의 단위(${u.unit})가 요청한 단위(${expectedUnit})와 다릅니다.`);
 return {unit:u.unit,body:canonicalBody(u.unit,f.body)};
}

// 대조용 정규화(검사 전용, 저장 본문은 그대로). folded: NFKC(전각·호환 문자)·마침표 변형 통일·소문자, squash: folded에서 공백을 뺀 사본, letters: 글자·숫자만 남긴 사본.
// 띄어쓰기·전각 문자·구두점 끼우기로 표지를 피하지 못하게 한다. 보이지 않는 문자는 text()가 먼저 거부한다. 이 검사는 보조 수단이고 1차 통제는 main 리뷰와 F3b 평가다.
type Forms={folded:string;squash:string;letters:string};
function formsOf(all:string):Forms{const folded=all.normalize('NFKC').replace(/[\u3002\uFF61\uFE12]/g,'.').toLowerCase();return {folded,squash:folded.replace(/\s+/g,''),letters:folded.replace(/[^\p{L}\p{N}]+/gu,'')}}
type Rule={form:keyof Forms;pattern:RegExp};
const on=(form:keyof Forms,...patterns:RegExp[]):Rule[]=>patterns.map(pattern=>({form,pattern}));
const matched=(rules:readonly Rule[],f:Forms)=>rules.find(r=>r.pattern.test(f[r.form]));
// 코드 소유 섹션의 표지: 근거 규율·광고 표현·추천·광고 표시·측정·상시 지시 정책 문장의 머리, 역할 스킬 머리말·제목, 입력 필드명, JSON 계약, 외부 행동 금지, 사실 정책을 뒤집는 문구.
const lead=(s:string)=>s.slice(0,24);
const squashed=(s:string)=>formsOf(s).squash;
const codeOwnedPhrases=[lead(factDiscipline),lead(claimPolicy),lead(copyCompliancePolicy),lead(answerDiscipline),lead(measurementDiscipline),lead(directivePolicy),'근거 규칙','광고 표현 규칙','추천·광고 표시 규칙','측정 정의:','실무 스킬','필수 산출물','완료 전 점검','인계:'].map(squashed);
const codeOwnedRules=[
 ...on('squash',/evidence\.(?:facts|directives)|facts\.(?:confirmed|candidate|prohibited)|contractversion|outputcontract|contexttruncated|idlabels|claimguard|respondsto|revisionrequest|previousdecisions|sourceassessment|brandintro|factpolicy|taskchecks|```|~~~/),
 ...on('folded',/\bsections\b|\boutput_?\d+\b/),
 ...on('letters',/json|제이슨|candidate|confirmed|prohibited/),
 ...on('squash',/외부(?:행동|도구\S{0,3}실행)|(?:메시지|문자|dm|이메일|메일|알림|푸시)\S{0,3}(?:발송|전송|보내)|광고\S{0,3}(?:집행|게재|송출)|(?:직접|바로|즉시|자동으로|대신)(?:집행|발송|전송|게시|결제|송금|업로드|구매|주문|제출)|결제\S{0,3}(?:진행|실행|완료|승인)|송금/),
 ...on('squash',/근거\S{0,2}없(?:어도|더라도|이도|는데도)|확정사실(?:로|처럼)/),
];
const injectionRules=[
 ...on('squash',
  /(?:이전|앞서|앞의|앞에서|위의|기존|모든|지금까지의?|상위|원래)(?:의)?(?:모든)?(?:받은)?(?:지시|지침|명령|규칙|프롬프트|설정)\S{0,8}?(?:무시|잊|따르지|지키지|폐기)/,
  /(?:위|앞|이전|상기)(?:의)?내용\S{0,6}?(?:무시|잊|따르지)/,
  /(?:규칙|지시|지침|정책|계약)\S{0,4}보다\S{0,8}우선(?!하지|시하지)/,
  /(?:이제부터|지금부터|앞으로)(?:너|당신|네가)|(?:너|당신)(?:는|은)이제|역할은이제|역할을(?:바꾸|전환|변경)|다른역할(?:로|을)(?:수행|연기|전환)/,
  /시스템(?:프롬프트|지시|메시지|설정|명령)|개발자(?:모드|메시지|지시)|탈옥/),
 ...on('folded',
  /\b(?:ignore|disregard|forget|override|bypass)\b.{0,40}?\b(?:instructions?|prompts?|rules?|messages?|directions?|guidance|guidelines?|above)\b/,
  /\b(?:act as|pretend (?:to be|you are)|role-?play as)\b/,
  /<\/?\s*(?:system|assistant|user|developer)\s*>|\[\s*\/?\s*(?:system|inst)\s*\]|(?:^|\s)#+\s*(?:system|instruction|developer)\b/m),
 ...on('letters',/(?:ignore|disregard|forget|override|bypass)(?:all|any|the|your)*(?:previous|prior|above|earlier|system|developer|preceding)|systemprompt|developer(?:mode|message)|jailbreak|you(?:a)?renow|fromnowonyou|pretendtobe|pretendyouare|roleplayas/),
];
// URL·도메인: 프로토콜(hxxp 변형 포함), www, 일반 도메인(모든 TLD, [.]·(.)·dot 표기), IPv4, //호스트, data: URL, @계정 핸들.
const urlRules=on('folded',
 /\b(?:https?|hxxps?|ftp|file|javascript|vbscript):|\bdata:[a-z]+\/|\bwww\d?\./,
 /\b[a-z0-9][a-z0-9-]*\s*(?:\[\.\]|\(\.\)|\[dot\]|\(dot\))\s*[a-z]{2,}|\b[a-z0-9][a-z0-9-]*\.[a-z]{2,24}\b|\b[a-z0-9][a-z0-9-]*\s+dot\s+[a-z]{2,24}\b/,
 /\b\d{1,3}(?:\.\d{1,3}){3}\b|(?:^|[\s(<"'])\/\/[a-z0-9]/,
 /(?:^|[^\p{L}\p{N}_.])@[\p{L}\p{N}_]{2,}/u);
const pricePatterns=[/[₩￦]/,/\d[\d,.]*\s*(?:만|천|백|억)?\s*원(?!인|문|칙|가|본|래|료|형|리|천|점|활|하|한|숭)/,/\b(?:KRW|USD|EUR|JPY)\b/i,/\$\s?\d|\d\s?(?:달러|엔|위안)/];
// 코드(시드·예시 문구)에 이미 공개된 브랜드 한글 표기. 여기서 새 표기를 처음 쓰지 않는다(tests/check-prompts.test.mjs가 앱 소스에 이미 있는지 확인한다).
export const codeBrandAliases:Readonly<Record<string,readonly string[]>>={ofd:['올드페리도넛','올드페리'],mapdal:['맵달'],alan:['닥터알란']};
// 약칭은 영문 3자 이상, 한글이 들어가면 2자 이상만 식별어로 쓴다(2자 영문 약칭은 우연 일치가 많다). 등록 API의 D1 약칭도 같은 규칙이다.
export const brandShort=(short:unknown)=>typeof short==='string'&&(short.trim().length>=3||/[가-힣]/.test(short)&&short.trim().length>=2)?[short]:[];
// 코드에서 가져온 브랜드 식별어: 시드 브랜드명과 마지막 단어를 뺀 앞부분(세 단어 이상), 약칭, '<한글 표기> / <브랜드명>' 병기, 코드에 공개된 한글 표기. 등록 API는 소유자 D1의 브랜드·지점명을 더한다.
export function brandTermsFromCode():string[]{
 return brandDefaults.flatMap(b=>{
  const paired=[b.description,b.constraints,b.knowledge].flatMap(t=>[...t.matchAll(/([가-힣]+\d*)\s*\/\s*([^\s/]+)/g)].filter(m=>m[2].replace(/[^\w.]/g,'').toLowerCase()===b.name.toLowerCase()).map(m=>m[1]));
  const words=b.name.split(/\s+/),leading=words.length>2?[words.slice(0,-1).join(' ')]:[];
  return [b.name,...leading,...brandShort(b.short),...paired,...(codeBrandAliases[b.id]??[])];
 });
}
// 식별어를 글자·숫자만 남긴 뒤 글자 사이에 구분 문자(글자·숫자 아닌 것)를 허용해 folded 본문에서 찾는다. 공백·하이픈·구두점·전각 변형이 같은 이름으로 잡힌다.
// 영문 4자 이하는 영문·숫자 경계를, 한글 2자는 앞 한글 경계를 둔다(today의 oda, 로드맵 달성의 맵달 같은 우연 일치 방지).
function termSource(term:string){
 const key=formsOf(term).letters;
 if(key.length<2)return null;
 const body=[...key].map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^\\p{L}\\p{N}]*'),ascii=/^[a-z0-9]+$/.test(key);
 return ascii&&key.length<=4?`(?<![a-z0-9])${body}(?![a-z0-9])`:!ascii&&key.length===2?`(?<![가-힣])${body}`:body;
}
export function brandPattern(terms:readonly string[]){
 const sources=[...new Set(terms.map(termSource).filter((s):s is string=>!!s))];
 return sources.length?new RegExp(sources.join('|'),'u'):null;
}
// 정규화한 본문을 검사한다. 통과하지 않으면 PromptUnitError(reason)를 던진다.
export function validateUnitBody(unit:string,body:UnitBody,brandTerms:readonly string[]=brandTermsFromCode()){
 const all=bodyText(canonicalBody(unit,body));
 if(all.length>PROMPT_UNIT_MAX_CHARS)fail('length',`본문이 ${PROMPT_UNIT_MAX_CHARS.toLocaleString('en-US')}자 상한을 넘습니다(${all.length}자).`);
 const f=formsOf(all),owned=codeOwnedPhrases.find(p=>f.squash.includes(p))??matched(codeOwnedRules,f)?.pattern.source;
 if(owned)fail('code_owned',`코드 소유 영역(근거 규율·사실 정책·출력 계약·외부 행동 금지·JSON 계약)의 문구를 담을 수 없습니다: ${owned.slice(0,40)}`);
 if(matched(injectionRules,f))fail('injection','명령형 주입 패턴(이전 지시 무시·상위 규칙 우선·시스템 프롬프트·역할 전환 요구)이 있습니다.');
 if(matched(urlRules,f))fail('url','본문에 URL·도메인·IP 주소·계정 핸들을 넣을 수 없습니다.');
 const brand=brandPattern(brandTerms)?.exec(f.folded);
 if(brand)fail('brand',`브랜드·지점을 식별하는 이름이 있습니다: ${brand[0]}. 브랜드 특화 내용은 D1에만 둡니다.`);
 if(pricePatterns.some(p=>p.test(f.folded)))fail('price','가격 표기(원·₩·통화 코드)가 있습니다.');
 return all.length;
}
