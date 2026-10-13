// 실제 SQLite + 모의 공급자: 한국 일요일·월요일 경계에서도 동일한 서버 검사를 실행한다.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const cases=[
 ['한국 일요일 23:59','2026-10-11T14:59:00.000Z'],
 ['한국 월요일 00:01','2026-10-11T15:01:00.000Z'],
 ['실패 재현 시각: 한국 월요일 01:00','2026-10-11T16:00:00.000Z'],
 ['한국 월요일 10:01','2026-10-12T01:01:00.000Z'],
];
let passed=0;
for(const [label,fixtureNow] of cases){
 const run=spawnSync(process.execPath,['--experimental-vm-modules','tests/product-research-server-round2.test.mjs'],{
  encoding:'utf8',timeout:30000,env:{...process.env,PRODUCT_RESEARCH_TEST_NOW:fixtureNow},
 });
 assert.equal(run.status,0,`${label}: ${run.error?.message??''}\n${run.stdout}\n${run.stderr}`);
 const result=JSON.parse(run.stdout.trim());
 assert.equal(result.fixtureNow,fixtureNow,label);
 assert.equal(result.passed,39,`${label}: 기존 이상치·보정·잠금·출시 검사를 모두 유지한다`);
 assert.equal(result.external,0,label);
 passed++;
}
console.log(JSON.stringify({passed,sqlite:'real',providers:'mocked',clock:'injected',external:0}));
