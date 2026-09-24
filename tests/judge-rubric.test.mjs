// J1 AI 심사 루브릭(lib/judge-rubric.ts): 7기준 정의·1~5 앵커·역할별 적용표·RUBRIC_VERSION, 심사 프롬프트 빌더의 금지 필드 거부·편향 정보 부재, 응답 파서의 무효 사례를 고정한다.
// 모든 입력은 합성 데이터다. 모델·HERMES·네트워크 호출은 0이다(mocked: fetch 스텁이 호출되면 실패).
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const jr=await rt.load('lib/judge-rubric.ts'),{roles}=await rt.load('lib/agency.ts');
let passed=0;
const check=(name,ok)=>{assert.ok(ok,name);passed++};
const throwsCode=(fn,code)=>{try{fn();return false}catch(e){return e.name==='JudgePromptError'&&e.code===code&&e.status===422&&/[가-힣]/.test(e.message)}};
const deepFreeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(deepFreeze);Object.freeze(v)}return v};
const safe=fn=>{try{return fn()}catch{return false}};
const errorOf=fn=>{try{fn();return null}catch(e){return e}};

// 1) 루브릭: 버전·7기준(설계 문서 judge-rubric-v1의 최종 이름)·앵커·적용표·채택 대상
const IDS=['evidence_linkage','actionability','causal_overreach','strategic_validity','persuasion','generic_positioning','concept_diversity'];
check('rubric version is judge-rubric-v1',jr.RUBRIC_VERSION==='judge-rubric-v1');
check('seven criteria with the design names in order',jr.JUDGE_CRITERIA.map(c=>c.id).join()===IDS.join());
check('every criterion has a Korean label and definition',jr.JUDGE_CRITERIA.every(c=>/[가-힣]/.test(c.label)&&/[가-힣]/.test(c.definition)&&c.definition.length<=120));
check('every criterion has five short anchors (scores 1..5)',jr.JUDGE_CRITERIA.every(c=>c.anchors.length===5&&c.anchors.every(a=>typeof a==='string'&&/[가-힣]/.test(a)&&a.length>0&&a.length<=60)));
check('anchors are distinct within a criterion',jr.JUDGE_CRITERIA.every(c=>new Set(c.anchors).size===5));
const TABLE={persuasion:['strategy','creative','content'],strategic_validity:['cmo','strategy','growth','creative'],evidence_linkage:['cmo','insight','strategy','creative','content','growth','data'],
 generic_positioning:['strategy','creative','content'],actionability:['cmo','creative','content','growth','data'],concept_diversity:['creative','content'],causal_overreach:['insight','strategy','cmo','growth','data']};
const byId=Object.fromEntries(jr.JUDGE_CRITERIA.map(c=>[c.id,c]));
check('role application table matches the design table',IDS.every(id=>[...byId[id].roles].sort().join()===[...TABLE[id]].sort().join()));
check('application table only names real agency roles',jr.JUDGE_CRITERIA.every(c=>c.roles.every(r=>roles.some(x=>x.id===r))));
check('quality role is not judged in v1 (B1 kappa already calibrates it)',jr.applicableCriteria('quality').length===0&&jr.JUDGE_CRITERIA.every(c=>!c.roles.includes('quality')));
// 7개 캠페인 × 적용 역할 수 = 설계 검토(3-1) 표의 표본 수: persuasion 21, strategic_validity 28, evidence_linkage 49, generic_positioning 21, actionability 35, concept_diversity 14, causal_overreach 35.
const SEVEN={persuasion:21,strategic_validity:28,evidence_linkage:49,generic_positioning:21,actionability:35,concept_diversity:14,causal_overreach:35};
check('per-criterion sample over 7 campaigns matches the critique table',IDS.every(id=>byId[id].roles.length*7===SEVEN[id]));
check('adoption targets are exactly evidence_linkage, actionability, causal_overreach',jr.JUDGE_CRITERIA.filter(c=>c.adoptable).map(c=>c.id).join()==='evidence_linkage,actionability,causal_overreach');
check('applicableCriteria(creative) keeps rubric order',jr.applicableCriteria('creative').join()==='evidence_linkage,actionability,strategic_validity,persuasion,generic_positioning,concept_diversity');
check('applicableCriteria(insight) is evidence_linkage and causal_overreach',jr.applicableCriteria('insight').join()==='evidence_linkage,causal_overreach');
check('unknown role has no criteria',jr.applicableCriteria('ghost').length===0);
check('only the role kind is judged in v1',jr.JUDGE_KINDS.join()==='role');
check('rubric constants are frozen',Object.isFrozen(jr.JUDGE_CRITERIA)&&jr.JUDGE_CRITERIA.every(c=>Object.isFrozen(c)&&Object.isFrozen(c.anchors)&&Object.isFrozen(c.roles)));

