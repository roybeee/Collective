// Read-only production boundary probe. It never follows redirects or prints bodies.
// Run explicitly; the regular test runner does not execute this file.
const origin=process.env.COLLECTIVE_PROBE_ORIGIN;
const directOrigin=process.env.COLLECTIVE_PROBE_DIRECT_ORIGIN;
const probeIdentity='collective-security-probe-no-real-user';

function endpoint(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Provide an HTTPS origin without credentials, path, query or fragment.');
 return new URL('/api/channels',url);
}

async function check(label,target,headers){
 try{
  const response=await fetch(target,{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
  const location=response.headers.get('location');
  const login=location?new URL(location,target):null;
  const loginRedirect=[302,303,307,308].includes(response.status)&&login?.origin===target.origin&&login.pathname==='/signin-with-chatgpt';
  const denied=[401,403].includes(response.status)||loginRedirect;
  if(response.body)await response.body.cancel();
  return {check:label,status:denied?'passed':'failed',evidence:'real',httpStatus:response.status};
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
  results.push({check:'authenticated_cross_owner_isolation',status:'not_run',reason:'Requires two authorized sessions and distinct known fixture data; anonymous probes cannot establish this.'});
  process.stdout.write(JSON.stringify({results},null,2)+'\n');
  process.exitCode=results.some(result=>['failed','blocked'].includes(result.status))?1:0;
 }catch{
  process.stdout.write(JSON.stringify({status:'not_run',reason:'Invalid probe origin; use an HTTPS origin only.'})+'\n');
  process.exitCode=2;
 }
}
