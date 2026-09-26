// 워크스페이스 화면 상태 ↔ URL 쿼리(lib/nav-state.ts)의 파싱·직렬화·검증 규칙을 고정한다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console,URLSearchParams}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/nav-state.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {navViews,learningTabs,storeTabs,brandTabs,franchiseTabs,isLearningTab,isFranchiseTab,franchiseMenuVisible,parseNav,serializeNav,normalizeNav,withCampaign,reconcileNav}=m.namespace;
let passed=0;
function check(name,actual,expected){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++}

// --- 허용 화면 ---------------------------------------------------------------------
check('allowed views match the sidebar menu and settings',[...navViews],['overview','learning','campaigns','brands','stores','agents','assets','results','franchise','settings']);

// --- 파싱 ---------------------------------------------------------------------------
check('empty query is the overview',parseNav(''),{view:'overview'});
check('leading ? is optional',parseNav('view=assets'),{view:'assets'});
check('campaign detail on the campaign list',parseNav('?view=campaigns&campaign=3f2a9c1e-0b7d-4c1a-9f00-1234567890ab'),{view:'campaigns',campaign:'3f2a9c1e-0b7d-4c1a-9f00-1234567890ab'});
check('campaign detail can sit on any view',parseNav('?view=assets&campaign=ofd-pilot-01'),{view:'assets',campaign:'ofd-pilot-01'});
check('brand archive',parseNav('?view=brands&brand=oda'),{view:'brands',brand:'oda'});
check('store marketing with brand and store',parseNav('?view=stores&brand=oda&store=store_01'),{view:'stores',brand:'oda',store:'store_01'});
check('unknown view falls back to the overview',parseNav('?view=admin'),{view:'overview'});
check('prototype keys are not views',parseNav('?view=__proto__'),{view:'overview'});
check('view is case-sensitive',parseNav('?view=Campaigns'),{view:'overview'});
check('missing view with campaign opens it on the overview',parseNav('?campaign=c1'),{view:'overview',campaign:'c1'});
check('brand is ignored outside brands and stores',parseNav('?view=campaigns&brand=oda'),{view:'campaigns'});
check('store is ignored outside stores',parseNav('?view=brands&brand=oda&store=s1'),{view:'brands',brand:'oda'});
check('unknown parameters are ignored',parseNav('?view=results&tab=history&utm_source=x'),{view:'results'});
check('ids with markup are dropped',parseNav('?view=campaigns&campaign=%3Cscript%3E'),{view:'campaigns'});
check('ids with spaces or slashes are dropped',parseNav('?view=brands&brand=a%20b&campaign=..%2Fx'),{view:'brands'});
check('100-character id is kept',parseNav('?view=campaigns&campaign='+'a'.repeat(100)),{view:'campaigns',campaign:'a'.repeat(100)});
check('101-character id is dropped',parseNav('?view=campaigns&campaign='+'a'.repeat(101)),{view:'campaigns'});
check('empty id is dropped',parseNav('?view=brands&brand='),{view:'brands'});
check('first duplicate parameter wins',parseNav('?view=assets&view=brands'),{view:'assets'});
// loop-7·loop-11: 학습 화면 링크는 브랜드와 탭(허용 목록)을 싣는다. 탭은 학습 화면에서만 의미가 있다.
check('learning tabs are an allow-list',[...learningTabs],['cases','experiments','rules','jobs']);
check('learning view keeps brand and tab',parseNav('?view=learning&brand=oda&tab=rules'),{view:'learning',brand:'oda',tab:'rules'});
check('unknown learning tab is dropped',parseNav('?view=learning&brand=oda&tab=admin'),{view:'learning',brand:'oda'});
check('prototype keys are not tabs',parseNav('?view=learning&tab=__proto__'),{view:'learning'});
check('a tab outside the view allow-list is dropped',parseNav('?view=stores&brand=oda&tab=rules'),{view:'stores',brand:'oda'});
check('store is ignored on learning',parseNav('?view=learning&brand=oda&store=s1'),{view:'learning',brand:'oda'});
// ux-2 권고 (3)·ux-5: '주문 장부 열기'는 지점의 주문 장부 탭을, 설정 기능표 링크는 브랜드 아카이브의 확인 사실 탭을 연다. 탭은 화면별 허용 목록만 받는다.
check('store tabs are an allow-list',[...storeTabs],['diagnosis','ledger','channels','experiments','research','report']);
// A8-3: 지점 '고객 보고서' 탭(app/customer-report-panel.tsx). 탭 노출(대표·관리자만)은 화면이 정하고, 주소는 허용 목록만 본다.
check('store tab \'report\' is allowed in nav-state',[parseNav('?view=stores&brand=oda&store=s1&tab=report'),parseNav('?view=brands&brand=oda&tab=report')],[{view:'stores',brand:'oda',store:'s1',tab:'report'},{view:'brands',brand:'oda'}]);
check('brand archive tabs are an allow-list',[...brandTabs],['overview','sources','facts','intake','research']);
check('store marketing keeps brand, store and a store tab',parseNav('?view=stores&brand=oda&store=s1&tab=ledger'),{view:'stores',brand:'oda',store:'s1',tab:'ledger'});
check('brand archive keeps brand and a brand tab',parseNav('?view=brands&brand=oda&tab=facts'),{view:'brands',brand:'oda',tab:'facts'});
check('a store tab is dropped on the brand archive and a brand tab on stores',[parseNav('?view=brands&brand=oda&tab=ledger'),parseNav('?view=stores&brand=oda&tab=facts')],[{view:'brands',brand:'oda'},{view:'stores',brand:'oda'}]);
check('views without tabs drop any tab',[parseNav('?view=campaigns&campaign=c1&tab=ledger'),parseNav('?view=settings&tab=facts')],[{view:'campaigns',campaign:'c1'},{view:'settings'}]);
check('prototype keys are not store tabs',parseNav('?view=stores&tab=__proto__'),{view:'stores'});
check('the learning tab guard accepts learning tabs only',['rules','jobs','ledger','facts',undefined].map(isLearningTab),[true,true,false,false,false]);
check('non-ASCII id is dropped',parseNav('?view=brands&brand=%ED%95%9C%EA%B8%80'),{view:'brands'});
// 트랙 R: 가맹 모집 화면(?view=franchise&brand=&tab=)은 브랜드와 탭(리드·정보주체 요청·설정)을 싣는다. 설정 탭 권한은 화면·서버가 따로 본다.
check('franchise tabs are an allow-list',[...franchiseTabs],['leads','requests','settings']);
check('franchise view keeps brand and a franchise tab',parseNav('?view=franchise&brand=fr-a&tab=requests'),{view:'franchise',brand:'fr-a',tab:'requests'});
check('unknown franchise tab is dropped and the brand kept',parseNav('?view=franchise&brand=fr-a&tab=ledger'),{view:'franchise',brand:'fr-a'});
check('franchise ignores store and bad brand ids',[parseNav('?view=franchise&brand=fr-a&store=s1'),parseNav('?view=franchise&brand=%3Cx%3E&tab=settings')],[{view:'franchise',brand:'fr-a'},{view:'franchise',tab:'settings'}]);
check('franchise tabs are dropped on other views',[parseNav('?view=learning&tab=requests'),parseNav('?view=brands&brand=oda&tab=leads')],[{view:'learning'},{view:'brands',brand:'oda'}]);
check('the franchise tab guard accepts franchise tabs only',['leads','requests','settings','rules','__proto__',undefined].map(isFranchiseTab),[true,true,true,false,false,false]);
// 메뉴 노출: 상태 전·실패는 숨김, 스위치 켜짐은 모두, 꺼짐은 기록이 있을 때 대표·관리자만.
check('franchise menu is hidden before the status arrives',[franchiseMenuVisible(null,true),franchiseMenuVisible(null,false)],[false,false]);
check('franchise menu shows for everyone when the switch is on',[franchiseMenuVisible({enabled:true,hasRecords:false},false),franchiseMenuVisible({enabled:true,hasRecords:true},true)],[true,true]);
check('franchise menu is hidden when the switch is off and nothing was recorded',[franchiseMenuVisible({enabled:false,hasRecords:false},true),franchiseMenuVisible({enabled:false,hasRecords:false},false)],[false,false]);
check('with the switch off, recorded leads keep the menu for owner/admin only',[franchiseMenuVisible({enabled:false,hasRecords:true},true),franchiseMenuVisible({enabled:false,hasRecords:true},false)],[true,false]);