// 2) 빌더: 허용 키만 받고, 금지 필드(모델·variant·expectations·후보 등)는 어느 깊이든 거부한다.
const OUTPUT='## 캠페인 콘셉트\n\n### 콘셉트 A — 줄 서는 도넛\n주말 오전 11시 한정 50개. 품절 시간표를 매장 앞 보드에 공개합니다.\n\n### 콘셉트 B — 크림의 무게\n"한 입에 크림 38g" 확인 필요. 단면 사진으로 보여줍니다.\n\n문의: 010-1234-5678';
const FACTS=[{key:'store_hours',value:'매일 10:00~21:00',source:'점주 확인',verifiedAt:'2026-09-01',validUntil:'2026-12-31',scope:'brand'}];
const BRAND={identity:{name:'Old Ferry Donut',short:'OFD',category:'BAKERY & COFFEE',color:'#273953',tone:'클래식하고 위트 있는',audience:'좋은 디저트를 찾는 고객',constraints:'상시 가격 할인에 의존하지 않기.'},brandIntro:{text:'소개: 묵직하고 쫄깃한 도우.',verification:'unverified',useInCopy:false}};
const base=()=>({kind:'role',role:'creative',renderedOutput:OUTPUT,brief:{constraints:'할인 표현 금지. 경쟁사 비교 금지.'},confirmedFacts:FACTS,brand:BRAND,upstreamExcerpt:'strategy: 핵심 메시지는 크림의 양이 아니라 한 입의 만족감.'});
const req=deepFreeze(base());
const prompt=jr.buildJudgePrompt(req);
check('builder returns instructions, input and the sent record',typeof prompt.instructions==='string'&&typeof prompt.input==='string'&&prompt.sent.role==='creative'&&prompt.sent.kind==='role'&&typeof prompt.sent.output==='string');
check('builder does not mutate its (frozen) request',JSON.stringify(req)===JSON.stringify(deepFreeze(base())));
check('builder is deterministic (byte identical for the same request)',JSON.stringify(jr.buildJudgePrompt(base()))===JSON.stringify(prompt));
for(const [name,extra] of [['model',{model:'gpt-5'}],['variant',{variant:'candidate'}],['expectations',{expectations:{prohibitedTerms:['할인']}}],['candidates',{candidates:['a','b']}],['promptVersion',{promptVersion:'v3'}],['runId',{runId:'run-1'}],['unknown key',{notes:'x'}]])
 check(`builder rejects a request with ${name}`,throwsCode(()=>jr.buildJudgePrompt({...base(),...extra}),'forbidden_field'));
check('builder rejects a forbidden key nested in brand',throwsCode(()=>jr.buildJudgePrompt({...base(),brand:{...BRAND,identity:{...BRAND.identity,model:'gpt-5'}}}),'forbidden_field'));
check('builder rejects a forbidden key nested in confirmed facts',throwsCode(()=>jr.buildJudgePrompt({...base(),confirmedFacts:[{...FACTS[0],variant:'active'}]}),'forbidden_field'));
check('builder rejects prohibitedTerms (golden labels) nested anywhere',throwsCode(()=>jr.buildJudgePrompt({...base(),confirmedFacts:[{key:'x',value:'y',prohibitedTerms:['z']}]}),'forbidden_field'));
check('forbidden-field error names the path, never the value',(()=>{try{jr.buildJudgePrompt({...base(),brand:{...BRAND,variant:'secret-candidate-name'}})}catch(e){return e.message.includes('brand.variant')&&!e.message.includes('secret-candidate-name')}return false})());
check('builder rejects an unknown kind (meeting is v2)',throwsCode(()=>jr.buildJudgePrompt({...base(),kind:'meeting'}),'unsupported_kind'));
check('builder rejects the quality role',throwsCode(()=>jr.buildJudgePrompt({...base(),role:'quality'}),'unsupported_role'));
check('builder rejects an unknown role',throwsCode(()=>jr.buildJudgePrompt({...base(),role:'ghost'}),'unsupported_role'));
check('builder rejects an empty rendered output',throwsCode(()=>jr.buildJudgePrompt({...base(),renderedOutput:'  \n '}),'bad_request'));
check('builder rejects a non-string output',throwsCode(()=>jr.buildJudgePrompt({...base(),renderedOutput:{text:'x'}}),'bad_request'));
check('builder rejects a non-array confirmedFacts',throwsCode(()=>jr.buildJudgePrompt({...base(),confirmedFacts:'x'}),'bad_request'));
check('builder rejects a non-object request',throwsCode(()=>jr.buildJudgePrompt(null),'bad_request'));

