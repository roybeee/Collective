// 규정 점검(lib/graders/compliance.ts) 이슈의 결정론 수정 제안(순수, 저장·네트워크·시계 없음). COLLECTIVE 휴리스틱이며 법률 자문이 아니다(docs/COMPLIANCE-FIXES.ko.md).
// 하는 일: 걸린 문장 위치를 찾아 규칙별로 안전한 고침 하나를 만든다(넣기·바꾸기·지우기·끝에 붙이기). 사실·가격·숫자를 지어내지 않는다.
// 080 번호·전송자 명칭처럼 모르는 값은 자리표시와 [확인 필요]로 둔다. 안전한 고침이 없는 규칙은 제안을 만들지 않는다(화면이 '직접 고쳐야 합니다'를 보인다).
// 위치 찾기: 채점기를 그대로 돌려 규칙의 첫 걸린 문장(발췌)을 찾고, 그 문장을 같은 길이의 빈칸으로 가린 뒤 다시 돌려 다음 문장을 찾는다(오프셋이 원문과 같다).
// 해소 단위: 표기·표시 규칙은 채점기와 같이 소제목 단락마다 한 번만 고친다(한 단락의 표기가 그 단락의 모든 걸린 문장을 해소한다).
import {checkCompliance,COMPLIANCE_LEXICON,type ComplianceRule,type FranchiseComplianceScope} from './compliance';
import type {FactLedger} from './types';
import {VIRTUAL_PERSON_LINE} from '../ai-disclosure';
import {AI_IMAGE_VISIBLE_LABEL} from '../ai-disclosure-image';

export type ComplianceFixKind='insert'|'replace'|'remove'|'append';
export type FixRange={start:number;end:number};
// before: 원문의 range 부분(넣기·붙이기는 빈 문자열). after: 그 자리에 들어갈 글. preview: 고침이 걸친 줄의 전후(화면 비교용).
export type ComplianceFix={id:string;ruleId:string;kind:ComplianceFixKind;range:FixRange;before:string;after:string;rationale:string;sources:string[];needsCheck:boolean;preview:{before:string;after:string}};
export type ComplianceFixOptions={facts?:FactLedger|null;franchise?:FranchiseComplianceScope|null;senderName?:string|null};
export const COMPLIANCE_FIX_NOTICE='수정 제안은 COLLECTIVE 휴리스틱이며 법률 자문이 아닙니다. 적용하면 새 버전으로 저장되고 이전 버전으로 되돌릴 수 있습니다.';
export const OPTOUT_PLACEHOLDER='[수신거부 080-…]';
export const SENDER_PLACEHOLDER='[전송자 명칭 확인 필요]';
export const CLAIM_PLACEHOLDER='[확인 필요: 순위 근거]';
export const CLAIM_BASIS_PLACEHOLDER='[확인 필요: 근거]';
export class ComplianceFixConflictError extends Error{}

type Span={start:number;end:number};
type Ctx={text:string;rule:ComplianceRule;sentence:Span;line:Span;part:Span;opts:ComplianceFixOptions};
type Draft={kind:ComplianceFixKind;range:FixRange;after:string;rationale:string;needsCheck:boolean;anchor:number};
const MAX_HITS=12,MAX_FIXES=50;

