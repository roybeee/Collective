// 화면·UX 계측(docs/UX-PLAN.ko.md 부록 A). 로컬 E2E 서버(node e2e/serve.mjs)에 합성 소유자로 지점·캠페인·상품·오퍼·미션을 만들고,
// 화면 10종 × 모바일·데스크톱을 캡처해 화면마다 글자 수·대비 실패·44px 미만 타깃·헤딩 순서·접힘 패널·높이·axe(WCAG 2.x AA) 위반을 metrics.json에 남긴다.
// 외부 호출 없음. 운영 서버에 쓰지 않는다. 사용: node scripts/ux-audit.mjs [출력 폴더=e2e/artifacts/ux-audit]
// 환경: E2E_PORT(기본 8799), PLAYWRIGHT_CHROMIUM(크로미움 실행 파일, 없으면 Playwright 기본 설치본).
import {chromium} from '@playwright/test';
import {existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const port=process.env.E2E_PORT||'8799',base=`http://127.0.0.1:${port}`,out=process.argv[2]||'e2e/artifacts/ux-audit';
mkdirSync(out,{recursive:true});
const owner=`ux-audit-${Date.now()}`;
const launch={};if(process.env.PLAYWRIGHT_CHROMIUM)launch.executablePath=process.env.PLAYWRIGHT_CHROMIUM;
const browser=await chromium.launch(launch);
const metrics={owner,base,at:new Date().toISOString(),screens:[]};
// axe-core는 Playwright의 전이 의존성이라 pnpm 저장소에서 찾는다. 없으면 axe 항목만 비운다.
const axePath=(()=>{const store='node_modules/.pnpm';if(!existsSync(store))return null;const dir=readdirSync(store).find(d=>d.startsWith('axe-core@'));return dir?join(store,dir,'node_modules/axe-core/axe.min.js'):null})();
async function axeRun(page){
 if(!axePath)return {skipped:'axe-core not found'};
 try{await page.addScriptTag({path:axePath});return await page.evaluate(async()=>{const res=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}});const by={};for(const v of res.violations)by[v.impact]=(by[v.impact]||0)+v.nodes.length;return {violations:res.violations.length,nodes:res.violations.reduce((n,v)=>n+v.nodes.length,0),byImpact:by,rules:res.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,help:v.help})).sort((a,b)=>b.nodes-a.nodes).slice(0,12)}})}
 catch(e){return {error:e.message}}
}
// 화면 안에서 계산: 텍스트 노드 대비(WCAG 1.4.3 기준 4.5:1, 큰 글자 3:1), 44px 미만 상호작용 요소, 헤딩 순서, 접힘 패널, 높이.
const inPage=()=>{
 const rgb=s=>{const m=s.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(',').map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
 const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
 const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)};
 const bgOf=el=>{let e=el;while(e){const c=rgb(getComputedStyle(e).backgroundColor);if(c&&c.a>0.9)return c;e=e.parentElement}return {r:255,g:255,b:255,a:1}};
 const visible=el=>{const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none')return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
 let textFail=0,textTotal=0;const fails=[];const seen=new Set();
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){const t=walker.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement;if(!el||seen.has(el)||!visible(el))continue;seen.add(el);const cs=getComputedStyle(el);const fg=rgb(cs.color);if(!fg)continue;const bg=bgOf(el);const size=parseFloat(cs.fontSize),bold=parseInt(cs.fontWeight)>=700;const need=(size>=24||(size>=18.66&&bold))?3:4.5;const rt=ratio(fg,bg);textTotal++;if(rt<need){textFail++;if(fails.length<6)fails.push({text:t.textContent.trim().slice(0,28),fg:cs.color,bg:`rgb(${bg.r},${bg.g},${bg.b})`,ratio:+rt.toFixed(2),size})}}
 const inter=[...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab],summary')].filter(visible);
 const box=e=>e.getBoundingClientRect();
 const under44=inter.filter(e=>box(e).height<44||box(e).width<44).length,under32=inter.filter(e=>box(e).height<32||box(e).width<32).length;
 const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(h=>h.tagName.toLowerCase());
 const unnamedButtons=[...document.querySelectorAll('button')].filter(visible).filter(b=>!(b.textContent.trim()||b.getAttribute('aria-label')||b.getAttribute('title'))).length;
 const smallText=[...seen].filter(el=>parseFloat(getComputedStyle(el).fontSize)<12).length;
 const chars=document.body.innerText.replace(/\s+/g,' ').trim().length;
 const sheet=document.querySelector('.campaign-sheet');
 return {textTotal,textFail,fails,interactive:inter.length,under44,under32,headings:headings.join(' '),unnamedButtons,smallText,chars,details:document.querySelectorAll('details').length,detailsOpen:document.querySelectorAll('details[open]').length,scrollW:document.documentElement.scrollWidth,innerW:innerWidth,docH:document.documentElement.scrollHeight,sheetScrollH:sheet?sheet.scrollHeight:null,sheetClientH:sheet?sheet.clientHeight:null};
};
async function shot(page,project,name,extra={}){
 await page.waitForTimeout(400);
 const file=`${out}/${project}-${name}.png`;
 try{await page.screenshot({path:file,fullPage:!extra.viewportOnly})}catch(e){console.error('shot fail',name,e.message)}
 let m={};try{m=await page.evaluate(inPage)}catch(e){m={error:e.message}}
 const axe=await axeRun(page);
 metrics.screens.push({project,name,...m,axe,...extra});
 console.log(`[${project}] ${name}: axe=${axe.nodes??'-'}(${JSON.stringify(axe.byImpact??{})}) chars=${m.chars} contrastFail=${m.textFail}/${m.textTotal} under44=${m.under44}/${m.interactive} details=${m.details} sheetH=${m.sheetScrollH} docH=${m.docH}`);
}
for(const project of [{name:'desktop',viewport:{width:1280,height:800}},{name:'mobile',viewport:{width:390,height:844}}]){
 const context=await browser.newContext({viewport:project.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}});
 const page=await context.newPage();
 const post=async(path,data)=>{const r=await page.request.post(base+path,{data});const body=await r.json();if(r.status()!==200)console.error('seed fail',path,r.status(),JSON.stringify(body).slice(0,200));return body};
 // 합성 데이터는 첫 통과(데스크톱)에서 한 번 만들고 모바일은 같은 소유자를 재사용한다.
 let campaignId=metrics.campaignId;
 if(!campaignId){
  await page.request.get(base+'/api/workspace');
  const store=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'성수 플래그십',address:'서울 성동구 연무장길 00',tradeArea:'residential',goal:'주말 방문 20% 증가'}});
  const camp=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId:store.id,title:'맵달 매운 세트 10월 판매',goal:'10월 한 달 매운 세트 300개 판매'}});
  campaignId=camp.id;metrics.campaignId=campaignId;metrics.storeId=store.id;
  const g=(action,id,input)=>post('/api/growth',{action,id,input,campaignId,campaignVersion:1,expectedVersion:0});
  await g('save_catalog','cat-spicy',{sku:'MD-SPICY-SET',title:'매운 세트(2인)',price:19800,unitCost:7200,variableCost:1800,stock:120,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'택배 배송(주문 후 2일)',refunds:'미개봉 7일 내 반품',rightsConfirmed:true,factIds:[],validUntil:'2026-12-31'});
  await g('save_offer','offer-oct',{title:'10월 매운 세트 런칭 오퍼',catalogId:'cat-spicy',catalogVersion:1,needId:'',price:19800,quantity:1,landingUrl:'https://example.com/spicy-set',purchaseReason:'주말 홈파티용 매운 세트',priceApproved:true});
  await g('save_mission','mission-oct',{title:'10월 매운 세트 자연 유입 판매',offerId:'offer-oct',offerVersion:1,assignee:'운영 담당',deadline:'2026-10-31',nextAction:'상세페이지 승인 후 발행',channel:'storefront',budget:0,lossLimit:0,stopRule:'반품률 10% 초과 시 중단',fulfillmentOwner:'물류 담당'});
 }
 const P=project.name;
 const go=async q=>{await page.goto(base+'/'+q);await page.waitForLoadState('networkidle').catch(()=>{})};
 await go('');await shot(page,P,'01-overview');
 await go('?view=campaigns');await shot(page,P,'02-campaigns');
 await go('?view=brands&brand=ofd');await shot(page,P,'03-brand-archive');
 await go('?view=stores&brand=ofd');await shot(page,P,'04-stores');
 await go('?view=learning');await shot(page,P,'05-learning');
 await go('?view=agents');await shot(page,P,'06-agents');
 await go('?view=settings');await shot(page,P,'07-settings');
 await go(`?view=campaigns&campaign=${campaignId}`);
 await page.getByRole('tab',{name:'브리프',exact:true}).waitFor({timeout:10000}).catch(()=>{});
 await shot(page,P,'10-campaign-brief',{viewportOnly:true});
 // 성장·판매 탭: 열기 뒤 요청 수. 브라우저 측 계수는 networkidle 타이밍에 흔들리므로 서버 로그(e2e/artifacts/server-*.log)의 4초 창 계수를 기준으로 삼는다.
 const reqs=[];const onReq=r=>{if(r.url().includes('/api/'))reqs.push(new URL(r.url()).pathname)};
 page.on('request',onReq);const t0=Date.now();
 await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
 await page.waitForTimeout(3000);await page.waitForLoadState('networkidle').catch(()=>{});const t1=Date.now();page.off('request',onReq);
 const growthReqs={count:reqs.length,distinct:[...new Set(reqs)].length,ms:t1-t0,paths:[...new Set(reqs)]};
 await shot(page,P,'11-growth-top',{viewportOnly:true,growthReqs});
 try{writeFileSync(`${out}/${P}-growth-aria.txt`,await page.locator('.campaign-sheet').ariaSnapshot())}catch(e){console.error('aria fail',e.message)}
 const scrollSheet=y=>page.evaluate(y=>{const s=document.querySelector('.campaign-sheet');if(s)s.scrollTop=y},y);
 await scrollSheet(project.viewport.height*0.9);await shot(page,P,'12-growth-scroll1',{viewportOnly:true});
 await scrollSheet(project.viewport.height*1.8);await shot(page,P,'13-growth-scroll2',{viewportOnly:true});
 await scrollSheet(0);
 for(const [summary,name] of [[/^고객 문의·약속 기한$/,'14-growth-cs-open'],[/^판매 실험·사전등록·분석$/,'15-growth-experiment-open']]){
  try{const s=page.locator('summary').filter({hasText:summary});await s.click();await s.scrollIntoViewIfNeeded();await shot(page,P,name,{viewportOnly:true})}catch(e){console.error('open',name,e.message)}
 }
 for(const [tab,name] of [['Meta 광고 준비','20-meta'],['제작·발행','21-execution'],['성과','22-results'],['팀 회의','23-meeting'],['AI 팀','24-team']]){
  try{await page.getByRole('tab',{name:tab,exact:true}).click();await page.waitForLoadState('networkidle').catch(()=>{});await shot(page,P,name,{viewportOnly:true})}catch(e){console.error('tab',tab,e.message)}
 }
 // 첫 로드 무게: 새 컨텍스트(캐시 없음)에서 JS·CSS 바이트와 내비게이션 타이밍.
 const sizes={js:0,css:0,requests:0};const ctx2=await browser.newContext({viewport:project.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}});const p2=await ctx2.newPage();
 p2.on('response',async r=>{try{const u=r.url();if(/\.(js|css)(\?|$)/.test(u)){const b=await r.body();sizes.requests++;if(/\.css(\?|$)/.test(u))sizes.css+=b.length;else sizes.js+=b.length}}catch{}});
 const n0=Date.now();await p2.goto(base+'/');await p2.waitForLoadState('networkidle').catch(()=>{});sizes.ms=Date.now()-n0;
 const nav=await p2.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return {domContentLoaded:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd)}});
 metrics.screens.push({project:P,name:'00-initial-load',sizes,nav});console.log(`[${P}] initial load js=${(sizes.js/1024).toFixed(0)}KB css=${(sizes.css/1024).toFixed(0)}KB files=${sizes.requests} idle=${sizes.ms}ms nav=${JSON.stringify(nav)}`);
 await ctx2.close();await context.close();
}
writeFileSync(`${out}/metrics.json`,JSON.stringify(metrics,null,1));
await browser.close();
console.log(`done → ${out}/metrics.json`);
