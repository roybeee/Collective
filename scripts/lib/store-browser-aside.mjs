import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { locatorCode, weeklyReadCode, weeklySaveCode, normalizedEvidence, allWeeklyLocators } from './store-browser-weekly.mjs';
import { supportsSchedule } from './store-browser-config.mjs';
import { photoCode, publicCode } from './store-browser-extra-aside.mjs';
const execute = promisify(execFile);
const marker = 'COLLECTIVE_BROWSER_EVIDENCE=';
function managerUrl(value, allowLocalFixture = false) {
  const url = new URL(value);
  const localFixture = allowLocalFixture && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!localFixture && (url.protocol !== 'https:' || !['new.smartplace.naver.com', 'smartplace.naver.com'].includes(url.hostname))) || url.username || url.password || url.hash) throw Error('invalid registered manager URL');
  return url.href;
}
export function buildAsideCode(config, binding, operation, afterHours, beforeHours, allowLocalFixture = false) {
  const url = managerUrl(binding.managerUrl, allowLocalFixture);
  if (!['observe', 'save', 'verify'].includes(operation)) throw Error('unsupported operation');
  if (operation === 'save' && (typeof afterHours !== 'string' || afterHours.length > 3000 || typeof beforeHours !== 'string')) throw Error('invalid hours');
  const read = key => `${locatorCode(config.locators[key])}.textContent()`;
  const hours = config.weekly ? `JSON.stringify(await ${weeklyReadCode(config.weekly)})` : `${locatorCode(config.locators.hours)}.${config.hoursReadMode === 'input' ? 'inputValue' : 'textContent'}()`;
  const weeklySchedule = config.weekly ? `schedule:await ${weeklyReadCode(config.weekly)},` : '';
  const change = operation === 'save' ? (config.weekly ? weeklySaveCode(config,JSON.parse(afterHours)) : `if(${JSON.stringify(config.hoursReadMode)} !== 'input')throw Error('observed input required');await ${locatorCode(config.locators.hours)}.fill(${JSON.stringify(afterHours)});`) : '';
  const save = operation === 'save' ? `await ${locatorCode(config.locators.save)}.click({timeout:15000});` : '';
  const locators = [...Object.values(config.locators),...(config.weekly ? allWeeklyLocators(config.weekly) : [])];
  // This fixed program is generated locally; no code or selectors come from a job.
  return `await (async () => {
    const listed = await listBrowserTabs();
    const candidates = listed.filter(t => t.url === ${JSON.stringify(url)});
    if(candidates.length > 1) throw Error('ambiguous manager tabs');
    if(candidates.length === 1) await attachBrowserTab(candidates[0].targetId); else await openTab(${JSON.stringify(url)});
    if(${JSON.stringify(operation)} === 'verify') await page.reload();
    const first = await snapshot(page, {interactive:true}); console.log(first.tree);
    const full = await snapshot(page); console.log(full.tree);
    const blocked = /captcha|캡차|자동입력|접근.{0,5}제한|로그인이 필요|로그인해주세요|보안 확인/i.test(full.tree) || page.url() !== ${JSON.stringify(url)};
    if(blocked) { console.log(${JSON.stringify(marker)} + JSON.stringify({blocked:true,auth:/captcha|캡차|자동입력/i.test(full.tree)?'captcha':/로그인|nid\.naver\.com/i.test(full.tree+' '+page.url())?'login_required':'unknown'})); return; }
    const configs = ${JSON.stringify(locators)};
    for(const cfg of configs) { const loc = cfg.css ? page.locator(cfg.css) : page.getByRole(cfg.role,{name:cfg.name,exact:true}); if(await loc.count() !== 1) throw Error('locator must match exactly once'); }
    const evidence = { managerUrl:page.url(), managerBusinessId:(await ${read('managerBusinessId')})?.trim(), naverPlaceId:(await ${read('naverPlaceId')})?.trim(), storeName:(await ${read('storeName')})?.trim(), hours:(await ${hours})?.trim(), ${weeklySchedule} capturedAt:new Date().toISOString(), source:${JSON.stringify(allowLocalFixture ? 'mocked' : 'real')} };
    if(${JSON.stringify(operation)} === 'save') {
      if(evidence.managerBusinessId !== ${JSON.stringify(binding.managerBusinessId)} || evidence.naverPlaceId !== ${JSON.stringify(binding.naverPlaceId)} || evidence.storeName !== ${JSON.stringify(binding.storeName)} || evidence.hours !== ${JSON.stringify(beforeHours)}) throw Error('target or current hours changed');
      ${change}
      const prepared = await snapshot(page,{interactive:true}); console.log(prepared.diff);
      ${save}
      const saved = await snapshot(page); console.log(saved.diff);
    }
    console.log(${JSON.stringify(marker)} + JSON.stringify(evidence));
  })()`;
}
export function createAsideAdapter(config, binding, run = execute, allowLocalFixture = false) {
  const args = ['repl', '--host', config.host, config.host === 'local' ? '--account' : '--profile', config.host === 'local' ? config.account : config.profile];
  async function executeCode(code) {
    let stdout;
    try { ({ stdout } = await run('aside', [...args, code], { timeout: 125000, maxBuffer: 2 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } })); }
    catch { throw Error('Aside operation failed; browser save must not be retried'); }
    const lines = stdout.split('\n').filter(line => line.startsWith(marker));
    if (lines.length !== 1) throw Error('missing unambiguous browser evidence');
    try { return normalizedEvidence(JSON.parse(lines[0].slice(marker.length))); } catch { throw Error('invalid browser evidence'); }
  }
  const operation=(kind,after,before)=>executeCode(buildAsideCode(config,binding,kind,after,before,allowLocalFixture));
  return { publicReadback:()=>executeCode(publicCode(config,binding,allowLocalFixture)), uploadPhoto:asset=>executeCode(photoCode(buildAsideCode(config,binding,'observe',undefined,undefined,allowLocalFixture),config,binding,asset)), verifyPhoto:()=>executeCode(photoCode(buildAsideCode(config,binding,'verify',undefined,undefined,allowLocalFixture),config,binding,undefined,true)), prepare: async job => { if(job.type==='upload_photo'&&(config.host!=='local'||!config.photo))throw Error('observed local photo adapter required'); if(job.afterSchedule)supportsSchedule(config,job.afterSchedule); if(['change_hours','change_weekly_hours'].includes(job.type)&&!config.locators.save)throw Error('observed save required'); }, observe: () => operation('observe'), saveHours: (after, before) => operation('save', after, before), verify: () => operation('verify') };
}
