// 채점기 확장 G3(lib/graders): 회의 단계·브리프 채점기 6종, 업종 사전(배열 업종·공용 용어 제외)과 채점 버전. 모든 입력은 합성 데이터다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
async function load(path){const m=moduleFor(path);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const {GRADERS,KIND_GRADERS,ALL_GRADERS,GRADERS_VERSION,runGraders}=await load('lib/graders/index.ts');
const industry=await load('lib/graders/industry.ts'),content=await load('lib/graders/content.ts');
const {roleOutputContract}=await load('lib/role-output.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const results=(item,ctx={})=>runGraders(item,ctx,ALL_GRADERS);
const status=(id,item,ctx={})=>results(item,ctx).find(r=>r.id===id)?.status;
const detail=(id,item,ctx={})=>results(item,ctx).find(r=>r.id===id)?.detail||'';
const omit=(obj,key)=>Object.fromEntries(Object.entries(obj).filter(([k])=>k!==key));
const NEW=['meeting_step_contract','revision_repeat','seeded_defect_detection','brief_contract','brief_instruction_violation','brand_intro_as_fact'];
const V1=['question_only','thin_section','contract_json','heading_nesting','internal_id_exposure','brief_prohibition_conflict','fact_conflict','unconfirmed_value_assertion','unsupported_claim_term','industry_metric_leak','revisit_cohort_definition','local_channel_coverage','input_budget'];

const long='퇴근길 직장인이 20분 안에 저녁을 포장하려는 상황을 우선 가정합니다. 현재 대안은 편의점 도시락과 배달이며 가장 큰 장벽은 매장 앞 대기 시간입니다. [가설] 픽업 선반을 두면 대기 불만이 줄어든다. 반증 조건은 설치 뒤에도 대기 문의가 줄지 않는 경우입니다. [자료 필요] 시간대별 주문량, 담당 점장, 오픈 1주 전 확인.';
const role=(text,extra={})=>({id:'t',kind:'role',role:'cmo',text,...extra});
const talk=(fields,extra={})=>({id:'d',kind:'discussion',role:'insight',fields:{respondsTo:[],...fields},...extra});
const goodTalk={position:'첫 방문 고객에게는 위치 확인이 가장 큰 장벽일 수 있다는 가설을 우선 검증합니다. 픽업 대기 시간 안내를 함께 둡니다.',evidence:'근거는 브리프 v1 목표와 총괄 파트너 v1 §3입니다. 대기 시간은 [자료 필요]로 두고 점장이 오픈 전 주에 확인합니다.',challenge:'앞선 발언의 인지도 우선 주장은 위치 정보가 정비된 뒤에 검토해야 합니다.',proposal:'길찾기 안내 카드 2안을 만들고 2주간 길찾기 클릭 대비 포장 주문으로 판정합니다.'};
const insightTitles=roleOutputContract('insight').sections.map(s=>s.title);
const contractItem={id:'c',kind:'role',role:'insight',contract:true,text:insightTitles.map(t=>`## ${t}\n\n${long}`).join('\n\n')};
const facts={confirmed:[{key:'주소',value:'가상동 12 B동 201호'},{key:'떡볶이 가격',value:'4,000원'}],prohibited:[{key:'원재료',value:'숯불'}]};
const cleanCtx={prohibitedTerms:['숯불'],facts,industry:'fnb',localStore:true};

// 회의 단계 합성 출력
const step=(phase,out,extra={})=>({id:'m-'+phase,kind:'meeting_step',phase,role:phase==='synthesis'?'cmo':phase==='quality'?'quality':'creative',raw:typeof out==='string'?out:JSON.stringify(out),...extra});
const task=r=>({role:r,instruction:'선택안 제작 지시서를 완성한다.',reason:'D4 반론 반영',acceptance:'제작 지시서 §3에 장면별 소재와 통과 조건이 있다.'});
const synthesis=(over={})=>({decisions:'위치 안내를 1순위로 채택한다(D1·D4 근거).',disagreements:'할인 우선안은 근거 부족으로 보류한다.',questions:'오픈일 확인 필요',tasks:[task('creative'),task('content')],...over});
const CRITERIA=['evidence','brand','execution','economics','measurement'];
const qcheck=c=>({criterion:c,status:'pass',location:'크리에이티브 개선본 §2',finding:'근거 위치와 판단을 대조했다.',fix:'해당 없음'});
const tcheck=r=>({role:r,status:'pass',location:'개선본 §3',finding:'완료 조건을 대조했다.',fix:'해당 없음'});
const review=(over={})=>({verdict:'revise',summary:'근거 표시 보완 필요',findings:'크리에이티브 개선본 §1의 헤드라인 근거를 다시 확인해야 한다.',checks:CRITERIA.map(qcheck),taskChecks:['creative','content'].map(tcheck),...over});
const strictQuality=(out,extra={})=>step('quality',out,{contract:true,taskRoles:['creative','content'],...extra});

// ── 등록·버전 ──
check('the v1 registry keeps its thirteen graders and the G3 graders are a separate list',()=>{
 assert.deepEqual([...GRADERS.map(g=>g.id)],V1);
 assert.deepEqual([...KIND_GRADERS.map(g=>g.id)],NEW);
 assert.deepEqual([...ALL_GRADERS.map(g=>g.id)],[...V1,...NEW]);
});
check('the grading version moves past measure-v2 with the G3 graders, dictionaries, compound failure labels, absent-expression negation, critique clauses, meeting normalization, R3 measurement fixes, local-channel rerun fixes, contract reading and local channel decision lines',()=>assert.equal(GRADERS_VERSION,'failure-types-v1+normalized+measure-v2+g3+compound-labels+absent-expr+critique-clause+meeting-normalized+r3-measure+local-rerun+contract-read+channel-decision'));
// 기존 역할·발언 채점은 그대로다: 앞 13종 결과가 같고 새 6종은 적용 kind 밖이라 not_applicable.
check('G3 graders leave role and discussion results unchanged (not applicable outside their kinds)',()=>{
 const ctx={...cleanCtx,seededDefects:[{id:'d1',role:'cmo',marker:'업계 최초'}],briefInput:'목표: 오픈'};
 for(const item of [role(long),contractItem,talk(goodTalk,{role:'cmo'}),role('요청하신 과업이 지정되지 않았습니다. 다음 중 원하시는 작업을 선택해 주세요.\n1. 초안 검수\n2. 요약')]){
  const base=runGraders(item,ctx).map(r=>JSON.stringify(r)),ext=results(item,ctx);
  assert.deepEqual(ext.slice(0,13).map(r=>JSON.stringify(r)),base,item.id);
  assert.ok(ext.slice(13).every(r=>r.status==='not_applicable'),JSON.stringify(ext.slice(13)));
 }
});
check('input and call items get not_applicable from every G3 grader',()=>{for(const item of [{id:'g',kind:'input',text:long},{id:'u',kind:'call',inputTokens:9000}])assert.ok(results(item,{...cleanCtx,brandIntro:'가상분식은 2004년부터 국내산 쌀떡만 쓴다.'}).slice(13).every(r=>r.status==='not_applicable'))});

// ── meeting_step_contract ──
check('meeting_step_contract passes a well-formed synthesis',()=>assert.equal(status('meeting_step_contract',step('synthesis',synthesis())),'pass'));
check('meeting_step_contract fails a synthesis with four tasks',()=>assert.equal(status('meeting_step_contract',step('synthesis',synthesis({tasks:['creative','content','growth','data'].map(task)}))),'fail'));
check('meeting_step_contract fails a synthesis missing decisions',()=>{const rest=omit(synthesis(),'decisions');assert.equal(status('meeting_step_contract',step('synthesis',rest)),'fail');assert.match(detail('meeting_step_contract',step('synthesis',rest)),/decisions/)});
check('meeting_step_contract fails a task assigned to quality',()=>assert.equal(status('meeting_step_contract',step('synthesis',synthesis({tasks:[task('quality')]}))),'fail'));
check('meeting_step_contract fails a non-JSON step output',()=>assert.equal(status('meeting_step_contract',step('synthesis','합의안: 위치 안내를 채택합니다.')),'fail'));
check('meeting_step_contract passes a strict quality review with five criteria and every task',()=>assert.equal(status('meeting_step_contract',strictQuality(review())),'pass'));
check('meeting_step_contract fails a strict quality review missing a criterion',()=>{const item=strictQuality(review({checks:CRITERIA.slice(0,4).map(qcheck)}));assert.equal(status('meeting_step_contract',item),'fail');assert.match(detail('meeting_step_contract',item),/5개 기준/)});
check('meeting_step_contract fails a strict quality review whose task checks miss an assigned role',()=>assert.equal(status('meeting_step_contract',strictQuality(review({taskChecks:[tcheck('creative')]}))),'fail'));
check('meeting_step_contract fails an unknown verdict',()=>assert.equal(status('meeting_step_contract',strictQuality(review({verdict:'approved'}))),'fail'));
check('meeting_step_contract accepts a legacy quality review with verdict, summary and findings only',()=>assert.equal(status('meeting_step_contract',step('quality',{verdict:'needs_data',summary:'자료 필요',findings:'오픈일 확정 전이라 판정을 보류한다.'})),'pass'));
check('meeting_step_contract reads a parsed step object when raw is absent',()=>{const item=omit(step('synthesis',synthesis()),'raw');assert.equal(status('meeting_step_contract',{...item,fields:synthesis()}),'pass')});
check('meeting_step_contract is not applicable to revisions, discussions and roles',()=>{assert.equal(status('meeting_step_contract',step('revision',{title:'t',content:long,changes:'c'})),'not_applicable');assert.equal(status('meeting_step_contract',talk(goodTalk)),'not_applicable');assert.equal(status('meeting_step_contract',role(long)),'not_applicable')});

// ── revision_repeat ──
const original=['## 콘셉트 A · 골목 끝 발견','가상동 골목 끝에서 떡볶이 가게를 찾는 첫 장면으로 시작한다. 길찾기 화면을 보여 준 뒤 가게 간판을 비춘다.','## 콘셉트 B · 퇴근길 포장','퇴근길 직장인이 20분 안에 포장해 가는 장면을 보여 준다. 대기 없이 받는 픽업 선반을 증명 장면으로 둔다.','## 콘셉트 C · 동네 단골','동네 주민이 주말 오후에 다시 찾는 장면을 보여 준다. 단골 인터뷰는 실제 촬영 동의 뒤에만 쓴다.','## 제작 지시','15초 세로 영상, 자막은 두 줄 이내, 마지막 장면에 위치 안내와 CTA를 넣는다.'].join('\n');
const revision=(text,extra={})=>step('revision',{title:'크리에이티브 개선본',content:text,changes:'D4 반론을 반영해 증명 장면을 바꿨다.'},{original,...extra});
const rewritten=['## 선택안 · 퇴근길 픽업','추천안은 퇴근길 픽업이다. 첫 장면은 지하철 출구에서 휴대폰 지도를 여는 손이고, 둘째 장면은 선반 번호표를 집는 손이다.','증명 장면은 주문부터 수령까지 걸린 시간을 화면 구석 타이머로 보여 준다. 타이머 값은 실제 촬영 기록으로만 넣는다 [확인 필요].','## 보류한 안','골목 끝 발견 안은 위치 인지가 확인된 뒤 2차 소재로 쓴다. 단골 안은 촬영 동의를 받기 전까지 보류한다.','## 대조안','CTA 문구만 바꾼 두 버전(길찾기 열기 / 픽업 주문하기)을 같은 기간에 비교한다.'].join('\n');
check('revision_repeat fails a revision that repeats the original verbatim',()=>{const item=revision(original);assert.equal(status('revision_repeat',item),'fail');assert.match(detail('revision_repeat',item),/유사도 1(\.0+)? ≥ 0\.9/)});
check('revision_repeat fails a revision that only appends a short note',()=>assert.equal(status('revision_repeat',revision(original+'\n수정: CTA 문구를 조금 다듬었다.')),'fail'));
check('revision_repeat passes a rewritten revision and reports the similarity',()=>{const item=revision(rewritten);assert.equal(status('revision_repeat',item),'pass');assert.match(detail('revision_repeat',item),/유사도 0\.\d+/)});
check('revision_repeat ignores whitespace-only differences',()=>assert.equal(status('revision_repeat',revision(original.replace(/\n/g,'\n\n').replace(/ /g,'  '))),'fail'));
check('an empty revision body is not graded as a rewrite or a fix',()=>{const empty=step('revision',{title:'크리에이티브 개선본',changes:'반영'},{original});assert.equal(status('revision_repeat',empty),'not_applicable');assert.equal(status('seeded_defect_detection',empty,{seededDefects:[{id:'d-first',role:'creative',marker:'업계 최초'}]}),'not_applicable')});
check('revision_repeat is not applicable without the original or outside revisions',()=>{assert.equal(status('revision_repeat',revision(rewritten,{original:undefined})),'not_applicable');assert.equal(status('revision_repeat',step('synthesis',synthesis())),'not_applicable');assert.equal(status('revision_repeat',role(original)),'not_applicable')});

// ── seeded_defect_detection ──
const defects=[{id:'d-first',role:'creative',marker:'업계 최초',keywords:['최초']},{id:'d-cohort',role:'data',keywords:['코호트','관찰 기간']}];
const sctx={seededDefects:defects};
check('seeded_defect_detection is not applicable without seeded defects',()=>assert.equal(status('seeded_defect_detection',strictQuality(review())),'not_applicable'));
check('seeded_defect_detection passes a quality review that points at every seeded defect',()=>assert.equal(status('seeded_defect_detection',strictQuality(review({findings:'크리에이티브 v1 헤드라인의 ‘업계 최초’ 표현은 근거가 없어 삭제가 필요하다. 데이터 v1은 재방문율 정의에 관찰 기간이 끝난 코호트 기준이 없다.'})),sctx),'pass'));
check('seeded_defect_detection reads the criterion checks of a quality review',()=>assert.equal(status('seeded_defect_detection',strictQuality(review({findings:'헤드라인의 최초 표현 근거가 없다.',checks:CRITERIA.map(c=>c==='measurement'?{...qcheck(c),status:'revise',finding:'재방문율에 코호트 기준이 없다.'}:qcheck(c))})),sctx),'pass'));
check('seeded_defect_detection fails a quality review that misses a seeded defect and names it',()=>{const item=strictQuality(review({findings:'헤드라인의 업계 최초 표현은 근거 확인 전이다.'}));assert.equal(status('seeded_defect_detection',item,sctx),'fail');assert.match(detail('seeded_defect_detection',item,sctx),/d-cohort/);assert.doesNotMatch(detail('seeded_defect_detection',item,sctx),/d-first/)});
check('seeded_defect_detection fails a revision that keeps the planted phrase',()=>assert.equal(status('seeded_defect_detection',revision('헤드라인: 업계 최초 숯불 떡볶이, 가상동에서 만나세요.\n'+rewritten),sctx),'fail'));
// 부정 맥락 재사용(negation.ts): 심은 문구를 쓰지 않는다고 밝힌 개선본은 수정한 것이다.
check('seeded_defect_detection passes a revision that negates the planted phrase',()=>assert.equal(status('seeded_defect_detection',revision('헤드라인은 ‘가상동 골목 끝 떡볶이’로 바꾼다. ‘업계 최초’ 표현은 근거가 없어 쓰지 않는다.\n'+rewritten),sctx),'pass'));
check('seeded_defect_detection passes a revision that drops the planted phrase',()=>assert.equal(status('seeded_defect_detection',revision(rewritten),sctx),'pass'));
check('seeded_defect_detection is not applicable to a revision of a role without planted phrases',()=>assert.equal(status('seeded_defect_detection',revision(rewritten,{role:'content'}),sctx),'not_applicable'));
check('seeded_defect_detection is not applicable to syntheses, discussions and roles',()=>{assert.equal(status('seeded_defect_detection',step('synthesis',synthesis()),sctx),'not_applicable');assert.equal(status('seeded_defect_detection',talk(goodTalk),sctx),'not_applicable');assert.equal(status('seeded_defect_detection',role('업계 최초 숯불 떡볶이'),sctx),'not_applicable')});
check('bad seeded defects become grader_error without hiding other results',()=>{const r=results(strictQuality(review()),{seededDefects:[null]});assert.equal(r.find(x=>x.id==='seeded_defect_detection').status,'grader_error');assert.equal(r.find(x=>x.id==='meeting_step_contract').status,'pass')});

// ── brief_contract ──
const sug=(field,value)=>({field,value,reason:'브리프 목표 근거'});
const baseSuggestions=[sug('kpi','첫 방문 주문 수(POS 기준, 주 단위 집계)'),sug('hypothesis','위치 안내 카드가 길찾기 뒤 첫 방문을 늘린다.'),sug('experiment','안내 카드 2안을 2주씩 번갈아 비교한다.'),sug('tracking','길찾기 클릭과 POS 첫 주문을 주 단위로 기록한다.'),sug('decision','2주 뒤 첫 주문이 늘지 않으면 안내 문구를 바꾼다.'),sug('message','가상동 골목 끝, 떡볶이 가게 위치를 먼저 확인하세요.'),sug('schedule','기준 데이터 확보 후 첫 주에 안내 카드를 게시한다.')];
const briefOut=(over={})=>({summary:'가상분식 오픈 첫 달 방문을 늘리는 위치 안내 중심 접근입니다.',suggestions:baseSuggestions,questions:[{field:'budget',question:'예산 상한은 얼마인가요?',why:'배분 원칙 확정'}],assumptions:['위치가 첫 방문의 장벽이다.'],contextUsed:['현재 브리프 입력'],factCandidates:[],...over});
const brief=(out,extra={})=>({id:'b',kind:'brief',raw:typeof out==='string'?out:JSON.stringify(out),...extra});
const withSuggestion=(...extra)=>briefOut({suggestions:[...baseSuggestions,...extra]});
check('brief_contract passes a complete draft',()=>assert.equal(status('brief_contract',brief(briefOut())),'pass'));
check('brief_contract fails a draft without an experiment suggestion',()=>assert.equal(status('brief_contract',brief(briefOut({suggestions:baseSuggestions.filter(s=>s.field!=='experiment')}))),'fail'));
check('brief_contract fails a draft without the assumptions array',()=>{assert.equal(status('brief_contract',brief(omit(briefOut(),'assumptions'))),'fail')});
check('brief_contract fails more than three questions',()=>{const q={field:'target',question:'목표값은?',why:'사용자 결정'};const item=brief(briefOut({questions:[q,q,q,q]}));assert.equal(status('brief_contract',item),'fail');assert.match(detail('brief_contract',item),/질문 4개/)});
check('brief_contract fails an unknown or duplicated suggestion key',()=>{assert.equal(status('brief_contract',brief(withSuggestion(sug('slogan','가상동 떡볶이')))),'fail');assert.equal(status('brief_contract',brief(withSuggestion(sug('kpi','주간 포장 주문 수')))),'fail')});
check('brief_contract fails a non-JSON draft',()=>assert.equal(status('brief_contract',brief('가상분식 브리프 초안입니다.')),'fail'));
check('brief_contract is not applicable to a rendered brief without JSON and to other kinds',()=>{assert.equal(status('brief_contract',{id:'b',kind:'brief',text:'## 목표\n'+long}),'not_applicable');assert.equal(status('brief_contract',role(long)),'not_applicable');assert.equal(status('brief_contract',step('synthesis',synthesis())),'not_applicable')});

// ── brief_instruction_violation ──
const bctx={prohibitedTerms:['숯불'],facts,briefInput:'제품: 떡볶이 1인분 4,500원\n시작일: 2026-10-03'};
check('brief_instruction_violation passes a draft that follows the brief rules',()=>assert.equal(status('brief_instruction_violation',brief(briefOut()),bctx),'pass'));
check('brief_instruction_violation fails a suggestion for a protected field',()=>{const item=brief(withSuggestion(sug('target','첫 달 방문 300명')));assert.equal(status('brief_instruction_violation',item,bctx),'fail');assert.match(detail('brief_instruction_violation',item,bctx),/보호 항목 제안: target/)});
check('brief_instruction_violation fails an unconfirmed price assertion',()=>assert.equal(status('brief_instruction_violation',brief(withSuggestion(sug('products','떡볶이 세트 6,900원으로 판매한다.'))),bctx),'fail'));
check('brief_instruction_violation accepts a price the user wrote or the ledger confirmed',()=>{assert.equal(status('brief_instruction_violation',brief(withSuggestion(sug('products','떡볶이 1인분 4,500원을 첫 화면에 둔다.'))),bctx),'pass');assert.equal(status('brief_instruction_violation',brief(withSuggestion(sug('products','떡볶이 4,000원을 첫 화면에 둔다.'))),bctx),'pass')});
check('brief_instruction_violation accepts a price marked for confirmation',()=>assert.equal(status('brief_instruction_violation',brief(withSuggestion(sug('products','떡볶이 세트 6,900원 [확인 필요]'))),bctx),'pass'));
check('brief_instruction_violation fails an absolute schedule date the user did not give',()=>{const item=brief(withSuggestion(sug('deliverables','10월 9일 오픈 행사 영상을 게시한다.')));assert.equal(status('brief_instruction_violation',item,bctx),'fail');assert.match(detail('brief_instruction_violation',item,bctx),/일정 단정/)});
check('brief_instruction_violation accepts the start date the user gave',()=>assert.equal(status('brief_instruction_violation',brief(withSuggestion(sug('deliverables','10월 3일 시작일에 안내 카드를 게시한다.'))),bctx),'pass'));
check('brief_instruction_violation fails a prohibited expression in a suggestion',()=>assert.equal(status('brief_instruction_violation',brief(withSuggestion(sug('deliverables','숯불 향을 강조한 15초 영상'))),bctx),'fail'));
// 부정 맥락 재사용(negation.ts): 금지 표현을 쓰지 않는다고 적은 제안은 위반이 아니다.
check('brief_instruction_violation passes a negated prohibited expression',()=>assert.equal(status('brief_instruction_violation',brief(withSuggestion(sug('constraints','숯불 표현은 쓰지 않는다.'))),bctx),'pass'));
check('brief_instruction_violation fails a rejected ledger value used as a premise',()=>assert.equal(status('brief_instruction_violation',brief(briefOut({summary:'숯불 조리를 차별점으로 알리는 접근입니다.'})),{facts}),'fail'));
check('brief_instruction_violation grades a rendered brief when JSON is absent',()=>assert.equal(status('brief_instruction_violation',{id:'b',kind:'brief',text:'## 제작물\n10월 9일에 숯불 영상을 게시한다.'},bctx),'fail'));
check('brief_instruction_violation is not applicable outside briefs',()=>{assert.equal(status('brief_instruction_violation',role('숯불 향 떡볶이 6,900원'),bctx),'not_applicable');assert.equal(status('brief_instruction_violation',step('synthesis',synthesis()),bctx),'not_applicable')});

// ── brand_intro_as_fact ──
const ictx={brandIntro:'가상분식 휘경본점은 2004년부터 국내산 쌀떡만 쓰는 휘경동 대표 분식집입니다.',brandName:'가상분식 휘경본점',facts};
check('brand_intro_as_fact fails an unverified intro claim written in a confirmed-facts section',()=>{const item=role('## 확인된 사실\n- 2004년부터 국내산 쌀떡만 쓴다.\n- 주소는 가상동 12 B동 201호다.\n\n## 가설\n'+long);assert.equal(status('brand_intro_as_fact',item,ictx),'fail');assert.match(detail('brand_intro_as_fact',item,ictx),/2004년부터/)});
check('brand_intro_as_fact passes intro claims kept outside the confirmed zone and marked',()=>assert.equal(status('brand_intro_as_fact',role('## 확인된 사실\n- 주소는 가상동 12 B동 201호다.\n\n## 브랜드 소개(미확인)\n- 2004년부터 국내산 쌀떡만 쓴다고 소개돼 있다.'),ictx),'pass'));
check('brand_intro_as_fact does not treat unverified or candidate fact labels as the confirmed zone',()=>{for(const text of ['## 미확인 사실\n- 2004년부터 국내산 쌀떡만 쓴다고 소개돼 있다.','## 확인 사실 후보\n- 2004년부터 국내산 쌀떡만 쓴다고 소개돼 있다.','## 확인된 사실\n| 구분 | 내용 |\n|---|---|\n| 미확인 소개 | 2004년부터 국내산 쌀떡만 쓴다 |\n| 주소 | 가상동 12 B동 201호 |'])assert.notEqual(status('brand_intro_as_fact',role(text),ictx),'fail',text)});
check('brand_intro_as_fact exempts a confirmed-zone sentence marked for confirmation',()=>assert.equal(status('brand_intro_as_fact',role('## 확인된 사실\n- 2004년부터 국내산 쌀떡만 쓴다 [확인 필요].'),ictx),'pass'));
check('brand_intro_as_fact accepts intro wording that the ledger confirmed',()=>{const item=role('## 확인된 사실\n- 국내산 쌀떡만 쓰는 분식집이다.');assert.equal(status('brand_intro_as_fact',item,ictx),'fail');assert.equal(status('brand_intro_as_fact',item,{...ictx,facts:{confirmed:[...facts.confirmed,{key:'원재료',value:'국내산 쌀떡만 쓰는 분식집'}],prohibited:[]}}),'pass')});
check('brand_intro_as_fact does not count the brand name as an intro claim',()=>{const item=role('## 확인된 사실\n- 가상분식 휘경본점 주소는 가상동 12 B동 201호다.');assert.equal(status('brand_intro_as_fact',item,ictx),'pass');assert.equal(status('brand_intro_as_fact',item,{...ictx,brandName:undefined}),'fail')});
check('brand_intro_as_fact reads a confirmed inline label and a confirmed table row',()=>{assert.equal(status('brand_intro_as_fact',role('## 확정/가정/미확정 목록\n- 확정: 2004년부터 국내산 쌀떡만 쓴다.\n- 가정: 첫 방문 장벽은 위치다.'),ictx),'fail');assert.equal(status('brand_intro_as_fact',role('| 구분 | 내용 |\n|---|---|\n| 확인 사실 | 휘경동 대표 분식집 |'),ictx),'fail')});
check('brand_intro_as_fact is not applicable without an intro or a confirmed zone',()=>{assert.equal(status('brand_intro_as_fact',role('## 확인된 사실\n- 2004년부터 국내산 쌀떡만 쓴다.'),{facts}),'not_applicable');assert.equal(status('brand_intro_as_fact',role('## 가설\n- 2004년부터 국내산 쌀떡만 쓴다는 소개를 검증한다.'),ictx),'not_applicable')});
check('brand_intro_as_fact grades revisions and rendered briefs but not discussions',()=>{const zone='## 확인된 사실\n- 2004년부터 국내산 쌀떡만 쓴다.';assert.equal(status('brand_intro_as_fact',revision(zone+'\n'+rewritten),ictx),'fail');assert.equal(status('brand_intro_as_fact',{id:'b',kind:'brief',text:zone},ictx),'fail');assert.equal(status('brand_intro_as_fact',talk({...goodTalk,evidence:zone}),ictx),'not_applicable')});

// ── 업종 사전: 새 업종, 배열(주 업종+허용 업종), 공용 용어 제외 ──
const leak=(text,ind)=>status('industry_metric_leak',role(text),{industry:ind});
check('the industry dictionary adds fnb, education, popup and retail next to the v1 industries',()=>assert.deepEqual(Object.keys(industry.INDUSTRY_TERMS).sort(),['beauty','education','fnb','kpop','locker','popup','retail']));
check('content.ts keeps exporting the same dictionary',()=>assert.equal(content.INDUSTRY_TERMS,industry.INDUSTRY_TERMS));
check('each new industry catches its own metrics in another campaign',()=>{
 for(const [id,text] of [['fnb','원산지 표시를 메뉴판에 적고 테이블 회전을 본다.'],['education','수강생 입학 상담 전환과 커리큘럼 만족도를 본다.'],['popup','회차별 입장 정원과 입장객 수를 기록한다.'],['retail','지점별 재고와 진열 면적을 맞춘다.']]){
  assert.equal(leak(text,'locker'),'fail',id);assert.match(detail('industry_metric_leak',role(text),{industry:'locker'}),new RegExp(id));assert.equal(leak(text,id),'pass',id);
 }
});
check('cross-industry common terms are not in any dictionary',()=>{
 assert.ok(industry.COMMON_TERMS.length>=20);
 for(const [id,re] of Object.entries(industry.INDUSTRY_TERMS))for(const t of industry.COMMON_TERMS)assert.ok(!re.test(t),`${id}: ${t}`);
});
// 수용 기준: MAPDAL(K-FOOD & CULTURE 브랜드의 kpop 캠페인)이 음식·공용 용어 때문에 새로 fail하지 않는다.
const mapdal='MAPDAL은 K-food와 팬덤을 잇는 브랜드다. 매운 떡볶이 굿즈와 앨범 초동 구매 혜택을 함께 알린다. 가격과 배송 일정, 할인 조건을 상세 페이지에 적는다. 분식 메뉴 콘텐츠와 먹방 영상으로 브랜드 세계관을 보여 준다. 포장 상태 후기와 재고 알림 신청, 매장 방문 이벤트, 팝업 기간 안내를 모은다. 주문 수와 재구매 고객을 주 단위로 본다.';
check('a MAPDAL kpop output with food and shared commerce words does not fail',()=>assert.equal(leak(mapdal,'kpop'),'pass'));
check('a kpop campaign still fails on real restaurant metrics unless fnb is allowed',()=>{assert.equal(leak('원산지 표시와 배달 주문 비중을 지표로 둔다.','kpop'),'fail');assert.equal(leak('원산지 표시와 배달 주문 비중을 지표로 둔다.',['kpop','fnb']),'pass')});
check('an array industry excludes the primary and every allowed industry',()=>{assert.equal(leak('포토카드 초동과 회차별 입장 정원을 본다.',['popup','kpop']),'pass');assert.equal(leak('포토카드 초동과 회차별 입장 정원을 본다.',['popup']),'fail')});
check('an empty or invalid industry array is an unknown industry',()=>{assert.equal(leak('보관함 가동률',[]),'not_applicable');assert.equal(leak('보관함 가동률',[null,'']),'not_applicable');assert.equal(leak('보관함 가동률',[null,'fnb']),'fail')});
check('an fnb campaign keeps waiting, visit and display words without popup or retail leaks',()=>assert.equal(leak(long+' 빵 진열대 위치와 매장 방문, 대기 번호 안내를 바꾼다.','fnb'),'pass'));
check('an explicit exclusion still clears a new-industry term',()=>assert.equal(leak('수강생 지표는 이번 캠페인과 무관하므로 제외합니다.','fnb'),'pass'));

// 모델 출력 한도(40,000자) 입력에서 새 채점기도 빨리 끝난다.
check('G3 graders finish quickly on 40,000-character adversarial inputs',()=>{
 const ctx={...cleanCtx,...ictx,...sctx,briefInput:'가'.repeat(5000)};
 for(const text of ['가'.repeat(40000),'가상분식은2004년부터'.repeat(3000),('## 확인된 사실\n- '+'가상동 '.repeat(20)+'\n').repeat(300),'10월 3일 4,500원 '.repeat(3000)]){
  const t=Date.now();
  for(const item of [revision(text,{original:text}),revision(text,{original:original}),strictQuality(review({findings:text})),brief(briefOut({summary:text.slice(0,5000)})),{id:'b',kind:'brief',text},role(text)])results(item,ctx);
  assert.ok(Date.now()-t<1500,text.slice(0,8)+' '+(Date.now()-t));
 }
});
console.log(JSON.stringify({passed:passed.length}));
