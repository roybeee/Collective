'use client';
import {useState} from 'react';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {Button} from '@/components/ui/button';
import {StatList} from './stat-list';
import {originLabel} from '@/lib/review-decisions';
import {loadArtifactSources} from '@/lib/artifact-sources-client';
import type {OriginInfo} from '@/lib/artifact-sources';

// X7 AI 출처 배지(docs/GLOBAL-PLAN.ko.md 에픽 X7). 작업물 상세 머리와 목록 카드의 출처 글자('AI 작성'·'AI 작성 · 사람 수정'·'직접 등록')를 배지 버튼으로 보이고,
// 누르면 담당·모델·작성 시각·브리프 판·적용한 학습 규칙 수·AI 생성물 표시 줄 상태를 팝오버로 보인다. 값은 저장된 작업물·실행 기록에서만 읽고(/api/artifact-sources), 없으면 '기록 없음'이다.
// info를 넘기면 그 값을 쓰고, 아직 없으면 처음 열 때 한 번 읽는다(목록 카드·상세가 읽기 전). 키보드로 열고 Esc로 닫으면 포커스가 배지로 돌아간다(Radix Popover).
const kst=(iso:string|null)=>{if(!iso)return '기록 없음';const d=new Date(iso);return Number.isNaN(d.getTime())?'기록 없음':d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})};
const viaLabel:Record<OriginInfo['via'],string>={role:'AI 팀 담당 실행',meeting:'AI 팀 회의',manual:'사람이 직접 등록',unknown:'실행 기록 없음'};
export function OriginDetails({info}:{info:OriginInfo}){
 const ai=info.origin==='ai'||info.origin==='ai_edited';
 const rows:[string,string][]=[['담당',info.roleName],['작성 경로',viaLabel[info.via]],...(ai?[['모델',info.model??'기록 없음'] as [string,string],['AI 작성 시각',kst(info.generatedAt)] as [string,string]]:[]),...(info.editedAt?[[info.origin==='manual'?'등록 시각':'사람 수정 시각',kst(info.editedAt)] as [string,string]]:[]),
  ['브리프 판',info.briefVersion?`v${info.briefVersion}`:'기록 없음'],['적용 학습 규칙',info.learningRules===null?'기록 없음':`${info.learningRules}개`]];
 return <div className="form-stack origin-details">
  <StatList label="작성 출처" items={rows}/>
  <p className="subtle-note">{info.disclosure.applies?`게시 캡션에 AI 생성물 표시 줄이 붙습니다: “${info.disclosure.line}”`:'직접 등록한 작업물이라 AI 생성물 표시 줄 대상이 아닙니다.'}</p>
  {info.disclosure.virtualPersonLine&&<p className="subtle-note">가상인물 표시 줄도 붙습니다: “{info.disclosure.virtualPersonLine}”</p>}
 </div>;
}
export function AiOriginBadge({artifactId,origin,info}:{artifactId:string;origin:string;info?:OriginInfo|null}){
 const [loaded,setLoaded]=useState<OriginInfo|null>(null),[error,setError]=useState('');
 const shown=info??loaded,label=originLabel(origin);
 function onOpen(open:boolean){
  if(!open||shown)return;
  setError('');
  void loadArtifactSources(artifactId).then(d=>setLoaded(d.origin)).catch(e=>setError((e as Error).message));
 }
 return <Popover onOpenChange={onOpen}>
  <PopoverTrigger asChild><Button type="button" variant="outline" size="xs" className="origin-badge" data-origin={origin} aria-label={`${label}, 작성 출처 보기`}>{label}</Button></PopoverTrigger>
  <PopoverContent className="citation-popover" aria-label="작성 출처">
   <h4>{label}</h4>
   {shown?<OriginDetails info={shown}/>:error?<p className="form-error" role="alert">{error}</p>:<p className="loading-line" role="status">작성 출처를 불러오고 있습니다.</p>}
  </PopoverContent>
 </Popover>;
}
