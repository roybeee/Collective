'use client';
// G5 AI 검색 노출 자동 추적 화면(조건부 확장 패널 안에서 lazy로 연다). 질문 표·시작 질문·측정 계획(추정 토큰)·결과 표·보고서·개선 백로그.
// 서버 경로: /api/geo(스위치 geo_tracking). 숫자는 관찰 기록의 비율이며 노출 보장이 아니다.
import {useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,CircleSlash,Lock} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import {Textarea} from '@/components/ui/textarea';
import {CheckInput} from '@/components/app/check';
import {Note} from '@/components/app/note';
import {MetaLine} from '@/components/app/meta-line';
import {StatList} from '@/components/app/stat-list';
import {EmptyLine} from '@/components/app/empty-line';
import {DataTable,type DataColumn} from '@/components/app/data-table';
import {readOnlyReason} from '@/lib/ui/read-only';
import {formatTokens} from '@/lib/token-estimate';
import {GEO_ENGINES,GEO_INTENTS,GEO_INTENT_LABELS,GEO_LOCALES,GEO_LOCALE_LABELS,type GeoEngine,type GeoQuestion,type GeoQuestionInput} from '@/lib/geo-questions';
import {GEO_ENGINE_PAGES,type GeoObservation} from '@/lib/geo-observation';
import type {GeoView} from '@/lib/geo-run-server';
import type {GeoSiteState} from '@/lib/geo-report';
import styles from './growth-panel.module.css';

const POLL_MS=15000;
const engineLabel=(e:GeoEngine)=>GEO_ENGINE_PAGES[e].label;
const pct=(v:number|null)=>v===null?'관찰 없음':Math.round(v*100)+'%';
const pp=(v:number|null)=>v===null?'비교 불가':(v>0?'+':'')+Math.round(v*100)+'%p';
const siteLabels:Record<GeoSiteState,string>={present:'있음',absent:'없음',unknown:'미확인'};
const jobLabels={pending:'대기',queued:'진행 중',uncertain:'접수 확인 중',completed:'완료',failed:'실패',cancelled:'중지'} as const;
const emptyForm=():GeoQuestionInput=>({text:'',locale:'ko',intent:'brand',engines:[...GEO_ENGINES],active:true});
type Editing={id:string;version:number}|null;

function ObservationCell({o}:{o:GeoObservation|undefined}){
 if(!o)return <span>측정 전</span>;
 if(o.status==='login_required')return <span><Lock aria-hidden="true" className="inline size-4"/> 로그인 필요</span>;
 if(o.status==='unavailable')return <span><CircleSlash aria-hidden="true" className="inline size-4"/> 답변 없음</span>;
 return <MetaLine items={[<span key="m">{o.brandMentioned?<CheckCircle2 aria-hidden="true" className="inline size-4"/>:<CircleSlash aria-hidden="true" className="inline size-4"/>} {o.brandMentioned?'언급':'미언급'}</span>,o.brandCited?'공식 인용':'인용 없음',o.firstMentionRank?`${o.firstMentionRank}번째 언급`:'']}/>;
}

