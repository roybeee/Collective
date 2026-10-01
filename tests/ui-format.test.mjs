// UX-PLAN P2: 표시 형식(lib/format.ts)·문구 사전(lib/ui-copy.ts)·안내문 분할(components/app/note.tsx)과 화면 문구 린트.
// 린트는 app/*.tsx 원문에서 기계 형식(밀리초 'ms' 접미, ISO 문자열 자르기, '<X> 새로고침' 보이는 라벨 변형)이 다시 들어오지 않게 막는다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('external forbidden')});
const f=await load('lib/format.ts'),c=await load('lib/ui-copy.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
check(f.money(19800)==='19,800원'&&f.money(null)==='미확인'&&f.money(0)==='0원','money keeps 0 and unknown apart');
check(f.dateTime('2026-10-01T05:30:00.000Z')==='2026-10-01 14:30','dateTime shows KST');
check(f.dateTime('')==='미확인'&&f.dateTime('nope','없음')==='없음','dateTime empty');
check(f.date('2026-10-01')==='2026-10-01'&&f.date('2026-09-30T20:00:00Z')==='2026-10-01','date-only stays, ISO converts to KST day');
check(f.duration(850)==='1초 미만'&&f.duration(3200)==='3초'&&f.duration(125000)==='2분 5초'&&f.duration(3840000)==='1시간 4분'&&f.duration(null)==='미확인','duration');
check(f.ratioOf(3,12)==='3/12건'&&f.ratioOf(3,null)==='3건(전체 미확인)','ratio keeps denominator');
check(f.percent(0.125)==='12.5%'&&f.percent(0.1)==='10%','percent');
check(f.toLocalInput('2026-10-01T05:30:00.000Z')==='2026-10-01T14:30'&&f.fromLocalInput('2026-10-01T14:30')==='2026-10-01T05:30:00.000Z'&&f.fromLocalInput('bad')==='','local input is KST both ways');
check(f.shortId('landing-3f9a2c1bde')==='…2c1bde'&&f.shortId('short')==='short','shortId');
check(c.t('refresh')==='새로고침'&&c.t('refresh','en')==='Refresh','dictionary ko/en');
check(c.copyKeys.every(k=>c.t(k,'ko')&&c.t(k,'en')),'every key has ko and en');
check(c.version(3)==='v3'&&c.version(null)==='미확인','version label');
check(c.enumLabel('csChannel','chat')==='채팅'&&c.enumLabel('csChannel','unknown-x')==='unknown-x','enum label falls back to value');
// 안내문 분할: tsx는 런타임 로더가 JSX를 다루지 않으므로 같은 규칙을 문자열로 확인한다.
const note=readFileSync('components/app/note.tsx','utf8');
check(note.includes('NOTE_LIMIT=60')&&note.includes("t('more')")&&note.includes('aria-expanded'),'note clamps over 60 chars with a shared "자세히" toggle');
// 화면 문구 린트.
const files=readdirSync('app').filter(n=>n.endsWith('.tsx')),src=Object.fromEntries(files.map(n=>[n,readFileSync('app/'+n,'utf8')]));
const qOwned=new Set(['online-grading.tsx']);
const offenders=(re)=>files.filter(n=>!qOwned.has(n)&&!n.startsWith('franchise-')&&re.test(src[n]));
check(offenders(/\}ms</).length===0,'no raw millisecond rendering');
check(offenders(/>[^<>{}]{1,24} 새로고침<\/button>/).length===0,'refresh buttons show one visible label (target in aria-label)');
check(offenders(/\{[A-Za-z_.?]+\.slice\(0,16\)/).length===0,'no ISO slicing for display (use dateTime)');
console.log(JSON.stringify({passed}));
