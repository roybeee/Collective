// lib/context-policies.ts(B5 맥락 정책 후보)의 순수 함수 회귀 테스트. 모델·네트워크 호출 없음(합성 fixture만, passed · mocked).
// P0는 캡처 스냅샷(tests/fixtures/role-submission-*.json)의 실제 조립 입력과 바이트 동일해야 하고, 나머지 정책은 omitted 문자 합이 입력 길이 차이와 정확히 같아야 한다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
async function load(path){const m=moduleFor(path);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
// vm 컨텍스트의 배열·객체는 프로토타입이 달라 deepStrictEqual이 실패하므로 JSON으로 옮겨 비교한다.
const plain=v=>JSON.parse(JSON.stringify(v)),policies=await load('lib/context-policies.ts'),{SECTION_BUDGET}=policies;
const CONTEXT_POLICIES=plain(policies.CONTEXT_POLICIES),ROLE_ARCHIVE_CATEGORIES=plain(policies.ROLE_ARCHIVE_CATEGORIES);
const applyPolicy=(...a)=>plain(policies.applyPolicy(...a)),sectionBudget=(...a)=>plain(policies.sectionBudget(...a)),splitSections=(...a)=>plain(policies.splitSections(...a));
const {buildRoleInput}=await load('lib/role-instruction.ts'),role=await load('lib/role-output.ts'),upstreamContext=(...a)=>plain(role.upstreamContext(...a)),{artifactRef,discussionRef}=await load('lib/meetings.ts'),agency=await load('lib/agency.ts'),{aiBudget}=agency,roles=plain(agency.roles);
const contract=id=>plain(role.roleOutputContract(id)),HANDOFF=plain(policies.HANDOFF_SECTIONS??{}),handoffOf=id=>HANDOFF[id]?contract(id).sections.find(s=>s.id===HANDOFF[id]).title:null;
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};

