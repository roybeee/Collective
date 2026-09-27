// 트랙 R R9a 정보성 너처링 승인형 초안(순수). 가맹 예비창업자에게 사람이 직접 보낼 메시지의 '자리표시 템플릿'과 그 판정만 계산한다.
// 이 모듈이 하는 일: 목적·분류(정보성/광고성)·매체, 자리표시 규칙, 템플릿 검사(개인정보·광고성 고정 요소·R2 판정), 모델 제출 조립(허용 입력만)·출력 읽기, 정보 요청·수동 발송 기록 판정.
// 하지 않는 일: 발송. 앱은 외부 발송 API를 부르지 않는다(tests/franchise-nurture.test.mjs 정적 검사). 사람이 보낸 뒤 '보냈다'는 기록만 남긴다.
// 모델 입력 경계(DP-10): 모델에는 템플릿 목적·분류·매체·브랜드 정체성(이름·업종·소개·말투)·확정 사실 줄만 간다. 리드·이벤트·연락처·가명 코드·시스템 코드는 이 모듈의 제출 조립 입력에 자리가 없다.
// 퍼널 집계는 넣지 않는다(계획은 허용했지만 초안 문구에 쓸 곳이 없어 전송 면을 줄였다). 시계·난수·조회·외부 호출이 없다(now·목록은 인자).
// 분류는 LR-2(Q8) 회신 전 COLLECTIVE 해석이다. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {judgeFranchiseText,type FranchiseJudgement} from './franchise-compliance';
import {scanText} from './pii-scan';
import {GATE_DISCLAIMER} from './franchise-gates';
import {isInstant} from './franchise-rules';
import type {VersionLite} from './franchise-facts';
import type {BrandFact} from './brand-facts';

function deepFreeze<T>(value:T):T{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const k of Object.keys(value))deepFreeze((value as Record<string,unknown>)[k])}
 return value;
}
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const oneOf=<T extends string>(list:readonly T[],v:unknown):v is T=>typeof v==='string'&&(list as readonly string[]).includes(v);

export const NURTURE_VERSION='fr-nurture@2026-09-27.1';
export const CLASSIFICATION_NOTE='COLLECTIVE 해석 · 법률 자문 아님';

// ── 목적·분류·매체 ──
// 분류: '요청받은 1회 정보'(info_requested)는 예비창업자가 요청한 기록(정보 요청)에 1회만 답한다. 설명회 초대·혜택·재상담 유도·소식지는 광고성(advertising)이다.
// 광고성은 R9a에서 템플릿 저장까지만 받고, 광고성 발송 기록은 R9b(매체별 수신 동의, 결정 28·LR-2) 전에는 409다.
export const CLASSIFICATIONS=deepFreeze(['advertising','info_requested'] as const);
export type Classification=typeof CLASSIFICATIONS[number];
export const CLASSIFICATION_LABELS:Readonly<Record<Classification,string>>=deepFreeze({info_requested:'요청받은 1회 정보',advertising:'광고성'});
export const PURPOSES=deepFreeze([
 {key:'requested_material',label:'요청 자료 회신',classification:'info_requested'},
 {key:'disclosure_guide',label:'정보공개서 받는 법 안내',classification:'info_requested'},
 {key:'process_guide',label:'가맹 절차 안내',classification:'info_requested'},
 {key:'briefing_invite',label:'설명회·견학 초대',classification:'advertising'},
 {key:'benefit',label:'창업 혜택 안내',classification:'advertising'},
 {key:'recontact',label:'재상담 제안',classification:'advertising'},
 {key:'newsletter',label:'소식지',classification:'advertising'},
] as const);
export type Purpose=typeof PURPOSES[number]['key'];
export const PURPOSE_KEYS:readonly Purpose[]=deepFreeze(PURPOSES.map(p=>p.key));
export const INFO_PURPOSES:readonly Purpose[]=deepFreeze(PURPOSES.filter(p=>p.classification==='info_requested').map(p=>p.key));
export const classificationOf=(p:Purpose):Classification=>PURPOSES.find(x=>x.key===p)!.classification;
// 알림톡은 정보성 전용이다(광고성 알림톡 템플릿은 저장도 400).
export const MEDIA=deepFreeze(['alimtalk','email','sms'] as const);
export type Medium=typeof MEDIA[number];
export const MEDIUM_LABELS:Readonly<Record<Medium,string>>=deepFreeze({email:'이메일',sms:'문자',alimtalk:'알림톡'});

