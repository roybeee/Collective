import {test,expect,type Page} from '@playwright/test';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
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
// 글자가 한 글자씩 세로로 쌓이는 요소(폭이 글자 두 개보다 좁은데 세 줄을 넘는다). 2026-10-02 설정 채널 줄이 상태 점 규칙(7px 폭)에 걸려 세로로 겹친 회귀(평가 9회차)를 잡는다.
const squeezed=(page:Page)=>page.evaluate(()=>{const bad:string[]=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const seen=new Set<Element>();
 while(walker.nextNode()){const t=walker.currentNode,el=t.parentElement;if(!el||seen.has(el)||(t.textContent||'').trim().length<3)continue;seen.add(el);const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.fontSize)<1)continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;const fs=parseFloat(cs.fontSize),lh=parseFloat(cs.lineHeight)||fs*1.4;if(r.width<fs*2&&r.height>lh*3)bad.push(`${el.tagName.toLowerCase()}.${el.className} "${(t.textContent||'').trim().slice(0,20)}" ${Math.round(r.width)}x${Math.round(r.height)}`)}
 return bad});
// 아래 검사들이 도는 화면(이름은 annotation에 쓴다). 캠페인 화면은 예산 캠페인 하나로 연다.
const routes=(campaignId:string):[string,string][]=>[['홈','/'],['캠페인 브리프',`/?view=campaigns&campaign=${campaignId}`],['캠페인 성장·판매',`/?view=campaigns&campaign=${campaignId}&ctab=growth`],['캠페인 Meta',`/?view=campaigns&campaign=${campaignId}&ctab=meta-ads`],['설정','/?view=settings'],['캠페인 목록','/?view=campaigns'],['학습','/?view=learning'],['브랜드','/?view=brands'],['점포','/?view=stores'],['성과','/?view=results'],['AI 팀','/?view=agents'],['작업물','/?view=assets']];
// 화면에 그려진 가운뎃점(' · ') 수(평가 10회차 ⑦: 소스 래칫 middleDotJoins·libMiddleDots와 별개로 실제 화면 글자를 센다). document.body.innerText 기준.
// 다른 레인 소유 화면(가맹·품질 콘솔·품질 운영·인터뷰·Reflector·사용량·고객 보고서·온라인 채점)의 그릇 안 글자는 따로 센다. 보고만 하고 판정하지 않는다(레인 A 화면이 0이 아니다).
const middleDots=(page:Page)=>page.evaluate(()=>{const n=(t:string)=>t.split(' · ').length-1,total=n(document.body.innerText);
 const roots=[...document.querySelectorAll<HTMLElement>('.franchise-panel,.franchise-box,.interview-studio,.quality-stats,.quality-table,section[aria-label="Reflector"],section[aria-label="운영 검증과 프롬프트 적용"],section[aria-label="고객 보고서"],[aria-label="작업물 온라인 채점"]'),
  ...[...document.querySelectorAll('h2')].filter(h=>h.textContent?.trim()==='AI 사용량과 비용').map(h=>h.closest('section')).filter((x):x is HTMLElement=>!!x)];
 const other=roots.filter(r=>!roots.some(o=>o!==r&&o.contains(r))).reduce((sum,r)=>sum+n(r.innerText),0);
 return {total,laneA:total-other,other}});

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
  const dots:string[]=[];
  for(const [label,path] of routes(campaignId)){
   await page.goto(path);await page.waitForLoadState('networkidle');
   const d=await middleDots(page);dots.push(`${label} ${d.total}(A ${d.laneA}, 다른 레인 ${d.other})`);
   const a=await axeSerious(page);expect(a.count,`${path} ${a.rules.join(',')}`).toBeLessThanOrEqual(budget.axeCriticalSerious);
   expect(await overflow(page),path).toBeLessThanOrEqual(budget.horizontalOverflowPx);
   // 탭 줄이 여러 줄로 감길 때 탭이 탭 줄 밖으로 넘치거나 아래 내용을 덮지 않는다(2026-10-01 모바일 겹침 회귀 방지).
   const tabs=await page.evaluate(()=>[...document.querySelectorAll('[data-slot=tabs-list]')].filter(l=>(l as HTMLElement).offsetParent).map(l=>{const r=l.getBoundingClientRect();const last=Math.max(...[...l.querySelectorAll('[role=tab]')].map(t=>t.getBoundingClientRect().bottom));return Math.round(last-r.bottom)}));
   for(const over of tabs)expect(over,`${path} tab row overflows its list by ${over}px`).toBeLessThanOrEqual(1);
   const thin=await squeezed(page);expect(thin,`${path} text squeezed into a vertical strip: ${thin.slice(0,4).join(' | ')}`).toEqual([]);
   const hit=await overlaps(page);expect(hit,`${path} overlapping controls: ${hit.slice(0,6).join(' | ')}`).toEqual([]);
   if(mobile){const t=await touch(page);expect(100*(t.total-t.small)/Math.max(1,t.total),`${path} ${t.small}/${t.total} under 44px`).toBeGreaterThanOrEqual(budget.mobileTouchTargetPct)}
  }
  info.annotations.push({type:'middleDots',description:dots.join(' / ')});
 }finally{await context.close()}
});

