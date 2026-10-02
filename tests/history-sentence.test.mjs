// 변경 이력 문장(lib/history-labels.ts historySentence·historyLine·historyLines)과 문장용 형식(lib/format.ts dayTime·josa)을 고정한다.
// 평가 10회차 ⑪ 5점 조건 '변경 이력을 사람이 읽는 문장으로': 항목마다 '…습니다.'로 끝나는 한 문장, KST '10월 2일 오후 3:10', 받침에 맞는 조사,
// 빠진 행위자·버전·시각은 구절째 뺀다('undefined'·빈 조사 없음). 선택 상자 글자(label)는 짧은 쉼표 형식 그대로다(tests/history-labels.test.mjs).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const load=async path=>{const m=moduleFor(path);await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();return m.namespace};
const {historySentence,historyLine,historyLines,versionGroups}=await load('lib/history-labels.ts');
const {dayTime,josa}=moduleFor('lib/format.ts').namespace; // history-labels가 이미 연결·평가했다.
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const plain=value=>JSON.parse(JSON.stringify(value));

// 문장용 시각·조사
check('dayTime is a KST month-day-meridiem time',()=>{assert.equal(dayTime('2026-10-02T06:10:00.000Z'),'10월 2일 오후 3:10');assert.equal(dayTime('2026-10-01T15:05:00.000Z'),'10월 2일 오전 12:05');assert.equal(dayTime('2026-10-02T03:00:00.000Z'),'10월 2일 오후 12:00');assert.equal(dayTime('nope'),'');assert.equal(dayTime(undefined),'')});
check('josa follows the final consonant of Hangul, digits and Latin letters',()=>{
 assert.deepEqual(['브랜드 전략 담당 v2','v1','v3','v10','작업물','회의 개선','고객 인사이트 재작성','「초안」','Meta','작업 7'].map((w,i)=>josa(w,['을/를','을/를','을/를','을/를','은/는','으로/로','으로/로','이/가','을/를','으로/로'][i])),
  ['브랜드 전략 담당 v2를','v1을','v3을','v10을','작업물은','회의 개선으로','고객 인사이트 재작성으로','「초안」이','Meta를','작업 7로']);
});

// 버전 문장(상태별 스냅샷)
const at='2026-10-02T06:10:00.000Z',made='2026-10-02T05:00:00.000Z';
const base={id:'ai-'+'a'.repeat(32),role:'strategy',version:2,status:'approved',origin:'ai',createdAt:made};
const V=(r,state='current')=>historySentence({kind:'version',record:{...base,...r},state});
check('version sentences per status kind',()=>assert.deepEqual([
 V({reviewedAt:at,reviewedVersion:2}),
 V({}),
 V({status:'revision',reviewedAt:at,reviewedVersion:2}),
 V({status:'revision'}),
 V({status:'review',version:1}),
 V({status:'review',meetingId:'0f8fad5b-d9cb-469f-a165-70867728950e'}),
 V({status:'review',version:1,origin:'manual'}),
 V({status:'outdated',version:1},'outdated'),
 V({id:'owner-1:campaign-1:1:insight:0123456789abcdef0123:ai-x:1',version:1},'history'),
 V({id:'0f8fad5b-d9cb-469f-a165-70867728950e:ai-x:1',version:1},'history'),
 V({id:'16fd2706-8baf-433b-82eb-8c7fada847da',version:1},'history'),
 V({id:'legacy:format',version:1},'history'),
 V({status:'draft'}),
],[
 '브랜드 전략 담당 v2를 10월 2일 오후 3:10에 승인했습니다.',
 '브랜드 전략 담당 v2는 10월 2일 오후 2:00에 직접 수정됐고 승인을 받았습니다.',
 '브랜드 전략 담당 v2의 수정을 10월 2일 오후 3:10에 요청했습니다.',
 '브랜드 전략 담당 v2는 10월 2일 오후 2:00에 직접 수정됐고 수정 요청을 받았습니다.',
 '브랜드 전략 담당 v1은 10월 2일 오후 2:00에 작성됐고 검토를 기다리고 있습니다.',
 '브랜드 전략 담당 v2는 10월 2일 오후 2:00에 팀 회의에서 개선됐고 검토를 기다리고 있습니다.',
 '브랜드 전략 담당 v1은 10월 2일 오후 2:00에 직접 등록됐고 검토를 기다리고 있습니다.',
 '브랜드 전략 담당 v1은 10월 2일 오후 2:00에 작성됐고 지금은 이전 버전입니다.',
 '브랜드 전략 담당 v1은 10월 2일 오후 2:00에 작성됐고 고객 인사이트 재작성으로 교체됐습니다.',
 '브랜드 전략 담당 v1은 10월 2일 오후 2:00에 작성됐고 회의 개선으로 교체됐습니다.',
 '브랜드 전략 담당 v1은 10월 2일 오후 2:00에 작성됐고 직접 수정으로 교체됐습니다.',
 '브랜드 전략 담당 v1은 10월 2일 오후 2:00에 작성됐고 새 버전으로 교체됐습니다.',
 '브랜드 전략 담당 v2는 10월 2일 오후 2:00에 직접 수정됐고 브리프 작성 상태로 남아 있습니다.',
]));
check('a review of an older version does not date the current approval',()=>assert.equal(V({reviewedAt:at,reviewedVersion:1}),'브랜드 전략 담당 v2는 10월 2일 오후 2:00에 직접 수정됐고 승인을 받았습니다.'));
check('missing time, version or role drops the phrase instead of printing undefined',()=>{
 assert.equal(V({status:'review',createdAt:'not a date'}),'브랜드 전략 담당 v2는 직접 수정됐고 검토를 기다리고 있습니다.');
 assert.equal(V({role:'unknown_role',version:Number.NaN,status:'review'}),'작업물은 10월 2일 오후 2:00에 작성됐고 검토를 기다리고 있습니다.');
 assert.equal(V({reviewedAt:'bad',reviewedVersion:2}),'브랜드 전략 담당 v2는 10월 2일 오후 2:00에 직접 수정됐고 승인을 받았습니다.');
});
check('version options keep the short label and add the sentence',()=>{const g=plain(versionGroups([{...base,reviewedAt:at,reviewedVersion:2}],[]));assert.equal(g[0].options[0].label,'브랜드 전략 v2, 기획 승인, 10-02 14:00 KST, 현재: 직접 수정');assert.equal(g[0].options[0].sentence,'브랜드 전략 담당 v2를 10월 2일 오후 3:10에 승인했습니다.')});

