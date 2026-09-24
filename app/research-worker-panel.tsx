'use client';
import {useEffect,useState} from 'react';
import {Download,RefreshCw,Server,Unplug} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {AdminOnly} from './account-context';
type WorkerEvent={email:string|null;at:string}|null;
type Rejected='expired'|'grace_ended'|'unknown_token'|'gate';
type WorkerStatus={registered:boolean;activated:boolean;online:boolean;lastSeen:string|null;canInstall:boolean;canRevoke?:boolean;lastIssued?:WorkerEvent;lastRevoked?:WorkerEvent;sshTarget?:string|null;lastStatus:number|null;blocked:number;
 expiryEnforced?:boolean;expiresAt?:string|null;rotationOfferedAt?:string|null;rotationReady?:boolean|null;graceUntil?:string|null;lastRejectedAt?:string|null;lastRejectedReason?:Rejected|null;gate?:'ok'|'missing'|'mismatch'|'unset'|null;gateEnforced?:boolean};
const eventText=(label:string,e:WorkerEvent|undefined)=>e?`${label}: ${e.email||'워크스페이스 소유자'} · ${new Date(e.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}`:'';
const kst=(at:string)=>new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
const rejectedText:Record<Rejected,string>={expired:'만료된 토큰',grace_ended:'유예가 끝난 이전 설치의 토큰',unknown_token:'폐기됐거나 일치하지 않는 토큰',gate:'사이트 gate 헤더 불일치'};
// 작업자 토큰 만료·자동 교체·재발급 유예·최근 거부(security-ops-4). 시각은 서버가 준 값만 쓴다. 대표·관리자에게만 내려오는 값이다.
// 만료는 RESEARCH_WORKER_TOKEN_EXPIRY=enforce일 때만 켜지고, 자동 교체는 작업자가 새 토큰을 저장할 수 있다고 알렸을 때만 약속한다.
function credentialNotes(s:WorkerStatus){
 if(!s.registered)return [];
 const now=Date.now(),left=s.expiresAt?Math.ceil((Date.parse(s.expiresAt)-now)/86400000):null;
 return [
  !s.expiryEnforced?'토큰 만료·자동 교체: 꺼짐 · 이 작업자 토큰은 연결 해제나 다시 발급 전까지 유효합니다.'+(s.rotationReady?' 작업자는 새 토큰을 저장할 수 있다고 알렸습니다.':''):!s.expiresAt?'토큰 만료: 없음(만료를 켜기 전에 발급) · 설치 파일을 다시 발급하면 90일 만료가 적용됩니다.':left!==null&&left<=0?`토큰 만료됨(${kst(s.expiresAt)}) · 작업자가 거부됩니다. 설치 파일을 다시 발급해 서버에 다시 설치하세요.`:`토큰 만료: ${kst(s.expiresAt)} (${left}일 남음) · ${s.rotationReady?'만료 14일 전부터 작업자가 새 토큰으로 자동 교체합니다.':'작업자가 자동 교체 가능을 알리지 않았습니다(설정 폴더 쓰기 불가 또는 이전 버전 작업자). 만료 전에 설치 파일을 다시 발급해 설치하세요.'}`,
  s.rotationOfferedAt?now-Date.parse(s.rotationOfferedAt)>3600000?`자동 교체가 ${kst(s.rotationOfferedAt)}부터 끝나지 않았습니다. 작업자가 새 토큰을 저장하지 못하고 있을 수 있습니다. 만료 전에 설치 파일을 다시 발급해 설치하세요.`:'자동 교체 진행 중 · 작업자가 새 토큰으로 응답하면 이전 토큰은 폐기됩니다.':'',
  s.graceUntil?`이전 설치 유예: ${kst(s.graceUntil)}까지 이전 작업자 토큰도 받습니다. 그 전에 새 설치 파일로 서버를 다시 설치하세요.`:'',
  s.lastRejectedAt?`최근 거부된 작업자 요청: ${kst(s.lastRejectedAt)} · ${s.lastRejectedReason?rejectedText[s.lastRejectedReason]:'인증 실패'}${s.lastSeen&&Date.parse(s.lastSeen)>Date.parse(s.lastRejectedAt)?' · 이후 정상 응답이 있었습니다.':''}`:'',
 ].filter(Boolean);
}
// 사이트 공통 gate를 앱도 확인한 결과(security-ops-7). 기본은 기록만 하고 RESEARCH_WORKER_APP_GATE=enforce일 때만 막는다.
function gateNote(s:WorkerStatus){
 if(!s.gate)return '';
 const seen=s.gate==='ok'?'최근 작업자 요청의 사이트 gate 헤더를 앱에서도 확인했습니다.':s.gate==='missing'?'최근 작업자 요청이 앱에 사이트 gate 헤더 없이 도착했습니다.':s.gate==='mismatch'?'최근 작업자 요청의 사이트 gate 헤더가 앱 설정과 다릅니다.':'앱에 사이트 gate 값이 없어 헤더를 확인하지 못했습니다.';
 return seen+(s.gateEnforced?' 앱 gate 차단이 켜져 있습니다.':' 앱 gate 차단은 꺼져 있어 기록만 합니다.');
}
// 브랜드 아카이브 배너: 거부·만료·교체 지연을 일반 '응답 없음' 대신 사유와 재발급 안내로 보여 준다(security-ops-4 권고 4 앱 측).
// 사유는 대표·관리자에게만 내려오므로 일반 멤버에게는 기존 문구만 보인다. 이메일·Slack 알림은 없다(docs/SECURITY-BOUNDARIES.ko.md).
function workerAlert(s:WorkerStatus){
 const reissue=' 연결 및 설정에서 설치 파일을 다시 발급하세요.';
 if(s.lastRejectedAt&&!s.online&&(!s.lastSeen||Date.parse(s.lastRejectedAt)>Date.parse(s.lastSeen)))return `서버 작업자 요청이 거부되고 있습니다(${s.lastRejectedReason?rejectedText[s.lastRejectedReason]:'인증 실패'}).`+reissue;
 if(s.expiresAt&&Date.parse(s.expiresAt)<=Date.now())return '서버 작업자 토큰이 만료됐습니다.'+reissue;
 if(s.rotationOfferedAt&&Date.now()-Date.parse(s.rotationOfferedAt)>3600000)return `서버 작업자 토큰 자동 교체가 ${kst(s.rotationOfferedAt)}부터 끝나지 않았습니다. 만료 전에`+reissue;
 return null;
}
export function ResearchWorkerNotice(){
 const[state,setState]=useState<WorkerStatus|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let disposed=false;const refresh=async()=>{try{const response=await fetch('/api/research-worker/setup',{cache:'no-store'});if(!response.ok)throw new Error();const value=await response.json() as WorkerStatus;if(!disposed){setState(value);setFailed(false)}}catch{if(!disposed)setFailed(true)}};void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>{disposed=true;clearInterval(timer)}},[]);
 const alert=!failed&&state?workerAlert(state):null;
 return <><p>{failed?'서버 작업자 연결 상태를 확인하지 못했습니다.':!state?'서버 작업자 확인 중…':state.online?'서버 작업자 연결됨 · Mac과 앱을 꺼도 다음 단계와 결과 저장이 이어집니다.':state.activated?'서버 작업자 응답 없음 · 이 화면에서는 계속 확인하며, 화면을 닫은 뒤 자동 진행은 작업자 복구가 필요합니다.':'서버 작업자 설치 전 · 앱을 열어두면 다음 단계와 결과 저장을 이어갑니다. 연결 및 설정에서 서버 실행을 설치하세요.'}</p>{alert&&<p role="alert">{alert}</p>}</>
}
export function ResearchWorkerPanel({hermes}:{hermes:boolean}){
 const[state,setState]=useState<WorkerStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){try{const response=await fetch('/api/research-worker/setup',{cache:'no-store'}),data=await response.json() as WorkerStatus & {error?:string};if(!response.ok)throw new Error(data.error||'작업자 상태를 확인하지 못했습니다.');setState(data);setError('')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer)},[]);
 async function action(action:'download'|'revoke'){
  if(action==='download'&&state?.registered&&state.online&&!window.confirm('가동 중 워커는 10분 안에 새 설치가 필요합니다. 다시 발급하면 지금 작업자는 10분 뒤 멈추고, 새 설치 파일로 서버를 다시 설치해야 이어집니다. 계속할까요?'))return;
  setBusy(true);setError('');try{
   const response=await fetch('/api/research-worker/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
   if(!response.ok){const result=await response.json() as {error?:string};throw new Error(result.error||'설정을 저장하지 못했습니다.')}
   if(action==='download'){const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='install-collective-server.py';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
   await refresh();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <section className="settings-card worker-card"><div className="settings-icon"><Server/></div><h2>Mac 없이 브랜드 조사</h2><p>Hetzner의 브라우저와 작업자가 조사 단계를 이어가고, 자료와 최종 결과를 브랜드 아카이브에 저장합니다.</p>
  <div className="connection-status" role="status"><span className={state?.online?'connected':''}/>{!state?'연결 상태 확인 중':state.online?'서버 작업자 연결됨':state.activated?'서버 작업자 응답 없음':state.registered?'설치 파일 발급됨 · 서버 설치 대기':'서버 작업자 설치 전'}</div>
  {state?.lastSeen&&<p className="subtle-note">마지막 응답: {new Date(state.lastSeen).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}{!state.online?' · 작업자 연결을 복구해야 화면을 닫아도 계속 진행됩니다.':''}</p>}
  {!!state?.blocked&&<p className="notice">접수 확인이 필요한 조사 {state.blocked}건이 있습니다. 해당 브랜드의 조사 기록에서 기존 요청을 확인하세요.</p>}
  {!!state?.lastStatus&&state.lastStatus>=400&&<p className="notice">최근 조사 처리 응답: {state.lastStatus}. 해당 브랜드의 진행 상태와 오류를 확인하세요.</p>}
  {state?.canRevoke&&credentialNotes(state).map(note=><p key={note} className="subtle-note">{note}</p>)}
  {state?.canRevoke&&gateNote(state)&&<p className="subtle-note">{gateNote(state)}</p>}
  {state?.canInstall&&<>
  <ol className="worker-steps"><li>진행 중인 AI 작업을 완료하거나 중지한 뒤 설치 파일을 받으세요.</li><li>Mac 터미널에서 아래 두 명령을 실행하세요. sudo 권한이 있는 서버 계정으로 접속하며, 서버 설치에 몇 분이 걸릴 수 있습니다.</li><li>위 상태가 ‘서버 작업자 연결됨’으로 바뀌면 새 심층 조사를 시작하세요.</li></ol>
  <pre className="worker-command">{`scp ~/Downloads/install-collective-server.py ${state.sshTarget||'<서버 접속 주소>'}:~/\nssh -t ${state.sshTarget||'<서버 접속 주소>'} 'sudo python3 ~/install-collective-server.py'`}</pre>
  {!state.sshTarget&&<p className="subtle-note">‘&lt;서버 접속 주소&gt;’를 sudo 권한이 있는 계정@서버 주소로 바꿔 실행하세요. 배포 환경변수 RESEARCH_WORKER_SSH_TARGET을 설정하면 이 자리에 표시됩니다.</p>}
  <p className="subtle-note">기존 Hetzner Ubuntu 서버용입니다. 설치 중 기본 HERMES 연결을 재시작합니다. 서버 브라우저의 로그인 상태는 별도이며, 로그인이 필요한 자료는 조사 한계로 기록합니다.</p>
  </>}
  <div className="worker-actions">{state?.canInstall&&<Button disabled={busy||!hermes} onClick={()=>action('download')}><Download/>{state.registered?'설치 파일 다시 발급':'서버 설치 파일 받기'}</Button>}<Button variant="outline" disabled={busy} onClick={refresh}><RefreshCw/>상태 확인</Button>{state?.canRevoke&&state.registered&&<Button variant="ghost" disabled={busy} onClick={()=>action('revoke')}><Unplug/>작업자 연결 해제</Button>}</div>
  {(state?.lastIssued||state?.lastRevoked)&&<p className="subtle-note">{[eventText('마지막 설치 파일 발급',state.lastIssued),eventText('마지막 연결 해제',state.lastRevoked)].filter(Boolean).join(' · ')}</p>}
  {state?.canInstall?<>
  {!hermes&&<p className="subtle-note">먼저 HERMES를 연결하세요.</p>}
  <p className="subtle-note">설치 파일에는 이 워크스페이스의 연결 정보가 포함됩니다. 공유하지 말고 설치 확인 후 삭제하세요. 다시 발급하면 이전 파일은 무효가 되고, 가동 중인 작업자는 10분 동안만 이전 인증으로 계속 동작합니다. 바로 멈추려면 먼저 작업자 연결 해제를 누르세요.</p>
  </>:state&&<AdminOnly><p className="subtle-note">서버 작업자 설치·다시 발급은 지정된 관리자만 할 수 있습니다.{state.canRevoke?' 연결 해제는 관리자 누구나 할 수 있습니다.':' 연결 해제는 관리자에게 요청하세요.'}</p></AdminOnly>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>
}
