import {archiveCategories,type ArchiveCategory} from './archive';
import {roleOutputContract} from './role-output';
import type {MeetingPhase} from './meetings';

// 입력 축소(PR 4b, 감사 ai-quality-9 ②~④·loop-10): 스위치 input_diet가 켜진 제출만 쓰는 순수 변환이다. 모델 호출·서버 의존·저장 없음.
// 꺼져 있으면 조립 함수(lib/role-instruction.ts·lib/meeting-input.ts·lib/brief-input.ts)가 이 모듈의 변환을 부르지 않아 제출 바이트가 이전과 같다.
// 설계 근거: B5 맥락 정책 리플레이(#64, 1fc49be의 docs/CONTEXT-REPLAY.ko.md) P1 메타 제거·P2 섹션별 예산·P3 회의 단계별 축소·P4 아카이브 카테고리 선택.
// 지시문(instructions)은 바꾸지 않는다. 근거 규율·사실 정책·출력 계약·확정 사실(evidence.facts)·factPolicy는 줄이지 않는다.
export const INPUT_DIET_VERSION='input-diet-v1';
export type InputDietOptions={inputDiet?:boolean};

// ── ② 프롬프트용 캠페인 메타 제거: 초안 메타(draftMeta: plan 사본·가정·질문·사용 맥락)·상태·시각. 예산 표시는 aiBudget이 원 레코드로 계산하므로 budgetConfirmedAt도 뺀다 ──
export const CAMPAIGN_DIET_KEYS=['draftMeta','status','derivedStatus','statusReason','createdAt','updatedAt','budgetConfirmedAt'] as const;
export function dietCampaign<T extends object>(c:T):T{return Object.fromEntries(Object.entries(c).filter(([k])=>!(CAMPAIGN_DIET_KEYS as readonly string[]).includes(k))) as T}

