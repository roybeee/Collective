// 트랙 R R15b-3 인터뷰 영상 완성본 해시 순수 모듈(lib/franchise-media.ts)과 경로(/api/franchise asset_media) 회귀. 사례 번호 MD-*는 PR 본문과 같다.
// 확인: 판정 순서(스위치 → 역할 → 유형 → 승인 → 입력 → 중복 → 한도), 촬영일 범위(승인일 ~ 오늘, KST), 실제 라우트에서 저장·중복 409·직원 403·미승인 409·라벨 개인정보 400·감사 값 없음.
// 근거: mocked(순수 함수·메모리 SQLite·이메일 모드 세션 주입, 외부 호출 0). 영상 파일은 올리지 않는다(해시만). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {franchiseFixture,captureConsole,plain,sha64} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
f.clock.set(Date.parse('2026-10-05T03:00:00Z')-Date.now());
const md=await f.load('lib/franchise-media.ts'),fa=await f.load('lib/franchise-assets.ts'),wrm=await f.load('lib/franchise-wait-review.ts');

// ════ MD-P 순수 판정 ════
const NOW='2026-10-10T09:00:00+09:00',SHA='a'.repeat(64);
const approved={type:'interview_video',status:'approved',approval:{at:'2026-10-08T10:00:00+09:00'},media:[]};
const IN={sha256:SHA,bytes:1024,label:'대표 인터뷰 15초 최종본',filmedOn:'2026-10-09'};
const CTX={enabled:true,actor:{id:'u1',role:'owner'},now:NOW};
const D=(a,i,c)=>plain(md.mediaDecision(a??approved,i??IN,{...CTX,...c}));
check('MD-P1 an approved interview script takes a hash with size, date and label',same(D(),{ok:true,value:{sha256:SHA,bytes:1024,label:'대표 인터뷰 15초 최종본',filmedOn:'2026-10-09',recordedAt:NOW,by:{id:'u1',role:'owner'}}}));
check('MD-P2 order: switch 409, member 403, other type 400, draft 409',same(D(undefined,undefined,{enabled:false}).reasons,['media_switch_off'])&&D(undefined,undefined,{actor:{id:'m',role:'member'}}).status===403&&same(D({...approved,type:'portal_intro'}).reasons,['media_type'])&&same(D({...approved,status:'draft'}).reasons,['media_not_approved']));
check('MD-P3 filming date must be between approval day and today (KST)',same(D(undefined,{...IN,filmedOn:'2026-10-07'}).reasons,['media_invalid'])&&same(D(undefined,{...IN,filmedOn:'2026-10-11'}).reasons,['media_invalid'])&&D(undefined,{...IN,filmedOn:'2026-10-08'}).ok&&D(undefined,{...IN,filmedOn:'2026-10-10'}).ok);
check('MD-P4 bad hash, size and label are 400; upper-case hex is normalized',[{sha256:'xyz'},{bytes:0},{bytes:5*1024**3},{bytes:1.5},{label:''},{label:'가'.repeat(61)},{label:'줄\n바꿈'}].every(x=>same(D(undefined,{...IN,...x}).reasons,['media_invalid']))&&D(undefined,{...IN,sha256:'A'.repeat(64)}).value.sha256===SHA);
check('MD-P5 the same hash twice is 409 and ten items is the limit',same(D({...approved,media:[{sha256:SHA}]}).reasons,['media_duplicate'])&&same(D({...approved,media:Array.from({length:10},(_,i)=>({sha256:String(i).repeat(64)}))}).reasons,['media_limit']));
const CODE=readFileSync('lib/franchise-media.ts','utf8');
check('MD-P6 the module imports only the rules module and reads no clock or network',same([...CODE.matchAll(/from '\.\/([^']+)'/g)].map(m=>m[1]),['franchise-rules'])&&!/Date\.now|new Date\(|fetch\(|database\(/.test(CODE));

// ════ MD-R 경로 ════
const WS='md-owner';
const boss=f.signIn('md-boss','admin',1000,WS),member=f.signIn('md-member','member',3000,WS);
await f.brand(WS,'fr-a');
assert.equal((await f.setFlag(boss,true)).status,200);
assert.equal((await f.profile(boss,'fr-a',{storageLabels:['가상 보관함']},0)).status,200);
const dv=await f.post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'가상 정보공개서',sha256:sha64('md dv'),storageLabel:'가상 보관함',registeredAt:'2026-03-15T10:00:00+09:00',validFrom:'2026-03-15',validUntil:'2027-06-30'});
assert.equal(dv.status,200,JSON.stringify(dv.body));
await server.recordStatement(WS,'campaign','ca-a',{id:'ca-a',brandId:'fr-a',title:'가상 가맹 모집',goal:'가상',audience:'',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'approved',version:1,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',objective:'franchise_recruitment'}).run();
const SCRIPT='[인터뷰] 매일 아침 반죽을 직접 치댑니다. 손님이 웃을 때 가장 보람을 느낍니다.';
let r=await f.post(member,{action:'asset_save',brandId:'fr-a',campaignId:'ca-a',type:'interview_video',factRefs:[],body:SCRIPT});
check('MD-R1 a member saves a 15-second interview script as an asset',r.status===200&&r.body.result.version===1);
const A=r.body.result,row=()=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='recruitment_asset' AND id=?").get(`${WS}:recruitment_asset:${A.assetId}:1`).data);
const media=(s,x={})=>f.post(s,{action:'asset_media',brandId:'fr-a',assetId:A.assetId,version:1,sha256:SHA,bytes:2048,label:'대표 인터뷰 최종본',filmedOn:'2026-10-05',...x});
r=await media(boss);
check('MD-R2 recording on a draft is 409 media_not_approved',r.status===409&&same((r.body.reasons||[]).map(x=>x.code),['media_not_approved']));
const view=await f.get(boss,`view=asset&brandId=fr-a&assetId=${A.assetId}`);
const ap=await f.post(boss,{action:'asset_approve',brandId:'fr-a',assetId:A.assetId,version:1,bodyHash:A.bodyHash,checklist:{version:fa.CHECKLIST_VERSION,checked:plain(fa.CHECKLIST_IDS)},waitReview:{version:wrm.WAIT_REVIEW_VERSION,confirmed:true,candidates:wrm.waitReviewSummary(SCRIPT).candidates}});
check('MD-R3 the owner approves the script',view.status===200&&ap.status===200,JSON.stringify(ap.body));
check('MD-R4 a member cannot record a hash (403)',(await media(member)).status===403);
check('MD-R5 a label with personal data is 400',(await media(boss,{label:'김가상 010-0000-0108'})).status===400);
r=await media(boss);
check('MD-R6 the owner records the hash; the asset row carries it',r.status===200&&r.body.result.media===1&&row().media.length===1&&row().media[0].sha256===SHA&&row().status==='approved');
check('MD-R7 the same hash again is 409',(await media(boss)).status===409);
const audit=sql.prepare("SELECT data FROM records WHERE kind='franchise_audit' AND json_extract(data,'$.action')='asset_media'").all().map(x=>x.data).join('\n');
check('MD-R8 the audit row keeps the hash and ids only (no label)',audit.includes(SHA)&&!audit.includes('대표 인터뷰 최종본'));
check('MD-R9 the detail view shows the media list',(await f.get(member,`view=asset&brandId=fr-a&assetId=${A.assetId}`)).body.asset.media.length===1);
r=await f.post(member,{action:'asset_save',brandId:'fr-a',campaignId:'ca-a',type:'interview_video',factRefs:[],body:'[인터뷰] 저희 점주님은 월 순수익 500만원을 벌고 있습니다.'});
const hb=await f.post(boss,{action:'asset_approve',brandId:'fr-a',assetId:r.body.result.assetId,version:1,bodyHash:r.body.result.bodyHash,checklist:{version:fa.CHECKLIST_VERSION,checked:plain(fa.CHECKLIST_IDS)},waitReview:{version:wrm.WAIT_REVIEW_VERSION,confirmed:true,candidates:0}});
check('MD-R10 a revenue claim in an interview script is blocked at approval (409)',hb.status===409);
check('MD-R11 no external call and no label in the console',f.calls.length===0&&!logged.some(l=>l.includes('대표 인터뷰 최종본')));

console.log(JSON.stringify({passed:passed.length}));
