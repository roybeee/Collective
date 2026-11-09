// 레인 X-G 남은 화면 연결 여정(모바일·데스크톱): 브리프 '산출물 언어' 저장·머리 표시, 작업물 대화상자의 외부 검토자 링크 만들기·취소(share_links 켬),
// 오늘의 안건 알림(크레딧 알림 fixture)·결정(플레이스 초안 승인 대기, 실제 API로 만든 초안), 점포 브라우저 목록의 새 작업 이름(리뷰 답글 등록·소식 등록 fixture),
// 지점 채널 점검 탭의 플레이스 초안 카드(승인 → 복사·제출 도움 → '제출했습니다'), 광고 제안 카드의 채널 선택(네이버·당근).
// Real local D1/API/Chromium. 인증 헤더 mocked. 일부 기록은 로컬 D1 fixture(크레딧 알림·점포 브라우저 작업). 외부 호출·광고비 지출·네이버 등록 없음.
import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {taskContext} from './helpers/ux-task-seeds';

function fixture(owner:string,kind:string,id:string,parent:string,data:unknown){
 const quote=(value:string)=>`'${value.replaceAll("'","''")}'`,folder=mkdtempSync(join(tmpdir(),'lane-x-g-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true})}
}
const flag=async(page:Page,name:string)=>expect((await page.request.post('/api/feature-flags',{data:{action:'set',flag:name,enabled:true}})).status()).toBe(200);
const kstMonth=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,7);

test('브리프에서 산출물 언어를 English로 저장하면 캠페인 머리에 보이고 한국어로 되돌리면 사라진다',async({browser},info)=>{
 const {context,page,post,get}=await taskContext(browser,info,'xg-lang',1);
 try{
  const title=`산출물 언어 ${info.project.name}`,{id}=await post('/api/action',{action:'save_campaign',data:{brandId:'oda',title,goal:'해외 파트너용 소개',budget:0}}) as {id:string};
  await page.goto(`/?view=campaigns&campaign=${id}`);
  const sheet=page.getByRole('region',{name:title});await expect(sheet.getByText('브리프 v1',{exact:true})).toBeVisible();
  await expect(sheet.locator('[data-output-language]')).toHaveCount(0);
  for(const [value,label,version] of [['en','English',2],['ko',null,3]] as const){
   await sheet.getByRole('button',{name:'브리프 수정',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'캠페인을 더 구체적으로'}),select=dialog.getByRole('combobox',{name:'산출물 언어'});
   await expect(select).toHaveValue(value==='en'?'ko':'en');
   await select.selectOption(value);
   const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/action'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='save_campaign');
   await dialog.getByRole('button',{name:'브리프 수정 저장',exact:true}).click();
   const res=await saved;expect(res.status()).toBe(200);expect(res.request().postDataJSON().data.outputLanguage).toBe(value);
   await expect(dialog).toBeHidden();await expect(sheet.getByText(`브리프 v${version}`,{exact:true})).toBeVisible();
   const ws=await get('/api/workspace') as {campaigns:{id:string;outputLanguage?:string}[]},saved2=ws.campaigns.find(c=>c.id===id);
   if(label){await expect(sheet.locator('[data-output-language="en"]')).toHaveText('산출물 English');expect(saved2?.outputLanguage).toBe('en')}
   else{await expect(sheet.locator('[data-output-language]')).toHaveCount(0);expect(saved2?.outputLanguage).toBeUndefined()}
  }
 }finally{await context.close()}
});

test('작업물 대화상자에서 외부 검토자 링크를 만들고 확인 카드로 취소한다',async({browser},info)=>{
 const {context,page,post}=await taskContext(browser,info,'xg-share',1);
 try{
  await flag(page,'share_links');
  const title=`검토자 링크 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title,goal:'외부 검토'}}) as {id:string};
  const artifactTitle=`외부 검토 카피 ${info.project.name}`;
  await post('/api/action',{action:'save_artifact',campaignId,role:'content',title:artifactTitle,content:'## 카피\n합성 본문'});
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=outputs`);
  const item=page.locator('.artifact-item').filter({hasText:artifactTitle});await expect(item).toBeVisible({timeout:30_000});
  await item.locator('.artifact-row').click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  const card=dialog.getByRole('region',{name:`검토자 링크 ${artifactTitle}`});await expect(card).toBeVisible();
  await expect(card).toContainText('사용 중 0/10개');
  await card.getByRole('textbox',{name:'받는 사람',exact:true}).fill('고객사 검수');
  await card.getByRole('button',{name:'검토자 링크 만들기',exact:true}).click();
  const address=card.getByRole('textbox',{name:'공유 주소',exact:true});await expect(address).toBeVisible();
  expect(await address.inputValue()).toMatch(/\/share\/[a-f0-9]{64}$/);
  await expect(card).toContainText('사용 중 1/10개');
  await card.getByRole('button',{name:'고객사 검수 링크 취소',exact:true}).click();
  const confirm=page.getByRole('alertdialog');await expect(confirm).toBeVisible();
  await expect(confirm.getByText('무엇',{exact:true})).toBeVisible();await expect(confirm.getByText('되돌림',{exact:true})).toBeVisible();await expect(confirm).toContainText(`${artifactTitle} v1`);
  await confirm.getByRole('button',{name:'링크 취소',exact:true}).click();
  await expect(card.getByRole('list',{name:'공유 링크 목록'})).toContainText('취소함');
  await expect(card).toContainText('사용 중 0/10개');
 }finally{await context.close()}
});

