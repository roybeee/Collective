'use client';
// 가맹 설정(트랙 R R1a, 대표·관리자 전용): 가맹 프로필(분기·예상매출액 산정서 판단 입력·공휴일·보관 위치·적격 기준), 정보공개서 버전, 가맹계약서안 템플릿,
// 개인정보 안내문, 감사 기록(값 없음). 문서 파일은 올리지 않고 브라우저에서 계산한 SHA-256만 저장한다. 직원은 이 화면을 보지 않는다(서버도 403).
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {BRANCH_LABELS,BUDGET_LABELS,TIMING_LABELS,FORECAST_DUTY_LABELS,AUDIT_ACTION_LABELS,CONTACT_FIELD_LABELS,REVEAL_PURPOSE_LABELS,EXPORT_PURPOSE_LABELS,REGISTRY_AMEND_REASON_LABELS,BACKDATE_REASON_LABELS,CORRECTION_REASON_LABELS,type Branch,type RegistryAmendReason} from '@/lib/franchise';
import {toKstDate} from '@/lib/franchise-rules';
import type {ForecastDuty} from '@/lib/franchise-gates';
import {franchiseGet,franchisePost,problemOf,messageOf,ProblemBox,Disclaimer,Section,HashField,StorageField,LabelSelect,kst,kstDate,labelOf,roleLabel,type Json,type Problem} from './franchise-common';

type Profile={branch:Branch;forecastInputs:{sme:boolean|null;storesAtFyEnd:number|null;fiscalYearEnd:string|null};holidays:{list:string[];source:string;verifiedAt:string}|null;storageLabels:string[];
 eligibility:{version:number;budgetBands:string[];regions:string[];timingBands:string[]}|null;version:number;updatedAt:string};
type Registered={id:string;status:'active'|'retired';createdAt:string;retiredAt?:string;amendments?:{at:string;reasonCode:string}[]};
type VersionRow=Registered&{label:string;sha256:string;registeredAt:string|null;validFrom:string;validUntil:string;storageLabel:string;version:number};
type TemplateRow=Registered&{label:string;sha256:string;checkedItems:number[];storageLabel:string;version:number;complete:boolean};
type NoticeRow=Registered&{versionLabel:string;text:string;sha256:string;controllerName:string;processorNames:string[]};
type SettingsData={profile:Profile|null;versions:VersionRow[];templates:TemplateRow[];notices:NoticeRow[];forecastDuty:ForecastDuty};
type AuditRow={id:string;action:string;actor:{id:string;role:string};at:string;fields?:string[];purpose?:string;contactMode?:string;count?:number;counts?:{leads:number;keys:number;audits:number;remaining:number};trigger?:string;reasonCode?:string;changedFields?:string[]};
type Run=(action:string,payload:Json,done:string)=>Promise<Json|null>;
const lines=(v:string)=>v.split('\n').map(x=>x.trim()).filter(Boolean);
const ITEMS=Array.from({length:13},(_,i)=>i+1);
const SME_HINT='중소기업 확인서를 받기 전에는 모름으로 두세요. 모름이면 예상매출액 산정서를 필수로 봅니다(COLLECTIVE 휴리스틱 · 법률 자문 아님).';

