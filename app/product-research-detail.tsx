'use client';
// 후보 상세 페이지(같은 화면 안, 이동 경로 '후보 목록 › 상품'). 출처별 추세(같은 시간축), 하위 점수와 근거, 경쟁 요약, 손익 시뮬레이터, 리스크 확인, 브랜드 적합성, 결정.
import {useEffect,useMemo,useRef,useState} from 'react';
import {ExternalLink} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {CheckInput} from '@/components/app/check';
import {MetaLine} from '@/components/app/meta-line';
import {StatList} from '@/components/app/stat-list';
import {TrendBars} from '@/components/app/trend-bars';
import {count,dateTime,money} from '@/lib/format';
import {MARGIN_CHANNELS,computeMargin,marginNumber} from '@/lib/product-research/ui-margin';
import {SUB_SCORES,type RegulatoryClass,type Series} from '@/lib/product-research/types';
import {categoryLabel,confidence,DecisionBox,editReason,evidenceLabel,Meter,metricLabels,regulatoryLabels,score,sourceLabel,subScoreLabels,temperatureLabels,TierBadge,type Act,type Product,type View} from './product-research-shared';
import s from './product-research.module.css';

export function CandidateDetail({view,product,act,busy,onBack}:{view:View;product:Product;act:Act;busy:boolean;onBack:()=>void}){
 const title=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{title.current?.focus({preventScroll:true});title.current?.scrollIntoView({block:'start'})},[]);
 const card=product.score,band=product.priceBand;
 const evidence=[...new Set(card?.subScores.flatMap(x=>x.evidence)??[])];
 return <article className={s.detail} aria-labelledby="pr-detail-title">
  <nav aria-label="이동 경로"><ol className="crumbs"><li><Button variant="link" size="sm" className="h-auto p-0 text-[13px]" onClick={onBack}>후보 목록</Button></li><li aria-current="page">{product.name}</li></ol></nav>
  <div className={s.detailHead}>
   <div><h2 id="pr-detail-title" ref={title} tabIndex={-1} className={s.title}>{product.name}</h2>
    <p className={s.muted}><MetaLine items={[product.brand??'브랜드 미확인',categoryLabel(product.categoryId),temperatureLabels[product.temperature],regulatoryLabels[product.regulatory],`가격대 ${bandText(band)}`]}/></p></div>
   <TierBadge card={card}/>
  </div>
  <StatList className={s.stats} label="점수표 요약" items={[['총점',score(card)],['신뢰도',confidence(card)],['가중치 판',card?.weightsVersion??'미확인'],['계산 시각',dateTime(card?.computedAt)],['비어 있는 자료',card?.missing.length?card.missing.map(k=>subScoreLabels[k]).join(', '):'없음']]}/>
  {card?.blocked&&<p className={s.blockNote} role="note"><b>선정 금지</b> {card.blocked.reason}(규칙 {card.blocked.rule}). 총점과 관계없이 승인할 수 없습니다.</p>}
  <MatchCheck view={view} product={product} act={act} busy={busy}/>
  <SeriesSection view={view} product={product}/>
  <section className={s.block} aria-labelledby="pr-sub-title"><h3 id="pr-sub-title" className={s.subtitle}>하위 점수와 근거</h3>
   {card?<ul className={s.subScores}>{SUB_SCORES.map(key=>{const sub=card.subScores.find(x=>x.key===key);return <li key={key}>
    <Meter label={subScoreLabels[key]} value={sub?.value??null}/>
    <p className={s.reason}>{sub?.reason||'이 하위 점수에 쓸 자료가 없습니다.'}</p>
    {!!sub?.evidence.length&&<p className={s.evidence}>근거: {sub.evidence.map(id=><span key={id} className={s.evidenceChip} title={id}>{evidenceLabel(view,id)}</span>)}</p>}
   </li>})}</ul>:<p className={s.muted}>점수표가 아직 없습니다. 출처와 가져오기 탭에서 점수를 다시 계산하세요.</p>}
  </section>
  <section className={s.block} aria-labelledby="pr-comp-title"><h3 id="pr-comp-title" className={s.subtitle}>경쟁 요약</h3>
   <p className={s.reason}>{card?.subScores.find(x=>x.key==='competition')?.reason||'경쟁 지표(판매처 수·상위 리뷰 수·광고 경쟁 지수)가 아직 없습니다.'}</p>
   <StatList className={s.stats} label="경쟁 요약" items={[['경쟁 강도 점수',subLine(card?.subScores.find(x=>x.key==='competition')?.value)],['연결한 판매 목록',count(product.listings.length,'개')],['가격대',bandText(band)]]}/>
   {product.listings.length>0&&<ul className={s.listings}>{product.listings.map(l=><li key={l.sourceId+':'+l.externalId}><MetaLine items={[sourceLabel(view,l.sourceId),l.title]}/>{l.url&&<a href={l.url} target="_blank" rel="noreferrer noopener" className={s.extLink}>원본 보기<ExternalLink size={13} aria-hidden="true"/></a>}</li>)}</ul>}
  </section>
  <MarginSimulator product={product}/>
  <RiskChecklist product={product}/>
  <BrandFit view={view} product={product} act={act} busy={busy}/>
  <section className={s.block} aria-labelledby="pr-decide-title"><h3 id="pr-decide-title" className={s.subtitle}>결정</h3><DecisionBox view={view} product={product} act={act} busy={busy}/></section>
  {evidence.length>0&&<section className={s.block} aria-labelledby="pr-evidence-title"><h3 id="pr-evidence-title" className={s.subtitle}>근거 스냅샷 {evidence.length}개</h3><ul className={s.plainList}>{evidence.map(id=><li key={id}><span title={id}>{evidenceLabel(view,id)}</span></li>)}</ul></section>}
 </article>;
}
const subLine=(v:number|null|undefined)=>v==null?'미확인':`${Math.round(v)}/100`;
const bandText=(b:Product['priceBand'])=>b.min===null&&b.max===null?'미확인':b.min===b.max||b.max===null?money(b.min):b.min===null?`${money(b.max)} 이하`:`${money(b.min)}~${money(b.max)}`;

