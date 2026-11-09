// X7 인라인 인용(docs/GLOBAL-PLAN.ko.md 에픽 X7)의 순수 규칙(화면·테스트 공용). 작업물 본문의 ref 라벨을 인용 조각으로 나눈다.
// 라벨 모양은 lib/role-output.ts idLabels·labelArchive가 실행 입력에 붙인 것과 같다: '브랜드 자료 #N'·'채널 관찰 #N'·'브랜드 진단'·'<담당 이름> vN'·'브리프 vN'.
// 확정 사실은 실행이 쓴 사실 항목 이름(factKeys)과 함께 쓴 표기만 인용으로 본다: '확정 사실 주소'·'확정 사실(주소)'·'[사실: 주소 · 확정 사실]'·'주소(확정 사실)'.
// 외부 출처는 본문의 http(s) 주소다. 라벨이 없는 문장은 '근거 없음' 표시 대상이다(작업물 출처가 AI일 때만, 화면이 정한다).
import {roles} from './agency';

export type RefKind='archive'|'observation'|'diagnosis'|'brief'|'artifact'|'fact'|'external';
// key: 서버 출처 지도(/api/artifact-sources refs)의 키. 라벨 그대로이고 사실은 'fact:<항목>', 외부 출처는 주소다.
export type CitationRef={kind:RefKind;label:string;key:string;short:string;url?:string};
export type TextSegment={type:'text';text:string}|{type:'ref';text:string;ref:CitationRef};