export function FranchiseSettings({brandId,enabled,onChanged}:{brandId:string;enabled:boolean;onChanged:()=>void}){
 const [data,setData]=useState<SettingsData|null>(null),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null),[message,setMessage]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const d=await franchiseGet<SettingsData>({view:'settings',brandId},signal);if(!signal?.aborted){setData(d);setError('')}}
  catch(e){if(!signal?.aborted)setError(messageOf(e))}
 },[brandId]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load]);
 const run:Run=async(action,payload,done)=>{
  setBusy(true);setProblem(null);setMessage('');
  try{
   const r=await franchisePost(action,{brandId,...payload});
   if(r.status!==200){setProblem(problemOf(r));if(r.status===409)void load();return null}
   const result=(r.body.result??{}) as Json;
   setMessage(result.reactivated?'사용 중지했던 같은 파일(본문)을 다시 사용합니다.':result.existing?'같은 해시(본문)의 항목이 이미 있어 새로 만들지 않았습니다.':result.alreadyRetired?'이미 사용 중지된 항목입니다.':done);
   await load();onChanged();
   return result;
  }finally{setBusy(false)}
 };
 if(error)return <div role="alert" className="load-error"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button></div>;
 if(!data)return <p role="status">가맹 설정을 불러오고 있습니다.</p>;
 const labels=data.profile?.storageLabels??[],locked=busy||!enabled;
 return <div className="franchise-panel">
  {!enabled&&<p className="notice" role="note">가맹 모집 기능이 꺼져 있어 설정을 바꿀 수 없습니다. 조회만 합니다.</p>}
  {(problem||message)&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<ProblemBox problem={problem}/></div>}
  <Section title="가맹 프로필" note="분기 A(모집 가능)로 기록한 브랜드만 문의를 등록할 수 있습니다."><ProfileForm key={data.profile?.version??0} profile={data.profile} duty={data.forecastDuty} run={run} locked={locked}/></Section>
  <VersionsSection rows={data.versions} labels={labels} run={run} locked={locked}/>
  <TemplatesSection rows={data.templates} labels={labels} run={run} locked={locked}/>
  <NoticesSection rows={data.notices} run={run} locked={locked}/>
  <AuditSection brandId={brandId} refresh={data}/>
 </div>;
}

function ProfileForm({profile,duty,run,locked}:{profile:Profile|null;duty:ForecastDuty;run:Run;locked:boolean}){
 const p=profile,fi=p?.forecastInputs;
 const [branch,setBranch]=useState<Branch>(p?.branch??'undetermined'),[sme,setSme]=useState(fi?.sme===true?'yes':fi?.sme===false?'no':'');
 const [stores,setStores]=useState(fi?.storesAtFyEnd===null||fi?.storesAtFyEnd===undefined?'':String(fi.storesAtFyEnd)),[fyEnd,setFyEnd]=useState(fi?.fiscalYearEnd??'');
 const [holidays,setHolidays]=useState((p?.holidays?.list??[]).join('\n')),[holidaySource,setHolidaySource]=useState(p?.holidays?.source??''),[storage,setStorage]=useState((p?.storageLabels??[]).join('\n'));
 const [useCriteria,setUseCriteria]=useState(!!p?.eligibility),[budgets,setBudgets]=useState<string[]>(p?.eligibility?.budgetBands??[]),[regions,setRegions]=useState((p?.eligibility?.regions??[]).join('\n')),[timings,setTimings]=useState<string[]>(p?.eligibility?.timingBands??[]);
 const toggle=(list:string[],v:string,on:boolean)=>on?[...list,v]:list.filter(x=>x!==v);
 function save(){
  const list=lines(holidays);
  void run('save_profile',{version:p?.version??0,profile:{branch,forecastInputs:{sme:sme==='yes'?true:sme==='no'?false:null,storesAtFyEnd:stores===''?null:Number(stores),fiscalYearEnd:fyEnd||null},
   holidays:list.length?{list,source:holidaySource}:null,storageLabels:lines(storage),eligibility:useCriteria?{budgetBands:budgets,regions:lines(regions),timingBands:timings}:null}},'가맹 프로필을 저장했습니다.');
 }
 return <form className="form-stack" onSubmit={e=>{e.preventDefault();save()}}><fieldset disabled={locked} className="form-stack">
  <div className="form-two"><LabelSelect label="가맹 준비도 분기" labels={BRANCH_LABELS} value={branch} onChange={setBranch}/>
   <label className="field"><span>중소기업 여부</span><NativeSelect value={sme} onChange={e=>setSme(e.target.value)}><NativeSelectOption value="">모름</NativeSelectOption><NativeSelectOption value="yes">예</NativeSelectOption><NativeSelectOption value="no">아니오</NativeSelectOption></NativeSelect><small>{SME_HINT}</small></label></div>
  <div className="form-two"><label className="field"><span>직전 사업연도 말 가맹점 수 (빈칸=모름)</span><Input type="number" min={0} step={1} value={stores} onChange={e=>setStores(e.target.value)}/></label>
   <label className="field"><span>사업연도 종료일 (월말, 선택)</span><Input type="date" value={fyEnd} onChange={e=>setFyEnd(e.target.value)}/></label></div>
  <p className="subtle-note">예상매출액 산정서: {FORECAST_DUTY_LABELS[duty]} · 저장한 값 기준</p>
  <div className="form-two"><label className="field"><span>공휴일 목록 (한 줄에 YYYY-MM-DD)</span><Textarea rows={4} value={holidays} onChange={e=>setHolidays(e.target.value)}/><small>없으면 주말만 반영합니다.</small></label>
   <label className="field"><span>공휴일 출처</span><Input maxLength={200} required={!!lines(holidays).length} value={holidaySource} placeholder="예: 관보 공휴일 목록(수기 입력)" onChange={e=>setHolidaySource(e.target.value)}/></label></div>
  <label className="field"><span>보관 위치 라벨 (한 줄에 하나, 20개까지)</span><Textarea rows={3} value={storage} placeholder="예: 본사 문서함" onChange={e=>setStorage(e.target.value)}/><small>증빙·문서 원본을 둔 곳의 이름만 적습니다. 주소·연락처는 적지 않습니다.</small></label>
  <label className="franchise-inline"><input type="checkbox" checked={useCriteria} onChange={e=>setUseCriteria(e.target.checked)}/> 적격 기준 사용 (목록 정렬에만 씁니다. 자동 탈락 없음)</label>
  {useCriteria&&<>
   <fieldset className="field"><legend>예산 구간</legend>{Object.entries(BUDGET_LABELS).map(([k,v])=><label key={k} className="franchise-inline"><input type="checkbox" checked={budgets.includes(k)} onChange={e=>setBudgets(toggle(budgets,k,e.target.checked))}/> {v}</label>)}</fieldset>
   <label className="field"><span>모집 지역 (한 줄에 시·군·구 하나)</span><Textarea rows={3} value={regions} placeholder="예: 가상시 가상구" onChange={e=>setRegions(e.target.value)}/></label>
   <fieldset className="field"><legend>창업 시기</legend>{Object.entries(TIMING_LABELS).map(([k,v])=><label key={k} className="franchise-inline"><input type="checkbox" checked={timings.includes(k)} onChange={e=>setTimings(toggle(timings,k,e.target.checked))}/> {v}</label>)}</fieldset>
  </>}
  <div className="form-actions"><Button type="submit">프로필 저장</Button></div>
  {p&&<p className="subtle-note">v{p.version} · 저장 {kst(p.updatedAt)}</p>}
 </fieldset></form>;
}

