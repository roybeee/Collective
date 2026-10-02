// UX-PLAN-3 Q0·Q7: 화면 품질 래칫. 아래 수치는 기준값 이하로만 내려갈 수 있다(올라가면 실패). 줄였으면 tests/ux-budget.json을 함께 낮춘다.
// 런타임 예산(홈 JS·성장 탭 요청·axe·44px)은 e2e/ux-budget.spec.ts가 같은 파일로 확인한다.
// 홈 첫 로딩을 무겁게 만드는 정적 import도 막는다. 가맹(franchise-*)·온라인 채점(online-grading) 화면은 R·Q 소유라 계수에서 뺀다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
const budget=JSON.parse(readFileSync('tests/ux-budget.json','utf8'));
const app=readdirSync('app').filter(n=>n.endsWith('.tsx')&&!n.startsWith('franchise-')&&n!=='online-grading.tsx').map(n=>readFileSync('app/'+n,'utf8')).join('\n');
const css=readdirSync('app').filter(n=>n.endsWith('.css')).map(n=>readFileSync('app/'+n,'utf8')).join('\n');
const count=(src,re)=>(src.match(re)||[]).length;
// 레인 A가 소유하고 화면 문자열을 만드는 lib 파일(평가 9회차: app/*.tsx만 세면 lib 뷰 문자열의 ' · '가 화면에 그대로 나온다).
// 주석은 빼고 문자열·템플릿 리터럴 안의 ' · '만 센다. 0이 목표다. 남은 것은 화면 문구가 아니라 저장·비교되는 값이거나 다른 레인 문구다:
//  - lib/store-marketing.ts channelCatalog name 6개(가운뎃점 7개): 캠페인 channels·학습 규칙 채널 값으로 저장되고 lib/channels.ts 키와 비교한다(화면은 label).
//  - lib/store-attribution.ts autoEvidence·manualEvidence 2개: 주문 attributionEvidence에 저장되고 isCodeEvidence가 글자 그대로 비교한다.
//  - lib/campaign-attribution.ts SNAPSHOT_SCOPE 1개: metric.scope로 저장되고 같은 범위 비교에 쓴다(화면은 성과 카드가 항목으로 나눈다).
//  - lib/feature-status.ts의 다른 레인 행(가맹·고객 보고서·주간 품질 집계·공공 벤치마크·Reflector·품질 운영) 문구 22개: 공유 파일이라 고치지 않고, 화면은 featureView가 항목으로 나눠 그린다.
// 9회차 시작(9f9b9f6) 115개 → 32개.
export const LANE_A_VIEW_LIBS=['lib/feature-status.ts','lib/store-operations-view.ts','lib/history-labels.ts','lib/campaign-status.ts','lib/execution.ts','lib/store-attribution.ts','lib/campaign-attribution.ts','lib/store-marketing.ts'];
const literalMiddleDots=file=>{const sf=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);let n=0;
 const visit=x=>{if(ts.isStringLiteral(x)||ts.isNoSubstitutionTemplateLiteral(x)||ts.isTemplateHead(x)||ts.isTemplateMiddle(x)||ts.isTemplateTail(x))n+=x.text.split(' · ').length-1;ts.forEachChild(x,visit)};visit(sf);return n};
