// 로컬 채널 결정(품질 수정 v2, R3 기준선 2026-09-25): 점포 목표 합성 캠페인(S2·S6·S8)의 총괄·전략 6건이 모두 local_channel_coverage 1/4였다.
// 현장 스킬(channel.offline)이 로컬 채널 4개군(네이버 플레이스·당근·배달앱·카카오)을 각각 채택·후순위·제외로 결정하게 한다. 온라인 캠페인에는 붙지 않는다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw new Error('No external calls expected')});
const practice=await load('lib/practice.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const local={goal:'첫 방문 고객의 2주 안 재방문을 만든다.',products:'식빵·소금빵',stores:'가상동 34',channels:'Instagram, 네이버 플레이스, 매장 안내'};
const online={goal:'온라인 구매 전환을 늘린다.',products:'음반',stores:'',channels:'Instagram, 자사몰'};
const text=practice.campaignPractice(local),decision=text.split('\n').find(l=>l.includes('당근'))||'';
check('a store campaign asks for a decision on each of the four local channel groups',()=>{for(const w of ['네이버 플레이스','당근','배달앱','카카오','채택','후순위','제외'])assert.ok(decision.includes(w),`${w}: ${decision}`)});
check('an online campaign does not get the local channel decision',()=>assert.ok(!practice.campaignPractice(online).includes('당근')));
check('the registry source file matches the code constant',()=>{const file=JSON.parse(readFileSync('prompts/channel.offline.json','utf8'));assert.equal(file.body,practice.channelSkills.find(s=>s.id==='offline').body)});
console.log(JSON.stringify({passed:passed.length}));
