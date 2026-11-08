// C6 카카오 비즈메시지 순수 모듈 회귀(docs/KAKAO-BIZMESSAGE.ko.md): 정보성/광고성 분류, 알림톡 정보성 전용, (광고) 머리말·전송자 명칭·080 수신거부, KST 야간 창(동의 유무),
// 수신 동의 없음·철회·2년 만료·23개월 경고, 수신거부 목록, 하루 상한, CSV 가져오기 해시(번호 원문 없음), 재동의 대상 목록, 레지스트리 서술자, 계약 하네스 5 시나리오(모의 딜러), 참고 딜러의 결과 분류.
// 근거: 순수 함수 검증(네트워크·D1 없음, fetch는 스텁). 실제 딜러·카카오 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const compliance=await rt.load('lib/kakao/compliance.ts'),consent=await rt.load('lib/kakao/consent.ts'),desc=await rt.load('lib/kakao/registry-descriptor.ts');
const registry=await rt.load('lib/connectors/registry.ts'),contract=await rt.load('lib/connectors/contract-test.ts'),mock=await rt.load('lib/kakao/dealer-mock.ts'),generic=await rt.load('lib/kakao/dealer-generic.ts'),outcome=await rt.load('lib/kakao/dealer-outcome.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const rules=v=>plain(v).reasons.map(r=>r.rule);

// ── 시각: KST 14:00(낮)·22:00(야간)·07:59(야간)·08:00(낮)·20:49·20:50 ──
const kst=(date,hm)=>Date.parse(`${date}T${hm}:00+09:00`);
const DAY=kst('2026-11-09','14:00'),NIGHT=kst('2026-11-09','22:00');
check('KST parts: 22:00 is night, 14:00 is day, 07:59 night, 08:00 day, 20:49 day, 20:50 night',compliance.kstParts(NIGHT).night&&!compliance.kstParts(DAY).night&&compliance.kstParts(kst('2026-11-09','07:59')).night&&!compliance.kstParts(kst('2026-11-09','08:00')).night&&!compliance.kstParts(kst('2026-11-09','20:49')).night&&compliance.kstParts(kst('2026-11-09','20:50')).night);
check('KST date rolls over at midnight Seoul time',compliance.kstParts(Date.parse('2026-11-09T15:30:00Z')).date==='2026-11-10'&&compliance.kstParts(Date.parse('2026-11-09T14:30:00Z')).date==='2026-11-09');

// ── 분류 ──
const INFO='[오다] 주문이 접수되었습니다. 예약 시간 18:00에 매장에서 뵙겠습니다.';
const AD_OK='(광고) 오다 이문점\n신메뉴 출시 기념 10% 할인 쿠폰을 드립니다.\n무료 수신거부 080-123-4567';
check('an order notice is informational',compliance.classifyMessage(INFO).classification==='informational');
check('discount wording is advertising',compliance.classifyMessage('이번 주 전 메뉴 20% 할인!').classification==='advertising');
check('the (광고) label alone makes it advertising',compliance.classifyMessage('(광고) 오다\n안내입니다.\n무료 수신거부 080-123-4567').classification==='advertising');
check("the '무료 수신거부' line does not count as a 무료 promotion",compliance.classifyMessage('예약이 확정되었습니다.\n무료 수신거부 080-123-4567').classification==='informational');

const active={consentedAt:'2026-01-10T00:00:00.000Z',nightConsent:false,revokedAt:null},night={...active,nightConsent:true};
const base={senderName:'오다 이문점',now:DAY,consent:active,optedOut:false,adSentToday:0};
// ── 알림톡 ──
check('an informational alimtalk passes',plain(compliance.checkKakaoCompliance({...base,type:'alimtalk',text:INFO,consent:null})).ok===true);
check('an alimtalk with advertising wording is blocked as informational-only',rules(compliance.checkKakaoCompliance({...base,type:'alimtalk',text:'(광고) 오다 신메뉴 할인 이벤트!'})).includes('kakao.alimtalk.informational_only'));
check('an informational alimtalk ignores consent, optout, window and cap',plain(compliance.checkKakaoCompliance({type:'alimtalk',text:INFO,senderName:'오다',now:NIGHT,consent:null,optedOut:true,adSentToday:5})).ok===true);
// ── 브랜드 메시지 형식 ──
check('a compliant brand message passes with no reasons',plain(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK})).ok===true);
check("a brand message without '(광고)' at the start is blocked",rules(compliance.checkKakaoCompliance({...base,type:'brand',text:'오다 이문점\n신메뉴 할인\n무료 수신거부 080-123-4567'})).includes('kakao.brand.ad_label'));
check("a variant label like '[광고]' or '(광/고)' is still blocked",rules(compliance.checkKakaoCompliance({...base,type:'brand',text:'[광고] 오다 이문점 할인\n무료 수신거부 080-123-4567'})).includes('kakao.brand.ad_label')&&rules(compliance.checkKakaoCompliance({...base,type:'brand',text:'(광/고) 오다 이문점 할인\n무료 수신거부 080-123-4567'})).includes('kakao.brand.ad_label'));
check('a brand message without the sender name is blocked',rules(compliance.checkKakaoCompliance({...base,type:'brand',text:'(광고) 신메뉴 할인\n무료 수신거부 080-123-4567'})).includes('kakao.brand.sender_name'));
check('a brand message without an 080 optout line is blocked',rules(compliance.checkKakaoCompliance({...base,type:'brand',text:'(광고) 오다 이문점\n신메뉴 할인\n수신거부: 답장'})).includes('kakao.brand.optout_080'));
check("the optout line needs both the '수신거부' wording and an 080 number",rules(compliance.checkKakaoCompliance({...base,type:'brand',text:'(광고) 오다 이문점\n신메뉴 할인\n문의 080-123-4567'})).includes('kakao.brand.optout_080'));
check('every reason cites its rule id in Korean text with a legal basis',plain(compliance.checkKakaoCompliance({...base,type:'brand',text:'할인'})).reasons.every(r=>/\[kakao\./.test(r.message)&&/[가-힣]/.test(r.message)&&r.basis.length>0));
// ── 야간 창 ──
check('a night-time brand message without night consent is blocked',rules(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,now:NIGHT})).includes('kakao.night_window'));
check('a night-time brand message with recorded night consent passes',plain(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,now:NIGHT,consent:night})).ok===true);
check('20:50 KST is already inside the blocked window (dealer rule, stricter than the 21:00 law)',rules(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,now:kst('2026-11-09','20:50')})).includes('kakao.night_window'));
// ── 동의 ──
check('no consent record blocks advertising',rules(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,consent:null})).includes('kakao.consent.required'));
check('a revoked consent blocks advertising',rules(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,consent:{...active,revokedAt:'2026-05-01T00:00:00.000Z'}})).includes('kakao.consent.revoked'));
const expiredVerdict=plain(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,consent:{...active,consentedAt:'2024-11-01T00:00:00.000Z'}}));
check("a consent older than 2 years is blocked with '재동의 필요'",expiredVerdict.reasons.some(r=>r.rule==='kakao.consent.expired'&&/재동의 필요/.test(r.message)));
check('a consent exactly 24 months old is expired, 23 months old is a warning only',compliance.consentStateOf({...active,consentedAt:'2024-11-09T05:00:00.000Z'},DAY)==='expired'&&(()=>{const v=plain(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,consent:{...active,consentedAt:'2024-12-01T00:00:00.000Z'}}));return v.ok&&v.warnings.some(w=>w.rule==='kakao.consent.renewal_due')})());
check('a consent dated in the future is invalid and treated as missing',rules(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,consent:{...active,consentedAt:'2027-01-01T00:00:00.000Z'}})).includes('kakao.consent.required'));
// ── 수신거부·상한 ──
check('an opted-out recipient is blocked',rules(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,optedOut:true})).includes('kakao.optout'));
check('the default daily cap is one advertising message per recipient',rules(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,adSentToday:1})).includes('kakao.daily_cap')&&plain(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK,adSentToday:1,dailyCap:2})).ok===true);
check('an empty body is rejected',rules(compliance.checkKakaoCompliance({...base,type:'alimtalk',text:'  '})).includes('kakao.text.empty'));
check('multiple failures are all reported at once',rules(compliance.checkKakaoCompliance({type:'brand',text:'할인 이벤트',senderName:'오다',now:NIGHT,consent:null,optedOut:true,adSentToday:1})).length>=6);
check('the rule catalogue covers every rule id with a basis',plain(compliance.KAKAO_RULE_IDS).every(id=>compliance.KAKAO_RULES[id]&&/[가-힣]/.test(compliance.KAKAO_RULES[id].basis)));
check('the engine is pure: same input twice gives the same verdict',JSON.stringify(plain(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK})))===JSON.stringify(plain(compliance.checkKakaoCompliance({...base,type:'brand',text:AD_OK}))));

