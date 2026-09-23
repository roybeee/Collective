// E2E 전용 로컬 서버. 매 실행마다 빈 로컬 D1을 만들고 drizzle/ 마이그레이션을 적용한 뒤
// 빌드 결과(dist/)를 wrangler --local로 띄운다. 운영 D1/R2에는 연결하지 않는다.
// 빌드는 하지 않는다. 먼저 `node scripts/run-framework.mjs build`를 실행한다.
import {existsSync, readdirSync, rmSync} from 'node:fs';
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
const authArgs = emailAuth ? ['--local-protocol','https','--var','AUTH_MODE:email','--var',`AUTH_ORIGIN:https://127.0.0.1:${port}`,'--var','AUTH_BOOTSTRAP_EMAIL:admin@example.test','--var','AUTH_BOOTSTRAP_OWNER:e2e-email-owner','--var',`AUTH_BOOTSTRAP_TOKEN_HASH:${createHash('sha256').update('e2e-only-bootstrap-token-do-not-use-in-production').digest('hex')}`] : [];
const server = spawn(process.execPath, [...wrangler, 'dev', '--config', config, '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', port, '--inspector-port', '0', ...(emailAuth?['--upstream-protocol','https']:[]), ...authArgs], {stdio: 'inherit'});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code ?? 0));
