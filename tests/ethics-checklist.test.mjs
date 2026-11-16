// 사람 확인 체크리스트(마케팅 스킬 이식 계획 P6, 스위치 ethics_review_checklist): 순수 목록(신호 → 항목·근거), 화면 사전 3개 언어,
// 스위치 꺼짐일 때 규정 점검 보기가 그대로인지, 표시 기록 왕복(추가 전용·권한·판 충돌·입력 검사·승인을 막지 않음), 다시 점검 뒤에도 남는지, 패널 연결(정적).
// 근거: mocked(메모리 SQLite, 헤더 세션 주입, fetch 스텁). 모델·외부 네트워크 호출은 0회다. 데이터는 합성(실제 고객·매장 아님).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const ec=await rt.load('lib/ethics-checklist.ts'),lexicon=await rt.load('lib/graders/compliance-lexicon.ts'),registry=await rt.load('lib/record-kinds.ts');
const server=await rt.load('lib/server.ts'),flags=await rt.load('lib/feature-flags.ts');
const sourcesRoute=await rt.load('app/api/artifact-sources/route.ts'),usageRoute=await rt.load('app/api/usage/route.ts'),actionRoute=await rt.load('app/api/action/route.ts');
const plain=x=>JSON.parse(JSON.stringify(x));
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};

// ── 1) 순수 목록: 신호 → 항목 ──
const ids=list=>list.map(i=>i.id);
const signals=(over={})=>({...plain(ec.NO_SIGNALS),...over});
const ALWAYS=['staged_spontaneous','material_omission','rights_scope','vulnerable_minors'];
check('ten items with unique ids in a fixed order',ec.ETHICS_ITEMS.length===10&&new Set(ids(ec.ETHICS_ITEMS)).size===10&&JSON.stringify(ids(ec.ETHICS_ITEMS))===JSON.stringify(plain(ec.ETHICS_ITEM_IDS)));
const base=plain(ec.ethicsChecklist(signals()));
check('without signals only the four always-on items appear, with no triggers',JSON.stringify(ids(base))===JSON.stringify(ALWAYS)&&base.every(i=>i.triggers.length===0));
const added=over=>ids(plain(ec.ethicsChecklist(signals(over)))).filter(id=>!ALWAYS.includes(id));
check('a price adds the required-labeling item',JSON.stringify(added({price:true}))==='["required_labeling"]');
check('an endorsement adds disclosure placement and authority items',JSON.stringify(added({endorsement:true}))==='["disclosure_placement","authority_expert"]');
check('an AI image adds the AI disclosure placement item',JSON.stringify(added({ai_image:true}))==='["ai_disclosure_placement"]');
check('franchise content adds required labeling and partner revenue',JSON.stringify(added({franchise:true}))==='["required_labeling","partner_revenue"]');
check('a non-Korean output adds the target-country item',JSON.stringify(added({foreign_language:true}))==='["target_country"]');
const all=plain(ec.ethicsChecklist(signals({price:true,endorsement:true,ai_image:true,franchise:true,foreign_language:true})));
check('all signals give all ten items',all.length===10);
check('triggers name every signal that added the item',JSON.stringify(all.find(i=>i.id==='required_labeling').triggers)==='["price","franchise"]');
check('the output language ko does not add the target-country item; en and ja do',!plain(ec.ethicsSignals('',{outputLanguage:'ko'})).foreign_language&&plain(ec.ethicsSignals('',{outputLanguage:'en'})).foreign_language&&plain(ec.ethicsSignals('',{outputLanguage:'ja'})).foreign_language);
const cs=t=>plain(ec.contentSignals(t));
check('content signals: price',cs('떡볶이 4,500원').price&&cs('오늘만 20% 할인').price&&cs('$12 only').price);
check('content signals: endorsement',cs('체험단 후기 모음').endorsement&&cs('#광고 협찬 받았습니다').endorsement&&cs('전문가 추천').endorsement);
check('content signals: AI image',cs('생성형 AI로 만든 매장 이미지').ai_image&&cs('가상 인플루언서 루나').ai_image);
check('content signals: franchise',cs('가맹 상담 문의').franchise&&cs('입점 제안을 받습니다').franchise);
check('plain copy raises no signal',JSON.stringify(cs('평일 오후 방문이 많습니다. 따뜻하게 받아 가세요.'))==='{"price":false,"endorsement":false,"ai_image":false,"franchise":false}');
check('record signals: a registered AI image and a recruitment objective count even without words',(()=>{const s=plain(ec.ethicsSignals('평일 방문',{outputLanguage:'ko',aiImage:true,franchise:true}));return s.ai_image&&s.franchise&&!s.price})());

