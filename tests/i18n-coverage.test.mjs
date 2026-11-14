// GLOBAL-PLAN G6 1단계 래칫: 1단계 화면 파일의 JSX 안에 t() 밖 한글 문자열이 0이고, 영어·일본어 사전이 한국어 키를 모두 가진다.
// 판정은 TypeScript 구문 트리로 한다(주석·타입은 보지 않는다). 2단계 화면을 넣을 때는 아래 목록에 파일(또는 workspace 영역)을 더한다(docs/I18N.ko.md).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const HANGUL=/[가-힣ㄱ-ㆎ]/;
// strict: JSX 밖 문자열(오류·확인 문장)까지 0. jsx: JSX 안만 본다(선택지 이름·동작 판정용 데이터는 허용).
const strict=['app/agenda-panel.tsx','components/app/inbox-row.tsx','components/app/inbox-actions.tsx','components/app/confirm-dialog.tsx','components/app/confirm-view.tsx','components/app/theme-toggle.tsx','app/command-palette-dialog.tsx','app/settings-sections.tsx'];
const jsxOnly=['components/app/empty-line.tsx','components/app/locale-toggle.tsx','app/command-palette.tsx'];
// 2단계 화면(캠페인 상세 탭·제작·발행·설정 채널 카드). strict2는 JSX 밖 문자열까지 0, jsxOnly2는 JSX 안만(회의 안건 기본값은 AI 입력, 문자 광고 머리말은 메시지 본문이라 남긴다).
const strict2=['app/campaign-brief.tsx','app/campaign-history.tsx','app/campaign-metrics.tsx','app/execution-panel.tsx','components/app/plan-card.tsx','components/app/run-timeline.tsx','app/settings-channels.tsx','app/settings-channel-card.tsx','app/settings-publishers.tsx','app/settings-pos.tsx'];
const jsxOnly2=['app/meeting-panel.tsx','components/app/channel-preview.tsx'];
// app/panels.tsx는 캠페인 상세 틀(CampaignPanel: 머리·이동 경로·탭·브리프·AI 팀·작업물·성과·이력 탭)만 본다. 작업물 대화상자·설정 패널은 아직 한국어다.
const panelsRegions=['CampaignPanel'];
strict.push(...strict2);jsxOnly.push(...jsxOnly2);
// app/workspace.tsx는 1단계 영역만 본다: 건너뛰기 링크·사이드바·머리 띠·화면 제목·새 캠페인 브리프 카드·지표 타일.
const workspaceRegions=[['a','skip-link'],['Sidebar',null],['header','topbar'],['div','page-heading'],['section','brief-card'],['div','stats-row']];

