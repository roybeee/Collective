// GLOBAL-PLAN X2·X3: AI 팀 탭의 실행 전 계획 카드와 실행 타임라인, 팀 회의의 A/B 선택 카드.
// Real local Chromium/빌드/로컬 D1. 인증 헤더·워크스페이스 실행 목록·회의 응답·실행 시작 응답은 mocked(route.fulfill). 외부 호출·유료 모델 호출 0회.
import {test,expect,type Browser,type TestInfo} from '@playwright/test';

async function campaignPage(browser:Browser,info:TestInfo,prefix:string,title:string){
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`${prefix}-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();await page.request.get('/api/workspace');
 const saved=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'계획 카드 검증',budget:0}}});expect(saved.status()).toBe(200);
 const {id}=await saved.json() as {id:string};
 const workspace=await (await page.request.get('/api/workspace')).json() as Record<string,unknown>;
 return {context,page,id,workspace};
}
const minutesAgo=(n:number)=>new Date(Date.now()-n*60000).toISOString();

test('AI 팀 탭은 계획 카드를 먼저 보이고 승인 버튼만으로 연속 실행을 시작하며, 타임라인이 모의 실행 상태를 그린다',async({browser},info)=>{
 const title='계획 카드 '+info.project.name;
 const {context,page,id,workspace}=await campaignPage(browser,info,'plan-card',title);
 try{
  // 모의 실행 목록: 완료·실패·진행 중과 이전 기록에만 있는 상태(incomplete)·알 수 없는 값. 모두 글자 라벨로 그려져야 한다.
  const runs=[
   {id:'run-done',campaignId:id,role:'cmo',status:'completed',error:null,createdAt:minutesAgo(30),model:'m',tokens:1234},
   {id:'run-fail',campaignId:id,role:'insight',status:'failed',error:'모의 실패 사유',createdAt:minutesAgo(20),model:'m',tokens:0},
   {id:'run-old',campaignId:id,role:'strategy',status:'incomplete',error:null,createdAt:minutesAgo(15),model:'m',tokens:0},
   {id:'run-odd',campaignId:id,role:'creative',status:'legacy_mystery',error:null,createdAt:minutesAgo(10),model:'m',tokens:0},
  ];
  await page.route('**/api/workspace',route=>route.fulfill({json:{...workspace,runs,connection:{...(workspace.connection as object),configured:true,provider:'hermes'},worker:{registered:true,online:true,lastSeen:new Date().toISOString()}}}));
  // 캠페인 화면은 실행 목록을 상세 API(/api/campaigns/<id>)에서 읽는다. 실제 응답에 모의 실행만 덧붙인다.
  const detail=await (await page.request.get('/api/campaigns/'+id)).json() as Record<string,unknown>;
  await page.route(`**/api/campaigns/${id}**`,route=>route.fulfill({json:{...detail,runs}}));
  const starts:Record<string,unknown>[]=[];
  await page.route('**/api/run',async route=>{
   if(route.request().method()==='GET'){await route.fulfill({json:{recent:[{id:'run-done',campaignId:id,role:'cmo',status:'completed',tokens:1234,startedAt:minutesAgo(30),finishedAt:minutesAgo(29),durationMs:60000}]}});return}
   starts.push(route.request().postDataJSON());await route.fulfill({json:{sequence:{campaignId:id,campaignVersion:1,status:'running',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}});
  });
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=team`);
  // 계획 카드: 제목 있는 영역, 산출물·담당 목록, 예상 토큰(추정)·소요·규칙 수.
  const card=page.getByRole('region',{name:'실행 전 계획',exact:true});
  await expect(card).toBeVisible();
  await expect(card.getByRole('list',{name:'산출물과 담당',exact:true}).getByRole('listitem')).toHaveCount(8);
  await expect(card.getByText('예상 토큰(추정)',{exact:true})).toBeVisible();
  await expect(card.getByText(/토큰 추정/).first()).toBeVisible();
  await expect(card.getByText('첫 실행이라 추정 불가',{exact:true})).toBeVisible();
  await expect(card.getByText('학습 규칙',{exact:true})).toBeVisible();
  await expect(card.getByText('상시 지시',{exact:true})).toBeVisible();
  // 부분 실행을 지원하지 않는 연속 실행에는 제외 체크박스가 없다.
  await expect(card.getByRole('checkbox')).toHaveCount(0);
  // 승인 전에는 예전 실행 버튼이 없고, 카드의 주 버튼 하나만 실행을 시작한다.
  await expect(page.getByRole('button',{name:'AI 팀 이어서 실행'})).toHaveCount(0);
  const approve=card.getByRole('button',{name:'승인 후 실행',exact:true});
  await expect(approve).toHaveCount(1);
  const box=await approve.boundingBox();expect(box&&box.height).toBeGreaterThanOrEqual(44);
  // 타임라인: role=log, 상태마다 글자 라벨(색만으로 구분하지 않음), 모르는 상태도 그린다.
  const log=page.getByRole('log',{name:'실행 타임라인',exact:true});
  await expect(log).toHaveAttribute('aria-live','polite');
  await expect(log.getByRole('listitem')).toHaveCount(4);
  await expect(log.locator('[data-status="completed"]')).toContainText('완료');
  await expect(log.locator('[data-status="completed"]')).toContainText('토큰 1,234');
  await expect(log.locator('[data-status="failed"]')).toContainText('실패');
  await expect(log.locator('[data-status="failed"]')).toContainText('모의 실패 사유');
  await expect(log.locator('[data-status="incomplete"]')).toContainText('중단됨');
  await expect(log.locator('[data-status="legacy_mystery"]')).toContainText('상태 미확인');
  // 승인: start_sequence 한 번, 추정이 함께 간다.
  await approve.focus();await page.keyboard.press('Enter');
  await expect.poll(()=>starts.length).toBe(1);
  expect(starts[0]).toMatchObject({action:'start_sequence',campaignId:id});
  const plan=starts[0].plan as {estimatedTokens:number;roles:string[]};
  expect(Number.isSafeInteger(plan.estimatedTokens)&&plan.estimatedTokens>0).toBe(true);
  expect(plan.roles).toHaveLength(8);
  await page.unrouteAll({behavior:'wait'});
 }finally{await context.close()}
});

