'use client';
import '@/lib/i18n/lazy-trust';
import {lazy,Suspense,useState} from 'react';
import {Button} from '@/components/ui/button';
import {MetaLine} from './meta-line';
import {CreativeScoreCard} from './creative-score-card';
import {regradeArtifact,type AppliedFixes} from '@/lib/artifact-sources-client';
import type {ComplianceView} from '@/lib/artifact-sources';
import {currentLocale,type MessageKey} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import {kstText} from '@/lib/format';

// X7 규정 점검 패널(작업물 상세). 규칙 분류별 통과·주의·차단 수와 걸린 표현(제목·발췌·법령 근거 링크)을 보인다. 자동 점검이며 법률 자문이 아니다.
// '다시 점검'은 POST /api/usage regrade_artifact(대표·관리자, 결정론 채점기, 모델 호출 없음)를 부르고 그 결과로 바꾼다.
// 수정 제안(스위치 compliance_fixes, lib/graders/compliance-fixes.ts)은 보기에 fixes가 있을 때만 lazy 청크(compliance-fixes.tsx)로 내려받아 그린다. 꺼져 있으면 이전 화면과 같다.
// 적용하면 서버가 새 버전을 저장하고 다시 점검한 보기를 돌려준다. 대화상자의 본문은 부모가 다시 읽을 때 새 버전이 되므로, 그 전까지 새 판 번호를 안내한다.
const ComplianceFixes=lazy(()=>import('./compliance-fixes'));
// 아래에 소재 예측 점수 카드(G2, components/app/creative-score-card.tsx)를 붙인다. 목록 배지(ScoreBadge)와 같은 모듈이라 캠페인 상세 청크(app/panels.tsx, lazy)에 함께 실린다. 홈 첫 로딩에는 없다.
// 점검 시각은 화면 언어로 적는다(lib/format.ts kstText, 한국어는 이전 결과와 같다). 분류 이름·고지문은 서버 값이 한국어 원본이고, 영어·일본어일 때만 사전(trust.category.<분류>·trust.cmp.notice)으로 바꾼다. 규칙 제목·발췌·법령 출처는 원문 그대로 둔다.
const kst=(iso:string|null)=>iso?kstText(iso,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):null;
const counts=(view:ComplianceView)=>({block:view.issues.filter(i=>i.severity==='block').length,warn:view.issues.filter(i=>i.severity==='warn').length});
export function CompliancePanel({artifactId,artifactVersion,compliance,canManage,onChange}:{artifactId:string;artifactVersion:number;compliance:ComplianceView|null;canManage:boolean;onChange:(view:ComplianceView)=>void}){
 const t=useT(),ko=currentLocale()==='ko',[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 function applied(result:AppliedFixes){onChange(result.compliance);setError('');setDone(t('trust.cmp.appliedDone',{version:result.version,...counts(result.compliance)}))}
 async function recheck(){
  setBusy(true);setError('');setDone('');
  try{const view=await regradeArtifact(artifactId);onChange(view);setDone(t('trust.cmp.recheckDone',counts(view)))}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const category=(c:{category:string;label:string})=>{if(ko)return c.label;const key=`trust.category.${c.category}` as MessageKey,text=t(key);return text===key?c.label:text};
 const shown=compliance?.categories.filter(c=>c.warn||c.block)??[],clean=compliance?.categories.filter(c=>!c.warn&&!c.block)??[];
 return <section className="compliance-panel form-stack" aria-label={t('trust.cmp.heading')}>
  <div className="section-heading"><h4>{t('trust.cmp.heading')}</h4><Button type="button" size="sm" variant="outline" disabled={busy||!canManage} disabledReason={!canManage?t('trust.cmp.denied'):undefined} onClick={()=>void recheck()}>{busy?t('trust.cmp.checking'):t('trust.cmp.recheck')}</Button></div>
  {!compliance?<p className="loading-line" role="status">{t('trust.cmp.loading')}</p>
   :compliance.status==='not_run'?<p className="subtle-note">{t('trust.cmp.notRun',{lines:compliance.lines})}</p>
   :<>
    <MetaLine items={[t('trust.cmp.checkedAt',{at:kst(compliance.checkedAt)??''}),compliance.gradedAt&&t('trust.cmp.gradedAt',{at:kst(compliance.gradedAt)??''})]}/>
    <ul className="compliance-categories" aria-label={t('trust.cmp.categories')}>{shown.map(c=><li key={c.category}>
     <MetaLine items={[<b key="l">{category(c)}</b>,t('trust.cmp.pass',{n:c.pass}),t('trust.cmp.warn',{n:c.warn}),t('trust.cmp.block',{n:c.block})]}/>
     <ul>{compliance.issues.filter(i=>i.category===c.category).map((i,n)=><li key={i.ruleId+n} data-severity={i.severity}>
      <MetaLine items={[<b key="s" className="severity-label">{t(i.severity==='block'?'trust.severity.block':'trust.severity.warn')}</b>,i.title,t('trust.cmp.sources',{n:i.sources.length})]}/>
      <q className="compliance-excerpt">{i.excerpt}</q>
      {i.sources[0]&&<a className="citation-link" href={i.sources[0].url} target="_blank" rel="noopener noreferrer" aria-label={t('trust.cmp.lawLinkLabel',{title:i.sources[0].title})}>{t('trust.cmp.lawLink')}</a>}
     </li>)}</ul>
    </li>)}</ul>
    {clean.length>0&&<p className="subtle-note">{t('trust.cmp.clean',{n:clean.length,list:clean.map(c=>t('trust.cmp.cleanItem',{label:category(c),n:c.pass})).join(', ')})}</p>}
    {compliance.fixes&&compliance.issues.length>0&&<Suspense fallback={null}><ComplianceFixes key={compliance.fixes.version} artifactId={artifactId} compliance={compliance} canManage={canManage} onApplied={applied}/></Suspense>}
    <p className="subtle-note">{ko?compliance.notice:t('trust.cmp.notice')}</p>
   </>}
  {done&&<p className="subtle-note" role="status">{done}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  <CreativeScoreCard artifactId={artifactId} artifactVersion={artifactVersion} canManage={canManage}/>
 </section>;
}