const parse=f=>ts.createSourceFile(f,readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
const isT=n=>ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='t';
const inside=(n,pred)=>{for(let p=n.parent;p;p=p.parent)if(pred(p))return true;return false};
const inJsx=n=>inside(n,p=>ts.isJsxElement(p)||ts.isJsxSelfClosingElement(p)||ts.isJsxFragment(p)||ts.isJsxAttribute(p));
const inType=n=>inside(n,p=>ts.isTypeNode(p)&&!ts.isExpressionWithTypeArguments(p));
const literalText=n=>ts.isJsxText(n)||ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n)?n.text:null;
function offenders(sf,root,{jsx}){
 const out=[];
 (function walk(n){
  const text=literalText(n);
  if(text!==null&&HANGUL.test(text)&&!inType(n)&&!inside(n,isT)&&(!jsx||ts.isJsxText(n)||inJsx(n))){const {line}=sf.getLineAndCharacterOfPosition(n.getStart(sf));out.push(`${sf.fileName}:${line+1} ${text.trim().slice(0,30)}`)}
  ts.forEachChild(n,walk);
 })(root);
 return out;
}
const classOf=el=>{const a=el.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText()==='className');return a?.initializer?a.initializer.getText():''};
for(const f of strict){const o=offenders(parse(f),parse(f),{jsx:false});check(o.length===0,`${f}: Hangul literal outside t(): ${o.slice(0,5).join(' | ')}`)}
for(const f of jsxOnly){const sf=parse(f),o=offenders(sf,sf,{jsx:true});check(o.length===0,`${f}: Hangul JSX text outside t(): ${o.slice(0,5).join(' | ')}`)}
{
 const sf=parse('app/workspace.tsx'),found=new Map();
 (function walk(n){
  if(ts.isJsxElement(n)){const open=n.openingElement,tag=open.tagName.getText(),cls=classOf(open);for(const [t,c] of workspaceRegions)if(tag===t&&(c===null||cls.includes(c)))found.set(`${t}.${c}`,[...(found.get(`${t}.${c}`)??[]),n])}
  ts.forEachChild(n,walk);
 })(sf);
 for(const [t,c] of workspaceRegions){const nodes=found.get(`${t}.${c}`)??[];check(nodes.length>0,`app/workspace.tsx region <${t}${c?' .'+c:''}> exists`);const o=nodes.flatMap(n=>offenders(sf,n,{jsx:true}));check(o.length===0,`app/workspace.tsx <${t}${c?' .'+c:''}>: Hangul JSX text outside t(): ${o.slice(0,5).join(' | ')}`)}
 const navDecl=sf.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText()==='nav'));
 check(navDecl&&!HANGUL.test(navDecl.getText()),'app/workspace.tsx nav names come from the dictionary (nav.<id>)');
}

{
 const sf=parse('app/panels.tsx');
 for(const name of panelsRegions){let fn;(function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)fn=n;else ts.forEachChild(n,walk)})(sf);check(fn,`app/panels.tsx ${name} exists`);const o=offenders(sf,fn,{jsx:true});check(o.length===0,`app/panels.tsx ${name}: Hangul JSX text outside t(): ${o.slice(0,5).join(' | ')}`)}
 const tabs=sf.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText()==='campaignTabKeys'));
 check(tabs&&!HANGUL.test(tabs.getText()),'app/panels.tsx campaign tab names come from the dictionary (campaign.tab.<id>)');
}

// 사전 완결성: en·ja는 ko 키를 모두 갖고 남는 키가 없다. 자리표시({name}) 이름이 같다. 빈 값은 단위 키(stats.*Unit)만 허용한다.
const {load}=testRuntime(async()=>{throw Error('external forbidden')});
const home=(await load('lib/i18n/ko.ts')).ko,lazyKo=(await load('lib/i18n/ko-lazy.ts')).koLazy,ko={...home,...lazyKo},dicts={en:(await load('lib/i18n/en.ts')).en,ja:(await load('lib/i18n/ja.ts')).ja};
const slots=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(',');
const keys=Object.keys(ko);
check(keys.length>=150,`ko dictionary holds the phase-1 surface (${keys.length} keys)`);
check(Object.keys(lazyKo).length>=900,`ko-lazy holds the phase-2 screens (${Object.keys(lazyKo).length} keys)`);
for(const [name,d] of Object.entries(dicts)){
 const missing=keys.filter(k=>typeof d[k]!=='string'),extra=Object.keys(d).filter(k=>!(k in ko));
 check(missing.length===0,`${name} has every ko key; missing: ${missing.slice(0,8).join(', ')}`);
 check(extra.length===0,`${name} has no keys outside ko: ${extra.slice(0,8).join(', ')}`);
 const slotDiff=keys.filter(k=>slots(ko[k])!==slots(d[k]??''));
 check(slotDiff.length===0,`${name} keeps the same {slots}: ${slotDiff.slice(0,8).join(', ')}`);
 const empty=keys.filter(k=>!d[k]&&!/Unit$/.test(k));
 check(empty.length===0,`${name} has no empty values: ${empty.join(', ')}`);
 const untranslated=keys.filter(k=>HANGUL.test(d[k]));
 check(untranslated.length===0,`${name} has no Korean left: ${untranslated.slice(0,8).join(', ')}`);
}
check(keys.every(k=>ko[k].length>0),'every ko value is non-empty');
check(Object.keys(lazyKo).every(k=>!(k in home)),'ko.ts and ko-lazy.ts do not share keys');
// 상태 배지(app/status-badge.tsx, 홈 첫 로딩 부품): 한국어는 lib/agency statuses 이름을 그대로 쓰고 영어·일본어일 때만 status.<상태> 키를 읽는다. 두 이름이 같아야 하고, 사전 등록 모듈을 홈에 싣지 않는다.
{const statuses=(await load('lib/agency.ts')).statuses,badge=readFileSync('app/status-badge.tsx','utf8');
 check(Object.entries(statuses).every(([k,v])=>ko['status.'+k]===v),'status.<id> Korean values equal lib/agency statuses');
 check(!badge.includes('lib/i18n/lazy')&&/locale!=='ko'&&localStatus\(status\)/.test(badge),'status badge reads the dictionary only outside Korean and does not load the lazy section');}
