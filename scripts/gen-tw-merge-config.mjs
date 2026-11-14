// lib/tw-merge-config.ts 생성기(UX-PLAN-3 11.26 홈 첫 로딩 여유).
// tailwind-merge 기본 설정(약 380개 클래스 그룹)에서 이 저장소 소스 문자열에 실제로 나오는 클래스가 속한 그룹만 남긴 설정을 만든다.
// 소스는 app·components·lib·hooks의 모든 문자열·템플릿 조각이다. 다만 아무 파일도 가져오지 않는 components/ui 부품(실행되지 않는다)은 뺀다.
// 홈 첫 로딩에서 기본 설정 코드(약 8KB gz 중 대부분)를 빼되, 소스에 나오는 모든 클래스 조합에서 결과가 기본 twMerge와 같아야 한다.
// 같음의 증명은 tests/tw-merge-config.test.mjs가 맡는다(소스 토큰 전체·그룹 있는 토큰의 모든 쌍).
// 사용: node scripts/gen-tw-merge-config.mjs        (lib/tw-merge-config.ts를 다시 쓴다)
//       node scripts/gen-tw-merge-config.mjs --check (다시 만든 결과가 커밋된 파일과 같은지만 본다)
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createTailwindMerge, getDefaultConfig, twMerge, validators} from 'tailwind-merge';

const root = fileURLToPath(new URL('..', import.meta.url));
export const OUTPUT = 'lib/tw-merge-config.ts';
const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks'];

