// G4 공유 링크 회귀(docs/SHARE-LINKS.ko.md). 실제 SQLite(node:sqlite)·실제 라우트(소유자 /api/share, 공개 /api/share/[token]·/share/[token]), 헤더(legacy) 인증, 합성 데이터.
// 스위치 share_links(꺼짐: 만들기 409·공개 404, 목록·취소는 계속), 권한(직원 403), 만들기 → 공개 GET → 취소 → 404, 만료 404, 모르는 토큰 404, 검토자 링크 승인·수정 요청(메시지 필수, 멱등, 외부 행위자 review_decision·이벤트 문장),
// 새 판이 링크를 무효화, 10개 상한, 빈도 제한 429, 토큰 원문 미저장, 공개 응답에 내부 id·주소·전화 없음, HTML 이스케이프·CSP·noindex, kind·스위치·기능표 등록.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더, fetch 스텁). 모델·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const {sql}=rt;
const server=await rt.load('lib/server.ts'),cr=await rt.load('lib/customer-report.ts'),flags=await rt.load('lib/feature-flags.ts'),registry=await rt.load('lib/record-kinds.ts'),status=await rt.load('lib/feature-status.ts');
const pure=await rt.load('lib/share-links.ts'),labels=await rt.load('lib/history-labels.ts');
const ownerRoute=await rt.load('app/api/share/route.ts'),apiRoute=await rt.load('app/api/share/[token]/route.ts'),pageRoute=await rt.load('app/share/[token]/route.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const ORIGIN='https://agency.test';

// ── 1) 합성 데이터: 소유자 O(브랜드 oda, 지점 s1, 동결 보고서 1건, 캠페인 c1, 작업물 a1 v1), 다른 소유자 X ──
const O='g4-owner',X='g4-other',WEEK='2026-W40';
const save=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await save(O,'brand','oda',{id:'oda',name:'오다'});
await save(O,'store','s1',{id:'s1',brandId:'oda',name:'이문점',address:'서울 동대문구 이문로 12',status:'active',version:1},'oda');
const report=cr.buildReport({scope:{type:'store',id:'s1',brandId:'oda',name:'이문점',address:'서울 동대문구 이문로 12',businessPhone:'02-963-1234'},week:WEEK,ledger:cr.aggregateLedger(WEEK,[],[]),days:[],posTotals:[]});
const REPORT_ID=`store:s1:${WEEK}`;
const frozen=v=>({id:REPORT_ID,scope:{type:'store',id:'s1',brandId:'oda'},week:WEEK,version:v,report,inputHash:'h'+v,frozenAt:'2026-10-05T00:00:00.000Z',frozenBy:{id:O,role:'owner'},review:null,history:v>1?[{version:1,report,inputHash:'h1',frozenAt:'2026-10-05T00:00:00.000Z',frozenBy:{id:O,role:'owner'},review:null}]:[]});
await save(O,'customer_report',REPORT_ID,frozen(1),'oda');
await save(O,'campaign','c1',{id:'c1',brandId:'oda',title:'이문 오픈 <캠페인>',goal:'g',version:1,status:'review'});
const ART={id:'a1',campaignId:'c1',campaignVersion:1,role:'cmo',title:'전략 브리프 <b>굵게</b>',content:'## 목표\n평일 방문 <script>alert(1)</script> 초안 job id=0f4b3c2a-1111-4222-8333-444455556666',version:1,status:'review',origin:'manual',createdAt:'2026-10-05T00:00:00.000Z'};
await save(O,'artifact','a1',ART,'c1');
await save(X,'brand','oda',{id:'oda',name:'남의 오다'});

// HTTP 도우미
const as=who=>({'oai-authenticated-user-id':who});
const call=async res=>{const text=await res.text();let body=null;try{body=JSON.parse(text)}catch{body=text}return {status:res.status,body,headers:res.headers}};
const G=(q,h=as(O))=>ownerRoute.GET(new Request(`${ORIGIN}/api/share${q}`,{headers:h})).then(call);
const P=(input,h=as(O))=>ownerRoute.POST(new Request(`${ORIGIN}/api/share`,{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,...h},body:JSON.stringify(input)})).then(call);
const ip=(addr='1.2.3.4')=>({'cf-connecting-ip':addr});
const pubGet=(token,h={})=>apiRoute.GET(new Request(`${ORIGIN}/api/share/${token}`,{headers:{...ip(),...h}}),{params:Promise.resolve({token})}).then(call);
const pubPost=(token,input,h={})=>apiRoute.POST(new Request(`${ORIGIN}/api/share/${token}`,{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,...ip(),...h},body:JSON.stringify(input)}),{params:Promise.resolve({token})}).then(call);
const pageGet=(token,h={})=>pageRoute.GET(new Request(`${ORIGIN}/share/${token}`,{headers:{...ip(),...h}}),{params:Promise.resolve({token})}).then(call);
const pagePost=(token,form,h={})=>pageRoute.POST(new Request(`${ORIGIN}/share/${token}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:ORIGIN,...ip(),...h},body:new URLSearchParams(form).toString()}),{params:Promise.resolve({token})}).then(call);
const rows=()=>sql.prepare("SELECT id,owner,data FROM records WHERE kind='share_link' ORDER BY rowid").all().map(r=>({...JSON.parse(r.data),rowId:r.id,owner:r.owner}));
const decisions=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='review_decision' ORDER BY rowid").all(O).map(r=>JSON.parse(r.data));
const events=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event' ORDER BY rowid").all(O).map(r=>JSON.parse(r.data));
const allData=()=>sql.prepare('SELECT data FROM records').all().map(r=>r.data).join('\n');

// ── 2) 등록 ──
const kinds=plain(registry.recordKinds),kind=kinds.find(k=>k.kind==='share_link');
check('share_link is registered: deleted with its campaign through data.campaignId, otherwise unscoped',kind&&kind.parent==='none'&&kind.campaignDeletion==='delete'&&JSON.stringify(kind.links)==='["data_campaign"]');
check('share_links is a known switch, off by default',flags.FEATURE_FLAGS.share_links?.defaultEnabled===false&&/로그인 없음/.test(flags.FEATURE_FLAGS.share_links.description));
const featureRow=f=>plain(status.featureRows({flags:f})).find(r=>r.key==='share-links');
check('the settings table has a share links row that follows the switch',JSON.stringify([featureRow([{flag:'share_links',enabled:true}]).status,featureRow([{flag:'share_links',enabled:false}]).status,featureRow(null).status])==='["available","blocked","blocked"]'&&featureRow(null).flag==='share_links');
const view=plain(status.featureView(featureRow([{flag:'share_links',enabled:true}])));
check('the share links feature row shows no internal code or middle dot on screen',![view.label,...view.reason].some(t=>/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/.test(t)||t.includes(' · '))&&view.tech.includes('스위치 이름 share_links'));
const src=p=>readFileSync(p,'utf8');
check('the switch is read only in lib/share-links-server.ts',!/isEnabled\(/.test(src('app/api/share/route.ts'))&&!/isEnabled\(/.test(src('app/api/share/[token]/route.ts'))&&!/isEnabled\(/.test(src('app/share/[token]/route.ts'))&&/isEnabled\(owner,'share_links'\)/.test(src('lib/share-links-server.ts')));
check('public routes never log the token',!/console\.(log|error|warn)\([^)]*token/.test(src('lib/share-links-server.ts')+src('app/share/[token]/route.ts')+src('app/api/share/[token]/route.ts')));

// ── 3) 스위치 꺼짐: 만들기 409, 목록 200, 공개 404 ──
let r=await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'점주님'});
check('switch off: create is a 409 and writes nothing',r.status===409&&/share_links/.test(r.body.error)&&rows().length===0);
r=await G(`?kind=customer_report&id=${encodeURIComponent(REPORT_ID)}`);
check('switch off: the owner list still reads',r.status===200&&r.body.enabled===false&&r.body.links.length===0);
r=await pubGet('a'.repeat(64));
check('switch off: unknown public token is 404',r.status===404);
await flags.setFeatureFlag(O,{flag:'share_links',enabled:true},{id:O,email:null});

// ── 4) 권한·입력 ──
r=await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'점주님'},as(X));
check('another workspace cannot link to this report (404 before any write)',r.status===404&&rows().length===0||r.status===409);
r=await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:''});
check('an empty label is a 400',r.status===400&&/라벨/.test(r.body.error));
r=await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'점주님',days:91});
check('more than 90 days is a 400',r.status===400&&/90일/.test(r.body.error));
r=await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'점주님',extra:1});
check('unknown fields are rejected (zod strict)',r.status===400);
r=await P({action:'nope'});
check('an unknown action is a 400',r.status===400);
r=await ownerRoute.POST(new Request(`${ORIGIN}/api/share`,{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.test',...as(O)},body:JSON.stringify({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'x'})})).then(call);
check('cross-origin owner writes are 403',r.status===403);

// ── 5) 보고서 링크: 만들기 → 공개 GET(JSON·HTML) → 조회 수 → 취소 → 404 ──
r=await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'점주님 <b>',days:14});
check('create returns the token once with a 14-day expiry',r.status===200&&/^[a-f0-9]{64}$/.test(r.body.token)&&r.body.state==='active'&&Math.round((Date.parse(r.body.expiresAt)-Date.parse(r.body.createdAt))/86400000)===14&&r.body.scope.version===1);
const T1=r.body.token,L1=r.body.id;
check('the stored row id is the SHA-256 of the token and the token itself is nowhere in the database',rows().length===1&&rows()[0].rowId.startsWith('share_link:')&&rows()[0].rowId.length==='share_link:'.length+64&&!allData().includes(T1)&&!rows()[0].rowId.includes(T1));
r=await G(`?kind=customer_report&id=${encodeURIComponent(REPORT_ID)}`);
check('the owner list shows the link without a token',r.status===200&&r.body.enabled===true&&r.body.links.length===1&&r.body.links[0].id===L1&&!('token' in r.body.links[0])&&r.body.links[0].viewCount===0);
r=await pubGet(T1);
check('public JSON GET returns the report view',r.status===200&&r.body.kind==='customer_report'&&r.body.name==='이문점'&&r.body.week===WEEK&&r.body.version===1&&r.body.label==='점주님 <b>'&&Array.isArray(r.body.ledger)&&r.body.ledger.length>0);
const dumped=JSON.stringify(r.body);
check('public JSON has no store id, brand id, address or phone',!dumped.includes('"id":"s1"')&&!dumped.includes('brandId')&&!dumped.includes('이문로')&&!dumped.includes('02-963')&&!dumped.includes(O));
check('public JSON is no-store, nosniff, noindex and framed out',r.headers.get('cache-control')==='no-store'&&r.headers.get('x-robots-tag')==='noindex, nofollow'&&/frame-ancestors 'none'/.test(r.headers.get('content-security-policy')||''));
r=await pageGet(T1);
check('public HTML page renders title, period, aggregates and the footer',r.status===200&&/text\/html/.test(r.headers.get('content-type'))&&r.body.includes(`이문점 · ${WEEK}`)&&r.body.includes(report.period.from)&&r.body.includes('COLLECTIVE 보고서 · 읽기 전용')&&r.body.includes('만료일')&&r.body.includes('<h2>장부</h2>'));
check('public HTML escapes the label and has no address, phone or inline script',r.body.includes('점주님 &lt;b&gt;')&&!r.body.includes('점주님 <b>')&&!r.body.includes('이문로')&&!r.body.includes('02-963')&&!/<script/.test(r.body));
check('public HTML sets CSP without inline scripts, noindex, no-referrer and no-store',/default-src 'none'/.test(r.headers.get('content-security-policy'))&&!/unsafe-inline/.test(r.headers.get('content-security-policy'))&&r.body.includes('name="robots" content="noindex')&&r.headers.get('referrer-policy')==='no-referrer'&&r.headers.get('cache-control')==='no-store');
r=await G(`?kind=customer_report&id=${encodeURIComponent(REPORT_ID)}`);
check('two public views are counted with a last viewed time',r.body.links[0].viewCount===2&&typeof r.body.links[0].lastViewedAt==='string');
r=await P({action:'revoke',id:L1},as(X));
check('another workspace cannot revoke the link',r.status===404&&rows()[0].revokedAt===null);
r=await P({action:'revoke',id:L1});
check('revoke marks the link and returns it',r.status===200&&r.body.state==='revoked'&&typeof r.body.revokedAt==='string');
r=await pubGet(T1);const page404=await pageGet(T1);
check('a revoked link is a 404 on JSON and HTML',r.status===404&&page404.status===404&&page404.body.includes('링크를 찾을 수 없습니다')&&!page404.body.includes('이문점'));
r=await P({action:'revoke',id:L1});
check('revoking twice is idempotent',r.status===200&&r.body.state==='revoked');

// ── 6) 만료·모르는 토큰·재동결 ──
r=await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'만료 테스트',days:1});
const T2=r.body.token;
sql.prepare("UPDATE records SET data=json_set(data,'$.expiresAt',?) WHERE kind='share_link' AND json_extract(data,'$.id')=?").run('2020-01-01T00:00:00.000Z',r.body.id);
r=await pubGet(T2);
check('an expired link is a 404',r.status===404);
r=await G(`?kind=customer_report&id=${encodeURIComponent(REPORT_ID)}`);
check('the owner list shows the expired state',r.body.links.find(l=>l.label==='만료 테스트').state==='expired');
r=await pubGet('f'.repeat(64));const bad=await pubGet('not-a-token');
check('unknown and malformed tokens are the same 404',r.status===404&&bad.status===404&&r.body.error===bad.body.error);
r=await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'판 고정'});
const T3=r.body.token;
await save(O,'customer_report',REPORT_ID,frozen(2),'oda');
r=await pubGet(T3);
check('a report link stays on the frozen version it was made for after a re-freeze',r.status===200&&r.body.version===1);
r=await P({action:'create',scope:{kind:'customer_report',id:'store:s1:2026-W41'}});
check('a link to a report that was never frozen is a 404 (label checked after scope)',r.status===404||r.status===400);

// ── 7) 검토자 링크: 승인·수정 요청·멱등·외부 행위자·이벤트 문장·새 판 무효화 ──
r=await P({action:'create',scope:{kind:'artifact',id:'a1'},label:'김검토'});
check('a reviewer link pins the artifact version and campaign',r.status===200&&r.body.scope.kind==='artifact'&&r.body.scope.version===1&&r.body.scope.campaignId==='c1');
const R1=r.body.token;
r=await pubGet(R1);
check('public JSON shows the artifact with origin label, version and AI notice',r.status===200&&r.body.kind==='artifact'&&r.body.version===1&&r.body.originLabel==='직접 작성'&&r.body.roleLabel==='총괄 파트너'&&/AI 표시/.test(r.body.aiNotice));
check('public artifact text scrubs internal ids and keeps no raw html',r.body.content.includes('내부 참조')&&!r.body.content.includes('0f4b3c2a'));
r=await pageGet(R1);
check('public HTML escapes the artifact title and content',r.body.includes('전략 브리프 &lt;b&gt;굵게&lt;/b&gt;')&&r.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;')&&!r.body.includes('<script>')&&r.body.includes('name="decision" value="revision"'));
r=await pubPost(R1,{decision:'revision'});
check('a revision without a message is a 400 and writes nothing',r.status===400&&/메시지/.test(r.body.error)&&decisions().length===0);
r=await pubPost(R1,{decision:'maybe'});
check('an unknown decision is a 400',r.status===400);
r=await apiRoute.POST(new Request(`${ORIGIN}/api/share/${R1}`,{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.test',...ip()},body:JSON.stringify({decision:'approved'})}),{params:Promise.resolve({token:R1})}).then(call);
check('a cross-origin public POST is a 403',r.status===403&&decisions().length===0);
r=await apiRoute.POST(new Request(`${ORIGIN}/api/share/${R1}`,{method:'POST',headers:{'content-type':'application/json',origin:'null','sec-fetch-site':'cross-site',...ip()},body:JSON.stringify({decision:'approved'})}),{params:Promise.resolve({token:R1})}).then(call);
const nullNoSite=await apiRoute.POST(new Request(`${ORIGIN}/api/share/${R1}`,{method:'POST',headers:{'content-type':'application/json',origin:'null',...ip()},body:JSON.stringify({decision:'approved'})}),{params:Promise.resolve({token:R1})}).then(call);
check('Origin null is judged by Sec-Fetch-Site: cross-site or missing is a 403',r.status===403&&nullNoSite.status===403&&decisions().length===0);
r=await pagePost(R1,{token:R1,decision:'revision'},{origin:'null','sec-fetch-site':'same-origin'});
check('a no-referrer browser form (Origin null, same-origin) reaches the handler',r.status===400&&r.body.includes('메시지를 적어야 합니다'));
r=await pubPost(R1,{decision:'revision',note:'톤을 더 부드럽게'});
check('a revision with a message records one external decision',r.status===200&&r.body.decision==='revision'&&r.body.repeated===false&&decisions().length===1);
let d=decisions()[0];
check('the review_decision carries the external actor, version, no note text and no reason codes',d.actor.id==='external:김검토'&&d.actor.role==='external'&&d.targetId==='a1'&&d.version===1&&d.decision==='revision'&&d.noteLength===9&&JSON.stringify(d.reasonCodes)==='[]'&&!JSON.stringify(d).includes('부드럽게'));
let ev=events().at(-1);
check('a campaign event is written in the external sentence form',ev.campaignId==='c1'&&ev.message.startsWith('외부 검토자 김검토 · ')&&!ev.actor);
const line=plain(labels.historyLine({kind:'event',event:ev}));
check('history renders the external revision as one sentence with the note aside',/^외부 검토자 김검토가 .*「전략 브리프.*」 v1의 수정을 요청했습니다\.$/.test(line.sentence)&&line.note==='톤을 더 부드럽게');
r=await pubPost(R1,{decision:'revision',note:'다시'});
check('the same decision on the same link is idempotent (no second record)',r.status===200&&r.body.repeated===true&&decisions().length===1);
r=await pagePost(R1,{token:R1,decision:'approved'});
check('the HTML form approval renders the result on the same page and records a second decision',r.status===200&&r.body.includes('승인을 담당자에게 전달했습니다.')&&decisions().length===2&&decisions()[1].decision==='approved'&&decisions()[1].actor.id==='external:김검토');
check('the approval sentence names the external reviewer',/^외부 검토자 김검토가 .*「전략 브리프.*」 v1을 승인했습니다\.$/.test(plain(labels.historyLine({kind:'event',event:events().at(-1)})).sentence));
r=await pagePost(R1,{token:'x'.repeat(64),decision:'approved'});
check('a form whose hidden token differs from the path is rejected',r.status===404&&decisions().length===2);
r=await pagePost(R1,{token:R1,decision:'revision'});
check('the HTML form shows the missing-message error without writing',r.status===400&&r.body.includes('메시지를 적어야 합니다')&&decisions().length===2);
const artifactRow=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='artifact'").get(O);
check('external decisions never change the artifact status',JSON.parse(artifactRow.data).status==='review');
r=await G('?kind=artifact&id=a1');
check('the owner sees both external decisions on the link',r.body.links[0].decisions.revision&&r.body.links[0].decisions.approved&&r.body.links[0].decisions.revision.noteLength===9);
await save(O,'artifact','a1',{...ART,version:2,content:'새 판'},'c1');
r=await pubGet(R1);const post2=await pubPost(R1,{decision:'approved'});
check('a new artifact version invalidates the reviewer link (404 on GET and POST)',r.status===404&&post2.status===404);
r=await P({action:'create',scope:{kind:'artifact',id:'a1'},label:'새 판 검토'});
check('a new reviewer link pins the new version',r.status===200&&r.body.scope.version===2);
await save(O,'artifact','a1',{...ART,version:2,status:'outdated'},'c1');
r=await P({action:'create',scope:{kind:'artifact',id:'a1'},label:'낡은 판'});
check('an outdated artifact cannot get a link',r.status===409);
await save(O,'artifact','a1',{...ART,version:2},'c1');
r=await pubPost(await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'보고서'}).then(x=>x.body.token),{decision:'approved'});
check('a report link accepts no decisions',r.status===404&&decisions().length===2);

// ── 8) 10개 상한(살아 있는 링크만 센다) ──
const made=[];
for(let i=made.length;i<9;i++){const x=await P({action:'create',scope:{kind:'artifact',id:'a1'},label:`검토자 ${i}`});made.push(x)}
check('ten active reviewer links are allowed per artifact version',made.every(x=>x.status===200));
r=await P({action:'create',scope:{kind:'artifact',id:'a1'},label:'열한 번째'});
check('the eleventh reviewer link is a 409',r.status===409&&/10개/.test(r.body.error));
await P({action:'revoke',id:made[0].body.id});
r=await P({action:'create',scope:{kind:'artifact',id:'a1'},label:'자리 생김'});
check('revoking one frees a slot',r.status===200);

// ── 9) 빈도 제한: 토큰 키 60회/15분, IP 키 240회/15분 ──
const T4=(await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'빈도'})).body.token;
let last=200;for(let i=0;i<61&&last===200;i++)last=(await pubGet(T4,ip('9.9.9.'+(i%200)))).status;
check('the 61st view of one token within the window is a 429',last===429);
const T5=(await P({action:'create',scope:{kind:'customer_report',id:REPORT_ID},label:'다른 토큰'})).body.token;
check('another token from another address is unaffected',(await pubGet(T5,ip('8.8.8.8'))).status===200);
let ipStatus=404;for(let i=0;i<241&&ipStatus===404;i++)ipStatus=(await pubGet('e'.repeat(64),ip('7.7.7.7'))).status;
check('guessing tokens from one address is throttled after 240 misses',ipStatus===429);
check('the page shows the throttle message with a 429',(await pageGet(T4,ip('9.9.9.1'))).status===429);

// ── 10) 직원 403, 캠페인 삭제 범위, 순수 함수 ──
const now=Date.now();
check('linkState: revoked wins over expired',pure.linkState({expiresAt:'2000-01-01T00:00:00.000Z',revokedAt:'2001-01-01T00:00:00.000Z'},now)==='revoked'&&pure.linkState({expiresAt:'2000-01-01T00:00:00.000Z',revokedAt:null},now)==='expired');
check('externalEventMessage keeps the note after the decision',pure.externalEventMessage('홍','제목',3,'approved','')==='외부 검토자 홍 · 제목 v3 승인'&&pure.externalEventMessage('홍','제목',3,'revision','메모')==='외부 검토자 홍 · 제목 v3 수정 요청 · 메모');
const scopes=plain(registry.campaignScopes('delete',O,'c1'));
check('campaign deletion reaches share links through data.campaignId',scopes.some(s=>s.kinds.includes('share_link')&&/campaignId/.test(s.where)));
check('no external network call happened',fetchCalls===0);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