// 2b) 허용 목록 투영(운영 aiBrand·confirmedItem과 같은 모양): 목록 밖 키는 거부하고 값 형식이 틀리면 bad_request다. 오류 문구에 값은 싣지 않는다.
const intake=errorOf(()=>jr.buildJudgePrompt({...base(),brand:{...BRAND,id:'b-1',intake:{contact:'kim@example.com 010-9999-8888'},knowledge:'메모 010-7777-6666'}}));
check('brand keys outside aiBrand (intake·id·knowledge) are rejected without the values',intake?.code==='forbidden_field'&&intake.message.includes('brand.intake')&&!/kim@example|010-9999|010-7777/.test(intake.message));
check('brand identity keys outside the seven fields are rejected',throwsCode(()=>jr.buildJudgePrompt({...base(),brand:{...BRAND,identity:{...BRAND.identity,description:'소개 원문'}}}),'forbidden_field'));
check('non-string brand identity values are bad_request (masking only covers strings)',throwsCode(()=>jr.buildJudgePrompt({...base(),brand:{...BRAND,identity:{...BRAND.identity,audience:['연락 010-2222-3333']}}}),'bad_request')&&throwsCode(()=>jr.buildJudgePrompt({...base(),brand:{...BRAND,identity:{...BRAND.identity,constraints:{note:'kim@example.com'}}}}),'bad_request'));
check('brand intro must stay unverified and out of copy',throwsCode(()=>jr.buildJudgePrompt({...base(),brand:{...BRAND,brandIntro:{...BRAND.brandIntro,verification:'verified'}}}),'bad_request')&&throwsCode(()=>jr.buildJudgePrompt({...base(),brand:{...BRAND,brandIntro:{...BRAND.brandIntro,useInCopy:true}}}),'bad_request'));
const note=errorOf(()=>jr.buildJudgePrompt({...base(),confirmedFacts:[{...FACTS[0],note:'kim@example.com'}]}));
check('confirmed fact keys outside confirmedItem (note) are rejected without the value',note?.code==='forbidden_field'&&!note.message.includes('kim@example.com'));
check('non-string confirmed fact fields are bad_request',throwsCode(()=>jr.buildJudgePrompt({...base(),confirmedFacts:[{...FACTS[0],source:{who:'점주 010-4444-5555'}}]}),'bad_request')&&throwsCode(()=>jr.buildJudgePrompt({...base(),confirmedFacts:['매일 영업']}),'bad_request'));
const partial=safe(()=>JSON.parse(jr.buildJudgePrompt({...base(),brand:{brandIntro:{text:'소개'},identity:{constraints:'할인 금지',name:'A'}}}).input).brand);
check('brand is projected to the aiBrand shape in canonical order',JSON.stringify(partial)===JSON.stringify({identity:{name:'A',constraints:'할인 금지'},brandIntro:{text:'소개',verification:'unverified',useInCopy:false}}));
const nest=(n,leaf)=>n?{x:nest(n-1,leaf)}:leaf;
check('a forbidden key deeper than the scan limit is rejected (fail closed)',throwsCode(()=>jr.buildJudgePrompt({...base(),brand:{...BRAND,deep:nest(14,{model:'gpt-5-candidate'})}}),'forbidden_field'));
check('forbidden keys match regardless of case',throwsCode(()=>jr.buildJudgePrompt({...base(),confirmedFacts:[{...FACTS[0],Model:'gpt-5'}]}),'forbidden_field')&&throwsCode(()=>jr.buildJudgePrompt({...base(),brief:{constraints:'x',VARIANT:'candidate'}}),'forbidden_field'));