// 날짜 입력칸 값: 등록일·유효 기간 시작은 그 시각의 KST 날짜, 유효 기간 끝은 저장한 끝 시각 직전의 KST 날짜(그날까지 유효).
const dateOf=(at:string|null)=>at?toKstDate(at):'';
const lastDayOf=(until:string)=>toKstDate(new Date(Date.parse(until)-1).toISOString());
const untilLabel=(until:string)=>`${lastDayOf(until)}까지(${kst(until)} 전)`;
// 정보공개서 버전: 등록된 최신본의 파일 해시와 공정위 등록일·유효 기간을 기록한다. 같은 해시를 다른 값으로 다시 등록하면 409이고 목록의 정정을 쓴다.
// 사용 중지한 같은 파일을 다시 등록하면 다시 사용한다. 사용 중지한 버전도 과거 제공 판정에는 계속 쓴다.
function VersionsSection({rows,labels,run,locked}:{rows:VersionRow[];labels:readonly string[];run:Run;locked:boolean}){
 const [f,setF]=useState({label:'',sha256:'',registeredOn:'',validFrom:'',validUntil:'',storageLabel:''});
 async function register(){const r=await run('register_disclosure_version',{label:f.label,sha256:f.sha256,registeredAt:f.registeredOn?kstDate(f.registeredOn):null,validFrom:f.validFrom,validUntil:f.validUntil,storageLabel:f.storageLabel},'정보공개서 버전을 등록했습니다.');if(r)setF({label:'',sha256:'',registeredOn:'',validFrom:'',validUntil:'',storageLabel:f.storageLabel})}
 return <Section title="정보공개서 버전" note="등록된 최신 정보공개서의 파일 해시와 등록일·유효 기간을 입력합니다. 파일은 올리지 않고 해시만 저장합니다.">
  {rows.length?<ul className="franchise-list">{rows.map(v=><li key={v.id}><p><b>{v.label}</b> <span className={'status '+(v.status==='active'?'status-approved':'status-outdated')}>{v.status==='active'?'사용 중':'사용 중지'}</span></p>
   <p className="subtle-note">등록 {v.registeredAt?kst(v.registeredAt):'미등록'} · 유효 {kst(v.validFrom)} ~ {untilLabel(v.validUntil)} · 해시 {v.sha256.slice(0,12)} · 보관 {v.storageLabel}{v.amendments?.length?` · 정정 ${v.amendments.length}회`:''}</p>
   {v.status==='active'&&<Button size="sm" variant="outline" disabled={locked} onClick={()=>{if(window.confirm('이 버전을 사용 중지할까요? 새 제공 기록에는 쓸 수 없고, 이미 기록한 제공 판정에는 계속 씁니다.'))void run('retire_disclosure_version',{id:v.id,version:v.version},'버전을 사용 중지했습니다.')}}>사용 중지</Button>}
   <VersionAmend key={v.version} row={v} run={run} locked={locked}/></li>)}</ul>:<p className="subtle-note">등록한 버전이 없습니다.</p>}
  <form className="form-stack" onSubmit={e=>{e.preventDefault();void register()}}><fieldset disabled={locked} className="form-stack"><legend>새 버전 등록</legend>
   <label className="field"><span>라벨</span><Input required maxLength={60} value={f.label} placeholder="예: 정보공개서 2026년판" onChange={e=>setF({...f,label:e.target.value})}/></label>
   <HashField label="정보공개서 파일 해시" required value={f.sha256} onChange={sha256=>setF({...f,sha256})}/>
   <div className="form-two"><label className="field"><span>공정위 등록일 (없으면 빈칸=미등록)</span><Input type="date" value={f.registeredOn} onChange={e=>setF({...f,registeredOn:e.target.value})}/></label><StorageField labels={labels} required value={f.storageLabel} onChange={storageLabel=>setF({...f,storageLabel})}/></div>
   <div className="form-two"><label className="field"><span>유효 기간 시작</span><Input type="date" required value={f.validFrom} onChange={e=>setF({...f,validFrom:e.target.value})}/></label><label className="field"><span>유효 기간 끝 (이날까지 유효)</span><Input type="date" required value={f.validUntil} onChange={e=>setF({...f,validUntil:e.target.value})}/></label></div>
   <div className="form-actions"><Button type="submit">버전 등록</Button></div>
  </fieldset></form>
 </Section>;
}
// 정정: 등록일·유효 기간을 고친다(사유 필수, 바꾸기 전 값과 사유가 기록에 남는다). 바꾼 칸만 보낸다. 이미 기록한 제공도 고친 값으로 다시 판정한다.
function VersionAmend({row,run,locked}:{row:VersionRow;run:Run;locked:boolean}){
 const initial={registeredOn:dateOf(row.registeredAt),validFrom:dateOf(row.validFrom),validUntil:lastDayOf(row.validUntil)};
 const [f,setF]=useState(initial),[reason,setReason]=useState<RegistryAmendReason|''>('');
 const payload={...(f.registeredOn!==initial.registeredOn?{registeredAt:f.registeredOn?kstDate(f.registeredOn):null}:{}),...(f.validFrom!==initial.validFrom?{validFrom:f.validFrom}:{}),...(f.validUntil!==initial.validUntil?{validUntil:f.validUntil}:{})};
 return <details><summary>정정 (등록일·유효 기간)</summary><form className="form-stack" onSubmit={e=>{e.preventDefault();void run('amend_disclosure_version',{id:row.id,version:row.version,reasonCode:reason,...payload},'정보공개서 버전을 정정했습니다.')}}><fieldset disabled={locked} className="form-stack">
  <div className="form-two"><label className="field"><span>공정위 등록일 (빈칸=미등록)</span><Input type="date" value={f.registeredOn} onChange={e=>setF({...f,registeredOn:e.target.value})}/></label><LabelSelect label="정정 사유" labels={REGISTRY_AMEND_REASON_LABELS} value={reason} empty="사유 선택" required onChange={setReason}/></div>
  <div className="form-two"><label className="field"><span>유효 기간 시작</span><Input type="date" required value={f.validFrom} onChange={e=>setF({...f,validFrom:e.target.value})}/></label><label className="field"><span>유효 기간 끝 (이날까지 유효)</span><Input type="date" required value={f.validUntil} onChange={e=>setF({...f,validUntil:e.target.value})}/></label></div>
  <div className="form-actions"><Button type="submit" variant="outline" disabled={!reason||!Object.keys(payload).length}>정정 저장</Button></div>
 </fieldset></form></details>;
}