test('진행 중 실행은 타임라인에 실행 중으로 보이고 계획 카드는 숨긴다',async({browser},info)=>{
 const title='진행 중 타임라인 '+info.project.name;
 const {context,page,id,workspace}=await campaignPage(browser,info,'plan-live',title);
 try{
  const runs=[{id:'run-live',campaignId:id,role:'cmo',status:'in_progress',error:null,createdAt:minutesAgo(1),model:'m',tokens:0}];
  await page.route('**/api/workspace',route=>route.fulfill({json:{...workspace,runs,connection:{...(workspace.connection as object),configured:true,provider:'hermes'},worker:{registered:true,online:true,lastSeen:new Date().toISOString()}}}));
  const detail=await (await page.request.get('/api/campaigns/'+id)).json() as Record<string,unknown>;
  await page.route(`**/api/campaigns/${id}**`,route=>route.fulfill({json:{...detail,runs}}));
  await page.route('**/api/run',route=>route.fulfill({json:{recent:[]}}));
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=team`);
  const log=page.getByRole('log',{name:'실행 타임라인',exact:true});
  await expect(log.locator('[data-status="in_progress"]')).toContainText('실행 중');
  await expect(log.locator('[data-status="in_progress"]')).toContainText(/경과 (\d+분 )?\d+초/);
  await expect(page.getByRole('status').filter({hasText:'AI 작업 진행 중'})).toBeVisible();
  await expect(page.getByRole('region',{name:'실행 전 계획',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'승인 후 실행'})).toHaveCount(0);
  await page.unrouteAll({behavior:'wait'});
 }finally{await context.close()}
});

test('팀 회의 탭은 계획 카드 승인으로 회의를 시작하고 합의 단계의 남은 이견을 A/B 선택 카드로 보인다',async({browser},info)=>{
 const title='회의 계획 '+info.project.name;
 const {context,page,id,workspace}=await campaignPage(browser,info,'plan-meeting',title);
 try{
  await page.route('**/api/workspace',route=>route.fulfill({json:{...workspace,connection:{...(workspace.connection as object),configured:true,provider:'hermes'},worker:{registered:true,online:true,lastSeen:new Date().toISOString()}}}));
  const meetingId='plan-meeting',synthesisId=meetingId+':synthesis';
  const discussion=['cmo','insight','strategy','creative','content','growth','data','quality'].map((role,i)=>({id:`${meetingId}:discussion:${role}`,role,phase:'discussion',status:'completed',tokens:100,attempt:0,retryAvailable:false,storedRepair:false,startedAt:minutesAgo(20-i),completedAt:minutesAgo(19-i),output:{position:`발언 ${i+1}`,evidence:'근거',challenge:'반론',proposal:'제안',respondsTo:[]}}));
  const synthesis={id:synthesisId,role:'cmo',phase:'synthesis',status:'completed',tokens:300,attempt:0,retryAvailable:false,storedRepair:false,startedAt:minutesAgo(10),completedAt:minutesAgo(9),output:{decisions:'A 방향: 단면 컷 실험',disagreements:'B 의견: 할인 쿠폰 제안은 보류',questions:'없음',tasks:[{role:'content',instruction:'개선',reason:'근거',acceptance:'조건'}]}};
  let meeting:Record<string,unknown>={id:meetingId,campaignId:id,campaignVersion:1,agenda:'A/B 선택 검증 회의',status:'running',steps:[...discussion,synthesis,{id:meetingId+':revision:content',role:'content',phase:'revision',status:'waiting_for_approval',retryAvailable:false,storedRepair:false},{id:meetingId+':quality',role:'quality',phase:'quality',status:'pending',retryAvailable:false,storedRepair:false}],createdAt:minutesAgo(21),updatedAt:minutesAgo(9),model:'hermes-agent',stopRequested:false,artifactIds:[],invalidatedRoles:[],choices:[]};
  const actions:Record<string,unknown>[]=[];
  await page.route('**/api/meetings**',async route=>{
   if(route.request().method()==='GET'){await route.fulfill({json:{meetings:[meeting]}});return}
   const input=route.request().postDataJSON() as Record<string,unknown>;actions.push(input);
   if(input.action==='choose')meeting={...meeting,choices:[{id:'ch1',stepId:synthesisId,choice:input.choice,optionA:'A 방향: 단면 컷 실험',optionB:'B 의견: 할인 쿠폰 제안은 보류',createdAt:new Date().toISOString()}]};
   await route.fulfill({json:meeting});
  });
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=meeting`);
  // 진행 중 회의: 타임라인이 승인 대기 단계를 글자로 보인다.
  const log=page.getByRole('log',{name:'회의 진행 타임라인',exact:true});
  await expect(log.locator('[data-status="waiting_for_approval"]')).toContainText('승인 대기');
  await expect(log.locator('[data-status="completed"]')).toHaveCount(9);
  // A/B 선택 카드: A·B·둘 다 보류 중 하나를 골라 저장한다.
  const choice=page.getByRole('region',{name:'남은 이견 선택',exact:true});
  await expect(choice).toBeVisible();
  await expect(choice).toContainText('A 방향: 단면 컷 실험');
  await expect(choice).toContainText('B 의견: 할인 쿠폰 제안은 보류');
  const save=choice.getByRole('button',{name:'선택 저장',exact:true});
  await expect(save).toBeDisabled();
  await choice.getByRole('button',{name:'B안 고르기',exact:true}).click();
  await expect(choice.getByRole('button',{name:'B안 고르기',exact:true})).toHaveAttribute('aria-pressed','true');
  await save.click();
  await expect.poll(()=>actions.length).toBe(1);
  expect(actions[0]).toMatchObject({action:'choose',id:meetingId,stepId:synthesisId,choice:'B'});
  await expect(choice.getByRole('status')).toContainText('현재 선택 B안 채택');
  // 회의가 끝나면 계획 카드가 돌아오고 승인 버튼(팀 회의 시작)만 회의를 시작한다.
  meeting={...meeting,status:'completed',plan:{estimatedTokens:5000,estimatedMs:null,steps:12,approvedAt:minutesAgo(21)}};
  const card=page.getByRole('region',{name:'실행 전 계획',exact:true});
  await expect(card).toBeVisible({timeout:15_000});
  await expect(card.getByRole('button',{name:'팀 회의 시작',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'팀 회의 시작',exact:true})).toHaveCount(1);
  await expect(card.getByTestId('plan-outcome')).toContainText('실제 토큰');
  await expect(card.getByTestId('plan-outcome')).toContainText('1,100 토큰');
  await card.getByRole('button',{name:'팀 회의 시작',exact:true}).click();
  await expect.poll(()=>actions.length).toBe(2);
  expect(actions[1]).toMatchObject({action:'start',campaignId:id});
  const plan=actions[1].plan as {estimatedTokens:number;steps:number};
  expect(Number.isSafeInteger(plan.estimatedTokens)&&plan.estimatedTokens>0&&plan.steps===12).toBe(true);
  await page.unrouteAll({behavior:'wait'});
 }finally{await context.close()}
});
