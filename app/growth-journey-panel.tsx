'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {emptyJourneyInput,type JourneyInput,type JourneyObservation} from '@/lib/growth-journey';
import styles from './growth-panel.module.css';

type Reference={id:string;version:number;input:{title?:string;offerId?:string;offerVersion?:number}};
type Blocker={id:string;version:number;input:JourneyInput;assessment:{missing:string[];comparison:{status:'not_measured'|'held'|'observed';reasons:string[];conversionDeltaPp:number|null;refundDeltaPp:number|null;profitDelta:number|null};mayExecute:false;causalStatus:'not_measured'}};
type View={blockers:Blocker[];offers:Reference[];missions:Reference[];campaignVersion:number;canEdit:boolean;mayExecute:false};
const stages:readonly [JourneyInput['stage'],string][]=[['inflow','유입'],['click','클릭'],['product','상품'],['cart','장바구니'],['checkout','결제'],['delivery','배송']];
const textFields:readonly {key:'hypothesis'|'alternativeExplanation'|'segment'|'denominatorDefinition'|'action'|'assignee'|'factEvidence'|'handoffReason';label:string}[]=[
 {key:'hypothesis',label:'병목 가설'},{key:'alternativeExplanation',label:'다른 설명·교란 요인'},{key:'segment',label:'고객 집단 정의'},
 {key:'denominatorDefinition',label:'분모 정의·집계 기준'},{key:'action',label:'개선 조치'},{key:'assignee',label:'담당 역할'},
 {key:'factEvidence',label:'병목 사실 근거'},{key:'handoffReason',label:'인계 사유·조건'},
];
const observationNumbers:readonly {key:'delayHours'|'denominator'|'conversions'|'paidOrders'|'refundedOrders'|'contributionProfit';label:string;negative?:boolean}[]=[
 {key:'delayHours',label:'관측 지연 (시간)'},{key:'denominator',label:'분모 수'},{key:'conversions',label:'전환 수'},
 {key:'paidOrders',label:'결제 주문 수'},{key:'refundedOrders',label:'환불 주문 수'},{key:'contributionProfit',label:'공헌이익 (원)',negative:true},
];
async function request(init:RequestInit,campaignId:string):Promise<View>{
 const response=await fetch(`/api/growth/journey${init.method==='POST'?'':`?campaignId=${encodeURIComponent(campaignId)}`}`,{...init,cache:'no-store'});
 const raw:unknown=await response.json();
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('구매 병목 응답을 확인하지 못했습니다.');
 const data=raw as Record<string,unknown>;
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'구매 병목 요청에 실패했습니다.');
 if(!['blockers','offers','missions'].every(key=>Array.isArray(data[key]))||typeof data.campaignVersion!=='number'||typeof data.canEdit!=='boolean')throw new Error('구매 병목 응답을 확인하지 못했습니다.');
 return data as unknown as View;
}
function ObservationEditor({label,value,onChange}:{label:string;value:JourneyObservation;onChange:(patch:Partial<JourneyObservation>)=>void}){
 return <details className={styles.wide}><summary>{label} 관측</summary><p className={styles.note}>확인일은 한국 시간 00:00 기준입니다. 관측 종료일 전체와 보고 지연이 지난 날짜를 기록하세요.</p><fieldset className={styles.references}><legend>{label} 관측 입력</legend><div className={styles.form}>
  {([['windowStart','관측 시작일'],['windowEnd','관측 종료일'],['observedAt','확인일']] as const).map(([key,name])=><label className={styles.field} key={key}>{name}<input type="date" value={value[key]} onChange={e=>onChange({[key]:e.target.value})}/></label>)}
  <label className={styles.field}>추적 상태<select value={value.tracking} onChange={e=>onChange({tracking:e.target.value as JourneyObservation['tracking']})}><option value="unknown">미확인</option><option value="reliable">신뢰 가능</option><option value="broken">추적 오류</option></select></label>
  {observationNumbers.map(field=><label className={styles.field} key={field.key}>{field.label}<input type="number" min={field.negative?undefined:0} step={1} value={value[field.key]??''} onChange={e=>onChange({[field.key]:e.target.value===''?null:Number(e.target.value)})}/></label>)}
  <label className={styles.wide}>관측 근거<textarea rows={3} maxLength={2000} value={value.evidence} onChange={e=>onChange({evidence:e.target.value})}/></label>
  <label className={styles.wide}>공개 출처 URL (줄마다 하나 · 쿼리·해시 제외)<textarea rows={3} value={value.sourceUrls.join('\n')} onChange={e=>onChange({sourceUrls:e.target.value.split('\n')})}/></label>
 </div></fieldset></details>;
}
function Assessment({row}:{row:Blocker}){
 const comparison=row.assessment.comparison;
 const difference=(value:number|null,unit:string)=>value===null?'미측정':`${value.toLocaleString('ko-KR',{maximumFractionDigits:4})}${unit}`;
 return <div className={styles.readiness} aria-label="구매 병목 평가"><p>비교 상태: {comparison.status==='observed'?'관측 차이 확인':comparison.status==='held'?'비교 보류':'미측정'}</p>
  <p>전환율 차이: {difference(comparison.conversionDeltaPp,'%p')} · 환불률 차이: {difference(comparison.refundDeltaPp,'%p')} · 공헌이익 차이: {difference(comparison.profitDelta,'원')}</p>
  <p>관측 차이이며 인과효과 미검증입니다. 자동 해결·확대 판정을 하지 않습니다.</p>
  {!!row.assessment.missing.length&&<><strong>보완할 항목</strong><ul>{row.assessment.missing.map((reason,i)=><li key={i}>{reason}</li>)}</ul></>}
  {!!comparison.reasons.length&&<><strong>비교 조건·한계</strong><ul>{comparison.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul></>}
 </div>;
}
export function GrowthJourneyPanel({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[draft,setDraft]=useState<JourneyInput>(()=>emptyJourneyInput());
 const [identity,setIdentity]=useState(()=>({id:crypto.randomUUID() as string,version:0}));
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),pending=useRef<AbortController|null>(null),read=useRef<AbortController|null>(null);
 const load=useCallback(async(signal:AbortSignal)=>{
  setLoading(true);setError('');
  try{const next=await request({signal},campaignId);if(!signal.aborted)setView(next);}
  catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:'병목 기록을 불러오지 못했습니다.');}
  finally{if(!signal.aborted)setLoading(false);}
 },[campaignId]);
 useEffect(()=>{mounted.current=true;const c=new AbortController();read.current=c;void Promise.resolve().then(()=>{if(!c.signal.aborted)void load(c.signal);});return()=>{mounted.current=false;read.current?.abort();pending.current?.abort();};},[load]);
 function reload(){read.current?.abort();const c=new AbortController();read.current=c;void load(c.signal);}
 function change(patch:Partial<JourneyInput>){setDraft(previous=>({...previous,...patch}));setDirty(true);setMessage('');}
 function pick(row?:Blocker){setIdentity({id:row?.id??crypto.randomUUID(),version:row?.version??0});setDraft(row?{...row.input,before:{...row.input.before,sourceUrls:[...row.input.before.sourceUrls]},after:{...row.input.after,sourceUrls:[...row.input.after.sourceUrls]}}:emptyJourneyInput());setDirty(false);setError('');setMessage('');}
 async function save(){
  if(!view||pending.current)return;
  const c=new AbortController();pending.current=c;setBusy(true);setError('');setMessage('');read.current?.abort();setLoading(false);
  const clean=(observation:JourneyObservation)=>({...observation,sourceUrls:observation.sourceUrls.map(v=>v.trim()).filter(Boolean)});
  const input={...draft,before:clean(draft.before),after:clean(draft.after)};
  try{const next=await request({method:'POST',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({action:'save_blocker',campaignId,campaignVersion:view.campaignVersion,id:identity.id,expectedVersion:identity.version,input})},campaignId);
   if(!mounted.current||c.signal.aborted)return;
   const saved=next.blockers.find(row=>row.id===identity.id);
   if(!saved)throw new Error('저장 응답에서 구매 병목을 확인하지 못했습니다. 새로고침해 확인하세요.');
   setView(next);setIdentity({id:saved.id,version:saved.version});setDraft(saved.input);setDirty(false);setMessage('구매 병목을 저장했습니다. 관측 차이의 인과효과는 미검증입니다.');
  }catch(e){if(mounted.current&&!c.signal.aborted)setError(`${e instanceof Error?e.message:'저장하지 못했습니다.'} 입력은 보존했습니다. 충돌이면 새로고침 후 최신 기록을 검토하세요.`);}
  finally{pending.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false);}
 }
 const selected=view?.blockers.find(row=>row.id===identity.id),stale=!!selected&&selected.version!==identity.version;
 const offer=view?.offers.find(row=>row.id===draft.offerId),mission=view?.missions.find(row=>row.id===draft.missionId),locked=busy||!view?.canEdit;
 return <section className={styles.panel} aria-label="구매 병목"><header className={styles.header}><div><h3>구매 병목</h3><p>유입부터 배송까지 병목 가설과 개선 전후 관측을 기록합니다.</p></div><button type="button" onClick={reload} disabled={loading||busy}>병목 기록 새로고침</button></header>
  <p className={styles.note}>직접 식별정보·비공개 접근 URL을 입력하지 마세요. 담당자는 이름 대신 역할로 기록합니다. 날짜는 한국 시간이며 관측 종료일을 포함합니다. 숫자 빈칸은 미확인, 0은 실제 관측값입니다. 공헌이익은 음수를 기록할 수 있습니다.</p>
  {loading&&<p role="status">병목 기록을 불러오고 있습니다.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}
  {view&&<div className={styles.workspace}><aside className={styles.list} aria-label="구매 병목 목록"><button type="button" disabled={locked} onClick={()=>pick()}>새 구매 병목</button>{!view.blockers.length&&<p>저장된 구매 병목이 없습니다.</p>}{view.blockers.map(row=><button key={row.id} type="button" aria-pressed={row.id===identity.id} disabled={busy} onClick={()=>pick(row)}><strong>{row.input.title||'제목 없는 초안'}</strong><span>v{row.version} · {stages.find(([id])=>id===row.input.stage)?.[1]}</span></button>)}</aside>
   <div className={styles.editor}><h4>{identity.version?`구매 병목 편집 · v${identity.version}`:'새 구매 병목'}</h4>{!view.canEdit&&<p className={styles.note}>조회 전용입니다.</p>}
    {stale&&<div className={styles.error}>서버 기록이 v{selected.version}로 바뀌었습니다. 최신 기록과 현재 입력을 비교하고 저장 기준을 선택하세요.<details><summary>최신 구매 병목 보기</summary><pre>{JSON.stringify(selected.input,null,2)}</pre></details><button type="button" disabled={locked} onClick={()=>{setIdentity({id:selected.id,version:selected.version});setError('');setMessage('현재 입력을 유지했습니다. 최신 기록 위에 새 버전으로 저장합니다.');}}>현재 입력 유지 · 최신 버전 기준 사용</button><button type="button" disabled={busy} onClick={()=>pick(selected)}>서버 기록으로 입력 교체</button></div>}
    <form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={locked} className={styles.form}><legend className={styles.srOnly}>구매 병목 입력</legend>
     <label className={styles.field}>병목 제목<input maxLength={200} value={draft.title} onChange={e=>change({title:e.target.value})}/></label>
     <label className={styles.field}>구매 단계<select value={draft.stage} onChange={e=>change({stage:e.target.value as JourneyInput['stage']})}>{stages.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
     {textFields.map(field=><label className={styles.wide} key={field.key}>{field.label}<textarea rows={2} maxLength={2000} value={draft[field.key]} onChange={e=>change({[field.key]:e.target.value})}/></label>)}
     <label className={styles.field}>채널<select value={draft.channel} onChange={e=>change({channel:e.target.value as JourneyInput['channel']})}><option value="storefront">자사몰</option><option value="organic">자연 유입</option><option value="meta">Meta 광고</option><option value="manual">수동 운영</option></select></label>
     <label className={styles.field}>기기<select value={draft.device} onChange={e=>change({device:e.target.value as JourneyInput['device']})}><option value="all">전체</option><option value="mobile">모바일</option><option value="desktop">데스크톱</option></select></label>
     <label className={styles.field}>분모 단위<select value={draft.denominatorUnit} onChange={e=>change({denominatorUnit:e.target.value as JourneyInput['denominatorUnit']})}><option value="visitor">방문자</option><option value="session">세션</option><option value="order">주문</option></select></label>
     {([['dueAt','조치 기한'],['appliedAt','조치 적용일']] as const).map(([key,label])=><label className={styles.field} key={key}>{label}<input type="date" value={draft[key]} onChange={e=>change({[key]:e.target.value})}/></label>)}
     <div className={styles.field}><label>연결 판매 오퍼<select value={draft.offerId} onChange={e=>change({offerId:e.target.value,offerVersion:view.offers.find(row=>row.id===e.target.value)?.version??0})}><option value="">선택하세요</option>{draft.offerId&&!offer&&<option value={draft.offerId}>연결 오퍼 없음</option>}{view.offers.map(row=><option key={row.id} value={row.id}>{row.input.title||row.id} · v{row.version}</option>)}</select></label>{offer&&<p>저장 기준 v{draft.offerVersion}</p>}{offer&&offer.version!==draft.offerVersion&&<button type="button" onClick={()=>change({offerVersion:offer.version})}>최신 오퍼 연결 (v{offer.version})</button>}</div>
     <div className={styles.field}><label>연결 판매 미션<select value={draft.missionId} onChange={e=>change({missionId:e.target.value,missionVersion:view.missions.find(row=>row.id===e.target.value)?.version??0})}><option value="">선택하세요</option>{draft.missionId&&!mission&&<option value={draft.missionId}>연결 미션 없음</option>}{view.missions.map(row=><option key={row.id} value={row.id}>{row.input.title||row.id} · v{row.version}</option>)}</select></label>{mission&&<p>저장 기준 v{draft.missionVersion}</p>}{mission&&mission.version!==draft.missionVersion&&<button type="button" onClick={()=>change({missionVersion:mission.version})}>최신 미션 연결 (v{mission.version})</button>}</div>
     <ObservationEditor label="개선 전" value={draft.before} onChange={patch=>change({before:{...draft.before,...patch}})}/><ObservationEditor label="개선 후" value={draft.after} onChange={patch=>change({after:{...draft.after,...patch}})}/>
    </fieldset>{view.canEdit&&<button type="submit" className={styles.primary} disabled={locked||stale}>{busy?'저장 중…':'구매 병목 저장'}</button>}</form>
    {dirty&&<p className={styles.note}>저장하지 않은 입력이 있습니다. 아래 평가는 마지막 서버 저장 기준입니다.</p>}
    {selected?<Assessment row={selected}/>:<p className={styles.note}>초안을 저장하면 관측 비교의 보완 조건을 확인합니다. 자동 해결·외부 실행·확대를 수행하지 않습니다.</p>}
   </div></div>}
 </section>;
}
