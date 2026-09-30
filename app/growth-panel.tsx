'use client';

import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {emptySignalInput,emptyNeedInput} from '@/lib/growth-market';
import {emptyCatalogInput,emptyOfferInput} from '@/lib/growth-catalog';
import {emptyMissionInput} from '@/lib/growth-mission';
import styles from './growth-panel.module.css';
import {GrowthBusinessOverview,type GrowthBusinessView} from './growth-business-overview';
import {GrowthAuthorityPanel} from './growth-authority-panel';
import {GrowthOperationsPanel} from './growth-operations-panel';

type Entity='signal'|'need'|'catalog'|'offer'|'mission';
type Value=string|number|boolean|null|string[];
type Draft=Record<string,Value>;
type Entry={id:string;version:number;input:Draft;status?:string;readiness?:{missing:string[];unitContribution?:number|null};evidence?:{status:string;reason:string};receipt?:{status:string;reference:string;note:string;recordedAt:string}};
type View={signals:Entry[];needs:Entry[];catalogs:Entry[];offers:Entry[];missions:Entry[];facts:{id:string;key:string;value:string;version:number}[];business:GrowthBusinessView;campaignVersion:number;canEdit:boolean;mayExecute:false};
type Field={key:string;label:string;type?:'number'|'date'|'textarea'|'checkbox'|'select'|'refs';options?:readonly (readonly[string,string])[];source?:'signals'|'needs'|'catalogs'|'offers'|'facts';versionKey?:string;required?:boolean};
const tabs:readonly (readonly[Entity,string])[]=[['signal','시장 근거'],['need','고객·기회'],['catalog','상품'],['offer','판매 오퍼'],['mission','판매 미션']];
const listKeys={signal:'signals',need:'needs',catalog:'catalogs',offer:'offers',mission:'missions'} as const;
const statusLabels:Record<string,string>={draft:'초안',staged:'준비 요청됨',unknown:'결과 확인 중',failed:'실패 기록',observed:'관측 기록',cancelled:'취소됨'};
const fields:Record<Entity,Field[]>={
 signal:[{key:'title',label:'근거 제목',required:true},{key:'sourceUrl',label:'공개 출처 URL',required:true},{key:'observedAt',label:'관측 시각 (ISO 시간대 포함)',required:true},{key:'expiresAt',label:'근거 유효기한',type:'date',required:true},{key:'sourceType',label:'근거 유형',type:'select',options:[['market','시장'],['customer','고객'],['competitor','경쟁'],['operations','운영']]},{key:'summary',label:'관측 요약',type:'textarea',required:true},{key:'sampleSize',label:'표본 수 (미확인은 빈칸)',type:'number'}],
 need:[{key:'title',label:'니즈 가설 제목',required:true},{key:'situation',label:'발생 상황',type:'textarea'},{key:'desiredOutcome',label:'원하는 결과',type:'textarea'},{key:'alternative',label:'현재 대안',type:'textarea'},{key:'barrier',label:'구매 장애물',type:'textarea'},{key:'counterEvidence',label:'반례·반대 근거',type:'textarea'},{key:'signalIds',label:'연결할 시장 근거',type:'refs',source:'signals'},{key:'deadline',label:'니즈 검토 기한',type:'date'},{key:'nextAction',label:'다음 검증 행동',type:'textarea'},{key:'assignee',label:'검토 담당 역할'}],
 catalog:[{key:'sku',label:'SKU'},{key:'title',label:'상품명'},{key:'price',label:'판매 단가 (원)',type:'number'},{key:'unitCost',label:'단위원가 (원)',type:'number'},{key:'variableCost',label:'단위변동비 (원)',type:'number'},{key:'stock',label:'판매 가능 재고',type:'number'},{key:'taxBasis',label:'가격·비용 세금 기준',type:'select',options:[['unknown','미확인'],['included','세금 포함'],['excluded','세금 제외']]},{key:'fulfillment',label:'배송 조건',type:'textarea'},{key:'refunds',label:'반품 조건',type:'textarea'},{key:'rightsConfirmed',label:'판매 권리 확인',type:'checkbox'},{key:'factIds',label:'연결할 확정 사실',type:'refs',source:'facts'},{key:'validUntil',label:'상품 근거 유효기한',type:'date'}],
 offer:[{key:'title',label:'오퍼명'},{key:'catalogId',label:'연결 상품',type:'select',source:'catalogs',versionKey:'catalogVersion'},{key:'needId',label:'연결 니즈 가설',type:'select',source:'needs'},{key:'price',label:'오퍼 단가 (원)',type:'number'},{key:'quantity',label:'오퍼 수량',type:'number'},{key:'landingUrl',label:'구매 링크 (쿼리·해시 없는 공개 HTTPS)'},{key:'purchaseReason',label:'구매 이유',type:'textarea'},{key:'priceApproved',label:'오퍼 가격 승인 확인',type:'checkbox'}],
 mission:[{key:'title',label:'미션 제목',required:true},{key:'offerId',label:'연결 판매 오퍼',type:'select',source:'offers',versionKey:'offerVersion'},{key:'assignee',label:'실행 담당 역할'},{key:'deadline',label:'실행 기한',type:'date'},{key:'nextAction',label:'다음 실행 행동',type:'textarea'},{key:'channel',label:'판매 채널',type:'select',options:[['manual','수동 운영'],['storefront','자사몰'],['organic','자연 유입'],['meta','Meta 광고']]},{key:'budget',label:'탐색 예산 한도 (원)',type:'number'},{key:'lossLimit',label:'탐색 손실 한도 (원)',type:'number'},{key:'stopRule',label:'중단 기준',type:'textarea'},{key:'fulfillmentOwner',label:'배송·반품 담당 역할'}],
};
function empty(entity:Entity):Draft{
 if(entity==='signal')return {...emptySignalInput(),observedAt:new Date().toISOString()};
 if(entity==='need')return {...emptyNeedInput()};
 if(entity==='catalog')return {...emptyCatalogInput()};
 if(entity==='offer')return {...emptyOfferInput()};
 return {...emptyMissionInput()};
}
function label(entry:Entry){return String(entry.input.title||entry.input.sku||'제목 없는 초안');}
function options(field:Field,view:View):{id:string;label:string;version:number}[]{
 if(field.source==='facts')return view.facts.map(f=>({id:f.id,label:`${f.key}: ${f.value}`,version:f.version}));
 if(field.source)return view[field.source].map(r=>({id:r.id,label:label(r),version:r.version}));
 return (field.options??[]).map(([id,label])=>({id,label,version:0}));
}
function FieldInput({field,draft,view,onChange}:{field:Field;draft:Draft;view:View;onChange:(patch:Draft)=>void}){
 const value=draft[field.key],choices=options(field,view);
 if(field.type==='refs'){
  const selected=Array.isArray(value)?value:[],missing=selected.filter(id=>!choices.some(c=>c.id===id));
  return <fieldset className={styles.references}><legend>{field.label}</legend>{!choices.length&&<p>선택할 기록이 없습니다. 앞 단계에서 먼저 등록하세요.</p>}{choices.map(c=><label key={c.id} className={styles.check}><input type="checkbox" checked={selected.includes(c.id)} onChange={e=>onChange({[field.key]:e.target.checked?[...selected,c.id]:selected.filter(id=>id!==c.id)})}/><span>{c.label} · v{c.version}</span></label>)}{missing.map(id=><label key={id} className={styles.check}><input type="checkbox" checked onChange={()=>onChange({[field.key]:selected.filter(v=>v!==id)})}/><span>현재 사용할 수 없는 근거 · 연결 해제 필요</span></label>)}</fieldset>;
 }
 if(field.type==='checkbox')return <label className={styles.check}><input type="checkbox" checked={value===true} onChange={e=>onChange({[field.key]:e.target.checked})}/><span>{field.label}</span></label>;
 let control:ReactNode;
 if(field.type==='select')control=<select value={String(value??'')} onChange={e=>onChange({[field.key]:e.target.value,...(field.versionKey?{[field.versionKey]:choices.find(c=>c.id===e.target.value)?.version??0}:{})})}><option value="">선택하세요</option>{value&&!choices.some(c=>c.id===value)&&<option value={String(value)}>연결 대상 없음</option>}{choices.map(c=><option key={c.id} value={c.id}>{c.label}{field.source?` · v${c.version}`:''}</option>)}</select>;
 else if(field.type==='textarea')control=<textarea rows={3} maxLength={field.key==='summary'?4000:['nextAction','stopRule'].includes(field.key)&&'offerVersion' in draft?500:2000} value={String(value??'')} required={field.required} onChange={e=>onChange({[field.key]:e.target.value})}/>;
 else control=<input type={field.type==='number'?'number':field.type==='date'?'date':'text'} min={field.key==='quantity'?1:0} step={1} maxLength={field.key==='sourceUrl'||field.key==='landingUrl'?2000:500} value={typeof value==='number'?value:String(value??'')} required={field.required} onChange={e=>onChange({[field.key]:field.type==='number'?(e.target.value===''?null:Number(e.target.value)):e.target.value})}/>;
 const current=choices.find(c=>c.id===value),outdated=!!(field.versionKey&&current&&draft[field.versionKey]!==current.version);
 return <div className={field.type==='textarea'?styles.wide:styles.field}><label><span>{field.label}</span>{control}</label>{outdated&&<button type="button" className={styles.smallButton} onClick={()=>onChange({[field.versionKey!]:current!.version})}>최신 버전 연결 (v{current!.version})</button>}</div>;
}
function Readiness({entry}:{entry?:Entry}){
 if(!entry)return <p className={styles.note}>초안을 저장하면 서버가 출처와 연결 자료의 준비 상태를 확인합니다.</p>;
 return <div className={styles.readiness} aria-label="저장된 준비 상태">{entry.evidence&&<p>{entry.evidence.reason}</p>}{entry.readiness&&(entry.readiness.missing.length?<><strong>보완할 항목</strong><ul>{entry.readiness.missing.map((v,i)=><li key={`${v}-${i}`}>{v}</li>)}</ul></>:<p>필수 준비 항목이 채워졌습니다. 수요 검증이나 외부 집행 승인을 의미하지 않습니다.</p>)}{typeof entry.readiness?.unitContribution==='number'&&<p>입력값 기준 단위 공헌이익: {entry.readiness.unitContribution.toLocaleString('ko-KR')}원</p>}</div>;
}
async function request(url:string,init:RequestInit):Promise<View>{
 const response=await fetch(url,{...init,cache:'no-store'});
 const raw:unknown=await response.json();
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('서버 응답 형식을 확인하지 못했습니다. 다시 불러오세요.');
 const data=raw as Record<string,unknown>;
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'성장 기록 요청에 실패했습니다.');
 if(!data||!['signals','needs','catalogs','offers','missions','facts'].every(key=>Array.isArray(data[key]))||typeof data.campaignVersion!=='number'||typeof data.canEdit!=='boolean')throw new Error('서버 응답 형식을 확인하지 못했습니다. 다시 불러오세요.');
 return data as unknown as View;
}
export function GrowthPanel(props:{campaignId:string;onMeta?:()=>void}){return <GrowthWorkspace key={props.campaignId} {...props}/>;}
function GrowthWorkspace({campaignId,onMeta}:{campaignId:string;onMeta?:()=>void}){
 const [view,setView]=useState<View|null>(null),[tab,setTab]=useState<Entity>('signal'),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const controller=useRef<AbortController|null>(null);
 const load=useCallback(async(signal:AbortSignal)=>{
  setLoading(true);setError('');
  try{const next=await request(`/api/growth?campaignId=${encodeURIComponent(campaignId)}`,{signal});if(!signal.aborted)setView(next);}
  catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:'성장 기록을 불러오지 못했습니다.');}
  finally{if(!signal.aborted)setLoading(false);}
 },[campaignId]);
 useEffect(()=>{const c=new AbortController();controller.current=c;void Promise.resolve().then(()=>{if(!c.signal.aborted)void load(c.signal);});return()=>c.abort();},[load]);
 function reload(){controller.current?.abort();const c=new AbortController();controller.current=c;void load(c.signal);}
 useEffect(()=>()=>controller.current?.abort(),[]);
 return <section className={styles.panel} aria-label="성장2 판매 워크스페이스"><header className={styles.header}><div><h2>근거에서 판매 미션까지</h2><p>시장 근거 → 고객·기회 → 상품 → 판매 오퍼 → 판매 미션</p></div><button type="button" onClick={reload} disabled={loading}>새로고침</button></header><p className={styles.note}>고객 이름·전화번호·이메일 등 직접 식별정보를 입력하지 마세요. 담당자는 역할로 기록합니다. 이 화면의 준비 요청과 운영자 확인 기록은 자동 집행이나 실제 매출 증명이 아닙니다.</p>{onMeta&&<button type="button" className={styles.smallButton} onClick={onMeta}>Meta 광고 작업 열기</button>}{loading&&<p role="status">성장 기록을 불러오고 있습니다.</p>}{error&&<div role="alert" className={styles.error}>{error}<button type="button" onClick={reload}>다시 불러오기</button></div>}{view&&<><GrowthBusinessOverview business={view.business}/><details><summary>판매 위임·예산 한도</summary><GrowthAuthorityPanel campaignId={campaignId} missions={view.missions}/></details><details><summary>주문·재고·이행 운영</summary><GrowthOperationsPanel campaignId={campaignId} missions={view.missions} offers={view.offers} catalogs={view.catalogs}/></details>{!view.canEdit&&<p className={styles.note}>조회 전용입니다. 관리자 권한과 캠페인 상태에 따라 편집할 수 있습니다.</p>}<nav className={styles.tabs} aria-label="성장 작업 단계">{tabs.map(([id,name])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}>{name}</button>)}</nav><Editor key={tab} entity={tab} campaignId={campaignId} view={view} onView={setView}/></>}</section>;
}
function Editor({entity,campaignId,view,onView}:{entity:Entity;campaignId:string;view:View;onView:(view:View)=>void}){
 const [draft,setDraft]=useState<Draft>(()=>empty(entity)),[identity,setIdentity]=useState(()=>({id:crypto.randomUUID() as string,version:0}));
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[dirty,setDirty]=useState(false);
 const [receipt,setReceipt]=useState({status:'unknown',reference:'',note:''});
 const mounted=useRef(false),pending=useRef<AbortController|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.abort();};},[]);
 const rows=view[listKeys[entity]],selected=rows.find(r=>r.id===identity.id),name=tabs.find(([id])=>id===entity)![1];
 const locked=!view.canEdit||busy||(entity==='mission'&&!!selected&&selected.status!=='draft');
 function pick(row?:Entry){setIdentity({id:row?.id??crypto.randomUUID(),version:row?.version??0});setDraft(row?{...row.input}:empty(entity));setDirty(false);setError('');setMessage('');setReceipt({status:'unknown',reference:'',note:''});}
 function change(patch:Draft){setDraft(previous=>({...previous,...patch}));setDirty(true);setMessage('');}
 async function post(action:string,input:unknown){
  if(pending.current)return;
  const c=new AbortController();pending.current=c;setBusy(true);setError('');setMessage('');
  try{const next=await request('/api/growth',{method:'POST',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({action,campaignId,campaignVersion:view.campaignVersion,id:identity.id,expectedVersion:identity.version,input})});
   if(!mounted.current||c.signal.aborted)return;
   onView(next);const saved=next[listKeys[entity]].find(r=>r.id===identity.id);
   if(saved){setIdentity({id:saved.id,version:saved.version});setDraft({...saved.input});}setDirty(false);
   setMessage(action.startsWith('save_')?'서버에 저장했습니다.':action==='queue_mission'?'미션 준비 요청을 기록했습니다. 외부 집행은 수행하지 않았습니다.':'운영 기록을 저장했습니다.');
  }catch(e){if(mounted.current&&!c.signal.aborted)setError(`${e instanceof Error?e.message:'저장하지 못했습니다.'} 입력은 보존했습니다. 변경 충돌이면 새로고침 후 현재 입력을 유지한 채 최신 버전을 검토하세요.`);}
  finally{pending.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false);}
 }
 const stale=!!selected&&selected.version!==identity.version;
 return <div className={styles.workspace}><aside className={styles.list} aria-label={`${name} 기록 목록`}><button type="button" disabled={busy||!view.canEdit} onClick={()=>pick()}>새 {name}</button>{!rows.length&&<p>저장된 기록이 없습니다.</p>}{rows.map(row=><button type="button" key={row.id} aria-pressed={row.id===identity.id} disabled={busy} onClick={()=>pick(row)}><strong>{label(row)}</strong><span>v{row.version}{row.status?` · ${statusLabels[row.status]??row.status}`:''}</span></button>)}</aside><div className={styles.editor}><h3>{identity.version?`${name} 편집 · v${identity.version}`:`새 ${name}`}</h3>{entity==='need'&&<p className={styles.note}>고객·기회는 검증 전 가설입니다. 근거가 충분해도 확정 수요로 표시하지 않습니다.</p>}{entity==='signal'&&<p className={styles.note}>공개 출처를 수동 등록합니다. 고객 근거는 표본 20개 미만 또는 미확인일 때 준비를 막습니다.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{stale&&<div className={styles.error}>서버 기록이 v{selected.version}로 바뀌었습니다. 현재 입력과 최신 기록을 비교한 뒤 저장 기준을 선택하세요.<details><summary>서버의 최신 기록 보기</summary><pre>{JSON.stringify(selected.input,null,2)}</pre></details><button type="button" disabled={busy} onClick={()=>{setIdentity({id:selected.id,version:selected.version});setError('');setMessage('현재 입력은 유지했습니다. 저장하면 최신 기록 위에 새 버전으로 기록됩니다.');}}>현재 입력 유지 · 최신 버전 기준 사용</button><button type="button" disabled={busy} onClick={()=>pick(selected)}>서버 기록으로 입력 교체</button></div>}<form onSubmit={e=>{e.preventDefault();void post(`save_${entity}`,draft);}}><fieldset disabled={locked} className={styles.form}><legend className={styles.srOnly}>{name} 입력</legend>{fields[entity].map(field=><FieldInput key={field.key} field={field} draft={draft} view={view} onChange={change}/>)}</fieldset>{view.canEdit&&<button type="submit" className={styles.primary} disabled={locked||stale}>{busy?'저장 중…':`${name} 저장`}</button>}</form>{dirty&&<p className={styles.note}>저장하지 않은 입력이 있습니다. 아래 준비 상태는 마지막 서버 저장 기준입니다.</p>}<Readiness entry={selected}/>{entity==='mission'&&selected&&<section className={styles.mission}><h4>운영자 확인 기록</h4><p>상태: {statusLabels[selected.status??'draft']??selected.status}. 준비 요청은 외부 채널에 주문·광고를 전송하지 않습니다.</p>{selected.receipt&&<blockquote><strong>{statusLabels[selected.receipt.status]}</strong><p>{selected.receipt.reference}</p><p>{selected.receipt.note}</p><small>{selected.receipt.recordedAt}</small></blockquote>}{view.canEdit&&<><div className={styles.actions}><button type="button" disabled={busy||dirty||stale||selected.status!=='draft'||!!selected.readiness?.missing.length} onClick={()=>void post('queue_mission',null)}>미션 준비 요청</button><button type="button" disabled={busy||dirty||stale||!['draft','staged'].includes(selected.status??'')} onClick={()=>void post('cancel_mission',null)}>미션 취소</button></div>{['staged','unknown'].includes(selected.status??'')&&<form onSubmit={e=>{e.preventDefault();void post('record_receipt',receipt);}}><fieldset disabled={busy||stale} className={styles.receipt}><legend>운영자가 확인한 상태</legend><label>결과 상태<select value={receipt.status} onChange={e=>setReceipt(previous=>({...previous,status:e.target.value}))}><option value="unknown">결과 불명 · 재확인 필요</option><option value="failed">실패 관측</option><option value="observed">결과 관측</option></select></label><label>증빙 참조 (개인정보 제외)<input required maxLength={200} value={receipt.reference} onChange={e=>setReceipt(previous=>({...previous,reference:e.target.value}))}/></label><label>확인 내용<textarea required maxLength={1000} rows={3} value={receipt.note} onChange={e=>setReceipt(previous=>({...previous,note:e.target.value}))}/></label><button type="submit">운영자 확인 기록 저장</button></fieldset></form>}</>}</section>}</div></div>;
}
