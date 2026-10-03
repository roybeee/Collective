'use client';
// 선정 위원회: 후보 2~4개를 나란히 비교하고 같은 자리에서 결정한다. MD 선정 메모는 결정형 템플릿 또는 AI 팀 상품 MD 역할(토큰 사용)로 만들고, 인용 검사 결과를 보인다.
import {useState} from 'react';
import {CheckCircle2,AlertTriangle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {CardButton} from '@/components/app/card-button';
import {CheckInput} from '@/components/app/check';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {StatList} from '@/components/app/stat-list';
import {dateTime} from '@/lib/format';
import {SUB_SCORES,type MdBrief} from '@/lib/product-research/types';
import {questionWhy,LIMITS} from '@/lib/product-research/ui-detail';
import {categoryLabel,confidence,DecisionBadge,DecisionBox,editReason,evidenceLabel,score,scoreSort,subScoreLabels,temperatureLabels,TierBadge,tierLabels,type Act,type Product,type View} from './product-research-shared';
import s from './product-research.module.css';

const MAX=4,PICK_LIST=30;
const recommendationLabels:Record<MdBrief['recommendation'],string>={adopt:'도입 권고',watch:'관찰 권고',reject:'제외 권고'};

export function CommitteeTab({view,act,busy,onOpen}:{view:View;act:Act;busy:boolean;onOpen:(id:string)=>void}){
 const ranked=[...view.products].sort((a,b)=>scoreSort(b.score)-scoreSort(a.score));
 // 처음에는 총점이 높은 후보 둘을 골라 둔다(제외 결정한 후보는 뺀다).
 const [picked,setPicked]=useState<string[]>(()=>ranked.filter(p=>p.decision?.status!=='rejected').slice(0,2).map(p=>p.id));
 const [question,setQuestion]=useState(view.settings.question);
 const chosen=picked.map(id=>view.products.find(p=>p.id===id)).filter((p):p is Product=>!!p);
 const toggle=(id:string)=>setPicked(p=>p.includes(id)?p.filter(x=>x!==id):p.length>=MAX?p:[...p,id]);
 const briefWhy=!view.canEdit?editReason:!chosen.length?'비교할 후보를 하나 이상 고르세요.':questionWhy(question,true);
 const brief=(mode:'template'|'model')=>void act({action:'generate_brief',productIds:chosen.map(p=>p.id),question:question.trim(),mode},mode==='model'?'선정 메모를 만들었습니다.':'템플릿 선정 메모를 만들었습니다.','인용 검사를 통과한 메모만 저장됩니다.');
 const briefs=[...view.briefs].filter(b=>!chosen.length||b.productIds.some(id=>picked.includes(id))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return <section className={s.section} aria-labelledby="pr-committee-title">
  <h2 id="pr-committee-title" className={s.title}>선정 위원회</h2>
  <details className={s.details} open={!chosen.length}><summary>비교할 후보 고르기({chosen.length}/{MAX})</summary>
   {ranked.length?<fieldset className={s.pickList}><legend className="sr-only">비교할 후보</legend>{ranked.slice(0,PICK_LIST).map(p=><label key={p.id} className={s.check}><CheckInput checked={picked.includes(p.id)} disabled={!picked.includes(p.id)&&picked.length>=MAX} onChange={()=>toggle(p.id)}/><span>{p.name}</span><small className={s.muted}><MetaLine items={[`총점 ${score(p.score)}`,p.score?tierLabels[p.score.tier]:'점수표 없음']}/></small></label>)}</fieldset>
    :<EmptyLine next="출처와 가져오기 탭에서 자료를 가져온 뒤 점수를 다시 계산하세요.">비교할 후보가 아직 없습니다.</EmptyLine>}
   {picked.length>=MAX&&<p className={s.muted}>한 번에 {MAX}개까지 비교합니다. 다른 후보를 보려면 하나를 빼세요.</p>}
  </details>
  {chosen.length>0&&<div className={s.columns}>{chosen.map(p=><article key={p.id} className={s.column} aria-label={`${p.name} 비교`}>
   <CardButton className={s.nameLink} onClick={()=>onOpen(p.id)}><b>{p.name}</b></CardButton>
   <small className={s.muted}><MetaLine items={[categoryLabel(p.categoryId),temperatureLabels[p.temperature]]}/></small>
   <div className={s.badges}><TierBadge card={p.score}/><DecisionBadge product={p}/></div>
   <StatList className={s.stats} label={`${p.name} 점수`} items={[['총점',score(p.score)],['신뢰도',confidence(p.score)],...SUB_SCORES.map(k=>[subScoreLabels[k],(()=>{const v=p.score?.subScores.find(x=>x.key===k)?.value;return v==null?'미확인':String(Math.round(v))})()] as const)]}/>
   {p.score?.blocked&&<p className={s.blocked}>선정 금지: {p.score.blocked.reason}</p>}
   <DecisionBox view={view} product={p} act={act} busy={busy} compact/>
   <Button type="button" variant="ghost" size="sm" onClick={()=>toggle(p.id)}>비교에서 빼기</Button>
  </article>)}</div>}
  <section className={s.block} aria-labelledby="pr-brief-title"><h3 id="pr-brief-title" className={s.subtitle}>MD 선정 메모</h3>
   <label className="field"><span>조사 질문({LIMITS.question}자까지)</span><Input value={question} maxLength={LIMITS.question} placeholder="예: 여름 상온 K-스낵, 2만 원 이하" onChange={e=>setQuestion(e.target.value)}/></label>
   <div className={s.toolbar}>
    <Button type="button" variant="outline" disabled={busy||!!briefWhy} disabledReason={briefWhy} onClick={()=>brief('template')}>템플릿으로 메모 만들기</Button>
    <Button type="button" disabled={busy||!!briefWhy} disabledReason={briefWhy} onClick={()=>brief('model')}>AI 상품 MD로 메모 만들기</Button>
   </div>
   <p className={s.muted}>AI 상품 MD는 토큰을 쓰고 AI 사용량에 기록됩니다. 템플릿은 토큰을 쓰지 않습니다. 모델은 점수를 설명만 하고 바꾸지 못합니다.</p>
   {briefs.length?<ul className={s.briefs}>{briefs.map(b=><li key={b.id} className={s.briefCard}><BriefCard view={view} brief={b}/></li>)}</ul>
    :<EmptyLine next="위 버튼으로 고른 후보의 첫 메모를 만드세요.">고른 후보의 선정 메모가 아직 없습니다.</EmptyLine>}
  </section>
 </section>;
}

function BriefCard({view,brief}:{view:View;brief:MdBrief}){
 const names=brief.productIds.map(id=>view.products.find(p=>p.id===id)?.name??'지워진 후보');
 const check=brief.citationCheck;
 return <>
  <div className={s.headRow}><b>{recommendationLabels[brief.recommendation]}</b>{check.passed
   ?<span className={'status status-approved '+s.badgeIcon}><CheckCircle2 size={13} aria-hidden="true"/>인용 검사 통과</span>
   :<span className={'status status-revision '+s.badgeIcon}><AlertTriangle size={13} aria-hidden="true"/>근거 없는 주장 {check.unsupported.length}건</span>}</div>
  <small className={s.muted}><MetaLine items={[brief.author.kind==='model'?'AI 상품 MD 작성':'템플릿 작성',dateTime(brief.createdAt),`후보 ${names.join(', ')}`]}/></small>
  <p className={s.reason}>질문: {brief.question}</p>
  <p>{brief.summary}</p>
  {brief.claims.length>0&&<ul className={s.claims}>{brief.claims.map((c,i)=><li key={i}>{c.text}{c.citations.length>0&&<span className={s.evidence}> 근거: {c.citations.map(id=><span key={id} className={s.evidenceChip} title={id}>{evidenceLabel(view,id)}</span>)}</span>}</li>)}</ul>}
  {!check.passed&&check.unsupported.length>0&&<div className={s.blockNote} role="note"><b>인용이 없는 주장</b><ul>{check.unsupported.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
  {brief.risks.length>0&&<p className={s.muted}>리스크: {brief.risks.join(', ')}</p>}
 </>;
}
