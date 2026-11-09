// C6 카카오 비즈메시지 서버·API 회귀(docs/KAKAO-BIZMESSAGE.ko.md): 실제 SQLite(node:sqlite)·실제 라우트(/api/kakao), 헤더(legacy) 인증, 합성 데이터, 딜러·카카오 API는 fetch 스텁.
// 권한(직원 403·비로그인 401·다른 출처 403·연결은 소유자만), 딜러 연결(암호화 저장·비밀값 미노출·검증 실패 시 저장 없음), 수신동의 CSV 가져오기(번호 원문 미저장·오류 시 부분 반영 없음), 수신거부,
// 초안→판정→승인(autonomy customer_send)→전송(스위치 꺼짐 409, 승인 없이는 409, 번호 해시 대조)→결과 폴링, unknown은 기록만 하고 재전송하지 않음, 같은 기록 재전송은 저장 레코드 반환, 하루 상한, 친구 관계 동기화, 재동의 안내 레코드, kind 등록.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더, fetch 스텁). 실제 딜러·카카오·모델 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const dealerCalls=[],kapiCalls=[];let dealerMode='ok';
const rt=testRuntime(async(url,init={})=>{
 const u=String(url);
 if(u.startsWith('https://dealer.test/')){
  dealerCalls.push({url:u,method:init.method||'GET',body:init.body?JSON.parse(init.body):null,headers:init.headers||{}});
  if(u.includes('/v1/sender-profiles/'))return new Response(JSON.stringify({name:'오다 이문점'}),{status:u.includes('bad-sender')?404:200});
  if(u.endsWith('/v1/brand/messages')||u.endsWith('/v1/alimtalk/messages')){
   if(dealerMode==='hang')throw new TypeError('socket hang up');
   if(dealerMode==='reject')return new Response(JSON.stringify({message:'발신프로필 차단'}),{status:400});
   return new Response(JSON.stringify({messageId:'msg-'+dealerCalls.length,costKrw:15}),{status:200});
  }
  if(u.includes('/v1/messages/'))return new Response(JSON.stringify({status:'DELIVERED',costKrw:15}),{status:200});
 }
 if(u.startsWith('https://kapi.kakao.com/v1/api/talk/channels')){
  kapiCalls.push({url:u,headers:init.headers||{}});
  const id=new URL(u).searchParams.get('target_id');
  if(id==='3')return new Response('{}',{status:500});
  return new Response(JSON.stringify({channels:[{channel_public_id:'_odapub',relation:id==='1'?'ADDED':id==='2'?'BLOCKED':'NONE'}]}),{status:200});
 }
 throw new Error('외부 호출 금지: '+u);
});
const {sql}=rt;
const server=await rt.load('lib/server.ts'),flags=await rt.load('lib/feature-flags.ts'),registry=await rt.load('lib/record-kinds.ts'),status=await rt.load('lib/feature-status.ts'),autonomy=await rt.load('lib/autonomy-server.ts');
const consentLib=await rt.load('lib/kakao/consent.ts'),route=await rt.load('app/api/kakao/route.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const ORIGIN='https://agency.test',O='c6-owner',X='c6-other';
const save=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await save(O,'brand','oda',{id:'oda',name:'오다'});
await save(X,'brand','oda',{id:'oda',name:'남의 오다'});
// 역할: legacy 헤더 인증은 모두 소유자다. 관리자·직원은 lib/server actor를 세션 모드 없이 흉내낼 수 없어 서버 함수에 Actor를 직접 넘겨 검사한다.
const as=who=>({'oai-authenticated-user-id':who});
const call=async res=>{const text=await res.text();let body=null;try{body=JSON.parse(text)}catch{body=text}return {status:res.status,body}};
const G=(q='',h=as(O))=>route.GET(new Request(`${ORIGIN}/api/kakao${q}`,{headers:h})).then(call);
const P=(input,h=as(O),origin=ORIGIN)=>route.POST(new Request(`${ORIGIN}/api/kakao`,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{}),...h},body:JSON.stringify(input)})).then(call);
const allData=()=>sql.prepare('SELECT data FROM records').all().map(r=>r.data).join('\n');
const rows=kind=>sql.prepare('SELECT id,owner,parent_id,data FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>({...JSON.parse(r.data),rowId:r.id,owner:r.owner,parentId:r.parent_id}));
const PHONE_A='010-1234-5678',PHONE_B='010-9999-8888',PHONE_C='010-5555-6666';
const HASH_A=await consentLib.recipientHash(O,'01012345678'),HASH_B=await consentLib.recipientHash(O,'01099998888'),HASH_C=await consentLib.recipientHash(O,'01055556666');
const AD_OK='(광고) 오다 이문점\n신메뉴 출시 기념 10% 할인 쿠폰을 드립니다.\n무료 수신거부 080-123-4567';
const INFO='[오다 이문점] 주문이 접수되었습니다. 예약 시간에 뵙겠습니다.';

// ── 1) 등록 ──
const kinds=plain(registry.recordKinds),kindOf=k=>kinds.find(x=>x.kind===k);
check('the five C6 kinds are registered as brand-parented, not campaign scoped',['marketing_consent','marketing_optout','kakao_friend_relation','kakao_reconsent_notice','bizmessage_send'].every(k=>kindOf(k)&&kindOf(k).parent==='brand'&&kindOf(k).campaignDeletion==='not_campaign_scoped'));
check('kakao_bizmessage is a known switch, off by default, and says sends are never automatic',flags.FEATURE_FLAGS.kakao_bizmessage?.defaultEnabled===false&&/자동 전송은 없다/.test(flags.FEATURE_FLAGS.kakao_bizmessage.description));
const featureRow=f=>plain(status.featureRows({flags:f})).find(r=>r.key==='kakao-bizmessage');
check('the settings table has a kakao row that follows the switch',JSON.stringify([featureRow([{flag:'kakao_bizmessage',enabled:true}]).status,featureRow([{flag:'kakao_bizmessage',enabled:false}]).status,featureRow(null).status])==='["available","blocked","blocked"]'&&featureRow(null).label==='카카오 비즈메시지(알림톡·브랜드 메시지)');
const src=p=>readFileSync(p,'utf8');
check('the switch is read only in lib/kakao/send-server.ts and never in the route',!/isEnabled\(/.test(src('app/api/kakao/route.ts'))&&/isEnabled\(owner,KAKAO_FLAG\)/.test(src('lib/kakao/send-server.ts')));
check('kakao modules never log phone numbers or secrets',!/console\.(log|warn|error)\([^)]*(phone|apiKey|to\b)/.test(['lib/kakao/send-server.ts','lib/kakao/consent-server.ts','lib/kakao/credential-server.ts','lib/kakao/dealer-generic.ts','lib/kakao/channel-sync.ts','app/api/kakao/route.ts'].map(src).join('\n')));

// ── 2) 권한·입력 ──
let r=await G('',{});
check('anonymous GET is 401',r.status===401);
r=await P({action:'check'},{} );
check('anonymous POST is 401',r.status===401);
r=await P({action:'nope'});
check('unknown action is 400',r.status===400);
r=await P({action:'check',brandId:'oda',type:'brand',text:AD_OK,phone:PHONE_A},as(O),'https://evil.test');
check('cross-origin POST is 403',r.status===403);
r=await G('');
check('owner GET shows the switch off and no dealer connected, with the rule catalogue',r.status===200&&r.body.enabled===false&&r.body.dealer.connected===false&&r.body.rules['kakao.consent.expired']);
r=await G('?brandId=nope');
check('an unknown brand is 404',r.status===404);
const member={owner:O,id:'staff-1',email:null,role:'member'},admin={owner:O,id:'admin-1',email:null,role:'admin'};
const sendServer=await rt.load('lib/kakao/send-server.ts');
await assert.rejects(()=>sendServer.approveMessage(O,member,{id:'x'}),e=>e.status===403);passed.push('a member cannot approve (403)');
await assert.rejects(()=>sendServer.sendMessage(O,member,{id:'x'}),e=>e.status===409);passed.push('a member send is refused before anything else while the switch is off (409)');
check('an admin can run the compliance check through the server module',(await sendServer.checkMessage(O,{brandId:'oda',type:'alimtalk',templateCode:'T1',text:INFO,phone:PHONE_A})).verdict.ok===true&&admin.role==='admin');

// ── 3) 딜러 연결: 검증 실패는 저장 없음, 성공은 암호화 저장·비밀값 미노출 ──
const dealerInput={action:'connect',dealer:'generic',baseUrl:'https://dealer.test',apiKey:'super-secret-key',senderKey:'sk-oda',senderName:'오다 이문점',optoutNumber:'080-123-4567',adminKey:'kakao-admin-key'};
r=await P({...dealerInput,senderKey:'bad-sender'});
check('a dealer that cannot verify the sender profile is not saved (400)',r.status===400&&rows('channel_credential').length===0);
r=await P({...dealerInput,dealer:'nhn'});
check("only the 'generic' reference dealer is accepted (400 with doc pointer)",r.status===400&&/KAKAO-BIZMESSAGE/.test(r.body.error));
r=await P({...dealerInput,optoutNumber:'02-123-4567'});
check('the optout number must be an 080 number',r.status===400);
r=await P({...dealerInput,baseUrl:'http://dealer.test'});
check('the dealer base URL must be https',r.status===400);
r=await P(dealerInput);
check('the owner connects the dealer and the response carries no secret',r.status===200&&r.body.account==='오다 이문점'&&!JSON.stringify(r.body).includes('super-secret-key'));
check('the dealer credential is stored encrypted in channel_credential without plaintext key or admin key',rows('channel_credential').length===1&&rows('channel_credential')[0].channel==='kakao_bizmessage'&&!allData().includes('super-secret-key')&&!allData().includes('kakao-admin-key'));
r=await P({action:'verify'});
check('verify re-reads the sender profile through the dealer',r.status===200&&r.body.ok===true&&r.body.resolvedScope.level==='workspace');
r=await G('');
check('GET shows the dealer connected with its account only',r.body.dealer.connected===true&&r.body.dealer.account==='오다 이문점'&&!JSON.stringify(r.body).includes('secret'));

// ── 4) 수신동의 가져오기: 번호 원문 미저장, 오류 시 부분 반영 없음, 갱신·중복 ──
r=await P({action:'consent_import',brandId:'oda',csv:`phone,consentedAt,source,nightConsent\n${PHONE_A},2026-10-01,event_form,true\n02-000-0000,2026-10-01,x,false`});
check('a CSV with one bad row imports nothing and names the row',r.status===200&&r.body.errors.length===1&&/^3행/.test(r.body.errors[0])&&rows('marketing_consent').length===0);
r=await P({action:'consent_import',brandId:'oda',csv:`phone,consentedAt,source,nightConsent\n${PHONE_A},2026-10-01,event_form,true\n${PHONE_B},2024-11-01,pos,false\n${PHONE_A},2026-10-01,event_form,true`});
check('valid rows are imported once per recipient',r.status===200&&r.body.created===2&&r.body.unchanged===1&&r.body.errors.length===0);
const consents=rows('marketing_consent');
check('consent rows hold hashes under the brand and no raw phone anywhere in the database',consents.length===2&&consents.every(c=>c.parentId==='oda'&&consentLib.isRecipientHash(c.recipientHash))&&consents.some(c=>c.recipientHash===HASH_A&&c.nightConsent===true)&&!/01012345678|1234-5678|0109999|9999-8888/.test(allData()));
r=await P({action:'consent_import',brandId:'oda',csv:`phone,consentedAt\n${PHONE_A},2026-09-01`});
check('an older consent date does not overwrite a newer one',r.body.unchanged===1&&rows('marketing_consent').find(c=>c.recipientHash===HASH_A).consentedAt==='2026-09-30T15:00:00.000Z');
r=await P({action:'consent_import',brandId:'oda',csv:'phone,consentedAt\n'+PHONE_A+',2026-10-01'},as(X));
check('another workspace imports into its own brand with a different owner-scoped hash',r.status===200&&r.body.created===1&&rows('marketing_consent').filter(c=>c.owner===X).length===1&&rows('marketing_consent').filter(c=>c.owner===X)[0].recipientHash!==HASH_A&&rows('marketing_consent').filter(c=>c.owner===O).length===2);
r=await P({action:'consent_import',brandId:'nope',csv:'phone,consentedAt\n'+PHONE_A+',2026-10-01'},as(X));
check('an unknown brand is 404 before any write',r.status===404);
r=await G('?brandId=oda');
check('the brand view summarises consent states and lists expired recipients for re-consent',r.body.consents.total===2&&r.body.consents.counts.active===1&&r.body.consents.counts.expired===1&&r.body.consents.reconsentDue===1&&r.body.consents.reconsent[0].recipientHash===HASH_B);
r=await P({action:'reconsent',brandId:'oda'});
check('the re-consent notice record is created once per brand and KST day in the detected-signal shape',r.status===200&&r.body.notice.status==='new'&&r.body.notice.detection.kind==='kakao_reconsent'&&rows('kakao_reconsent_notice').length===1&&rows('kakao_reconsent_notice')[0].parentId==='oda');
const noticeId=r.body.notice.id;r=await P({action:'reconsent',brandId:'oda'});
check('re-running returns the same notice without a second row',r.body.notice.id===noticeId&&rows('kakao_reconsent_notice').length===1);

// ── 5) 판정 미리보기(스위치 무관)·초안 ──
r=await P({action:'check',brandId:'oda',type:'brand',text:AD_OK,phone:PHONE_B});
check('check reports the expired consent with the rule id and stores nothing',r.status===200&&r.body.verdict.ok===false&&r.body.verdict.reasons.some(x=>x.rule==='kakao.consent.expired')&&r.body.recipientHash===HASH_B&&rows('bizmessage_send').length===0);
r=await P({action:'check',brandId:'oda',type:'alimtalk',templateCode:'ODA_ORDER_01',text:INFO,phone:PHONE_C});
check('an informational alimtalk to a recipient without consent passes the check',r.body.verdict.ok===true&&r.body.verdict.classification==='informational');
r=await P({action:'draft',brandId:'oda',type:'brand',text:'오다 이문점 할인!',phone:PHONE_A});
check('a non-compliant draft is saved with its reasons (status draft)',r.status===200&&r.body.status==='draft'&&r.body.compliance.ok===false&&r.body.compliance.reasons.some(x=>x.rule==='kakao.brand.ad_label'));
const badDraft=r.body.id;
r=await P({action:'approve',id:badDraft});
check('a blocked draft cannot be approved (409 with reasons)',r.status===409&&/kakao\.brand\.ad_label/.test(r.body.error));
r=await P({action:'draft',brandId:'oda',type:'brand',text:AD_OK,phone:PHONE_A,buttons:[{name:'메뉴 보기',url:'https://oda.example/menu'}]});
check('a compliant brand draft is saved with a hash, idempotency key and no phone',r.status===200&&r.body.compliance.ok===true&&r.body.recipientHash===HASH_A&&r.body.idempotencyKey===`kakao:${O}:${r.body.id}`&&r.body.senderName==='오다 이문점'&&!JSON.stringify(r.body).includes('1234'));
const draftId=r.body.id;
r=await P({action:'draft',brandId:'oda',type:'brand',text:AD_OK,phone:PHONE_A,buttons:[{name:'x',url:'http://insecure'}]});
check('non-https buttons are rejected',r.status===400);
r=await P({action:'draft',brandId:'oda',type:'alimtalk',text:INFO,phone:PHONE_A});
check('an alimtalk draft needs a template code',r.status===400);

// ── 6) 전송: 스위치 꺼짐 409 → 승인 필요 → 승인(autonomy) → 전송 ──
r=await P({action:'send',id:draftId,phone:PHONE_A});
check('switch off: send is 409 and the draft is untouched',r.status===409&&/kakao_bizmessage/.test(r.body.error)&&rows('bizmessage_send').find(x=>x.id===draftId).status==='draft'&&dealerCalls.filter(c=>c.url.endsWith('/messages')).length===0);
await flags.setFeatureFlag(O,{flag:'kakao_bizmessage',enabled:true},{id:O,email:null});
r=await P({action:'send',id:draftId,phone:PHONE_A});
check('switch on but unapproved: send is 409 and nothing reaches the dealer',r.status===409&&/승인/.test(r.body.error)&&dealerCalls.filter(c=>c.url.endsWith('/messages')).length===0);
// 자율성 규칙: customer_send는 자동이 될 수 없고 never면 403이다.
await flags.setFeatureFlag(O,{flag:'autonomy_rules',enabled:true},{id:O,email:null});
await autonomy.saveAutonomySettings({owner:O,id:O,email:null,role:'owner'},{settings:{customer_send:'never'}});
r=await P({action:'approve',id:draftId});
check('autonomy never blocks approval with 403',r.status===403&&rows('bizmessage_send').find(x=>x.id===draftId).status==='draft');
await assert.rejects(()=>autonomy.saveAutonomySettings({owner:O,id:O,email:null,role:'owner'},{settings:{customer_send:'auto'}}),e=>e.status===400);passed.push('customer_send can never be set to auto');
await autonomy.saveAutonomySettings({owner:O,id:O,email:null,role:'owner'},{settings:{customer_send:'ask'}});
r=await P({action:'approve',id:draftId,version:99});
check('a stale version is 409',r.status===409);
r=await P({action:'approve',id:draftId});
check('a human approval records who, when and the autonomy mode (ask)',r.status===200&&r.body.status==='approved'&&r.body.approval.by===O&&r.body.approval.autonomy==='ask');
r=await P({action:'approve',id:draftId});
check('approving twice is 409',r.status===409);
r=await P({action:'send',id:draftId,phone:PHONE_B});
check('sending with a phone whose hash does not match the record is 400 and does not send',r.status===400&&dealerCalls.filter(c=>c.url.endsWith('/messages')).length===0);
r=await P({action:'send',id:draftId,phone:PHONE_A});
const sentCalls=()=>dealerCalls.filter(c=>c.url.endsWith('/v1/brand/messages'));
check('an approved brand message is sent once with the idempotency key, ad flag and recipient only in the request body',r.status===200&&r.body.executed===true&&r.body.record.status==='sent'&&r.body.record.send.outcome==='success'&&r.body.record.send.messageId&&r.body.record.send.costKrw===15&&sentCalls().length===1&&sentCalls()[0].headers['Idempotency-Key']===`kakao:${O}:${draftId}`&&sentCalls()[0].body.ad===true&&sentCalls()[0].body.recipient==='01012345678'&&sentCalls()[0].body.buttons.length===1);
check('the stored send record has the KST day for the daily cap and no phone number',rows('bizmessage_send').find(x=>x.id===draftId).send.day.length===10&&!/01012345678/.test(allData()));
r=await P({action:'send',id:draftId,phone:PHONE_A});
check('re-sending the same record returns the stored record without a second dealer call',r.status===200&&r.body.executed===false&&r.body.record.id===draftId&&sentCalls().length===1);
r=await P({action:'result',id:draftId});
check('result polling records the dealer status',r.status===200&&r.body.result.status==='delivered'&&r.body.status==='sent');
// 하루 상한: 같은 수신자에게 두 번째 광고성 초안은 판정에서 막힌다.
r=await P({action:'draft',brandId:'oda',type:'brand',text:AD_OK,phone:PHONE_A});
check('a second advertising draft to the same recipient today is blocked by the daily cap',r.body.compliance.ok===false&&r.body.compliance.reasons.some(x=>x.rule==='kakao.daily_cap'));

// ── 7) unknown: 보낸 뒤 연결 끊김은 기록만 남기고 재전송하지 않는다 ──
await P({action:'consent_import',brandId:'oda',csv:`phone,consentedAt,source,nightConsent\n${PHONE_C},2026-10-01,event_form,true`});
r=await P({action:'draft',brandId:'oda',type:'brand',text:AD_OK,phone:PHONE_C});const unknownId=r.body.id;
await P({action:'approve',id:unknownId});
dealerMode='hang';
r=await P({action:'send',id:unknownId,phone:PHONE_C});
check('a send whose fetch fails after dispatch is recorded as unknown after a single attempt',r.status===200&&r.body.record.status==='unknown'&&r.body.record.send.outcome==='unknown'&&r.body.record.send.attempts===1&&sentCalls().length===2);
dealerMode='ok';
r=await P({action:'send',id:unknownId,phone:PHONE_C});
check('an unknown record is never re-sent, even after the dealer recovers',r.body.executed===false&&r.body.record.status==='unknown'&&sentCalls().length===2);
r=await P({action:'result',id:unknownId});
check('result polling of an unknown record without a message id is 409 (reconcile in the dealer console)',r.status===409);
// 거부: 4xx는 failed이고 새 초안이 필요하다.
r=await P({action:'draft',brandId:'oda',type:'alimtalk',templateCode:'ODA_ORDER_01',text:INFO,variables:{이름:'고객'},phone:PHONE_B});const alimId=r.body.id;
await P({action:'approve',id:alimId});dealerMode='reject';
r=await P({action:'send',id:alimId,phone:PHONE_B});dealerMode='ok';
check('a 4xx dealer rejection is failed with the dealer detail and the alimtalk request carried template code and variables',r.body.record.status==='failed'&&/발신프로필 차단/.test(r.body.record.send.detail)&&dealerCalls.filter(c=>c.url.endsWith('/v1/alimtalk/messages'))[0].body.templateCode==='ODA_ORDER_01');
r=await P({action:'send',id:alimId,phone:PHONE_B});
check('a failed record is not re-sent (409, new draft required)',r.status===409);

// ── 8) 수신거부 → 동의 철회 → 전송 차단 ──
r=await P({action:'optout',brandId:'oda',phone:PHONE_A,source:'080_call'});
check('an opt-out records the hash and revokes the consent in the same batch',r.status===200&&r.body.recipientHash===HASH_A&&r.body.consentRevoked===true&&rows('marketing_optout').length===1&&rows('marketing_consent').find(c=>c.recipientHash===HASH_A).revokedAt);
r=await P({action:'check',brandId:'oda',type:'brand',text:AD_OK,phone:PHONE_A});
check('after opt-out the check reports both optout and revoked consent',r.body.verdict.reasons.map(x=>x.rule).includes('kakao.optout')&&r.body.verdict.reasons.map(x=>x.rule).includes('kakao.consent.revoked'));

// ── 9) 친구 관계 동기화(Admin 키, 모의 카카오 API) ──
r=await P({action:'friend_sync',brandId:'oda',channelPublicId:'_odapub',recipients:[{recipientHash:HASH_A,appUserId:'1'},{recipientHash:HASH_B,appUserId:'2'},{recipientHash:HASH_C,appUserId:'3'}]});
check('friend relations are synced per recipient hash and unknown responses are skipped',r.status===200&&r.body.synced===2&&r.body.unknown===1&&r.body.relations.ADDED===1&&r.body.relations.BLOCKED===1&&rows('kakao_friend_relation').length===2&&rows('kakao_friend_relation').every(x=>x.parentId==='oda'&&!('appUserId' in x)));
r=await P({action:'friend_sync',brandId:'oda',channelPublicId:'_odapub',recipients:[{recipientHash:'zz',appUserId:'1'}]});
check('malformed friend pairs are 400',r.status===400);
check('the kakao admin key only travels in the Authorization header to kapi.kakao.com',kapiCalls.length===3&&kapiCalls.every(c=>c.headers.Authorization==='KakaoAK kakao-admin-key'&&!c.url.includes('kakao-admin-key')));

// ── 10) 다른 워크스페이스는 보이지 않는다 ──
r=await G('?brandId=oda',as(X));
check('another workspace sees only its own consent, no sends and no dealer',r.status===200&&r.body.consents.total===1&&r.body.sends.length===0&&r.body.dealer.connected===false);
r=await G('?brandId=oda');
check('the owner view lists the sends newest first with hashes only',r.body.sends.length===5&&r.body.sends.every(s=>consentLib.isRecipientHash(s.recipientHash))&&!JSON.stringify(r.body.sends).includes('0101234'));
check('no external call left the dealer or kakao stubs',dealerCalls.every(c=>c.url.startsWith('https://dealer.test/')));

console.log(JSON.stringify({passed:passed.length}));