// 홈 첫 로딩 부품은 ko.ts(홈 사전) 키만 쓴다. 열 때 내려받는 화면은 lib/i18n/lazy.ts를 가져와 ko-lazy.ts를 등록한다. 홈 부품이 lazy.ts를 가져오면 ko-lazy.ts가 홈 청크에 실린다.
const homeFiles=['app/workspace.tsx','app/agenda-panel.tsx','components/app/inbox-row.tsx','components/app/confirm-dialog.tsx','components/app/theme-toggle.tsx','components/app/empty-line.tsx','app/command-palette.tsx'];
const lazyFiles=['components/app/inbox-actions.tsx','components/app/confirm-view.tsx','app/command-palette-dialog.tsx','app/settings-sections.tsx','components/app/locale-toggle.tsx',...strict2,...jsxOnly2,'app/panels.tsx'];
const usedKeys=src=>[...src.matchAll(/\bt\('([\w.]+)'/g)].map(m=>m[1]);
for(const f of homeFiles){const src=readFileSync(f,'utf8'),bad=usedKeys(src).filter(k=>!(k in home));check(bad.length===0,`${f} uses only home keys (lazy keys would show their names): ${bad.join(', ')}`);check(!src.includes("lib/i18n/lazy"),`${f} does not load the lazy Korean section`)}
for(const f of lazyFiles){const src=readFileSync(f,'utf8'),bad=usedKeys(src).filter(k=>!(k in ko));check(src.includes("import '@/lib/i18n/lazy';"),`${f} registers the lazy Korean section`);check(bad.length===0,`${f} uses known keys: ${bad.join(', ')}`)}
for(const f of [...strict,...jsxOnly]){const bad=usedKeys(readFileSync(f,'utf8')).filter(k=>!(k in ko));check(bad.length===0,`${f} uses known keys: ${bad.join(', ')}`)}
// 영어·일본어 사전은 고를 때만 내려받는다: lib/i18n.ts는 동적 import만 쓰고, 화면 코드는 사전 파일을 직접 가져오지 않는다.
const core=readFileSync('lib/i18n.ts','utf8');
check(/import\('\.\/i18n\/en'\)/.test(core)&&/import\('\.\/i18n\/ja'\)/.test(core)&&!/from '\.\/i18n\/(en|ja)'/.test(core),'en/ja dictionaries are dynamic imports only');
for(const f of [...strict,...jsxOnly,'app/workspace.tsx','app/account-panel.tsx','app/layout.tsx'])check(!/lib\/i18n\/(en|ja)/.test(readFileSync(f,'utf8')),`${f} does not import en/ja dictionaries`);
check(!/console\.(log|info|warn)/.test(core),'i18n core does not log');
console.log(JSON.stringify({passed}));