// ── 동의 CSV·해시 ──
check('phone normalisation accepts Korean mobiles with separators and +82',consent.normalizePhone('010-1234-5678')==='01012345678'&&consent.normalizePhone('+82 10 1234 5678')==='01012345678'&&consent.normalizePhone('02-123-4567')===null&&consent.normalizePhone('0101234')===null);
const h1=await consent.recipientHash('owner-a','01012345678'),h2=await consent.recipientHash('owner-b','01012345678');
check('recipient hashes are 64 hex, owner-scoped and never contain the number',consent.isRecipientHash(h1)&&h1!==h2&&!h1.includes('1234')&&h1===await consent.recipientHash('owner-a','01012345678'));
const csv='phone,consentedAt,source,nightConsent\n010-1234-5678,2026-10-01,event_form,true\n"01099998888",2026-09-15T10:00:00+09:00,pos,false\n010-1234-5678,2026-10-01,event_form,true';
const parsed=plain(consent.parseConsentCsv(csv,DAY));
check('CSV rows are parsed with ISO dates and booleans',parsed.errors.length===0&&parsed.rows.length===3&&parsed.rows[0].consentedAt==='2026-09-30T15:00:00.000Z'&&parsed.rows[0].nightConsent===true&&parsed.rows[1].source==='pos'&&parsed.rows[1].nightConsent===false);
const bad=plain(consent.parseConsentCsv('phone,consentedAt\n02-111-2222,2026-10-01\n01012345678,2030-01-01\n01012345678,언젠가',DAY));
check('CSV errors name the row number only, never the phone number',bad.rows.length===0&&bad.errors.length===3&&bad.errors.every(e=>/^\d+행/.test(e)&&!/0101234|02-111/.test(e)));
check('CSV without the phone/consentedAt header is rejected',plain(consent.parseConsentCsv('번호,날짜\n01012345678,2026-10-01',DAY)).errors.length===1);
check('CSV over the row limit is rejected',plain(consent.parseConsentCsv('phone,consentedAt\n'+Array.from({length:5001},()=>'01012345678,2026-10-01').join('\n'),DAY)).errors[0].includes('5000'));
// ── 재동의 대상 ──
const rec=(hash,consentedAt,extra={})=>({id:'b:'+hash,recipientHash:hash,brandId:'b',channel:'kakao',consentedAt,source:'csv',nightConsent:false,revokedAt:null,createdAt:'x',updatedAt:'x',updatedBy:'u',...extra});
const due=plain(consent.reconsentDue([rec('a'.repeat(64),'2026-01-01T00:00:00Z'),rec('b'.repeat(64),'2024-12-01T00:00:00Z'),rec('c'.repeat(64),'2024-06-01T00:00:00Z'),rec('d'.repeat(64),'2024-06-01T00:00:00Z',{revokedAt:'2025-01-01T00:00:00Z'})],DAY));
check('re-consent list holds 23-month-old (active) and expired consents, not fresh or revoked ones, oldest first',due.length===2&&due[0].recipientHash==='c'.repeat(64)&&due[0].state==='expired'&&due[1].recipientHash==='b'.repeat(64)&&due[1].state==='active'&&due[1].renewBy==='2026-12-01');
const notice=plain(consent.reconsentNotice('b',due,DAY,'u1'));
check('the re-consent notice mirrors the detected-signal shape (status new, detection title/detail/dueBy) and is keyed per brand and KST day',notice.id==='reconsent:b:2026-11-09'&&notice.status==='new'&&notice.campaignId===null&&/2명/.test(notice.detection.title)&&/만료\(전송 차단\) 1명/.test(notice.detection.detail)&&notice.detection.dueBy==='2026-06-01'&&notice.detection.recipientHashes.length===2);
check('no due recipients means no notice',consent.reconsentNotice('b',[],DAY,'u1')===null);