test('안건 알림 탭에 크레딧 알림이, 결정 탭에 플레이스 초안이 지점과 함께 보이고 카드에서 승인·제출 표시를 한다',async({browser},info)=>{
 test.setTimeout(90_000);
 const {owner,context,page,post}=await taskContext(browser,info,'xg-agenda',1);
 try{
  await flag(page,'place_drafts');
  const storeName=`안건 지점 ${info.project.name}`,{id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:storeName,address:'합성 주소',tradeArea:'residential',goal:'안건'}}) as {id:string};
  const month=kstMonth();
  fixture(owner,'billing_alert',`${month}-100`,'',{id:`${month}-100`,month,level:100,kind:'signal',title:'크레딧 모두 사용',detail:'이번 달 크레딧을 모두 썼습니다. 새 AI 실행이 멈춥니다.',createdAt:new Date().toISOString()});
  const created=await post('/api/place-drafts',{action:'create',kind:'review_reply',storeId,sourceText:'음식이 맛있고 친절했어요. 또 올게요.',rating:5}) as {id?:string;draft?:{id:string}};
  expect(created.id??created.draft?.id).toBeTruthy();
  await page.goto('/');
  const agenda=page.getByRole('region',{name:'오늘의 안건',exact:true});
  await agenda.getByRole('radio',{name:/^알림/}).click();
  const alert=agenda.locator('[data-inbox-row]').filter({hasText:'크레딧 모두 사용'});await expect(alert).toBeVisible();await expect(alert).toContainText('워크스페이스 전체');
  await agenda.getByRole('radio',{name:/^결정/}).click();
  const row=agenda.locator('[data-inbox-row]').filter({hasText:'플레이스 리뷰 답글 승인 대기'});await expect(row).toBeVisible();await expect(row).toContainText(storeName);
  // 행을 열면 그 지점의 채널 점검 탭으로 가고 초안 카드가 보인다.
  await row.getByRole('button',{name:/플레이스 리뷰 답글 승인 대기/}).click();
  await expect(page).toHaveURL(new RegExp(`view=stores.*store=${storeId}`));
  const card=page.getByRole('region',{name:'플레이스 리뷰 답글·소식 초안',exact:true});await expect(card).toBeVisible({timeout:30_000});
  await expect(card).toContainText('쓰기 API 없음·자동 제출 없음');
  const draft=card.locator('[data-place-draft]').first();await expect(draft).toHaveAttribute('data-status','draft');
  await draft.getByRole('button',{name:'승인',exact:true}).click();
  const confirm=page.getByRole('alertdialog');await expect(confirm).toContainText(storeName);await confirm.getByRole('button',{name:'승인',exact:true}).click();
  await expect(draft).toHaveAttribute('data-status','approved');
  const help=draft.getByRole('group',{name:'복사·제출 도움'});await expect(help).toBeVisible();
  await expect(help.getByRole('textbox',{name:'승인한 문안'})).toHaveValue(/감사/);
  await expect(help.getByRole('link',{name:'스마트플레이스 관리 열기'})).toHaveAttribute('href',/smartplace\.naver\.com/);
  await expect(draft.getByRole('button',{name:'점포 브라우저 작업 만들기',exact:true})).toBeDisabled();
  await draft.getByRole('button',{name:'제출했습니다',exact:true}).click();
  await expect(draft).toHaveAttribute('data-status','submitted');await expect(draft).toContainText('제출했습니다');
 }finally{await context.close()}
});