check('pure module imports only relative paths',()=>assert.ok(![...readFileSync('lib/context-policies.ts','utf8').matchAll(/from\s+'([^']+)'/g)].some(x=>!x[1].startsWith('./'))));
const files=readdirSync('tests/fixtures').filter(f=>/^role-submission-[0-9a-f]{7}\.json$/.test(f));
const fixture=JSON.parse(readFileSync('tests/fixtures/'+files[0],'utf8'));
const byName=name=>fixture.cases.find(c=>c.name===name);
const ids=['P0','P1','P2','P3','P4'];
check('five candidate policies with labels',()=>{assert.deepEqual(CONTEXT_POLICIES.map(p=>p.id),ids);assert.ok(CONTEXT_POLICIES.every(p=>p.label.trim()&&p.description.trim()))});
check('unknown policy is rejected',()=>assert.throws(()=>applyPolicy('P9',{kind:'role',input:'{}'}),/Unknown context policy/));

// P0: 현행. 실제 조립 함수(buildRoleInput) 출력과 캡처 스냅샷 본문 모두와 바이트 동일.
for(const c of fixture.cases)check(`P0 is byte-identical for ${c.name}`,()=>{
 const built=buildRoleInput(c.context),r=applyPolicy('P0',{kind:'role',role:c.role,input:built});
 assert.equal(r.input,c.submission.input);assert.equal(r.input,built);assert.deepEqual(r.omitted,[]);assert.equal(r.applicable,true);
});

// 회의 단계 입력: lib/meeting-execution.ts context()와 같은 키·순서로 만든 합성 입력(그 함수는 export되지 않는다). 키가 늘거나 빠지거나 순서가 어긋나면 아래 드리프트 검사가 잡는다.
const base=byName('quality').context,roleInput=JSON.parse(byName('quality').submission.input);
const meetingKeys=['skillVersion','channelPractice','agenda','role','phase','allowedRespondsTo','correction','brand','evidence','brandArchive','campaign','trialLearning','recordedMetrics','previousMeeting','originalArtifacts','discussion','synthesis','completedRevisions','task','candidateArtifacts','invalidatedRoles'];
// context() 반환 객체 리터럴의 최상위 키(조건부 스프레드 안의 키 포함)를 TypeScript 구문 트리로 읽는다.
function contextKeys(){
 const src=ts.createSourceFile('meeting-execution.ts',readFileSync('lib/meeting-execution.ts','utf8'),ts.ScriptTarget.ES2022,true);
 const find=(n,pred)=>pred(n)?n:ts.forEachChild(n,c=>find(c,pred));
 const fn=find(src,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='context'),ret=find(fn.body,n=>ts.isReturnStatement(n));
 const unwrap=e=>ts.isParenthesizedExpression(e)?unwrap(e.expression):e;
 const keys=e=>{e=unwrap(e);return ts.isObjectLiteralExpression(e)?e.properties.flatMap(p=>ts.isSpreadAssignment(p)?keys(p.expression):[p.name.text]):ts.isConditionalExpression(e)?[...keys(e.whenTrue),...keys(e.whenFalse)]:[]};
 return keys(ret.expression);
}
check('synthetic meeting input has exactly the meeting-execution context() keys in order',()=>assert.deepEqual(contextKeys(),meetingKeys));
const revision={role:'content',title:'콘텐츠 개선본',content:'## 게시 카피 3종과 용도·CTA\n\n개선한 합성 카피 초안입니다. 자료 필요: 가격 확인.\n\n## 수정 요청 반영 위치\n\n첫 장면 반론을 반영했습니다.',changes:'첫 장면 반론 반영'};
const modelArtifact=a=>({ref:artifactRef(a),...a});
// 발언·합의·이전 회의는 실제 모양(lib/meetings.ts Contribution·Synthesis, lib/meeting-execution.ts previousMeeting)의 합성 값이다.
const contribution=id=>({position:`합성 ${id} 입장입니다.`,evidence:'합성 근거입니다.',challenge:'합성 반론입니다.',proposal:'합성 제안입니다.',respondsTo:[]});
const synthesisOutput={decisions:'합성 결정입니다.',disagreements:'없음',questions:'없음',tasks:[{role:'content',instruction:'카피 개선',reason:'회의 근거',acceptance:'게시 카피 절에서 대조안 포함'}]};
const previousMeeting={id:'m0',agenda:'이전 합성 안건',decisions:synthesisOutput,quality:{verdict:'revise',summary:'합성 요약',findings:'합성 발견'},discussion:roles.slice(0,2).map(r=>({id:`m0:discussion:${r.id}`,role:r.id,output:contribution(r.id)}))};
function meetingInput(phase,role,{task}={}){
 const arts=base.previous,revised=phase==='quality'?[revision]:[];
 const first=Math.min(...revised.map(r=>roles.findIndex(x=>x.id===r.role)));
 const candidates=[...arts.filter(a=>roles.findIndex(r=>r.id===a.role)<first),...revised.map(r=>({role:r.role,...r}))];
 const spoken=phase==='discussion'?roles.slice(0,roles.findIndex(r=>r.id===role)):roles;
 return JSON.stringify({skillVersion:roleInput.skillVersion,channelPractice:roleInput.channelPractice,agenda:'합성 안건: 약점을 검토한다.',role,phase,allowedRespondsTo:[],correction:undefined,brand:roleInput.brand,evidence:roleInput.evidence,brandArchive:roleInput.brandArchive,campaign:{...base.campaign,...aiBudget(base.campaign)},trialLearning:[],recordedMetrics:[],previousMeeting,
  originalArtifacts:arts.map(a=>({ref:artifactRef(a),...a,content:a.content.slice(0,8000),excerpt:a.content.length>8000})),discussion:spoken.map(r=>({ref:discussionRef(r.id),role:r.id,...contribution(r.id)})),synthesis:['revision','quality'].includes(phase)?synthesisOutput:undefined,completedRevisions:revised.map(r=>({role:r.role,...r})),task,
  ...(phase==='quality'?{candidateArtifacts:candidates.map(modelArtifact),invalidatedRoles:['growth','data']}:{})});
}
const meetings={discussion:meetingInput('discussion','insight'),synthesis:meetingInput('synthesis','cmo'),revision:meetingInput('revision','content',{task:{role:'content',instruction:'카피 개선',reason:'회의 근거',acceptance:'대조안 포함'}}),quality:meetingInput('quality','quality')};
// 값이 undefined인 키(correction, 단계에 따라 synthesis·task, 품질 단계가 아니면 candidateArtifacts·invalidatedRoles)는 JSON에서 빠진다. 남은 키는 context() 순서 그대로다.
check('synthetic meeting inputs keep the context() key order per stage',()=>{for(const input of Object.values(meetings)){const keys=Object.keys(JSON.parse(input));assert.deepEqual(keys,meetingKeys.filter(k=>keys.includes(k)));assert.ok(meetingKeys.filter(k=>!keys.includes(k)).every(k=>['correction','synthesis','task','candidateArtifacts','invalidatedRoles'].includes(k)))}});

// 모든 정책: 결과는 JSON이고, omitted 문자 합이 입력 길이 차이와 정확히 같다(생략 목록이 실제 변경 전부를 설명한다).
const samples=[...fixture.cases.map(c=>({name:c.name,s:{kind:'role',role:c.role,input:c.submission.input}})),...Object.entries(meetings).map(([stage,input])=>({name:'meeting-'+stage,s:{kind:'meeting',role:JSON.parse(input).role,stage,input}}))];
const pathShape=/^[A-Za-z]+(?:\[\d+\])?(?:\.[A-Za-z]+(?:\[\d+\])?)*$/;
for(const {name,s} of samples)for(const id of ids)check(`${id} omitted accounts for every removed char in ${name}`,()=>{
 const r=applyPolicy(id,s);JSON.parse(r.input);
 assert.equal(r.omitted.reduce((n,o)=>n+o.chars,0),s.input.length-r.input.length);
 assert.ok(r.omitted.every(o=>pathShape.test(o.path)&&o.chars>0&&o.reason.trim()&&!o.reason.includes('합성')),JSON.stringify(r.omitted.slice(0,3)));
 if(!r.omitted.length)assert.equal(r.input,s.input);
});

// 비JSON·비정규 JSON: P0만 적용하고 나머지는 해당 없음(입력 그대로).
const text={kind:'role',role:'cmo',input:'평문 입력입니다. JSON이 아닙니다.'},pretty={kind:'role',role:'cmo',input:JSON.stringify(JSON.parse(byName('cmo').submission.input),null,1)};
check('P0 applies to non-JSON input unchanged',()=>assert.deepEqual(applyPolicy('P0',text),{input:text.input,omitted:[],applicable:true}));
for(const id of ids.slice(1)){
 check(`${id} is not applicable to non-JSON input`,()=>assert.deepEqual(applyPolicy(id,text),{input:text.input,omitted:[],applicable:false}));
 check(`${id} is not applicable to non-canonical JSON`,()=>assert.deepEqual(applyPolicy(id,pretty),{input:pretty.input,omitted:[],applicable:false}));
 check(`${id} is not applicable to a JSON array`,()=>assert.equal(applyPolicy(id,{kind:'role',role:'cmo',input:'[1,2]'}).applicable,false));
}

// P1: campaign 메타(draftMeta·status·createdAt·updatedAt 등). 사실·출처·작업물은 그대로.
const prop=(k,v)=>JSON.stringify(k).length+1+JSON.stringify(v).length+1;
check('P1 removes campaign status and timestamps from a role input',()=>{
 const s={kind:'role',role:'cmo',input:byName('cmo').submission.input},x=JSON.parse(s.input),r=applyPolicy('P1',s),y=JSON.parse(r.input);
 assert.deepEqual(r.omitted.map(o=>o.path),['campaign.status','campaign.createdAt','campaign.updatedAt']);
 assert.deepEqual(r.omitted.map(o=>o.chars),['status','createdAt','updatedAt'].map(k=>prop(k,x.campaign[k])));
 assert.deepEqual(y.campaign,Object.fromEntries(Object.entries(x.campaign).filter(([k])=>!['status','createdAt','updatedAt'].includes(k))));
 assert.deepEqual({...y,campaign:null},{...x,campaign:null});
});
const draftMeta={id:'draft-1',generatedAt:'2026-01-01T00:00:00.000Z',model:'synthetic',values:{goal:'합성 목표 사본'},questions:[],assumptions:['합성 가정'],contextUsed:['brand']};
check('P1 removes draftMeta assembled by buildRoleInput',()=>{
 const c=byName('cmo').context,campaign={...c.campaign};const withMeta=Object.fromEntries([...Object.entries(campaign).slice(0,3),['draftMeta',draftMeta],...Object.entries(campaign).slice(3)]);
 const input=buildRoleInput({...c,campaign:withMeta}),r=applyPolicy('P1',{kind:'role',role:'cmo',input});
 assert.equal(r.omitted[0].path,'campaign.draftMeta');assert.equal(r.omitted[0].chars,prop('draftMeta',draftMeta));
 assert.equal(JSON.parse(r.input).campaign.draftMeta,undefined);
});
check('P1 removes meeting campaign id and artifact metadata only',()=>{
 const r=applyPolicy('P1',{kind:'meeting',stage:'discussion',input:meetings.discussion}),y=JSON.parse(r.input),x=JSON.parse(meetings.discussion);
 assert.deepEqual(r.omitted.filter(o=>o.path.startsWith('campaign.')).map(o=>o.path),['campaign.status','campaign.createdAt','campaign.updatedAt','campaign.id']);
 const meta=['campaignId','status','origin','createdAt','factRefs','outputContractVersion','skillVersion'];
 assert.deepEqual(r.omitted.filter(o=>o.path.startsWith('originalArtifacts[0].')).map(o=>o.path),meta.map(k=>'originalArtifacts[0].'+k));
 assert.equal(r.omitted.filter(o=>o.path.startsWith('originalArtifacts[')).length,x.originalArtifacts.length*meta.length);
 assert.ok(y.originalArtifacts.every((a,i)=>a.content===x.originalArtifacts[i].content));
 assert.deepEqual(Object.keys(y.originalArtifacts[0]),['ref','id','campaignVersion','role','title','content','version','excerpt']);
});

// P2: 섹션별 예산. 앞부분 절단(upstreamContext 6,000자)은 뒤 섹션을 잃고, 섹션 예산은 모든 섹션 제목을 남긴다.
const long=['## 목표와 병목','## 작업표','## 예산과 미확정 목록','## 추가 자료 요청'].map((h,i)=>h+'\n\n'+'합성 본문 문장입니다. '.repeat(200+i*10)).join('\n\n');
const titles=text=>splitSections(text).map(s=>s.title).filter(Boolean);
check('splitSections round-trips the content',()=>{assert.equal(splitSections(long).map(s=>s.text).join(''),long);assert.deepEqual(titles(long),['목표와 병목','작업표','예산과 미확정 목록','추가 자료 요청'])});
check('splitSections splits at the top heading level only',()=>{const t='머리말\n## A\n### a1\n본문\n## B\n본문';assert.deepEqual(splitSections(t).map(s=>s.title),['','A','B']);assert.equal(splitSections(t).map(s=>s.text).join(''),t)});
check('front truncation loses later sections that the section budget keeps',()=>{
 const cut=upstreamContext([{id:'a',campaignId:'c',role:'cmo',title:'합성',content:long,status:'review',version:1,origin:'ai',createdAt:'2026-01-01T00:00:00.000Z'}],'insight',1)[0].content,b=sectionBudget(long);
 assert.ok(titles(cut).length<4);assert.deepEqual(titles(b.content),titles(long));assert.equal(b.cut,4);
 assert.ok(splitSections(b.content).every(s=>s.text.length<=SECTION_BUDGET+4));assert.ok(b.content.length<long.length);
});
check('sectionBudget leaves short content unchanged',()=>assert.deepEqual(sectionBudget('## 짧은 섹션\n\n본문'),{content:'## 짧은 섹션\n\n본문',cut:0}));
check('P2 budgets truncated prior artifacts and keeps every section title',()=>{
 const s={kind:'role',role:'quality',input:byName('quality-truncated').submission.input},r=applyPolicy('P2',s),x=JSON.parse(s.input),y=JSON.parse(r.input);
 assert.deepEqual(r.omitted.map(o=>o.path),['previous[0].content','previous[1].content']);
 assert.ok(r.omitted.every(o=>o.reason.includes(String(SECTION_BUDGET))));
 assert.deepEqual(y.previous.map(p=>titles(p.content)),x.previous.map(p=>titles(p.content)));
 assert.ok(y.previous.slice(0,2).every(p=>p.excerpt===true&&p.content.length<=SECTION_BUDGET+4));assert.deepEqual(y.previous.slice(2),x.previous.slice(2));
});
check('P2 changes nothing when every section fits the budget',()=>{const s={kind:'role',role:'quality',input:byName('quality').submission.input};assert.deepEqual(applyPolicy('P2',s),{input:s.input,omitted:[],applicable:true})});
// 문서 제목 H1, 본문 속 H1, 코드 블록 속 '#' 줄이 역할 계약 섹션(`## `, lib/role-output.ts parseRoleOutput)을 한 섹션으로 뭉치지 않는다.
const titled='# 개선본 제목\n\n'+long;
check('a leading H1 title does not merge the contract sections',()=>{
 assert.deepEqual(titles(titled),['개선본 제목','목표와 병목','작업표','예산과 미확정 목록','추가 자료 요청']);assert.equal(splitSections(titled).map(s=>s.text).join(''),titled);
 const b=sectionBudget(titled),after=splitSections(b.content);assert.deepEqual(titles(b.content),titles(titled));assert.equal(b.cut,4);
 for(const t of ['목표와 병목','작업표','예산과 미확정 목록','추가 자료 요청'])assert.ok(after.find(s=>s.title===t).text.includes('합성 본문'),t);
});
const midH1=long.replace('## 작업표\n\n','## 작업표\n\n# 본문 속 제목\n\n');
check('an H1 inside a section body keeps every contract section',()=>{assert.deepEqual(titles(midH1),['목표와 병목','작업표','본문 속 제목','예산과 미확정 목록','추가 자료 요청']);assert.deepEqual(titles(sectionBudget(midH1).content),titles(midH1))});
const fenced='## 지표\n\n```sql\n# 전환율 계산\nSELECT 1;\n```\n\n## 판단표\n\n본문\n\n~~~\n# 주석\n~~~\n\n## 다음 실험 연결\n\n본문';
check('heading lines inside code blocks are not section titles',()=>{assert.deepEqual(titles(fenced),['지표','판단표','다음 실험 연결']);assert.equal(splitSections(fenced).map(s=>s.text).join(''),fenced)});
check('an inline triple-backtick span does not open a code block',()=>assert.deepEqual(titles('## 지표\n\n```산식``` 참고\n\n## 판단표\n\n본문'),['지표','판단표']));
check('single headings at every level each become a section',()=>assert.deepEqual(titles('# 문서\n\n## 하나뿐인 절\n\n본문'),['문서','하나뿐인 절']));
// P2 대상은 지금 앞부분 절단을 받는 목록(역할 previous, 회의 originalArtifacts)뿐이다. 품질 검수 대상(candidateArtifacts)과 개선본(completedRevisions)은 줄이지 않는다.
check('P2 leaves quality review candidates and completed revisions whole',()=>{
 const x=JSON.parse(meetings.quality),big=list=>list.map(a=>({...a,content:long})),longer={...x,originalArtifacts:big(x.originalArtifacts),candidateArtifacts:big(x.candidateArtifacts),completedRevisions:big(x.completedRevisions)};
 const input=JSON.stringify(longer),r=applyPolicy('P2',{kind:'meeting',role:'quality',stage:'quality',input}),y=JSON.parse(r.input);
 assert.deepEqual(y.candidateArtifacts,longer.candidateArtifacts);assert.deepEqual(y.completedRevisions,longer.completedRevisions);
 assert.deepEqual(r.omitted.map(o=>o.path),x.originalArtifacts.map((_,i)=>`originalArtifacts[${i}].content`));
});

// P3: 회의 단계별 축소(의견 교환·품질 재검토만). 합의·개선 단계와 역할 제출에는 해당 없음.
// 인계 섹션은 역할 계약(lib/role-output.ts roleOutputContract) 섹션 id로 고정한다. 계약 제목에 인계 낱말이 있는 섹션이 그 역할의 인계 섹션이다.
// 품질 작업물은 계약 렌더링을 거치지 않는 자유 형식이라(parseRoleOutput) 인계 섹션이 없다.
const HANDOFF_WORDS=/인계|요청|자료\s?필요|미확정|다음 실험/;
check('P3 handoff sections are the contract sections that hand work over',()=>{
 const expected=Object.fromEntries(roles.map(r=>{const hits=contract(r.id).sections.filter(s=>HANDOFF_WORDS.test(s.title));assert.ok(r.id==='quality'||hits.length<=1,r.id);return [r.id,r.id==='quality'||!hits.length?null:hits[0].id]}));
 assert.deepEqual(HANDOFF,expected);assert.deepEqual(roles.map(r=>r.id).filter(id=>HANDOFF[id]),['cmo','insight','data']);
});
check('P3 digest keeps the summary and the named handoff section only',()=>{
 const t=['## 요약','## 작업표','## 추가 자료 요청','## 마지막 조건'].map(h=>h+'\n\n'+h.slice(3)+' 본문입니다.').join('\n\n'),s=title=>{const d=plain(policies.digestSections(t,title));return {cut:d.cut,body:splitSections(d.content).map(x=>x.text.includes('본문'))}};
 assert.deepEqual(splitSections(plain(policies.digestSections(t,'추가 자료 요청')).content).map(x=>x.title),['요약','작업표','추가 자료 요청','마지막 조건']);
 assert.deepEqual(s('추가 자료 요청'),{cut:2,body:[true,false,true,false]});assert.deepEqual(s(null),{cut:3,body:[true,false,false,false]});
});
check('P3 is not applicable to role submissions',()=>assert.equal(applyPolicy('P3',{kind:'role',role:'cmo',input:byName('cmo').submission.input}).applicable,false));
check('P3 is not applicable to an unknown meeting stage',()=>assert.equal(applyPolicy('P3',{kind:'meeting',stage:'lunch',input:meetings.discussion}).applicable,false));
for(const stage of ['synthesis','revision'])check(`P3 is not applicable to the ${stage} stage`,()=>assert.deepEqual(applyPolicy('P3',{kind:'meeting',stage,input:meetings[stage]}),{input:meetings[stage],omitted:[],applicable:false}));
check('P3 falls back to the input phase when the stage is missing',()=>assert.deepEqual(applyPolicy('P3',{kind:'meeting',input:meetings.discussion}),applyPolicy('P3',{kind:'meeting',stage:'discussion',input:meetings.discussion})));
check('P3 discussion keeps the summary and the contract handoff section with every title',()=>{
 const r=applyPolicy('P3',{kind:'meeting',stage:'discussion',input:meetings.discussion}),x=JSON.parse(meetings.discussion),y=JSON.parse(r.input);
 assert.deepEqual(r.omitted.map(o=>o.path),x.originalArtifacts.map((_,i)=>`originalArtifacts[${i}].content`));
 assert.deepEqual(r.omitted.map(o=>Number(/섹션 (\d+)개/.exec(o.reason)[1])),x.originalArtifacts.map(a=>contract(a.role).sections.length-1-(handoffOf(a.role)?1:0)));
 assert.deepEqual(r.omitted.map(o=>/, 인계 ([^)]+)\)$/.exec(o.reason)[1]),x.originalArtifacts.map(a=>HANDOFF[a.role]??'없음'));
 y.originalArtifacts.forEach((a,i)=>{const role=x.originalArtifacts[i].role,before=splitSections(x.originalArtifacts[i].content),after=splitSections(a.content);
  assert.deepEqual(after.map(s=>s.title),before.map(s=>s.title));assert.deepEqual(after.map((s,j)=>s.text===before[j].text),after.map((s,j)=>j===0||s.title===handoffOf(role)));assert.equal(a.excerpt,true)});
 assert.deepEqual({...y,originalArtifacts:null},{...x,originalArtifacts:null});
});
const insightDoc='# 인사이트 문서\n\n'+contract('insight').sections.map(s=>`## ${s.title}\n\n`+'합성 인사이트 문장입니다. '.repeat(150)).join('\n\n');
check('P3 keeps the insight handoff section under a document H1',()=>{
 const x=JSON.parse(meetings.discussion),i=x.originalArtifacts.findIndex(a=>a.role==='insight'),input=JSON.stringify({...x,originalArtifacts:x.originalArtifacts.map((a,j)=>j===i?{...a,content:insightDoc}:a)});
 const r=applyPolicy('P3',{kind:'meeting',stage:'discussion',input}),after=splitSections(JSON.parse(r.input).originalArtifacts[i].content),body=t=>after.find(s=>s.title===t).text.includes('합성 인사이트');
 assert.deepEqual(after.map(s=>s.title),splitSections(insightDoc).map(s=>s.title));
 assert.deepEqual(contract('insight').sections.map(s=>body(s.title)),[true,false,true]);assert.match(r.omitted[i].reason,/인계 output_3\)/);
});
check('P3 quality sends candidates whole and originals as id, version and length',()=>{
 const r=applyPolicy('P3',{kind:'meeting',role:'quality',stage:'quality',input:meetings.quality}),x=JSON.parse(meetings.quality),y=JSON.parse(r.input);
 assert.deepEqual(y.candidateArtifacts,x.candidateArtifacts);
 assert.deepEqual(y.originalArtifacts,x.originalArtifacts.map(a=>({ref:a.ref,id:a.id,role:a.role,version:a.version,length:a.content.length})));
 assert.deepEqual(y.completedRevisions,[{role:'content',title:revision.title,changes:revision.changes}]);
 assert.deepEqual(r.omitted.map(o=>o.path),[...x.originalArtifacts.map((_,i)=>`originalArtifacts[${i}]`),'completedRevisions[0].content']);
});

