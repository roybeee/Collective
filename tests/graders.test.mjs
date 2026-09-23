// 실패 유형 사전 v1 결정론 채점기(lib/graders)와 로컬 재채점 CLI(scripts/eval/grade.mjs). 모든 입력은 합성 데이터다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
async function load(path){const m=moduleFor(path);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const {GRADERS,CONTENT_GRADERS,runGraders,summarize,INPUT_TOKEN_CAP}=await load('lib/graders/index.ts');
const {scrubInternalIds,roleOutputContract,substanceProblem}=await load('lib/role-output.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const statuses=(item,ctx={})=>Object.fromEntries(runGraders(item,ctx).map(r=>[r.id,r.status]));
const status=(id,item,ctx={})=>statuses(item,ctx)[id];
const role=(text,extra={})=>({id:'t',kind:'role',role:'cmo',text,...extra});
const talk=(fields,extra={})=>({id:'d',kind:'discussion',role:'insight',fields:{respondsTo:[],...fields},...extra});

const long='퇴근길 직장인이 20분 안에 저녁을 포장하려는 상황을 우선 가정합니다. 현재 대안은 편의점 도시락과 배달이며 가장 큰 장벽은 매장 앞 대기 시간입니다. [가설] 픽업 선반을 두면 대기 불만이 줄어든다. 반증 조건은 설치 뒤에도 대기 문의가 줄지 않는 경우입니다. [자료 필요] 시간대별 주문량, 담당 점장, 오픈 1주 전 확인.';
const reask='요청하신 과업이 지정되지 않았습니다. 다음 중 원하시는 작업을 선택해 주세요.\n1. 초안 검수\n2. 채널 확장\n3. 요약';
const insightTitles=roleOutputContract('insight').sections.map(s=>s.title);
const rendered=(bodies,head='')=>insightTitles.map((t,i)=>`## ${t}\n\n${i===0?head:''}${bodies[i]}`).join('\n\n');
const contract=(bodies,head)=>({id:'c',kind:'role',role:'insight',contract:true,text:rendered(bodies,head)});
const goodTalk={position:'첫 방문 고객에게는 위치 확인이 가장 큰 장벽일 수 있다는 가설을 우선 검증합니다. 픽업 대기 시간 안내를 함께 둡니다.',evidence:'근거는 브리프 v1 목표와 총괄 파트너 v1 §3입니다. 대기 시간은 [자료 필요]로 두고 점장이 오픈 전 주에 확인합니다.',challenge:'앞선 발언의 인지도 우선 주장은 위치 정보가 정비된 뒤에 검토해야 합니다.',proposal:'길찾기 안내 카드 2안을 만들고 2주간 길찾기 클릭 대비 포장 주문으로 판정합니다.'};

check('registry has the thirteen v1 failure types',()=>assert.deepEqual([...GRADERS.map(g=>g.id)],['question_only','thin_section','contract_json','heading_nesting','internal_id_exposure','brief_prohibition_conflict','fact_conflict','unconfirmed_value_assertion','unsupported_claim_term','industry_metric_leak','revisit_cohort_definition','local_channel_coverage','input_budget']));
check('results use only the four statuses',()=>assert.ok(runGraders(role(long)).every(r=>['pass','fail','not_applicable','grader_error'].includes(r.status))));
check('grader modules import only relative pure modules',()=>{for(const f of readdirSync('lib/graders').filter(f=>f.endsWith('.ts'))){const specs=[...readFileSync('lib/graders/'+f,'utf8').matchAll(/from\s+'([^']+)'/g)].map(x=>x[1]);assert.ok(specs.every(s=>/^\.\.?\//.test(s)&&!/(server|hermes|archive-server|learning-server|usage-ledger)$/.test(s)),f)}});

// 1 question_only
check('question_only passes a conditional draft',()=>assert.equal(status('question_only',role(long)),'pass'));
check('question_only fails a choice list',()=>assert.equal(status('question_only',role(reask)),'fail'));
check('question_only fails a deferral that waits for input',()=>assert.equal(status('question_only',role('어떤 방향으로 작성할지 알려 주시면 바로 작성하겠습니다. '+'브리프와 목표를 확인했습니다. '.repeat(12))),'fail'));
check('question_only fails a re-asking discussion field',()=>assert.equal(status('question_only',talk({...goodTalk,position:reask,evidence:'없음',challenge:'없음',proposal:'없음'})),'fail'));
check('question_only is not applicable to inputs and quality verdicts',()=>{assert.equal(status('question_only',{id:'g',kind:'input',text:reask}),'not_applicable');assert.equal(status('question_only',role('{"verdict":"revise"}',{role:'quality'})),'not_applicable')});
const bigDoc=['1. 결론',long,'2. 우선순위',long,'3. 근거 구분',long].join('\n\n').repeat(5);
check('a long single-section plan passes question_only and thin_section',()=>{assert.ok(bigDoc.length>2500);const s=statuses(role(bigDoc));assert.equal(s.question_only,'pass');assert.equal(s.thin_section,'pass')});
// 평범한 '…요청…없습니다' 문장 하나는 재질문이 아니고, 내용 채점기를 가리지 않는다(isQuestionOnly 본문 전체 단독 적용 금지).
const plainPlan=['## 상황',long,'## 메뉴 근거','고객 요청이 많은 메뉴 데이터는 아직 없습니다. '+long,'## 게시 카피','숯불 향을 살린 떡볶이, 오늘 오픈합니다.','## 측정',long].join('\n');
check('a plain no-data sentence is not a re-ask and does not hide content failures',()=>{const s=statuses(role(plainPlan),{prohibitedTerms:['숯불']});assert.equal(s.question_only,'pass');assert.equal(s.brief_prohibition_conflict,'fail')});
check('a discussion noting missing requested data is not a re-ask',()=>assert.equal(status('question_only',talk({...goodTalk,evidence:goodTalk.evidence+' 요청하신 경쟁점 가격 자료는 아직 없습니다.'})),'pass'));

// 2 thin_section
check('thin_section passes three substantive contract sections',()=>assert.equal(status('thin_section',contract([long,long,long])),'pass'));
check('thin_section fails a contract section holding only data requests',()=>assert.equal(status('thin_section',contract([long,'- 자료 필요: 근거 없음\n- 자료 필요: 경쟁점 가격',long])),'fail'));
check('thin_section fails a short legacy body',()=>assert.equal(status('thin_section',role('## 요약\n오픈 준비 중입니다.')),'fail'));
check('thin_section fails when most sections are data requests only',()=>assert.equal(status('thin_section',role(['## A\n- 자료 필요: 가격','## B\n- 자료 필요: 메뉴','## C\n'+long+long].join('\n'))),'fail'));
const inline=['## 상황\n퇴근길 직장인이 20분 안에 저녁을 포장하려는 상황을 우선 가정하고, 현재 대안인 편의점 도시락과 배달 대비 매장 앞 대기 시간을 가장 큰 장벽으로 봅니다 [자료 필요: 시간대별 주문량]','## 가설\n픽업 선반을 두면 대기 불만이 줄어든다는 가설을 세우고, 선반 설치 뒤에도 대기 문의가 줄지 않으면 이 가설을 기각하는 반증 조건으로 삼습니다 [자료 필요: 문의 기록]','## 계획\n점장이 오픈 1주 전부터 시간대별 주문량과 평균 대기 시간을 기록하고, 그 결과로 선반 설치 여부와 안내 문구 위치를 결정합니다 [자료 필요: 담당 확정]'].join('\n');
check('thin_section does not repeat the inline data-request false positive',()=>{assert.equal(substanceProblem(inline),'placeholder');assert.equal(status('thin_section',role(inline)),'pass')});

// 3 contract_json
const c=roleOutputContract('insight');
const raw=sections=>JSON.stringify({contractVersion:c.version,role:'insight',sections});
check('contract_json passes a complete raw contract',()=>assert.equal(status('contract_json',{id:'r',kind:'role',role:'insight',contract:true,raw:raw(c.sections.map(s=>({id:s.id,content:long})))}),'pass'));
check('contract_json fails a raw contract missing sections',()=>assert.equal(status('contract_json',{id:'r',kind:'role',role:'insight',contract:true,raw:raw([{id:'output_1',content:long}])}),'fail'));
check('contract_json checks rendered titles when raw JSON is absent',()=>{assert.equal(status('contract_json',contract([long,long,long])),'pass');assert.equal(status('contract_json',{...contract([long,long,long]),text:rendered([long,long,long]).replace('## '+insightTitles[1],'## 다른 제목')}),'fail')});
check('contract_json is not applicable to legacy runs',()=>assert.equal(status('contract_json',role(long)),'not_applicable'));
check('contract_json allows an empty reference for the first speaker',()=>assert.equal(status('contract_json',talk(goodTalk,{role:'cmo'})),'pass'));
check('contract_json fails a later speaker without references',()=>assert.equal(status('contract_json',talk(goodTalk,{priorRoles:['cmo']})),'fail'));
check('contract_json accepts a canonical meeting reference',()=>assert.equal(status('contract_json',talk({...goodTalk,respondsTo:['m-1:discussion:cmo']},{priorRoles:['cmo'],meetingId:'m-1'})),'pass'));
check('contract_json fails a missing discussion field',()=>assert.equal(status('contract_json',talk({position:goodTalk.position,evidence:goodTalk.evidence,challenge:goodTalk.challenge})),'fail'));

// 4 heading_nesting
check('heading_nesting allows ### inside a contract section',()=>assert.equal(status('heading_nesting',contract([long,long,long],'### 판단 범위\n')),'pass'));
check('heading_nesting fails a ## heading inside a contract section',()=>assert.equal(status('heading_nesting',contract([long,long,long],'## 판단 범위\n')),'fail'));
check('heading_nesting fails ## in a legacy role body',()=>assert.equal(status('heading_nesting',role('## 결론\n'+long)),'fail'));
check('heading_nesting is not applicable to briefs and discussions',()=>{assert.equal(status('heading_nesting',{id:'b',kind:'brief',text:'## 목표\n'+long}),'not_applicable');assert.equal(status('heading_nesting',talk(goodTalk)),'not_applicable')});

// 5 internal_id_exposure
check('internal_id_exposure ignores identifiers inside URLs',()=>assert.equal(status('internal_id_exposure',role('근거: 총괄 파트너 v1 §3과 브리프 v2 목표. 참고 https://example.com/a/0123456789abcdef0123456789abcdef')),'pass'));
check('internal_id_exposure fails an artifact id and schema path',()=>assert.equal(status('internal_id_exposure',role('근거: 이전 작업물 ai-0123456789abcdef0123456789abcdef 와 campaign.plan.kpi 필드')),'fail'));
const pathOnly={...goodTalk,evidence:'[확인 사실] campaign.address와 campaign.stores 필드에 주소가 있습니다. 오픈일은 [자료 필요]입니다.'};
check('schema paths alone are exposure even when scrubInternalIds finds nothing',()=>{assert.equal(scrubInternalIds(pathOnly.evidence),pathOnly.evidence);assert.equal(status('internal_id_exposure',talk(pathOnly)),'fail')});
check('internal_id_exposure fails debug key=value output',()=>assert.equal(status('internal_id_exposure',role('자료 상태: confirmedSources=[] 이고 learning=[] 입니다. '+long)),'fail'));
check('internal_id_exposure skips respondsTo code fields',()=>assert.equal(status('internal_id_exposure',talk({...goodTalk,respondsTo:['0f6c2551-0a1b-4c2d-8e3f-123456789abc:discussion:cmo']},{priorRoles:['cmo']})),'pass'));

// 6 brief_prohibition_conflict
const terms={prohibitedTerms:['숯불']};
check('prohibition passes a negated mention inside a hypothesis block',()=>assert.equal(status('brief_prohibition_conflict',{id:'b',kind:'brief',text:'## 검증할 가설\n가설 1: 조리 과정 영상(설비 확인 후 촬영)이 메뉴 조회를 늘릴 수 있다. 숯불 표현은 설비 확인 전 사용하지 않는다.'},terms),'pass'));
check('prohibition fails a hypothesis premise even with [확인 필요]',()=>assert.equal(status('brief_prohibition_conflict',{id:'b',kind:'brief',text:'## 검증할 가설\n가설 1: 숯불 향을 강조한 영상이 메뉴 조회를 늘릴 수 있다. [확인 필요]'},terms),'fail'));
check('prohibition catches a numbered hypothesis under a plain label',()=>assert.equal(status('brief_prohibition_conflict',role('고객 가설 3\n\n숯불 조리 장면이 주문으로 이어질 수 있습니다.\n\n주의: 숯불 표현은 확인 전 쓰지 않습니다.'),terms),'fail'));
check('prohibition skips blocks labelled as excluded wording',()=>assert.equal(status('brief_prohibition_conflict',role('확정 전 사용하지 않을 카피 표현\n숯불 향\n\n'+long),terms),'pass'));
check('prohibition uses rejected ledger values',()=>assert.equal(status('brief_prohibition_conflict',role('게시 카피\n“숯불로 굽는 떡꼬치”'),{facts:{confirmed:[],prohibited:[{key:'조리 방식',value:'숯불'}]}}),'fail'));
check('prohibition checks discussion position and proposal',()=>{assert.equal(status('brief_prohibition_conflict',talk({...goodTalk,proposal:'숯불 장면을 첫 컷에 둡니다.'}),terms),'fail');assert.equal(status('brief_prohibition_conflict',talk({...goodTalk,proposal:'숯불 장면은 설비 확인 전 쓰지 않습니다.'}),terms),'pass')});
check('prohibition is not applicable without prohibited terms',()=>assert.equal(status('brief_prohibition_conflict',role(long)),'not_applicable'));
// 부정·배제는 금지 표현 바로 뒤 서술부만 본다. 문장 안 다른 곳의 '놓치지 말고'·'아닌'·'어디에도 없습니다'는 면제 사유가 아니다.
const copy=line=>({id:'k',kind:'role',role:'content',text:'## 게시 카피\n'+line});
check('prohibition catches the term despite unrelated negation wording',()=>{for(const s of ['숯불 향 가득한 떡볶이, 놓치지 말고 오세요.','평범한 분식이 아닌 숯불 떡볶이.','이런 숯불 맛은 어디에도 없습니다.','한 번 맛보면 잊지 않을 숯불 떡볶이.'])assert.equal(status('brief_prohibition_conflict',copy(s),terms),'fail',s)});
check('prohibition accepts avoidance wording right after the term',()=>{for(const s of ['숯불이라는 단어는 빼고 씁니다.','숯불 대신 철판 조리를 강조합니다.','숯불 표현은 피합니다.','금지 표현: 숯불, 화덕','숯불·인기 메뉴 경쟁이 아니라 위치 안내로 시작합니다.'])assert.equal(status('brief_prohibition_conflict',copy(s),terms),'pass',s)});
// 카피 라벨은 제목·강조·인라인·목록·끝 콜론 형식을 모두 인식한다.
const labelForms=['### 게시 카피\n숯불 향 가득, 동네 인기 떡볶이.','**게시 카피**\n숯불 향 가득, 동네 인기 떡볶이.','**카피 A:** 숯불 향 가득, 동네 인기 떡볶이.','- 게시 카피: 숯불 향 가득, 동네 인기 떡볶이.','게시 카피:\n숯불 향 가득, 동네 인기 떡볶이.'];
check('copy labels are found in heading, bold, inline, list and colon forms',()=>{for(const text of labelForms){const s=statuses({id:'k',kind:'role',role:'content',text},terms);assert.equal(s.brief_prohibition_conflict,'fail',text);assert.equal(s.unsupported_claim_term,'fail',text)}});

// 7 fact_conflict: 원장에 있는 항목만 대조한다. 원장에 없는 항목은 세지 않고 합격률 분모에서 뺀다.
const ledger={facts:{confirmed:[{key:'주소',value:'가상동 12 B동 201호'}],prohibited:[]}};
const priced={facts:{confirmed:[{key:'가격',value:'떡볶이 5,000원'},{key:'오픈일',value:'10월 5일'}],prohibited:[]}};
check('fact_conflict passes matching address with pending open date',()=>assert.equal(status('fact_conflict',role('가상동 12 B동 201호에 오픈 예정입니다. 오픈일은 [확인 필요] 확정 후 안내합니다.'),ledger),'pass'));
check('fact_conflict fails a different address',()=>assert.equal(status('fact_conflict',role('가상동 12 B동 102호에서 10월 5일 오픈합니다.'),ledger),'fail'));
check('fact_conflict fails a price or open date that differs from the ledger',()=>{assert.equal(status('fact_conflict',role('떡볶이는 7,000원입니다.'),priced),'fail');assert.equal(status('fact_conflict',role('10월 9일 오픈합니다.'),priced),'fail')});
check('fact_conflict passes a price and open date that match the ledger',()=>assert.equal(status('fact_conflict',role('떡볶이는 5,000원이고 10월 5일 오픈합니다.'),priced),'pass'));
check('fact_conflict leaves items missing from the ledger out of the denominator',()=>assert.equal(status('fact_conflict',role('떡볶이는 7,000원입니다.'),ledger),'not_applicable'));
const rejectedLedger={facts:{confirmed:[],prohibited:[{key:'조리 방식',value:'숯불'}]}};
check('fact_conflict scopes negation of rejected values to the term',()=>{assert.equal(status('fact_conflict',role('숯불 대신 철판 조리를 강조합니다.'),rejectedLedger),'pass');assert.equal(status('fact_conflict',role('숯불 향 가득, 놓치지 말고 오세요.'),rejectedLedger),'fail')});
check('fact_conflict is not applicable without a ledger',()=>assert.equal(status('fact_conflict',role('가상동 12 B동 102호')),'not_applicable'));
check('fact_conflict is not applicable when no ledger key is touched',()=>assert.equal(status('fact_conflict',role(long),ledger),'not_applicable'));

// 7b unconfirmed_value_assertion: 원장에 확정값이 없는 구체 값을 표시 없이 단정하면 fail.
check('unconfirmed value fails an asserted price or open date missing from the ledger',()=>{assert.equal(status('unconfirmed_value_assertion',role('대표 메뉴는 12,900원입니다.'),ledger),'fail');assert.equal(status('unconfirmed_value_assertion',role('10월 5일 오픈합니다.'),ledger),'fail')});
check('unconfirmed value passes a marked example price',()=>assert.equal(status('unconfirmed_value_assertion',role('[예시] 대표 메뉴 12,900원처럼 가격을 적는 양식입니다.'),ledger),'pass'));
check('unconfirmed value leaves ledger-confirmed kinds to fact_conflict',()=>assert.equal(status('unconfirmed_value_assertion',role('떡볶이는 7,000원입니다.'),priced),'not_applicable'));
check('unconfirmed value is not applicable without a ledger',()=>assert.equal(status('unconfirmed_value_assertion',role('대표 메뉴는 12,900원입니다.')),'not_applicable'));
// 예산·비용·객단가·매출 목표 금액은 판매가가 아니다.
const budgets=['인스타그램 광고 예산은 월 30만 원으로 시작합니다.','1회 촬영 비용 150,000원 한도 안에서 진행합니다.','객단가 12,000원 이상 주문 비중을 측정합니다.','목표: 첫 주 매출 300만 원.'];
check('budgets, costs and sales targets are not treated as menu prices',()=>{for(const b of budgets){assert.equal(status('unconfirmed_value_assertion',role(b),ledger),'not_applicable',b);assert.equal(status('fact_conflict',role(b),priced),'not_applicable',b)}});

// 8 unsupported_claim_term
check('claim term passes neutral copy',()=>assert.equal(status('unsupported_claim_term',role('게시 카피\n“새로 여는 분식집, 메뉴는 확정 후 안내합니다.”')),'pass'));
check('claim term fails unsupported popularity and opening benefit',()=>assert.equal(status('unsupported_claim_term',role('게시 카피\n“동네 인기 1위 떡볶이, 오픈 혜택 20%”')),'fail'));
check('claim term ignores procedural mentions outside copy',()=>assert.equal(status('unsupported_claim_term',role('오픈 전에는 할인보다 위치 정보를 먼저 정비합니다. 할인 제공 여부는 별도 승인 없이 바꾸지 않습니다. '+long)),'pass'));
check('claim term accepts [확인 필요] and negation in copy',()=>assert.equal(status('unsupported_claim_term',role('게시 카피\n“오픈 혜택 [확인 필요] 안내”\n인기 표현은 쓰지 않습니다.')),'pass'));
check('claim term scopes negation to the claim term',()=>{assert.equal(status('unsupported_claim_term',copy('그냥 떡볶이가 아닌 동네 인기 떡볶이.')),'fail');assert.equal(status('unsupported_claim_term',copy('오픈 혜택 놓치지 말고 오세요.')),'fail');assert.equal(status('unsupported_claim_term',copy('할인 없이도 만족스러운 한 끼.')),'pass')});
check('claim term accepts a confirmed ledger basis',()=>assert.equal(status('unsupported_claim_term',role('게시 카피\n“오픈 혜택 안내”'),{facts:{confirmed:[{key:'오픈 혜택',value:'첫 주 음료 제공'}],prohibited:[]}}),'pass'));

// 9 industry_metric_leak
check('industry leak passes own-industry metrics',()=>assert.equal(status('industry_metric_leak',role('꽃다발 픽업 완료 건수를 일별로 기록한다.'),{industry:'florist'}),'pass'));
check('industry leak fails a locker metric in a florist campaign',()=>assert.equal(status('industry_metric_leak',role('보관함 가동률을 주간 지표로 둔다.'),{industry:'florist'}),'fail'));
check('industry leak passes an explicit exclusion',()=>assert.equal(status('industry_metric_leak',role('보관함 지표는 이번 캠페인과 무관하므로 제외합니다.'),{industry:'fnb'}),'pass'));
check('industry leak allows the campaign own industry terms',()=>assert.equal(status('industry_metric_leak',role('보관함 가동률을 주간 지표로 둔다.'),{industry:'locker'}),'pass'));
check('industry leak is not applicable without an industry',()=>assert.equal(status('industry_metric_leak',role('보관함 가동률')),'not_applicable'));

// 10 revisit_cohort_definition
check('revisit definition passes a matured cohort',()=>assert.equal(status('revisit_cohort_definition',role('재방문율 = 첫 결제 뒤 30일 관찰을 마친 손님 가운데 30일 안에 다시 결제한 손님 수 ÷ 관찰을 마친 손님 수')),'pass'));
check('revisit definition fails an immature denominator',()=>assert.equal(status('revisit_cohort_definition',role('재방문율 = 두 번째 구매 고객 수 ÷ 첫 구매 고객 수')),'fail'));
check('revisit definition fails a label line followed by a formula',()=>assert.equal(status('revisit_cohort_definition',role('재방문율\n= 30일 내 두 번째 주문 고객 수 ÷ 첫 구매 고객 수 × 100')),'fail'));
check('revisit definition is not applicable without a definition',()=>assert.equal(status('revisit_cohort_definition',role(long)),'not_applicable'));

// 11 local_channel_coverage
const store={localStore:true};
check('channel coverage passes four decided local channels',()=>assert.equal(status('local_channel_coverage',role('채널 후보\n- 네이버 플레이스: 선택. 기준 정보 채널\n- 당근 비즈프로필: 선택. 동네 노출\n- 배달앱: 보류. 수수료 확인 전\n- 카카오톡 채널: 제외. 수신동의 고객 없음'),store),'pass'));
check('channel coverage fails a plan missing local channels',()=>assert.equal(status('local_channel_coverage',role('채널 후보\n- 네이버 플레이스: 선택\n- Instagram: 선택'),store),'fail'));
check('channel coverage ignores data requests and formulas',()=>assert.equal(status('local_channel_coverage',role('채널 후보\n- 네이버 플레이스: 선택\n- 당근: 보류\n- 카카오: 제외\n자료 필요: 배달 플랫폼 수수료\n= 판매가 - 배달 플랫폼 수수료'),store),'fail'));
check('channel coverage is not applicable outside store campaigns and to other roles',()=>{assert.equal(status('local_channel_coverage',role('채널 후보')),'not_applicable');assert.equal(status('local_channel_coverage',role('채널 후보',{role:'insight'}),store),'not_applicable')});

// 12 input_budget
check('input budget cap defaults to 32,000',()=>assert.equal(INPUT_TOKEN_CAP,32000));
check('input budget passes and fails around the cap',()=>{assert.equal(status('input_budget',{id:'u',kind:'call',role:'cmo',inputTokens:24000}),'pass');assert.equal(status('input_budget',{id:'u',kind:'call',role:'cmo',inputTokens:35500}),'fail')});
check('input budget is not applicable without tokens or for brief drafts',()=>{assert.equal(status('input_budget',{id:'u',kind:'call',role:'cmo',inputTokens:null}),'not_applicable');assert.equal(status('input_budget',{id:'u',kind:'call',role:'brief',inputTokens:40000}),'not_applicable')});
check('input budget cap is configurable',()=>assert.equal(status('input_budget',{id:'u',kind:'call',role:'cmo',inputTokens:33000},{inputTokenCap:36000}),'pass'));

// 우선순위: 재질문이면 내용 채점기는 not_applicable, 구조 채점기는 계속 채점한다.
check('question_only failure suppresses content graders only',()=>{const s=statuses(role(reask+'\n근거: ai-0123456789abcdef0123456789abcdef'),{prohibitedTerms:['초안'],industry:'fnb',localStore:true,facts:ledger.facts});for(const id of CONTENT_GRADERS)assert.equal(s[id],'not_applicable',id);assert.equal(s.internal_id_exposure,'fail');assert.equal(s.question_only,'fail')});
// 격리: 채점기 하나의 예외는 grader_error로 남고 나머지는 그대로다.
check('a throwing grader is isolated as grader_error',()=>{const item=role(long),base=runGraders(item),boom=runGraders(item,{},[...GRADERS,{id:'boom',grade(){throw new Error('boom')}}]);assert.equal(boom.at(-1).status,'grader_error');assert.deepEqual([...boom.slice(0,-1).map(r=>r.status)],[...base.map(r=>r.status)])});
check('bad context data becomes grader_error without hiding other results',()=>{const s=statuses(role('## 검증할 가설\n가설 1: 조리 과정 영상이 조회를 늘린다.'),{prohibitedTerms:[null]});assert.equal(s.brief_prohibition_conflict,'grader_error');assert.equal(s.question_only,'pass')});
// 합성 정상 산출물: 오탐 0건.
const cleanPlan=['1. 결론','가상분식 오픈의 1차 병목은 위치 정보 부족일 수 있다는 가설로 시작합니다. 오픈일과 가격은 [확인 필요]이며 확정 후 안내합니다. 주소는 가상동 12 B동 201호입니다.',long,'2. 채널 후보','- 네이버 플레이스: 선택. 주소·영업정보 기준 채널','- 당근 비즈프로필: 선택. 동네 노출','- 배달앱: 보류. 수수료 확인 전','- 카카오톡 채널: 제외. 수신 동의 고객 없음','3. 게시 카피','“가상동에 새로 여는 분식집, 위치를 먼저 확인하세요.”','4. 측정','재방문율 = 한 달 관찰 코호트에서 두 번 이상 결제한 손님 수 ÷ 같은 코호트의 손님 수',long].join('\n\n');
const cleanCtx={prohibitedTerms:['숯불'],facts:ledger.facts,industry:'fnb',localStore:true};
check('clean synthetic plan has zero failures',()=>{const r=runGraders({...role(cleanPlan),inputTokens:21000},cleanCtx);assert.deepEqual([...r.filter(x=>x.status==='fail'||x.status==='grader_error')],[])});
check('clean synthetic contract output has zero failures',()=>assert.deepEqual([...runGraders(contract([long,long,long]),cleanCtx).filter(x=>x.status!=='pass'&&x.status!=='not_applicable')],[]));
check('clean synthetic discussion has zero failures',()=>assert.deepEqual([...runGraders(talk(goodTalk,{role:'cmo'}),cleanCtx).filter(x=>x.status==='fail'||x.status==='grader_error')],[]));
// 모델 출력 한도(40,000자) 입력에서 선형에 가까운 시간 안에 끝난다(긴 한글 연속·반복 제목).
check('graders finish quickly on 40,000-character adversarial inputs',()=>{for(const text of ['가'.repeat(40000),'가상동'.repeat(13000),('## x\n'+'자료 필요\n').repeat(4000),'campaign.'+'a.'.repeat(20000)]){const t=Date.now();runGraders({id:'p',kind:'role',role:'insight',contract:true,text},cleanCtx);runGraders(role(text),cleanCtx);assert.ok(Date.now()-t<1000,text.slice(0,6))}});
check('summary counts statuses and excludes not_applicable from pass rate',()=>{const s=summarize([runGraders(role(long)),runGraders(role(reask))]);assert.equal(s.question_only.pass,1);assert.equal(s.question_only.fail,1);assert.equal(s.question_only.passRate,0.5);assert.equal(s.fact_conflict.not_applicable,2);assert.equal(s.fact_conflict.passRate,null)});

// grade.mjs: 추적 가능한 경로 거부, 무시 경로 채점, 네트워크 0회, 새 파일 0건.
const grade=args=>spawnSync(process.execPath,['scripts/eval/grade.mjs',...args],{encoding:'utf8'});
const porcelain=()=>spawnSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'}).stdout;
check('grade refuses a git-trackable input path',()=>{const r=grade(['tests/fixtures/brief.json']);assert.notEqual(r.status,0);assert.match(r.stderr,/추적/)});
const madeOutputs=!existsSync('outputs'),dir=join('outputs','.grade-selftest-'+process.pid);
const before=porcelain();
try{
 mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,'campaign.md'),['# 가상분식 오픈','','목표: 가상동 12 B동 201호 오픈. 숯불 표현은 쓰지 않는다.','예산: 미확정','','## 검증할 가설','가설 1: 숯불 향을 강조한 영상이 조회를 늘린다.','','## 총괄 파트너 · 가상분식 오픈',bigDoc,'','## 고객 인사이트 · 가상분식 오픈',reask].join('\n'));
 writeFileSync(join(dir,'meeting.md'),['# 팀 회의','','가상 안건: 숯불 표현은 넣지 않습니다.','','## 총괄 파트너 · 의견 교환','',JSON.stringify({...goodTalk,evidence:'근거 ai-0123456789abcdef0123456789abcdef',respondsTo:[]},null,2),'','## 고객 인사이트 · 의견 교환','',JSON.stringify({...goodTalk,evidence:'campaign.stores 필드 기준',respondsTo:['m-9:discussion:cmo']},null,2)].join('\n'));
 writeFileSync(join(dir,'usage.csv'),'run,input_tokens\nbrief,9000\ncmo,31000\ninsight,33000\n');
 writeFileSync(join(dir,'case.json'),JSON.stringify({version:'eval-case-v1',context:{prohibitedTerms:['숯불'],industry:'fnb',localStore:true},sources:[{type:'campaign_export',file:'campaign.md'},{type:'meeting_export',file:'meeting.md'},{type:'usage_csv',file:'usage.csv'}],notRun:[{id:'meeting_content',reason:'원문 없음(합성)'}]}));
 const r=grade([join(dir,'case.json'),'--json']);
 check('grade scores an ignored local case offline',()=>assert.equal(r.status,0,r.stderr));
 const out=JSON.parse(r.stdout);
 check('grade reports zero network calls',()=>assert.equal(out.networkCalls,0));
 check('grade splits app exports into items',()=>assert.deepEqual([...out.items.map(i=>i.id)],['brief_goal','brief_plan','role_cmo','role_insight','meeting_agenda','discussion_cmo','discussion_insight','call_brief','call_cmo','call_insight']));
 check('grade aggregates per failure type',()=>{assert.equal(out.summary.question_only.fail,1);assert.equal(out.summary.internal_id_exposure.fail,2);assert.equal(out.summary.brief_prohibition_conflict.fail,1);assert.equal(out.summary.input_budget.fail,1);assert.equal(out.summary.input_budget.not_applicable>0,true)});
 check('grade passes through not_run cases',()=>assert.equal(out.notRun[0].id,'meeting_content'));
 check('grade text output shows counts without excerpts',()=>{const t=grade([join(dir,'case.json')]);assert.equal(t.status,0);assert.match(t.stdout,/question_only/);assert.ok(!t.stdout.includes('숯불 향'))});
 check('grade refuses a case that points at a tracked source',()=>{writeFileSync(join(dir,'bad.json'),JSON.stringify({version:'eval-case-v1',sources:[{type:'role_markdown',file:resolve('README.md'),role:'cmo'}]}));const b=grade([join(dir,'bad.json')]);assert.notEqual(b.status,0);assert.match(b.stderr,/추적/)});
}finally{rmSync(dir,{recursive:true,force:true});if(madeOutputs)rmSync('outputs',{recursive:true,force:true})}
check('grade leaves no new files in git status',()=>assert.equal(porcelain(),before));
console.log(JSON.stringify({passed:passed.length}));