// ── 자리표시 ──
// 사람 이름·연락처·가명 코드는 템플릿에 값으로 넣지 않고 자리표시로만 둔다. 보낼 때 사람이 채운다.
export const PLACEHOLDERS=deepFreeze(['{담당자}','{문의처}','{브랜드}','{수신거부}','{이름}'] as const);
export const AD_LABEL='(광고)';
export const LIMITS=deepFreeze({subjectChars:60,bodyChars:1000,bodyLines:30,requests:50,logs:200,brandFieldChars:200,factLines:12} as const);

// ── 사유 코드 ──
export const NURTURE_CODES=deepFreeze(['ad_label_missing','ad_label_variant','ad_optout_missing','ad_sender_missing','advertising_before_r9b','alimtalk_advertising','block_unresolved','contact_unavailable','hard_block','invalid_input','invalid_template','limit','medium_mismatch','personal_data','request_missing','request_used','switch_off','template_blocked','unknown_placeholder'] as const);
export type NurtureCode=typeof NURTURE_CODES[number];
export const NURTURE_CODE_STATUS:Readonly<Record<NurtureCode,400|409>>=deepFreeze({
 ad_label_missing:400,ad_label_variant:400,ad_optout_missing:400,ad_sender_missing:400,advertising_before_r9b:409,alimtalk_advertising:400,block_unresolved:409,contact_unavailable:409,hard_block:409,
 invalid_input:400,invalid_template:400,limit:409,medium_mismatch:400,personal_data:400,request_missing:400,request_used:409,switch_off:409,template_blocked:409,unknown_placeholder:400,
});
export const NURTURE_MESSAGES:Readonly<Record<NurtureCode,string>>=deepFreeze({
 ad_label_missing:"광고성 템플릿은 첫 줄을 '(광고)'로 시작해야 합니다.",
 ad_label_variant:"'(광고)' 표기를 바꿔 쓸 수 없습니다('(광/고)'·'[광고]'·'(AD)' 등). 첫 줄 맨 앞에 '(광고)'를 그대로 쓰세요.",
 ad_optout_missing:"광고성 템플릿에는 '무료 수신거부'와 자리표시 {수신거부}가 든 줄이 있어야 합니다.",
 ad_sender_missing:"광고성 템플릿 첫 줄에 전송자 명칭 자리표시 {브랜드}가 있어야 합니다.",
 advertising_before_r9b:'광고성 메시지의 발송 기록은 매체별 수신 동의 확인(R9b) 전에는 남길 수 없습니다.',
 alimtalk_advertising:'알림톡은 정보성 전용입니다. 광고성 목적은 이메일·문자로만 만듭니다.',
 block_unresolved:'가맹 모집 규칙상 근거 사실이 필요한 표현이 남아 있습니다.',
 contact_unavailable:'이 리드의 연락처가 없거나 파기돼 발송 기록을 남길 수 없습니다.',
 hard_block:'가맹 모집 규칙상 쓸 수 없는 표현이 있습니다(승인으로 풀 수 없음).',
 invalid_input:'입력 형식을 확인하세요.',
 invalid_template:`템플릿은 본문 1~${LIMITS.bodyChars}자·${LIMITS.bodyLines}줄, 제목은 이메일만 ${LIMITS.subjectChars}자 이하이고 줄바꿈 밖의 제어 문자를 넣을 수 없습니다.`,
 limit:'기록 한도를 넘었습니다.',
 medium_mismatch:'템플릿을 만든 매체로만 발송 기록을 남길 수 있습니다.',
 personal_data:'템플릿에 전화번호·이메일 같은 개인정보나 긴 숫자가 있습니다. 이름·연락처는 자리표시로만 둡니다.',
 request_missing:"'요청받은 1회 정보'는 이 리드의 정보 요청 기록을 골라야 발송 기록을 남길 수 있습니다.",
 request_used:'이 정보 요청에는 이미 발송 기록이 있습니다(요청당 1회).',
 switch_off:'가맹 모집 기능이 꺼져 있습니다.',
 template_blocked:'이 템플릿은 지금 규칙으로 다시 보면 막히는 표현이 있어 발송 기록을 남길 수 없습니다. 템플릿을 고쳐 새 판으로 저장하세요.',
 unknown_placeholder:`정해진 자리표시(${PLACEHOLDERS.join(' ')})만 쓸 수 있습니다.`,
});
export type NurtureDecision<T>={ok:true;value:T;warnings:string[]}|{ok:false;status:400|409;reasons:NurtureCode[];message:string;judgement?:FranchiseJudgement};
const fail=(codes:readonly NurtureCode[],judgement?:FranchiseJudgement):Extract<NurtureDecision<never>,{ok:false}>=>{
 const reasons=[...new Set(codes)].sort();
 return {ok:false,status:NURTURE_CODE_STATUS[reasons[0]],reasons,message:reasons.map(c=>NURTURE_MESSAGES[c]).join(' '),...(judgement?{judgement}:{})};
};

