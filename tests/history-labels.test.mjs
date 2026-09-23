// 버전 비교 라벨(lib/history-labels.ts)의 역할별 묶음·한글 상태·KST 작성 시각·교체 사유·기본 비교 쌍·미리보기 정리를 고정한다.
// 기본 브랜드·다른 브랜드 언급은 tests/brand-default.test.mjs, 아카이브 진단 단계는 tests/archive-stage.test.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/history-labels.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {statusLabel,kstTime,versionGroups,defaultComparison,artifactPreview}=m.namespace;
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const plain=value=>JSON.parse(JSON.stringify(value));

// 상태·시각 표기
check('status labels follow the panels Status table',()=>{assert.equal(statusLabel('review'),'검토 대기');assert.equal(statusLabel('approved'),'기획 승인');assert.equal(statusLabel('outdated'),'이전 버전');assert.equal(statusLabel('revision'),'수정 요청');assert.equal(statusLabel('unknown_state'),'unknown_state')});
check('creation time is shown in KST regardless of the viewer time zone',()=>{assert.equal(kstTime('2026-09-23T06:10:00.000Z'),'09-23 15:10 KST');assert.equal(kstTime('2026-09-23T15:30:00.000Z'),'09-24 00:30 KST');assert.equal(kstTime('not a date'),'')});

// 역할 재실행: 고객 인사이트를 다시 실행하면 기존 인사이트와 하위 전략이 이력으로 복사되고 작업물은 outdated로 남는다(lib/role-execution.ts 기록 규칙).
const job=role=>`owner-1:campaign-1:1:${role}:0123456789abcdef0123`;
const cmo={id:'ai-'+'a'.repeat(32),campaignId:'campaign-1',role:'cmo',title:'총괄 파트너 · 아주 긴 캠페인 이름',content:'',status:'approved',version:1,origin:'ai',createdAt:'2026-09-23T05:00:00.000Z'};
const insightOld={...cmo,id:'ai-'+'b'.repeat(32),role:'insight',status:'review',createdAt:'2026-09-23T05:10:00.000Z'};
const insightNew={...cmo,id:'ai-'+'c'.repeat(32),role:'insight',status:'review',createdAt:'2026-09-23T06:10:00.000Z'};
const strategyOld={...cmo,id:'ai-'+'d'.repeat(32),role:'strategy',status:'review',createdAt:'2026-09-23T05:20:00.000Z'};
const rerunHistory=[insightOld,strategyOld].map(a=>({...a,id:`${job('insight')}:${a.id}:1`,originalId:a.id}));
const rerun=plain(versionGroups([cmo,{...insightOld,status:'outdated'},insightNew,{...strategyOld,status:'outdated'}],rerunHistory));
check('versions are grouped by role in team order with role names',()=>assert.deepEqual(rerun.map(g=>[g.role,g.label]),[['cmo','총괄 파트너'],['insight','고객 인사이트'],['strategy','브랜드 전략']]));
check('labels show role version, Korean status, KST time and current/previous reason',()=>assert.deepEqual(rerun.map(g=>g.options.map(o=>o.label)),[
 ['총괄 파트너 v1 · 기획 승인 · 09-23 14:00 KST · 현재'],
 ['고객 인사이트 v1 · 검토 대기 · 09-23 15:10 KST · 현재','고객 인사이트 v1 · 검토 대기 · 09-23 14:10 KST · 이전: 고객 인사이트 재작성으로 교체'],
 ['브랜드 전략 v1 · 검토 대기 · 09-23 14:20 KST · 이전: 고객 인사이트 재작성으로 교체']]));
check('labels never expose internal id fragments or English statuses',()=>{for(const o of rerun.flatMap(g=>g.options)){assert.ok(!/review|approved|outdated|ai-|:1$/.test(o.label),o.label);assert.ok(!o.label.includes(o.id.slice(-6)),o.label)}});
check('an outdated artifact already copied to history is listed once',()=>assert.deepEqual(rerun.find(g=>g.role==='strategy').options.map(o=>o.id),[rerunHistory[1].id]));
check('the default pair is the previous and current version of the same role',()=>assert.deepEqual(plain(defaultComparison(rerun)),{left:rerunHistory[0].id,right:insightNew.id}));

