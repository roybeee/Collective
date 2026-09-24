// A7 부분 구제: 심층 조사 보고서(parseDeepReport)의 항목 단위 오류는 그 원소만 빼고 사유를 남긴다. 뺀 출처를 가리키던 원소는 함께 빠진다.
// 뼈대 오류(단계 기록·목록 형식·크기 한도·진단 필수 필드·JSON 아님)는 DeepReportShapeError(422)로 구분하고, 서로 독립인 뼈대 오류는 errors에 모두 모은다. 최대 개수를 넘은 원소는 항목 단위로 뺀다. 저장 계획 없음은 수리할 수 없으므로 일반 ApiError(422)다.
// 근거: mocked(합성 보고서, fetch 스텁은 호출되면 실패한다). 유료 모델·HERMES·외부 API 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
const external=[];
const {load}=testRuntime(async url=>{external.push(String(url));throw new Error('외부 호출 금지: '+url)});
const deep=await load('lib/deep-research-server.ts'),server=await load('lib/server.ts'),{researchPhases}=await load('lib/deep-research.ts');
let passed=0;const check=(name,condition)=>{assert.ok(condition,name);passed++};
const CASCADE='근거 출처가 빠져 함께 뺐습니다.';

// 합성 보고서. 실제 브랜드·고객 정보가 아니다. 시각을 고정해 결과를 바이트 단위로 비교한다.
const at='2026-09-18T00:00:00.000Z',published='2026-09-10T00:00:00.000Z';
const research={id:'rs',brandId:'b1',createdAt:'2026-09-20T00:00:00.000Z',plan:{objective:'검증',businessType:'service',lookbackDays:30,targetCases:2,targetCompetitors:1,maxFollowups:2,questions:[],channels:[]}};
const existing=[{id:'in1',brandId:'b1',title:'입력 자료',category:'market',origin:'manual',status:'confirmed',url:'https://brand.example.com/in1',content:'입력 근거',observedAt:at,createdAt:at,version:1,scope:'원문'}];
const source=(id,category)=>({id,title:id+' 자료',category,url:'https://brand.example.com/'+id,content:id+' 관찰 근거',scope:'공식 원문',observedAt:at});
const fixture=()=>({
 sources:[source('s1','brand'),source('s2','product'),source('s3','customer'),source('v1','channel'),source('v2','operations')],
 phases:researchPhases.map(phase=>({phase,summary:phase+' 검토'})),
 access:[...['s1','s2','s3','v1','v2'].map(sourceId=>({sourceId,method:'browser',tool:'test-browser',scope:'읽기'})),{sourceId:'in1',method:'api',tool:'test-api',scope:'입력 자료'}],
 cases:[{id:'c1',sourceId:'v1',account:'brand',channel:'Instagram',relationship:'own',format:'video',publishedAt:published,observedAt:at,distribution:'organic',views:120,likes:null,comments:3,shares:null,durationSeconds:20,viewing:'full',viewedRanges:[{start:0,end:20}],timeline:[{second:0,observation:'첫 장면'}],hook:'h',message:'m',proof:'p',cta:'c',friction:'f',hypothesis:'hy',alternative:'al'},
  {id:'c2',sourceId:'v2',account:'brand',channel:'Instagram',relationship:'own',format:'image',publishedAt:published,observedAt:at,distribution:'unknown',views:null,likes:10,comments:null,shares:null,durationSeconds:null,viewing:'not_viewed',viewedRanges:[],timeline:[],hook:'h',message:'m',proof:'p',cta:'c',friction:'f',hypothesis:'hy',alternative:'al'}],
 customerSignals:[{sourceId:'s3',kind:'barrier',observation:'가격 질문',implication:'가격 안내'}],
 competitors:[{name:'경쟁 A',sourceIds:['in1','s2'],difference:'구성 차이'}],
 review:{claims:[{claim:'가격 장벽',sourceIds:['s3'],counterEvidence:'다른 요인',nextCheck:'한 변수 실험'}],followups:[{question:'구성 차이?',finding:'확인함',sourceIds:['s2']}],unresolved:['추가 자료 필요']},
 diagnosis:{summary:'진단',positioning:'p',audience:'a',needs:'n',strengths:'s',gaps:'g',limitations:'l',questions:['실제 선택 이유는?'],sourceIds:['s1','s2','s3','in1'],opportunities:[{title:'가격 안내',hypothesis:'h',action:'a',metric:'m',sourceIds:['s3']},{title:'구성 비교',hypothesis:'h',action:'a',metric:'m',sourceIds:['s2','in1']}]}
});
const edit=change=>{const x=fixture();change(x);return x};
const parse=(x,r=research)=>deep.parseDeepReport(x,r,existing);
const caught=run=>{try{run()}catch(e){return e}return null};
const shape=(name,run,message)=>{const e=caught(run);check(name+' → '+(e?`${e.status} ${e.message}`:'통과함'),e instanceof deep.DeepReportShapeError&&e instanceof server.ApiError&&e.status===422&&(!message||e.message===message))};
const normal=out=>JSON.stringify({sources:out.sources.map(s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='createdAt'))),report:{...out.report,completedAt:null},diagnosis:out.diagnosis});
const hash=text=>createHash('sha256').update(text).digest('hex');
const has=(out,section,index,reason)=>out.salvage.dropped.some(d=>d.section===section&&d.index===index&&d.reason===reason);

