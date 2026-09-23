import {test,expect} from '@playwright/test';

// Real browser Canvas and local D1/R2. Dispatcher identity is injected; no external publishing.
test('확인 사실로 실제 PNG를 만들고 새로고침 뒤 내려받는다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`execution-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();await page.request.get('/api/workspace');
 const title='실행 카드 '+info.project.name;
 const created=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'확인 사실 안내',budget:0}}});expect(created.status()).toBe(200);const campaign=await created.json();
 await page.goto('/');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'제작·발행',exact:true}).click();
 const steps=page.getByRole('list',{name:'첫 게시 단계',exact:true});
 await expect(steps.locator('[aria-current="step"]')).toHaveText('사실 확정');
 await page.getByRole('button',{name:'사실 추가',exact:true}).click();
 // 표준 항목(대표 메뉴)은 지점별 항목이 아니라 브랜드 공통 저장에 범위 확인이 필요 없다.
 const form=page.getByRole('form',{name:'브랜드 사실 편집'});
 await form.getByRole('combobox',{name:'사실 항목',exact:true}).selectOption('signature_menu');await form.getByLabel('확인할 내용',{exact:true}).fill('테스트 대표 메뉴 107');await form.getByRole('combobox',{name:'사실 상태',exact:true}).selectOption('confirmed');
 await form.getByLabel('확인 근거 · 문서·담당자·URL',{exact:true}).fill('브라우저 회귀 테스트');
 await form.getByLabel('확인 시점 · 현재 기기 시간대',{exact:true}).fill('2020-01-01T12:00');await form.getByLabel('유효 기한 · 현재 기기 시간대',{exact:true}).fill('2099-01-01T12:00');
 for(const box of await form.getByRole('checkbox').all())await box.check();
 await form.getByRole('button',{name:'사실 저장',exact:true}).click();await expect(form).toBeHidden();
 // 캡션·PNG에는 내부 key(signature_menu) 대신 표준 라벨이 쓰인다.
 await page.getByRole('checkbox',{name:/대표 메뉴: 테스트 대표 메뉴 107/}).check();
 const save=page.waitForResponse(r=>r.url().endsWith('/api/execution')&&r.request().postDataJSON()?.action==='save_creative');await page.getByRole('button',{name:'PNG 제작·저장',exact:true}).click();expect((await save).status()).toBe(200);
 await expect(page.getByAltText('제작한 안내 카드 미리보기')).toBeVisible();
 const state=await(await page.request.get('/api/execution?campaignId='+campaign.id)).json();expect(state.creatives).toHaveLength(1);expect(state.publications).toHaveLength(0);expect(state.creatives[0].caption).toBe('대표 메뉴: 테스트 대표 메뉴 107');expect(state.creatives[0].current).toBe(true);
 const asset=await page.request.get('/api/execution/asset?id='+state.creatives[0].id);expect(asset.status()).toBe(200);const bytes=await asset.body();expect(bytes.readUInt32BE(16)).toBe(1080);expect(bytes.readUInt32BE(20)).toBe(1080);
 // 외부 주소 없이 초안을 만들면 승인 때 앱 공개 주소를 채운다. 승인 전에는 공개 주소가 없다.
 const draft=await page.request.post('/api/execution',{data:{action:'save_publication',campaignId:campaign.id,creativeId:state.creatives[0].id,scheduledAt:new Date(Date.now()+86400000).toISOString(),plannedCostKRW:0}});expect(draft.status()).toBe(200);const publication=await draft.json();expect(publication.mediaMode).toBe('auto');expect(publication.mediaUrl).toBe('');
 await page.reload();await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'제작·발행',exact:true}).click();await expect(page.getByRole('link',{name:'원본 PNG 내려받기',exact:true})).toBeVisible();
 await expect(page.getByText('발행 연결: 연결 필요',{exact:true})).toBeVisible();await expect(steps.locator('[aria-current="step"]')).toHaveText('채널');
 await expect(page.getByText('고급: 외부 호스트',{exact:true})).toBeVisible();
 // 승인 버튼 옆 차단 사유: 한도·채널·기획 승인·기간. 기본 한도 버튼으로 한도 사유가 사라진다.
 const blockers=page.getByRole('list',{name:'승인 차단 사유',exact:true});
 for(const reason of ['한도 미설정','채널 미연결','기획 미승인','기간 밖','권리 확인 필요'])await expect(blockers).toContainText(reason);
 await expect(page.getByRole('button',{name:'이 버전 발행 승인',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'기본 한도(발행 1회·0원) 저장',exact:true}).first().click();await expect(page.getByText('기본 한도(발행 1회·0원)를 저장했습니다.',{exact:true})).toBeVisible();
 await expect(blockers).not.toContainText('한도 미설정');expect((await(await page.request.get('/api/execution?campaignId='+campaign.id)).json()).limits).toMatchObject({maxPublications:1,maxPlannedCostKRW:0});
 await page.screenshot({path:`e2e/artifacts/${info.project.name}-execution.png`,fullPage:true});
 await context.close();
});
