'use client';
// 후보 상세 페이지(같은 화면 안, 이동 경로 '후보 목록 › 상품'). 출처별 추세(같은 시간축), 하위 점수와 근거(칩 → 스냅샷 상세), 경쟁 구조 표,
// 소싱 견적 연결과 손익 시뮬레이터, 리스크 검토, 브랜드 적합성(아카이브 대조 힌트), 결정.
import {useEffect,useMemo,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {MetaLine} from '@/components/app/meta-line';
import {StatList} from '@/components/app/stat-list';
import {dateTime} from '@/lib/format';
import {productSubjects,signed,weekDelta} from '@/lib/product-research/ui-detail';
import {SUB_SCORES} from '@/lib/product-research/types';
import {MATCH_KEYS_MAX} from '@/lib/product-research/api';
import {categoryLabel,confidence,DecisionBox,editReason,Meter,regulatoryLabels,score,subScoreLabels,temperatureLabels,TierBadge,type Act,type Product,type View} from './product-research-shared';
import {EvidenceChips,SeriesSection,SnapshotPanel} from './product-research-evidence';
import {BrandFitSection,CompetitionSection,RiskReviewSection,bandText} from './product-research-review';
import {SourcingAndMargin} from './product-research-sourcing';
import s from './product-research.module.css';

export function CandidateDetail({view,product,act,busy,onBack}:{view:View;product:Product;act:Act;busy:boolean;onBack:()=>void}){
 const title=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{title.current?.focus({preventScroll:true});title.current?.scrollIntoView({block:'start'})},[]);
 const card=product.score;
 const evidence=[...new Set(card?.subScores.flatMap(x=>x.evidence)??[])];
 const subjects=useMemo(()=>productSubjects(product,view.keywordGroups),[product,view.keywordGroups]);
 const [snapshot,setSnapshot]=useState<string|null>(null);
 const delta=weekDelta(product);
 const filtered=product.filtered?.reasons??[];
 return <article className={s.detail} aria-labelledby="pr-detail-title">
  <nav aria-label="이동 경로"><ol className="crumbs"><li><Button variant="link" size="sm" className="h-auto p-0 text-[13px]" onClick={onBack}>후보 목록</Button></li><li aria-current="page">{product.name}</li></ol></nav>
  <div className={s.detailHead}>
   <div><h2 id="pr-detail-title" ref={title} tabIndex={-1} className={s.title}>{product.name}</h2>
    <p className={s.muted}><MetaLine items={[product.brand??'브랜드 미확인',categoryLabel(product.categoryId),temperatureLabels[product.temperature],regulatoryLabels[product.regulatory],`가격대 ${bandText(product.priceBand)}`]}/></p>
    {filtered.length>0&&<p className={s.badges} aria-label="조사 방향 밖 표시">{filtered.map(x=><span key={x} className={'status '+s.warn}>{x}</span>)}</p>}</div>
   <TierBadge card={card}/>
  </div>
  <StatList className={s.stats} label="점수표 요약" items={[['총점',score(card)],['신뢰도',confidence(card)],['지난주 대비 총점',delta?signed(delta.total):'지난주 점수 없음'],['지난주 대비 모멘텀',delta?signed(delta.momentum):'지난주 점수 없음'],['가중치 판',card?.weightsVersion??'미확인'],['계산 시각',dateTime(card?.computedAt)],['비어 있는 자료',card?.missing.length?card.missing.map(k=>subScoreLabels[k]).join(', '):'없음']]}/>
  {card?.blocked&&<p className={s.blockNote} role="note"><b>선정 금지</b> {card.blocked.reason}(규칙 {card.blocked.rule}). 총점과 관계없이 승인할 수 없습니다.</p>}
  {filtered.length>0&&<p className={s.muted}>조사 방향(보관 온도, 가격 상한) 밖이라 목록 뒤로 보냈습니다. 지우지 않았고 결정은 그대로 할 수 있습니다.</p>}
  <MatchCheck view={view} product={product} act={act} busy={busy}/>
  <SeriesSection view={view} product={product} subjects={subjects}/>
  <section className={s.block} aria-labelledby="pr-sub-title"><h3 id="pr-sub-title" className={s.subtitle}>하위 점수와 근거</h3>
   {card?<ul className={s.subScores}>{SUB_SCORES.map(key=>{const sub=card.subScores.find(x=>x.key===key);return <li key={key}>
    <Meter label={subScoreLabels[key]} value={sub?.value??null}/>
    <p className={s.reason}>{sub?.reason||'이 하위 점수에 쓸 자료가 없습니다.'}</p>
    <EvidenceChips view={view} ids={sub?.evidence??[]} open={snapshot} onOpen={setSnapshot}/>
   </li>})}</ul>:<p className={s.muted}>점수표가 아직 없습니다. 출처와 가져오기 탭에서 점수를 다시 계산하세요.</p>}
   {snapshot&&<SnapshotPanel view={view} id={snapshot} subjects={subjects} onClose={()=>setSnapshot(null)}/>}
  </section>
  <CompetitionSection view={view} product={product}/>
  <SourcingAndMargin view={view} product={product} act={act} busy={busy}/>
  <RiskReviewSection view={view} product={product} act={act} busy={busy}/>
  <BrandFitSection view={view} product={product} act={act} busy={busy}/>
  <section className={s.block} aria-labelledby="pr-decide-title"><h3 id="pr-decide-title" className={s.subtitle}>결정</h3><DecisionBox view={view} product={product} act={act} busy={busy}/></section>
  {evidence.length>0&&<section className={s.block} aria-labelledby="pr-evidence-title"><h3 id="pr-evidence-title" className={s.subtitle}>근거 스냅샷 {evidence.length}개</h3>
   <EvidenceChips view={view} ids={evidence} open={snapshot} onOpen={id=>{setSnapshot(id)}}/></section>}
 </article>;
}

