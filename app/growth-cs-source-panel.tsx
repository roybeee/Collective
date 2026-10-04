'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAccount} from './account-context';
import {GrowthConsumerDeliveryPanel} from './growth-consumer-delivery-panel';
import {Button} from '@/components/ui/button';
import {Note} from '@/components/app/note';
import {MetaLine} from '@/components/app/meta-line';
import type {CsSource} from '@/lib/growth-cs-source';
type View={campaignVersion:number;sources:(CsSource&{canReply:boolean})[]};
export function GrowthCsSourcePanel({campaignId}:{campaignId:string}){
 const account=useAccount(),[view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cursor,setCursor]=useState<string|null>(null),[intakeHeld,setIntakeHeld]=useState(false),working=useRef(false),pending=useRef<{requestId:string;cursor:string|null}|null>(null);
 const load=useCallback(async(signal?:AbortSignal)=>{const r=await fetch(`/api/growth/cs-source?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),x=await r.json() as View&{error?:string};if(!r.ok)throw new Error(x.error||'문의 접수 조회 실패');if(!signal?.aborted)setView(x)},[campaignId]);
 useEffect(()=>{const c=new AbortController();Promise.resolve().then(()=>load(c.signal)).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[load]);
 async function pull(){if(working.current||!view)return;working.current=true;setBusy(true);setError('');pending.current??={requestId:crypto.randomUUID(),cursor};let saved=false;try{const r=await fetch('/api/growth/cs-source',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaignId,campaignVersion:view.campaignVersion,...pending.current})}),x=await r.json() as {error?:string;nextCursor?:string|null;intakeHeld?:boolean};if(!r.ok){if(r.status<500)pending.current=null;throw new Error(x.error||'문의 접수 실패')}saved=true;pending.current=null;setCursor(x.nextCursor??null);setIntakeHeld(x.intakeHeld??false);await load()}catch(e){setError(`${saved?'접수는 저장됐지만 새 조회가 필요합니다. ':''}${e instanceof Error?e.message:'접수 결과 확인 필요'}`)}finally{working.current=false;setBusy(false)}}
 const sources=(view?.sources??[]).filter(x=>x.canReply&&x.customerId&&x.order),customers=Array.from(new Map(sources.map(x=>[x.customerId,{id:x.customerId,version:x.customerVersion,assessment:{postPurchaseEligible:false,reorderEligible:false}}])).values());
 return <section aria-label="판매처 본인 문의 연결"><h4>판매처 본인 문의 연결</h4><Note>본인 문의의 서비스 답변은 마케팅 동의와 별도로 확인합니다. 문의 원문과 연락처는 제공자에 보관하고, 승인된 고정 템플릿만 본인 문의 화면에 게시합니다.</Note>
 {intakeHeld&&<p role="status">신규 문의는 범위 대사가 필요합니다. 기존 문의의 철회·변경 상태만 갱신했습니다.</p>}{error&&<p role="alert">{error}</p>}<Button disabled={busy||!account?.isAdmin} disabledReason={busy?'처리 중입니다.':'관리자 권한이 필요합니다.'} onClick={()=>void pull()}>{cursor?'다음 문의 접수 동기화':'문의 접수 동기화'}</Button><Button disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>현재 문의 연결 조회</Button>
 {view&&<><p><MetaLine items={[`접수 근거 ${view.sources.length}건`,`현재 응답 후보 ${sources.length}건`,cursor?'다음 페이지 있음':'조회 범위 끝']}/></p><GrowthConsumerDeliveryPanel key={sources.map(x=>`${x.id}:${x.version}:${x.ticketVersion}`).join(',')} campaignId={campaignId} customers={customers} serviceSources={sources}/></>}
 </section>;
}
