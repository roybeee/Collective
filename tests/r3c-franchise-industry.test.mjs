// R3c(트랙 R): 업종 채점 사전 franchise와 채점 버전 +franchise-industry.
// 수용: 가맹 모집 운영 용어(정보공개서·가맹 상담·창업 설명회·예비 점주 등)는 가맹 업종이 아닌 캠페인에서 industry_metric_leak fail이고,
// 주 업종이나 허용 업종에 franchise가 있으면 pass다. 소비자 캠페인이 흔히 쓰는 '가맹' 낱말(결제망 가맹점, 가맹점 개설 기념, 가맹 계약 만료 공지,
// 창업 N주년·창업 이야기, 점주님 인사)은 걸리지 않는다. 가맹 캠페인도 다른 업종 사전(교육 등)은 계속 본다. 모든 입력은 합성 문장이다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m}
async function load(path){const m=moduleFor(path);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const {GRADERS_VERSION,runGraders,ALL_GRADERS}=await load('lib/graders/index.ts');
const industry=await load('lib/graders/industry.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const role=text=>({id:'t',kind:'role',role:'content',text});
const leak=(text,ind)=>runGraders(role(text),{industry:ind},ALL_GRADERS).find(r=>r.id==='industry_metric_leak');

// 가맹 모집 운영 용어: 가맹 업종이 아닌 캠페인에서는 유출이다.
const RECRUIT=[
 '가맹 상담 신청 수와 정보공개서 제공 수를 주 단위로 본다.',
 '창업 설명회 참석자에게 가맹 문의 경로를 안내한다.',
 '예비 가맹점주 리드는 희망 지역별로 나눈다.',
 '가맹금 예치 절차를 먼저 설명한다.',
 '출점 상담 요청은 본사 개발팀이 받는다.',
 '가맹점 모집 공고를 창업 박람회 부스에 붙인다.',
 '정보 공개서 열람 뒤 대기 기간을 지킨다.',
 '예비 점주 모집 퍼널은 문의, 연락, 설명회 순서다.',
 '가맹비와 교육비는 확정 사실로만 적는다.',
 '가맹 설명회 신청 폼을 리드 광고에 연결한다.',
 '가맹 계약 전환율과 계약당 비용을 따로 본다.',
];
// 소비자 캠페인이 흔히 쓰는 '가맹'·'창업'·'점주' 낱말. 가맹 모집 운영 용어가 아니다(R2 소비자 범위의 모집 문구 판정과 같은 방향).
const CONSUMER=[
 '제로페이 가맹점에서 결제하면 10% 할인해 준다.',
 '카드 가맹점 수수료가 올라 가격을 조정하지 않는다.',
 '지역화폐 가맹점 스티커를 입구에 붙였다.',
 '온누리상품권 가맹 신청을 마쳐 상품권 결제를 받는다.',
 '휘경동 가맹점 개설 기념으로 쿠폰을 준다.',
 '가맹 계약 만료로 이 매장은 이번 달까지 운영한다.',
 '전국 가맹점에서 같은 가격으로 판다.',
 '가맹점주님들께 감사 이벤트를 연다.',
 '창업 30주년 기념 행사를 한다.',
 '창업 비용 300만원으로 시작한 할머니 가게 이야기를 쓴다.',
 '1호점 점주님을 모시고 시식회를 한다.',
 '예비 신부 할인과 예비 창업자 특강 후기를 모은다.',
 '공정위 표준 가맹 계약서를 따르는 매장이라고만 쓴다.',
];

check('the industry dictionary has a franchise entry next to the G3 industries',()=>assert.deepEqual(Object.keys(industry.INDUSTRY_TERMS).sort(),['beauty','education','fnb','franchise','kpop','locker','popup','retail']));
check('franchise does not match any cross-industry common term',()=>{for(const t of industry.COMMON_TERMS)assert.ok(!industry.INDUSTRY_TERMS.franchise.test(t),t)});
check('recruitment terms leak into non-franchise campaigns (fnb, education, locker) with a franchise hit',()=>{
 for(const t of RECRUIT)for(const ind of ['fnb','education','locker',['fnb','retail']]){const r=leak(t,ind);assert.equal(r.status,'fail',t+' '+ind);assert.match(r.detail,/franchise: /,t)}
});
check('recruitment terms pass when franchise is the primary or an allowed industry',()=>{
 for(const t of RECRUIT)for(const ind of ['franchise',['franchise','fnb'],['fnb','franchise']])assert.equal(leak(t,ind).status,'pass',t+' '+JSON.stringify(ind));
});
check('consumer uses of 가맹·창업·점주 are not franchise leaks in an fnb campaign',()=>{
 for(const t of CONSUMER){const r=leak(t,'fnb');assert.ok(!/franchise: /.test(r.detail||''),t);assert.equal(r.status,'pass',t)}
});
check('an explicit exclusion still clears a franchise term',()=>assert.equal(leak('가맹 상담 지표는 이번 소비자 캠페인과 무관하므로 제외합니다.','fnb').status,'pass'));
check('a franchise campaign still sees other industry dictionaries',()=>{
 const t='예비 점주 설명회는 체험 수업처럼 운영하고 수강료는 받지 않는다.';
 const r=leak(t,['franchise','fnb']);assert.equal(r.status,'fail');assert.match(r.detail,/education: /);assert.ok(!/franchise: /.test(r.detail));
});
check('the old S7 expectation (fnb only) now fails recruitment output that franchise+fnb passes',()=>{
 const t='가맹 상담 신청자에게 정보공개서 제공 일정을 먼저 안내한다. 쇼룸에서는 떡볶이 대표 메뉴 시식을 한다.';
 assert.equal(leak(t,['fnb']).status,'fail');assert.equal(leak(t,['franchise','fnb']).status,'pass');
});
check('the grading version carries the franchise-industry tag at the end',()=>assert.ok(GRADERS_VERSION.endsWith('+root-brace+franchise-industry')));
check('the franchise dictionary finishes quickly on 40,000-character inputs',()=>{
 for(const text of ['가맹'.repeat(20000),'가맹 '.repeat(13000),'예비 '.repeat(13000),'정보 '.repeat(13000),('가맹점 '.repeat(30)+'\n').repeat(400)]){
  const t=Date.now();leak(text,'fnb');assert.ok(Date.now()-t<1500,text.slice(0,6)+' '+(Date.now()-t));
 }
});
console.log(JSON.stringify({passed:passed.length}));