// 1) 정상 보고서: 결과 불변. GOLDEN은 구제 도입 전 파서(origin/main d609e9d)로 같은 합성 보고서를 처리한 결과(생성 시각 제외)의 sha256이다.
const GOLDEN='eee73ccf45ab0b5f487f172fc5f12e80122f90a25825b6025de6f1ab9f09e27d';
const ok=parse(fixture());
check('valid report output is byte-identical to the pre-salvage parser',hash(normal(ok))===GOLDEN);
check('valid report drops nothing',Array.isArray(ok.salvage.dropped)&&ok.salvage.dropped.length===0);
check('valid report counts every kept element',JSON.stringify(ok.salvage.kept)===JSON.stringify({sources:5,access:6,cases:2,customerSignals:1,competitors:1,'review.claims':1,'review.followups':1,'review.unresolved':1,'diagnosis.sourceIds':4,'diagnosis.opportunities':2,'diagnosis.questions':1}));

// 2) 잘못된 콘텐츠 표본 1개: 그 표본만 빠지고 나머지는 그대로다.
const badCase=parse(edit(x=>{x.cases[1].format='gif'}));
check('invalid case is dropped with its reason and id',JSON.stringify(badCase.salvage.dropped)===JSON.stringify([{section:'cases',index:1,id:'c2',reason:'콘텐츠 형식 값이 올바르지 않습니다.'}]));
check('other cases, sources and sections are preserved',badCase.report.cases.length===1&&badCase.report.cases[0].id==='c1'&&badCase.sources.length===5&&JSON.stringify(badCase.report.competitors)===JSON.stringify(ok.report.competitors)&&JSON.stringify(badCase.diagnosis.opportunities)===JSON.stringify(ok.diagnosis.opportunities));
check('server quality gate still judges what is left',badCase.report.quality.status==='needs_data'&&badCase.report.quality.issues.some(s=>s.startsWith('자사 콘텐츠 표본 1/2')));

// 3) 잘못된 출처: 그 출처를 가리키던 접근 기록·경쟁·보완 조사·실험 과제가 함께 빠지고, 진단 근거에서는 그 출처만 빠진다.
const badSource=parse(edit(x=>{x.sources[1].url='ftp://brand.example.com/s2'}));
check('invalid source is dropped with its reason',has(badSource,'sources',1,'공개 웹 주소를 입력하세요.')&&badSource.salvage.dropped.find(d=>d.section==='sources').id==='s2');
check('surviving sources keep their canonical ids',JSON.stringify(badSource.sources.map(s=>s.id))==='["rs-e0-0","rs-e2-0","rs-e3-0","rs-e4-0"]');
for(const [section,index] of [['access',1],['competitors',0],['review.followups',0],['diagnosis.sourceIds',1],['diagnosis.opportunities',1]])check('cascade drops '+section+' #'+index,has(badSource,section,index,CASCADE));
check('nothing kept still points at the dropped source',!JSON.stringify({report:badSource.report,diagnosis:badSource.diagnosis}).includes('rs-e1-0'));
check('diagnosis keeps its other evidence',JSON.stringify(badSource.diagnosis.sourceIds)==='["rs-e0-0","rs-e2-0","in1"]'&&badSource.diagnosis.opportunities.length===1);
check('surviving new sources are stored as candidates only',badSource.sources.every(s=>s.status==='candidate'&&s.origin==='research'&&s.researchId==='rs'));
const LOST='형식·근거 검증에서 뺀 항목';
check('dropping a source or diagnosis evidence is a quality issue (diagnosis text may lean on it)',badSource.report.quality.status==='needs_data'&&badSource.report.quality.issues.some(s=>s.startsWith(LOST)));
check('dropping only a content case adds no such issue',!badCase.report.quality.issues.some(s=>s.startsWith(LOST))&&!ok.report.quality.issues.some(s=>s.startsWith(LOST)));
const noAccess=parse(edit(x=>{x.access.shift()}));
check('a new source without an access record is dropped and cascades',has(noAccess,'sources',0,'접근 기록이 없는 출처입니다.')&&has(noAccess,'diagnosis.sourceIds',0,CASCADE)&&noAccess.sources.length===4);
const dup=parse(edit(x=>{x.access.push({...x.access[0]});x.cases.push({...x.cases[0],id:'c3'});x.competitors.push({...x.competitors[0],name:' 경쟁 a '})}));
check('later duplicates are dropped, first ones kept',has(dup,'access',6,'같은 출처의 접근 기록이 중복됐습니다.')&&has(dup,'cases',2,'콘텐츠 표본이 중복됐습니다.')&&has(dup,'competitors',1,'경쟁사 근거가 없거나 중복됐습니다.')&&dup.report.cases.length===2&&dup.report.competitors.length===1);

