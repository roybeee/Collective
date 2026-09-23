import {test,expect} from '@playwright/test';

// Real browser Canvas and local D1/R2. Dispatcher identity is injected; no external publishing.
test('확인 사실로 실제 PNG를 만들고 새로고침 뒤 내려받는다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`execution-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();await page.request.get('/api/workspace');
 const title='실행 카드 '+info.project.name;
 const created=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'확인 사실 안내',budget:0}}});expect(created.status()).toBe(200);const campaign=await created.json();
 await page.goto('/');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'제작·발행',exact:true}).click();
 await page.getByRole('button',{name:'사실 추가',exact:true}).click();
 const form=page.getByRole('form',{name:'브랜드 사실 편집'});
 await form.getByLabel('사실 항목',{exact:true}).fill('주소');await form.getByLabel('확인할 내용',{exact:true}).fill('서울시 테스트 주소 107호');await form.getByRole('combobox',{name:'사실 상태',exact:true}).selectOption('confirmed');
 await form.getByLabel('확인 근거 · 문서·담당자·URL',{exact:true}).fill('브라우저 회귀 테스트');
 await form.getByLabel('확인 시점 · 현재 기기 시간대',{exact:true}).fill('2020-01-01T12:00');await form.getByLabel('유효 기한 · 현재 기기 시간대',{exact:true}).fill('2099-01-01T12:00');
 await form.getByRole('checkbox').check();await form.getByRole('button',{name:'사실 저장',exact:true}).click();await expect(form).toBeHidden();
 await page.getByRole('checkbox',{name:/주소: 서울시 테스트 주소 107호/}).check();
 const save=page.waitForResponse(r=>r.url().endsWith('/api/execution')&&r.request().postDataJSON()?.action==='save_creative');await page.getByRole('button',{name:'PNG 제작·저장',exact:true}).click();expect((await save).status()).toBe(200);
 await expect(page.getByAltText('제작한 안내 카드 미리보기')).toBeVisible();
 const state=await(await page.request.get('/api/execution?campaignId='+campaign.id)).json();expect(state.creatives).toHaveLength(1);expect(state.publications).toHaveLength(0);
 const asset=await page.request.get('/api/execution/asset?id='+state.creatives[0].id);expect(asset.status()).toBe(200);const bytes=await asset.body();expect(bytes.readUInt32BE(16)).toBe(1080);expect(bytes.readUInt32BE(20)).toBe(1080);
 await page.reload();await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'제작·발행',exact:true}).click();await expect(page.getByRole('link',{name:'원본 PNG 내려받기',exact:true})).toBeVisible();
 await expect(page.getByText('발행 연결: 연결 필요',{exact:true})).toBeVisible();await expect(page.getByText('아직 발행 이력이 없습니다.',{exact:true})).toBeVisible();
 await page.screenshot({path:`e2e/artifacts/${info.project.name}-execution.png`,fullPage:true});
 await context.close();
});