// --- 직렬화 -------------------------------------------------------------------------
check('overview without detail is the bare path',serializeNav({view:'overview'}),'');
check('view only',serializeNav({view:'settings'}),'?view=settings');
check('campaign detail keeps the view',serializeNav({view:'campaigns',campaign:'c1'}),'?view=campaigns&campaign=c1');
check('overview with campaign keeps the view',serializeNav({view:'overview',campaign:'c1'}),'?view=overview&campaign=c1');
check('stores with brand and store',serializeNav({view:'stores',brand:'oda',store:'s1'}),'?view=stores&brand=oda&store=s1');
check('invalid view and ids are not written',serializeNav({view:'nope',campaign:'a b',brand:'<x>'}),'');
check('learning link with brand and tab',serializeNav({view:'learning',brand:'oda',tab:'rules'}),'?view=learning&brand=oda&tab=rules');
check('a tab outside the view allow-list is not written',serializeNav({view:'stores',brand:'oda',tab:'rules'}),'?view=stores&brand=oda');
check('franchise link with brand and tab',serializeNav({view:'franchise',brand:'fr-a',tab:'settings'}),'?view=franchise&brand=fr-a&tab=settings');
check('the order ledger link is written with its tab',serializeNav({view:'stores',brand:'oda',store:'s1',tab:'ledger'}),'?view=stores&brand=oda&store=s1&tab=ledger');
check('brand outside brands/stores is not written',serializeNav({view:'assets',brand:'oda'}),'?view=assets');
for(const state of [{view:'overview'},{view:'campaigns',campaign:'c-1'},{view:'brands',brand:'mapdal'},{view:'stores',brand:'oda',store:'s_2'},{view:'assets',campaign:'x'},{view:'learning'},{view:'learning',brand:'ofd',tab:'experiments'},{view:'stores',brand:'oda',store:'s_2',tab:'ledger'},{view:'stores',brand:'oda',store:'s_2',tab:'report'},{view:'brands',brand:'mapdal',tab:'facts'},{view:'franchise'},{view:'franchise',brand:'fr-a',tab:'requests'},{view:'franchise',campaign:'c-1',brand:'fr-a',tab:'leads'}])check('round trip '+JSON.stringify(state),parseNav(serializeNav(state)),state);

