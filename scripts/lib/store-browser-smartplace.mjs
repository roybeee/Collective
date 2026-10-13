import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),marker='COLLECTIVE_SMARTPLACE_READ=';
const weekdays={월:'mon',화:'tue',수:'wed',목:'thu',금:'fri',토:'sat',일:'sun'};
const order=['mon','tue','wed','thu','fri','sat','sun'];
function official(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.hostname!=='new.smartplace.naver.com'||u.port||u.username||u.password||u.hash)throw Error('official SmartPlace URL required');
 const id=u.pathname.match(/^\/bizes\/place\/([0-9]+)(?:\/|$)/)?.[1];
 if(!id)throw Error('observed manager URL required');return {url:u.href,id};
}
export function validateSmartplaceConfig(native){
 if(!native||typeof native!=='object'||Object.keys(native).some(k=>!['dashboardUrl','hoursUrl'].includes(k)))throw Error('invalid observed native config');
 const dashboard=official(native.dashboardUrl),hours=official(native.hoursUrl);
 if(dashboard.id!==hours.id)throw Error('manager target mismatch');return native;
}
export function parseSmartplaceWeek(preview){
 const aria=Array.from(String(preview).matchAll(/- text: "([월화수목금토일])"([\s\S]*?)(?=- text: "[월화수목금토일]"|$)/g));
 if(aria.length)preview=aria.map(row=>{const ranges=Array.from(row[2].matchAll(/\d{1,2}:\d{2}\s*[-–~]\s*\d{1,2}:\d{2}/g),m=>m[0]);const times=Array.from(row[2].matchAll(/\d{1,2}:\d{2}/g));if(times.length!==ranges.length*2||/휴게|브레이크/.test(row[2]))throw Error('unsupported additional interval');return row[1]+' '+ranges.join(' ');}).join(' ');
 const days={};
 const observed=Array.from(String(preview).matchAll(/(?:^|\s)([월화수목금토일])\s+([0-2]?\d:[0-5]\d)\s*[-–~]\s*([0-2]?\d:[0-5]\d)/g));
 for(const [index,m] of observed.entries()){
  const key=weekdays[m[1]];if(days[key])throw Error('duplicate weekday');
  const start=m[2].padStart(5,'0'),end=m[3].padStart(5,'0');
  if(start>='24:00'||end>='24:00'||start===end)throw Error('unsupported day hours');
  const tail=String(preview).slice(m.index+m[0].length,observed[index+1]?.index);
  if(/\d{1,2}:\d{2}|휴게|브레이크/.test(tail))throw Error('unsupported additional interval');
  days[key]={state:'open',intervals:[{start,end,endsNextDay:end<start}]};
 }
 if(Object.keys(days).length!==7)throw Error('seven observed weekdays required');
 return Object.fromEntries(order.map(day=>[day,days[day]]));
}
export function buildSmartplaceReadCode(native,binding){
 validateSmartplaceConfig(native);
 if(official(native.hoursUrl).id!==binding.managerBusinessId||official(binding.managerUrl).url!==official(native.hoursUrl).url)throw Error('manager target mismatch');
 return String.raw`await (async()=>{
  async function navigate(url){const tabs=await listBrowserTabs();const found=tabs.filter(t=>t.url===url);if(found.length>1)throw Error('ambiguous manager tabs');if(found.length){await attachBrowserTab(found[0].targetId);await page.reload();}else await openTab(url);const seen=await snapshot(page);console.log(seen.tree);if(page.url()!==url||/캡차|CAPTCHA|자동입력|접근.{0,5}제한|로그인이 필요/.test(seen.tree))throw Error('login or access block');return seen;}
  const dashboard=await navigate(${JSON.stringify(native.dashboardUrl)});
  const names=page.locator('strong[class*="SideNavigation_name__"]');if(await names.count()!==1)throw Error('manager identity element changed');
  const storeName=(await names.textContent()).trim();
  const publicRefs=Array.from(dashboard.tree.matchAll(/-\s+link "내 플레이스 보기" \[ref=([^\]]+)\]/g));if(publicRefs.length!==1)throw Error('public target link missing or ambiguous');
  const publicLink=page.locator(publicRefs[0][1]);
  const publicUrl=new URL(await publicLink.getAttribute('href'),page.url());
  if(publicUrl.protocol!=='https:'||publicUrl.hostname!=='map.naver.com')throw Error('unexpected public target');
  const naverPlaceId=publicUrl.pathname.match(/\/entry\/place\/([0-9]+)(?:\/|$)/)?.[1];
  const managerBusinessId=new URL(page.url()).pathname.match(/\/bizes\/place\/([0-9]+)(?:\/|$)/)?.[1];
  if(storeName!==${JSON.stringify(binding.storeName)}||naverPlaceId!==${JSON.stringify(binding.naverPlaceId)}||managerBusinessId!==${JSON.stringify(binding.managerBusinessId)})throw Error('target mismatch');
  const hoursPage=await navigate(${JSON.stringify(native.hoursUrl)});
  const selected=page.locator('strong[class*="SideNavigation_name__"]');if(await selected.count()!==1||(await selected.textContent()).trim()!==storeName)throw Error('editor target changed');
  const preview=hoursPage.tree.match(/캘린더에서 다시 확인해보세요\.([\s\S]*?)우리가게 정보가 위와 같이 표기될 예정입니다\./)?.[1];
  if(!preview)throw Error('observed week preview unavailable');
  console.log(${JSON.stringify(marker)}+JSON.stringify({managerUrl:page.url(),managerBusinessId,naverPlaceId,storeName,weekPreview:preview,capturedAt:new Date().toISOString(),source:'real'}));
 })()`;
}

