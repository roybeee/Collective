// lint 기준선 게이트의 판정. 증가는 막고, 감소는 기준선 갱신을 요구해 한 방향으로만 내려가게 한다.
// 실제 eslint 대신 개수만 출력하는 가짜 eslint를 임시 폴더에 두고 scripts/lint-gate.mjs를 그대로 실행한다.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'lint-gate-'));
mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'node_modules/eslint/bin'),{recursive:true});
copyFileSync('scripts/lint-gate.mjs',join(dir,'scripts/lint-gate.mjs'));
writeFileSync(join(dir,'node_modules/eslint/bin/eslint.js'),"const [e,w]=process.env.FAKE_LINT.split(',').map(Number);process.stdout.write(JSON.stringify([{errorCount:e,warningCount:w}]));\n");
const baseline=(errors,warnings)=>writeFileSync(join(dir,'scripts/lint-baseline.json'),JSON.stringify({errors,warnings}));
const gate=(counts,...args)=>spawnSync(process.execPath,['scripts/lint-gate.mjs',...args],{cwd:dir,encoding:'utf8',env:{...process.env,FAKE_LINT:counts}});
let passed=0;
function check(name,condition){assert.ok(condition,name);passed++}
try{
 baseline(5,2);
 check('equal counts pass',gate('5,2').status===0);
 const moreErrors=gate('6,2');
 check('more errors fail',moreErrors.status===1&&moreErrors.stderr.includes('1건 늘었습니다'));
 check('more warnings fail',gate('5,3').status===1);
 const fewerErrors=gate('4,2');
 check('fewer errors fail until the baseline is lowered',fewerErrors.status===1&&fewerErrors.stderr.includes('--update'));
 check('fewer warnings fail until the baseline is lowered',gate('5,1').status===1);
 const mixed=gate('4,3');
 check('an increase is reported before a decrease so --update cannot absorb it',mixed.status===1&&mixed.stderr.includes('경고가 기준선보다 1건 늘었습니다')&&!mixed.stderr.includes('--update'));
 check('update lowers the baseline to the current counts',gate('4,1','--update').status===0&&JSON.stringify(JSON.parse(readFileSync(join(dir,'scripts/lint-baseline.json'),'utf8')))==='{"errors":4,"warnings":1}');
 check('lowered baseline passes',gate('4,1').status===0);
}finally{rmSync(dir,{recursive:true,force:true})}
console.log(JSON.stringify({passed}));