export const measure=()=>({
 libMiddleDots:LANE_A_VIEW_LIBS.reduce((n,f)=>n+literalMiddleDots(f),0),
 rawButtons:count(app,/<button\b/g),
 rawFormControls:count(app,/<(?:input|select|textarea)\b/g),
 // 목록형 기록은 공용 데이터 표(components/app/data-table.tsx)로 그린다. 원시 <table>은 늘지 않는다.
 rawTables:count(app,/<table\b/g),
 confirmCalls:count(app,/\bconfirm\(/g),
 inlineStyles:count(app,/style=\{\{/g),
 hexColors:new Set(css.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)||[]).size,
 // 화면 폭 중단점은 @media 조건의 폭만 센다(요소의 min-width 같은 크기 지정은 중단점이 아니다).
 mediaWidths:new Set((css.match(/@media[^{]*?\((?:max|min)-width: ?\d+px\)/g)||[]).map(x=>x.match(/\d+/)[0])).size,
 // 빈 목록 안내는 공용 EmptyLine(다음 행동 버튼)으로 쓴다. 다음 행동 없는 '…없습니다.' 문단은 늘지 않는다.
 bareEmptyLines:count(app,/<p(?: className=[^>]*)?>[^<{]{0,60}없습니다\.<\/p>/g),
});
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const now=measure();
for(const [k,v] of Object.entries(now))check(v<=budget.static[k],`${k} ${v} > budget ${budget.static[k]} (줄였으면 예산을 낮추고, 늘었으면 공용 부품을 쓰세요)`);
// 패널 안내문(Note)의 첫 문장은 60자 이하(UX-PLAN-3 Q4). 첫 문장은 늘 다 보이고 나머지는 '자세히'로 편다.
const longNotes=[...app.matchAll(/<Note[^>]*>([^<{]+)<\/Note>/g)].map(m=>m[1].trim().split(/(?<=[.다요])\s/)[0]).filter(f=>f.length>60);
check(longNotes.length===0,`Note first sentence over 60 chars: ${longNotes.join(' | ')}`);
// 패널 머리 문단(제목 바로 뒤 <p>)은 60자 이하로 쓴다. 다른 레인 소유 화면(가맹·품질 콘솔·품질 운영·인터뷰·Reflector·사용량·고객 보고서)은 세지 않는다. 더 길면 첫 문장만 보이는 Note를 쓴다(UX-PLAN-3 4차원 4점 조건 '패널 첫 문단 60자').
const ownA=readdirSync('app').filter(n=>n.endsWith('.tsx')&&!/^(franchise-|online-grading|quality-|brand-interview|reflector|usage-panel|customer-report)/.test(n)).map(n=>readFileSync('app/'+n,'utf8')).join('\n');
// 가운뎃점(' · ')으로 여러 사실을 이은 한 줄은 공용 MetaLine(항목 나눔)이나 metaText(쉼표)로 쓴다(UX-PLAN-3 7차원 4점 조건 ≤80). 다른 레인 소유 화면은 세지 않는다.
check(count(ownA,/ · /g)<=budget.static.middleDotJoins,`middleDotJoins ${count(ownA,/ · /g)} > budget ${budget.static.middleDotJoins} (MetaLine·metaText를 쓰세요)`);
const longLeads=[...ownA.matchAll(/<h[23][^>]*>[^<{]*<\/h[23]>\s*<p(?: className=[^>]*)?>([^<{]+)<\/p>/g)].map(m=>m[1].trim()).filter(t=>t.length>60);
check(longLeads.length===0,`header paragraph over 60 chars: ${longLeads.join(' | ')}`);
// 저장 동사는 '저장'(서버에 쓰기)과 '기록'(관측·확인 사실 남기기) 두 가지만 버튼에 쓴다(UX-PLAN-3 4차원 4점 조건). 대화상자를 여는 버튼은 '새 ○○', 폼에 칸을 늘리는 버튼은 '○○ 하나 더'다. '사전등록'은 실험 용어라 예외다.
// 버튼 안의 아이콘·조건식({…})을 걷어내고 남은 글자로 판단한다(평가 5회차: 아이콘이 든 버튼을 놓치던 구멍).
const buttonTexts=[...ownA.matchAll(/<(Button|CardButton)\b[^>]*?(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^>]*?)*>([\s\S]*?)<\/\1>/g)].map(m=>m[2].replace(/<[^>]*>/g,'').replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g,'').trim());
const otherVerbs=buttonTexts.filter(t=>/(등록|추가|입력)$/.test(t)&&!t.endsWith('사전등록'));
check(otherVerbs.length===0,`save buttons must use 저장 or 기록 (row additions use '하나 더'): ${otherVerbs.join(' | ')}`);
// 권한이 없을 때 버튼을 숨기지 않는다(UX-PLAN-3 11차원 4점 조건). 비활성과 이유(disabledReason)로 보인다.
const hiddenByPermission=(ownA.match(/\b(?:(?:view|state|data|listing)\??\.)?(?:can[A-Z]\w*|editable|admin|owner|isAdmin|isOwner|canChange\([^)]*\))&&(?:<>)?\s?<(?:Button|form)\b/g)||[]).length;
check(hiddenByPermission===0,`controls hidden by permission: ${hiddenByPermission}`);
// 진행 중(busy 등) 말고 다른 조건으로 막힌 버튼은 이유(disabledReason)를 보인다(UX-PLAN-3 6차원 4점 조건). 부모가 넘긴 disabled·locked는 부모 쪽에서 센다.
const transient=new Set(['busy','saving','pending','loading','working','sending','!!busy','props.busy','checking','acting','polling','switching',"load.state==='loading'",'disabled','locked','props.disabled']);
const silentDisabled=[...ownA.matchAll(/<Button\b([^>]*?(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^>]*?)*)>/g)].map(m=>m[1]).filter(a=>!a.includes('disabledReason')).map(a=>a.match(/disabled=\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/)?.[1]).filter(c=>c&&c.split('||').some(x=>!transient.has(x.trim()))).length;
check(silentDisabled<=budget.static.silentDisabled,`buttons disabled without a reason ${silentDisabled} > ${budget.static.silentDisabled}`);
// 레인 A 화면의 빈 목록 안내는 모두 EmptyLine(다음 행동 버튼이나 문장)으로 쓴다(UX-PLAN-3 12차원 4점 조건 '빈 상태 100% 다음 행동').
const ownAScreens=readdirSync('app').filter(n=>n.endsWith('.tsx')&&!/^(franchise-|online-grading|quality-|brand-interview|reflector|usage-|customer-report)/.test(n)).map(n=>readFileSync('app/'+n,'utf8')).join('\n');
const laneABareEmpty=(ownAScreens.match(/<(p|div)(?: className=(?:"[^"]*"|\{[^{}]*\}))?>(?:[^<{]|\{[^{}]*\})*?(?:기록|목록|이력|제안|후보|일정|작업물|주문|성과|사실|교정)[^<]{0,12}(?:이|가) (?:아직 )?없습니다\.<\/(p|div)>/g)||[]).length;
check(laneABareEmpty===0,`lane A empty lines without a next action: ${laneABareEmpty}`);
// 패널마다 '…하지 않습니다' 부인문을 되풀이하지 않는다(UX-PLAN-3 4차원 5점 조건 138 → ≤30). 외부 전송·지출 범위는 공용 SafetyScope(components/app/safety-scope.tsx) 한 줄로 적고, 나머지는 하는 일로 쓴다.
const negativeSafety=(ownAScreens.match(/하지 않습니다/g)||[]).length;
check(negativeSafety<=budget.static.negativeSafety,`'하지 않습니다' ${negativeSafety} > budget ${budget.static.negativeSafety} (안전 범위는 SafetyScope로, 나머지는 하는 일로 쓰세요)`);
// 한국어 화면에 영문 대문자 머리말(예: 'CAMPAIGN OBJECTIVE')을 두지 않는다(UX-PLAN-3 4차원, 평가 7회차). 브랜드 이름 COLLECTIVE와 형식 이름(JSON)은 예외다.
const englishEyebrows=[...ownAScreens.matchAll(/>\s*([A-Z][A-Z'&]+(?:\s*[\/·]?\s*[A-Z][A-Z'&]+)*)\s*</g)].map(m=>m[1]).filter(t=>/[A-Z]{2,}/.test(t)&&!/^(COLLECTIVE|JSON|CSV|PNG|POS|ROAS|ROI|CTA|AI|URL|UTM|QR|SKU|HERMES|KST|ID|API|CS|MD|OFD|ODA)$/.test(t)&&t.length>=4);
check(englishEyebrows.length===0,`English eyebrows on Korean screens: ${englishEyebrows.join(' | ')}`);
// 성공 알림은 한 형식으로만 낸다(UX-PLAN-3 ⑤): lib/ui/notify.ts notifySaved — 제목은 '…습니다.' 한 문장, 덧붙임은 description, 되돌릴 수 있으면 '되돌리기'. 레인 A 화면은 toast.success를 직접 부르지 않는다.
const directToastSuccess=(ownAScreens.match(/\btoast\.success\(/g)||[]).length;
check(directToastSuccess<=budget.static.directToastSuccess,`direct toast.success in lane A screens ${directToastSuccess} > ${budget.static.directToastSuccess} (lib/ui/notify.ts notifySaved를 쓰세요)`);
// notifySaved 첫 인자의 글자 그대로 문구(조건식 양쪽·템플릿 끝 포함)는 모두 '습니다.'로 끝난다. 변수로 넘기는 문구는 타입(Saved)이 컴파일 때 막는다.
const notices=[];let undoNotices=0;
for(const n of readdirSync('app').filter(n=>n.endsWith('.tsx')&&!/^(franchise-|online-grading|quality-|brand-interview|reflector|usage-|customer-report)/.test(n))){
 const sf=ts.createSourceFile(n,readFileSync('app/'+n,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const leaves=e=>ts.isParenthesizedExpression(e)?leaves(e.expression):ts.isConditionalExpression(e)?[...leaves(e.whenTrue),...leaves(e.whenFalse)]:ts.isStringLiteral(e)||ts.isNoSubstitutionTemplateLiteral(e)?[e.text]:ts.isTemplateExpression(e)?[e.templateSpans.at(-1).literal.text]:[];
 const visit=x=>{if(ts.isCallExpression(x)&&ts.isIdentifier(x.expression)&&x.expression.text==='notifySaved'){notices.push(...leaves(x.arguments[0]).map(t=>({n,t})));const o=x.arguments[1];if(o&&ts.isObjectLiteralExpression(o)&&o.properties.some(p=>p.name?.getText()==='undo'))undoNotices++}ts.forEachChild(x,visit)};visit(sf);
}
const nonSentence=notices.filter(x=>!x.t.endsWith('습니다.'));
check(notices.length>0&&nonSentence.length===0,`success notices must be one sentence ending in '습니다.': ${nonSentence.map(x=>x.n+': '+x.t).join(' | ')}`);
// 되돌리기 알림 수는 줄지 않는다(바닥 래칫). 캠페인 보관·보관 해제·상시 지시 저장(2곳)·자료 일괄 검토·가맹 모집 스위치.
check(undoNotices>=budget.floors.undoNotices,`undo notices ${undoNotices} < floor ${budget.floors.undoNotices}`);
// 확인 대화상자는 무엇·영향·되돌리기를 모두 적는다(UX-PLAN-3 Q2·11차원 4점 조건). 타입이 영향·되돌림을 필수로 요구한다.
check(/impact:string;undo:string;/.test(readFileSync('components/app/confirm-dialog.tsx','utf8')),'ConfirmAsk must require impact and undo');
// 홈 첫 로딩 경계: 화면·대화상자는 lazy로만 불러온다.
const ws=readFileSync('app/workspace.tsx','utf8');
for(const m of budget.lazyOnly)check(!new RegExp(`^import [^;]*from '\\./${m}';`,'m').test(ws),`app/workspace.tsx must not statically import ./${m}`);
check(!/from '\.\/command-palette-dialog'/.test(readFileSync('app/command-palette.tsx','utf8'))||/lazy\(\(\)=>import\('\.\/command-palette-dialog'\)\)/.test(readFileSync('app/command-palette.tsx','utf8')),'command palette dialog is lazy');
check(/include=summary,stop/.test(readFileSync('app/growth-panel.tsx','utf8')),'growth tab reads view, panel summary and stop state in one request');
// 브라우저 번들에서 부수 효과 없음으로 표시한 lib 모듈(vite.config.ts PURE_CLIENT_LIB)은 최상위에 선언만 둔다. 최상위 실행문(등록·전역 변경)이 생기면 번들에서 빠질 수 있다.
const pureLib=readFileSync('vite.config.ts','utf8').match(/PURE_CLIENT_LIB = [^\n]*?\(\?:([\w|-]+)\)/)?.[1]?.split('|')??[];
check(pureLib.length>0,'vite.config.ts PURE_CLIENT_LIB list is readable');
const declarationKinds=new Set([ts.SyntaxKind.ImportDeclaration,ts.SyntaxKind.ExportDeclaration,ts.SyntaxKind.TypeAliasDeclaration,ts.SyntaxKind.InterfaceDeclaration,ts.SyntaxKind.FunctionDeclaration,ts.SyntaxKind.VariableStatement]);
for(const m of pureLib){const f=`lib/${m}.ts`,sf=ts.createSourceFile(f,readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true);const bad=sf.statements.filter(x=>!declarationKinds.has(x.kind)).map(x=>x.getText().slice(0,40));check(bad.length===0,`${f} must hold only declarations at top level: ${bad.join(' | ')}`)}
// 설정 '현재 사용할 수 있는 기능'에 내부 코드를 보이지 않는다(평가 9회차 결함 3: a6_data_requests·b4_reward_lineage·'B4-2c'·'워커 digest 큐'·'성장2 …').
// 1) 레인 A 행은 lib 문구(label·reason·link.label) 자체에 코드가 없다. 스위치 이름은 flag로만 넘기고 화면은 '자세히'의 기술 정보로 보인다.
// 2) 모든 행(다른 레인 행 포함)의 화면 모양(featureView)에도 코드와 ' · '가 없다. 다른 레인 문구는 공유 파일이라 고치지 않고 화면 단에서 숨긴다.
// 평가 보고서의 검사식에 growth_daily_loop처럼 첫 단어가 두 글자 이상인 스위치 이름을 더해 넓혔다.
{
 const {SourceTextModule,createContext}=await import('node:vm'),{resolve,dirname}=await import('node:path');
 const context=createContext({}),cache=new Map();
 const moduleFor=path=>{path=resolve(path);if(!cache.has(path))cache.set(path,new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path}));return cache.get(path)};
 const fs=moduleFor('lib/feature-status.ts');await fs.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await fs.evaluate();
 const {featureRows,featureView}=fs.namespace,plain=v=>JSON.parse(JSON.stringify(v));
 const CODE=/\b[a-z]\d?_[a-z_]+\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\bB\d-\d|성장2|digest/;
 const LANE_A_ROWS=['brand','ai','text','review','metrics','worker','png','buffer','measurement','data-requests','place-check','reward-lineage','playbook-signals','growth-daily','storefront-pull','pos-csv','pos-auto','video','ads'];
 const flagNames=['r_franchise','a6_data_requests','a6_place_check','a8_customer_report','b4_reward_lineage','b3_playbook_signals','b2_digest_queue','growth_daily_loop','storefront_pull','b3_reflector'];
 const now=Date.parse('2026-10-01T00:00:00.000Z'),brands=[{id:'b1'},{id:'b2'}],campaigns=[{id:'c1',brandId:'b1',updatedAt:'2026-09-30T00:00:00.000Z'}];
 const inputs=[{},{now,brands,campaigns,flags:flagNames.map(flag=>({flag,enabled:true})),connection:{configured:true},worker:{online:true},facts:[],publishers:{b1:true,b2:null},channels:[{label:'네이버 검색광고',connected:true},{label:'Instagram',connected:false}],brandChannels:[]},
  {now,brands,campaigns,flags:flagNames.map(flag=>({flag,enabled:false})),connection:{configured:false},worker:{registered:true,online:false},facts:[],publishers:{},channels:[{label:'네이버 검색광고',connected:false}],brandChannels:null}];
 const words=r=>[r.label,...(Array.isArray(r.reason)?r.reason:[r.reason||'']),r.link?.label||''];
 const all=inputs.flatMap(input=>plain(featureRows(input)));
 const laneA=all.filter(r=>LANE_A_ROWS.includes(r.key));
 check(new Set(laneA.map(r=>r.key)).size===LANE_A_ROWS.length,`lane A feature rows exist: ${LANE_A_ROWS.filter(k=>!laneA.some(r=>r.key===k)).join(', ')}`);
 const laneACodes=laneA.flatMap(r=>words(r).filter(t=>CODE.test(t)).map(t=>r.key+': '+t));
 check(laneACodes.length===0,`internal codes in lane A feature row words: ${laneACodes.join(' | ')}`);
 const laneADots=laneA.flatMap(r=>words(r).filter(t=>t.includes(' · ')).map(t=>r.key+': '+t));
 check(laneADots.length===0,`middle dot joins in lane A feature row words: ${laneADots.join(' | ')}`);
 const screen=inputs.flatMap(input=>featureRows(input).map(r=>plain(featureView(r))));
 const screenCodes=screen.flatMap(r=>[r.label,...r.reason,r.link?.label||''].filter(t=>CODE.test(t)||t.includes(' · ')).map(t=>r.key+': '+t));
 check(screenCodes.length===0,`internal codes or middle dots on the settings feature screen: ${screenCodes.join(' | ')}`);
 check(screen.some(r=>r.tech.includes('스위치 이름 a6_data_requests')),'switch names stay available as technical details');
 const panels=readFileSync('app/panels.tsx','utf8');
 check(panels.includes('rows.map(featureView)')&&panels.includes('<summary>자세히</summary>기술 정보: {metaText(r.tech)}'),'settings feature table renders featureView and keeps codes in the details');
}
// 레인 A 화면(app/*.tsx, components/**)의 글자 리터럴(문자열·템플릿·JSX 글자)에 시드·테스트 브랜드 이름을 하드코딩하지 않는다(평가 9회차 11차원: 브리프 목표 자리표시 '맵달서울').
// 브랜드 이름은 선택한 브랜드(brands)에서 읽는다. 목록은 lib/agency.ts brandDefaults와 테스트 시드에서 쓰는 이름이다. 주석, 시드 데이터(lib), 테스트 파일은 세지 않는다.
const seedBrandNames=/맵달|mapdal|old\s?ferry|올드\s?페리|oda\s?pizza|오다\s?피자|dr\.?\s?alan|닥터\s?알란/i;
const laneAFiles=[...readdirSync('app').filter(n=>n.endsWith('.tsx')&&!/^(franchise-|online-grading|quality-|brand-interview|reflector|usage-|customer-report)/.test(n)).map(n=>'app/'+n),...['components/app','components/ui'].flatMap(d=>readdirSync(d).filter(n=>n.endsWith('.tsx')).map(n=>d+'/'+n))];
const brandLiterals=[];
for(const f of laneAFiles){
 const sf=ts.createSourceFile(f,readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const visit=x=>{if((ts.isStringLiteral(x)||ts.isNoSubstitutionTemplateLiteral(x)||ts.isTemplateHead(x)||ts.isTemplateMiddle(x)||ts.isTemplateTail(x)||ts.isJsxText(x))&&seedBrandNames.test(x.text))brandLiterals.push(`${f}: ${x.text.trim().slice(0,40)}`);ts.forEachChild(x,visit)};visit(sf);
}
check(laneAFiles.length>100&&brandLiterals.length===0,`hardcoded seed brand names in lane A screens: ${brandLiterals.join(' | ')}`);
console.log(JSON.stringify({passed,now,directToastSuccess,notices:notices.length,undoNotices,brandLiterals:brandLiterals.length}));