// --- 정규화·캠페인 열기 -----------------------------------------------------------------
check('null and undefined ids are dropped',normalizeNav({view:'brands',brand:null,campaign:undefined}),{view:'brands'});
check('missing view becomes the overview',normalizeNav({}),{view:'overview'});
const base=Object.freeze({view:'assets',brand:'oda'});
check('opening a campaign keeps the current view',withCampaign({view:'assets'},'c9'),{view:'assets',campaign:'c9'});
check('closing a campaign keeps the view',withCampaign({view:'campaigns',campaign:'c9'},null),{view:'campaigns'});
check('invalid campaign id is not opened',withCampaign({view:'campaigns'},'bad id'),{view:'campaigns'});
check('withCampaign does not mutate its input',[withCampaign(base,'c1'),base],[{view:'assets',campaign:'c1'},{view:'assets',brand:'oda'}]);

// --- 로드 뒤 존재 확인 -----------------------------------------------------------------
const known={campaigns:['c1','c2'],brands:['ofd','oda']};
const ok={view:'campaigns',campaign:'c1'};
assert.equal(reconcileNav(ok,known),ok,'known campaign keeps the same state object');passed++;
check('unknown campaign goes to the campaign list',reconcileNav({view:'assets',campaign:'gone'},known),{view:'campaigns'});
check('unknown campaign on brands also goes to the list',reconcileNav({view:'brands',brand:'oda',campaign:'gone'},known),{view:'campaigns'});
check('unknown brand archive goes to the brand list',reconcileNav({view:'brands',brand:'nope'},known),{view:'brands'});
check('unknown brand keeps a known open campaign',reconcileNav({view:'stores',brand:'nope',campaign:'c2'},known),{view:'stores',campaign:'c2'});
check('unknown store brand shows all stores',reconcileNav({view:'stores',brand:'nope',store:'s1'},known),{view:'stores'});
check('unknown learning brand keeps the tab',reconcileNav({view:'learning',brand:'nope',tab:'rules'},known),{view:'learning',tab:'rules'});
check('unknown franchise brand shows the franchise view without brand or tab',reconcileNav({view:'franchise',brand:'nope',tab:'requests'},known),{view:'franchise'});
check('unknown store or archive brand drops the store and brand tab',[reconcileNav({view:'stores',brand:'nope',store:'s1',tab:'ledger'},known),reconcileNav({view:'brands',brand:'nope',tab:'facts'},known)],[{view:'stores'},{view:'brands'}]);
const archive={view:'brands',brand:'oda'};
assert.equal(reconcileNav(archive,known),archive,'known brand keeps the same state object');passed++;
const plain={view:'results'};
assert.equal(reconcileNav(plain,known),plain,'state without ids is unchanged');passed++;

console.log(JSON.stringify({passed},null,2));
