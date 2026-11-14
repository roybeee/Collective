// 홈 첫 로딩 JS 여유(UX-PLAN-3 11.26): 브라우저 진입점의 경로 목록에 /api/* 경로 처리기가 실리지 않는다.
// 1) vinext의 실제 생성기(generateBrowserEntry)로 만든 코드에 build/client-route-manifest.mjs 필터를 적용해 확인한다(정적).
// 2) vite.config.ts가 그 플러그인을 쓰는지 확인한다(정적).
// 3) dist/가 있으면 빌드된 브라우저 진입 청크에 /api/ 경로가 없는지 확인한다(빌드 결과).
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {generateBrowserEntry} from '../node_modules/vinext/dist/entries/app-browser-entry.js';
import {APP_BROWSER_ENTRY_ID, clientRouteManifest, dropApiRoutesFromBrowserEntry} from '../build/client-route-manifest.mjs';

let passed = 0;
const check = (ok, name) => { assert.ok(ok, name); passed++; };

const appRoute = (pattern, kind) => {
  const patternParts = pattern.split('/').filter(Boolean);
  return {pattern, patternParts, isDynamic: patternParts.some(p => p.startsWith(':')), pagePath: kind === 'page' ? 'app/page.tsx' : null,
    routePath: kind === 'route' ? `app${pattern}/route.ts` : null, layouts: ['app/layout.tsx'], loadingPath: null, parallelSlots: [], siblingIntercepts: []};
};
const patterns = [['/', 'page'], ['/api/workspace', 'route'], ['/api/campaigns/:id/deletion', 'route'], ['/api', 'route'], ['/share/:token', 'route'], ['/media/:file', 'route'], ['/apiary', 'route']];
const routes = patterns.map(([p, k]) => appRoute(p, k));
const entry = (p, kind) => [`route:${p}`, {id: `route:${p}`, pattern: p, patternParts: p.split('/').filter(Boolean), pageId: kind === 'page' ? `page:${p}` : null, routeHandlerId: kind === 'route' ? `route-handler:${p}` : null, layoutIds: ['layout:/']}];
const map = list => new Map(list);
const manifest = {graphVersion: 'g1', segmentGraph: {
  routes: map(patterns.map(([p, k]) => entry(p, k))),
  pages: map([['page:/', {id: 'page:/', routeId: 'route:/', pattern: '/'}]]),
  routeHandlers: map(patterns.filter(([, k]) => k === 'route').map(([p]) => [`route-handler:${p}`, {id: `route-handler:${p}`, routeId: `route:${p}`, pattern: p}])),
  layouts: map([['layout:/', {id: 'layout:/', treePath: '/', patternParts: []}]]), templates: map([]), slots: map([]), defaults: map([]), slotBindings: map([]),
  interceptions: map([]), interceptionsBySlotId: map([]), boundaries: map([]), rootBoundaries: map([['root-boundary:/', {id: 'root-boundary:/', layoutId: 'layout:/', treePath: '/'}]])}};

const original = generateBrowserEntry(routes, manifest);
const filtered = dropApiRoutesFromBrowserEntry(original);
const prefetchOf = code => JSON.parse(code.match(/^window\.__VINEXT_LINK_PREFETCH_ROUTES__ = (.*);$/m)[1]);
const mapOf = (code, key) => JSON.parse(code.match(new RegExp(`^\\s*${key}: new Map\\((.*)\\),?$`, 'm'))[1]);

check(prefetchOf(original).some(r => r.patternParts[0] === 'api'), 'fixture: vinext puts /api route handlers into the prefetch list');
check(!prefetchOf(filtered).some(r => r.patternParts[0] === 'api'), 'prefetch list has no /api entries');
check(prefetchOf(filtered).map(r => r.patternParts.join('/')).join(',') === ',share/:token,media/:file,apiary', 'prefetch list keeps /, /share, /media and /apiary in order');
check(prefetchOf(filtered).find(r => r.patternParts[0] === 'share').documentOnly === true, '/share stays document-only (full navigation)');
check(mapOf(filtered, 'routes').map(([id]) => id).join(',') === 'route:/,route:/share/:token,route:/media/:file,route:/apiary', 'routeManifest.routes drops /api only');
check(mapOf(filtered, 'routeHandlers').every(([, v]) => v.pattern !== '/api' && !v.pattern.startsWith('/api/')) && mapOf(filtered, 'routeHandlers').length === 3, 'routeManifest.routeHandlers drops /api only');
check(mapOf(filtered, 'pages').length === 1 && mapOf(filtered, 'layouts').length === 1, 'pages and layouts unchanged');
check(filtered.includes('graphVersion: "g1"'), 'graphVersion unchanged');
check(original.split('\n').filter(l => !/PREFETCH_ROUTES__ =|^\s*(routes|routeHandlers): /.test(l)).join('\n') === filtered.split('\n').filter(l => !/PREFETCH_ROUTES__ =|^\s*(routes|routeHandlers): /.test(l)).join('\n'), 'all other lines unchanged');
check(dropApiRoutesFromBrowserEntry(filtered) === filtered, 'filter is idempotent');
const nullManifest = generateBrowserEntry(routes, null);
check(!prefetchOf(dropApiRoutesFromBrowserEntry(nullManifest)).some(r => r.patternParts[0] === 'api'), 'null routeManifest still filters the prefetch list');
assert.throws(() => dropApiRoutesFromBrowserEntry('import "x";'), /형식이 바뀌었습니다/); passed++;
check(clientRouteManifest.transform('x', 'app/page.tsx') === null, 'plugin ignores other modules');
check(clientRouteManifest.transform(original, APP_BROWSER_ENTRY_ID).code === filtered, 'plugin transforms the vinext browser entry');

const vite = readFileSync('vite.config.ts', 'utf8');
check(/import \{ clientRouteManifest \} from "\.\/build\/client-route-manifest\.mjs";/.test(vite) && /plugins: \[\s*vinext\(\),\s*clientRouteManifest,/.test(vite), 'vite.config.ts uses the plugin for every DEPLOY_TARGET');

// 빌드 결과: 브라우저 진입 청크(경로 목록을 가진 파일)에 /api/ 경로가 없다. dist가 없으면(빌드 전) 건너뛴다.
const chunks = 'dist/client/_next/static/chunks';
if (existsSync(chunks)) {
  const withRoutes = readdirSync(chunks).filter(f => f.endsWith('.js')).filter(f => readFileSync(`${chunks}/${f}`, 'utf8').includes('__VINEXT_LINK_PREFETCH_ROUTES__='));
  check(withRoutes.length >= 1, 'built client has the route list');
  for (const f of withRoutes) {
    const code = readFileSync(`${chunks}/${f}`, 'utf8');
    check(!/patternParts:\[`api`/.test(code) && !/pattern:`\/api\//.test(code), `built ${f} has no /api route entries`);
  }
}

console.log(JSON.stringify({passed}));
