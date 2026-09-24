import {practices,channelSkills,defaultChannelSkill,viralPractice,type RoleSkill} from './practice';
import {factDiscipline,claimPolicy,answerDiscipline,measurementDiscipline,directivePolicy} from './campaign-policy';
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

export type PromptUnitErrorReason='schema'|'length'|'code_owned'|'injection'|'url'|'brand'|'price';
export class PromptUnitError extends Error{constructor(public reason:PromptUnitErrorReason,message:string){super(message)}}
const fail=(reason:PromptUnitErrorReason,message:string):never=>{throw new PromptUnitError(reason,message)};

// 코드 상수(폴백)에서 만든 단위 본문. prompts/의 정본 파일과 비교하는 기준이다.
export function codeUnitBody(unit:string):UnitBody{
 const u=unitOf(unit)??fail('schema',`알 수 없는 프롬프트 단위입니다: ${unit}`);
 if(u.kind==='role'){const p=practices[u.key];return {focus:p.focus,methods:[...p.methods],outputs:[...p.outputs],review:[...p.review],handoff:p.handoff}}
 if(u.kind==='viral')return viralPractice;
 return u.key==='default'?defaultChannelSkill:channelSkills.find(s=>s.id===u.key)!.body;
}
const text=(value:unknown,label:string,max:number)=>typeof value==='string'&&value.trim()&&value.length<=max&&value===value.trim()?value:fail('schema',`${label}은(는) 앞뒤 공백 없는 ${max}자 이하 문자열이어야 합니다.`);
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

// 코드 소유 섹션의 표지. 근거 규율·광고 표현·상시 지시 정책 문장의 머리, 역할 스킬 머리말·제목, 입력 필드명, JSON 계약, 외부 행동 금지.
const lead=(s:string)=>s.slice(0,24);
const codeOwnedPhrases=[lead(factDiscipline),lead(claimPolicy),lead(answerDiscipline),lead(measurementDiscipline),lead(directivePolicy),'근거 규칙:','실무 스킬 ','필수 산출물:','완료 전 점검:','인계:'];
const codeOwnedPatterns=[/\b(?:evidence\.facts|contractVersion|outputContract|respondsTo|allowedRespondsTo|revisionRequest|previousDecisions|sourceAssessment|brandIntro|factPolicy|taskChecks)\b/,/json/i,/```/,/외부\s*(?:행동|도구\s*실행)|메시지\s*발송|광고\s*집행/];
const injectionPatterns=[
 /(?:이전|앞의|위의|기존|모든)\s*(?:의\s*)?(?:모든\s*)?(?:지시|지침|명령|규칙|프롬프트)\S*\s*(?:을|를|은|는)?\s*(?:무시|잊|따르지)/,
 /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)*(?:previous|prior|above|earlier|system|developer)\s+(?:instructions?|prompts?|rules?|messages?)/i,
 /system\s*prompt|시스템\s*(?:프롬프트|지시|메시지)|developer\s*(?:mode|message)|jailbreak/i,
 /\b(?:you are now|from now on,? you|act as|pretend (?:to be|you are)|role-?play as)\b/i,
 /(?:너는|당신은)\s*이제|이제부터\s*(?:너는|당신은)|역할을\s*(?:바꾸|전환|변경)|다른\s*역할(?:로|을)\s*(?:수행|연기|전환)/,
 /<\/?\s*(?:system|assistant|user|developer)\s*>|\[\s*(?:system|inst)\s*\]|#{2,}\s*(?:system|instruction)/i,
];
const urlPattern=/https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|kr|co|me|ly|app|dev|ai)\b/i;
const pricePatterns=[/[₩￦]/,/\d[\d,.]*\s*(?:만|천|백|억)?\s*원(?!인|문|칙|가|본|래|료|형|리|천|점|활|하|한|숭)/,/\b(?:KRW|USD|EUR|JPY)\b/i,/\$\s?\d|\d\s?(?:달러|엔|위안)/];
// 코드에서 가져온 브랜드 식별어: 시드 브랜드명·약칭(3자 이상)과 '<한글 표기> / <브랜드명>' 병기. 등록 API는 소유자 D1의 브랜드·지점명을 더한다.
export function brandTermsFromCode():string[]{
 return brandDefaults.flatMap(b=>{
  const aliases=[b.description,b.constraints,b.knowledge].flatMap(t=>[...t.matchAll(/([가-힣]+\d*)\s*\/\s*([^\s/]+)/g)].filter(m=>m[2].replace(/[^\w.]/g,'').toLowerCase()===b.name.toLowerCase()).map(m=>m[1]));
  return [b.name,...(b.short.length>=3?[b.short]:[]),...aliases];
 });
}
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function brandPattern(terms:readonly string[]){
 const clean=[...new Set(terms.map(t=>t.trim()).filter(t=>t.length>=2))];
 return clean.length?new RegExp(clean.map(t=>/^[\w.]+$/.test(t)?`(?<![\\w.])${escape(t)}(?![\\w])`:escape(t)).join('|'),'i'):null;
}
// 정규화한 본문을 검사한다. 통과하지 않으면 PromptUnitError(reason)를 던진다.
export function validateUnitBody(unit:string,body:UnitBody,brandTerms:readonly string[]=brandTermsFromCode()){
 const all=bodyText(canonicalBody(unit,body));
 if(all.length>PROMPT_UNIT_MAX_CHARS)fail('length',`본문이 ${PROMPT_UNIT_MAX_CHARS.toLocaleString('en-US')}자 상한을 넘습니다(${all.length}자).`);
 const owned=codeOwnedPhrases.find(p=>all.includes(p))??codeOwnedPatterns.find(p=>p.test(all))?.source;
 if(owned)fail('code_owned',`코드 소유 영역(근거 규율·사실 정책·출력 계약·외부 행동 금지·JSON 계약)의 문구를 담을 수 없습니다: ${owned.slice(0,40)}`);
 if(injectionPatterns.some(p=>p.test(all)))fail('injection','명령형 주입 패턴(이전 지시 무시·시스템 프롬프트·역할 전환 요구)이 있습니다.');
 if(urlPattern.test(all))fail('url','본문에 URL이나 도메인을 넣을 수 없습니다.');
 const brand=brandPattern(brandTerms)?.exec(all);
 if(brand)fail('brand',`브랜드·지점을 식별하는 이름이 있습니다: ${brand[0]}. 브랜드 특화 내용은 D1에만 둡니다.`);
 if(pricePatterns.some(p=>p.test(all)))fail('price','가격 표기(원·₩·통화 코드)가 있습니다.');
 return all.length;
}