// 매칭 신뢰도 0.95 미만은 사람이 같은 상품인지 확인한다.
function MatchCheck({view,product,act,busy}:{view:View;product:Product;act:Act;busy:boolean}){
 const m=product.match;
 if(m.confidence>=0.95||m.confirmedBy)return <p className={s.muted}>상품 매칭: {m.method==='manual'?'사람 확인':m.method==='barcode'?'바코드':'브랜드·이름·용량'} 기준, 신뢰도 {Math.round(m.confidence*100)}%{m.confirmedBy?`(확인 ${m.confirmedBy.email??'확인한 사람 미확인'})`:''}.</p>;
 const keys=product.listings.map(l=>`${l.sourceId}:${l.externalId}`),why=!view.canEdit?editReason:keys.length<2?'묶인 판매 목록이 하나라 확인할 것이 없습니다.':'';
 return <div className={s.matchBox} role="note"><p>여러 판매 목록을 같은 상품으로 묶은 신뢰도가 {Math.round(m.confidence*100)}%입니다. 같은 상품인지 확인하세요.</p>
  <div className={s.toolbar}><Button type="button" variant="outline" size="sm" disabled={busy||!!why} disabledReason={why} onClick={()=>void act({action:'confirm_match',productId:product.id,decision:'merge',listingKeys:keys},'같은 상품으로 확인했습니다.')}>같은 상품으로 확인</Button>
  <Button type="button" variant="outline" size="sm" disabled={busy||!!why} disabledReason={why} onClick={()=>void act({action:'confirm_match',productId:product.id,decision:'split',listingKeys:keys},'판매 목록을 따로 나눴습니다.','다시 계산하면 나뉜 상품마다 점수표가 생깁니다.')}>다른 상품으로 나누기</Button></div>
 </div>;
}

