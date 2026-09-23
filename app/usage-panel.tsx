'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {ReceiptText,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import type {ProviderUsage,UsagePricing,UsageProvider} from '@/lib/usage-ledger';
import {isModelAlias,summarizeUsage} from '@/lib/usage-summary';

type UsageData={entries:ProviderUsage[];pricing:UsagePricing[];notice:string};
const statusNames:Record<string,string>={completed:'완료',failed:'실패',error:'실패',cancelled:'취소',canceled:'취소',stopped:'중지',interrupted:'중단',incomplete:'미완료'};
const outcomeNames:Record<string,string>={completed:'저장 완료 · 내용 검토 별도',invalid_output:'결과 요건 미충족',cancelled:'취소',provider_failed:'공급자 실행 실패',storage_failed:'결과 저장 실패'};
const count=(value:number|null)=>value===null?'미확인':value.toLocaleString('ko-KR');
const providerName=(provider:UsageProvider)=>provider==='hermes'?'HERMES':'OpenAI API';
const cost=(entry:ProviderUsage)=>entry.costAmount===null?'미확인':`${entry.costAmount.toLocaleString('ko-KR',{maximumFractionDigits:6})} ${entry.currency||''} · 추정`;
const emptyPrice={provider:'hermes' as UsageProvider,model:'',priceVersion:'',currency:'USD',inputPerMillion:'',outputPerMillion:'',source:''};
async function usageData():Promise<UsageData>{
 const response=await fetch('/api/usage',{cache:'no-store'}),data=await response.json() as Partial<UsageData>&{error?:string};
 if(!response.ok)throw new Error(data.error||'사용량을 불러오지 못했습니다.');
 if(!Array.isArray(data.entries)||!Array.isArray(data.pricing))throw new Error('사용량 응답을 확인하지 못했습니다.');
 return data as UsageData;
}
function UsageRows({entries}:{entries:ProviderUsage[]}){
 return <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm" style={{minWidth:780}}>
  <caption className="sr-only">공급자 실행별 토큰과 추정 비용</caption>
  <thead><tr className="border-b">{['관측 시각 · 공급자','공급자 보고 모델','실행 · 결과 처리','입력 토큰','출력 토큰','합계 토큰','비용 · 단가 버전'].map(label=><th scope="col" key={label} className="p-3 font-medium">{label}</th>)}</tr></thead>
  <tbody>{entries.map(entry=><tr key={entry.id} className="border-b align-top">
   <td className="p-3"><time dateTime={entry.observedAt}>{new Date(entry.observedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</time><br/>{providerName(entry.provider)}<details className="mt-1"><summary className="cursor-pointer text-xs">실행 번호</summary><span className="break-all text-xs">{entry.providerRunId}</span></details></td>
   <td className="max-w-48 break-words p-3">{entry.model||'미확인'}{isModelAlias(entry.provider,entry.model)&&<p className="text-xs">연결 별칭 · 기반 모델 미확인</p>}</td>
   <td className="p-3">{statusNames[entry.status]||entry.status}<br/><span className="text-xs">{entry.domainOutcome?outcomeNames[entry.domainOutcome]||entry.domainOutcome:'결과 처리 미확인'}</span><br/><span className="break-all text-xs">종료 사유: {entry.terminalReason}</span></td>
   <td className="p-3 tabular-nums">{count(entry.inputTokens)}</td><td className="p-3 tabular-nums">{count(entry.outputTokens)}</td><td className="p-3 tabular-nums">{count(entry.totalTokens)}</td>
   <td className="p-3 tabular-nums">{cost(entry)}<br/><span className="text-xs">{entry.priceVersion||'적용 단가 없음'}</span></td>
  </tr>)}</tbody>
 </table></div>;
}
function UsageSummary({entries}:{entries:ProviderUsage[]}){
 const totals=summarizeUsage(entries);
 return <div className="notice" aria-label="전체 실행 사용량 요약">
  <p>전체 {entries.length.toLocaleString('ko-KR')}회 · 확인된 합계 {count(totals.totalTokens)}토큰{totals.unknownTotalCount>0?` · 합계 미확인 ${totals.unknownTotalCount}회 제외`:''}</p>
  <p>입력 {count(totals.inputTokens)} / 출력 {count(totals.outputTokens)}토큰 · 입력 미확인 {totals.unknownInputCount}회, 출력 미확인 {totals.unknownOutputCount}회</p>
  <p>결과 요건 미충족 {totals.invalidOutputCount}회 · 확인된 사용량 {count(totals.invalidOutputTokens)}토큰{totals.unknownInvalidOutputCount>0?` · 사용량 미확인 ${totals.unknownInvalidOutputCount}회 제외`:''}</p>
  <p>저장 완료 {totals.storedCount}회 · 결과 처리 미확인 {totals.unclassifiedCount}회. 저장 완료는 내용 승인이나 성과 달성을 뜻하지 않습니다.</p>
 </div>;
}
function PricingForm({saved,onSaved}:{saved:UsagePricing[];onSaved:()=>Promise<void>}){
 const [price,setPrice]=useState(emptyPrice),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const set=(field:keyof typeof emptyPrice,value:string)=>setPrice(current=>({...current,[field]:value}));
 async function submit(event:FormEvent){
  event.preventDefault();setError('');setMessage('');
  if(!price.inputPerMillion.trim()||!price.outputPerMillion.trim()){setError('입력·출력 단가를 모두 입력하세요. 확인된 무료 단가만 0으로 입력하세요.');return}
  setBusy(true);
  try{
   const response=await fetch('/api/usage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_pricing',...price,inputPerMillion:Number(price.inputPerMillion),outputPerMillion:Number(price.outputPerMillion)})});
   const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||'단가를 저장하지 못했습니다.');
   await onSaved();setMessage('단가를 저장했습니다. 새로 관측되는 실행부터 적용합니다.');
  }catch(error){setError(error instanceof Error?error.message:'단가를 저장하지 못했습니다.')}finally{setBusy(false)}
 }
 return <details className="mt-6 border-t pt-5"><summary className="cursor-pointer font-medium">모델별 단가 설정{saved.length?` · ${saved.length}개`:''}</summary>
  <p className="subtle-note">공급자 가격표에서 확인한 백만 토큰당 단가를 직접 입력하세요. 실제 보고 모델 ID가 정확히 일치할 때만 적용합니다. 기존 실행의 적용 단가와 금액은 변경하지 않습니다.</p>
  {saved.length>0&&<ul className="my-4 space-y-2 text-sm">{saved.map(item=><li key={item.provider+':'+item.model}>{providerName(item.provider)} · {item.model} · {item.priceVersion}<br/>입력 {item.inputPerMillion} / 출력 {item.outputPerMillion} {item.currency} (백만 토큰당) <a href={item.source} target="_blank" rel="noreferrer" className="underline">단가 출처</a></li>)}</ul>}
  <form className="form-stack mt-4" onSubmit={submit}>
   <div className="form-two"><label className="field"><span>공급자</span><NativeSelect value={price.provider} onChange={event=>set('provider',event.target.value)}><NativeSelectOption value="hermes">HERMES</NativeSelectOption><NativeSelectOption value="openai">OpenAI API</NativeSelectOption></NativeSelect></label><label className="field"><span>실제 모델 ID</span><Input required maxLength={200} value={price.model} onChange={event=>set('model',event.target.value)} placeholder="위 사용량에 보고된 모델 ID"/></label></div>
   <div className="form-two"><label className="field"><span>단가 버전</span><Input required maxLength={100} value={price.priceVersion} onChange={event=>set('priceVersion',event.target.value)} placeholder="확인한 가격표 날짜 또는 버전"/></label><label className="field"><span>통화</span><Input required pattern="[A-Z]{3}" maxLength={3} value={price.currency} onChange={event=>set('currency',event.target.value.toUpperCase())} placeholder="USD"/></label></div>
   <div className="form-two"><label className="field"><span>입력 단가 · 백만 토큰당</span><Input required type="number" min={0} max={1000000} step="any" value={price.inputPerMillion} onChange={event=>set('inputPerMillion',event.target.value)}/></label><label className="field"><span>출력 단가 · 백만 토큰당</span><Input required type="number" min={0} max={1000000} step="any" value={price.outputPerMillion} onChange={event=>set('outputPerMillion',event.target.value)}/></label></div>
   <label className="field"><span>단가 출처 · HTTPS 주소</span><Input required type="url" pattern="https://.*" maxLength={2000} value={price.source} onChange={event=>set('source',event.target.value)} placeholder="https://…"/></label>
   <div className="form-actions"><Button type="submit" disabled={busy}>{busy?'저장 중…':'이 단가 저장'}</Button></div>
   {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p role="status" className="text-sm">{message}</p>}
  </form>
 </details>;
}
export function UsagePanel(){
 const [data,setData]=useState<UsageData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[visible,setVisible]=useState(30);
 const refresh=useCallback(async()=>{
  try{const next=await usageData();setData(next);setError('')}catch(error){setError(error instanceof Error?error.message:'사용량을 불러오지 못했습니다.')}finally{setLoading(false)}
 },[]);
 useEffect(()=>{
  let disposed=false;
  void usageData().then(next=>{if(!disposed){setData(next);setError('')}}).catch(error=>{if(!disposed)setError(error instanceof Error?error.message:'사용량을 불러오지 못했습니다.')}).finally(()=>{if(!disposed)setLoading(false)});
  return()=>{disposed=true};
 },[]);
 return <section className="settings-card" style={{gridColumn:'1 / -1',minWidth:0}}>
  <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="settings-icon"><ReceiptText/></div><h2>AI 사용량과 비용</h2></div><Button variant="outline" disabled={loading} onClick={()=>{setLoading(true);void refresh()}}><RefreshCw/>새로고침</Button></div>
  <p>실패하거나 취소된 실행도 공급자가 보고한 사용량을 남깁니다. 알 수 없는 모델·토큰·금액은 ‘미확인’으로 표시합니다.</p>
  <p className="subtle-note">hermes-agent는 연결 별칭입니다. 기반 모델이 보고되지 않으면 모델을 추정하거나 별칭에 단가를 적용하지 않습니다.</p>
  <p className="notice">{data?.notice||'비용은 직접 등록한 단가로 계산한 추정치입니다. 도구 요금·할인·캐시 요금·세금은 포함하지 않습니다.'}</p>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {loading&&!data?<p role="status">사용량 불러오는 중…</p>:data&&<>
   {!data.pricing.length&&<p className="subtle-note">아직 등록한 단가가 없습니다. 기반 모델과 입력·출력 토큰, 적용 단가가 확인되기 전의 비용은 미확인으로 남습니다.</p>}
   {data.entries.length?<><p className="subtle-note">최근 {Math.min(visible,data.entries.length)}건 / 전체 {data.entries.length}건 · 한국 시간</p><UsageSummary entries={data.entries}/><UsageRows entries={data.entries.slice(0,visible)}/>{visible<data.entries.length&&<Button className="mt-4" variant="outline" onClick={()=>setVisible(current=>current+30)}>이전 실행 더 보기</Button>}</>:<p className="subtle-note">아직 기록된 사용량이 없습니다. 이 기능 도입 이후 종료 상태를 확인한 실행부터 표시됩니다.</p>}
   <PricingForm saved={data.pricing} onSaved={refresh}/>
  </>}
 </section>;
}