export function GeoPanel({campaignId}:{campaignId:string}){
 const [view,setView]=useState<GeoView|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[off,setOff]=useState(''),[message,setMessage]=useState('');
 const [form,setForm]=useState<GeoQuestionInput>(emptyForm),[editing,setEditing]=useState<Editing>(null),[picked,setPicked]=useState<string[]>([]),[site,setSite]=useState<{jsonLd:GeoSiteState;llmsTxt:GeoSiteState}|null>(null);
 const reading=useRef<AbortController|null>(null),runKey=useRef<string>('');
 const load=useCallback(async()=>{reading.current?.abort();const c=new AbortController();reading.current=c;setLoading(true);setError('');
  try{const r=await fetch(`/api/geo?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal:c.signal}),v:unknown=await r.json();if(c.signal.aborted)return;
   if(r.status===409){setOff((v as {error?:string}).error??'AI 검색 노출 추적을 쓸 수 없습니다.');setView(null);return}
   if(!r.ok)throw new Error((v as {error?:string}).error??'조회하지 못했습니다.');setOff('');setView(v as GeoView);}
  catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'조회 실패')}finally{if(!c.signal.aborted)setLoading(false)}},[campaignId]);
 useEffect(()=>{void Promise.resolve().then(()=>load());return()=>reading.current?.abort()},[load]);
 async function send(body:Record<string,unknown>,done:string,after?:()=>void){
  if(saving)return;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/geo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignId,...body})}),v=await r.json() as {error?:string};if(!r.ok)throw new Error(v.error??'처리하지 못했습니다.');setMessage(done);after?.();await load();}
  catch(e){setError(`${e instanceof Error?e.message:'처리 실패'} 입력은 보존했습니다.`)}finally{setSaving(false)}
 }
 const active=view?.active??null;
 useEffect(()=>{if(!active)return;const id=setInterval(()=>{void fetch('/api/geo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignId,action:'advance',runId:active.id})}).then(()=>load()).catch(()=>undefined)},POLL_MS);return()=>clearInterval(id)},[active,campaignId,load]);
 if(off)return <section aria-label="AI 검색 노출 자동 추적" className={styles.section}><Note className={styles.note}>{off}</Note></section>;
 if(!view)return <section aria-label="AI 검색 노출 자동 추적" className={styles.section}>{loading&&<p role="status">AI 검색 노출 기록을 조회하고 있습니다.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}</section>;
 const canEdit=view.canEdit,lockedReason=canEdit?undefined:readOnlyReason,checks=site??{jsonLd:view.site.jsonLd,llmsTxt:view.site.llmsTxt};
 const latest=new Map<string,GeoObservation>();for(const o of view.observations){const k=o.questionId+':'+o.engine;if(!latest.has(k))latest.set(k,o)}
 const shownEngines=GEO_ENGINES.filter(e=>view.questions.some(q=>q.engines.includes(e)));
 const questionColumns:DataColumn<GeoQuestion>[]=[
  {label:'질문',cell:q=>q.text,sort:q=>q.text},
  {label:'유형',cell:q=>GEO_INTENT_LABELS[q.intent],sort:q=>q.intent},
  {label:'엔진',cell:q=><MetaLine items={q.engines.map(engineLabel)}/>},
  {label:'추적',cell:q=>q.active?'켜짐':'꺼짐',sort:q=>q.active?1:0},
  {label:'관리',cell:q=><span className={styles.actions}><Button variant="panel" size="fit" type="button" disabled={!canEdit||saving} disabledReason={lockedReason} onClick={()=>{setForm({text:q.text,locale:q.locale,intent:q.intent,engines:q.engines,active:q.active});setEditing({id:q.id,version:q.version})}}>수정</Button><Button variant="panel" size="fit" type="button" disabled={!canEdit||saving} disabledReason={lockedReason} onClick={()=>void send({action:'save_question',id:q.id,expectedVersion:q.version,input:{text:q.text,locale:q.locale,intent:q.intent,engines:q.engines,active:!q.active}},q.active?'질문 추적을 껐습니다.':'질문 추적을 켰습니다.')}>{q.active?'추적 끄기':'추적 켜기'}</Button></span>},
 ];
 const resultColumns:DataColumn<GeoQuestion>[]=[{label:'질문',cell:q=>q.text,sort:q=>q.text},...shownEngines.map(e=>({label:engineLabel(e),cell:(q:GeoQuestion)=>q.engines.includes(e)?<ObservationCell o={latest.get(q.id+':'+e)}/>:'측정 안 함'}))];
 const planBlocked=!canEdit?readOnlyReason:active?'진행 중인 측정이 끝난 뒤 다시 측정할 수 있습니다.':!view.plan.jobs?'켜 둔 질문과 엔진이 없습니다.':view.plan.jobs>view.maxJobs?`질문×엔진은 최대 ${view.maxJobs}개입니다.`:undefined;
 const runCounts=active?Object.entries(jobLabels).map(([k,label])=>[label,active.jobs.filter(j=>j.status===k).length] as const).filter(([,n])=>n>0).map(([l,n])=>`${l} ${n}`):[];
 return <section aria-label="AI 검색 노출 자동 추적" className={styles.section}>
  <h4>AI 검색 노출 자동 추적</h4>
  <p><MetaLine items={['관찰 기록','노출 보장 아님',`브랜드 ${view.brandName}`]}/></p>
  <Note className={styles.note}>엔진 답변은 사용자·위치·시각마다 달라 저장한 발췌와 시각만 근거로 씁니다. 로그인이 필요한 화면은 로그인 필요로 남기고, 질문마다 엔진별로 주 1회 공개 화면 한 장만 읽습니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">새로 조회하고 있습니다.</p>}

  <h5>추적 질문 {view.questions.length}/{view.limit}</h5>
  {view.questions.length?<DataTable rows={view.questions} columns={questionColumns} rowKey={q=>q.id} caption="추적 질문"/>:<EmptyLine first={canEdit?'질문':undefined} next="아래 추천 질문을 고르거나 직접 쓰세요.">추적 질문이 아직 없습니다.</EmptyLine>}
  <form onSubmit={e=>{e.preventDefault();void send({action:'save_question',id:editing?.id,expectedVersion:editing?.version??0,input:form},editing?'질문을 저장했습니다.':'새 질문을 저장했습니다.',()=>{setForm(emptyForm());setEditing(null)})}}><fieldset disabled={saving} className={styles.form}><legend>{editing?'질문 수정':'새 질문'}</legend>
   <label className={styles.wide}>질문<Input maxLength={200} value={form.text} onChange={e=>setForm({...form,text:e.target.value})}/></label>
   <label>언어<NativeSelect value={form.locale} onChange={e=>setForm({...form,locale:e.target.value as GeoQuestionInput['locale']})}>{GEO_LOCALES.map(l=><option key={l} value={l}>{GEO_LOCALE_LABELS[l]}</option>)}</NativeSelect></label>
   <label>유형<NativeSelect value={form.intent} onChange={e=>setForm({...form,intent:e.target.value as GeoQuestionInput['intent']})}>{GEO_INTENTS.map(i=><option key={i} value={i}>{GEO_INTENT_LABELS[i]}</option>)}</NativeSelect></label>
   {GEO_ENGINES.map(e=><label key={e}><CheckInput checked={form.engines.includes(e)} onChange={ev=>setForm({...form,engines:ev.target.checked?GEO_ENGINES.filter(x=>x===e||form.engines.includes(x)):form.engines.filter(x=>x!==e)})}/>{engineLabel(e)}</label>)}
   <label><CheckInput checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>추적 켜기</label>
   <Button variant="panel" size="fit" type="submit" disabled={!canEdit||!form.text.trim()||!form.engines.length} disabledReason={!canEdit?readOnlyReason:!form.text.trim()?'질문을 먼저 쓰세요.':!form.engines.length?'엔진을 하나 이상 고르세요.':undefined}>질문 저장</Button>
   {editing&&<Button variant="panel" size="fit" type="button" onClick={()=>{setForm(emptyForm());setEditing(null)}}>수정 취소</Button>}
  </fieldset></form>

  <h5>확정 사실로 만든 추천 질문</h5>
  {view.starters.length?<><ul>{view.starters.map(s=><li key={s.text}><label><CheckInput checked={picked.includes(s.text)} onChange={e=>setPicked(e.target.checked?[...picked,s.text]:picked.filter(x=>x!==s.text))}/>{s.text}</label> <small><MetaLine items={[GEO_INTENT_LABELS[s.intent],`근거 ${s.basis.length}개`]}/></small></li>)}</ul>
   <Button variant="panel" size="fit" type="button" disabled={!canEdit||saving||!picked.length} disabledReason={!canEdit?readOnlyReason:!picked.length?'저장할 추천 질문을 고르세요.':undefined} onClick={()=>void send({action:'add_starters',texts:picked},'추천 질문을 저장했습니다.',()=>setPicked([]))}>추천 질문 {picked.length}개 저장</Button></>
   :<EmptyLine next="브랜드 사실(주소·대표 메뉴·업종)을 확정하면 추천 질문이 생깁니다.">지금 만들 추천 질문이 없습니다.</EmptyLine>}

  <h5>측정 계획</h5>
  <StatList label="측정 계획과 추정 토큰" items={[['질문',`${view.plan.questions}개`],['엔진',`${view.plan.engines}개`],['측정 수',`${view.plan.jobs}회`],['측정당 추정',formatTokens(view.plan.perJobTokens)],['예상 토큰(추정)',formatTokens(view.plan.totalTokens)],['추정 근거',view.plan.basis==='history'?`최근 측정 ${view.plan.samples}건 평균`:'입력 길이와 보수적 하한']]}/>
  <small>토큰은 추정이며 실제 사용량은 끝난 뒤 기록됩니다. 예산 상한을 넘으면 보내지 않습니다.</small>
  <p><Button variant="panel" size="fit" type="button" disabled={saving||!!planBlocked} disabledReason={planBlocked} onClick={()=>{runKey.current=runKey.current||'geo-run-'+crypto.randomUUID().replaceAll('-','').slice(0,16);void send({action:'start_run',id:runKey.current},'측정을 시작했습니다.',()=>{runKey.current=''})}}>{`${view.plan.questions}개 질문 × ${view.plan.engines}개 엔진 지금 측정`}</Button></p>
  {active&&<div role="status"><MetaLine items={['측정 진행 중',...runCounts]}/> <Button variant="panel" size="fit" type="button" disabled={saving} onClick={()=>void send({action:'advance',runId:active.id},'진행 상태를 확인했습니다.')}>진행 확인</Button> <Button variant="panel" size="fit" type="button" disabled={saving||!canEdit} disabledReason={lockedReason} onClick={()=>void send({action:'cancel_run',runId:active.id},'측정을 중지했습니다.')}>측정 중지</Button></div>}
  {view.runs.filter(r=>r.status!=='running').slice(0,1).map(r=><p key={r.id}><MetaLine items={[`마지막 측정 ${r.createdAt.slice(0,10)}`,r.trigger==='schedule'?'예약':'직접',`완료 ${r.jobs.filter(j=>j.status==='completed').length}`,`실패 ${r.jobs.filter(j=>j.status==='failed').length}`,`중지 ${r.jobs.filter(j=>j.status==='cancelled').length}`]}/></p>)}

  <h5>결과</h5>
  {view.questions.length&&view.observations.length?<DataTable rows={view.questions} columns={resultColumns} rowKey={q=>q.id} caption="질문별 엔진 관찰 결과"/>:<EmptyLine next="측정을 마치면 엔진별 언급과 인용이 여기에 보입니다.">관찰 기록이 아직 없습니다.</EmptyLine>}
  {view.observations.length>0&&<details><summary>최근 관찰 원문 발췌 {Math.min(view.observations.length,20)}건</summary><ul>{view.observations.slice(0,20).map(o=><li key={o.id}><MetaLine items={[o.questionText,engineLabel(o.engine),o.observedAt.slice(0,16).replace('T',' ')+' UTC',o.status==='observed'?'관찰':o.status==='login_required'?'로그인 필요':'답변 없음']}/>{o.answerExcerpt&&<Textarea readOnly aria-label={`${o.questionText} ${engineLabel(o.engine)} 답변 발췌`} value={o.answerExcerpt}/>}{o.citations.length>0&&<ul>{o.citations.map(c=><li key={c.url}><a href={c.url} target="_blank" rel="noreferrer noopener">{c.title||c.domain}</a>{c.brand?' (공식)':''}</li>)}</ul>}</li>)}</ul></details>}

  <h5>보고서 {view.report.week?`${view.report.week} 주`:''}</h5>
  {view.report.engines.length?<DataTable rows={view.report.engines} rowKey={e=>e.engine} caption="엔진별 점유율과 인용률" columns={[{label:'엔진',cell:e=>engineLabel(e.engine)},{label:'점유율(언급/관찰 질문)',cell:e=>`${pct(e.shareOfVoice)} (${e.mentions}/${e.observed})`,sort:e=>e.shareOfVoice??-1},{label:'인용률',cell:e=>`${pct(e.citationRate)} (${e.cited}/${e.observed})`,sort:e=>e.citationRate??-1},{label:'지난주 대비 점유율',cell:e=>pp(e.change.shareOfVoice)},{label:'지난주 대비 인용률',cell:e=>pp(e.change.citationRate)},{label:'측정 못 함',cell:e=>`${e.notObserved}`}]}/>:<EmptyLine next="측정이 쌓이면 엔진별 점유율이 계산됩니다.">보고서에 쓸 관찰 기록이 아직 없습니다.</EmptyLine>}
  {view.report.topDomains.length>0&&<p><MetaLine label="많이 인용된 도메인" items={view.report.topDomains.map(d=>`${d.domain} ${d.count}회${d.brand?'(공식)':''}`)}/></p>}
  <h5>개선 백로그</h5>
  <ul>{view.report.backlog.map(b=><li key={b.id}>{b.text}{b.engines?.length?<> <small><MetaLine items={b.engines.map(engineLabel)}/></small></>:null}</li>)}</ul>
  <form onSubmit={e=>{e.preventDefault();void send({action:'save_site',expectedVersion:view.site.version,...checks},'사이트 점검을 저장했습니다.',()=>setSite(null))}}><fieldset disabled={saving} className={styles.form}><legend>사이트 점검(사람이 확인)</legend>
   <label>JSON-LD<NativeSelect value={checks.jsonLd} onChange={e=>setSite({...checks,jsonLd:e.target.value as GeoSiteState})}>{Object.entries(siteLabels).map(([k,l])=><option key={k} value={k}>{l}</option>)}</NativeSelect></label>
   <label>llms.txt<NativeSelect value={checks.llmsTxt} onChange={e=>setSite({...checks,llmsTxt:e.target.value as GeoSiteState})}>{Object.entries(siteLabels).map(([k,l])=><option key={k} value={k}>{l}</option>)}</NativeSelect></label>
   <Button variant="panel" size="fit" type="submit" disabled={!canEdit} disabledReason={lockedReason}>사이트 점검 저장</Button>
  </fieldset></form>
  <details><summary>llms.txt 템플릿(확정 사실과 공식 URL만)</summary><Textarea readOnly aria-label="llms.txt 템플릿" value={view.llmsTxt}/></details>
 </section>;
}
