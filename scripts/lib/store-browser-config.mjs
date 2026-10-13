export const WEEK_DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value,max=200) => typeof value === 'string' && value.length>0 && value.length<=max && !/[\u0000-\u001f]/u.test(value);
export function validateLocator(locator) {
 if(!plain(locator)||Object.keys(locator).some(k=>!['css','role','name'].includes(k))) throw Error('invalid observed locator');
 const css=bounded(locator.css,300)&&!/[;{}\n]/u.test(locator.css)&&locator.role===undefined&&locator.name===undefined;
 const role=bounded(locator.role,30)&&/^[a-z]+$/u.test(locator.role)&&bounded(locator.name)&&locator.css===undefined;
 if(!css&&!role) throw Error('invalid observed locator');
 return locator;
}
export function canonicalSchedule(schedule) {
 if(!plain(schedule)||Object.keys(schedule).length!==7) throw Error('all seven days required');
 const normalized=Object.fromEntries(WEEK_DAYS.map(day=> {
  const value=schedule[day];
  if(!plain(value)||Object.keys(value).some(k=>!['state','intervals'].includes(k))||!['open','closed','unknown'].includes(value.state)||!Array.isArray(value.intervals)) throw Error('invalid weekly state');
  if(value.state==='open' ? value.intervals.length<1||value.intervals.length>6 : value.intervals.length!==0) throw Error('invalid weekly intervals');
  const intervals=value.intervals.map(interval=>{
   if(!plain(interval)||Object.keys(interval).some(k=>!['start','end','endsNextDay'].includes(k))||typeof interval.endsNextDay!=='boolean'||![interval.start,interval.end].every(x=>/^([01]\d|2[0-3]):[0-5]\d$/u.test(x))) throw Error('invalid time interval');
   if(interval.endsNextDay ? interval.end>interval.start : interval.end<=interval.start) throw Error('overnight must be explicit');
   return {start:interval.start,end:interval.end,endsNextDay:interval.endsNextDay};
  }).sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<intervals.length;i++) if(intervals[i-1].endsNextDay||intervals[i].start<intervals[i-1].end) throw Error('overlapping intervals');
  return [day,{state:value.state,intervals}];
 }));
 const minutes=x=>{const [h,m]=x.split(':').map(Number);return h*60+m;};
 const spans=WEEK_DAYS.flatMap((day,index)=>normalized[day].intervals.map(i=>({start:index*1440+minutes(i.start),end:index*1440+minutes(i.end)+(i.endsNextDay?1440:0)})));
 const all=[...spans,...spans.map(s=>({start:s.start+10080,end:s.end+10080}))].sort((a,b)=>a.start-b.start);
 if(all.some((s,i)=>i>0&&s.start<all[i-1].end))throw Error('overlapping weekly intervals');
 return JSON.stringify(normalized);
}
function weeklyConfig(value) {
 if(!plain(value)||Object.keys(value).length!==7) throw Error('observed seven-day locators required');
 for(const day of WEEK_DAYS) {
  const row=value[day];
  if(!plain(row)||Object.keys(row).some(k=>!['state','values','intervals'].includes(k))) throw Error('invalid weekday config');
  validateLocator(row.state);
  if(!plain(row.values)||Object.keys(row.values).length!==3||!['open','closed','unknown'].every(k=>bounded(row.values[k],60))||new Set(Object.values(row.values)).size!==3) throw Error('explicit state values required');
  if(!Array.isArray(row.intervals)||row.intervals.length<1||row.intervals.length>6) throw Error('observed fixed interval slots required');
  for(const interval of row.intervals) {if(!plain(interval)||Object.keys(interval).some(k=>!['start','end','endsNextDay','endsNextDayMode'].includes(k))||interval.endsNextDayMode!==undefined&&!['checkbox','select'].includes(interval.endsNextDayMode)) throw Error('invalid interval locators');for(const key of ['start','end','endsNextDay']) validateLocator(interval[key]);}
 }
}
export function validateConfig(value) {
 if(!plain(value)||Object.keys(value).some(k=>!['adapter','native','version','host','profile','account','locators','hoursReadMode','weekly','public','photo'].includes(k))) throw Error('invalid local config');
 if(value.version!==undefined&&![1,2].includes(value.version)) throw Error('unsupported config version');
 if(!bounded(value.host)||!/^[\w .-]+$/u.test(value.host)) throw Error('explicit host required');
 if(value.host==='local' ? (!bounded(value.account)||value.profile!==undefined) : (!bounded(value.profile)||value.account!==undefined)) throw Error('explicit local account or remote profile required');
 if(!/^[\w.-]+$/u.test(value.host==='local'?value.account:value.profile)) throw Error('invalid profile selector');
 if(value.adapter==='naver_smartplace'){if(!plain(value.native)||Object.keys(value.native).some(k=>!['dashboardUrl','hoursUrl'].includes(k)))throw Error('invalid native config');for(const key of ['dashboardUrl','hoursUrl']){const url=new URL(value.native[key]);if(url.protocol!=='https:'||!['smartplace.naver.com','new.smartplace.naver.com'].includes(url.hostname)||url.username||url.password||url.hash)throw Error('invalid observed native URL');}return value;}
 if(value.adapter!==undefined&&value.adapter!=='registered_dom')throw Error('unsupported adapter');
 if(value.native!==undefined)throw Error('native config requires native adapter');
 if(!plain(value.locators)||Object.keys(value.locators).some(k=>!['managerBusinessId','naverPlaceId','storeName','hours','save'].includes(k))) throw Error('invalid locators');
 for(const key of ['managerBusinessId','naverPlaceId','storeName']) validateLocator(value.locators[key]);
 if(value.weekly) {if(value.version!==2) throw Error('weekly adapter requires version 2');weeklyConfig(value.weekly);}
 else {validateLocator(value.locators.hours);if(!['input','text'].includes(value.hoursReadMode)) throw Error('explicit hoursReadMode required');}
 if(value.locators.save) validateLocator(value.locators.save);
 if(value.version!==2&&!value.locators.save) throw Error('observed save locator required');
 if(value.public) {if(!plain(value.public)||Object.keys(value.public).some(k=>!['naverPlaceId','hours','hoursReadMode','weekly','photoId','photoSha256'].includes(k))) throw Error('invalid public config');validateLocator(value.public.naverPlaceId);if(value.public.weekly)weeklyConfig(value.public.weekly);else if(value.public.hours){validateLocator(value.public.hours);if(!['input','text'].includes(value.public.hoursReadMode))throw Error('public read mode required');}for(const key of ['photoId','photoSha256'])if(value.public[key])validateLocator(value.public[key]);}
 if(value.photo) {if(!plain(value.photo)||Object.keys(value.photo).some(k=>!['fileInput','submit','photoId','photoSha256'].includes(k)))throw Error('invalid photo config');for(const key of ['fileInput','submit'])validateLocator(value.photo[key]);for(const key of ['photoId','photoSha256'])if(value.photo[key])validateLocator(value.photo[key]);}
 return value;
}
export function supportsSchedule(config, schedule) {
 canonicalSchedule(schedule);
 if(!config.weekly) throw Error('registered weekly adapter required');
 for(const day of WEEK_DAYS) if(schedule[day].state==='unknown'||schedule[day].state==='open'&&schedule[day].intervals.length!==config.weekly[day].intervals.length) throw Error('unregistered interval change requires operator');
}
