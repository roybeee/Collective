import {usesTerm} from './graders/negation';

// 브랜드 말투 원장(A3-2): 순수 모듈(타입·검증·모델 블록·피할 표현 판정). 상대 import만 쓴다. 저장·권한은 lib/brand-voice-server.ts, 규칙과 근거는 docs/COPY-PACK.ko.md A3-2 절.
// 관리자가 초안(draft)을 쓰고 대표·관리자가 확정(confirmed)한다. 모델에는 마지막 확정본(confirmedVoice)만 가고, 새 초안을 쓰는 동안에도 이전 확정본을 유지한다. 철회(revoked)하면 확정본이 없다.
// 확정본은 기능 스위치 a3_brand_voice가 켜졌을 때 content·creative 역할 입력에만 실린다(lib/role-execution.ts roleRequestWithRules, lib/role-instruction.ts).
export const BRAND_VOICE_LIMITS={items:10,item:40,samples:3,sample:200,block:1500,history:20} as const;
export const VOICE_LISTS=['tone','do','dont','preferTerms','avoidTerms'] as const;
// 말투를 입력으로 받는 역할. 다른 역할은 요청에 말투가 있어도 입력·지시에 싣지 않는다.
export const VOICE_ROLES:readonly string[]=['creative','content'];
export type VoiceBody={tone:string[];do:string[];dont:string[];preferTerms:string[];avoidTerms:string[];samples:string[]};
export type VoiceStatus='draft'|'confirmed'|'revoked';
// 사람은 id·역할만 남긴다(이메일 없음).
export type VoiceActor={id:string;role:'owner'|'admin'|'member'};
export type VoiceSnapshot=VoiceBody&{version:number;status:VoiceStatus;updatedBy:VoiceActor;updatedAt:string;confirmedBy?:VoiceActor;confirmedAt?:string};
// confirmedVoice: 모델에 가는 마지막 확정본(확정 때 채우고, 초안 저장 때 유지하고, 철회 때 null). history: 이전 판(최근 20판, 최신 먼저).
export type BrandVoice=VoiceSnapshot&{id:string;brandId:string;confirmedVoice:VoiceSnapshot|null;history:VoiceSnapshot[]};
// 모델 입력 블록: 말투 본문과 확정 판 번호만. 사람 id·시각·상태는 뺀다.
export type BrandVoiceInput=VoiceBody&{version:number};
// 입력 가림 경로(lib/role-instruction.ts ROLE_MASK_PATHS). 브랜드 정체성 자유 텍스트와 같은 탐지·자리표시·허용 값을 쓴다.
export const BRAND_VOICE_MASK_PATHS=[...VOICE_LISTS,'samples'].map(k=>`brandVoice.${k}.*`);

