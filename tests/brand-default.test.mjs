// 기본 브랜드 결정(lib/brand-default.ts)을 고정한다: 기억한 선택 → 가장 최근 활동 브랜드 → 첫 브랜드,
// 목표에 적힌 다른 브랜드 탐지, 목표 한 줄 입력의 HERMES 자동 초안 허용 조건.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/brand-default.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {defaultBrandId,otherBrandMentions,canAutoDraft}=m.namespace;
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};

const brands=[{id:'ofd',name:'Old Ferry Donut',short:'OFD'},{id:'oda',name:'ODA Pizza',short:'ODA'},{id:'mapdal',name:'MAPDAL',short:'MD'},{id:'alan',name:'Dr.alan623',short:'a623'}];
const activity=[{brandId:'ofd',at:'2026-09-20T00:00:00.000Z'},{brandId:'oda',at:'2026-09-23T00:00:00.000Z'},{brandId:'deleted',at:'2026-09-24T00:00:00.000Z'},{brandId:'alan',at:'invalid'}];

// 기본 브랜드: 워크스페이스(캠페인 수정 시각)와 학습 화면(사례·실험·캠페인)이 같은 규칙을 쓴다.
check('a remembered brand wins while it still exists',()=>assert.equal(defaultBrandId(brands,activity,'mapdal'),'mapdal'));
check('an unknown remembered brand falls back to the most recently active brand',()=>assert.equal(defaultBrandId(brands,activity,'gone'),'oda'));
check('without a remembered brand the latest activity decides; deleted brands and invalid times are skipped',()=>{assert.equal(defaultBrandId(brands,activity),'oda');assert.equal(defaultBrandId(brands,activity,''),'oda')});
check('activity of a deleted brand is skipped',()=>assert.equal(defaultBrandId([{id:'ofd'}],activity),'ofd'));
check('without activity the first brand is the default',()=>{assert.equal(defaultBrandId(brands,[]),'ofd');assert.equal(defaultBrandId(brands,[{brandId:'oda',at:''}]),'ofd')});
check('no brands yields an empty id',()=>{assert.equal(defaultBrandId([],activity,'ofd'),'');assert.equal(defaultBrandId([],[{brandId:'oda',at:'2026-09-23T00:00:00.000Z'}]),'')});
check('the input lists are not reordered',()=>{const frozen=Object.freeze([...activity]);defaultBrandId(brands,frozen);assert.equal(frozen[0].brandId,'ofd')});

// 목표 문장에 선택하지 않은 브랜드의 이름·약칭
check('a goal naming another brand is flagged',()=>{assert.deepEqual(otherBrandMentions('ODA 오픈 캠페인을 준비하고 싶어',brands,'ofd').map(b=>b.id),['oda']);assert.deepEqual(otherBrandMentions('mapdal seoul 팝업과 Old Ferry Donut 협업',brands,'oda').map(b=>b.id),['ofd','mapdal'])});
check('the selected brand, short common words and partial tokens are not flagged',()=>{assert.deepEqual(otherBrandMentions('OFD 신메뉴 MD 추천',brands,'ofd'),[]);assert.deepEqual(otherBrandMentions('ODAX 이벤트',brands,'ofd'),[]);assert.deepEqual(otherBrandMentions('',brands,'ofd'),[])});

// 자동 초안: 목표가 있고 목표에 다른 브랜드 이름이 없을 때만 다이얼로그가 열리자마자 HERMES 초안을 요청한다.
check('a goal for the selected brand starts the draft automatically',()=>{assert.equal(canAutoDraft('평일 방문을 늘리는 캠페인',brands,'ofd'),true);assert.equal(canAutoDraft('ODA 오픈 캠페인',brands,'oda'),true)});
check('a goal naming another brand waits for the user to confirm the brand',()=>assert.equal(canAutoDraft('ODA 오픈 캠페인',brands,'ofd'),false));
check('an empty goal never starts a draft',()=>{assert.equal(canAutoDraft('   ',brands,'ofd'),false);assert.equal(canAutoDraft('',brands,'ofd'),false)});

console.log(JSON.stringify({passed},null,2));