// 팀 회의 개선(`${meetingId}:${artifactId}:${version}`)과 직접 수정(uid) 이력
const meetingId='0f8fad5b-d9cb-469f-a165-70867728950e';
const creativeV1={...cmo,id:'ai-'+'e'.repeat(32),role:'creative',status:'revision',createdAt:'2026-09-23T07:00:00.000Z'};
const creativeV2={...creativeV1,status:'review',version:2,meetingId,createdAt:'2026-09-23T08:00:00.000Z'};
const contentV1={...cmo,id:'7c9e6679-7425-40de-944b-e07fc1f90ae7',role:'content',status:'review',origin:'manual',createdAt:'2026-09-23T07:30:00.000Z'};
const contentV2={...contentV1,version:2,createdAt:'2026-09-23T09:00:00.000Z'};
const edits=[{...creativeV1,id:`${meetingId}:${creativeV1.id}:1`,originalId:creativeV1.id},{...contentV1,id:'16fd2706-8baf-433b-82eb-8c7fada847da',originalId:contentV1.id}];
const revised=plain(versionGroups([creativeV2,contentV2],edits));
check('meeting improvements and direct edits are named as reasons',()=>assert.deepEqual(revised.map(g=>g.options.map(o=>o.label)),[
 ['크리에이티브 v2 · 검토 대기 · 09-23 17:00 KST · 현재: 회의 개선','크리에이티브 v1 · 수정 요청 · 09-23 16:00 KST · 이전: 회의 개선으로 교체'],
 ['콘텐츠 스튜디오 v2 · 검토 대기 · 09-23 18:00 KST · 현재: 직접 수정','콘텐츠 스튜디오 v1 · 검토 대기 · 09-23 16:30 KST · 이전: 직접 수정으로 교체']]));
check('with several changed roles the most recently changed role is compared',()=>assert.deepEqual(plain(defaultComparison(revised)),{left:edits[1].id,right:contentV2.id}));
check('a manual first version and an unknown history format stay readable',()=>{const g=plain(versionGroups([{...contentV1}],[{...contentV1,id:'legacy:format',originalId:'other'}]));assert.deepEqual(g[0].options.map(o=>o.label),['콘텐츠 스튜디오 v1 · 검토 대기 · 09-23 16:30 KST · 현재: 직접 등록','콘텐츠 스튜디오 v1 · 검토 대기 · 09-23 16:30 KST · 이전'])});
check('without any previous version both sides default to a current version',()=>{assert.deepEqual(plain(defaultComparison(plain(versionGroups([cmo],[])))),{left:cmo.id,right:cmo.id});assert.deepEqual(plain(defaultComparison([])),{left:'',right:''})});
check('a role with only previous versions still defaults to that previous version',()=>{const g=plain(versionGroups([cmo,{...strategyOld,status:'outdated'}],[]));assert.equal(g[1].options[0].label,'브랜드 전략 v1 · 이전 버전 · 09-23 14:20 KST');assert.deepEqual(plain(defaultComparison(g)),{left:strategyOld.id,right:cmo.id})});

// 미리보기: 첫 비제목 문단, 내부 식별자 제거
check('preview uses the first non-heading paragraph without markdown',()=>assert.equal(artifactPreview('## 핵심 요약\n\n**오후 방문 동기**를 실험합니다.\n조건은 같습니다.\n\n## 다음\n나머지'),'오후 방문 동기를 실험합니다. 조건은 같습니다.'));
check('preview removes campaign ids and UUIDs',()=>{const p=artifactPreview('## 요약\ncampaign:id=37da2d59-1c2b-4c1e-9d5e-0a1b2c3d4e5f, version=1 기준으로 artifact_id=7c9e6679-7425-40de-944b-e07fc1f90ae7 초안과 16fd2706-8baf-433b-82eb-8c7fada847da 자료를 비교합니다.');assert.equal(p,'기준으로 초안과 자료를 비교합니다.');assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}|campaign:id=/i.test(p))});
check('preview labels leaked artifact ids like the artifact dialog',()=>assert.equal(artifactPreview('ai-'+'f'.repeat(32)+'의 방향을 유지합니다.'),'이전 작업물의 방향을 유지합니다.'));
check('preview is bounded and empty when only headings exist',()=>{assert.equal(artifactPreview('# 제목\n## 소제목'),'');const long=artifactPreview('가'.repeat(300),120);assert.equal(long.length,121);assert.ok(long.endsWith('…'))});

console.log(JSON.stringify({passed},null,2));
