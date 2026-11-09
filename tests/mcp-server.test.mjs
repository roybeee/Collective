// G9 MCP 서버 회귀(docs/MCP-SERVER.ko.md). 실제 SQLite(node:sqlite)·실제 라우트(/api/mcp, /api/api-keys, 저장 모양 대조용 /api/action), 합성 데이터.
// 인증(키 없음·틀림·취소 401), 스위치 꺼짐 404(모든 메서드), GET 405, initialize(판 협상)·알림 202·ping·tools/list(범위별)·tools/call(도구 10개 정상 경로),
// 범위(read 키는 초안 도구 isError·쓰기 0, draft 키도 승인·발행·지출·발송 도구 없음), 자율성 금지 403, 인자 오류 -32602, 프로토콜 오류(-32700·-32600·-32601·-32603),
// 출처·MCP-Protocol-Version 확인, 소유자 격리, 키당 1분 60회 429, 감사 api_call(본문 없음), 저장 모양이 기존 저장 경로와 같음.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더). 모델·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const {sql}=rt;
const server=await rt.load('lib/server.ts'),flags=await rt.load('lib/feature-flags.ts'),autonomy=await rt.load('lib/autonomy-server.ts');
const mcp=await rt.load('app/api/mcp/route.ts'),keysRoute=await rt.load('app/api/api-keys/route.ts'),action=await rt.load('app/api/action/route.ts'),mcpLib=await rt.load('lib/mcp/server.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const ORIGIN='https://agency.test',O='g9-mcp-owner',X='g9-mcp-other';
const as=who=>({'oai-authenticated-user-id':who});
const parse=async res=>{const text=await res.text();let body=null;try{body=text?JSON.parse(text):null}catch{body=text}return {status:res.status,body,headers:res.headers,text}};

// ── 1) 합성 데이터: 소유자 O(브랜드 2·캠페인 c1·작업물·성과·증분·학습 규칙), 다른 소유자 X(브랜드·캠페인) ──
const save=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await save(O,'brand','oda',{id:'oda',name:'ODA Pizza',category:'PIZZA',description:'동네 피자'});
await save(O,'brand','ofd',{id:'ofd',name:'Old Ferry Donut',category:'BAKERY',description:'도넛'});
const C1={id:'c1',brandId:'oda',title:'이문 오픈',goal:'평일 방문을 늘린다',audience:'직장인',channels:'Instagram',stores:'',products:'피자',budget:300000,startDate:'2026-10-01',endDate:'2026-10-14',constraints:'할인 없음',sources:'',status:'review',version:2,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-02T00:00:00.000Z'};
await save(O,'campaign','c1',C1);
await save(O,'campaign','c2',{...C1,id:'c2',title:'보관 캠페인',status:'draft',archivedAt:'2026-10-05T00:00:00.000Z'});
await save(O,'artifact','a1',{id:'a1',campaignId:'c1',campaignVersion:2,role:'cmo',title:'실행 브리프',content:'## 목표\n평일 방문',version:1,status:'review',origin:'ai',createdAt:'2026-10-02T00:00:00.000Z'},'c1');
await save(O,'artifact','a0',{id:'a0',campaignId:'c1',campaignVersion:1,role:'cmo',title:'옛 브리프',content:'old',version:1,status:'outdated',origin:'manual',createdAt:'2026-10-01T00:00:00.000Z'},'c1');
await save(O,'metric','m1',{id:'m1',campaignId:'c1',period:'1주차',revenue:1000000,variableCosts:600000,adSpend:100000,productionCost:50000,orders:40,baselineContribution:200000,notes:''},'c1');
await save(O,'incrementality_result','c1',{id:'c1',campaignId:'c1',brandId:'oda',periodStart:'2026-10-01',periodEnd:'2026-10-14',treatedStoreIds:['s1'],controlStoreIds:['s2'],result:{label:'관찰 비교이며 인과 증명이 아닙니다',method:'difference_in_differences',verdict:'positive',reasons:[],period:{start:'2026-10-01',end:'2026-10-14',days:14},prePeriod:{start:'2026-09-17',end:'2026-09-30',days:14},stores:{treated:1,control:1},means:{treatedPre:1,treatedCampaign:2,controlPre:1,controlCampaign:1},liftPerStoreDay:1,liftTotal:14,liftRate:0.5,ci:{low:1,high:2,level:0.95,samples:400}},computedAt:'2026-10-15T00:00:00.000Z',computedBy:{id:O,email:null},version:1},'oda');
const rule=(id,status,expiresAt)=>save(O,'learning_rule',id,{id,brandId:'oda',channel:'Instagram',experimentId:'e',experimentVersion:1,caseId:'k',title:'규칙 '+id,guidance:'첫 3초에 제품',scope:'Instagram 릴스',status,version:1,expiresAt,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z'},'oda');
await rule('r-active','active','2999-01-01T00:00:00.000Z');await rule('r-expired','active','2020-01-01T00:00:00.000Z');await rule('r-paused','paused','2999-01-01T00:00:00.000Z');
await save(X,'brand','xb',{id:'xb',name:'남의 브랜드',category:'',description:''});
await save(X,'campaign','xc',{...C1,id:'xc',brandId:'xb',title:'남의 캠페인'});

// ── 2) 키 만들기(실제 라우트) ──
const keyPost=(owner,input)=>keysRoute.POST(new Request(`${ORIGIN}/api/api-keys`,{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,...as(owner)},body:JSON.stringify(input)})).then(parse);
for(const owner of [O,X])await flags.setFeatureFlag(owner,{flag:'mcp_server',enabled:true},{id:owner,email:null});
const READ=(await keyPost(O,{action:'create',label:'읽기',scope:'read'})).body,DRAFT=(await keyPost(O,{action:'create',label:'초안',scope:'draft'})).body,XKEY=(await keyPost(X,{action:'create',label:'X',scope:'read'})).body;
check('read, draft and other-owner keys were created through the route',[READ,DRAFT,XKEY].every(k=>/^ck_[a-f0-9]{64}$/.test(k.token)));

// ── HTTP 도우미 ──
let seq=0;
const http=(method,token,{body,headers={}}={})=>mcp[method](new Request(`${ORIGIN}/api/mcp`,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{}),...(body!==undefined?{'content-type':'application/json',accept:'application/json, text/event-stream'}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})})).then(parse);
const rpc=(token,method,params,headers)=>http('POST',token,{body:{jsonrpc:'2.0',id:++seq,method,...(params!==undefined?{params}:{})},headers});
const tool=(token,name,args)=>rpc(token,'tools/call',{name,arguments:args});
const audits=()=>sql.prepare("SELECT owner,data FROM records WHERE kind='api_call' ORDER BY rowid").all().map(r=>({...JSON.parse(r.data),owner:r.owner}));
const count=kind=>sql.prepare('SELECT COUNT(*) AS n FROM records WHERE kind=?').get(kind).n;

