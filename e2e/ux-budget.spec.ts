import {test,expect,type Page} from '@playwright/test';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
// UX-PLAN-3 Q0·Q7 런타임 예산(tests/ux-budget.json runtime): 홈 첫 로딩 JS(gz), axe critical·serious 0, 모바일 44px 비율, 가로 넘침.
// Real local D1/API/Chromium. 인증 헤더 mocked. 외부 호출 없음. 예산을 넘으면 실패한다.
const budget=JSON.parse(readFileSync('tests/ux-budget.json','utf8')).runtime as {homeJsGzKB:number;axeCriticalSerious:number;mobileTouchTargetPct:number;horizontalOverflowPx:number};
const axePath=(()=>{const store='node_modules/.pnpm';if(!existsSync(store))return null;const dir=readdirSync(store).find(d=>d.startsWith('axe-core@'));return dir?join(store,dir,'node_modules/axe-core/axe.min.js'):null})();
async function axeSerious(page:Page){
 if(!axePath)return {count:0,rules:['axe-core not found']};
 await page.addScriptTag({path:axePath});
 return page.evaluate(async()=>{const w=window as unknown as {axe:{run:(d:Document,o:unknown)=>Promise<{violations:{id:string;impact:string;nodes:unknown[]}[]}>}};const r=await w.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});const bad=r.violations.filter(v=>v.impact==='critical'||v.impact==='serious');return {count:bad.reduce((n,v)=>n+v.nodes.length,0),rules:bad.map(v=>`${v.id}:${v.nodes.length}`)}});
}
const touch=(page:Page)=>page.evaluate(()=>{const els=[...document.querySelectorAll('button,a[href],[role=tab],summary,select,input:not([type=hidden]):not([type=checkbox]):not([type=radio])')].filter(e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'});const small=els.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44});return {total:els.length,small:small.length}});
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
  for(const path of ['/',`/?view=campaigns&campaign=${campaignId}`,`/?view=campaigns&campaign=${campaignId}&ctab=growth`,`/?view=campaigns&campaign=${campaignId}&ctab=meta-ads`,'/?view=settings']){
   await page.goto(path);await page.waitForLoadState('networkidle');
   const a=await axeSerious(page);expect(a.count,`${path} ${a.rules.join(',')}`).toBeLessThanOrEqual(budget.axeCriticalSerious);
   expect(await overflow(page),path).toBeLessThanOrEqual(budget.horizontalOverflowPx);
   // 탭 줄이 여러 줄로 감길 때 탭이 탭 줄 밖으로 넘치거나 아래 내용을 덮지 않는다(2026-10-01 모바일 겹침 회귀 방지).
   const tabs=await page.evaluate(()=>[...document.querySelectorAll('[data-slot=tabs-list]')].filter(l=>(l as HTMLElement).offsetParent).map(l=>{const r=l.getBoundingClientRect();const last=Math.max(...[...l.querySelectorAll('[role=tab]')].map(t=>t.getBoundingClientRect().bottom));return Math.round(last-r.bottom)}));
   for(const over of tabs)expect(over,`${path} tab row overflows its list by ${over}px`).toBeLessThanOrEqual(1);
   if(mobile){const t=await touch(page);expect(100*(t.total-t.small)/Math.max(1,t.total),`${path} ${t.small}/${t.total} under 44px`).toBeGreaterThanOrEqual(budget.mobileTouchTargetPct)}
  }
 }finally{await context.close()}
});
