import {roles,statuses,type Artifact} from './agency';
import {scrubInternalIds} from './role-output';

// 화면 표시용 파생 계산만 한다. 저장 데이터와 서버 동작은 바꾸지 않는다.

// 작업물 상태 한글 표기. app/panels.tsx Status와 같은 표(statuses 우선, 작업물 상태 보충)를 쓴다.
const artifactStatuses:Record<string,string>={approved:'승인 완료',review:'검토 대기',revision:'수정 요청',outdated:'이전 버전'};
export const statusLabel=(status:string)=>statuses[status]||artifactStatuses[status]||status;
const pad=(n:number)=>String(n).padStart(2,'0');
// 작성 시각을 한국 표준시(UTC+9, 일광 절약 없음)로 표시한다. 보는 사람의 시간대와 무관하다.
export function kstTime(iso:string){const t=Date.parse(iso);if(Number.isNaN(t))return '';const d=new Date(t+9*3600000);return `${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} KST`}

export type VersionRecord=Pick<Artifact,'id'|'role'|'version'|'status'|'createdAt'|'origin'>&{originalId?:string;meetingId?:string};
export type VersionOption={id:string;role:string;label:string;current:boolean;createdAt:string;version:number};
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
 return [`${roleName(a.role)} v${a.version}`,statusLabel(a.status),kstTime(a.createdAt),state].filter(Boolean).join(' · ');
}
// 버전 비교 선택지: 역할 순서로 묶고, 묶음 안에서는 현재 버전 → 최근 작성 순. 이력으로 복사된 outdated 작업물은 한 번만 보인다.
export function versionGroups(artifacts:VersionRecord[],history:VersionRecord[]):VersionGroup[]{
 const copied=new Set(history.map(h=>`${h.originalId}:${h.version}`));
 const entries=[...artifacts.filter(a=>!(a.status==='outdated'&&copied.has(`${a.id}:${a.version}`))).map(a=>({a,kind:a.status==='outdated'?'outdated' as const:'current' as const})),...history.map(a=>({a,kind:'history' as const}))];
 const order=(role:string)=>{const i=roles.findIndex(r=>r.id===role);return i<0?roles.length:i};
 return [...new Set(entries.map(e=>e.a.role))].toSorted((x,y)=>order(x)-order(y)||x.localeCompare(y)).map(role=>({role,label:roleName(role),options:entries.filter(e=>e.a.role===role)
  .toSorted((x,y)=>Number(y.kind==='current')-Number(x.kind==='current')||time(y.a.createdAt)-time(x.a.createdAt)||y.a.version-x.a.version)
  .map(({a,kind})=>({id:a.id,role,label:versionLabel(a,kind),current:kind==='current',createdAt:a.createdAt,version:a.version}))}));
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