// UX-PLAN-3 ⑨ 5점 조건(평가 10회차): 200% 확대에서 내용 손실이 없다. 1280×800 화면을 200%로 키우면 CSS 화면 폭·높이가 640×400이 된다(WCAG 1.4.4·1.4.10).
// 같은 화면들에서 글자가 세로 띠로 눌림(squeezed)·누를 수 있는 요소끼리 겹침(overlaps)·가로 넘침이 없어야 한다. 640px은 모바일 배치(768px 미만)로 그려진다.
// 데스크톱 프로젝트에서만 잰다(모바일 프로젝트는 이미 390px 폭이다).
test('200% 확대(640×400) 내용 손실 없음',async({browser},info)=>{
 test.skip(info.project.name!=='desktop','1280×800을 200%로 키운 화면은 데스크톱 프로젝트에서만 잰다');test.setTimeout(120_000);
 const owner=`zoom-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const {id:campaignId}=await (await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title:'확대 캠페인',goal:'200% 확대 확인'}}})).json();
  await page.setViewportSize({width:640,height:400});
  for(const [label,path] of routes(campaignId)){
   await page.goto(path);await page.waitForLoadState('networkidle');
   expect(await overflow(page),`200% ${label} ${path}`).toBeLessThanOrEqual(budget.horizontalOverflowPx);
   const thin=await squeezed(page);expect(thin,`200% ${label} text squeezed into a vertical strip: ${thin.slice(0,4).join(' | ')}`).toEqual([]);
   const hit=await overlaps(page);expect(hit,`200% ${label} overlapping controls: ${hit.slice(0,6).join(' | ')}`).toEqual([]);
  }
 }finally{await context.close()}
});

// UX-PLAN-3 ⑩ 5점 조건. 4G(왕복 150ms·내려받기 1.6Mbps·올리기 750kbps)+CPU 4배 감속에서 빈 캐시로 연 홈의 LCP(largest-contentful-paint 마지막 후보)와,
// 같은 CPU 감속에서 핵심 조작(홈 표에서 캠페인 열기·성장·판매 탭·'/' 바로 가기)의 Event Timing duration 최댓값(INP와 같은 계산: 조작마다 가장 긴 이벤트)을 잰다.
// lcpMs4g는 래칫이다. 3.4~3.6초에서 머리 스크립트 미리 요청(lib/ui/boot-fetch.ts)·홈 진입점 modulepreload(app/home-client.tsx)·홈 모듈 한 덩어리(vite.config.ts homeChunk)로
// 홈 아래쪽을 첫 그림 다음 프레임에 그리게 해(components/app/after-paint.tsx) 2026-10-02 로컬 통합 빌드 2.32~2.38초가 됐다. 예산은 목표 2.5초이고, 세 번 잰 중앙값으로 판정한다(평가 10회차).
// 데스크톱 프로젝트에서만 잰다. 모바일 프로젝트는 같은 Chromium에 폭만 좁힌 것이라 새 정보가 없고, 감속 아래 두 번째 측정이 흔들려 예산 판정만 불안정해진다.
test('4G 홈 LCP·핵심 조작 지연(INP) 예산',async({browser},info)=>{
 test.skip(info.project.name!=='desktop','데스크톱 프로젝트에서만 잰다');test.setTimeout(150_000);
 const owner=`perf-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  await page.request.get('/api/workspace');
  const title='성능 측정 캠페인';await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'성능 확인'}}});
  await page.addInitScript(()=>{const w=window as unknown as {__events:{id:number;name:string;duration:number}[]};w.__events=[];new PerformanceObserver(list=>{for(const e of list.getEntries() as (PerformanceEventTiming&{interactionId:number})[])if(e.interactionId)w.__events.push({id:e.interactionId,name:e.name,duration:e.duration})}).observe({type:'event',durationThreshold:16,buffered:true} as PerformanceObserverInit)});
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto('/');const open=page.locator('.campaign-table .campaign-name',{hasText:title});await expect(open).toBeVisible({timeout:30_000});await page.waitForLoadState('networkidle');
  // 한 번 잰 값은 흔들린다(평가 10회차). 빈 캐시로 새 창을 두 번 더 열어 세 번의 중앙값을 예산과 비교한다.
  const readLcp=(p:typeof page)=>p.evaluate(()=>new Promise<number>(done=>{new PerformanceObserver(list=>{const e=list.getEntries();done(Math.round(e[e.length-1].startTime))}).observe({type:'largest-contentful-paint',buffered:true});setTimeout(()=>done(-1),3000)}));
  const coldLcp=async()=>{const c=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}});try{const p=await c.newPage(),s=await c.newCDPSession(p);await s.send('Network.enable');await s.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await s.send('Emulation.setCPUThrottlingRate',{rate:4});await p.goto('/');await expect(p.locator('.campaign-table .campaign-name',{hasText:title})).toBeVisible({timeout:30_000});await p.waitForLoadState('networkidle');return await readLcp(p)}finally{await c.close()}};
  const samples=[await readLcp(page),await coldLcp(),await coldLcp()],lcp=[...samples].sort((a,b)=>a-b)[1];
  info.annotations.push({type:'lcpMs4g',description:`${lcp} (중앙값, ${samples.join('·')})`});
  expect(Math.min(...samples),'no largest-contentful-paint entry').toBeGreaterThan(0);expect(lcp,`home LCP median ${lcp}ms under 4G (${samples.join(', ')})`).toBeLessThanOrEqual(budget.lcpMs4g);
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