const escapeRegex=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const roleNames=roles.map(r=>escapeRegex(r.name)).join('|');
// 확인 필요 표지: '[확인 필요]'·'[가격 확인 필요]'·'[실제 고객 후기 수집 후 삽입 — 확인 필요]'.
export const CHECK_FLAG=/\[[^\]\n]{0,60}확인 필요[^\]\n]{0,20}\]/g;
type Matcher={re:RegExp;ref:(m:RegExpMatchArray)=>CitationRef};
const trimUrl=(url:string)=>url.replace(/[.,;:!?'"’”)\]]+$/,'');
const domainOf=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return url.slice(0,40)}};
const factRef=(key:string,label:string):CitationRef=>({kind:'fact',label,key:'fact:'+key,short:'사실 '+key});
const FIXED:Matcher[]=[
 {re:/브랜드 자료 #(\d{1,3})/g,ref:m=>({kind:'archive',label:m[0],key:m[0],short:'자료 '+m[1]})},
 {re:/채널 관찰 #(\d{1,3})/g,ref:m=>({kind:'observation',label:m[0],key:m[0],short:'관찰 '+m[1]})},
 {re:/브랜드 진단/g,ref:m=>({kind:'diagnosis',label:m[0],key:m[0],short:'진단'})},
 {re:/브리프 v(\d{1,4})/g,ref:m=>({kind:'brief',label:m[0],key:m[0],short:m[0]})},
 {re:new RegExp(`(?:${roleNames}) v\\d{1,4}`,'g'),ref:m=>({kind:'artifact',label:m[0],key:m[0],short:m[0]})},
 {re:/https?:\/\/[^\s<>"'`)\]]+/g,ref:m=>{const url=trimUrl(m[0]);return {kind:'external',label:url,key:url,short:domainOf(url),url}}},
];
function matchers(factKeys:readonly string[]):Matcher[]{
 const keys=[...new Set(factKeys.filter(k=>k&&k.length<=40))].sort((a,b)=>b.length-a.length).map(escapeRegex).join('|');
 if(!keys)return FIXED;
 return [
  {re:new RegExp(`\\[사실:\\s?(${keys})\\s?·\\s?확정 사실\\]`,'g'),ref:m=>factRef(m[1],m[0])},
  {re:new RegExp(`확정 사실\\s?[:(]?\\s?(${keys})\\)?`,'g'),ref:m=>factRef(m[1],m[0])},
  {re:new RegExp(`(${keys})\\s?\\(확정 사실\\)`,'g'),ref:m=>factRef(m[1],m[0])},
  ...FIXED,
 ];
}
type Hit={start:number;end:number;ref:CitationRef};
const hitsOf=(text:string,factKeys:readonly string[]):Hit[]=>matchers(factKeys).flatMap(({re,ref})=>[...text.matchAll(new RegExp(re.source,re.flags))].map(m=>{
 const r=ref(m),length=r.kind==='external'?r.label.length:m[0].length;
 return {start:m.index??0,end:(m.index??0)+length,ref:r};
}));
// 한 줄(또는 한 문장)을 글자·인용 조각으로 나눈다. 겹치면 먼저 시작하고 더 긴 표기를 쓴다. 조각을 이으면 원문과 같다(외부 주소 끝 문장부호는 글자 조각으로 남긴다).
export function parseCitations(text:string,factKeys:readonly string[]=[]):TextSegment[]{
 const chosen=hitsOf(text,factKeys).sort((a,b)=>a.start-b.start||b.end-a.end).reduce<Hit[]>((out,h)=>out.length&&h.start<out[out.length-1].end?out:[...out,h],[]);
 const {segments,cursor}=chosen.reduce<{segments:TextSegment[];cursor:number}>((acc,h)=>({cursor:h.end,segments:[...acc.segments,...(h.start>acc.cursor?[{type:'text' as const,text:text.slice(acc.cursor,h.start)}]:[]),{type:'ref' as const,text:text.slice(h.start,h.end),ref:h.ref}]}),{segments:[],cursor:0});
 return cursor<text.length?[...segments,{type:'text',text:text.slice(cursor)}]:segments;
}
export const refsOf=(text:string,factKeys:readonly string[]=[])=>parseCitations(text,factKeys).flatMap(s=>s.type==='ref'?[s.ref]:[]);
// 본문 줄 종류(RichText와 같은 규칙): 제목(#~###), 빈 줄, 목록(- ·*), 그 밖의 문단. 굵게(**…**) 표지는 지운다.
export type TextLine={kind:'heading'|'gap'|'bullet'|'paragraph';text:string};
export function textLines(text:string):TextLine[]{
 return text.split('\n').map(line=>{
  if(/^#{1,3} /.test(line))return {kind:'heading' as const,text:line.replace(/^#+ /,'')};
  if(!line.trim())return {kind:'gap' as const,text:''};
  const clean=line.replace(/\*\*(.*?)\*\*/g,'$1');
  return {kind:/^[-*] /.test(clean)?'bullet' as const:'paragraph' as const,text:clean};
 });
}
// 문장 나누기: 마침표·물음표·느낌표 뒤 빈칸 앞에서 자른다. 조각을 이으면 원문 줄과 같다.
export const splitSentences=(line:string)=>line.split(/(?<=[.!?。])(?=\s)/).filter(s=>s.length);
// 근거 표시 대상 문장: 표 구분선이 아니고 빈칸·기호를 뺀 길이가 12자 이상인 문장.
const MIN_CLAIM_CHARS=12;
export const isClaimSentence=(sentence:string)=>!/^\s*\|?[-:| ]+\|?\s*$/.test(sentence)&&sentence.replace(/[\s\-*#|>]/g,'').length>=MIN_CLAIM_CHARS;
export const hasCheckFlag=(sentence:string)=>new RegExp(CHECK_FLAG.source).test(sentence);
export type SentenceUnit={text:string;refs:CitationRef[];checkFlag:boolean};
export function claimSentences(text:string,factKeys:readonly string[]=[]):SentenceUnit[]{
 return textLines(text).filter(l=>l.kind==='bullet'||l.kind==='paragraph').flatMap(l=>splitSentences(l.text)).filter(isClaimSentence)
  .map(s=>({text:s.trim(),refs:refsOf(s,factKeys),checkFlag:hasCheckFlag(s)}));
}
