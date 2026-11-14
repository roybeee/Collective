'use client';
import {lazy,Suspense,useState} from 'react';
import {Button} from '@/components/ui/button';
import {MetaLine} from './meta-line';
import {CreativeScoreCard} from './creative-score-card';
import {ComplianceRate} from './compliance-rate';
import {regradeArtifact,type AppliedFixes} from '@/lib/artifact-sources-client';
import {SEVERITY_LABELS,type ComplianceView} from '@/lib/artifact-sources';

// X7 규정 점검 패널(작업물 상세). 규칙 분류별 통과·주의·차단 수와 걸린 표현(제목·발췌·법령 근거 링크)을 보인다. 자동 점검이며 법률 자문이 아니다.
// '다시 점검'은 POST /api/usage regrade_artifact(대표·관리자, 결정론 채점기, 모델 호출 없음)를 부르고 그 결과로 바꾼다.
// 수정 제안(스위치 compliance_fixes, lib/graders/compliance-fixes.ts)은 보기에 fixes가 있을 때만 lazy 청크(compliance-fixes.tsx)로 내려받아 그린다. 꺼져 있으면 이전 화면과 같다.
// 적용하면 서버가 새 버전을 저장하고 다시 점검한 보기를 돌려준다. 대화상자의 본문은 부모가 다시 읽을 때 새 버전이 되므로, 그 전까지 새 판 번호를 안내한다.
const ComplianceFixes=lazy(()=>import('./compliance-fixes'));
// 아래에 소재 예측 점수 카드(G2, components/app/creative-score-card.tsx)를 붙인다. 목록 배지(ScoreBadge)와 같은 모듈이라 캠페인 상세 청크(app/panels.tsx, lazy)에 함께 실린다. 홈 첫 로딩에는 없다.
const kst=(iso:string|null)=>iso?new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):null;
export function CompliancePanel({artifactId,artifactVersion,compliance,canManage,onChange}:{artifactId:string;artifactVersion:number;compliance:ComplianceView|null;canManage:boolean;onChange:(view:ComplianceView)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 function applied(result:AppliedFixes){onChange(result.compliance);setError('');setDone(`v${result.version} 점검 결과입니다. 차단 ${result.compliance.issues.filter(i=>i.severity==='block').length}건, 주의 ${result.compliance.issues.filter(i=>i.severity==='warn').length}건입니다. 본문은 이 창을 다시 열면 v${result.version}으로 보입니다.`)}
 async function recheck(){
  setBusy(true);setError('');setDone('');
  try{const view=await regradeArtifact(artifactId);onChange(view);setDone(`다시 점검했습니다. 차단 ${view.issues.filter(i=>i.severity==='block').length}건, 주의 ${view.issues.filter(i=>i.severity==='warn').length}건입니다.`)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const shown=compliance?.categories.filter(c=>c.warn||c.block)??[],clean=compliance?.categories.filter(c=>!c.warn&&!c.block)??[];
 return <section className="compliance-panel form-stack" aria-label="규정 점검">
  <div className="section-heading"><h4>규정 점검</h4><ComplianceRate compliance={compliance}/><Button type="button" size="sm" variant="outline" disabled={busy||!canManage} disabledReason={!canManage?'대표·관리자만 다시 점검할 수 있습니다.':undefined} onClick={()=>void recheck()}>{busy?'점검 중':'다시 점검'}</Button></div>
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
    {compliance.fixes&&compliance.issues.length>0&&<Suspense fallback={null}><ComplianceFixes key={compliance.fixes.version} artifactId={artifactId} compliance={compliance} canManage={canManage} onApplied={applied}/></Suspense>}
    <p className="subtle-note">{compliance.notice}</p>
   </>}
  {done&&<p className="subtle-note" role="status">{done}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  <CreativeScoreCard artifactId={artifactId} artifactVersion={artifactVersion} canManage={canManage}/>
 </section>;
}