// 4) null·원시값 원소: TypeError가 아니라 항목 단위 오류로 빠진다(security-ops-11 잔여). 뼈대 자리의 null은 422다.
const nulls={sources:x=>x.sources,access:x=>x.access,cases:x=>x.cases,customerSignals:x=>x.customerSignals,competitors:x=>x.competitors,'review.claims':x=>x.review.claims,'review.followups':x=>x.review.followups,'review.unresolved':x=>x.review.unresolved,'diagnosis.opportunities':x=>x.diagnosis.opportunities,'diagnosis.questions':x=>x.diagnosis.questions};
for(const [section,list] of Object.entries(nulls))for(const value of ['review.unresolved','diagnosis.questions'].includes(section)?[null,7,{}]:[null,'문자열',7]){
 const x=fixture(),target=list(x),index=target.length;target.push(value);const e=caught(()=>parse(x)),out=e?null:parse(x);
 check(`${JSON.stringify(value)} element in ${section} is salvaged, not a TypeError`,!e&&out.salvage.dropped.length===1&&out.salvage.dropped[0].section===section&&out.salvage.dropped[0].index===index);
}
const nullOpportunity=parse(edit(x=>{x.diagnosis.opportunities=[null]}));
check('null opportunity (known defect) is dropped with a user-facing reason',has(nullOpportunity,'diagnosis.opportunities',0,'근거 목록 형식을 확인하세요.')&&nullOpportunity.diagnosis.opportunities.length===0);
check('losing every opportunity is a quality issue, not a shape error',nullOpportunity.report.quality.status==='needs_data'&&nullOpportunity.report.quality.issues.includes('출처에 연결된 진단과 검증 실험이 필요합니다.'));
shape('null phase is a shape error',()=>parse(edit(x=>{x.phases[0]=null})),'조사 단계 기록이 누락되거나 순서가 다릅니다.');
shape('null diagnosis is a shape error',()=>parse(edit(x=>{x.diagnosis=null})),'근거 목록 형식을 확인하세요.');
shape('null review has no claim list',()=>parse(edit(x=>{x.review=null})),'핵심 주장 검토 형식을 확인하세요.');