// 2c) 값 수준 금지(J3가 run이 보고한 모델 id·별칭, 평가 연결 model, promptVersion·promptHash, variant 이름을 넘긴다): 가린 입력·지시문에 있으면 값을 밝히지 않고 거부한다.
const DENY=['gpt-6-astra','insight@abc123','candidate-b'];
const leak=errorOf(()=>jr.buildJudgePrompt({...base(),upstreamExcerpt:'model: gpt-6-astra variant: candidate-b'},{denyTerms:DENY}));
check('a deny term (reported model) in the upstream excerpt is forbidden_field without naming it',leak?.code==='forbidden_field'&&leak.status===422&&!/gpt-6-astra|candidate-b/i.test(leak.message));
check('deny terms match case-insensitively in the rendered output',throwsCode(()=>jr.buildJudgePrompt({...base(),renderedOutput:OUTPUT+'\n작성: GPT-6-Astra'},{denyTerms:DENY}),'forbidden_field'));
check('deny terms are checked in brief, facts and brand too',throwsCode(()=>jr.buildJudgePrompt({...base(),brief:{constraints:'insight@abc123 기준'}},{denyTerms:DENY}),'forbidden_field')&&throwsCode(()=>jr.buildJudgePrompt({...base(),confirmedFacts:[{...FACTS[0],source:'gpt-6-astra 요약'}]},{denyTerms:DENY}),'forbidden_field')&&throwsCode(()=>jr.buildJudgePrompt({...base(),brand:{...BRAND,brandIntro:{text:'Candidate-B 소개'}}},{denyTerms:DENY}),'forbidden_field'));
check('deny terms shorter than three characters are ignored',safe(()=>typeof jr.buildJudgePrompt(base(),{denyTerms:['ab','가']}).input==='string'));
check('a clean request with deny terms builds the same prompt',safe(()=>JSON.stringify(jr.buildJudgePrompt(base(),{denyTerms:DENY}))===JSON.stringify(prompt)));
check('denyTerms must be an array of strings',throwsCode(()=>jr.buildJudgePrompt(base(),{denyTerms:'gpt-6-astra'}),'bad_request')&&throwsCode(()=>jr.buildJudgePrompt(base(),{denyTerms:[1]}),'bad_request'));

// 2d) 브리프 요약(설계 2절: 목표·타깃·KPI·예산 확정 여부·채널·금지 표현)과 거절된 사실. 운영 캠페인·사실 원장과 같은 가림을 거친다.
const BRIEF={goal:'주말 오전 재방문 늘리기(문의 kim@example.com)',audience:'근처 직장인',kpi:'재방문율 = 4주 안 2회 방문 고객 / 첫 방문 고객',channels:'인스타그램, 매장 보드',constraints:'할인 표현 금지. 경쟁사 비교 금지.',budgetConfirmed:false};
const REJECTED=[{key:'best_seller',value:'판매 1위 010-3333-4444',scope:'브랜드'}];
const briefed=safe(()=>JSON.parse(jr.buildJudgePrompt({...base(),brief:BRIEF,rejectedFacts:REJECTED}).input));
check('brief summary carries goal, audience, KPI, channels, constraints and budget status',!!briefed&&Object.keys(briefed.brief).join()==='goal,audience,kpi,channels,constraints,budgetConfirmed'&&briefed.brief.kpi===BRIEF.kpi&&briefed.brief.budgetConfirmed===false);
check('brief free text is masked like production campaign fields',!!briefed&&briefed.brief.goal.includes('[이메일]')&&!JSON.stringify(briefed).includes('kim@example.com'));
check('rejected facts are sent as key/value/scope with masked values',!!briefed&&Object.keys(briefed.facts.rejected[0]).join()==='key,value,scope'&&briefed.facts.rejected[0].value.includes('[전화번호]')&&!JSON.stringify(briefed).includes('010-3333-4444'));
check('brief keys outside the summary are rejected',throwsCode(()=>jr.buildJudgePrompt({...base(),brief:{...BRIEF,budget:5000000}}),'forbidden_field'));
check('budgetConfirmed must be a boolean',throwsCode(()=>jr.buildJudgePrompt({...base(),brief:{...BRIEF,budgetConfirmed:'yes'}}),'bad_request'));
check('rejected fact keys outside key/value/scope are rejected',throwsCode(()=>jr.buildJudgePrompt({...base(),rejectedFacts:[{...REJECTED[0],status:'rejected'}]}),'forbidden_field'));