// ── 레지스트리 서술자 ──
check('the kakao descriptor is registered, valid, default off and never retries unknown writes',registry.descriptorFor('kakao_bizmessage')&&registry.describeViolations().length===0&&plain(desc.kakaoCapabilities).every(c=>c.defaultOff===true&&c.retryUnknown===false&&c.flag==='kakao_bizmessage'));
check('customer sends are T4 and result/friend reads are T1',registry.capabilityFor('kakao_bizmessage.brand.send')?.riskTier==='T4'&&registry.capabilityFor('kakao_bizmessage.alimtalk.send')?.riskTier==='T4'&&registry.capabilityFor('kakao_bizmessage.result.read')?.riskTier==='T1'&&registry.capabilityFor('kakao_bizmessage.friend.read')?.riskTier==='T1');

// ── 계약 하네스 5 시나리오(모의 딜러가 ContractConnector) ──
const results=await contract.runContractScenarios(script=>mock.mockDealer({script}),{read:'kakao_bizmessage.result.read',write:'kakao_bizmessage.brand.send'});
check('five contract scenarios run against the mock dealer',results.length===5&&results.map(r=>r.scenario).join(',')==='success,failure,timeout,restart_resume,duplicate_idempotent');
for(const r of results)check(`contract scenario ${r.scenario} passes${r.passed?'':': '+r.details.join(' | ')}`,r.passed);