// 가맹계약서안 템플릿: 계약 전에 주는 초안(서명한 계약서가 아님). 제11조② 필수 기재 13개 항목 확인 여부를 기록한다. 13개가 다 확인돼야 계약서안 제공을 기산에 쓴다.
function TemplatesSection({rows,labels,run,locked}:{rows:TemplateRow[];labels:readonly string[];run:Run;locked:boolean}){
 const [f,setF]=useState<{label:string;sha256:string;items:number[];storageLabel:string}>({label:'',sha256:'',items:[],storageLabel:''});
 async function register(){const r=await run('register_contract_template',{label:f.label,sha256:f.sha256,checkedItems:[...f.items].sort((a,b)=>a-b),storageLabel:f.storageLabel},'가맹계약서안 템플릿을 등록했습니다.');if(r)setF({label:'',sha256:'',items:[],storageLabel:f.storageLabel})}
 return <Section title="가맹계약서안 템플릿" note="계약 전에 가맹희망자에게 주는 가맹계약서 초안입니다. 서명한 계약서가 아닙니다.">
  {rows.length?<ul className="franchise-list">{rows.map(t=><li key={t.id}><p><b>{t.label}</b> <span className={'status '+(t.status==='active'?'status-approved':'status-outdated')}>{t.status==='active'?'사용 중':'사용 중지'}</span> <span className={'status '+(t.complete?'status-approved':'status-revision')}>{t.complete?'13개 항목 확인':`${t.checkedItems.length}/13 확인`}</span></p>
   <p className="subtle-note">해시 {t.sha256.slice(0,12)} · 보관 {t.storageLabel} · 등록 {kst(t.createdAt)}{t.amendments?.length?` · 정정 ${t.amendments.length}회`:''}</p>
   {t.status==='active'&&<Button size="sm" variant="outline" disabled={locked} onClick={()=>{if(window.confirm('이 템플릿을 사용 중지할까요?'))void run('retire_contract_template',{id:t.id,version:t.version},'템플릿을 사용 중지했습니다.')}}>사용 중지</Button>}
   <TemplateAmend key={t.version} row={t} run={run} locked={locked}/></li>)}</ul>:<p className="subtle-note">등록한 템플릿이 없습니다.</p>}
  <form className="form-stack" onSubmit={e=>{e.preventDefault();void register()}}><fieldset disabled={locked} className="form-stack"><legend>새 템플릿 등록</legend>
   <label className="field"><span>라벨</span><Input required maxLength={60} value={f.label} placeholder="예: 가맹계약서안 v1" onChange={e=>setF({...f,label:e.target.value})}/></label>
   <HashField label="계약서안 파일 해시" required value={f.sha256} onChange={sha256=>setF({...f,sha256})}/>
   <fieldset className="field"><legend>확인한 필수 기재 항목</legend><div className="franchise-bar">{ITEMS.map(n=><label key={n} className="franchise-inline"><input type="checkbox" checked={f.items.includes(n)} onChange={e=>setF({...f,items:e.target.checked?[...f.items,n]:f.items.filter(x=>x!==n)})}/> 제11조② {n}호</label>)}</div><small>빠진 항목이 있어도 저장할 수 있지만, 그 템플릿으로 한 제공은 기산에 쓰지 않습니다.</small></fieldset>
   <StorageField labels={labels} required value={f.storageLabel} onChange={storageLabel=>setF({...f,storageLabel})}/>
   <div className="form-actions"><Button type="submit">템플릿 등록</Button></div>
  </fieldset></form>
 </Section>;
}
// 정정: 확인한 필수 기재 항목을 고친다(사유 필수). 13개가 모두 확인되면 그 템플릿으로 한 제공을 기산에 쓴다.
function TemplateAmend({row,run,locked}:{row:TemplateRow;run:Run;locked:boolean}){
 const [items,setItems]=useState<number[]>(row.checkedItems),[reason,setReason]=useState<RegistryAmendReason|''>('');
 const changed=JSON.stringify([...items].sort((a,b)=>a-b))!==JSON.stringify([...row.checkedItems].sort((a,b)=>a-b));
 return <details><summary>정정 (확인한 기재 항목)</summary><form className="form-stack" onSubmit={e=>{e.preventDefault();void run('amend_contract_template',{id:row.id,version:row.version,reasonCode:reason,checkedItems:[...items].sort((a,b)=>a-b)},'계약서안 템플릿을 정정했습니다.')}}><fieldset disabled={locked} className="form-stack">
  <fieldset className="field"><legend>확인한 필수 기재 항목</legend><div className="franchise-bar">{ITEMS.map(n=><label key={n} className="franchise-inline"><input type="checkbox" checked={items.includes(n)} onChange={e=>setItems(e.target.checked?[...items,n]:items.filter(x=>x!==n))}/> 제11조② {n}호</label>)}</div></fieldset>
  <LabelSelect label="정정 사유" labels={REGISTRY_AMEND_REASON_LABELS} value={reason} empty="사유 선택" required onChange={setReason}/>
  <div className="form-actions"><Button type="submit" variant="outline" disabled={!reason||!changed}>정정 저장</Button></div>
 </fieldset></form></details>;
}

