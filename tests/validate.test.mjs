// 외부 입력(HERMES 응답·요청 본문)을 좁히는 헬퍼의 동작 고정. any → unknown 전환 전후로 반환값과 오류가 같아야 한다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
let toolsets=[];
const {load}=testRuntime(async url=>{
 if(url.endsWith('/v1/capabilities'))return Response.json({object:'hermes.api_server.capabilities',features:{run_submission:true,run_status:true},endpoints:{toolsets:{method:'GET',path:'/v1/toolsets'}}});
 if(url.endsWith('/v1/toolsets'))return Response.json({data:toolsets});
 throw new Error('Unexpected destination: '+url);
});
const deep=await load('lib/deep-research-server.ts');
const {researchPhases}=await load('lib/deep-research.ts');
const stores=await load('lib/store-server.ts');
const {channelCatalog,storeMetricFields}=await load('lib/store-marketing.ts');
let passed=0;
function check(name,condition){assert.ok(condition,name);passed++}
function fails(name,run,status,message){let error;try{run()}catch(e){error=e}assert.ok(error&&error.status===status&&error.message===message,name+' → '+(error?`${error.status} ${error.message}`:'통과함'));passed++}
function typeError(name,run){let error;try{run()}catch(e){error=e}assert.equal(error?.name,'TypeError',name);passed++}

// 심층 조사 응답 (parseDeepReport)
const now=new Date().toISOString(),past=new Date(Date.now()-86400000).toISOString();
const research={id:'r1',brandId:'b1',createdAt:now,plan:{objective:'검증',businessType:'service',lookbackDays:30,targetCases:1,targetCompetitors:1,maxFollowups:2,questions:[],channels:[]}};
const base=()=>({sources:[{id:'s1',title:'공식 자료',category:'brand',url:'https://brand.example.com/a',content:'관찰한 근거',scope:'원문',observedAt:now}],phases:researchPhases.map(phase=>({phase,summary:'검토 내용'})),access:[{sourceId:'s1',method:'browser',tool:'test-browser',scope:'읽기'}],cases:[],customerSignals:[],competitors:[],review:{claims:[],followups:[],unresolved:[]},diagnosis:{summary:'진단',positioning:'p',audience:'a',needs:'n',strengths:'s',gaps:'g',limitations:'l',questions:[],sourceIds:['s1'],opportunities:[{title:'t',hypothesis:'h',action:'a',metric:'m',sourceIds:['s1']}]}});
const video={id:'c1',sourceId:'s1',account:'brand',channel:'Instagram',relationship:'own',format:'video',publishedAt:past,observedAt:now,distribution:'organic',views:100,likes:null,comments:0,shares:null,durationSeconds:20,viewing:'not_viewed',viewedRanges:[],timeline:[],hook:'h',message:'m',proof:'p',cta:'c',friction:'f',hypothesis:'hy',alternative:'al'};
const edit=change=>{const x=base();change(x);return x};
const parse=x=>deep.parseDeepReport(x,research,[]);
const deepFails=(name,change,status,message)=>fails(name,()=>parse(edit(change)),status,message);
const withCase=patch=>x=>{x.cases=[{...video,...patch}]};

