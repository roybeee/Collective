'use client';
import '@/lib/i18n/lazy-trust';
import {useState} from 'react';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {Button} from '@/components/ui/button';
import {StatList} from './stat-list';
import {loadArtifactSources} from '@/lib/artifact-sources-client';
import type {OriginInfo} from '@/lib/artifact-sources';
import {kstText} from '@/lib/format';
import {currentLocale,t,type MessageKey} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';

// X7 AI 출처 배지(docs/GLOBAL-PLAN.ko.md 에픽 X7). 작업물 상세 머리와 목록 카드의 출처 글자('AI 작성'·'AI 작성 · 사람 수정'·'직접 등록')를 배지 버튼으로 보이고,
// 누르면 담당·모델·작성 시각·브리프 판·적용한 학습 규칙 수·AI 생성물 표시 줄 상태를 팝오버로 보인다. 값은 저장된 작업물·실행 기록에서만 읽고(/api/artifact-sources), 없으면 '기록 없음'이다.
// info를 넘기면 그 값을 쓰고, 아직 없으면 처음 열 때 한 번 읽는다(목록 카드·상세가 읽기 전). 키보드로 열고 Esc로 닫으면 포커스가 배지로 돌아간다(Radix Popover).
// 글자는 사전(trust.origin.*), 시각은 화면 언어(lib/format.ts kstText)로 적는다. 출처 이름(한국어)은 lib/review-decisions.ts originLabel과 같다. 담당 이름·모델·표시 줄 문장은 저장값 그대로다.
const none=()=>t('trust.origin.none');
const kst=(iso:string|null)=>kstText(iso,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})||none();
const viaLabel:Record<OriginInfo['via'],MessageKey>={role:'trust.origin.viaRole',meeting:'trust.origin.viaMeeting',manual:'trust.origin.viaManual',unknown:'trust.origin.viaUnknown'};
// 담당 이름: 영어·일본어는 사전(role.<id>)에서 읽고, 모르는 담당이면 저장된 이름 그대로다.
const roleText=(info:OriginInfo)=>{if(currentLocale()==='ko')return info.roleName;const key=`role.${info.role}` as MessageKey,text=t(key);return text===key?info.roleName:text};
const originLabel=(origin:string|undefined)=>t(origin==='ai'?'trust.origin.ai':origin==='ai_edited'?'trust.origin.aiEdited':'trust.origin.manual');
export function OriginDetails({info}:{info:OriginInfo}){
 const t=useT(),ai=info.origin==='ai'||info.origin==='ai_edited';
 const rows:[string,string][]=[[t('trust.origin.role'),roleText(info)],[t('trust.origin.via'),t(viaLabel[info.via])],...(ai?[[t('trust.origin.model'),info.model??none()] as [string,string],[t('trust.origin.generatedAt'),kst(info.generatedAt)] as [string,string]]:[]),...(info.editedAt?[[info.origin==='manual'?t('trust.origin.registeredAt'):t('trust.origin.editedAt'),kst(info.editedAt)] as [string,string]]:[]),
  [t('trust.origin.brief'),info.briefVersion?`v${info.briefVersion}`:none()],[t('trust.origin.rules'),info.learningRules===null?none():t('trust.origin.rulesCount',{n:info.learningRules})]];
 return <div className="form-stack origin-details">
  <StatList label={t('trust.origin.title')} items={rows}/>
  <p className="subtle-note">{info.disclosure.applies?t('trust.origin.disclosure',{line:info.disclosure.line??''}):t('trust.origin.noDisclosure')}</p>
  {info.disclosure.virtualPersonLine&&<p className="subtle-note">{t('trust.origin.virtualPerson',{line:info.disclosure.virtualPersonLine})}</p>}
 </div>;
}
export function AiOriginBadge({artifactId,origin,info}:{artifactId:string;origin:string;info?:OriginInfo|null}){
 const t=useT(),[loaded,setLoaded]=useState<OriginInfo|null>(null),[error,setError]=useState('');
 const shown=info??loaded,label=originLabel(origin);
 function onOpen(open:boolean){
  if(!open||shown)return;
  setError('');
  void loadArtifactSources(artifactId).then(d=>setLoaded(d.origin)).catch(e=>setError((e as Error).message));
 }
 return <Popover onOpenChange={onOpen}>
  <PopoverTrigger asChild><Button type="button" variant="outline" size="xs" className="origin-badge" data-origin={origin} aria-label={t('trust.origin.badgeLabel',{label})}>{label}</Button></PopoverTrigger>
  <PopoverContent className="citation-popover" aria-label={t('trust.origin.title')}>
   <h4>{label}</h4>
   {shown?<OriginDetails info={shown}/>:error?<p className="form-error" role="alert">{error}</p>:<p className="loading-line" role="status">{t('trust.origin.loading')}</p>}
  </PopoverContent>
 </Popover>;
}