// ── 3) 인증·스위치·메서드 ──
let r=await rpc(null,'initialize',{});
check('no key is a 401 with a Bearer challenge and a JSON-RPC error',r.status===401&&/Bearer/.test(r.headers.get('www-authenticate'))&&r.body.error.code===-32001&&/API 키/.test(r.body.error.message));
r=await rpc('ck_'+'0'.repeat(64),'initialize',{});
const malformed=await http('POST',null,{body:{jsonrpc:'2.0',id:1,method:'ping'},headers:{authorization:'Bearer not-a-key'}});
check('a wrong or malformed key is the same 401',r.status===401&&malformed.status===401&&r.body.error.message===malformed.body.error.message);
const sessionOnly=await http('POST',null,{body:{jsonrpc:'2.0',id:1,method:'ping'},headers:as(O)});
check('the session identity header alone does not authenticate MCP',sessionOnly.status===401);
r=await http('GET',READ.token);
check('GET (SSE stream) is a 405 that allows POST only',r.status===405&&r.headers.get('allow')==='POST');
check('DELETE (session end) is a 405',(await http('DELETE',READ.token)).status===405);
await flags.setFeatureFlag(X,{flag:'mcp_server',enabled:false},{id:X,email:null});
const off=await Promise.all([rpc(XKEY.token,'initialize',{}),rpc(XKEY.token,'tools/list'),tool(XKEY.token,'list_brands',{}),http('GET',XKEY.token),http('DELETE',XKEY.token)]);
check('switch off for the key owner: every method is a 404 with the same body',off.every(x=>x.status===404)&&new Set(off.map(x=>x.text)).size===1&&!off[0].text.includes('jsonrpc'));
check('switch off writes no audit',audits().filter(a=>a.owner===X).length===0);
await flags.setFeatureFlag(X,{flag:'mcp_server',enabled:true},{id:X,email:null});