// QA D10(2026-11-09 독립 평가 D1~D6): 빈 캠페인·스위치 꺼짐만 재면 결정 인박스·상태 배지·실행 타임라인 결함을 놓친다. 실제와 비슷한 홈을 만든다:
// 기능 스위치를 모두 켜고(켜지지 않는 스위치는 건너뛴다), 안건 종류마다 항목을 둔다 — 결정(작업물 검토 대기·발행 승인 대기·플레이스 초안·광고 제안), 질문(브리프 확인 질문),
// 알림(새 감지 신호·크레딧 알림·AI 검색 노출 측정). 라이트·다크 모두 axe serious·critical 0, 390px에서 문서 폭 ≤ 화면 폭. 실행 기록이 있는 AI 팀 탭(타임라인)과 가맹 모집도 함께 잰다.
// Real local D1/API/Chromium. 인증 헤더 mocked. 일부 기록은 로컬 D1 fixture. 외부 호출·지출 없음.
function seedSql(statements:string[]){
 const folder=mkdtempSync(join(tmpdir(),'ux-budget-seed-'));
 try{const path=join(folder,'seed.sql');writeFileSync(path,statements.join('\n'));execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','e2e/.state','--file',path],{stdio:'pipe'})}finally{rmSync(folder,{recursive:true,force:true})}
}
const q=(v:string)=>`'${v.replaceAll("'","''")}'`;
const recordSql=(owner:string,kind:string,id:string,parent:string,data:unknown)=>`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(${[`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),new Date().toISOString()].map(q).join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`;
test('기능을 모두 켜고 안건 종류마다 항목이 있는 홈도 접근성·가로 넘침 예산을 지킨다(라이트·다크)',async({browser},info)=>{
 test.setTimeout(150_000);
 const owner=`seeded-home-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};
 try{
  await page.request.get('/api/workspace');
  const {flags}=await (await page.request.get('/api/feature-flags')).json() as {flags:{flag:string}[]};
  const on:string[]=[];for(const {flag} of flags){const r=await page.request.post('/api/feature-flags',{data:{action:'set',flag,enabled:true}});if(r.ok())on.push(flag)}
  info.annotations.push({type:'flagsOn',description:`${on.length}/${flags.length}`});
  const {id:campaignId,version}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',title:'안건 예산 캠페인',goal:'결정 인박스 접근성 확인'}}) as {id:string;version?:number};
  for(const [role,title] of [['strategy','브랜드 방향 초안'],['content','게시 카피 초안 — 아주 긴 제목으로 한 줄 요약이 좁은 화면 폭을 넘기는지 확인하는 작업물']])await post('/api/action',{action:'save_artifact',campaignId,role,title,content:'## 합성\n본문'});
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'안건 예산 지점',address:'합성 주소',tradeArea:'residential',goal:'안건'}}) as {id:string};
  await page.request.post('/api/place-drafts',{data:{action:'create',kind:'review_reply',storeId,sourceText:'맛있고 친절했어요.',rating:5}});
  const now=new Date().toISOString(),before=new Date(Date.now()-86400000).toISOString(),month=new Date(Date.now()+9*3600000).toISOString().slice(0,7),cv=version??1;
  seedSql([
   recordSql(owner,'execution_publication','budget-pub',campaignId,{id:'budget-pub',campaignId,campaignVersion:cv,creativeId:'c',creativeVersion:1,pngHash:'b'.repeat(64),factRefs:[],caption:'합성 발행 문구',mediaUrl:'',mediaMode:'auto',scheduledAt:new Date(Date.now()+2*86400000).toISOString(),plannedCostKRW:1500,version:1,status:'draft',createdAt:before}),
   recordSql(owner,'brief_draft','budget-brief',campaignId,{id:'budget-brief',status:'completed',campaignId,input:{},result:{summary:'합성',suggestions:[],questions:[{field:'kpi',question:'목표 지표는 무엇인가요?',why:'합성'}],assumptions:[],contextUsed:[]},createdAt:before,updatedAt:before,model:'m'}),
   recordSql(owner,'growth_detected_signal','budget-signal',campaignId,{id:'budget-signal',campaignId,status:'new',version:1,detection:{title:'최근 7일 유료 주문 증가',detail:'합성 신호',kind:'orders_up'}}),
   recordSql(owner,'billing_alert',`${month}-80`,'',{id:`${month}-80`,month,level:80,kind:'signal',title:'크레딧 80% 사용',detail:'이번 달 크레딧의 80%를 썼습니다.',createdAt:now}),
   recordSql(owner,'geo_run','budget-geo','ofd',{id:'budget-geo',brandId:'ofd',campaignId,status:'completed',jobs:[{id:'j1',status:'completed'},{id:'j2',status:'failed'}],createdAt:before,updatedAt:now}),
   recordSql(owner,'ads_proposal','budget-ads','',{id:'budget-ads',channel:'naver_ads',campaignId:'ncc-budget',storeId:null,brandId:'ofd',kind:'bid',riskTier:'T2',status:'draft',target:{type:'keyword',ids:['k'],names:['떡볶이']},diff:{before:{},after:{}},history:[],createdAt:before}),
   `INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(${[`budget-job-${owner}`,owner,campaignId,'content','completed','synthetic-model'].map(q).join(',')},${cv},${q(before)},${q(now)});`,
  ]);
  const result:Record<string,unknown>={};
  for(const theme of ['light','dark'] as const){
   await page.addInitScript(t=>{try{localStorage.setItem('theme',t)}catch{/* 저장소가 막히면 시스템 테마 */}},theme);
   await page.goto('/');await page.waitForLoadState('networkidle');
   const agenda=page.getByRole('region',{name:'오늘의 안건',exact:true});
   await expect(agenda.locator('[data-inbox-row]').first()).toBeVisible({timeout:30_000});
   if(theme==='dark')await expect(page.locator('html')).toHaveClass(/\bdark\b/);
   const kinds=await agenda.locator('[data-inbox-row]').evaluateAll(rows=>[...new Set(rows.map(r=>r.getAttribute('data-kind')))]);
   expect(kinds,'seeded agenda has decision, question and notification rows').toEqual(expect.arrayContaining(['decision','question','signal']));
   const approve=agenda.getByRole('button',{name:'승인',exact:true}).first();await expect(approve).toBeVisible();
   const colors=await approve.evaluate(e=>{const cs=getComputedStyle(e);return [cs.color,cs.backgroundColor]});expect.soft(colors[0],'approve text differs from its background').not.toBe(colors[1]);
   const width=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,view:window.innerWidth}));
   const home=await axeSerious(page);result[`home-${theme}`]={axe:home.count,rules:home.rules,docWidth:width.doc,viewport:width.view};
   expect.soft(home.count,`seeded home (${theme}) ${home.rules.join(',')}`).toBeLessThanOrEqual(budget.axeCriticalSerious);
   expect.soft(width.doc-width.view,`seeded home (${theme}) document ${width.doc}px > viewport ${width.view}px`).toBeLessThanOrEqual(budget.horizontalOverflowPx);
   for(const [label,path] of [['AI 팀',`/?view=campaigns&campaign=${campaignId}&ctab=team`],['작업물',`/?view=campaigns&campaign=${campaignId}&ctab=outputs`],['가맹 모집','/?view=franchise']]){
    await page.goto(path);await page.waitForLoadState('networkidle');
    const a=await axeSerious(page);result[`${label}-${theme}`]={axe:a.count,rules:a.rules};
    expect.soft(a.count,`${label} (${theme}) ${a.rules.join(',')}`).toBeLessThanOrEqual(budget.axeCriticalSerious);
    expect.soft(await overflow(page),`${label} (${theme})`).toBeLessThanOrEqual(budget.horizontalOverflowPx);
   }
  }
  info.annotations.push({type:'seededHome',description:JSON.stringify(result)});
  console.log('[seeded-home]',info.project.name,JSON.stringify(result));
 }finally{await context.close()}
});