const ok=parse(base());
check('valid report maps new sources to canonical ids',ok.sources[0].id==='r1-e0-0'&&ok.report.access[0].sourceId==='r1-e0-0'&&ok.diagnosis.sourceIds[0]==='r1-e0-0');
check('text trims surrounding whitespace',parse(edit(x=>{x.phases[0].summary='  검토 내용  '})).report.phases[0].summary==='검토 내용');
check('text accepts exactly its max length',parse(edit(x=>{x.phases[0].summary='가'.repeat(1500)})).report.phases[0].summary.length===1500);
deepFails('text length is checked before trimming',x=>{x.phases[0].summary=' '+'가'.repeat(1500)},400,'단계 요약 입력을 확인해 주세요.');
deepFails('blank text is rejected',x=>{x.phases[0].summary='   '},400,'단계 요약 입력을 확인해 주세요.');
deepFails('non-string text is rejected',x=>{x.phases[0].summary=5},400,'단계 요약 입력을 확인해 주세요.');
deepFails('text falls back to its default label',x=>{x.customerSignals=[{sourceId:'s1',kind:'barrier',observation:'',implication:'i'}]},400,'조사 내용 입력을 확인해 주세요.');
for(const [kind,value] of [['string','abc'],['null',null],['object',{}],['missing',undefined]])deepFails('non-array list is rejected: '+kind,x=>{x.sources=value},422,'조사 출처 형식을 확인하세요.');
deepFails('list over its max is rejected',x=>{x.sources=Array.from({length:41},()=>x.sources[0])},422,'조사 출처 형식을 확인하세요.');
deepFails('unresolved list over 12 is rejected',x=>{x.review.unresolved=Array(13).fill('미확인')},422,'미해결 질문 형식을 확인하세요.');
deepFails('followups over plan maximum are rejected',x=>{x.review.followups=Array(3).fill({question:'q',finding:'f',sourceIds:['s1']})},422,'보완 조사 형식을 확인하세요.');
for(const [kind,value] of [['null',null],['string','abc'],['array',[]]])deepFails('non-object review is read as empty: '+kind,x=>{x.review=value},422,'핵심 주장 검토 형식을 확인하세요.');
for(const [kind,value] of [['null',null],['string','abc']])deepFails('non-object diagnosis has no evidence: '+kind,x=>{x.diagnosis=value},422,'근거 목록 형식을 확인하세요.');
for(const [kind,value] of [['unknown','crawler'],['null',null],['array',['browser']]])deepFails('choice rejects values outside the list: '+kind,x=>{x.access[0].method=value},422,'접근 방식 값이 올바르지 않습니다.');
for(const [kind,value] of [['numeric string','100'],['negative',-1],['over limit',1e12+1],['infinity',Infinity],['NaN',NaN],['missing',undefined]])deepFails('number rejects '+kind,withCase({views:value}),422,'views 수치를 확인하세요.');
const counted=parse(edit(withCase({views:1e12}))).report.cases[0];
check('number keeps limit value, null and zero as given',counted.views===1e12&&counted.likes===null&&counted.comments===0&&counted.shares===null&&counted.durationSeconds===20);
deepFails('non-nullable number rejects null',withCase({viewing:'partial',viewedRanges:[{start:null,end:5}],timeline:[{second:1,observation:'o'}]}),422,'시작 초 수치를 확인하세요.');
deepFails('non-nullable number rejects numeric string',withCase({viewing:'partial',viewedRanges:[{start:'0',end:5}],timeline:[{second:1,observation:'o'}]}),422,'시작 초 수치를 확인하세요.');
deepFails('reference rejects non-string ids',x=>{x.access[0].sourceId=5},422,'실제 조사 자료와 일치하지 않는 근거입니다.');
deepFails('reference rejects unknown ids',x=>{x.access[0].sourceId='missing'},422,'실제 조사 자료와 일치하지 않는 근거입니다.');
check('references dedupe and map to canonical ids',JSON.stringify(parse(edit(x=>{x.competitors=[{name:'경쟁',sourceIds:['s1','s1'],difference:'d'}]})).report.competitors[0].sourceIds)==='["r1-e0-0"]');
const unresolved=parse(edit(x=>{x.review.unresolved=['  추가 자료 필요  ']})).report;
check('unresolved items are trimmed and surface as quality issues',unresolved.review.unresolved[0]==='추가 자료 필요'&&unresolved.quality.issues.includes('추가 자료 필요'));
// null·원시값 원소는 속성이 없는 값으로 읽혀 각 항목의 첫 검사에서 막힌다.
deepFails('null source element',x=>{x.sources=[null]},400,'자료 번호 입력을 확인해 주세요.');
deepFails('null phase element',x=>{x.phases[0]=null},422,'조사 단계 기록이 누락되거나 순서가 다릅니다.');
deepFails('null access element',x=>{x.access=[null]},422,'실제 조사 자료와 일치하지 않는 근거입니다.');
deepFails('null case element',x=>{x.cases=[null]},400,'콘텐츠 번호 입력을 확인해 주세요.');
deepFails('primitive case element',x=>{x.cases=['문자열']},400,'콘텐츠 번호 입력을 확인해 주세요.');
deepFails('null viewed range element',withCase({viewing:'partial',viewedRanges:[null],timeline:[]}),422,'시작 초 수치를 확인하세요.');
deepFails('null timeline element',withCase({viewing:'partial',viewedRanges:[{start:0,end:5}],timeline:[null]}),422,'장면 시점 수치를 확인하세요.');
deepFails('null customer signal element',x=>{x.customerSignals=[null]},422,'실제 조사 자료와 일치하지 않는 근거입니다.');
deepFails('null competitor element',x=>{x.competitors=[null]},400,'경쟁사 입력을 확인해 주세요.');
deepFails('null claim element',x=>{x.review.claims=[null]},400,'조사 내용 입력을 확인해 주세요.');
deepFails('null followup element',x=>{x.review.followups=[null]},400,'조사 내용 입력을 확인해 주세요.');
deepFails('null unresolved element',x=>{x.review.unresolved=[null]},400,'조사 내용 입력을 확인해 주세요.');
// 알려진 결함: 실험 과제 원소가 null이면 422가 아니라 TypeError로 실패하고, 그 내부 예외 문구가 조사 기록 오류로 저장·표시된다.
// PR 0은 동작을 바꾸지 않는다. PR 4(security-ops-11)에서 422로 바꾸고 이 검사도 함께 바꾼다.
typeError('알려진 결함(security-ops-11, PR 4에서 422로 전환): null opportunity element',()=>parse(edit(x=>{x.diagnosis.opportunities=[null]})));

