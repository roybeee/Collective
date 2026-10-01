// UX-PLAN-3 Q0·Q7: 화면 품질 래칫. 아래 수치는 기준값 이하로만 내려갈 수 있다(올라가면 실패). 줄였으면 tests/ux-budget.json을 함께 낮춘다.
// 런타임 예산(홈 JS·성장 탭 요청·axe·44px)은 e2e/ux-budget.spec.ts가 같은 파일로 확인한다.
// 홈 첫 로딩을 무겁게 만드는 정적 import도 막는다. 가맹(franchise-*)·온라인 채점(online-grading) 화면은 R·Q 소유라 계수에서 뺀다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const budget=JSON.parse(readFileSync('tests/ux-budget.json','utf8'));
const app=readdirSync('app').filter(n=>n.endsWith('.tsx')&&!n.startsWith('franchise-')&&n!=='online-grading.tsx').map(n=>readFileSync('app/'+n,'utf8')).join('\n');
const css=readdirSync('app').filter(n=>n.endsWith('.css')).map(n=>readFileSync('app/'+n,'utf8')).join('\n');
const count=(src,re)=>(src.match(re)||[]).length;
export const measure=()=>({
 rawButtons:count(app,/<button\b/g),
 rawFormControls:count(app,/<(?:input|select|textarea)\b/g),
 confirmCalls:count(app,/\bconfirm\(/g),
 inlineStyles:count(app,/style=\{\{/g),
 hexColors:new Set(css.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)||[]).size,
 mediaWidths:new Set((css.match(/(?:max|min)-width: ?\d+px/g)||[]).map(x=>x.replace(/\s/g,''))).size,
 middleDotJoins:count(app,/ · /g),
});
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const now=measure();
for(const [k,v] of Object.entries(now))check(v<=budget.static[k],`${k} ${v} > budget ${budget.static[k]} (줄였으면 예산을 낮추고, 늘었으면 공용 부품을 쓰세요)`);
// 홈 첫 로딩 경계: 화면·대화상자는 lazy로만 불러온다.
const ws=readFileSync('app/workspace.tsx','utf8');
for(const m of budget.lazyOnly)check(!new RegExp(`^import [^;]*from '\\./${m}';`,'m').test(ws),`app/workspace.tsx must not statically import ./${m}`);
check(!/from '\.\/command-palette-dialog'/.test(readFileSync('app/command-palette.tsx','utf8'))||/lazy\(\(\)=>import\('\.\/command-palette-dialog'\)\)/.test(readFileSync('app/command-palette.tsx','utf8')),'command palette dialog is lazy');
check(/include=summary,stop/.test(readFileSync('app/growth-panel.tsx','utf8')),'growth tab reads view, panel summary and stop state in one request');
console.log(JSON.stringify({passed,now}));
