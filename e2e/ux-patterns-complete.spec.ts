// 레인 X 패턴 완성: P5 작업물 진행 단계·P10 규정 배지, P2 팀 회의 뷰(참석자·결정 카드·접기·선택 표시), P14 실행 중 지시 추가(회의·연속 실행), P11 사용량 미터·계획 카드 원화.
// Real local Chromium/빌드/로컬 D1(캠페인·작업물 저장, 규정 점검 계산). mocked: 인증 헤더, 진행 중 회의·연속 실행 응답, 발행 예약 표시, 사용량 예산 응답(route.fulfill). 외부 호출·유료 모델 호출 0회.
import {test,expect,type Browser,type TestInfo} from '@playwright/test';

async function campaignPage(browser:Browser,info:TestInfo,prefix:string,title:string){
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`${prefix}-${info.project.name}-${Date.now()}`}});
 const page=await context.newPage();await page.request.get('/api/workspace');
 const saved=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'패턴 완성 검증',budget:0}}});expect(saved.status()).toBe(200);
 const {id}=await saved.json() as {id:string};
 const workspace=await (await page.request.get('/api/workspace')).json() as Record<string,unknown>;
 return {context,page,id,workspace};
}
const minutesAgo=(n:number)=>new Date(Date.now()-n*60000).toISOString();
const connected=(workspace:Record<string,unknown>,extra:Record<string,unknown>={})=>({...workspace,...extra,connection:{...(workspace.connection as object),configured:true,provider:'hermes'},worker:{registered:true,online:true,lastSeen:new Date().toISOString()}});