// 출처별 추세: 같은 시간축(모든 계열의 날짜 합집합, 최근 12개)에 계열마다 막대를 그린다. 값이 없는 날은 '미확인'이다.
function SeriesSection({view,product}:{view:View;product:Product}){
 const series=useMemo(()=>(view.series??[]).filter(x=>x.subjectKey===product.id||product.keywordGroupIds.includes(x.subjectKey)),[view.series,product]);
 const axis=useMemo(()=>[...new Set(series.flatMap(x=>x.points.map(p=>p.at.slice(0,10))))].sort().slice(-12),[series]);
 return <section className={s.block} aria-labelledby="pr-series-title"><h3 id="pr-series-title" className={s.subtitle}>출처별 추세</h3>
  {!view.series?<p className={s.muted}>화면 응답에 시계열이 아직 없어 추세를 그리지 못했습니다. 하위 점수의 근거 스냅샷으로 값을 확인하세요.</p>
   :!series.length?<p className={s.muted}>이 후보에 연결된 시계열이 없습니다. 자동 수집이나 가져오기가 쌓이면 보입니다.</p>
   :<div className={s.seriesGrid}>{series.map(x=><TrendBars key={x.sourceId+x.metric+x.subjectKey} title={`${sourceLabel(view,x.sourceId)} ${metricLabels[x.metric]}`} points={axis.map(at=>pointAt(x,at))}/>)}</div>}
 </section>;
}
function pointAt(x:Series,at:string){
 const p=[...x.points].reverse().find(q=>q.at.slice(0,10)===at),v=p?.value??null;
 return {label:at.slice(5).replace('-','/'),value:v,display:v===null?'미확인':x.metric==='rank'?`${v}위`:v.toLocaleString('ko-KR')};
}

// 손익 시뮬레이터: 입력을 바꾸면 바로 다시 계산한다(lib/product-research/ui-margin.ts). 저장하지 않는다.
function MarginSimulator({product}:{product:Product}){
 const [f,setF]=useState({price:product.priceBand.min===null?'':String(product.priceBand.min),cost:'',shipping:'3000',packaging:'',channel:'smartstore',feePct:String(MARGIN_CHANNELS.find(c=>c.id==='smartstore')?.feePct??''),adPerOrder:'0',returnPct:'3'});
 const set=(k:keyof typeof f)=>(e:{target:{value:string}})=>setF(x=>({...x,[k]:e.target.value}));
 const pickChannel=(id:string)=>{const c=MARGIN_CHANNELS.find(x=>x.id===id);setF(x=>({...x,channel:id,feePct:c?.feePct==null?x.feePct:String(c.feePct)}))};
 const r=computeMargin({price:marginNumber(f.price),cost:marginNumber(f.cost),shipping:marginNumber(f.shipping),packaging:marginNumber(f.packaging),feePct:marginNumber(f.feePct),adPerOrder:marginNumber(f.adPerOrder),returnPct:marginNumber(f.returnPct)});
 const field=(k:'price'|'cost'|'shipping'|'packaging'|'adPerOrder',label:string)=><label className="field"><span>{label}</span><Input type="number" min={0} inputMode="numeric" value={f[k]} onChange={set(k)}/></label>;
 return <section className={s.block} aria-labelledby="pr-margin-title"><h3 id="pr-margin-title" className={s.subtitle}>손익 시뮬레이터</h3>
  <p className={s.muted}>주문 1건 기준입니다. 채널 수수료율은 기본값이라 실제 계약 요율로 고치세요.</p>
  <div className={s.formGrid}>
   {field('price','판매가(원)')}{field('cost','원가(원)')}{field('shipping','배송비(원)')}{field('packaging','포장비(원)')}
   <label className="field"><span>채널</span><NativeSelect value={f.channel} onChange={e=>pickChannel(e.target.value)}>{MARGIN_CHANNELS.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.label}</NativeSelectOption>)}</NativeSelect></label>
   <label className="field"><span>채널 수수료율(%)</span><Input type="number" min={0} max={100} step="0.1" inputMode="decimal" value={f.feePct} onChange={set('feePct')}/></label>
   {field('adPerOrder','광고비/주문(원)')}
   <label className="field"><span>반품률(%)</span><Input type="number" min={0} max={99} step="0.1" inputMode="decimal" value={f.returnPct} onChange={set('returnPct')}/></label>
  </div>
  <div aria-live="polite">{r?<StatList className={s.stats} label="손익 계산 결과" items={[['순매출(반품 제외)',money(r.netRevenue)],['채널 수수료',money(r.fee)],['공헌이익',money(r.contribution)],['광고비 차감 후 공헌이익',money(r.afterAds)],['마진율',r.marginPct===null?'미확인':`${r.marginPct}%`],['손익분기 ROAS',r.breakevenRoas===null?'남는 공헌이익이 없어 계산 불가':`${r.breakevenRoas}배`]]}/>
   :<p className={s.muted}>판매가, 원가, 배송비, 포장비, 수수료율, 광고비, 반품률을 모두 채우면 계산합니다. 모르는 값은 0으로 채우지 않습니다.</p>}</div>
 </section>;
}

