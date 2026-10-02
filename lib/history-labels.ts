import {roles,statuses,type Artifact,type Event,type Run} from './agency';
import {scrubInternalIds} from './artifact-text';
import {count,dayTime,josa,metaText} from './format';

// 화면 표시용 파생 계산만 한다. 저장 데이터와 서버 동작은 바꾸지 않는다.

// 작업물 상태 한글 표기. app/panels.tsx Status와 같은 표(statuses 우선, 작업물 상태 보충)를 쓴다.
const artifactStatuses:Record<string,string>={approved:'승인 완료',review:'검토 대기',revision:'수정 요청',outdated:'이전 버전'};
export const statusLabel=(status:string)=>statuses[status]||artifactStatuses[status]||status;
const pad=(n:number)=>String(n).padStart(2,'0');
// 작성 시각을 한국 표준시(UTC+9, 일광 절약 없음)로 표시한다. 보는 사람의 시간대와 무관하다.
export function kstTime(iso:string){const t=Date.parse(iso);if(Number.isNaN(t))return '';const d=new Date(t+9*3600000);return `${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} KST`}

export type VersionRecord=Pick<Artifact,'id'|'role'|'version'|'status'|'createdAt'|'origin'>&{originalId?:string;meetingId?:string;reviewedAt?:string;reviewedVersion?:number};
// label은 선택 상자(option)용 짧은 형식, sentence는 화면에 보이는 한 문장(historySentence)이다.
export type VersionOption={id:string;role:string;label:string;sentence:string;current:boolean;createdAt:string;version:number};
export type VersionGroup={role:string;label:string;options:VersionOption[]};
const roleName=(role:string)=>roles.find(r=>r.id===role)?.name||role;
const time=(iso:string)=>Date.parse(iso)||0;
// 현재 버전이 만들어진 사유. 회의 개선본은 meetingId, 직접 수정은 v2 이상(AI 역할 실행은 항상 v1로 새로 만든다).
function madeBy(a:VersionRecord){return a.meetingId?'회의 개선':a.version>1?'직접 수정':a.origin==='manual'?'직접 등록':''}
// 이전 버전이 된 사유. 이력 ID 형식(서버 기록 규칙): 역할 실행 `${owner}:${campaignId}:${campaignVersion}:${roleId}:${inputHash}:${artifactId}:${version}`,
// 팀 회의 `${meetingId}:${artifactId}:${version}`, 직접 수정 uid(콜론 없음). 형식을 알 수 없으면 사유를 표시하지 않는다.
function replacedBy(historyId:string){
 const parts=historyId.split(':');
 if(parts.length===1)return '직접 수정';
 if(parts.length===3)return '회의 개선';
 const role=parts.length>=7?roles.find(r=>r.id===parts[parts.length-4]):undefined;
 return role?role.name+' 재작성':'';
}
function versionLabel(a:VersionRecord,kind:'current'|'outdated'|'history'){
 const state=kind==='current'?(madeBy(a)?'현재: '+madeBy(a):'현재'):kind==='history'?(replacedBy(a.id)?`이전: ${replacedBy(a.id)}으로 교체`:'이전'):'';
 // 선택 상자(option) 글자라 MetaLine을 못 쓴다. 쉼표로 잇는다(metaText).
 return metaText([`${roleName(a.role)} v${a.version}`,statusLabel(a.status),kstTime(a.createdAt),state]);
}
// 버전 비교 선택지: 역할 순서로 묶고, 묶음 안에서는 현재 버전 → 최근 작성 순. 이력으로 복사된 outdated 작업물은 한 번만 보인다.
export function versionGroups(artifacts:VersionRecord[],history:VersionRecord[]):VersionGroup[]{
 const copied=new Set(history.map(h=>`${h.originalId}:${h.version}`));
 const entries=[...artifacts.filter(a=>!(a.status==='outdated'&&copied.has(`${a.id}:${a.version}`))).map(a=>({a,kind:a.status==='outdated'?'outdated' as const:'current' as const})),...history.map(a=>({a,kind:'history' as const}))];
 const order=(role:string)=>{const i=roles.findIndex(r=>r.id===role);return i<0?roles.length:i};
 return [...new Set(entries.map(e=>e.a.role))].toSorted((x,y)=>order(x)-order(y)||x.localeCompare(y)).map(role=>({role,label:roleName(role),options:entries.filter(e=>e.a.role===role)
  .toSorted((x,y)=>Number(y.kind==='current')-Number(x.kind==='current')||time(y.a.createdAt)-time(x.a.createdAt)||y.a.version-x.a.version)
  .map(({a,kind})=>({id:a.id,role,label:versionLabel(a,kind),sentence:historySentence({kind:'version',record:a,state:kind}),current:kind==='current',createdAt:a.createdAt,version:a.version}))}));
}
// 변경 이력 문장(평가 10회차 ⑪ 5점 조건 '변경 이력을 사람이 읽는 문장으로'). 한 항목은 '…습니다.'로 끝나는 한 문장이고, 덧붙일 내용(검토 의견·사용량 등)은 note로 따로 준다.
// 시각은 '10월 2일 오후 3:10'(KST), 조사는 받침에 맞춘다. 행위자·버전·시각이 없으면 그 구절을 뺀다. 선택 상자 글자는 versionLabel의 짧은 형식을 그대로 쓴다.
export type HistoryEntry=
 |{kind:'version';record:VersionRecord;state:'current'|'outdated'|'history'}
 |{kind:'event';event:Pick<Event,'message'|'createdAt'|'actor'>}
 |{kind:'run';run:Pick<Run,'role'|'status'|'createdAt'|'model'|'tokens'>};
