'use client';
// 후보 상세의 판단 칸: 경쟁 구조 표(⑤), 리스크 검토 체크리스트 저장(⑦), 브랜드 적합성 사람 판정과 아카이브 대조 힌트(⑧).
// 검사 한도는 lib/product-research/api.ts 상수(ui-detail.ts)만 쓴다. 힌트는 칸을 자동으로 채우지 않는다(사람 판정이 정본).
import {useState} from 'react';
import {ExternalLink} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {CheckInput} from '@/components/app/check';
import {MetaLine} from '@/components/app/meta-line';
import {StatList} from '@/components/app/stat-list';
import {count,dateTime,money,percent} from '@/lib/format';
import {marginNumber} from '@/lib/product-research/ui-margin';
import {brandFitReasonWhy,brandFitValueWhy,LIMITS,riskItemsWithIds,riskNoteWhy} from '@/lib/product-research/ui-detail';
import type {CompetitionDetail,RegulatoryClass} from '@/lib/product-research/types';
import {editReason,regulatoryLabels,sourceLabel,type Act,type Product,type View} from './product-research-shared';
import s from './product-research.module.css';

const subLine=(v:number|null|undefined)=>v==null?'미확인':`${Math.round(v)}/100`;
export const bandText=(b:Product['priceBand'])=>b.min===null&&b.max===null?'미확인':b.min===b.max||b.max===null?money(b.min):b.min===null?`${money(b.max)} 이하`:`${money(b.min)}~${money(b.max)}`;

// 경쟁 구조: 하위 점수 설명(SubScore.detail)을 표로. 자료가 없는 칸은 '미확인'(0 아님).
export function CompetitionSection({view,product}:{view:View;product:Product}){
 const sub=product.score?.subScores.find(x=>x.key==='competition'),d:CompetitionDetail|null=sub?.detail??null;
 const band=d?.priceBand?`${money(d.priceBand.p25)} / ${money(d.priceBand.p50)} / ${money(d.priceBand.p75)}`:'미확인';
 return <section className={s.block} aria-labelledby="pr-comp-title"><h3 id="pr-comp-title" className={s.subtitle}>경쟁 구조</h3>
  <p className={s.reason}>{sub?.reason||'경쟁 지표(판매처 수, 상위 리뷰 수, 광고 경쟁 지수)가 아직 없습니다.'}</p>
  <StatList className={s.stats} label="경쟁 구조 표" items={[
   ['경쟁 강도 점수',subLine(sub?.value)],
   ['판매처 수',count(d?.sellerCount,'곳')],
   ['상품 수',count(d?.productCount,'개')],
   ['상위 10 집중도',d?.top10Hhi==null?'미확인':d.top10Hhi.toFixed(2)],
   ['가격대(하위 25% / 중앙 / 상위 25%)',band],
   ['신규 진입 비율(최근 8주)',percent(d?.newEntrantShare??null)],
  ]}/>
  {d?.emptySlot&&<p className={s.slotNote} role="note"><b>비어 있는 자리</b> {d.emptySlot}</p>}
  {!d&&<p className={s.muted}>점수표에 경쟁 구조 설명이 아직 없습니다. 쇼핑 검색 수집이나 랭킹 가져오기 뒤 다시 계산하면 채워집니다.</p>}
  <StatList className={s.stats} label="연결 요약" items={[['연결한 판매 목록',count(product.listings.length,'개')],['가격대',bandText(product.priceBand)]]}/>
  {product.listings.length>0&&<ul className={s.listings}>{product.listings.map(l=><li key={l.sourceId+':'+l.externalId}><MetaLine items={[sourceLabel(view,l.sourceId),l.title]}/>{l.url&&<a href={l.url} target="_blank" rel="noreferrer noopener" className={s.extLink}>원본 보기<ExternalLink size={13} aria-hidden="true"/></a>}</li>)}</ul>}
 </section>;
}

