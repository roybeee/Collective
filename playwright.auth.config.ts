import {defineConfig,devices} from '@playwright/test';
const baseURL='https://127.0.0.1:8800';
export default defineConfig({
 testDir:'e2e',testMatch:'email-auth.spec.ts',workers:1,retries:0,timeout:90_000,
 outputDir:'e2e/artifacts/auth-results',reporter:[['list']],
 use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},baseURL,ignoreHTTPSErrors:true,trace:'retain-on-failure'},
 webServer:{command:'node e2e/serve.mjs',url:baseURL,ignoreHTTPSErrors:true,env:{E2E_PORT:'8800',E2E_EMAIL_AUTH:'1'},reuseExistingServer:false,timeout:120_000},
});
