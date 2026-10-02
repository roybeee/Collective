'use client';

import {CheckInput} from '@/components/app/check';
import {NativeSelect} from '@/components/ui/native-select';
import {Textarea} from '@/components/ui/textarea';
import {Input as UiInput} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {dateTime} from '@/lib/format';
import {Note} from '@/components/app/note';
import {useEffect,useRef,useState} from 'react';
import styles from './growth-panel.module.css';
import {emptyReconciliationInput,type ReconciliationInput as Input} from '@/lib/growth-reconciliation';

type Commitment={status:string;reservedAmount:number|null;reservedLoss:number|null;actualAmount:number|null;actualLoss:number|null};
export type ReconciliationIntent={id:string;version:number;state:string;currentMissionVersion:number;commitmentId:string;input:{inventoryId:string}};
export type ReconciliationAck={reconciled:true;viewUnavailable:true;resultIntentId:string;duplicate:boolean;mayExecute:false};
export type ReconciliationData={campaignVersion:number;canRecord:boolean;intents:ReconciliationIntent[];inventory:{id:string;version:number}[];commitments:{id:string;version?:number;commitment:Commitment}[];reconciliations:{id:string;intentId:string;intentVersion:number;commitmentVersion:number;input:Input;before:Commitment;after:Commitment;recordedAt:string;source:'operator_attested'}[]};
const amount=(n:number|null|undefined)=>n===null||n===undefined?'미확인':`${n.toLocaleString('ko-KR')}원`;
const modes={partial:'부분 대사 · 예약 유지',final:'최종 실비 대사',release:'무집행 취소 · 예산·재고 해제'};
const states:Record<string,string>={reserved:'예약 유지',unknown:'미확인 · 예약 유지',reconciled:'실비 대사됨',released:'예약 해제됨'};
function versions(intent:ReconciliationIntent,data:ReconciliationData){return {expectedVersion:intent.version,commitmentVersion:data.commitments.find(row=>row.id===intent.commitmentId)?.version??1,missionVersion:intent.currentMissionVersion,inventoryVersion:data.inventory.find(row=>row.id===intent.input.inventoryId)?.version??0,campaignVersion:data.campaignVersion};}
export function GrowthReconciliationPanel({intent,data,busy,onBusy,onSubmit}:{intent:ReconciliationIntent;data:ReconciliationData;busy:boolean;onBusy:(value:boolean)=>void;onSubmit:(payload:Record<string,unknown>)=>Promise<ReconciliationData|ReconciliationAck>}){
 const [input,setInput]=useState<Input>(emptyReconciliationInput),[basis,setBasis]=useState(()=>versions(intent,data)),[error,setError]=useState(''),[message,setMessage]=useState(''),[ackVersion,setAckVersion]=useState<number|null>(null);
 const pending=useRef(false),mounted=useRef(false),retry=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const current=versions(intent,data),stale=Object.entries(current).some(([key,value])=>basis[key as keyof typeof basis]!==value),commitment=data.commitments.find(row=>row.id===intent.commitmentId)?.commitment;
 const unverified=ackVersion!==null&&intent.version<=ackVersion,released=commitment?.status==='released',locked=unverified||busy||!data.canRecord||released||stale;
 const finalReasons=[...(!['failed','observed'].includes(intent.state)?['실행 결과가 확인되어야 최종 대사할 수 있습니다.']:[]),...(input.actualAmount===null||input.actualLoss===null?['누적 실비와 실손실을 모두 확인하세요.']:[]),...(!input.noOutstandingObligations?['잔여 지급·이행 의무가 없음을 확인하세요.']:[])];
 const releaseReasons=[...(intent.state!=='failed'?['실패 확인 상태에서만 무집행 취소할 수 있습니다.']:[]),...(input.actualAmount!==0||input.actualLoss!==0?['실비와 실손실을 모두 명시적으로 0원으로 확인하세요.']:[]),...(!input.noExecution?['외부 접수·집행이 없었음을 확인하세요.']:[]),...(!input.noOutstandingObligations?['잔여 지급·이행 의무가 없음을 확인하세요.']:[])];
 async function save(){
  if(pending.current||busy)return;
  const payload={action:'reconcile_execution',id:intent.id,...basis,input},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.id:crypto.randomUUID();retry.current={key,id:requestId};
  pending.current=true;onBusy(true);setError('');setMessage('');
  try{const next=await onSubmit({...payload,requestId});if(!mounted.current)return;if('viewUnavailable' in next){if(next.resultIntentId!==intent.id)throw new Error('저장 대상 확인이 필요합니다.');retry.current=null;setAckVersion(basis.expectedVersion);setMessage('대사 저장 완료 · 최신 목록 조회 불가. 실행 준비 새로고침으로 현재 상태를 확인하세요.');return;}const updated=next.intents.find(row=>row.id===intent.id);if(!updated)throw new Error('저장된 실행을 확인하지 못했습니다.');setBasis(versions(updated,next));retry.current=null;setMessage(input.mode==='release'?'무집행 취소를 기록하고 예산·재고 예약을 함께 해제했습니다.':'실비·실손실 대사를 기록했습니다.');}
  catch(e){if(mounted.current)setError(`${e instanceof Error?e.message:'대사를 저장하지 못했습니다.'} 입력은 보존했습니다. 응답 미확인 시 동일 입력으로 재시도하고, 충돌 시 새로고침 후 최신 판을 검토하세요.`);}
  finally{pending.current=false;if(mounted.current)onBusy(false);}
 }
 return <section aria-label="실비·손실 대사" className={styles.editor}><h4>실비·손실 대사</h4><Note className={styles.note}>운영자가 확인한 내부 증빙입니다. 외부 공급자의 접수·비용을 자동 검증하지 않습니다. 실패 결과만으로 예약을 해제하지 않습니다.</Note>
 <div aria-label="현재 예산 대사 상태" className={styles.readiness}><p>최초 예산 예약: {amount(commitment?.reservedAmount)} · 손실 예약: {amount(commitment?.reservedLoss)}</p><p>실비: {amount(commitment?.actualAmount)} · 실손실: {amount(commitment?.actualLoss)}</p><p>대사 상태: {commitment?states[commitment.status]??commitment.status:'예산 기록 미확인'}</p><p>저장 기준: 실행 v{basis.expectedVersion} · 예산 v{basis.commitmentVersion} · 미션 v{basis.missionVersion} · 재고 v{basis.inventoryVersion}</p></div>
 {unverified&&<p className={styles.note}>대사는 저장됐습니다. 아래 금액·상태는 마지막 조회 결과이며 최신 상태 확인 전 추가 기록을 중단합니다.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{ackVersion!==null&&!unverified?'대사 저장 완료 · 최신 상태를 확인했습니다.':message}</p>}{stale&&<div className={styles.error}>대상 기록이 변경되었습니다. 현재 예산·실비와 이력을 검토하세요.<p>최신 판: 실행 v{current.expectedVersion} · 예산 v{current.commitmentVersion} · 미션 v{current.missionVersion} · 재고 v{current.inventoryVersion}</p><Button variant="panel" size="fit" type="button" disabled={busy||released||unverified} disabledReason={released?'이미 해제했습니다.':unverified?'확인되지 않은 값입니다. 먼저 확인하세요.':undefined} onClick={()=>{setBasis(current);setAckVersion(null);}}>현재 대사 입력 유지 · 최신 판 사용</Button></div>}
 <form onSubmit={event=>{event.preventDefault();void save();}}><fieldset className={styles.form} disabled={locked}><legend className={styles.srOnly}>실비 대사 입력</legend><label className={styles.wide}>대사 방식<NativeSelect value={input.mode} onChange={event=>setInput(previous=>({...previous,mode:event.target.value as Input['mode'],noExecution:false,noOutstandingObligations:false}))}>{Object.entries(modes).map(([id,label])=><option key={id} value={id}>{label}</option>)}</NativeSelect></label>
 {([['actualAmount','확인한 실비 (원)'],['actualLoss','확인한 실손실 (원)']] as const).map(([key,label])=><label className={styles.field} key={key}>{label}<UiInput type="number" min={0} step={1} value={input[key]??''} onChange={event=>setInput(previous=>({...previous,[key]:event.target.value===''?null:Number(event.target.value)}))}/></label>)}
 <label className={styles.wide}>대사 증빙 내부 ID<UiInput required maxLength={100} value={input.evidenceRef} onChange={event=>setInput(previous=>({...previous,evidenceRef:event.target.value}))}/></label><label className={styles.wide}>대사 확인 내용<Textarea required rows={3} maxLength={1000} value={input.note} onChange={event=>setInput(previous=>({...previous,note:event.target.value}))}/></label>
 {input.mode==='release'&&<><label className={styles.check}><CheckInput checked={input.noExecution} onChange={event=>setInput(previous=>({...previous,noExecution:event.target.checked}))}/>외부 접수·집행이 없었음을 확인했습니다</label></>}{input.mode!=='partial'&&<label className={styles.check}><CheckInput checked={input.noOutstandingObligations} onChange={event=>setInput(previous=>({...previous,noOutstandingObligations:event.target.checked}))}/>잔여 지급·이행 의무가 없음을 확인했습니다</label>}{input.mode==='release'&&<>{!!releaseReasons.length&&<div aria-label="예약 해제 보류 이유" className={styles.wide}><ul>{releaseReasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div>}</>}
 {input.mode==='final'&&!!finalReasons.length&&<ul className={styles.wide}>{finalReasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}<p className={styles.wide}>증빙 ID에는 영문·숫자·밑줄·붙임표를 사용하세요. 기록 시각은 실제 비용 발생 시각이 아닙니다. 금액은 사건별 추가액이 아니라 이 예약에서 확인한 누적 실비·실손실입니다. 이전 확인액보다 낮추거나 미확인으로 되돌릴 수 없습니다. 빈칸은 미확인, 0은 확인한 0원입니다. 부분 대사는 기존 예약과 실비 중 큰 금액으로 한도를 유지합니다. 최종 실비 대사는 재고를 해제하지 않습니다. 무집행 취소는 미배정·미출고 예약 전량인지 서버가 확인한 뒤 예산과 재고를 함께 해제합니다.</p><Button variant="panel" size="fit" type="submit" disabled={!commitment||(input.mode==='release'&&releaseReasons.length>0)||(input.mode==='final'&&finalReasons.length>0)}>대사 기록 저장</Button></fieldset></form>
 <section aria-label="실비 대사 이력"><h4>실비 대사 이력</h4>{data.reconciliations.filter(row=>row.intentId===intent.id).map(row=><article key={row.id} className={styles.mission}><strong>{modes[row.input.mode]} · 실행 v{row.intentVersion} · 예산 v{row.commitmentVersion}</strong><p>서버 기록 시각: {dateTime(row.recordedAt)} · 운영자 확인</p><p>실비 {amount(row.input.actualAmount)} · 실손실 {amount(row.input.actualLoss)}</p><p>증빙: {row.input.evidenceRef}</p><p>{row.input.note}</p><p>예산 상태: {states[row.before.status]??row.before.status} → {states[row.after.status]??row.after.status}</p></article>)}</section>
 </section>;
}