// 규제 분류·보관 온도에서 나온 기본 점검 항목(리스크 '높음' 사유 다음에 붙인다).
const riskItems:Record<RegulatoryClass,readonly string[]>={
 food:['식품 표시사항(원재료, 알레르기, 소비기한) 확인','수입 식품이면 수입신고와 한글 표시 확인','제조원 영업등록 확인'],
 health_functional_food:['건강기능식품 표시·광고 사전 심의 필요 여부','기능성 원료 인정 범위 밖 표현 금지','수입 건강기능식품 신고 확인'],
 cosmetics:['전성분 표시와 책임판매업자 확인','의약품 오인 표현 금지'],
 functional_cosmetics:['기능성 화장품 보고·심사 확인','기능성 범위 밖 효능 표현 금지'],
 kc_electrical:['KC 전기용품 안전인증 번호 확인','전파 인증이 필요한 무선 기능 여부'],
 kc_children:['KC 어린이제품 안전인증 확인','사용 연령과 경고 표시 확인'],
 general:['상표권 침해 여부(같은 이름, 로고)','가품·병행수입 신호 확인'],
};
const baseItems=(p:Product)=>[...riskItems[p.regulatory],...(p.regulatory!=='general'?riskItems.general:[]),...(p.temperature==='chilled'||p.temperature==='frozen'?['냉장·냉동 배송(콜드체인) 가능 여부와 비용 확인']:[]),...(p.temperature==='unknown'?['보관 온도 확인(상온 우선 결정)']:[])];

// 리스크 검토: 점검 항목 체크와 메모를 이 점수표 판에 저장한다(save_risk_review). 리스크 높음 점수표는 저장한 검토(모두 확인)가 있어야 승인할 수 있다.
export function RiskReviewSection({view,product,act,busy}:{view:View;product:Product;act:Act;busy:boolean}){
 const card=product.score,saved=card?view.riskReviews?.find(r=>r.scoreCardId===card.id)??null:null;
 // 서버 필수 항목(riskChecklists)을 앞에 두고, 저장 때 그 항목은 ruleId를 같이 보낸다(평가 2회차 H1: 승인에는 필수 항목만 센다).
 const pairs=card?riskItemsWithIds(card,view.riskChecklists?.find(c=>c.scoreCardId===card.id)?.items,baseItems(product)):baseItems(product).map(rule=>({rule,ruleId:null as string|null})),items=pairs.map(x=>x.rule);
 const [done,setDone]=useState<string[]>(()=>saved?saved.checklist.filter(x=>x.checked).map(x=>x.rule):[]),[note,setNote]=useState(saved?.note??'');
 const risk=card?.subScores.find(x=>x.key==='risk');
 const changed=!saved||saved.note!==note.trim()||items.some(x=>done.includes(x)!==!!saved.checklist.find(c=>c.rule===x)?.checked);
 const why=!view.canEdit?editReason:!card?'점수표가 아직 없어 검토를 저장할 판이 없습니다. 먼저 점수를 다시 계산하세요.':riskNoteWhy(note)||(!changed?'바뀐 체크나 메모가 없습니다.':'');
 const open=items.filter(x=>!done.includes(x)).length;
 const save=()=>{if(!card||why)return;void act({action:'save_risk_review',productId:product.id,scoreCardId:card.id,checklist:pairs.map(({rule,ruleId})=>({rule,checked:done.includes(rule),...(ruleId?{ruleId}:{})})),note:note.trim()},'리스크 검토를 저장했습니다.',open?`확인하지 않은 항목 ${open}개가 남아 있습니다.`:'모든 항목을 확인했습니다.')};
 return <section className={s.block} aria-labelledby="pr-risk-title"><h3 id="pr-risk-title" className={s.subtitle}>리스크 검토({regulatoryLabels[product.regulatory]})</h3>
  {card?.blocked&&<p className={s.blockNote} role="note"><b>선정 금지</b> {card.blocked.reason} 이 판은 승인할 수 없습니다.</p>}
  {card?.needsReview&&card.review&&<div className={s.matchBox} role="note"><p><b>사람 검토 필요(리스크 높음)</b> 아래 항목을 모두 확인해 저장하거나, 결정 사유에 확인한 위험을 적고 위험 확인을 표시해야 승인할 수 있습니다.</p><ul className={s.notes}>{card.review.reasons.map(x=><li key={x}>{x}</li>)}</ul></div>}
  {risk?.reason&&<p className={s.reason}>{risk.reason}</p>}
  <fieldset className={s.riskList}><legend className="sr-only">리스크 점검 항목</legend>{items.map(x=><label key={x} className={s.check}><CheckInput checked={done.includes(x)} disabled={!view.canEdit} onChange={()=>setDone(d=>d.includes(x)?d.filter(y=>y!==x):[...d,x])}/>{x}</label>)}</fieldset>
  <label className="field"><span>검토 메모(선택, {LIMITS.riskNoteMax}자까지)</span><Textarea aria-label="리스크 검토 메모" value={note} maxLength={LIMITS.riskNoteMax} disabled={!view.canEdit} placeholder="예: 판매 페이지의 '다이어트 효과' 문구를 빼기로 공급사와 확인했습니다." onChange={e=>setNote(e.target.value)}/></label>
  <div className={s.toolbar}><Button type="button" variant="outline" disabled={busy||!!why} disabledReason={why} onClick={save}>리스크 검토 저장</Button>
   <span className={s.muted}>{saved?<MetaLine items={[`저장한 검토 ${dateTime(saved.at)}`,saved.by.email??'저장한 사람 미확인',`확인 ${saved.checklist.filter(x=>x.checked).length}/${saved.checklist.length}`]}/>:'이 점수표 판에 저장한 검토가 아직 없습니다.'}</span></div>
  <p className={s.muted}>법률 자문이 아닙니다. 체크와 메모는 이 점수표 판의 기록으로 남습니다.</p>
 </section>;
}