// ── 4) initialize·알림·ping·tools/list ──
r=await rpc(READ.token,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});
check('initialize returns protocol 2025-06-18, serverInfo collective and the tools capability',r.status===200&&r.headers.get('content-type')==='application/json'&&r.body.jsonrpc==='2.0'&&r.body.id===seq&&r.body.result.protocolVersion==='2025-06-18'&&r.body.result.serverInfo.name==='collective'&&r.body.result.serverInfo.version==='development'&&typeof r.body.result.capabilities.tools==='object'&&/승인·발행·지출·고객 발송·AI 실행/.test(r.body.result.instructions));
check('initialize echoes a supported older version and falls back to 2025-06-18 otherwise',(await rpc(READ.token,'initialize',{protocolVersion:'2025-03-26'})).body.result.protocolVersion==='2025-03-26'&&(await rpc(READ.token,'initialize',{protocolVersion:'1999-01-01'})).body.result.protocolVersion==='2025-06-18'&&(await rpc(READ.token,'initialize')).body.result.protocolVersion==='2025-06-18');
r=await http('POST',READ.token,{body:{jsonrpc:'2.0',method:'notifications/initialized'}});
check('notifications/initialized is a 202 with no body',r.status===202&&r.text==='');
check('a client response message is accepted with 202',(await http('POST',READ.token,{body:{jsonrpc:'2.0',id:9,result:{}}})).status===202);
r=await rpc(READ.token,'ping');
check('ping returns an empty result',r.status===200&&JSON.stringify(r.body.result)==='{}');
const READ_NAMES=['list_brands','list_campaigns','get_campaign','list_artifacts','get_artifact','get_performance','get_agenda','list_learning_rules'],DRAFT_NAMES=['create_campaign_draft','add_artifact_draft'];
const listed=(await rpc(READ.token,'tools/list',{},{'mcp-protocol-version':'2025-06-18'})).body.result.tools;
check('a read key lists exactly the eight read tools',JSON.stringify(listed.map(t=>t.name))===JSON.stringify(READ_NAMES));
check('read tools declare readOnlyHint and a closed object input schema',listed.every(t=>t.annotations.readOnlyHint===true&&t.annotations.destructiveHint===false&&t.inputSchema.type==='object'&&t.inputSchema.additionalProperties===false&&Array.isArray(t.inputSchema.required)));
const draftListed=(await rpc(DRAFT.token,'tools/list')).body.result.tools;
check('a draft key lists the read tools plus the two draft tools',JSON.stringify(draftListed.map(t=>t.name))===JSON.stringify([...READ_NAMES,...DRAFT_NAMES])&&draftListed.filter(t=>DRAFT_NAMES.includes(t.name)).every(t=>t.annotations.readOnlyHint===false&&t.annotations.destructiveHint===false));
check('every tool has a Korean and English description and a title',draftListed.every(t=>/[가-힣]/.test(t.description)&&/[A-Za-z]{4,} [a-z]+/.test(t.description)&&t.title));
check('no tool can approve, publish, spend, send, activate or delete',!draftListed.some(t=>/approve|publish|spend|send|activate|delete|budget|run_/.test(t.name)));
check('tool definitions do not leak the internal tier or run function',draftListed.every(t=>!('tier' in t)&&!('run' in t)));

