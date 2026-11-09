import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// X6 채널 모양 미리보기. Real local D1/R2/API/Chromium. 인증 헤더 mocked. 발행 초안의 AI 카피 기록은 합성 고정값(AI 카피 캡션은 운영 환경 스위치라 로컬 D1에 직접 넣는다). 외부 게시·HERMES 호출 없음.
const AI_LINE='이 게시물의 문구는 AI의 도움을 받아 작성하고 담당자가 확인했습니다.';
function fixture(owner:string,kind:string,id:string,parent:string,data:unknown){
 const quote=(value:string)=>`'${value.replaceAll("'","''")}'`,folder=mkdtempSync(join(tmpdir(),'collective-preview-'));
 try{const path=join(folder,'fixture.sql');writeFileSync(path,`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`);execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true})}
}

test('발행 초안이 Instagram 모양 미리보기로 보이고 원문으로 바꿀 수 있다',async({browser},info)=>{
 test.setTimeout(90_000);
 const owner=`preview-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const title='미리보기 캠페인 '+info.project.name;
  const {id}=await(await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'채널 미리보기 확인',budget:0}}})).json();
  const fact=await(await page.request.post('/api/brand-facts',{data:{action:'save_fact',confirmed:true,data:{brandId:'ofd',key:'signature_menu',value:'딸기 도넛',status:'confirmed',source:'E2E 합성 검증',verifiedAt:new Date(Date.now()-60000).toISOString(),validUntil:new Date(Date.now()+30*86400000).toISOString()}}})).json();
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1080;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#334455';ctx.fillRect(0,0,1080,1080);return canvas.toDataURL('image/png');});
  const creative=await page.request.post('/api/execution',{data:{action:'save_creative',campaignId:id,campaignVersion:1,factRefs:[{id:fact.id,version:fact.version}],title:'미리보기 소재',png}});expect(creative.status(),await creative.text()).toBe(200);
  const state=await(await page.request.get('/api/execution?campaignId='+id)).json();
  const draft=await page.request.post('/api/execution',{data:{action:'save_publication',campaignId:id,creativeId:state.creatives[0].id,scheduledAt:new Date(Date.now()+86400000).toISOString(),plannedCostKRW:0}});expect(draft.status(),await draft.text()).toBe(200);
  const publication=await draft.json();
  // 합성 AI 카피: 125자를 넘겨 '더 보기'로 접히게 하고, 표시 줄은 접혀도 보여야 한다.
  const copy='봄 한정 신메뉴가 나왔어요. 새콤한 딸기와 부드러운 크림을 듬뿍 넣은 딸기 도넛을 이번 주말 매장에서 가장 먼저 만나 보세요. 오전에 오시면 갓 구운 도넛을 드실 수 있고, 포장 주문도 언제든 환영합니다. 친구와 함께 오시면 더 즐거워요! #딸기도넛 #봄신메뉴';
  const caption=copy+'\n\n'+publication.caption+'\n\n'+AI_LINE;
  fixture(owner,'execution_publication',publication.id,id,{...publication,caption,copy:{artifactId:'seed-artifact',artifactVersion:1,index:0,text:copy,aiGenerated:true}});
  await page.goto(`/?view=campaigns&campaign=${id}&ctab=execution`);
  const card=page.locator('article',{hasText:'소재: 미리보기 소재'});
  const preview=card.getByRole('figure',{name:'Instagram 미리보기',exact:true});
  await expect(preview).toBeVisible({timeout:15_000});
  // 접힌 상태에서도 AI 생성물 표시 줄과 글자 수(2,200자 한도)가 보인다.
  await expect(preview.getByRole('note',{name:'표시 줄'})).toHaveText(AI_LINE);
  await expect(preview.getByText(/^글자 수 \d{3}\/2,200자$/)).toBeVisible();
  await expect(preview.locator('.cp-tag')).toHaveCount(0);
  await expect(preview.getByText('즐거워요',{exact:false})).toHaveCount(0);
  await preview.getByRole('button',{name:'더 보기',exact:true}).click();
  await expect(preview.getByText('즐거워요',{exact:false})).toBeVisible();
  await expect(preview.locator('.cp-tag')).toHaveText(['#딸기도넛','#봄신메뉴']);
  await expect(preview.getByAltText('게시 이미지 미리보기')).toBeVisible();
  // 미리보기는 앱 테마와 상관없이 밝은 기기 틀이다.
  const white=/^(rgb\(255, 255, 255\)|oklch\(1 0 0\)|lab\(100 0 0\)|color\(srgb 1 1 1\))$/;
  expect(await preview.evaluate(el=>getComputedStyle(el).backgroundColor)).toMatch(white);
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  expect(await preview.evaluate(el=>getComputedStyle(el).backgroundColor),'dark theme keeps the light device frame').toMatch(white);
  await page.evaluate(()=>document.documentElement.classList.remove('dark'));
  // 원문으로 바꾸면 저장된 캡션 그대로 보인다.
  const views=card.getByRole('radiogroup',{name:'발행 캡션 보기 방식',exact:true});
  await expect(views.getByRole('radio',{name:'미리보기',exact:true})).toHaveAttribute('aria-checked','true');
  await views.getByRole('radio',{name:'원문',exact:true}).click();
  await expect(preview).toBeHidden();
  await expect(card.locator('p.whitespace-pre-wrap')).toContainText(AI_LINE);
  await expect(card.locator('p.whitespace-pre-wrap')).toContainText('#봄신메뉴');
  // 캡션 편집기도 같은 채널 모양으로 보인다. 스위치를 켜면 글을 고를 때 다시 쓰기 막대가 나오고, 누르면 확인 카드에 추정 비용이 보인다(취소하면 아무것도 보내지 않는다).
  const editor=page.getByRole('region',{name:'캡션 편집기',exact:true});
  await expect(editor.getByRole('figure',{name:'Instagram 미리보기',exact:true})).toBeVisible();
  await expect(editor.getByRole('toolbar',{name:'고른 글 다시 쓰기'})).toHaveCount(0);
  expect((await page.request.post('/api/feature-flags',{data:{action:'set',flag:'selection_rewrite',enabled:true}})).status()).toBe(200);
  await page.reload();
  const box=page.getByRole('region',{name:'캡션 편집기',exact:true}).getByLabel('캡션 편집기',{exact:true});
  await expect(box).toHaveValue('대표 메뉴: 딸기 도넛');
  // 끝의 5자('딸기 도넛')를 고르고 키를 뗀 것처럼 알린다(macOS의 End 키는 글자 끝으로 옮기지 않아 선택 범위를 직접 정한다).
  await box.evaluate((el:HTMLTextAreaElement)=>{el.focus();el.setSelectionRange(7,12);el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Shift'}))});
  const toolbar=page.getByRole('toolbar',{name:'고른 글 다시 쓰기'});
  await expect(toolbar).toBeVisible();
  let sent=0;page.on('request',r=>{if(r.url().endsWith('/api/rewrite')&&r.method()==='POST')sent++});
  await toolbar.getByRole('button',{name:'줄이기',exact:true}).click();
  const dialog=page.getByRole('alertdialog');
  await expect(dialog).toContainText('비용');await expect(dialog).toContainText('토큰(추정)');await expect(dialog).toContainText('고른 5자');
  await dialog.getByRole('button',{name:'취소',exact:true}).click();
  await expect(dialog).toBeHidden();expect(sent).toBe(0);
  await expect(box).toHaveValue('대표 메뉴: 딸기 도넛');
  await page.screenshot({path:`e2e/artifacts/${info.project.name}-channel-preview.png`,fullPage:true});
 }finally{await context.close()}
});
