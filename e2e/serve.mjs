// E2E 전용 로컬 서버. 매 실행마다 빈 로컬 D1을 만들고 drizzle/ 마이그레이션을 적용한 뒤
// 빌드 결과(dist/)를 wrangler --local로 띄운다. 운영 D1/R2에는 연결하지 않는다.
// 빌드는 하지 않는다. 먼저 `node scripts/run-framework.mjs build`를 실행한다.
import {existsSync, readdirSync, rmSync, mkdirSync, createWriteStream} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const port = process.env.E2E_PORT || '8799';
const emailAuth = process.env.E2E_EMAIL_AUTH === '1';
const state = emailAuth ? 'e2e/.state-auth' : 'e2e/.state';
const config = 'dist/server/wrangler.json';
const wrangler = ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js'];

if (!existsSync(config)) {
  process.stderr.write(`${config}가 없습니다. 먼저 node scripts/run-framework.mjs build 를 실행하세요.\n`);
  process.exit(1);
}

rmSync(state, {recursive: true, force: true});
for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) {
  const run = spawnSync(process.execPath, [...wrangler, 'd1', 'execute', 'DB', '--config', config, '--local', '--persist-to', state, '--file', `drizzle/${file}`], {encoding: 'utf8'});
  if (run.status !== 0) {
    process.stderr.write(run.stdout + run.stderr);
    process.stderr.write(`마이그레이션 ${file} 적용에 실패했습니다.\n`);
    process.exit(1);
  }
}

// Public test-only bootstrap fixture; never used against a remote database.
// 운영 빌드는 AUTH_MODE가 비면 503으로 닫히므로 기본(헤더 모의) 여정은 legacy를 명시한다.
const authArgs = emailAuth ? ['--local-protocol','https','--var','AUTH_MODE:email','--var',`AUTH_ORIGIN:https://127.0.0.1:${port}`,'--var','AUTH_BOOTSTRAP_EMAIL:admin@example.test','--var','AUTH_BOOTSTRAP_OWNER:e2e-email-owner','--var',`AUTH_BOOTSTRAP_TOKEN_HASH:${createHash('sha256').update('e2e-only-bootstrap-token-do-not-use-in-production').digest('hex')}`] : ['--var','AUTH_MODE:legacy'];
const server = spawn(process.execPath, [...wrangler, 'dev', '--config', config, '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', port, '--inspector-port', '0', ...(emailAuth?['--upstream-protocol','https']:[]), ...authArgs], {stdio: ['inherit', 'pipe', 'inherit']});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
// workerd는 크래시 사유(예: *** Received signal #11)를 stdout으로 낸다. Playwright webServer는 stdout을 버리므로
// CI에서 사유가 사라졌다. stdout은 그대로 흘려보내되 크래시 관련 줄만 stderr에도 복사하고, 종료 코드·시그널을 남긴다.
const crashLine = /Received signal|Fatal|fatal error|uncaught|out of memory|Segmentation|Aborted|core dumped/i;
// 서버 stdout 전체(요청마다 wrangler가 적는 경로·상태·처리 시간 포함)를 줄마다 UTC 시각을 붙여 e2e/artifacts/server-<여정>.log에 남긴다.
// CI는 e2e/artifacts/를 늘 올린다. 응답 없이 멈춘 요청(예: meeting-quality.spec.ts:40의 첫 GET /api/workspace 60초 초과, docs/STATUS.md 테스트 흔들림)을
// Playwright 시각과 맞춰 조사하려는 것이다. 이 파일은 로컬 E2E D1의 합성 데이터 요청 기록만 담는다.
mkdirSync('e2e/artifacts', {recursive: true});
const serverLog = createWriteStream(`e2e/artifacts/server-${emailAuth ? 'auth' : 'default'}.log`, {flags: 'w'});
let pending = '';
server.stdout.on('data', chunk => {
 process.stdout.write(chunk);
 const lines = (pending + chunk.toString('utf8')).split('\n');
 pending = lines.pop() ?? '';
 for (const line of lines) {
  serverLog.write(`${new Date().toISOString()} ${line.replace(/\x1b\[[0-9;]*m/g, '')}\n`);
  if (crashLine.test(line)) process.stderr.write(`[serve] ${line}\n`);
 }
});
server.on('exit', (code, signal) => {
 if (pending && crashLine.test(pending)) process.stderr.write(`[serve] ${pending}\n`);
 if (code !== 0 || signal) process.stderr.write(`[serve] wrangler exited code=${code} signal=${signal}\n`);
 process.exit(code ?? 0);
});
