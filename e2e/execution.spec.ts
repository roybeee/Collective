import {test,expect} from '@playwright/test';

// Real browser Canvas and local D1/R2. Dispatcher identity is injected; no external publishing.
test('확인 사실로 실제 PNG를 만들고 새로고침 뒤 내려받는다',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`execution-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();await page.request.get('/api/workspace');
 const title='실행 카드 '+info.project.name;
 const created=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'확인 사실 안내',budget:0}}});expect(created.status()).toBe(200);const campaign=await created.json();
 // A4-2: 브랜드 공통 캠페인의 게시 코드는 같은 브랜드 지점을 골라 발급한다. 화면이 지점 목록을 불러오기 전에 지점을 만든다.
 const storeName='실행 코드 지점 '+info.project.name+' '+Date.now();
 const store=await page.request.post('/api/stores',{data:{action:'save_store',brandId:'ofd',data:{name:storeName,address:'서울 성수동 테스트 주소',tradeArea:'residential',goal:'평일 포장 주문 증가'}}});expect(store.status()).toBe(200);
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
 // 소재 제목은 선택이다. 해시·캡션에 들어가지 않고 소재 목록·발행 준비 선택에 보인다.
 const creativeTitle='오픈 메뉴 안내 '+info.project.name;await page.getByLabel('소재 제목 (선택)',{exact:true}).fill(creativeTitle);
 const save=page.waitForResponse(r=>r.url().endsWith('/api/execution')&&r.request().postDataJSON()?.action==='save_creative');await page.getByRole('button',{name:'PNG 제작·저장',exact:true}).click();expect((await save).status()).toBe(200);
 await expect(page.getByAltText('제작한 안내 카드 미리보기')).toBeVisible();
 const state=await(await page.request.get('/api/execution?campaignId='+campaign.id)).json();expect(state.creatives).toHaveLength(1);expect(state.publications).toHaveLength(0);expect(state.creatives[0].caption).toBe('대표 메뉴: 테스트 대표 메뉴 107');expect(state.creatives[0].current).toBe(true);expect(state.creatives[0].title).toBe(creativeTitle);
 await expect(page.locator('strong',{hasText:creativeTitle})).toBeVisible();
 const asset=await page.request.get('/api/execution/asset?id='+state.creatives[0].id);expect(asset.status()).toBe(200);const bytes=await asset.body();expect(bytes.readUInt32BE(16)).toBe(1080);expect(bytes.readUInt32BE(20)).toBe(1080);
 // 외부 주소 없이 초안을 만들면 승인 때 앱 공개 주소를 채운다. 승인 전에는 공개 주소가 없다.
 const draft=await page.request.post('/api/execution',{data:{action:'save_publication',campaignId:campaign.id,creativeId:state.creatives[0].id,scheduledAt:new Date(Date.now()+86400000).toISOString(),plannedCostKRW:0}});expect(draft.status()).toBe(200);const publication=await draft.json();expect(publication.mediaMode).toBe('auto');expect(publication.mediaUrl).toBe('');
 // 새로고침하면 주소(?campaign=)로 상세가 다시 열린다. 열린 상세가 뒤 목록을 가리므로 '열기'를 다시 누르지 않는다.
 await page.reload();await expect(page.getByRole('dialog',{name:title})).toBeVisible();await page.getByRole('tab',{name:'제작·발행',exact:true}).click();await expect(page.getByRole('link',{name:'원본 PNG 내려받기',exact:true})).toBeVisible();
 await expect(page.getByText('발행 연결: 연결 필요',{exact:true})).toBeVisible();await expect(steps.locator('[aria-current="step"]')).toHaveText('채널');
 // exec-loop-10: 한도는 '발행 횟수 한도'로 부르고 확정된 캠페인 예산을 함께 보여 준다. 예정 비용 입력은 유료 부스트 연동 전까지 참고용 접힘 영역에 있다.
 await expect(page.getByRole('heading',{name:'2. 채널 연결과 발행 횟수 한도',exact:true})).toBeVisible();await expect(page.getByText('실행 한도',{exact:false})).toHaveCount(0);
 await expect(page.getByText('캠페인 예산 0원(무예산)',{exact:true})).toBeVisible();await expect(page.getByLabel('누적 예정 비용 상한 (원)',{exact:true})).toBeHidden();
 const plannedCost=page.getByLabel('이 발행의 예정 비용 (원)',{exact:true});await expect(plannedCost).toBeHidden();
 await page.getByText('예정 비용 · 유료 부스트 연동 전까지 참고용',{exact:true}).click();await expect(plannedCost).toBeVisible();await expect(plannedCost).toHaveValue('0');
 await expect(page.getByText('고급: 외부 호스트',{exact:true})).toBeVisible();
 // 승인 버튼 옆 차단 사유: 한도·채널·기획 승인·기간. 기본 한도 버튼으로 한도 사유가 사라진다.
 const blockers=page.getByRole('list',{name:'승인 차단 사유',exact:true});
 for(const reason of ['한도 미설정','채널 미연결','기획 미승인','기간 밖','권리 확인 필요'])await expect(blockers).toContainText(reason);
 await expect(page.getByRole('button',{name:'이 버전 발행 승인',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'기본 한도(발행 1회·0원) 저장',exact:true}).first().click();await expect(page.getByText('기본 한도(발행 1회·0원)를 저장했습니다.',{exact:true})).toBeVisible();
 await expect(blockers).not.toContainText('한도 미설정');expect((await(await page.request.get('/api/execution?campaignId='+campaign.id)).json()).limits).toMatchObject({maxPublications:1,maxPlannedCostKRW:0});
 // A4-2: 화면에서 쿠폰 코드와 지점을 골라 준비하면 캡션 끝에 코드 줄이 붙고, 준비된 발행에 코드와 복사 버튼이 보인다.
 const creativeSelect=page.getByRole('combobox',{name:'발행할 소재',exact:true});await expect(creativeSelect.locator('option',{hasText:creativeTitle})).toHaveCount(1);await creativeSelect.selectOption(state.creatives[0].id);
 await page.getByRole('combobox',{name:'코드 유형',exact:true}).selectOption('coupon');await page.getByRole('combobox',{name:'코드 지점',exact:true}).selectOption({label:storeName});
 const due=new Date(Date.now()+2*86400000),two=(n:number)=>String(n).padStart(2,'0');
 await page.getByLabel(/^예약 시각/).fill(`${due.getFullYear()}-${two(due.getMonth()+1)}-${two(due.getDate())}T${two(due.getHours())}:${two(due.getMinutes())}`);
 const coded=page.waitForResponse(r=>r.url().endsWith('/api/execution')&&r.request().postDataJSON()?.action==='save_publication');await page.getByRole('button',{name:'발행 초안 저장',exact:true}).click();
 const codedResponse=await coded;expect(codedResponse.status()).toBe(200);const codedDraft=await codedResponse.json();
 expect(codedDraft.trackingCode).toMatchObject({type:'coupon'});expect(codedDraft.caption.startsWith('대표 메뉴: 테스트 대표 메뉴 107\n\n주문할 때 쿠폰 코드 '+codedDraft.trackingCode.code)).toBe(true);expect(codedDraft.caption).toMatch(/[을를] 알려 주세요\.$/);
 const codedArticle=page.locator('article',{hasText:codedDraft.trackingCode.code});await expect(codedArticle.getByRole('button',{name:'코드 복사',exact:true})).toBeVisible();await expect(codedArticle).toContainText(storeName);await expect(codedArticle).toContainText('소재: '+creativeTitle);
 await page.screenshot({path:`e2e/artifacts/${info.project.name}-execution.png`,fullPage:true});
 await context.close();
});
