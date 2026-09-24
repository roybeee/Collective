// B2 품질 콘솔 여정: 소유자 로그인 → 사이드바 '품질 콘솔' 진입 → 표 표시 → 주간 다이제스트 받기(다운로드 이벤트).
// 로컬 빌드(wrangler --local)와 실제 로컬 D1을 쓰고 dispatcher 로그인 헤더를 직접 붙인다(mocked auth, navigation.spec.ts와 같은 방식). 모델 호출은 없다.
// 판정 1건은 직접 등록한 작업물을 승인해서 만든다(사람 판정 로그 B1). 직원 진입점 숨김은 이메일 인증 여정이 아니라 회귀 스위트(tests/quality-console-route.test.mjs)가 본다.
import {test,expect,type Page} from '@playwright/test';

const isMobile=(page:Page)=>(page.viewportSize()?.width??1280)<768;

test('소유자는 품질 콘솔에서 지표 표를 보고 주간 다이제스트를 내려받는다',async({browser},testInfo)=>{
 const owner=`e2e-quality-${testInfo.project.name}-${Date.now()}`;
 const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,viewport:testInfo.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner},acceptDownloads:true});
 const page=await context.newPage();
 await page.request.get('/api/workspace');
 const saved=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'oda',title:'품질 콘솔 검증',goal:'판정 기록을 콘솔에서 확인한다',budget:0}}});
 expect(saved.status()).toBe(200);
 const {id}=await saved.json() as {id:string};
 const artifact=await page.request.post('/api/action',{data:{action:'save_artifact',campaignId:id,role:'cmo',title:'콘솔 검증 전략',content:'## 목표\n평일 방문을 늘리는 실행 초안입니다.'}});
 expect(artifact.status()).toBe(200);
 const reviewed=await page.request.post('/api/action',{data:{action:'review_artifact',id:(await artifact.json() as {id:string}).id,version:1,decision:'approved'}});
 expect(reviewed.status()).toBe(200);
 const view=await page.request.get('/api/quality-console');
 expect(view.status()).toBe(200);
 expect((await view.json() as {read:{decisions:number}}).read.decisions).toBe(1);

 await page.goto('/');
 if(isMobile(page))await page.getByRole('button',{name:'Toggle Sidebar'}).click();
 await page.getByRole('button',{name:'품질 콘솔',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'품질 콘솔'});
 await expect(sheet).toBeVisible();
 await expect(sheet.getByText('자동 판정이 아니',{exact:false}).first()).toBeVisible();
 // 판정 보정(κ) 표는 표본이 없어도 5기준 행을 보여 주고 '보정 불가'로 표시한다.
 const kappa=sheet.getByRole('table',{name:'기준별 판정 보정(κ)'});
 await expect(kappa).toBeVisible();
 await expect(kappa.getByRole('row')).toHaveCount(6);
 await expect(kappa.getByText('보정 불가',{exact:false}).first()).toBeVisible();

 const download=page.waitForEvent('download');
 await sheet.getByRole('button',{name:'주간 다이제스트 받기',exact:true}).click();
 const file=await download;
 expect(file.suggestedFilename()).toMatch(/^collective-quality-digest-\d{4}-W\d{2}\.md$/);
 await context.close();
});
