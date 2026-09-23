import {parseRoleOutput,roleOutputContract} from '../role-output';
import type {EvalItem} from './types';

// 채점기 공통 텍스트 도구. 규칙의 정의와 근거는 docs/EVAL.ko.md 실패 유형 정의표에 있다.
export const PROSE_FIELDS=['position','evidence','challenge','proposal'] as const;
const str=(v:unknown)=>typeof v==='string'?v:'';
export const isText=(item:EvalItem)=>item.kind!=='input'&&item.kind!=='call';
export const compact=(s:string)=>s.replace(/\s+/g,'').toLowerCase();
export const excerpt=(s:string,n=40)=>s.trim().slice(0,n);
export const withoutUrls=(text:string)=>text.replace(/https?:\/\/[^\s)>\]]+/g,'');
export const contractTitles=(role:string)=>roleOutputContract(role).sections.map(s=>s.title);
// 회의 발언의 산문 필드. respondsTo 같은 코드 필드는 채점하지 않는다(meetings.ts codeKeys).
export const proseFields=(item:EvalItem)=>PROSE_FIELDS.map(k=>str(item.fields?.[k]));
// meetings.ts fieldText와 같은 형식: 필드마다 '## 이름' 제목을 붙여 재질문은 필드 단위로 본다.
export const fieldText=(item:EvalItem)=>PROSE_FIELDS.map(k=>`## ${k}\n${str(item.fields?.[k])}`).join('\n');
// 원 JSON만 있으면 앱과 같은 규칙으로 렌더한다. 계약 위반 JSON은 섹션 본문을 이어 붙여 내용 채점만 가능하게 한다.
function renderRaw(item:EvalItem){
 const raw=item.raw||'';
 try{return parseRoleOutput(raw,item.role||'',roleOutputContract(item.role||''))}catch{}
 try{
  const parsed=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')) as {sections?:{id?:unknown;content?:unknown}[]};
  return (parsed.sections||[]).map(s=>`## ${str(s?.id)}\n\n${str(s?.content)}`).join('\n\n');
 }catch{return raw}
}
// 채점 대상 본문: 회의 발언은 산문 필드, 나머지는 본문(없으면 원 JSON 렌더).
export function bodyOf(item:EvalItem){
 if(item.kind==='discussion')return proseFields(item).join('\n');
 return item.text??(item.raw?renderRaw(item):'');
}
// 문장 단위: 표 행은 칸으로, 나머지는 문장부호 뒤 공백으로 나눈다.
export const sentences=(line:string)=>(line.trim().startsWith('|')?line.split('|'):[line]).flatMap(c=>c.split(/(?<=[.?!])\s+/)).map(s=>s.trim()).filter(Boolean);
const heading=(l:string)=>/^#{1,6}\s/.test(l);
// 라벨: 제목 줄, 또는 강조(**·__)와 끝 콜론을 벗긴 뒤 문장부호 없는 30자 이하 짧은 줄(예: '고객 가설 3', '**게시 카피**', '게시 카피:').
// 아래 줄은 가장 가까운 라벨에 속한다.
const unmark=(l:string)=>l.replace(/\*\*|__/g,'').trim();
const labelText=(l:string)=>heading(l)?l.replace(/^#+\s*/,'').trim():unmark(l).replace(/[:：]\s*$/,'').trim();
const isLabel=(l:string)=>{const t=labelText(l);return heading(l)||(t.length>0&&t.length<=30&&!/[.:!?|‘’“”"]/.test(t)&&!/^[-*>]/.test(t))};
// 인라인 라벨: '라벨: 본문' 줄(예: '- 게시 카피: …', '**카피 A:** …'). 그 줄에만 적용하고 둘러싼 라벨과 함께 본다.
const INLINE_LABEL=/^(?:[-*>]\s*)?([^:：.!?|‘’“”"()[\]]{1,24}?)\s*[:：]\s*\S/;
export type Block={index:number;line:string;label:string;isLabel:boolean};
export function blocks(text:string):Block[]{
 return text.split('\n').reduce<{label:string;out:Block[]}>((acc,line,index)=>{
  const labelled=isLabel(line),label=labelled?labelText(line):acc.label,inline=labelled?undefined:INLINE_LABEL.exec(unmark(line))?.[1]?.trim();
  return {label,out:[...acc.out,{index,line,label:inline?`${inline} ${label}`.trim():label,isLabel:labelled}]};
 },{label:'',out:[]}).out;
}
// '자료 필요'로 시작하는 줄(조건부 초안 없이 자료 요청만 남긴 줄) 판정과 제목 줄로 나눈 섹션은 앱 검사(role-output.ts)의 구현을 그대로 쓴다.
export {placeholderOnly,sectionsOf} from '../role-output';
