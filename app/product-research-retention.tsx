'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {DataTable,type DataColumn} from '@/components/app/data-table';
import {MetaLine} from '@/components/app/meta-line';
import {dateTime} from '@/lib/format';
import type {ResearchRetentionInventory} from '@/lib/product-research/api';
import s from './product-research.module.css';

export function ResearchRetention({canInspect}:{canInspect:boolean}){
 const [report,setReport]=useState<ResearchRetentionInventory|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function inspect(){
  setBusy(true);setError('');setReport(null);
  try{const r=await fetch('/api/product-research?view=retention',{credentials:'same-origin'});const data=await r.json() as ResearchRetentionInventory&{error?:string};if(!r.ok)throw new Error(typeof data.error==='string'?data.error:'보존 상태를 확인하지 못했습니다.');setReport(data)}
  catch(e){setError(e instanceof Error?e.message:'보존 상태를 확인하지 못했습니다. 다시 시도하세요.')}
  finally{setBusy(false)}
 }
 const columns:DataColumn<ResearchRetentionInventory['rows'][number]>[]=[
  {label:'기록 종류',cell:r=>r.kind}, {label:'확인한 기록',cell:r=>r.records},
  {label:'YouTube 관련 기록',cell:r=>r.youtubeRecords}, {label:'30일 이상 보관',cell:r=>r.expiredRecords},
  {label:'시각 확인 필요',cell:r=>r.invalidTimeRecords}, {label:'가장 오래된 수집',cell:r=>dateTime(r.oldestFetchedAt)},
 ];
 return <section className={s.block} aria-label="수집 자료 보존 상태">
  <h3 className={s.subtitle}>수집 자료 보존 상태</h3>
  <p className={s.muted}>수집을 꺼도 확인할 수 있습니다. 원문과 키를 제외한 건수만 조회합니다. 실제 삭제는 별도 작업입니다.</p>
  <Button type="button" variant="outline" disabled={!canInspect||busy} disabledReason={!canInspect?'소유자만 보존 상태를 확인할 수 있습니다.':undefined} onClick={()=>void inspect()}>{busy?'확인 중…':'보존 상태 확인'}</Button>
  {error&&<p role="alert">{error}</p>}
  {report&&<div aria-live="polite">
   <p><MetaLine items={[report.complete?'조회 범위 확인 완료':'일부 확인',`${report.scanned}건`,dateTime(report.checkedAt)]}/></p>
   {!report.complete&&<p role="status">조회 한도 또는 확인 오류로 일부만 확인했습니다. 전체 자료가 없다는 뜻이 아닙니다.</p>}
   <DataTable rows={report.rows} columns={columns} rowKey={r=>r.kind} caption="수집 자료 보존 현황"/>
   <p>자동 삭제: 꺼짐. 외부 전송본 삭제: {report.externalDeletion==='unverified'?'확인되지 않음':'이 조회 범위에서 대상 없음'}.</p>
  </div>}
 </section>;
}
