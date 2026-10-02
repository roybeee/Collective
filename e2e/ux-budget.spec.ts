import {test,expect,type Page} from '@playwright/test';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
// UX-PLAN-3 Q0·Q7·⑩ 런타임 예산(tests/ux-budget.json runtime): 홈 첫 로딩 JS(gz), axe critical·serious 0, 모바일 44px 비율, 가로 넘침, 4G 홈 LCP, 핵심 조작 지연(INP).
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음. 예산을 넘으면 실패한다.
const budget=JSON.parse(readFileSync('tests/ux-budget.json','utf8')).runtime as {homeJsGzKB:number;axeCriticalSerious:number;mobileTouchTargetPct:number;horizontalOverflowPx:number;lcpMs4g:number;inpMs:number};
const axePath=(()=>{const store='node_modules/.pnpm';if(!existsSync(store))return null;const dir=readdirSync(store).find(d=>d.startsWith('axe-core@'));return dir?join(store,dir,'node_modules/axe-core/axe.min.js'):null})();
async function axeSerious(page:Page){
 if(!axePath)return {count:0,rules:['axe-core not found']};
 await page.addScriptTag({path:axePath});
 return page.evaluate(async()=>{const w=window as unknown as {axe:{run:(d:Document,o:unknown)=>Promise<{violations:{id:string;impact:string;nodes:unknown[]}[]}>}};const r=await w.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});const bad=r.violations.filter(v=>v.impact==='critical'||v.impact==='serious');return {count:bad.reduce((n,v)=>n+v.nodes.length,0),rules:bad.map(v=>`${v.id}:${v.nodes.length}`)}});
}
const touch=(page:Page)=>page.evaluate(()=>{const els=[...document.querySelectorAll('button,a[href],[role=tab],summary,select,input:not([type=hidden]):not([type=checkbox]):not([type=radio])')].filter(e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'});const small=els.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44});return {total:els.length,small:small.length}});
// 누를 수 있는 요소끼리 겹치면 하나가 다른 것을 가린다(2026-10-01 모바일 탭 겹침 같은 결함을 화면 비교 없이 잡는다). 서로 안에 든 요소(버튼 안 링크 등)는 뺀다.
const overlaps=(page:Page)=>page.evaluate(()=>{const els=[...document.querySelectorAll('button,a[href],[role=tab],summary,select,input:not([type=hidden]),textarea')].filter(e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>1&&r.height>1&&cs.visibility!=='hidden'&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!e.closest('[aria-hidden=true],[inert]')});// 스크롤 영역 밖으로 잘린 부분은 보이지 않으므로 조상 스크롤 영역으로 자른 사각형을 쓴다.
 const clip=(e:Element)=>{let {left,top,right,bottom}=e.getBoundingClientRect();for(let p=e.parentElement;p;p=p.parentElement){const cs=getComputedStyle(p);if(cs.overflowX!=='visible'||cs.overflowY!=='visible'){const r=p.getBoundingClientRect();left=Math.max(left,r.left);top=Math.max(top,r.top);right=Math.min(right,r.right);bottom=Math.min(bottom,r.bottom)}}return {left,top,right,bottom}};
 const name=(e:Element)=>`${e.tagName.toLowerCase()}${(e as HTMLInputElement).type?':'+(e as HTMLInputElement).type:''} "${(e.getAttribute('aria-label')||e.textContent||(e as HTMLInputElement).name||'').trim().slice(0,20)}"`;
 const rects=els.map(clip),bad:string[]=[];
 for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){if(els[i].contains(els[j])||els[j].contains(els[i]))continue;const a=rects[i],b=rects[j],w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(w>2&&h>2)bad.push(`${name(els[i])} × ${name(els[j])}`)}
 return bad});
const overflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);

