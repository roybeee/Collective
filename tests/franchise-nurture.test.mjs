// 트랙 R R9a 정보성 너처링 순수 모듈(lib/franchise-nurture.ts) 회귀. 사례 번호 NU-*는 R9a PR 본문 수용 기준과 같다.
// 확인: 구문 경계·발송 코드 0줄(NU-S), 목적·분류·매체(NU-P), 템플릿 구조(NU-T), R2 판정(NU-J), 모델 제출 조립 허용 입력(NU-D, DP-10), 출력 읽기(NU-O), 정보 요청·수동 발송 기록(NU-L), 사유 코드(NU-C).
// 근거: mocked(순수 함수, 합성 입력, 외부 호출 0회). 분류는 LR-2(Q8) 회신 전 COLLECTIVE 해석이다. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const nu=await rt.load('lib/franchise-nurture.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
const NOW='2026-10-10T09:00:00+09:00';
const CTX={enabled:true,brandId:'b1',now:NOW,facts:[],versions:[]};
const INFO={purpose:'requested_material',medium:'email',subject:'{브랜드} 창업 안내 자료',body:'{이름}님, 요청하신 창업 안내 자료를 보내 드립니다.\n궁금한 점은 {담당자}에게 {문의처}로 물어봐 주세요.'};
const AD={purpose:'briefing_invite',medium:'sms',subject:null,body:'(광고) {브랜드}\n{이름}님, 이번 달 창업 설명회에 초대합니다.\n무료 수신거부: {수신거부}'};
const S=x=>plain(nu.templateStructure(nu.templateInput(x)));

