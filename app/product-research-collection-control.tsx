'use client';
// 권한은 기존 소유자 전용 feature-flags API가 판단한다. 저장과 최신 화면 조회의 결과를 구분한다.
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {askConfirm} from '@/components/app/confirm-dialog';
import {notifySaved} from '@/lib/ui/notify';
import s from './product-research.module.css';

type Props={enabled:boolean;canConnect:boolean;connected:boolean;busy:boolean;onRefresh:()=>Promise<boolean>};
export function CollectionControl({enabled,canConnect,connected,busy,onRefresh}:Props){
 const pending=useRef(false);
 const [switching,setSwitching]=useState(false),[error,setError]=useState(''),[needsRefresh,setNeedsRefresh]=useState(false);
 const why=!canConnect?'자동 수집 스위치는 소유자만 변경할 수 있습니다.':needsRefresh?'최신 수집 상태를 먼저 확인하세요.':'';
 async function refresh(){
  if(pending.current)return;
  pending.current=true;setSwitching(true);
  try{if(await onRefresh()){setNeedsRefresh(false);setError('')}}
  finally{pending.current=false;setSwitching(false)}
 }
 async function change(){
  if(pending.current||busy||why)return;
  pending.current=true;setSwitching(true);setError('');
  let saved=false;
  try{
   const next=!enabled,label=next?'켜기':'끄기';
   if(!await askConfirm({title:`자동 수집을 ${next?'켤까요':'끌까요'}?`,impact:next?'연결된 공식 API만 출처별 쿼터 안에서 자동 수집합니다. API 키가 없으면 실제 수집은 시작되지 않습니다.':'다음 예약 수집과 즉시 수집을 중단합니다. 이미 시작한 요청은 끝날 수 있고 기존 자료는 남습니다.',undo:'같은 버튼으로 언제든 다시 바꿀 수 있습니다.',confirmLabel:label}))return;
   const r=await fetch('/api/feature-flags',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set',flag:'product_research_collect',enabled:next})});
   const data=await r.json().catch(()=>({})) as {error?:unknown};
   if(r.status>=500)throw new Error('저장 여부 미확인');
   if(!r.ok){setError(`저장하지 못했습니다. ${typeof data.error==='string'?data.error:'수집 설정을 바꾸지 못했습니다.'}`);return}
   saved=true;
   if(!await onRefresh()){setNeedsRefresh(true);setError('자동 수집 설정은 저장됐지만 최신 상태를 불러오지 못했습니다.');return}
   notifySaved(next?'자동 수집을 켰습니다.':'자동 수집을 껐습니다.');
  }catch{
   setNeedsRefresh(true);
   setError(saved?'자동 수집 설정은 저장됐지만 최신 상태를 불러오지 못했습니다.':'서버 응답을 확인하지 못했습니다. 저장 여부를 다시 확인하세요.');
  }finally{pending.current=false;setSwitching(false)}
 }
 return <div className={s.block}>
  <Button type="button" variant="outline" disabled={busy||switching||!!why} disabledReason={why} onClick={()=>void change()}>자동 수집 {enabled?'끄기':'켜기'}</Button>
  {!connected&&<p className={s.muted}>API 키가 연결되지 않아 실제 수집은 시작되지 않습니다.</p>}
  {error&&<p role="alert">{error}</p>}
  {needsRefresh&&<Button type="button" variant="outline" disabled={busy||switching} onClick={()=>void refresh()}>수집 상태 다시 확인</Button>}
 </div>;
}