function sourceFiles() {
  const files = [];
  const walk = dir => {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const rel = `${dir}/${name}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (/\.(tsx?|mjs)$/.test(name) && !/\.test\./.test(name) && rel !== OUTPUT) files.push(rel);
    }
  };
  for (const dir of SOURCE_DIRS) walk(dir);
  return withoutUnusedUiKit(files);
}

// components/ui에는 shadcn 부품이 통째로 들어 있고 그중 일부는 아무도 가져오지 않는다. 가져오지 않는 파일은 실행되지 않으므로
// 그 클래스는 cn()에 닿지 않는다. 다른 파일(빠진 ui 파일 제외)이 경로로 가져오는 ui 파일만 남긴다. 가져오는 방식을 넓게 잡는다(남기는 쪽으로 틀린다).
function withoutUnusedUiKit(files) {
  const text = new Map(files.map(rel => [rel, readFileSync(join(root, rel), 'utf8')]));
  let kept = files;
  for (;;) {
    const next = kept.filter(rel => {
      const ui = rel.match(/^components\/ui\/([\w-]+)\.tsx?$/);
      if (!ui) return true;
      const ref = new RegExp(`(?:ui/|\\./)${ui[1]}(?:\\.tsx?)?["'\`]`);
      return kept.some(other => other !== rel && ref.test(text.get(other)));
    });
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

/** 소스(app·components·lib·hooks)의 모든 문자열·템플릿 조각을 공백으로 나눈 토큰 집합. Tailwind도 소스에 글자 그대로 있는 클래스만 CSS로 만든다. */
export function sourceClassTokens() {
  const tokens = new Set();
  const add = text => { for (const token of text.split(/\s+/)) if (token) tokens.add(token); };
  for (const rel of sourceFiles()) {
    const source = ts.createSourceFile(rel, readFileSync(join(root, rel), 'utf8'), ts.ScriptTarget.Latest, false, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = node => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) add(node.text);
      else if (ts.isJsxText(node)) add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return tokens;
}

/** 기본 twMerge가 그룹을 주는 토큰(같은 토큰 두 개를 합치면 하나만 남는다). */
export const groupedTokens = (tokens, merge = twMerge) => [...tokens].filter(token => merge(`${token} ${token}`) === token).sort();

function usedGroups(grouped) {
  const config = getDefaultConfig();
  // 임의 속성([--x:1] 등)은 설정과 무관하게 그룹이 생긴다. 그룹 판정에서 뺀다.
  const none = createTailwindMerge(() => ({...getDefaultConfig(), classGroups: {}, conflictingClassGroups: {}, conflictingClassGroupModifiers: {}}));
  grouped = grouped.filter(token => none(`${token} ${token}`) !== token);
  return Object.keys(config.classGroups).filter(group => {
    const only = createTailwindMerge(() => ({...getDefaultConfig(), classGroups: {[group]: config.classGroups[group]}, conflictingClassGroups: {}, conflictingClassGroupModifiers: {}}));
    return grouped.some(token => only(`${token} ${token}`) === token);
  });
}

const validatorNames = new Map(Object.entries(validators).map(([name, fn]) => [fn, name]));
function themeKey(getter) {
  let key = null;
  getter(new Proxy({}, {get: (_, k) => { key = String(k); return undefined; }}));
  if (!key) throw new Error('theme getter key not found');
  return key;
}

function emit(value, themeKeys) {
  if (typeof value === 'function') {
    if (value.isThemeGetter) { const key = themeKey(value); themeKeys.add(key); return `t(${JSON.stringify(key)})`; }
    const name = validatorNames.get(value);
    if (!name) throw new Error('unknown tailwind-merge validator');
    return `v.${name}`;
  }
  if (Array.isArray(value)) return `[${value.map(v => emit(v, themeKeys)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${emit(v, themeKeys)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function generate() {
  const grouped = groupedTokens(sourceClassTokens());
  const keep = new Set(usedGroups(grouped));
  const config = getDefaultConfig();
  const pick = record => Object.fromEntries(Object.entries(record).filter(([group]) => keep.has(group)).map(([group, list]) => [group, list.filter(other => keep.has(other))]).filter(([, list]) => list.length));
  const light = {
    cacheSize: config.cacheSize,
    theme: config.theme,
    classGroups: Object.fromEntries(Object.entries(config.classGroups).filter(([group]) => keep.has(group))),
    conflictingClassGroups: pick(config.conflictingClassGroups),
    conflictingClassGroupModifiers: pick(config.conflictingClassGroupModifiers),
    postfixLookupClassGroups: config.postfixLookupClassGroups.filter(group => keep.has(group)),
    orderSensitiveModifiers: config.orderSensitiveModifiers,
  };
  // 테마 값은 그룹 정의 안의 t(키)로만 읽힌다. 남긴 그룹이 읽는 테마 키만 둔다.
  const themeKeys = new Set();
  const emitted = Object.fromEntries(Object.entries(light).filter(([key]) => key !== 'theme').map(([key, value]) => [key, emit(value, themeKeys)]));
  const theme = emit(Object.fromEntries(Object.entries(config.theme).filter(([key]) => themeKeys.has(key))), themeKeys);
  let body = Object.entries(light).map(([key]) => ` ${key}: ${key === 'theme' ? theme : emitted[key]},`).join('\n');
  // 여러 그룹이 같은 값 목록(간격·색 척도 등)을 쓴다. 두 번 이상 나오는 긴 목록은 상수 하나로 묶는다(설정은 읽기만 한다).
  const shared = [];
  for (;;) {
    const counts = new Map();
    for (const m of body.matchAll(/\[[^[\]{}]{24,}\]/g)) counts.set(m[0], (counts.get(m[0]) || 0) + 1);
    const best = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[0].length * b[1] - a[0].length * a[1])[0];
    if (!best) break;
    const name = `s${shared.length}`;
    shared.push(`const ${name} = ${best[0]};`);
    body = body.split(best[0]).join(name);
  }
  return `// 생성 파일: node scripts/gen-tw-merge-config.mjs. 손으로 고치지 않는다(UX-PLAN-3 11.26).
// tailwind-merge ${JSON.parse(readFileSync(join(root, 'node_modules/tailwind-merge/package.json'), 'utf8')).version} 기본 설정 ${Object.keys(config.classGroups).length}개 그룹 중 소스에 나오는 클래스가 속한 ${keep.size}개만 남겼다.
// 소스의 모든 클래스 조합에서 기본 twMerge와 결과가 같다는 확인은 tests/tw-merge-config.test.mjs가 한다.
import {fromTheme as t, validators as v} from 'tailwind-merge';

${shared.join('\n')}

export const twMergeConfig = () => ({
${body}
});
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const next = generate();
  if (process.argv.includes('--check')) {
    const same = readFileSync(join(root, OUTPUT), 'utf8') === next;
    process.stdout.write(same ? `${OUTPUT} 최신\n` : `${OUTPUT}가 소스와 맞지 않습니다. node scripts/gen-tw-merge-config.mjs 를 실행하세요.\n`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(join(root, OUTPUT), next);
  process.stdout.write(`${OUTPUT} 생성\n`);
}
