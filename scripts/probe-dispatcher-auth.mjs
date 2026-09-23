// Read-only production boundary probe. It never follows redirects or prints bodies.
// Run explicitly; the regular test runner does not execute this file.
// 사용법(승인받은 운영 origin에만):
//   COLLECTIVE_PROBE_ORIGIN=https://<승인된 사이트> [COLLECTIVE_PROBE_DIRECT_ORIGIN=https://<Worker 직접 주소>] [COLLECTIVE_PROBE_WORKER=1] node scripts/probe-dispatcher-auth.mjs
// COLLECTIVE_PROBE_WORKER=1은 별도 승인 뒤에만 켠다. gate 헤더 없이 형식만 맞는 가짜 작업자 토큰으로 POST /api/research-worker를 한 번 보내고,
// 거부한 쪽을 기록한다. 앱 고유 오류 문구(lib/research-worker.ts)와 앱 응답 헤더(lib/server.ts json)가 모두 맞으면 rejectedBy=app
// (디스패처가 gate를 강제하지 않음), 앱 모양인데 문구나 헤더 한쪽만 맞으면 rejectedBy=unknown(blocked, 수동 확인), 그 밖의 401/403·로그인 리다이렉트면 rejectedBy=dispatcher.
const origin=process.env.COLLECTIVE_PROBE_ORIGIN;
const directOrigin=process.env.COLLECTIVE_PROBE_DIRECT_ORIGIN;
const workerProbe=process.env.COLLECTIVE_PROBE_WORKER==='1';
const probeIdentity='collective-security-probe-no-real-user';
const fakeWorkerToken='0'.repeat(64);
// 형식만 맞는 가짜 토큰·자격증명 없는 owner에 앱이 돌려주는 고정 문구(lib/research-worker.ts workerIdentity).
const appWorkerErrors=['작업자 연결이 해제됐거나 인증이 만료됐습니다.','작업자 인증이 필요합니다.'];

function endpoint(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Provide an HTTPS origin without credentials, path, query or fragment.');
 return new URL('/api/channels',url);
}

function loginRedirect(response,target){
 const location=response.headers.get('location');
 const login=location?new URL(location,target):null;
 return [302,303,307,308].includes(response.status)&&login?.origin===target.origin&&login.pathname==='/signin-with-chatgpt';
}

async function check(label,target,headers){
 try{
  const response=await fetch(target,{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
  const denied=[401,403].includes(response.status)||loginRedirect(response,target);
  if(response.body)await response.body.cancel();
  return {check:label,status:denied?'passed':'failed',evidence:'real',httpStatus:response.status};
 }catch{
  return {check:label,status:'blocked',evidence:'real',reason:'Network or response validation failed; inspect connectivity without logging credentials.'};
 }
}

// The app answers auth failures as exactly {"error":"<message>"} JSON with no-store and nosniff headers (lib/server.ts json/failure).
// Shape alone is not proof: gateways also answer {"error":"Unauthorized"}. The body is compared, never printed.
async function workerRejection(response,target){
 if(loginRedirect(response,target))return 'dispatcher';
 if(![401,403].includes(response.status))return null;
 const headers=response.headers;let error=null;
 if((headers.get('content-type')||'').includes('application/json'))try{const data=JSON.parse(await response.text());if(data&&typeof data.error==='string'&&Object.keys(data).length===1)error=data.error}catch{}
 const appHeaders=(headers.get('cache-control')||'').includes('no-store')&&(headers.get('x-content-type-options')||'').toLowerCase()==='nosniff';
 const appMessage=appWorkerErrors.includes(error);
 return appMessage&&appHeaders?'app':appMessage||(error!==null&&appHeaders)?'unknown':'dispatcher';
}

async function workerCheck(label,value){
 const target=new URL('/api/research-worker',endpoint(value));
 const headers=new Headers({'content-type':'application/json',authorization:'Bearer '+fakeWorkerToken,'x-collective-owner':probeIdentity});
 try{
  const response=await fetch(target,{method:'POST',headers,body:'{}',redirect:'manual',signal:AbortSignal.timeout(15000)});
  const rejectedBy=await workerRejection(response,target);
  if(response.body&&!response.bodyUsed)await response.body.cancel();
  if(!rejectedBy)return {check:label,status:'failed',evidence:'real',httpStatus:response.status};
  if(rejectedBy==='unknown')return {check:label,status:'blocked',evidence:'real',httpStatus:response.status,rejectedBy,reason:'App-shaped rejection did not match the expected app message and headers; inspect manually without logging the body.'};
  return {check:label,status:'passed',evidence:'real',httpStatus:response.status,rejectedBy,gateEnforced:rejectedBy==='dispatcher'};
 }catch{
  return {check:label,status:'blocked',evidence:'real',reason:'Network or response validation failed; inspect connectivity without logging credentials.'};
 }
}

async function probe(label,value){
 const target=endpoint(value);
 const forged=new Headers({'oai-authenticated-user-id':probeIdentity});
 const duplicate=new Headers(forged);duplicate.append('oai-authenticated-user-id',probeIdentity+'-second');
 return Promise.all([
  check(label+':anonymous',target,new Headers()),
  check(label+':forged_identity',target,forged),
  check(label+':duplicate_identity',target,duplicate),
 ]);
}

if(!origin){
 process.stdout.write(JSON.stringify({status:'not_run',reason:'Set COLLECTIVE_PROBE_ORIGIN to the authorized production HTTPS origin.'})+'\n');
 process.exitCode=2;
}else{
 try{
  const results=await probe('dispatcher',origin);
  if(directOrigin)results.push(...await probe('direct_origin',directOrigin));
  else results.push({check:'direct_origin',status:'not_run',reason:'No authorized direct Worker origin supplied.'});
  if(workerProbe)results.push(await workerCheck('dispatcher:worker_without_gate',origin));
  else results.push({check:'dispatcher:worker_without_gate',status:'not_run',reason:'Set COLLECTIVE_PROBE_WORKER=1 only after approval; it sends one POST with a fake worker token and no gate header.'});
  results.push({check:'authenticated_cross_owner_isolation',status:'not_run',reason:'Requires two authorized sessions and distinct known fixture data; anonymous probes cannot establish this.'});
  process.stdout.write(JSON.stringify({results},null,2)+'\n');
  process.exitCode=results.some(result=>['failed','blocked'].includes(result.status))?1:0;
 }catch{
  process.stdout.write(JSON.stringify({status:'not_run',reason:'Invalid probe origin; use an HTTPS origin only.'})+'\n');
  process.exitCode=2;
 }
}