// 매칭 신뢰도 0.95 미만은 사람이 같은 상품인지 확인한다.
function MatchCheck({view,product,act,busy}:{view:View;product:Product;act:Act;busy:boolean}){
 const m=product.match;
 if(m.confidence>=0.95||m.confirmedBy)return <p className={s.muted}>상품 매칭: {m.method==='manual'?'사람 확인':m.method==='barcode'?'바코드':'브랜드·이름·용량'} 기준, 신뢰도 {Math.round(m.confidence*100)}%{m.confirmedBy?`(확인 ${m.confirmedBy.email??'확인한 사람 미확인'})`:''}.</p>;
 const keys=product.listings.map(l=>`${l.sourceId}:${l.externalId}`),why=!view.canEdit?editReason:keys.length<2?'묶인 판매 목록이 하나라 확인할 것이 없습니다.':keys.length>MATCH_KEYS_MAX?`묶인 판매 목록이 ${MATCH_KEYS_MAX}개를 넘어 한 번에 확인할 수 없습니다.`:'';
 return <div className={s.matchBox} role="note"><p>여러 판매 목록을 같은 상품으로 묶은 신뢰도가 {Math.round(m.confidence*100)}%입니다. 같은 상품인지 확인하세요.</p>
  <div className={s.toolbar}><Button type="button" variant="outline" size="sm" disabled={busy||!!why} disabledReason={why} onClick={()=>void act({action:'confirm_match',productId:product.id,decision:'merge',listingKeys:keys},'같은 상품으로 확인했습니다.')}>같은 상품으로 확인</Button>
  <Button type="button" variant="outline" size="sm" disabled={busy||!!why} disabledReason={why} onClick={()=>void act({action:'confirm_match',productId:product.id,decision:'split',listingKeys:keys},'판매 목록을 따로 나눴습니다.','다시 계산하면 나뉜 상품마다 점수표가 생깁니다.')}>다른 상품으로 나누기</Button></div>
 </div>;
}
