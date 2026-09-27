// R5a 리드 CSV 해독·검사·정규화 순수 모듈(lib/franchise-lead-import.ts) 회귀. 명세 6.2의 R5a 사례 LI-(LI-B 제외, R5b-2)를 사례 번호 이름으로 둔다.
// 확인: 구문 import 경계(LI-S1), 해독·인코딩·전송(LI-E), 구조·한도(LI-F), 파일 검사와 브라우저 사전 검사(LI-A), 개인정보 거부 위치(LI-P), 매핑·민감 열 이름(LI-M), 시각 문법·범위·지역·구간(LI-R),
// 제공 증빙·기간(LI-V), 건너뜀(LI-K), 파일 해시·계획 해시·확인 값(LI-H). 근거: mocked(순수 함수, 합성 값, 가상 CP949·UTF-16 고정 바이트, 외부 호출 0회). 전화·이메일·주민번호 값은 모두 가상 형식이다.
// R5b-2(결정 32 B안): 매핑한 이름·전화·이메일 열(LI-C), 수집 근거(LI-B), 교차 파일·파일 안 연락처 병합(LI-X, 대표 결정 '리드 1건, 집계는 파일별')을 더했다. 저장·API는 tests/lead-import-route.test.mjs가 본다. 법률 적합성은 not_run(LR-1 대상).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const li=await rt.load('lib/franchise-lead-import.ts'),rc=await rt.load('lib/franchise-recruitment.ts'),oi=await rt.load('lib/order-import.ts'),fl=await rt.load('lib/franchise.ts'),fr=await rt.load('lib/franchise-rules.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const canon=v=>Array.isArray(v)?'['+v.map(canon).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}':JSON.stringify(v);
const eqv=(a,b)=>canon(plain(a))===canon(b);
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
const asc=(a,b)=>a<b?-1:a>b?1:0;
const sha=b=>createHash('sha256').update(b).digest('hex');
const DISCLAIMER='COLLECTIVE 휴리스틱 · 법률 자문 아님';
const produced=new Set(),warned=new Set(),rowCodes=new Set();let failCount=0;
// 모든 실패 결과: 사유 정렬·중복 없음, 단계 불변식(상태 같음), 문구는 첫 사유의 고정 문구(구조 오류는 parseCsv 문구, 개인정보는 건수만 든 고정 문구), errors는 행·열·행 코드만.
const F=r=>{
 assert.equal(r?.ok,false,'실패 결과여야 합니다: '+JSON.stringify(plain(r)));
 assert.ok(Array.isArray(r.reasons)&&r.reasons.length>0);
 assert.deepEqual(plain(r.reasons),[...new Set(plain(r.reasons))].sort(asc));
 assert.ok(r.reasons.every(c=>li.LEAD_IMPORT_CODE_STATUS[c]===r.status),'상태 불변식: '+r.status+' '+r.reasons.join(','));
 const first=r.reasons[0];
 if(first==='pii_in_file'){const n=Number((/^(\d+)개 칸에서/.exec(r.message)||[])[1]);assert.equal(r.message,li.piiMessage(n))}
 else if(first!=='csv_invalid')assert.equal(r.message,li.LEAD_IMPORT_MESSAGES[first]);
 assert.ok(typeof r.message==='string'&&r.message.length>0);
 if(r.errors!==undefined){assert.ok(Array.isArray(r.errors)&&r.errors.length>0);for(const e of r.errors){assert.ok(Object.keys(e).every(k=>['row','column','code'].includes(k)));assert.ok(typeof e.column==='string');if('row' in e)assert.ok(Number.isSafeInteger(e.row));if('code' in e){assert.ok(li.LEAD_IMPORT_ROW_CODES.includes(e.code));rowCodes.add(e.code)}}}
 assert.equal(r.ruleVersion,rc.RECRUITMENT_VERSION);assert.equal(r.disclaimer,DISCLAIMER);
 failCount++;r.reasons.forEach(c=>produced.add(c));return r;
};
const is=(r,...codes)=>{F(r);return same(r.reasons,codes)};
const OK=r=>{const ok=r?.ok===true&&r.status===200&&r.ruleVersion===rc.RECRUITMENT_VERSION&&r.disclaimer===DISCLAIMER&&Array.isArray(r.warnings);if(ok)r.warnings.forEach(w=>warned.add(w));return ok};

