import { locatorCode, weeklyReadCode } from './store-browser-weekly.mjs';
const marker='COLLECTIVE_BROWSER_EVIDENCE=';
export function photoCode(base,config,binding,asset,verify=false) {
 const output=`console.log(${JSON.stringify(marker)} + JSON.stringify(evidence));`;
 if(!base.includes(output))throw Error('unrecognized fixed browser program');
 const readPhoto=['photoId','photoSha256'].map(key=>config.photo?.[key]?`if(await ${locatorCode(config.photo[key])}.count()===1)evidence.${key}=(await ${locatorCode(config.photo[key])}.textContent())?.trim();`:'').join('\n');
 if(verify)return base.replace(output,`${readPhoto}\n${output}`);
 if(config.host!=='local'||!config.photo?.fileInput||!config.photo?.submit||!asset)throw Error('registered local upload controls required');
 const url=new URL(asset.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^\/[a-f0-9]{64}$/u.test(url.pathname))throw Error('private local asset bridge required');
 const upload=`if(evidence.managerBusinessId!==${JSON.stringify(binding.managerBusinessId)}||evidence.naverPlaceId!==${JSON.stringify(binding.naverPlaceId)}||evidence.storeName!==${JSON.stringify(binding.storeName)})throw Error('photo target changed');
 if(await ${locatorCode(config.photo.fileInput)}.count()!==1||await ${locatorCode(config.photo.submit)}.count()!==1)throw Error('photo upload controls ambiguous');
 const binary=await fetch(${JSON.stringify(url.href)});if(!binary.ok)throw Error('photo transfer unavailable');
 const file={name:${JSON.stringify(asset.name)},mimeType:${JSON.stringify(asset.mime)},buffer:Buffer.from(await binary.arrayBuffer())};
 await ${locatorCode(config.photo.fileInput)}.setInputFiles([file]);
 const selected=await snapshot(page,{interactive:true});console.log(selected.diff);
 await ${locatorCode(config.photo.submit)}.click({timeout:15000});
 const uploaded=await snapshot(page);console.log(uploaded.diff);`;
 return base.replace(output,`${upload}\n${output}`);
}
export function publicCode(config,binding,allowLocalFixture=false) {
 if(!config.public||!binding.publicUrl)throw Error('public readback not registered');
 const url=new URL(binding.publicUrl);
 const fixture=allowLocalFixture&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);
 if(url.username||url.password||url.hash||(!fixture&&(url.protocol!=='https:'||!['place.naver.com','pcmap.place.naver.com','map.naver.com'].includes(url.hostname))))throw Error('invalid registered public URL');
 const p=config.public;const hours=p.weekly?`const schedule=await ${weeklyReadCode(p.weekly)};evidence.schedule=schedule;evidence.hours=JSON.stringify(schedule);`:p.hours?`evidence.hours=(await ${locatorCode(p.hours)}.${p.hoursReadMode==='input'?'inputValue':'textContent'}())?.trim();`:'';
 return `await(async()=>{const listed=await listBrowserTabs();const matches=listed.filter(t=>t.url===${JSON.stringify(url.href)});if(matches.length>1)throw Error('ambiguous public tabs');if(matches.length===1)await attachBrowserTab(matches[0].targetId);else await openTab(${JSON.stringify(url.href)});await page.reload();const snap=await snapshot(page);console.log(snap.tree);if(page.url()!==${JSON.stringify(url.href)}||/captcha|캡차|접근.{0,5}제한|로그인이 필요/i.test(snap.tree))throw Error('public access unavailable');if(await ${locatorCode(p.naverPlaceId)}.count()!==1)throw Error('public target ambiguous');const evidence={publicUrl:page.url(),naverPlaceId:(await ${locatorCode(p.naverPlaceId)}.textContent())?.trim(),capturedAt:new Date().toISOString(),source:${JSON.stringify(fixture?'mocked':'real')}};${hours}${['photoId','photoSha256'].map(k=>p[k]?`if(await ${locatorCode(p[k])}.count()!==1)throw Error('public photo ambiguous');evidence.${k}=(await ${locatorCode(p[k])}.textContent())?.trim();`:'').join('')}
 console.log(${JSON.stringify(marker)}+JSON.stringify(evidence));})()`;
}
