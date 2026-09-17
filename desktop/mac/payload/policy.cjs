const SITE = 'https://mealzip-agency.hflameb.chatgpt.site';
const LOGIN_HOSTS = new Set(['chatgpt.com', 'auth.openai.com', 'auth0.openai.com']);
function allowedNavigation(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password &&
      (u.origin === SITE || (!u.port && LOGIN_HOSTS.has(u.hostname)));
  } catch { return false; }
}
function externalLink(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password; }
  catch { return false; }
}
module.exports = { SITE, allowedNavigation, externalLink };
