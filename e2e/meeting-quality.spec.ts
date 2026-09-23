// Real local browser / local D1; identity and meeting/provider responses are mocked.
import {test,expect} from '@playwright/test';

test('회의 실패 단계만 재작성하고 브라우저는 진행 요청 없이 상태를 조회한다',async({browser},testInfo)=>{
 const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,viewport:testInfo.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`meeting-ui-${testInfo.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 await page.request.get('/api/workspace');
 const saved=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'oda',title:'ODA 실패 복구 검증',goal:'실패 단계 복구 화면 검증',budget:0}}});
 expect(saved.status()).toBe(200);
 const {id}=await saved.json();
 await page.route('**/api/workspace',async route=>{
  const response=await route.fetch();const body=await response.json();
  await route.fulfill({response,json:{...body,connection:{...body.connection,configured:true,provider:'hermes'},worker:{registered:true,online:true,lastSeen:new Date().toISOString()}}});
 });
 const meetingId='meeting-ui',stepId=meetingId+':discussion:content';
 const good=['cmo','insight','strategy','creative'].map((role,i)=>({id:meetingId+':discussion:'+role,role,phase:'discussion',status:'completed',tokens:100,retryAvailable:false,output:{position:`보존할 발언 ${i+1}`,evidence:'테스트 근거',challenge:'확인 필요',proposal:'실행 초안',respondsTo:[]}}));
 let meeting={id:meetingId,campaignId:id,campaignVersion:1,agenda:'실패 복구 테스트 회의',status:'failed',steps:[...good,{id:stepId,role:'content',phase:'discussion',status:'failed',error:'respondsTo: 앞선 완료 발언을 적어도 하나 지정해야 합니다.',tokens:50,retryAvailable:true}],createdAt:'2026-09-23T05:00:00.000Z',updatedAt:'2026-09-23T05:00:00.000Z',model:'hermes-agent',stopRequested:false,artifactIds:[],invalidatedRoles:[],error:'respondsTo 검증 실패'};
 const actions:Record<string,unknown>[]=[];let gets=0;
 await page.route('**/api/meetings**',async route=>{
  if(route.request().method()==='GET'){gets++;await route.fulfill({json:{meetings:[meeting]}});return;}
  const input=route.request().postDataJSON();actions.push(input);
  if(input.action==='retry_failed')meeting={...meeting,status:'running',error:'',steps:[...good,{id:stepId,role:'content',phase:'discussion',status:'pending',error:'',tokens:0,retryAvailable:false}]};
  await route.fulfill({json:meeting});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'ODA 실패 복구 검증 열기',exact:true}).click();
 await page.getByRole('tab',{name:'팀 회의',exact:true}).click();
 await expect(page.getByText('보존할 발언 1',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'실패 단계 다시 작성',exact:true}).click();
 await expect.poll(()=>actions.length).toBe(1);
 expect(actions[0]).toMatchObject({action:'retry_failed',id:meetingId,stepId,expectedAttempt:0});
 const previousGets=gets;
 await expect.poll(()=>gets,{timeout:12000}).toBeGreaterThan(previousGets);
 expect(actions.some(action=>action.action==='advance')).toBe(false);
 await expect(page.getByText('보존할 발언 1',{exact:true})).toBeVisible();
 await context.close();
});
