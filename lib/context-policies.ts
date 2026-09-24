import {archiveCategories,type ArchiveCategory} from './archive';
import {phaseNames,type MeetingPhase} from './meetings';
import {roleOutputContract} from './role-output';

// B5 맥락 정책 리플레이의 후보 정책(순수 함수, 모델 호출 없음). 저장된 역할·회의 제출의 input 문자열(hermes_submission body의 input:
// 역할은 lib/role-instruction.ts buildRoleInput, 회의는 lib/meeting-execution.ts context()의 JSON)을 받아 정책을 적용한 새 입력과 뺀 것(omitted)을 돌려준다.
// 운영 제출 경로는 바꾸지 않는다. 채택과 구현은 PR 4b가 한다(docs/CONTEXT-REPLAY.ko.md).
// omitted[].chars는 그 경로에서 줄어든 직렬화 문자 수다. 한 정책의 omitted 합은 원래 입력 길이 − 새 입력 길이와 정확히 같다(tests/context-policies.test.mjs).
// reason에는 코드 문구·역할 id·카테고리 id·수치만 넣는다(원문 없음).
export type PolicyId='P0'|'P1'|'P2'|'P3'|'P4';
export type ReplaySubmission={kind:'role'|'meeting';role?:string;stage?:string;input:string};
export type Omission={path:string;chars:number;reason:string};
// applicable:false는 이 정책을 적용할 수 없는 제출이다(정규 JSON 객체가 아닌 입력, 역할 제출의 P3, 모르는 역할의 P4 등). 입력은 그대로 돌려준다.
export type PolicyResult={input:string;omitted:Omission[];applicable:boolean};
export const SECTION_BUDGET=2000,SUMMARY_CHARS=1000,HANDOFF_CHARS=1500;
export const CONTEXT_POLICIES:readonly {id:PolicyId;label:string;description:string}[]=[
 {id:'P0',label:'현행',description:'저장된 입력 그대로(항등). 비교 기준이다.'},
 {id:'P1',label:'메타 제거',description:'campaign의 draftMeta·status·derivedStatus·statusReason·createdAt·updatedAt·budgetConfirmedAt·id와 회의 작업물의 campaignId·status·origin·createdAt·factRefs·outputContractVersion·skillVersion을 뺀다.'},
 {id:'P2',label:'섹션별 예산',description:`지금 앞부분 절단을 받는 선행 작업물(역할 previous, 회의 originalArtifacts)을 앞부분 절단 대신 섹션당 ${SECTION_BUDGET}자로 줄여 모든 섹션 제목을 남긴다. 품질 검수 대상(candidateArtifacts)과 개선본(completedRevisions)은 줄이지 않는다.`},
 {id:'P3',label:'회의 단계별 축소',description:`의견 교환은 원본 작업물마다 요약(첫 본문 섹션, ${SUMMARY_CHARS}자)과 역할 계약의 인계 섹션(${HANDOFF_CHARS}자)만 본문을 남긴다. 품질 재검토는 candidateArtifacts 전문과 originalArtifacts의 id·버전·길이만 보낸다. 합의·개선 단계와 역할 제출은 해당 없음.`},
 {id:'P4',label:'아카이브 카테고리 선택',description:'역할별로 필요한 카테고리의 확정 자료만 남기고, 채널·성과 카테고리가 없는 역할은 채널 관찰을 뺀다. 뺀 수는 omittedSources·omittedObservations에 더한다.'},
];
// P4 역할별 자료 카테고리(근거: 역할 계약 섹션 제목, docs/CONTEXT-REPLAY.ko.md 표). 계약 제목의 채널→channel, 성과·매출·CPA→performance, 대상·고객→customer는 반드시 남긴다(tests/context-policies.test.mjs).
// 미분류(other)는 역할을 판단할 수 없어 모든 역할에 남긴다. 품질 검수는 근거 전체를 본다.
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
// P3 인계 섹션: 역할 계약(lib/role-output.ts roleOutputContract) 섹션 id. 계약 제목에 다음 담당에게 넘기는 내용(추가 자료 요청·미확정 목록·다음 실험 연결)이 있는 역할만 있다.
// strategy·creative·content·growth 계약에는 인계 섹션이 없다(null, 요약만 남는다). 품질 작업물은 계약 렌더링을 거치지 않는 자유 형식이라 null이다.
export const HANDOFF_SECTIONS:Readonly<Record<string,string|null>>={cmo:'output_3',insight:'output_3',strategy:null,creative:null,content:null,growth:null,data:'output_4',quality:null};
export const MEETING_STAGES=Object.keys(phaseNames) as MeetingPhase[];
const CAMPAIGN_META=['draftMeta','status','derivedStatus','statusReason','createdAt','updatedAt','budgetConfirmedAt','id'];
const ARTIFACT_META=['campaignId','status','origin','createdAt','factRefs','outputContractVersion','skillVersion'];
// P2 대상: 운영에서 앞부분 절단(lib/role-output.ts upstreamContext 6,000/24,000자, lib/meeting-execution.ts 회의 8,000자)을 받는 목록.
export const BUDGET_LISTS=['previous','originalArtifacts'];
const ROLE_ID=/^[a-z][a-z_]{0,39}$/,CUT=' …';

