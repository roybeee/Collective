'use client';
// 후보 목록: 공용 데이터 표(정렬·찾기·CSV·좁은 화면 카드). 상품명을 누르면 같은 화면 안의 후보 상세 페이지가 열린다.
// 조사 방향 밖 후보(filtered: 상온 아님·가격 상한 초과)는 지우지 않고 흐리게 표시하고 이유 배지를 붙인다. '뒤로 보내기'(기본)와 '조사 방향 안만' 보기를 고른다.
import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {CardButton} from '@/components/app/card-button';
import {DataTable,type DataColumn} from '@/components/app/data-table';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {Segmented} from '@/components/app/segmented';
import {signed,weekDelta} from '@/lib/product-research/ui-detail';
import {date} from '@/lib/format';
import {categoryLabel,confidence,decisionLabels,DecisionBadge,editReason,score,scoreSort,temperatureLabels,TierBadge,tierLabels,type Act,type Product,type View} from './product-research-shared';
import s from './product-research.module.css';

const off=(p:Product)=>!!p.filtered?.reasons.length;

export function RecomputeButton({view,act,busy}:{view:View;act:Act;busy:boolean}){
 const why=!view.canEdit?editReason:'';
 return <Button type="button" variant="outline" disabled={busy||!!why} disabledReason={why} onClick={()=>void act({action:'recompute'},'점수표를 다시 계산했습니다.','저장된 스냅샷만 썼고 외부 호출은 없었습니다.')}><RefreshCw/>점수 다시 계산</Button>;
}

export function CandidatesTab({view,act,busy,onOpen,onSources}:{view:View;act:Act;busy:boolean;onOpen:(id:string)=>void;onSources:()=>void}){
 const columns:DataColumn<Product>[]=[
  {label:'상품명',cell:p=><span className={off(p)?s.offFocus:s.stack}><CardButton className={s.nameLink} onClick={()=>onOpen(p.id)} aria-label={`${p.name} 상세 열기`}>{p.name}{p.brand?<small className={s.muted}>{p.brand}</small>:null}</CardButton>{off(p)&&<span className={s.badges}>{p.filtered!.reasons.map(x=><span key={x} className={'status '+s.warn}>{x}</span>)}</span>}</span>,sort:p=>`${off(p)?1:0}${p.name}`,csv:p=>p.name},
  {label:'카테고리',cell:p=>categoryLabel(p.categoryId),sort:p=>categoryLabel(p.categoryId),csv:p=>categoryLabel(p.categoryId)},
  {label:'보관',cell:p=>temperatureLabels[p.temperature],sort:p=>temperatureLabels[p.temperature],csv:p=>temperatureLabels[p.temperature]},
  {label:'총점',cell:p=>score(p.score),sort:p=>scoreSort(p.score),csv:p=>p.score?.total==null?'':Math.round(p.score.total),align:'right'},
  {label:'지난주 대비',cell:p=>{const d=weekDelta(p);return d?signed(d.total):'미확인'},sort:p=>weekDelta(p)?.total??-Infinity,csv:p=>weekDelta(p)?.total??'',align:'right'},
  {label:'조사 방향',cell:p=>off(p)?p.filtered!.reasons.join(', '):'안',sort:p=>off(p)?1:0,csv:p=>off(p)?p.filtered!.reasons.join(', '):'안'},
  {label:'신뢰도',cell:p=>confidence(p.score),sort:p=>p.score?.confidence??-1,csv:p=>p.score?Math.round(p.score.confidence*100):'',align:'right'},
  {label:'분류',cell:p=><TierBadge card={p.score}/>,sort:p=>p.score?tierLabels[p.score.tier]:'',csv:p=>p.score?tierLabels[p.score.tier]:''},
  {label:'차단 사유',cell:p=>p.score?.blocked?<span className={s.blocked}>{p.score.blocked.reason}</span>:<span className={s.muted}>없음</span>,sort:p=>p.score?.blocked?.reason??'',csv:p=>p.score?.blocked?.reason??''},
  {label:'결정 상태',cell:p=><span className={s.stack}><DecisionBadge product={p}/>{p.decision&&<small className={s.muted}>{date(p.decision.decidedAt)}</small>}</span>,sort:p=>p.decision?decisionLabels[p.decision.status]:'',csv:p=>p.decision?decisionLabels[p.decision.status]:'결정 전'},
 ];
 const [scope,setScope]=useState<'all'|'focus'>('all');
 const outside=view.products.filter(off).length;
 // 조사 방향 밖 후보는 뒤로(서버 정렬과 같음), '조사 방향 안만'이면 숨긴다(지우지 않음).
 const rows=scope==='focus'?view.products.filter(p=>!off(p)):[...view.products].sort((a,b)=>Number(off(a))-Number(off(b)));
 const adopt=view.products.filter(p=>p.score?.tier==='adopt').length,needs=view.products.filter(p=>p.score?.tier==='needs_data').length,undecided=view.products.filter(p=>!p.decision).length;
 return <section className={s.section} aria-labelledby="pr-candidates-title">
  <div className={s.headRow}><h2 id="pr-candidates-title" className={s.title}>후보 목록</h2><RecomputeButton view={view} act={act} busy={busy}/></div>
  <p className={s.muted}><MetaLine items={[`전체 ${view.products.length}개`,`도입 검토 ${adopt}개`,`자료 보강 ${needs}개`,`결정 전 ${undecided}개`,outside?`조사 방향 밖 ${outside}개`:null]}/></p>
  {outside>0&&<div className={s.toolbar}><Segmented label="조사 방향 밖 후보 보기" value={scope} onChange={setScope} options={[{value:'all',label:'뒤로 보내 함께 보기'},{value:'focus',label:'조사 방향 안만'}]}/>{scope==='focus'&&<span className={s.muted}>조사 방향 밖 후보 {outside}개를 숨겼습니다.</span>}</div>}
  {view.products.length?<DataTable rows={rows} columns={columns} rowKey={p=>p.id} caption="상품 리서치 후보" csvName="product-research-candidates" filterText={p=>[p.name,p.brand??'',categoryLabel(p.categoryId),p.score?.blocked?.reason??''].join(' ')}/>
   :<div className={s.empty}><EmptyLine next="랭킹 파일을 가져오거나 자동 수집을 켠 뒤 점수를 다시 계산하면 후보가 생깁니다.">후보가 아직 없습니다.</EmptyLine><Button type="button" variant="outline" size="sm" onClick={onSources}>출처와 가져오기 열기</Button></div>}
  <p className={s.muted}>총점은 결측을 0으로 채우지 않습니다. 자료가 모자라면 신뢰도가 낮고 자료 보강으로 분류됩니다.</p>
 </section>;
}