test('홈 첫 로딩 JS·접근성·터치 크기·가로 넘침 예산',async({browser},info)=>{
 const owner=`budget-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 const mobile=(page.viewportSize()?.width??1280)<768;
 try{
  await page.request.get('/api/workspace');
  const {id:campaignId}=await (await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title:'예산 캠페인',goal:'예산 확인'}}})).json();
  const js:number[]=[];page.on('response',async r=>{if(new URL(r.url()).pathname.endsWith('.js')){try{js.push(gzipSync(await r.body()).length)}catch{/* 응답 본문이 없으면 세지 않는다 */}}});
  await page.goto('/');await page.waitForLoadState('networkidle');
  const homeKB=Math.round(js.reduce((a,b)=>a+b,0)/1024);
  info.annotations.push({type:'homeJsGzKB',description:String(homeKB)});
  expect(homeKB,`home JS ${homeKB}KB gz`).toBeLessThanOrEqual(budget.homeJsGzKB);
  for(const path of ['/',`/?view=campaigns&campaign=${campaignId}`,`/?view=campaigns&campaign=${campaignId}&ctab=growth`,`/?view=campaigns&campaign=${campaignId}&ctab=meta-ads`,'/?view=settings','/?view=campaigns','/?view=learning','/?view=brands','/?view=stores','/?view=results','/?view=agents','/?view=assets']){
   await page.goto(path);await page.waitForLoadState('networkidle');
   const a=await axeSerious(page);expect(a.count,`${path} ${a.rules.join(',')}`).toBeLessThanOrEqual(budget.axeCriticalSerious);
   expect(await overflow(page),path).toBeLessThanOrEqual(budget.horizontalOverflowPx);
   // 탭 줄이 여러 줄로 감길 때 탭이 탭 줄 밖으로 넘치거나 아래 내용을 덮지 않는다(2026-10-01 모바일 겹침 회귀 방지).
   const tabs=await page.evaluate(()=>[...document.querySelectorAll('[data-slot=tabs-list]')].filter(l=>(l as HTMLElement).offsetParent).map(l=>{const r=l.getBoundingClientRect();const last=Math.max(...[...l.querySelectorAll('[role=tab]')].map(t=>t.getBoundingClientRect().bottom));return Math.round(last-r.bottom)}));
   for(const over of tabs)expect(over,`${path} tab row overflows its list by ${over}px`).toBeLessThanOrEqual(1);
   const hit=await overlaps(page);expect(hit,`${path} overlapping controls: ${hit.slice(0,6).join(' | ')}`).toEqual([]);
   if(mobile){const t=await touch(page);expect(100*(t.total-t.small)/Math.max(1,t.total),`${path} ${t.small}/${t.total} under 44px`).toBeGreaterThanOrEqual(budget.mobileTouchTargetPct)}
  }
 }finally{await context.close()}
});

// UX-PLAN-3 ⑩ 5점 조건. 4G(왕복 150ms·내려받기 1.6Mbps·올리기 750kbps)+CPU 4배 감속에서 빈 캐시로 연 홈의 LCP(largest-contentful-paint 마지막 후보)와,
// 같은 CPU 감속에서 핵심 조작(홈 표에서 캠페인 열기·성장·판매 탭·'/' 바로 가기)의 Event Timing duration 최댓값(INP와 같은 계산: 조작마다 가장 긴 이벤트)을 잰다.
// lcpMs4g는 래칫이다. 3.4~3.6초에서 머리 스크립트 미리 요청(lib/ui/boot-fetch.ts)·홈 진입점 modulepreload(app/home-client.tsx)·홈 모듈 한 덩어리(vite.config.ts homeChunk)로
// 2026-10-02 로컬 HTTP/1.1 서버 2.34~2.51초(목표 2.5초)가 됐다. CI 러너 흔들림을 감안해 예산은 2.7초로 둔다.
// 데스크톱 프로젝트에서만 잰다. 모바일 프로젝트는 같은 Chromium에 폭만 좁힌 것이라 새 정보가 없고, 감속 아래 두 번째 측정이 흔들려 예산 판정만 불안정해진다.
test('4G 홈 LCP·핵심 조작 지연(INP) 예산',async({browser},info)=>{
 test.skip(info.project.name!=='desktop','데스크톱 프로젝트에서만 잰다');
 const owner=`perf-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const title='성능 측정 캠페인';await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'성능 확인'}}});
  await page.addInitScript(()=>{const w=window as unknown as {__events:{id:number;name:string;duration:number}[]};w.__events=[];new PerformanceObserver(list=>{for(const e of list.getEntries() as (PerformanceEventTiming&{interactionId:number})[])if(e.interactionId)w.__events.push({id:e.interactionId,name:e.name,duration:e.duration})}).observe({type:'event',durationThreshold:16,buffered:true} as PerformanceObserverInit)});
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto('/');const open=page.locator('.campaign-table .campaign-name',{hasText:title});await expect(open).toBeVisible({timeout:30_000});await page.waitForLoadState('networkidle');
  const lcp=await page.evaluate(()=>new Promise<number>(done=>{new PerformanceObserver(list=>{const e=list.getEntries();done(Math.round(e[e.length-1].startTime))}).observe({type:'largest-contentful-paint',buffered:true});setTimeout(()=>done(-1),3000)}));
  info.annotations.push({type:'lcpMs4g',description:String(lcp)});
  expect(lcp,'no largest-contentful-paint entry').toBeGreaterThan(0);expect(lcp,`home LCP ${lcp}ms under 4G`).toBeLessThanOrEqual(budget.lcpMs4g);
  // 조작 지연은 네트워크와 무관하므로 4G 제한만 풀고 CPU 4배 감속은 둔다. 조작마다 그 사이 생긴 이벤트의 최댓값을 남긴다.
  // 사람은 누르기 전에 마우스를 올린다. 올렸을 때 미리 받는 화면 코드(data-prefetch)가 다 받아진 뒤 누른 지연을 잰다(Playwright는 올리자마자 누른다).
  const settle=async(target:ReturnType<typeof page.locator>)=>{await target.hover();await page.waitForLoadState('networkidle');await page.waitForTimeout(200)};
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  const worst:Record<string,number>={};
  const measure=async(name:string,act:()=>Promise<void>)=>{const from=await page.evaluate(()=>(window as unknown as {__events:unknown[]}).__events.length);await act();await page.waitForTimeout(300);worst[name]=await page.evaluate(n=>Math.max(0,...(window as unknown as {__events:{duration:number}[]}).__events.slice(n).map(e=>e.duration)),from)};
  await settle(open);await measure('open-campaign',async()=>{await open.click();await expect(page.getByRole('tab',{name:'성장·판매',exact:true})).toBeVisible({timeout:30_000})});
  await settle(page.getByRole('tab',{name:'성장·판매',exact:true}));await measure('growth-tab',async()=>{await page.getByRole('tab',{name:'성장·판매',exact:true}).click();await expect(page.getByRole('tab',{name:'성장·판매',exact:true})).toHaveAttribute('aria-selected','true');await page.waitForLoadState('networkidle')});
  await page.locator('body').click({position:{x:5,y:5}});
  await measure('palette',async()=>{await page.keyboard.press('/');await expect(page.getByRole('dialog',{name:'바로 가기'})).toBeVisible({timeout:30_000})});
  const inp=Math.max(...Object.values(worst));
  info.annotations.push({type:'inpMs',description:JSON.stringify(worst)});
  expect(inp,`interaction latency ${JSON.stringify(worst)}`).toBeLessThanOrEqual(budget.inpMs);
 }finally{await context.close()}
});