// 브랜드 적합성: 사람이 매긴 점수(0~100)와 사유. 옆에 브랜드 아카이브 대조 힌트(메모와 인용한 확정 사실)를 보인다. 힌트로 칸을 채우지 않는다.
export function BrandFitSection({view,product,act,busy}:{view:View;product:Product;act:Act;busy:boolean}){
 const current=product.score?.subScores.find(x=>x.key==='brand_fit'),hint=product.score?.brandFitHint??null;
 const [value,setValue]=useState(current?.value==null?'':String(Math.round(current.value))),[reason,setReason]=useState('');
 const why=!view.canEdit?editReason:brandFitValueWhy(value)||brandFitReasonWhy(reason);
 const n=marginNumber(value);
 return <section className={s.block} aria-labelledby="pr-fit-title"><h3 id="pr-fit-title" className={s.subtitle}>브랜드 적합성</h3>
  <p className={s.muted}>지금 점수: {current?.value==null?'미확인':Math.round(current.value)}{current?.reason?`. ${current.reason}`:''}</p>
  <div className={s.fitGrid}>
   <div className={s.formGrid}>
    <label className="field"><span>적합성 점수(0~100)</span><Input type="number" min={0} max={100} inputMode="numeric" value={value} disabled={!view.canEdit} onChange={e=>setValue(e.target.value)}/></label>
    <label className={'field '+s.wide}><span>사유({LIMITS.reasonMin}~{LIMITS.brandFitReasonMax}자)</span><Input value={reason} maxLength={LIMITS.brandFitReasonMax} disabled={!view.canEdit} placeholder="예: 브랜드 아카이브의 '매운맛 소스' 사실과 맞습니다." onChange={e=>setReason(e.target.value)}/></label>
   </div>
   <aside className={s.hintBox} aria-label="브랜드 적합성 힌트">
    <b className={s.cardTitle}>아카이브 대조 힌트</b>
    {hint?<><p className={s.reason}>{hint.memo}</p>
     <p className={s.muted}><MetaLine items={[`힌트 점수 ${hint.score===null?'미확인':Math.round(hint.score)}`,hint.factIds.length?`인용한 확정 사실 ${hint.factIds.length}개`:'인용한 확정 사실 없음']}/></p>
     {hint.factIds.length>0&&<p className={s.evidence}>확정 사실: {hint.factIds.map(id=><span key={id} className={s.factChip} title={id}>{id}</span>)}</p>}</>
     :<p className={s.muted}>점수표에 힌트가 아직 없습니다. 다시 계산하면 브랜드 아카이브 확정 사실과 대조한 메모가 붙습니다.</p>}
    <p className={s.muted}>힌트는 판정 칸을 채우지 않습니다. 사람이 점수와 사유를 씁니다.</p>
   </aside>
  </div>
  <Button type="button" variant="outline" disabled={busy||!!why} disabledReason={why} onClick={()=>void act({action:'set_brand_fit',productId:product.id,value:n??0,reason:reason.trim()},'브랜드 적합성을 저장했습니다.','다시 계산한 점수표에 반영했습니다.').then(r=>{if(r.ok)setReason('')})}>브랜드 적합성 저장</Button>
 </section>;
}
