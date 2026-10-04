/** Explicit purpose choices; no identity or contacts accepted from this surface. */
const purposes = ['post_purchase', 'marketing_reorder'];
function validate(value) {
  if (!value || !Array.isArray(value.purposes) || value.purposes.length !== 2) throw Error('Invalid notices');
  for (const purpose of purposes) {
    const matches = value.purposes.filter(p => p.purpose === purpose);
    if (matches.length !== 1) throw Error('Invalid purpose');
    const p = matches[0];
    if (typeof p.version !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(p.version) || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 10000 || !Number.isInteger(p.maxAgeSeconds) || p.maxAgeSeconds < 1 || p.maxAgeSeconds > 31536000 || typeof p.granted !== 'boolean' || !(p.expiresAt === null || typeof p.expiresAt === 'string')) throw Error('Invalid notice');
  }
  return value.purposes.map(p => ({purpose:p.purpose,version:p.version,text:p.text,maxAgeSeconds:p.maxAgeSeconds,granted:p.granted,expiresAt:p.expiresAt,selected:false,chosen:false}));
}
export function createConsumerConsent({csrfToken,fetchImpl=globalThis.fetch}) {
  if (typeof csrfToken !== 'string' || csrfToken.length < 24 || csrfToken.length > 256) throw Error('Session CSRF required');
  let state = {purposes:[],busy:false,error:'',message:'',needsReload:false};
  const listeners = new Set();
  const snapshot = () => ({...state,purposes:state.purposes.map(p => ({...p}))});
  const update = value => {state = {...state,...value};for (const listener of listeners) listener(snapshot());};
  async function request(method,body) {
    const controller = new AbortController();const timer = setTimeout(() => controller.abort(),5000);
    try {
      const response = await fetchImpl('/collective/consumer-consents/',{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},...(body ? {body:JSON.stringify(body)} : {})});
      if (response.status !== 200) throw Error('Consent unavailable');
      return validate(await response.json());
    } finally {clearTimeout(timer);}
  }
  async function save(purpose,withdraw=false) {
    const p = state.purposes.find(p => p.purpose === purpose);
    if (state.busy || state.needsReload || !p || (!withdraw && !p.chosen)) return false;
    update({busy:true,error:'',message:''});
    try {const rows = await request('POST',{purpose,granted:withdraw ? false : p.selected,version:p.version});update({purposes:rows,message:'선택을 저장했습니다.',needsReload:false});return true;}
    catch {update({error:'저장 결과를 확인하지 못했습니다. 현재 상태를 다시 조회해 주세요.',needsReload:true});return false;}
    finally {update({busy:false});}
  }
  return {
    state:snapshot,
    subscribe(listener) {listeners.add(listener);listener(snapshot());return () => listeners.delete(listener);},
    choose(purpose,selected) {if (state.busy || state.needsReload || typeof selected !== 'boolean') return;update({purposes:state.purposes.map(p => p.purpose === purpose ? {...p,selected,chosen:true} : p),message:''});},
    save:purpose => save(purpose),withdraw:purpose => save(purpose,true),
    async load() {
      if (state.busy) return false;update({busy:true,error:'',message:''});
      try {update({purposes:await request('GET'),needsReload:false});return true;}
      catch {update({error:'현재 동의 상태를 조회하지 못했습니다. 다시 조회해 주세요.',needsReload:true});return false;}
      finally {update({busy:false});}
    }
  };
}
export function mountConsumerConsent(root,api) {
  const doc = root.ownerDocument;
  const element = (tag,text) => {const e = doc.createElement(tag);if (text !== undefined) e.textContent = text;return e;};
  return api.subscribe(state => {
    const content = element('section');content.setAttribute('aria-label','목적별 알림 동의');
    const refresh = element('button','현재 상태 다시 조회');refresh.type = 'button';refresh.disabled = state.busy;refresh.addEventListener('click',() => api.load());content.append(refresh);
    for (const p of state.purposes) {
      const group = element('fieldset');group.disabled = state.busy || state.needsReload;
      group.append(element('legend',p.purpose === 'post_purchase' ? '구매 후 안내' : '재구매 마케팅 알림'));
      group.append(element('p',p.text),element('p',`고지 버전: ${p.version} · 동의 유효기간: ${p.maxAgeSeconds}초`));
      group.append(element('p',p.granted ? `현재 동의함 · 만료: ${p.expiresAt}` : '현재 동의하지 않음'));
      const label = element('label');const check = element('input');check.type = 'checkbox';check.checked = p.selected;
      check.addEventListener('change',() => api.choose(p.purpose,check.checked));label.append(check,element('span','이 목적의 알림 수신에 동의합니다.'));
      const save = element('button','선택 저장');save.type = 'button';save.disabled = !p.chosen || state.busy || state.needsReload;save.addEventListener('click',() => api.save(p.purpose));
      const withdraw = element('button','동의 철회');withdraw.type = 'button';withdraw.disabled = state.busy || state.needsReload;withdraw.addEventListener('click',() => api.withdraw(p.purpose));group.append(label,save,withdraw);content.append(group);
    }
    const status = element('p',state.error || state.message || (state.busy ? '확인 중입니다.' : '각 목적의 고지를 읽고 따로 선택해 주세요.'));status.setAttribute('role',state.error ? 'alert' : 'status');content.append(status);root.replaceChildren(content);
  });
}
