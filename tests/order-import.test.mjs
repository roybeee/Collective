// A4 주문 CSV 가져오기(순수 모듈) 회귀: CSV 파서·열 매핑·검증·중복·개인정보 거부·상한.
// 근거: mocked(외부 호출 0회). 오늘 날짜는 인자로 고정한다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const oi=await rt.load('lib/order-import.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const refused=(fn,pattern)=>{try{fn()}catch(e){return e instanceof oi.ImportError&&(!pattern||pattern.test(e.message))}return false};

// 1) CSV 파서: 따옴표·쉼표·BOM·CRLF
const csv=plain(oi.parseCsv('﻿ 주문번호 ,금액,메모\r\n"A-1","12,000","say ""hi"""\r\nA-2,500,\r\n\r\n'));
check('BOM is stripped and headers are trimmed',csv.headers.join('|')==='주문번호|금액|메모');
check('quoted commas and escaped quotes survive',csv.rows[0][1]==='12,000'&&csv.rows[0][2]==='say "hi"');
check('CRLF and blank lines are handled',csv.rows.length===2&&csv.rows[1][0]==='A-2'&&csv.rows[1][2]==='');
check('quoted line breaks stay in the cell',plain(oi.parseCsv('a,b\n"x\ny",z')).rows[0][0]==='x\ny');
check('trailing empty cells beyond the header are allowed',plain(oi.parseCsv('a,b\n1,2,,\n')).rows[0].length===2);
check('unterminated quote is refused',refused(()=>oi.parseCsv('a,b\n"1,2\n')));
check('text after a closing quote is refused',refused(()=>oi.parseCsv('a,b\n"1"x,2\n')));
check('a row with too few cells is refused with its line',refused(()=>oi.parseCsv('a,b\n1\n'),/2행/));
check('a row with extra non-empty cells is refused',refused(()=>oi.parseCsv('a,b\n1,2,3\n')));
check('duplicate header names are refused',refused(()=>oi.parseCsv('a,a\n1,2\n')));
check('a file without data rows is refused',refused(()=>oi.parseCsv('a,b\n'))&&refused(()=>oi.parseCsv('')));
check('file size is measured in UTF-8 bytes',refused(()=>oi.parseCsv('a\n'+'가'.repeat(oi.IMPORT_LIMITS.maxBytes/3+1)),/KB/));
check('row count is capped',refused(()=>oi.parseCsv('a\n'+'1\n'.repeat(oi.IMPORT_LIMITS.maxRows+1)),/행/)&&plain(oi.parseCsv('a\n'+'1\n'.repeat(oi.IMPORT_LIMITS.maxRows))).rows.length===oi.IMPORT_LIMITS.maxRows);