// ── 2) 근거 ──
const laws=ec.ETHICS_ITEMS.filter(i=>i.basis.kind==='law');
check('law bases point at an existing lexicon source and name an article',laws.length>=5&&laws.every(i=>lexicon.COMPLIANCE_LEXICON.sources[i.basis.sourceId]&&i.basis.article&&i.basis.law));
check('items without a checked law row say unverified or operating standard',ec.ETHICS_ITEMS.filter(i=>i.basis.kind!=='law').every(i=>['unverified','operating'].includes(i.basis.kind))&&ec.ETHICS_ITEMS.find(i=>i.id==='partner_revenue').basis.kind==='operating'&&ec.ETHICS_ITEMS.find(i=>i.id==='target_country').basis.kind==='unverified');

// ── 3) 입력 검사·마지막 표시 ──
const items=plain(ec.ethicsChecklist(signals()));
const parse=v=>plain(ec.parseEthicsMark(v,items));
check('a valid mark is trimmed',JSON.stringify(parse({itemId:'rights_scope',status:'held',note:'  허락서 확인 중 '}))==='{"mark":{"itemId":"rights_scope","status":"held","note":"허락서 확인 중"}}');
check('unknown item, item outside the list, bad status, bad note and long note are rejected',[{itemId:'x',status:'held'},{itemId:'target_country',status:'held'},{itemId:'rights_scope',status:'ok'},{itemId:'rights_scope',status:'held',note:3},{itemId:'rights_scope',status:'held',note:'가'.repeat(301)}].every(v=>'error' in parse(v)));
check('the last mark per item wins',JSON.stringify(plain(ec.latestMarks([{itemId:'a',n:1},{itemId:'b',n:2},{itemId:'a',n:3}])).map(m=>m.n))==='[3,2]');

