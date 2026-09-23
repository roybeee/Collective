// 기존 lint 오류를 한 번에 고치지 않는다. 대신 기준선을 고정하고 증가를 막는다.
// 감소 시 기준선 갱신 강제: 수치가 줄면 --update로 scripts/lint-baseline.json을 함께 낮춰야 통과한다(한 방향 래칫).
import {readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const BASELINE = 'scripts/lint-baseline.json';
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const run = spawnSync(process.execPath, ['node_modules/eslint/bin/eslint.js', '.', '--ignore-pattern', 'dist', '--ignore-pattern', '.next', '-f', 'json'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
if (!run.stdout) {
 process.stderr.write(run.stderr || 'eslint 출력을 받지 못했습니다.\n');
 process.exit(1);
}
const results = JSON.parse(run.stdout);
const errors = results.reduce((sum, r) => sum + r.errorCount, 0);
const warnings = results.reduce((sum, r) => sum + r.warningCount, 0);
process.stdout.write(`eslint errors ${errors} (기준선 ${baseline.errors}) · warnings ${warnings} (기준선 ${baseline.warnings})\n`);

if (process.argv.includes('--update')) {
 writeFileSync(BASELINE, JSON.stringify({errors, warnings}, null, 1) + '\n');
 process.stdout.write('기준선을 현재 값으로 갱신했습니다.\n');
 process.exit(0);
}
if (errors > baseline.errors) {
 process.stderr.write(`lint 오류가 기준선보다 ${errors - baseline.errors}건 늘었습니다. 새로 추가한 오류를 고치세요.\n`);
 process.exit(1);
}
if (warnings > baseline.warnings) {
 process.stderr.write(`lint 경고가 기준선보다 ${warnings - baseline.warnings}건 늘었습니다.\n`);
 process.exit(1);
}
// 증가를 먼저 본다. 한쪽이 늘고 다른 쪽이 줄었을 때 --update로 증가분이 기준선에 흡수되지 않게 한다.
if (errors < baseline.errors || warnings < baseline.warnings) {
 process.stderr.write('lint 수치가 기준선보다 줄었습니다. node scripts/lint-gate.mjs --update로 기준선을 낮춰 함께 커밋하세요.\n');
 process.exit(1);
}
