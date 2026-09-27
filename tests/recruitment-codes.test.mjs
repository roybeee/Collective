// R5a 모집 코드·채널·귀속·비용 순수 모듈(lib/franchise-recruitment.ts) 회귀. 명세 docs(R5 구현 명세 초안 2) 6.2의 R5a 사례 RC-·RA-·RS-·RD-를 사례 번호 이름으로 둔다. RA-9(제공처 파일 기준 귀속)은 R5b-2가 더했다.
// 확인: 구문 import 경계(RC-S1), 코드 형식·생성·토큰·UTM(RC-F·RC-T), 채널(RC-CH), 발급·사용 중지 판정(RC-D·RC-R), 코드 귀속(asOf·제외·사용 중지·소급·늦은 입력, RA), 비용 판정·무효화·기간 합계·정렬 창(RS),
// 결정 객체 불변식·표지 문자열·얼린 상수(RD). 근거: mocked(순수 함수, 합성 입력, 외부 호출 0회). 저장·API·화면·kind·스위치는 R5b·R5c가 맡는다. 법률 적합성은 not_run(LR-1 대상, 결정 20 보류).
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const rc=await rt.load('lib/franchise-recruitment.ts'),pii=await rt.load('lib/pii-scan.ts'),fr=await rt.load('lib/franchise-rules.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const canon=v=>Array.isArray(v)?'['+v.map(canon).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}':JSON.stringify(v);
const eqv=(a,b)=>canon(plain(a))===canon(b);
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
const asc=(a,b)=>a<b?-1:a>b?1:0;
const DISCLAIMER='COLLECTIVE 휴리스틱 · 법률 자문 아님';
// 모든 실패 결과는 F를 거친다: 사유는 정렬·중복 없음, 모든 사유의 상태가 결과 상태와 같다(단계 불변식), 문구는 첫 사유의 고정 문구, 버전·면책이 있다.
const produced=new Set(),warned=new Set();let failCount=0;
const F=r=>{
 assert.equal(r?.ok,false,'실패 결과여야 합니다: '+JSON.stringify(plain(r)));
 assert.ok(Array.isArray(r.reasons)&&r.reasons.length>0,'사유가 있어야 합니다');
 assert.deepEqual(plain(r.reasons),[...new Set(plain(r.reasons))].sort(asc));
 assert.ok(r.reasons.every(c=>rc.RECRUITMENT_CODE_STATUS[c]===r.status),'상태 불변식: '+r.status+' '+r.reasons.join(','));
 assert.equal(r.message,rc.RECRUITMENT_MESSAGES[r.reasons[0]]);
 assert.equal(r.ruleVersion,rc.RECRUITMENT_VERSION);assert.equal(r.disclaimer,DISCLAIMER);
 failCount++;r.reasons.forEach(c=>produced.add(c));return r;
};
const is=(r,...codes)=>{F(r);return same(r.reasons,codes)};
const OK=r=>{const ok=r?.ok===true&&r.status===200&&r.ruleVersion===rc.RECRUITMENT_VERSION&&r.disclaimer===DISCLAIMER&&Array.isArray(r.warnings);if(ok)r.warnings.forEach(w=>warned.add(w));return ok};
const W=(r,...codes)=>OK(r)&&same(r.warnings,codes);

// ════ RC-S1 구문 경계 ════
const SRC=readFileSync('lib/franchise-recruitment.ts','utf8');
const moduleRefs=(text,file='m.ts')=>{
 const out=[],sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,false,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),lit=n=>n&&(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))?n.text:'(opaque)';
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
const FORBIDDEN_SPEC=s=>['./server','./feature-flags','./franchise-server','./franchise-crypto','./store-marketing','./store-attribution','./store-operations-server','./hermes','cloudflare:workers'].includes(s)||/^\.\/execution/.test(s)||s.startsWith('@/')||s.endsWith('.ts');
const refs=moduleRefs(SRC,'lib/franchise-recruitment.ts');
check('RC-S1 the module references exactly the five allowed modules, all static value imports',same(refs.map(r=>r.spec).sort(asc),['./agency','./franchise-gates','./franchise-rules','./pii-scan','./tracking-codes'])&&refs.every(r=>r.kind==='import'));
check('RC-S1 the ./tracking-codes import names are exactly CODE_ALPHABET and normalizeCode',same(refs.find(r=>r.spec==='./tracking-codes').names.sort(asc),['CODE_ALPHABET','normalizeCode']));
check('RC-S1 the other imports use only the names allowed by spec 2.1',same(refs.find(r=>r.spec==='./pii-scan').names,['scanText'])&&refs.find(r=>r.spec==='./franchise-rules').names.every(n=>['isDate','isInstant','parseInstant','toKstDate','addDays'].includes(n))&&same(refs.find(r=>r.spec==='./franchise-gates').names,['GATE_DISCLAIMER'])&&same(refs.find(r=>r.spec==='./agency').names,['isRecruitmentObjective']));
check('RC-S1 no forbidden module import (server, D1, flags, franchise-server/crypto, store modules, execution, hermes)',!refs.some(r=>FORBIDDEN_SPEC(r.spec)));
check('RC-S1 the checker itself catches sneaked forbidden references',['import {x} from "./store-marketing";','export * from "./server";','const m=import("./hermes");','const r=require("./execution-server");','type T=typeof import("./franchise-server");'].every(t=>{const x=moduleRefs(SRC+'\n'+t);return x.length===refs.length+1&&FORBIDDEN_SPEC(x[x.length-1].spec)}));
check('RC-S1 the source has no store-marketing string',!SRC.includes('store-marketing'));
const CODE=SRC.replace(/^\s*\/\/.*$/gm,'');
check('RC-S1 no fetch call, clock, randomness, environment or any',!/\bfetch\s*\(/.test(SRC)&&!/\bDate\.now\b|new\s+Date\s*\(\s*\)|Math\.random|\bcrypto\.|\bprocess\.|globalThis/.test(CODE)&&!/\bany\b/.test(CODE));
check('RC-S1 no record-kind literal or storage call',!/recordStatement|readRecord|listRecords|optionalRecord|recruitment_(code|spend|import)/.test(SRC));
// 앱 경로 경계: 두 순수 모듈을 import하는 파일은 가져오기 모듈(모집 모듈을 쓴다), R5b-1·R5b-2 서버 모듈(lib/franchise-recruitment-server.ts·lib/franchise-lead-import-server.ts),
// R6a 보고 순수 모듈(lib/franchise-report.ts)·R6b 보고 서버(lib/franchise-report-server.ts)·R6d-2 소재 실험 모듈·서버·화면, R5c 가맹 화면 네 개(유입·비용 탭·가져오기·리드 상세·가맹 패널)뿐이다. 모두 모델 경계 FORBIDDEN이다(tests/franchise-model-boundary.test.mjs).
const walk=d=>readdirSync(d).flatMap(x=>{const p=join(d,x);return statSync(p).isDirectory()?(x==='node_modules'||x.startsWith('.')?[]:walk(p)):/\.(ts|tsx)$/.test(x)&&!x.endsWith('.d.ts')?[p]:[]});
const resolveRef=(from,spec)=>{const base=spec.startsWith('@/')?spec.slice(2):spec.startsWith('.')?join(dirname(from),spec):null;return base===null?null:join(base).replace(/\.tsx?$/,'')};
const importers=['app','lib','components','hooks','db'].flatMap(walk).filter(p=>moduleRefs(readFileSync(p,'utf8'),p).some(r=>['lib/franchise-recruitment','lib/franchise-lead-import'].includes(resolveRef(p,r.spec))));
check('RC-S1 only the lead-import module, the R5b-1 and R5b-2 servers, the R6a report module, the R6b report server, the R6d-2 experiment modules and screen and the R5c franchise screens import the two R5a modules',same([...importers].sort(),[join('lib','franchise-lead-import.ts'),join('lib','franchise-experiment.ts'),join('lib','franchise-experiment-server.ts'),join('app','franchise-experiment-panel.tsx'),join('lib','franchise-report.ts'),join('lib','franchise-report-server.ts'),join('lib','franchise-recruitment-server.ts'),join('lib','franchise-lead-import-server.ts'),join('app','franchise-inflow-panel.tsx'),join('app','franchise-import-panel.tsx'),join('app','franchise-lead-detail.tsx'),join('app','franchise-panel.tsx')].sort()));

// ════ 상수·채널 ════
check('RC-CH1 ten channels in plan order with the Korean labels',same(rc.RECRUITMENT_CHANNELS,[{key:'portal',label:'창업 포털'},{key:'search_ad',label:'네이버 검색광고'},{key:'expo',label:'박람회'},{key:'briefing',label:'사업설명회'},{key:'lead_ad',label:'메타 리드광고'},{key:'youtube',label:'유튜브'},{key:'blog_post',label:'블로그'},{key:'store_qr',label:'매장 QR'},{key:'owner_referral',label:'점주 추천'},{key:'community',label:'커뮤니티'}]));
check('RC-CH1 provenance channels are portal and expo, event channels are expo and briefing',same(rc.PROVENANCE_CHANNELS,['portal','expo'])&&same(rc.EVENT_CHANNELS,['expo','briefing']));
// 점포 모듈을 import하지 않고 문자열 목록으로 대조한다. 목록이 점포 파일과 어긋나지 않게 원문에서 키를 읽어 함께 확인한다.
const STORE_KEYS=['naver_place','naver_ads','blog','local_creator','social','daangn','maps','orders','retention','partnership','offline'];
const storeSrc=readFileSync('lib/store-marketing.ts','utf8'),catalog=storeSrc.slice(storeSrc.indexOf('export const channelCatalog'),storeSrc.indexOf('] as const',storeSrc.indexOf('export const channelCatalog')));
check('RC-CH2 the eleven store channel keys are still the store catalog keys',same([...catalog.matchAll(/\{key:'([a-z_]+)'/g)].map(m=>m[1]),STORE_KEYS));
check('RC-CH2 recruitment and store channel keys do not intersect',rc.RECRUITMENT_CHANNELS.every(c=>!STORE_KEYS.includes(c.key))&&STORE_KEYS.every(k=>!rc.isRecruitmentChannel(k)));

// ════ RC-F 형식·생성 ════
check('RC-F1 R2345678 is a recruitment code',rc.isRecruitmentCode('R2345678')&&rc.RECRUITMENT_CODE_PREFIX==='R'&&rc.RECRUITMENT_CODE_BODY===7);
check('RC-F2 lower case, hyphen and full-width input normalize to a valid code',rc.normalizeRecruitmentCode('r234-5678')==='R2345678'&&rc.normalizeRecruitmentCode('Ｒ２３４５６７８')==='R2345678'&&rc.normalizeRecruitmentCode(' r 234 5678 ')==='R2345678'&&rc.isRecruitmentCode(rc.normalizeRecruitmentCode('ｒ２３４－５６７８'))&&rc.normalizeRecruitmentCode(5)==='');
check('RC-F3 store prefix C and lead prefix L are rejected',!rc.isRecruitmentCode('C2345678')&&!rc.isRecruitmentCode('L2345678')&&!rc.isRecruitmentCode('Q2345678'));
check('RC-F4 nine and seven character values are rejected',!rc.isRecruitmentCode('R23456789')&&!rc.isRecruitmentCode('R234567')&&!rc.isRecruitmentCode('')&&!rc.isRecruitmentCode(null));
check('RC-F5 confusable characters 0 O 1 I L are rejected',['R234567O','R2345670','R2345671','R234567I','R234567L'].every(c=>!rc.isRecruitmentCode(c))&&!rc.isRecruitmentCode('r2345678'));
const gen=[];for(let i=0;gen.length<20000;i++){const c=rc.generateRecruitmentCode(new Uint8Array(createHash('sha256').update('rc-gen:'+i).digest()));if(c)gen.push(c)}
check('RC-F6 twenty thousand generated codes are all valid and all scanText-clean',gen.every(c=>rc.isRecruitmentCode(c)&&c.length===8)&&gen.every(c=>pii.scanText(c).length===0)&&new Set(gen).size>19990);
check('RC-F6 a nine-character R value would hit the passport pattern (why the body is seven)',pii.scanText('R23456789').some(f=>f.kind==='national_id'));
check('RC-F6 bytes of 248 or more are discarded and short randomness gives null',rc.generateRecruitmentCode(Uint8Array.from([255,248,0,1,2,3,4,5,6]))==='RABCDEFG'&&rc.generateRecruitmentCode(Uint8Array.from([0,1,2,3,4,5]))===null&&rc.generateRecruitmentCode(new Uint8Array(40).fill(250))===null&&rc.generateRecruitmentCode([0,1,2,3,4,5,6])===null);

// ════ RC-T 토큰 ════
const tok=c=>plain(rc.recruitmentTokens(c));
check('RC-T five separators split tokens (comma, semicolon, bar, slash, whitespace/newline)',same(tok('R2345678,R3456789;R4567892|R5678923/R6789234').codes,['R2345678','R3456789','R4567892','R5678923','R6789234'])&&same(tok('R2345678 R3456789\nR4567892').codes,['R2345678','R3456789','R4567892']));
check('RC-T utm_content is extracted with percent decoding and everything after # is ignored',same(tok('https://x.test/a?utm_campaign=fall&utm_content=R234%2D5678#utm_content=R3456789'),{codes:['R2345678'],dropped:0,truncated:false})&&same(tok('?utm_content=%52%32%33%34%35%36%37%38').codes,['R2345678']));
check('RC-T UTM_CONTENT= and Utm_Content= keys are extracted case-insensitively',same(tok('https://x.test/?UTM_CONTENT=R2345678').codes,['R2345678'])&&same(tok('utm_campaign=a&Utm_Content=r345-6789').codes,['R3456789']));
check('RC-T both utm_content values of two addresses in one cell are extracted',same(tok('https://x.test/?utm_content=R2345678 https://y.test/?utm_source=a&utm_content=R3456789').codes,['R2345678','R3456789']));
check('RC-T plain codes and addresses mix in cell order and a repeated code keeps its first position',same(tok('R3456789 https://x.test/?utm_content=R2345678, R3456789;R4567892').codes,['R3456789','R2345678','R4567892'])&&same(tok('https://x.test/?utm_content=R2345678 R3456789').codes,['R2345678','R3456789']));
check('RC-T store codes and garbage are dropped and counted',same(tok('C2345678, R2345678, 없음'),{codes:['R2345678'],dropped:2,truncated:false})&&same(tok('?utm_content=C2345678'),{codes:[],dropped:1,truncated:false})&&same(tok(''),{codes:[],dropped:0,truncated:false})&&same(tok(null),{codes:[],dropped:0,truncated:false}));
// 명세 2.3의 2: '='가 든 덩어리만 뺀다. 쿼리 없는 주소는 스킴이 있어도 '/'로 나눠 경로의 코드를 꺼낸다(스킴·호스트·경로 조각은 버린 수에 든다).
check('RC-T an address chunk without = is split on / like any other chunk, with or without a scheme',same(tok('https://brand.test/r/R2345678'),{codes:['R2345678'],dropped:3,truncated:false})&&same(tok('https://x.test/R2345678'),{codes:['R2345678'],dropped:2,truncated:false})&&same(tok('x.test/R2345678'),{codes:['R2345678'],dropped:1,truncated:false})&&same(tok('https://brand.test/r/R2345678').codes,tok('brand.test/r/R2345678').codes));
// 해석(명세 6.2 RC-T '# 뒤 무시'): '='가 든 주소는 '#' 앞에서만 utm_content를 찾는다. 해시 라우팅 주소의 조각 안 쿼리는 쿼리가 아니다.
check('RC-T a hash-route address keeps the fragment reading: utm_content after # is ignored and nothing is counted',same(tok('https://brand.test/#/apply?utm_content=R2345678'),{codes:[],dropped:0,truncated:false}));
check('RC-T a lone hyphen between codes normalizes to nothing and is not counted as dropped',same(tok('R2345678 - R3456789'),{codes:['R2345678','R3456789'],dropped:0,truncated:false}));
check('RC-T the sixth code is truncated',same(tok('R2345678,R3456789,R4567892,R5678923,R6789234,R7892345'),{codes:['R2345678','R3456789','R4567892','R5678923','R6789234'],dropped:0,truncated:true}));
check('RC-T recruitmentUtmQuery returns the query only with a campaign',rc.recruitmentUtmQuery({code:'R2345678',utmCampaign:'fall_expo'})==='utm_campaign=fall_expo&utm_content=R2345678'&&rc.recruitmentUtmQuery({code:'R2345678',utmCampaign:null})==='');

// ════ RC-D 발급 판정 ════
const OWNER={id:'u-owner',role:'owner'},ADMIN={id:'u-admin',role:'admin'},MEMBER={id:'u-member',role:'member'};
const TODAY='2026-10-10';
const CAMP={id:'c1',brandId:'b1',objective:'franchise_recruitment'},CONSUMER={id:'c2',brandId:'b1'},CAMP_B2={id:'c3',brandId:'b2',objective:'franchise_recruitment'};
const ASSET={id:'a1',version:2,brandId:'b1',status:'approved',reviewNeeded:false,current:true,type:'portal_intro'};
const EVENT={id:'e1',brandId:'b1',status:'scheduled'};
const ICTX={enabled:true,brandId:'b1',branch:'A',actor:OWNER,today:TODAY,campaign:null,asset:null,event:null,taken:{tracking:false,recruitment:false},candidate:'R2345678'};
const IIN={channel:'portal',label:'가상 포털 가을 배너'};
const issue=(input={},ctx={})=>rc.codeIssueDecision({...IIN,...input},{...ICTX,...ctx});
const d1=issue({validFrom:'2026-10-12',campaignId:'c1',assetRef:{id:'a1',version:2},eventId:'e1',utmCampaign:' Fall_Expo '},{campaign:CAMP,asset:ASSET,event:EVENT});
check('RC-D1 a full issue returns the fixed value shape',W(d1)&&eqv(d1.value,{code:'R2345678',channel:'portal',label:'가상 포털 가을 배너',validFrom:'2026-10-12',campaignId:'c1',assetRef:{id:'a1',version:2},eventId:'e1',utmCampaign:'fall_expo'}));
check('RC-D1 a minimal issue defaults validFrom to today and links to null; a custom code is normalized',eqv(issue().value,{code:'R2345678',channel:'portal',label:'가상 포털 가을 배너',validFrom:TODAY,campaignId:null,assetRef:null,eventId:null,utmCampaign:null})&&issue({customCode:'r345-6789'},{candidate:null}).value.code==='R3456789'&&OK(issue({},{actor:ADMIN})));
check('RC-D1 a label is NFC-trimmed and a missing server candidate fails closed',issue({label:'  가상 라벨  '}).value.label==='가상 라벨'&&is(issue({},{candidate:null}),'invalid_input')&&is(issue({},{candidate:'C2345678'}),'invalid_input'));
check('RC-D1 an asset of another type than the channel gives asset_channel_mismatch',W(issue({channel:'expo',assetRef:{id:'a1',version:2}},{asset:ASSET}),'asset_channel_mismatch')&&W(issue({channel:'portal',assetRef:{id:'a1',version:2}},{asset:{...ASSET,type:'startup_page'}})));
check('RC-D2 switch off is 409 before the role check (even for a member with bad input)',is(issue({channel:'nope'},{enabled:false,actor:MEMBER}),'switch_off')&&issue({},{enabled:false}).status===409&&is(issue({},{enabled:'true'}),'switch_off'));
check('RC-D3 a member is 403 (rejection case: permission) and a malformed actor is 403',is(issue({},{actor:MEMBER}),'role_forbidden')&&is(issue({},{actor:null}),'role_forbidden')&&is(issue({},{actor:{id:'',role:'owner'}}),'role_forbidden'));
check('RC-D4 branch B, C, undetermined and missing are 409 branch_not_a',['B','C','undetermined',null,'a'].every(branch=>is(issue({},{branch}),'branch_not_a')));
check('RC-D5 a value taken by a store tracking code or a recruitment code is 409 code_taken',is(issue({},{taken:{tracking:true,recruitment:false}}),'code_taken')&&is(issue({},{taken:{tracking:false,recruitment:true}}),'code_taken')&&is(issue({customCode:'R3456789'},{taken:{tracking:true,recruitment:true}}),'code_taken'));
const d=n=>fr.addDays(TODAY,n);
check('RC-D6 validFrom boundaries: today-90 and today+180 accepted, -91 and +181 are 400',issue({validFrom:d(-90)}).value.validFrom===d(-90)&&issue({validFrom:d(180)}).value.validFrom===d(180)&&is(issue({validFrom:d(-91)}),'valid_from_out_of_range')&&is(issue({validFrom:d(181)}),'valid_from_out_of_range')&&is(issue({validFrom:'2026-02-30'}),'valid_from_invalid')&&is(issue({validFrom:'2026-10-10T00:00:00Z'}),'valid_from_invalid'));
const lp=issue({label:'가상 담당 010-0000-0101'});
check('RC-D7 a phone number in the label is 400 label_pii and no message holds the value',is(lp,'label_pii')&&!JSON.stringify(plain(lp)).includes('0101')&&is(issue({label:'연락 lead.one@example.com'}),'label_pii'));
check('RC-D7 label length and control characters are 400 label_invalid',is(issue({label:''}),'label_invalid')&&is(issue({label:'   '}),'label_invalid')&&is(issue({label:'가'.repeat(61)}),'label_invalid')&&OK(issue({label:'가'.repeat(60)}))&&is(issue({label:'가상\u0007라벨'}),'label_invalid')&&is(issue({label:'가상\u200b라벨'}),'label_invalid')&&is(issue({label:5}),'label_invalid'));
check('RC-D8 campaign of another brand is 400, a non-recruitment campaign 409, a cancelled event 409',is(issue({campaignId:'c3'},{campaign:CAMP_B2}),'campaign_other_brand')&&is(issue({campaignId:'c9'},{campaign:null}),'campaign_other_brand')&&is(issue({campaignId:'c2'},{campaign:CONSUMER}),'campaign_not_recruitment')&&is(issue({eventId:'e1'},{event:{...EVENT,status:'cancelled'}}),'event_cancelled')&&is(issue({eventId:'e1'},{event:{...EVENT,brandId:'b2'}}),'event_other_brand')&&is(issue({eventId:'e2'},{event:EVENT}),'event_other_brand'));
const AREF={assetRef:{id:'a1',version:2}};
check('RC-D8b asset: draft and retired 409 asset_not_approved, review 409 asset_review_needed, old version 409 asset_superseded, approved current 200',is(issue(AREF,{asset:{...ASSET,status:'draft'}}),'asset_not_approved')&&is(issue(AREF,{asset:{...ASSET,status:'retired'}}),'asset_not_approved')&&is(issue(AREF,{asset:{...ASSET,reviewNeeded:true}}),'asset_review_needed')&&is(issue(AREF,{asset:{...ASSET,current:false}}),'asset_superseded')&&OK(issue(AREF,{asset:ASSET})));
check('RC-D8b asset of another brand or a missing asset is 400 asset_other_brand; a bad ref is invalid_input',is(issue(AREF,{asset:{...ASSET,brandId:'b2'}}),'asset_other_brand')&&is(issue(AREF,{asset:null}),'asset_other_brand')&&is(issue({assetRef:{id:'a1',version:1}},{asset:ASSET}),'asset_other_brand')&&is(issue({assetRef:{id:'a1',version:0}}),'invalid_input')&&is(issue({assetRef:'a1'}),'invalid_input'));
check('RC-D input errors: channel, code format, utm_campaign, unknown keys and prototype keys never throw',is(issue({channel:'naver_place'}),'channel_unknown')&&is(issue({customCode:'C2345678'}),'code_format')&&is(issue({customCode:'R23456789'}),'code_format')&&is(issue({utmCampaign:'가을 박람회'}),'utm_campaign_invalid')&&is(issue({utmCampaign:'a'.repeat(61)}),'utm_campaign_invalid')&&is(issue({extra:1}),'invalid_input')&&is(rc.codeIssueDecision(JSON.parse('{"channel":"portal","label":"가상","__proto__":{"x":1}}'),ICTX),'invalid_input')&&is(rc.codeIssueDecision({channel:'portal',label:'가상',constructor:1},ICTX),'invalid_input')&&is(rc.codeIssueDecision(null,ICTX),'invalid_input')&&is(rc.codeIssueDecision([],ICTX),'invalid_input'));
check('RC-D a stage returns all its codes sorted and stops (input before state)',is(issue({channel:'x',label:'',customCode:'bad'},{branch:'B',taken:{tracking:true,recruitment:false}}),'channel_unknown','code_format','label_invalid')&&is(issue({campaignId:'c2',...AREF},{branch:'B',campaign:CONSUMER,asset:{...ASSET,status:'draft',reviewNeeded:true},taken:{tracking:true,recruitment:false}}),'asset_not_approved','asset_review_needed','branch_not_a','campaign_not_recruitment','code_taken'));
check('RC-D malformed context fails closed without throwing',is(rc.codeIssueDecision(IIN,null),'switch_off')&&is(issue({},{today:'2026-13-01'}),'invalid_input')&&is(issue({},{taken:null}),'invalid_input'));
// 명세 3.2 상태표 전수(RC-D9).
const SPEC_STATUS={
 400:['invalid_input','channel_unknown','code_format','valid_from_invalid','valid_from_out_of_range','retire_date_invalid','label_invalid','label_pii','utm_campaign_invalid','campaign_other_brand','asset_other_brand','event_other_brand','period_invalid','period_future','period_too_long','amount_negative','amount_invalid','vat_invalid','original_invalid','funding_invalid','ad_fund_forbidden','referral_reward_forbidden','evidence_required','evidence_pii','platform_metric_invalid','void_reason_invalid'],
 403:['role_forbidden'],
 409:['switch_off','branch_not_a','campaign_not_recruitment','asset_not_approved','asset_review_needed','asset_superseded','event_cancelled','code_taken','code_already_retired','spend_already_voided','spend_possible_duplicate','spend_period_overlap','spend_referenced','spend_replace_invalid'],
 200:['asset_channel_mismatch','clicks_exceed_impressions','search_ad_manual','agency_fee_wording','duplicate_acknowledged'],
};
const specMap=Object.fromEntries(Object.entries(SPEC_STATUS).flatMap(([s,cs])=>cs.map(c=>[c,Number(s)])));
check('RC-D9 the status table equals spec 3.2 code by code (one status per stage)',eqv(rc.RECRUITMENT_CODE_STATUS,specMap)&&same([...rc.RECRUITMENT_WARNING_CODES].sort(asc),[...SPEC_STATUS[200]].sort(asc)));

// ════ RC-R 사용 중지 ════
const STORED={code:'R2345678',validFrom:'2026-10-01',retiredOn:null};
const RCTX={actor:OWNER,today:TODAY,enabled:true};
const retire=(input={},ctx={},code=STORED)=>rc.codeRetireDecision(code,input,{...RCTX,...ctx});
check('RC-R today is 200 (default and explicit)',OK(retire())&&retire().value.retiredOn===TODAY&&retire({retiredOn:TODAY}).value.retiredOn===TODAY&&retire({retiredOn:d(180)}).value.retiredOn===d(180));
check('RC-R yesterday is 400 retire_date_invalid (no backdating)',is(retire({retiredOn:d(-1)}),'retire_date_invalid'));
check('RC-R a date before validFrom is 400 and validFrom itself is 200',is(retire({retiredOn:TODAY},{},{...STORED,validFrom:'2026-10-20'}),'retire_date_invalid')&&retire({retiredOn:'2026-10-20'},{},{...STORED,validFrom:'2026-10-20'}).value.retiredOn==='2026-10-20'&&is(retire({},{},{...STORED,validFrom:'2026-10-20'}),'retire_date_invalid'));
check('RC-R today+181 is 400 and a malformed date is 400',is(retire({retiredOn:d(181)}),'retire_date_invalid')&&is(retire({retiredOn:'2026/10/10'}),'retire_date_invalid')&&is(retire({when:TODAY}),'invalid_input'));
check('RC-R an already retired code is 409',is(retire({},{},{...STORED,retiredOn:'2026-10-09'}),'code_already_retired'));
check('RC-R a member is 403 (rejection case: permission) and switch off is still 200',is(retire({},{actor:MEMBER}),'role_forbidden')&&OK(retire({},{enabled:false}))&&OK(retire({},{actor:ADMIN})));
check('RC-R a malformed stored code fails closed',is(retire({},{},{code:'C2345678',validFrom:'2026-10-01',retiredOn:null}),'invalid_input')&&is(retire({},{},null),'invalid_input'));

// ════ RA 귀속 ════
const C=(code,x)=>({code,brandId:'b1',channel:'portal',validFrom:'2026-10-01',createdAt:'2026-09-30T00:00:00Z',retiredOn:null,retiredAt:null,campaignId:null,assetRef:null,eventId:null,...x});
const cA=C('R2345678',{campaignId:'c1',assetRef:{id:'a1',version:1}}),cB=C('R3456789',{channel:'expo',validFrom:'2026-10-06',eventId:'e1'}),cX=C('R4567892',{brandId:'b2'});
const cR=C('R5678923',{channel:'lead_ad',validFrom:'2026-09-01',retiredOn:'2026-10-08',retiredAt:'2026-10-07T01:00:00Z'}),cK=C('R6789234',{channel:'search_ad'}),cA2=C('R7892345',{campaignId:'c1',assetRef:{id:'a1',version:1}});
const UNKNOWN='R8923456';
const BOOK={codes:[cA,cB,cX,cR,cK,cA2],tracking:[{value:'R6789234',createdAt:'2026-09-01T00:00:00Z'}]};
const T0='2026-10-06T01:00:00Z';
const L=(codes,x={})=>({brandId:'b1',receivedAt:T0,codes:codes.map(c=>typeof c==='string'?{code:c,at:T0}:c),strikes:[],...x});
const att=(lead,book=BOOK,opts)=>plain(rc.attributeLead(lead,book,opts));
check('RA-1 the first valid code wins and reversing the order changes the result',att(L(['R2345678','R3456789'])).channel==='portal'&&att(L(['R3456789','R2345678'])).channel==='expo');
check('RA-1 the attributed value carries channel, campaign, asset, event and flags',eqv(att(L(['R2345678','R3456789'])),{state:'attributed',basis:'code',code:'R2345678',channel:'portal',campaignId:'c1',assetRef:{id:'a1',version:1},eventId:null,alsoMatched:1,retroactive:false,late:false})&&att(L(['R3456789'])).eventId==='e1');
const early='2026-10-05T01:00:00Z';
check('RA-2 leading invalid tokens (unregistered, other brand, before validFrom) are skipped',att(L([UNKNOWN,'R4567892','R3456789','R2345678'],{receivedAt:early})).code==='R2345678');
check('RA-3 14:59:59Z (KST 23:59 on 10-05) is before validFrom 10-06 and 15:00:00Z is attributed',att(L(['R3456789'],{receivedAt:'2026-10-05T14:59:59Z'})).reason==='before_valid_from'&&att(L(['R3456789'],{receivedAt:'2026-10-05T15:00:00Z'})).code==='R3456789');
check('RA-4 no code is unattributed no_code labelled 유입 미확인',eqv(att(L([])),{state:'unattributed',reason:'no_code'})&&eqv(rc.attributionLabel(att(L([]))),{label:'유입 미확인',detail:'코드 없음'})&&rc.UNATTRIBUTED_LABEL==='유입 미확인');
// RA-9(R5b-2, 명세 2.7.3·Q-R5-2 권고안): 코드 귀속을 먼저 쓰고, 코드가 없는(또는 모두 무효인) 가져온 리드만 제공처 파일 기준으로 가져오기 채널에 따로 센다. 충돌은 그대로다.
const IMP={importId:'ri-1',channel:'portal',eventId:null};
check('RA-9 a code-less imported lead is attributed on the provider-file basis to the import channel',eqv(att(L([],{import:IMP})),{state:'attributed',basis:'import',channel:'portal',importId:'ri-1',eventId:null})&&eqv(att(L([UNKNOWN],{import:{...IMP,channel:'expo',eventId:'e9'}})),{state:'attributed',basis:'import',channel:'expo',importId:'ri-1',eventId:'e9'}));
check('RA-9 a valid code wins over the import and a conflict stays a conflict',att(L(['R3456789'],{import:IMP})).basis==='code'&&att(L(['R3456789'],{import:IMP})).channel==='expo'&&att(L(['R6789234'],{import:IMP})).state==='conflict');
check('RA-9 an import with an unknown channel or no import id falls back to 유입 미확인',att(L([],{import:{...IMP,channel:'naver_place'}})).state==='unattributed'&&att(L([],{import:{...IMP,importId:''}})).state==='unattributed'&&att(L([],{import:null})).reason==='no_code');
check('RA-9 the label is 제공처 파일 기준 · the channel and the import id enters the attribution inputs',eqv(rc.attributionLabel(att(L([],{import:IMP}))),{label:'제공처 파일 기준 · 창업 포털',detail:null})&&rc.FILE_BASIS_LABEL==='제공처 파일 기준'&&rc.attributionInputs({...L([],{import:IMP}),id:'l1'},BOOK).includes('import:ri-1')&&!rc.attributionInputs({...L([]),id:'l1'},BOOK).some(x=>x.startsWith('import:')));
const reason=codes=>att(L(codes,{receivedAt:'2026-10-08T03:00:00Z'})).reason;
const cBlate=C('R9234567',{validFrom:'2026-10-20'});
const bookP={...BOOK,codes:[...BOOK.codes,cBlate]};
const reasonP=codes=>att(L(codes,{receivedAt:'2026-10-08T03:00:00Z'}),bookP).reason;
check('RA-5 reason priority is before_valid_from, after_retired, other_brand, unknown_code in any order',reason([UNKNOWN])==='unknown_code'&&reason([UNKNOWN,'R4567892'])==='other_brand'&&reason(['R4567892',UNKNOWN])==='other_brand'&&reason([UNKNOWN,'R4567892','R5678923'])==='after_retired'&&reasonP(['R5678923',UNKNOWN,'R9234567','R4567892'])==='before_valid_from'&&reasonP([UNKNOWN,'R9234567'])==='before_valid_from');
check('RA-5 reason labels are the fixed Korean details',['before_valid_from','after_retired','other_brand','unknown_code','no_code'].map(r=>rc.attributionLabel({state:'unattributed',reason:r}).detail).join('|')==='적용 시작일 전 접수|사용 중지 뒤 접수|다른 브랜드 코드|등록되지 않은 코드|코드 없음');
check('RA-6 a deciding token equal to a store code value is conflict and does not fall through',eqv(att(L(['R6789234','R2345678'])),{state:'conflict',code:'R6789234'})&&eqv(rc.attributionLabel({state:'conflict',code:'R6789234'}),{label:'유입 미확인',detail:'점포 코드와 같은 값'}));
check('RA-7 a valid earlier token is not changed by a later conflict token',att(L(['R2345678','R6789234'])).state==='attributed'&&att(L(['R2345678','R6789234'])).code==='R2345678');
const bookT={codes:[C('R2345678',{campaignId:'c1',assetRef:{id:'a1',version:1}}),C('R3456789',{campaignId:'c2',assetRef:{id:'a1',version:1}}),C('R4567892',{campaignId:'c1',assetRef:{id:'a1',version:2}}),C('R5678923',{campaignId:'c1',assetRef:{id:'a1',version:1}})],tracking:[]};
check('RA-8 on the same channel a later token counts only when its campaign or asset version differs',att(L(['R2345678','R3456789']),bookT).alsoMatched===1&&att(L(['R2345678','R4567892']),bookT).alsoMatched===1&&att(L(['R2345678','R5678923']),bookT).alsoMatched===0&&att(L(['R2345678','R3456789','R4567892','R5678923']),bookT).alsoMatched===2);
check('RA-8 alsoMatched counts later valid tokens that point elsewhere',att(L(['R2345678','R3456789','R7892345'])).alsoMatched===1&&att(L(['R2345678','R7892345'])).alsoMatched===0&&att(L(['R2345678',UNKNOWN])).alsoMatched===0&&att(L(['R2345678','R3456789','R5678923'])).alsoMatched===2);
const AS='2026-10-07T00:00:00Z',AFTER='2026-10-07T06:00:00Z';
const bookAs={codes:[...BOOK.codes,C('R9234567',{createdAt:AFTER})],tracking:[...BOOK.tracking,{value:'R2345678',createdAt:AFTER}]};
check('RA-10 a lead token added after asOf does not count',att(L([{code:'R2345678',at:AFTER}]),BOOK,{asOf:AS}).reason==='no_code'&&att(L([{code:'R2345678',at:AFTER}]),BOOK).state==='attributed');
check('RA-10 a recruitment code created after asOf does not exist yet',att(L(['R9234567']),bookAs,{asOf:AS}).reason==='unknown_code'&&att(L(['R9234567']),bookAs).state==='attributed');
check('RA-10 a store code created after asOf is not a conflict yet',att(L(['R2345678']),bookAs,{asOf:AS}).state==='attributed'&&att(L(['R2345678']),bookAs).state==='conflict');
check('RA-10 a strike after asOf is ignored at asOf',att(L(['R2345678','R3456789'],{strikes:[{code:'R2345678',at:AFTER}]}),BOOK,{asOf:AS}).code==='R2345678'&&att(L(['R2345678','R3456789'],{strikes:[{code:'R2345678',at:AFTER}]})).code==='R3456789');
const recvR='2026-10-08T01:00:00Z',cRlate=C('R5678923',{channel:'lead_ad',validFrom:'2026-09-01',retiredOn:'2026-10-08',retiredAt:'2026-10-09T00:00:00Z'});
check('RA-10 a retirement recorded after asOf does not apply at asOf',att(L(['R5678923'],{receivedAt:recvR}),{codes:[cRlate],tracking:[]},{asOf:'2026-10-08T12:00:00Z'}).state==='attributed'&&att(L(['R5678923'],{receivedAt:recvR}),{codes:[cRlate],tracking:[]}).reason==='after_retired');
const LI=L(['R2345678','R3456789'],{id:'lead-1',strikes:[{code:'R3456789',at:'2026-10-06T02:00:00Z'}]});
const in1=plain(rc.attributionInputs(LI,BOOK,{asOf:AS}));
const LI2={...LI,codes:[...LI.codes,{code:'R9234567',at:AFTER}],strikes:[...LI.strikes,{code:'R2345678',at:AFTER}]};
check('RA-10 attributionInputs is a sorted stable list and records after asOf do not change it',same(plain(rc.attributionInputs(LI,BOOK,{asOf:AS})),in1)&&same(in1,[...in1].sort(asc))&&in1.includes('lead:lead-1')&&same(plain(rc.attributionInputs(LI2,bookAs,{asOf:AS})),in1)&&!same(plain(rc.attributionInputs(LI2,bookAs)),in1)&&!same(plain(rc.attributionInputs({...LI,id:'lead-2'},BOOK,{asOf:AS})),in1));
const bookIn={codes:[C('R2345678'),C('R4567892',{brandId:'b2'}),C('R8923456')],tracking:[{value:'R7892345',createdAt:'2026-09-01T00:00:00Z'}]};
check('RA-10 attributionInputs lists only records for the lead tokens (no unrelated code, other-brand code or tracking value)',same(plain(rc.attributionInputs({id:'lead-1',brandId:'b1',receivedAt:T0,codes:[{code:'R2345678',at:T0}],strikes:[]},bookIn)),['code:R2345678@2026-09-30T00:00:00Z','lead:lead-1','token:R2345678@2026-10-06T01:00:00Z']));
check('RA-11 striking the first token lets the next token decide; striking all gives no_code',att(L(['R2345678','R3456789'],{strikes:[{code:'R2345678',at:T0}]})).code==='R3456789'&&att(L(['R2345678','R3456789'],{strikes:[{code:'R2345678',at:T0},{code:'r345-6789',at:T0}]})).reason==='no_code');
check('RA-12 retiredOn 10-08: received the day before is attributed, received that day is after_retired',att(L(['R5678923'],{receivedAt:'2026-10-07T14:59:59Z'})).code==='R5678923'&&att(L(['R5678923'],{receivedAt:'2026-10-07T15:00:00Z'})).reason==='after_retired');
const cLate=C('R2345678',{createdAt:'2026-10-06T00:00:00Z'});
const H=3600000,at=ms=>new Date(Date.parse(T0)+ms).toISOString();
check('RA-13 a code created after the token was written is retroactive',att(L([{code:'R2345678',at:'2026-10-05T23:00:00Z'}],{receivedAt:'2026-10-05T22:00:00Z'}),{codes:[cLate],tracking:[]}).retroactive===true&&att(L(['R2345678']),{codes:[cLate],tracking:[]}).retroactive===false);
const tEq='2026-10-06T00:00:00Z';
check('RA-13 a code created at the same instant the token was written is not retroactive (only later is)',att(L([{code:'R2345678',at:tEq}],{receivedAt:'2026-10-05T22:00:00Z'}),{codes:[C('R2345678',{createdAt:tEq})],tracking:[]}).retroactive===false&&att(L([{code:'R2345678',at:tEq}],{receivedAt:'2026-10-05T22:00:00Z'}),{codes:[C('R2345678',{createdAt:'2026-10-06T00:00:01Z'})],tracking:[]}).retroactive===true);
check('RA-13 exactly 72 hours is not late, 72 hours and 1 second is late, an import token is never late',att(L([{code:'R2345678',at:at(72*H)}])).late===false&&att(L([{code:'R2345678',at:at(72*H+1000)}])).late===true&&att(L([{code:'R2345678',at:at(500*H),source:'import'}])).late===false&&att(L([{code:'R2345678',at:at(500*H),source:'manual'}])).late===true&&rc.LATE_TOKEN_HOURS===72);
check('RA-13 badges are shown as the attributed detail',eqv(rc.attributionLabel({state:'attributed',basis:'code',code:'R2345678',channel:'expo',campaignId:null,assetRef:null,eventId:null,alsoMatched:0,retroactive:true,late:true}),{label:'박람회',detail:'소급 등록 코드 · 접수 72시간 뒤 입력'})&&eqv(rc.attributionLabel(att(L(['R2345678']))),{label:'창업 포털',detail:null}));
check('RA receivedAtOf uses receivedAt for imported leads and createdAt otherwise',rc.receivedAtOf({receivedAt:'2026-10-01T00:00:00Z',createdAt:'2026-10-09T00:00:00Z'})==='2026-10-01T00:00:00Z'&&rc.receivedAtOf({createdAt:'2026-10-09T00:00:00Z'})==='2026-10-09T00:00:00Z');
check('RA the attribution note and the codes being normalized',rc.RECRUITMENT_ATTRIBUTION_NOTE.startsWith('귀속≠증분')&&att(L(['r234-5678'])).code==='R2345678'&&att(L([{code:5,at:T0}])).reason==='no_code');

// ════ RS 비용 ════
const SIN={channel:'portal',date:'2026-10-01',amount:500000,vat:'excluded',funding:'hq_budget',evidence:'관리 화면 월 소진 내역'};
const SCTX={enabled:true,brandId:'b1',actor:OWNER,today:TODAY,campaign:null,asset:null,existing:[],replaces:null};
const spend=(input={},ctx={})=>rc.spendDecision({...SIN,...input},{...SCTX,...ctx});
const drop=(k,x={})=>{const o={...SIN,...x};delete o[k];return rc.spendDecision(o,SCTX)};
const s0=spend();
check('RS success value: date becomes a one-day period, amountExVat, nulls for unknown platform metrics',OK(s0)&&eqv(s0.value,{channel:'portal',period:{from:'2026-10-01',to:'2026-10-01'},amount:500000,vat:'excluded',amountExVat:500000,funding:'hq_budget',evidence:'관리 화면 월 소진 내역',original:null,campaignId:null,assetRef:null,platform:{impressions:null,clicks:null,formSubmits:null},platformNote:rc.PLATFORM_REPORTED_NOTE,replaces:null,duplicates:[]}));
check('RS-1 a missing channel or date/period is 400',is(drop('channel'),'channel_unknown')&&is(drop('date'),'period_invalid'));
check('RS-2 a missing amount or vat is 400',is(drop('amount'),'amount_invalid')&&is(drop('vat'),'vat_invalid'));
check('RS-3 a missing funding source is 400',is(drop('funding'),'funding_invalid'));
check('RS-4 a missing evidence label is 400 and date plus period together is 400',is(drop('evidence'),'evidence_required')&&is(spend({period:{from:'2026-10-01',to:'2026-10-02'}}),'period_invalid')&&is(spend({evidence:''}),'evidence_required')&&is(spend({evidence:'가'.repeat(201)}),'evidence_required')&&OK(spend({evidence:'가'.repeat(200)}))&&is(spend({evidence:'내역\u0000'}),'evidence_required'));
check('RS-5 -1 is amount_negative; 1.5, "1000", NaN are amount_invalid; 0 is 200',is(spend({amount:-1}),'amount_negative')&&is(spend({amount:1.5}),'amount_invalid')&&is(spend({amount:'1000'}),'amount_invalid')&&is(spend({amount:NaN}),'amount_invalid')&&is(spend({amount:Infinity}),'amount_invalid')&&OK(spend({amount:0}))&&OK(spend({amount:1e11}))&&is(spend({amount:1e11+1}),'amount_invalid'));
check('RS-5b vat included 11000 gives 10000 and 11001 gives 10000 (floor)',spend({vat:'included',amount:11000}).value.amountExVat===10000&&spend({vat:'included',amount:11001}).value.amountExVat===10000&&spend({vat:'included',amount:11000}).value.amount===11000&&spend({vat:'included',amount:1e11}).value.amountExVat===90909090909);
check('RS-5b another vat value is 400 and a bad original is 400',is(spend({vat:'none'}),'vat_invalid')&&is(spend({original:{currency:'KRW',amount:'10'}}),'original_invalid')&&is(spend({original:{currency:'usd',amount:'10'}}),'original_invalid')&&is(spend({original:{currency:'USD',amount:'1.234'}}),'original_invalid')&&is(spend({original:{currency:'USD',amount:'1',x:1}}),'original_invalid')&&eqv(spend({original:{currency:'USD',amount:'12.50'}}).value.original,{currency:'USD',amount:'12.50'}));
// 외화 원금은 원화 소진액이 있는 외화 청구에만 적는다(명세 2.5 '외화 청구일 때만'). 0원 행에 외화 금액을 실으면 원장 비용이 0으로 줄어든다.
check('RS-5b a 0-won row with a foreign-currency original is 400 original_invalid; a charged row with an original and a 0-won row without one are 200',is(spend({amount:0,original:{currency:'USD',amount:'1000'}}),'original_invalid')&&OK(spend({amount:650000,original:{currency:'USD',amount:'500.00'}}))&&OK(spend({amount:0}))&&rc.RECRUITMENT_MESSAGES.original_invalid.includes('원화 금액이 0이면 외화 원금을 적지 않습니다'));
check('RS-6 ad_fund is 400 and hq_budget with 광고 분담금 wording is 400',is(spend({funding:'ad_fund'}),'ad_fund_forbidden')&&is(spend({evidence:'광고 분담금 정산'}),'ad_fund_forbidden')&&is(spend({funding:'store'}),'funding_invalid'));
check('RS-6b wording both ways: disguised ad-fund phrases are 400, harmless phrases are 200',['광.고.분.담.금','점주 부담 광고비','판촉비 분담','Ad Fund','광고기금','공동 광고 정산','애드 펀드'].every(e=>is(spend({evidence:e}),'ad_fund_forbidden'))&&['분담금 없음(본부 전액 부담)','월 광고비 소진'].every(e=>OK(spend({evidence:e}))));
const AD=['광고분담금','판촉분담금','광고비분담','판촉비분담','광고기금','판촉기금','공동광고','점주부담광고','가맹점부담광고','점주분담','가맹점분담','adfund','애드펀드'];
check('RS-6b the ad-fund term list is the spec list in order; every spaced term and a full-width phrase alone give 400 ad_fund_forbidden',same(rc.AD_FUND_TERMS,AD)&&['판촉 분담금','광고비 분담','판촉 기금','가맹점 부담 광고','점주 분담','가맹점 분담','판촉비 분담','광고 기금','공동 광고','점주 부담 광고','광고 분담금'].every(t=>is(spend({evidence:t+' 정산'}),'ad_fund_forbidden'))&&is(spend({evidence:'ＡＤ　ＦＵＮＤ 정산'}),'ad_fund_forbidden'));
check('RS-6c owner_referral amount 1 is 400 referral_reward_forbidden, amount 0 is 200',is(spend({channel:'owner_referral',amount:1}),'referral_reward_forbidden')&&OK(spend({channel:'owner_referral',amount:0})));
check('RS-6c owner_referral amount 0 carrying a foreign-currency original is still a monetary reward: 400 referral_reward_forbidden',is(spend({channel:'owner_referral',amount:0,original:{currency:'USD',amount:'500.00'}}),'referral_reward_forbidden'));
check('RS-6c the agency-fee term list is the spec list and each term alone warns exactly agency_fee_wording',same(rc.AGENCY_FEE_TERMS,['영업대행','분양대행','성과수수료','성공보수','커미션','commission'])&&['영업대행 비용','분양대행 비용','성과 수수료 정산','성공보수 지급','커미션 정산','COMMISSION 정산'].every(e=>W(spend({evidence:e}),'agency_fee_wording')));
check('RS-6c agency-fee wording is 200 with agency_fee_wording',W(spend({evidence:'분양대행 성과 수수료'}),'agency_fee_wording')&&W(spend({evidence:'Commission 정산'}),'agency_fee_wording'));
check('RS-7 platform metrics stay null when unknown and are never zero-filled',eqv(spend({platform:{impressions:1200}}).value.platform,{impressions:1200,clicks:null,formSubmits:null})&&eqv(spend({platform:{impressions:null,clicks:0,formSubmits:3}}).value.platform,{impressions:null,clicks:0,formSubmits:3}));
check('RS-7 -1 and 1.2 metrics are 400 and clicks above impressions is a warning',is(spend({platform:{clicks:-1}}),'platform_metric_invalid')&&is(spend({platform:{impressions:1.2}}),'platform_metric_invalid')&&is(spend({platform:{reach:1}}),'platform_metric_invalid')&&is(spend({platform:5}),'platform_metric_invalid')&&W(spend({platform:{impressions:10,clicks:11}}),'clicks_exceed_impressions')&&W(spend({platform:{impressions:null,clicks:11}})));
check('RS-7 clicks equal to impressions is not a warning (only clicks above impressions)',W(spend({platform:{impressions:10,clicks:10}}))&&W(spend({platform:{impressions:0,clicks:0}})));
check('RS-8 an asset of another brand is 400 and a channel mismatch is a warning',is(spend(AREF,{asset:{...ASSET,brandId:'b2'}}),'asset_other_brand')&&W(spend({...AREF,channel:'expo'},{asset:ASSET}),'asset_channel_mismatch')&&W(spend(AREF,{asset:ASSET})));
check('RS-8b draft and retired 409 asset_not_approved, review 409 asset_review_needed, old version 409 asset_superseded',is(spend(AREF,{asset:{...ASSET,status:'draft'}}),'asset_not_approved')&&is(spend(AREF,{asset:{...ASSET,status:'retired'}}),'asset_not_approved')&&is(spend(AREF,{asset:{...ASSET,reviewNeeded:true}}),'asset_review_needed')&&is(spend(AREF,{asset:{...ASSET,current:false}}),'asset_superseded'));
check('RS campaign links: recruitment campaign 200, consumer 409, other brand 400',spend({campaignId:'c1'},{campaign:CAMP}).value.campaignId==='c1'&&is(spend({campaignId:'c2'},{campaign:CONSUMER}),'campaign_not_recruitment')&&is(spend({campaignId:'c3'},{campaign:CAMP_B2}),'campaign_other_brand'));
check('RS-9 the stored value carries the platform-reported note',spend({platform:{formSubmits:4}}).value.platformNote==='플랫폼 보고, 원장 리드 아님'&&rc.PLATFORM_REPORTED_NOTE==='플랫폼 보고, 원장 리드 아님');
const ROW=(id,channel,from,to,amount,x={})=>({id,version:1,brandId:'b1',channel,period:{from,to},amountExVat:amount,createdAt:'2026-10-01T00:00:00Z',voided:null,...x});
const ROWS=[ROW('s1','portal','2026-10-05','2026-10-06',100000),ROW('s2','portal','2026-10-01','2026-10-31',310000),ROW('s3','portal','2026-10-07','2026-10-07',50000,{voided:{at:'2026-10-08T00:00:00Z',reason:'entry_error'}}),ROW('s4','search_ad','2026-09-01','2026-09-30',90000),ROW('s5','expo','2026-10-06','2026-10-06',0)];
const win=plain(rc.spendInWindow(ROWS,'2026-10-05','2026-10-11'));
check('RS-10 only rows fully inside the window are summed, straddling rows are separate, voided rows are excluded, nothing is prorated',same(win.included.map(r=>r.id),['s1','s5'])&&same(win.straddling.map(r=>r.id),['s2'])&&win.byChannel.portal.total===100000&&same(win.inputs,['s1@1','s2@1','s5@1']));
check('RS-10b byChannel holds {total,rowCount,straddlingCount} only for channels with rows (unknown is not zero)',eqv(win.byChannel,{portal:{total:100000,rowCount:1,straddlingCount:1},expo:{total:0,rowCount:1,straddlingCount:0}})&&!('search_ad' in win.byChannel)&&rc.NO_PRORATION_NOTE.includes('일할하지 않습니다'));
const win1=rows=>plain(rc.spendInWindow(rows,'2026-10-05','2026-10-11'));
const wR=win1([ROW('right','portal','2026-10-10','2026-10-20',200000)]),wL=win1([ROW('left','portal','2026-09-28','2026-10-06',30000)]),wE=win1([ROW('last','portal','2026-10-11','2026-10-11',7),ROW('lastover','portal','2026-10-11','2026-10-12',9)]);
check('RS-10 a row crossing only the right or only the left window edge is straddling and never summed',same(wR.included,[])&&same(wR.straddling.map(r=>r.id),['right'])&&eqv(wR.byChannel,{portal:{total:0,rowCount:0,straddlingCount:1}})&&same(wL.included,[])&&same(wL.straddling.map(r=>r.id),['left'])&&eqv(wL.byChannel,{portal:{total:0,rowCount:0,straddlingCount:1}}));
check('RS-10b a row on the last day of the window is included and a row starting that day and running past it is straddling',same(wE.included.map(r=>r.id),['last'])&&same(wE.straddling.map(r=>r.id),['lastover'])&&eqv(wE.byChannel,{portal:{total:7,rowCount:1,straddlingCount:1}})&&same(wE.inputs,['last@1','lastover@1']));
check('RS-11 search_ad gives the manual-entry warning',W(spend({channel:'search_ad'}),'search_ad_manual'));
check('RS-12 a future period is 400, from after to is 400, 367 days is 400 (366 is 200)',is(spend({date:undefined,period:{from:'2026-10-01',to:d(1)}}),'period_future')&&is(spend({date:d(1)}),'period_future')&&is(spend({date:undefined,period:{from:'2026-10-05',to:'2026-10-01'}}),'period_invalid')&&is(spend({date:undefined,period:{from:'2025-10-09',to:TODAY}}),'period_too_long')&&OK(spend({date:undefined,period:{from:'2025-10-10',to:TODAY}}))&&is(spend({date:'2026-02-30'}),'period_invalid')&&is(spend({date:undefined,period:{from:'2026-10-01'}}),'period_invalid'));
const VCTX={actor:OWNER,referencedBy:0,enabled:true};
const vd=(row,input,ctx={})=>rc.spendVoidDecision(row,input,{...VCTX,...ctx});
const LIVE={id:'s1',voided:null};
check('RS-13 void reasons: other values and replaced are 400, voided rows 409, switch off allowed, a member is 403 (rejection case: permission)',eqv(vd(LIVE,{reason:'refunded'}).value,{reason:'refunded'})&&OK(vd(LIVE,{reason:'entry_error'}))&&OK(vd(LIVE,{reason:'duplicate'}))&&is(vd(LIVE,{reason:'mistake'}),'void_reason_invalid')&&is(vd(LIVE,{reason:'replaced'}),'void_reason_invalid')&&is(vd(LIVE,{}),'void_reason_invalid')&&is(vd({id:'s1',voided:{at:'2026-10-08T00:00:00Z',reason:'duplicate'}},{reason:'duplicate'}),'spend_already_voided')&&OK(vd(LIVE,{reason:'duplicate'},{enabled:false}))&&is(vd(LIVE,{reason:'duplicate'},{actor:MEMBER}),'role_forbidden')&&is(vd(LIVE,{reason:'duplicate',x:1}),'invalid_input')&&is(vd(null,{reason:'duplicate'}),'invalid_input'));
check('RS-13b a row referenced by an event is 409 spend_referenced',is(vd(LIVE,{reason:'duplicate'},{referencedBy:1}),'spend_referenced'));
const AS2='2026-10-07T12:00:00Z',ROWS14=[...ROWS,ROW('s6','portal','2026-10-08','2026-10-08',70000,{createdAt:'2026-10-09T00:00:00Z'})];
const w14=plain(rc.spendInWindow(ROWS14,'2026-10-05','2026-10-11',{asOf:AS2}));
check('RS-14 at asOf a void recorded later still counts and a row recorded later is absent',same(w14.included.map(r=>r.id),['s1','s3','s5'])&&w14.byChannel.portal.total===150000&&plain(rc.spendInWindow(ROWS14,'2026-10-05','2026-10-11')).byChannel.portal.total===170000);
check('RS-14 inputs are the same list for the same input and ignore rows after asOf',same(plain(rc.spendInWindow(ROWS14,'2026-10-05','2026-10-11',{asOf:AS2})).inputs,w14.inputs)&&same(plain(rc.spendInWindow(ROWS,'2026-10-05','2026-10-11',{asOf:AS2})).inputs,w14.inputs)&&same(w14.inputs,['s1@1','s2@1','s3@1','s5@1']));
const EX=(id,from,to,amount,x={})=>({id,channel:'portal',period:{from,to},amountExVat:amount,campaignId:null,assetRef:null,...x});
check('RS-15 same channel, period and amount is 409 spend_possible_duplicate and a date equals its one-day period',is(spend({},{existing:[EX('s1','2026-10-01','2026-10-01',500000,{campaignId:'c9'})]}),'spend_possible_duplicate')&&is(spend({date:undefined,period:{from:'2026-10-01',to:'2026-10-01'}},{existing:[EX('s1','2026-10-01','2026-10-01',500000,{campaignId:'c9'})]}),'spend_possible_duplicate'));
check('RS-15 a monthly and a weekly row of the same channel, campaign and asset overlap 409',is(spend({date:undefined,period:{from:'2026-10-05',to:'2026-10-09'},amount:70000},{existing:[EX('s2','2026-10-01','2026-10-31',310000)]}),'spend_period_overlap')&&OK(spend({date:undefined,period:{from:'2026-10-05',to:'2026-10-09'},amount:70000},{existing:[EX('s2','2026-10-01','2026-10-31',310000,{campaignId:'c9'})]}))&&OK(spend({channel:'expo',date:undefined,period:{from:'2026-10-05',to:'2026-10-09'},amount:70000},{existing:[EX('s2','2026-10-01','2026-10-31',310000)]})));
check('RS-15 a vat-included re-entry is compared by amountExVat: 550,000 included equals an existing 500,000 row',is(spend({vat:'included',amount:550000},{existing:[EX('s1','2026-10-01','2026-10-01',500000,{campaignId:'c9'})]}),'spend_possible_duplicate')&&OK(spend({vat:'included',amount:500000},{existing:[EX('s1','2026-10-01','2026-10-01',500000,{campaignId:'c9'})]})));
const r15a=spend({date:undefined,period:{from:'2026-10-05',to:'2026-10-09'},amount:70000,assetRef:{id:'a1',version:2}},{asset:ASSET,existing:[EX('s2','2026-10-01','2026-10-31',310000,{assetRef:{id:'a9',version:1}})]});
check('RS-15 an overlapping period on the same channel and campaign but another asset version is not an overlap',W(r15a)&&same(r15a.value.duplicates,[])&&is(spend({date:undefined,period:{from:'2026-10-05',to:'2026-10-09'},amount:70000,assetRef:{id:'a1',version:2}},{asset:ASSET,existing:[EX('s2','2026-10-01','2026-10-31',310000,{assetRef:{id:'a1',version:2}})]}),'spend_period_overlap'));
const ack=spend({acknowledgeDuplicate:true},{existing:[EX('s1','2026-10-01','2026-10-01',500000),EX('s2','2026-09-15','2026-10-15',90000)]});
check('RS-15 acknowledgeDuplicate:true turns both 409s into 200 with duplicate_acknowledged and a summary of id, period, amount only',W(ack,'duplicate_acknowledged')&&eqv(ack.value.duplicates,[{id:'s1',period:{from:'2026-10-01',to:'2026-10-01'},amountExVat:500000},{id:'s2',period:{from:'2026-09-15',to:'2026-10-15'},amountExVat:90000}])&&is(spend({},{existing:[EX('s1','2026-10-01','2026-10-01',500000)]}),'spend_period_overlap','spend_possible_duplicate')&&is(spend({acknowledgeDuplicate:'yes'}),'invalid_input'));
const REP={id:'s1',brandId:'b1',channel:'portal',voided:false,referencedBy:0};
check('RS-16 replacing a voided row, another channel or another brand is 409 spend_replace_invalid; a referenced row is 409 spend_referenced',is(spend({replacesSpendId:'s1'},{replaces:{...REP,voided:true}}),'spend_replace_invalid')&&is(spend({replacesSpendId:'s1'},{replaces:{...REP,channel:'expo'}}),'spend_replace_invalid')&&is(spend({replacesSpendId:'s1'},{replaces:{...REP,brandId:'b2'}}),'spend_replace_invalid')&&is(spend({replacesSpendId:'s1'},{replaces:null}),'spend_replace_invalid')&&is(spend({replacesSpendId:'s9'},{replaces:REP}),'spend_replace_invalid')&&is(spend({replacesSpendId:'s1'},{replaces:{...REP,referencedBy:2}}),'spend_referenced'));
check('RS-16 a normal replacement returns the replaced void and the replaced row is left out of the duplicate check',eqv(spend({replacesSpendId:'s1'},{replaces:REP,existing:[EX('s1','2026-10-01','2026-10-01',500000)]}).value.replaces,{spendId:'s1',reason:'replaced'})&&W(spend({replacesSpendId:'s1'},{replaces:REP,existing:[EX('s1','2026-10-01','2026-10-01',500000)]})));
check('RS-17 a straddling monthly row widens the window to hold the month; no straddle keeps it',eqv(rc.alignedWindow(ROWS,'portal','2026-10-05','2026-10-11'),{from:'2026-10-01',to:'2026-10-31',expanded:true})&&eqv(rc.alignedWindow(ROWS,'expo','2026-10-05','2026-10-11'),{from:'2026-10-05',to:'2026-10-11',expanded:false})&&eqv(rc.alignedWindow(ROWS,'community','2026-10-05','2026-10-11'),{from:'2026-10-05',to:'2026-10-11',expanded:false}));
check('RS-17 widening repeats until nothing straddles and a window over 366 days is null',eqv(rc.alignedWindow([...ROWS,ROW('s8','portal','2026-09-25','2026-10-03',1)],'portal','2026-10-05','2026-10-11'),{from:'2026-09-25',to:'2026-10-31',expanded:true})&&rc.alignedWindow([ROW('s7','youtube','2025-10-06','2026-10-05',1)],'youtube','2026-10-01','2026-10-31')===null);
check('RS-17 a widened window of exactly 366 days is returned (only over 366 is null)',eqv(rc.alignedWindow([ROW('s7','youtube','2025-10-06','2026-10-05',1)],'youtube','2026-10-01','2026-10-06'),{from:'2025-10-06',to:'2026-10-06',expanded:true}));
check('RS-18 a member recording spend is 403 (rejection case: permission) and switch off is 409 first',is(spend({},{actor:MEMBER}),'role_forbidden')&&is(spend({amount:-1},{actor:MEMBER,enabled:false}),'switch_off'));
check('RS input objects: unknown and prototype keys are 400 without throwing',is(spend({extra:1}),'invalid_input')&&is(rc.spendDecision(JSON.parse(JSON.stringify(SIN).replace('{','{"__proto__":{"amount":1},')),SCTX),'invalid_input')&&is(rc.spendDecision(null,SCTX),'invalid_input')&&is(rc.spendDecision(SIN,{...SCTX,existing:null}),'invalid_input'));
check('RS evidence with personal data is 400 evidence_pii without the value',is(spend({evidence:'담당 010-0000-0101 확인'}),'evidence_pii')&&!JSON.stringify(plain(spend({evidence:'담당 010-0000-0101 확인'}))).includes('0101'));

// ════ RD 공통 ════
const MARK='ZQMARKX',marked=r=>JSON.stringify(plain(r)).includes(MARK);
const markedFails=[
 issue({channel:MARK,label:MARK+'\u0000',validFrom:MARK,customCode:MARK,campaignId:MARK,assetRef:{id:MARK,version:1},eventId:MARK,utmCampaign:MARK+'!'}),
 issue({label:MARK+' 010-0000-0101'}),issue({[MARK]:1}),issue({customCode:'R'+MARK+'0'}),
 retire({retiredOn:MARK}),retire({[MARK]:MARK}),
 spend({channel:MARK,amount:MARK,vat:MARK,funding:MARK,evidence:MARK+'\u0001',original:{currency:MARK,amount:MARK},campaignId:MARK,assetRef:{id:MARK,version:1},platform:{impressions:MARK},replacesSpendId:MARK}),
 spend({evidence:MARK+' 광고분담금'}),spend({evidence:MARK+' 010-0000-0101'}),spend({evidence:MARK},{existing:[EX('s1','2026-10-01','2026-10-01',500000)]}),
 vd(LIVE,{reason:MARK}),
];
check('RD a marker string in every input field never reaches a message or any failure field',markedFails.every(r=>F(r)&&!marked(r)&&!r.message.includes(MARK)));
check('RD code list, status table and message table have the same keys and every message is non-empty Korean text',same([...rc.RECRUITMENT_CODES].sort(asc),Object.keys(rc.RECRUITMENT_CODE_STATUS).sort(asc))&&same(Object.keys(rc.RECRUITMENT_MESSAGES).sort(asc),Object.keys(rc.RECRUITMENT_CODE_STATUS).sort(asc))&&Object.values(rc.RECRUITMENT_MESSAGES).every(m=>typeof m==='string'&&/[가-힣]/.test(m)));
check('RD fixed notices are the spec wording',rc.RECRUITMENT_MESSAGES.ad_fund_forbidden.startsWith('광고분담금은 모집 비용 출처로 쓸 수 없습니다(결정 27 기본값)')&&rc.RECRUITMENT_MESSAGES.referral_reward_forbidden.startsWith('점주 추천에는 금전 보상을 기록하지 않습니다(결정 27 기본값)')&&rc.RECRUITMENT_MESSAGES.agency_fee_wording.startsWith('모집 위탁 계약 밖 성과 수수료형 영업대행은 1차에 쓰지 않습니다(결정 27)')&&rc.RECRUITMENT_MESSAGES.search_ad_manual.startsWith('네이버 검색광고 비용은 수기 입력입니다(API 연동 없음)'));
const deepFrozen=v=>!v||typeof v!=='object'||Object.isFrozen(v)&&Object.values(v).every(deepFrozen);
check('RD exported constants are deeply frozen and the exported pattern is a frozen copy',['RECRUITMENT_CHANNELS','RECRUITMENT_CHANNEL_KEYS','PROVENANCE_CHANNELS','EVENT_CHANNELS','AD_FUND_TERMS','AGENCY_FEE_TERMS','RECRUITMENT_CODES','RECRUITMENT_WARNING_CODES','RECRUITMENT_CODE_STATUS','RECRUITMENT_MESSAGES','RECRUITMENT_CHANNEL_LABELS','ASSET_TYPE_CHANNELS','SPEND_VOID_REASONS','SPEND_LIMITS','UNATTRIBUTED_REASON_LABELS'].every(k=>rc[k]&&deepFrozen(rc[k]))&&Object.isFrozen(rc.RECRUITMENT_CODE_PATTERN));
let compileThrew=false;try{rc.RECRUITMENT_CODE_PATTERN.compile('^.*$')}catch{compileThrew=true}
check('RD compiling the exported pattern cannot loosen the module check',compileThrew&&!rc.isRecruitmentCode('C2345678'));
check('RD versions and disclaimer (R5b-2 raised the rule version for the provider-file basis)',rc.RECRUITMENT_VERSION==='fr-recruitment@2026-09-27.2'&&rc.RECRUITMENT_DISCLAIMER===DISCLAIMER);
check('RD the decision functions never throw on garbage',[undefined,null,0,'x',[],{},new Proxy({},{get(){throw new Error('x')},ownKeys(){throw new Error('x')}})].every(g=>{try{rc.codeIssueDecision(g,g);rc.codeIssueDecision(IIN,g);rc.codeRetireDecision(g,g,g);rc.spendDecision(g,g);rc.spendDecision(SIN,g);rc.spendVoidDecision(g,g,g);rc.attributeLead(g,g,g);rc.attributionInputs(g,g,g);rc.attributionLabel(g);rc.spendInWindow(g,g,g,g);rc.alignedWindow(g,g,g,g,g);rc.recruitmentTokens(g);rc.recruitmentUtmQuery(g);return true}catch{return false}}));

// ════ 사유 코드 전부·외부 호출 ════
const errorCodes=plain(rc.RECRUITMENT_CODES).filter(c=>rc.RECRUITMENT_CODE_STATUS[c]!==200);
const missingProduced=errorCodes.filter(c=>!produced.has(c)),missingWarned=plain(rc.RECRUITMENT_WARNING_CODES).filter(c=>!warned.has(c));
assert.deepEqual(missingProduced,[],'실제로 나오지 않은 사유 코드: '+missingProduced.join(', '));passed.push(`RD all ${errorCodes.length} failure codes were produced by a decision`);
assert.deepEqual(missingWarned,[],'실제로 나오지 않은 경고 코드: '+missingWarned.join(', '));passed.push(`RD all ${rc.RECRUITMENT_WARNING_CODES.length} warning codes were produced by a decision`);
check(`RD the status invariant held on every failure result (${failCount})`,failCount>=150);
// 사례 번호 전수: 6.2의 R5a 사례와 R5b-2의 RA-9가 모두 이름에 있다.
const IDS=['RC-S1','RC-F1','RC-F2','RC-F3','RC-F4','RC-F5','RC-F6','RC-T','RC-CH1','RC-CH2','RC-CH3','RC-D1','RC-D2','RC-D3','RC-D4','RC-D5','RC-D6','RC-D7','RC-D8','RC-D8b','RC-D9','RC-R','RA-1','RA-2','RA-3','RA-4','RA-5','RA-6','RA-7','RA-8','RA-9','RA-10','RA-11','RA-12','RA-13','RS-1','RS-2','RS-3','RS-4','RS-5','RS-5b','RS-6','RS-6b','RS-6c','RS-7','RS-8','RS-8b','RS-9','RS-10','RS-10b','RS-11','RS-12','RS-13','RS-13b','RS-14','RS-15','RS-16','RS-17','RS-18','RD'];
check('RC-CH3 a store channel key recording spend is 400 channel_unknown',is(spend({channel:'naver_place'}),'channel_unknown')&&is(spend({channel:'blog'}),'channel_unknown'));
const missingIds=IDS.filter(id=>!passed.some(n=>n.startsWith(id+' ')));
assert.deepEqual(missingIds,[],'이름에 없는 사례 번호: '+missingIds.join(', '));passed.push(`every R5a and R5b-2 case id of this suite (${IDS.length}) has a named check`);
check('no external call was made',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length}));
