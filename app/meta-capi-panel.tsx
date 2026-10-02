'use client';
import {NativeSelect} from '@/components/ui/native-select';
import {useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import type {MetaConversionView} from '@/lib/meta-conversion';
import type {MetaPixelEnvelope} from '@/lib/meta-capi';
import s from './meta-insights-panel.module.css';
export function MetaCapiPanel({campaignId,view,onChange}:{campaignId:string;view:MetaConversionView;onChange:(v:MetaConversionView)=>void}){
 const id=useId(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[datasetId,setDatasetId]=useState(''),[origin,setOrigin]=useState(''),[token,setToken]=useState(''),[confirmed,setConfirmed]=useState(false),[eventId,setEventId]=useState(''),[emailHash,setEmailHash]=useState(''),[ua,setUa]=useState(''),[source,setSource]=useState(''),[consented,setConsented]=useState(false),[pixel,setPixel]=useState<MetaPixelEnvelope|null>(null);
 const c=view.capi,disabled=busy||!view.canEdit,event=view.records.find(x=>x.id===eventId);
 if(!c)return null;
 async function run(action:string,extra:Record<string,unknown>={}){setBusy(true);setError('');setPixel(null);try{const r=await fetch('/api/meta-ads/conversions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,campaignId,confirmed:true,...extra})}),v=await r.json() as MetaConversionView&{error?:string;envelope?:MetaPixelEnvelope};if(!r.ok)throw new Error(v.error||'전환 작업 실패');if(v.envelope)setPixel(v.envelope);else onChange(v);if(action==='configure'){setToken('');setConfirmed(false)}if(action==='queue'){setEmailHash('');setUa('');setConsented(false)}}catch(e){setError(e instanceof Error?e.message:'전환 작업 실패')}finally{setBusy(false)}}
 return <div className={s.card}><h3>서버 전환 전송과 Pixel 연결</h3><p>전송 기능 {c.enabled?'켜짐':'꺼짐'} · Meta 수신 확인 {c.operations.filter(x=>x.state==='accepted').length}건. 수신 확인은 광고 귀속이나 중복 제거 검증과 다릅니다.</p>
 {error&&<p role="alert" className={s.error}>{error}</p>}
 <p>데이터셋 연결: {c.connection?.connected?`${c.connection.datasetId} · ${c.connection.origin}`:'연결 없음'}</p>
 <label htmlFor={id+'dataset'}>Meta 데이터셋 ID<Input id={id+'dataset'} value={datasetId} onChange={e=>setDatasetId(e.target.value)} disabled={disabled}/></label>
 <label htmlFor={id+'origin'}>자사몰 원본 주소<Input id={id+'origin'} placeholder="https://shop.example" value={origin} onChange={e=>setOrigin(e.target.value)} disabled={disabled}/></label>
 <label htmlFor={id+'token'}>전환 전용 액세스 토큰<Input id={id+'token'} type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} disabled={disabled}/></label>
 <label><Checkbox checked={confirmed} onCheckedChange={v=>setConfirmed(v===true)} disabled={disabled}/>이 지점의 데이터셋과 전환 전용 연결을 확인했습니다</label>
 <p><Button disabled={disabled||!confirmed||!token||!datasetId||!origin} disabledReason={!confirmed?'확인 칸을 먼저 체크하세요.':!token?'토큰을 먼저 넣으세요.':!datasetId?'필수 칸을 먼저 채우세요.':!origin?'필수 칸을 먼저 채우세요.':undefined} onClick={()=>void run('configure',{datasetId,origin,token,expectedConnectionVersion:c.connection?.version??0})}>전환 연결 저장</Button>{c.connection?.connected&&<Button variant="outline" disabled={disabled} onClick={()=>void run('disconnect',{expectedConnectionVersion:c.connection?.version})}>전환 연결 해제</Button>}</p>
 <h4>동의한 구매 전송 예약</h4><p>이메일 원문은 입력하지 마세요. 자사몰이 공백 제거·소문자 처리 후 SHA-256으로 만든 값과 실제 구매 브라우저 정보를 사용합니다. 해시도 고객 정보이므로 별도 동의가 필요합니다.</p>
 <label htmlFor={id+'event'}>전송할 구매<NativeSelect id={id+'event'} value={eventId} disabled={disabled} onChange={e=>{setEventId(e.target.value);setPixel(null);setConsented(false)}}><option value="">구매 선택</option>{view.records.map(x=><option key={x.id} value={x.id}>{x.value.toLocaleString('ko-KR')}원 · {x.id.slice(-10)}</option>)}</NativeSelect></label>
 <label htmlFor={id+'hash'}>동의한 이메일 SHA-256<Input id={id+'hash'} value={emailHash} maxLength={64} autoComplete="off" onChange={e=>setEmailHash(e.target.value)} disabled={disabled}/></label>
 <label htmlFor={id+'ua'}>실제 구매 브라우저 User-Agent<Input id={id+'ua'} value={ua} maxLength={512} autoComplete="off" onChange={e=>setUa(e.target.value)} disabled={disabled}/></label>
 <label htmlFor={id+'source'}>개인정보 없는 고정 구매 페이지 주소<Input id={id+'source'} value={source} onChange={e=>setSource(e.target.value)} disabled={disabled}/></label>
 <label><Checkbox checked={consented} onCheckedChange={v=>setConsented(v===true)} disabled={disabled}/>고객이 이메일 해시·브라우저 정보·구매 정보의 Meta 전송에 동의했고 실제 전송을 승인합니다</label>
 <p><Button disabled={disabled||!c.enabled||!c.connection?.connected||!event||!consented||!emailHash||!ua||!source} disabledReason={!c.enabled?'연결을 먼저 켜세요.':(!c.connection?.connected)?'연결 확인을 먼저 하세요.':!event?'먼저 대상을 고르세요.':!consented?'동의 확인을 먼저 체크하세요.':!emailHash?'필수 칸을 먼저 채우세요.':!ua?'필수 칸을 먼저 채우세요.':!source?'먼저 대상을 고르세요.':undefined} onClick={()=>void run('queue',{eventId,expectedVersion:event?.version,fieldsConsented:consented,emailHash,clientUserAgent:ua,eventSourceUrl:source})}>동의한 구매 전송 예약</Button> <Button variant="outline" disabled={disabled||!c.enabled} disabledReason={!c.enabled?'연결을 먼저 켜세요.':undefined} onClick={()=>void run('advance')}>예약한 전환 전송 실행</Button></p>
 <p>예약 후 워커가 전송합니다. 응답 미확인 시 5분 간격, 최대 3회까지 같은 구매 ID로 재시도합니다. 취소·환불·주문 변경·동의 철회는 다음 전송을 차단합니다.</p>
 <Button variant="outline" disabled={disabled||!event||!c.enabled} disabledReason={!event?'먼저 대상을 고르세요.':!c.enabled?'연결을 먼저 켜세요.':undefined} onClick={()=>void run('pixel',{eventId})}>구매 브라우저용 Pixel 계약 보기</Button>
 {pixel&&<><p>5분 안에 자사몰 서버에서 구매자 브라우저로 전달하세요. 구매자 동의 관리자가 광고 측정 동의를 확인한 경우에만 자사몰에서 실행합니다.</p><pre className="whitespace-pre-wrap wrap-anywhere">{JSON.stringify(pixel,null,2)}</pre><code>fbq(&apos;trackSingle&apos;, envelope.datasetId, &apos;Purchase&apos;, {'{'}value: envelope.value, currency: envelope.currency{'}'}, {'{'}eventID: envelope.eventId{'}'})</code></>}
 <ul>{c.operations.map(x=><li key={x.id}>{x.id.slice(-10)} · {x.state} · 시도 {x.attempts}회 · {x.reason}</li>)}</ul>
 </div>;
}
