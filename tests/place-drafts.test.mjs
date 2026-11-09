// C5 플레이스 리뷰 답글·소식 초안: 결정론 템플릿(확정 사실·확정 말투만), 규정 점검(광고 표기·확정 사실 밖 수치·최상급·길이·피할 표현), 리뷰 원문 개인정보 가림,
// 상태 전이, 서버(스위치 꺼짐 409·직원 403·자율성 publish_submit never 403·막는 항목 승인 409·승인 문안 해시·복사·제출 지원·수동 제출·게시 확인),
// 장치 작업(점포 브라우저 스위치·연결·매핑 확인이 모두 있을 때만, 작업은 draft로 만들어 점포 브라우저 승인을 다시 거침), HTTP 권한.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·세션 주입). 외부 네트워크 0회. 실제 네이버 스마트플레이스 등록은 하지 않는다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const {sql,env,load}=testRuntime(async url=>{throw new Error('외부 호출 금지: '+url)});
const pure=await load('lib/place-drafts.ts'),server=await load('lib/place-drafts-server.ts'),flags=await load('lib/feature-flags.ts'),core=await load('lib/server.ts'),autonomy=await load('lib/autonomy-server.ts');
const browser=await load('lib/store-browser-server.ts'),route=await load('app/api/place-drafts/route.ts'),kinds=await load('lib/record-kinds.ts'),status=await load('lib/feature-status.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const day=86400000,iso=ms=>new Date(Date.now()+ms).toISOString();
const fact=(id,key,value,over={})=>({id,brandId:'ofd',key,value,status:'confirmed',source:'대표 확인',verifiedAt:iso(-day),validUntil:iso(30*day),version:1,updatedAt:iso(-day),...over});
const facts=[fact('f-phone','phone','02-123-4567',{storeId:'s1'}),fact('f-hours','hours','매일 11:00-21:00',{storeId:'s1'}),fact('f-addr','address','서울 동대문구 휘경로 1',{storeId:'s1'}),fact('f-promo','promotion','아메리카노 1,000원 할인'),fact('f-old','menu_price','라떼 9,000원',{validUntil:iso(-day)}),fact('f-rej','promotion','전 메뉴 50% 할인',{status:'rejected'})];
const ctxOf=(voice=null)=>({storeLabel:'올드페리도넛 휘경점',facts:facts.filter(f=>f.status==='confirmed'&&Date.parse(f.validUntil)>Date.now()),voice});

// 1) 순수 템플릿: 결정론, 확정 사실만, 리뷰 원문·리뷰어 이름 재사용 없음.
check('sentiment uses the rating first, negative words win over positive ones',pure.sentimentOf('정말 맛있어요',5)==='positive'&&pure.sentimentOf('맛있는데 직원이 불친절',5)==='negative'&&pure.sentimentOf('그냥 그래요',3)==='neutral'&&pure.sentimentOf('별로였어요')==='negative'&&pure.sentimentOf('또 올게요')==='positive'&&pure.sentimentOf('보통')==='neutral');
const neg=plain(pure.reviewReplyDraft({text:'김철수입니다. 도넛이 식었고 불친절했어요',rating:2},ctxOf()));
check('a negative reply apologises, adds the confirmed phone and cites only that fact',neg.text==='안녕하세요, 올드페리도넛 휘경점입니다. 이용에 불편을 드려 죄송합니다. 말씀해 주신 내용은 매장에서 확인하고 개선하겠습니다. 더 자세한 상황은 02-123-4567로 연락 주시면 직접 확인하겠습니다.'&&neg.template==='review_reply.negative.formal'&&neg.factRefs.map(r=>r.id).join()==='f-phone'&&!neg.text.includes('김철수'));
const pos=plain(pure.reviewReplyDraft({text:'최고예요 또 올게요',rating:5},ctxOf({version:3,tone:['친근한'],avoidTerms:[]})));
check('a positive reply in a friendly confirmed voice uses the friendly template, no phone, voice version recorded',pos.template==='review_reply.positive.friendly'&&/감사해요/.test(pos.text)&&!pos.text.includes('02-')&&pos.factRefs.length===0&&pos.voiceVersion===3);
check('the same input gives the same draft (deterministic)',JSON.stringify(plain(pure.reviewReplyDraft({text:'불친절',rating:1},ctxOf())))===JSON.stringify(plain(pure.reviewReplyDraft({text:'불친절',rating:1},ctxOf()))));
check('without a confirmed phone the negative reply has no contact line',!/연락/.test(pure.reviewReplyDraft({text:'불친절',rating:1},{...ctxOf(),facts:[]}).text));
const promo=plain(pure.newsPostDraft({topic:'promotion',title:'평일 오후 아메리카노 할인',condition:'평일 14~17시 아메리카노 1,000원 할인',period:{from:'2026-11-10',to:'2026-11-30'}},ctxOf()));
check('a promotion news post starts with [광고] and adds only confirmed hours and address',promo.text.startsWith('[광고] 평일 오후 아메리카노 할인')&&promo.text.includes('2026-11-10~2026-11-30 동안')&&promo.text.includes('영업시간: 매일 11:00-21:00')&&promo.text.includes('주소: 서울 동대문구 휘경로 1')&&promo.factRefs.map(r=>r.id).join()==='f-addr,f-hours');
// 2) 규정 점검.
const chk=(text,news,over={})=>plain(pure.checkPlaceDraft({kind:news?'news_post':'review_reply',text,news,facts:ctxOf().facts,prohibited:facts.filter(f=>f.status==='rejected'),avoidTerms:[],now:'2026-11-09T00:00:00Z',...over}));
const promoNews={topic:'promotion',title:'평일 오후 아메리카노 할인',condition:'평일 14~17시 아메리카노 1,000원 할인'};
check('the generated promotion passes the check (confirmed amount, labelled)',chk(promo.text,promoNews).blocking===false);
check('a promotion without the [광고] label is blocked',chk(promo.text.replace('[광고] ',''),promoNews).issues.some(i=>i.ruleId==='place_promotion_label'&&i.severity==='block'));
const fake={topic:'promotion',title:'동네 최고 도넛',condition:'전 메뉴 50% 할인'};
const fakeCheck=chk(pure.newsPostDraft(fake,ctxOf()).text,fake);
check('unconfirmed amounts/discounts and superlatives are blocked as fake claims',fakeCheck.blocking&&fakeCheck.issues.some(i=>i.ruleId==='place_unconfirmed_value'&&i.excerpt==='50%')&&fakeCheck.issues.some(i=>i.ruleId==='place_unconfirmed_superlative'&&i.excerpt==='최고'));
check('expired facts do not confirm an amount',chk('[광고] 라떼 9,000원',{topic:'promotion',title:'라떼 9,000원',condition:'라떼 9,000원'}).issues.some(i=>i.ruleId==='place_unconfirmed_value'));
check('too long and empty texts are blocked; brand voice avoid terms warn only',chk('가'.repeat(1001),null).issues.some(i=>i.ruleId==='place_length')&&chk(' ',null).blocking&&(c=>!c.blocking&&c.issues.some(i=>i.ruleId==='place_voice_avoid'&&i.severity==='warn'))(chk('저렴하게 드려요',null,{avoidTerms:['저렴']})));
check('the shared compliance lexicon still runs (fake review solicitation is caught)',chk('리뷰 이벤트: 별점 5점 후기를 남기면 음료를 드려요',null).issues.length>0);
const src=plain(pure.sourceOf({text:'010-1234-5678로 연락주세요. 너무 늦게 나왔어요',reviewRef:'11/8 저녁 리뷰',rating:2}));
check('pasted review text is masked for personal data before saving',!src.text.includes('010-1234-5678')&&src.text.includes('[전화번호]')&&src.masked.some(m=>m.kind==='phone')&&src.reviewRef==='11/8 저녁 리뷰');
const base={id:'d1',status:'draft',version:1,history:[],updatedAt:''};
check('transitions: draft→approved→submitted→verified; illegal ones refused in Korean; inputs not mutated',(()=>{const a=pure.transitionDraft(base,'approved','u','t');const v=pure.transitionDraft(pure.transitionDraft(a,'submitted','u','t'),'verified','u','t');let msg='';try{pure.transitionDraft(base,'submitted','u','t')}catch(e){msg=e.message}return v.status==='verified'&&v.version===4&&base.status==='draft'&&/초안 상태에서는 제출 표시/.test(msg)})());

// 3) 서버.
const owner='pd-owner',who={owner,id:'owner-account',email:null,role:'owner'},member={...who,id:'m',role:'member'};
await core.seedBrands(owner);
await core.recordStatement(owner,'store','s1',{id:'s1',brandId:'ofd',name:'올드페리도넛 휘경점',status:'active',version:1},'ofd').run();
for(const f of facts)await core.recordStatement(owner,'brand_fact',f.id,f,'ofd').run();
await core.recordStatement(owner,'brand_voice','ofd',{id:'ofd',brandId:'ofd',confirmedVoice:{tone:['정중한'],do:[],dont:[],preferTerms:[],avoidTerms:['저렴'],samples:[],version:2,status:'confirmed'},history:[]},'ofd').run();
const by={id:'owner-account',email:null};
const reviewInput={action:'create',kind:'review_reply',storeId:'s1',sourceText:'도넛이 식어서 나왔어요. 010-9999-8888',rating:2,reviewRef:'11/8 리뷰'};
check('create with the switch off is a 409',await server.createPlaceDraft(who,reviewInput).then(()=>false,e=>e.status===409&&/place_drafts/.test(e.message)));
await flags.setFeatureFlag(owner,{flag:'place_drafts',enabled:true},by);
check('a member cannot create (403)',await server.createPlaceDraft(member,reviewInput).then(()=>false,e=>e.status===403));
let r=plain(await server.placeDraftAction(who,reviewInput));
const reply=r.draft;
check('a review reply draft uses store facts and the confirmed voice, masks the pasted review and is not blocking',reply.status==='draft'&&reply.draft.template==='review_reply.negative.formal'&&reply.draft.text.includes('02-123-4567')&&reply.draft.voiceVersion===2&&!reply.source.text.includes('010-9999-8888')&&reply.compliance.blocking===false&&sql.prepare("SELECT parent_id p FROM records WHERE owner=? AND kind='place_draft'").get(owner).p==='s1');
check('bad input is a 400: unknown kind, rating 6, promotion without condition',await server.createPlaceDraft(who,{...reviewInput,kind:'tweet'}).then(()=>false,e=>e.status===400)&&await server.createPlaceDraft(who,{...reviewInput,rating:6}).then(()=>false,e=>e.status===400)&&await server.createPlaceDraft(who,{action:'create',kind:'news_post',storeId:'s1',news:{topic:'promotion',title:'x'}}).then(()=>false,e=>e.status===400));
r=plain(await server.placeDraftAction(who,{action:'create',kind:'news_post',storeId:'s1',news:fake}));
const fakeDraft=r.draft;
check('a news post with unconfirmed claims is saved as a blocking draft',fakeDraft.compliance.blocking===true&&fakeDraft.draft.text.startsWith('[광고] 동네 최고 도넛'));
check('approving a blocking draft is a 409 listing the reasons',await server.approvePlaceDraft(who,{id:fakeDraft.id}).then(()=>false,e=>e.status===409&&/확정 사실에 없는/.test(e.message)));
check('edit needs the current version (409 when stale)',await server.editPlaceDraft(who,{id:fakeDraft.id,text:'x',expectedVersion:99}).then(()=>false,e=>e.status===409));
r=plain(await server.editPlaceDraft(who,{id:fakeDraft.id,expectedVersion:fakeDraft.version,text:'[광고] 평일 오후 아메리카노 할인\n\n아메리카노 1,000원 할인을 진행합니다.'}));
check('editing re-runs the check on the edited text: removing the fake claims clears the block',r.draft.draft.edited===true&&r.draft.version===2&&r.draft.compliance.blocking===false&&fakeDraft.compliance.blocking===true);
r=plain(await server.editPlaceDraft(who,{id:fakeDraft.id,expectedVersion:2,text:'[광고] 오늘만 반값'}));
check('an edit that adds an unconfirmed claim blocks again',r.draft.compliance.blocking===true&&r.draft.compliance.issues.some(i=>i.excerpt==='반값'));
await flags.setFeatureFlag(owner,{flag:'autonomy_rules',enabled:true},by);
await autonomy.saveAutonomySettings(who,{settings:{publish_submit:'never'}});
check('publish_submit never blocks approval with a 403',await server.approvePlaceDraft(who,{id:reply.id}).then(()=>false,e=>e.status===403&&/발행 접수/.test(e.message)));
await autonomy.saveAutonomySettings(who,{settings:{publish_submit:'ask'}});
check('a member cannot approve (403)',await server.approvePlaceDraft(member,{id:reply.id}).then(()=>false,e=>e.status===403));
r=plain(await server.approvePlaceDraft(who,{id:reply.id}));
const approved=r.draft;
check('approval pins the text hash and returns copy-and-submit help with the official admin URL',approved.status==='approved'&&approved.approvedBy==='owner-account'&&approved.approvedSha256===createHash('sha256').update(approved.draft.text).digest('hex')&&r.submitHelp.text===approved.draft.text&&r.submitHelp.adminUrl==='https://new.smartplace.naver.com/'&&/공개 쓰기 API가 없어/.test(r.submitHelp.note)&&r.autonomy==='ask');
check('an approved draft cannot be edited or approved again',await server.editPlaceDraft(who,{id:reply.id,expectedVersion:approved.version,text:'x'}).then(()=>false,e=>e.status===409)&&await server.approvePlaceDraft(who,{id:reply.id}).then(()=>false,e=>e.status===409));
// 4) 장치 작업: 점포 브라우저 스위치·연결·매핑이 모두 있어야 한다.
check('device task with store_browser_execution off is a 409 pointing to copy-and-submit',await server.createDeviceTask(who,{id:reply.id}).then(()=>false,e=>e.status===409&&/복사·제출 지원/.test(e.message)));
await flags.setFeatureFlag(owner,{flag:'store_browser_execution',enabled:true},by);
check('device task without a binding/mapping is a 409',await server.createDeviceTask(who,{id:reply.id}).then(()=>false,e=>e.status===409&&/registered_dom/.test(e.message)));
const dev=plain(await browser.storeBrowserAction(owner,{action:'register_device',label:'매장 PC',profileId:'u0'},who));
const bound=plain(await browser.storeBrowserAction(owner,{action:'save_binding',storeId:'s1',deviceId:dev.device.id,profileId:'u0',naverPlaceId:'2071910776',managerBusinessId:'11695831',managerUrl:'https://new.smartplace.naver.com/bizes/place/11695831/hours'},who));
check('a binding alone (no mapping confirmation) still refuses the device task',await server.createDeviceTask(who,{id:reply.id}).then(()=>false,e=>e.status===409&&/registered_dom/.test(e.message)));
check('mapping types are validated',await server.declareMapping(who,{storeId:'s1',taskTypes:['change_hours']}).then(()=>false,e=>e.status===400));
await server.declareMapping(who,{storeId:'s1',taskTypes:['post_news']});
check('a mapping without reply_review does not allow a reply task',await server.createDeviceTask(who,{id:reply.id}).then(()=>false,e=>e.status===409));
const mapping=plain(await server.declareMapping(who,{storeId:'s1',taskTypes:['reply_review','post_news'],note:'11/9 관찰'})).mapping;
check('the mapping records the binding version, device and profile (no selectors)',mapping.bindingVersion===bound.binding.version&&mapping.deviceId===dev.device.id&&mapping.profileId==='u0'&&mapping.version===2&&!('locators' in mapping));
r=plain(await server.createDeviceTask(who,{id:reply.id}));
const job=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='store_browser_job'").get(owner).data);
check('the device task is a draft reply_review store-browser job carrying the approved text and hash',r.job.type==='reply_review'&&r.job.status==='draft'&&job.type==='reply_review'&&job.status==='draft'&&job.placeDraft.text===approved.draft.text&&job.placeDraft.textSha256===approved.approvedSha256&&job.placeDraft.reviewRef==='11/8 리뷰'&&job.beforeHours===''&&job.deviceId===dev.device.id&&r.draft.deviceTask.jobId===job.id&&r.draft.status==='approved');
check('a second device task for the same draft is refused; manual submit is refused while a device task exists',await server.createDeviceTask(who,{id:reply.id}).then(()=>false,e=>e.status===409)&&await server.markSubmitted(who,{id:reply.id}).then(()=>false,e=>e.status===409&&/sync_device/.test(e.message)));
const approvedJob=plain(await browser.storeBrowserAction(owner,{action:'approve_job',jobId:job.id,expectedVersion:1},who));
check('the store-browser approval still gates the device job (draft → approved by a second human step)',approvedJob.job.status==='approved'&&approvedJob.job.approvedDigest===job.digest);
r=plain(await server.syncDeviceTask(who,{id:reply.id}));
check('sync before the device saves keeps the draft approved and records the job status',r.draft.status==='approved'&&r.draft.deviceTask.jobStatus==='approved');
const setJob=(over)=>{const cur=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='store_browser_job'").get(owner).data);return core.recordStatement(owner,'store_browser_job',cur.id,{...cur,...over},'s1').run()};
await setJob({status:'submitted',submissionStartedAt:'2026-11-09T02:00:00.000Z'});
r=plain(await server.syncDeviceTask(who,{id:reply.id}));
check('once the device started saving the draft is submitted via device',r.draft.status==='submitted'&&r.draft.submission.channel==='device'&&r.draft.submission.deviceJobId===job.id);
await setJob({status:'verified'});
r=plain(await server.syncDeviceTask(who,{id:reply.id}));
check('a verified device job marks the draft verified from the device read-back',r.draft.status==='verified'&&r.draft.verification.source==='device'&&r.draft.history.map(h=>h.to).join()==='draft,approved,submitted,verified');
// 5) 수동 제출 경로.
r=plain(await server.placeDraftAction(who,{action:'create',kind:'news_post',storeId:'s1',news:{topic:'notice',title:'11월 휴무 안내',body:'11월 20일은 쉽니다.'}}));
const notice=r.draft;
check('a notice draft is not blocking and has no [광고] label',!notice.compliance.blocking&&!notice.draft.text.startsWith('[광고]'));
await server.approvePlaceDraft(who,{id:notice.id});
check('submit_help returns the approved text and the menu path',(h=>h.text===notice.draft.text&&/소식/.test(h.path)&&h.observedManagerUrl===bound.binding.managerUrl)(plain(await server.placeDraftAction(who,{action:'submit_help',id:notice.id})).submitHelp));
// 승인 뒤 문안이 바뀌면(저장소 조작) 제출을 막는다.
const row=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='place_draft' AND id=?").get(owner,`${owner}:place_draft:${notice.id}`).data);
await core.recordStatement(owner,'place_draft',notice.id,{...row,draft:{...row.draft,text:row.draft.text+' 변조'}},'s1').run();
check('a text changed after approval is refused on submit',await server.markSubmitted(who,{id:notice.id}).then(()=>false,e=>e.status===409&&/승인한 문안과/.test(e.message)));
await core.recordStatement(owner,'place_draft',notice.id,row,'s1').run();
r=plain(await server.markSubmitted(who,{id:notice.id,note:'대표가 직접 등록'}));
check('manual submit marks submitted(manual) with the note',r.draft.status==='submitted'&&r.draft.submission.channel==='manual'&&r.draft.submission.note==='대표가 직접 등록');
r=plain(await server.markVerified(who,{id:notice.id,note:'공개 화면 확인'}));
check('manual verify marks verified',r.draft.status==='verified'&&r.draft.verification.source==='manual');
check('a verified draft cannot be cancelled; a draft can',await server.cancelPlaceDraft(who,{id:notice.id}).then(()=>false,e=>e.status===409)&&plain(await server.cancelPlaceDraft(who,{id:fakeDraft.id})).draft.status==='cancelled');
await flags.setFeatureFlag(owner,{flag:'place_drafts',enabled:false},by);
const listed=plain(await server.listPlaceDrafts(owner,'s1'));
check('listing works with the switch off and shows the mapping and the no-auto-submit notice',listed.enabled===false&&listed.drafts.length===3&&listed.mapping.status==='active'&&/자동 제출은 없습니다/.test(listed.notice));
check('writes are 409 with the switch off; revoke mapping still works',await server.createPlaceDraft(who,reviewInput).then(()=>false,e=>e.status===409)&&plain(await server.revokeMapping(who,{storeId:'s1'})).mapping.status==='revoked');
await flags.setFeatureFlag(owner,{flag:'place_drafts',enabled:true},by);

// 6) HTTP.
const call=async res=>({status:res.status,body:await res.json()});
const legacy={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
const get=(q,h=legacy)=>route.GET(new Request('https://agency.test/api/place-drafts'+q,{headers:h})).then(call);
const post=(input,h=legacy)=>route.POST(new Request('https://agency.test/api/place-drafts',{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(input)})).then(call);
let res=await get('?storeId=s1');
check('GET lists drafts for the store',res.status===200&&res.body.drafts.length===3);
res=await post({action:'dance'});
check('an unknown action is a 400',res.status===400&&/create/.test(res.body.error));
res=await post({...reviewInput},{...legacy,origin:'https://evil.test'});
check('cross-origin write is a 403',res.status===403);
check('unauthenticated read is a 401',(await get('?storeId=s1',{})).status===401);
res=await post(reviewInput);
check('POST create works over HTTP',res.status===200&&res.body.draft.kind==='review_reply');
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',1000);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const memberS=signIn('pd-member','member'),adminS=signIn('pd-admin','admin');
check('member GET and POST are 403',(await get('?storeId=s1',memberS)).status===403&&(await post(reviewInput,memberS)).status===403);
check('admin GET works',(await get('?storeId=s1',adminS)).status===200);

// 7) 레지스트리·스위치·기능 상태·문서·장치 작업 유형.
check('record kinds place_draft and place_draft_mapping are store-scoped and outside campaign deletion',['place_draft','place_draft_mapping'].every(kind=>(k=>k&&k.parent==='store'&&k.campaignDeletion==='not_campaign_scoped')(plain(kinds.recordKinds).find(k=>k.kind===kind))));
check('flag place_drafts defaults off and the feature row follows it',flags.FEATURE_FLAGS.place_drafts.defaultEnabled===false&&status.featureRows({flags:[{flag:'place_drafts',enabled:false}]}).find(r=>r.key==='place-drafts').status==='blocked'&&status.featureRows({flags:[{flag:'place_drafts',enabled:true}]}).find(r=>r.key==='place-drafts').status==='available');
const sbTypes=readFileSync('lib/store-browser.ts','utf8');
check('store-browser task types gained reply_review and post_news additively',/'upload_photo'\|'reply_review'\|'post_news'/.test(sbTypes));
const worker=readFileSync('scripts/store-browser-worker.mjs','utf8');
check('the device runner still hands off non-hours/photo writes before saving (native adapter stays read-only)',worker.includes("if (!['change_hours','change_weekly_hours','upload_photo'].includes(job.type)"));
const doc=readFileSync('docs/PLACE-DRAFTS.ko.md','utf8');
check('docs/PLACE-DRAFTS.ko.md covers the flow, limits and API',['place_drafts','[광고]','publish_submit','registered_dom','reply_review','post_news','/api/place-drafts','복사·제출 지원','자동 제출'].every(w=>doc.includes(w)));

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