// ── 5) 읽기 도구 정상 경로 ──
const ok=async(token,name,args)=>{const x=await tool(token,name,args);assert.equal(x.status,200,name);assert.ok(!x.body.error&&!x.body.result.isError,name+': '+JSON.stringify(x.body).slice(0,300));assert.equal(x.body.result.content[0].type,'text');assert.deepEqual(JSON.parse(x.body.result.content[0].text),x.body.result.structuredContent);return x.body.result.structuredContent};
let s=await ok(READ.token,'list_brands',{});
check('list_brands returns only the owner brands with text and structured content',s.total===2&&s.brands.map(b=>b.id).sort().join()==='oda,ofd'&&!JSON.stringify(s).includes('남의'));
s=await ok(READ.token,'list_campaigns',{});
check('list_campaigns hides archived campaigns by default',s.total===1&&s.campaigns[0].id==='c1'&&s.campaigns[0].status==='review');
s=await ok(READ.token,'list_campaigns',{includeArchived:true,status:'draft'});
check('list_campaigns filters by status and can include archived',s.total===1&&s.campaigns[0].id==='c2'&&s.campaigns[0].archived===true);
check('list_campaigns brand filter',(await ok(READ.token,'list_campaigns',{brandId:'ofd'})).total===0);
s=await ok(READ.token,'get_campaign',{id:'c1'});
check('get_campaign returns the brief summary, status and current artifact titles',s.id==='c1'&&s.status==='review'&&s.brief.goal==='평일 방문을 늘린다'&&s.brief.budget===300000&&s.artifacts.length===1&&s.artifacts[0].title==='실행 브리프'&&s.artifacts[0].status==='review'&&s.outdatedCount===1);
s=await ok(READ.token,'list_artifacts',{campaignId:'c1',includeOutdated:true});
check('list_artifacts can include outdated artifacts',s.artifacts.length===2&&s.artifacts.some(a=>a.status==='outdated'));
s=await ok(READ.token,'get_artifact',{id:'a1'});
check('get_artifact returns the text with origin label and AI disclosure note',s.content==='## 목표\n평일 방문'&&s.origin==='ai'&&s.originLabel==='AI 작성'&&/AI 표시 안내/.test(s.aiNote)&&s.roleLabel==='총괄 파트너');
s=await ok(READ.token,'get_performance',{campaignId:'c1'});
check('get_performance summarises measurements with contribution and ROAS',s.measurements.length===1&&s.measurements[0].contribution===400000&&s.measurements[0].net===250000&&s.measurements[0].roas===10&&s.totals.revenue===1000000&&s.totals.orders===40);
check('get_performance carries the incrementality result with its observational label',s.incrementality&&s.incrementality.verdict==='positive'&&s.incrementality.verdictLabel==='증가 관찰'&&s.incrementality.label==='관찰 비교이며 인과 증명이 아닙니다'&&s.incrementality.liftTotal===14);
s=await ok(READ.token,'get_performance',{campaignId:'c2'});
check('get_performance with nothing recorded returns empty totals and no incrementality',s.measurements.length===0&&s.totals.revenue===null&&s.incrementality===null);
s=await ok(READ.token,'get_agenda',{});
check('get_agenda returns counts that add up and item titles',['overdue','decision','question','signal','upcoming'].every(k=>typeof s.counts[k]==='number')&&Object.values(s.counts).reduce((a,b)=>a+b,0)===s.total&&s.items.every(i=>typeof i.title==='string'&&typeof i.campaignTitle==='string'));
s=await ok(READ.token,'list_learning_rules',{});
check('list_learning_rules returns only active unexpired rules',s.total===1&&s.rules[0].id==='r-active'&&s.rules[0].guidance==='첫 3초에 제품');
check('list_learning_rules brand filter',(await ok(READ.token,'list_learning_rules',{brandId:'ofd'})).total===0);

// ── 6) 소유자 격리 ──
r=await tool(READ.token,'get_campaign',{id:'xc'});
check('owner A key cannot read owner B campaign (isError 404 message)',r.status===200&&r.body.result.isError===true&&/찾을 수 없습니다/.test(r.body.result.content[0].text)&&!JSON.stringify(r.body).includes('남의 캠페인'));
s=await ok(XKEY.token,'list_brands',{});
check('owner B key sees only owner B brands',s.total===1&&s.brands[0].id==='xb');
check('owner B key cannot read owner A artifact',(await tool(XKEY.token,'get_artifact',{id:'a1'})).body.result.isError===true);