export type HistoryLine={sentence:string;note:string};
const at=(iso:string|undefined)=>{const t=dayTime(iso);return t?t+'에 ':''};
const role=(id:string)=>roles.find(r=>r.id===id)?.name;
// 저장된 문구의 가운뎃점 연결. 화면 문장에서는 쉼표로 바꾼다(test용은 g 없는 정규식, lastIndex 상태가 없다).
const DOT=/\s·\s/g,hasDot=(text:string)=>/\s·\s/.test(text);
// 대상: '브랜드 전략 담당 v2'. 역할을 모르면 '작업물'.
function versionSubject(a:VersionRecord){const name=role(a.role);return `${name?name+' 담당':'작업물'}${Number.isFinite(a.version)&&a.version>0?' v'+a.version:''}`}
// 이 버전이 만들어진 방식(피동). 회의 개선본은 meetingId, 직접 수정은 v2 이상, 직접 등록은 origin='manual'(madeBy와 같은 기준).
function made(a:VersionRecord){return a.meetingId?'팀 회의에서 개선됐':a.version>1?'직접 수정됐':a.origin==='manual'?'직접 등록됐':'작성됐'}
function versionSentence(a:VersionRecord,state:'current'|'outdated'|'history'){
 const s=versionSubject(a),topic=josa(s,'은/는'),t=at(a.createdAt),m=made(a);
 const reviewed=a.reviewedAt&&(a.reviewedVersion===undefined||a.reviewedVersion===a.version)?at(a.reviewedAt):'';
 if(state==='history'){const reason=replacedBy(a.id);return `${topic} ${t}${m}고 ${reason?josa(reason,'으로/로'):'새 버전으로'} 교체됐습니다.`}
 if(state==='outdated'||a.status==='outdated')return `${topic} ${t}${m}고 지금은 이전 버전입니다.`;
 if(a.status==='approved')return reviewed?`${josa(s,'을/를')} ${reviewed}승인했습니다.`:`${topic} ${t}${m}고 승인을 받았습니다.`;
 if(a.status==='revision')return reviewed?`${s}의 수정을 ${reviewed}요청했습니다.`:`${topic} ${t}${m}고 수정 요청을 받았습니다.`;
 if(a.status==='review')return `${topic} ${t}${m}고 검토를 기다리고 있습니다.`;
 return `${topic} ${t}${m}고 ${statusLabel(a.status)} 상태로 남아 있습니다.`;
}
// 작업물 제목: AI 작업물('브랜드 전략 · 캠페인')은 '브랜드 전략 담당', 그 밖은 낫표로 감싼다(가운뎃점은 쉼표로).
function titleSubject(title:string){const parts=title.split(DOT);return parts.length>1&&roles.some(r=>r.name===parts[0])?`${parts[0]} 담당`:`「${title.replace(DOT,', ')}」`}
const ACTIONS:Record<string,string>={수정:'수정했습니다',추가:'추가했습니다',삭제:'삭제했습니다',연결:'연결했습니다',저장:'저장했습니다',완료:'마쳤습니다',해제:'해제했습니다',등록:'등록했습니다',확인:'확인했습니다',재확인:'다시 확인했습니다',지정:'지정했습니다',변경:'변경했습니다',기록:'기록했습니다',시작:'시작했습니다'};
const ACTION=new RegExp(`^(.+?) (${Object.keys(ACTIONS).join('|')})$`);
// 서버가 남긴 캠페인 이벤트 문구(lib/server.ts eventStatement)를 행위자·시각이 든 한 문장으로 바꾼다. 저장된 문구는 바꾸지 않는다.
function eventLine(e:Pick<Event,'message'|'createdAt'|'actor'>):HistoryLine{
 const lead=`${e.actor?.email?e.actor.email+' 님이 ':''}${at(e.createdAt)}`,message=e.message.trim();
 // 검토: '${title} v${n} 승인|수정 요청|브랜드·사실 변경 확인 후 승인[ · 의견]'(app/api/action/route.ts review_artifact).
 const review=/^(.+) v(\d+) (승인|수정 요청|브랜드·사실 변경 확인 후 승인)(?:\s·\s([\s\S]+))?$/.exec(message);
 if(review){const [,title,v,decision,note='']=review,target=`${titleSubject(title)} v${v}`;
  return {sentence:decision==='수정 요청'?`${lead}${target}의 수정을 요청했습니다.`:`${lead}${decision==='승인'?'':'브랜드와 확정 사실이 바뀐 것을 확인하고 '}${josa(target,'을/를')} 승인했습니다.`,note:note.replace(DOT,', ')}}
 // 작업물 저장: '${역할} 작업물 수정|등록 · v${n}'(save_artifact).
 const saved=/^(.+) 작업물 (수정|등록)\s·\sv(\d+)$/.exec(message);
 if(saved){const [,name,verb,v]=saved,target=`${roles.some(r=>r.name===name)?name+' 담당 ':''}작업물 v${v}`;return {sentence:`${lead}${josa(target,'을/를')} ${verb}했습니다.`,note:''}}
 // 이미 문장으로 끝나는 문구: 첫 문장 앞에 행위자·시각을 붙이고 나머지 문장은 note로 둔다.
 const first=/^([^]*?습니다\.)(?:\s+([^]*))?$/.exec(message);
 if(first&&!hasDot(first[1]))return {sentence:lead+first[1],note:(first[2]||'').replace(DOT,', ')};
 // '명사 동작 · 덧붙임'(예: '브리프 수정 · 이전 승인은 종료되었습니다.', 'Meta 읽기 연결 해제'): 앞 조각을 '…을 수정했습니다.'로, 나머지는 note로.
 const [head,...rest]=message.split(DOT),action=ACTION.exec(head);
 if(action)return {sentence:`${lead}${josa(action[1],'을/를')} ${ACTIONS[action[2]]}.`,note:rest.join(', ')};
 return {sentence:`${lead}다음 내용을 기록했습니다.`,note:message.replace(DOT,', ')};
}
function runLine(r:Pick<Run,'role'|'status'|'createdAt'|'model'|'tokens'>):HistoryLine{
 const name=role(r.role),job=`${name?name+' 담당':r.role==='meeting'?'팀 회의':''} AI 작업`.trim(),t=at(r.createdAt),started=t?`${t}시작한 ${job}`:job;
 const sentence=r.status==='completed'?`${josa(started,'을/를')} 마쳤습니다.`:r.status==='failed'?`${josa(started,'이/가')} 실패했습니다.`:r.status==='cancelled'?`${josa(started,'을/를')} 취소했습니다.`
  :r.status==='incomplete'?`${josa(started,'이/가')} 끝까지 완료되지 않았습니다.`:r.status==='uncertain'?`${josa(started,'은/는')} 접수 여부를 확인하고 있습니다.`:`${t}${josa(job,'을/를')} 시작했고 아직 끝나지 않았습니다.`;
 const used=typeof r.tokens==='number'&&r.tokens>0?`${r.model?r.model+' 모델로 ':''}토큰 ${count(r.tokens,'개')}를 썼습니다.`:'';
 return {sentence,note:used};
}
export function historyLine(entry:HistoryEntry):HistoryLine{
 return entry.kind==='version'?{sentence:versionSentence(entry.record,entry.state),note:''}:entry.kind==='event'?eventLine(entry.event):runLine(entry.run);
}
/** 변경 이력 한 항목을 '…습니다.'로 끝나는 한 문장으로: '브랜드 전략 담당 v2를 10월 2일 오후 3:10에 승인했습니다.' */
export const historySentence=(entry:HistoryEntry)=>historyLine(entry).sentence;
// 캠페인 이력 탭: 이벤트와 AI 작업을 최근 순으로 한 목록에 문장으로 보인다.
export function historyLines(events:readonly Pick<Event,'id'|'message'|'createdAt'|'actor'>[],runs:readonly Pick<Run,'id'|'role'|'status'|'createdAt'|'model'|'tokens'>[]){
 return [...events.map(e=>({key:'event:'+e.id,createdAt:e.createdAt,...eventLine(e)})),...runs.map(r=>({key:'run:'+r.id,createdAt:r.createdAt,...runLine(r)}))].toSorted((a,b)=>time(b.createdAt)-time(a.createdAt));
}
// 기본 비교: 가장 최근에 바뀐 역할의 직전 버전(왼쪽)과 현재 버전(오른쪽). 짝이 없으면 이전 버전 하나와 현재 버전 하나.
export function defaultComparison(groups:VersionGroup[]){
 const pairs=groups.flatMap(g=>{const current=g.options.find(o=>o.current),previous=g.options.find(o=>!o.current);return current&&previous?[{current,previous}]:[]}).toSorted((a,b)=>time(b.current.createdAt)-time(a.current.createdAt));
 if(pairs[0])return {left:pairs[0].previous.id,right:pairs[0].current.id};
 const all=groups.flatMap(g=>g.options),left=all.find(o=>!o.current)||all[0];
 const right=all.find(o=>o.current&&o.role===left?.role)||all.find(o=>o.current)||left;
 return {left:left?.id||'',right:right?.id||''};
}
// 미리보기: 첫 비제목 문단에서 마크다운 기호와 내부 식별자(UUID, campaign:id= 등)를 지운다.
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const internalRef=new RegExp(`\\b(?:(?:campaign|artifact|job|brand|source)[:_]?\\s?id\\s?[=:]\\s?[\\w-]+|${uuid})(?:\\s?[,/·]?\\s?(?:version|v)\\s?[=:]?\\s?\\d+)?`,'gi');
export function artifactPreview(content:string,max=120){
 const lines=content.split('\n').map(l=>l.trim()),start=lines.findIndex(l=>l&&!/^#{1,6}\s/.test(l));
 if(start<0)return '';
 const end=lines.findIndex((l,i)=>i>start&&(!l||/^#{1,6}\s/.test(l)));
 const text=scrubInternalIds(lines.slice(start,end<0?undefined:end).map(l=>l.replace(/^(?:[-*]|\d+\.)\s+/,'')).join(' ').replace(/\*\*|__|`/g,'').replace(internalRef,''))
  .replace(/\s+([,.)])/g,'$1').replace(/\(\s*\)/g,'').replace(/\s{2,}/g,' ').trim();
 return text.length>max?text.slice(0,max)+'…':text;
}