// 2) 열 매핑
const headers=['주문번호','주문일시','결제금액','할인금액','쿠폰코드','주문채널','회원번호'];
check('mapping is suggested from common POS headers',JSON.stringify(plain(oi.suggestMapping(headers)))===JSON.stringify({orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',discount:'할인금액',code:'쿠폰코드',channel:'주문채널',customerId:'회원번호'}));
check('suggestion never maps one header twice',Object.keys(plain(oi.suggestMapping(['금액']))).length===1);
check('required fields must be mapped',refused(()=>oi.checkMapping(headers,{orderNumber:'주문번호',amount:'결제금액'}),/주문 일시/));
check('mapped header must exist',refused(()=>oi.checkMapping(headers,{orderNumber:'주문번호',orderedAt:'주문일시',amount:'없는열'})));
check('one header cannot serve two fields',refused(()=>oi.checkMapping(headers,{orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',discount:'결제금액'})));
check('unknown mapping keys are refused',refused(()=>oi.checkMapping(headers,{orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',phone:'회원번호'}))&&refused(()=>oi.checkMapping(headers,null)));

// 3) 행 검증과 변환
const today='2026-09-24';
const mapping={orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',discount:'할인금액',code:'쿠폰코드',channel:'주문채널',customerId:'회원번호'};
const file=rows=>headers.join(',')+'\n'+rows.join('\n')+'\n';
const ok=plain(oi.prepareImport(file([
 'A1,2026-09-20 13:05,"12,000원",1000,AB23,배달의민족,member-777',
 'A2,2026/9/3,500,,,포장,',
 'A3,2026.09.21.,0,0,,,',
 'A4,2026-09-20T23:30:00Z,300,0,,쿠팡이츠,',
 'A1,2026-09-21 09:00,700,0,,,',
 'A5,2026-09-22,100,0,,카카오 선물,',
]),mapping,today));
check('valid rows are read without errors',ok.errors.length===0&&ok.rows.length===6);
check('local date and time keeps the calendar date',ok.rows[0].orderDate==='2026-09-20'&&ok.rows[1].orderDate==='2026-09-03'&&ok.rows[2].orderDate==='2026-09-21');
check('a UTC timestamp is converted to the Korean date',ok.rows[3].orderDate==='2026-09-21');
check('amounts accept thousands separators and the won sign',ok.rows[0].amount===12000&&ok.rows[0].discount===1000&&ok.rows[1].discount===0);
check('delivery apps map to their source and delivery mode',ok.rows[0].source==='baemin'&&ok.rows[0].mode==='delivery'&&ok.rows[3].source==='coupang');
check('pickup text maps to POS pickup and blanks to POS hall',ok.rows[1].source==='pos'&&ok.rows[1].mode==='pickup'&&ok.rows[2].source==='pos'&&ok.rows[2].mode==='hall'&&ok.rows[5].source==='other');
check('the same order number on another date is not a duplicate',ok.rows[4].orderNumber==='A1');
check('code cell is kept for matching',ok.rows[0].codeCell==='AB23');
check('customer IDs are counted but never returned',ok.identifiableOrders===1&&!JSON.stringify(ok).includes('member-777'));
const bad=plain(oi.prepareImport(file([
 'B1,2026-09-20,-500,0,,,',
 'B2,2026-09-25,100,0,,,',
 'B3,2026-02-30,100,0,,,',
 'B4,2026-09-20,100,-1,,,',
 'B5,어제,100,0,,,',
 'B6,2026-09-20,abc,0,,,',
 'B7,2026-09-20,(500),0,,,',
 ',2026-09-20,100,0,,,',
 'B8,2026-09-20,100,0,,,',
 'B8,2026-09-20 18:00,100,0,,,',
]),mapping,today));
const lines=m=>bad.errors.filter(e=>m.test(e.message)).map(e=>e.line);
check('negative amounts are row errors',lines(/음수/).includes(2)&&lines(/음수/).includes(8)&&lines(/할인/).includes(5));
check('future dates are row errors',lines(/미래/).join()==='3');
check('impossible and unreadable dates are row errors',lines(/일시/).includes(4)&&lines(/일시/).includes(6));
check('non-numeric amounts are row errors',lines(/금액/).includes(7));
check('missing order number is a row error',lines(/주문번호/).includes(9));
check('a repeated order number on the same date is a row error',lines(/반복/).join()==='11');
check('valid rows survive next to invalid ones',bad.rows.map(r=>r.orderNumber).join()==='B8');
const flagged=plain(oi.prepareImport('주문번호,일시,금액,신규\nN1,2026-09-20,1,Y\nN2,2026-09-20,1,기존\nN3,2026-09-20,1,\nN4,2026-09-20,1,아마도\n',{orderNumber:'주문번호',orderedAt:'일시',amount:'금액',newCustomer:'신규'},today));
check('new-customer flags are read when mapped',flagged.rows[0].newCustomer===true&&flagged.rows[1].newCustomer===false&&!('newCustomer' in flagged.rows[2])&&flagged.errors.length===1&&flagged.errors[0].line===5);

// 4) 개인정보: 카드번호(13~19자리 숫자열)·휴대폰 번호 패턴이 보이면 파일 전체를 거부한다. 값은 메시지에 싣지 않는다.
const base={orderNumber:'주문번호',orderedAt:'일시',amount:'금액'};
const pii=(extra,value)=>{try{oi.prepareImport(`주문번호,일시,금액,${extra}\nP1,2026-09-20,100,${value}\n`,base,today)}catch(e){return e instanceof oi.ImportError&&e.message.includes(extra)&&!e.message.includes(value)?e.message:''}return ''};
check('a phone number column is refused',/휴대폰/.test(pii('연락처','010-1234-5678'))&&/휴대폰/.test(pii('메모','01012345678'))&&/휴대폰/.test(pii('비고','+82 10 1234 5678')));
check('a card number column is refused',/카드/.test(pii('결제수단','4111 1111 1111 1111'))&&/카드/.test(pii('승인','4111-1111-1111-1111'))&&/카드/.test(pii('참조','1234567890123')));
check('a phone number used as customer ID is refused',/휴대폰/.test(pii('고객ID','010-9876-5432')));
check('masked and short numbers are allowed',!pii('연락처','010-****-5678')&&!pii('사업자','123-45-67890')&&!pii('승인번호','12345678'));
check('long POS order numbers are not mistaken for cards',plain(oi.prepareImport('주문번호,일시,금액\n2026092412345678,2026-09-20,100\n',base,today)).rows.length===1);
// 주문번호 열은 카드번호 검사에서만 빠진다. 전화번호를 주문번호로 매핑해도 휴대폰 번호는 거부한다(값은 메시지에 싣지 않는다).
const orderNumberPii=value=>{try{oi.prepareImport(`주문번호,일시,금액\n${value},2026-09-20,100\n`,base,today)}catch(e){return e instanceof oi.ImportError&&!e.message.includes(value)?e.message:''}return ''};
check('a phone number in the order number column is refused',/휴대폰/.test(orderNumberPii('010-1234-5678'))&&/휴대폰/.test(orderNumberPii('01098765432')));
check('date-style POS order numbers are not phone numbers',plain(oi.prepareImport('주문번호,일시,금액\n20260924-0001,2026-09-20,100\n',base,today)).rows.length===1);

// 5) 행 번호는 파일의 실제 줄 번호다(빈 줄·인용 안 줄바꿈을 센다).
const gap=plain(oi.prepareImport('주문번호,일시,금액\n\n\nG1,2026-09-20,-1\n',base,today));
check('row errors use the physical line after blank lines',gap.errors.length===1&&gap.errors[0].line===4);
const quotedGap=plain(oi.prepareImport('주문번호,일시,금액,메모\nQ1,2026-09-20,100,"두 줄\n메모"\nQ2,2026-09-20,-1,\n',base,today));
check('row errors use the physical line after a quoted line break',quotedGap.rows[0].line===2&&quotedGap.errors[0].line===4);
check('structure errors use the physical line too',refused(()=>oi.parseCsv('a,b\n\n1\n'),/3행/)&&refused(()=>oi.parseCsv('a,b\r\n\r\n1\r\n'),/3행/));

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
