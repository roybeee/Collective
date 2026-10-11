'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect} from '@/components/ui/native-select';
import {CheckInput} from '@/components/app/check';
import {clientId} from '@/lib/client';
import type {Store,StoreTask,StoreMeasurement,StoreExperiment} from '@/lib/store-marketing';
import type {StoreGrowthProfile,LocalPartnerCandidate,ActivityTime} from '@/lib/store-growth';
import {useAccount,canChange,adminOnlyNote} from './account-context';
import styles from './store-growth-panel.module.css';

type Match={score:number;fit:string;ready:boolean;blockers:string[];reasons:string[]};
type Candidate=LocalPartnerCandidate&{match:Match;brief?:string;publicBusinessEvidence?:string;recentExamples?:{url:string;note:string;outcome:'positive'|'negative'|'unknown'}[];quoteEvidenceUrl?:string;rightsScope?:string;rightsDays?:number|null;visitConditions?:string;sponsoredRatio?:number|null};
type Link={id:string;candidateId:string;campaignId:string;experimentId?:string;trackingCodeId?:string;collaborationId?:string;version:number;sourceStatus?:string;sourceReasons?:string[]};
type Comparison={id:string;currentMeasurementId:string;baselineMeasurementId:string;baselineSoftwareCost:number;currentSoftwareCost:number;baselineTimeCost:number;confirmed:boolean;evidence:string;version:number};
type View={profile:StoreGrowthProfile;candidates:(Candidate&{economics?:{breakEvenOrders:number|null;capacityOrders:number|null;totalCost:number|null;missing:string[];warnings:string[];feasible:boolean|null}})[];timeEntries:(ActivityTime&{phase?:'setup'|'recurring'})[];links:Link[];tasks:StoreTask[];learning?:{id:string;title:string;decision:string;learning:string;nextAction:string;evidenceLevel:string}[];campaigns?:{id:string;title:string;version:number}[];experiments?:StoreExperiment[];measurements?:StoreMeasurement[];comparisons?:Comparison[];canEdit:boolean;assessment:{blockers:string[];recommendations:string[];contributionPerOrder:number|null;breakEvenOrders:number|null};weekly:{actualMinutes:number|null;estimatedSavedMinutes:number|null;decision:string;periodStart?:string;periodEnd?:string;netContribution?:number|null;change?:number|null;timeCost?:number|null;reasons?:string[]}};
type Mutation=(payload:Record<string,unknown>)=>Promise<void>;
type FormProps={view:View;store:Store;mutate:Mutation;busy:boolean};
const display=(value:number|null|undefined,unit='')=>value==null?'미확인':`${value.toLocaleString('ko-KR')}${unit}`;
const list=(value:string)=>value.split(',').map(v=>v.trim()).filter(Boolean);
const nullable=(value:string)=>value.trim()===''?null:Number(value);
const needLabels:Record<string,string>={averageOrderValue:'객단가',variableCostPerOrder:'주문당 변동비',adCost:'광고비',productionCost:'제작·협찬비',benefitCost:'할인·혜택 비용',softwareCost:'소프트웨어 비용',spareOrdersPerDay:'추가 주문 수용량',days:'계획 기간',ownerHourlyValue:'시간 가치',plannedOwnerMinutes:'예상 사장 작업 시간'};
const needLabel=(value:string)=>Object.entries(needLabels).reduce((text,[key,label])=>text.replaceAll(key,label),value);
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
const field=(label:string,children:ReactNode)=> <label className={styles.field}><span>{label}</span>{children}</label>;

export async function growthRequest(storeId:string,payload?:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>{
 const response=await fetch(payload?'/api/store-growth':`/api/store-growth?storeId=${encodeURIComponent(storeId)}`,payload?
  {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,storeId}),signal}:
  {credentials:'same-origin',cache:'no-store',signal});
 const data=await response.json().catch(()=>{throw new Error('서버 응답을 읽지 못했습니다. 다시 불러오세요.');}) as {error?:string};
 if(!response.ok)throw Object.assign(new Error(data.error||'요청을 처리하지 못했습니다.'),{status:response.status});
 return data;
}
function checkedView(data:unknown,storeId:string):View{
 const v=data as View;
 if(!v?.profile||v.profile.storeId!==storeId||!Array.isArray(v.candidates)||!Array.isArray(v.timeEntries)||!Array.isArray(v.links))throw new Error('점포 자료 응답을 확인하지 못했습니다.');
 return v;
}

