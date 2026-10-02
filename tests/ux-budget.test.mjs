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
export const measure=()=>({
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
console.log(JSON.stringify({passed,now,directToastSuccess,notices:notices.length,undoNotices}));
