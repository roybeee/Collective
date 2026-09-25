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
// 로컬 채널 재실행(2026-09-25 fa9da73): S8(체험 수업 예약, '네이버 플레이스 예약')은 현장 스킬 적용 낱말이 없어 총괄·전략 2건이 1/4였다.
// 지점에 연결한 캠페인(storeId, 운영 채점의 점포 조건)과 네이버 플레이스를 쓰는 캠페인에도 붙이고, 방문 예약 목표도 결정 대상이다.
const decisionOf=c=>practice.campaignPractice(c).split('\n').find(l=>l.includes('당근'))||'';
const booking={goal:'체험 수업 예약을 받고, 체험 뒤 14일 안 정규 등록으로 이어진 비율을 본다.',products:'체험 수업 1회',stores:'가상동 77 2층',channels:'네이버 플레이스 예약, Instagram, 건물 입구 안내'};
check('a Naver Place booking campaign gets the local channel decision for visit bookings',()=>{const d=decisionOf(booking);assert.ok(d.includes('카카오')&&d.includes('방문 예약'),d)});
check('a campaign linked to a store gets the local channel decision',()=>assert.ok(decisionOf({goal:'정규 등록을 늘린다.',products:'8회권',stores:'',channels:'Instagram',storeId:'store-1'}).includes('카카오')));
check('Naver Place written without a space still counts',()=>assert.ok(practice.channelSkillIds({goal:'등록을 늘린다.',products:'',stores:'',channels:'네이버플레이스'}).includes('offline')));
check('a marketplace campaign does not get the local channel decision',()=>assert.ok(!practice.campaignPractice({goal:'온라인 구매 전환을 늘린다.',products:'음반',stores:'',channels:'쿠팡 마켓플레이스, 자사몰'}).includes('당근')));
check('the registry source file matches the code constant',()=>{const file=JSON.parse(readFileSync('prompts/channel.offline.json','utf8'));assert.equal(file.body,practice.channelSkills.find(s=>s.id==='offline').body)});
console.log(JSON.stringify({passed:passed.length}));