// 개인정보 안내문: 동의 근거·광고성 정보 동의 때 안내한 문구의 버전. 처리자·수탁자 이름은 관리자가 적는다(코드에 고정한 회사 정보 없음).
function NoticesSection({rows,run,locked}:{rows:NoticeRow[];run:Run;locked:boolean}){
 const [f,setF]=useState({versionLabel:'',text:'',controllerName:'',processors:''});
 async function register(){const r=await run('register_privacy_notice',{versionLabel:f.versionLabel,text:f.text,controllerName:f.controllerName,processorNames:lines(f.processors)},'개인정보 안내문을 등록했습니다.');if(r)setF({versionLabel:'',text:'',controllerName:'',processors:''})}
 return <Section title="개인정보 안내문" note="수집·이용 안내에 쓴 문구를 버전으로 남깁니다. 한 번 등록한 본문은 바꾸지 않고 새 버전으로 등록합니다.">
  {rows.length?<ul className="franchise-list">{rows.map(n=><li key={n.id}><p><b>{n.versionLabel}</b> <span className={'status '+(n.status==='active'?'status-approved':'status-outdated')}>{n.status==='active'?'사용 중':'사용 중지'}</span></p>
   <p className="subtle-note">처리자 {n.controllerName}{n.processorNames.length?` · 수탁자 ${n.processorNames.join(', ')}`:''} · 해시 {n.sha256.slice(0,12)} · 등록 {kst(n.createdAt)}</p>
   <details><summary>본문 보기</summary><p style={{whiteSpace:'pre-wrap'}}>{n.text}</p></details>
   {n.status==='active'&&<Button size="sm" variant="outline" disabled={locked} onClick={()=>{if(window.confirm('이 안내문을 사용 중지할까요? 새 동의 기록에는 쓸 수 없습니다.'))void run('retire_privacy_notice',{id:n.id},'안내문을 사용 중지했습니다.')}}>사용 중지</Button>}</li>)}</ul>:<p className="subtle-note">등록한 안내문이 없습니다. 동의 근거와 광고성 정보 동의에는 안내문이 필요합니다.</p>}
  <form className="form-stack" onSubmit={e=>{e.preventDefault();void register()}}><fieldset disabled={locked} className="form-stack"><legend>새 안내문 등록</legend>
   <div className="form-two"><label className="field"><span>버전 이름</span><Input required maxLength={20} value={f.versionLabel} placeholder="예: 2026-1" onChange={e=>setF({...f,versionLabel:e.target.value})}/></label>
    <label className="field"><span>개인정보처리자 이름</span><Input required maxLength={100} value={f.controllerName} placeholder="예: 가상 가맹본부" onChange={e=>setF({...f,controllerName:e.target.value})}/></label></div>
   <label className="field"><span>안내문 본문</span><Textarea required rows={6} maxLength={20000} value={f.text} onChange={e=>setF({...f,text:e.target.value})}/></label>
   <label className="field"><span>수탁자 이름 (한 줄에 하나, 선택)</span><Textarea rows={2} value={f.processors} placeholder="예: 가상 호스팅사" onChange={e=>setF({...f,processors:e.target.value})}/></label>
   <div className="form-actions"><Button type="submit">안내문 등록</Button></div>
  </fieldset></form>
 </Section>;
}