// 캠페인 이벤트 문장(서버 eventStatement 문구 → 행위자·시각이 든 한 문장 + 덧붙임)
const actor={id:'u1',email:'kim@example.com'};
const E=(message,who=actor)=>plain(historyLine({kind:'event',event:{message,createdAt:at,...(who?{actor:who}:{})}}));
check('event sentences per action kind',()=>assert.deepEqual([
 E('브랜드 전략 · 평일의 도넛 리추얼 v2 승인'),
 E('브랜드 전략 · 평일의 도넛 리추얼 v3 브랜드·사실 변경 확인 후 승인'),
 E('전략 초안 v1 수정 요청 · 근거 출처를 붙이세요'),
 E('팀 회의 · 품질 재검토 v1 승인'),
 E('총괄 파트너 작업물 등록 · v1'),
 E('총괄 파트너 작업물 수정 · v2'),
 E('undefined 작업물 수정 · v3'),
 E('캠페인을 보관했습니다. 목록·대시보드에서 숨기고 새 AI 실행·연속 실행·발행 승인을 막습니다.'),
 E('브리프 수정 · 이전 승인은 종료되었습니다.'),
 E('상시 지시 삭제 · 오후 할인 금지 (브리프 버전·작업물 유지)'),
 E('발행 재확인 · 승인을 초안으로 되돌렸습니다. 바뀐 항목을 확인하고 다시 승인하세요.'),
 E('Meta 읽기 연결 해제'),
 E('팀 회의 완료 · 3개 담당 개선본과 품질 재검토를 저장했습니다.',null),
 E('AI 작업물 검증 오류로 실행을 종료했습니다.',null),
 E('Meta 성과 수동 가져오기 v2 · 12행 · 실제 주문 매출 미검증'),
],[
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 브랜드 전략 담당 v2를 승인했습니다.',note:''},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 브랜드와 확정 사실이 바뀐 것을 확인하고 브랜드 전략 담당 v3을 승인했습니다.',note:''},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 「전략 초안」 v1의 수정을 요청했습니다.',note:'근거 출처를 붙이세요'},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 「팀 회의, 품질 재검토」 v1을 승인했습니다.',note:''},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 총괄 파트너 담당 작업물 v1을 등록했습니다.',note:''},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 총괄 파트너 담당 작업물 v2를 수정했습니다.',note:''},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 작업물 v3을 수정했습니다.',note:''},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 캠페인을 보관했습니다.',note:'목록·대시보드에서 숨기고 새 AI 실행·연속 실행·발행 승인을 막습니다.'},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 브리프를 수정했습니다.',note:'이전 승인은 종료되었습니다.'},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 상시 지시를 삭제했습니다.',note:'오후 할인 금지 (브리프 버전·작업물 유지)'},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 발행을 다시 확인했습니다.',note:'승인을 초안으로 되돌렸습니다. 바뀐 항목을 확인하고 다시 승인하세요.'},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 Meta 읽기 연결을 해제했습니다.',note:''},
 {sentence:'10월 2일 오후 3:10에 팀 회의를 마쳤습니다.',note:'3개 담당 개선본과 품질 재검토를 저장했습니다.'},
 {sentence:'10월 2일 오후 3:10에 AI 작업물 검증 오류로 실행을 종료했습니다.',note:''},
 {sentence:'kim@example.com 님이 10월 2일 오후 3:10에 다음 내용을 기록했습니다.',note:'Meta 성과 수동 가져오기 v2, 12행, 실제 주문 매출 미검증'},
]));
check('an actor without email and a bad time leave no dangling particle',()=>{assert.equal(historySentence({kind:'event',event:{message:'새 캠페인 브리프를 만들었습니다.',createdAt:'bad',actor:{id:'u',email:null}}}),'새 캠페인 브리프를 만들었습니다.')});