// ── 4) 화면 사전(ko·en·ja) ──
const dict=lang=>{const src=readFileSync(`lib/i18n/${lang}-trust.ts`,'utf8');return new Map([...src.matchAll(/'(ethics\.[\w.]+)':'((?:[^'\\]|\\.)*)'/g)].map(m=>[m[1],m[2]]))};
const ko=dict('ko'),en=dict('en'),ja=dict('ja');
check('every item has a question in ko, en and ja',ec.ETHICS_ITEM_IDS.every(id=>[ko,en,ja].every(d=>(d.get(`ethics.item.${id}`)??'').endsWith('?'))));
check('every signal, status and basis kind has a label in all three languages',[...ec.ETHICS_SIGNALS.map(s=>`ethics.trigger.${s}`),...ec.ETHICS_MARK_STATUSES.map(s=>`ethics.status.${s}`),'ethics.trigger.always','ethics.basis.law','ethics.basis.unverified','ethics.basis.operating'].every(k=>ko.has(k)&&en.has(k)&&ja.has(k)));
check('the three dictionaries have the same ethics keys',ko.size>=30&&[...ko.keys()].every(k=>en.has(k)&&ja.has(k))&&en.size===ko.size&&ja.size===ko.size);

// ── 5) 합성 데이터와 세션 ──
const O='workspace',X='other-ws',ADMIN='a'.repeat(64),MEMBER='b'.repeat(64),OTHER='c'.repeat(64),now=new Date().toISOString();
for(const [id,role,token,ws] of [['admin','admin',ADMIN,O],['member','member',MEMBER,O],['x-admin','admin',OTHER,X]]){
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',Date.now());
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
}
const cookie=token=>({cookie:'__Host-collective_session='+token});
const get=async(id,token=ADMIN)=>{const r=await sourcesRoute.GET(new Request('https://app.test/api/artifact-sources?artifact='+id,{headers:cookie(token)}));return {status:r.status,data:await r.json()}};
const post=async(mod,token,data)=>{const r=await mod.POST(new Request('https://app.test/api/test',{method:'POST',headers:{...cookie(token),origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}};
const put=(kind,id,data,parent='',owner=O)=>server.recordStatement(owner,kind,id,data,parent).run();
const setFlag=(enabled,owner=O)=>flags.setFeatureFlag(owner,{flag:'ethics_review_checklist',enabled},{id:'admin',email:null});
await put('brand','gb',{id:'gb',name:'가상분식',short:'GB'});
await put('campaign','c1',{id:'c1',brandId:'gb',title:'가상분식 오픈',goal:'첫 포장 주문',version:1,status:'review',createdAt:now,updatedAt:now});
await put('campaign','c2',{id:'c2',brandId:'gb',title:'Global launch',goal:'visits',version:1,status:'review',outputLanguage:'en',createdAt:now,updatedAt:now});
const CONTENT='## 게시물 카피\n체험단 후기를 모아 소개합니다. 떡볶이 4,500원.\n영수증 리뷰 이벤트로 음료를 증정합니다.';
const artifact=(id,campaignId,content,extra={})=>put('artifact',id,{id,campaignId,campaignVersion:1,role:'content',title:'콘텐츠 '+id,content,version:1,status:'review',origin:'manual',createdAt:now,...extra},campaignId);
await artifact('a1','c1',CONTENT);
await artifact('a2','c2','Warm tteokbokki for weekday afternoons.');
await artifact('a3','c1','평일 오후 방문이 많습니다.');
await put('ai_image_disclosure','img-1',{id:'img-1',action:'marked',campaignId:'c1',artifactId:'a3',publicationId:null,channel:'creative',origin:'ai',hashBefore:'h0',hashAfter:'h1',virtualPerson:false,marked:true,disclosure:null,createdAt:now},'c1');
await put('campaign','cx',{id:'cx',brandId:'gb',title:'남의 캠페인',version:1,status:'review'},'',X);
const rows=()=>rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='ethics_check_mark' ORDER BY rowid").all(O).map(r=>JSON.parse(r.data));

// ── 6) 스위치 꺼짐: 보기가 그대로다 ──
const strip=v=>JSON.stringify(Object.fromEntries(Object.entries(v).filter(([k])=>k!=='checkedAt'&&k!=='checklist')));
const off=(await get('a1')).data.compliance;
check('flag off: the compliance view has no checklist key',off.status==='checked'&&!('checklist' in off)&&JSON.stringify(Object.keys(off).sort())==='["categories","checkedAt","gradedAt","issues","lines","notice","status"]');
const markBody={action:'mark_ethics_check',artifactId:'a1',version:1,itemId:'rights_scope',status:'held',note:'허락서 확인 중'};
let r=await post(actionRoute,ADMIN,markBody);
check('flag off: recording is 409 and writes nothing',r.status===409&&rows().length===0);

// ── 7) 스위치 켜짐: 목록·기록 왕복 ──
await setFlag(true);
const on=(await get('a1')).data.compliance;
check('flag on: everything but the checklist key is the same view',strip(on)===strip(off));
const list=on.checklist;
check('flag on: the checklist follows content signals (price, endorsement)',JSON.stringify(list.items.map(i=>i.id))==='["staged_spontaneous","disclosure_placement","authority_expert","material_omission","required_labeling","rights_scope","vulnerable_minors"]'&&list.artifactVersion===1&&list.marks.length===0&&list.scope.campaignId==='c1'&&list.scope.brandId==='gb');
check('law bases carry a law name, article and https link; others carry only the kind',list.items.every(i=>i.basis.kind==='law'?/^https:\/\//.test(i.basis.url)&&i.basis.law&&i.basis.article:!('url' in i.basis)));
check('an English campaign adds the target-country item',(await get('a2')).data.compliance.checklist.items.some(i=>i.id==='target_country'&&JSON.stringify(i.triggers)==='["foreign_language"]'));
check('a registered AI image adds the AI disclosure item without any words about AI',(await get('a3')).data.compliance.checklist.items.some(i=>i.id==='ai_disclosure_placement'&&i.triggers[0]==='ai_image'));
check('a member cannot record (403)',(await post(actionRoute,MEMBER,markBody)).status===403&&rows().length===0);
await setFlag(true,X);
check('another owner cannot record on this artifact (404)',(await post(actionRoute,OTHER,markBody)).status===404);
check('a stale version is 409',(await post(actionRoute,ADMIN,{...markBody,version:2})).status===409);
check('an item not in this checklist is 400',(await post(actionRoute,ADMIN,{...markBody,itemId:'target_country'})).status===400);
check('a bad status or an over-long note is 400',(await post(actionRoute,ADMIN,{...markBody,status:'done'})).status===400&&(await post(actionRoute,ADMIN,{...markBody,note:'가'.repeat(301)})).status===400&&rows().length===0);
r=await post(actionRoute,ADMIN,markBody);
check('admin records a mark and gets the refreshed checklist',r.status===200&&r.data.checklist.marks.length===1&&r.data.checklist.marks[0].status==='held'&&r.data.checklist.marks[0].note==='허락서 확인 중'&&['owner','admin'].includes(r.data.checklist.marks[0].actorRole));
const first=rows();
check('the stored row carries item, status, note, version, checklist version and actor id',first.length===1&&first[0].itemId==='rights_scope'&&first[0].artifactId==='a1'&&first[0].artifactVersion===1&&first[0].campaignId==='c1'&&first[0].checklistVersion===ec.ETHICS_CHECKLIST_VERSION&&first[0].actor.id==='admin'&&!('email' in first[0].actor));
r=await post(actionRoute,ADMIN,{...markBody,status:'confirmed',note:''});
check('a second mark on the same item appends a row; the view shows the latest',r.status===200&&rows().length===2&&rows()[0].status==='held'&&r.data.checklist.marks.length===1&&r.data.checklist.marks[0].status==='confirmed');
await post(actionRoute,ADMIN,{...markBody,itemId:'vulnerable_minors',status:'not_applicable'});
const reread=(await get('a1')).data.compliance.checklist;
check('round trip: reading the artifact again shows the latest mark per item',reread.marks.length===2&&reread.marks.find(m=>m.itemId==='rights_scope').status==='confirmed'&&reread.marks.find(m=>m.itemId==='vulnerable_minors').status==='not_applicable');
check('the parent row is the campaign',rt.sql.prepare("SELECT parent_id FROM records WHERE owner=? AND kind='ethics_check_mark'").all(O).every(x=>x.parent_id==='c1'));
const regraded=await post(usageRoute,ADMIN,{action:'regrade_artifact',artifactId:'a1'});
check('regrade keeps the checklist and its marks',regraded.status===200&&regraded.data.compliance.checklist?.marks.length===2);

// ── 8) 승인을 막지 않는다 ──
await post(actionRoute,ADMIN,{...markBody,status:'held',note:'보류'});
r=await post(actionRoute,ADMIN,{action:'review_artifact',id:'a1',version:1,decision:'approved',note:''});
check('a held mark does not block approval',r.status===200);
await put('artifact','a1',{id:'a1',campaignId:'c1',campaignVersion:1,role:'content',title:'콘텐츠 a1',content:CONTENT+'\n수정',version:2,status:'review',origin:'manual',createdAt:now},'c1');
check('marks belong to the version they were made on',(await get('a1')).data.compliance.checklist.marks.length===0&&(await get('a1')).data.compliance.checklist.artifactVersion===2);
await setFlag(false);
check('turning the flag off again removes the checklist from the view',!('checklist' in (await get('a1')).data.compliance));

// ── 9) 레지스트리·화면 연결(정적) ──
const kind=plain(registry.recordKinds).find(k=>k.kind==='ethics_check_mark');
check('ethics_check_mark is registered as campaign-scoped and deleted with the campaign',kind?.parent==='campaign'&&kind.campaignDeletion==='delete');
check('the flag is registered and off by default',flags.FEATURE_FLAGS.ethics_review_checklist?.defaultEnabled===false);
const panel=readFileSync('components/app/compliance-panel.tsx','utf8'),comp=readFileSync('components/app/ethics-checklist.tsx','utf8'),approve=readFileSync('app/api/action/route.ts','utf8');
check('the panel loads the checklist lazily and mounts it only when the view has one',/const EthicsChecklist=lazy\(\(\)=>import\('\.\/ethics-checklist'\)\);/.test(panel)&&/\{compliance\?\.checklist&&<Suspense fallback=\{null\}><EthicsChecklist /.test(panel)&&!/import [^;]*from '\.\/ethics-checklist'/.test(panel));
check('the checklist uses shared parts (no raw button or form control) and the trust dictionary',!/<(?:button|input|select|textarea)\b/.test(comp)&&comp.includes("import '@/lib/i18n/lazy-trust';")&&/<RadioGroup /.test(comp)&&/disabledReason=/.test(comp));
check('the approval path does not read checklist marks',!/ethics_check_mark/.test(approve.slice(approve.indexOf("b.action==='review_artifact'"))));
check('no model or network call happened',fetchCalls===0);
console.log(JSON.stringify({passed}));