const CONTROL=/[\u0000-\u0008\u000b-\u001f\u007f]/;
const LABELS:Record<keyof VoiceBody,string>={tone:'어조',do:'쓸 것',dont:'피할 것',preferTerms:'선호 표현',avoidTerms:'피할 표현',samples:'예시 문장'};
function listOf(value:unknown,key:keyof VoiceBody,max:number,chars:number,collapse:boolean):{items:string[];errors:string[]}{
 if(value===undefined)return {items:[],errors:[]};
 if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))return {items:[],errors:[`${LABELS[key]}은 문장 목록이어야 합니다.`]};
 const items=[...new Set((value as string[]).map(v=>collapse?v.replace(/\s+/g,' ').trim():v.trim()).filter(Boolean))];
 const errors=[items.length>max?`${LABELS[key]}은 ${max}개까지 적을 수 있습니다.`:'',items.some(v=>v.length>chars)?`${LABELS[key]} 한 항목은 ${chars}자까지입니다.`:'',items.some(v=>CONTROL.test(v))?`${LABELS[key]}에 제어 문자를 쓸 수 없습니다.`:''].filter(Boolean);
 return {items,errors};
}
// 저장 입력 검증: 목록마다 10개·항목 40자, 예시 3개·200자, 모델 블록 1,500자. 공백만 다른 항목은 하나로 친다. 넘으면 자르지 않고 오류다.
export function parseVoiceBody(data:unknown):{body:VoiceBody|null;errors:string[]}{
 if(!data||typeof data!=='object'||Array.isArray(data))return {body:null,errors:['말투 내용을 입력하세요.']};
 const d=data as Record<string,unknown>,L=BRAND_VOICE_LIMITS;
 const lists=VOICE_LISTS.map(k=>[k,listOf(d[k],k,L.items,L.item,true)] as const),samples=listOf(d.samples,'samples',L.samples,L.sample,false);
 const body={...Object.fromEntries(lists.map(([k,v])=>[k,v.items])),samples:samples.items} as VoiceBody;
 const errors=[...lists.flatMap(([,v])=>v.errors),...samples.errors];
 if(!errors.length&&![...VOICE_LISTS,'samples' as const].some(k=>body[k].length))errors.push('어조·쓸 것·피할 것·선호 표현·피할 표현·예시 중 하나 이상을 적으세요.');
 if(!errors.length&&JSON.stringify(voiceBlock(body,0)).length>L.block)errors.push(`말투 전체는 ${L.block.toLocaleString('ko-KR')}자(모델 입력 블록)를 넘을 수 없습니다. 항목을 줄여 주세요.`);
 return {body:errors.length?null:body,errors};
}
// 말투 본문만 새 객체로 옮긴다(키 순서 고정, 입력 불변).
export const voiceBody=(v:VoiceBody):VoiceBody=>({tone:[...v.tone],do:[...v.do],dont:[...v.dont],preferTerms:[...v.preferTerms],avoidTerms:[...v.avoidTerms],samples:[...v.samples]});
const voiceBlock=(v:VoiceBody,version:number):BrandVoiceInput=>({...voiceBody(v),version});
// 1,500자를 넘으면 뒤에서부터 뺀다: 예시 → 선호 표현 → 쓸 것 → 피할 것 → 어조 → 피할 표현(채점 대상이라 마지막). 저장 검증이 막으므로 옛 행 대비 방어선이다.
const DROP_ORDER:readonly (keyof VoiceBody)[]=['samples','preferTerms','do','dont','tone','avoidTerms'];
export function voiceModelBlock(v:VoiceBody&{version:number}):BrandVoiceInput{
 const fits=(b:BrandVoiceInput)=>JSON.stringify(b).length<=BRAND_VOICE_LIMITS.block;
 const shrink=(b:BrandVoiceInput):BrandVoiceInput=>{if(fits(b))return b;const key=DROP_ORDER.find(k=>b[k].length);return key?shrink({...b,[key]:b[key].slice(0,-1)}):b};
 return shrink(voiceBlock(v,v.version));
}
// 모델에 갈 확정본 블록. 확정본이 없거나(초안만·철회) 행이 없으면 null.
export const activeVoiceInput=(row:Pick<BrandVoice,'confirmedVoice'>|null|undefined):BrandVoiceInput|null=>row?.confirmedVoice?voiceModelBlock(row.confirmedVoice):null;
// 역할이 말투를 받는지. 아니면 undefined라 입력·지시·채점이 말투 없는 경우와 같다.
export const voiceForRole=<T>(role:string,v:T|undefined|null)=>VOICE_ROLES.includes(role)&&v?v:undefined;
// 피할 표현이 카피 문장에 부정·배제 없이 쓰였는지(공용 부정 판정 usesTerm). '‘대박’이라는 표현은 쓰지 않는다'는 사용이 아니다. 결과는 '표현: 발췌'.
export function voiceAvoidHits(units:readonly {sentence:string;within?:(at:number)=>boolean}[],terms:readonly string[]):string[]{
 return [...new Set(units.flatMap(u=>terms.filter(t=>usesTerm(u.sentence,t,u.within)).map(t=>`${t}: ${u.sentence.trim().slice(0,40)}`)))];
}
