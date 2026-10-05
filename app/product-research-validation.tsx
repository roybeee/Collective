'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {clientId} from '@/lib/client';
import {parseCsv} from '@/lib/product-research/collectors/imports';
import s from './product-research.module.css';

type Section='legal'|'groundTruth'|'blind';
type Gate={ready:boolean;verified:number;required:number;reasons:string[]};
type Entry=Record<string,string|number>;
type ValidationView={version:number;legal:Entry[];groundTruth:Entry[];blind:Entry[];readiness:{legal:Gate;groundTruth:Gate;blind:Gate;sales:Gate};launchOutcomes:{decisionId:string;sku:string|null;reason:string|null;windows:{weeks:number;complete:boolean;orders:number|null;units:number|null;revenue:number|null}[]}[]};
type Field={key:string;label:string;type?:string;options?:[string,string][]};
const fields:Record<Section,Field[]>={
 legal:[{key:'id',label:'검토 기록 번호'},{key:'sourceId',label:'검토 출처',options:[['naver_datalab_search','네이버 검색어 트렌드'],['naver_datalab_shopping','네이버 쇼핑인사이트'],['youtube_data','YouTube'],['naver_searchad_keyword','네이버 검색광고'],['coupang_partners','쿠팡 파트너스']]},{key:'reviewer',label:'법무 검토자'},{key:'reviewedAt',label:'검토 시각',type:'datetime-local'},{key:'validUntil',label:'검토 유효 기한',type:'datetime-local'},{key:'evidenceUrl',label:'검토 증빙 주소',type:'url'},{key:'allowedScope',label:'허용 범위와 제한 사항'},{key:'decision',label:'검토 결론',options:[['restricted','제한 있음'],['approved','허용'],['rejected','불허']]}],
 groundTruth:[{key:'id',label:'정답 기록 번호'},{key:'sku',label:'정확한 상품 SKU'},{key:'title',label:'상품명'},{key:'decisionAt',label:'선정 당시 시각',type:'datetime-local'},{key:'periodStart',label:'관측 시작',type:'date'},{key:'periodEnd',label:'관측 종료',type:'date'},{key:'criterion',label:'사전에 정한 성공·대조 기준'},{key:'criterionFrozenAt',label:'기준 확정 시각',type:'datetime-local'},{key:'label',label:'상품 판정',options:[['control','비히트 대조군'],['hit','히트']]},{key:'origin',label:'판정 근거',options:[['candidate','후보·검수 전'],['human','사람 검수'],['ai','AI 제안']]},{key:'reviewer',label:'정답 검수자'},{key:'reviewedAt',label:'검수 시각',type:'datetime-local'},{key:'evidenceUrl',label:'정답 증빙 주소',type:'url'},{key:'evidenceHash',label:'정답 증빙 파일 SHA-256'}],
 blind:[{key:'id',label:'평가 제출 번호'},{key:'evaluatorName',label:'실제 평가자 이름'},{key:'packetHash',label:'배부 평가 자료 SHA-256'},{key:'frozenAt',label:'평가 자료 확정 시각',type:'datetime-local'},{key:'evaluatedAt',label:'평가 제출 시각',type:'datetime-local'},{key:'submittedFileHash',label:'제출한 평가 파일 SHA-256'},{key:'evidenceUrl',label:'평가 원본 증빙 주소',type:'url'},{key:'score',label:'제출 평가 점수(0~5)',type:'number'}],
};
const sectionLabels:Record<Section,string>={legal:'법무 검토',groundTruth:'정답 상품',blind:'블라인드 평가'};
function initial(section:Section):Entry{return Object.fromEntries(fields[section].map(f=>[f.key,f.options?.[0][0]??'']))}
function encoded(section:Section,input:Entry):Entry{
 return Object.fromEntries(fields[section].map(f=>{
  const value=input[f.key]??'';
  if(f.type==='datetime-local'&&value){const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error(`${f.label}을 확인하세요.`);return [f.key,date.toISOString()]}
  if(f.type==='number'){if(value==='')throw new Error(`${f.label}을 입력하세요.`);return [f.key,Number(value)]}
  return [f.key,String(value).trim()];
 }));
}
export function ResearchValidation({canInspect}:{canInspect:boolean}){
 const [view,setView]=useState<ValidationView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 const [section,setSection]=useState<Section>('legal'),[draft,setDraft]=useState<Entry>(()=>initial('legal'));
 const [pending,setPending]=useState<Entry[]|null>(null);
 async function request(entries?:Entry[]){
  setBusy(true);setError('');setSaved('');
  try{
   const response=await fetch('/api/product-research/validation',entries?{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:clientId(),expectedVersion:view?.version,section,entries})}:{credentials:'same-origin'});
   const result=await response.json() as ValidationView&{error?:string};
   if(!response.ok){if(response.status===409){const latest=await fetch('/api/product-research/validation',{credentials:'same-origin'});if(latest.ok)setView(await latest.json() as ValidationView)}throw new Error(result.error||'검증 자료를 확인하지 못했습니다.')}
   setView(result);if(entries){setSaved(`${entries.length}건을 저장했습니다.`);setPending(null);setDraft(initial(section))}
  }catch(e){setError(e instanceof Error?e.message:'검증 자료를 확인하지 못했습니다.')}
  finally{setBusy(false)}
 }
 async function importFile(file:File|undefined){
  if(!file)return;setError('');setPending(null);
  try{
   if(file.size>500000)throw new Error('파일은 500KB 이하여야 합니다.');
   const rows=parseCsv(await file.text());const header=rows[0]?.cells??[];
   if(!fields[section].every(f=>header.includes(f.key)))throw new Error('양식의 모든 열을 유지해 주세요. 아래 빈 양식을 내려받아 사용하세요.');
   if(new Set(header).size!==header.length)throw new Error('같은 열 이름이 중복돼 있습니다.');
   const data=rows.slice(1).filter(r=>r.cells.some(Boolean));
   if(!data.length||data.length>200)throw new Error('한 번에 1~200건을 올려 주세요.');
   setPending(data.map(r=>encoded(section,Object.fromEntries(header.map((key,i)=>[key,r.cells[i]??''])))));
  }catch(e){setError(e instanceof Error?e.message:'파일을 읽지 못했습니다.')}
 }
 function template(){
  const url=URL.createObjectURL(new Blob(['\uFEFF'+fields[section].map(f=>f.key).join(',')+'\r\n'],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`research-${section}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const gates=view?[['법무 검토',view.readiness.legal],['정답셋',view.readiness.groundTruth],['블라인드 평가',view.readiness.blind],['출시 판매 관측',view.readiness.sales]] as const:[];
 return <section className={s.block} aria-label="실제 검증 자료">
  <h3 className={s.subtitle}>실제 검증 자료</h3>
  <p className={s.muted}>사람이 확인한 법무·정답·평가 증빙을 기록합니다. 수집 사용 제한은 별도로 유지됩니다.</p>
  <Button variant="outline" disabled={!canInspect||busy} disabledReason={!canInspect?'소유자만 검증 자료를 관리할 수 있습니다.':undefined} onClick={()=>void request()}>실제 검증 자료 열기</Button>
  {error&&<p role="alert">{error}</p>}{saved&&<p role="status">{saved}</p>}
  {view&&<div>
   <p>유효 정답 {view.readiness.groundTruth.verified} / 50개</p>
   <p>평가자 제출 {new Set(view.blind.map(r=>String(r.evaluatorName).trim().toLowerCase())).size} / 3명</p>
   {gates.map(([label,gate])=><div key={label}><h4>{label}: {gate.ready?'등록 기준 충족':'확인 필요'}</h4>{gate.reasons.map(reason=><p key={reason} className={s.muted}>{reason}</p>)}</div>)}
   <p className={s.muted}>평가 원본을 소유자가 대리 등록합니다. 평가자 본인 인증과 독립성은 별도 확인이 필요합니다.</p>
   <label className="field"><span>등록할 자료</span><NativeSelect value={section} disabled={busy} onChange={e=>{const next=e.target.value as Section;setSection(next);setDraft(initial(next));setPending(null);setError('');setSaved('')}}>{Object.entries(sectionLabels).map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label>
   <form onSubmit={e=>{e.preventDefault();try{void request([encoded(section,draft)])}catch(error){setError(error instanceof Error?error.message:'입력을 확인하세요.')}}}>
    <fieldset disabled={busy}><legend>{sectionLabels[section]} 등록</legend>
     {fields[section].map(field=><label className="field" key={field.key}><span>{field.label}</span>{field.options?<NativeSelect value={String(draft[field.key]??'')} onChange={e=>setDraft({...draft,[field.key]:e.target.value})}>{field.options.map(([key,label])=><NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect>:<Input required type={field.type??'text'} value={draft[field.key]??''} maxLength={1000} step={field.type==='number'?'0.1':undefined} min={field.type==='number'?0:undefined} max={field.type==='number'?5:undefined} onChange={e=>setDraft({...draft,[field.key]:e.target.value})}/>}</label>)}
     <Button type="submit" disabled={busy}>검증 자료 저장</Button>
    </fieldset>
   </form>
   <details><summary>여러 건을 파일로 등록</summary>
    <p>빈 CSV 양식에 같은 항목을 작성하세요. 시각은 시간대를 포함한 ISO 형식(예: 2026-10-01T09:00:00+09:00)을 사용합니다. 실제 증빙을 확인한 내용만 등록하세요.</p>
    <Button variant="outline" onClick={template}>빈 CSV 양식 받기</Button>
    <label className="field"><span>검증 자료 CSV</span><Input key={section} type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>void importFile(e.target.files?.[0])}/></label>
    {pending&&<p>확인할 자료 {pending.length}건</p>}<Button disabled={busy||!pending} disabledReason={!pending?'양식에 맞는 CSV 파일을 먼저 선택하세요.':undefined} onClick={()=>pending&&void request(pending)}>확인한 파일 저장</Button>
   </details>
   <h4>등록된 {sectionLabels[section]}</h4>
   {view[section].length?view[section].map(entry=><p key={String(entry.id)}><MetaLine items={[String(entry.id),String(entry.reviewer??entry.evaluatorName??''),String(entry.sku??entry.sourceId??'평가 원본')]}/></p>):<EmptyLine first="검증 자료">등록된 자료가 없습니다.</EmptyLine>}
   <h4>출시 후 실제 판매 원장</h4>
   {!view.launchOutcomes.length&&<p>연결된 출시 결과가 없습니다. 신규 출시의 정확한 SKU를 기존 주문 원장에 연결하세요.</p>}
   {view.launchOutcomes.map(row=><div key={row.decisionId}><p><MetaLine items={[row.sku??'SKU 미확인',row.reason??'기존 주문 원장 관측']}/></p>{row.windows.map(w=><p key={w.weeks}><MetaLine items={[`${w.weeks}주`,w.complete?'기간 종료':'관측 중',`주문 ${w.orders??'미확인'}건`,`수량 ${w.units??'미확인'}개`,`매출 ${w.revenue===null?'미확인':`${w.revenue.toLocaleString('ko-KR')}원`}`]}/></p>)}</div>)}
   <p className={s.muted}>매출 관측 뒤 반품·비용·마진 및 인과 효과를 별도로 검증해야 합니다. 모든 자료는 등록 당시 근거를 보존하며 서버 검증을 거칩니다.</p>
  </div>}
 </section>;
}