test('작업물 카드와 대화상자는 진행 단계를 보이고, 카드의 규정 배지로 규정 점검이 있는 대화상자를 연다',async({browser},info)=>{
 const {context,page,id}=await campaignPage(browser,info,'lifecycle',`진행 단계 ${info.project.name}`);
 try{
  // 앞 담당(크리에이티브)을 먼저 저장한다. 뒤 담당을 먼저 저장하면 앞 담당 저장이 뒤 작업물을 이전 판으로 돌린다.
  const b=await page.request.post('/api/action',{data:{action:'save_artifact',campaignId:id,role:'creative',title:'검토 카피',content:'단면 컷 촬영 지시서입니다.'}});expect(b.status()).toBe(200);
  const a=await page.request.post('/api/action',{data:{action:'save_artifact',campaignId:id,role:'content',title:'예약 카피',content:'평일 오후 픽업 안내 문안입니다.'}});expect(a.status()).toBe(200);
  const ws=await (await page.request.get('/api/workspace')).json() as {artifacts:{id:string;title:string;version:number;campaignId:string}[]};
  const scheduled=ws.artifacts.find(x=>x.campaignId===id&&x.title==='예약 카피')!;
  // 규정 점검 수는 실제 서버 계산(real), 발행 예약 표시만 모의(mocked): 발행 기록 없이 예약 상태를 보이려 응답의 publication만 바꾼다.
  await page.route('**/api/artifact-sources?cards=*',async route=>{const r=await route.fetch();const d=await r.json() as {cards:{artifactId:string;publication:string|null}[]};await route.fulfill({json:{cards:d.cards.map(c=>c.artifactId===scheduled.id?{...c,publication:'scheduled'}:c)}})});
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=outputs`);
  const steppers=page.getByRole('list',{name:'작업물 진행 단계',exact:true});
  await expect(steppers).toHaveCount(2);
  const item=page.locator('.artifact-item').filter({hasText:'예약 카피'});
  const stepper=item.getByRole('list',{name:'작업물 진행 단계',exact:true});
  await expect(stepper.locator('[aria-current="step"]')).toHaveAttribute('data-stage','scheduled');
  await expect(stepper.locator('[data-stage="scheduled"]')).toContainText('발행 예약');
  await expect(stepper.locator('[data-stage="approved"]')).toHaveAttribute('data-state','done');
  await expect(stepper.locator('[data-stage="revision"]')).toHaveAttribute('data-state','skipped');
  await expect(stepper.locator('[data-stage="published"]')).toHaveAttribute('data-state','todo');
  // 발행 기록이 없는 검토 대기 작업물은 '검토 중'이 현재 단계다(작업물 상태에서 읽음, real).
  const review=page.locator('.artifact-item').filter({hasText:'검토 카피'}).getByRole('list',{name:'작업물 진행 단계',exact:true});
  await expect(review.locator('[aria-current="step"]')).toHaveAttribute('data-stage','review');
  await expect(review.locator('[data-stage="draft"]')).toContainText('초안(직접 작성)');
  // 규정 배지: 24px 이상, 누르면 대화상자와 규정 점검 패널.
  const badge=item.getByTestId('compliance-count-badge');
  await expect(badge).toBeVisible();await expect(badge).toContainText(/규정/);
  const box=await badge.boundingBox();expect(box&&box.height).toBeGreaterThanOrEqual(24);
  await badge.click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('list',{name:'작업물 진행 단계',exact:true}).locator('[aria-current="step"]')).toHaveAttribute('data-stage','scheduled');
  await expect(dialog.getByText('규정 점검',{exact:false}).first()).toBeVisible();
  await page.unrouteAll({behavior:'wait'});
 }finally{await context.close()}
});

test('팀 회의 뷰는 참석자 상태·결정 카드·선택 결과를 보이고, 진행 중 회의에 지시를 추가하면 타임라인에 다음 단계부터 반영으로 남는다',async({browser},info)=>{
 const {context,page,id,workspace}=await campaignPage(browser,info,'meeting-board',`회의 뷰 ${info.project.name}`);
 try{
  await page.route('**/api/workspace',route=>route.fulfill({json:connected(workspace)}));
  const meetingId='board-meeting',synthesisId=meetingId+':synthesis';
  const discussion=['cmo','insight','strategy','creative','content','growth','data','quality'].map((role,i)=>({id:`${meetingId}:discussion:${role}`,role,phase:'discussion',status:'completed',tokens:100,attempt:0,retryAvailable:false,storedRepair:false,startedAt:minutesAgo(30-i),completedAt:minutesAgo(29-i),output:{position:`발언 ${i+1}`,evidence:'근거',challenge:'반론',proposal:'제안',respondsTo:[]}}));
  const synthesis={id:synthesisId,role:'cmo',phase:'synthesis',status:'completed',tokens:300,attempt:0,retryAvailable:false,storedRepair:false,startedAt:minutesAgo(20),completedAt:minutesAgo(19),output:{decisions:'- 단면 컷 실험\n- 평일 오후 픽업 안내',disagreements:'할인 쿠폰 제안은 보류',questions:'실제 판매 가격 확인',tasks:[{role:'content',instruction:'카피 개선',reason:'근거',acceptance:'채널별 문안 2개'}]}};
  const revision={id:meetingId+':revision:content',role:'content',phase:'revision',status:'running',retryAvailable:false,storedRepair:false,startedAt:minutesAgo(5),attempt:0};
  let meeting:Record<string,unknown>={id:meetingId,campaignId:id,campaignVersion:1,agenda:'회의 뷰 검증',status:'running',steps:[...discussion,synthesis,revision,{id:meetingId+':quality',role:'quality',phase:'quality',status:'pending',retryAvailable:false,storedRepair:false}],createdAt:minutesAgo(31),updatedAt:minutesAgo(5),model:'hermes-agent',stopRequested:false,artifactIds:[],invalidatedRoles:[],choices:[{id:'ch1',stepId:synthesisId,choice:'A',optionA:'- 단면 컷 실험\n- 평일 오후 픽업 안내',optionB:'할인 쿠폰 제안은 보류',createdAt:minutesAgo(10)}],instructions:[]};
  const actions:Record<string,unknown>[]=[];
  await page.route('**/api/meetings**',async route=>{
   if(route.request().method()==='GET'){await route.fulfill({json:{meetings:[meeting]}});return}
   const input=route.request().postDataJSON() as Record<string,unknown>;actions.push(input);
   if(input.action==='add_instruction')meeting={...meeting,instructions:[{id:'in1',text:input.text,createdAt:new Date().toISOString(),afterStepId:revision.id}]};
   await route.fulfill({json:meeting});
  });
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=meeting`);
  // 참석자 열: 에이전트마다 상태 글자. 개선 단계를 하는 콘텐츠 담당은 '발언 중'.
  const people=page.getByRole('region',{name:'참석자',exact:true});
  await expect(people.getByRole('listitem')).toHaveCount(8);
  await expect(people.locator('[data-role="content"]')).toContainText('발언 중');
  await expect(people.locator('[data-role="cmo"]')).toContainText('완료');
  // 결정 카드: 합의의 결정마다 카드, 남은 이견 카드에 사용자 선택, 확인할 사실·담당 배정.
  const decisions=page.getByRole('region',{name:'결정 사항',exact:true});
  await expect(decisions.locator('[data-kind="decision"]')).toHaveCount(2);
  await expect(decisions.locator('[data-kind="decision"]').first()).toContainText('단면 컷 실험');
  await expect(decisions.locator('[data-kind="disagreement"]')).toContainText('사용자가 A안을 골랐습니다.');
  await expect(decisions.locator('[data-kind="questions"]')).toContainText('실제 판매 가격 확인');
  await expect(decisions.locator('[data-kind="task"]')).toContainText('담당 배정');
  // 뒤 단계 발언에 선택이 보인다(선택 뒤 시작한 단계라 이 단계 입력에 반영).
  const turn=page.locator(`[data-step="${revision.id}"]`);
  await expect(turn.getByRole('note')).toContainText('사용자가 A안을 골랐습니다. 이 단계 입력에 반영됐습니다.');
  // 발언 접기·펼치기.
  const first=page.locator(`[data-step="${meetingId}:discussion:cmo"]`);
  const toggle=first.getByRole('button',{name:/번째 발언\(.+\) 접기/});
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(first.getByText('발언 1',{exact:true})).toBeVisible();
  await toggle.click();
  await expect(first.getByRole('button',{name:/번째 발언\(.+\) 펼치기/})).toHaveAttribute('aria-expanded','false');
  await expect(first.getByText('발언 1',{exact:true})).toBeHidden();
  // 지시 추가: 다음 단계부터 반영 안내, 저장하면 타임라인 항목.
  const form=page.getByTestId('add-instruction');
  await expect(form).toContainText('다음 단계 입력부터 반영됩니다');
  const add=form.getByRole('button',{name:'지시 추가',exact:true});
  await expect(add).toBeDisabled();
  await form.getByLabel('지시 추가').fill('다음 단계부터 할인 표현은 빼 주세요.');
  await add.click();
  await expect.poll(()=>actions.length).toBe(1);
  expect(actions[0]).toMatchObject({action:'add_instruction',id:meetingId,text:'다음 단계부터 할인 표현은 빼 주세요.'});
  const log=page.getByRole('log',{name:'회의 진행 타임라인',exact:true});
  const entry=log.locator('[data-status="instruction"]');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('지시 추가');
  await expect(entry).toContainText('다음 단계부터 반영');
  await expect(entry).toContainText('다음 단계부터 할인 표현은 빼 주세요.');
  // 끼운 자리: 진행 중이던 개선 단계 바로 뒤.
  const order=await log.locator('li').evaluateAll(xs=>xs.map(x=>x.getAttribute('data-status')));
  expect(order.slice(-3)).toEqual(['running','instruction','pending']);
  await page.unrouteAll({behavior:'wait'});
 }finally{await context.close()}
});