export function validatePublicTarget(value,expectedId){
 const url=new URL(value);if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash)throw Error('invalid public target URL');
 const id=url.hostname==='map.naver.com'?url.pathname.match(/^\/(?:v5|p)\/entry\/place\/([0-9]+)\/?$/)?.[1]:url.hostname==='pcmap.place.naver.com'?url.pathname.match(/^\/place\/([0-9]+)(?:\/home)?\/?$/)?.[1]:undefined;
 if(!id||id!==expectedId)throw Error('public target mismatch');return{url:url.href,id,path:url.origin+url.pathname};
}
export function buildSmartplacePublicCode(binding){
 validatePublicTarget(binding.publicUrl,binding.naverPlaceId);
 if(typeof binding.storeName!=='string'||!binding.storeName.trim())throw Error('public store name required');
 return String.raw`await(async()=>{
  const validate=${validatePublicTarget.toString()};const expected=${JSON.stringify(binding.naverPlaceId)};
  async function openObserved(url){const listed=await listBrowserTabs();const found=listed.filter(t=>t.url===url);if(found.length>1)throw Error('ambiguous public tabs');if(found.length){await attachBrowserTab(found[0].targetId);await page.reload();}else await openTab(url);const seen=await snapshot(page);console.log(seen.tree);validate(page.url(),expected);if(/CAPTCHA|캡차|자동입력|접근.{0,5}제한|로그인이 필요/.test(seen.tree))throw Error('public access unavailable');return seen;}
  let seen=await openObserved(${JSON.stringify(binding.publicUrl)});
  if(new URL(page.url()).hostname==='map.naver.com'){
   const frames=Array.from(seen.tree.matchAll(/- iframe "Naver Place Entry" \[ref=([^\]]+)\]/g));if(frames.length!==1)throw Error('observed place iframe missing');
   const href=await page.locator(frames[0][1]).getAttribute('src');const target=validate(new URL(href,page.url()).href,expected);if(new URL(target.url).hostname!=='pcmap.place.naver.com')throw Error('unexpected public iframe host');seen=await openObserved(target.url);
  }
  const name=page.locator('.IY7ZX');if(await name.count()!==1||(await name.textContent()).trim()!==${JSON.stringify(binding.storeName)})throw Error('public store name changed');
  const expands=Array.from(seen.tree.matchAll(/- button "[^"\n]*(?:영업|휴무)[^"\n]*펼쳐보기" \[ref=([^\]]+)\]/g));if(expands.length!==1)throw Error('observed hours expander missing');
  await page.locator(expands[0][1]).click();const expanded=await snapshot(page);console.log(expanded.diff);validate(page.url(),expected);
  const rows=Array.from(expanded.tree.matchAll(/- button "[^"\n]*(?:영업|휴무)[^"\n]*[월화수목금토일] \d{1,2}:\d{2}[^"\n]*" \[ref=([^\]]+)\]/g));if(rows.length!==1)throw Error('expanded public hours changed');
  const weekPreview=(await page.locator(rows[0][1]).textContent()).replace(/([월화수목금토일])\s*(\d{1,2}:\d{2})/g,' $1 $2');
  if(await name.count()!==1||(await name.textContent()).trim()!==${JSON.stringify(binding.storeName)})throw Error('public store identity changed');
  console.log('COLLECTIVE_SMARTPLACE_PUBLIC='+JSON.stringify({publicUrl:${JSON.stringify(binding.publicUrl)},observedPublicUrl:page.url(),naverPlaceId:expected,storeName:(await name.textContent()).trim(),weekPreview,capturedAt:new Date().toISOString(),source:'real'}));
 })()`;
}