// HERMES 도구 목록 (inspectResearchAccess)
const cfg={provider:'hermes',key:'k',model:'m',endpoint:'https://hermes.example.com'};
toolsets=[{name:'aside',enabled:true,configured:true,tools:['aside_browser',5,'bad tool!']},{name:'off',enabled:false,configured:true,tools:['browser_x']}];
let access=await deep.inspectResearchAccess(cfg);
check('toolsets keep only enabled, configured, well-formed names',JSON.stringify(access.tools)==='["aside","aside_browser"]'&&access.aside==='advertised'&&access.browser==='advertised');
toolsets=[{name:7,enabled:true,configured:true,tools:'browser'}];access=await deep.inspectResearchAccess(cfg);
check('non-string names and non-array tools are dropped',access.tools.length===0&&access.aside==='unverified'&&!access.notes.some(n=>n.startsWith('도구 목록을 읽지 못했습니다')));
toolsets=[null,{name:'aside',enabled:true,configured:true,tools:['aside_browser']}];access=await deep.inspectResearchAccess(cfg);
check('a null toolset entry abandons the whole list as before',access.tools.length===0&&access.notes.some(n=>n.startsWith('도구 목록을 읽지 못했습니다')));
toolsets='aside';access=await deep.inspectResearchAccess(cfg);
check('non-array toolset data is reported as unreadable',access.tools.length===0&&access.notes.some(n=>n.startsWith('도구 목록을 읽지 못했습니다')));

// 점포 진단 응답 (parseStoreReport)
const store={id:'st1',brandId:'b1',version:3},sources=[{id:'s1',status:'candidate'},{id:'s2',status:'excluded'}];
const storeBase=()=>({summary:' 요약 ',customer:'고객',bottleneck:'장벽',measurementPlan:'측정',limitations:'한계',questions:['  질문  '],sourceIds:['s1','s1'],actions:[{channel:'naver_place',priority:'first',action:'가격 갱신',reason:'이유',sourceIds:['s1']}],proposals:[{title:'실험',channel:'daangn',hypothesis:'가설',control:'기존',treatment:'변경',measurement:'측정',sourceIds:['s1']}]});
const storeEdit=change=>{const x=storeBase();change(x);return x};
const report=x=>stores.parseStoreReport(x,store,sources,'rep1');
const storeFails=(name,change,status,message)=>fails(name,()=>report(storeEdit(change)),status,message);
const parsed=report(storeBase());
check('store report trims text and dedupes evidence',parsed.summary==='요약'&&JSON.stringify(parsed.questions)==='["질문"]'&&JSON.stringify(parsed.sourceIds)==='["s1"]'&&parsed.status==='candidate'&&parsed.storeVersion===3&&JSON.stringify(parsed.actions[0].sourceIds)==='["s1"]');
check('store text accepts exactly 2000 characters',report(storeEdit(x=>{x.summary='가'.repeat(2000)})).summary.length===2000);
for(const [name,change] of [['string list',x=>{x.questions='abc'}],['list over max',x=>{x.questions=Array(9).fill('q')}],['null evidence',x=>{x.sourceIds=null}],['object actions',x=>{x.actions={}}],['too many proposals',x=>{x.proposals=[...x.proposals,...x.proposals,...x.proposals]}]])storeFails('store list rejects '+name,change,422,'점포 진단 목록 형식을 확인하세요.');
storeFails('store evidence rejects non-string ids',x=>{x.sourceIds=[5]},422,'점포 진단에 실제 자료와 일치하지 않는 근거가 있습니다.');
storeFails('store evidence rejects excluded sources',x=>{x.sourceIds=['s2']},422,'점포 진단에 실제 자료와 일치하지 않는 근거가 있습니다.');
storeFails('store actions need linked evidence',x=>{x.actions[0].sourceIds=[]},422,'실행 제안에 전체 진단과 연결된 근거가 필요합니다.');
storeFails('store text rejects blanks',x=>{x.summary='   '},400,'진단 요약 입력을 확인해 주세요.');
storeFails('store text rejects over 2000',x=>{x.summary='가'.repeat(2001)},400,'진단 요약 입력을 확인해 주세요.');
storeFails('store proposal title keeps its 150 limit',x=>{x.proposals[0].title='가'.repeat(151)},400,'실험 이름 입력을 확인해 주세요.');
storeFails('null question element',x=>{x.questions=[null]},400,'질문 입력을 확인해 주세요.');
// 알려진 결함: 실행 제안·실험 제안 원소가 null이면 TypeError로 실패한다(위 실험 과제와 같은 결함, PR 4에서 400/422로 전환).
typeError('알려진 결함(security-ops-11, PR 4에서 전환): null action element',()=>report(storeEdit(x=>{x.actions=[null]})));
typeError('알려진 결함(security-ops-11, PR 4에서 전환): null proposal element',()=>report(storeEdit(x=>{x.proposals=[null]})));

