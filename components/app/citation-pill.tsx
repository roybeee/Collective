'use client';
import {memo} from 'react';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {Button} from '@/components/ui/button';
import {MetaLine} from './meta-line';
import {parseCitations,textLines,splitSentences,isClaimSentence,hasCheckFlag,type CitationRef} from '@/lib/citation-refs';
import {SOURCE_KIND_LABELS,type CitationSource} from '@/lib/artifact-sources';

// X7 인라인 인용 pill(docs/GLOBAL-PLAN.ko.md 에픽 X7). 본문의 ref 라벨('브랜드 자료 #3'·'확정 사실 주소'·외부 주소)을 짧은 이름 버튼으로 바꾸고,
// 누르면(Enter·Space 포함) 출처 종류·제목·확인일·유효기한과 열기 링크를 팝오버로 보인다. Esc로 닫으면 포커스가 pill로 돌아간다(Radix Popover).
// 출처 종류는 글자로 적는다(색만으로 구분하지 않는다). 외부 주소는 새 창(rel=noopener noreferrer)으로, 내 브랜드 자료·확정 사실은 브랜드 아카이브 탭으로 연다.
export type OpenArchive=(brandId:string,tab:'sources'|'facts')=>void;
const day=(iso:string|null|undefined)=>{if(!iso)return null;const d=new Date(iso);return Number.isNaN(d.getTime())?null:d.toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})};
const archiveTab=(kind:CitationRef['kind'])=>kind==='fact'?'facts' as const:kind==='archive'||kind==='observation'||kind==='diagnosis'?'sources' as const:null;

function SourceLink({citation,source,brandId,onOpenArchive}:{citation:CitationRef;source?:CitationSource;brandId?:string;onOpenArchive?:OpenArchive}){
 const external=citation.url??source?.url??null,tab=archiveTab(citation.kind),brand=source?.brandId??brandId;
 if(citation.kind==='external'&&external)return <a className="citation-link" href={external} target="_blank" rel="noopener noreferrer">원문 열기 ({citation.short})</a>;
 if(tab&&brand&&onOpenArchive)return <Button type="button" variant="link" size="sm" className="citation-link" onClick={()=>onOpenArchive(brand,tab)}>브랜드 아카이브에서 열기</Button>;
 return external?<a className="citation-link" href={external} target="_blank" rel="noopener noreferrer">원문 열기</a>:null;
}
export function CitationPill({citation,source,brandId,onOpenArchive}:{citation:CitationRef;source?:CitationSource;brandId?:string;onOpenArchive?:OpenArchive}){
 const kind=SOURCE_KIND_LABELS[citation.kind],missing=citation.kind!=='external'&&!source?.found;
 return <Popover>
  <PopoverTrigger asChild><Button type="button" variant="outline" size="xs" className="citation-pill" data-kind={citation.kind} aria-label={`인용 ${citation.label}, ${kind} 출처 보기`}>{citation.short}</Button></PopoverTrigger>
  <PopoverContent className="citation-popover" aria-label={`${citation.label} 출처`}>
   <p className="citation-kind">{kind}{citation.kind==='external'?` (${citation.short})`:''}</p>
   <h4>{source?.title??citation.label}</h4>
   {source?.value&&<p>값: {source.value}</p>}
   <MetaLine items={[day(source?.observedAt)&&`${citation.kind==='fact'?'확인일':'수집일'} ${day(source?.observedAt)}`,day(source?.validUntil)&&`유효기한 ${day(source?.validUntil)}`,citation.label!==source?.title&&citation.label]}/>
   {missing&&<p className="citation-missing">실행 기록에서 원본을 찾지 못했습니다. 브랜드 아카이브에서 직접 확인하세요.</p>}
   <SourceLink citation={citation} source={source} brandId={brandId} onOpenArchive={onOpenArchive}/>
  </PopoverContent>
 </Popover>;
}
// 문장 하나: 글자·인용 조각과, 인용이 없는 주장 문장 끝의 '근거 없음' 표시(showMissing일 때만, [확인 필요] 표지가 있는 문장은 이미 표시돼 있어 붙이지 않는다).
function Sentence({text,factKeys,refs,brandId,showMissing,onOpenArchive}:{text:string;factKeys:readonly string[];refs:Record<string,CitationSource>;brandId?:string;showMissing:boolean;onOpenArchive?:OpenArchive}){
 const segments=parseCitations(text,factKeys),cited=segments.some(s=>s.type==='ref');
 const mark=showMissing&&!cited&&isClaimSentence(text)&&!hasCheckFlag(text);
 return <>{segments.map((s,i)=>s.type==='ref'?<CitationPill key={i} citation={s.ref} source={refs[s.ref.key]} brandId={brandId} onOpenArchive={onOpenArchive}/>:<span key={i}>{s.text}</span>)}{mark&&<small className="no-evidence">근거 없음</small>}</>;
}
// RichText(app/panels.tsx)와 같은 줄 규칙으로 그리되 인용을 pill로 바꾼다.
// 상세 대화상자가 검토 의견을 칠 때마다 본문을 다시 나누지 않도록 memo로 감싼다(넘기는 값은 부모가 고정한다).
const NO_KEYS:readonly string[]=[],NO_REFS:Record<string,CitationSource>={};
export const CitedText=memo(function CitedText({text,factKeys=NO_KEYS,refs=NO_REFS,brandId,showMissing=false,onOpenArchive}:{text:string;factKeys?:readonly string[];refs?:Record<string,CitationSource>;brandId?:string;showMissing?:boolean;onOpenArchive?:OpenArchive}){
 return <div className="rich-text cited-text">{textLines(text).map((line,i)=>{
  if(line.kind==='heading')return <h3 key={i}>{line.text}</h3>;
  if(line.kind==='gap')return <div className="text-gap" key={i}/>;
  return <p className={line.kind==='bullet'?'text-bullet':''} key={i}>{splitSentences(line.text).map((s,j)=><Sentence key={j} text={s} factKeys={factKeys} refs={refs} brandId={brandId} showMissing={showMissing} onOpenArchive={onOpenArchive}/>)}</p>;
 })}</div>;
});