// ── 템플릿 검사 ──
export type TemplateInput={purpose:Purpose;medium:Medium;subject:string|null;body:string};
const hasControl=(s:string)=>{for(const ch of s){const c=ch.codePointAt(0)??0;if((c<0x20&&c!==0x0a)||(c>=0x7f&&c<=0x9f)||c===0x2028||c===0x2029)return true}return false};
const AD_VARIANT=/\(\s*광\s*[/·.\s]\s*고\s*\)|\[\s*광\s*고\s*\]|\(\s*AD\s*\)|<\s*광\s*고\s*>|\(\s*광\s+고\s*\)/i;
const PLACEHOLDER=/\{[^{}\n]{0,20}\}/g;
// 7자리 넘는 숫자 줄(구분자 무시)은 전화·계좌·주민번호일 수 있어 막는다(가명 코드·시스템 코드도 여기 걸린다).
const longDigits=(s:string)=>/\d{7}/.test(s.replace(/[\s\-.()]/g,''));
export function templateInput(input:unknown):TemplateInput|null{
 if(!isRecord(input)||!oneOf(PURPOSE_KEYS,input.purpose)||!oneOf(MEDIA,input.medium)||typeof input.body!=='string')return null;
 const subject=input.subject===undefined||input.subject===null||input.subject===''?null:input.subject;
 if(subject!==null&&typeof subject!=='string')return null;
 return {purpose:input.purpose,medium:input.medium,subject,body:input.body.replace(/\r\n?/g,'\n').normalize('NFC')};
}
// 구조 검사(400). 순서: 형식 → 자리표시 → 개인정보 → 매체·광고성 고정 요소.
export function templateStructure(t:TemplateInput):NurtureCode[]{
 const codes:NurtureCode[]=[],all=(t.subject??'')+'\n'+t.body,lines=t.body.split('\n');
 if(!t.body.trim()||Array.from(t.body).length>LIMITS.bodyChars||lines.length>LIMITS.bodyLines||hasControl(t.body)
  ||(t.subject!==null&&(t.medium!=='email'||!t.subject.trim()||Array.from(t.subject).length>LIMITS.subjectChars||/[\n]/.test(t.subject)||hasControl(t.subject))))codes.push('invalid_template');
 if([...all.matchAll(PLACEHOLDER)].some(m=>!(PLACEHOLDERS as readonly string[]).includes(m[0]))||/[{}]/.test(all.replace(PLACEHOLDER,'')))codes.push('unknown_placeholder');
 if(scanText(all.replace(PLACEHOLDER,' ')).length||longDigits(all))codes.push('personal_data');
 const cls=classificationOf(t.purpose);
 if(cls==='advertising'){
  if(t.medium==='alimtalk')codes.push('alimtalk_advertising');
  const first=lines.find(l=>l.trim())??'';
  if(AD_VARIANT.test(all))codes.push('ad_label_variant');
  else if(!first.trimStart().startsWith(AD_LABEL))codes.push('ad_label_missing');
  if(!first.includes('{브랜드}'))codes.push('ad_sender_missing');
  if(!lines.some(l=>l.includes('무료 수신거부')&&l.includes('{수신거부}')))codes.push('ad_optout_missing');
 }else if(AD_VARIANT.test(all)||all.includes(AD_LABEL))codes.push('ad_label_variant');
 return [...new Set(codes)].sort();
}
// R2 판정(모집 범위, 자리표시는 판정 전에 일반 낱말로 바꾼다). hard_block·block은 409다.
export function templateJudgement(t:TemplateInput,ctx:{brandId:string;now:string;facts:readonly BrandFact[];versions:readonly VersionLite[]}):FranchiseJudgement{
 const text=((t.subject?t.subject+'\n':'')+t.body).replace(PLACEHOLDER,'고객');
 return judgeFranchiseText({text,at:ctx.now,now:ctx.now,scope:'recruitment',brandId:ctx.brandId,facts:ctx.facts,versions:ctx.versions});
}
export function templateDecision(input:unknown,ctx:{enabled:boolean;brandId:string;now:string;facts:readonly BrandFact[];versions:readonly VersionLite[]}):NurtureDecision<TemplateInput&{classification:Classification;judgement:FranchiseJudgement}>{
 try{
  if(ctx.enabled!==true)return fail(['switch_off']);
  const t=templateInput(input);
  if(!t)return fail(['invalid_input']);
  const s=templateStructure(t);
  if(s.length)return fail(s);
  const j=templateJudgement(t,ctx);
  if(j.hardBlocked)return fail(['hard_block'],j);
  if(j.issues.some(x=>x.tier==='block'))return fail(['block_unresolved'],j);
  return {ok:true,value:{...t,classification:classificationOf(t.purpose),judgement:j},warnings:[]};
 }catch{return fail(['invalid_input'])}
}

