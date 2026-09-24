// F4b-2 학습 자산 비식별 이관 회귀(대표 결정 7, 2단계 종료 조건 '이관 레코드의 원문 패턴 검사 매치 0건, 점포 규칙은 캠페인 삭제 뒤에도 보존').
// 합성 캠페인에 고유 문장·전화번호·URL·이메일·주소·주문번호·캠페인 제목·브랜드 이름을 넣고, 삭제 뒤 이관 레코드 전체 JSON에서 찾는다(모두 합성 값, 외부 호출 0).
// 가명 키가 캠페인 id·제목과 무관한지, 90일 만료분이 조회에서 빠지고 정리되는지, 소유자만 완전 삭제를 고를 수 있고 그때 이관·동결이 없으며, 이전에 삭제한 다른 캠페인의 이관분은 지우지 않는지 본다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

let fetches=0;
const rt=testRuntime(async()=>{fetches++;throw new Error('외부 호출 금지')});
const signals=await rt.load('lib/deidentified-signals.ts'),server=await rt.load('lib/server.ts'),worker=await rt.load('lib/research-worker.ts');
const action=await rt.load('app/api/action/route.ts'),campaignsRoute=await rt.load('app/api/campaigns/route.ts'),deletionRoute=await rt.load('app/api/campaigns/[id]/deletion/route.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const OWNER='owner-f4b2-legacy-account';
const post=(mod,b,headers={})=>mod.POST(new Request('https://agency.test/api/x',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':OWNER,...headers},body:JSON.stringify(b)})).then(async r=>({status:r.status,data:await r.json()}));
const preview=async id=>(await deletionRoute.GET(new Request(`https://agency.test/api/campaigns/${id}/deletion`,{headers:{'oai-authenticated-user-id':OWNER}}),{params:Promise.resolve({id})})).json();
const put=(kind,id,data,parent='',owner=OWNER)=>server.recordStatement(owner,kind,id,data,parent).run();
const rows=(kind,owner=OWNER)=>rt.sql.prepare('SELECT id,parent_id,data,updated_at FROM records WHERE owner=? AND kind=? ORDER BY id').all(owner,kind);
const read=(kind,id)=>JSON.parse(rt.sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? AND id=?').get(OWNER,kind,`${OWNER}:${kind}:${id}`)?.data||'null');

// 합성 원문 표지. 어느 것도 이관 레코드에 나오면 안 된다.
const UNIQUE='새벽 세 시 등대 아래서 굽는 도넛 고유문장 QX7',PHONE='010-4821-7730',URL='https://secret-landing.example.com/offer?id=77',EMAIL='owner.private@example.org',ADDRESS='테헤란로 427',ORDER='ORD-20260924-5512';
const TITLE='비식별 검증 캠페인 고유제목 ZK9',BRAND='루마 도넛 고유상호',SHORT='LUMA';
const MARKERS=[UNIQUE,PHONE,URL,'secret-landing',EMAIL,ADDRESS,ORDER,TITLE,BRAND,SHORT];
const markersIn=value=>MARKERS.filter(m=>JSON.stringify(value).toLowerCase().includes(m.toLowerCase()));

// 1) 원문 패턴 검사(DP-3 수준). 전화·이메일·URL·주소·주문번호·금지 문자열을 잡고, 버전·모델·날짜·가명 키 같은 코드 값은 잡지 않는다.
const scan=(v,forbidden)=>plain(signals.scanForRawPatterns(v,{forbidden}));
for(const [name,value] of [['mobile',`문의 ${PHONE}입니다`],['mobile without dashes','tel:01048217730'],['landline','02-123-4567'],['email',EMAIL],['url',URL],['bare domain','landing.co.kr'],['www','www.example.net'],['road address',ADDRESS],['lot address','역삼동 123-4'],['building unit','101동 1203호'],['order id',ORDER],['long order number','주문 2026092455120'],['order label','주문번호 확인'],['orderRefs hash','a'.repeat(64)]])check(`scan catches ${name}`,JSON.stringify(scan({x:value}))==='["x"]');
check('scan catches forbidden title and brand strings case-insensitively',JSON.stringify(scan({a:`앞 ${TITLE.toUpperCase()} 뒤`,b:'luma',c:'clean'},[TITLE,SHORT]))==='["a","b"]');
check('short forbidden strings match only as whole words',scan({a:'illuminate'},[SHORT]).length===0);
const codeValues={v:'deidentified-signal-v1',subject:signals.signalSubject(),id:signals.signalSubject()+':0',skill:'2026-09-23.3',prompt:'role.cmo@abcdef123456+channel.shortform@0123456789ab',f2a:'2026-09-23.3:abcdef123456',model:'gpt-5.4-mini',alias:'hermes-agent',vendor:'anthropic/claude-sonnet-4',graders:['question_only','fact_conflict'],gv:'failure-types-v1',day:'2026-09-24',at:'2027-02-03T00:00:00.000Z',role:'content',category:'BAKERY & COFFEE'};
check('code values are not reported as raw text',scan(codeValues,[TITLE,BRAND,SHORT]).length===0);
check('scan reports nested paths for arrays and objects',JSON.stringify(scan({usage:{models:['gpt-5',URL]},list:[{a:PHONE}]}))==='["usage.models.1","list.0.a"]');
// 코드 값(버전·모델·채점기 id) 검사: 날짜 접미사 모델 id·숫자뿐인 해시·짧은 약칭과 겹치는 날짜 조각은 원문이 아니다(F4B2-06·R3). 전화·이메일·URL·주문 형식·긴 금지 문자열은 그대로 잡는다.
const codeScan=(v,forbidden)=>plain(signals.scanForRawPatterns(v,{forbidden,mode:'code'}));
check('code-value scan keeps dated model ids, numeric prompt hashes and versions sharing a short brand name',codeScan({m:['claude-sonnet-4-5-20250929','claude-3-7-sonnet-20250219','anthropic/claude-sonnet-4-20250514','gpt-4o-mini-2024-07-18'],p:'role.cmo@123456789012',s:'2026-09-23.3'},['09','12','AI']).length===0);
check('code-value scan still catches phones, emails, URLs, order ids, hashes and long forbidden strings',JSON.stringify(codeScan({a:PHONE,b:EMAIL,c:URL,d:ORDER,e:'x-LUMA-1',f:'role.cmo@'+'a'.repeat(64)},[SHORT]))==='["a","b","c","d","e","f"]');

// 2) 가명 키와 만료 기한
const k1=signals.signalSubject(),k2=signals.signalSubject();
check('pseudonymous keys are random 128-bit values',/^anon_[0-9a-f]{32}$/.test(k1)&&k1!==k2);
const expected=new Date(Date.UTC(2026,8,24)+90*86400000).toISOString();
check('expiry is 90 days from the UTC archive day',signals.signalExpiry('2026-09-24T23:59:59.000Z')===expected&&signals.signalExpiry('2026-09-24T00:00:00.000Z')===expected&&signals.SIGNAL_RETENTION_DAYS===90);

// 3) 순수 이관: 원문을 담지 않고, 매치된 필드는 버린다(업종에 전화번호가 들어간 브랜드).
const brand={id:'luma',name:BRAND,short:SHORT,category:`BAKERY ${PHONE}`,color:'#000',bg:'#fff',description:UNIQUE,audience:'',tone:'',constraints:'',knowledge:URL};
const campaignData={brandId:'luma',title:TITLE,goal:`${UNIQUE} 문의 ${PHONE} ${URL}`,audience:'근처 직장인',channels:'Instagram',stores:'',products:'',startDate:'',endDate:'',constraints:`${ADDRESS} 매장, ${EMAIL}`,sources:ORDER,budget:0};
const artifact=(id,extra)=>({id,campaignId:'X',title:`${TITLE} 작업물`,content:`## 요약\n${UNIQUE}\n연락처 ${PHONE}\n${URL}`,status:'review',createdAt:'2026-09-24T00:00:00.000Z',reviewNote:`${UNIQUE} ${EMAIL}`,...extra});
const fixtures=cid=>({
 artifacts:[artifact('art-ai',{campaignId:cid,role:'cmo',version:1,origin:'ai',skillVersion:'2026-09-23.3',outputContractVersion:'role-output-v2',complianceHold:{version:'c1',block:2,issues:[{category:'health',ruleId:'r1',title:'효능',excerpt:`${UNIQUE} ${PHONE}`}],checkedAt:'2026-09-24T00:00:00.000Z',notice:'보류'}}),
  artifact('art-edited',{campaignId:cid,role:'content',version:3,origin:'ai_edited',aiSource:{id:'art-edited',version:2,skillVersion:'2026-09-23.2',outputContractVersion:'role-output-v1'},editStats:{changedSections:[UNIQUE],diffRatio:0.4}}),
  artifact('art-manual',{campaignId:cid,role:'strategy',version:1,origin:'manual'})],
 gradings:[{id:'art-ai:1',artifactId:'art-ai',artifactVersion:1,campaignId:cid,role:'cmo',status:'graded',gradersVersion:'failure-types-v1',graders:[{id:'question_only',status:'pass'},{id:'fact_conflict',status:'fail',detail:`${UNIQUE} ${PHONE}`},{id:'thin_section',status:'grader_error'}],summary:{pass:1,fail:1,not_applicable:0,grader_error:1},compliance:{version:'c1',block:1,warn:2,info:0,issues:[{category:'health',ruleId:'r1',severity:'block'}]}}],
 usage:[{id:'hermes:r1',provider:'hermes',model:'gpt-5.4',inputTokens:1200,outputTokens:800,totalTokens:2000,campaignId:cid,artifactId:'art-ai',kind:'role',role:'cmo',promptVersion:'2026-09-23.3:abcdef123456',domainOutcome:'completed'},
  {id:'hermes:r2',provider:'hermes',model:'https://secret-landing.example.com/m',inputTokens:10,outputTokens:5,totalTokens:15,campaignId:cid,artifactId:'art-ai',kind:'role',role:'cmo',promptVersion:PHONE,domainOutcome:'thin_output'},
  {id:'hermes:m1',provider:'hermes',model:'hermes-agent',inputTokens:null,outputTokens:null,totalTokens:300,campaignId:cid,artifactId:null,kind:'meeting',domainOutcome:'completed'}],
 metrics:[{id:'m1',campaignId:cid,notes:`${UNIQUE} 주문 ${ORDER}`}],
});
const pure=plain(signals.buildSignals(OWNER,{...campaignData,id:'camp-pure'},{brand,...fixtures('camp-pure')},{subject:k1,now:'2026-09-24T10:00:00.000Z'}));
const forbidden=plain(signals.forbiddenStrings(OWNER,{...campaignData,id:'camp-pure'},{brand,...fixtures('camp-pure')}));
// 이관 레코드 검사는 buildSignals가 쓰는 필드별 검사(scanSignal)다: 업종 범주는 전체 검사, 버전·모델·채점기 id는 코드 값 검사, 나머지는 코드가 만든 구조 값이라 검사하지 않는다.
const scanRecord=(v,forbidden)=>plain(signals.scanSignal(v,forbidden));
check('only AI artifacts become signals plus one campaign usage summary',pure.length===3&&JSON.stringify(pure.map(s=>s.unit+':'+(s.role||'')))==='["artifact:cmo","artifact:content","campaign:"]');
check('pure signals carry no synthetic raw text',markersIn(pure).length===0&&!JSON.stringify(pure).includes('camp-pure')&&!JSON.stringify(pure).includes('art-ai')&&!JSON.stringify(pure).includes(OWNER));
check('pure signals have zero raw pattern matches',scanRecord(pure,forbidden).length===0&&scan(pure,forbidden).length===0);
check('a category holding a phone number is dropped and recorded as a dropped field',pure.every(s=>s.category===null&&s.droppedFields.includes('category')));
check('a URL model and a phone prompt version are dropped from the lists',JSON.stringify(pure[0].usage.models)==='["gpt-5.4"]'&&JSON.stringify(pure[0].promptVersions)==='["2026-09-23.3:abcdef123456"]'&&pure[0].droppedFields.includes('usage.models.1'));
const clean=plain(signals.buildSignals(OWNER,{...campaignData,id:'camp-pure'},{brand:{...brand,category:'BAKERY & COFFEE'},...fixtures('camp-pure')},{subject:k1,now:'2026-09-24T10:00:00.000Z'}));
check('a plain industry category is kept',clean.every(s=>s.category==='BAKERY & COFFEE'&&!s.droppedFields.includes('category')));

// 3b) 구조 필드(id·가명 키·판·출처·날짜)는 코드가 만든 값이라 검사하지 않는다. 금지 문자열이 날짜·가명 키·판 문자열과 우연히 겹쳐도 버리지 않는다(F4B2-02·R1·SEC-1).
// 회의 작업물은 사용량 원장에 artifactId가 없어 회의 id·역할로 잇고, 작업물에 저장된 promptVersion도 쓴다(F4B2-03).
const meetingArt=(id,role,extra={})=>({id,campaignId:'X',role,version:2,origin:'ai',meetingId:'mt-1',skillVersion:'2026-09-23.3',promptVersion:`role.${role}@abcdef123456`,title:'회의 개선',content:'본문',...extra});
const meetingRow={id:'hermes:mt',provider:'hermes',model:'claude-sonnet-4-5-20250929',inputTokens:1234,outputTokens:56,totalTokens:1290,campaignId:'X',artifactId:null,jobId:OWNER+':meeting:mt-1',kind:'meeting',role:'cmo',promptVersion:'role.cmo@abcdef123456',domainOutcome:'completed'};
const build=(camp,br,extra={})=>plain(signals.buildSignals(OWNER,{id:'camp-x',brandId:'b',title:'평범한 캠페인 이름',...camp},{brand:br,artifacts:[meetingArt('art-m1','cmo'),meetingArt('art-m2','content')],gradings:[],usage:[meetingRow],...extra},{subject:k1,now:'2026-09-24T10:00:00.000Z'}));
const structuralKept=out=>out.length===3&&out.every((s,i)=>s.id===`${k1}:${i}`&&s.subject===k1&&s.v==='deidentified-signal-v1'&&s.archivedOn==='2026-09-24'&&s.expiresAt==='2026-12-23T00:00:00.000Z')&&out.filter(s=>s.unit==='artifact').every(s=>s.origin==='ai'&&s.artifactVersion===2);
for(const [name,camp,br] of [['brand short 12',{},{name:'브랜드',short:'12'}],['brand short 09',{},{name:'브랜드',short:'09'}],['brand short 00',{},{name:'브랜드',short:'00'}],['brand short 24',{},{name:'브랜드',short:'24'}],['brand short AI',{},{name:'브랜드',short:'AI'}],['campaign title 2026',{title:'2026'},{name:'브랜드',short:'BR'}],['campaign title Signal',{title:'Signal'},{name:'브랜드',short:'BR'}],['brand name anon',{},{name:'anon',short:'BR'}],['brand name Anon',{},{name:'Anon',short:'BR'}],['goal holding the expiry day',{goal:'메모\n2026-12-23'},{name:'브랜드',short:'BR'}],['products 12 and stores 00',{products:'12',stores:'00'},{name:'브랜드',short:'BR'}]]){
 check(`structural fields survive a coincidental forbidden string: ${name}`,structuralKept(build(camp,br)));
}
const shortVersion=build({},{name:'브랜드',short:'09'});
check('versions sharing a short brand name are kept',shortVersion.filter(s=>s.unit==='artifact').every(s=>s.skillVersion==='2026-09-23.3'&&!s.droppedFields.length));
const meetingSignals=build({},{name:'브랜드',short:'BR'}),mcmo=meetingSignals.find(s=>s.role==='cmo'),mcontent=meetingSignals.find(s=>s.role==='content');
check('a meeting artifact takes the meeting usage of its role and its stored prompt version',JSON.stringify(mcmo.promptVersions)==='["role.cmo@abcdef123456"]'&&mcmo.usage?.runs===1&&JSON.stringify(mcmo.usage.models)==='["claude-sonnet-4-5-20250929"]');
check('a meeting artifact without usage rows still keeps its stored prompt version',JSON.stringify(mcontent.promptVersions)==='["role.content@abcdef123456"]'&&mcontent.usage===null);
check('an edited artifact prefers the prompt version of its AI source',JSON.stringify(plain(signals.buildSignals(OWNER,{id:'c',brandId:'b',title:'평범한 캠페인 이름'},{brand:null,artifacts:[meetingArt('art-e','cmo',{origin:'ai_edited',version:3,promptVersion:'role.cmo@111111111111',aiSource:{id:'art-e',version:2,skillVersion:'2026-09-23.3',outputContractVersion:null,promptVersion:'role.cmo@222222222222'}})],gradings:[],usage:[]},{subject:k1,now:'2026-09-24T10:00:00.000Z'}))[0].promptVersions)==='["role.cmo@222222222222"]');
// 토큰 합계는 유효숫자 2자리로 줄여 사용량 원장의 정확한 합계와 바로 맞춰 보지 못하게 한다(SEC-4·R4).
check('token totals are rounded to two significant digits',mcmo.usage.inputTokens===1200&&mcmo.usage.outputTokens===56&&mcmo.usage.totalTokens===1300&&meetingSignals.find(s=>s.unit==='campaign').usage[0].totalTokens===1300);
// 결과 코드는 사용량 원장의 결과 목록 값만 키로 받는다. 이메일·URL 모양 키가 검사를 건너 새지 않는다(R3).
const oddOutcome=build({},{name:'브랜드',short:'BR'},{usage:[{...meetingRow,domainOutcome:'a@b.com'},{...meetingRow,id:'hermes:mt2',domainOutcome:'https://x.com/y'},{...meetingRow,id:'hermes:mt3',domainOutcome:'thin_output'}]});
check('only known usage outcomes become outcome keys',JSON.stringify(oddOutcome.find(s=>s.unit==='campaign').usage[0].outcomes)==='{"thin_output":1}');
// 판정 로그가 없는 품질 검수 작업물의 AI 기준 판정(코드 값만)을 이관한다. 발견·수정·위치 원문은 담지 않는다(F4B2-08).
const qualityArt=meetingArt('art-q','quality',{qualityReview:{verdict:'revise',summary:UNIQUE,findings:PHONE,checks:[{criterion:'evidence',status:'revise',location:URL,finding:UNIQUE,fix:EMAIL},{criterion:'brand',status:'pass',location:'x',finding:'y',fix:'z'},{criterion:'made_up',status:'pass',location:'x',finding:'y',fix:'z'},{criterion:'economics',status:UNIQUE,location:'x',finding:'y',fix:'z'}]}});
const quality=plain(signals.buildSignals(OWNER,{id:'c',brandId:'b',title:'평범한 캠페인 이름'},{brand:null,artifacts:[qualityArt],gradings:[],usage:[]},{subject:k1,now:'2026-09-24T10:00:00.000Z'}))[0];
check('a quality artifact carries the AI verdict and per-criterion statuses without raw text',JSON.stringify(quality.quality)==='{"verdict":"revise","checks":[{"criterion":"evidence","status":"revise"},{"criterion":"brand","status":"pass"}]}'&&markersIn(quality).length===0);
check('artifacts without a quality review carry no quality verdict',meetingSignals.filter(s=>s.unit==='artifact').every(s=>s.quality===null));

// 4) 삭제 연쇄: 기본은 비식별 이관 + 규칙 종료 보존 + 요약 동결. 점포 규칙·사람 판정 로그는 그대로다.
await put('brand','luma',brand);
const cid=(await post(action,{action:'save_campaign',data:campaignData})).data.id;
const f=fixtures(cid);
for(const a of f.artifacts)await put('artifact',a.id,a,cid);
for(const g of f.gradings)await put('grading',g.id,g,cid);
for(const u of f.usage)await put('provider_usage',u.id,u);
for(const m of f.metrics)await put('metric',m.id,m,cid);
await put('review_decision','rd-1',{id:'rd-1',targetKind:'artifact',targetId:'art-ai',version:1,role:'cmo',decision:'approved',reasonCodes:[],campaignId:cid,brandId:null});
const viral=(id,campaignId)=>({id,brandId:'luma',campaignId,title:'첫 장면 질문형',channel:'Instagram',hypothesis:'질문형이 공유를 늘린다',metric:'share_rate',minSample:100,minHours:24,minLift:10,version:3,status:'evaluated',startedAt:null,assessment:null,result:null});
const rule=(id,experimentId,extra={})=>({origin:'viral',direction:'test',id,brandId:'luma',channel:'Instagram',experimentId,experimentVersion:3,caseId:'case',title:'질문형 첫 장면',guidance:'질문형 첫 장면을 시험 적용',scope:'같은 채널',evidenceLevel:'observational',status:'active',version:1,expiresAt:'2026-12-01T00:00:00.000Z',createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',...extra});
await put('viral_experiment','exp-1',viral('exp-1',cid),cid);await put('learning_rule','exp-1:3',rule('exp-1:3','exp-1'),'luma');
// 점포 회고에서 승격한 규칙(PR 4b-1 loop-7)과 캠페인에 연결된 점포 실험.
await put('store','st',{id:'st',brandId:'luma'},'luma');
const storeExperiment=id=>({id,storeId:'st',brandId:'luma',campaignId:cid,title:'점포 실험',status:'closed',version:4});
const storeRule=id=>rule('store:'+id+':4',id,{origin:'store',storeId:'st',experimentVersion:4,direction:'caution',storeAssessment:{decision:'stop',primaryMetric:'orders',observed:3}});
await put('store_experiment','sx-1',storeExperiment('sx-1'),'st');await put('learning_rule','store:sx-1:4',storeRule('sx-1'),'luma');
const plan=await preview(cid);
check('preview shows the number of signals to archive and the retention',plan.archive?.signals===3&&plan.archive.retentionDays===90);
check('preview shows what complete deletion removes or skips on top',JSON.stringify(plan.purge.deleted)==='{"learning_rule":1,"review_decision":1}'&&JSON.stringify(plan.purge.skipped)==='{"viral_experiment_summary":1,"deidentified_signal":3}');
check('preview wrote nothing',rows('deidentified_signal').length===0);
const done=await post(action,{action:'delete_campaign',id:cid,version:1,confirmed:true});
check('default deletion archives the signals',done.status===200&&done.data.archived===3&&done.data.purgedLearning===false);
const archived=rows('deidentified_signal'),parsed=archived.map(r=>JSON.parse(r.data));
check('archived records have zero raw text matches in their full JSON',archived.length===3&&markersIn(archived).length===0&&scanRecord(parsed,forbidden.concat([cid])).length===0);
check('archived records carry no campaign, artifact or owner identifier',!JSON.stringify(parsed).includes(cid)&&!JSON.stringify(parsed).includes('art-ai')&&!JSON.stringify(parsed).includes(OWNER)&&!JSON.stringify(parsed).includes('luma'));
check('archived rows are not linked to the campaign and keep only the archive day',archived.every(r=>r.parent_id===''&&/T00:00:00\.000Z$/.test(r.updated_at)));
const subject=parsed[0].subject,sha=createHash('sha256').update(cid).digest('hex');
check('one random pseudonymous key per deleted campaign, unrelated to its id and title',parsed.every(s=>s.subject===subject)&&/^anon_[0-9a-f]{32}$/.test(subject)&&!subject.includes(cid)&&!subject.includes(sha.slice(0,32))&&!subject.includes(createHash('sha256').update(TITLE).digest('hex').slice(0,32)));
const cmo=parsed.find(s=>s.role==='cmo'),edited=parsed.find(s=>s.role==='content'),summary=parsed.find(s=>s.unit==='campaign');
check('artifact signal keeps role versions model tokens and grading outcome',cmo.origin==='ai'&&cmo.skillVersion==='2026-09-23.3'&&cmo.outputContractVersion==='role-output-v2'&&cmo.usage.inputTokens===1200&&cmo.usage.totalTokens===2000&&cmo.usage.runs===2&&JSON.stringify(cmo.gradings[0].failed)==='["fact_conflict"]'&&JSON.stringify(cmo.gradings[0].passed)==='["question_only"]'&&JSON.stringify(cmo.gradings[0].errored)==='["thin_section"]'&&cmo.gradings[0].complianceBlock===1&&cmo.complianceHold===2);
check('human-edited artifact signal uses the AI source versions',edited.origin==='ai_edited'&&edited.skillVersion==='2026-09-23.2'&&edited.outputContractVersion==='role-output-v1'&&edited.usage===null);
check('campaign signal summarises usage by run kind',summary.aiArtifacts===2&&JSON.stringify(summary.usage.map(u=>[u.kind,u.runs,u.totalTokens]))==='[["meeting",1,300],["role",2,2000]]'&&summary.usage[1].outcomes.thin_output===1);
check('viral rule is still retired and its experiment frozen by default',read('learning_rule','exp-1:3').status==='retired'&&!!read('viral_experiment_summary','exp-1'));
check('store rule survives campaign deletion unchanged',JSON.stringify(read('learning_rule','store:sx-1:4'))===JSON.stringify(storeRule('sx-1'))&&!!read('store_experiment','sx-1'));
check('human decision log is kept by default',!!read('review_decision','rd-1'));

// 5) 90일 만료: 조회에서 빠지고, 워커 tick과 캠페인 삭제가 지운다.
const expire=id=>rt.sql.prepare("UPDATE records SET data=json_set(data,'$.expiresAt','2026-01-01T00:00:00.000Z') WHERE id=?").run(id);
check('listing returns the active signals',plain(await server.listDeidentifiedSignals(OWNER)).length===3);
expire(archived[0].id);
check('expired signals are excluded from reads',plain(await server.listDeidentifiedSignals(OWNER)).length===2&&rows('deidentified_signal').length===3);
check('the purge helper removes expired signals only',await server.purgeExpiredSignals(OWNER)===1&&rows('deidentified_signal').length===2);
expire(archived[1].id);
const token=await worker.registerWorker(OWNER);
const tick=plain(await worker.workerTick({owner:OWNER,hash:await worker.workerHash(token)},async()=>new Response('{}')));
check('the research worker tick purges expired signals',tick.status==='idle'&&rows('deidentified_signal').length===1);
// 정리는 소유자당 UTC 하루 1회다(R6): 같은 날 두 번째 tick은 지우지 않고, 날짜가 바뀐 첫 tick이 지운다. expiresAt이 없는 행도 정리한다(SEC-1 방어).
const workerTickNow=async()=>worker.workerTick({owner:OWNER,hash:await worker.workerHash(token)},async()=>new Response('{}'));
const remaining=rows('deidentified_signal')[0],validUntil=JSON.parse(remaining.data).expiresAt;
expire(remaining.id);await workerTickNow();
check('a second tick on the same UTC day does not purge again',rows('deidentified_signal').length===1);
rt.sql.prepare("UPDATE records SET data=json_set(data,'$.expiresAt',?) WHERE id=?").run(validUntil,remaining.id);
await put('deidentified_signal','anon_stale:0',{id:'anon_stale:0',v:'deidentified-signal-v1',expiresAt:'2026-01-01T00:00:00.000Z'});
rt.sql.prepare("UPDATE records SET data=json_set(data,'$.signalPurgeDay','2026-01-01') WHERE owner=? AND kind='worker_state'").run(OWNER);
await workerTickNow();
check('the first tick of a new UTC day purges again',rows('deidentified_signal').length===1&&rows('deidentified_signal')[0].id===remaining.id);
await put('deidentified_signal','anon_broken:0',{id:'anon_broken:0',v:'deidentified-signal-v1',expiresAt:null});
check('a signal without an expiry is purged rather than kept forever',await server.purgeExpiredSignals(OWNER)===1&&rows('deidentified_signal').length===1);

// 6) 완전 삭제: 소유자만. 이관·규칙 종료 보존·요약 동결이 없고, 규칙·이 캠페인 판정 로그를 지운다. 이전에 삭제한 다른 캠페인의 이관분과 점포 규칙은 남는다.
const cid2=(await post(action,{action:'save_campaign',data:{...campaignData,title:TITLE+' 둘째'}})).data.id,f2=fixtures(cid2);
for(const a of f2.artifacts)await put('artifact',a.id+'-2',{...a,id:a.id+'-2'},cid2);
await put('review_decision','rd-2',{id:'rd-2',targetKind:'artifact',targetId:'art-ai-2',version:1,role:'cmo',decision:'revision',reasonCodes:['evidence'],campaignId:cid2,brandId:null});
await put('viral_experiment','exp-2',viral('exp-2',cid2),cid2);await put('learning_rule','exp-2:3',rule('exp-2:3','exp-2'),'luma');
await put('store_experiment','sx-2',{...storeExperiment('sx-2'),campaignId:cid2},'st');await put('learning_rule','store:sx-2:4',storeRule('sx-2'),'luma');
const plan2=await preview(cid2);
check('purge preview never counts other campaigns archived signals for deletion',plan2.purge.deleted.deidentified_signal===undefined&&plan2.purge.deleted.learning_rule===1&&plan2.purge.deleted.review_decision===1&&plan2.purge.skipped.deidentified_signal===2);
check('a malformed purge flag is rejected',(await post(action,{action:'delete_campaign',id:cid2,version:1,confirmed:true,purgeLearning:'yes'})).status===400);
// 완전 삭제도 기존 삭제 동작(POST /api/action delete_campaign)이 행위자 역할을 넘겨 받는다(F4B2-07). 헤더 인증(legacy)의 행위자는 소유자다.
const archivedBefore=rows('deidentified_signal').length;
const purged=await post(action,{action:'delete_campaign',id:cid2,version:1,confirmed:true,purgeLearning:true});
check('the owner can delete a campaign with its learning assets through the regular delete action',purged.status===200&&purged.data.purgedLearning===true&&purged.data.archived===0&&!read('campaign',cid2));
check('complete deletion archives nothing and keeps signals archived from other campaigns',archivedBefore>0&&rows('deidentified_signal').length===archivedBefore);
check('complete deletion deletes the viral rule instead of retiring it and freezes no summary',!read('learning_rule','exp-2:3')&&!read('viral_experiment_summary','exp-2')&&!read('viral_experiment','exp-2'));
check('complete deletion removes only this campaign decision log',!read('review_decision','rd-2')&&!!read('review_decision','rd-1'));
check('complete deletion keeps store rules and other retained rules',JSON.stringify(read('learning_rule','store:sx-2:4'))===JSON.stringify(storeRule('sx-2'))&&!!read('store_experiment','sx-2')&&read('learning_rule','exp-1:3').status==='retired'&&!!read('viral_experiment_summary','exp-1'));
check('the tombstone records the purge choice',read('deleted_campaign',cid2).learningAssets==='purged'&&!read('deleted_campaign',cid).learningAssets);
const retried=await post(action,{action:'delete_campaign',id:cid2,version:1,confirmed:true,purgeLearning:true});
check('a retried complete deletion reports the purge it already did',retried.status===200&&retried.data.purgedLearning===true);
// 이미 기본 삭제한 캠페인에 완전 삭제를 보내면 완료로 알리지 않고 409로 거절한다(R5·SEC-3).
const c3=(await post(action,{action:'save_campaign',data:{...campaignData,title:'셋째'}})).data.id;await put('artifact','a3',{...f.artifacts[0],id:'a3',campaignId:c3},c3);
const d3=await post(action,{action:'delete_campaign',id:c3,version:1,confirmed:true});
check('default deletion still archives',d3.status===200&&d3.data.archived===1&&d3.data.purgedLearning===false&&rows('deidentified_signal').length===archivedBefore+1);
const late=await post(action,{action:'delete_campaign',id:c3,version:1,confirmed:true,purgeLearning:true});
check('complete deletion of an already deleted campaign is refused instead of reported as done',late.status===409&&/이미 삭제/.test(late.data.error)&&rows('deidentified_signal').length===archivedBefore+1);
check('a retried default deletion stays idempotent',(await post(action,{action:'delete_campaign',id:c3,version:1,confirmed:true})).data.purgedLearning===false);
check('the campaigns route does not take deletions',(await post(campaignsRoute,{action:'delete_campaign',id:c3,version:1,confirmed:true})).status===400);
// 브랜드 이름·제목이 가명 키 접두어와 겹쳐도 삭제가 실패하지 않고 이관 행 id가 모두 다르다(SEC-2·R1).
await put('brand','anonb',{...brand,id:'anonb',name:'Anon',short:'AN',category:'카페'});
const c4=(await post(action,{action:'save_campaign',data:{...campaignData,brandId:'anonb',title:'anon'}})).data.id;
for(const a of fixtures(c4).artifacts.slice(0,2))await put('artifact',a.id+'-4',{...a,id:a.id+'-4',campaignId:c4},c4);
const d4=await post(action,{action:'delete_campaign',id:c4,version:1,confirmed:true}),all4=rows('deidentified_signal');
check('a campaign whose brand or title overlaps the pseudonym prefix is deleted with distinct signal rows',d4.status===200&&d4.data.archived===2&&all4.length===archivedBefore+3&&new Set(all4.map(r=>r.id)).size===all4.length&&all4.every(r=>!r.id.endsWith(':null')&&JSON.parse(r.data).expiresAt&&JSON.parse(r.data).subject));

// 7) 이메일 모드 권한: 완전 삭제는 대표(소유자)만. 관리자·직원은 403이고 아무것도 지우지 않는다.
const em=testRuntime(async()=>{fetches++;throw new Error('외부 호출 금지')});Object.assign(em.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const emServer=await em.load('lib/server.ts'),emRoute=await em.load('app/api/action/route.ts');
await emServer.recordStatement('workspace','campaign','m',{id:'m',brandId:'ofd',title:'이메일 모드',version:1}).run();
const users=[['owner','admin','a'.repeat(64),1],['admin2','admin','b'.repeat(64),2],['member','member','c'.repeat(64),3]];
for(const [id,role,tok,at] of users){em.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid','workspace',role,'active',at);em.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(tok).digest('hex'),id,Date.now()+60000,Date.now())}
const emPost=(tok,b)=>emRoute.POST(new Request('https://app.test/api/action',{method:'POST',headers:{cookie:'__Host-collective_session='+tok,origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(b)}));
const purgeBody={action:'delete_campaign',id:'m',version:1,confirmed:true,purgeLearning:true},exists=()=>!!em.sql.prepare("SELECT id FROM records WHERE kind='campaign' AND id='workspace:campaign:m'").get();
check('an admin cannot choose complete deletion',(await emPost('b'.repeat(64),purgeBody)).status===403&&exists());
check('a member cannot delete at all',(await emPost('c'.repeat(64),purgeBody)).status===403&&exists());
check('the owner can choose complete deletion',(await emPost('a'.repeat(64),purgeBody)).status===200&&!exists());
check('no external calls were made',fetches===0);

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