// ── 7) 범위 ──
const before={campaign:count('campaign'),artifact:count('artifact'),event:count('event')};
r=await tool(READ.token,'create_campaign_draft',{brandId:'oda',title:'읽기 키 시도',goal:'x'});
const r2=await tool(READ.token,'add_artifact_draft',{campaignId:'c1',role:'content',title:'t',text:'x'});
check('a read key cannot call draft tools (isError with a Korean reason) and writes nothing',[r,r2].every(x=>x.status===200&&x.body.result.isError===true&&/읽기' 범위/.test(x.body.result.content[0].text))&&count('campaign')===before.campaign&&count('artifact')===before.artifact&&count('event')===before.event);
for(const name of ['approve_artifact','review_artifact','publish_submit','ad_activate','send_message','delete_campaign']){
 r=await tool(DRAFT.token,name,{id:'a1'});
 check(`a draft key cannot call ${name} (unknown tool -32602)`,r.status===200&&r.body.error.code===-32602&&/알 수 없는 도구/.test(r.body.error.message));
}

// ── 8) 초안 도구 + 기존 저장 경로와 같은 모양 ──
s=await ok(DRAFT.token,'create_campaign_draft',{brandId:'oda',title:'API 초안',goal:'주말 방문'});
const saved=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' AND json_extract(data,'$.id')=?").get(O,s.id).data);
check('create_campaign_draft saves a draft campaign version 1 and starts no AI job',s.status==='draft'&&saved.status==='draft'&&saved.version===1&&saved.title==='API 초안'&&saved.budget===null&&sql.prepare('SELECT COUNT(*) AS n FROM jobs').get().n===0);
const routeCampaign=await action.POST(new Request(`${ORIGIN}/api/action`,{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,...as(O)},body:JSON.stringify({action:'save_campaign',data:{brandId:'oda',title:'화면 초안',goal:'주말 방문',budget:null}})})).then(parse);
const viaRoute=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' AND json_extract(data,'$.id')=?").get(O,routeCampaign.body.id).data);
check('the MCP campaign draft has the same stored shape as save_campaign',JSON.stringify(Object.keys(saved).sort())===JSON.stringify(Object.keys(viaRoute).sort()));
const events=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event' ORDER BY rowid").all(O).map(x=>JSON.parse(x.data));
const ev=events().find(e=>e.campaignId===s.id);
check('the campaign event names the API key actor and the api channel',ev&&ev.message==='새 캠페인 브리프를 만들었습니다.'&&ev.actor.id===`api_key:${DRAFT.id}`&&ev.via==='api'&&ev.apiKeyId===DRAFT.id);
s=await ok(DRAFT.token,'add_artifact_draft',{campaignId:'c1',role:'content',title:'API 카피',text:'게시물 카피 초안'});
const art=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='artifact' AND json_extract(data,'$.id')=?").get(O,s.id).data);
check('add_artifact_draft saves a review-pending manual artifact (직접 등록), never approved',s.status==='review'&&s.originLabel==='직접 등록'&&art.status==='review'&&art.origin==='manual'&&art.version===1&&art.campaignVersion===2&&art.via==='api'&&art.content==='게시물 카피 초안');
const c1=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' AND json_extract(data,'$.id')='c1'").get(O).data);
check('the campaign goes to review and the event follows the save_artifact wording',c1.status==='review'&&events().some(e=>e.campaignId==='c1'&&e.message==='콘텐츠 스튜디오 작업물 등록 · v1'&&e.actor.id===`api_key:${DRAFT.id}`));
check('the earlier-stage artifact is not outdated by a later-stage draft',JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='artifact' AND json_extract(data,'$.id')='a1'").get(O).data).status==='review');
const routeArtifact=await action.POST(new Request(`${ORIGIN}/api/action`,{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,...as(O)},body:JSON.stringify({action:'save_artifact',campaignId:'c1',role:'data',title:'화면 등록',content:'측정 설계'})})).then(parse);
const routeArt=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='artifact' AND json_extract(data,'$.id')=?").get(O,routeArtifact.body.id).data);
check('the MCP artifact has the save_artifact shape plus via and apiKeyId',JSON.stringify(Object.keys(art).filter(k=>!['via','apiKeyId'].includes(k)).sort())===JSON.stringify(Object.keys(routeArt).sort()));
r=await tool(DRAFT.token,'add_artifact_draft',{campaignId:'xc',role:'content',title:'t',text:'x'});
check('a draft key cannot add an artifact to another owner campaign',r.body.result.isError===true&&!sql.prepare("SELECT id FROM records WHERE owner=? AND kind='artifact' AND parent_id='xc'").get(X));
r=await tool(DRAFT.token,'create_campaign_draft',{brandId:'xb',title:'남의 브랜드',goal:'x'});
check('a draft key cannot create a campaign on another owner brand',r.body.result.isError===true);
await flags.setFeatureFlag(O,{flag:'autonomy_rules',enabled:true},{id:O,email:null});
await autonomy.saveAutonomySettings({owner:O,id:O,email:null,role:'owner'},{settings:{brief_draft:'never'}});
const n=count('campaign');
r=await tool(DRAFT.token,'create_campaign_draft',{brandId:'oda',title:'금지',goal:'x'});
check('create_campaign_draft respects the autonomy rule never for brief drafts',r.body.result.isError===true&&count('campaign')===n);
await flags.setFeatureFlag(O,{flag:'autonomy_rules',enabled:false},{id:O,email:null});

// ── 9) 인자·프로토콜 오류 ──
const err=async(p,code,status=200)=>{const x=await p;return x.status===status&&x.body.error?.code===code};
check('a missing required argument is -32602',await err(tool(READ.token,'get_campaign',{}),-32602));
check('an unknown argument is -32602',await err(tool(READ.token,'list_brands',{owner:X}),-32602));
check('a bad enum value is -32602',await err(tool(READ.token,'list_campaigns',{status:'published'}),-32602));
check('a wrong argument type is -32602',await err(tool(READ.token,'list_artifacts',{campaignId:'c1',includeOutdated:'yes'}),-32602));
check('a bad role for add_artifact_draft is -32602',await err(tool(DRAFT.token,'add_artifact_draft',{campaignId:'c1',role:'boss',title:'t',text:'x'}),-32602));
check('tools/call without params is -32602',await err(rpc(READ.token,'tools/call'),-32602));
check('invalid JSON is -32700 with HTTP 400',await err(http('POST',READ.token,{body:'{not json'}),-32700,400));
check('a batch array is refused with -32600',await err(http('POST',READ.token,{body:[{jsonrpc:'2.0',id:1,method:'ping'}]}),-32600,400));
check('a missing jsonrpc version is -32600',await err(http('POST',READ.token,{body:{id:1,method:'ping'}}),-32600,400));
check('a null id is -32600',await err(http('POST',READ.token,{body:{jsonrpc:'2.0',id:null,method:'ping'}}),-32600,400));
check('an unknown method is -32601',await err(rpc(READ.token,'resources/list'),-32601));
check('an unsupported MCP-Protocol-Version header is a 400',await err(rpc(READ.token,'ping',undefined,{'mcp-protocol-version':'1999-01-01'}),-32600,400));
check('a foreign browser Origin is a 403',await err(rpc(READ.token,'ping',undefined,{origin:'https://evil.test'}),-32600,403));
check('an oversized body is refused',(await http('POST',READ.token,{body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping',params:{pad:'x'.repeat(1048600)}})})).status===413);
sql.prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)").run(`${O}:artifact:broken`,O,'artifact','c1','{broken','2026-10-01');
r=await tool(READ.token,'get_artifact',{id:'broken'});
check('an unexpected failure is -32603 without internals',r.status===200&&r.body.error.code===-32603&&!/JSON|Syntax/.test(r.body.error.message));
sql.prepare("DELETE FROM records WHERE id=?").run(`${O}:artifact:broken`);
check('the mcp library exports the protocol constants',mcpLib.MCP_PROTOCOL_VERSION==='2025-06-18'&&mcpLib.RPC.invalidParams===-32602);

// ── 10) 감사 ──
const mine=audits().filter(a=>a.keyId===READ.id);
check('every tools/call by the read key wrote one api_call audit',mine.length>=20&&mine.every(a=>a.owner===O&&typeof a.at==='string'&&typeof a.ok==='boolean'));
check('audits keep only id, key, tool, ok, error and time',audits().every(a=>Object.keys(a).filter(k=>k!=='owner').every(k=>['id','keyId','tool','ok','error','at'].includes(k))));
check('audits classify scope denial, invalid params, unknown tools and internal errors',['scope_denied','invalid_params','internal'].every(e=>mine.some(a=>a.error===e))&&audits().some(a=>a.keyId===DRAFT.id&&a.error==='unknown_tool'&&a.tool==='approve_artifact'));
check('audits hold no payload text',!sql.prepare("SELECT data FROM records WHERE kind='api_call'").all().map(x=>x.data).join('\n').match(/게시물 카피 초안|주말 방문|평일 방문|API 카피/));
check('protocol methods other than tools/call are not audited',!audits().some(a=>['initialize','ping','tools/list'].includes(a.tool)));
check('no key text is stored anywhere',[READ,DRAFT,XKEY].every(k=>!sql.prepare('SELECT data FROM records').all().some(x=>x.data.includes(k.token))));
const used=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='api_key' AND json_extract(data,'$.id')=?").get(READ.id).data);
check('lastUsedAt is recorded on use',typeof used.lastUsedAt==='string');

// ── 11) 빈도 제한·취소 ──
const RATE=(await keyPost(O,{action:'create',label:'빈도',scope:'read'})).body;
let last=null;for(let i=0;i<61;i++)last=await rpc(RATE.token,'ping');
check('the 61st request in a minute is a 429 with Retry-After',last.status===429&&last.headers.get('retry-after')==='60'&&last.body.error.code===-32029&&/1분에 60회/.test(last.body.error.message));
check('the rate limit is per key: another key still works',(await rpc(READ.token,'ping')).status===200);
await keyPost(O,{action:'revoke',id:READ.id});
check('a revoked key is a 401 on the next request',(await rpc(READ.token,'ping')).status===401);
check('no model or network call was made',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length,checks:passed},null,1));
