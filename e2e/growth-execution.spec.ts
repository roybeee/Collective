import {test,expect} from '@playwright/test';

// Real local browser/D1; synthetic owner authentication. No external dispatch.
test('일반 판매 동시 예약·충돌 입력 보존·미확인·관측 재조회',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`execution-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
  await page.request.get('/api/workspace');
  const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString(),day=after.slice(0,10);
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'예약 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'판매 준비'}});
  const title=`일반 판매 실행 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'합성 예약 검증'}});
  const {id:factId}=await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'합성 상품',value:'테스트용 상품 근거',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:after}});
  const save=(action:string,id:string,input:unknown)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await save('save_signal','exec-signal',{title:'시장 근거',sourceUrl:'https://example.com/market',observedAt:before,expiresAt:day,sourceType:'market',summary:'공개 관측',sampleSize:null});
  await save('save_need','exec-need',{title:'니즈 가설',situation:'상황',desiredOutcome:'준비 단축',alternative:'기존 대안',barrier:'배송',counterEvidence:'직접 조리',signalIds:['exec-signal'],deadline:day,nextAction:'확인',assignee:'검토 담당'});
  await save('save_catalog','exec-catalog',{sku:'EXEC-SKU',title:'예약 상품',price:100,unitCost:20,variableCost:10,stock:20,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송 조건',refunds:'반품 조건',rightsConfirmed:true,factIds:[factId],validUntil:day});
  await save('save_offer','exec-offer',{title:'예약 오퍼',catalogId:'exec-catalog',catalogVersion:1,needId:'exec-need',price:100,quantity:2,landingUrl:'https://example.com/buy',purchaseReason:'준비 단축',priceApproved:true});
  await save('save_mission','exec-mission',{title:'수동 판매 미션',offerId:'exec-offer',offerVersion:1,assignee:'판매 담당',deadline:day,nextAction:'판매 준비',channel:'manual',budget:100,lossLimit:20,stopRule:'한도 도달',fulfillmentOwner:'배송 담당'});
  await post('/api/growth/operations',{action:'create_inventory',campaignId,campaignVersion:1,input:{sku:'EXEC-SKU',locationId:storeId,unit:'piece',onHand:10},observedAt:before,evidenceRef:'warehouse-opening'});
  await post('/api/growth',{action:'queue_mission',id:'exec-mission',campaignId,campaignVersion:1,expectedVersion:1});
  await post('/api/growth/authority',{action:'save_authority',id:'exec-authority',campaignId,campaignVersion:1,expectedVersion:0,sign:true,input:{accountId:'manual-seller',channel:'manual',status:'active',maxTier:'T3',allowedActions:['publish','spend'],startsAt:before,expiresAt:after,periodStart:before,periodEnd:after,totalCap:1000,dayCap:1000,weekCap:1000,lossCap:1000}});
  const read=async()=>{const r=await page.request.get(`/api/growth/execution?campaignId=${campaignId}`);expect(r.status(),await r.text()).toBe(200);return r.json()};
  const open=async()=>{await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();await page.locator('summary').filter({hasText:/^일반 판매 실행 준비·결과$/}).click();return page.getByRole('region',{name:'일반 판매 실행 준비',exact:true})};
  let panel=await open();
  await panel.getByRole('combobox',{name:'준비된 판매 미션',exact:true}).selectOption('exec-mission');await panel.getByRole('combobox',{name:'서명된 판매 위임',exact:true}).selectOption('exec-authority');await panel.getByRole('combobox',{name:'예약할 공유 재고',exact:true}).selectOption({index:1});
  await panel.getByLabel('예약할 재고 수량 (등록된 SKU 단위)',{exact:true}).fill('2');await panel.getByLabel('결과 확인 담당 역할',{exact:true}).fill('판매 확인 담당');await panel.getByLabel('결과 확인 기한',{exact:true}).fill(day);await panel.getByLabel('준비 증빙 내부 ID',{exact:true}).fill('preparation-a');
  await panel.getByRole('button',{name:'예산·재고 함께 예약',exact:true}).click();await expect(panel.getByRole('status')).toContainText('예산과 재고를 함께 예약했습니다.');
  let v=await read();expect(v.intents).toHaveLength(1);expect(v.inventory[0].projection.reserved).toBe(2);expect(v.mayExecute).toBe(false);
  const receipt=()=>panel.getByRole('group',{name:'실행 결과 확인 기록',exact:true});
  await receipt().getByLabel('결과 증빙 내부 ID',{exact:true}).fill('pending-a');await receipt().getByLabel('결과 확인 내용',{exact:true}).fill('결과 확인 중');
  await post('/api/growth/execution',{action:'record_execution_receipt',campaignId,campaignVersion:v.campaignVersion,id:v.intents[0].id,expectedVersion:v.intents[0].version,receiptId:crypto.randomUUID(),input:{status:'unknown',reference:'concurrent-check',note:'다른 운영자가 확인 중'}});
  await receipt().getByRole('button',{name:'실행 결과 기록',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('입력은 보존했습니다.');await panel.getByRole('button',{name:'실행 준비 새로고침',exact:true}).click();await expect(receipt().getByRole('textbox',{name:'결과 확인 내용',exact:true})).toHaveValue('결과 확인 중');await panel.getByRole('button',{name:'현재 입력 유지 · 최신 결과 버전 사용',exact:true}).click();await receipt().getByRole('button',{name:'실행 결과 기록',exact:true}).click();await expect(panel.getByRole('status')).toContainText('실행 결과를 기록했습니다.');v=await read();expect(v.intents[0].state).toBe('unknown');expect(v.inventory[0].projection.reserved).toBe(2);
  panel=await open();await panel.getByRole('complementary',{name:'판매 실행 기록',exact:true}).getByRole('button',{name:/수동 판매 미션/}).click();
  await receipt().getByRole('combobox',{name:'확인 상태',exact:true}).selectOption('observed');await receipt().getByLabel('결과 증빙 내부 ID',{exact:true}).fill('observation-a');await receipt().getByLabel('결과 확인 내용',{exact:true}).fill('운영자가 결과 확인');await receipt().getByRole('button',{name:'실행 결과 기록',exact:true}).click();await expect(panel.getByRole('status')).toContainText('실행 결과를 기록했습니다.');
  v=await read();expect(v.intents[0].state).toBe('observed');expect(v.receipts).toHaveLength(4);expect(v.inventory[0].projection.reserved).toBe(2);await expect(receipt().getByRole('button',{name:'실행 결과 기록',exact:true})).toBeDisabled();
  await panel.getByRole('button',{name:'실행 준비 새로고침',exact:true}).click();await expect(panel).toContainText('관측 완료');await expect(panel.getByRole('region',{name:'실행 증빙 이력',exact:true})).toContainText('observation-a');expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await panel.getByRole('heading',{name:'실행 증빙 이력',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`e2e/artifacts/growth-execution-${info.project.name}.png`});
 }finally{await context.close()}
});
