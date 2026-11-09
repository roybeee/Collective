import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {taskContext} from './helpers/ux-task-seeds';
// 결정 인박스 v2(GLOBAL-PLAN X1)·승인 카드 v2(X4) 여정(모바일·데스크톱): 검토 대기 작업물이 홈 안건 '결정' 탭에 보이고, A 자판으로 승인 카드(무엇·어디·되돌림)를 열어 승인하며,
// R 자판은 수정 요청 칸에 초점을 두고 빈 메시지는 보내기를 막는다. 발행 초안은 안건에서 A로, 제작·발행 탭에서는 '이 버전 발행 승인'으로 무엇·어디·언제·비용 카드를 연다(취소).
// Real local D1/API/Chromium. 인증 헤더 mocked. 발행 승인·외부 호출·광고비 지출 없음(발행 카드는 취소한다).
function fixture(owner:string,kind:string,id:string,parent:string,data:unknown){
 const quote=(value:string)=>`'${value.replaceAll("'","''")}'`,folder=mkdtempSync(join(tmpdir(),'collective-inbox-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true})}
}
const agendaOf=(page:Page)=>page.getByRole('region',{name:'오늘의 안건',exact:true});
// 행 수는 행(li)으로 센다. 본문 버튼 이름에 제목이 들어가고, 승인·수정 요청·미루기 버튼은 '승인'·'수정 요청'·'미루기' 이름에 제목을 aria-describedby로 단다(Tab 정지는 본문 버튼만).
const rowsOf=(page:Page,text:string|RegExp)=>agendaOf(page).locator('[data-inbox-row]').filter({hasText:text});
const dialog=(page:Page)=>page.getByRole('alertdialog');

test('안건 결정 탭에서 작업물을 A로 승인하고 R로 수정 요청한다',async({browser},info)=>{
 test.setTimeout(90_000);
 const {context,page,post,get}=await taskContext(browser,info,'inbox',1);
 try{
  const title=`인박스 작업물 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'인박스'}}) as {id:string};
  await post('/api/action',{action:'save_artifact',campaignId,role:'strategy',title:'브랜드 방향 초안',content:'## 방향\n합성 본문'});
  await post('/api/action',{action:'save_artifact',campaignId,role:'content',title:'게시 카피 초안',content:'## 카피\n합성 본문'});
  await page.goto('/');const agenda=agendaOf(page);
  // 결정 탭: 두 작업물이 '결정 대기' 행으로 보이고, 요약 수는 aria-live로 읽힌다.
  await agenda.getByRole('radio',{name:/^결정/}).click();
  const strategyRow=agenda.getByRole('button',{name:/브랜드 전략 작업물 검토 대기/}).first(),contentRow=agenda.getByRole('button',{name:/콘텐츠 스튜디오 작업물 검토 대기/}).first();
  await expect(strategyRow).toBeVisible();await expect(contentRow).toBeVisible();await expect(strategyRow).toContainText('브랜드 방향 초안');
  await expect(agenda.getByRole('list',{name:'안건 요약'})).toHaveAttribute('aria-live','polite');
  // J로 첫 행에 초점, A로 승인 카드(무엇·어디·되돌림 + 변경 요청 선택지)를 연다.
  await page.keyboard.press('j');await expect(agenda.getByRole('button',{name:/작업물 검토 대기/}).first()).toBeFocused();
  await page.keyboard.press('a');const card=dialog(page);await expect(card).toBeVisible();
  const list=card.getByRole('definition');await expect(card.getByText('무엇',{exact:true})).toBeVisible();await expect(card.getByText('어디',{exact:true})).toBeVisible();await expect(card.getByText('되돌림',{exact:true})).toBeVisible();await expect(list.first()).toBeVisible();
  await expect(card).toContainText(title);await expect(card.getByRole('button',{name:'변경 요청',exact:true})).toBeVisible();
  await card.getByRole('button',{name:'승인',exact:true}).click();
  await expect(agenda.getByRole('status').filter({hasText:'작업물을 승인했습니다.'})).toBeVisible();
  // 승인한 작업물은 안건에서 빠지고 서버 상태는 approved다.
  await expect(rowsOf(page,'작업물 검토 대기')).toHaveCount(1);
  const first=await get('/api/workspace') as {artifacts:{campaignId:string;role:string;status:string}[]};
  expect(first.artifacts.find(a=>a.campaignId===campaignId&&a.role==='strategy')?.status).toBe('approved');
  // R: 남은 행의 수정 요청 칸에 초점. 빈 메시지는 보내기가 막히고 이유가 보인다. 메시지를 적으면 revision으로 기록된다.
  await page.keyboard.press('j');await page.keyboard.press('r');
  const message=agenda.getByRole('textbox',{name:'수정 요청 내용 (필수)',exact:true});await expect(message).toBeFocused();
  const send=agenda.getByRole('button',{name:'수정 요청 보내기',exact:true});await expect(send).toBeDisabled();await expect(agenda.getByText('수정 요청 내용을 먼저 적으세요.',{exact:true})).toBeVisible();
  await message.fill('첫 문장을 고객 질문으로 바꿔 주세요.');await expect(send).toBeEnabled();await send.click();
  await expect(agenda.getByRole('status').filter({hasText:'수정을 요청했습니다.'})).toBeVisible();
  const second=await get('/api/workspace') as {artifacts:{campaignId:string;role:string;status:string;reviewNote?:string}[]};
  const content=second.artifacts.find(a=>a.campaignId===campaignId&&a.role==='content');expect(content?.status).toBe('revision');expect(content?.reviewNote).toBe('첫 문장을 고객 질문으로 바꿔 주세요.');
  await expect(rowsOf(page,'작업물 검토 대기')).toHaveCount(0);
  // 미루기(H)는 이 기기에만 남고 새로고침 뒤에도 유지된다.
  await post('/api/action',{action:'save_artifact',campaignId,role:'growth',title:'채널 계획',content:'## 채널\n합성 본문'});
  await page.reload();const again=agendaOf(page);await again.getByRole('radio',{name:/^결정/}).click();
  await expect(again.getByRole('button',{name:/채널 & 그로스 작업물 검토 대기/}).first()).toBeVisible();
  await page.keyboard.press('j');await page.keyboard.press('h');await expect(again.getByRole('status').filter({hasText:'24시간 미뤘습니다.'})).toBeVisible();
  await expect(rowsOf(page,'채널 & 그로스 작업물 검토 대기')).toHaveCount(0);
  await page.reload();await expect(agendaOf(page).getByText(/미룬 1건 외에 지금 처리할 안건이 없습니다\.|채널 & 그로스 작업물 검토 대기/).first()).toBeVisible();
  await expect(rowsOf(page,'채널 & 그로스 작업물 검토 대기')).toHaveCount(0);
 }finally{await context.close()}
});

test('발행 승인 카드는 무엇·어디·언제·비용을 보인다(안건 A·제작 탭 버튼)',async({browser},info)=>{
 test.setTimeout(90_000);
 const {owner,context,page,post,get}=await taskContext(browser,info,'inbox',2);
 try{
  const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString();
  const title=`인박스 발행 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'발행 카드',startDate:before.slice(0,10),endDate:after.slice(0,10)}}) as {id:string};
  const {id:factId}=await post('/api/brand-facts',{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'합성 상품',value:'테스트용 상품 근거',status:'confirmed',source:'합성 운영 확인',verifiedAt:before,validUntil:after}}) as {id:string};
  // 승인 조건(기획 승인·기간·한도·채널)은 로컬 fixture로 둔다. 실제 Buffer 연결·승인은 하지 않는다.
  const ws=await get('/api/workspace') as {campaigns:Record<string,unknown>[]};const campaign=ws.campaigns.find(c=>c.id===campaignId)!;
  fixture(owner,'campaign',campaignId,'',{...campaign,status:'approved',budget:50000,startDate:before.slice(0,10),endDate:after.slice(0,10)});
  fixture(owner,'publisher_credential','ofd','ofd',{channelId:'buffer-channel',account:'합성 Buffer 계정',version:1});
  fixture(owner,'execution_limits',campaignId,campaignId,{id:campaignId,version:1,maxPublications:1,maxPlannedCostKRW:0,paused:false});
  fixture(owner,'execution_creative','inbox-creative',campaignId,{id:'inbox-creative',campaignId,campaignVersion:campaign.version,brandId:'ofd',version:1,factRefs:[{id:factId,version:1}],caption:'합성 상품: 테스트용 상품 근거',pngHash:'b'.repeat(64),objectKey:'inbox.png',title:'인박스 소재',createdAt:before});
  const scheduledAt=new Date(Date.now()+2*86400000).toISOString();
  fixture(owner,'execution_publication','inbox-publication',campaignId,{id:'inbox-publication',campaignId,campaignVersion:campaign.version,creativeId:'inbox-creative',creativeVersion:1,pngHash:'b'.repeat(64),factRefs:[{id:factId,version:1}],caption:'합성 상품: 테스트용 상품 근거',mediaUrl:'',mediaMode:'auto',scheduledAt,plannedCostKRW:1500,version:1,status:'draft',createdAt:before});
  await page.goto('/');const agenda=agendaOf(page);
  await agenda.getByRole('radio',{name:/^결정/}).click();
  const row=agenda.getByRole('button',{name:/발행 승인 대기/}).first();await expect(row).toBeVisible();await expect(row).toContainText('비용 1,500원');
  await expect(agenda.getByRole('checkbox',{name:'발행 승인 대기 선택',exact:true})).toBeVisible();
  // 안건에서 A: 현재 계정·한도를 읽고 무엇·어디·언제·비용·되돌림 카드를 연다. 취소하면 아무것도 바뀌지 않는다.
  await page.keyboard.press('j');await page.keyboard.press('a');
  const card=dialog(page);await expect(card).toBeVisible();await expect(card).toContainText('이 발행을 승인할까요?');
  for(const label of ['무엇','어디','언제','비용','되돌림'])await expect(card.getByText(label,{exact:true})).toBeVisible();
  await expect(card).toContainText('1,500원');await expect(card).toContainText('합성 Buffer 계정');await expect(card).toContainText(title);
  await card.getByRole('button',{name:'취소',exact:true}).click();await expect(card).toBeHidden();
  // 일괄 선택: 체크하면 '선택 승인 1건 (비용 1,500원)' 버튼이 생기고 건수·비용 합계를 묻는다(취소).
  await agenda.getByRole('checkbox',{name:'발행 승인 대기 선택',exact:true}).check();
  await agenda.getByRole('button',{name:/^선택 승인 1건/}).click();const batch=dialog(page);await expect(batch).toContainText('선택한 1건을 승인할까요?');await expect(batch).toContainText('1,500원');
  await batch.getByRole('button',{name:'취소',exact:true}).click();await expect(batch).toBeHidden();
  const state=await get('/api/execution?campaignId='+campaignId) as {publications:{status:string}[]};expect(state.publications[0].status).toBe('draft');
  // 제작·발행 탭의 '이 버전 발행 승인'도 같은 카드를 연다(권리 확인 뒤).
  await row.click();await expect(page.getByRole('tab',{name:'제작·발행',exact:true})).toHaveAttribute('aria-selected','true');
  const article=page.locator('article',{hasText:'인박스 소재'});await article.getByRole('checkbox').first().check();
  const approve=article.getByRole('button',{name:'이 버전 발행 승인',exact:true});await expect(approve).toBeEnabled({timeout:15_000});await approve.click();
  const panelCard=dialog(page);await expect(panelCard).toContainText('이 버전을 발행 승인할까요?');
  for(const label of ['무엇','어디','언제','비용','되돌림'])await expect(panelCard.getByText(label,{exact:true})).toBeVisible();
  await expect(panelCard).toContainText('인박스 소재');await expect(panelCard).toContainText('1,500원');await expect(panelCard).toContainText('계정 합성 Buffer 계정');
  await panelCard.getByRole('button',{name:'취소',exact:true}).click();await expect(panelCard).toBeHidden();
  expect((await get('/api/execution?campaignId='+campaignId) as {publications:{status:string}[]}).publications[0].status).toBe('draft');
  await page.screenshot({path:`e2e/artifacts/${info.project.name}-ux-inbox.png`,fullPage:true});
 }finally{await context.close()}
});