// AI 작업 문장
const R=(status,extra={})=>plain(historyLine({kind:'run',run:{role:'insight',status,createdAt:at,model:'gpt-test',tokens:1234,...extra}}));
check('run sentences per status',()=>assert.deepEqual(['completed','failed','cancelled','incomplete','uncertain','in_progress','queued'].map(s=>R(s).sentence),[
 '10월 2일 오후 3:10에 시작한 고객 인사이트 담당 AI 작업을 마쳤습니다.',
 '10월 2일 오후 3:10에 시작한 고객 인사이트 담당 AI 작업이 실패했습니다.',
 '10월 2일 오후 3:10에 시작한 고객 인사이트 담당 AI 작업을 취소했습니다.',
 '10월 2일 오후 3:10에 시작한 고객 인사이트 담당 AI 작업이 끝까지 완료되지 않았습니다.',
 '10월 2일 오후 3:10에 시작한 고객 인사이트 담당 AI 작업은 접수 여부를 확인하고 있습니다.',
 '10월 2일 오후 3:10에 고객 인사이트 담당 AI 작업을 시작했고 아직 끝나지 않았습니다.',
 '10월 2일 오후 3:10에 고객 인사이트 담당 AI 작업을 시작했고 아직 끝나지 않았습니다.',
]));
check('run usage is a Korean note, and missing parts are dropped',()=>{
 assert.equal(R('completed').note,'gpt-test 모델로 토큰 1,234개를 썼습니다.');
 assert.deepEqual(R('completed',{role:'meeting',tokens:0,createdAt:'',model:''}),{sentence:'팀 회의 AI 작업을 마쳤습니다.',note:''});
 assert.deepEqual(R('failed',{role:'unknown',model:''}),{sentence:'10월 2일 오후 3:10에 시작한 AI 작업이 실패했습니다.',note:'토큰 1,234개를 썼습니다.'});
});

// 이력 탭 목록: 이벤트와 AI 작업을 최근 순으로, 모든 문장은 '…습니다.'로 끝나고 'undefined'·가운뎃점 연결·영문 단위가 없다.
const lines=plain(historyLines([{id:'e1',message:'새 캠페인 브리프를 만들었습니다.',createdAt:'2026-10-02T01:00:00.000Z'},{id:'e2',message:'브랜드 전략 · 캠페인 v1 승인',createdAt:'2026-10-02T03:00:00.000Z',actor}],[{id:'r1',role:'strategy',status:'completed',createdAt:'2026-10-02T02:00:00.000Z',model:'m',tokens:10}]));
check('history lines are merged newest first',()=>assert.deepEqual(lines.map(l=>l.key),['event:e2','run:r1','event:e1']));
check('every line is one sentence ending in 습니다. without leftovers',()=>{for(const l of lines){assert.match(l.sentence,/습니다\.$/);assert.ok(!/undefined|\s·\s|tokens|\s{2}|^\s|님이 님이/.test(l.sentence+l.note),l.sentence)}});

console.log(JSON.stringify({passed},null,2));
