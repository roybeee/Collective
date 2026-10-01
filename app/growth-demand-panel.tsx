'use client';

import {RecordView} from '@/components/app/record-view';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import {emptyDemandInput,emptyDemandStep,type DemandInput,type DemandStep} from '@/lib/growth-demand';
import styles from './growth-panel.module.css';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';

type Reference={id:string;version:number;input:{title?:string;offerId?:string;offerVersion?:number}};
type Sequence={id:string;version:number;input:DemandInput;readiness:{missing:string[];mayExecute:false;plannedCost:number|null}};
type View={sequences:Sequence[];offers:Reference[];missions:Reference[];campaignVersion:number;canEdit:boolean;mayExecute:false};
type TextKey='message'|'useScene'|'creativeBrief'|'audience'|'purchaseUrl'|'rightsEvidence'|'partnerRole'|'partnerTerms'|'performanceEvidence'|'performanceNote';
const textFields:readonly {key:TextKey;label:string;long?:boolean}[]=[
 {key:'message',label:'전달 메시지',long:true},{key:'useScene',label:'사용 장면',long:true},
 {key:'creativeBrief',label:'콘텐츠 제작 지시',long:true},{key:'audience',label:'대상 고객 가설'},
 {key:'purchaseUrl',label:'구매 URL (공개 HTTPS · 쿼리·해시 제외)'},
 {key:'rightsEvidence',label:'사용 권리 확인 근거'}, {key:'partnerRole',label:'파트너 담당 역할'},
 {key:'partnerTerms',label:'협업·비용 조건',long:true},{key:'performanceEvidence',label:'성과 관측 근거'},
 {key:'performanceNote',label:'관측 내용·한계',long:true},
];
async function request(init:RequestInit,campaignId:string):Promise<View>{
 const response=await fetch(`/api/growth/demand${init.method==='POST'?'':`?campaignId=${encodeURIComponent(campaignId)}`}`,{...init,cache:'no-store'});
 const raw:unknown=await response.json();
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('수요 시퀀스 응답을 확인하지 못했습니다.');
 const data=raw as Record<string,unknown>;
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'수요 시퀀스 요청에 실패했습니다.');
 if(!['sequences','offers','missions'].every(key=>Array.isArray(data[key]))||typeof data.campaignVersion!=='number'||typeof data.canEdit!=='boolean')throw new Error('수요 시퀀스 응답을 확인하지 못했습니다.');
 return data as unknown as View;
}
function StepEditor({step,index,total,onChange,onMove,onRemove}:{step:DemandStep;index:number;total:number;onChange:(patch:Partial<DemandStep>)=>void;onMove:(delta:number)=>void;onRemove:()=>void}){
 return <fieldset className={styles.references}><legend>수요 단계 {index+1}</legend>
  <div className={styles.actions}><button type="button" disabled={index===0} onClick={()=>onMove(-1)}>위로</button><button type="button" disabled={index===total-1} onClick={()=>onMove(1)}>아래로</button><button type="button" onClick={onRemove}>단계 삭제</button></div>
  <div className={styles.form}>
   <label className={styles.field}>채널<select value={step.channel} onChange={e=>onChange({channel:e.target.value as DemandStep['channel']})}><option value="storefront">자사몰</option><option value="organic">자연 유입</option><option value="meta">Meta 광고</option><option value="manual">수동 운영</option></select></label>
   <label className={styles.field}>노출 방식<select value={step.placement} onChange={e=>onChange({placement:e.target.value as DemandStep['placement']})}><option value="owned">자체 채널</option><option value="ad">광고</option><option value="creator">크리에이터</option><option value="partner">파트너</option></select></label>
   {textFields.map(field=><label key={field.key} className={field.long?styles.wide:styles.field}>{field.label}{field.long?<textarea rows={3} maxLength={2000} value={step[field.key]} onChange={e=>onChange({[field.key]:e.target.value})}/>:<input maxLength={2000} value={step[field.key]} onChange={e=>onChange({[field.key]:e.target.value})}/>}</label>)}
   <label className={styles.wide}>검색어 (최대 30개 · 줄마다 하나)<textarea rows={3} value={step.keywords.join('\n')} onChange={e=>onChange({keywords:e.target.value.split('\n')})}/></label>
   <label className={styles.wide}>공개 출처 URL (최대 20개 · 줄마다 하나 · 쿼리·해시 제외)<textarea rows={3} value={step.sourceUrls.join('\n')} onChange={e=>onChange({sourceUrls:e.target.value.split('\n')})}/></label>
   <label className={styles.field}>권리 확인 상태<select value={step.rightsStatus} onChange={e=>onChange({rightsStatus:e.target.value as DemandStep['rightsStatus']})}><option value="unknown">미확인</option><option value="confirmed">확인됨</option><option value="denied">사용 불가</option></select></label>
   <label className={styles.field}>예상 비용 (원 · 미확인은 빈칸)<input type="number" min={0} step={1} value={step.plannedCost??''} onChange={e=>onChange({plannedCost:e.target.value===''?null:Number(e.target.value)})}/></label>
   <label className={styles.field}>성과 상태<select value={step.performanceStatus} onChange={e=>onChange({performanceStatus:e.target.value as DemandStep['performanceStatus']})}><option value="not_measured">미측정 · 가설</option><option value="observed">운영자 관측 기록</option></select></label>
   <label className={styles.check}><input type="checkbox" checked={step.authenticityConfirmed} onChange={e=>onChange({authenticityConfirmed:e.target.checked})}/><span>가짜 참여·후기 없는 콘텐츠 계획임을 확인했습니다.</span></label>
   <p className={`${styles.note} ${styles.wide}`}>이 확인은 운영자 검토 기록입니다. 모든 조작 문구의 자동 판별이 완료되었다는 뜻은 아니며, 외부 실행 전에 채널 정책을 다시 검토해야 합니다.</p>
  </div>
 </fieldset>;
}
export function GrowthDemandPanel({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[draft,setDraft]=useState<DemandInput>(()=>emptyDemandInput());
 const [identity,setIdentity]=useState(()=>({id:crypto.randomUUID() as string,version:0}));
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),pending=useRef<AbortController|null>(null),read=useRef<AbortController|null>(null);
 const load=useCallback(async(signal:AbortSignal)=>{
  setLoading(true);setError('');
  try{const next=await request({signal},campaignId);if(!signal.aborted)setView(next);}
  catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:'수요 기록을 불러오지 못했습니다.');}
  finally{if(!signal.aborted)setLoading(false);}
 },[campaignId]);
 useEffect(()=>{mounted.current=true;const c=new AbortController();read.current=c;void Promise.resolve().then(()=>{if(!c.signal.aborted)void load(c.signal);});return()=>{mounted.current=false;read.current?.abort();pending.current?.abort();};},[load]);
 function reload(){read.current?.abort();const c=new AbortController();read.current=c;void load(c.signal);}
 function change(patch:Partial<DemandInput>){setDraft(previous=>({...previous,...patch}));setDirty(true);setMessage('');}
 function pick(row?:Sequence){setIdentity({id:row?.id??crypto.randomUUID(),version:row?.version??0});setDraft(row?{...row.input,steps:row.input.steps.map(s=>({...s}))}:emptyDemandInput());setDirty(false);setError('');setMessage('');}
 function move(index:number,delta:number){const target=index+delta;if(target<0||target>=draft.steps.length)return;change({steps:draft.steps.map((s,i)=>i===index?draft.steps[target]:i===target?draft.steps[index]:s)});}
 async function save(){
  if(!view||pending.current)return;
  const c=new AbortController();pending.current=c;setBusy(true);setError('');setMessage('');
  read.current?.abort();setLoading(false);
  const input={...draft,steps:draft.steps.map(step=>({...step,keywords:step.keywords.map(v=>v.trim()).filter(Boolean),sourceUrls:step.sourceUrls.map(v=>v.trim()).filter(Boolean)}))};
  try{const next=await request({method:'POST',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({action:'save_sequence',campaignId,campaignVersion:view.campaignVersion,id:identity.id,expectedVersion:identity.version,input})},campaignId);
   if(!mounted.current||c.signal.aborted)return;
   const saved=next.sequences.find(row=>row.id===identity.id);
   if(!saved)throw new Error('저장 응답에서 수요 시퀀스를 확인하지 못했습니다. 새로고침해 확인하세요.');
   setView(next);
   if(saved){setIdentity({id:saved.id,version:saved.version});setDraft(saved.input);setDirty(false);setMessage('수요 시퀀스를 저장했습니다. 외부 집행은 수행하지 않았습니다.');}
  }catch(e){if(mounted.current&&!c.signal.aborted)setError(`${e instanceof Error?e.message:'저장하지 못했습니다.'} 입력은 보존했습니다. 충돌이면 새로고침 후 최신 기록을 검토하세요.`);}
  finally{pending.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false);}
 }
 const selected=view?.sequences.find(row=>row.id===identity.id),stale=!!selected&&selected.version!==identity.version;
 const offer=view?.offers.find(row=>row.id===draft.offerId),mission=view?.missions.find(row=>row.id===draft.missionId);
 const locked=busy||!view?.canEdit;
 return <section className={styles.panel} aria-label="수요 시퀀스"><header className={styles.header}><div><h3>수요 시퀀스</h3><p>메시지·콘텐츠·검색어·협업을 구매 경로 순서로 연결합니다.</p></div><button aria-label="수요 기록 새로고침" type="button" onClick={reload} disabled={loading||busy}>새로고침</button></header>
  <Note className={styles.note}>이 기록은 계획과 운영자 관측입니다. 저장으로 광고·게시물·고객 메시지를 발송하지 않습니다. 직접 식별정보와 비공개 접근 URL을 입력하지 마세요.</Note>
  {loading&&<ScreenSkeleton label="수요 기록을 불러오고 있습니다." rows={2}/>}{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}
  {view&&<div className={styles.workspace}><div role="group" className={styles.list} aria-label="수요 시퀀스 목록"><button type="button" disabled={locked} onClick={()=>pick()}>새 수요 시퀀스</button>{!view.sequences.length&&<p>저장된 수요 시퀀스가 없습니다.</p>}{view.sequences.map(row=><button key={row.id} type="button" aria-pressed={row.id===identity.id} disabled={busy} onClick={()=>pick(row)}><strong>{row.input.title||'제목 없는 초안'}</strong><span>v{row.version} · {row.input.steps.length}단계</span></button>)}</div>
   <div className={styles.editor}><h4>{identity.version?`수요 시퀀스 편집 · v${identity.version}`:'새 수요 시퀀스'}</h4>{!view.canEdit&&<p className={styles.note}>조회 전용입니다.</p>}
    {stale&&<div className={styles.error}>서버 기록이 v{selected.version}로 바뀌었습니다. 최신 기록과 현재 입력을 비교하고 저장 기준을 선택하세요.<details><summary>최신 수요 시퀀스 보기</summary><RecordView label="최신 수요 시퀀스 보기" value={selected.input}/></details><button type="button" disabled={busy||!view.canEdit} onClick={()=>{setIdentity({id:selected.id,version:selected.version});setError('');setMessage('현재 입력을 유지했습니다. 최신 기록 위에 새 버전으로 저장합니다.');}}>현재 입력 유지 · 최신 버전 기준 사용</button><button type="button" disabled={busy} onClick={()=>pick(selected)}>서버 기록으로 입력 교체</button></div>}
    <form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={locked} className={styles.form}><legend className={styles.srOnly}>수요 시퀀스 입력</legend>
     <label className={styles.field}>시퀀스 제목<input maxLength={200} value={draft.title} onChange={e=>change({title:e.target.value})}/></label>
     <label className={styles.wide}>검증할 수요 가설·목표<textarea rows={3} maxLength={2000} value={draft.objective} onChange={e=>change({objective:e.target.value})}/></label>
     <div className={styles.field}><label>연결 판매 오퍼<select value={draft.offerId} onChange={e=>change({offerId:e.target.value,offerVersion:view.offers.find(row=>row.id===e.target.value)?.version??0})}><option value="">선택하세요</option>{draft.offerId&&!offer&&<option value={draft.offerId}>연결 오퍼 없음</option>}{view.offers.map(row=><option key={row.id} value={row.id}>{row.input.title||row.id} · v{row.version}</option>)}</select></label>{offer&&offer.version!==draft.offerVersion&&<button type="button" onClick={()=>change({offerVersion:offer.version})}>최신 오퍼 연결 (v{offer.version})</button>}</div>
     <div className={styles.field}><label>연결 판매 미션<select value={draft.missionId} onChange={e=>change({missionId:e.target.value,missionVersion:view.missions.find(row=>row.id===e.target.value)?.version??0})}><option value="">선택하세요</option>{draft.missionId&&!mission&&<option value={draft.missionId}>연결 미션 없음</option>}{view.missions.map(row=><option key={row.id} value={row.id}>{row.input.title||row.id} · v{row.version}</option>)}</select></label>{mission&&mission.version!==draft.missionVersion&&<button type="button" onClick={()=>change({missionVersion:mission.version})}>최신 미션 연결 (v{mission.version})</button>}</div>
     {draft.steps.map((step,index)=><StepEditor key={step.id} step={step} index={index} total={draft.steps.length} onChange={patch=>change({steps:draft.steps.map((s,i)=>i===index?{...s,...patch}:s)})} onMove={delta=>move(index,delta)} onRemove={()=>change({steps:draft.steps.filter((_,i)=>i!==index)})}/>)}
     <button type="button" disabled={draft.steps.length>=12} onClick={()=>change({steps:[...draft.steps,{...emptyDemandStep(),id:crypto.randomUUID()}]})}>수요 단계 추가</button>
    </fieldset>{view.canEdit&&<button type="submit" className={styles.primary} disabled={locked||stale}>{busy?'저장 중…':'수요 시퀀스 저장'}</button>}</form>
    {dirty&&<p className={styles.note}>저장하지 않은 입력이 있습니다. 아래 준비 상태는 마지막 서버 저장 기준입니다.</p>}
    {selected?<div className={styles.readiness} aria-label="수요 시퀀스 준비 상태"><p>예상 비용 합계: {selected.readiness.plannedCost===null?'미확인':`${selected.readiness.plannedCost.toLocaleString('ko-KR')}원`} · 실제 지출·매출이 아닙니다.</p>{selected.readiness.missing.length?<><strong>보완할 항목</strong><ul>{selected.readiness.missing.map((reason,i)=><li key={i}>{reason}</li>)}</ul></>:<p>준비 항목이 채워졌습니다. 수요 검증·외부 집행 승인을 뜻하지 않습니다.</p>}</div>:<p className={styles.note}>초안을 저장하면 연결 자료와 단계별 준비 상태를 확인합니다.</p>}
   </div></div>}
 </section>;
}
