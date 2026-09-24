// lib/pii-scan.ts(DP-3 탐지·가림, DP-4 값 비노출) 순수 모듈 테스트. 모든 값은 합성이다(0으로 채운 번호, example.com, '가상' 지명).
// 근거: mocked(런타임·네트워크 없음, vm 순수 로더). 외부 호출 0회.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pureLoader} from '../scripts/eval/load-ts.mjs';

const load=pureLoader(process.cwd());
const pii=await load('lib/pii-scan.ts');
const orders=await load('lib/order-import.ts');
const {scanText,maskText,maskFields,PiiBlockedError,PII_PLACEHOLDER,contactAllowValues,mergeFindings}=pii;
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const kinds=text=>scanText(text).map(f=>f.kind).sort().join(',');
const masked=(text,opts)=>maskText(text,opts).text;
// vm 컨텍스트의 배열·객체는 다른 realm이라 deepStrictEqual 전에 평범한 값으로 바꾼다.
const plain=x=>JSON.parse(JSON.stringify(x));

check('module imports only relative paths',()=>assert.ok(![...readFileSync('lib/pii-scan.ts','utf8').matchAll(/from\s+'([^']+)'/g)].some(x=>!x[1].startsWith('./'))));
check('placeholders follow the lane A decision',()=>assert.deepEqual(plain(PII_PLACEHOLDER),{phone:'[전화번호]',email:'[이메일]',address:'[주소]',payment:'[결제정보]',national_id:'[고유식별번호]',customer_id:'[고객식별자]'}));

// 1) 전화번호: 휴대폰·지역번호·국제(+82)·구분자 변형·전각 숫자·폭 없는 문자.
const phones=['010-0000-0000','010 0000 0000','010.0000.0000','01000000000','+82 10-0000-0000','+82-10-0000-0000','+821000000000','02-000-0000','02-0000-0000','031-000-0000','(02) 000-0000','0507-0000-0000','070-0000-0000','０１０－００００－００００','010\u20130000\u20130000','010\u200b0000\u200b0000'];
for(const p of phones)check(`phone detected: ${JSON.stringify(p)}`,()=>{assert.equal(kinds(`문의 ${p} 로 연락`),'phone');assert.equal(masked(`문의 ${p} 로 연락`),'문의 [전화번호] 로 연락')});
// 2) 이메일(전각 @ 포함).
check('email detected and masked',()=>assert.equal(masked('담당 synthetic.user@example.com 으로'),'담당 [이메일] 으로'));
check('full-width email is normalized before matching',()=>assert.equal(masked('synthetic＠example．com'),'[이메일]'));
// 3) 주소: DP-9 입력(도로명·지번·동호수)과 변형.
const addresses={'가상로 12':'[주소]','가상대로 1200':'[주소]','가상로12번길 34':'[주소]','가상동 123-4':'[주소]','가상리 55-1번지':'[주소]','101동 1203호':'[주소]','B동 201호':'[주소]','이문2동 12-3':'[주소]'};
for(const [text,out] of Object.entries(addresses))check(`address masked: ${text}`,()=>{assert.equal(kinds(text),'address');assert.equal(masked(`매장은 ${text} 입니다`),`매장은 ${out} 입니다`)});
check('full address keeps region words and masks the detailed parts',()=>assert.equal(masked('가상시 가상구 가상로 12, 101동 1203호'),'가상시 가상구 [주소], [주소]'));
// 4) 결제정보: 카드(13~19자리, CARD와 같은 구분자 규칙)·은행명+계좌.
check('card number masked',()=>assert.equal(masked('카드 0000-0000-0000-0000 결제'),'카드 [결제정보] 결제'));
check('19-digit card masked',()=>assert.equal(kinds('0000000000000000000'),'payment'));
check('bank account masked with its bank name',()=>assert.equal(masked('입금 가상은행 000-000000-00-000 으로'),'입금 [결제정보] 으로'));
check('account keyword without bank name is masked',()=>assert.equal(masked('계좌번호: 000-00-0000000'),'[결제정보]'));
check('short digit groups after a bank name are not an account',()=>assert.equal(kinds('가상은행 12-34'),''));
// 5) 고유식별번호: 주민등록·외국인등록 형식, 운전면허, 여권 후보.
check('resident registration format masked',()=>assert.equal(masked('번호 000101-3000000 확인'),'번호 [고유식별번호] 확인'));
check('foreigner registration format (7th digit 5-8) masked',()=>assert.equal(kinds('000101-5000000'),'national_id'));
check('driver license format masked',()=>assert.equal(kinds('면허 00-00-000000-00'),'national_id'));
check('passport candidate formats masked',()=>{assert.equal(kinds('여권 M00000000'),'national_id');assert.equal(kinds('여권 M000A0000'),'national_id')});
// 6) 고객식별자: 64자리 16진 해시(orderRefs 형식).
const hash='ab'.repeat(32);
check('64-hex hash masked as customer identifier',()=>assert.equal(masked(`ref ${hash} 끝`),'ref [고객식별자] 끝'));
check('shorter hex (12-char prompt version) is not a customer identifier',()=>assert.equal(kinds('role-cmo@0123456789ab'),''));

// 7) 오탐 억제: 날짜·시각·가격·버전·퍼센트·캠페인 KPI 수치는 가리지 않는다(원문 그대로).
const negatives=['2026-09-24','2026.09.24','2026/09/24','14:30','14:30:00','2026-09-24T14:30:00+09:00','2026-09-24 14:30','12,000원','1,200,000원','예산 500,000원','2026-09-23.3','v2.3.1','12.5%','30%','전환율 3.2%','주문 120건','도달 15,000명','CTR 1.8%','ROAS 320%','객단가 12,000원','첫 포장 주문 30건/주','기준 기간 2026-09-01~2026-09-30','재방문율로 20 이상','목표는 재방문율로 20.','기준으로 3','최대로 30, 최소로 10','무료로 100개','추가로 2 종','고객 행동 3','리뷰 관리 2','조리 5','3호점','2호선','D-7','1+1','주 2회로 3','utm_campaign=open_2026','가상분식 가상동 오픈 캠페인','KPI: 쿠폰 회수율 = 회수 카드 수 / 포장 주문 수','1588-0000'];
for(const text of negatives)check(`not masked: ${text}`,()=>{const r=maskText(text);assert.equal(r.text,text);assert.deepEqual(plain(r.findings),[])});

// 8) 허용 목록: 원문과 정확히 같은 부분(정규화 후)만 가리지 않는다.
const allow=['가상동 12 B동 201호','02-000-0000'];
check('allowed store address and business phone stay verbatim',()=>assert.equal(masked('오픈 매장 가상동 12 B동 201호, 문의 02-000-0000',{allow}),'오픈 매장 가상동 12 B동 201호, 문의 02-000-0000'));
check('a different address next to an allowed one is still masked',()=>assert.equal(masked('가상동 12 B동 201호 옆 가상동 123-4',{allow}),'가상동 12 B동 201호 옆 [주소]'));
check('allow protects only the exact text, not a longer address that starts with it',()=>assert.equal(masked('가상로 123 과 가상로 12',{allow:['가상로 12']}),'[주소] 과 가상로 12'));
check('allow entries shorter than 4 characters are ignored',()=>assert.equal(masked('010-0000-0000',{allow:['010']}),'[전화번호]'));
check('full-width variant of an allowed value is still allowed',()=>assert.equal(masked('문의 ０２－０００－００００',{allow}),'문의 ０２－０００－００００'));

// 9) 탐지 0이면 원문 그대로, 여러 종류는 종류별 건수만 돌려준다(값 없음).
const mixed='전화 010-0000-0000, 010-1111-0000 메일 synthetic.user@example.com 주소 가상로 12';
check('no detection returns the same string',()=>{const t='합성 문장: 첫 방문 고객 30명';assert.equal(maskText(t).text,t)});
check('findings are kind counts only',()=>assert.deepEqual(plain(scanText(mixed)),[{kind:'phone',count:2},{kind:'email',count:1},{kind:'address',count:1}]));
check('findings never carry the detected values',()=>{const s=JSON.stringify([scanText(mixed),maskText(mixed).findings]);for(const v of ['0000','1111','synthetic','example','가상로'])assert.ok(!s.includes(v))});
check('masked text has no detected value left',()=>{const t=maskText(mixed).text;assert.ok(!/\d{4}/.test(t)&&!t.includes('@')&&!t.includes('가상로'),t)});

// 10) maskFields: 지정 경로의 문자열만 가리고, 새 객체를 돌려주며, 키 순서를 지킨다.
const input={a:1,campaign:{title:'오픈',goal:'문의 010-0000-0000',plan:{owner:'',tracking:'메일 synthetic.user@example.com'}},previous:[{content:'가상로 12'},{content:'없음'}],untouched:'010-0000-0000'};
const before=JSON.stringify(input);
const r=maskFields(input,['campaign.goal','campaign.plan.*','previous.*.content','missing.path','campaign.missing']);
check('maskFields masks only the listed paths',()=>{assert.equal(r.value.campaign.goal,'문의 [전화번호]');assert.equal(r.value.campaign.plan.tracking,'메일 [이메일]');assert.equal(r.value.previous[0].content,'[주소]');assert.equal(r.value.untouched,'010-0000-0000')});
check('maskFields does not mutate the input',()=>assert.equal(JSON.stringify(input),before));
check('maskFields keeps key order and never adds missing keys',()=>{assert.deepEqual(plain(Object.keys(r.value)),Object.keys(input));assert.deepEqual(plain(Object.keys(r.value.campaign)),['title','goal','plan']);assert.ok(!('missing' in r.value)&&!('missing' in r.value.campaign))});
check('maskFields reports field, kind and count per concrete path',()=>assert.deepEqual(plain(r.findings),[{field:'campaign.goal',kind:'phone',count:1},{field:'campaign.plan.tracking',kind:'email',count:1},{field:'previous.0.content',kind:'address',count:1}]));
check('maskFields without detection serializes byte-identically',()=>{const clean={x:{y:'없음',z:[1,'둘']}};assert.equal(JSON.stringify(maskFields(clean,['x.y','x.z.*']).value),JSON.stringify(clean))});
check('maskFields applies the allow list',()=>assert.deepEqual(plain(maskFields({s:'문의 02-000-0000'},['s'],{allow}).findings),[]));

// 11) 전송 차단(fail-closed, B3-2 Reflector용 옵션): 탐지되면 던지고 오류 문구·필드에 값이 없다.
check('failClosed maskText throws without the value',()=>assert.throws(()=>maskText('문의 010-0000-0000',{failClosed:true}),e=>e instanceof PiiBlockedError&&!e.message.includes('0000')&&e.findings[0].kind==='phone'));
check('failClosed maskFields throws with field and kind only',()=>assert.throws(()=>maskFields(input,['campaign.goal','previous.*.content'],{failClosed:true}),e=>e instanceof PiiBlockedError&&/campaign\.goal/.test(e.message)&&/전화번호/.test(e.message)&&!/0000|가상로/.test(e.message+JSON.stringify(e.findings))));
check('failClosed passes clean input through',()=>assert.equal(maskText('합성 문장',{failClosed:true}).text,'합성 문장'));
check('field paths from object keys are sanitized',()=>assert.deepEqual(plain(maskFields({m:{'010-0000-0000':'010-0000-0000'}},['m.*']).findings),[{field:'m.?',kind:'phone',count:1}]));

// 12) 보조: 사업장 연락처 추출(허용 목록용)·결과 합치기.
check('contactAllowValues returns business phone and email substrings',()=>assert.deepEqual(plain(contactAllowValues(['주차 가능, 문의 02-000-0000',null,'메일 store@example.com'])),['02-000-0000','store@example.com']));
check('mergeFindings adds counts per field and kind',()=>assert.deepEqual(plain(mergeFindings([{field:'a',kind:'phone',count:1}],[{field:'a',kind:'phone',count:2},{field:'b',kind:'email',count:1}])),[{field:'a',kind:'phone',count:3},{field:'b',kind:'email',count:1}]));

// 13) 주문 가져오기(lib/order-import.ts PHONE·CARD)가 거부하는 값은 여기서도 모두 탐지한다(상위 집합).
for(const v of ['010-0000-0000','+82 10 0000 0000','0000 0000 0000 0000','0000-0000-0000-0'])check(`order-import rejection is also detected: ${v}`,()=>{const k=orders.personalDataKind(v);assert.ok(k);assert.ok(scanText(v).some(f=>f.kind===(k==='phone'?'phone':'payment')))});
console.log(JSON.stringify({passed:passed.length}));
