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
 // 화면이 계속 조회하므로 닫는 순간 route.fetch 중인 처리기가 남을 수 있다. 끝날 때까지 기다린 뒤 닫는다(Response has been disposed 방지).
 await page.unrouteAll({behavior:'wait'});
 await context.close();
});

test('기준 자료가 바뀐 실패 회의는 재작성 대신 새 회의를 안내하고 안건은 검수 지적으로 채운다',async({browser},testInfo)=>{
 const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,viewport:testInfo.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`meeting-stale-${testInfo.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 await page.request.get('/api/workspace');
 const saved=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'oda',title:'ODA 기준 변경 검증',goal:'기준 변경 안내 검증',budget:0}}});
 expect(saved.status()).toBe(200);
 const {id}=await saved.json();
 await page.route('**/api/workspace',async route=>{
  const response=await route.fetch();const body=await response.json();
  await route.fulfill({response,json:{...body,connection:{...body.connection,configured:true,provider:'hermes'},worker:{registered:true,online:true,lastSeen:new Date().toISOString()}}});
 });
 const meetingId='meeting-stale';
 const good=['cmo','insight'].map((role,i)=>({id:meetingId+':discussion:'+role,role,phase:'discussion',status:'completed',tokens:100,retryAvailable:false,output:{position:`이어받을 발언 ${i+1}`,evidence:'테스트 근거',challenge:'확인 필요',proposal:'실행 초안',respondsTo:[]}}));
 const meeting={id:meetingId,campaignId:id,campaignVersion:1,agenda:'기준 변경 테스트 회의',status:'failed',stale:true,steps:[...good,{id:meetingId+':discussion:strategy',role:'strategy',phase:'discussion',status:'failed',error:'respondsTo ID 불일치: 지정한 발언 참조 1개가 앞선 완료 발언과 일치하지 않습니다.',tokens:50,retryAvailable:false}],createdAt:'2026-09-23T05:00:00.000Z',updatedAt:'2026-09-23T05:00:00.000Z',model:'hermes-agent',stopRequested:false,artifactIds:[],invalidatedRoles:[],error:'respondsTo ID 불일치'};
 const draft='최근 품질 검수 지적을 반영해 담당 작업물을 개선해 주세요.\n검수 수정 요청:\n- 콘텐츠 스튜디오: CTA의 할인 표현을 확인 전까지 삭제\n\n캠페인 상시 지시:\n- 인기·할인 표현은 확인 전 광고 문구에 쓰지 않습니다.';
 const actions:Record<string,unknown>[]=[];
 await page.route('**/api/meetings**',async route=>{
  if(route.request().method()==='GET'){await route.fulfill({json:{meetings:[meeting],agendaDraft:{agenda:draft,reviewFixes:1}}});return;}
  const input=route.request().postDataJSON();actions.push(input);
  await route.fulfill({json:{...meeting,id:String(input.id),status:'cancelled',stale:false,steps:[],previousMeetingId:meetingId}});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'ODA 기준 변경 검증 열기',exact:true}).click();
 await page.getByRole('tab',{name:'팀 회의',exact:true}).click();
 await expect(page.getByText('이어받을 발언 1',{exact:true})).toBeVisible();
 await expect(page.getByText('기준 자료 변경됨 — 완료 발언을 이어받아 새 회의 시작',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'실패 단계 다시 작성',exact:true})).toHaveCount(0);
 const agenda=page.getByLabel('회의 안건',{exact:true});
 await expect(agenda).toHaveValue(draft);
 await agenda.fill('사용자가 고친 안건');
 await page.getByRole('button',{name:'검수 지적 반영 회의',exact:true}).click();
 await expect(agenda).toHaveValue(draft);
 await page.getByRole('button',{name:'후속 회의 새로 시작',exact:true}).click();
 await expect(page.getByLabel('후속 회의 안건',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'팀 회의 시작',exact:true}).click();
 await expect.poll(()=>actions.length).toBe(1);
 expect(actions[0]).toMatchObject({action:'start',campaignId:id,previousMeetingId:meetingId});
 expect(actions.some(action=>action.action==='retry_failed')).toBe(false);
 await page.unrouteAll({behavior:'wait'});
 await context.close();
});