// 리스크 확인: 규제 분류·보관 온도에서 나온 점검 항목. 체크는 이 화면에서만 보이는 메모이며 저장하지 않는다.
const riskItems:Record<RegulatoryClass,readonly string[]>={
 food:['식품 표시사항(원재료·알레르기·소비기한) 확인','수입 식품이면 수입신고·한글 표시 확인','제조원 영업등록 확인'],
 health_functional_food:['건강기능식품 표시·광고 사전 심의 필요 여부','기능성 원료 인정 범위 밖 표현 금지','수입 건강기능식품 신고 확인'],
 cosmetics:['전성분 표시와 책임판매업자 확인','의약품 오인 표현 금지'],
 functional_cosmetics:['기능성 화장품 보고·심사 확인','기능성 범위 밖 효능 표현 금지'],
 kc_electrical:['KC 전기용품 안전인증 번호 확인','전파 인증이 필요한 무선 기능 여부'],
 kc_children:['KC 어린이제품 안전인증 확인','사용 연령·경고 표시 확인'],
 general:['상표권 침해 여부(같은 이름·로고)','가품·병행수입 신호 확인'],
};
function RiskChecklist({product}:{product:Product}){
 const items=[...riskItems[product.regulatory],...(product.regulatory!=='general'?riskItems.general:[]),...(product.temperature==='chilled'||product.temperature==='frozen'?['냉장·냉동 배송(콜드체인) 가능 여부와 비용 확인']:[]),...(product.temperature==='unknown'?['보관 온도 확인(상온 우선 결정)']:[])];
 const [done,setDone]=useState<string[]>([]);
 const risk=product.score?.subScores.find(x=>x.key==='risk');
 return <section className={s.block} aria-labelledby="pr-risk-title"><h3 id="pr-risk-title" className={s.subtitle}>리스크 확인({regulatoryLabels[product.regulatory]})</h3>
  {risk?.reason&&<p className={s.reason}>{risk.reason}</p>}
  <ul className={s.plainList}>{items.map(x=><li key={x}><label className={s.check}><CheckInput checked={done.includes(x)} onChange={()=>setDone(d=>d.includes(x)?d.filter(y=>y!==x):[...d,x])}/>{x}</label></li>)}</ul>
  <p className={s.muted}>체크는 이 화면에서만 보이는 메모입니다. 판단 근거는 결정 사유에 한 문장으로 남기세요. 법률 자문이 아닙니다.</p>
 </section>;
}

// 브랜드 적합성: 사람이 매긴 점수(0~100)와 사유. 점수표의 브랜드 적합성 하위 점수로 들어간다.
function BrandFit({view,product,act,busy}:{view:View;product:Product;act:Act;busy:boolean}){
 const current=product.score?.subScores.find(x=>x.key==='brand_fit');
 const [value,setValue]=useState(current?.value==null?'':String(Math.round(current.value))),[reason,setReason]=useState('');
 const n=marginNumber(value),why=!view.canEdit?editReason:n===null||n>100?'0~100 사이 점수를 쓰세요.':!reason.trim()?'사유를 한 문장으로 쓰세요.':'';
 return <section className={s.block} aria-labelledby="pr-fit-title"><h3 id="pr-fit-title" className={s.subtitle}>브랜드 적합성</h3>
  <p className={s.muted}>지금 점수: {current?.value==null?'미확인':Math.round(current.value)}{current?.reason?`. ${current.reason}`:''}</p>
  <div className={s.formGrid}>
   <label className="field"><span>적합성 점수(0~100)</span><Input type="number" min={0} max={100} inputMode="numeric" value={value} disabled={!view.canEdit} onChange={e=>setValue(e.target.value)}/></label>
   <label className={'field '+s.wide}><span>사유(한 문장)</span><Input value={reason} maxLength={200} disabled={!view.canEdit} placeholder="예: 브랜드 아카이브의 '매운맛 소스' 사실과 맞습니다." onChange={e=>setReason(e.target.value)}/></label>
  </div>
  <Button type="button" variant="outline" disabled={busy||!!why} disabledReason={why} onClick={()=>void act({action:'set_brand_fit',productId:product.id,value:n??0,reason:reason.trim()},'브랜드 적합성을 저장했습니다.','다시 계산하면 총점에 반영됩니다.').then(r=>{if(r.ok)setReason('')})}>브랜드 적합성 저장</Button>
 </section>;
}