// ── 모델 제출 조립(허용 입력만) ──
// brand: 이름·업종·소개·말투만. facts: 확정 사실 줄(호출자가 lib/franchise-facts factLine으로 만든 브랜드 사실, 수익 항목·지점 사실 제외). 개인정보가 든 칸·줄은 뺀다.
export type DraftBrand={name:string;category:string;description:string;tone:string};
export type DraftRequest={purpose:Purpose;medium:Medium;brand:DraftBrand;factLines:string[]};
const clean=(v:unknown)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,LIMITS.brandFieldChars):'';
const safe=(s:string)=>s&&!scanText(s).length&&!longDigits(s)?s:'';
export function draftRequest(purpose:unknown,medium:unknown,brand:unknown,factLines:unknown):DraftRequest|null{
 if(!oneOf(PURPOSE_KEYS,purpose)||!oneOf(MEDIA,medium)||!isRecord(brand))return null;
 if(classificationOf(purpose)==='advertising'&&medium==='alimtalk')return null;
 const b:DraftBrand={name:safe(clean(brand.name)),category:safe(clean(brand.category)),description:safe(clean(brand.description)),tone:safe(clean(brand.tone))};
 if(!b.name)return null;
 const lines=Array.isArray(factLines)?factLines.filter((x):x is string=>typeof x==='string').map(x=>x.trim()).filter(x=>x&&x.length<=300&&safe(x)).slice(0,LIMITS.factLines):[];
 return {purpose,medium,brand:b,factLines:lines};
}
// 지시문은 고정 문장과 목적·분류·매체 라벨만 쓴다. 입력은 JSON 한 덩어리이고 키는 정해진 것뿐이다(테스트가 키를 고정한다).
export function nurtureSubmission(r:DraftRequest):{instructions:string;input:string}{
 const cls=classificationOf(r.purpose),purpose=PURPOSES.find(p=>p.key===r.purpose)!.label;
 const rules=[
  '당신은 가맹본부의 가맹 모집 담당자를 돕는 카피라이터입니다. 예비 가맹점주에게 사람이 직접 보낼 메시지의 초안 한 편을 한국어로 씁니다.',
  `목적: ${purpose}. 분류: ${CLASSIFICATION_LABELS[cls]}. 매체: ${MEDIUM_LABELS[r.medium]}.`,
  `받는 사람 이름·담당자·연락처는 모릅니다. 값 대신 자리표시 ${PLACEHOLDERS.join(' ')}만 씁니다. 전화번호·이메일·주소·숫자 코드를 지어내지 않습니다.`,
  '수치는 입력의 확정 사실 줄에 있는 값만 그대로 씁니다. 평균매출·월 매출·순수익·수익률·투자금 회수 기간 같은 수익 수치는 쓰지 않습니다. 수익 질문은 정보공개서와 서면 자료로 안내한다고만 씁니다.',
  '정보공개서를 받은 뒤 14일(자문을 받았다면 7일)이 지나기 전에는 계약하거나 가맹금을 받지 않는다는 원칙을 바꾸거나 줄여 말하지 않습니다. 계약을 서두르게 하는 표현을 쓰지 않습니다.',
  ...(cls==='advertising'?[`광고성이므로 첫 줄을 '${AD_LABEL} {브랜드}'로 시작하고, 마지막 줄에 '무료 수신거부: {수신거부}'를 씁니다.`]:[`정보성이므로 '${AD_LABEL}' 표기와 설명회 초대·혜택·재상담 유도를 넣지 않습니다.`]),
  `본문은 ${r.medium==='email'?'700':'300'}자 이내로 씁니다.`,
  `출력은 JSON 한 개만: {"subject": ${r.medium==='email'?'"제목(60자 이내)"':'null'}, "body": "본문"}. 다른 글은 쓰지 않습니다.`,
 ].join('\n');
 const input=JSON.stringify({purpose:r.purpose,classification:cls,medium:r.medium,brand:r.brand,facts:r.factLines});
 return {instructions:rules,input};
}
// 모델 출력 읽기: 첫 JSON 객체의 subject·body. 형식이 틀리면 null(부분 본문을 쓰지 않는다).
export function parseNurtureOutput(text:unknown,medium:Medium):{subject:string|null;body:string}|null{
 if(typeof text!=='string'||text.length>20000)return null;
 const start=text.indexOf('{'),end=text.lastIndexOf('}');
 if(start<0||end<=start)return null;
 try{
  const o=JSON.parse(text.slice(start,end+1)) as unknown;
  if(!isRecord(o)||typeof o.body!=='string'||!o.body.trim())return null;
  const subject=medium==='email'&&typeof o.subject==='string'&&o.subject.trim()?o.subject.trim():null;
  return {subject,body:o.body.replace(/\r\n?/g,'\n').trim()};
 }catch{return null}
}

