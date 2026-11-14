// GLOBAL-PLAN G6 1단계 래칫: 1단계 화면 파일의 JSX 안에 t() 밖 한글 문자열이 0이고, 영어·일본어 사전이 한국어 키를 모두 가진다.
// 판정은 TypeScript 구문 트리로 한다(주석·타입은 보지 않는다). 2단계 화면을 넣을 때는 아래 목록에 파일(또는 workspace 영역)을 더한다(docs/I18N.ko.md).
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const HANGUL=/[가-힣ㄱ-ㆎ]/;
// strict: JSX 밖 문자열(오류·확인 문장)까지 0. jsx: JSX 안만 본다(선택지 이름·동작 판정용 데이터는 허용).
const strict=['app/agenda-panel.tsx','components/app/inbox-row.tsx','components/app/inbox-actions.tsx','components/app/confirm-dialog.tsx','components/app/confirm-view.tsx','components/app/theme-toggle.tsx','app/command-palette-dialog.tsx','app/settings-sections.tsx'];
const jsxOnly=['components/app/empty-line.tsx','components/app/locale-toggle.tsx','app/command-palette.tsx','components/app/compliance-fixes.tsx','app/publication-media-set.tsx','app/settings-kakao-send.tsx'];
// 2단계 화면(캠페인 상세 탭·제작·발행·설정 채널 카드). strict2는 JSX 밖 문자열까지 0, jsxOnly2는 JSX 안만(회의 안건 기본값은 AI 입력, 문자 광고 머리말은 메시지 본문이라 남긴다).
const strict2=['app/campaign-brief.tsx','app/campaign-history.tsx','app/campaign-metrics.tsx','app/execution-panel.tsx','components/app/plan-card.tsx','components/app/run-timeline.tsx','app/settings-channels.tsx','app/settings-channel-card.tsx','app/settings-publishers.tsx','app/settings-pos.tsx'];
const jsxOnly2=['app/meeting-panel.tsx','components/app/channel-preview.tsx'];
// app/panels.tsx는 캠페인 상세 틀(CampaignPanel: 머리·이동 경로·탭·브리프·AI 팀·작업물·성과·이력 탭)과 작업물 대화상자(ArtifactDialog)만 본다. 수정 사유 칩(ReviewReasons)·설정 패널은 아직 한국어다.
const panelsRegions=['CampaignPanel','ArtifactDialog','ReviewReasons'];
// 3단계 화면(신뢰 UI·카카오·공유 링크·플레이스 초안·광고 제안·브랜드 사실 카드 틀). 브랜드 사실·점수·광고 제안 카드는 서버 값과 맞춰 보는 이름 표(데이터)가 JSX 밖에 있어 JSX 안만 본다.
const strict3=['components/app/compliance-panel.tsx','components/app/confidence-label.tsx','components/app/citation-pill.tsx','components/app/ai-origin-badge.tsx','app/settings-kakao.tsx','components/app/share-links-card.tsx','app/place-drafts-card.tsx'];
const jsxOnly3=['components/app/creative-score-card.tsx','app/ads-proposals-card.tsx','components/app/safety-scope.tsx','app/brand-facts-panel.tsx','components/app/lifecycle-stepper.tsx','components/app/compliance-count-badge.tsx','components/app/usage-meter.tsx'];
strict.push(...strict2,...strict3);jsxOnly.push(...jsxOnly2,...jsxOnly3);
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
// 한국어 원본: 홈(ko.ts)·공통(ko-lazy.ts)·화면 구역(ko-<구역>.ts, lazy-<구역>.ts가 등록)·서버 안건 문장(ko-agenda.ts, 등록하지 않는다).
const AREAS=readdirSync('lib/i18n').map(f=>f.match(/^ko-(?!lazy)(\w+)\.ts$/)?.[1]).filter(Boolean).sort();
const first=m=>Object.values(m).find(v=>v&&typeof v==='object');
const area={};for(const a of AREAS)area[a]=first(await load(`lib/i18n/ko-${a}.ts`));
const home=(await load('lib/i18n/ko.ts')).ko,lazyKo=(await load('lib/i18n/ko-lazy.ts')).koLazy,ko=Object.assign({...home,...lazyKo},...Object.values(area)),dicts={en:(await load('lib/i18n/en.ts')).en,ja:(await load('lib/i18n/ja.ts')).ja};
check(['campaign','exec','settings','trust','cards','agenda'].every(a=>AREAS.includes(a)),`area dictionaries exist: ${AREAS.join(',')}`);
// 구역 사전 쌍: ko-<구역>.ts와 en-<구역>.ts·ja-<구역>.ts의 키가 같다. 구역끼리·공통·홈과 키가 겹치지 않는다.
for(const a of AREAS){const keysA=Object.keys(area[a]).sort().join('|');for(const lang of ['en','ja']){const d=first(await load(`lib/i18n/${lang}-${a}.ts`));check(Object.keys(d).sort().join('|')===keysA,`${lang}-${a}.ts has exactly the keys of ko-${a}.ts`)}}
{const all=[home,lazyKo,...Object.values(area)].flatMap(d=>Object.keys(d)),dup=all.filter((k,i)=>all.indexOf(k)!==i);check(dup.length===0,`dictionary files do not share keys: ${dup.slice(0,5).join(', ')}`)}
const slots=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(',');
const keys=Object.keys(ko);
check(keys.length>=150,`ko dictionary holds the phase-1 surface (${keys.length} keys)`);
check(Object.keys(lazyKo).length+Object.values(area).reduce((n,d)=>n+Object.keys(d).length,0)>=1300,`lazy sections hold the phase-2·3 screens (${Object.keys(ko).length-keys.filter(k=>k in home).length} keys)`);
// 구역을 나눠 각 화면이 덜 내려받는다: 공통 구역은 작게 둔다.
check(readFileSync('lib/i18n/ko-lazy.ts').length<12000,'common lazy section stays small');
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
const lazyFiles=['components/app/inbox-actions.tsx','components/app/confirm-view.tsx','app/command-palette-dialog.tsx','app/settings-sections.tsx','components/app/locale-toggle.tsx',...strict2,...jsxOnly2,...strict3,...jsxOnly3,'app/panels.tsx'];
const usedKeys=src=>[...src.matchAll(/\bt\('([\w.]+)'/g)].map(m=>m[1]);
for(const f of homeFiles){const src=readFileSync(f,'utf8'),bad=usedKeys(src).filter(k=>!(k in home));check(bad.length===0,`${f} uses only home keys (lazy keys would show their names): ${bad.join(', ')}`);check(!src.includes("lib/i18n/lazy"),`${f} does not load the lazy Korean section`)}
// 화면 파일은 쓰는 키(문자열·템플릿 접두어)가 든 구역을 직접 등록한다: 공통은 lib/i18n/lazy.ts, 구역은 lib/i18n/lazy-<구역>.ts. ko-agenda는 등록하지 않는다(한국어 화면은 서버 문장).
const areaOfKey=k=>k in lazyKo?'common':Object.keys(area).find(a=>k in area[a])??null;
const areasUsed=src=>{const need=new Set();for(const m of src.matchAll(/['`]([a-zA-Z0-9]+\.[\w.]*)(?:['`]|\$\{)/g)){const k=m[1];if(k in home)continue;const a=areaOfKey(k);if(a)need.add(a);else if(m[0].endsWith('${'))for(const kk of Object.keys(ko))if(kk.startsWith(k)&&!(kk in home)){const x=areaOfKey(kk);if(x)need.add(x)}}need.delete('agenda');return need};
const registers=(src,a)=>src.includes(a==='common'?"import '@/lib/i18n/lazy';":`import '@/lib/i18n/lazy-${a}';`);
for(const f of lazyFiles){const src=readFileSync(f,'utf8'),bad=usedKeys(src).filter(k=>!(k in ko)),need=[...areasUsed(src)];check(need.length>0&&need.every(a=>registers(src,a)),`${f} registers the lazy sections it uses (${need.join(',')})`);check(bad.length===0,`${f} uses known keys: ${bad.join(', ')}`)}
for(const a of AREAS.filter(x=>x!=='agenda'))check(readFileSync(`lib/i18n/lazy-${a}.ts`,'utf8').includes(`registerKorean(ko${a[0].toUpperCase()+a.slice(1)})`),`lib/i18n/lazy-${a}.ts registers ko-${a}.ts`);
check(!AREAS.includes('agenda')||!readdirSync('lib/i18n').includes('lazy-agenda.ts'),'server agenda sentences are not registered on screens');
for(const f of [...strict,...jsxOnly]){const bad=usedKeys(readFileSync(f,'utf8')).filter(k=>!(k in ko));check(bad.length===0,`${f} uses known keys: ${bad.join(', ')}`)}
// 영어·일본어 사전은 고를 때만 내려받는다: lib/i18n.ts는 동적 import만 쓰고, 화면 코드는 사전 파일을 직접 가져오지 않는다.
const core=readFileSync('lib/i18n.ts','utf8');
check(/import\('\.\/i18n\/en'\)/.test(core)&&/import\('\.\/i18n\/ja'\)/.test(core)&&!/from '\.\/i18n\/(en|ja)'/.test(core),'en/ja dictionaries are dynamic imports only');
for(const f of [...strict,...jsxOnly,'app/workspace.tsx','app/account-panel.tsx','app/layout.tsx'])check(!/lib\/i18n\/(en|ja)/.test(readFileSync(f,'utf8')),`${f} does not import en/ja dictionaries`);
check(!/console\.(log|info|warn)/.test(core),'i18n core does not log');
// 사전 한국어가 원본 상수와 같다(영어·일본어일 때만 사전을 읽는 이름들).
{const src=await load('lib/artifact-sources.ts'),conf=await load('lib/evidence-confidence.ts'),rev=await load('lib/review-decisions.ts'),agency=await load('lib/agency.ts'),share=await load('lib/share-links.ts');
 check(ko['trust.cmp.notice']===(await load('lib/graders/compliance.ts')).COMPLIANCE_NOTICE,'trust.cmp.notice equals COMPLIANCE_NOTICE');
 check(ko['trust.score.label']===(await load('lib/creative-score.ts')).CREATIVE_SCORE_LABEL,'trust.score.label equals CREATIVE_SCORE_LABEL');
 check(Object.entries(conf.CONFIDENCE_LABELS).every(([k,v])=>ko['trust.level.'+k]===v),'trust.level.<level> equals CONFIDENCE_LABELS');
 check(Object.entries(src.SOURCE_KIND_LABELS).every(([k,v])=>ko['trust.kind.'+k]===v),'trust.kind.<kind> equals SOURCE_KIND_LABELS');
 check(Object.entries(src.COMPLIANCE_CATEGORY_LABELS).every(([k,v])=>ko['trust.category.'+k]===v),'trust.category.<category> equals COMPLIANCE_CATEGORY_LABELS');
 check(ko['trust.severity.block']===src.SEVERITY_LABELS.block&&ko['trust.severity.warn']===src.SEVERITY_LABELS.warn,'trust.severity.* equals SEVERITY_LABELS');
 check(['ai','ai_edited','manual'].every(o=>ko[o==='ai'?'trust.origin.ai':o==='ai_edited'?'trust.origin.aiEdited':'trust.origin.manual']===rev.originLabel(o)),'trust.origin.* equals originLabel');
 check(rev.REVIEW_REASONS.every(r=>ko['reason.label.'+r.code]===r.label&&ko['reason.desc.'+r.code]===r.description),'reason.label/desc.<code> equals REVIEW_REASONS');
 check(agency.roles.every(r=>ko['role.'+r.id]===r.name),'role.<id> equals lib/agency roles names');
 check(Object.entries(share.SHARE_STATE_LABELS).every(([k,v])=>ko['share.state.'+k]===v),'share.state.<state> equals SHARE_STATE_LABELS');
 {const ch=await load('app/settings-channel-state.ts');check(Object.entries(ch.connectionLabels).every(([k,v])=>ko['sch.conn.'+k]===v)&&ko['sch.switch.unknown']===ch.switchLabel(null)&&ko['sch.switch.on']===ch.switchLabel(true)&&ko['sch.switch.off']===ch.switchLabel(false),'sch.conn/sch.switch equal settings-channel-state labels')}}
// 서버 안건 제목·설명(titleKey·vars, detailKey·detailVars): 한국어 원본(ko-agenda.ts)을 채운 문장이 서버 title·detail과 같다. 서버가 쓰는 키는 모두 사전에 있다.
{const fill=(text,vars)=>text.replace(/\{(\w+)\}/g,(w,n)=>vars&&n in vars?String(vars[n]):w);
 const s=await load('lib/agenda-sources.ts'),w=await load('lib/agenda-workspace-sources.ts');
 const names={brand:id=>'브랜드 '+id,store:id=>id?'지점 '+id:''},c={id:'c1',title:'캠페인',version:2,brandId:'b1',storeId:'s1'},now=Date.parse('2026-11-15T03:00:00Z');
 const items=[s.artifactItem({id:'a1',status:'review',role:'content',version:1,campaignVersion:2},c,names),s.artifactItem({id:'a2',status:'review',version:1},c,names),
  s.publicationItem({id:'p1',status:'draft',version:1},c,names),s.publicationItem({id:'p2',status:'approved',version:1},c,names),
  ...s.meetingItems({id:'m1',status:'uncertain',steps:[{status:'uncertain'},{status:'uncertain'}]},c,names),...s.meetingItems({id:'m2',status:'completed',steps:[{phase:'synthesis',status:'completed',output:{questions:'가격 확인'}}]},c,names),
  s.sequenceItem({status:'needs_review',fixes:[1,2,3]},c,names),s.dataRequestItem({id:'d1',status:'open',label:'사진'},c,names),s.briefQuestionItem({id:'q1',status:'completed',result:{questions:[{question:'예산?'},{question:'기간?'}]}},c,names),
  ...w.billingAlertItems([{id:'x',month:'2026-11',level:100,title:'크레딧 모두 사용'}],'2026-11'),...w.billingAlertItems([{id:'y',month:'2026-11',level:80,title:'크레딧 80% 사용'}],'2026-11'),w.reconsentItem({id:'k1',status:'new',brandId:'b1'},names),
  w.geoRunItem({id:'g1',status:'completed',updatedAt:'2026-11-14T00:00:00Z',jobs:[{status:'completed'},{status:'failed'}]},c,names,now),w.geoRunItem({id:'g2',status:'completed',updatedAt:'2026-11-14T00:00:00Z',jobs:[{status:'completed'}]},c,names,now),w.geoRunItem({id:'g3',status:'cancelled',updatedAt:'2026-11-14T00:00:00Z',jobs:[]},c,names,now),
  w.placeDraftItem({id:'pl1',status:'draft',storeId:'s1',kind:'news_post',draft:{text:'소식'}},names),w.placeDraftItem({id:'pl2',status:'draft',storeId:'s1',kind:'review_reply',draft:{text:'답글'}},names),
  w.adsProposalItem({id:'ad1',status:'draft',channel:'daangn_ads'},names),w.adsProposalItem({id:'ad2',status:'draft',channel:'naver_ads'},names)].filter(Boolean);
 check(items.length===19&&items.every(i=>i.titleKey),`every server agenda source sends a titleKey (${items.length})`);
 const wrong=items.filter(i=>fill(ko[i.titleKey]??'',i.vars)!==i.title||i.detailKey&&fill(ko[i.detailKey]??'',i.detailVars)!==i.detail);
 check(wrong.length===0,`ko-agenda Korean equals the server title/detail: ${wrong.map(i=>i.id).join(', ')}`);
 const used=['lib/agenda-sources.ts','lib/agenda-workspace-sources.ts','lib/agenda-server.ts'].flatMap(f=>[...readFileSync(f,'utf8').matchAll(/'(agenda\.[td]\.\w+)'/g)].map(m=>m[1]));
 check(used.length>=30&&used.every(k=>k in area.agenda),`server agenda keys exist in ko-agenda.ts (${used.length})`);
 check(Object.keys(area.agenda).every(k=>used.includes(k)),'ko-agenda.ts has no unused keys');
 check(!readFileSync('app/agenda-panel.tsx','utf8').includes('lib/i18n/lazy')&&readFileSync('lib/agenda-client.ts','utf8').includes("currentLocale()==='ko'"),'agenda titles stay server Korean in Korean and load no lazy section on home');}
console.log(JSON.stringify({passed}));
