'use client';
import {useEffect,useState} from 'react';
import {Download,RefreshCw,Server,Unplug} from 'lucide-react';
import {Button} from '@/components/ui/button';
type WorkerEvent={email:string|null;at:string}|null;
type WorkerStatus={registered:boolean;activated:boolean;online:boolean;lastSeen:string|null;canInstall:boolean;canRevoke?:boolean;lastIssued?:WorkerEvent;lastRevoked?:WorkerEvent;sshTarget?:string|null;lastStatus:number|null;blocked:number};
const eventText=(label:string,e:WorkerEvent|undefined)=>e?`${label}: ${e.email||'워크스페이스 소유자'} · ${new Date(e.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}`:'';
export function ResearchWorkerNotice(){
 const[state,setState]=useState<WorkerStatus|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let disposed=false;const refresh=async()=>{try{const response=await fetch('/api/research-worker/setup',{cache:'no-store'});if(!response.ok)throw new Error();const value=await response.json() as WorkerStatus;if(!disposed){setState(value);setFailed(false)}}catch{if(!disposed)setFailed(true)}};void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>{disposed=true;clearInterval(timer)}},[]);
 return <p>{failed?'서버 작업자 연결 상태를 확인하지 못했습니다.':!state?'서버 작업자 확인 중…':state.online?'서버 작업자 연결됨 · Mac과 앱을 꺼도 다음 단계와 결과 저장이 이어집니다.':state.activated?'서버 작업자 응답 없음 · 이 화면에서는 계속 확인하며, 화면을 닫은 뒤 자동 진행은 작업자 복구가 필요합니다.':'서버 작업자 설치 전 · 앱을 열어두면 다음 단계와 결과 저장을 이어갑니다. 연결 및 설정에서 서버 실행을 설치하세요.'}</p>
}
export function ResearchWorkerPanel({hermes}:{hermes:boolean}){
 const[state,setState]=useState<WorkerStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){try{const response=await fetch('/api/research-worker/setup',{cache:'no-store'}),data=await response.json() as WorkerStatus & {error?:string};if(!response.ok)throw new Error(data.error||'작업자 상태를 확인하지 못했습니다.');setState(data);setError('')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer)},[]);
 async function action(action:'download'|'revoke'){
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
  <p className="subtle-note">설치 파일에는 이 워크스페이스의 연결 정보가 포함됩니다. 공유하지 말고 설치 확인 후 삭제하세요. 다시 발급하면 이전 파일과 작업자 인증이 무효화됩니다.</p>
  </>:state&&<p className="subtle-note">서버 작업자 설치·다시 발급은 지정된 관리자만 할 수 있습니다.{state.canRevoke?' 연결 해제는 관리자 누구나 할 수 있습니다.':' 연결 해제는 관리자에게 요청하세요.'}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>
}