// ── 섹션: 코드 블록 밖 마크다운 제목으로 나눈다(B5 splitSections와 같은 규칙). 경계 수준은 제목이 2개 이상인 가장 얕은 수준이되 역할 계약 제목(## )보다 얕게 잡지 않는다 ──
type Section={title:string;text:string};
type Heading={level:number;title:string;at:number};
function headings(content:string):Heading[]{
 return content.split('\n').reduce<{list:Heading[];fence:string;at:number}>((acc,line)=>{
  const at=acc.at+line.length+1;
  if(acc.fence){const close=/^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(line)?.[1];return {...acc,at,fence:close&&close[0]===acc.fence[0]&&close.length>=acc.fence.length?'':acc.fence}}
  const open=/^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line)?.[1];if(open)return {...acc,at,fence:open};
  const m=/^(#{1,6})[ \t]+\S/.exec(line);
  return {...acc,at,list:m?[...acc.list,{level:m[1].length,title:line.replace(/^#+[ \t]+/,'').trim(),at:acc.at}]:acc.list};
 },{list:[],fence:'',at:0}).list;
}
function boundaryLevel(hs:Heading[]){
 const levels=[...new Set(hs.map(h=>h.level))].sort((a,b)=>a-b),repeated=levels.find(l=>hs.filter(h=>h.level===l).length>=2);
 return repeated===undefined?levels[levels.length-1]:Math.max(2,repeated);
}
// 첫 제목 앞 머리말은 제목 '' 섹션이다. text를 이으면 원문과 같다.
export function splitSections(content:string):Section[]{
 const hs=headings(content);
 if(!hs.length)return content?[{title:'',text:content}]:[];
 const level=boundaryLevel(hs),starts=hs.filter(h=>h.level<=level),bounds=[...(starts[0].at>0?[{title:'',at:0}]:[]),...starts];
 return bounds.map((b,i)=>({title:b.title,text:content.slice(b.at,bounds[i+1]?.at??content.length)}));
}
const CUT=' …';
const headingLine=(s:Section)=>s.title?s.text.split('\n',1)[0]:'';
const sectionHasBody=(s:Section)=>{const nl=s.text.indexOf('\n');return s.title?nl>=0&&!!s.text.slice(nl+1).trim():!!s.text.trim()};
// 섹션을 budget자로 줄이고 표시(' …')를 붙인다. 제목 줄은 남기고 잘린 하위 제목 조각은 버린다. 짧아지지 않으면 그대로 둔다.
function trimSection(s:Section,budget:number,last:boolean){
 if(s.text.length<=budget)return s.text;
 const head=s.text.slice(0,Math.max(budget,headingLine(s).length)),body=head.includes('\n')?head.replace(/\n#[^\n]*$/,''):head;
 const out=body.trimEnd()+CUT+(last?'':'\n\n');
 return out.length<s.text.length?out:s.text;
}
const headingOnly=(s:Section,last:boolean)=>{const out=headingLine(s)+(last||!s.title?'':'\n\n');return out.length<s.text.length?out:s.text};

// ── ③ 선행 작업물 섹션별 예산: 앞부분 절단(역할 6,000/품질 24,000자, 회의 원본 8,000자) 대신 같은 총량을 섹션에 나눠 모든 섹션(마지막 추가 자료 요청·산식·적용 규칙까지)을 싣는다 ──
// 나누기는 물 채우기다: 몫보다 짧은 섹션은 그대로 두고 남은 예산을 긴 섹션에 고르게 나눈다(섹션당 최소 MIN_SECTION자). 한도 이하 본문은 그대로다.
export const MIN_SECTION=300;
function sectionCap(lengths:number[],limit:number){
 const sorted=[...lengths].sort((a,b)=>a-b);
 const found=sorted.reduce<{left:number;cap:number|null}>((acc,len,k)=>acc.cap!==null?acc:len<=Math.floor(acc.left/(sorted.length-k))?{left:acc.left-len,cap:null}:{left:acc.left,cap:Math.floor(acc.left/(sorted.length-k))},{left:limit,cap:null});
 return Math.max(MIN_SECTION,found.cap??limit);
}
export function sectionExcerpt(content:string,limit:number){
 if(content.length<=limit)return content;
 const sections=splitSections(content),cap=sectionCap(sections.map(s=>s.text.length),limit);
 return sections.map((s,i)=>trimSection(s,cap,i===sections.length-1)).join('');
}

// ── ④ 회의 의견 교환용 요약: 첫 본문 섹션(요약)과 역할 계약의 인계 섹션만 본문을 남기고 나머지 섹션은 제목 줄만 남긴다(B5 P3) ──
export const SUMMARY_CHARS=1000,HANDOFF_CHARS=1500;
// 인계 섹션: 계약 제목이 다음 담당에게 넘기는 내용(추가 자료 요청·미확정 목록·다음 실험 연결)인 역할만 있다. 나머지 역할은 요약만 남는다.
export const HANDOFF_SECTIONS:Readonly<Record<string,string|null>>={cmo:'output_3',insight:'output_3',strategy:null,creative:null,content:null,growth:null,data:'output_4',quality:null};
function handoffTitle(role:unknown):string|null{
 const id=typeof role==='string'&&Object.hasOwn(HANDOFF_SECTIONS,role)?HANDOFF_SECTIONS[role]:null;
 return id?roleOutputContract(role as string).sections.find(s=>s.id===id)?.title??null:null;
}
export function discussionDigest(content:string,role:unknown){
 const title=handoffTitle(role),sections=splitSections(content),last=sections.length-1,summary=sections.findIndex(sectionHasBody);
 return sections.map((s,i)=>i<summary?s.text:i===summary?trimSection(s,SUMMARY_CHARS,i===last):title!==null&&s.title===title?trimSection(s,HANDOFF_CHARS,i===last):headingOnly(s,i===last)).join('');
}
// 회의 원본 작업물(originalArtifacts 원소, 본문은 8,000자 상한 전 원문)의 단계별 모양. 의견 교환은 요약·인계, 품질 재검토는 id·버전·길이만, 합의·개선은 섹션별 예산.
export const MEETING_ORIGINAL_LIMIT=8000;
type Piece={ref?:unknown;id?:unknown;role?:unknown;version?:unknown;content:string;excerpt?:unknown};
export function meetingOriginal<T extends Piece>(a:T,full:string,phase:MeetingPhase):T|{ref?:unknown;id?:unknown;role?:unknown;version?:unknown;length:number}{
 if(phase==='quality')return {ref:a.ref,id:a.id,role:a.role,version:a.version,length:full.length};
 const content=phase==='discussion'?discussionDigest(full,a.role):sectionExcerpt(full,MEETING_ORIGINAL_LIMIT);
 return {...a,content,excerpt:content!==full};
}

// ── loop-10 아카이브 digest: 확정 자료 본문을 요약(앞 SOURCE_SUMMARY_CHARS자, 문장 경계)으로 바꾸고 역할에 필요한 카테고리만 싣는다(B5 P4) ──
// 결정론이고 저장하지 않는다: 같은 아카이브 revision·같은 자료면 같은 digest다. revision이나 자료가 바뀌면 조립 때 새로 만들어 옛 digest를 쓸 일이 없다.
// 출처 id·ref·제목·카테고리·URL·확인 시점·범위·버전은 그대로 둔다. 뺀 자료 수는 omittedSources·omittedObservations에 더한다.
export const SOURCE_SUMMARY_CHARS=800;
// 역할별 자료 카테고리(근거: 역할 계약 섹션 제목, B5 표). 미분류(other)는 모든 역할에 남기고, 품질 검수는 전체를 본다.
export const ROLE_ARCHIVE_CATEGORIES:Readonly<Record<string,readonly ArchiveCategory[]>>={
 cmo:['brand','product','customer','market','performance','operations','other'],
 insight:['brand','product','customer','market','other'],
 strategy:['brand','product','customer','market','channel','other'],
 creative:['brand','product','customer','channel','other'],
 content:['brand','product','channel','operations','other'],
 growth:['product','customer','channel','performance','operations','other'],
 data:['channel','performance','operations','other'],
 quality:Object.keys(archiveCategories) as ArchiveCategory[],
};
export function sourceSummary(content:string){
 if(content.length<=SOURCE_SUMMARY_CHARS)return content;
 const head=content.slice(0,SOURCE_SUMMARY_CHARS),end=Math.max(head.lastIndexOf('\n'),...['. ','다. ','다.\n','요. '].map(p=>{const i=head.lastIndexOf(p);return i<0?-1:i+p.trimEnd().length}));
 return (end>=SOURCE_SUMMARY_CHARS/2?head.slice(0,end):head).trimEnd()+CUT;
}
type ArchiveLike={revision?:number;confirmedSources?:object[];observations?:object[];omittedSources?:number;omittedObservations?:number};
export type DigestReport={revision:number|null;sources:number;sourcesOmitted:number;observations:number;observationsOmitted:number;summarized:number};
const categoryOf=(s:object)=>{const c=(s as {category?:unknown}).category;return typeof c==='string'&&Object.hasOwn(archiveCategories,c)?c as ArchiveCategory:'other'};
const bump=<N>(n:N,by:number):N=>(typeof n==='number'?n+by:n) as N;
// role: 역할 id(회의 단계의 역할 포함). null이면 카테고리를 거르지 않는다(브리프 초안).
export function archiveDigest<T extends ArchiveLike>(archive:T,role:string|null):{archive:T;report:DigestReport}{
 const allowed=role&&Object.hasOwn(ROLE_ARCHIVE_CATEGORIES,role)?ROLE_ARCHIVE_CATEGORIES[role]:null;
 const sources=archive.confirmedSources||[],kept=allowed?sources.filter(s=>allowed.includes(categoryOf(s))):sources;
 const summarized=kept.map(s=>{const c=(s as {content?:unknown}).content;if(typeof c!=='string')return s;const summary=sourceSummary(c);return summary===c?s:{...s,content:summary,excerpt:true}});
 const dropObservations=!!allowed&&!allowed.includes('channel')&&!allowed.includes('performance'),observations=archive.observations||[];
 const next={...archive,...(archive.confirmedSources?{confirmedSources:summarized,omittedSources:bump(archive.omittedSources,sources.length-kept.length)}:{}),...(archive.observations&&dropObservations?{observations:[],omittedObservations:bump(archive.omittedObservations,observations.length)}:{})};
 return {archive:next,report:{revision:typeof archive.revision==='number'?archive.revision:null,sources:kept.length,sourcesOmitted:sources.length-kept.length,observations:dropObservations?0:observations.length,observationsOmitted:dropObservations?observations.length:0,summarized:summarized.filter((s,i)=>s!==kept[i]).length}};
}

// ── loop-10 입력 상한: 조립 뒤 추정 토큰이 상한을 넘으면 브랜드 자료(뒤에서부터)·채널 관찰 순으로 빼고 뺀 수를 brandArchive에 표시한다 ──
// 추정은 lib/token-budget.ts estimateInputTokens와 같은 식이고, 상한은 lib/graders/ledger.ts INPUT_TOKEN_CAP·MEETING_INPUT_TOKEN_CAP과 같은 값이다(테스트가 대조한다).
// 사실(evidence)·factPolicy·과제·출력 계약·작업물은 빼지 않는다. 자료를 다 빼도 넘으면 그대로 보낸다(상한은 입력측 추정이고 전송을 막지 않는다).
export const ROLE_INPUT_TOKEN_CAP=32000,MEETING_INPUT_TOKEN_CAP=64000;
export const estimateTokens=(text:string)=>Math.max(Math.ceil(text.length/2),Math.ceil(new TextEncoder().encode(text).length/3));
export type CapReport={cap:number;sources:number;observations:number};
export function capInput<T extends {brandArchive?:unknown}>(raw:T,cap:number):{value:T;report:CapReport}{
 const over=(v:T)=>estimateTokens(JSON.stringify(v))>cap,start=raw.brandArchive as ArchiveLike|undefined;
 if(!start||!over(raw))return {value:raw,report:{cap,sources:0,observations:0}};
 const trim=(a:ArchiveLike,sources:number,observations:number):ArchiveLike=>{
  const s=a.confirmedSources||[],o=a.observations||[];
  return {...a,...(a.confirmedSources?{confirmedSources:s.slice(0,s.length-sources),omittedSources:bump(a.omittedSources,sources)}:{}),...(a.observations?{observations:o.slice(0,o.length-observations),omittedObservations:bump(a.omittedObservations,observations)}:{}),...(sources||observations?{inputCapOmitted:{sources,observations}}:{})};
 };
 const steps=[...Array.from({length:(start.confirmedSources||[]).length},(_,i)=>[i+1,0]),...Array.from({length:(start.observations||[]).length},(_,i)=>[(start.confirmedSources||[]).length,i+1])];
 const hit=steps.find(([s,o])=>!over({...raw,brandArchive:trim(start,s,o)}))??steps[steps.length-1];
 return hit?{value:{...raw,brandArchive:trim(start,hit[0],hit[1])},report:{cap,sources:hit[0],observations:hit[1]}}:{value:raw,report:{cap,sources:0,observations:0}};
}

// ── ① 입력 문자 수 분해(스위치와 무관하게 기록): 제출 입력 JSON 최상위 키마다 '"키":값' 조각의 문자 수. 원문은 담지 않는다 ──
// 키 이름은 형식 검사를 통과한 것만 쓰고 나머지는 '(기타)'로 합친다. JSON 객체가 아니면 total만 있다.
export type InputChars={total:number;instructions?:number;byKey?:Record<string,number>};
const KEY_NAME=/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
export function inputChars(input:string,instructions?:string):InputChars{
 const base={total:input.length,...(typeof instructions==='string'?{instructions:instructions.length}:{})};
 let parsed:unknown;try{parsed=JSON.parse(input)}catch{return base}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return base;
 const byKey=Object.entries(parsed).reduce<Record<string,number>>((acc,[k,v])=>{const name=KEY_NAME.test(k)?k:'(기타)',n=JSON.stringify(k).length+1+(JSON.stringify(v)?.length??0);return {...acc,[name]:(acc[name]||0)+n}},{});
 return {...base,byKey};
}
// 실행 기록(role_output_contract·회의 단계·브리프 초안)의 inputDiet 요약. 켜진 제출에만 붙는다.
export type InputDietReport={version:typeof INPUT_DIET_VERSION;archive:DigestReport|null;cap:CapReport};
