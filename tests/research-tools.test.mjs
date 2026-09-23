// 조사 도구 위험 등급(security-ops-1 앱 부분): 도구 이름 등급표, 모르는 도구(unknown), 화면 경고 데이터, RESEARCH_TOOL_POLICY=block 정책의 켜짐·꺼짐.
// 근거: mocked(HERMES /v1/capabilities·/v1/toolsets fetch 스텁, 메모리 SQLite). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
let toolsets=[],capabilities=true,listing=true,hang=false;const hermesCalls=[];
const {sql,env,load}=testRuntime(async (url,init)=>{
 hermesCalls.push(url);
 if(hang)return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)));
 if(url.endsWith('/v1/capabilities'))return capabilities?Response.json({object:'hermes.api_server.capabilities',features:{run_submission:true,run_status:true},...(listing?{endpoints:{toolsets:{method:'GET',path:'/v1/toolsets'}}}:{})}):new Response('',{status:503});
 if(url.endsWith('/v1/toolsets'))return Response.json({data:toolsets});
 throw new Error('외부 호출 금지: '+url);
});
const tools=await load('lib/research-tools.ts'),deep=await load('lib/deep-research-server.ts'),start=await load('lib/research-tool-check.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const cfg={provider:'hermes',key:'k',model:'m',endpoint:'https://hermes.example.com'};

// 1) 등급표: HERMES browser·web 도구셋 이름
const table={read:['browser_navigate','browser_snapshot','browser_get_images','browser_vision','browser_back','web_search','web_extract','vision_analyze'],interact:['browser_click','browser_type','browser_press','browser_scroll'],dangerous:['browser_cdp','browser_dialog','browser_console','browser_exec','terminal','process_manage','execute_code','write_file','patch','read_file','computer_use','delegate_task','cronjob_manage','send_message']};
for(const [grade,names] of Object.entries(table))for(const name of names)check(`${name} is ${grade}`,tools.classifyTool(name)===grade);
check('classification ignores letter case',tools.classifyTool('BROWSER_CDP')==='dangerous'&&tools.classifyTool('Browser_Navigate')==='read');

// 2) 모르는 도구: 이름 조각으로 위험·상호작용만 올려 잡고, 읽기로는 추측하지 않는다.
check('unknown MCP tool that evaluates scripts is dangerous',tools.classifyTool('mcp__playwright__browser_evaluate')==='dangerous');
check('unknown file writer is dangerous',tools.classifyTool('mcp_filesystem_write_file')==='dangerous');
check('unknown clicker is interact',tools.classifyTool('aside_click_element')==='interact');
check('unknown browser tool stays unknown',tools.classifyTool('aside_browser')==='unknown');
check('read-looking unknown tool is not guessed as read',tools.classifyTool('instagram_get_posts')==='unknown'&&tools.classifyTool('browser_take_screenshot')==='unknown');
check('code, network and write tool name fragments are dangerous',['python_repl','run_js','http_request','sql_query','ssh','mcp_github_create_issue','fetch','sandbox_exec'].every(n=>tools.classifyTool(n)==='dangerous'));
check('prototype names are unknown, not table hits',['__proto__','constructor','toString','hasOwnProperty'].every(n=>tools.classifyTool(n)==='unknown'));
check('unknown is treated at least as interact',tools.riskRank('unknown')>=tools.riskRank('interact')&&tools.riskRank('unknown')<tools.riskRank('dangerous')&&tools.riskRank('read')<tools.riskRank('interact'));
const grouped=plain(tools.groupToolRisk(['browser_navigate','browser_cdp','browser_navigate','aside_browser','browser_click']));
check('grouping keeps each name once in its grade',JSON.stringify(grouped)===JSON.stringify({read:['browser_navigate'],interact:['browser_click'],dangerous:['browser_cdp'],unknown:['aside_browser']}));
const many=plain(tools.groupToolRisk([...Array.from({length:150},(_,i)=>'custom_tool_'+i),'browser_cdp'],100));
check('group lists are capped without hiding a dangerous tool',many.unknown.length===100&&many.dangerous[0]==='browser_cdp');

// 3) 점검 결과에 등급별 목록과 dangerousAdvertised가 붙는다(운영 목록과 같은 모양: browser 도구셋에 browser_cdp·browser_dialog 포함).
const production=[{name:'browser',enabled:true,configured:true,tools:['browser_back','browser_cdp','browser_click','browser_console','browser_dialog','browser_get_images','browser_navigate','browser_press','browser_scroll','browser_snapshot','browser_type','browser_vision','web_search']},{name:'web',enabled:true,configured:true,tools:['web_extract','web_search']},{name:'terminal',enabled:false,configured:true,tools:['terminal']}];
toolsets=production;let access=plain(await deep.inspectResearchAccess(cfg));
check('inspection groups advertised tools by grade',JSON.stringify(access.toolRisk.dangerous)==='["browser_cdp","browser_console","browser_dialog"]'&&access.toolRisk.interact.length===4&&access.toolRisk.read.includes('web_extract')&&!access.toolRisk.dangerous.includes('terminal'));
check('dangerous tools in the list set dangerousAdvertised',access.dangerousAdvertised===true);
check('toolset names are not classified as tools',!Object.values(access.toolRisk).flat().some(n=>n==='browser'||n==='web'));
check('existing tool list and browser flag are unchanged',access.tools.includes('browser')&&access.tools.includes('browser_cdp')&&access.browser==='advertised');
toolsets=[{name:'web',enabled:true,configured:true,tools:['web_extract','web_search']}];access=plain(await deep.inspectResearchAccess(cfg));
check('read-only list does not advertise dangerous tools',access.dangerousAdvertised===false&&access.toolRisk.read.length===2);
toolsets=[{name:'aside',enabled:true,configured:true,tools:[]}];access=plain(await deep.inspectResearchAccess(cfg));
check('a toolset without resolved tools is graded by its own name',JSON.stringify(access.toolRisk.unknown)==='["aside"]');
check('a toolset without resolved tools is listed as unresolved',JSON.stringify(access.toolRisk.unresolved)==='["aside"]'&&access.toolRisk.invalid===0);
toolsets=[{name:'web',enabled:true,configured:true,tools:['web_search','python repl','도구']}];access=plain(await deep.inspectResearchAccess(cfg));
check('tool names outside the allowed format are counted, not silently dropped',access.toolRisk.invalid===2&&JSON.stringify(access.toolRisk.read)==='["web_search"]');
check('summary shows unresolved toolsets and malformed names',tools.toolRiskView(access).summary.includes('형식 밖 이름 2')&&tools.toolRiskView({...access,toolRisk:{...access.toolRisk,unresolved:['browser']}}).summary.includes('도구 목록 미확인 도구셋 1'));
toolsets='broken';access=plain(await deep.inspectResearchAccess(cfg));
check('unreadable list leaves grades unknown instead of empty',access.toolRisk===undefined&&access.dangerousAdvertised===false);

// 4) 화면 표시 데이터: 긍정 문구 대신 등급 요약, dangerous가 있으면 빨간 경고
toolsets=production;let view=plain(tools.toolRiskView(await deep.inspectResearchAccess(cfg)));
check('summary counts each grade',view.summary==='읽기 7 · 상호작용 4 · 위험 3 · 미분류 0');
check('dangerous tools raise the operations warning',view.warning.includes('서버 훅으로 차단하도록 설치했는지 확인 필요 — 운영 확인 항목')&&view.warning.includes('browser_cdp'));
check('summary no longer claims the browser was confirmed',!view.summary.includes('확인'));
toolsets=[{name:'web',enabled:true,configured:true,tools:['web_search']}];view=plain(tools.toolRiskView(await deep.inspectResearchAccess(cfg)));
check('no warning without dangerous tools',view.warning===null);
view=plain(tools.toolRiskView({checkedAt:'2026-09-24T00:00:00Z',gateway:false,aside:'unverified',browser:'unverified',tools:[],notes:[]}));
check('older stored access without grades shows unverifiable list',view.summary==='목록만으로 확인 불가'&&view.warning===null);
view=plain(tools.toolRiskView({checkedAt:'x',gateway:true,aside:'unverified',browser:'advertised',tools:['x'],notes:[],toolRisk:{read:[],interact:[],dangerous:[],unknown:['aside_browser']},dangerousAdvertised:false}));
check('unknown tools are called out as interact or higher',view.summary.includes('미분류 1')&&view.summary.includes('상호작용 이상'));

// 5) 정책: RESEARCH_TOOL_POLICY=block일 때만 조사 시작을 409로 막는다. 기본은 경고만 남긴다.
check('policy defaults to warn',tools.toolPolicy(undefined)==='warn'&&tools.toolPolicy('')==='warn'&&tools.toolPolicy('warn')==='warn'&&tools.toolPolicy('blocked')==='warn');
check('policy block is explicit',tools.toolPolicy('block')==='block'&&tools.toolPolicy(' BLOCK ')==='block');
const startFails=async(name,expected)=>{let error;try{await start.startResearchAccess(cfg)}catch(e){error=e}assert.ok(error&&error.status===409&&error.message.includes(expected),name+' → '+(error?`${error.status} ${error.message}`:'통과함'));passed.push(name)};
delete env.RESEARCH_TOOL_POLICY;toolsets=production;access=plain(await start.startResearchAccess(cfg));
check('default policy starts research with dangerous tools and keeps the fresh check',access.dangerousAdvertised===true&&access.gateway===true&&access.toolRisk.dangerous.includes('browser_cdp'));
check('default policy records the warning in stored notes',access.notes.some(n=>n.includes('RESEARCH_TOOL_POLICY')&&n.includes('경고만')));
env.RESEARCH_TOOL_POLICY='block';
await startFails('block policy stops research when dangerous tools are listed','browser_cdp');
toolsets=[{name:'web',enabled:true,configured:true,tools:['web_extract','web_search']},{name:'aside',enabled:true,configured:true,tools:['aside_browser']}];access=plain(await start.startResearchAccess(cfg));
check('block policy allows a list without dangerous tools (unknown is not blocked)',access.dangerousAdvertised===false&&access.toolRisk.unknown.includes('aside_browser'));
listing=false;await startFails('block policy fails closed when the tool list is unavailable','도구 목록');listing=true;
toolsets=[{name:'browser',enabled:true,configured:true,tools:[]},{name:'web',enabled:true,configured:true,tools:['web_search']}];
await startFails('block policy refuses a toolset whose tools were not listed (browser with an empty list)','도구 목록');
toolsets=[{name:'web',enabled:true,configured:true,tools:['web_search','python repl']}];
await startFails('block policy refuses tool names outside the allowed format','형식');
capabilities=false;await startFails('block policy fails closed when the check itself fails','도구 점검');
delete env.RESEARCH_TOOL_POLICY;access=plain(await start.startResearchAccess(cfg));capabilities=true;
check('default policy does not stop research when the check fails',access.gateway===false&&access.toolRisk===undefined&&access.notes.some(n=>n.includes('도구 점검')));
env.RESEARCH_TOOL_POLICY='warn';toolsets=production;
check('explicit warn behaves like the default',(await start.startResearchAccess(cfg)).dangerousAdvertised===true);
toolsets=[{name:'browser',enabled:true,configured:true,tools:[]}];
check('warn policy starts research with an unresolved toolset',JSON.stringify(plain(await start.startResearchAccess(cfg)).toolRisk.unresolved)==='["browser"]');
delete env.RESEARCH_TOOL_POLICY;

// 6) 시작 경로 연결(PR6APP-2): 대화형 시작(POST /api/archive/research start)과 브랜드 등록 자동 조사(POST /api/archive create_brand autoResearch).
const server=await load('lib/server.ts'),researchRoute=await load('app/api/archive/research/route.ts'),archiveRoute=await load('app/api/archive/route.ts');
const owner='tool-policy-owner';
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:cfg.endpoint,key:'mock-only-key'})),'HERMES',new Date().toISOString());
const post=async(route,payload)=>{const response=await route.POST(new Request('https://agency.test/api/test',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify(payload)}));return {status:response.status,data:await response.json()}};
const stored=async id=>plain(await server.readRecord(owner,'brand_research',id));
const researchIds=async()=>(await server.listRecords(owner,'brand_research')).map(r=>r.id);
const brand=(id,autoResearch)=>post(archiveRoute,{action:'create_brand',id,...(autoResearch?{autoResearch:true}:{}),data:{name:'도구 점검 '+id,category:'서비스'}});
check('route test brand is created',(await brand('tool-brand')).status===200);
env.RESEARCH_TOOL_POLICY='block';toolsets=production;
let res=await post(researchRoute,{action:'start',id:'tool-start-blocked',brandId:'tool-brand'});
check('interactive start is refused with 409 under block when dangerous tools are listed',res.status===409&&res.data.error.includes('browser_cdp'));
check('a blocked interactive start creates no research',!(await researchIds()).includes('tool-start-blocked'));
toolsets=[{name:'web',enabled:true,configured:true,tools:['web_extract','web_search']}];
res=await post(researchRoute,{action:'start',id:'tool-start-allowed',brandId:'tool-brand'});
check('interactive start under block stores the passing check as research.access',res.status===202&&(await stored('tool-start-allowed')).access.toolRisk.read.length===2);
await post(researchRoute,{action:'cancel',id:'tool-start-allowed'});
delete env.RESEARCH_TOOL_POLICY;toolsets=production;
res=await post(researchRoute,{action:'start',id:'tool-start-warn',brandId:'tool-brand'});
access=(await stored('tool-start-warn')).access;
check('interactive start under warn stores the fresh check with grades',res.status===202&&access.gateway===true&&access.dangerousAdvertised===true&&access.toolRisk.dangerous.includes('browser_cdp')&&access.notes.some(n=>n.includes('경고만')));
await post(researchRoute,{action:'cancel',id:'tool-start-warn'});
let calls=hermesCalls.length;
await post(researchRoute,{action:'start',id:'tool-start-classify',brandId:'tool-brand',mode:'classify'});
check('classification start does not run the tool check',hermesCalls.length===calls);
env.RESEARCH_TOOL_POLICY='block';toolsets=production;
res=await brand('tool-auto-blocked',true);
check('auto research under block registers the brand, queues no research and reports why',res.status===200&&res.data.researchQueued===false&&res.data.researchBlocked.includes('browser_cdp')&&!(await server.listRecords(owner,'brand_research')).some(r=>r.brandId==='tool-auto-blocked'));
toolsets=[{name:'web',enabled:true,configured:true,tools:['web_extract','web_search']}];
res=await brand('tool-auto-allowed',true);
check('auto research under block stores the passing check as research.access',res.status===200&&res.data.researchQueued===true&&(await stored(res.data.researchId)).access.toolRisk.read.length===2);
delete env.RESEARCH_TOOL_POLICY;calls=hermesCalls.length;
res=await brand('tool-auto-warn',true);
check('auto research under warn keeps registration free of gateway calls (unverified access)',res.status===200&&res.data.researchQueued===true&&hermesCalls.length===calls&&(await stored(res.data.researchId)).access.gateway===false&&!('researchBlocked' in res.data));

// 7) 시작 점검 제한 시간: HERMES가 응답하지 않아도 대화형 시작을 호출당 30초씩 붙잡지 않는다(warn은 미확인으로 시작, block은 409).
check('the start-time check uses a short timeout',start.START_CHECK_TIMEOUT_MS<=10000);
// AbortSignal.timeout 타이머는 프로세스를 붙잡지 않으므로 이 구간 동안만 이벤트 루프를 유지한다.
const keepAlive=setInterval(()=>{},1000);hang=true;let began=Date.now();access=plain(await start.startResearchAccess(cfg,'warn',50));
check('a hung gateway resolves the warn start check as unverified within its timeout',Date.now()-began<2000&&access.gateway===false&&access.notes.some(n=>n.includes('점검에 실패')));
let hungError;began=Date.now();try{await start.startResearchAccess(cfg,'block',50)}catch(e){hungError=e}
check('a hung gateway under block refuses the start with 409 within its timeout',Date.now()-began<2000&&hungError?.status===409);
hang=false;clearInterval(keepAlive);

console.log(JSON.stringify({passed:passed.length}));
