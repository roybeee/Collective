import { WEEK_DAYS, canonicalSchedule, supportsSchedule } from './store-browser-config.mjs';
export function locatorCode(locator) {
 if(!locator)throw Error('observed locator missing');
 return locator.css?`page.locator(${JSON.stringify(locator.css)})`:`page.getByRole(${JSON.stringify(locator.role)},{name:${JSON.stringify(locator.name)},exact:true})`;
}
export function weeklyReadCode(weekly) {
 return `await (async()=>{const result={};${WEEK_DAYS.map(day=>{
 const row=weekly[day];
 return `const value_${day}=await ${locatorCode(row.state)}.inputValue();const state_${day}=Object.entries(${JSON.stringify(row.values)}).find(([_,v])=>v===value_${day})?.[0];if(!state_${day})throw Error('unregistered weekday state');result.${day}={state:state_${day},intervals:state_${day}==='open'?[${row.intervals.map(x=>`{start:await ${locatorCode(x.start)}.inputValue(),end:await ${locatorCode(x.end)}.inputValue(),endsNextDay:${x.endsNextDayMode==='select'?`await(async()=>{const v=await ${locatorCode(x.endsNextDay)}.inputValue();if(!['true','false'].includes(v))throw Error('unregistered overnight state');return v==='true';})()`:`await ${locatorCode(x.endsNextDay)}.isChecked()`}}`).join(',')}]:[]};`;
 }).join('\n')}return result;})()`;
}
export function weeklySaveCode(config, schedule) {
 supportsSchedule(config,schedule);
 return WEEK_DAYS.map(day=>{
 const row=config.weekly[day],desired=schedule[day];
 return `await ${locatorCode(row.state)}.selectOption(${JSON.stringify(row.values[desired.state])});const changed_${day}=await snapshot(page,{interactive:true});console.log(changed_${day}.diff);${desired.intervals.map((x,i)=>`await ${locatorCode(row.intervals[i].start)}.fill(${JSON.stringify(x.start)});await ${locatorCode(row.intervals[i].end)}.fill(${JSON.stringify(x.end)});await ${locatorCode(row.intervals[i].endsNextDay)}.${row.intervals[i].endsNextDayMode==='select'?`selectOption(${JSON.stringify(String(x.endsNextDay))})`:`setChecked(${x.endsNextDay})`};`).join('\n')}`;
 }).join('\n');
}
export function normalizedEvidence(evidence) {
 if(!evidence?.schedule)return evidence;
 return {...evidence,hours:canonicalSchedule(evidence.schedule)};
}
export function allWeeklyLocators(weekly) {
 return Object.values(weekly).flatMap(row=>[row.state,...row.intervals.flatMap(x=>[x.start,x.end,x.endsNextDay])]);
}