type Obj=Record<string,unknown>;
type Step={value:Obj;omitted:Omission[]};
const isObj=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const size=(v:unknown)=>JSON.stringify(v)?.length??0;
const field=(v:unknown,...path:string[])=>path.reduce<unknown>((o,k)=>isObj(o)?o[k]:undefined,v);
const same=(value:Obj):Step=>({value,omitted:[]});
// 정규 JSON 객체(JSON.stringify 출력 그대로)만 정책 대상이다. 공백·이스케이프가 다른 입력은 재직렬화만으로 길이가 바뀌어 절약량이 왜곡된다.
export function parseInput(input:string):Obj|null{
 try{const x:unknown=JSON.parse(input);return isObj(x)&&JSON.stringify(x)===input?x:null}catch{return null}
}
// 역할: 제출 메타 → task.role(역할 입력) → role(회의 입력). 형식이 다르면 null(원문을 추측하지 않는다).
export function submissionRole(s:ReplaySubmission,x:Obj|null=parseInput(s.input)):string|null{
 const role=s.role??field(x,'task','role')??field(x,'role');
 return typeof role==='string'&&ROLE_ID.test(role)?role:null;
}
export function submissionStage(s:ReplaySubmission,x:Obj|null=parseInput(s.input)):MeetingPhase|null{
 const stage=s.stage??field(x,'phase');
 return MEETING_STAGES.find(p=>p===stage)??null;
}