test('연속 실행 중에는 AI 팀 탭에서 지시를 추가하고, 계획 카드는 원화 추정을, 캠페인 머리는 사용량 미터를 보인다',async({browser},info)=>{
 const {context,page,id,workspace}=await campaignPage(browser,info,'meter',`미터 ${info.project.name}`);
 try{
  // 사용량 미터: 처음은 실제 서버 응답(real, 상한 미설정).
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=team`);
  const meter=page.getByTestId('usage-meter');
  await expect(meter).toHaveAttribute('data-state','unset');
  await expect(meter).toContainText('상한 미설정');
  // 계획 카드의 예상 비용(추정)은 크레딧과 원화로 보인다(QA D13).
  const card=page.getByRole('region',{name:'실행 전 계획',exact:true});
  await expect(card.getByText('예상 비용(추정)',{exact:true})).toBeVisible();
  await expect(card).toContainText(/약 [\d,]+크레딧, 약 [\d,]+원/);
  // 80%·100% 상태(모의 예산 응답).
  let used=850;
  await page.route('**/api/usage?budget=1',route=>route.fulfill({json:{budget:{month:'2026-11',workspace:{limit:1000,used,inProgress:0,remaining:1000-used,unknownUsage:0},campaigns:[]}}}));
  await page.reload();
  await expect(meter).toHaveAttribute('data-state','warn');
  await expect(meter).toContainText('주의: 상한의 85%');
  await expect(meter.getByRole('meter')).toHaveAttribute('aria-valuenow','85');
  used=1200;await page.reload();
  await expect(meter).toHaveAttribute('data-state','over');
  await expect(meter).toContainText('상한 도달: 120%');
  await expect(meter.getByRole('meter')).toHaveAttribute('aria-valuenow','100');
  // 연속 실행 진행 중(모의): 지시 추가 → /api/run add_instruction, 타임라인에 끼운다.
  const runs=[{id:'run-live',campaignId:id,role:'cmo',status:'in_progress',error:null,createdAt:minutesAgo(1),model:'m',tokens:0}];
  const sequences=[{campaignId:id,campaignVersion:1,status:'running',startedAt:minutesAgo(2),updatedAt:minutesAgo(1)}];
  await page.route('**/api/workspace',route=>route.fulfill({json:connected(workspace,{runs,sequences})}));
  const detail=await (await page.request.get('/api/campaigns/'+id)).json() as Record<string,unknown>;
  await page.route(`**/api/campaigns/${id}**`,route=>route.fulfill({json:{...detail,runs,sequences}}));
  let instructions:Record<string,unknown>[]=[];const posts:Record<string,unknown>[]=[];
  await page.route('**/api/run**',async route=>{
   const url=new URL(route.request().url());
   if(route.request().method()==='GET'){await route.fulfill({json:url.searchParams.has('instructions')?{instructions}:{recent:[]}});return}
   const input=route.request().postDataJSON() as Record<string,unknown>;posts.push(input);
   if(input.action==='add_instruction'){instructions=[{id:'ri1',text:input.text,createdAt:new Date().toISOString(),afterStepId:'run-live'}];await route.fulfill({json:{instruction:instructions[0],instructions}});return}
   await route.fulfill({json:{sequence:sequences[0]}});
  });
  await page.reload();
  const form=page.getByTestId('add-instruction');
  await expect(form).toBeVisible();
  await form.getByLabel('지시 추가').fill('다음 담당부터 가격은 [자료 필요]로 두세요.');
  await form.getByRole('button',{name:'지시 추가',exact:true}).click();
  await expect.poll(()=>posts.filter(p=>p.action==='add_instruction').length).toBe(1);
  expect(posts.find(p=>p.action==='add_instruction')).toMatchObject({campaignId:id,text:'다음 담당부터 가격은 [자료 필요]로 두세요.'});
  const log=page.getByRole('log',{name:'실행 타임라인',exact:true});
  await expect(log.locator('[data-status="instruction"]')).toContainText('다음 단계부터 반영');
  await expect(log.locator('[data-status="instruction"]')).toContainText('[자료 필요]로 두세요.');
  await page.unrouteAll({behavior:'wait'});
 }finally{await context.close()}
});