// ── 모의 딜러를 BizMessageProvider로: 성공·거부·보낸 뒤 타임아웃(unknown, 1회만) ──
const dealer=mock.mockDealer({script:{ok:[{kind:'response',status:200,value:{messageId:'m-1',costKrw:15}}],bad:[{kind:'response',status:400,value:{detail:'템플릿 미승인'}}],late:[{kind:'timeout',sent:true},{kind:'response',status:200}],busy:[{kind:'response',status:429,retryAfter:'1'},{kind:'response',status:200,value:{messageId:'m-2'}}]},results:{'m-1':{status:'DELIVERED',costKrw:15}}});
const req=key=>({senderKey:'sk',to:'01012345678',text:AD_OK,adFlag:true,idempotencyKey:key});
const ok=plain(await dealer.sendBrandMessage(req('ok')));
check('a 2xx dealer response is success with message id and cost',ok.outcome==='success'&&ok.messageId==='m-1'&&ok.costKrw===15&&ok.attempts===1);
const rejected=plain(await dealer.sendBrandMessage(req('bad')));
check('a 4xx dealer response is failed without retry',rejected.outcome==='failed'&&rejected.attempts===1&&/템플릿 미승인/.test(rejected.detail));
const late=plain(await dealer.sendBrandMessage(req('late')));
check('a timeout after sending is unknown and is not retried',late.outcome==='unknown'&&late.attempts===1&&dealer.calls().late===1&&/자동 재전송하지 않습니다/.test(late.detail));
const busy=plain(await dealer.sendBrandMessage(req('busy')));
check('a 429 is retried after Retry-After and then succeeds',busy.outcome==='success'&&busy.attempts===2&&busy.messageId==='m-2');
check('result polling maps dealer status strings',plain(await dealer.getResult('m-1')).status==='delivered'&&plain(await dealer.getResult('nope')).status==='unknown'&&outcome.resultStatus('FAILED')==='failed'&&outcome.resultStatus('queued')==='pending'&&outcome.resultStatus('???')==='unknown');
check('the mock never sees a phone number it was not given and records the recipient per call',dealer.sent().every(s=>s.to==='01012345678'));

// ── 참고 딜러(generic): fetch 스텁으로 응답 분류, 키 헤더·멱등 헤더, 예외는 unknown ──
const seen=[];
const fetchStub=async(url,init)=>{seen.push({url,init});
 if(url.endsWith('/v1/sender-profiles/sk'))return new Response(JSON.stringify({name:'오다'}),{status:200});
 if(url.endsWith('/v1/brand/messages')){const b=JSON.parse(init.body);if(b.recipient==='01000000000')throw new TypeError('socket hang up');return new Response(JSON.stringify({messageId:'g-1',costKrw:15}),{status:200})}
 if(url.endsWith('/v1/alimtalk/messages'))return new Response(JSON.stringify({message:'invalid template'}),{status:400});
 if(url.includes('/v1/messages/g-1'))return new Response(JSON.stringify({status:'DELIVERED',costKrw:15}),{status:200});
 return new Response('{}',{status:503})};
const cred={dealer:'generic',baseUrl:'https://dealer.test/',apiKey:'secret-key',senderKey:'sk',senderName:'오다',optoutNumber:'080-123-4567'};
const g=generic.genericDealer(cred,{fetch:fetchStub,deps:outcome.immediateDeps});
check('generic verify reads the sender profile',plain(await g.verify()).ok===true);
const gs=plain(await g.sendBrandMessage(req('idem-1')));
check('generic brand send posts JSON with the api-key and idempotency headers and maps 2xx to success',gs.outcome==='success'&&gs.messageId==='g-1'&&gs.costKrw===15&&seen.at(-1).init.headers['X-Api-Key']==='secret-key'&&seen.at(-1).init.headers['Idempotency-Key']==='idem-1'&&JSON.parse(seen.at(-1).init.body).ad===true);
check('generic alimtalk 4xx is failed',plain(await g.sendAlimtalk({senderKey:'sk',templateCode:'T1',to:'01012345678',variables:{이름:'고객'},idempotencyKey:'idem-2'})).outcome==='failed');
const thrown=plain(await g.sendBrandMessage({...req('idem-3'),to:'01000000000'}));
check('a thrown fetch during a write is unknown (could have reached the dealer), attempted once',thrown.outcome==='unknown'&&thrown.attempts===1);
check('generic result polling maps the status and cost',plain(await g.getResult('g-1')).status==='delivered'&&plain(await g.getResult('other')).status==='unknown');
check('the generic shape is marked as needing dealer-specific mapping',generic.GENERIC_SHAPE.note==='dealer-specific mapping needed');

console.log(JSON.stringify({passed:passed.length}));
