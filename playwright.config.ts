// E2E 스모크. 실행 방법과 실제/모의 구분은 docs/E2E.ko.md.
// `pnpm run`은 이 저장소에서 실패하므로 node로 직접 실행한다:
//   node scripts/run-framework.mjs build
//   node node_modules/@playwright/test/cli.js test
import {defineConfig, devices} from '@playwright/test';

const port = Number(process.env.E2E_PORT || 8799);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/artifacts/test-results',
  // 한 서버·한 로컬 D1을 공유하므로 순서대로 실행한다.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {baseURL, trace: 'retain-on-failure'},
  projects: [
    {name: 'mobile', use: {...devices['Desktop Chrome'], viewport: {width: 390, height: 844}}},
    {name: 'desktop', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 800}}},
  ],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `${baseURL}/`,
    env: {E2E_PORT: String(port)},
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
