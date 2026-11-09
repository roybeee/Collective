import {defineConfig,devices} from '@playwright/test';
// 포트는 E2E_AUTH_PORT로 바꿀 수 있다(기본 8800). 셀프 가입 여정(signup.spec.ts, G8)도 같은 이메일 인증 서버에서 돈다.
const port=process.env.E2E_AUTH_PORT||'8800',baseURL=`https://127.0.0.1:${port}`;
export default defineConfig({
 testDir:'e2e',testMatch:['email-auth.spec.ts','signup.spec.ts'],workers:1,retries:0,timeout:90_000,
 outputDir:'e2e/artifacts/auth-results',reporter:[['list']],
 use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},baseURL,ignoreHTTPSErrors:true,trace:'retain-on-failure'},
 webServer:{command:'node e2e/serve.mjs',url:baseURL,ignoreHTTPSErrors:true,env:{E2E_PORT:port,E2E_EMAIL_AUTH:'1'},reuseExistingServer:false,timeout:120_000},
});
