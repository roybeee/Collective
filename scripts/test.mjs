// tests/ 아래 모든 스위트를 순서대로 실행한다. 하나라도 실패하면 비영으로 끝난다.
// 스위트는 {"passed":N}을 출력한다. 출력하지 않는 스위트는 0으로 집계하고 통과 여부만 본다.
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const files = readdirSync('tests').filter(f => f.endsWith('.mjs')).sort();
let failed = 0, assertions = 0;

for (const file of files) {
 const run = spawnSync(process.execPath, ['--experimental-vm-modules', 'tests/' + file], {encoding: 'utf8'});
 const passed = Number((run.stdout.match(/"passed"\s*:\s*(\d+)/) || [])[1] || 0);
 assertions += passed;
 if (run.status !== 0) {
  failed++;
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
 }
 process.stdout.write(`${run.status === 0 ? 'PASS' : 'FAIL'}  ${file.padEnd(28)} ${passed || '-'}\n`);
}

process.stdout.write(`\n${files.length - failed}/${files.length} suites, ${assertions} assertions\n`);
process.exit(failed ? 1 : 0);