test('점포 브라우저 목록은 리뷰 답글·소식 작업을 제 이름으로 보인다',async({browser},info)=>{
 const {owner,context,page,post}=await taskContext(browser,info,'xg-browser',1);
 try{
  const storeName=`브라우저 지점 ${info.project.name}`,{id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:storeName,address:'합성 주소',tradeArea:'residential',goal:'점포 브라우저'}}) as {id:string};
  const now=new Date().toISOString(),binding={storeId,naverPlaceId:'1234',managerBusinessId:'5678',managerUrl:'https://new.smartplace.naver.com/bizes/5678',publicUrl:'',deviceId:'dev-1',profileId:'p-1',version:1,createdAt:now,updatedAt:now};
  for(const [id,type,text] of [['job-reply','reply_review','소중한 후기 감사합니다.'],['job-news','post_news','[광고] 가을 신메뉴 소식']] as const)
   fixture(owner,'store_browser_job',`${id}-${info.project.name}`,storeId,{id:`${id}-${info.project.name}`,storeId,type,status:'waiting_human',bindingVersion:1,binding,beforeHours:'',afterHours:'',digest:'d'.repeat(64),deviceId:'dev-1',version:2,createdAt:now,updatedAt:now,placeDraft:{draftId:'pd',draftVersion:1,kind:type==='reply_review'?'review_reply':'news_post',text,textSha256:'a'.repeat(64)}});
  await page.goto(`/?view=stores&brand=ofd&store=${encodeURIComponent(storeId)}&tab=channels`);
  const panel=page.getByRole('region',{name:'네이버 매장 관리'});await expect(panel).toBeVisible({timeout:30_000});
  await expect(panel.getByText('리뷰 답글 등록',{exact:true})).toBeVisible();await expect(panel.getByText('소식 등록',{exact:true})).toBeVisible();
  await expect(panel).toContainText('소중한 후기 감사합니다.');
  await expect(panel.getByText('영업시간 변경',{exact:true})).toHaveCount(0);
 }finally{await context.close()}
});

test('광고 제안 카드는 네이버·당근 채널을 고르고 당근 스위치가 꺼져 있으면 이유를 보인다',async({browser},info)=>{
 const {context,page,post}=await taskContext(browser,info,'xg-ads',1);
 try{
  const {id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`광고 채널 ${info.project.name}`,goal:'광고 채널 확인'}}) as {id:string};
  const day=(n:number)=>new Date(Date.now()-n*86_400_000).toISOString().slice(0,10);
  await post('/api/action',{action:'save_metric',campaignId,schemaVersion:2,periodStart:day(13),periodEnd:day(7),scope:'전체 주문',source:'POS 정산서',definition:'KST 순매출',method:'export',revenue:412000,orders:20,variableCosts:100000,adSpend:30000,productionCost:0});
  await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=results`);
  const naver=page.getByRole('region',{name:'네이버 검색광고 제안',exact:true});await expect(naver).toBeVisible({timeout:30_000});
  await expect(naver.getByRole('radio',{name:'네이버',exact:true})).toHaveAttribute('aria-checked','true');
  await naver.getByRole('radio',{name:'당근',exact:true}).click();
  const daangn=page.getByRole('region',{name:'당근 광고 제안',exact:true});await expect(daangn).toBeVisible();
  await expect(daangn).toHaveAttribute('data-channel','daangn_ads');
  await expect(daangn.getByRole('note').filter({hasText:'당근 광고 스위치 꺼짐'})).toBeVisible();
  await daangn.getByRole('textbox',{name:'당근 광고 캠페인 ID'}).fill('dg-e2e-1');
  await expect(daangn.getByRole('button',{name:'제안 만들기',exact:true})).toBeDisabled();
  await daangn.getByRole('radio',{name:'네이버',exact:true}).click();
  await expect(page.getByRole('region',{name:'네이버 검색광고 제안',exact:true})).toBeVisible();
 }finally{await context.close()}
});
