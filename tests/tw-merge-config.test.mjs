// 가벼운 tailwind-merge 설정(lib/tw-merge-config.ts, UX-PLAN-3 11.26)이 기본 twMerge와 소스의 모든 클래스 조합에서 같은 결과를 낸다.
// twMerge는 뒤에서부터 토큰을 보며, 이미 남긴 뒤 토큰이 등록한 충돌 키에 걸리는 토큰만 지운다. 그래서 어떤 목록의 결과든
// "x 다음에 y가 오면 x가 지워지는가"라는 두 토큰 관계로 정해진다. 소스에 나오는 모든 토큰에서 그룹 여부가 같고,
// 그룹이 있는 토큰의 모든 순서쌍에서 두 결과가 같으면 소스 토큰으로 만든 모든 className에서 결과가 같다.
// 실패하면: node scripts/gen-tw-merge-config.mjs 로 설정을 다시 만든다(새 클래스 그룹을 쓰기 시작한 경우).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTailwindMerge, twMerge} from 'tailwind-merge';
import {groupedTokens, sourceClassTokens} from '../scripts/gen-tw-merge-config.mjs';
import {twMergeConfig} from '../lib/tw-merge-config.ts';

let passed = 0;
const check = (ok, name) => { assert.ok(ok, name); passed++; };
const light = createTailwindMerge(twMergeConfig);
const fix = '새 클래스 그룹이면 node scripts/gen-tw-merge-config.mjs 로 lib/tw-merge-config.ts를 다시 만드세요';

const tokens = sourceClassTokens();
check(tokens.size > 1000, `source tokens collected (${tokens.size})`);
const sameSingle = [...tokens].filter(t => light(`${t} ${t}`) !== twMerge(`${t} ${t}`));
check(sameSingle.length === 0, `group status differs for ${sameSingle.slice(0, 5).join(', ')} (${fix})`);

const grouped = groupedTokens(tokens);
check(grouped.length > 300 && grouped.includes('h-9') && grouped.includes('px-4') && grouped.includes('rounded-md'), `grouped tokens include shadcn base classes (${grouped.length})`);
const diffs = [];
for (const x of grouped) for (const y of grouped) {
  const list = `${x} ${y}`;
  if (light(list) !== twMerge(list) && diffs.push(list) >= 5) break;
}
check(diffs.length === 0, `pair results differ: ${diffs.join(' | ')} (${fix})`);

// 실제 화면에서 겹치는 덮어쓰기(Button h-auto p-0, Input 테두리 덮어쓰기)가 기본과 같게 합쳐진다.
for (const list of ['h-9 px-4 py-2 has-[>svg]:px-3 h-auto p-0', 'rounded-md border px-3 py-1 block border rounded p-2 w-full', 'text-sm font-medium h-auto p-0 text-[13px]']) check(light(list) === twMerge(list) && light(list) !== list, `override merges like default: ${light(list)}`);

const utils = readFileSync('lib/utils.ts', 'utf8');
check(/createTailwindMerge\(twMergeConfig\)/.test(utils) && !/\btwMerge\b[^\n]*from "tailwind-merge"/.test(utils), 'lib/utils.ts cn uses the light config, not the default twMerge');

console.log(JSON.stringify({passed, pairs: grouped.length ** 2}));