// 5) 뼈대 오류는 DeepReportShapeError(422)다. 메시지는 사용자용 한국어 그대로다.
shape('missing phase',()=>parse(edit(x=>{x.phases.pop()})),'여섯 조사 단계의 기록이 필요합니다.');
shape('phase text error becomes 422',()=>parse(edit(x=>{x.phases[0].summary='   '})),'단계 요약 입력을 확인해 주세요.');
shape('non-array source list',()=>parse(edit(x=>{x.sources='abc'})),'조사 출처 형식을 확인하세요.');
shape('a list over twice its maximum is a size error',()=>parse(edit(x=>{x.review.unresolved=Array(25).fill('미확인')})),'미해결 질문 형식을 확인하세요.');
shape('response over the storage limit',()=>parse(edit(x=>{x.review.unresolved=['가'.repeat(240000)]})),'조사 응답이 저장 한도를 초과했습니다.');
shape('blank diagnosis summary',()=>parse(edit(x=>{x.diagnosis.summary=''})),'진단 요약 입력을 확인해 주세요.');
shape('fabricated diagnosis evidence',()=>parse(edit(x=>{x.diagnosis.sourceIds.push('missing')})),'실제 조사 자료와 일치하지 않는 근거입니다.');
shape('non-array questions',()=>parse(edit(x=>{x.diagnosis.questions='q'})),'진단 과제와 질문 형식을 확인하세요.');
const noPlan=caught(()=>parse(fixture(),{...research,plan:undefined}));
check('missing stored plan stays a plain 422, not a repairable shape error',noPlan instanceof server.ApiError&&noPlan.status===422&&!(noPlan instanceof deep.DeepReportShapeError)&&noPlan.message==='저장된 조사 계획이 없습니다.');
shape('non-JSON response text is a shape error',()=>deep.parseDeepText('조사 결과입니다',research,existing),'조사 응답 형식을 확인하지 못했습니다. 기록을 유지했으며 새 조사로 이어갈 수 있습니다.');
const two=caught(()=>parse(edit(x=>{x.phases[0]=null;x.diagnosis.summary=''})));
check('independent shape errors are all collected and the first one is shown',two instanceof deep.DeepReportShapeError&&two.message==='조사 단계 기록이 누락되거나 순서가 다릅니다.'&&JSON.stringify(two.errors)===JSON.stringify(['조사 단계 기록이 누락되거나 순서가 다릅니다.','진단 요약 입력을 확인해 주세요.']));
const brokenSources=caught(()=>parse(edit(x=>{x.sources='abc';x.phases.pop()})));
check('errors that only follow from a broken list are not added',JSON.stringify(brokenSources?.errors)===JSON.stringify(['조사 출처 형식을 확인하세요.','여섯 조사 단계의 기록이 필요합니다.']));
check('a single shape error carries itself as the list',JSON.stringify(caught(()=>deep.parseDeepText('조사 결과입니다',research,existing)).errors)===JSON.stringify(['조사 응답 형식을 확인하지 못했습니다. 기록을 유지했으며 새 조사로 이어갈 수 있습니다.']));
check('JSON response text parses like the object',hash(normal(deep.parseDeepText('```json\n'+JSON.stringify(fixture())+'\n```',research,existing)))===GOLDEN);

// 6) 최소 개수 붕괴: 진단이 가리키던 출처가 모두 빠지면 구제하지 않고 뼈대 오류로 올린다.
shape('diagnosis losing all evidence is a shape error',()=>parse(edit(x=>{x.sources[0].category='weird';x.diagnosis.sourceIds=['s1'];x.diagnosis.opportunities=[{...x.diagnosis.opportunities[0],sourceIds:['s1']}]})),'진단이 참조하는 출처가 모두 빠졌습니다.');
check('diagnosis without evidence to begin with is still accepted as before',parse(edit(x=>{x.diagnosis.sourceIds=[];x.diagnosis.opportunities=[]})).diagnosis.sourceIds.length===0);

