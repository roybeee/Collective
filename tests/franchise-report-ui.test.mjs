// 트랙 R R6c '성과' 화면 계약 검사: 실제 경로(/api/franchise, 메모리 D1)로 만든 리드·모집 코드·모집 비용의 GET report 보기를 그대로 화면(React SSR)에 넣어 그리고,
// 화면의 입력 도우미(freezeInput·exportInput·evidenceInput)가 만든 요청을 같은 경로 핸들러로 보낸다. 서버와 화면의 키 이름·요청 모양이 어긋나면 여기서 잡힌다.
// 사례 번호 RU-*는 R6c PR 본문 수용 기준과 같다. 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date, 화면은 react-dom/server).
// 실제 브라우저·로컬 D1은 e2e/franchise-recruit.spec.ts(R6c 여정)가 본다. 값은 모두 합성이다. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';
import {franchiseFixture,captureConsole,DISCLAIMER,NAME} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture(),{sql,env}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const setNow=ms=>f.clock.set(ms-Date.now());
setNow(Date.parse('2026-09-30T03:00:00Z')); // 2026-W40 수요일

// ── 화면 링커(tests/franchise-recruit-ui.test.mjs와 같은 규칙). 화면 문맥의 Date는 서버와 같은 이동 시계다. ──
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),jsxRuntime=require('react/jsx-runtime');
let screenFetch=async()=>{throw new Error('화면 네트워크 호출이 준비되지 않았습니다.')};
const context=createContext({console,URL,URLSearchParams,Date:f.clock.ShiftDate,Intl,TextEncoder,TextDecoder,crypto:globalThis.crypto,setTimeout,clearTimeout,btoa,atob,fetch:(...a)=>screenFetch(...a)});
const transpile=file=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),clause=s.importClause;if(clause?.name)set.add('default');const bound=clause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
const TAGS={Button:'button',Input:'input',Textarea:'textarea',NativeSelect:'select',NativeSelectOption:'option',DialogTitle:'h2',SheetTitle:'h2',DialogDescription:'p',SheetDescription:'p'};
const part=name=>{function Part({children,variant,size,asChild,onOpenChange,onValueChange,...props}){void variant;void size;void asChild;void onOpenChange;void onValueChange;return React.createElement(TAGS[name]||'div',{...props,'data-part':name},children)}Part.displayName=name;return Part};
const REAL_APP=new Set(['./franchise-common']);
const cache=new Map(),synthetic=(names,value)=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,value(n))},{context});
const moduleFor=file=>{file=resolve(file);if(cache.has(file))return cache.get(file);const code=transpile(file),m=new SourceTextModule(code,{context,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m};
function link(spec,ref){
 if(spec==='react')return synthetic(ref.imports.get(spec)||new Set(),n=>React[n]);
 if(spec==='react/jsx-runtime')return synthetic(ref.imports.get(spec)||new Set(),n=>jsxRuntime[n]);
 if(spec.startsWith('@/components/ui/'))return synthetic(ref.imports.get(spec)||new Set(),part);
 if(spec==='lucide-react')return synthetic(ref.imports.get(spec)||new Set(),()=>()=>null);
 if(spec==='./account-context')return synthetic(ref.imports.get(spec)||new Set(),n=>n==='useAccount'?()=>null:()=>false);
 if(spec.startsWith('@/lib/'))return moduleFor(resolve(spec.slice(2))+'.ts');
 if(spec.startsWith('.')&&(ref.identifier.includes('/lib/')||REAL_APP.has(spec))){const base=resolve(dirname(ref.identifier),spec);return moduleFor(existsSync(base+'.ts')?base+'.ts':base+'.tsx')}
 throw new Error('예상하지 못한 import: '+spec);
}
const load=async file=>{const m=moduleFor(file);if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace};
const ui=await load('app/franchise-report-panel.tsx'),common=await load('app/franchise-common.tsx');
const rc=await f.load('lib/franchise-recruitment.ts'),rep=await f.load('lib/franchise-report.ts');
const render=(C,p)=>renderToStaticMarkup(React.createElement(C,p));
const button=(html,label)=>html.includes(`>${label}</button>`);
const asUser=session=>async(url,init={})=>{
 sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
 const headers={...(init.headers||{}),cookie:session.cookie,origin:session.origin};
 return init.method==='POST'?f.route.POST(new Request('https://agency.test'+url,{...init,headers})):f.route.GET(new Request('https://agency.test'+url,{headers}));
};
const as=session=>{screenFetch=asUser(session)};
const view=async(session,params)=>{as(session);return common.franchiseGet({brandId:'fr-a',...params})};
const write=async(session,action,payload)=>{as(session);return common.franchisePost(action,{brandId:'fr-a',...payload})};

// ── 준비: 스위치·프로필·코드 2개·비용·리드 7건(포털 6, 검색광고 1) ──
const WS='ru-owner',boss=f.signIn('ru-boss','admin',1000,WS),member=f.signIn('ru-member','member',2000,WS);
await f.brand(WS,'fr-a');
check('owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);
check('the brand profile is branch A',(await f.profile(boss,'fr-a',{branch:'A'},0)).status===200);
let r=await f.post(boss,{action:'code_issue',brandId:'fr-a',channel:'portal',label:'가상 포털',validFrom:'2026-09-01'});
const PORTAL=r.body.result.code;
r=await f.post(boss,{action:'code_issue',brandId:'fr-a',channel:'search_ad',label:'가상 검색광고',validFrom:'2026-09-01'});
const SEARCH=r.body.result.code;
r=await f.post(boss,{action:'spend_record',brandId:'fr-a',channel:'portal',period:{from:'2026-09-28',to:'2026-09-29'},amount:1234567,vat:'excluded',funding:'hq_budget',evidence:'가상 관리 화면 소진',platform:{impressions:900,clicks:30,formSubmits:null}});
check('setup: a portal spend inside the week',r.status===200);
const leads=[];
for(let i=0;i<6;i++){const c=await f.createLead(boss,'fr-a',{codes:[PORTAL]});assert.equal(c.status,200,JSON.stringify(c.body));leads.push(c.body.result.leadId)}
{const c=await f.createLead(member,'fr-a',{codes:[SEARCH]});assert.equal(c.status,200,JSON.stringify(c.body));leads.push(c.body.result.leadId)}
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#x27;');

// ════ RU-1 직원 화면 ════
const m=await view(member,{view:'report'});
let html=render(ui.FranchiseReport,{brandId:'fr-a',admin:false,initial:m});
const firstNumber=html.search(/<td>\d/);
check('RU-1 the member screen lists attribution≠increment and every report note before any number',firstNumber>0&&html.indexOf(rc.RECRUITMENT_ATTRIBUTION_NOTE)>-1&&html.indexOf(rc.RECRUITMENT_ATTRIBUTION_NOTE)<firstNumber&&m.preview.notes.every(n=>{const at=html.indexOf(esc(n));return at>-1&&at<firstNumber}));
check('RU-1 the disclaimer is shown before any number',html.indexOf(DISCLAIMER)>-1&&html.indexOf(DISCLAIMER)<firstNumber);
check('RU-1 the member sees the aggregate (seven leads, portal six, the one-lead channel merged and suppressed)',html.includes('<td>전체</td><td>7</td>')&&html.includes('<td>창업 포털</td><td>6</td><td>0</td><td>6</td>')&&html.includes('5건 미만 채널 합침 (네이버 검색광고)')&&html.includes('<td>5건 미만</td>'));
check('RU-1 CPL under twenty leads shows the small-sample label and the spend with separators',html.includes('표본 부족(n&lt;20)')&&html.includes('1,234,567원'));
check('RU-1 platform-reported numbers are a separate table with the platform note',html.includes('플랫폼 보고 수치')&&html.includes(rc.PLATFORM_REPORTED_NOTE)&&html.includes('<td>900</td><td>30</td><td>모름</td>'));
check('RU-1 the member has no freeze or download button and sees the member note',!button(html,'이 주 보고 확정')&&!button(html,'Markdown 내려받기')&&html.includes(ui.MEMBER_REPORT_NOTE));
check('RU-1 the screen carries no lead id, system code, contact or recruitment code',leads.every(id=>!html.includes(id)&&!html.includes(f.leadRow(id).systemCode))&&!html.includes(PORTAL)&&!html.includes(NAME)&&!html.includes('이테스트'));

// ════ RU-2 진행 중인 주 ════
const open=await view(boss,{view:'report'});
html=render(ui.FranchiseReport,{brandId:'fr-a',admin:true,initial:open});
check('RU-2 an open week shows the open-week note and no freeze button even for an owner',html.includes(ui.OPEN_WEEK_NOTE)&&!button(html,'이 주 보고 확정')&&!ui.canFreeze(open,true));

// ════ RU-3 끝난 주 확정·내려받기 ════
setNow(Date.parse('2026-10-06T03:00:00Z'));
const closed=await view(boss,{view:'report',week:'2026-W40'});
html=render(ui.FranchiseReport,{brandId:'fr-a',admin:true,initial:closed});
check('RU-3 a closed week offers the freeze button to an owner only',closed.closed===true&&button(html,'이 주 보고 확정')&&ui.canFreeze(closed,true)&&!ui.canFreeze(closed,false));
check('RU-3 freezeInput is the exact server shape (week, confirmed, expected digest)',JSON.stringify(ui.freezeInput(closed))===JSON.stringify({week:'2026-W40',confirmed:true,expected:{digest:closed.digest}}));
r=await write(boss,'report_freeze',ui.freezeInput(closed));
check('RU-3 the screen request freezes the week (200, version 1)',r.status===200&&r.body.result.version===1);
const frozen=await view(boss,{view:'report',week:'2026-W40'});
html=render(ui.FranchiseReport,{brandId:'fr-a',admin:true,initial:frozen});
check('RU-3 the frozen screen shows the version, the re-freeze button and three download buttons',html.includes('확정 판 1')&&button(html,'지금 값으로 다시 확정')&&['Markdown','CSV','JSON'].every(k=>button(html,`${k} 내려받기`))&&!html.includes(ui.CHANGED_NOTE));
r=await write(boss,'report_export',ui.exportInput('2026-W40','md'));
check('RU-3 exportInput downloads the frozen Markdown through the route',r.status===200&&r.body.fileName==='recruitment-report-fr-a-2026-W40.md'&&r.body.body.includes('# 가맹 모집 주간 보고 2026-W40')&&r.body.body.includes('1,234,567원'));
check('RU-3 exportInput keeps an explicit version and omits it otherwise',JSON.stringify(ui.exportInput('2026-W40','csv',1))===JSON.stringify({week:'2026-W40',format:'csv',version:1})&&!('version' in ui.exportInput('2026-W40','md')));
r=await write(member,'report_export',ui.exportInput('2026-W40','md'));
check('RU-3 a member cannot download (server 403)',r.status===403);

// ════ RU-4 확정 뒤 변경 ════
await f.post(boss,{action:'move_stage',brandId:'fr-a',leadId:leads[0],version:f.leadRow(leads[0]).version,to:'contacted'});
const changed=await view(boss,{view:'report',week:'2026-W40'});
html=render(ui.FranchiseReport,{brandId:'fr-a',admin:true,initial:changed});
check('RU-4 a ledger change after the freeze shows the changed note and keeps the frozen version',changed.frozen.changedSinceFreeze===true&&html.includes(ui.CHANGED_NOTE)&&html.includes('확정 판 1'));
r=await write(boss,'report_freeze',ui.freezeInput(closed));
check('RU-4 freezing with the stale digest is 409 REPORT_CHANGED (the screen shows its own note for it)',r.status===409&&r.body.error===f.lib.FRANCHISE_ERRORS.REPORT_CHANGED.text&&/다시 불러온/.test(ui.REPORT_CHANGED_NOTE));
r=await write(boss,'report_freeze',ui.freezeInput(changed));
const two=await view(boss,{view:'report',week:'2026-W40'});
html=render(ui.FranchiseReport,{brandId:'fr-a',admin:true,initial:two});
check('RU-4 re-freezing lists the earlier version with its own download',r.status===200&&html.includes('확정 판 2')&&html.includes('판 1 · '));

// ════ RU-5 스위치 꺼짐 ════
await f.setFlag(boss,false);
const off=await view(boss,{view:'report',week:'2026-W40'});
html=render(ui.FranchiseReport,{brandId:'fr-a',admin:true,initial:off});
check('RU-5 with the switch off the owner cannot freeze but can still download',off.enabled===false&&!button(html,'지금 값으로 다시 확정')&&button(html,'Markdown 내려받기')&&html.includes('확정은 할 수 없습니다'));
await f.setFlag(boss,true);

// ════ RU-6 증빙 묶음 버튼 ════
html=render(common.EvidenceExport,{brandId:'fr-a',scope:'lead',target:leads[0]});
check('RU-6 the evidence button renders with its note',button(html,'증빙 묶음 내려받기')&&html.includes(common.EVIDENCE_EXPORT_NOTE));
r=await write(boss,'evidence_export',common.evidenceInput('lead',leads[0]));
check('RU-6 evidenceInput exports the lead journey through the route without contact values',r.status===200&&JSON.parse(r.body.body).scope==='lead'&&!r.body.body.includes('이테스트'));
check('RU-6 evidenceInput for an asset names assetId',JSON.stringify(common.evidenceInput('asset','ra-1'))===JSON.stringify({scope:'asset',assetId:'ra-1'}));
const detailSrc=readFileSync('app/franchise-lead-detail.tsx','utf8'),assetSrc=readFileSync('app/franchise-assets-panel.tsx','utf8'),panelSrc=readFileSync('app/franchise-panel.tsx','utf8');
check('RU-6 the lead detail and the asset detail show the evidence button to owners and admins only',/\{admin&&<EvidenceExport brandId=\{brandId\} scope="lead" target=\{lead\.id\}\/>\}/.test(detailSrc)&&/\{admin&&<EvidenceExport brandId=\{brandId\} scope="asset" target=\{a\.id\}\/>\}/.test(assetSrc));

// ════ RU-8 적격 판정 코호트(대표 결정 35) ════
{
 const saved=await f.profile(boss,'fr-a',{branch:'A',eligibility:{budgetBands:['100m_150m'],regions:['서울 강남구'],timingBands:['within_3m']}},1);
 check('RU-8 setup: criteria version 1 is saved',saved.status===200);
 for(const id of leads.slice(0,5)){const q=await f.post(boss,{action:'qualify_lead',brandId:'fr-a',leadId:id,version:f.leadRow(id).version,verdict:'qualified',reason:'criteria_met',criteriaVersion:1});assert.equal(q.status,200,JSON.stringify(q.body))}
 const qv=await view(member,{view:'report',week:'2026-W40'}),qhtml=render(ui.FranchiseReport,{brandId:'fr-a',admin:false,initial:qv});
 check('RU-8 the report screen has the cohort qualification table with the note, counts by criteria version and the cost per qualified lead',qhtml.includes('적격 판정(문의 월 코호트)')&&qhtml.includes(esc(rep.QUALIFIED_NOTE))&&qhtml.includes('<td>2026-09</td><td>5</td><td>v1 5</td><td>0</td><td>0</td><td>5건 미만</td><td>표본 부족(n&lt;20)</td>'));
 check('RU-8 the old empty qualified-lead note under the CPL table is gone',!qhtml.includes('비워 둡니다'));
}

// ════ RU-7 탭 연결 ════
check('RU-7 the franchise panel has a 성과 tab after 유입·비용 that renders the report panel',panelSrc.includes('<TabsTrigger value="inflow">유입·비용</TabsTrigger><TabsTrigger value="report">성과</TabsTrigger>')&&panelSrc.includes("shown==='report'?<FranchiseReport key={brandId} brandId={brandId} admin={admin}/>"));
check('RU-7 no external or model call was made',f.calls.length===0&&!logged.some(l=>/franchise_request_failed/.test(l)));

const IDS=['RU-1','RU-2','RU-3','RU-4','RU-5','RU-6','RU-7','RU-8'];
const missing=IDS.filter(id=>!passed.some(n=>n.startsWith(id+' ')));
assert.deepEqual(missing,[],'이름에 없는 사례 번호: '+missing.join(', '));passed.push(`every R6c case id (${IDS.length}) has a named check`);
console.log(JSON.stringify({passed:passed.length}));