// ════ NU-S 구문 경계·발송 코드 0줄 ════
const CODE=readFileSync('lib/franchise-nurture.ts','utf8');
const imports=[...CODE.matchAll(/from '\.\/([^']+)'/g)].map(m=>m[1]).sort();
check('NU-S1 imports only pure modules',same(imports,['brand-facts','franchise-compliance','franchise-facts','franchise-gates','franchise-rules','pii-scan']));
check('NU-S2 no clock, randomness, storage, network or send API',!/Date\.now|new Date\(|Math\.random|database\(|listRecords|fetch\(|https?:\/\/|sendMessage|alimtalk\.|kakao|twilio|nodemailer|smtp/i.test(CODE.replace(/'alimtalk'|alimtalk:|알림톡/g,'')));
check('NU-S3 no lead, contact, pseudonym or system-code field names reach the submission builder',!/leadId|systemCode|contact|phone|email\s*:|pseudonym|franchise-server|franchise-crypto|from '\.\/franchise'/.test(CODE.slice(CODE.indexOf('// ── 모델 제출 조립'),CODE.indexOf('// ── 정보 요청'))));

// ════ NU-P 목적·분류·매체 ════
check('NU-P1 seven purposes, three informational and four advertising',nu.PURPOSES.length===7&&same(nu.INFO_PURPOSES,['requested_material','disclosure_guide','process_guide'])&&['briefing_invite','benefit','recontact','newsletter'].every(p=>nu.classificationOf(p)==='advertising'));
check('NU-P2 classifications, media and the interpretation note',same(nu.CLASSIFICATIONS,['advertising','info_requested'])&&same(nu.MEDIA,['alimtalk','email','sms'])&&nu.CLASSIFICATION_NOTE==='COLLECTIVE 해석 · 법률 자문 아님'&&nu.NURTURE_DISCLAIMER==='COLLECTIVE 휴리스틱 · 법률 자문 아님');

// ════ NU-T 템플릿 구조 ════
check('NU-T1 a good informational email and a good advertising sms have no structure codes',same(S(INFO),[])&&same(S(AD),[]));
check('NU-T2 advertising needs (광고) first, the sender placeholder and the free opt-out line',same(S({...AD,body:'{브랜드} 설명회 초대\n무료 수신거부: {수신거부}'}),['ad_label_missing'])&&same(S({...AD,body:'(광고) 설명회 초대\n무료 수신거부: {수신거부}'}),['ad_sender_missing'])&&same(S({...AD,body:'(광고) {브랜드}\n설명회 초대'}),['ad_optout_missing']));
check('NU-T3 variant ad labels are rejected',['(광/고) {브랜드}','[광고] {브랜드}','(AD) {브랜드}','(광 고) {브랜드}'].every(first=>S({...AD,body:first+'\n초대\n무료 수신거부: {수신거부}'}).includes('ad_label_variant')));
check('NU-T4 an informational template cannot carry an ad label',same(S({...INFO,body:'(광고) {브랜드} 안내'}),['ad_label_variant']));
check('NU-T5 advertising on alimtalk is rejected',S({...AD,medium:'alimtalk'}).includes('alimtalk_advertising'));
check('NU-T6 only the fixed placeholders and no stray braces',same(S({...INFO,body:'{고객명}님 안녕하세요'}),['unknown_placeholder'])&&same(S({...INFO,body:'{이름}님 {안녕'}),['unknown_placeholder']));
check('NU-T7 phone numbers, emails and long digit runs are personal data',same(S({...INFO,body:'{이름}님 010-0000-0101로 연락 주세요'}),['personal_data'])&&same(S({...INFO,body:'lead.one@example.com 으로 보내 주세요'}),['personal_data'])&&same(S({...INFO,body:'코드 1234567 확인'}),['personal_data']));
check('NU-T8 format: empty body, too long, too many lines, subject outside email',same(S({...INFO,body:'  '}),['invalid_template'])&&same(S({...INFO,body:'가'.repeat(1001)}),['invalid_template'])&&same(S({...INFO,body:Array(31).fill('가').join('\n')}),['invalid_template'])&&same(S({...INFO,medium:'sms'}),['invalid_template'])&&same(S({...INFO,subject:'가'.repeat(61)}),['invalid_template']));
check('NU-T9 control characters are rejected',same(S({...INFO,body:'안내\u0007'}),['invalid_template']));
check('NU-T10 bad input shapes are null',[null,{},{...INFO,purpose:'x'},{...INFO,medium:'fax'},{...INFO,body:3},{...INFO,subject:5}].every(x=>nu.templateInput(x)===null));

// ════ NU-J 판정 ════
const J=(x,ctx=CTX)=>plain(nu.templateDecision(x,ctx));
const ok=J(INFO);
check('NU-J1 a good template passes with its classification',ok.ok&&ok.value.classification==='info_requested'&&J(AD).ok&&J(AD).value.classification==='advertising');
const hb=J({...INFO,body:'{이름}님, 월 순수익 500만원을 보장합니다.'});
check('NU-J2 a revenue guarantee is hard_block 409 with the judgement',!hb.ok&&hb.status===409&&same(hb.reasons,['hard_block'])&&hb.judgement.hardBlocked===true);
const wait=J({...INFO,body:'{이름}님, 정보공개서 받은 당일 바로 계약하실 수 있습니다.'});
check('NU-J3 a wait-bypass sentence is hard_block',!wait.ok&&wait.reasons.includes('hard_block'));
check('NU-J4 switch off is 409 and structure codes come before the judge (400)',same(J(INFO,{...CTX,enabled:false}).reasons,['switch_off'])&&J({...INFO,body:'{고객} 월 순수익 보장'}).status===400);

// ════ NU-D 모델 제출 조립 ════
const BRAND={name:'가상 도넛',category:'베이커리',description:'매일 굽는 우유 도넛',tone:'다정하게',leadName:'김가상',phone:'010-0000-0101',systemCode:'L1234567'};
const req=plain(nu.draftRequest('process_guide','email',BRAND,['총 창업비용 · 소형 매장: 4,500만원','대표 010-0000-0101',42,'가맹점 수: 12개']));
check('NU-D1 the draft request keeps only brand name, category, description, tone and clean fact lines',same(Object.keys(req.brand),['name','category','description','tone'])&&same(req.factLines,['총 창업비용 · 소형 매장: 4,500만원','가맹점 수: 12개']));
const sub=nu.nurtureSubmission(req),parsed=JSON.parse(sub.input);
check('NU-D2 the submission input has exactly the allowed keys',same(Object.keys(parsed),['purpose','classification','medium','brand','facts'])&&parsed.classification==='info_requested');
check('NU-D3 no lead-like token reaches instructions or input',['김가상','010-0000-0101','L1234567','leadName','systemCode'].every(t=>!sub.instructions.includes(t)&&!sub.input.includes(t)));
check('NU-D4 brand fields with personal data are dropped, a missing name is null, advertising on alimtalk is null',nu.draftRequest('process_guide','sms',{...BRAND,description:'문의 010-0000-0101'},[]).brand.description===''&&nu.draftRequest('process_guide','sms',{category:'x'},[])===null&&nu.draftRequest('benefit','alimtalk',BRAND,[])===null);
check('NU-D5 the instructions carry placeholders, the no-revenue rule and the ad fixed lines only for advertising',sub.instructions.includes('{이름}')&&sub.instructions.includes('수익 수치는 쓰지 않습니다')&&!sub.instructions.includes("'(광고) {브랜드}'")&&nu.nurtureSubmission(plain(nu.draftRequest('benefit','sms',BRAND,[]))).instructions.includes("'(광고) {브랜드}'"));
check('NU-D6 fact lines are capped at twelve',nu.draftRequest('process_guide','email',BRAND,Array.from({length:20},(_,i)=>'사실 '+i)).factLines.length===12);

// ════ NU-O 출력 읽기 ════
check('NU-O1 reads the first JSON object and trims',same(nu.parseNurtureOutput('설명\n{"subject":" 제목 ","body":" 본문\\r\\n둘째 "}\n끝','email'),{subject:'제목',body:'본문\n둘째'}));
check('NU-O2 sms ignores the subject',same(nu.parseNurtureOutput('{"subject":"x","body":"본문"}','sms'),{subject:null,body:'본문'}));
check('NU-O3 broken or empty output is null (no partial body)',[null,'','본문만','{"body":""}','{"body":3}','{bad json}','x'.repeat(20001)].every(t=>nu.parseNurtureOutput(t,'email')===null));

// ════ NU-L 정보 요청·발송 기록 ════
const R1={id:'rq-1',purpose:'requested_material',at:NOW,by:'u1'};
const IR=(input,x={})=>plain(nu.infoRequestDecision(input,{enabled:true,now:NOW,id:'rq-2',by:'u1',requests:[],...x}));
check('NU-L1 an info request takes only an informational purpose',IR({purpose:'process_guide'}).ok&&same(IR({purpose:'benefit'}).reasons,['invalid_input'])&&same(IR({purpose:'process_guide'},{requests:Array(50).fill(R1)}).reasons,['limit'])&&same(IR({purpose:'process_guide'},{enabled:false}).reasons,['switch_off']));
const T1={id:'nt-1',version:2,...INFO},T_AD={id:'nt-2',version:1,...AD};
const L=(input,x={})=>plain(nu.messageLogDecision(input,{enabled:true,now:NOW,id:'ml-1',by:'u1',template:T1,contactPresent:true,requests:[R1],logs:[],brandId:'b1',facts:[],versions:[],...x}));
const good=L({medium:'email',requestId:'rq-1'});
check('NU-L2 a log links template version, classification, medium and the request',good.ok&&same(good.value,{id:'ml-1',templateId:'nt-1',templateVersion:2,classification:'info_requested',medium:'email',requestId:'rq-1',at:NOW,by:'u1'}));
check('NU-L3 advertising logs are 409 before R9b',same(L({medium:'sms'},{template:T_AD}).reasons,['advertising_before_r9b'])&&L({medium:'sms'},{template:T_AD}).status===409);
check('NU-L4 medium mismatch, missing and used requests',same(L({medium:'sms',requestId:'rq-1'}).reasons,['medium_mismatch'])&&same(L({medium:'email'}).reasons,['request_missing'])&&same(L({medium:'email',requestId:'rq-9'}).reasons,['request_missing'])&&same(L({medium:'email',requestId:'rq-1'},{logs:[{...good.value,id:'ml-0'}]}).reasons,['request_used']));
check('NU-L5 no contact is 409 and a template that is blocked now is 409',same(L({medium:'email',requestId:'rq-1'},{contactPresent:false}).reasons,['contact_unavailable'])&&same(L({medium:'email',requestId:'rq-1'},{template:{...T1,body:'월 순수익 500만원 보장'}}).reasons,['template_blocked']));
check('NU-L6 switch off, no template and log limit',same(L({medium:'email',requestId:'rq-1'},{enabled:false}).reasons,['switch_off'])&&same(L({medium:'email',requestId:'rq-1'},{template:null}).reasons,['invalid_input'])&&same(L({medium:'email',requestId:'rq-1'},{logs:Array.from({length:200},(_,i)=>({...good.value,id:'x'+i,requestId:'o'+i}))}).reasons,['limit']));

// ════ NU-C 사유 코드 ════
check('NU-C1 codes are sorted, each has a status and a message',same([...nu.NURTURE_CODES].sort(),plain(nu.NURTURE_CODES))&&nu.NURTURE_CODES.every(c=>[400,409].includes(nu.NURTURE_CODE_STATUS[c])&&typeof nu.NURTURE_MESSAGES[c]==='string'&&nu.NURTURE_MESSAGES[c].length>5)&&Object.keys(nu.NURTURE_CODE_STATUS).length===nu.NURTURE_CODES.length);
check('NU-C2 failures carry one status for sorted unique reasons',(r=>!r.ok&&r.status===400&&same(r.reasons,[...new Set(r.reasons)].sort()))(J({...AD,body:'(광/고) 안내'})));
check('NU-C3 exported lists are frozen',Object.isFrozen(nu.PURPOSES)&&Object.isFrozen(nu.NURTURE_CODES)&&Object.isFrozen(nu.PLACEHOLDERS)&&Object.isFrozen(nu.LIMITS));
check('NU-C4 no fetch was called',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length}));