// ════ LI-S1 구문 ════
const SRC=readFileSync('lib/franchise-lead-import.ts','utf8');
const moduleRefs=(text,file='m.ts')=>{
 const out=[],sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,false,ts.ScriptKind.TS),lit=n=>n&&(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))?n.text:'(opaque)';
 const visit=n=>{
  if(ts.isImportDeclaration(n))out.push({kind:n.importClause?.isTypeOnly?'import type':'import',spec:lit(n.moduleSpecifier),names:n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)?n.importClause.namedBindings.elements.map(e=>e.name.text):[]});
  else if(ts.isExportDeclaration(n)&&n.moduleSpecifier)out.push({kind:'export',spec:lit(n.moduleSpecifier),names:[]});
  else if(ts.isImportEqualsDeclaration(n)&&ts.isExternalModuleReference(n.moduleReference))out.push({kind:'import=',spec:lit(n.moduleReference.expression),names:[]});
  else if(ts.isImportTypeNode(n))out.push({kind:'import type()',spec:ts.isLiteralTypeNode(n.argument)?lit(n.argument.literal):'(opaque)',names:[]});
  else if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==='require')))out.push({kind:'call',spec:lit(n.arguments[0]),names:[]});
  ts.forEachChild(n,visit);
 };
 visit(sf);return out;
};
const refs=moduleRefs(SRC);
const FORBIDDEN_SPEC=s=>['./server','./feature-flags','./franchise-server','./franchise-crypto','./store-marketing','./store-attribution','./store-operations-server','./hermes','cloudflare:workers'].includes(s)||/^\.\/execution/.test(s)||s.startsWith('@/')||s.endsWith('.ts');
check('LI-S1 the module references exactly the five allowed modules, all static imports',same(refs.map(r=>r.spec).sort(asc),['./franchise','./franchise-recruitment','./franchise-rules','./order-import','./pii-scan'])&&refs.every(r=>r.kind==='import'));
check('LI-S1 the ./order-import import names are exactly parseCsv and IMPORT_LIMITS (no ImportError)',same(refs.find(r=>r.spec==='./order-import').names.sort(asc),['IMPORT_LIMITS','parseCsv']));
check('LI-S1 the ./franchise import names are only the band labels, the retention days and the three contact normalizers (R5b-2)',refs.find(r=>r.spec==='./franchise').names.every(n=>['BUDGET_LABELS','TIMING_LABELS','UNCONVERTED_RETENTION_DAYS','normalizeName','normalizePhone','normalizeEmail'].includes(n))&&same(refs.find(r=>r.spec==='./pii-scan').names,['scanText']));
check('LI-S1 no checkMapping or findPersonalData string and no forbidden module',!SRC.includes('checkMapping')&&!SRC.includes('findPersonalData')&&!refs.some(r=>FORBIDDEN_SPEC(r.spec))&&!SRC.includes('store-marketing'));
const CODE=SRC.replace(/^\s*\/\/.*$/gm,'');
check('LI-S1 no fetch, clock, randomness or environment; crypto only through subtle.digest',!/\bfetch\s*\(/.test(SRC)&&!/\bDate\.now\b|new\s+Date\s*\(\s*\)|Math\.random|\bprocess\.|globalThis/.test(CODE)&&!/\bcrypto\.(?!subtle\.digest\()/.test(CODE)&&!/\bany\b/.test(CODE)&&!/recordStatement|recruitment_(code|spend|import)\b/.test(SRC));
check("LI-S1 decoding is strict: TextDecoder('utf-8') with fatal:true",/new TextDecoder\('utf-8',\{fatal:true/.test(SRC));
check('LI-S1 byte and row limits are within IMPORT_LIMITS and maxAgeDays is UNCONVERTED_RETENTION_DAYS',li.LEAD_IMPORT_LIMITS.maxBytes<=oi.IMPORT_LIMITS.maxBytes&&li.LEAD_IMPORT_LIMITS.maxRows<=oi.IMPORT_LIMITS.maxRows&&li.LEAD_IMPORT_LIMITS.maxAgeDays===fl.UNCONVERTED_RETENTION_DAYS&&eqv(li.LEAD_IMPORT_LIMITS,{maxBytes:100000,maxBase64:133336,maxRows:100,maxCodesPerRow:5,maxErrors:50,maxPiiPositions:20,maxAgeDays:180,maxPeriodDays:180,futureToleranceMs:300000,expiringWarnDays:14}));
check('LI-S1 targets (plus the three decision 32 contact targets) and forbidden targets are the spec lists',eqv(li.LEAD_IMPORT_TARGETS,{receivedAt:'접수 시각',region:'희망 시·도·시·군·구',budgetBand:'예산 구간',timingBand:'희망 시기',codes:'모집 코드',landingUrl:'유입 주소(utm_content)',contactName:'이름(연락처)',contactPhone:'전화(연락처)',contactEmail:'이메일(연락처)'})&&same(li.FORBIDDEN_TARGETS,['name','phone','email','address','birthDate','residentId','gender','account','card','memo','message','externalId','ip']));

// ════ 공통 픽스처 ════
const OWNER={id:'u-owner',role:'owner'},ADMIN={id:'u-admin',role:'admin'},MEMBER={id:'u-member',role:'member'};
const TODAY='2026-10-10',NOW='2026-10-10T03:00:00.000Z';
const HEAD='접수일시,희망지역,창업예산,희망시기,모집코드';
const ROW1='2026-10-05 14:05,서울 강남구,5천만~1억원,3개월 안,R2345678';
const csv=(...lines)=>lines.join('\n')+'\n';
const b64=x=>Buffer.from(x).toString('base64');
const q=v=>/[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
const MAP={receivedAt:0,region:1,budgetBand:2,timingBand:3,codes:4};
const SHA=sha('가상 동의 증빙 문서');
const PROV={provider:'가상창업포털',providedOn:'2026-10-09',period:{from:'2026-09-01',to:'2026-10-08'},consentRef:{sha256:SHA,storageLabel:'본사 문서함'}};
const CODEBOOK={codes:[{code:'R2345678',brandId:'b1',channel:'portal',validFrom:'2026-09-01',createdAt:'2026-08-30T00:00:00Z',retiredOn:null,retiredAt:null,campaignId:null,assetRef:null,eventId:null},{code:'R3456789',brandId:'b1',channel:'expo',validFrom:'2026-09-01',createdAt:'2026-08-30T00:00:00Z',retiredOn:null,retiredAt:null,campaignId:null,assetRef:null,eventId:'e1'},{code:'R6789234',brandId:'b1',channel:'search_ad',validFrom:'2026-09-01',createdAt:'2026-08-30T00:00:00Z',retiredOn:null,retiredAt:null,campaignId:null,assetRef:null,eventId:null}],tracking:[{value:'R6789234',createdAt:'2026-08-01T00:00:00Z'}]};
const CTX={enabled:true,brandId:'b1',branch:'A',actor:OWNER,now:NOW,today:TODAY,storageLabels:['본사 문서함'],coveredPeriods:[],event:null,fileExists:false,book:CODEBOOK,bind:null};
const ICTX={enabled:true,brandId:'b1',branch:'A',actor:OWNER};
const IN=(text,x={})=>({csvBase64:typeof text==='string'?b64(text):Buffer.from(text).toString('base64'),channel:'portal',mapping:MAP,provenance:PROV,...x});
const dec=(text,x={},c={})=>li.leadImportDecision(IN(text,x),{...CTX,...c});
const FILE=csv(HEAD,ROW1);
const base=await dec(FILE);
check('LI baseline preview succeeds with the plan shape',OK(base)&&eqv(base.value.normalizedRows,[{line:2,receivedAt:'2026-10-05T05:05:00.000Z',receivedPrecision:'time',region:'서울 강남구',budgetBand:'50m_100m',timingBand:'within_3m',codes:['R2345678']}])&&base.value.toCreate===1&&eqv(base.value.skipped,{overlap:0,duplicateInFile:0})&&/^[0-9a-f]{64}$/.test(base.value.planSha256)&&base.value.fileSha256===sha(Buffer.from(FILE))&&base.value.ruleVersion===rc.RECRUITMENT_VERSION&&base.value.importVersion===li.LEAD_IMPORT_VERSION&&base.value.note===rc.RECRUITMENT_ATTRIBUTION_NOTE&&eqv(base.value.receivedRange,{from:'2026-10-05T05:05:00.000Z',to:'2026-10-05T05:05:00.000Z'})&&eqv(base.value.mapping,MAP)&&base.value.providerKey==='가상창업포털'&&same(base.value.headers,HEAD.split(',')));
// 명세 2.6.6: 결과의 rows는 파일의 데이터 행 수이고, 정규화한 행 목록(normalizedRows)은 서버 전용이다(R5b-2는 응답에서 뺀다).
check('LI baseline plan: rows is the data-row count and normalizedRows is the server-only list',base.value.rows===1&&Array.isArray(base.value.normalizedRows)&&base.value.normalizedRows.length===base.value.toCreate);
check('LI baseline attribution counts code attribution and the provider-file basis for code-less rows (R5b-2 2.7.3)',eqv(base.value.attribution,{code:{portal:1},unattributed:{},conflict:0,fileBasis:{}}));
const attr=await dec(csv(HEAD,ROW1,'2026-10-05 15:05,,,,','2026-10-05 16:05,,,,R6789234','2026-10-05 17:05,,,,R3456789','2026-10-05 18:05,,,,R8923456'));
check('LI attribution summary for mixed rows',OK(attr)&&eqv(attr.value.attribution,{code:{portal:1,expo:1},unattributed:{no_code:1,unknown_code:1},conflict:1,fileBasis:{portal:2}}));
const confirmIn=p=>({confirm:true,expected:{planSha256:p.value.planSha256,toCreate:p.value.toCreate}});
check('LI a confirm with the preview expectation succeeds with the same plan',eqv((await dec(FILE,confirmIn(base))).value,plain(base.value)));

// ════ LI-E 인코딩·전송 ════
// 가상 CP949 고정 바이트: '접수일시,희망지역\n2026-10-05 14:05,서울 강남구\n'을 CP949로 저장한 파일(표 계산기 'CSV(쉼표로 분리)' 기본 저장 형태).
const CP949=Buffer.from('c1a2bcf6c0cfbdc32cc8f1b8c1c1f6bfaa0a323032362d31302d30352031343a30352cbcadbfef20b0adb3b2b1b80a','hex');
check('LI-E1 fixture bytes really are CP949 for the Korean header',new TextDecoder('euc-kr').decode(CP949)==='접수일시,희망지역\n2026-10-05 14:05,서울 강남구\n');
const e1=await dec(CP949,{mapping:{receivedAt:0,region:1}});
check('LI-E1 CP949 bytes are 400 encoding_invalid with the fixed message, not a garbled header preview',is(e1,'encoding_invalid')&&e1.message==='이 파일은 UTF-8 CSV가 아닙니다. 표 계산기에서 "CSV UTF-8"로 다시 저장하거나, 화면의 "EUC-KR로 읽기"를 눌러 주세요.'&&!('headers' in e1)&&same(await li.decodeLeadCsv(new Uint8Array(CP949)),{ok:false,reason:'encoding_invalid'}));
// 가상 UTF-16 고정 바이트: '접수일시,희망지역\n'의 UTF-16LE(BOM FF FE)와 UTF-16BE(BOM FE FF).
const U16LE=Buffer.from('fffe11c818c27cc7dcc22c006cd7ddb9c0c9edc50a00','hex'),U16BE=Buffer.from('feffc811c218c77cc2dc002cd76cb9ddc9c0c5ed000a','hex');
check('LI-E2 UTF-16LE (BOM FF FE) and UTF-16BE (BOM FE FF) are 400 encoding_invalid',new TextDecoder('utf-16le').decode(U16LE.subarray(2))==='접수일시,희망지역\n'&&is(await dec(U16LE),'encoding_invalid')&&is(await dec(U16BE),'encoding_invalid')&&(await li.decodeLeadCsv(new Uint8Array(U16LE))).reason==='encoding_invalid');
check('LI-E3 UTF-8 with U+0000 or a literal U+FFFD is 400 encoding_invalid',is(await dec(csv(HEAD,ROW1+'\u0000')),'encoding_invalid')&&is(await dec(csv(HEAD,ROW1.replace('서울','서\ufffd울'))),'encoding_invalid')&&(await li.decodeLeadCsv(new Uint8Array([0x61,0xef,0xbf,0xbd]))).reason==='encoding_invalid');
const BOM=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(FILE)]),noBom=Buffer.from(FILE);
const dB=await li.decodeLeadCsv(new Uint8Array(BOM)),dN=await li.decodeLeadCsv(new Uint8Array(noBom));
const pB=await dec(BOM),pN=await dec(noBom);
check('LI-E4 BOM and no-BOM bytes: different fileSha256, each equal to the raw-byte SHA-256, same rows, hadBom true/false',dB.ok&&dN.ok&&dB.fileSha256===sha(BOM)&&dN.fileSha256===sha(noBom)&&dB.fileSha256!==dN.fileSha256&&dB.hadBom===true&&dN.hadBom===false&&dB.text===dN.text&&OK(pB)&&OK(pN)&&same(pB.value.normalizedRows,plain(pN.value.normalizedRows))&&pB.value.hadBom===true&&pB.value.fileSha256===sha(BOM)&&pB.value.planSha256!==pN.value.planSha256);
check('LI-E4 only one UTF-8 BOM is removed',(await li.decodeLeadCsv(new Uint8Array(Buffer.concat([Buffer.from([0xef,0xbb,0xbf,0xef,0xbb,0xbf]),noBom])))).text.startsWith('\ufeff'));
const TABS=new Uint8Array(100000).fill(9);TABS.set(Buffer.from('a\n'));
const reqJson=JSON.stringify({requestId:'rq-00000000-0000-4000-8000-000000000000',action:'lead_import_preview',brandId:'b1',...IN(TABS),dropInFileDuplicates:false,eventId:null});
check('LI-E5 a 100,000-byte tab-filled file travels in a request JSON under 200,000 bytes (base64 is exactly 133,336 characters)',b64(TABS).length===133336&&Buffer.byteLength(reqJson)<200000&&(await li.decodeLeadCsv(TABS)).ok===true);
const PAD=Buffer.concat([Buffer.from(FILE),Buffer.alloc(100000-Buffer.byteLength(FILE),0x0a)]);
const padI=await li.inspectLeadFile({csvBase64:b64(PAD)},{enabled:true,brandId:'b1',branch:'A',actor:OWNER}),padD=await dec(PAD);
check('LI-E5 a legitimate file of exactly 100,000 bytes (133,336 base64 characters) passes inspection and the decision',PAD.length===100000&&b64(PAD).length===133336&&OK(padI)&&padI.value.rowCount===1&&OK(padD)&&padD.value.toCreate===1&&padD.value.fileSha256===sha(PAD));
const big=new Uint8Array(100001).fill(0x61);
check('LI-E5 100,001 bytes are 400 file_too_large (the base64 fits the character cap, the byte cap still holds)',b64(big).length===133336&&is(await dec(big),'file_too_large')&&same(await li.decodeLeadCsv(big),{ok:false,reason:'file_too_large'}));
check('LI-E6 base64Bytes takes the standard alphabet only: URL-safe - and _ give null',li.base64Bytes('ab-_')===null&&li.base64Bytes('ab+/')!==null&&li.base64Bytes('YW-=')===null&&li.base64Bytes('YW_=')===null);
check('LI-E6 a character outside the base64 alphabet is 400 encoding_invalid and 133,337 characters are 400 file_too_large',is(await li.leadImportDecision({...IN(FILE),csvBase64:b64(FILE).slice(0,-4)+'ab*='},CTX),'encoding_invalid')&&is(await li.leadImportDecision({...IN(FILE),csvBase64:'A'.repeat(133337)},CTX),'file_too_large')&&is(await li.leadImportDecision({...IN(FILE),csvBase64:5},CTX),'encoding_invalid')&&li.base64Bytes('A'.repeat(133337))===null&&li.base64Bytes('abc')===null&&li.base64Bytes('a=bc')===null&&li.base64Bytes(null)===null&&same(Array.from(li.base64Bytes('YWI=')),[97,98])&&li.base64Bytes('A'.repeat(133336)).length===100002);

// ════ LI-F 파일 구조 ════
const rowsOf=n=>Array.from({length:n},(_,i)=>`2026-10-0${1+i%8} ${String(9+i%10).padStart(2,'0')}:${String(i%60).padStart(2,'0')},서울 강남구,,,`);
check('LI-F 101 data rows are 400 too_many_rows and 100 rows are accepted (R5b-2: contact keys keep one confirm batch at 402 statements)',is(await dec(csv(HEAD,...rowsOf(101))),'too_many_rows')&&(await dec(csv(HEAD,...rowsOf(100)))).value.toCreate===100&&is(await dec(csv(HEAD,...rowsOf(501))),'too_many_rows'));
const hdrOnly=await dec(csv(HEAD));
check('LI-F a header-only file says 가져올 리드 행이 없습니다. with no order wording',is(hdrOnly,'csv_invalid')&&hdrOnly.message==='가져올 리드 행이 없습니다.'&&!hdrOnly.message.includes('주문'));
const quoteErr=await dec(csv(HEAD,'2026-10-05 14:05,서울 "ZQCELLX" 강남구,,,')),colErr=await dec(csv(HEAD,ROW1,'2026-10-05 14:05,서울 강남구,,,,,x'));
check('LI-F structure errors carry only line numbers and fixed text, never cell values',is(quoteErr,'csv_invalid')&&!quoteErr.message.includes('ZQCELLX')&&is(colErr,'csv_invalid')&&colErr.message==='3행의 열 수가 머리글과 다릅니다.'&&is(await dec('   \n'),'csv_invalid'));

// ════ LI-A 파일 검사 ════
const insp=(text,x={},c={})=>li.inspectLeadFile({csvBase64:typeof text==='string'?b64(text):Buffer.from(text).toString('base64'),...x},{...ICTX,...c});
const a1=await insp(csv(HEAD+',유입URL',ROW1+',https://x.test/?utm_content=R3456789'));
check('LI-A1 inspection without mapping returns headers, row count, suggested mapping and file hash',OK(a1)&&eqv(a1.value,{fileSha256:sha(Buffer.from(csv(HEAD+',유입URL',ROW1+',https://x.test/?utm_content=R3456789'))),hadBom:false,headers:[...HEAD.split(','),'유입URL'],rowCount:1,suggestedMapping:{receivedAt:0,region:1,budgetBand:2,timingBand:3,codes:4,landingUrl:5},transcodedFrom:null})&&(await insp(FILE,{transcodedFrom:'euc-kr'})).value.transcodedFrom==='euc-kr'&&is(await insp(FILE,{transcodedFrom:'cp949'}),'invalid_input')&&is(await insp(FILE,{mapping:MAP}),'invalid_input'));
check('LI-A2 inspection by a member is 403, switch off 409, branch B 409 (rejection cases)',is(await insp(FILE,{},{actor:MEMBER}),'role_forbidden')&&is(await insp(FILE,{},{enabled:false,actor:MEMBER}),'switch_off')&&is(await insp(FILE,{},{branch:'B'}),'branch_not_a')&&OK(await insp(FILE,{},{actor:ADMIN})));
const a3=await insp(csv(HEAD+',문의내용',ROW1+',가상'));
check('LI-A3 a sensitive header (not a decision 32 contact header) returns no headers',is(a3,'sensitive_column_in_file')&&!('headers' in a3)&&!('value' in a3)&&same(a3.errors,[{column:'6번째 열'}]));
const FIXTURES=[Buffer.from(FILE),BOM,Buffer.from(csv(HEAD+',문의내용',ROW1+',가상')),Buffer.from(csv(HEAD+',추가값',ROW1+',010-0000-0101')),CP949,Buffer.from(csv(HEAD)),big,U16LE,Buffer.from(csv('접수일시,010-0000-0101','2026-10-05 14:05,1'))];
const pick=r=>r.ok?{ok:true,fileSha256:r.value.fileSha256,hadBom:r.value.hadBom,headers:r.value.headers,rowCount:r.value.rowCount,suggestedMapping:r.value.suggestedMapping}:{ok:false,status:r.status,reasons:r.reasons,message:r.message,errors:r.errors};
let a4=true;
for(const bytes of FIXTURES){
 const local=pick(plain(await li.localFileCheck(new Uint8Array(bytes)))),server=pick(plain(await insp(bytes))),full=plain(await dec(bytes));
 a4&&=eqv(local,server)&&(local.ok?full.ok:eqv(pick(full),server));
}
check('LI-A4 localFileCheck and the server inspection and decision give the same file and check results for the same bytes',a4&&FIXTURES.length===9);

// ════ LI-P 개인정보 ════
const piiFile=v=>csv(HEAD+',추가값',ROW1+','+q(v));
const piiCase=async(id,v)=>{const r=await dec(piiFile(v));return is(r,'pii_in_file')&&same(r.errors,[{row:2,column:'추가값'}])&&r.message.startsWith('1개 칸에서')&&!JSON.stringify(plain(r)).includes(v)&&li.importPiiHits(v)>0};
check('LI-P1 a phone number in an unmapped column gives the row and column name only',await piiCase('P1','010-0000-0101'));
const p1b=await dec(csv(HEAD+',추가값','',ROW1+',010-0000-0101')),p1c=await dec(csv(HEAD+',추가값',ROW1+',"가\n나"',ROW1+',010-0000-0101'));
check('LI-P1 the row is the parseCsv line: a blank line and a quoted newline earlier in the file move it',is(p1b,'pii_in_file')&&same(p1b.errors,[{row:3,column:'추가값'}])&&is(p1c,'pii_in_file')&&same(p1c.errors,[{row:4,column:'추가값'}]));
check('LI-P2 an email address is rejected',await piiCase('P2','lead.one@example.com'));
check('LI-P3 a resident registration number format is rejected',await piiCase('P3','900101-1234567'));
check('LI-P4 a passport candidate (M12345678) is rejected',await piiCase('P4','M12345678'));
check('LI-P5 a 13-digit card-like number is rejected',await piiCase('P5','1234567890123'));
const p6=await dec(csv(HEAD+',010-0000-0101 담당',ROW1+',x'));
check('LI-P6 a phone number in a header value is 400 sensitive_column_in_file shown only as the column number',is(p6,'sensitive_column_in_file')&&same(p6.errors,[{column:'6번째 열'}])&&!JSON.stringify(plain(p6)).includes('0101'));
const HS=Array.from({length:51},(_,i)=>'이름'+i),p6b=await dec(csv(HEAD+','+HS.join(','),ROW1+','+HS.map(()=>'x').join(',')));
check('LI-P6 51 sensitive headers give sensitive_column_in_file with the first 50 column numbers only',is(p6b,'sensitive_column_in_file')&&p6b.errors.length===50&&same(p6b.errors[0],{column:'6번째 열'})&&same(p6b.errors[49],{column:'55번째 열'}));
const p7=await dec(csv(HEAD+',추가값',...Array.from({length:25},(_,i)=>`2026-10-05 14:${String(10+i)},서울 강남구,,,,010-0000-0${String(100+i)}`)));
check('LI-P7 more than 20 positions give 20 positions and the full count',is(p7,'pii_in_file')&&p7.errors.length===20&&p7.message.startsWith('25개 칸에서')&&p7.errors[0].row===2&&p7.errors[19].row===21);
const VARIANTS=[['P8','0082-10-0000-0101'],['P9','1000000101'],['P10','10-0000-0101'],['P11','1.01234E+09'],['P12','9.00101E+12'],['P13','010   0000   0101'],['P14','0 1 0 0 0 0 0 0 1 0 1'],['P15','010~0000~0101'],['P16','010_0000_0101'],['P17','010,0000,0101'],['P18','٠١٠-٠٠٠٠-٠١٠١'],['P19','010-****-0101'],['P20','lead.one(at)example.com'],['P21','lead.one%40example.com'],['P22','lead.one @ example.com'],['P23','lead.one@example'],['P24','010%2D0000%2D0101'],['P25','900101-1******'],['P26','90.01.01-1234567'],['P27','900101_1234567']];
for(const [id,v] of VARIANTS)check(`LI-${id} import-only detection rejects ${JSON.stringify(v)} with position only`,await piiCase(id,v));
check('LI-P20 the [at] and 골뱅이 email variants are rejected with position only',await piiCase('P20b','lead.one[at]example.com')&&await piiCase('P20c','lead.one 골뱅이 example.com'));
check('LI-P18 a Unicode digit glued before a phone number is caught by the raw-cell scan',await piiCase('P18b','\u0660010-0000-0101'));
const splitCase=async(a,b,c)=>{const r=await dec(csv(HEAD+',값1,값2,값3',ROW1+`,${a},${b},${c}`));return is(r,'pii_in_file')&&same(r.errors,[{row:2,column:'값1'},{row:2,column:'값2'},{row:2,column:'값3'}])};
let p28b=true;for(const pre of ['011','016','017','018','019'])p28b&&=await splitCase(pre,'0000','0101');
check('LI-P28 split phone cells: every 01X prefix and a three-digit middle flag all three neighbours',p28b&&await splitCase('010','000','0101')&&await splitCase('011','000','0101'));
const p28=await dec(csv(HEAD+',값1,값2,값3',ROW1+',010,0000,0101'));
check('LI-P28 split phone cells under generic headers flag all three neighbours',is(p28,'pii_in_file')&&same(p28.errors,[{row:2,column:'값1'},{row:2,column:'값2'},{row:2,column:'값3'}])&&p28.message.startsWith('3개 칸에서')&&OK(await dec(csv(HEAD+',값1,값2,값3',ROW1+',010,0000,가'))));
const p29=await dec(csv(HEAD+',날짜,기간','2026-09-24 14:30:00,서울 강남구,5천만~1억원,,R2345678,2026.09.24,2026-09-01~2026-09-15'));
check('LI-P29 false-positive guard: a mapped receipt time, budget label, region, code, a dotted date and a date range pass',OK(p29)&&p29.value.normalizedRows[0].receivedAt==='2026-09-24T05:30:00.000Z'&&['2026-09-24 14:30:00','5천만~1억원','서울 강남구','R2345678','2026.09.24','2026-09-01~2026-09-15','R3456789, R4567892'].every(v=>li.importPiiHits(v)===0));
check('LI-P29 13 grouped digits are not a resident number when the 7th digit is 9 or 0 or the date part is not a valid YYMMDD',['900101-9234567','900101-0234567','991399-1234567','901301-1234567','900100-1234567'].every(v=>li.importPiiHits(v)===0));
const p30=await dec(csv(HEAD,'2026-10-05 14:05,서울 강남구,,,R23456789'));
check('LI-P30 the fixed message has the date and code-length hints and no per-cell kind; a nine-character code is rejected by position',is(p30,'pii_in_file')&&same(p30.errors,[{row:2,column:'모집코드'}])&&p30.message.includes('날짜는 YYYY-MM-DD HH:mm로 바꿔 주세요')&&p30.message.includes('R로 시작하는 8자')&&li.piiMessage(3)===li.LEAD_IMPORT_MESSAGES.pii_in_file.replace('{count}','3')&&p30.message===li.piiMessage(1));

// ════ LI-M 매핑·민감 열 이름 ════
const FORB=['name','phone','email','address','birthDate','residentId','gender','account','card','memo','message','externalId','ip'];
let m1=true;for(const k of FORB)m1&&=is(await dec(FILE,{mapping:{receivedAt:0,[k]:1}}),'mapping_forbidden');
check('LI-M1 every forbidden target (name, phone, resident id, memo, external id, …) is 400 mapping_forbidden',m1);
check('LI-M2 an unknown target and one column for two targets are 400 mapping_invalid',is(await dec(FILE,{mapping:{receivedAt:0,foo:1}}),'mapping_invalid')&&is(await dec(FILE,{mapping:{receivedAt:0,region:0}}),'mapping_invalid')&&is(await dec(FILE,{mapping:{receivedAt:0,phone:1,foo:2}}),'mapping_forbidden','mapping_invalid'));
check('LI-M3 a 휴대폰 header anywhere (mapped or not) is 400 sensitive_column_in_file',is(await dec(csv(HEAD+',휴대폰',ROW1+',x')),'sensitive_column_in_file')&&is(await dec(csv('휴대폰,'+HEAD,'x,'+ROW1),{mapping:{receivedAt:1}}),'sensitive_column_in_file'));
check('LI-M4 a mapping without receivedAt is 400',is(await dec(FILE,{mapping:{region:1}}),'mapping_invalid')&&is(await dec(FILE,{mapping:null}),'mapping_invalid')&&is(await dec(FILE,{mapping:[0]}),'mapping_invalid'));
const sug=plain(li.suggestLeadMapping(['이름','접수일시','연락처','희망지역','담당자 코드','코드','휴대폰','창업예산']));
check('LI-M5 suggested mapping picks sensitive headers only as decision 32 contact targets (exact contact header names)',eqv(sug,{receivedAt:1,region:3,codes:5,budgetBand:7,contactName:0,contactPhone:2})&&eqv(li.suggestLeadMapping(['성명','연락처','이메일']),{contactName:0,contactPhone:1,contactEmail:2})&&eqv(li.suggestLeadMapping(['담당자 코드','휴대폰1','문의내용']),{})&&eqv(li.suggestLeadMapping(['신청일시','창업희망지역','예산','창업시기','유입코드','랜딩URL']),{receivedAt:0,region:1,budgetBand:2,timingBand:3,codes:4,landingUrl:5})&&eqv(li.suggestLeadMapping(['접수일']),{receivedAt:0}));
const M6=['이름','문의내용','신청자명','휴대폰1','생년월일','full_name','phone_number','id','ZQHDRX 이름'];
let m6=true;for(const h of M6){const r=await dec(csv(HEAD+','+h,ROW1+',x'));m6&&=is(r,'sensitive_column_in_file')&&same(r.errors,[{column:'6번째 열'}])&&!JSON.stringify(plain(r.errors)).includes(h)&&r.message===li.LEAD_IMPORT_MESSAGES.sensitive_column_in_file}
check('LI-M6 unmapped sensitive headers (Korean and Meta export names) are 400 with the column number only',m6);
check('LI-M6 Meta export headers and plain Korean headers pass',OK(await dec(csv('campaign_name,ad_name,adset_name,form_id,platform,접수일시,희망지역,창업예산','가상캠페인,가상광고,가상세트,f1,fb,2026-10-05 14:05,서울 강남구,5천만~1억원'),{channel:'lead_ad',mapping:{receivedAt:5,region:6,budgetBand:7},provenance:{...PROV,consentRef:undefined}})));
const KO=['이름','성명','성함','신청자','고객명','회원명','대표자','예비창업자','문의자','담당자','닉네임','아이디','연락처','전화','휴대폰','핸드폰','휴대전화','이메일','메일','카카오','카톡','주소','거주','생년','생일','나이','연령','주민','성별','계좌','카드','직업','직장','소득','자산','재산','건강','종교','문의내용','내용','메모','비고','요청사항','질문','의견','남기실','신청인','작성자','예금주','고객','사항','상담내용','상담요청','제목','휴대','연락','폰번호','전번','출생','우편'];
const EN=['phone','mobile','tel','telephone','email','mail','address','addr','birth','birthday','birthdate','dob','gender','sex','age','account','card','memo','message','comment','note','notes','nickname','username','kakao','income','job','occupation','fullname','firstname','lastname','surname','ssn','rrn','passport','ip','hp','cell','contact','zip','zipcode','postal','postcode'];
const STEMS=['phone','mail','birth','contact','comment','remark','inquir','question','kakao','passport','address'];
check('LI-M6 the Korean sensitive term list is the spec list and every term is caught inside a header',same(li.SENSITIVE_HEADER_TERMS_KO,KO)&&KO.every(t=>li.isSensitiveHeader(t)&&li.isSensitiveHeader('희망 '+t+' 칸')));
check('LI-M6 the English sensitive token list is the spec list and every token is caught as a token',same(li.SENSITIVE_HEADER_TOKENS_EN,EN)&&EN.every(t=>li.isSensitiveHeader(t)&&li.isSensitiveHeader('lead_'+t)&&li.isSensitiveHeader(t.toUpperCase()+'-1')));
check('LI-M6 name and id are sensitive alone or after the listed qualifiers only',['name','full_name','first name','last-name','user_name','customer_name','applicant_name','contact_name','id','lead_id','user_id','member_id','customer_id','applicant_id','kakao_id','fullName'].every(h=>li.isSensitiveHeader(h))&&['campaign_name','ad_name','adset_name','form_name','form_id','ad_id','campaign_id','platform','created_time','is_organic'].every(h=>!li.isSensitiveHeader(h)));
check('LI-M6 Korean terms are found after whitespace removal and NFKC (spaced, full-width and NFD headers)',['예비 창업자','성 명','생 년 월 일','요청 사항','고객 명','ＰＨＯＮＥ','Ｅ－ｍａｉｌ',...['이름','연락처','휴대폰','생년월일'].map(h=>h.normalize('NFD'))].every(h=>li.isSensitiveHeader(h)));
const m6s=await dec(csv(HEAD+',성 명',ROW1+',x')),m6n=await dec(csv(HEAD+','+'이름'.normalize('NFD'),ROW1+',x'));
check('LI-M6 a spaced or NFD sensitive header rejects the file with the column number only',is(m6s,'sensitive_column_in_file')&&same(m6s.errors,[{column:'6번째 열'}])&&is(m6n,'sensitive_column_in_file')&&same(m6n.errors,[{column:'6번째 열'}]));
check('LI-M6 the joined-word stems and the name/id qualifier lists are the fixed lists; every stem is caught inside a joined token',same(li.SENSITIVE_HEADER_STEMS_EN,STEMS)&&STEMS.every(t=>li.isSensitiveHeader('x'+t+'x'))&&same(li.NAME_QUALIFIERS,['full','first','last','user','customer','applicant','contact','given','family','real','nick'])&&same(li.ID_QUALIFIERS,['lead','user','member','customer','applicant','kakao','external','leadgen']));
// 흔한 신청·게시판 내보내기 머리글(이름·자유 텍스트·생년·연락처·식별자, 붙여 쓴 영어 포함)은 값 패턴으로 못 잡으므로 이름으로 막는다(명세 2.6.3 1단계).
const M6B=['신청인','작성자','예금주','고객','fullname','FULLNAME','given_name','family_name','surname','real_name','nick_name','문의사항','특이사항','기타사항','상담요청','상담내용','제목','comments','inquiry','question','content','remarks','출생연도','dateofbirth','birthyear','연락번호','휴대번호','폰번호','전번','우편번호','phonenumber','contact','contact_number','hp','H.P','cell','kakaotalk','Postal Code','zip','ssn','rrn','passport','ip','external_id','leadgen_id'];
let m6b=true;for(const h of M6B){const r=await dec(csv(HEAD+','+h,ROW1+',x'));m6b&&=li.isSensitiveHeader(h)&&is(r,'sensitive_column_in_file')&&same(r.errors,[{column:'6번째 열'}])}
check('LI-M6 common lead-export headers (names, free text, birth, contact, identifiers, joined English words) are 400 with the column number only',m6b);
check('LI-M6 a lone content header is sensitive but utm_content and other Meta export headers still pass',li.isSensitiveHeader('content')&&li.isSensitiveHeader('Content')&&['campaign_name','ad_name','adset_name','form_id','form_name','ad_id','campaign_id','platform','created_time','is_organic','utm_content','inbox_url'].every(h=>!li.isSensitiveHeader(h)));
check('LI-M6 date columns that name a consultation or writing time are not sensitive (bare 상담·문의 are not terms)',['상담신청일시','상담신청일','작성일','문의일시'].every(h=>!li.isSensitiveHeader(h)));
check('LI-M6 the spec examples that must pass are not sensitive',['접수일시','신청일시','문의일시','희망지역','창업예산','희망시기','유입코드','모집코드','등록일시','접수일','유입URL','랜딩URL','값1'].every(h=>!li.isSensitiveHeader(h)));
check('LI-M7 column index -1, 1.5, "0" and out of range are 400 mapping_invalid',(await Promise.all([-1,1.5,'0',5,NaN,null].map(i=>dec(FILE,{mapping:{...MAP,receivedAt:i}})))).every(r=>is(r,'mapping_invalid')));
let m7=true;try{m7=is(await dec(FILE,{mapping:JSON.parse('{"receivedAt":0,"__proto__":1}')}),'mapping_invalid')&&is(await dec(FILE,{mapping:{receivedAt:0,constructor:1}}),'mapping_invalid')&&is(await dec(FILE,{mapping:JSON.parse('{"__proto__":{"receivedAt":0}}')}),'mapping_invalid')}catch{m7=false}
check('LI-M7 __proto__ and constructor keys are 400 mapping_invalid without throwing',m7);

// ════ LI-R 행 ════
const R1=[['2026-10-05 14:05','2026-10-05T05:05:00.000Z'],['2026-10-05 14:05:03','2026-10-05T05:05:03.000Z'],['2026.10.05 14:05','2026-10-05T05:05:00.000Z'],['2026/10/05 14:05','2026-10-05T05:05:00.000Z'],['2026-10-5 9:05','2026-10-05T00:05:00.000Z'],['2026. 10. 5. 오후 2:05','2026-10-05T05:05:00.000Z'],['2026-10-05 오후 2:05:03','2026-10-05T05:05:03.000Z'],['2026-10-05 오전 12:10','2026-10-04T15:10:00.000Z'],['2026-10-05 오후 12:10','2026-10-05T03:10:00.000Z'],['2026-10-05T14:05','2026-10-05T05:05:00.000Z'],['2026-10-05T05:05:00Z','2026-10-05T05:05:00.000Z'],['2026-10-05T14:05:00+09:00','2026-10-05T05:05:00.000Z']];
const r1=await dec(csv(HEAD,...R1.map(([v],i)=>`${v},서울 강남구,,,${i%2?'R2345678':''}`)));
check('LI-R1 accepted time forms (KST local, 오전/오후, dots, slashes, one-digit parts, T, Z, +09:00) normalize to UTC',OK(r1)&&same(r1.value.normalizedRows.map(r=>r.receivedAt),R1.map(x=>x[1]))&&R1.every(([v,u])=>eqv(li.parseReceivedAt(v,'portal'),{ok:true,at:u,precision:'time'})));
const R2=['2026-02-30 10:00','2026-10-05 24:00','2026-10-05 10:60','2026-10-05 오후 13:00','2026-10-05 오전 0:10','20260924143000','2026-10-05 14시','05/10/2026 14:05','1999-12-31 10:00'];
check('LI-R2 impossible dates, 24:00, :60, 오후 13시 and other forms are received_invalid',R2.every(v=>eqv(li.parseReceivedAt(v,'portal'),{ok:false,code:'received_invalid'}))&&eqv(li.parseReceivedAt('  ','portal'),{ok:false,code:'received_missing'}));
const r2=await dec(csv(HEAD,'2026-02-30 10:00,서울 강남구,,,',',서울 강남구,,,'));
check('LI-R2 row errors carry row, mapped column name and row code only',is(r2,'row_invalid')&&same(r2.errors,[{row:2,column:'접수일시',code:'received_invalid'},{row:3,column:'접수일시',code:'received_missing'}]));
const r2b=await dec(csv(HEAD,'','x,서울 강남구,,,'));
check('LI-R2 a row error after a blank line carries the parseCsv line',is(r2b,'row_invalid')&&same(r2b.errors,[{row:3,column:'접수일시',code:'received_invalid'}]));
const r2c=await dec(csv(HEAD,...Array.from({length:51},()=>'x,서울 강남구,,,')));
check('LI-R2 51 invalid rows give row_invalid with the first 50 row errors only',is(r2c,'row_invalid')&&r2c.errors.length===50&&r2c.errors[0].row===2&&r2c.errors[49].row===51);
check('LI-R3 date-only values: expo and briefing accept with day precision at KST 00:00, lead_ad is received_date_only',eqv(li.parseReceivedAt('2026-10-05','expo'),{ok:true,at:'2026-10-04T15:00:00.000Z',precision:'day'})&&eqv(li.parseReceivedAt('2026. 10. 5.','briefing'),{ok:true,at:'2026-10-04T15:00:00.000Z',precision:'day'})&&eqv(li.parseReceivedAt('2026-10-05','lead_ad'),{ok:false,code:'received_date_only'})&&eqv(li.parseReceivedAt('2026-02-30','expo'),{ok:false,code:'received_invalid'}));
const r3=await dec(csv(HEAD,'2026-10-05,서울 강남구,,,'),{channel:'expo'}),r3b=await dec(csv(HEAD,'2026-10-05,서울 강남구,,,'),{channel:'lead_ad',provenance:{...PROV,consentRef:undefined}});
check('LI-R3 in a file: expo gets receivedPrecision day, lead_ad gets a row error',OK(r3)&&r3.value.normalizedRows[0].receivedPrecision==='day'&&r3.value.normalizedRows[0].receivedAt==='2026-10-04T15:00:00.000Z'&&is(r3b,'row_invalid')&&same(r3b.errors,[{row:2,column:'접수일시',code:'received_date_only'}]));
const PNOW={...PROV,providedOn:TODAY,period:{from:'2026-09-01',to:TODAY}};
const r4=await dec(csv(HEAD,'2026-10-10T03:06:00Z,서울 강남구,,,'),{provenance:PNOW});
const r4e=await dec(csv(HEAD,'2026-10-10T03:05:01Z,서울 강남구,,,'),{provenance:PNOW});
check('LI-R4 exactly now+5 minutes is accepted and one second later is received_future',OK(await dec(csv(HEAD,'2026-10-10T03:05:00Z,서울 강남구,,,'),{provenance:PNOW}))&&is(r4e,'row_invalid')&&same(r4e.errors,[{row:2,column:'접수일시',code:'received_future'}]));
check('LI-R4 now+4 minutes is accepted and now+6 minutes is received_future',OK(await dec(csv(HEAD,'2026-10-10T03:04:00Z,서울 강남구,,,'),{provenance:PNOW}))&&is(r4,'row_invalid')&&same(r4.errors,[{row:2,column:'접수일시',code:'received_future'}]));
const P179={...PROV,providedOn:TODAY,period:{from:fr.addDays(TODAY,-179),to:TODAY}};
const r5=await dec(csv(HEAD,`${fr.addDays(TODAY,-179)} 00:00,서울 강남구,,,`),{provenance:P179}),r5b=await dec(csv(HEAD,`${fr.addDays(TODAY,-180)} 23:59,서울 강남구,,,`),{provenance:P179});
check('LI-R5 today-179 (KST date) is accepted and today-180 is received_too_old',OK(r5)&&is(r5b,'row_invalid')&&r5b.errors.some(e=>e.code==='received_too_old'));
const next={today:'2026-10-11',now:'2026-10-11T03:00:00.000Z'};
check('LI-R5 confirming the same file after the date changed is 409 expected_mismatch',is(await dec(FILE,confirmIn(base),next),'expected_mismatch')&&OK(await dec(FILE,{},next))&&(await dec(FILE,{},next)).value.planSha256!==base.value.planSha256);
const r6=await dec(csv(HEAD,'2026-10-09 10:00,서울 강남구,,,','2026-10-10 00:30,서울 강남구,,,','2026-08-31 10:00,서울 강남구,,,'));
check('LI-R6 after the provided date is received_after_provided and outside the declared period is received_outside_period',is(r6,'row_invalid')&&same(r6.errors,[{row:2,column:'접수일시',code:'received_outside_period'},{row:3,column:'접수일시',code:'received_after_provided'},{row:3,column:'접수일시',code:'received_outside_period'},{row:4,column:'접수일시',code:'received_outside_period'}]));
check('LI-R7 regions: 서울 강남구, 경기 성남시 분당구, 서울특별시 pass; 홍길동, 강남구, 서울 강남 and digits are region_invalid',['서울 강남구','경기 성남시 분당구','서울특별시','제주특별자치도 제주시','강원특별자치도','전북특별자치도 전주시 완산구','  서울   강남구 '].every(v=>li.normalizeRegion(v)!==null)&&li.normalizeRegion('  서울   강남구 ')==='서울 강남구'&&li.normalizeRegion('')===''&&['홍길동','강남구','서울 강남','서울 강남구 3','김서준','서울 홍 길동','Seoul','서울 구'].every(v=>li.normalizeRegion(v)===null));
check('LI-R7 regions end in 시·군·구·읍·면·동 with at most three tokens after the province',['서울 강남구 역삼동','경기 광주시 오포읍','강원 홍천군 서면','경기 성남시 분당구 정자동'].every(v=>li.normalizeRegion(v)===v)&&li.normalizeRegion('경기 성남시 분당구 정자동 금곡동')===null);
check('LI-R7 a region of 40 characters is accepted and 41 characters is region_invalid',li.normalizeRegion('서울 '+'가'.repeat(36)+'동')==='서울 '+'가'.repeat(36)+'동'&&li.normalizeRegion('서울 '+'가'.repeat(37)+'동')===null);
const SIDO=['서울','서울시','서울특별시','부산','부산시','부산광역시','대구','대구시','대구광역시','인천','인천시','인천광역시','광주','광주시','광주광역시','대전','대전시','대전광역시','울산','울산시','울산광역시','세종','세종시','세종특별자치시','경기','경기도','강원','강원도','강원특별자치도','충북','충청북도','충남','충청남도','전북','전라북도','전북특별자치도','전남','전라남도','경북','경상북도','경남','경상남도','제주','제주도','제주특별자치도'];
check('LI-R7 SIDO_NAMES is the fixed 45-entry list and every entry alone is a region',same(li.SIDO_NAMES,SIDO)&&SIDO.length===45&&SIDO.every(v=>li.normalizeRegion(v)===v));
const r7=await dec(csv(HEAD,'2026-10-05 14:05,홍길동,,,','2026-10-05 14:06,서울 강남구 3,,,'));
check('LI-R7 region errors in a file are row errors without the value',is(r7,'row_invalid')&&same(r7.errors,[{row:2,column:'희망지역',code:'region_invalid'},{row:3,column:'희망지역',code:'region_invalid'}])&&!JSON.stringify(plain(r7)).includes('홍길동'));
check('LI-R7 SIDO_NAMES covers the 17 provinces with formal and short names',['서울','서울시','서울특별시','부산','부산광역시','대구','인천','광주','대전','울산','세종','세종특별자치시','경기','경기도','강원','강원도','강원특별자치도','충북','충청북도','충남','충청남도','전북','전라북도','전북특별자치도','전남','전라남도','경북','경상북도','경남','경상남도','제주','제주도','제주특별자치도'].every(s=>li.SIDO_NAMES.includes(s)));
const r8=await dec(csv(HEAD,'2026-10-05 14:05,서울 강남구,5천만~1억원,3개월 안,','2026-10-05 14:06,서울 강남구,lt_50m,6m_12m,','2026-10-05 14:07,서울 강남구,ZQBUDGETX,ZQTIMINGX,','2026-10-05 14:08,서울 강남구,,,','2026-10-05 14:09,서울 강남구,1억 ~ 1.5억원,1년 이후,'));
check('LI-R8 budget and timing labels and keys map, unknown values become unknown with warning counts and never appear',OK(r8)&&same(r8.value.normalizedRows.map(r=>[r.budgetBand,r.timingBand]),[['50m_100m','within_3m'],['lt_50m','6m_12m'],['unknown','unknown'],['unknown','unknown'],['100m_150m','over_12m']])&&r8.value.warnings.budgetUnmapped===1&&r8.value.warnings.timingUnmapped===1&&r8.warnings.includes('budget_unmapped')&&r8.warnings.includes('timing_unmapped')&&!JSON.stringify(plain(r8)).includes('ZQBUDGETX')&&!JSON.stringify(plain(r8)).includes('ZQTIMINGX'));
const P9={...PROV,period:{from:'2026-04-20',to:'2026-10-08'}};
const r9=await dec(csv(HEAD,`${fr.addDays(TODAY,-170)} 10:00,서울 강남구,,,`,`${fr.addDays(TODAY,-166)} 10:00,서울 강남구,,,`,`${fr.addDays(TODAY,-165)} 10:00,서울 강남구,,,`,`${fr.addDays(TODAY,-100)} 10:00,서울 강남구,,,`),{provenance:P9});
check('LI-R9 rows whose retention ends within 14 days are counted as expiring_within_14d',OK(r9)&&r9.value.warnings.expiringWithin14d===2&&r9.warnings.includes('expiring_within_14d'));

// ════ LI-V 제공 증빙 ════
const noConsent={...PROV,consentRef:undefined};
check('LI-V1 portal and expo without consentRef are 400',is(await dec(FILE,{provenance:noConsent}),'provenance_required')&&is(await dec(FILE,{channel:'expo',provenance:noConsent}),'provenance_required')&&OK(await dec(FILE,{channel:'expo'})));
const drop=k=>{const p={...PROV,consentRef:undefined};delete p[k];return p};
check('LI-V2 lead_ad needs no consentRef but provider, providedOn and period are required',OK(await dec(FILE,{channel:'lead_ad',provenance:noConsent}))&&is(await dec(FILE,{channel:'lead_ad',provenance:drop('provider')}),'provenance_required')&&is(await dec(FILE,{channel:'lead_ad',provenance:drop('providedOn')}),'provenance_required')&&is(await dec(FILE,{channel:'lead_ad',provenance:drop('period')}),'provenance_required')&&is(await dec(FILE,{provenance:undefined}),'provenance_required')&&is(await dec(FILE,{channel:'community',provenance:null}),'provenance_required'));
check('LI-V3 a 63-character or upper-case hash is 400',is(await dec(FILE,{provenance:{...PROV,consentRef:{...PROV.consentRef,sha256:SHA.slice(1)}}}),'provenance_invalid')&&is(await dec(FILE,{provenance:{...PROV,consentRef:{...PROV.consentRef,sha256:SHA.toUpperCase()}}}),'provenance_invalid')&&OK(await dec(FILE,{channel:'lead_ad',provenance:{...PROV}})));
check('LI-V4 a storage label outside the list is 400 and an empty list is 400 storage_labels_unset',is(await dec(FILE,{provenance:{...PROV,consentRef:{...PROV.consentRef,storageLabel:'다른 보관함'}}}),'provenance_invalid')&&is(await dec(FILE,{},{storageLabels:[]}),'storage_labels_unset')&&OK(await dec(FILE,{channel:'lead_ad',provenance:noConsent},{storageLabels:[]})));
check('LI-V5 an email in the provider label is 400 provider_pii and a bad label is 400 provenance_invalid',is(await dec(FILE,{provenance:{...PROV,provider:'포털 lead.one@example.com'}}),'provider_pii')&&is(await dec(FILE,{provenance:{...PROV,provider:''}}),'provenance_invalid')&&is(await dec(FILE,{provenance:{...PROV,provider:'가'.repeat(61)}}),'provenance_invalid')&&is(await dec(FILE,{provenance:{...PROV,provider:'포털\u0007'}}),'provenance_invalid')&&is(await dec(FILE,{provenance:{...PROV,providedOn:'2026-10-11'}}),'provenance_invalid')&&is(await dec(FILE,{provenance:{...PROV,extra:1}}),'provenance_invalid'));
const per=(from,to,providedOn=PROV.providedOn)=>dec(FILE,{provenance:{...PROV,providedOn,period:{from,to}}});
check('LI-V6 from after to, 181 days, to after providedOn and from before today-179 are 400 period_invalid',is(await per('2026-10-06','2026-10-05'),'period_invalid')&&is(await per(fr.addDays(TODAY,-180),TODAY,TODAY),'period_invalid')&&is(await per('2026-09-01','2026-10-10'),'period_invalid')&&is(await per(fr.addDays(TODAY,-180),'2026-10-08'),'period_invalid')&&OK(await per(fr.addDays(TODAY,-179),TODAY,TODAY))&&is(await per('2026-09-01','2026-13-01'),'period_invalid'));
const v7=await per('2026-09-01','2026-10-09');
check('LI-V7 a period ending on the provided date warns period_includes_export_day',OK(v7)&&v7.warnings.includes('period_includes_export_day')&&v7.value.warnings.periodIncludesExportDay===true&&base.value.warnings.periodIncludesExportDay===false);
const EV={id:'e1',brandId:'b1',status:'scheduled'};
check('LI-V8 eventId: lead_ad is 400 event_channel_mismatch, another brand 400, cancelled 409; expo keeps the event',is(await dec(FILE,{channel:'lead_ad',provenance:noConsent,eventId:'e1'},{event:EV}),'event_channel_mismatch')&&is(await dec(FILE,{channel:'expo',eventId:'e1'},{event:{...EV,brandId:'b2'}}),'event_other_brand')&&is(await dec(FILE,{channel:'expo',eventId:'e1'},{event:null}),'event_other_brand')&&is(await dec(FILE,{channel:'expo',eventId:'e1'},{event:{...EV,status:'cancelled'}}),'event_cancelled')&&(await dec(FILE,{channel:'briefing',eventId:'e1'},{event:EV})).value.eventId==='e1'&&base.value.eventId===null);
check('LI-V9 창업포털A and 창업 포털a are the same providerKey',li.providerKeyOf('창업포털A')==='창업포털a'&&li.providerKeyOf('창업 포털a')==='창업포털a'&&li.providerKeyOf('창업　포털Ａ')==='창업포털a'&&(await dec(FILE,{provenance:{...PROV,provider:'가상 창업포털'}})).value.providerKey==='가상창업포털');
check('LI channel must be a recruitment channel',is(await dec(FILE,{channel:'naver_place'}),'channel_unknown')&&is(await dec(FILE,{channel:undefined}),'channel_unknown'));

// ════ LI-K 건너뜀 ════
const days=(from,n)=>Array.from({length:n},(_,i)=>`${fr.addDays(from,i)} 10:00,서울 강남구,,,`);
const K1P={...PROV,providedOn:'2026-09-21',period:{from:'2026-09-10',to:'2026-09-20'}};
const k1=await dec(csv(HEAD,...days('2026-09-10',11)),{provenance:K1P},{coveredPeriods:[{from:'2026-09-01',to:'2026-09-15'}]});
check('LI-K1 rows inside an earlier declared period (09-10..09-15) are skipped as overlap and the rest are created',OK(k1)&&k1.value.skipped.overlap===6&&k1.value.toCreate===5&&same(k1.value.normalizedRows.map(r=>r.receivedAt),['2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20'].map(d=>d+'T01:00:00.000Z')));
const k2=await dec(csv(HEAD,...days('2026-09-01',30)),{provenance:{...PROV,providedOn:'2026-10-09',period:{from:'2026-09-01',to:'2026-09-30'}}},{coveredPeriods:[{from:'2026-10-01',to:'2026-10-08'}]});
const k1f=await dec(csv(HEAD,...days('2026-09-10',11)),{provenance:K1P},{coveredPeriods:[{from:'2026-09-10',to:'2026-09-12'}]});
check('LI-K1 a row on the first day of a covered period is skipped as overlap',OK(k1f)&&k1f.value.skipped.overlap===3&&k1f.value.toCreate===8&&k1f.value.normalizedRows[0].receivedAt==='2026-09-13T01:00:00.000Z');
check('LI-K1 rows counts every data row (created plus both skip kinds) and normalizedRows holds only the created rows',k1.value.rows===11&&k1.value.rows===k1.value.toCreate+k1.value.skipped.overlap+k1.value.skipped.duplicateInFile&&k1.value.normalizedRows.length===k1.value.toCreate);
check('LI-K2 a backfill of September after October was imported creates every row',OK(k2)&&k2.value.toCreate===30&&k2.value.skipped.overlap===0);
const k3=await dec(csv(HEAD,...days('2026-09-10',11)),{channel:'lead_ad',provenance:{...K1P,provider:'가상 창업포털',consentRef:undefined}},{coveredPeriods:[{from:'2026-09-01',to:'2026-09-15'}]});
check('LI-K3 a provider label variant and another channel hit the same coverage',OK(k3)&&k3.value.skipped.overlap===6&&k3.value.providerKey===k1.value.providerKey);
const k4=await dec(csv(HEAD,...days('2026-09-10',11),'2026-08-31 10:00,서울 강남구,,,'),{provenance:K1P});
const k4ok=await dec(csv(HEAD,...days('2026-09-10',11)),{provenance:K1P});
check('LI-K4 one row outside the declared period blocks the import and never widens the coverage',is(k4,'row_invalid')&&same(k4.errors,[{row:13,column:'접수일시',code:'received_outside_period'}])&&OK(k4ok)&&eqv(k4ok.value.provenance.period,{from:'2026-09-10',to:'2026-09-20'}));
const DUP=csv(HEAD,'2026-10-05 14:05,서울 강남구,5천만~1억원,,','2026-10-05 14:05,서울 강남구,5천만~1억원,,','2026-10-05 14:06,서울 강남구,5천만~1억원,,');
const k5=await dec(DUP),k5d=await dec(DUP,{dropInFileDuplicates:true});
check('LI-K5 same minute, region and band rows are both created by default with one warning; dropInFileDuplicates:true creates one and counts duplicate_in_file',OK(k5)&&k5.value.toCreate===3&&k5.value.warnings.possibleDuplicateInFile===1&&k5.warnings.includes('possible_duplicate_in_file')&&k5.value.skipped.duplicateInFile===0&&OK(k5d)&&k5d.value.toCreate===2&&k5d.value.skipped.duplicateInFile===1&&is(await dec(DUP,{dropInFileDuplicates:'yes'}),'invalid_input'));
const k5n=await dec(csv(HEAD,'2026-10-05 14:05,서울 강남구,5천만~1억원,,','2026-10-05 14:05,부산 해운대구,5천만~1억원,,','2026-10-05 14:05,서울 강남구,lt_50m,,','2026-10-05 14:05,서울 강남구,5천만~1억원,6m_12m,','2026-10-05 14:05,서울 강남구,5천만~1억원,,R2345678'),{dropInFileDuplicates:true});
check('LI-K5 same-minute rows differing only by region, budget, timing or codes are distinct leads even with dropInFileDuplicates:true',OK(k5n)&&k5n.value.toCreate===5&&k5n.value.skipped.duplicateInFile===0&&k5n.value.warnings.possibleDuplicateInFile===0&&!k5n.warnings.includes('possible_duplicate_in_file'));
check('LI-K6 when every row is skipped the decision is 409 no_new_rows',is(await dec(csv(HEAD,...days('2026-09-10',6)),{provenance:K1P},{coveredPeriods:[{from:'2026-09-01',to:'2026-09-15'}]}),'no_new_rows'));

// ════ LI-H 해시·확정 ════
const again=await dec(FILE);
check('LI-H1 the same bytes give the same file hash and plan hash',again.value.fileSha256===base.value.fileSha256&&again.value.planSha256===base.value.planSha256);
check('LI-H2 a confirm without expected, or expected without confirm, is 400 confirm_required',is(await dec(FILE,{confirm:true}),'confirm_required')&&is(await dec(FILE,{expected:{planSha256:base.value.planSha256,toCreate:1}}),'confirm_required')&&is(await dec(FILE,{confirm:true,expected:{planSha256:'x',toCreate:1}}),'confirm_required')&&is(await dec(FILE,{confirm:false}),'invalid_input'));
check('LI-H3 a different toCreate is 409 expected_mismatch',is(await dec(FILE,{confirm:true,expected:{planSha256:base.value.planSha256,toCreate:2}}),'expected_mismatch'));
check('LI-H4 a file that was already imported is 409 file_duplicate',is(await dec(FILE,{},{fileExists:true}),'file_duplicate'));
check('LI-H5 branch B is 409 before any file check (rejection case)',is(await li.leadImportDecision({...IN(FILE),csvBase64:'***'},{...CTX,branch:'B'}),'branch_not_a')&&is(await dec(FILE,{},{actor:MEMBER}),'role_forbidden')&&is(await dec(FILE,{},{enabled:false,actor:MEMBER}),'switch_off'));
const TWIN=csv(HEAD+',창업희망지역',ROW1+',서울 강남구');
const twin=await dec(TWIN),twinMapped=await dec(TWIN,{mapping:{...MAP,region:5}});
const variants=[
 ['mapping (same rows)',twinMapped,twin],
 ['brand',await dec(FILE,{},{brandId:'b2'}),base],
 ['channel',await dec(FILE,{channel:'expo'}),base],
 ['provider',await dec(FILE,{provenance:{...PROV,provider:'가상창업포털2'}}),base],
 ['period',await dec(FILE,{provenance:{...PROV,period:{from:'2026-09-02',to:'2026-10-08'}}}),base],
 ['event',await dec(FILE,{channel:'expo',eventId:'e1'},{event:EV}),await dec(FILE,{channel:'expo'})],
 ['dropInFileDuplicates',await dec(FILE,{dropInFileDuplicates:true}),base],
 ['bind',await dec(FILE,{},{bind:{basis:'provided'}}),base],
 ['transcodedFrom',await dec(FILE,{transcodedFrom:'euc-kr'}),base],
];
check('LI-H6 changing any one of mapping, brand, channel, provider, period, event, dropInFileDuplicates or bind changes planSha256',variants.every(([,a,b])=>OK(a)&&OK(b)&&a.value.planSha256!==b.value.planSha256&&a.value.toCreate===b.value.toCreate)&&same(twin.value.normalizedRows,plain(twinMapped.value.normalizedRows)));
let h6=true;
for(const [name,a,b] of variants){
 const x=name==='mapping (same rows)'?{mapping:{...MAP,region:5}}:name==='channel'?{channel:'expo'}:name==='provider'?{provenance:{...PROV,provider:'가상창업포털2'}}:name==='period'?{provenance:{...PROV,period:{from:'2026-09-02',to:'2026-10-08'}}}:name==='event'?{channel:'expo',eventId:'e1'}:name==='dropInFileDuplicates'?{dropInFileDuplicates:true}:name==='transcodedFrom'?{transcodedFrom:'euc-kr'}:{};
 const c=name==='brand'?{brandId:'b2'}:name==='event'?{event:EV}:name==='bind'?{bind:{basis:'provided'}}:{};
 const text=name==='mapping (same rows)'?TWIN:FILE;
 h6&&=is(await dec(text,{...x,confirm:true,expected:{planSha256:b.value.planSha256,toCreate:b.value.toCreate}},c),'expected_mismatch')&&OK(await dec(text,{...x,...confirmIn(a)},c));
}
check('LI-H6 confirming with the old expectation after any one change is 409 expected_mismatch (and the new expectation confirms)',h6);
const PH={brandId:'b1',channel:'portal',mapping:MAP,provenance:{provider:'가',providedOn:TODAY,period:{from:TODAY,to:TODAY},consentRef:null},providerKey:'가',eventId:null,dropInFileDuplicates:false,transcodedFrom:null,bind:null,today:TODAY,fileSha256:SHA,rows:[]};
const reordered=Object.fromEntries(Object.entries(PH).reverse());
check('LI-H6 leadImportPlanSha256 is canonical (key order independent) and binds today',await li.leadImportPlanSha256(PH)===await li.leadImportPlanSha256(reordered)&&await li.leadImportPlanSha256(PH)!==await li.leadImportPlanSha256({...PH,today:'2026-10-11'})&&/^[0-9a-f]{64}$/.test(await li.leadImportPlanSha256(PH)));

const GOLD=csv(HEAD,'2026-10-06 09:00,서울 강남구,,,','2026-10-05 09:00,서울 강남구,,,'),gold=await dec(GOLD);
const goldRows=[...plain(gold.value.normalizedRows)].sort((a,b)=>asc(a.receivedAt,b.receivedAt)||a.line-b.line);
const goldBody=canon({brandId:'b1',channel:'portal',mapping:MAP,provenance:plain(gold.value.provenance),providerKey:'가상창업포털',eventId:null,dropInFileDuplicates:false,transcodedFrom:null,bind:null,today:TODAY,fileSha256:sha(Buffer.from(GOLD)),rows:goldRows,ruleVersion:rc.RECRUITMENT_VERSION,importVersion:li.LEAD_IMPORT_VERSION});
check('LI-H6 golden plan hash: SHA-256 of the canonical body with rows by receivedAt then line and both rule versions',OK(gold)&&gold.value.normalizedRows[0].line===2&&goldRows[0].line===3&&gold.value.planSha256===sha(Buffer.from(goldBody)));

// ════ 표지 문자열·불변식 ════
const MARK='ZQMARKX',hasMark=r=>JSON.stringify(plain(r)).includes(MARK);
const markFails=[
 await dec(csv(HEAD+',추가값',`${MARK},${MARK},${MARK},${MARK},${MARK},${MARK}`)),
 await dec(csv(HEAD+',추가값',`${ROW1},${MARK} 010-0000-0101`)),
 await dec(csv(HEAD+`,${MARK} 이름`,`${ROW1},x`)),
 await dec(FILE,{channel:MARK}),await dec(FILE,{mapping:{receivedAt:0,[MARK]:1}}),await dec(FILE,{[MARK]:1}),
 await dec(FILE,{provenance:{...PROV,provider:MARK+' 010-0000-0101'}}),await dec(FILE,{provenance:{...PROV,consentRef:{sha256:MARK,storageLabel:MARK}}}),
 await dec(FILE,{provenance:{...PROV,providedOn:MARK,period:{from:MARK,to:MARK}}}),await dec(FILE,{channel:'lead_ad',eventId:MARK,provenance:noConsent}),
 await li.leadImportDecision({...IN(FILE),csvBase64:MARK},CTX),await dec(FILE,{confirm:true,expected:{planSha256:MARK,toCreate:1}}),await dec(FILE,{transcodedFrom:MARK}),
 await dec(csv(HEAD,`2026-10-05 14:05,서울 "${MARK}" 강남구,,,`)),
];
check('LI a marker string in any cell, mapping key, provenance field or request field never reaches a message or errors',markFails.every(r=>F(r)&&!hasMark(r)));
const hdrMark=await dec(csv(HEAD+`,${MARK}`,`${ROW1},010-0000-0101`));
check('LI a passed header name may appear only as the errors column (spec 3.1) and never in the message',is(hdrMark,'pii_in_file')&&same(hdrMark.errors,[{row:2,column:MARK}])&&!hdrMark.message.includes(MARK));
const clean=await dec(csv(HEAD+',추가값',`${ROW1},${MARK}`));
check('LI an accepted plan holds only the mapped targets (an unmapped cell value is nowhere in the plan)',OK(clean)&&!JSON.stringify(plain(clean.value.normalizedRows)).includes(MARK)&&!JSON.stringify(plain({...clean.value,headers:[]})).includes(MARK));
check('LI code list, status table and message table have the same keys; row, skip and warning codes are listed',same([...li.LEAD_IMPORT_CODES].sort(asc),Object.keys(li.LEAD_IMPORT_CODE_STATUS).sort(asc))&&same(Object.keys(li.LEAD_IMPORT_MESSAGES).sort(asc),Object.keys(li.LEAD_IMPORT_CODE_STATUS).sort(asc))&&same(li.LEAD_IMPORT_ROW_CODES,['received_missing','received_invalid','received_date_only','received_future','received_too_old','received_after_provided','received_outside_period','region_invalid','contact_missing','contact_name_invalid','contact_phone_invalid','contact_email_invalid'])&&same(li.LEAD_IMPORT_SKIP_CODES,['overlap','duplicate_in_file'])&&same(li.LEAD_IMPORT_WARNING_CODES,['budget_unmapped','timing_unmapped','dropped_tokens','truncated_tokens','possible_duplicate_in_file','expiring_within_14d','period_includes_export_day']));
const SPEC={400:['file_too_large','encoding_invalid','csv_invalid','too_many_rows','sensitive_column_in_file','pii_in_file','channel_unknown','mapping_invalid','mapping_forbidden','provenance_required','provenance_invalid','provider_pii','period_invalid','storage_labels_unset','event_channel_mismatch','event_other_brand','confirm_required','row_invalid','invalid_input','contact_mapping_invalid','basis_invalid'],403:['role_forbidden'],409:['switch_off','branch_not_a','event_cancelled','file_duplicate','no_new_rows','expected_mismatch']};
const specMap={...Object.fromEntries(Object.entries(SPEC).flatMap(([s,cs])=>cs.map(c=>[c,Number(s)]))),...Object.fromEntries(li.LEAD_IMPORT_ROW_CODES.map(c=>[c,400])),...Object.fromEntries([...li.LEAD_IMPORT_SKIP_CODES,...li.LEAD_IMPORT_WARNING_CODES].map(c=>[c,200]))};
check('LI the status table equals spec 3.2 (plus invalid_input; row codes 400 inside row_invalid, skip and warning counts 200)',eqv(li.LEAD_IMPORT_CODE_STATUS,specMap));
const deepFrozen=v=>!v||typeof v!=='object'||Object.isFrozen(v)&&Object.values(v).every(deepFrozen);
check('LI exported constants are deeply frozen',['LEAD_IMPORT_LIMITS','LEAD_IMPORT_TARGETS','FORBIDDEN_TARGETS','SIDO_NAMES','SENSITIVE_HEADER_TERMS_KO','SENSITIVE_HEADER_TOKENS_EN','SENSITIVE_HEADER_STEMS_EN','NAME_QUALIFIERS','ID_QUALIFIERS','LEAD_MAPPING_ALIASES','LEAD_IMPORT_CODES','LEAD_IMPORT_ROW_CODES','LEAD_IMPORT_SKIP_CODES','LEAD_IMPORT_WARNING_CODES','LEAD_IMPORT_CODE_STATUS','LEAD_IMPORT_MESSAGES'].every(k=>li[k]&&deepFrozen(li[k])));
check('LI versions (R5b-2 raised the rule version)',li.LEAD_IMPORT_VERSION==='fr-lead-import@2026-09-27.2');
let noThrow=true;
for(const g of [undefined,null,0,'x',[],{},new Proxy({},{get(){throw new Error('x')},ownKeys(){throw new Error('x')}})]){
 try{await li.leadImportDecision(g,g);await li.leadImportDecision(IN(FILE),g);await li.leadImportDecision(g,CTX);await li.inspectLeadFile(g,g);await li.localFileCheck(g);await li.decodeLeadCsv(g);await li.leadImportPlanSha256(g);li.base64Bytes(g);li.isSensitiveHeader(g);li.suggestLeadMapping(g);li.importPiiHits(g);li.parseReceivedAt(g,g);li.normalizeRegion(g);li.providerKeyOf(g)}catch{noThrow=false}
}
check('LI no function throws on garbage input or context',noThrow);
const tokens=await dec(csv(HEAD+',유입URL','2026-10-05 14:05,서울 강남구,,,"C2345678,R2345678",https://x.test/?utm_content=R3456789','2026-10-05 14:06,서울 강남구,,,"R2345678,R3456789,R4567892,R5678923",https://x.test/?utm_content=R6789234&utm_content=R7892345'),{mapping:{...MAP,landingUrl:5}});
check('LI codes and landing URL merge through recruitmentTokens (code column first, 5 max) with dropped and truncated counts',OK(tokens)&&same(tokens.value.normalizedRows.map(r=>r.codes),[['R2345678','R3456789'],['R2345678','R3456789','R4567892','R5678923','R6789234']])&&tokens.value.warnings.droppedTokens===1&&tokens.value.warnings.truncatedTokens===1&&tokens.warnings.includes('dropped_tokens')&&tokens.warnings.includes('truncated_tokens'));

// ════ R5b-2 결정 32(B안): 매핑한 연락처 열(LI-C)·수집 근거(LI-B)·연락처 병합(LI-X) ════
// 대표 결정(2026-09-27): 매핑한 이름·전화·이메일 열에서만 연락처를 받고, 매핑하지 않은 열의 개인정보는 파일 전체 거부. 교차 파일 중복은 '리드 1건, 집계는 파일별'.
const HEADC=HEAD+',이름,휴대폰,이메일',MAPC={...MAP,contactName:5,contactPhone:6,contactEmail:7};
const rowC=(t,name,phone,email,code='')=>`${t},서울 강남구,5천만~1억원,3개월 안,${code},${name},${phone},${email}`;
const C1=rowC('2026-10-05 14:05','김가상','010-0000-0101','lead.one@example.com','R2345678');
const FILEC=csv(HEADC,C1);
const CCTX={requireContact:true};
const BP={type:'provided'};
const decC=(text,x={},c={})=>dec(text,{mapping:MAPC,basis:BP,...x},{...CCTX,...c});
const c1i=await insp(FILEC),c1l=await li.localFileCheck(new Uint8Array(Buffer.from(FILEC)));
check('LI-C1 a file with 이름·휴대폰·이메일 headers passes inspection and the local check with the contact targets suggested',OK(c1i)&&eqv(c1i.value.suggestedMapping,{receivedAt:0,region:1,budgetBand:2,timingBand:3,codes:4,contactName:5,contactPhone:6,contactEmail:7})&&same(c1i.value.headers,HEADC.split(','))&&OK(c1l)&&same(c1l.value.headers,HEADC.split(',')));
check('LI-C1 contactColumnKind recognises only the exact contact header names',li.contactColumnKind('이름')==='contactName'&&li.contactColumnKind('Full Name')==='contactName'&&li.contactColumnKind('phone_number')==='contactPhone'&&li.contactColumnKind('연락처')==='contactPhone'&&li.contactColumnKind('E-mail')==='contactEmail'&&['휴대폰1','문의내용','생년월일','이름(한자)','접수일시',''].every(h=>li.contactColumnKind(h)===null)&&li.contactColumnKind(null)===null);
const c2=await decC(FILEC);
check('LI-C2 mapped contact columns are normalized into the server-only rows (phone digits, lower-case email) and counted per file',OK(c2)&&eqv(c2.value.normalizedRows[0].contact,{name:'김가상',phone:'01000000101',email:'lead.one@example.com'})&&c2.value.toCreate===1&&eqv(c2.value.merged,{existing:{count:0,rows:[]},inFile:{count:0,rows:[]}})&&c2.value.providerLeadCount===1&&eqv(c2.value.basis,{type:'provided'})&&eqv(c2.value.mapping,MAPC));
check('LI-C2 the plan outside normalizedRows carries no contact value',OK(c2)&&!['김가상','0101','lead.one'].some(v=>JSON.stringify(plain({...c2.value,normalizedRows:[],headers:[]})).includes(v)));
const c3=await decC(FILEC,{mapping:{...MAP,contactName:5,contactPhone:6}});
check('LI-C3 an unmapped contact column (이메일) rejects the whole file as sensitive_column_in_file with the column number only',is(c3,'sensitive_column_in_file')&&same(c3.errors,[{column:'8번째 열'}])&&!JSON.stringify(plain(c3)).includes('lead.one'));
check('LI-C4 contact targets need their own header kind and name with a phone or email; the ledger import needs contacts',is(await decC(FILEC,{mapping:{receivedAt:0,contactName:5,contactPhone:1,contactEmail:7}}),'contact_mapping_invalid')&&is(await decC(FILEC,{mapping:{...MAPC,contactPhone:7,contactEmail:6}}),'contact_mapping_invalid')&&is(await decC(csv(HEAD+',이름',ROW1+',김가상'),{mapping:{...MAP,contactName:5}}),'contact_mapping_invalid')&&is(await decC(csv(HEAD+',휴대폰',ROW1+',010-0000-0101'),{mapping:{...MAP,contactPhone:5}}),'contact_mapping_invalid')&&is(await decC(FILE,{mapping:MAP}),'contact_mapping_invalid')&&OK(await dec(FILE)));
const c5=async(name,phone,email,col)=>{const r=await decC(csv(HEADC,rowC('2026-10-05 14:05',name,phone,email)));return is(r,'pii_in_file')&&same(r.errors,[{row:2,column:col}])&&![name,phone,email].some(v=>v&&JSON.stringify(plain(r)).includes(v))};
check('LI-C5 identifiers stay rejected in contact columns: a resident number in the phone or email column, a card or an email in the name column',await c5('김가상','900101-1234567','lead.one@example.com','휴대폰')&&await c5('김가상','010-0000-0101','900101-1234567@example.com','이메일')&&await c5('4111111111111111','010-0000-0101','lead.one@example.com','이름')&&await c5('lead.one@example.com','010-0000-0101','','이름')&&await c5('김가상','010-****-0101','','휴대폰'));
const c6=await decC(csv(HEADC,rowC('2026-10-05 14:05','','010-0000-0101',''),rowC('2026-10-05 14:06','김가상','',''),rowC('2026-10-05 14:07','김가상','12345',''),rowC('2026-10-05 14:08','김가상','','lead.one@'),rowC('2026-10-05 14:09','김가상1','010-0000-0102','')));
check('LI-C6 contact row errors carry the row, the mapped header and the row code only',is(c6,'row_invalid')&&same(c6.errors,[{row:2,column:'이름',code:'contact_missing'},{row:3,column:'휴대폰',code:'contact_missing'},{row:4,column:'휴대폰',code:'contact_phone_invalid'},{row:5,column:'이메일',code:'contact_email_invalid'},{row:6,column:'이름',code:'contact_name_invalid'}])&&!['12345','lead.one@','김가상1'].some(v=>JSON.stringify(plain(c6)).includes(v)));
const c7p=await decC(csv(HEAD+',성명,연락처',ROW1+',김가상,010-0000-0101'),{mapping:{...MAP,contactName:5,contactPhone:6}}),c7e=await decC(csv(HEAD+',name,email',ROW1+',Kim Test,Lead.Two@Example.com'),{mapping:{...MAP,contactName:5,contactEmail:6}});
check('LI-C7 a phone-only file and an email-only file are accepted',OK(c7p)&&eqv(c7p.value.normalizedRows[0].contact,{name:'김가상',phone:'01000000101',email:null})&&OK(c7e)&&eqv(c7e.value.normalizedRows[0].contact,{name:'Kim Test',phone:null,email:'lead.two@example.com'}));
const c8=await decC(csv(HEADC+',추가값',C1+',010-0000-0999'),{mapping:MAPC});
check('LI-C8 a phone number in an unmapped non-contact column still rejects the whole file',is(c8,'pii_in_file')&&same(c8.errors,[{row:2,column:'추가값'}])&&!JSON.stringify(plain(c8)).includes('0999'));
// 파일 안 병합(같은 사람이 한 파일에 두 번): 리드는 한 건, 제공처 파일 집계도 한 명이다.
const X=csv(HEADC,C1,rowC('2026-10-05 15:00','이테스트','010-0000-0120','lead.two@example.com'),rowC('2026-10-06 09:00','김가상','010 0000 0101',''),rowC('2026-10-06 10:00','김가상','','LEAD.ONE@example.com'));
const x1=await decC(X);
check('LI-X1 the same phone or email twice in one file merges into the first row: one lead per person, counts and row numbers only',OK(x1)&&x1.value.toCreate===2&&eqv(x1.value.merged,{existing:{count:0,rows:[]},inFile:{count:2,rows:[4,5]}})&&x1.value.providerLeadCount===2&&eqv(x1.value.normalizedRows.map(r=>r.merge),[{type:'create'},{type:'create'},{type:'in_file',line:2},{type:'in_file',line:2}]));
check('LI-X1 merged-row counts carry no contact value',!['김가상','0101','lead.one','LEAD.ONE'].some(v=>JSON.stringify(plain(x1.value.merged)).includes(v)));
const x3=await decC(X,{},{mergeExisting:[{line:2,leadId:'lead-old'}]});
check('LI-X3 a row whose contact key belongs to an existing lead creates no lead and is counted once for this file',OK(x3)&&x3.value.toCreate===1&&eqv(x3.value.merged,{existing:{count:1,rows:[2]},inFile:{count:2,rows:[4,5]}})&&x3.value.providerLeadCount===2&&eqv(x3.value.normalizedRows[0].merge,{type:'existing',leadId:'lead-old'})&&x3.value.planSha256!==x1.value.planSha256);
const x4=await decC(X,{},{mergeExisting:[{line:2,leadId:'lead-old'},{line:3,leadId:'lead-old'}]});
check('LI-X4 two rows matching the same existing lead are one person: the second is an in-file merge',OK(x4)&&x4.value.toCreate===0&&eqv(x4.value.merged,{existing:{count:1,rows:[2]},inFile:{count:3,rows:[3,4,5]}})&&x4.value.providerLeadCount===1);
check('LI-X5 mergeExisting must name primary rows of this plan with a valid lead id',is(await decC(X,{},{mergeExisting:[{line:4,leadId:'lead-old'}]}),'invalid_input')&&is(await decC(X,{},{mergeExisting:[{line:9,leadId:'lead-old'}]}),'invalid_input')&&is(await decC(X,{},{mergeExisting:[{line:2,leadId:'bad id!'}]}),'invalid_input')&&is(await decC(X,{},{mergeExisting:'x'}),'invalid_input'));
check('LI-X6 confirming with the preview expectation after an existing lead appeared is 409 expected_mismatch',is(await decC(X,{confirm:true,expected:{planSha256:x1.value.planSha256,toCreate:x1.value.toCreate}},{mergeExisting:[{line:2,leadId:'lead-old'}]}),'expected_mismatch')&&OK(await decC(X,{confirm:true,expected:{planSha256:x3.value.planSha256,toCreate:1}},{mergeExisting:[{line:2,leadId:'lead-old'}]})));
const x7=await decC(FILEC,{confirm:true,expected:{planSha256:(await decC(FILEC,{},{mergeExisting:[{line:2,leadId:'lead-old'}]})).value.planSha256,toCreate:0}},{mergeExisting:[{line:2,leadId:'lead-old'}]});
check('LI-X7 a file whose every person already exists still confirms with toCreate 0 (the provider record is appended)',OK(x7)&&x7.value.toCreate===0&&x7.value.providerLeadCount===1);
// 수집 근거(명세 2.7.1, consent 없음).
check('LI-B1 portal takes provided or inquiry_response and either way needs the consent evidence reference',eqv(li.importBasisDecision('portal',{type:'provided'}),{ok:true,basis:{type:'provided'}})&&eqv(li.importBasisDecision('expo',{type:'inquiry_response'}),{ok:true,basis:{type:'inquiry_response'}})&&OK(await decC(FILEC,{basis:{type:'inquiry_response'}}))&&is(await decC(FILEC,{provenance:{...PROV,consentRef:undefined}}),'provenance_required'));
let b2=true;for(const ch of rc.RECRUITMENT_CHANNELS.map(c=>c.key))b2&&=li.importBasisDecision(ch,{type:'consent'}).ok===false;
check('LI-B2 consent is basis_invalid on every channel',b2&&is(await decC(FILEC,{basis:{type:'consent',noticeId:'pn-1'}}),'basis_invalid'));
check('LI-B3 owner_referral takes referral with referralFrom franchisee; lead_ad referral and other referral sources are basis_invalid',eqv(li.importBasisDecision('owner_referral',{type:'referral'}),{ok:true,basis:{type:'referral',referralFrom:'franchisee'}})&&eqv(li.importBasisDecision('owner_referral',{type:'referral',referralFrom:'franchisee'}),{ok:true,basis:{type:'referral',referralFrom:'franchisee'}})&&li.importBasisDecision('owner_referral',{type:'referral',referralFrom:'acquaintance'}).ok===false&&li.importBasisDecision('lead_ad',{type:'referral'}).ok===false&&li.importBasisDecision('lead_ad',{type:'provided'}).ok===false&&eqv(li.importBasisDecision('lead_ad',{type:'inquiry_response'}),{ok:true,basis:{type:'inquiry_response'}})&&li.importBasisDecision('portal',{type:'provided',x:1}).ok===false&&li.importBasisDecision('portal',null).ok===false);
const b4a=await decC(FILEC),b4b=await decC(FILEC,{basis:{type:'inquiry_response'}});
check('LI-B4 a different basis changes planSha256 and the old expectation is 409 expected_mismatch',OK(b4a)&&OK(b4b)&&b4a.value.planSha256!==b4b.value.planSha256&&is(await decC(FILEC,{basis:{type:'inquiry_response'},confirm:true,expected:{planSha256:b4a.value.planSha256,toCreate:1}}),'expected_mismatch'));
check('LI-B5 the ledger import needs a basis',is(await decC(FILEC,{basis:undefined}),'basis_invalid')&&is(await decC(FILEC,{basis:'provided'}),'basis_invalid'));

// ════ 사유 코드 전부·사례 번호·외부 호출 ════
const errorCodes=Object.keys(li.LEAD_IMPORT_CODE_STATUS).filter(c=>li.LEAD_IMPORT_CODE_STATUS[c]!==200&&!li.LEAD_IMPORT_ROW_CODES.includes(c));
const missing=errorCodes.filter(c=>!produced.has(c)),missingRow=plain(li.LEAD_IMPORT_ROW_CODES).filter(c=>!rowCodes.has(c)),missingWarn=plain(li.LEAD_IMPORT_WARNING_CODES).filter(c=>!warned.has(c));
assert.deepEqual(missing,[],'나오지 않은 사유 코드: '+missing.join(', '));passed.push(`LI all ${errorCodes.length} failure codes were produced`);
assert.deepEqual(missingRow,[],'나오지 않은 행 코드: '+missingRow.join(', '));passed.push(`LI all ${li.LEAD_IMPORT_ROW_CODES.length} row codes were produced`);
assert.deepEqual(missingWarn,[],'나오지 않은 경고: '+missingWarn.join(', '));passed.push(`LI all ${li.LEAD_IMPORT_WARNING_CODES.length} warning codes were produced`);
check(`LI the status invariant held on every failure result (${failCount})`,failCount>=120);
const IDS=['LI-S1','LI-E1','LI-E2','LI-E3','LI-E4','LI-E5','LI-E6','LI-F','LI-A1','LI-A2','LI-A3','LI-A4',...Array.from({length:30},(_,i)=>'LI-P'+(i+1)),'LI-M1','LI-M2','LI-M3','LI-M4','LI-M5','LI-M6','LI-M7','LI-R1','LI-R2','LI-R3','LI-R4','LI-R5','LI-R6','LI-R7','LI-R8','LI-R9','LI-V1','LI-V2','LI-V3','LI-V4','LI-V5','LI-V6','LI-V7','LI-V8','LI-V9','LI-K1','LI-K2','LI-K3','LI-K4','LI-K5','LI-K6','LI-H1','LI-H2','LI-H3','LI-H4','LI-H5','LI-H6',
 'LI-B1','LI-B2','LI-B3','LI-B4','LI-B5',...Array.from({length:8},(_,i)=>'LI-C'+(i+1)),'LI-X1','LI-X3','LI-X4','LI-X5','LI-X6','LI-X7'];
const missingIds=IDS.filter(id=>!passed.some(n=>n.startsWith(id+' ')));
assert.deepEqual(missingIds,[],'이름에 없는 사례 번호: '+missingIds.join(', '));passed.push(`every R5a and R5b-2 case id of this suite (${IDS.length}) has a named check`);
check('no external call was made',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length}));
