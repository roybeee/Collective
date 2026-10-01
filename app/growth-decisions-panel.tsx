'use client';

import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import {emptyDecisionInput,emptyLessonInput,type DecisionInput,type LessonInput} from '@/lib/growth-decisions';
import styles from './growth-panel.module.css';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';

type Kind='decision'|'lesson';
type Input=DecisionInput|LessonInput;
type Reference={id:string;version:number;input:{title:string;missionId?:string;missionVersion?:number;journeyId?:string;journeyVersion?:number}};
type Row=Reference&{input:Input;assessment:{missing:string[];canReuse?:boolean;mayExecute?:false;mayScale?:false;mayPromote?:false;causalStatus:'not_measured'}};
type View={decisions:Row[];lessons:Row[];missions:Reference[];journeys:Reference[];campaignVersion:number;canEdit:boolean;mayExecute:false};
type Field={key:string;label:string;options?:readonly (readonly [string,string])[];date?:boolean};
const decisionFields:readonly Field[]=[
 {key:'title',label:'결정 제목'},{key:'decision',label:'결정 유형',options:[['maintain','유지'],['modify','수정'],['stop','중단'],['explore','탐색'],['scale','확대 검토']]},
 {key:'reason',label:'결정 이유'},{key:'observation',label:'관측 사실'},{key:'alternativeExplanation',label:'다른 설명·불확실성'},
 {key:'nextAction',label:'다음 조치'},{key:'assignee',label:'담당 역할'},{key:'dueAt',label:'조치 기한',date:true},
];
const lessonFields:readonly Field[]=[
 {key:'title',label:'교훈 제목'},{key:'method',label:'적용 방법'},{key:'hypothesis',label:'검증 가설'},{key:'scope',label:'적용 범위'},
 {key:'sourceType',label:'근거 유형',options:[['market','시장'],['execution','실행'],['journey','구매 병목'],['decision','결정'],['manual','수동 기록']]},
 {key:'evidenceLevel',label:'근거 수준',options:[['provisional','잠정 가설'],['operational_observation','운영 관측']]},
 {key:'sourceEvidence',label:'출처·근거'},{key:'counterEvidence',label:'반례·반대 근거'},{key:'falsificationRule',label:'반증 조건'},
 {key:'expiresAt',label:'유효 기한',date:true},{key:'state',label:'교훈 상태',options:[['candidate','후보'],['testing','검증 중'],['reusable','재사용 검토'],['retired','폐기']]},
 {key:'outcome',label:'검증 결과',options:[['not_tested','미검증'],['success','성공 관측'],['failure','실패 관측'],['invalid','무효']]},
 {key:'testPlan',label:'검증 계획'},{key:'testResult',label:'검증 결과 근거'},{key:'nextAction',label:'다음 조치'},{key:'assignee',label:'담당 역할'},
 {key:'dueAt',label:'조치 기한',date:true},{key:'retirementReason',label:'폐기 사유'},
];
async function request(campaignId:string,init:RequestInit={}):Promise<View>{
 const response=await fetch(`/api/growth/decisions${init.method==='POST'?'':`?campaignId=${encodeURIComponent(campaignId)}`}`,{...init,cache:'no-store'});
 const raw:unknown=await response.json();
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('결정·교훈 응답을 확인하지 못했습니다.');
 const data=raw as Record<string,unknown>;
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'결정·교훈 요청에 실패했습니다.');
 if(!['decisions','lessons','missions','journeys'].every(key=>Array.isArray(data[key]))||typeof data.campaignVersion!=='number'||typeof data.canEdit!=='boolean')throw new Error('결정·교훈 응답을 확인하지 못했습니다.');
 return data as unknown as View;
}
function ReferenceField({label,rows,id,version,onChange}:{label:string;rows:Reference[];id:string;version:number;onChange:(id:string,version:number)=>void}){
 const selected=rows.find(row=>row.id===id);
 return <div className={styles.field}><label>{label}<select value={id} onChange={e=>onChange(e.target.value,rows.find(row=>row.id===e.target.value)?.version??0)}><option value="">연결 없음</option>{id&&!selected&&<option value={id}>연결 기록 없음</option>}{rows.map(row=><option key={row.id} value={row.id}>{row.input.title||row.id} · v{row.version}</option>)}</select></label>{id&&<p>저장 기준 v{version}</p>}{selected&&selected.version!==version&&<button type="button" onClick={()=>onChange(id,selected.version)}>최신 {label} 연결 (v{selected.version})</button>}</div>;
}
function Editor({kind,campaignId,view,onView,saving,onSaving}:{kind:Kind;campaignId:string;view:View;onView:(view:View)=>void;saving:boolean;onSaving:(value:boolean)=>void}){
 const name=kind==='decision'?'일일 결정':'운영 교훈',rows=kind==='decision'?view.decisions:view.lessons;
 const [draft,setDraft]=useState<Input>(()=>kind==='decision'?emptyDecisionInput():emptyLessonInput());
 const [identity,setIdentity]=useState(()=>({id:crypto.randomUUID() as string,version:0}));
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),pending=useRef<AbortController|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.abort();};},[]);
 function change(patch:Record<string,string|number|null>){setDraft(previous=>({...previous,...patch}));setDirty(true);setMessage('');}
 function pick(row?:Row){setIdentity({id:row?.id??crypto.randomUUID(),version:row?.version??0});setDraft(row?{...row.input}:kind==='decision'?emptyDecisionInput():emptyLessonInput());setDirty(false);setError('');setMessage('');}
 async function save(){
  if(pending.current||saving)return;
  const c=new AbortController();pending.current=c;setBusy(true);onSaving(true);setError('');setMessage('');
  try{
   const next=await request(campaignId,{method:'POST',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({action:`save_${kind}`,campaignId,campaignVersion:view.campaignVersion,id:identity.id,expectedVersion:identity.version,input:draft})});
   if(!mounted.current||c.signal.aborted)return;
   const saved=(kind==='decision'?next.decisions:next.lessons).find(row=>row.id===identity.id);
   if(!saved)throw new Error('저장 응답에서 기록을 확인하지 못했습니다. 새로고침해 확인하세요.');
   onView(next);setIdentity({id:saved.id,version:saved.version});setDraft(saved.input);setDirty(false);setMessage(`${name}을 저장했습니다.`);
  }catch(e){if(mounted.current&&!c.signal.aborted)setError(`${e instanceof Error?e.message:'저장하지 못했습니다.'} 입력은 보존했습니다. 충돌이면 새로고침 후 최신 기록을 검토하세요.`);}
  finally{pending.current=null;if(mounted.current&&!c.signal.aborted){setBusy(false);onSaving(false);}}
 }
 const selected=rows.find(row=>row.id===identity.id),stale=!!selected&&selected.version!==identity.version,locked=saving||!view.canEdit;
 const values=draft as unknown as Record<string,string|number|null>,lesson=kind==='lesson'?draft as LessonInput:null;
 return <section aria-label={name}><div className={styles.workspace}><div role="group" className={styles.list} aria-label={`${name} 목록`}><button type="button" disabled={locked} onClick={()=>pick()}>새 {name}</button>{!rows.length&&<p>저장된 기록이 없습니다.</p>}{rows.map(row=><button type="button" key={row.id} disabled={saving} aria-pressed={row.id===identity.id} onClick={()=>pick(row)}><strong>{row.input.title||'제목 없는 초안'}</strong><span>v{row.version}</span></button>)}</div>
 <div className={styles.editor}><h4>{identity.version?`${name} 편집 · v${identity.version}`:`새 ${name}`}</h4>{!view.canEdit&&<p>조회 전용입니다.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}
 {stale&&<div className={styles.error}>서버 기록이 v{selected.version}로 바뀌었습니다. 최신 기록을 검토하고 저장 기준을 선택하세요.<details><summary>최신 기록 보기</summary><dl>{Object.entries(selected.input).map(([key,value])=><div key={key}><dt>{[...decisionFields,...lessonFields].find(field=>field.key===key)?.label??key}</dt><dd>{value===null?'미확인':String(value)}</dd></div>)}</dl></details><button type="button" disabled={locked} onClick={()=>{setIdentity({id:selected.id,version:selected.version});setError('');setMessage('현재 입력을 유지했습니다. 최신 기록 위에 새 버전으로 저장합니다.');}}>현재 입력 유지 · 최신 버전 기준 사용</button><button type="button" disabled={saving} onClick={()=>pick(selected)}>서버 기록으로 입력 교체</button></div>}
 <form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={locked} className={styles.form}><legend className={styles.srOnly}>{name} 입력</legend>
 {(kind==='decision'?decisionFields:lessonFields).map(field=><label className={field.options||field.date?styles.field:styles.wide} key={field.key}>{field.label}{field.options?<select value={String(values[field.key]??'')} onChange={e=>change({[field.key]:e.target.value})}>{field.options.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>:field.date?<input type="date" value={String(values[field.key]??'')} onChange={e=>change({[field.key]:e.target.value})}/>:<textarea rows={field.key==='title'?1:2} maxLength={field.key==='title'?200:2000} value={String(values[field.key]??'')} onChange={e=>change({[field.key]:e.target.value})}/>}</label>)}
 {lesson&&<label className={styles.field}>손실 한도 (원 · 빈칸은 미확인)<input type="number" min={0} step={1} value={lesson.lossLimit??''} onChange={e=>change({lossLimit:e.target.value===''?null:Number(e.target.value)})}/></label>}
 <ReferenceField label="판매 미션" rows={view.missions} id={draft.missionId} version={draft.missionVersion} onChange={(missionId,missionVersion)=>change({missionId,missionVersion})}/>
 <ReferenceField label="구매 병목" rows={view.journeys} id={draft.journeyId} version={draft.journeyVersion} onChange={(journeyId,journeyVersion)=>{const ref=view.journeys.find(row=>row.id===journeyId);change({journeyId,journeyVersion,...(ref?{missionId:ref.input.missionId??'',missionVersion:ref.input.missionVersion??0}:{})});}}/>
 {lesson&&<ReferenceField label="근거 결정" rows={view.decisions} id={lesson.decisionId} version={lesson.decisionVersion} onChange={(decisionId,decisionVersion)=>{const ref=view.decisions.find(row=>row.id===decisionId);change({decisionId,decisionVersion,...(ref?{missionId:ref.input.missionId,missionVersion:ref.input.missionVersion,journeyId:ref.input.journeyId,journeyVersion:ref.input.journeyVersion}:{})});}}/>}
 </fieldset>{view.canEdit&&<button className={styles.primary} type="submit" disabled={locked||stale}>{busy?'저장 중…':`${name} 저장`}</button>}</form>
 {dirty&&<p className={styles.note}>저장하지 않은 입력이 있습니다. 평가는 마지막 서버 저장 기준입니다.</p>}
 {selected?<div className={styles.readiness} aria-label={`${name} 평가`}><p>저장 시점의 근거를 함께 기록했습니다. 최신 연결 기록이 변경되면 재검토가 필요합니다.</p>{kind==='lesson'&&<p>재사용 검토: {selected.assessment.canReuse?'조건 충족':'보완 필요'} · 자동 규칙 승격 없음</p>}<p>인과효과 미측정 · 외부 실행·자동 확대 없음</p>{!!selected.assessment.missing.length&&<><strong>보완할 항목</strong><ul>{selected.assessment.missing.map((reason,index)=><li key={index}>{reason}</li>)}</ul></>}</div>:<p className={styles.note}>초안을 저장하면 보완 조건을 확인할 수 있습니다.</p>}
 </div></div></section>;
}
export function GrowthDecisionsPanel({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const read=useRef<AbortController|null>(null);
 const load=useCallback(async(signal:AbortSignal)=>{setLoading(true);setError('');try{const next=await request(campaignId,{signal});if(!signal.aborted)setView(next);}catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:'결정·교훈을 불러오지 못했습니다.');}finally{if(!signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{const c=new AbortController();read.current=c;void Promise.resolve().then(()=>{if(!c.signal.aborted)void load(c.signal);});return()=>read.current?.abort();},[load]);
 function reload(){read.current?.abort();const c=new AbortController();read.current=c;void load(c.signal);}
 function saved(next:View){read.current?.abort();setLoading(false);setView(next);}
 return <section className={styles.panel} aria-label="결정·운영 교훈"><header className={styles.header}><div><h3>일일 결정·운영 교훈</h3><p>관측과 판단을 나누고 실패·반례까지 다음 검증에 남깁니다.</p></div><button aria-label="결정·교훈 새로고침" type="button" disabled={loading||saving} onClick={reload}>새로고침</button></header>
 <Note className={styles.note}>개인정보·비공개 접근 URL을 입력하지 마세요. 담당자는 역할로 기록합니다. 실패 관측도 교훈으로 남길 수 있습니다. 재사용 검토는 자동 규칙 주입이나 성과의 인과 검증이 아닙니다. 손실 한도 빈칸은 미확인, 0은 명시한 한도입니다.</Note>
 {loading&&<ScreenSkeleton label="결정·교훈을 불러오고 있습니다." rows={2}/>}{error&&<p role="alert" className={styles.error}>{error}</p>}{view&&<><details open><summary>일일 결정 기록</summary><Editor kind="decision" campaignId={campaignId} view={view} onView={saved} saving={saving} onSaving={value=>{if(value){read.current?.abort();setLoading(false);}setSaving(value);}}/></details><details><summary>운영 교훈 기록</summary><Editor kind="lesson" campaignId={campaignId} view={view} onView={saved} saving={saving} onSaving={value=>{if(value){read.current?.abort();setLoading(false);}setSaving(value);}}/></details></>}
 </section>;
}