// 3) 빌더 출력: 편향 유발 정보 없음, 도구 금지·길이 가산 금지·출력 스키마, 적용 기준만
const text=(prompt.instructions+'\n'+prompt.input).toLowerCase();
for(const word of ['model','모델','variant','active','candidate','후보','expectation','prohibitedterms','pair','baseline','gpt','claude','hermes','openai','run-','promptversion','sealed','봉인'])
 check(`prompt carries no bias-inducing word: ${word}`,!text.includes(word));
const input=JSON.parse(prompt.input);
check('input keys are the judged material only',Object.keys(input).join()==='task,output,brief,facts,brand,upstream'&&Object.keys(input.task).join()==='kind,role,roleName,deliverable');
check('facts carry confirmed and rejected facts',Object.keys(input.facts).join()==='confirmed,rejected');
check('instructions name the brief and rejected facts as material',/brief/.test(prompt.instructions)&&/facts\.rejected/.test(prompt.instructions));
check('instructions forbid tools',/도구/.test(prompt.instructions)&&/검색/.test(prompt.instructions));
check('instructions forbid scoring by length',/길이/.test(prompt.instructions)&&/가산|올리지/.test(prompt.instructions));
check('instructions say the material is data, not instructions',/지시문/.test(prompt.instructions)&&/따르지/.test(prompt.instructions));
check('instructions describe the JSON schema (score 1~5|null, quotes 1~3, reason ≤300, uncertain)',['"criteria"','"score"','"quotes"','"reason"','"uncertain"','300','1~3','null'].every(s=>prompt.instructions.includes(s)));
check('instructions list only the criteria that apply to the role, with all five anchors',jr.applicableCriteria('creative').every(id=>prompt.instructions.includes(id)&&byId[id].anchors.every(a=>prompt.instructions.includes(a)))&&!prompt.instructions.includes('causal_overreach'));
const insight=jr.buildJudgePrompt({...base(),role:'insight'});
check('insight prompt lists evidence_linkage and causal_overreach only',insight.instructions.includes('evidence_linkage')&&insight.instructions.includes('causal_overreach')&&!['persuasion','actionability','concept_diversity','generic_positioning','strategic_validity'].some(id=>insight.instructions.includes(id)));
check('instructions do not carry the rubric version (the code records it)',!prompt.instructions.includes('judge-rubric'));
// 가림: 산출물·브리프·상류 발췌·브랜드 자유 텍스트는 운영과 같은 가림(pii-scan)을 거치고, 파서가 대조할 본문은 실제로 보낸 가림본이다.
check('phone number in the output is masked in the input',!prompt.input.includes('010-1234-5678')&&input.output.includes('[전화번호]'));
check('sent output is exactly the masked output in the input',prompt.sent.output===input.output&&prompt.sent.output!==OUTPUT);
check('masking record is returned without values',Array.isArray(prompt.masking)&&prompt.masking.some(m=>m.field==='output'&&m.kind==='phone'&&m.count===1)&&!JSON.stringify(prompt.masking).includes('1234'));
check('confirmed fact values are allowed (not masked) and sent as given',JSON.stringify(input.facts.confirmed)===JSON.stringify(FACTS));
const allowed=jr.buildJudgePrompt({...base(),allow:['010-1234-5678']});
check('an explicit allow list (production allow values) keeps the value',JSON.parse(allowed.input).output.includes('010-1234-5678')&&allowed.sent.output===OUTPUT);
check('brand audience/constraints are masked like production (email in constraints)',JSON.parse(jr.buildJudgePrompt({...base(),brand:{...BRAND,identity:{...BRAND.identity,constraints:'문의 kim@example.com'}}}).input).brand.identity.constraints.includes('[이메일]'));
const longUp=jr.buildJudgePrompt({...base(),upstreamExcerpt:'가'.repeat(jr.UPSTREAM_MAX_CHARS+500)});
check('upstream excerpt is capped at UPSTREAM_MAX_CHARS',JSON.parse(longUp.input).upstream.length===jr.UPSTREAM_MAX_CHARS);
const minimal=JSON.parse(jr.buildJudgePrompt({kind:'role',role:'insight',renderedOutput:'관찰: 주말 오전 방문이 많습니다.'}).input);
check('optional material defaults to empty values',minimal.brief.constraints===''&&minimal.facts.confirmed.length===0&&minimal.brand===null&&minimal.upstream==='');
check('an absent brief is empty text with unknown budget status, and no rejected facts',minimal.brief.goal===''&&minimal.brief.kpi===''&&minimal.brief.budgetConfirmed===null&&Array.isArray(minimal.facts.rejected)&&minimal.facts.rejected.length===0);
const UP=jr.UPSTREAM_MAX_CHARS;
const cutPhone=safe(()=>JSON.parse(jr.buildJudgePrompt({...base(),upstreamExcerpt:'가'.repeat(UP-11)+' 010-1234-5678 끝'}).input).upstream);
check('a phone number across the upstream cut is masked before the cut',typeof cutPhone==='string'&&!cutPhone.includes('010-1234')&&Array.from(cutPhone).length<=UP);
const cutMail=safe(()=>JSON.parse(jr.buildJudgePrompt({...base(),upstreamExcerpt:'가'.repeat(UP-12)+' kim.lee@example.com 끝'}).input).upstream);
check('an email across the upstream cut is masked before the cut',typeof cutMail==='string'&&!cutMail.includes('kim.lee')&&Array.from(cutMail).length<=UP);

