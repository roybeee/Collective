import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const marker = 'COLLECTIVE_BROWSER_EVIDENCE=';
function locatorCode(locator) {
  return locator.css ? `page.locator(${JSON.stringify(locator.css)})` : `page.getByRole(${JSON.stringify(locator.role)},{name:${JSON.stringify(locator.name)},exact:true})`;
}
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
  const hours = `${locatorCode(config.locators.hours)}.${config.hoursReadMode === 'input' ? 'inputValue' : 'textContent'}()`;
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
    if(blocked) { console.log(${JSON.stringify(marker)} + JSON.stringify({blocked:true})); return; }
    const configs = ${JSON.stringify(config.locators)};
    for(const cfg of Object.values(configs)) { const loc = cfg.css ? page.locator(cfg.css) : page.getByRole(cfg.role,{name:cfg.name,exact:true}); if(await loc.count() !== 1) throw Error('locator must match exactly once'); }
    const evidence = { managerUrl:page.url(), managerBusinessId:(await ${read('managerBusinessId')})?.trim(), naverPlaceId:(await ${read('naverPlaceId')})?.trim(), storeName:(await ${read('storeName')})?.trim(), hours:(await ${hours})?.trim(), capturedAt:new Date().toISOString(), source:${JSON.stringify(allowLocalFixture ? 'mocked' : 'real')} };
    if(${JSON.stringify(operation)} === 'save') {
      if(evidence.managerBusinessId !== ${JSON.stringify(binding.managerBusinessId)} || evidence.naverPlaceId !== ${JSON.stringify(binding.naverPlaceId)} || evidence.storeName !== ${JSON.stringify(binding.storeName)} || evidence.hours !== ${JSON.stringify(beforeHours)}) throw Error('target or current hours changed');
      if(${JSON.stringify(config.hoursReadMode)} !== 'input') throw Error('hours editing requires an observed input');
      await ${locatorCode(config.locators.hours)}.fill(${JSON.stringify(afterHours)});
      const prepared = await snapshot(page,{interactive:true}); console.log(prepared.diff);
      await ${locatorCode(config.locators.save)}.click({timeout:15000});
      const saved = await snapshot(page); console.log(saved.diff);
    }
    console.log(${JSON.stringify(marker)} + JSON.stringify(evidence));
  })()`;
}
export function createAsideAdapter(config, binding, run = execute, allowLocalFixture = false) {
  const args = ['repl', '--host', config.host, config.host === 'local' ? '--account' : '--profile', config.host === 'local' ? config.account : config.profile];
  async function operation(kind, after, before) {
    let stdout;
    try { ({ stdout } = await run('aside', [...args, buildAsideCode(config, binding, kind, after, before, allowLocalFixture)], { timeout: 125000, maxBuffer: 2 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } })); }
    catch { throw Error('Aside operation failed; browser save must not be retried'); }
    const lines = stdout.split('\n').filter(line => line.startsWith(marker));
    if (lines.length !== 1) throw Error('missing unambiguous browser evidence');
    try { return JSON.parse(lines[0].slice(marker.length)); } catch { throw Error('invalid browser evidence'); }
  }
  return { observe: () => operation('observe'), saveHours: (after, before) => operation('save', after, before), verify: () => operation('verify') };
}
