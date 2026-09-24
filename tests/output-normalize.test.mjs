// 사람이 보는 역할 산출물 정규화(lib/output-normalize.ts): 입력 스키마 경로 → 한국어 라벨, 계약 섹션 본문 안 #·## 제목 → ###.
// 품질 기준선 v1(2026-09-24) 실패 문구를 합성해 internal_id_exposure·heading_nesting 채점기가 정규화 결과에서 통과하는지 본다. 모든 입력은 합성 데이터다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
async function load(path){const m=moduleFor(path);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const {SCHEMA_PATH_LABELS,labelSchemaPaths,normalizeSectionBody,normalizeQualityOutput}=await load('lib/output-normalize.ts');
const {parseRoleOutput,renderRoleOutput,roleOutputContract,scrubInternalIds,ROLE_OUTPUT_VERSION}=await load('lib/role-output.ts');
const {runGraders,runPreventionGraders,PREVENTION_GRADERS}=await load('lib/graders/index.ts');
const {SCHEMA_PATH,DEBUG_VALUE}=await load('lib/graders/structure.ts');
const {parseStandaloneQuality,qualityMarkdown}=await load('lib/quality.ts');
const {planFields,questionFields}=await load('lib/brief.ts');
const policy=await load('lib/campaign-policy.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const label=text=>labelSchemaPaths(text).text;
// vm 컨텍스트에서 만든 객체는 프로토타입이 달라 JSON으로 옮겨 비교한다.
const plain=x=>JSON.parse(JSON.stringify(x));
const status=(id,item)=>Object.fromEntries(runGraders(item,{}).map(r=>[r.id,r.status]))[id];
const prevention=(id,item)=>Object.fromEntries(runPreventionGraders(item,{}).map(r=>[r.id,r.status]))[id];
const raw=(role,bodies,changes)=>JSON.stringify({contractVersion:ROLE_OUTPUT_VERSION,role,sections:roleOutputContract(role).sections.map((s,i)=>({id:s.id,content:bodies[i]})),...(changes?{changes}:{})});

// 1 스키마 경로 → 라벨
check('known schema paths become Korean labels mid-sentence, in lists and in parentheses',()=>assert.equal(
 label('캠페인 목표(campaign.goal)와 campaign.audience 기준으로 campaign.plan.hypothesis·campaign.plan.barrier를 검증하고 campaign.plan.tracking에 따라 잽니다. evidence.facts.confirmed만 쓰고 evidence.directives를 반영합니다. (근거: campaign.plan.hypothesis, campaign.plan.tracking)'),
 '캠페인 목표와 타깃 고객 기준으로 검증할 가설·고객의 이용 장애물·인사이트를 검증하고 수집할 데이터·측정 방법에 따라 잽니다. 확정 사실만 쓰고 상시 지시를 반영합니다. (근거: 검증할 가설, 수집할 데이터·측정 방법)'));
// 지시문이 경로를 '라벨(경로)'로 부르므로 모델이 따라 쓴다. 경로만 든 괄호는 괄호째 지워 '확정 사실(확정 사실)' 같은 겹침을 만들지 않는다.
check('a parenthesis holding only a known path is dropped, not doubled',()=>{
 assert.equal(label('확정 사실(evidence.facts.confirmed)만 근거로 씁니다.'),'확정 사실만 근거로 씁니다.');
 assert.equal(label('캠페인 목표 (campaign.goal)와 KPI(campaign.plan.kpi)를 봅니다.'),'캠페인 목표와 KPI를 봅니다.');
 assert.equal(label('거절된 사실(evidence.facts.prohibited, 관리자가 거절한 사실)은 쓰지 않습니다.'),'거절된 사실(관리자가 거절한 사실)은 쓰지 않습니다.');
 assert.equal(label('구매 장벽: campaign.plan.barrier(구매 장벽)'),'구매 장벽: 고객의 이용 장애물·인사이트(구매 장벽)');
 assert.equal(label('근거: (campaign.goal)'),'근거: (캠페인 목표)');
 assert.equal(label('(근거: campaign.goal)'),'(근거: 캠페인 목표)');
 assert.deepEqual(plain(labelSchemaPaths('확정 사실(evidence.facts.confirmed)과 후보 사실(evidence.facts.candidate)')),{text:'확정 사실과 후보 사실',count:2});
 for(const text of ['목표(campaign.plan.tracking.detail)','목표(evidence.facts.confirmed[0])','예산(campaign.budget=null)'])assert.equal(label(text),text,text);
});
// 모델이 지시문 문장을 그대로 옮겨 적어도 경로가 남지 않고 같은 이름이 괄호로 겹치지 않는다.
check('policy sentences copied verbatim leave no path and no doubled name',()=>{
 for(const name of ['factDiscipline','claimPolicy','copyCompliancePolicy','directivePolicy','measurementDiscipline']){
  const out=label(policy[name]);
  assert.deepEqual([...out.matchAll(SCHEMA_PATH)].map(m=>m[0]),[],name);
  assert.equal(/([가-힣][가-힣 ·]*)\(\1\)/.test(out),false,name+': '+out);
 }
});
// 라벨은 화면 이름과 같다: 사용자가 산출물의 이름으로 브리프·사실 원장·상시 지시 항목을 찾을 수 있어야 한다.
check('campaign labels are the brief form field names and evidence labels are the product terms',()=>{
 const ui=s=>s.replace(/\s+([·/])\s+/g,'$1');
 for(const [key,name] of Object.entries(planFields))assert.equal(SCHEMA_PATH_LABELS['campaign.plan.'+key],ui(name),key);
 for(const [key,name] of Object.entries(questionFields))if(!(key in planFields))assert.equal(SCHEMA_PATH_LABELS['campaign.'+key],ui(name),key);
 assert.equal(SCHEMA_PATH_LABELS['campaign.plan.barrier'],'고객의 이용 장애물·인사이트');
 assert.equal(SCHEMA_PATH_LABELS['campaign.plan.tracking'],'수집할 데이터·측정 방법');
 assert.deepEqual(['evidence.facts','evidence.facts.confirmed','evidence.facts.candidate','evidence.facts.prohibited','evidence.directives'].map(k=>SCHEMA_PATH_LABELS[k]),['사실 원장','확정 사실','후보 사실','거절된 사실','상시 지시']);
});
check('particles follow the final consonant of the label',()=>{
 assert.equal(label('campaign.goal을 확인'),'캠페인 목표를 확인');
 assert.equal(label('campaign.audience가 넓다'),'타깃 고객이 넓다');
 assert.equal(label('campaign.plan.barrier와 campaign.plan.hypothesis는'),'고객의 이용 장애물·인사이트와 검증할 가설은');
 assert.equal(label('campaign.plan.tracking로 campaign.plan.hypothesis으로 evidence.directives으로'),'수집할 데이터·측정 방법으로 검증할 가설로 상시 지시로');
 assert.equal(label('campaign.goal이나 campaign.audience나'),'캠페인 목표나 타깃 고객이나');
 assert.equal(label('campaign.goal이며 campaign.audience에서'),'캠페인 목표이며 타깃 고객에서');
});
check('copula-like particles (이랑·이라는·이라고·이라서·이란·이라) follow the label too',()=>{
 assert.equal(label('campaign.audience랑 campaign.goal이랑'),'타깃 고객이랑 캠페인 목표랑');
 assert.equal(label('campaign.goal이라는 evidence.facts.confirmed라는'),'캠페인 목표라는 확정 사실이라는');
 assert.equal(label('campaign.goal이라고 campaign.audience라고'),'캠페인 목표라고 타깃 고객이라고');
 assert.equal(label('campaign.goal이라서 campaign.audience란 campaign.goal이라면'),'캠페인 목표라서 타깃 고객이란 캠페인 목표라면');
});
check('a sentence-final period stays after the label',()=>assert.equal(label('측정은 campaign.plan.tracking. 다음 줄'),'측정은 수집할 데이터·측정 방법. 다음 줄'));
check('URLs (with or without a scheme), inline code and fenced code are untouched',()=>{
 const text='주소 https://mapdal.kr/e?ref=campaign.goal 와 mapdal.kr/event?ref=campaign.goal 와 `ref=campaign.plan.tracking` 표기\n```\ncampaign.goal=purchase\n## utm\n```\n본문 campaign.goal';
 assert.equal(label(text),text.replace(/본문 campaign\.goal$/,'본문 캠페인 목표'));
});
// 모델이 필드명을 백틱으로 감싸는 일은 흔하다. 인라인 코드 전체가 알려진 경로 하나면 산문으로 보고 라벨로 바꾼다.
check('an inline code span holding only a known path becomes the label',()=>{
 assert.equal(label('`campaign.plan.tracking` 기준으로 `campaign.goal`을 봅니다.'),'수집할 데이터·측정 방법 기준으로 캠페인 목표를 봅니다.');
 assert.equal(label('`campaign.plan.tracking.detail`과 `ref=campaign.goal`'),'`campaign.plan.tracking.detail`과 `ref=campaign.goal`');
});
// 울타리는 여는 문자·길이와 같은 줄에서만 닫힌다. 한 줄짜리 ```코드```는 울타리가 아니다.
check('code fences close only on the same marker and inline triple backticks open nothing',()=>{
 assert.equal(normalizeSectionBody('~~~\n```\n~~~\n## 제목\ncampaign.goal').text,'~~~\n```\n~~~\n### 제목\n캠페인 목표');
 assert.equal(normalizeSectionBody('````\n```\n## 코드\n````\n## 제목').text,'````\n```\n## 코드\n````\n### 제목');
 assert.equal(normalizeSectionBody('```campaign.goal```\n## 제목\ncampaign.goal').text,'```campaign.goal```\n### 제목\n캠페인 목표');
});
check('unknown, indexed and assigned paths are left for the grader',()=>{
 for(const text of ['campaign.address 확인','campaign.plan.tracking.detail 확인','evidence.facts.confirmed[0] 값','campaign.budget=null','campaign.budget = null','campaign.id=37da2d59-038a-4403-8374-de1f01f430f7','brandArchive.revision 17','mapdal.campaign.goal','/campaign.goal'])assert.equal(label(text),text,text);
});
check('the fact ledger bundle path is labelled like its children',()=>assert.equal(label('근거 위치는 evidence.facts 기준입니다.'),'근거 위치는 사실 원장 기준입니다.'));
check('every label target is a path the grader flags and no label is flagged',()=>{
 const flagged=k=>[...k.matchAll(SCHEMA_PATH)].map(m=>m[0]);
 for(const [path,value] of Object.entries(SCHEMA_PATH_LABELS)){
  if(!path.startsWith('storeContext.'))assert.deepEqual(flagged(path),[path],path);
  assert.deepEqual([...value.matchAll(SCHEMA_PATH),...value.matchAll(DEBUG_VALUE)],[],value);
 }
 for(const path of ['campaign.goal','campaign.audience','campaign.plan.hypothesis','campaign.plan.barrier','campaign.plan.tracking','evidence.facts.confirmed','evidence.facts.candidate','evidence.facts.prohibited','evidence.directives','brandArchive.confirmedSources','archive.confirmedSources','brandArchive.storeMarketing'])assert.ok(SCHEMA_PATH_LABELS[path],path);
});

// 2 계약 섹션 본문 제목 낮추기
check('body # and ## headings drop to ### outside code fences; ### and hashtags stay',()=>{
 const body='# 큰 제목\n본문\n## 소제목\n### 유지\n#맵달 #KPOP\n```\n## 코드 안\n```\n##\t탭 제목';
 assert.equal(normalizeSectionBody(body).text,'### 큰 제목\n본문\n### 소제목\n### 유지\n#맵달 #KPOP\n```\n## 코드 안\n```\n###\t탭 제목');
});
const long='첫 구매 고객이 배송 일정과 특전 구성을 한 화면에서 확인하지 못하면 장바구니에서 이탈한다고 가정합니다. [가설] 특전·배송일을 첫 화면에 두면 이탈이 줄어든다. 반증 조건은 2주 동안 이탈률이 기준 기간과 같을 때입니다. [자료 필요] 기준 기간 이탈률, 특전 재고, 확인 담당.';
check('parseRoleOutput keeps contract titles and the changes heading at ## and lowers body headings',()=>{
 const titles=roleOutputContract('strategy').sections.map(s=>s.title);
 const out=parseRoleOutput(raw('strategy',['## 메시지 구조\n'+long,'# 추천 방향\n'+long,long],'## 반영\n요청대로 고쳤습니다.'),'strategy',roleOutputContract('strategy'));
 assert.deepEqual(out.split('\n').filter(l=>/^##\s/.test(l)),[...titles.map(t=>'## '+t),'## 수정 요청 반영 위치']);
 assert.deepEqual(out.split('\n').filter(l=>/^###\s/.test(l)),['### 메시지 구조','### 추천 방향','### 반영']);
});

// 3 멱등성·건수
const baseline=[
 '## 메시지 구조\n\ncampaign.audience를 K-POP 앨범을 처음 사는 팬으로 좁히고 campaign.plan.barrier와 campaign.plan.hypothesis를 한 줄로 연결합니다. '+long,
 '# 추천 방향\n\nevidence.facts.confirmed에 없는 가격·할인 조건은 쓰지 않고 [확인 필요]로 둡니다. campaign.goal(구매 전환)과 evidence.directives를 함께 반영해 A안을 고릅니다. B안은 특전 비교형이며 재고 확인 전에는 보류합니다.\n\n## 대안 비교\n\n'+long,
 '측정은 campaign.plan.tracking 기준으로 합니다. 랜딩 예시 주소는 https://mapdal.kr/event?ref=campaign.goal 입니다. 크리에이티브 평가 기준은 첫 화면에서 특전·배송일·행동 버튼이 모두 보이는지입니다. '+long,
];
const strategyRaw=raw('strategy',baseline);
check('normalization is idempotent',()=>{
 for(const body of baseline){
  const once=normalizeSectionBody(body),again=normalizeSectionBody(once.text);
  assert.notEqual(once.text,body);
  assert.equal(again.text,once.text);
  assert.deepEqual(plain(again.normalization),{schemaPaths:0,headings:0});
 }
 const rendered=parseRoleOutput(strategyRaw,'strategy',roleOutputContract('strategy')),relabelled=labelSchemaPaths(rendered);
 assert.equal(relabelled.text,rendered);
 assert.equal(relabelled.count,0);
});
check('renderRoleOutput reports kinds and counts without values',()=>{
 const {content,normalization}=renderRoleOutput(strategyRaw,'strategy',roleOutputContract('strategy'));
 assert.equal(content,parseRoleOutput(strategyRaw,'strategy',roleOutputContract('strategy')));
 assert.deepEqual(plain(normalization),{schemaPaths:7,headings:3});
});
// 예방 측정용: 정규화하지 않은 렌더본(품질 기준선 v1이 채점한 본문과 같은 방식).
check('renderRoleOutput with normalize:false renders the model text as is',()=>{
 const {content,normalization}=renderRoleOutput(strategyRaw,'strategy',roleOutputContract('strategy'),{normalize:false});
 assert.equal(content,roleOutputContract('strategy').sections.map((s,i)=>`## ${s.title}\n\n${baseline[i].trim()}`).join('\n\n'));
 assert.deepEqual(plain(normalization),{schemaPaths:0,headings:0});
});
check('legacy output without a contract is returned unchanged',()=>{
 const legacy='## 결론\ncampaign.goal 기준 초안입니다.';
 assert.equal(parseRoleOutput(legacy,'cmo'),legacy);
 assert.deepEqual(plain(renderRoleOutput(legacy,'cmo').normalization),{schemaPaths:0,headings:0});
});

// 4 채점기: 기준선 실측 문구 합성 재현 → 정규화 결과 통과
check('baseline-like strategy output fails both graders before normalization',()=>{
 const unnormalized=roleOutputContract('strategy').sections.map((s,i)=>`## ${s.title}\n\n${baseline[i]}`).join('\n\n');
 const item={id:'b',kind:'role',role:'strategy',contract:true,text:unnormalized};
 assert.equal(status('internal_id_exposure',item),'fail');
 assert.equal(status('heading_nesting',item),'fail');
});
check('the same raw output passes both graders through the eval render path',()=>{
 const item={id:'e',kind:'role',role:'strategy',contract:true,raw:strategyRaw};
 assert.equal(status('internal_id_exposure',item),'pass');
 assert.equal(status('heading_nesting',item),'pass');
 assert.equal(status('contract_json',item),'pass');
});
// 정규화가 가린 결함은 예방된 것이 아니다. 예방 판정은 정규화 전 렌더본으로 두 채점기를 따로 돌린다.
check('prevention graders still fail the raw output that normalization cleaned',()=>{
 const item={id:'e',kind:'role',role:'strategy',contract:true,raw:strategyRaw};
 assert.deepEqual([...PREVENTION_GRADERS],['heading_nesting','internal_id_exposure']);
 assert.equal(prevention('internal_id_exposure',item),'fail');
 assert.equal(prevention('heading_nesting',item),'fail');
 const clean={id:'k',kind:'role',role:'strategy',contract:true,raw:raw('strategy',[long,long,long])};
 assert.deepEqual(plain(runPreventionGraders(clean,{}).map(r=>r.status)),['pass','pass']);
 assert.deepEqual(plain(runPreventionGraders({id:'t',kind:'role',role:'strategy',contract:true,text:'본문'},{})),[]);
});
check('the production path (parse, then scrubInternalIds) passes both graders',()=>{
 const saved=scrubInternalIds(parseRoleOutput(strategyRaw,'strategy',roleOutputContract('strategy')));
 const item={id:'p',kind:'role',role:'strategy',contract:true,text:saved};
 assert.equal(status('internal_id_exposure',item),'pass');
 assert.equal(status('heading_nesting',item),'pass');
});
check('ODA-like insight output with store paths passes internal_id_exposure',()=>{
 const oda=['[확인 사실] campaign.stores 및 campaign.products: 주소는 확정, 메뉴·가격은 미확정입니다. brandArchive.confirmedSources와 brandArchive.storeMarketing.operations에는 관찰 수치가 없습니다. '+long,long,long];
 assert.equal(status('internal_id_exposure',{id:'o',kind:'role',role:'insight',contract:true,raw:raw('insight',oda)}),'pass');
});
check('a known path alone in inline code is labelled; a longer code span is still caught by the grader',()=>{
 assert.equal(status('internal_id_exposure',{id:'c',kind:'role',role:'insight',contract:true,raw:raw('insight',['`campaign.plan.tracking` 기준. '+long,long,long])}),'pass');
 assert.equal(status('internal_id_exposure',{id:'d',kind:'role',role:'insight',contract:true,raw:raw('insight',['`campaign.plan.tracking.detail` 기준. '+long,long,long])}),'fail');
});

// 5 품질 검수 JSON: 경로만 라벨로 바꾸고 JSON은 그대로 파싱된다
const qualityJson=JSON.stringify({verdict:'revise',summary:'측정 정의 보완 필요',findings:'campaign.plan.tracking이 비어 있고 evidence.facts.confirmed에 가격이 없습니다.',checks:[{criterion:'measurement',status:'revise',location:'campaign.plan.tracking',finding:'30일 재방문 코호트 정의가 없습니다.',fix:'관찰이 끝난 코호트 기준을 적으세요.'}],taskChecks:[]},null,1);
check('quality JSON paths are labelled and still parse, fenced or not',()=>{
 for(const text of [qualityJson,'```json\n'+qualityJson+'\n```']){
  const out=normalizeQualityOutput(text);
  assert.equal(out.normalization.schemaPaths,3);
  const q=parseStandaloneQuality(out.text,true);
  assert.equal(q.checks[0].location,'수집할 데이터·측정 방법');
  assert.match(q.findings,/^수집할 데이터·측정 방법이 비어 있고 확정 사실에 가격이 없습니다\.$/);
  assert.equal(parseRoleOutput(text,'quality',roleOutputContract('quality')),out.text);
  assert.equal(status('internal_id_exposure',{id:'q',kind:'role',role:'quality',contract:true,raw:text}),'pass');
 }
 assert.equal(parseRoleOutput(qualityJson,'quality'),qualityJson);
});
// 품질 JSON은 문자열 값마다 풀어서(\\n·\\t 이스케이프, 문자열 경계) 정규화한다. 원문 JSON 텍스트에 정규식을 걸면 이스케이프 뒤·URL 뒤·문자열을 넘는 백틱 사이 경로를 놓친다.
check('quality JSON paths after escapes, URLs and cross-string backticks are labelled and never reach the saved markdown',()=>{
 const cases=[
  {verdict:'revise',summary:'측정 보완',findings:'발견 사항:\ncampaign.plan.tracking이 비어 있음\n\tevidence.facts.confirmed에 가격 없음',checks:[],taskChecks:[]},
  {verdict:'revise',summary:'측정 보완',findings:'링크 점검',checks:[{criterion:'measurement',status:'revise',location:'https://x.kr/a',finding:'campaign.plan.tracking 없음',fix:'수집 항목을 정하세요.'}],taskChecks:[]},
  {verdict:'revise',summary:'`a 표기',findings:'campaign.goal 은 `b` 기준입니다.',checks:[],taskChecks:[]},
 ];
 for(const value of cases)for(const text of [JSON.stringify(value),JSON.stringify(value,null,1),'```json\n'+JSON.stringify(value)+'\n```']){
  const out=normalizeQualityOutput(text);
  assert.ok(out.normalization.schemaPaths>0,text);
  const saved=scrubInternalIds(qualityMarkdown(parseStandaloneQuality(parseRoleOutput(text,'quality',roleOutputContract('quality')),true)));
  assert.deepEqual([...saved.matchAll(SCHEMA_PATH)].map(m=>m[0]),[],saved);
  assert.equal(status('internal_id_exposure',{id:'s',kind:'role',role:'quality',contract:true,text:saved}),'pass');
  assert.equal(status('internal_id_exposure',{id:'r',kind:'role',role:'quality',contract:true,raw:text}),'pass');
  assert.equal(prevention('internal_id_exposure',{id:'r',kind:'role',role:'quality',contract:true,raw:text}),'fail');
 }
 const pretty=JSON.stringify(cases[0],null,2),out=normalizeQualityOutput(pretty).text;
 assert.equal(out.split('\n').length,pretty.split('\n').length);
 assert.equal(normalizeQualityOutput('검수 결과: campaign.goal 확인 필요').text,'검수 결과: campaign.goal 확인 필요');
});
console.log(JSON.stringify({passed:passed.length}));
