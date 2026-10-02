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
 // 화면 폭 중단점은 @media 조건의 폭만 센다(요소의 min-width 같은 크기 지정은 중단점이 아니다).
 mediaWidths:new Set((css.match(/@media[^{]*?\((?:max|min)-width: ?\d+px\)/g)||[]).map(x=>x.match(/\d+/)[0])).size,
 middleDotJoins:count(app,/ · /g),
});
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const now=measure();
for(const [k,v] of Object.entries(now))check(v<=budget.static[k],`${k} ${v} > budget ${budget.static[k]} (줄였으면 예산을 낮추고, 늘었으면 공용 부품을 쓰세요)`);
// 패널 안내문(Note)의 첫 문장은 60자 이하(UX-PLAN-3 Q4). 첫 문장은 늘 다 보이고 나머지는 '자세히'로 편다.
const longNotes=[...app.matchAll(/<Note[^>]*>([^<{]+)<\/Note>/g)].map(m=>m[1].trim().split(/(?<=[.다요])\s/)[0]).filter(f=>f.length>60);
check(longNotes.length===0,`Note first sentence over 60 chars: ${longNotes.join(' | ')}`);
// 패널 머리 문단(제목 바로 뒤 <p>)은 60자 이하로 쓴다. 다른 레인 소유 화면(가맹·품질 콘솔·품질 운영·인터뷰·Reflector·사용량·고객 보고서)은 세지 않는다. 더 길면 첫 문장만 보이는 Note를 쓴다(UX-PLAN-3 4차원 4점 조건 '패널 첫 문단 60자').
const ownA=readdirSync('app').filter(n=>n.endsWith('.tsx')&&!/^(franchise-|online-grading|quality-|brand-interview|reflector|usage-panel|customer-report)/.test(n)).map(n=>readFileSync('app/'+n,'utf8')).join('\n');
const longLeads=[...ownA.matchAll(/<h[23][^>]*>[^<{]*<\/h[23]>\s*<p(?: className=[^>]*)?>([^<{]+)<\/p>/g)].map(m=>m[1].trim()).filter(t=>t.length>60);
check(longLeads.length===0,`header paragraph over 60 chars: ${longLeads.join(' | ')}`);
// 저장 동사는 '저장'(서버에 쓰기)과 '기록'(관측·확인 사실 남기기) 두 가지만 버튼에 쓴다(UX-PLAN-3 4차원 4점 조건). '사전등록'은 실험 용어라 예외다.
const otherVerbs=[...ownA.matchAll(/<(?:Button|CardButton)[^>]*>(?:<[A-Za-z]+\/>)?([^<>{}]{1,24}(?:등록|추가))<\/(?:Button|CardButton)>/g)].map(m=>m[1].trim()).filter(t=>!t.endsWith('사전등록'));
check(otherVerbs.length===0,`save buttons must use 저장 or 기록: ${otherVerbs.join(' | ')}`);
// 확인 대화상자는 무엇·영향·되돌리기를 모두 적는다(UX-PLAN-3 Q2·11차원 4점 조건). 타입이 영향·되돌림을 필수로 요구한다.
check(/impact:string;undo:string;/.test(readFileSync('components/app/confirm-dialog.tsx','utf8')),'ConfirmAsk must require impact and undo');
// 홈 첫 로딩 경계: 화면·대화상자는 lazy로만 불러온다.
const ws=readFileSync('app/workspace.tsx','utf8');
for(const m of budget.lazyOnly)check(!new RegExp(`^import [^;]*from '\\./${m}';`,'m').test(ws),`app/workspace.tsx must not statically import ./${m}`);
check(!/from '\.\/command-palette-dialog'/.test(readFileSync('app/command-palette.tsx','utf8'))||/lazy\(\(\)=>import\('\.\/command-palette-dialog'\)\)/.test(readFileSync('app/command-palette.tsx','utf8')),'command palette dialog is lazy');
check(/include=summary,stop/.test(readFileSync('app/growth-panel.tsx','utf8')),'growth tab reads view, panel summary and stop state in one request');
console.log(JSON.stringify({passed,now}));