// 점포 입력 (channelInput·measurementInput·experimentInput)
const firstCheck=channelCatalog.find(c=>c.key==='naver_place').checks[0];
fails('string checks are read by index and rejected',()=>stores.channelInput({key:'naver_place',checks:'abc'},'st1'),400,firstCheck+'을 선택하세요.');
for(const [kind,value] of [['empty string',''],['null',null],['missing',undefined]])check('checks default to unknown: '+kind,Object.values(stores.channelInput({key:'naver_place',checks:value},'st1').checks).every(v=>v==='unknown'));
const listed=stores.channelInput({key:'naver_place',checks:['todo']},'st1').checks;
check('array checks map by position',listed['0']==='todo'&&listed['1']==='unknown');
typeError('missing channel body fails as before',()=>stores.channelInput(undefined,'st1'));
const experiment={id:'e1',storeId:'st1',startDate:'2026-08-01',endDate:'2026-08-31'};
const measure=values=>stores.measurementInput({periodStart:'2026-08-01',periodEnd:'2026-08-10',source:'POS',definition:'KST 결제 기준',method:'manual',values},experiment);
const measured=measure({orders:3}).values;
check('measurement keeps given values and fills the rest with null',measured.orders===3&&measured.visits===null&&Object.keys(measured).length===Object.keys(storeMetricFields).length);
for(const [kind,value] of [['string','abc'],['array',['x']],['null',null],['empty field',{orders:''}]])fails('measurement without readable values: '+kind,()=>measure(value),400,'확인한 수치를 하나 이상 입력하세요.');
fails('measurement rejects numeric strings',()=>measure({orders:'3'}),400,'결제·주문 완료은 0 이상의 숫자로 입력해 주세요.');
fails('experiment body without fields asks for a title',()=>stores.experimentInput('abc'),400,'실험 이름 입력을 확인해 주세요.');
const planned=stores.experimentInput({title:' 실험 ',channel:'daangn',hypothesis:'가설',primaryMetric:'orders',target:'',budget:10000});
check('experiment input trims text and keeps nullable numbers',planned.title==='실험'&&planned.target===null&&planned.budget===10000&&planned.offer==='');

// 공용 좁히기 헬퍼 (lib/validate.ts)
const {obj,boundedArray}=await load('lib/validate.ts');
const record={a:1},array=[1];
check('obj reads null and undefined as empty',Object.keys(obj(null)).length===0&&Object.keys(obj(undefined)).length===0);
check('obj returns objects and arrays as they are',obj(record)===record&&obj(array)===array);
check('obj reads primitives like property access does',obj('ab')[0]==='a'&&obj('ab').id===undefined&&obj(5).id===undefined&&obj(true).id===undefined);
check('obj spreads like the original value',JSON.stringify({...obj('ab')})==='{"0":"a","1":"b"}'&&JSON.stringify({...obj(null)})==='{}');
fails('boundedArray rejects non-arrays with the given message',()=>boundedArray('abc',3,'목록 형식'),422,'목록 형식');
fails('boundedArray rejects arrays over max',()=>boundedArray([1,2],1,'목록 형식'),422,'목록 형식');
check('boundedArray returns the same array within max',boundedArray(array,1,'목록 형식')===array);

console.log(JSON.stringify({passed}));
