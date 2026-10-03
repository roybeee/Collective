'use client';
// 후보 상세의 근거 보기: 출처별 추세(같은 시간축)와 근거 스냅샷 상세. 평가 1회차 H1·② 대응.
// 시계열은 서버 subjectKey 모양(kw:정규형 키워드, ls:출처:외부ID)으로 이 상품의 판매 목록·키워드 묶음과 맞춘다(lib/product-research/ui-detail.ts).
// 근거 칩을 누르면 같은 페이지 안의 '근거 스냅샷 상세' 칸이 열린다(모달이 아니라 내용이 그대로 남는다). 화면 응답에 없는 값(요청 범위 원문)은 없다고 적는다.
import {useEffect,useMemo,useRef} from 'react';
import {X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {DataTable,type DataColumn} from '@/components/app/data-table';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {StatList} from '@/components/app/stat-list';
import {TrendBars} from '@/components/app/trend-bars';
import {count,dateTime} from '@/lib/format';
import {SOURCES} from '@/lib/product-research/sources';
import {pointOn,productSeries,requestScope,seriesAxis,snapshotRows,type SnapshotRow} from '@/lib/product-research/ui-detail';
import type {Series} from '@/lib/product-research/types';
import {evidenceLabel,methodLabels,metricLabels,snapshotStatusLabels,sourceLabel,type Product,type View} from './product-research-shared';
import s from './product-research.module.css';

const valueText=(metric:Series['metric'],v:number|null)=>v===null?'미확인':metric==='rank'?`${v}위`:metric==='rating'?String(v):v.toLocaleString('ko-KR');

// 근거 칩: 누르면 스냅샷 상세를 연다. 지금 열린 칩은 눌린 상태로 보인다.
export function EvidenceChips({view,ids,open,onOpen}:{view:View;ids:readonly string[];open:string|null;onOpen:(id:string)=>void}){
 if(!ids.length)return null;
 return <p className={s.evidence}>근거: {ids.map(id=><Button key={id} type="button" variant="outline" size="sm" className={s.evidenceChip} aria-pressed={open===id} title="근거 스냅샷 상세 열기" onClick={()=>onOpen(id)}>{evidenceLabel(view,id)}</Button>)}</p>;
}

// 출처별 추세: 같은 시간축(모든 계열의 날짜 합집합, 최근 12개)에 계열마다 막대를 그린다. 그날 관측이 없으면 '미확인'이다.
export function SeriesSection({view,product,subjects}:{view:View;product:Product;subjects:ReadonlyMap<string,string>}){
 const series=useMemo(()=>productSeries(view.series,subjects),[view.series,subjects]);
 const axis=useMemo(()=>seriesAxis(series),[series]);
 const limits=[...new Set(series.flatMap(x=>x.limitations??[]))];
 const many=product.listings.length>1||series.some(x=>x.subjectKey.startsWith('kw:'));
 const title=(x:Series)=>`${sourceLabel(view,x.sourceId)} ${metricLabels[x.metric]}${many?` (${subjects.get(x.subjectKey)??x.subjectKey})`:''}`;
 return <section className={s.block} aria-labelledby="pr-series-title"><h3 id="pr-series-title" className={s.subtitle}>출처별 추세</h3>
  {!view.series?<p className={s.muted}>화면 응답에 시계열이 아직 없어 추세를 그리지 못했습니다. 하위 점수의 근거 스냅샷으로 값을 확인하세요.</p>
   :!series.length?<EmptyLine next="자동 수집이나 운영자 가져오기가 쌓인 뒤 점수를 다시 계산하면 보입니다.">이 후보에 연결된 시계열이 아직 없습니다.</EmptyLine>
   :axis.length<2?<><p className={s.muted}>관측이 {axis[0]} 하루뿐이라 막대 대신 값만 보입니다. 다른 날 관측이 쌓이면 같은 시간축 막대로 그립니다.</p>
    <StatList className={s.stats} label="하루 관측 값" items={series.map(x=>[title(x),valueText(x.metric,pointOn(x,axis[0])?.value??null)] as const)}/></>
   :<><p className={s.muted}><MetaLine items={[`계열 ${series.length}개`,`시간축 ${axis[0]}~${axis[axis.length-1]}`]}/></p>
    {series.some(x=>x.metric==='rank')&&<p className={s.muted}>랭킹 순위 막대는 숫자 그대로입니다. 숫자가 작을수록 높은 순위입니다.</p>}
    <div className={s.seriesGrid} data-testid="pr-trend-grid">{series.map(x=><TrendBars key={x.sourceId+x.metric+x.subjectKey} title={title(x)} points={axis.map(at=>{const v=pointOn(x,at)?.value??null;return {label:at.slice(5).replace('-','/'),value:v,display:valueText(x.metric,v)}})}/>)}</div></>}
  {limits.length>0&&<ul className={s.notes} aria-label="시계열 해석 한계">{limits.map(x=><li key={x}>{x}</li>)}</ul>}
 </section>;
}

// 근거 스냅샷 상세: 출처, 수집 방식, 수집 시각, 상태, 가져오기 기록(있으면), 이 상품과 관련된 관측 행.
export function SnapshotPanel({view,id,subjects,onClose}:{view:View;id:string;subjects:ReadonlyMap<string,string>;onClose:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'nearest'})},[id]);
 const meta=view.snapshots?.find(x=>x.id===id)??null,imported=view.imports.find(x=>x.snapshotId===id)??null;
 const sourceId=meta?.sourceId??imported?.sourceId??null,spec=sourceId?SOURCES.find(x=>x.id===sourceId):null;
 const rows=snapshotRows(view.series??[],subjects,id);
 const limits=[...new Set([...(meta?.limitations??[]),...(view.series??[]).filter(x=>x.points.some(p=>p.snapshotId===id)).flatMap(x=>x.limitations??[])])];
 const scope=meta?.request?requestScope(meta.request):[];
 const columns:DataColumn<SnapshotRow>[]=[
  {label:'대상',cell:r=>r.subject,sort:r=>r.subject,csv:r=>r.subject},
  {label:'지표',cell:r=>metricLabels[r.metric],sort:r=>metricLabels[r.metric],csv:r=>metricLabels[r.metric]},
  {label:'관측 기간 끝',cell:r=>r.at.slice(0,10),sort:r=>r.at,csv:r=>r.at.slice(0,10)},
  {label:'값',cell:r=>valueText(r.metric,r.value),sort:r=>r.value??-Infinity,csv:r=>r.value??'',align:'right'},
 ];
 return <section className={s.snapshotPanel} aria-labelledby="pr-snapshot-title" data-testid="pr-snapshot-panel">
  <div className={s.headRow}><h4 id="pr-snapshot-title" ref={heading} tabIndex={-1} className={s.cardTitle}>근거 스냅샷 상세</h4><Button type="button" variant="ghost" size="sm" onClick={onClose}><X/>닫기</Button></div>
  <StatList className={s.stats} label="스냅샷 요약" items={[
   ['출처',sourceId?sourceLabel(view,sourceId):'미확인'],
   ['수집 방식',spec?<span className={s.method} data-method={spec.method}>{methodLabels[spec.method]}</span>:'미확인'],
   ['수집 시각',dateTime(meta?.fetchedAt??imported?.importedAt)],
   ['상태',meta?.status?snapshotStatusLabels[meta.status]:'미확인'],
   ['요청 범위',scope.length?scope.join(', '):imported?`파일 ${imported.fileName}, ${count(imported.rows,'행')}`:meta?.request?'없음':'미확인'],
   ['관측 행',typeof meta?.rows==='number'?count(meta.rows,'행'):'미확인'],
   ['스냅샷 ID',<span key="id" className={s.code}>{id}</span>],
  ]}/>
  {imported&&<p className={s.muted}><MetaLine items={['운영자 가져오기',`가져온 사람 ${imported.importedBy??'미확인'}`,dateTime(imported.importedAt)]}/></p>}
  {rows.length?<DataTable rows={rows} columns={columns} rowKey={r=>`${r.subjectKey}|${r.metric}|${r.at}`} caption="이 상품과 관련된 관측 행" csvName="product-research-snapshot-rows" limit={50}/>
   :<EmptyLine next="이 스냅샷의 관측 행은 화면 응답의 시계열에 없어 값을 보이지 못합니다. 하위 점수 설명으로 판단하세요.">이 상품과 관련된 관측 행이 화면에 없습니다.</EmptyLine>}
  {limits.length>0&&<ul className={s.notes} aria-label="스냅샷 해석 한계">{limits.map(x=><li key={x}>{x}</li>)}</ul>}
  <p className={s.muted}>원문 본문은 화면 응답에 싣지 않습니다. 값은 이 상품의 시계열 점에서 찾았습니다.</p>
 </section>;
}