export type Section={title:string;text:string};
export type Heading={level:number;title:string;at:number};
// 코드 블록(``` · ~~~) 밖의 마크다운 제목 줄. at은 그 줄의 시작 위치다. 같은 줄에 백틱이 더 있으면(```코드``` 인라인) 코드 블록 시작이 아니다(CommonMark).
export function headings(content:string):Heading[]{
 return content.split('\n').reduce<{list:Heading[];fence:string;at:number}>((acc,line)=>{
  const at=acc.at+line.length+1;
  if(acc.fence){const close=/^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(line)?.[1];return {...acc,at,fence:close&&close[0]===acc.fence[0]&&close.length>=acc.fence.length?'':acc.fence}}
  const open=/^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line)?.[1];if(open)return {...acc,at,fence:open};
  const m=/^(#{1,6})[ \t]+\S/.exec(line);
  return {...acc,at,list:m?[...acc.list,{level:m[1].length,title:line.replace(/^#+[ \t]+/,'').trim(),at:acc.at}]:acc.list};
 },{list:[],fence:'',at:0}).list;
}
// 경계 수준: 제목이 2개 이상인 가장 얕은 수준. 단 역할 계약 제목 수준(`## `, lib/role-output.ts parseRoleOutput)보다 얕게 나누지 않는다.
// 그래서 문서 제목 H1 하나나 본문 속 H1이 계약 섹션을 한 섹션으로 뭉치지 않는다. 어느 수준도 2개 미만이면 가장 깊은 수준(모든 제목이 경계)이다.
function boundaryLevel(hs:Heading[]){
 const levels=[...new Set(hs.map(h=>h.level))].sort((a,b)=>a-b),repeated=levels.find(l=>hs.filter(h=>h.level===l).length>=2);
 return repeated===undefined?levels[levels.length-1]:Math.max(2,repeated);
}
// 경계 수준 이하의 모든 제목(코드 블록 밖)에서 나눈다. 첫 제목 앞 머리말은 제목 '' 섹션이다. text를 이으면 원문과 같다.
export function splitSections(content:string):Section[]{
 const hs=headings(content);
 if(!hs.length)return content?[{title:'',text:content}]:[];
 const level=boundaryLevel(hs),starts=hs.filter(h=>h.level<=level),bounds=[...(starts[0].at>0?[{title:'',at:0}]:[]),...starts];
 return bounds.map((b,i)=>({title:b.title,text:content.slice(b.at,bounds[i+1]?.at??content.length)}));
}
const headingLine=(s:Section)=>s.title?s.text.split('\n',1)[0]:'';
// 본문이 있는 섹션: 제목 섹션은 제목 줄 뒤, 머리말은 전체가 공백이 아니다.
export function sectionHasBody(s:Section){const nl=s.text.indexOf('\n');return s.title?nl>=0&&!!s.text.slice(nl+1).trim():!!s.text.trim()}
// 섹션을 budget자로 줄이고 표시(' …')를 붙인다. 제목 줄은 남기고, 잘린 하위 제목 조각은 버린다. 짧아지지 않으면 그대로 둔다.
function trimSection(s:Section,budget:number,last:boolean){
 if(s.text.length<=budget)return s.text;
 const head=s.text.slice(0,Math.max(budget,headingLine(s).length)),body=head.includes('\n')?head.replace(/\n#[^\n]*$/,''):head;
 const out=body.trimEnd()+CUT+(last?'':'\n\n');
 return out.length<s.text.length?out:s.text;
}
const headingOnly=(s:Section,last:boolean)=>{const out=headingLine(s)+(last||!s.title?'':'\n\n');return out.length<s.text.length?out:s.text};
const rebuild=(sections:Section[],out:string[])=>({content:out.join(''),cut:out.filter((t,i)=>t!==sections[i].text).length});
// P2: 섹션마다 budget자. 앞부분 절단(lib/role-output.ts upstreamContext)과 달리 모든 섹션 제목이 남는다.
export function sectionBudget(content:string,budget=SECTION_BUDGET){
 const sections=splitSections(content);
 return rebuild(sections,sections.map((s,i)=>trimSection(s,budget,i===sections.length-1)));
}
// P3 의견 교환용 요약: 첫 본문 섹션(요약)과 제목이 handoff인 섹션(역할 계약의 인계 섹션)만 본문을 남기고 나머지는 제목 줄만 남긴다.
// 첫 본문 섹션 앞의 제목만 있는 섹션(문서 제목 H1 등)은 그대로 둔다. handoff가 null이면 요약만 남는다.
export function digestSections(content:string,handoff:string|null=null){
 const sections=splitSections(content),last=sections.length-1,summary=sections.findIndex(sectionHasBody);
 return rebuild(sections,sections.map((s,i)=>i<summary?s.text:i===summary?trimSection(s,SUMMARY_CHARS,i===last):handoff!==null&&s.title===handoff?trimSection(s,HANDOFF_CHARS,i===last):headingOnly(s,i===last)));
}
// 역할 계약의 인계 섹션 제목. 인계 섹션이 없는 역할·모르는 역할은 null이다.
export function handoffTitle(role:unknown):string|null{
 const id=typeof role==='string'&&Object.hasOwn(HANDOFF_SECTIONS,role)?HANDOFF_SECTIONS[role]:null;
 return id?roleOutputContract(role as string).sections.find(s=>s.id===id)?.title??null:null;
}

const chain=(x:Obj,...fns:((y:Obj)=>Step)[])=>fns.reduce<Step>((acc,fn)=>{const s=fn(acc.value);return {value:s.value,omitted:[...acc.omitted,...s.omitted]}},same(x));
function mapField(x:Obj,key:string,fn:(v:Obj)=>Step):Step{
 const v=x[key];if(!isObj(v))return same(x);
 const s=fn(v);return s.omitted.length?{value:{...x,[key]:s.value},omitted:s.omitted}:same(x);
}
function mapList(x:Obj,key:string,fn:(item:Obj,path:string)=>Step):Step{
 const list=x[key];if(!Array.isArray(list))return same(x);
 const steps=list.map((item,i)=>isObj(item)?fn(item,`${key}[${i}]`):{value:item,omitted:[]});
 return steps.some(s=>s.omitted.length)?{value:{...x,[key]:steps.map(s=>s.value)},omitted:steps.flatMap(s=>s.omitted)}:same(x);
}
// 키를 하나씩 뺀다. 줄어든 문자: `"키":값` + 다른 키가 남아 있으면 쉼표 1자.
function dropKeys(o:Obj,keys:readonly string[],path:string,reason:string):Step{
 return keys.filter(k=>Object.hasOwn(o,k)).reduce<Step>((acc,k)=>{
  const value=Object.fromEntries(Object.entries(acc.value).filter(([key])=>key!==k)),chars=size(k)+1+size(acc.value[k])+(Object.keys(acc.value).length>1?1:0);
  return {value,omitted:[...acc.omitted,{path:`${path}.${k}`,chars,reason}]};
 },same(o));
}
// keep이 거짓인 원소를 빼고 countKey(입력에 싣지 않은 수)를 늘린다. 줄어든 문자: 원소 + 다른 원소가 남아 있으면 쉼표 1자 − 늘어난 수의 자릿수.
function dropItems(o:Obj,listKey:string,countKey:string,keep:(item:unknown)=>boolean,reason:(item:unknown)=>string):Step{
 const list=Array.isArray(o[listKey])?o[listKey] as unknown[]:[],flags=list.map(keep);
 return list.reduce<Step>((acc,item,i)=>{
  if(flags[i])return acc;
  const before=list.filter((_,j)=>flags[j]||j>=i),after=list.filter((_,j)=>flags[j]||j>i),count=acc.value[countKey],counted=typeof count==='number'?{[countKey]:count+1}:{};
  const chars=size(item)+(before.length>1?1:0)-(typeof count==='number'?size(count+1)-size(count):0);
  return {value:{...acc.value,[listKey]:after,...counted},omitted:[...acc.omitted,{path:`brandArchive.${listKey}[${i}]`,chars,reason:reason(item)}]};
 },same(o));
}
// 작업물 본문을 fn으로 줄인다. excerpt 필드가 있으면 true로 바꾼다(줄어든 문자에 포함).
function reshape(item:Obj,path:string,fn:(content:string)=>{content:string;cut:number},reason:(cut:number)=>string):Step{
 if(typeof item.content!=='string')return same(item);
 const r=fn(item.content),excerpt=Object.hasOwn(item,'excerpt');
 const chars=size(item.content)-size(r.content)+(excerpt?size(item.excerpt)-size(true):0);
 return r.content!==item.content&&chars>0?{value:{...item,content:r.content,...(excerpt?{excerpt:true}:{})},omitted:[{path:path+'.content',chars,reason:reason(r.cut)}]}:same(item);
}
function stub(item:Obj,path:string):Step{
 const value={...Object.fromEntries(['ref','id','role','version'].filter(k=>Object.hasOwn(item,k)).map(k=>[k,item[k]])),length:typeof item.content==='string'?item.content.length:0},chars=size(item)-size(value);
 return chars>0?{value,omitted:[{path,chars,reason:'품질 재검토: 원본 작업물은 id·버전·길이만'}]}:same(item);
}

const metaPolicy=(x:Obj)=>chain(x,
 y=>mapField(y,'campaign',c=>dropKeys(c,CAMPAIGN_META,'campaign','프롬프트에 불필요한 캠페인 메타')),
 ...['originalArtifacts','candidateArtifacts'].map(key=>(y:Obj)=>mapList(y,key,(a,path)=>dropKeys(a,ARTIFACT_META,path,'프롬프트에 불필요한 작업물 메타'))));
const budgetPolicy=(x:Obj)=>chain(x,...BUDGET_LISTS.map(key=>(y:Obj)=>mapList(y,key,(a,path)=>reshape(a,path,c=>sectionBudget(c),cut=>`섹션당 ${SECTION_BUDGET}자 예산 초과분(섹션 ${cut}개)`))));
// 의견 교환 발언용 요약. reason의 인계 표시: 계약 섹션 id(찾음), '<id> 미발견'(계약에는 있으나 본문에 그 제목이 없음), '없음'(계약에 인계 섹션이 없는 역할).
function digestArtifact(a:Obj,path:string):Step{
 const id=typeof a.role==='string'&&Object.hasOwn(HANDOFF_SECTIONS,a.role)?HANDOFF_SECTIONS[a.role]:null,title=handoffTitle(a.role);
 const found=title!==null&&typeof a.content==='string'&&splitSections(a.content).some(s=>s.title===title),label=!id?'없음':found?id:`${id} 미발견`;
 return reshape(a,path,c=>digestSections(c,found?title:null),cut=>`회의 ${phaseNames.discussion} 단계: 요약·인계 섹션만 본문 유지(줄인 섹션 ${cut}개, 인계 ${label})`);
}
// P3는 의견 교환과 품질 재검토에만 적용한다. 합의·개선 단계는 해당 없음(null).
function meetingPolicy(x:Obj,stage:MeetingPhase):Step|null{
 if(stage==='quality')return chain(x,y=>mapList(y,'originalArtifacts',stub),y=>mapList(y,'completedRevisions',(a,path)=>dropKeys(a,['content'],path,'품질 재검토: candidateArtifacts와 같은 개선본 본문')));
 return stage==='discussion'?mapList(x,'originalArtifacts',digestArtifact):null;
}
function archivePolicy(x:Obj,role:string):Step{
 const allowed=ROLE_ARCHIVE_CATEGORIES[role],observations=allowed.includes('channel')||allowed.includes('performance');
 const category=(item:unknown)=>{const c=field(item,'category');return typeof c==='string'&&Object.hasOwn(archiveCategories,c)?c as ArchiveCategory:'other'};
 return mapField(x,'brandArchive',a=>chain(a,
  y=>dropItems(y,'confirmedSources','omittedSources',s=>allowed.includes(category(s)),s=>`역할(${role}) 비필요 카테고리(${category(s)})`),
  y=>observations?same(y):dropItems(y,'observations','omittedObservations',()=>false,()=>`역할(${role}) 비필요 채널 관찰`)));
}
function transform(id:Exclude<PolicyId,'P0'>,s:ReplaySubmission,x:Obj):Step|null{
 if(id==='P1')return metaPolicy(x);
 if(id==='P2')return budgetPolicy(x);
 if(id==='P3'){const stage=submissionStage(s,x);return s.kind==='meeting'&&stage?meetingPolicy(x,stage):null}
 const role=submissionRole(s,x);
 return role&&Object.hasOwn(ROLE_ARCHIVE_CATEGORIES,role)?archivePolicy(x,role):null;
}
export function applyPolicy(id:PolicyId,s:ReplaySubmission):PolicyResult{
 if(!CONTEXT_POLICIES.some(p=>p.id===id))throw new Error('Unknown context policy');
 if(id==='P0')return {input:s.input,omitted:[],applicable:true};
 const x=parseInput(s.input),step=x?transform(id,s,x):null;
 if(!step)return {input:s.input,omitted:[],applicable:false};
 return {input:step.omitted.length?JSON.stringify(step.value):s.input,omitted:step.omitted,applicable:true};
}