// ── 정보 요청·수동 발송 기록(리드 기록 안, 값 없음) ──
export type InfoRequest={id:string;purpose:Purpose;at:string;by:string};
export type MessageLog={id:string;templateId:string;templateVersion:number;classification:Classification;medium:Medium;requestId:string|null;at:string;by:string};
export function infoRequestDecision(input:unknown,ctx:{enabled:boolean;now:string;id:string;by:string;requests:readonly InfoRequest[]}):NurtureDecision<InfoRequest>{
 if(ctx.enabled!==true)return fail(['switch_off']);
 if(!isRecord(input)||!oneOf(INFO_PURPOSES,input.purpose)||!isInstant(ctx.now))return fail(['invalid_input']);
 if(ctx.requests.length>=LIMITS.requests)return fail(['limit']);
 return {ok:true,value:{id:ctx.id,purpose:input.purpose,at:ctx.now,by:ctx.by},warnings:[]};
}
export type LogTemplate={id:string;version:number;purpose:Purpose;medium:Medium;subject:string|null;body:string};
// 순서: 스위치 → 입력 → 분류(광고성 409) → 매체 → 요청(정보성: 이 리드의 요청 기록, 요청당 1회) → 연락처 → 템플릿 다시 판정 → 한도.
export function messageLogDecision(input:unknown,ctx:{enabled:boolean;now:string;id:string;by:string;template:LogTemplate|null;contactPresent:boolean;requests:readonly InfoRequest[];logs:readonly MessageLog[];brandId:string;facts:readonly BrandFact[];versions:readonly VersionLite[]}):NurtureDecision<MessageLog>{
 try{
  if(ctx.enabled!==true)return fail(['switch_off']);
  const t=ctx.template;
  if(!isRecord(input)||!t||!oneOf(MEDIA,input.medium)||!isInstant(ctx.now))return fail(['invalid_input']);
  const cls=classificationOf(t.purpose);
  if(cls==='advertising')return fail(['advertising_before_r9b']);
  if(input.medium!==t.medium)return fail(['medium_mismatch']);
  const requestId=typeof input.requestId==='string'?input.requestId:null;
  if(!requestId||!ctx.requests.some(r=>r.id===requestId))return fail(['request_missing']);
  if(ctx.logs.some(l=>l.requestId===requestId))return fail(['request_used']);
  if(!ctx.contactPresent)return fail(['contact_unavailable']);
  const again=templateDecision(t,{enabled:true,brandId:ctx.brandId,now:ctx.now,facts:ctx.facts,versions:ctx.versions});
  if(!again.ok)return fail(['template_blocked']);
  if(ctx.logs.length>=LIMITS.logs)return fail(['limit']);
  return {ok:true,value:{id:ctx.id,templateId:t.id,templateVersion:t.version,classification:cls,medium:t.medium,requestId,at:ctx.now,by:ctx.by},warnings:[]};
 }catch{return fail(['invalid_input'])}
}
export const NURTURE_DISCLAIMER=GATE_DISCLAIMER;