// 4) 파서: JSON 추출, 적용표 밖·범위 밖 점수, 없는 인용은 그 기준만 무효
const sent=prompt.sent;
const crit=(id,score,quotes,extra={})=>({id,score,uncertain:false,quotes,reason:'근거가 연결됩니다.',...extra});
const Q1='주말 오전 11시 한정 50개',Q2='품절 시간표를 매장 앞 보드에 공개합니다',Q3='단면 사진으로 보여줍니다';
const good={criteria:[crit('evidence_linkage',4,[Q1]),crit('actionability',3,[Q2,Q3]),crit('strategic_validity',3,[Q1]),crit('persuasion',4,[Q2]),crit('generic_positioning',2,[Q3]),crit('concept_diversity',2,[Q1,Q3])]};
const r=jr.parseJudgeResponse(JSON.stringify(good),sent);
check('valid response parses with every criterion valid',r.ok&&r.rubricVersion==='judge-rubric-v1'&&r.criteria.length===6&&r.criteria.every(c=>c.valid&&c.invalid.length===0)&&r.missing.length===0);
check('scores and quotes are kept',r.criteria.find(c=>c.id==='actionability').score===3&&r.criteria.find(c=>c.id==='actionability').quotes.join('|')===[Q2,Q3].join('|'));
check('fenced JSON is extracted',jr.parseJudgeResponse('```json\n'+JSON.stringify(good)+'\n```',sent).ok);
check('JSON wrapped in prose is extracted',jr.parseJudgeResponse('심사 결과입니다.\n'+JSON.stringify(good)+'\n이상입니다.',sent).ok);
const notJson=jr.parseJudgeResponse('점수: 근거 연결 4점, 실행 가능성 3점',sent);
check('non-JSON response is rejected as a whole',!notJson.ok&&notJson.error==='not_json'&&/[가-힣]/.test(notJson.message));
check('non-string response is not_json',jr.parseJudgeResponse(undefined,sent).error==='not_json');
check('criteria that is not an array is bad_shape',jr.parseJudgeResponse(JSON.stringify({criteria:{evidence_linkage:4}}),sent).error==='bad_shape');
const one=(entry,s=sent)=>jr.parseJudgeResponse(JSON.stringify({criteria:[entry]}),s).criteria[0];
const fake=one(crit('evidence_linkage',5,['매일 선착순 100명에게 무료 증정']));
check('quote that is not in the sent output invalidates that criterion',!fake.valid&&fake.invalid.includes('quote_not_found')&&fake.score===null);
const mixed=one(crit('evidence_linkage',4,[Q1,'없는 문장을 지어낸 인용입니다']));
check('one fabricated quote among real ones still invalidates',!mixed.valid&&mixed.invalid.includes('quote_not_found'));
const unmasked=one(crit('evidence_linkage',4,['문의: 010-1234-5678']));
check('quote of the unmasked original (not what was sent) is invalid',!unmasked.valid&&unmasked.invalid.includes('quote_not_found'));
check('quote of the masked text as sent is valid',one(crit('evidence_linkage',4,['단면 사진으로 보여줍니다. 문의: [전화번호]'])).valid);
check('whitespace, punctuation and markdown differences are normalized',one(crit('evidence_linkage',4,['**주말  오전 11시 한정 50개.**'])).valid&&one(crit('evidence_linkage',4,['콘셉트 A — 줄 서는 도넛'])).valid&&one(crit('evidence_linkage',4,['콘셉트 A 줄서는 도넛'])).valid);
check('full-width characters are NFKC-normalized',one(crit('evidence_linkage',4,['주말 오전 １１시 한정 ５０개'])).valid);
const oos=jr.parseJudgeResponse(JSON.stringify({criteria:[crit('evidence_linkage',4,[Q1]),crit('causal_overreach',2,[Q1])]}),sent);
check('score on a criterion outside the role table is invalid (not_applicable)',oos.criteria.find(c=>c.id==='causal_overreach').invalid.includes('not_applicable')&&oos.criteria.find(c=>c.id==='causal_overreach').score===null&&oos.criteria.find(c=>c.id==='evidence_linkage').valid);
const insightSent=insight.sent;
check('persuasion on an insight output is not_applicable',one(crit('persuasion',4,[Q1]),insightSent).invalid.includes('not_applicable'));
for(const bad of [0,6,-1,3.5,'4',true])check(`score ${JSON.stringify(bad)} is out of range`,one(crit('evidence_linkage',bad,[Q1])).invalid.includes('score_out_of_range'));
check('scored criterion without quotes is invalid',one(crit('evidence_linkage',4,[])).invalid.includes('quotes_missing')&&one(crit('evidence_linkage',4,undefined)).invalid.includes('quotes_missing'));
check('more than three quotes is invalid',one(crit('evidence_linkage',4,[Q1,Q2,Q3,Q1])).invalid.includes('too_many_quotes'));
check('too-short quote (under MIN_QUOTE_CHARS after normalization) is invalid',one(crit('evidence_linkage',4,['50개'])).invalid.includes('quote_too_short')&&jr.MIN_QUOTE_CHARS===4);
check('non-string quote is invalid',one(crit('evidence_linkage',4,[42])).invalid.includes('quote_not_found'));
const unsure=one({id:'evidence_linkage',score:null,uncertain:true,quotes:[],reason:'근거를 판단할 자료가 없습니다.'});
check('score null with uncertain true is a valid uncertain answer',unsure.valid&&unsure.score===null&&unsure.uncertain===true);
check('uncertain flag is only true for boolean true',one(crit('evidence_linkage',4,[Q1],{uncertain:'yes'})).uncertain===false);
check('reason is cut to 300 characters',one(crit('evidence_linkage',4,[Q1],{reason:'가'.repeat(400)})).reason.length===jr.REASON_MAX_CHARS&&jr.REASON_MAX_CHARS===300);
const part=jr.parseJudgeResponse(JSON.stringify({criteria:[crit('evidence_linkage',4,[Q1])]}),sent);
check('applicable criteria without an answer are listed as missing',part.missing.join()==='actionability,strategic_validity,persuasion,generic_positioning,concept_diversity');
const dup=jr.parseJudgeResponse(JSON.stringify({criteria:[crit('evidence_linkage',4,[Q1]),crit('evidence_linkage',2,[Q2])]}),sent);
check('duplicated criterion invalidates both answers',dup.criteria.filter(c=>c.id==='evidence_linkage').length===2&&dup.criteria.every(c=>!c.valid&&c.invalid.includes('duplicate')));
const unk=one(crit('brand_love',5,[Q1]));
check('unknown criterion id is invalid',!unk.valid&&unk.invalid.includes('unknown_criterion'));
check('entry without an id is bad_shape',one({score:4,quotes:[Q1]}).invalid.includes('bad_shape')&&one('evidence_linkage').invalid.includes('bad_shape'));
check('parser does not mutate the sent record',(()=>{const s=Object.freeze({...sent});jr.parseJudgeResponse(JSON.stringify(good),s);return true})());
check('parser with an unknown role marks every score not_applicable',jr.parseJudgeResponse(JSON.stringify(good),{role:'ghost',output:sent.output}).criteria.every(c=>c.invalid.includes('not_applicable')));
check('quoteKey strips spaces, punctuation and case',jr.quoteKey(' A-b.  C！ ')==='abc');

