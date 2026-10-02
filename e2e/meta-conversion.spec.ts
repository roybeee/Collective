// Real browser/local D1, synthetic order and consent. No external Meta transmission.
import {test,expect} from '@playwright/test';
import {dispatchMetaPurchasePixel} from '../lib/meta-capi';
test('Pixel 계약은 구매자 동의와 같은 eventID를 사용한다',async({page})=>{
 const outcome=await page.evaluate(({source})=>{
  // Execute the shipped helper in a real browser with a synthetic fbq recorder; no Meta script is loaded.
  const dispatch=Function('return ('+source+')')() as typeof dispatchMetaPurchasePixel,calls:unknown[][]=[],envelope={datasetId:'12345678',eventId:'purchase_synthetic',eventName:'Purchase' as const,value:12000,currency:'KRW' as const,expiresAt:Date.now()+60000};
  const denied=dispatch(envelope,(...args)=>calls.push(args),false),accepted=dispatch(envelope,(...args)=>calls.push(args),true);
  return {denied,accepted,calls};
 },{source:dispatchMetaPurchasePixel.toString()});
 expect(outcome.denied).toBe(false);expect(outcome.accepted).toBe(true);expect(outcome.calls).toEqual([['trackSingle','12345678','Purchase',{value:12000,currency:'KRW'},{eventID:'purchase_synthetic'}]]);
});
test('구매 전환 준비·새로고침 보존·동의 철회',async({browser},info)=>{
 const owner=`conversion-e2e-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 await page.request.get('/api/workspace');
 const saved=await page.request.post('/api/stores',{data:{action:'save_store',brandId:'ofd',data:{name:'합성 전환 검증 지점',address:'합성 주소',tradeArea:'residential',goal:'주문 검증'}}});expect(saved.status()).toBe(200);const {id:storeId}=await saved.json();
 const now=new Date(Math.floor((Date.now()-60000)/60000)*60000),day=now.toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),localTime=new Date(now.getTime()+9*3600000).toISOString().slice(0,16),csv=`order_id,revision,order_date,status,paid_amount,refund_amount,mode\nCONVERSION-TEST,1,${day},paid,12000,0,delivery\n`,payload={storeId,sourceKey:'conversion-test',csv};
 const preview=await page.request.post('/api/storefront-orders',{data:{...payload,action:'preview'}});expect(preview.status()).toBe(200);const {previewKey}=await preview.json();expect((await page.request.post('/api/storefront-orders',{data:{...payload,action:'import',previewKey}})).status()).toBe(200);
 const title='전환 검증 '+info.project.name;expect((await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'합성 검증'}}})).status()).toBe(200);
 await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기'}).click();await page.getByRole('tab',{name:'Meta 광고 준비',exact:true}).click();await page.getByRole('tab',{name:'예산·전환',exact:true}).click();
 const panel=page.getByRole('region',{name:'구매 전환 준비'});await panel.getByLabel('연결된 주문',{exact:true}).selectOption({index:1});await panel.getByLabel('실제 구매 시각(한국 시간)',{exact:true}).fill(localTime);await panel.getByLabel('비식별 동의 증빙 번호',{exact:true}).fill('consent-e2e');await expect(panel.getByRole('button',{name:'전환 준비 기록',exact:true})).toBeDisabled();await panel.getByLabel('고객이 Meta 광고 전환 측정 목적에 별도로 동의했고 증빙을 확인했습니다',{exact:true}).check();await panel.getByLabel('테스트 주문이 아닌 실제 결제 주문임을 확인했습니다',{exact:true}).check();await panel.getByRole('button',{name:'전환 준비 기록',exact:true}).click();await expect(panel.getByRole('status')).toContainText('구매 전환 준비를 기록했습니다');await expect(panel.getByText('Pixel / 서버 공통 구매 ID:',{exact:false})).toHaveCount(1);
 await panel.getByRole('button',{name:'다시 불러오기',exact:true}).click();await expect(panel.getByText('Pixel / 서버 공통 구매 ID:',{exact:false})).toHaveCount(1);await panel.getByRole('button',{name:'이 주문의 전환 동의 철회',exact:true}).click();await expect(panel.getByText('동의 철회됨',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'철회·매칭 정보 파기 재확인',exact:true})).toBeEnabled();expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:`e2e/artifacts/meta-conversion-${info.project.name}.png`});await context.close();
});
