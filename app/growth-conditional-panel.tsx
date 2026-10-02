'use client';
import {CheckInput} from '@/components/app/check';
import {NativeSelect} from '@/components/ui/native-select';
import {Textarea} from '@/components/ui/textarea';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {enumLabel} from '@/lib/ui-copy';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthConditionalView} from '@/lib/growth-conditional-server';
import {geoEngines,pilotChecks,type GeoObservationInput,type PilotInput} from '@/lib/growth-conditional';
import styles from './growth-panel.module.css';
type View=GrowthConditionalView;
const checkLabels:Record<typeof pilotChecks[number],string>={productEligibility:'상품 수입·판매 자격',rightsCleared:'권리',logistics:'물류',returnsPolicy:'반품',fxBasis:'환율 기준',settlementPath:'정산 경로',taxCustoms:'세금·통관'};
const pilotLabels={blocked:'막힘',not_ready:'준비 안 됨',ready_for_owner_decision:'대표 결정 대기(출시 아님)'} as const;
const emptyGeo=():GeoObservationInput=>({engine:'chatgpt',query:'',observedAt:'',cited:false,citedUrl:'',referralSessions:null,note:''});
const emptyPilot=():PilotInput=>({country:'',offerId:'',currency:'',priceLocal:null,fxKrwPerUnit:null,landedCostKrw:null,expectedReturnRate:null,checks:Object.fromEntries(pilotChecks.map(k=>[k,{status:'unknown',evidenceRef:''}])) as PilotInput['checks']});
export function GrowthConditionalPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[geo,setGeo]=useState<GeoObservationInput>(emptyGeo),[pilot,setPilot]=useState<PilotInput>(emptyPilot),[pilotVersion,setPilotVersion]=useState(0),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const reading=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null);
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const r=await fetch(`/api/growth/conditional?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal:controller.signal}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'조회하지 못했습니다.');if(!controller.signal.aborted)setView(v as View);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'조회 실패');}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{void Promise.resolve().then(()=>load());return()=>reading.current?.abort();},[load]);
 async function send(body:Record<string,unknown>,done:string){if(saving||!view)return;const payload={campaignId,campaignVersion:view.campaignVersion,...body},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/conditional',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId})}),v=await r.json() as {error?:string;version?:number};if(!r.ok)throw new Error(v.error??'저장하지 못했습니다.');retry.current=null;setMessage(done);if(body.action==='save_geo')setGeo(emptyGeo());else setPilotVersion(v.version??0);await load();}catch(e){setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다.`);}finally{setSaving(false)}}
 const n=(v:string)=>v===''?null:Number(v);
 return <section aria-label="조건부 확장 검토" className={styles.panel}><header className={styles.header}><h3>조건부 확장 · GEO·해외·MMM</h3><Button variant="panel" size="fit" aria-label="조건부 검토 새로고침" type="button" disabled={loading} onClick={()=>void load()}>새로고침</Button></header>
  <Note className={styles.note}>데이터·권리·사업성이 준비될 때만 여는 원안 선택 카드입니다. 구조화 데이터는 노출·인용 보장이 아니고, 해외 파일럿은 대표 결정 전 출시하지 않으며, MMM은 충분한 장기·변동 지출 이력이 없으면 실행하지 않고 예산을 배분하지 않습니다. 외부 고객 서비스(G2-23/24)는 별도 사업 결정이 필요합니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">조건부 검토를 조회하고 있습니다.</p>}
  {view&&<><h4>GEO · 상품 구조화 데이터</h4><ul>{view.geo.products.map(p=><li key={p.offerId}>{p.title}: {p.ready?<Textarea readOnly aria-label={`${p.title} JSON-LD`} value={JSON.stringify(p.jsonLd,null,1)}/>:p.missing.join(' ')}</li>)}</ul>
   <p>AI 답변 관측 {view.geo.summary.checks}회 · 인용 {view.geo.summary.cited}회 · 유입 세션 {view.geo.summary.referralSessions??'미확인'} · 주문은 추적 코드로 별도 확인</p>
   {view.canEdit&&<form onSubmit={e=>{e.preventDefault();void send({action:'save_geo',id:`geo-${crypto.randomUUID().slice(0,8)}`,expectedVersion:0,input:{...geo,observedAt:geo.observedAt?new Date(geo.observedAt).toISOString():''}},'관측을 기록했습니다.');}}><fieldset disabled={saving} className={styles.form}><legend>AI 답변 인용 관측</legend>
    <label>AI 답변 서비스<NativeSelect value={geo.engine} onChange={e=>setGeo({...geo,engine:e.target.value as GeoObservationInput['engine']})}>{geoEngines.map(x=><option key={x} value={x}>{enumLabel('geoEngine',x)}</option>)}</NativeSelect></label><label className={styles.wide}>질문<Input maxLength={300} value={geo.query} onChange={e=>setGeo({...geo,query:e.target.value})}/></label>
    <label>관측 시각<Input type="datetime-local" value={geo.observedAt} onChange={e=>setGeo({...geo,observedAt:e.target.value})}/></label><label><CheckInput checked={geo.cited} onChange={e=>setGeo({...geo,cited:e.target.checked,citedUrl:e.target.checked?geo.citedUrl:''})}/>우리 페이지 인용됨</label>
    {geo.cited&&<label className={styles.wide}>인용 URL<Input value={geo.citedUrl} onChange={e=>setGeo({...geo,citedUrl:e.target.value})}/></label>}<label>유입 세션(분석 도구)<Input type="number" min={0} value={geo.referralSessions??''} onChange={e=>setGeo({...geo,referralSessions:n(e.target.value)})}/></label>
    <Button variant="panel" size="fit" type="submit" disabled={!geo.query||!geo.observedAt}>관측 기록</Button></fieldset></form>}
   <h4>해외 파일럿 준비</h4><ul>{view.overseas.map(p=><li key={p.id}>{p.input.country} · {p.input.offerId} · {pilotLabels[p.assessment.status]} · 단위 공헌이익 {p.assessment.unitContributionKrw===null?'미확인':`${p.assessment.unitContributionKrw.toLocaleString('ko-KR')}원`}{p.assessment.reasons.length?` · ${p.assessment.reasons.join(', ')}`:''}{view.canEdit&&<Button variant="panel" size="fit" type="button" onClick={()=>{setPilot(structuredClone(p.input));setPilotVersion(p.version);}}>{p.input.country} 수정</Button>}</li>)}</ul>
   {view.canEdit&&<form onSubmit={e=>{e.preventDefault();void send({action:'save_pilot',id:`pilot-${pilot.country.toLowerCase()}`,expectedVersion:pilotVersion,input:pilot},'파일럿 준비를 저장했습니다.');}}><fieldset disabled={saving} className={styles.form}><legend>국가별 준비</legend>
    <label>국가 코드<Input maxLength={2} value={pilot.country} onChange={e=>setPilot({...pilot,country:e.target.value.toUpperCase()})}/></label><label>현지 통화<Input maxLength={3} value={pilot.currency} onChange={e=>setPilot({...pilot,currency:e.target.value.toUpperCase()})}/></label>
    <label>오퍼<NativeSelect value={pilot.offerId} onChange={e=>setPilot({...pilot,offerId:e.target.value})}><option value="">오퍼 선택</option>{view.offers.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</NativeSelect></label>
    <label>현지 가격<Input type="number" min={0} step="any" value={pilot.priceLocal??''} onChange={e=>setPilot({...pilot,priceLocal:n(e.target.value)})}/></label><label>환율(원/현지 1단위)<Input type="number" min={0} step="any" value={pilot.fxKrwPerUnit??''} onChange={e=>setPilot({...pilot,fxKrwPerUnit:n(e.target.value)})}/></label>
    <label>도착 원가(원)<Input type="number" min={0} value={pilot.landedCostKrw??''} onChange={e=>setPilot({...pilot,landedCostKrw:n(e.target.value)})}/></label><label>예상 반품률(0~1)<Input type="number" min={0} max={1} step={0.01} value={pilot.expectedReturnRate??''} onChange={e=>setPilot({...pilot,expectedReturnRate:n(e.target.value)})}/></label>
    {pilotChecks.map(k=><div key={k}><label>{checkLabels[k]}<NativeSelect value={pilot.checks[k].status} onChange={e=>setPilot({...pilot,checks:{...pilot.checks,[k]:{...pilot.checks[k],status:e.target.value as 'unknown'|'confirmed'|'blocked'}}})}><option value="unknown">미확인</option><option value="confirmed">확인</option><option value="blocked">막힘</option></NativeSelect></label><label>{checkLabels[k]} 증빙 ID<Input value={pilot.checks[k].evidenceRef} onChange={e=>setPilot({...pilot,checks:{...pilot.checks,[k]:{...pilot.checks[k],evidenceRef:e.target.value}}})}/></label></div>)}
    <Button variant="panel" size="fit" type="submit" disabled={!pilot.country||!pilot.offerId||!pilot.currency}>파일럿 준비 저장</Button></fieldset></form>}
   <h4>MMM 타당성</h4><p>{view.mmm.status==='not_run'?'실행하지 않음':'검토 가능(예산 배분 없음)'} · 사용 가능한 주 {view.mmm.usableWeeks} · 변동 채널 {view.mmm.variedChannels.join(', ')||'없음'}</p>{view.mmm.reasons.map(r=><p key={r}>{r}</p>)}</>}
 </section>;
}
