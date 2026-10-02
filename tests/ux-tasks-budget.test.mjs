// UX-PLAN-3 10.5 완료 판정: 핵심 8과제 클릭 수가 기준선(Sites83) 대비 −40% 이상 줄었는지 정적으로 묶는다.
// 실제 클릭 수는 e2e/ux-tasks.spec.ts가 각 과업 예산 이하인지 확인한다(real local D1/API/Chromium). 이 검사는 예산 합계가 목표를 넘지 않게 한다.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const b=JSON.parse(readFileSync('tests/ux-tasks.json','utf8'));let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const ids=Object.keys(b.tasks);check(ids.length===8&&ids.join()==='1,2,3,4,5,6,7,8','eight core tasks');
for(const p of ['desktop','mobile']){
 const now=ids.reduce((t,id)=>t+b.tasks[id].clicks[p],0),base=ids.reduce((t,id)=>t+b.tasks[id].baseline[p],0);
 check(base===b.baselineTotal[p],`${p} baseline per task sums to the recorded total`);
 check(now<=Math.floor(base*b.targetRatio),`${p} clicks ${now} ≤ ${b.targetRatio}×baseline ${base}`);
 check(ids.every(id=>b.tasks[id].clicks[p]<=b.tasks[id].baseline[p]),`${p} no task is worse than baseline`);
}
console.log(JSON.stringify({passed}));