export function createSmartplaceAdapter(config,binding,run=execute){
 validateSmartplaceConfig(config.native);
 const args=['repl','--host',config.host,config.host==='local'?'--account':'--profile',config.host==='local'?config.account:config.profile];
 async function observe(){
  let stdout;
  try{({stdout}=await run('aside',[...args,buildSmartplaceReadCode(config.native,binding)],{timeout:125000,maxBuffer:2*1024*1024,env:{PATH:process.env.PATH,HOME:process.env.HOME}}))}catch{throw Error('SmartPlace read failed; no save was attempted')}
  const lines=stdout.split('\n').filter(line=>line.startsWith(marker));if(lines.length!==1)throw Error('unambiguous target evidence required');
  const raw=JSON.parse(lines[0].slice(marker.length));
  if(['managerUrl','managerBusinessId','naverPlaceId','storeName'].some(k=>raw[k]!==binding[k]))throw Error('target mismatch');
  if(!['real','mocked'].includes(raw.source)||!Number.isFinite(Date.parse(raw.capturedAt)))throw Error('invalid observation evidence');
  const schedule=parseSmartplaceWeek(raw.weekPreview);
  return {managerUrl:raw.managerUrl,managerBusinessId:raw.managerBusinessId,naverPlaceId:raw.naverPlaceId,storeName:raw.storeName,schedule,hours:JSON.stringify(schedule),capturedAt:raw.capturedAt,source:raw.source,note:'관리 화면 캘린더의 7일 표시. 법정공휴일·임시 설정은 별도 확인.'};
 }
 async function publicReadback(){
  let stdout;try{({stdout}=await run('aside',[...args,buildSmartplacePublicCode(binding)],{timeout:125000,maxBuffer:2*1024*1024,env:{PATH:process.env.PATH,HOME:process.env.HOME}}));}catch{throw Error('public readback unavailable; no save attempted');}
  const lines=stdout.split('\n').filter(line=>line.startsWith('COLLECTIVE_SMARTPLACE_PUBLIC='));if(lines.length!==1)throw Error('unambiguous public evidence required');
  const raw=JSON.parse(lines[0].slice('COLLECTIVE_SMARTPLACE_PUBLIC='.length));
  validatePublicTarget(raw.publicUrl,binding.naverPlaceId);const observed=validatePublicTarget(raw.observedPublicUrl,binding.naverPlaceId);
  if(raw.publicUrl!==binding.publicUrl||raw.naverPlaceId!==binding.naverPlaceId||raw.storeName!==binding.storeName||!['real','mocked'].includes(raw.source)||!Number.isFinite(Date.parse(raw.capturedAt)))throw Error('public observation target mismatch');
  const schedule=parseSmartplaceWeek(raw.weekPreview);
  return{publicUrl:raw.publicUrl,naverPlaceId:raw.naverPlaceId,schedule,hours:JSON.stringify(schedule),source:raw.source,capturedAt:raw.capturedAt,note:'등록 주소에서 이동한 공개 화면 '+observed.path+'. 공개 시간표의 7일 표시; 법정공휴일·임시 설정은 별도 확인.'};
 }
 return {supportsWrite:false,publicReadback,observe,verify:observe,saveHours:async()=>{throw Error('read-only native adapter: 현장 변경 절차는 별도 검증 필요')}};
}
