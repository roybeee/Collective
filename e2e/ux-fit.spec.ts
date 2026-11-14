import {test,expect,type Page} from '@playwright/test';
import {taskContext} from './helpers/ux-task-seeds';
// QA 2026-11-15 N1·N4·N5 회귀 검사.
//  N1: 휴대폰(320·390px) 머리 띠 경로·연결 상태 글자가 단어 중간에서 줄이 바뀌지 않는다('MEALZ IP', 'Works pace', 'ME/AL/ZI/P'). 모든 화면 언어.
//  N4: 홈 인박스 일괄 선택 체크박스의 누르는 영역(감싼 label)이 데스크톱 24px·모바일 44px 이상이다.
//  N5: 영어 캠페인 상세(1280px) 탭 줄이 가로 스크롤 뒤로 탭을 숨기지 않고, 고른 탭이 탭 줄 안에 보인다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음.
const LOCALES=['ko','en','ja'] as const;
// 각 글자 노드를 단어(공백 사이) 단위 Range로 재서, 한 단어의 글자 상자가 두 줄 이상에 걸치면 그 단어를 돌려준다.
const brokenWords=(page:Page,selector:string)=>page.evaluate(sel=>{
 const out:string[]=[];
 for(const el of document.querySelectorAll<HTMLElement>(sel)){
  const r=el.getBoundingClientRect();if(r.width<1||r.height<1||getComputedStyle(el).display==='none')continue;
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   const text=node.textContent??'';
   for(const m of text.matchAll(/\S+/g)){
    const range=document.createRange();range.setStart(node,m.index!);range.setEnd(node,m.index!+m[0].length);
    const tops=new Set([...range.getClientRects()].filter(b=>b.width>0&&b.height>0).map(b=>Math.round(b.top)));
    if(tops.size>1)out.push(`${el.className||el.tagName} "${m[0]}" ${tops.size}줄`);
   }
  }
 }
 return out;
},selector);
const HEADER='.topbar .topbar-path>span,.topbar .topbar-path>b,.topbar .mode-pill';

test('N1 휴대폰 머리 띠 글자는 단어 중간에서 줄이 바뀌지 않는다(320·390px, ko·en·ja)',async({browser},info)=>{
 test.skip(info.project.name!=='mobile','휴대폰 폭 검사(데스크톱 프로젝트는 같은 일을 반복하지 않는다)');
 test.setTimeout(120_000);
 const {context,page,post}=await taskContext(browser,info,'fit',1);
 try{
  await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`머리 띠 ${info.project.name}`,goal:'머리 띠 확인'}});
  const problems:string[]=[];await page.goto('/');
  for(const locale of LOCALES){
   await page.evaluate(l=>localStorage.setItem('locale',l),locale);
   for(const width of [320,390]){
    await page.setViewportSize({width,height:740});
    for(const view of ['overview','campaigns','research']){
     await page.goto(`/?view=${view}`);await expect(page.locator('html')).toHaveAttribute('lang',locale);
     await expect(page.locator('.topbar .topbar-path>b')).toBeVisible();if(locale!=='ko')await expect(page.locator('.topbar .topbar-path>b')).not.toHaveText(/[가-힣]/);await expect(page.getByRole('heading',{level:1})).toBeVisible();
     problems.push(...(await brokenWords(page,HEADER)).map(p=>`${locale} ${width}px ${view}: ${p}`));
     // 머리 띠가 화면 폭을 넘지 않는다.
     const over=await page.evaluate(()=>Math.max(...[...document.querySelectorAll('.topbar *')].map(e=>e.getBoundingClientRect().right))-innerWidth);
     expect.soft(over,`${locale} ${width}px ${view} 머리 띠가 ${over}px 넘침`).toBeLessThanOrEqual(1);
    }
   }
  }
  expect(problems).toEqual([]);
 }finally{await context.close()}
});

test('N4 인박스 일괄 선택 체크박스의 누르는 영역은 데스크톱 24px·모바일 44px 이상',async({browser},info)=>{
 const {context,page,post,mobile}=await taskContext(browser,info,'fit',2);
 try{
  const {id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`누르는 영역 ${info.project.name}`,goal:'체크박스'}}) as {id:string};
  await post('/api/action',{action:'save_artifact',campaignId,role:'strategy',title:'영역 확인 초안',content:'## 방향\n합성 본문'});
  await page.goto('/');const agenda=page.getByRole('region',{name:'오늘의 안건',exact:true});
  await agenda.getByRole('radio',{name:/^결정/}).click();
  const box=agenda.getByRole('checkbox').first();await expect(box).toBeVisible();
  const label=agenda.locator('label.agenda-select').first(),area=await label.boundingBox(),input=await box.boundingBox(),min=mobile?44:24;
  info.annotations.push({type:'hit-area',description:JSON.stringify({label:[area!.width,area!.height],input:[input!.width,input!.height]})});
  expect(Math.min(area!.width,area!.height),`label ${area!.width}×${area!.height}`).toBeGreaterThanOrEqual(min);
  // 모양은 그대로(데스크톱 18px·모바일 22px), label 가운데를 누르면 선택된다.
  expect(Math.round(input!.width)).toBe(mobile?22:18);
  await page.mouse.click(area!.x+2,area!.y+2);await expect(box).toBeChecked();
 }finally{await context.close()}
});

test('N5 영어 캠페인 상세 탭 줄은 탭을 가로 스크롤 뒤로 숨기지 않는다',async({browser},info)=>{
 test.skip(info.project.name!=='desktop','데스크톱 1280px 검사(모바일은 이미 줄바꿈 규칙이 있다)');
 const {context,page,post}=await taskContext(browser,info,'fit',3);
 try{
  const {id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:`탭 줄 ${info.project.name}`,goal:'탭 줄 확인'}}) as {id:string};
  await page.goto('/');
  const measure=()=>page.evaluate(()=>{const list=document.querySelector<HTMLElement>('.campaign-tabs>[role=tablist]')!,lr=list.getBoundingClientRect();
   return {scroll:list.scrollWidth-list.clientWidth,rows:new Set([...list.querySelectorAll('[role=tab]')].map(t=>Math.round(t.getBoundingClientRect().top))).size,
    clipped:[...list.querySelectorAll<HTMLElement>('[role=tab]')].filter(t=>{const r=t.getBoundingClientRect();return r.left<lr.left-1||r.right>lr.right+1||r.right>innerWidth}).map(t=>t.textContent)}});
  for(const locale of ['en','ko']){
   await page.evaluate(l=>localStorage.setItem('locale',l),locale);
   await page.goto(`/?view=campaigns&campaign=${campaignId}&ctab=history`);await expect(page.locator('html')).toHaveAttribute('lang',locale);
   const active=page.getByRole('tablist').first().getByRole('tab',{selected:true});await expect(active).toBeVisible();
   const m=await measure();info.annotations.push({type:'tabs',description:JSON.stringify({locale,...m})});
   expect(m.scroll,`${locale} 탭 줄 가로 스크롤 ${m.scroll}px`).toBeLessThanOrEqual(1);expect(m.clipped,`${locale} 잘린 탭`).toEqual([]);
   await expect(active).toBeInViewport({ratio:1});
  }
 }finally{await context.close()}
});
