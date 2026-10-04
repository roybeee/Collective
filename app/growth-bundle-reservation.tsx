'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {CheckInput} from '@/components/app/check';
import type {GrowthBundleView} from '@/lib/growth-bundle-server';
import {MetaLine} from '@/components/app/meta-line';
type Bundle=GrowthBundleView['bundles'][number];
export function GrowthBundleReservation({bundle,campaignId,campaignVersion,disabled,onSaved}:{bundle:Bundle;campaignId:string;campaignVersion:number;disabled:boolean;onSaved:(message:string)=>Promise<void>}){
 const [quantity,setQuantity]=useState(1),[confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const pending=useRef<{key:string;requestId:string}|null>(null),writing=useRef<AbortController|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;writing.current?.abort()}},[]);
 const release=bundle.reservation?.status==='held',stocks=release?bundle.reservationInventory:bundle.assessment.stockAllocation.map(s=>({inventoryId:s.inventoryId,version:s.inventoryVersion}));
 const unavailable=stocks.some(s=>s.version===null)||!stocks.length;
 async function submit(){
  if(disabled||saving||writing.current||!confirmed||unavailable||(!release&&!bundle.canReserve))return;
  const payload={campaignId,campaignVersion,id:bundle.id,expectedVersion:bundle.version,action:release?'release_bundle':'reserve_bundle',...(release?{}:{quantity}),inventories:stocks,evidenceRef:`bundle-v${bundle.version}-operator-confirmed`,confirmed:true},key=JSON.stringify(payload);
  const requestId=pending.current?.key===key?pending.current.requestId:crypto.randomUUID();pending.current={key,requestId};const controller=new AbortController();writing.current=controller;setSaving(true);setError('');
  try{const response=await fetch('/api/growth/bundles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId}),signal:controller.signal}),result=await response.json() as {recorded?:boolean;error?:string};if(!response.ok||result.recorded!==true)throw new Error(result.error??'예약 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;pending.current=null;setConfirmed(false);await onSaved(release?'번들 구성 재고를 모두 해제했습니다.':'번들 구성 재고를 모두 예약했습니다. 판매 집행·예산 예약은 별도입니다.');}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 응답 미확인은 동일 입력으로 재시도하세요.`)}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false)}
 }
 return <fieldset disabled={disabled||saving} aria-label={`${bundle.id} 재고 예약`}><legend>전체 구성 재고 {release?'해제':'예약'}</legend>
  {bundle.reservation&&<p><MetaLine items={[`예약 상태: ${release?'보유 중':bundle.reservation.status==='consumed'?'주문 배정 완료':'해제 완료'}`,`${bundle.reservation.quantity}개 번들`]}/></p>}
  {!release&&<label>예약할 번들 수량<Input type="number" min={1} max={Math.min(bundle.input.plannedQuantity,bundle.assessment.maxBundles??0)} value={quantity} onChange={e=>{setQuantity(Number(e.target.value));setConfirmed(false)}}/></label>}
  <ul>{stocks.map(stock=>{const component=release?bundle.reservation?.components.find(c=>c.inventoryId===stock.inventoryId):bundle.assessment.stockAllocation.find(c=>c.inventoryId===stock.inventoryId),units=component?('units' in component?component.units:component.unitsPerBundle*quantity):null;return <li key={stock.inventoryId}><MetaLine items={[component?.sku??'상품 확인 필요',`${units??'미확인'}${component?.unit==='pack'?'팩':'개'}`,`재고 v${stock.version??'미확인'}`]}/></li>})}</ul>
  <label><CheckInput checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{release?'주문에 배정되지 않은 전체 예약을 해제합니다.':'구성별 공유 재고와 수량을 확인했고 전체 예약에 동의합니다.'}</label>
  <Button variant="panel" size="fit" type="button" disabled={!confirmed||unavailable||(!release&&(!bundle.canReserve||!Number.isInteger(quantity)||quantity<1||quantity>bundle.input.plannedQuantity))} disabledReason={!confirmed?'전체 구성 재고와 예약·해제 수량을 확인하세요.':'상품·가격·재고 근거와 예약 가능 수량을 확인하세요.'} onClick={()=>void submit()}>{release?'전체 예약 해제':'전체 재고 예약'}</Button>
  {unavailable&&<p>공유 재고의 현재 판을 먼저 확인하세요.</p>}{!release&&!bundle.canReserve&&<p>상품·가격·재고 근거 또는 운영 상태를 확인해야 예약할 수 있습니다.</p>}{error&&<p role="alert">{error}</p>}
 </fieldset>;
}
