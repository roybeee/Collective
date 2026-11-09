// G7 범위 역할 E2E(이메일 로그인 서버, 여러 계정). 실행: 먼저 `node scripts/run-framework.mjs build` 뒤
//   E2E_PORT=8842 node node_modules/@playwright/test/cli.js test -c playwright.roles.config.ts
// 기본 설정(playwright.config.ts, legacy 헤더 모의)은 계정이 하나뿐이라 e2e/roles.spec.ts를 건너뛴다(E2E_ROLES로 구분).
import {defineConfig,devices} from '@playwright/test';
process.env.E2E_ROLES='1';
const port=Number(process.env.E2E_PORT||8842);
const baseURL=`https://127.0.0.1:${port}`;
export default defineConfig({
 testDir:'e2e',testMatch:'roles.spec.ts',workers:1,fullyParallel:false,retries:0,timeout:120_000,
 outputDir:'e2e/artifacts/roles-results',reporter:[['list']],
 use:{baseURL,ignoreHTTPSErrors:true,trace:'retain-on-failure'},
 projects:[
  {name:'mobile',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844}}},
  {name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:800}}},
 ],
 webServer:{command:'node e2e/serve.mjs',url:baseURL,ignoreHTTPSErrors:true,env:{E2E_PORT:String(port),E2E_EMAIL_AUTH:'1'},reuseExistingServer:false,timeout:120_000},
});
