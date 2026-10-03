'use client';
// 트렌드 레이더: 조사 방향(카테고리·보관 온도·가격 상한·질문)과 후보 지도. 칸 크기는 수요, 색과 화살표는 모멘텀이다(색만으로 구분하지 않고 글자도 붙인다).
// '지난주 대비 상승'은 화면 응답에 지난주 점수가 아직 없어 이번 주 모멘텀 점수로 줄을 세우고 그 사실을 적는다.
import {useMemo,useState} from 'react';
import {ArrowDownRight,ArrowRight,ArrowUpRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {CardButton} from '@/components/app/card-button';
import {CheckInput} from '@/components/app/check';
import {DataTable,type DataColumn} from '@/components/app/data-table';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {Note} from '@/components/app/note';
import {Segmented} from '@/components/app/segmented';
import {CATEGORIES} from '@/lib/product-research/categories';
import type {KeywordGroup,Temperature} from '@/lib/product-research/types';
import {categoryLabel,editReason,Meter,score,subValue,temperatureLabels,type Act,type Product,type View} from './product-research-shared';
import s from './product-research.module.css';

type SortKey='momentum'|'demand'|'total';
const sortLabels:Record<SortKey,string>={momentum:'모멘텀 높은 순',demand:'수요 큰 순',total:'총점 높은 순'};
const TOP=20;
const metric=(p:Product,key:SortKey)=>key==='total'?p.score?.total??null:subValue(p.score,key);
const trendOf=(v:number|null)=>v===null?'unknown':v>=60?'up':v<=40?'down':'flat';
const trendText={up:'상승',down:'하락',flat:'보합',unknown:'미확인'} as const;
const mean=(xs:(number|null)[])=>{const v=xs.filter((x):x is number=>x!==null);return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null};
const sameSet=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every(x=>b.includes(x));

export function RadarTab({view,act,busy,onOpen}:{view:View;act:Act;busy:boolean;onOpen:(id:string)=>void}){
 const settings=view.settings,saved=settings.categories.length?settings.categories:view.focus.categories;
 const [picked,setPicked]=useState<string[]>(saved),[temps,setTemps]=useState<Temperature[]>(settings.temperatures.length?settings.temperatures:view.focus.temperature);
 const [priceMax,setPriceMax]=useState(settings.priceMax===null?'':String(settings.priceMax)),[question,setQuestion]=useState(settings.question),[sort,setSort]=useState<SortKey>('momentum');
 const toggle=(id:string)=>setPicked(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
 const toggleTemp=(t:Temperature)=>setTemps(p=>p.includes(t)?p.filter(x=>x!==t):[...p,t]);
 const price=priceMax.trim()===''?null:Number(priceMax);
 const changed=!sameSet(picked,saved)||!sameSet(temps,settings.temperatures)||price!==settings.priceMax||question!==settings.question;
 const saveWhy=!view.canEdit?editReason:!picked.length?'카테고리를 하나 이상 고르세요.':!temps.length?'보관 온도를 하나 이상 고르세요.':price!==null&&!(price>0)?'가격 상한은 0보다 큰 숫자로 쓰세요.':!changed?'바뀐 조사 방향이 없습니다.':'';
 const save=()=>void act({action:'save_settings',settings:{categories:picked,temperatures:temps,priceMax:price,question:question.trim()},expectedVersion:settings.version},'조사 방향을 저장했습니다.','다음 수집과 점수 계산부터 반영됩니다.');
 const shown=useMemo(()=>view.products.filter(p=>!picked.length||(p.categoryId!==null&&picked.includes(p.categoryId))),[view.products,picked]);
 const ranked=useMemo(()=>[...shown].sort((a,b)=>(metric(b,sort)??-1)-(metric(a,sort)??-1)).slice(0,TOP),[shown,sort]);
 const hidden=view.products.length-shown.length;
 const groups=view.keywordGroups.filter(g=>!picked.length||g.categoryId===null||picked.includes(g.categoryId));
 const linked=(g:KeywordGroup)=>view.products.filter(p=>p.keywordGroupIds.includes(g.id));
 const groupColumns:DataColumn<KeywordGroup>[]=[
  {label:'키워드 묶음',cell:g=><><b>{g.label}</b><br/><small className={s.muted}>{g.keywords.slice(0,6).join(', ')}{g.keywords.length>6?` 외 ${g.keywords.length-6}개`:''}</small></>,sort:g=>g.label,csv:g=>g.label},
  {label:'카테고리',cell:g=>categoryLabel(g.categoryId),sort:g=>categoryLabel(g.categoryId),csv:g=>categoryLabel(g.categoryId)},
  {label:'연결 후보',cell:g=>`${linked(g).length}개`,sort:g=>linked(g).length,csv:g=>linked(g).length},
  {label:'평균 수요',cell:g=>mean(linked(g).map(p=>subValue(p.score,'demand')))??'미확인',sort:g=>mean(linked(g).map(p=>subValue(p.score,'demand')))??-1,csv:g=>mean(linked(g).map(p=>subValue(p.score,'demand')))??''},
  {label:'평균 모멘텀',cell:g=><Trend value={mean(linked(g).map(p=>subValue(p.score,'momentum')))}/>,sort:g=>mean(linked(g).map(p=>subValue(p.score,'momentum')))??-1,csv:g=>mean(linked(g).map(p=>subValue(p.score,'momentum')))??''},
 ];
 return <section className={s.section} aria-labelledby="pr-radar-title">
  <h2 id="pr-radar-title" className={s.title}>트렌드 레이더</h2>
  <Note>대표 결정(10월 3일 D1): 푸드는 배송 이슈가 있어 상온 제품을 우선합니다. 냉장·냉동 카테고리는 후순위로 두고, 고르면 함께 봅니다.</Note>
  <fieldset className={s.chips}><legend className={s.legend}>조사할 카테고리</legend>
   {CATEGORIES.map(c=><Button key={c.id} type="button" variant="outline" size="sm" className={s.chip} aria-pressed={picked.includes(c.id)} onClick={()=>toggle(c.id)}>{c.label}{c.focus?<span className={s.focusMark}>우선</span>:null}</Button>)}
  </fieldset>
  <details className={s.details}><summary>보관 온도·가격 상한·조사 질문</summary>
   <div className={s.formGrid}>
    <fieldset className={s.checks}><legend className={s.legend}>보관 온도</legend>{(['ambient','chilled','frozen'] as const).map(t=><label key={t} className={s.check}><CheckInput checked={temps.includes(t)} onChange={()=>toggleTemp(t)}/>{temperatureLabels[t]}</label>)}</fieldset>
    <label className="field"><span>가격 상한(원, 비우면 제한 없음)</span><Input type="number" min={0} inputMode="numeric" value={priceMax} onChange={e=>setPriceMax(e.target.value)}/></label>
    <label className={'field '+s.wide}><span>조사 질문(선정 메모의 방향)</span><Textarea value={question} maxLength={300} placeholder="예: 여름 상온 K-스낵, 2만 원 이하" onChange={e=>setQuestion(e.target.value)}/></label>
   </div>
  </details>
  <div className={s.toolbar}>
   <Button type="button" disabled={busy||!!saveWhy} disabledReason={saveWhy} onClick={save}>조사 방향 저장</Button>
   <span className={s.muted}><MetaLine items={[`조사 방향 v${settings.version}`,settings.updatedAt?`저장 ${settings.updatedAt.slice(0,10)}`:'아직 저장 전']}/></span>
  </div>
  <div className={s.headRow}><h3 className={s.subtitle}>{sort==='momentum'?`상승 상위 ${TOP}`:`${sortLabels[sort]} 상위 ${TOP}`}</h3><Segmented label="후보 정렬" value={sort} onChange={setSort} options={(Object.keys(sortLabels) as SortKey[]).map(k=>({value:k,label:sortLabels[k]}))}/></div>
  {sort==='momentum'&&<p className={s.muted}>지난주 점수가 화면 응답에 아직 없어 이번 주 모멘텀 점수(12주 기울기·순위 상승·조회수 증가)로 줄을 세웠습니다.</p>}
  {hidden>0&&<p className={s.muted}>고른 카테고리 밖 후보 {hidden}개는 숨겼습니다.</p>}
  {ranked.length?<ol className={s.tiles}>{ranked.map((p,i)=>{const demand=subValue(p.score,'demand'),momentum=subValue(p.score,'momentum');
   return <li key={p.id} className={demand!==null&&demand>=70?s.tileLarge:demand!==null&&demand>=40?s.tileMid:s.tileSmall}><CardButton className={s.tile} data-trend={trendOf(momentum)} onClick={()=>onOpen(p.id)}>
    <span className={s.rank}>{i+1}</span><b className={s.tileName}>{p.name}</b>
    <small className={s.muted}><MetaLine items={[categoryLabel(p.categoryId),temperatureLabels[p.temperature],`총점 ${score(p.score)}`]}/></small>
    <Meter label="수요" value={demand}/><Trend value={momentum}/>
   </CardButton></li>})}</ol>
   :<EmptyLine next="출처와 가져오기 탭에서 랭킹 파일을 가져오거나 자동 수집을 켠 뒤 점수를 다시 계산하세요.">고른 카테고리에 점수가 있는 후보가 아직 없습니다.</EmptyLine>}
  <h3 className={s.subtitle}>키워드 묶음</h3>
  {groups.length?<DataTable rows={groups} columns={groupColumns} rowKey={g=>g.id} caption="키워드 묶음별 수요와 모멘텀" csvName="product-research-keyword-groups" filterText={g=>[g.label,...g.keywords].join(' ')}/>
   :<EmptyLine next="키워드 묶음은 수집한 검색 지표를 다시 계산할 때 만들어집니다.">고른 카테고리의 키워드 묶음이 아직 없습니다.</EmptyLine>}
 </section>;
}

// 모멘텀 표시: 화살표(색)와 글자를 함께 보인다.
export function Trend({value}:{value:number|null}){
 const t=trendOf(value),Icon=t==='up'?ArrowUpRight:t==='down'?ArrowDownRight:ArrowRight;
 return <span className={s.trend} data-trend={t}>{t!=='unknown'&&<Icon size={15} aria-hidden="true"/>}<span>모멘텀 {value===null?'미확인':`${Math.round(value)} ${trendText[t]}`}</span></span>;
}
