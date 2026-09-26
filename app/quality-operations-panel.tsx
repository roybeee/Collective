'use client';
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption as Option} from '@/components/ui/native-select';
import type {Campaign} from '@/lib/agency';
import type {operationsSummary} from '@/lib/eval-operations';
import {authRequest} from './auth-client';

type Evaluation=ReturnType<typeof operationsSummary>&{connection:{configured:boolean;status?:string};usage:{usedTokens:number;reservedTokens:number;monthlyCap:number;smokeCap:number}};
type Registry={units:{unit:string;release:{active:string|null;stagedCampaignIds:string[]}|null}[];versions:{id:string;unit:string;sourceSha:string}[];manifest:string|null};
type Version={build:string;tree:string;promptManifest:string|null};
export function QualityOperationsPanel({campaigns}:{campaigns:Campaign[]}){
 const [data,setData]=useState<{evaluation:Evaluation;registry:Registry;version:Version}|null>(null);
 const [busy,setBusy]=useState(false),pending=useRef(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [unit,setUnit]=useState('channel.offline'),[sha,setSha]=useState(''),[versionId,setVersionId]=useState(''),[runId,setRunId]=useState('');
 const [caseIds,setCaseIds]=useState<string[]>([]),[budget,setBudget]=useState('250000'),[campaignId,setCampaignId]=useState(''),[reason,setReason]=useState('');
 const run=data?.evaluation.runs.find(r=>r.id===runId),versions=data?.registry.versions.filter(v=>v.unit===unit)||[];
 const remaining=data?data.evaluation.usage.monthlyCap-data.evaluation.usage.usedTokens-data.evaluation.usage.reservedTokens:0;
 async function reload(){
  const [evaluation,registry,version]=await Promise.all([authRequest<Evaluation>('/api/eval?view=operations'),authRequest<Registry>('/api/prompts'),authRequest<Version>('/api/version')]);
  setData({evaluation,registry,version});
 }
 async function perform(work:()=>Promise<unknown>,success:string){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
  try{await work();setMessage(success);try{await reload()}catch(e){setError('작업 뒤 상태 조회 실패: '+(e instanceof Error?e.message:'조회 버튼으로 다시 확인하세요.'))}}
  catch(e){setError(e instanceof Error?e.message:'요청을 처리하지 못했습니다. 자동 재시도하지 않습니다.')}
  finally{pending.current=false;setBusy(false)}
 }
 const mutate=(path:string,input:Record<string,unknown>,success:string)=>perform(()=>authRequest(path,input),success);
 const selectedSealed=data?.evaluation.cases.some(c=>caseIds.includes(c.id)&&c.set==='sealed');
 const gateOk=!!run?.gate?.ok&&run.pair?.unit===unit&&run.pair.candidateVersionId===versionId;
 return <section aria-label="운영 검증과 프롬프트 적용">
  <h3>운영 검증과 프롬프트 적용</h3>
  <p className="subtle-note">소유자 전용입니다. 평가 입력·출력 원문은 표시하지 않고 실행 상태와 합계만 확인합니다.</p>
  <Button disabled={busy} onClick={()=>void perform(async()=>{},'운영 상태를 조회했습니다.')}>운영 상태 조회</Button>
  {error&&<p role="alert" className="form-error">{error}</p>}{message&&<p role="status">{message}</p>}
  {data&&<div className="space-y-5 mt-4">
   <dl className="break-all text-sm"><dt>운영 빌드</dt><dd>{data.version.build}</dd><dt>운영 tree</dt><dd>{data.version.tree}</dd><dt>프롬프트 매니페스트</dt><dd>{data.version.promptManifest??'코드 기본값'}</dd></dl>
   <p>평가 연결: {data.evaluation.connection.status??'미설정'} · 월 사용 {data.evaluation.usage.usedTokens.toLocaleString()} / {data.evaluation.usage.monthlyCap.toLocaleString()} 토큰 · 예약 제외 잔여 {remaining.toLocaleString()}</p>
   <label className="block">평가 실행<NativeSelect aria-label="운영 평가 실행" value={runId} onChange={e=>setRunId(e.target.value)}><Option value="">실행 선택</Option>{data.evaluation.runs.map(r=><Option key={r.id} value={r.id}>{r.label||r.id} · {r.id} · {r.status}</Option>)}</NativeSelect></label>
   {run&&<div><p>{run.id} · {run.status} · 완료 {run.completed}/{run.total} · 사용 {run.usedTokens.toLocaleString()} 토큰</p>
    <p>HERMES 실행 번호 확인: {run.submitted}/{run.total}</p>
    {Object.keys(run.failures).length>0&&<pre aria-label="평가 실패 사유 집계" className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(run.failures,null,2)}</pre>}
    <Button disabled={busy||['running','queued'].includes(run.status)||run.variant==='judge'} onClick={()=>void mutate('/api/eval',{action:'regrade_run',id:run.id},'재채점을 저장했습니다. 모델 토큰은 사용하지 않았습니다.')}>선택 실행 재채점 · 토큰 0</Button>
    {run.regrade&&<><p>최근 재채점: {run.regrade.at} · {run.regrade.gradersVersion}</p><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(run.regrade.totals,null,2)}</pre></>}
    {run.gate&&<><p>쌍 평가 게이트: {run.gate.ok?'통과':'미통과'}</p><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(run.gate,null,2)}</pre></>}
   </div>}
   <form className="space-y-3" onSubmit={e=>{e.preventDefault();void mutate('/api/prompts',{action:'register',unit,sourceSha:sha},'후보 버전을 등록했습니다. 아직 적용하지 않았습니다.')}}>
    <h4>1. 병합된 후보 등록</h4><label className="block">프롬프트 단위<NativeSelect aria-label="운영 프롬프트 단위" value={unit} onChange={e=>{setUnit(e.target.value);setVersionId('')}}>{data.registry.units.map(u=><Option key={u.unit} value={u.unit}>{u.unit}</Option>)}</NativeSelect></label>
    <label className="block">병합 커밋 SHA<Input aria-label="후보 병합 SHA" value={sha} onChange={e=>setSha(e.target.value.trim())} pattern="[0-9a-f]{40}" required/></label><Button type="submit" disabled={busy||!/^[0-9a-f]{40}$/.test(sha)}>후보 등록</Button>
   </form>
   <form className="space-y-3" onSubmit={e=>{e.preventDefault();void mutate('/api/eval',{action:'start_run',label:`운영 화면 쌍 평가 ${unit}`,variant:'pair',pair:{unit,candidateVersionId:versionId},caseIds,tokenBudget:Number(budget)},'쌍 평가 실행을 생성했습니다. 운영 상태 조회로 진행 상황을 확인하세요.')}}>
    <h4>2. 기존 버전과 쌍 평가</h4><label className="block">후보 버전<NativeSelect aria-label="운영 후보 버전" value={versionId} onChange={e=>setVersionId(e.target.value)}><Option value="">등록된 후보 선택</Option>{versions.map(v=><Option key={v.id} value={v.id}>{v.id}</Option>)}</NativeSelect></label>
    <fieldset><legend>평가 케이스 · 봉인 케이스 1건 이상 포함</legend><div className="max-h-48 overflow-auto">{data.evaluation.cases.map(c=><label className="block text-sm" key={c.id}><input type="checkbox" checked={caseIds.includes(c.id)} onChange={e=>setCaseIds(ids=>e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/> {c.set} · {c.kind} · {c.role} · {c.id}</label>)}</div></fieldset>
    <label className="block">실행 토큰 상한<Input aria-label="쌍 평가 토큰 상한" type="number" min="1" max={data.evaluation.usage.smokeCap} value={budget} onChange={e=>setBudget(e.target.value)} required/></label>
    <p className="subtle-note">각 케이스를 두 번 실행합니다. 월 예산·평가 전용 연결·봉인 회귀 검사는 서버에서 확인합니다.</p>
    <Button type="submit" disabled={busy||!versionId||!selectedSealed||!Number.isSafeInteger(Number(budget))||Number(budget)<=0||Number(budget)>data.evaluation.usage.smokeCap||data.evaluation.connection.status!=='ready'||data.evaluation.runs.some(r=>['running','queued'].includes(r.status))}>쌍 평가 시작</Button>
   </form>
   <form className="space-y-3" onSubmit={e=>{e.preventDefault();void mutate('/api/prompts',{action:'stage',unit,versionId,evalRunId:runId,campaignIds:[campaignId],approval:{reason}},'지정 캠페인 적용을 저장했습니다. 전체 캠페인으로 자동 확대하지 않습니다.')}}>
    <h4>3. 게이트 통과 후 지정 캠페인에 적용</h4><label className="block">적용 캠페인<NativeSelect aria-label="프롬프트 적용 캠페인" value={campaignId} onChange={e=>setCampaignId(e.target.value)}><Option value="">캠페인 선택</Option>{campaigns.map(c=><Option key={c.id} value={c.id}>{c.title}</Option>)}</NativeSelect></label>
    <label className="block">적용 사유<Input aria-label="프롬프트 적용 사유" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} required/></label>
    <p className="subtle-note">위에서 선택한 쌍 평가와 후보가 일치해야 합니다. 기존 고정 버전은 유지하며, 최종 게이트는 서버에서 다시 확인합니다.</p><Button type="submit" disabled={busy||!gateOk||!campaignId||!reason.trim()}>지정 캠페인 적용</Button>
   </form>
   <p className="break-all text-sm">현재 단위 적용: {data.registry.units.find(u=>u.unit===unit)?.release?.active??'코드 기본값'}</p>
  </div>}
 </section>;
}