// 4b) 파서 계약(점수 없으면 uncertain:true, uncertain이면 점수 없음)과 인용 보관: 대조를 통과한 인용만, 300자까지 돌려준다.
const noScore=one({id:'evidence_linkage',score:null,uncertain:false,quotes:[],reason:'없음'});
check('score null without uncertain is invalid (score_missing)',!noScore.valid&&noScore.invalid.includes('score_missing')&&noScore.score===null);
check('a missing score field without uncertain is invalid (score_missing)',one({id:'evidence_linkage',quotes:[Q1],reason:'x'}).invalid.includes('score_missing'));
const both=one(crit('evidence_linkage',4,[Q1],{uncertain:true}));
check('uncertain with a score is a contradiction (bad_shape, score dropped)',!both.valid&&both.invalid.includes('bad_shape')&&both.score===null);
check('fabricated quotes are not returned on an invalid answer',fake.quotes.length===0&&mixed.quotes.join('|')===Q1);
check('fabricated quotes are not returned on an uncertain answer',one({id:'evidence_linkage',score:null,uncertain:true,quotes:['연락처 010-5555-6666 원문',Q1],reason:'판단 불가'}).quotes.join('|')===Q1);
const huge=one(crit('evidence_linkage',4,['없는 인용 '.repeat(20000)]));
check('a very long fabricated quote is dropped',huge.quotes.length===0&&!huge.valid);
const padded=one(crit('evidence_linkage',4,[Q1+' '.repeat(5000)]));
check('returned quotes are capped at QUOTE_MAX_CHARS',padded.valid&&padded.quotes[0].length<=jr.QUOTE_MAX_CHARS&&jr.QUOTE_MAX_CHARS===300);
check('invalid reasons are exported for the stats (with score_missing)',Array.isArray(jr.JUDGE_INVALID)&&jr.JUDGE_INVALID.includes('score_missing')&&Object.isFrozen(jr.JUDGE_INVALID));