// P4: 역할별 아카이브 카테고리. 사실(evidence)은 건드리지 않는다.
const source=(id,category)=>({id,title:'합성 자료 '+id,category,url:'https://example.com/'+id,observedAt:'2026-01-01T00:00:00.000Z',scope:'브랜드',content:'합성 자료 본문 '+id,excerpt:false,version:1});
const observation=id=>({id,brandId:'synthetic-bunsik',channel:'instagram',account:'합성 계정',periodStart:'2026-01-01',periodEnd:'2026-01-07',observedAt:'2026-01-08T00:00:00.000Z',source:'합성',scope:'organic',method:'manual',definition:'합성 정의',values:{posts:3},version:1,createdAt:'2026-01-08T00:00:00.000Z'});
const archive={...byName('insight').context.archive,confirmedSources:[source('s-product','product'),source('s-channel','channel'),source('s-performance','performance'),source('s-customer','customer'),source('s-odd','unexpected')],observations:[observation('o-1'),observation('o-2')]};
const insightInput=buildRoleInput({...byName('insight').context,archive});
check('P4 keeps only the categories the role needs',()=>{
 const r=applyPolicy('P4',{kind:'role',role:'insight',input:insightInput}),x=JSON.parse(insightInput),y=JSON.parse(r.input);
 assert.deepEqual(r.omitted.map(o=>o.path),['brandArchive.confirmedSources[1]','brandArchive.confirmedSources[2]','brandArchive.observations[0]','brandArchive.observations[1]']);
 assert.deepEqual(y.brandArchive.confirmedSources.map(s=>s.id),['s-product','s-customer','s-odd']);
 assert.deepEqual(y.brandArchive.confirmedSources.map(s=>s.ref),['브랜드 자료 #1','브랜드 자료 #4','브랜드 자료 #5']);
 assert.equal(y.brandArchive.omittedSources,x.brandArchive.omittedSources+2);assert.equal(y.brandArchive.omittedObservations,x.brandArchive.omittedObservations+2);
 assert.deepEqual(y.evidence,x.evidence);assert.ok(r.omitted.every(o=>/역할\(insight\)/.test(o.reason)));
});
check('P4 keeps every category for the quality reviewer',()=>{const input=buildRoleInput({...byName('quality').context,archive}),r=applyPolicy('P4',{kind:'role',role:'quality',input});assert.deepEqual(r,{input,omitted:[],applicable:true})});
check('P4 is not applicable to an unknown role',()=>assert.equal(applyPolicy('P4',{kind:'role',role:'intern',input:insightInput}).applicable,false));
check('P4 reads the role from the task when the submission has none',()=>assert.deepEqual(applyPolicy('P4',{kind:'role',input:insightInput}),applyPolicy('P4',{kind:'role',role:'insight',input:insightInput})));
check('P4 category map covers every agency role with known categories',()=>{assert.deepEqual(Object.keys(ROLE_ARCHIVE_CATEGORIES).sort(),roles.map(r=>r.id).sort());assert.ok(Object.values(ROLE_ARCHIVE_CATEGORIES).every(list=>list.includes('other')))});
// 역할 계약 섹션 제목이 요구하는 자료 카테고리는 그 역할에 남아야 한다(채널→channel, 성과·매출·CPA→performance, 대상·고객→customer).
const CONTRACT_NEEDS=[[/채널/,'channel'],[/성과|매출|CPA/,'performance'],[/대상|고객/,'customer']];
check('P4 keeps the categories each role contract asks for',()=>{for(const r of roles){const text=contract(r.id).sections.map(s=>s.title).join(' ');for(const [re,c] of CONTRACT_NEEDS)if(re.test(text))assert.ok(ROLE_ARCHIVE_CATEGORIES[r.id].includes(c),`${r.id}: ${c}`)}});
check('P4 keeps channel observations for strategy and growth',()=>{for(const id of ['strategy','growth']){const input=buildRoleInput({...byName(id).context,archive}),y=JSON.parse(applyPolicy('P4',{kind:'role',role:id,input}).input);assert.deepEqual(y.brandArchive.observations.map(o=>o.id),['o-1','o-2'],id)}});
check('policies do not mutate the fixture',()=>{const before=JSON.stringify(fixture);for(const {s} of samples)for(const id of ids)applyPolicy(id,s);assert.equal(JSON.stringify(fixture),before)});
console.log(JSON.stringify({passed:passed.length}));
