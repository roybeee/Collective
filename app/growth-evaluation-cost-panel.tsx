'use client';
import {useEffect,useState} from 'react';
import {MetaLine} from '@/components/app/meta-line';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Input} from '@/components/ui/input';
import styles from './growth-panel.module.css';
type Overview={connection:{host:string}|null;month:{id:string;capKrw:number;reservedKrw:number;settledKrw:number}|null};
export function GrowthEvaluationCostPanel(){
 const [view,setView]=useState<Overview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [form,setForm]=useState({endpoint:'',key:'',trustKey:'',isolationConfirmed:false,capKrw:0,reason:''});
 useEffect(()=>{const controller=new AbortController();void fetch('/api/eval?boundedCost=1',{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('평가 비용 설정을 불러오지 못했습니다.');const v=await r.json() as Overview;if(!controller.signal.aborted)setView(v);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'조회 실패');});return()=>controller.abort();},[]);
 async function save(action:string){
  setBusy(true);setMessage('');setError('');
  try{const body=action==='save_bounded_connection'?{action,endpoint:form.endpoint,key:form.key,trustKey:form.trustKey,isolationConfirmed:form.isolationConfirmed}:{action,capKrw:form.capKrw,reason:form.reason};
   const r=await fetch('/api/eval',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),v=await r.json() as {error?:string};if(!r.ok)throw Error(v.error??'저장 실패');
   setForm(f=>({...f,key:'',trustKey:''}));setMessage('설정을 저장했습니다. 실제 유료 호출은 후보별 견적 승인 후 실행됩니다.');
   const fresh=await fetch('/api/eval?boundedCost=1',{cache:'no-store'});if(!fresh.ok)throw Error('저장은 완료했으나 최신 조회에 실패했습니다.');setView(await fresh.json());
  }catch(e){setError(e instanceof Error?e.message:'저장 실패');}finally{setBusy(false);}
 }
 return <details className={styles.panel}><summary>Q 평가 공급자·원화 월 한도 설정</summary>
  <p>세금·수수료를 포함한 고정 원화 계약을 검증합니다. USD 환산 추정치는 원화 상한 계약으로 사용할 수 없습니다. 별도 모델의 진단 결과는 운영 프롬프트 승격 근거가 아닙니다.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <p><MetaLine items={[view?.connection?`연결: ${view.connection.host}`:'공급자 미연결',view?.month?`${view.month.id} UTC / 상한 ${view.month.capKrw}원 / 미정산 예약 ${view.month.reservedKrw}원 / 확정 ${view.month.settledKrw}원`:'이번 달 한도 미승인']}/></p>
  <form onSubmit={e=>{e.preventDefault();void save('save_bounded_connection');}}><fieldset disabled={busy} className={styles.form}><legend>전용 평가 연결</legend>
   <label>평가 공급자 HTTPS 주소<Input type="url" required value={form.endpoint} onChange={e=>setForm({...form,endpoint:e.target.value})}/></label>
   <label>평가 인증 키<Input type="password" autoComplete="new-password" required minLength={32} value={form.key} onChange={e=>setForm({...form,key:e.target.value})}/></label>
   <label>계약·영수증 검증 키<Input type="password" autoComplete="new-password" required minLength={32} value={form.trustKey} onChange={e=>setForm({...form,trustKey:e.target.value})}/></label>
   <label><Checkbox required checked={form.isolationConfirmed} onCheckedChange={checked=>setForm({...form,isolationConfirmed:checked===true})}/>운영 연결과 격리된 평가 전용 공급자임을 확인했습니다.</label>
   <p>서버의 EVAL_BOUNDED_ALLOWED_HOSTS 허용 목록 등록이 필요합니다. 미정산 실행이 있으면 연결을 교체할 수 없습니다.</p>
   <Button type="submit" variant="panel" size="fit">평가 연결 검증·저장</Button>
  </fieldset></form>
  <form onSubmit={e=>{e.preventDefault();void save('set_bounded_month_cap');}}><fieldset disabled={busy} className={styles.form}><legend>이번 UTC 월 승인</legend>
   <label>월 평가 지출 상한(원)<Input type="number" min={0} max={1000000000} step={1} required value={form.capKrw} onChange={e=>setForm({...form,capKrw:Number(e.target.value)})}/></label>
   <label>예산 승인 사유<Input required maxLength={500} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
   <Button type="submit" variant="panel" size="fit">원화 월 한도 승인</Button>
  </fieldset></form>
 </details>;
}