// 4c) 수치 인용: 소수점·숫자 사이 구분을 지우지 않고, 숫자 중간에서 시작하거나 끝나는 인용은 일치로 보지 않는다. 천 단위 쉼표는 무시한다.
const numSent={role:'creative',output:'재방문율은 15배 늘었습니다. 할인율은 50%입니다. 객단가 5,000원을 유지합니다. 문의: [전화번호]'};
const nq=quote=>one(crit('evidence_linkage',4,[quote]),numSent);
check('a decimal point is not dropped: 1.5배 does not match 15배',nq('재방문율은 1.5배 늘었습니다').invalid.includes('quote_not_found'));
check('a quote cut inside a number does not match: 할인율은 5 vs 50%',nq('할인율은 5').invalid.includes('quote_not_found'));
check('a quote starting inside a number does not match: 5배 vs 15배',nq('5배 늘었습니다').invalid.includes('quote_not_found'));
check('thousands separators are ignored: 5000원 matches 5,000원',nq('객단가 5000원을 유지합니다').valid&&nq('객단가 5,000원을 유지합니다').valid);
check('whole numbers still match with surrounding punctuation',nq('할인율은 50%입니다').valid&&nq('재방문율은 15배').valid);
const gapSent={role:'creative',output:'할인율은 50%. 10,000,000원 예산입니다. 점심 11:00~14:00 운영.'};
check('numbers split by a sentence end or a range stay separate numbers',one(crit('evidence_linkage',4,['10000000원 예산입니다']),gapSent).valid&&one(crit('evidence_linkage',4,['14:00 운영']),gapSent).valid&&one(crit('evidence_linkage',4,['4:00 운영']),gapSent).invalid.includes('quote_not_found'));
check('quoteKey keeps a separator between digits',jr.quoteKey('1.5배')!==jr.quoteKey('15배')&&jr.quoteKey('5,000원')===jr.quoteKey('5000원'));
check('a quote of only a mask token is too short',nq('[전화번호]').invalid.includes('quote_too_short')&&one(crit('evidence_linkage',4,['[전화번호]'])).invalid.includes('quote_too_short'));
check('prose with braces before the JSON still parses',jr.parseJudgeResponse('기준 {id}마다 답합니다: '+JSON.stringify(good)+' 끝',sent).ok);

check('no network call was made',fetchCalls===0);
console.log(JSON.stringify({passed}));