export function StoreGrowthPanel({store}:{store:Store}){
 const account=useAccount(),sequence=useRef(0),activeStore=useRef(store.id);
 const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>checkedView(await growthRequest(store.id,undefined,signal),store.id),[store.id]);
 useEffect(()=>{const controller=new AbortController(),version=++sequence.current;activeStore.current=store.id;
  void Promise.resolve().then(()=>{if(controller.signal.aborted)return null;setView(null);setError('');setNotice('');setBusy(false);return load(controller.signal);}).then(v=>{if(v&&!controller.signal.aborted&&version===sequence.current)setView(v);}).catch(e=>{if(!controller.signal.aborted&&version===sequence.current)setError((e as Error).message);});
  return()=>{controller.abort();};
 },[load,store.id]);
 async function mutate(payload:Record<string,unknown>){
  const version=sequence.current,id=store.id;setBusy(true);setError('');setNotice('');
  try{await growthRequest(id,payload);const v=await load();if(version===sequence.current&&activeStore.current===id){setView(v);setNotice('기록을 저장했습니다.');}}
  catch(e){if(version===sequence.current&&activeStore.current===id){if((e as {status?:number}).status===409){try{const v=await load();if(version===sequence.current&&activeStore.current===id)setView(v);}catch{/* 원래 충돌 메시지를 유지한다. */}if(version===sequence.current&&activeStore.current===id)setError('다른 변경이 있어 최신 자료를 불러왔습니다. 내용을 확인한 뒤 다시 저장하세요.');}else setError((e as Error).message);}throw e;}
  finally{if(version===sequence.current&&activeStore.current===id)setBusy(false);}
 }
 async function retry(){const version=sequence.current,id=store.id;try{const v=await load();if(version===sequence.current&&activeStore.current===id){setView(v);setError('');}}catch(e){if(version===sequence.current&&activeStore.current===id)setError((e as Error).message);}}
 const editable=canChange(account)&&view?.canEdit&&store.status!=='archived';
 return <section className={styles.panel} aria-label="점포 성장 운영">
  <header><h3>점포에 맞는 채널을 찾고, 실제 구매와 시간으로 판단하세요</h3><p>점포 기준 → 공개 후보 비교 → 실행 연결 → 시간 기록 → 다음 주 결정</p></header>
  {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!view?<p aria-live="polite">{error?'자료를 다시 불러오세요.':'불러오는 중…'}{error&&<Button onClick={()=>{void retry();}}>다시 불러오기</Button>}</p>:<>
   {!editable&&<p>{store.status==='archived'?'보관된 점포는 조회만 가능합니다.':adminOnlyNote()}</p>}
   <fieldset disabled={!editable||busy} className={styles.section}><legend>1. 점포 기준과 수용 여력</legend><ProfileForm key={`${store.id}:${view.profile.version}`} {...{view,store,mutate,busy}}/></fieldset>
   <section className={styles.section}><h4>2. 지역 후보 비교</h4><p>공식 서비스와 공개 협업 후보를 비교합니다. 공개 자료로 확인할 수 없는 도달·견적은 미확인으로 남깁니다.</p><Candidates {...{view,store,mutate,busy}} editable={!!editable}/>
    <fieldset disabled={!editable||busy}><legend>공개 사업·협업 후보 등록</legend><CandidateForm {...{view,store,mutate,busy}}/><CandidateImport mutate={mutate}/></fieldset></section>
   <fieldset disabled={!editable||busy} className={styles.section}><legend>3. 선택한 후보의 실행 연결</legend><ExecutionForm {...{view,store,mutate,busy}}/></fieldset>
   <fieldset disabled={!editable||busy} className={styles.section}><legend>4. 사장님 실제 작업 시간</legend><TimeForm {...{view,store,mutate,busy}}/></fieldset>
   <fieldset disabled={!editable||busy} className={styles.section}><legend>구매·비용 비교 대사</legend><ComparisonForm {...{view,store,mutate,busy}}/></fieldset>
   <Weekly view={view}/>
  </>}
 </section>;
}
function ProfileForm({view,store,mutate}:FormProps){
 const p=view.profile,[concept,setConcept]=useState(p.concept),[regions,setRegions]=useState(p.regions.join(', ')),[audiences,setAudiences]=useState(p.audiences.join(', ')),[dayparts,setDayparts]=useState(p.dayparts.join(', '));
 const numeric=[['averageOrderValue','객단가 (원)'],['variableCostPerOrder','주문당 변동비 (원)'],['spareOrdersPerDay','하루 추가 주문 수용량 (건)'],['ownerHourlyValue','사장 시간 가치 (원/시간)'],['plannedOwnerMinutes','예상 사장 작업 시간 (분)'],['monthlyBudget','월 마케팅 예산 (원)'],['adCost','이번 계획 광고비 (원)'],['productionCost','제작·협찬비 (원)'],['benefitCost','할인·혜택 비용 (원)'],['softwareCost','기간 소프트웨어 비용 (원)'],['days','계획 운영 기간 (일)']] as const;
 const [values,setValues]=useState(Object.fromEntries(numeric.map(([k])=>[k,p[k]==null?'':String(p[k])])) as Record<typeof numeric[number][0],string>),[categoryTags,setCategoryTags]=useState((p.categoryTags||[]).join(', ')),[bottleneck,setBottleneck]=useState(p.bottleneck||''),[constraints,setConstraints]=useState(p.constraints||'');
 async function submit(e:FormEvent){e.preventDefault();await mutate({action:'save_profile',version:p.version,profile:{...p,concept,categoryTags:list(categoryTags),bottleneck,constraints,regions:list(regions),audiences:list(audiences),dayparts:list(dayparts),...Object.fromEntries(numeric.map(([k])=>[k,nullable(values[k])]))}});}
 return <form onSubmit={e=>{void submit(e).catch(()=>{});}} className={styles.grid}>
  <p className={styles.wide}>주소: {store.address||'미확인'}, 목표: {store.goal||'미확인'}, 기존 점포 정보를 먼저 채웠습니다. 달라진 항목만 확인하세요. 비용을 몰라도 후보 조사는 시작할 수 있습니다.</p>
  <p className={styles.wide}>협업 후보 견적은 별도로 합산합니다. 후보 견적에 포함된 광고·제작·혜택 비용을 아래 항목에 중복 입력하지 마세요. 작업이 없다면 예상 작업 시간을 0분으로 확인하세요.</p>
  {field('가게 콘셉트',<Textarea value={concept} onChange={e=>setConcept(e.target.value)} required maxLength={1000}/>)}
  {field('비교할 업종·콘셉트 태그 (쉼표 구분)',<Input value={categoryTags} onChange={e=>setCategoryTags(e.target.value)} maxLength={1000}/>)}
  {field('현재 방문·구매를 막는 문제',<Textarea value={bottleneck} onChange={e=>setBottleneck(e.target.value)} maxLength={2000}/>)}
  {field('운영·촬영·고객 응대 제약',<Textarea value={constraints} onChange={e=>setConstraints(e.target.value)} maxLength={2000}/>)}
  {field('상권·활동 지역 (쉼표 구분)',<Input value={regions} onChange={e=>setRegions(e.target.value)} maxLength={1000}/>)}
  {field('주요 고객·이용 상황 (쉼표 구분)',<Input value={audiences} onChange={e=>setAudiences(e.target.value)} maxLength={1000}/>)}
  {field('집중 시간대 (쉼표 구분)',<Input value={dayparts} onChange={e=>setDayparts(e.target.value)} maxLength={500}/>)}
  {numeric.map(([k,label])=><label key={k} className={styles.field}><span>{label}</span><Input type="number" min="0" step="any" value={values[k]} placeholder="미확인" onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/></label>)}
  <div className={styles.wide}><Button type="submit">점포 기준 저장</Button></div>
 </form>;
}
function Candidates({view,store,mutate,busy,editable}:FormProps&{editable:boolean}){
 const [filter,setFilter]=useState('all'),[editing,setEditing]=useState<string|null>(null);
 const candidates=view.candidates.filter(c=>filter==='all'||c.status===filter);
 return <><label>상태 <NativeSelect value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체</option><option value="research">조사 중</option><option value="shortlisted">선택한 후보</option><option value="rejected">제외한 후보</option></NativeSelect></label>
  {!candidates.length&&<p>등록된 후보가 없습니다. 공식 후보 자료를 확인하거나 공개 협업 후보를 등록하세요.</p>}
  <div className={styles.candidates}>{candidates.map(c=><article key={c.id} className={styles.candidate}>
   <h5><a href={c.url} target="_blank" rel="noopener noreferrer">{c.name}</a></h5><p>{c.regions.join(', ')||'지역 미확인'}, {{creator:'지역 인플루언서·체험단',media:'지역 매체',platform:'협업·광고 플랫폼',community:'지역 커뮤니티',partner:'지역 제휴'}[c.kind]}, {c.status==='shortlisted'?'선택됨':c.status==='rejected'?'제외됨':'조사 중'}</p>
   <p>적합도 {c.match.score}/100, {c.match.ready?'실행 조건 확인됨':'실행 조건 확인 필요'}</p><p>{c.evidenceSummary}</p>
   <p>확인일 {c.checkedAt}, 재확인 기한 {c.expiresAt}, 견적 {display(c.quote,'원')}, 지역 도달 {display(c.localReach,'명')}</p>
   <p>사업·협업 근거: {c.publicBusinessEvidence||'미확인'}, 방문 조건: {c.visitConditions||'미확인'}, 협찬 비율: {c.sponsoredRatio==null?'미확인':`${(c.sponsoredRatio*100).toLocaleString('ko-KR')}%`}</p>
   <p>재사용 범위: {c.rightsScope||'미확인'}, 기간 {display(c.rightsDays,'일')} {c.quoteEvidenceUrl&&<a href={c.quoteEvidenceUrl} target="_blank" rel="noopener noreferrer">견적 근거</a>}</p>
   {(c.recentExamples||[]).length>0&&<details><summary>최근 사례와 반례</summary><ul>{c.recentExamples!.map((example,i)=><li key={i}><a href={example.url} target="_blank" rel="noopener noreferrer">{example.note}</a>, {{positive:'긍정 사례',negative:'부정 사례',unknown:'결과 미확인'}[example.outcome]}</li>)}</ul></details>}
   {c.economics&&<p>확인 비용 {display(c.economics.totalCost,'원')}, 회수 필요 주문 {display(c.economics.breakEvenOrders,'건')}, 기간 추가 수용량 {display(c.economics.capacityOrders,'건')}{c.economics.feasible===false&&', 처리 여력 초과'}, {c.economics.missing.map(needLabel).join(', ')}</p>}
   <a href={c.evidenceUrl} target="_blank" rel="noopener noreferrer">공개 근거 확인</a><p>{c.match.reasons.join(', ')}</p>
   {c.brief&&<details><summary>점포 기준을 담은 협업 브리프</summary><pre className={styles.brief}>{c.brief}</pre></details>}
   {c.match.blockers.length>0&&<ul>{c.match.blockers.map(b=><li key={b}>{b}</li>)}</ul>}
   {editable&&<div className={styles.actions}><Button disabled={busy||c.status==='shortlisted'||c.match.fit==='exclude'} disabledReason={c.status==='shortlisted'?'이미 선택한 후보입니다.':c.match.fit==='exclude'?'제외 사유를 확인하세요.':''} onClick={()=>{void mutate({action:'select_candidate',id:c.id,version:c.version,status:'shortlisted'}).catch(()=>{});}}>검토 후보로 선택</Button><Button disabled={busy||c.status==='rejected'} disabledReason="이미 제외한 후보입니다." variant="outline" onClick={()=>{void mutate({action:'select_candidate',id:c.id,version:c.version,status:'rejected'}).catch(()=>{});}}>제외</Button><Button disabled={busy} variant="outline" onClick={()=>setEditing(editing===c.id?null:c.id)}>견적·근거 갱신</Button></div>}
   {editable&&editing===c.id&&<fieldset disabled={busy}><legend>{c.name} 확인 내용 수정</legend><CandidateForm key={`${c.id}:${c.version}`} {...{view,store,mutate,busy}} candidate={c}/></fieldset>}
  </article>)}</div>
 </>;
}
function CandidateForm({view,mutate,candidate}:FormProps&{candidate?:Candidate}){
 const c=candidate;
 const [values,setValues]=useState({name:c?.name||'',kind:c?.kind||'creator',url:c?.url||'',regions:(c?.regions||view.profile.regions).join(', '),concepts:(c?.concepts||[]).join(', '),audiences:(c?.audiences||[]).join(', '),dayparts:(c?.dayparts||[]).join(', '),evidenceUrl:c?.evidenceUrl||'',evidenceSummary:c?.evidenceSummary||'',checkedAt:c?.checkedAt||today(),expiresAt:c?.expiresAt||'',localReach:c?.localReach==null?'':String(c.localReach),localReachEvidence:c?.localReachEvidence||'',quote:c?.quote==null?'':String(c.quote),rights:String(c?.rights||'unknown'),disclosure:String(c?.disclosure||'unknown'),tracking:String(c?.tracking||'unknown')});
 const [extra,setExtra]=useState({publicBusinessEvidence:c?.publicBusinessEvidence||'',recentExamples:(c?.recentExamples||[]).map(e=>`${e.url}|${e.note}|${e.outcome}`).join('\n'),quoteEvidenceUrl:c?.quoteEvidenceUrl||'',rightsScope:c?.rightsScope||'',rightsDays:c?.rightsDays==null?'':String(c.rightsDays),visitConditions:c?.visitConditions||'',sponsoredRatio:c?.sponsoredRatio==null?'':String(c.sponsoredRatio)}),[localError,setLocalError]=useState('');
 const set=(k:keyof typeof values,v:string)=>setValues(old=>({...old,[k]:v}));
 async function submit(e:FormEvent){e.preventDefault();setLocalError('');try{const examples=parseExamples(extra.recentExamples);await mutate({action:c?'update_candidate':'add_candidate',...(c?{id:c.id,version:c.version}:{}),candidate:{...values,...extra,recentExamples:examples,rightsDays:nullable(extra.rightsDays),sponsoredRatio:nullable(extra.sponsoredRatio),regions:list(values.regions),concepts:list(values.concepts),audiences:list(values.audiences),dayparts:list(values.dayparts),localReach:nullable(values.localReach),quote:nullable(values.quote)}});if(!c){setValues(v=>({...v,name:'',url:'',concepts:'',audiences:'',dayparts:'',evidenceUrl:'',evidenceSummary:'',expiresAt:'',localReach:'',localReachEvidence:'',quote:'',rights:'unknown',disclosure:'unknown',tracking:'unknown'}));setExtra({publicBusinessEvidence:'',recentExamples:'',quoteEvidenceUrl:'',rightsScope:'',rightsDays:'',visitConditions:'',sponsoredRatio:''});}}catch(e){setLocalError((e as Error).message);}}
 const texts=[['name','사업·협업 후보 이름'],['url','공개 사업 페이지 URL'],['regions','활동 지역 (쉼표 구분)'],['concepts','콘셉트 (쉼표 구분)'],['audiences','고객 (쉼표 구분)'],['dayparts','시간대 (쉼표 구분)'],['evidenceUrl','확인한 근거 URL'],['localReachEvidence','지역 도달 확인 근거']] as const;
 return <form onSubmit={e=>{void submit(e).catch(()=>{});}} className={styles.grid}>
  <p className={styles.wide}>협업을 공개적으로 안내하는 사업 계정·매체만 등록하세요. 일반 후기 작성자나 비공개 연락처는 등록 대상이 아닙니다.</p>
  {texts.map(([k,label])=><label key={k} className={styles.field}><span>{label}</span><Input required={['name','url','evidenceUrl'].includes(k)} type={k.includes('Url')||k==='url'?'url':'text'} value={values[k]} onChange={e=>set(k,e.target.value)} maxLength={1000}/></label>)}
  {field('후보 유형',<NativeSelect value={values.kind} onChange={e=>set('kind',e.target.value)}><option value="creator">지역 인플루언서·체험단</option><option value="media">지역 맛집 페이지·매체</option><option value="platform">협업·광고 플랫폼</option><option value="community">지역 커뮤니티</option><option value="partner">지역 제휴 사업장</option></NativeSelect>)}
  {field('확인된 내용',<Textarea required value={values.evidenceSummary} onChange={e=>set('evidenceSummary',e.target.value)} maxLength={2000}/>)}
  {(['checkedAt','expiresAt'] as const).map(k=><label key={k} className={styles.field}><span>{k==='checkedAt'?'확인일':'재확인 기한'}</span><Input required type="date" value={values[k]} onChange={e=>set(k,e.target.value)}/></label>)}
  {(['localReach','quote'] as const).map(k=><label key={k} className={styles.field}><span>{k==='localReach'?'확인된 지역 도달 (명)':'확인된 견적 (원)'}</span><Input type="number" min="0" placeholder="미확인" value={values[k]} onChange={e=>set(k,e.target.value)}/></label>)}
  {(['rights','disclosure','tracking'] as const).map(k=><label key={k} className={styles.field}><span>{{rights:'원본·재사용 권한',disclosure:'협찬·광고 표시',tracking:'구매 추적 경로'}[k]}</span><NativeSelect value={values[k]} onChange={e=>set(k,e.target.value)}><option value="unknown">미확인</option><option value="confirmed">확인됨</option>{k==='rights'&&<option value="not_needed">필요 없음</option>}</NativeSelect></label>)}
  {([['publicBusinessEvidence','공개 사업·협업 안내 근거'],['quoteEvidenceUrl','견적 근거 URL (선택)'],['rightsScope','원본·재사용 허용 범위'],['visitConditions','방문·촬영·제공 조건']] as const).map(([k,label])=><label key={k} className={styles.field}><span>{label}</span><Input type={k==='quoteEvidenceUrl'?'url':'text'} value={extra[k]} maxLength={2000} onChange={e=>setExtra(v=>({...v,[k]:e.target.value}))}/></label>)}
  {field('재사용 허용 기간 (일)',<Input type="number" min="1" max="3650" value={extra.rightsDays} onChange={e=>setExtra(v=>({...v,rightsDays:e.target.value}))}/>)}
  {field('최근 콘텐츠 협찬 비율 (0~1)',<Input type="number" min="0" max="1" step="0.01" value={extra.sponsoredRatio} onChange={e=>setExtra(v=>({...v,sponsoredRatio:e.target.value}))}/>)}
  {field('최근 사례·반례 (최대 10개, 한 줄마다 URL|메모|positive 또는 negative 또는 unknown)',<Textarea value={extra.recentExamples} onChange={e=>setExtra(v=>({...v,recentExamples:e.target.value}))} maxLength={15000}/>)}
  {localError&&<p className={styles.wide} role="alert">{localError}</p>}
  <div className={styles.wide}><Button type="submit">{c?'확인 내용 갱신':'근거와 함께 후보 저장'}</Button></div>
 </form>;
}
export function parseExamples(value:string){
 const lines=value.split('\n').map(v=>v.trim()).filter(Boolean);
 if(lines.length>10)throw new Error('최근 사례는 최대 10개입니다.');
 return lines.map(line=>{const [url,note,outcome,...rest]=line.split('|').map(v=>v.trim());if(rest.length||!note||!['positive','negative','unknown'].includes(outcome)||!/^https:\/\//.test(url))throw new Error('사례는 HTTPS URL|메모|positive 또는 negative 또는 unknown 형식으로 입력하세요.');return {url,note,outcome:outcome as 'positive'|'negative'|'unknown'};});
}
export function parseCandidateBatch(value:string){
 const candidates=JSON.parse(value) as unknown;
 if(!Array.isArray(candidates)||!candidates.length||candidates.length>30||candidates.some(c=>!c||typeof c!=='object'||Array.isArray(c)))throw new Error('후보 객체 배열 1~30개를 입력하세요.');
 return candidates;
}
function CandidateImport({mutate}:{mutate:Mutation}){
 const [value,setValue]=useState(''),[error,setError]=useState('');
 async function submit(e:FormEvent){e.preventDefault();setError('');try{await mutate({action:'import_candidates',candidates:parseCandidateBatch(value)});setValue('');}catch(e){setError((e as Error).message);}}
 return <details><summary>공개 사업 후보 자료 일괄 가져오기</summary><p>조사한 공개 사업 후보 객체 배열을 입력하세요. 위 등록 폼과 같은 필드로 최대 30개를 검증하며, 각 후보의 공개 출처·확인일·근거가 필요합니다. 개인 후기 작성자 자료를 가져오지 마세요.</p><form onSubmit={e=>{void submit(e);}}>{field('후보 자료 JSON 배열',<Textarea value={value} onChange={e=>setValue(e.target.value)} required maxLength={100000}/>)}{error&&<p role="alert">{error}</p>}<Button type="submit">공개 후보 일괄 저장</Button></form></details>;
}
function ExecutionForm({view,store,mutate,busy}:FormProps){
 const [candidateId,setCandidateId]=useState(''),[task,setTask]=useState(''),[campaignId,setCampaignId]=useState(''),[experimentId,setExperimentId]=useState(''),[trackingCodeId,setTrackingCodeId]=useState(''),[collaborationId,setCollaborationId]=useState('');
 const selected=view.candidates.filter(c=>c.status==='shortlisted');
 const submitTask=async()=>{await mutate({action:'create_task',candidateId,task,requestId:clientId()});setTask('');};
 const link=async()=>{const old=view.links.find(l=>l.candidateId===candidateId&&l.campaignId===campaignId);await mutate({action:'link_execution',...(old?{id:old.id}:{}),version:old?.version??0,candidateId,campaignId,experimentId:experimentId||undefined,trackingCodeId:trackingCodeId||undefined,collaborationId:collaborationId||undefined});};
 return <div className={styles.grid}>
  <p className={styles.wide}>후보 선택은 협업 계약이나 발신 승인이 아닙니다. 기존 캠페인·실험·쿠폰·협업의 식별자를 연결하면 서버가 같은 점포와 브랜드인지 확인합니다.</p>
  {field('선택한 후보',<NativeSelect value={candidateId} onChange={e=>setCandidateId(e.target.value)}><option value="">후보 선택</option>{selected.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>)}
  {field('다음 확인·촬영·브리프 과제',<Input value={task} onChange={e=>setTask(e.target.value)} maxLength={1000}/>)}
  <div className={styles.wide}><Button disabled={!candidateId||!task.trim()} disabledReason="후보를 선택하고 할 일을 입력하세요." onClick={()=>{void submitTask().catch(()=>{});}}>점포 할 일 만들기</Button></div>
  {field('점포 캠페인',<NativeSelect value={campaignId} onChange={e=>setCampaignId(e.target.value)}><option value="">캠페인 선택</option>{(view.campaigns||[]).map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</NativeSelect>)}
  {field('점포 실험 (선택)',<NativeSelect value={experimentId} onChange={e=>setExperimentId(e.target.value)}><option value="">실험 선택</option>{(view.experiments||[]).filter(e=>!e.campaignId||e.campaignId===campaignId).map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</NativeSelect>)}
  {([['구매 추적 코드 ID (선택)',trackingCodeId,setTrackingCodeId],['협업 ID (선택)',collaborationId,setCollaborationId]] as const).map(([label,value,setter])=><label key={label} className={styles.field}><span>{label}</span><Input value={value} onChange={e=>setter(e.target.value)} maxLength={150}/></label>)}
  <div className={styles.wide}><Button disabled={!candidateId||!campaignId.trim()} disabledReason="후보와 점포 캠페인을 선택하세요." onClick={()=>{void link().catch(()=>{});}}>기존 실행 연결</Button></div>
  <ul className={styles.wide}>{view.links.map(l=><li key={l.id}>캠페인 {l.campaignId}, {view.candidates.find(c=>c.id===l.candidateId)?.name||'후보'}{l.experimentId&&`, 실험 ${l.experimentId}`}{l.trackingCodeId&&`, 구매 추적 ${l.trackingCodeId}`}{l.sourceStatus&&`, 연결 근거 ${l.sourceStatus==='current'?'최신':'재확인 필요'}`}{(l.sourceReasons||[]).join(', ')}</li>)}</ul>
  <ul className={styles.wide}>{(view.tasks||[]).map(t=><li key={t.id}>{t.status==='done'?'완료':'할 일'}: {t.title}{t.status==='open'&&t.id.startsWith('growth:'+store.id+':')&&<TaskCompletion task={t} mutate={mutate} busy={busy}/>}</li>)}</ul>
 </div>;
}
function TaskCompletion({task,mutate,busy}:{task:StoreTask;mutate:Mutation;busy:boolean}){
 const [evidence,setEvidence]=useState('');
 return <div className={styles.actions}><label>완료 확인 근거<Input value={evidence} onChange={e=>setEvidence(e.target.value)} maxLength={2000}/></label><Button disabled={busy||!evidence.trim()} disabledReason={busy?'저장 중입니다.':!evidence.trim()?'완료를 확인한 근거를 입력하세요.':undefined} onClick={()=>{void mutate({action:'complete_task',id:task.id,version:task.version,evidence}).catch(()=>{});}}>과제 완료 기록</Button></div>;
}
function TimeForm({view,mutate}:FormProps){
 const [date,setDate]=useState(today()),[task,setTask]=useState(''),[minutes,setMinutes]=useState(''),[baseline,setBaseline]=useState(''),[source,setSource]=useState('measured'),[included,setIncluded]=useState(false),[phase,setPhase]=useState('recurring'),[prefilled,setPrefilled]=useState(false),[confirmed,setConfirmed]=useState(false);
 const recent=view.timeEntries.filter((t,i,a)=>a.findIndex(p=>p.task===t.task)===i);
 function choose(taskName:string){const old=recent.find(t=>t.task===taskName);if(!old)return;setTask(old.task);setMinutes(String(old.minutes));setBaseline(old.baselineMinutes==null?'':String(old.baselineMinutes));setPhase(old.phase||'recurring');setSource('self_reported');setPrefilled(true);setConfirmed(false);}
 async function submit(e:FormEvent){e.preventDefault();if(prefilled&&!confirmed)return;await mutate({action:'add_time',requestId:clientId(),entry:{date,task,minutes:Number(minutes),baselineMinutes:nullable(baseline),source,phase,costIncludedElsewhere:included}});setTask('');setMinutes('');setBaseline('');setPrefilled(false);setConfirmed(false);}
 return <form onSubmit={e=>{void submit(e).catch(()=>{});}} className={styles.grid}>
  <p className={styles.wide}>입력·승인·확인·촬영에 쓴 실제 시간을 기록하세요. 클릭·활동 로그와 별도로 실제 작업 시간을 확인하세요. 이전 방식의 같은 과제 시간이 있어야 절감 비교가 가능합니다.</p>
  {field('최근 업무로 빠르게 주간 확인',<NativeSelect value="" onChange={e=>choose(e.target.value)}><option value="">직전 기록을 가져와 확인</option>{recent.map(t=><option key={t.id} value={t.task}>{t.task}, 직전 {t.minutes}분</option>)}</NativeSelect>)}
  {field('업무 구분',<NativeSelect value={phase} onChange={e=>setPhase(e.target.value)}><option value="setup">초기 설정</option><option value="recurring">반복 업무</option></NativeSelect>)}
  {field('작업일',<Input type="date" value={date} onChange={e=>setDate(e.target.value)} required/>)}
  {field('실제 수행한 작업',<Input value={task} onChange={e=>setTask(e.target.value)} required maxLength={500}/>)}
  {field('실제 소요 시간 (분)',<Input type="number" min="1" max="1440" value={minutes} onChange={e=>setMinutes(e.target.value)} required/>)}
  {field('이전 방식의 동일 과제 시간 (분, 선택)',<Input type="number" min="0" max="1440" value={baseline} onChange={e=>setBaseline(e.target.value)} placeholder="미확인"/>)}
  {field('기록 근거',<NativeSelect value={source} onChange={e=>setSource(e.target.value)}><option value="measured">타이머·작업 기록 실측</option><option value="self_reported">사장 직접 회고</option></NativeSelect>)}
  <label><CheckInput checked={included} onChange={e=>setIncluded(e.target.checked)}/> 이 인건비를 다른 비용 항목에 이미 포함했습니다.</label>
  {prefilled&&<label className={styles.wide}><CheckInput checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/> 직전 기록에서 채운 시간을 이번 작업의 실제 시간으로 다시 확인했습니다. 자동 실측값이 아닙니다.</label>}
  <div className={styles.wide}><Button type="submit" disabled={prefilled&&!confirmed} disabledReason="가져온 시간을 이번 작업의 실제 시간으로 확인하세요.">작업 시간 기록</Button></div>
  <ul className={styles.wide}>{view.timeEntries.slice(0,12).map(t=><li key={t.id}>{t.date}, {t.task}, {t.minutes}분, {t.phase==='setup'?'초기 설정':'반복 업무'}, {t.source==='measured'?'실측':'직접 회고'}, 비교 기준 {display(t.baselineMinutes,'분')}</li>)}</ul>
 </form>;
}
function ComparisonForm({view,mutate}:FormProps){
 const [currentId,setCurrentId]=useState(''),[baselineId,setBaselineId]=useState(''),[baselineSoftware,setBaselineSoftware]=useState(''),[currentSoftware,setCurrentSoftware]=useState(''),[baselineTime,setBaselineTime]=useState(''),[confirmed,setConfirmed]=useState(false),[evidence,setEvidence]=useState('');
 const measurements=view.measurements||[],current=measurements.find(m=>m.id===currentId),existing=(view.comparisons||[]).find(c=>c.currentMeasurementId===currentId);
 const baselines=measurements.filter(m=>m.scope==='baseline'&&(!current||m.experimentId===current.experimentId));
 async function submit(e:FormEvent){e.preventDefault();await mutate({action:'save_comparison',version:existing?.version??0,comparison:{currentMeasurementId:currentId,baselineMeasurementId:baselineId,baselineSoftwareCost:nullable(baselineSoftware),currentSoftwareCost:nullable(currentSoftware),baselineTimeCost:nullable(baselineTime),confirmed,evidence}});}
 return <form className={styles.grid} onSubmit={e=>{void submit(e).catch(()=>{});}}>
  <p className={styles.wide}>같은 실험·집계 정의·출처·길이의 기간을 비교합니다. 양쪽 기간의 도구비용과 기준 기간 시간비용을 확인하고, 현재 기간의 전체 업무 시간을 빠짐없이 기록했는지 확인하세요.</p>
  {field('비교할 실행 측정',<NativeSelect required value={currentId} onChange={e=>{setCurrentId(e.target.value);setBaselineId('');setConfirmed(false);}}><option value="">실행 측정 선택</option>{measurements.filter(m=>m.scope!=='baseline').map(m=><option key={m.id} value={m.id}>{m.periodStart} ~ {m.periodEnd}, {m.source}</option>)}</NativeSelect>)}
  {field('처치 전 기준선 측정',<NativeSelect required value={baselineId} onChange={e=>setBaselineId(e.target.value)}><option value="">기준선 선택</option>{baselines.map(m=><option key={m.id} value={m.id}>{m.periodStart} ~ {m.periodEnd}, {m.source}</option>)}</NativeSelect>)}
  {([['기준 기간 도구비용 (원)',baselineSoftware,setBaselineSoftware],['실행 기간 도구비용 (원)',currentSoftware,setCurrentSoftware],['기준 기간 시간비용 (원)',baselineTime,setBaselineTime]] as const).map(([label,value,setter])=><label key={label} className={styles.field}><span>{label}</span><Input required type="number" min="0" value={value} onChange={e=>setter(e.target.value)}/></label>)}
  {field('양쪽 비용과 전체 시간 기록 확인 근거',<Textarea required value={evidence} maxLength={2000} onChange={e=>setEvidence(e.target.value)}/>)}
  <label className={styles.wide}><CheckInput checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/> 두 기간의 비용을 대사했고 실행 기간의 전체 업무 시간이 기록되었음을 확인했습니다.</label>
  <div className={styles.wide}><Button type="submit" disabled={!confirmed||!currentId||!baselineId} disabledReason="두 측정과 전체 시간·비용 대사 확인이 필요합니다.">비교 근거 저장</Button></div>
  {existing&&<p className={styles.wide}>이 측정의 저장된 비교 근거: {existing.evidence}</p>}
 </form>;
}
function Weekly({view}:{view:View}){
 const {assessment:a,weekly:w}=view;
 return <section className={styles.section} aria-label="주간 판단"><h4>5. 주간 판단과 다음 행동</h4>
  <p>시간 집계 기간: {w?.periodStart||'미확인'} ~ {w?.periodEnd||'미확인'}</p>
  <dl className={styles.metrics}><div><dt>주문당 공헌이익</dt><dd>{display(a?.contributionPerOrder,'원')}</dd></div><div><dt>비용 회수에 필요한 주문</dt><dd>{display(a?.breakEvenOrders,'건')}</dd></div><div><dt>집계 기간 실제 작업</dt><dd>{display(w?.actualMinutes,'분')}</dd></div><div><dt>동일 과제 기준 절감 비교</dt><dd>{display(w?.estimatedSavedMinutes,'분')}</dd></div></dl>
  <dl className={styles.metrics}><div><dt>확인 비용·시간 차감 공헌이익</dt><dd>{display(w?.netContribution,'원')}</dd></div><div><dt>대사된 기준선 대비 변화</dt><dd>{display(w?.change,'원')}</dd></div><div><dt>실행 기간 시간비용</dt><dd>{display(w?.timeCost,'원')}</dd></div></dl>
  <p>{{hold:'판단 보류: 비교 가능한 구매·비용 근거를 모으세요.',stop:'중단 검토: 확인된 비용과 이익을 확인하세요.',continue:'유지 검토: 확인된 비교 결과를 다음 실험으로 재검증하세요.',review:'수정 검토: 증가하지 않은 원인을 확인하세요.'}[w?.decision]||w?.decision||'실제 구매·비용과 같은 과제의 시간 비교 자료를 모은 뒤 판단하세요.'}</p>
  {(w?.reasons||[]).length>0&&<ul>{w.reasons!.map(r=><li key={r}>{needLabel(r)}</li>)}</ul>}
  {(a?.blockers||[]).length>0&&<><h5>실행 전에 필요한 확인</h5><ul>{a.blockers.map(b=><li key={b}>{needLabel(b)}</li>)}</ul></>}
  {(a?.recommendations||[]).length>0&&<><h5>다음 행동</h5><ul>{a.recommendations.map(r=><li key={r}>{needLabel(r)}</li>)}</ul></>}
  {(view.learning||[]).length>0&&<><h5>이전 실험에서 배운 점</h5><ul>{view.learning!.map(l=><li key={l.id}>{l.title}: {l.learning}, 다음 행동: {l.nextAction||'미정'}, 근거 수준: {{observation:'관찰',comparison:'비교',repeated:'반복 검증'}[l.evidenceLevel]||'확인 필요'}</li>)}</ul></>}
  <p>후보 적합도와 예상 손익은 판단 자료입니다. 실제 추가 매출·추가 이익은 기준선과 비교 실험으로 검증하세요.</p>
 </section>;
}
