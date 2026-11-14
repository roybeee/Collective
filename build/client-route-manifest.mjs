// 브라우저 진입점(vinext 가상 모듈)의 경로 목록에서 /api/* 경로 처리기를 뺀다(UX-PLAN-3 11.26).
// vinext는 화면 이동 판단용 목록(__VINEXT_LINK_PREFETCH_ROUTES__)과 경로 그래프(routeManifest.routes·routeHandlers)에
// 경로 처리기까지 모두 넣는다. 이 앱의 화면은 app/page.tsx 하나이고 /api/*는 fetch·내려받기 링크(일반 <a>, 문서 이동)로만 쓰므로
// 클라이언트 라우터가 이 항목을 쓸 일이 없다. 그런데 API가 하나 늘 때마다 홈 첫 로딩 JS가 커졌다(2026-11-14 약 6KB gz).
// /share/*·/media/* 같은 다른 경로 처리기는 그대로 둔다. vinext가 생성 형식을 바꿔 찾을 줄이 없으면 빌드를 멈춘다(조용히 다시 커지지 않게).
export const APP_BROWSER_ENTRY_ID = "\0virtual:vinext-app-browser-entry";

const isApiPattern = pattern => pattern === "/api" || pattern.startsWith("/api/");
const PREFETCH_LINE = /^(window\.__VINEXT_LINK_PREFETCH_ROUTES__ = )(.*);$/;
const MAP_LINE = /^(\s*(routes|routeHandlers): new Map\()(.*)(\),?)$/;

function filterPrefetch(json) {
  return JSON.parse(json).filter(route => !isApiPattern("/" + route.patternParts.join("/")));
}

function filterMap(json) {
  return JSON.parse(json).filter(([, value]) => !isApiPattern(value.pattern));
}

/** vinext 가상 브라우저 진입점 코드에서 /api/* 항목을 뺀 새 코드를 돌려준다. 원래 코드는 바꾸지 않는다. */
export function dropApiRoutesFromBrowserEntry(code) {
  const seen = new Set();
  const lines = code.split("\n").map(line => {
    const prefetch = line.match(PREFETCH_LINE);
    if (prefetch) {
      seen.add("prefetch");
      return `${prefetch[1]}${JSON.stringify(filterPrefetch(prefetch[2]))};`;
    }
    const map = line.match(MAP_LINE);
    if (!map) return line;
    seen.add(map[2]);
    return `${map[1]}${JSON.stringify(filterMap(map[3]))}${map[4]}`;
  });
  const missing = ["prefetch", "routes", "routeHandlers"].filter(key => !seen.has(key));
  // routeManifest가 null이면 routes·routeHandlers 줄이 없다. 그때는 목록 줄만 있으면 된다.
  const manifestNull = /routeManifest: null\b/.test(code);
  const required = manifestNull ? missing.filter(key => key === "prefetch") : missing;
  if (required.length) throw new Error(`vinext 브라우저 진입점 형식이 바뀌었습니다(${required.join(", ")} 줄 없음). build/client-route-manifest.mjs를 갱신하세요.`);
  return lines.join("\n");
}

/** vite 플러그인: 클라이언트 환경의 vinext 브라우저 진입점에만 적용한다. */
export const clientRouteManifest = {
  name: "collective:client-route-manifest",
  transform(code, id) {
    if (id !== APP_BROWSER_ENTRY_ID) return null;
    return { code: dropApiRoutesFromBrowserEntry(code), map: null };
  },
};
