'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {MetaLine} from './meta-line';
import {CreativeScoreCard} from './creative-score-card';
import {regradeArtifact} from '@/lib/artifact-sources-client';
import {SEVERITY_LABELS,type ComplianceView} from '@/lib/artifact-sources';

// X7 규정 점검 패널(작업물 상세). 규칙 분류별 통과·주의·차단 수와 걸린 표현(제목·발췌·법령 근거 링크)을 보인다. 자동 점검이며 법률 자문이 아니다.
// '다시 점검'은 POST /api/usage regrade_artifact(대표·관리자, 결정론 채점기, 모델 호출 없음)를 부르고 그 결과로 바꾼다.
// '수정 제안 적용'은 채점기가 구체적인 대체 문구를 줄 때만 보이는 자리다. 현재 규제 점검(lib/graders/compliance.ts)은 대체 문구를 주지 않아 버튼을 그리지 않는다.
// 아래에 소재 예측 점수 카드(G2, components/app/creative-score-card.tsx)를 붙인다. 목록 배지(ScoreBadge)와 같은 모듈이라 캠페인 상세 청크(app/panels.tsx, lazy)에 함께 실린다. 홈 첫 로딩에는 없다.
const kst=(iso:string|null)=>iso?new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):null;
export function CompliancePanel({artifactId,artifactVersion,compliance,canManage,onChange}:{artifactId:string;artifactVersion:number;compliance:ComplianceView|null;canManage:boolean;onChange:(view:ComplianceView)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 async function recheck(){
  setBusy(true);setError('');setDone('');
  try{const view=await regradeArtifact(artifactId);onChange(view);setDone(`다시 점검했습니다. 차단 ${view.issues.filter(i=>i.severity==='block').length}건, 주의 ${view.issues.filter(i=>i.severity==='warn').length}건입니다.`)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const shown=compliance?.categories.filter(c=>c.warn||c.block)??[],clean=compliance?.categories.filter(c=>!c.warn&&!c.block)??[];
 return <section className="compliance-panel form-stack" aria-label="규정 점검">
  <div className="section-heading"><h4>규정 점검</h4><Button type="button" size="sm" variant="outline" disabled={busy||!canManage} disabledReason={!canManage?'대표·관리자만 다시 점검할 수 있습니다.':undefined} onClick={()=>void recheck()}>{busy?'점검 중':'다시 점검'}</Button></div>
  {!compliance?<p className="loading-line" role="status">규정 점검 결과를 불러오고 있습니다.</p>
   :compliance.status==='not_run'?<p className="subtle-note">본문이 {compliance.lines}줄이라 자동 점검 한도를 넘었습니다. 담당자가 원문 규정을 직접 확인하세요.</p>
   :<>
    <MetaLine items={[`점검 ${kst(compliance.checkedAt)}`,compliance.gradedAt&&`저장된 채점 ${kst(compliance.gradedAt)}`]}/>
    <ul className="compliance-categories" aria-label="분류별 결과">{shown.map(c=><li key={c.category}>
     <MetaLine items={[<b key="l">{c.label}</b>,`통과 ${c.pass}`,`주의 ${c.warn}`,`차단 ${c.block}`]}/>
     <ul>{compliance.issues.filter(i=>i.category===c.category).map((i,n)=><li key={i.ruleId+n} data-severity={i.severity}>
      <MetaLine items={[<b key="s" className="severity-label">{SEVERITY_LABELS[i.severity]}</b>,i.title,`출처 ${i.sources.length}건`]}/>
      <q className="compliance-excerpt">{i.excerpt}</q>
      {i.sources[0]&&<a className="citation-link" href={i.sources[0].url} target="_blank" rel="noopener noreferrer" aria-label={`법령 근거: ${i.sources[0].title}`}>법령 근거</a>}
     </li>)}</ul>
    </li>)}</ul>
    {clean.length>0&&<p className="subtle-note">걸린 표현이 없는 분류 {clean.length}개: {clean.map(c=>`${c.label} 통과 ${c.pass}`).join(', ')}.</p>}
    <p className="subtle-note">{compliance.notice}</p>
   </>}
  {done&&<p className="subtle-note" role="status">{done}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  <CreativeScoreCard artifactId={artifactId} artifactVersion={artifactVersion} canManage={canManage}/>
 </section>;
}