const REASON_LABELS={...BACKDATE_REASON_LABELS,...CORRECTION_REASON_LABELS,...REGISTRY_AMEND_REASON_LABELS,reactivate:'다시 사용',subject_request:'정보주체 요청'};
// 감사 기록: 최근 100건. 누가(역할)·언제·무엇을·몇 건·어떤 항목 이름·목적만 보인다. 값은 기록에도 화면에도 없다.
function auditDetail(a:AuditRow){
 return [a.fields?.length?'항목 '+a.fields.map(f=>labelOf(CONTACT_FIELD_LABELS,f)).join('·'):null,a.purpose?'목적 '+labelOf({...REVEAL_PURPOSE_LABELS,...EXPORT_PURPOSE_LABELS},a.purpose):null,
  a.contactMode?(a.contactMode==='full'?'원문 포함':'가린 값'):null,typeof a.count==='number'?`${a.count}건`:null,
  a.counts?`파기 ${a.counts.leads} · 키 ${a.counts.keys} · 감사 ${a.counts.audits} · 남음 ${a.counts.remaining}`:null,a.trigger?({board_open:'목록 열기',manual:'직접 실행',inline:'요청 중'} as Record<string,string>)[a.trigger]??a.trigger:null,
  a.changedFields?.length?'바뀐 항목 '+a.changedFields.join('·'):null,a.reasonCode?'사유 '+labelOf(REASON_LABELS,a.reasonCode):null].filter(Boolean).join(' · ');
}
function AuditSection({brandId,refresh}:{brandId:string;refresh:unknown}){
 const [rows,setRows]=useState<AuditRow[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();franchiseGet<{audit:AuditRow[]}>({view:'audit',brandId},c.signal).then(d=>{if(!c.signal.aborted)setRows(d.audit.slice(0,100))},e=>{if(!c.signal.aborted)setError(messageOf(e))});return ()=>c.abort()},[brandId,refresh]);
 return <Section title="감사 기록" note="최근 100건입니다. 연락처 값은 기록하지 않습니다.">
  {error&&<p className="form-error" role="alert">{error}</p>}
  {rows===null?!error&&<p role="status">불러오고 있습니다.</p>:rows.length?<div className="ledger-table-wrap"><table className="ledger-table franchise-table"><caption className="sr-only">가맹 감사 기록</caption><thead><tr><th>시각</th><th>역할</th><th>작업</th><th>내용</th></tr></thead>
   <tbody>{rows.map(a=><tr key={a.id}><td>{kst(a.at)}</td><td>{roleLabel(a.actor.role)}</td><td>{labelOf(AUDIT_ACTION_LABELS,a.action)}</td><td>{auditDetail(a)||'-'}</td></tr>)}</tbody></table></div>:<p className="subtle-note">감사 기록이 없습니다.</p>}
  <Disclaimer/>
 </Section>;
}