// 7) 사유에는 원문·내부 예외 문구·스택이 없다. 식별자는 짧은 영숫자일 때만 남긴다.
const leaky=parse(edit(x=>{x.sources.push({...source('bad','weird'),title:'RAW-MARKER 제목',content:'RAW-MARKER 본문'});x.cases.push({...x.cases[0],id:'<b>RAW-MARKER</b>',sourceId:'s1',hook:'RAW-MARKER 도입',format:'reel'});x.review.unresolved.push({text:'RAW-MARKER'})}));
const text=JSON.stringify(leaky.salvage);
check('dropped reasons carry no raw text, exception text or stack',leaky.salvage.dropped.length>=3&&!/RAW-MARKER|TypeError|Cannot read|reading '|\n\s+at /.test(text));
check('every reason is a short Korean sentence',leaky.salvage.dropped.every(d=>/[가-힣]/.test(d.reason)&&d.reason.length<=120));
check('unsafe ids are omitted, safe ids are kept',leaky.salvage.dropped.find(d=>d.section==='cases').id===undefined&&leaky.salvage.dropped.find(d=>d.section==='sources').id==='bad');

// 8) 조사 기록에 저장하는 salvage는 명세 모양 그대로다({dropped:[{section,index,id?,reason}],kept}). 뺀 원소마다 사유를 모두 남겨 한 섹션이 다른 섹션 사유를 밀어내지 않는다.
const many=parse(edit(x=>{x.review.unresolved=Array(12).fill('');x.diagnosis.questions=Array(12).fill(null)}));
check('salvage keeps every reason in the spec shape',Object.keys(many.salvage).sort().join()==='dropped,kept'&&many.salvage.dropped.length===24&&many.salvage.dropped.filter(d=>d.section==='diagnosis.questions').length===12&&many.salvage.dropped.every(d=>Object.keys(d).every(k=>['section','index','id','reason'].includes(k))));
check('the summary helper that cut reasons at 20 is gone',!('salvageRecord' in deep));

// 9) 최대 개수 초과: 뒤쪽 원소만 사유와 함께 빼고, 뺀 출처를 가리키던 원소는 연쇄로 빠진다(보고서 전체를 버리지 않는다).
const over=parse(edit(x=>{x.review.unresolved=Array(13).fill('미확인');x.review.followups.push(x.review.followups[0],x.review.followups[0])}));
check('items past a list maximum are dropped one by one',has(over,'review.unresolved',12,'최대 12개를 넘어 뺐습니다.')&&has(over,'review.followups',2,'최대 2개를 넘어 뺐습니다.')&&over.report.review.unresolved.length===12&&over.report.review.followups.length===2);
const extra=parse(edit(x=>{for(let i=0;i<36;i++){x.sources.push(source('e'+i,'other'));x.access.push({sourceId:'e'+i,method:'browser',tool:'test-browser',scope:'읽기'})}x.customerSignals.push({sourceId:'e35',kind:'question',observation:'관찰',implication:'함의'})}));
check('sources past the maximum are dropped and their citations cascade',extra.sources.length===40&&has(extra,'sources',40,'최대 40개를 넘어 뺐습니다.')&&extra.salvage.dropped.find(d=>d.section==='sources').id==='e35'&&has(extra,'access',41,CASCADE)&&has(extra,'customerSignals',1,CASCADE)&&extra.report.customerSignals.length===1);

// 10) 출처 번호 충돌: 같은 번호를 다른 URL에 쓰면 어느 출처의 근거인지 가릴 수 없다. 그 번호의 출처와 인용을 모두 빼고, 다른 출처로 옮겨 붙이지 않는다.
// 사유는 충돌 원인을 드러낸다(새 출처끼리 같은 번호 / 입력 자료 번호를 다른 URL로 재사용).
const CONFLICT='출처 번호 충돌(새 출처 여러 개가 같은 번호를 씀)로 어느 근거인지 가릴 수 없어 뺐습니다.',REUSED='출처 번호 충돌(입력 자료 번호를 다른 URL로 재사용)로 어느 근거인지 가릴 수 없어 뺐습니다.';
const twin=parse(edit(x=>{x.sources.push({...source('s3','customer'),url:'https://other.example.com/reviews',content:'B 사이트 별점 1점 불만'});x.customerSignals.push({sourceId:'s3',kind:'complaint',observation:'B 사이트 별점 1점 불만',implication:'확인 필요'})}));
check('two new sources sharing an id are both dropped',has(twin,'sources',2,CONFLICT)&&has(twin,'sources',5,CONFLICT)&&!twin.sources.some(s=>s.id==='rs-e2-0'||s.url.includes('other.example.com')));
check('citations of a shared new id are dropped, not re-bound to the first source',has(twin,'customerSignals',0,CONFLICT)&&has(twin,'customerSignals',1,CONFLICT)&&has(twin,'access',2,CONFLICT)&&!twin.report.customerSignals.length&&!JSON.stringify({report:twin.report,diagnosis:twin.diagnosis}).includes('rs-e2-0'));
const shadow=parse(edit(x=>{x.sources.push({...source('in1','market'),url:'https://elsewhere.example.com/in1',content:'다른 페이지'})}));
check('a new source reusing an input id with another URL drops every citation of that id',has(shadow,'sources',5,REUSED)&&has(shadow,'access',5,REUSED)&&has(shadow,'competitors',0,REUSED)&&has(shadow,'diagnosis.sourceIds',3,REUSED)&&!JSON.stringify({report:shadow.report,diagnosis:shadow.diagnosis}).includes('"in1"'));
const redeclared=parse(edit(x=>{x.sources.push(source('in1','market'))}));
// 입력 자료를 번호·URL까지 같게 다시 적은 것은 뺀 항목이 아니라 재선언 수로만 센다(tests/deep-report-evidence.test.mjs).
check('re-declaring an input source with the same URL is counted, not dropped, and citations stay on the input',redeclared.salvage.dropped.length===0&&redeclared.salvage.redeclared===1&&redeclared.diagnosis.sourceIds.includes('in1')&&redeclared.report.competitors.length===1);
check('no external destination was called',external.length===0);
console.log(JSON.stringify({passed}));