// ── 위치 계산(원문 오프셋) ──
const lineAt=(text:string,pos:number):Span=>{const start=text.lastIndexOf('\n',pos-1)+1,nl=text.indexOf('\n',pos);return {start,end:nl<0?text.length:nl}};
// 채점기의 문장 나누기와 같다: 문장부호 뒤 공백에서 끊는다. 끝 공백은 문장에 넣지 않는다.
function sentenceAt(text:string,at:number):Span{
 const line=lineAt(text,at),stop=/[.?!](?=\s)/g;stop.lastIndex=at;
 const m=stop.exec(text);let end=m&&m.index<line.end?m.index+1:line.end;
 while(end>at&&/\s/.test(text[end-1]))end--;
 return {start:at,end};
}
const MARKERS=/^[ \t]*(?:#{1,6}[ \t]+)?(?:(?:[-*•]|\d+[.)])[ \t]+|>[ \t]*)*[“"‘']?/;
const contentStart=(text:string,line:Span)=>line.start+(MARKERS.exec(text.slice(line.start,line.end))?.[0].length??0);
const isHeading=(line:string)=>/^#{1,6}\s/.test(line);
const isRule=(line:string)=>/^\s*(?:-{3,}|\*{3,})\s*$/.test(line);
// 단락(채점기 partOf): 제목 줄(#~######)과 구분선(---)이 경계다. 제목 줄은 자기 단락의 첫 줄이다.
function partAt(text:string,pos:number):Span{
 let start=0,end=text.length,offset=0;
 for(const line of text.split('\n')){
  const ls=offset,le=offset+line.length;offset=le+1;
  if(isHeading(line)){if(ls<=pos)start=ls;else{end=Math.min(end,ls);break}}
  else if(isRule(line)){if(le<pos)start=le+1;else if(ls>pos){end=Math.min(end,ls);break}}
 }
 return {start,end};
}
// 단락 안의 마지막 글자 바로 뒤(끝 공백·빈 줄 앞).
function contentEnd(text:string,span:Span){let end=span.end;while(end>span.start&&/\s/.test(text[end-1]))end--;return end}
// pos가 든 문단(빈 줄·제목 전까지)의 마지막 줄 끝.
function paragraphEnd(text:string,pos:number,limit:number){
 let line=lineAt(text,pos);
 while(line.end<limit){const next=lineAt(text,line.end+1);if(!text.slice(next.start,next.end).trim()||isHeading(text.slice(next.start,next.end))||next.start>=limit)break;line=next}
 return line.end;
}
// pos 다음 줄부터 단락 안에서 처음 나오는 비어 있지 않은 줄(제목 제외)의 본문 시작. 없으면 -1.
function nextContentStart(text:string,pos:number,limit:number){
 let line=lineAt(text,pos);
 while(line.end<limit){line=lineAt(text,line.end+1);const body=text.slice(line.start,line.end);if(isHeading(body)||line.start>=limit)return -1;if(body.trim())return contentStart(text,line)}
 return -1;
}

// ── 규칙별 고침 ──
const BLOG=/블로그|포스팅|카페\s?(?:글|게시)|브런치/;
const LABEL_COLON=/(?:초안|문안|내용)\s*[:：]\s*/;
// 채점기 DRAFT_LABEL·LABEL_TAIL과 같은 라벨: '문자 초안', '## 알림톡 발송 문안 B'(뒤 두 글자 이하 허용).
const LABEL_END=/(?:초안|문안|내용)(?:\s*[A-Za-z0-9가-힣]{1,2})?\s*[:：]?\s*$/;
// 메시지 본문이 시작하는 자리: '문자 초안: …'이면 콜론 뒤, 라벨만 있는 줄이면 다음 줄, 아니면 그 줄 본문 시작.
function messageStart(c:Ctx){
 const s=c.text.slice(c.sentence.start,c.sentence.end),colon=LABEL_COLON.exec(s);
 if(colon){const at=c.sentence.start+colon.index+colon[0].length;if(at<c.line.end&&c.text.slice(at,c.line.end).trim())return at;return nextContentStart(c.text,c.line.start,c.part.end)}
 if(LABEL_END.test(s))return nextContentStart(c.text,c.line.start,c.part.end);
 return contentStart(c.text,c.line);
}
// 문장 지우기: 줄 본문 전체면 줄을 지우고(앞 줄바꿈 포함), 아니면 문장과 뒤 공백(줄 끝이면 앞 공백)을 지운다.
function removal(c:Ctx):FixRange{
 const {text,sentence:s,line}=c,lineContentEnd=contentEnd(text,line);
 if(s.start<=contentStart(text,line)&&s.end>=lineContentEnd)return line.start>0?{start:line.start-1,end:line.end}:{start:0,end:Math.min(text.length,line.end+1)};
 let end=s.end;while(end<line.end&&/[ \t]/.test(text[end]))end++;
 if(end<lineContentEnd)return {start:s.start,end};
 let start=s.start;while(start>line.start&&/[ \t]/.test(text[start-1]))start--;
 return {start,end:s.end};
}
const terminal=(text:string,s:Span)=>/[.?!]/.test(text[s.end-1]??'')?s.end-1:s.end;
function firstMatch(c:Ctx){
 const s=c.text.slice(c.sentence.start,c.sentence.end),m=new RegExp(c.rule.match).exec(s);
 return m?{start:c.sentence.start+m.index,end:c.sentence.start+m.index+m[0].length,text:m[0]}:null;
}
const at=(pos:number)=>({start:pos,end:pos});
// 문장 안의 첫 매치부터 마지막 매치까지를 바꾸되 매치만 자리표시로 바꾼다(사이의 글은 그대로 둔다).
function claimReplacement(c:Ctx,placeholder:string,rationale:string):Draft|null{
 const s=c.text.slice(c.sentence.start,c.sentence.end),all=[...s.matchAll(new RegExp(c.rule.match,'g'))].filter(m=>m[0]);
 if(!all.length)return null;
 const from=all[0].index!,to=all[all.length-1].index!+all[all.length-1][0].length;
 return {kind:'replace',range:{start:c.sentence.start+from,end:c.sentence.start+to},after:s.slice(from,to).replace(new RegExp(c.rule.match,'g'),m=>m?placeholder:m),needsCheck:true,anchor:c.sentence.start,rationale};
}
const FIXERS:Readonly<Record<string,(c:Ctx)=>Draft|null>>={
 sponsorship_undisclosed:c=>{
  const blog=BLOG.test(c.text.slice(c.part.start,c.part.end)),pos=contentStart(c.text,c.line);
  return {kind:'insert',range:at(pos),after:blog?'[광고] ':'#광고 ',needsCheck:false,anchor:c.part.start,
   rationale:`추천·보증 심사지침: 협찬·대가 관계는 소비자가 바로 알아보도록 게시물 첫머리에 표시합니다. ${blog?'블로그 글은 [광고]':'SNS 캡션은 #광고'} 표기를 이 문장 앞에 넣습니다.`};
 },
 disclosure_omitted:c=>{
  const m=firstMatch(c);if(!m)return null;
  const ai=/^AI/.test(m.text);
  return {kind:'replace',range:{start:m.start,end:terminal(c.text,c.sentence)},after:ai?'AI 생성 표시를 게시물에 넣는다':'‘#광고’ 표기를 게시물 첫머리에 넣는다',needsCheck:false,anchor:c.sentence.start,
   rationale:'광고·AI 표시를 빼라는 지시는 표시 의무와 충돌합니다. 지시 부분을 표시를 넣는 문장으로 바꿉니다.'};
 },
 virtual_person_undisclosed:c=>({kind:'append',range:at(contentEnd(c.text,c.part)),after:'\n'+VIRTUAL_PERSON_LINE,needsCheck:false,anchor:c.part.start,
  rationale:'가상인물이 추천·보증하면 가상인물임을 밝혀야 합니다(추천·보증 심사지침). 앱의 가상인물 표시 문구를 이 단락 끝에 붙입니다.'}),
 ai_generated_unlabeled:c=>({kind:'append',range:at(contentEnd(c.text,c.part)),after:`\nAI 생성 표시: ${AI_IMAGE_VISIBLE_LABEL}`,needsCheck:true,anchor:c.part.start,
  rationale:'AI로 만든 이미지·영상·음성에는 사람이 알아볼 수 있는 AI 생성 표시를 둡니다(AI 기본법 제31조). 앱의 가시 표시 라벨을 단락 끝에 붙입니다. 라벨 문구는 대표·법률 검토 전 초안입니다.'}),
 ad_label_missing:c=>{
  const pos=messageStart(c);if(pos<0)return null;
  return {kind:'insert',range:at(pos),after:'(광고) ',needsCheck:false,anchor:c.part.start,rationale:"광고성 정보를 보내는 메시지는 본문 첫머리를 '(광고)'로 시작합니다(정보통신망법 제50조④)."};
 },
 optout_missing:c=>{
  const start=messageStart(c);if(start<0)return null;
  const sender=c.opts.senderName?.trim()||SENDER_PLACEHOLDER;
  return {kind:'append',range:at(paragraphEnd(c.text,start,c.part.end)),after:`\n전송자: ${sender}, 무료 수신거부 ${OPTOUT_PLACEHOLDER} [확인 필요]`,needsCheck:true,anchor:c.part.start,
   rationale:'광고성 메시지에는 전송자 명칭과 무료 수신거부 방법을 적습니다(정보통신망법 제50조④). 080 번호는 실제 번호로 바꿔야 하므로 확인 필요로 둡니다.'};
 },
 disease_claim:c=>({kind:'remove',range:removal(c),after:'',needsCheck:false,anchor:c.sentence.start,
  rationale:'식품에는 질병 예방·치료 효능을 표시하거나 광고할 수 없습니다(식품표시광고법 제8조). 고쳐 쓸 근거가 없어 문장을 지웁니다.'}),
 drug_claim:c=>({kind:'remove',range:removal(c),after:'',needsCheck:false,anchor:c.sentence.start,
  rationale:'화장품을 의약품으로 잘못 알게 하는 표현은 쓸 수 없습니다(화장품법 제13조). 문장을 지웁니다.'}),
 'kr.fr.revenue_guarantee':c=>({kind:'remove',range:removal(c),after:'',needsCheck:false,anchor:c.sentence.start,
  rationale:'가맹 모집에서 수익·매출 보장 표현은 허위·과장 정보입니다(가맹사업법 제9조). 규칙에 정해진 대체 문장이 없어 문장만 지웁니다.'}),
 'kr.fr.superlative_claims':c=>claimReplacement(c,CLAIM_PLACEHOLDER,'순위·최상급 표현은 객관적 근거가 확정 사실로 있을 때만 씁니다. 근거가 없어 표현을 지우고 확인 필요 표시로 바꿉니다.'),
 // QA N7 일반 표시·광고 규칙: 최상급은 근거 자리표시로 바꾸고, 효과·수익·매출 보장 문장은 지운다.
 'kr.ad.superlative_unsupported':c=>claimReplacement(c,CLAIM_BASIS_PLACEHOLDER,'최고·1위·최초·유일 같은 배타적 절대 표현은 객관적 근거로 입증될 때만 씁니다(부당 표시·광고 지정고시 Ⅲ.14.나). 확정 근거가 없어 표현을 확인 필요 표시로 바꿉니다.'),
 'kr.ad.outcome_guarantee':c=>({kind:'remove',range:removal(c),after:'',needsCheck:false,anchor:c.sentence.start,
  rationale:'효과·수익·매출을 보장한다는 표현은 실증할 수 없는 거짓·과장 광고가 될 수 있습니다(표시광고법 제3조). 고쳐 쓸 근거가 없어 문장을 지웁니다.'}),
};
export const FIXABLE_RULE_IDS=Object.freeze(Object.keys(FIXERS));
export const hasFixer=(ruleId:string)=>Object.hasOwn(FIXERS,ruleId);

// ── 겹침 판정과 적용 ──
// 두 범위가 겹치면 충돌이다. 넣기(빈 범위)는 다른 범위의 안쪽(양 끝 제외)에 있을 때만 충돌한다. 같은 자리의 넣기 여러 개는 순서대로 들어간다.
function conflicts(a:FixRange,b:FixRange){
 const az=a.start===a.end,bz=b.start===b.end;
 if(az&&bz)return false;
 if(az)return b.start<a.start&&a.start<b.end;
 if(bz)return a.start<b.start&&b.start<a.end;
 return a.start<b.end&&b.start<a.end;
}
const KIND_ORDER:Record<ComplianceFixKind,number>={remove:0,replace:1,insert:2,append:3};
const byPosition=<T extends {range:FixRange}>(list:readonly T[])=>list.map((f,i)=>({f,i})).toSorted((x,y)=>x.f.range.start-y.f.range.start||x.f.range.end-y.f.range.end||x.i-y.i).map(x=>x.f);
export function overlappingFixes(fixes:readonly Pick<ComplianceFix,'id'|'range'>[]):string[]{
 const out=new Set<string>();
 fixes.forEach((a,i)=>fixes.slice(i+1).forEach(b=>{if(conflicts(a.range,b.range)){out.add(a.id);out.add(b.id)}}));
 return [...out];
}
// 고른 고침을 원문에 적용한 새 글을 돌려준다. 원문 범위가 before와 다르거나(다른 본문) 범위가 겹치면 예외다. 입력을 바꾸지 않는다.
export function applyComplianceFixes(text:string,fixes:readonly Pick<ComplianceFix,'id'|'range'|'before'|'after'>[]):string{
 if(overlappingFixes(fixes).length)throw new ComplianceFixConflictError('겹치는 수정 제안은 함께 적용할 수 없습니다.');
 for(const f of fixes)if(f.range.start<0||f.range.end>text.length||f.range.start>f.range.end||text.slice(f.range.start,f.range.end)!==f.before)throw new ComplianceFixConflictError('수정 제안이 본문과 맞지 않습니다. 다시 점검한 뒤 고르세요.');
 let out='',cursor=0;
 for(const f of byPosition(fixes)){out+=text.slice(cursor,f.range.start)+f.after;cursor=f.range.end}
 return out+text.slice(cursor);
}
function previewOf(text:string,range:FixRange,after:string){
 const from=lineAt(text,range.start).start,to=lineAt(text,range.end).end;
 return {before:text.slice(from,to),after:text.slice(from,range.start)+after+text.slice(range.end,to)};
}

// ── 제안 만들기 ──
const blank=(text:string,s:Span)=>text.slice(0,s.start)+' '.repeat(s.end-s.start)+text.slice(s.end);
// 규칙의 걸린 문장들(원문 오프셋). 첫 문장을 가리고 다시 채점해 다음 문장을 찾는다. 발췌를 찾지 못하면(표 칸 비우기 등) 멈춘다.
function hitSentences(text:string,ruleId:string,opts:ComplianceFixOptions):Span[]{
 const out:Span[]=[];let masked=text;
 for(let i=0;i<MAX_HITS;i++){
  const issue=checkCompliance(masked,opts).issues.find(x=>x.ruleId===ruleId&&x.severity!=='info');
  const pos=issue?.excerpt?masked.indexOf(issue.excerpt):-1;
  if(pos<0)break;
  const s=sentenceAt(text,pos);if(s.end<=s.start)break;
  out.push(s);masked=blank(masked,s);
 }
 return out;
}
const ruleOf=(id:string)=>COMPLIANCE_LEXICON.rules.find(r=>r.id===id);
// 원문과 옵션이 같으면 결과(고침 id 포함)도 같다. 서버는 저장 본문으로 다시 계산해 화면이 고른 id만 적용한다.
export function computeComplianceFixes(text:string,opts:ComplianceFixOptions={}):ComplianceFix[]{
 const hit=new Set(checkCompliance(text,opts).issues.filter(i=>i.severity!=='info'&&hasFixer(i.ruleId)).map(i=>i.ruleId));
 const drafts:{rule:ComplianceRule;draft:Draft}[]=[];
 for(const id of FIXABLE_RULE_IDS){
  const rule=ruleOf(id);if(!rule||!hit.has(id))continue;
  const anchors=new Set<number>();
  for(const sentence of hitSentences(text,id,opts)){
   const draft=FIXERS[id]({text,rule,sentence,line:lineAt(text,sentence.start),part:partAt(text,sentence.start),opts});
   if(!draft||anchors.has(draft.anchor))continue;
   anchors.add(draft.anchor);drafts.push({rule,draft});
  }
 }
 // 겹치면 지우기 → 바꾸기 → 넣기 → 붙이기 순으로 앞선 고침을 남긴다(남은 표현은 적용 뒤 다시 점검하면 다시 제안된다).
 const kept:typeof drafts=[];
 for(const d of drafts.map((d,i)=>({d,i})).toSorted((x,y)=>KIND_ORDER[x.d.draft.kind]-KIND_ORDER[y.d.draft.kind]||x.d.draft.range.start-y.d.draft.range.start||x.i-y.i).map(x=>x.d)){
  if(kept.length>=MAX_FIXES)break;
  if(!kept.some(k=>conflicts(k.draft.range,d.draft.range)))kept.push(d);
 }
 return byPosition(kept.map(({rule,draft})=>({id:`${rule.id}@${draft.range.start}-${draft.range.end}`,ruleId:rule.id,kind:draft.kind,range:draft.range,before:text.slice(draft.range.start,draft.range.end),after:draft.after,
  rationale:draft.rationale,sources:[...rule.sources],needsCheck:draft.needsCheck,preview:previewOf(text,draft.range,draft.after)})));
}
