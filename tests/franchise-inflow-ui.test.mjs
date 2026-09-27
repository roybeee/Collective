// 트랙 R R5c '유입·비용' 화면 계약 검사: 실제 경로(/api/franchise, 메모리 D1)로 만든 모집 코드·모집 비용·리드 가져오기 기록의 GET 보기를 그대로 화면(React SSR)에 넣어 그리고,
// 화면의 입력 도우미가 만든 요청을 같은 경로 핸들러로 보낸다. 서버와 화면의 키 이름·요청 모양이 어긋나면 여기서 잡힌다.
// 명세 docs/FRANCHISE-R5-SPEC.ko.md 6.2 R5c 사례(UI-R2·UI-Q1·UI-E1·UI-F1)와 5절 화면 항목(IN-*) 이름이 검사 이름에 붙는다.
// 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date, 화면은 react-dom/server). 실제 브라우저·실제 D1은 not_run.
// 값은 모두 합성이다(이름 김가상·이테스트, 전화 010-0000-2xxx, 이메일 *@example.com). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';
import {franchiseFixture,captureConsole,DISCLAIMER,plain} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture(),{sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
f.clock.set(Date.parse('2026-10-05T03:00:00Z')-Date.now());

// ── 화면 링커(tests/franchise-recruit-ui.test.mjs와 같은 규칙). 화면 문맥의 Date는 서버와 같은 이동 시계다. ──
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),jsxRuntime=require('react/jsx-runtime');
let screenFetch=async()=>{throw new Error('화면 네트워크 호출이 준비되지 않았습니다.')};
const context=createContext({console,URL,URLSearchParams,Date:f.clock.ShiftDate,Intl,TextEncoder,TextDecoder,crypto:globalThis.crypto,setTimeout,clearTimeout,btoa,atob,fetch:(...a)=>screenFetch(...a)});
const transpile=file=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),clause=s.importClause;if(clause?.name)set.add('default');const bound=clause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
const TAGS={Button:'button',Input:'input',Textarea:'textarea',NativeSelect:'select',NativeSelectOption:'option',DialogTitle:'h2',SheetTitle:'h2',DialogDescription:'p',SheetDescription:'p'};
const part=name=>{function Part({children,variant,size,asChild,onOpenChange,onValueChange,...props}){void variant;void size;void asChild;void onOpenChange;void onValueChange;return React.createElement(TAGS[name]||'div',{...props,'data-part':name},children)}Part.displayName=name;return Part};
const REAL_APP=new Set(['./franchise-common','./franchise-import-panel','./franchise-lead-detail','./franchise-experiment-panel','./franchise-lead-nurture']);
const cache=new Map(),synthetic=(names,value)=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,value(n))},{context});
const moduleFor=file=>{file=resolve(file);if(cache.has(file))return cache.get(file);const code=transpile(file),m=new SourceTextModule(code,{context,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m};
function link(spec,ref){
 if(spec==='react')return synthetic(ref.imports.get(spec)||new Set(),n=>React[n]);
 if(spec==='react/jsx-runtime')return synthetic(ref.imports.get(spec)||new Set(),n=>jsxRuntime[n]);
 if(spec.startsWith('@/components/ui/'))return synthetic(ref.imports.get(spec)||new Set(),part);
 if(spec==='lucide-react')return synthetic(ref.imports.get(spec)||new Set(),()=>()=>null);
 if(spec==='./account-context')return synthetic(ref.imports.get(spec)||new Set(),n=>n==='useAccount'?()=>null:()=>false);
 if(spec.startsWith('@/lib/'))return moduleFor(resolve(spec.slice(2))+'.ts');
 if(spec.startsWith('.')&&(ref.identifier.includes('/lib/')||REAL_APP.has(spec))){const base=resolve(dirname(ref.identifier),spec);return moduleFor(existsSync(base+'.ts')?base+'.ts':base+'.tsx')}
 throw new Error('예상하지 못한 import: '+spec);
}
const load=async file=>{const m=moduleFor(file);if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace};
const inflowUi=await load('app/franchise-inflow-panel.tsx'),importUi=await load('app/franchise-import-panel.tsx'),eventsUi=await load('app/franchise-events-panel.tsx'),detailUi=await load('app/franchise-lead-detail.tsx'),common=await load('app/franchise-common.tsx');
const rc=await f.load('lib/franchise-recruitment.ts'),li=await f.load('lib/franchise-lead-import.ts');
const render=(C,p)=>renderToStaticMarkup(React.createElement(C,p)),noop=()=>{};
const button=(html,label)=>html.includes(`>${label}</button>`),options=html=>[...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(m=>m[1]);

// 화면의 fetch를 경로 핸들러로: 세션 쿠키·출처를 붙이고, 요청 제한 창은 매번 비운다.
const asUser=session=>async(url,init={})=>{
 sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
 const headers={...(init.headers||{}),cookie:session.cookie,origin:session.origin};
 return init.method==='POST'?f.route.POST(new Request('https://agency.test'+url,{...init,headers})):f.route.GET(new Request('https://agency.test'+url,{headers}));
};
const as=session=>{screenFetch=asUser(session)};
const write=async(session,action,payload,last=null)=>{as(session);return common.sendAttempt(action,{brandId:'fr-a',...payload},last)};
const view=async(session,params)=>{as(session);return common.franchiseGet({brandId:'fr-a',...params})};
const codeRow=code=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='recruitment_code' AND json_extract(data,'$.code')=?").get(code).data);
const spendRow=id=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='recruitment_spend' AND json_extract(data,'$.id')=?").get(id).data);

// ── 준비: 스위치·프로필(분기 A, 보관 위치)·모집 캠페인·행사 ──
const WS='iu-owner',boss=f.signIn('iu-boss','admin',1000,WS),member=f.signIn('iu-member','member',2000,WS);
await f.brand(WS,'fr-a');
check('owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);
const LABEL='가상 보관함';
check('the brand profile is branch A with a storage label',(await f.profile(boss,'fr-a',{storageLabels:[LABEL],branch:'A'},0)).status===200);
await server.recordStatement(WS,'campaign','ca-r',{id:'ca-r',brandId:'fr-a',title:'가상 가맹 모집',goal:'가상',audience:'',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'approved',version:1,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',objective:'franchise_recruitment'}).run();
let r=await f.post(boss,{action:'event_save',brandId:'fr-a',campaignId:'ca-r',type:'expo',startsAt:'2026-10-20T14:00:00+09:00',placeLabel:'가상 박람회장',capacity:50,spendRef:null,assetRefs:[]});
const EXPO=r.body.result?.eventId;check('an expo event exists for the options',r.status===200&&typeof EXPO==='string');

// ════ 모집 코드(IN-C) ════
const options0=await view(boss,{view:'events'});
const issue=inflowUi.codeIssueInput({...inflowUi.ISSUE_BLANK,channel:'expo',label:' 가상 박람회 부스 QR ',campaignId:'ca-r',eventId:EXPO,utmCampaign:'expo_fall'});
check('IN-C1: the issue input sends only filled fields with a trimmed label and no empty keys',JSON.stringify(plain(issue))===JSON.stringify({channel:'expo',label:'가상 박람회 부스 QR',campaignId:'ca-r',eventId:EXPO,utmCampaign:'expo_fall'}));
let w=await write(boss,'code_issue',issue);
const C1=w.r.body.result?.code;
check('IN-C1: owner/admin issue a code with the screen payload',w.r.status===200&&rc.isRecruitmentCode(C1)&&codeRow(C1).eventId===EXPO&&codeRow(C1).campaignId==='ca-r');
w=await write(boss,'code_issue',inflowUi.codeIssueInput({...inflowUi.ISSUE_BLANK,channel:'portal',label:'가상 포털 코드',customCode:' r234-5678 ',validFrom:'2026-10-01'}));
const C2=w.r.body.result?.code;
check('IN-C1: a direct code is sent as typed and the server normalizes it',w.r.status===200&&C2==='R2345678'&&codeRow(C2).validFrom==='2026-10-01');
w=await write(member,'code_issue',inflowUi.codeIssueInput({...inflowUi.ISSUE_BLANK,channel:'portal',label:'직원 시도'}));
check('IN-C1: a member issue is refused by the server (the screen hides the form)',w.r.status===403);

// 리드: 코드로 귀속되는 리드 1건, 코드 없는 리드 1건.
r=await f.createLead(boss,'fr-a',{codes:[C1]});const L1=r.body.result?.leadId;
check('IN-L1: a lead registered with the issued code is created',r.status===200&&typeof L1==='string');
r=await f.createLead(member,'fr-a');const L2=r.body.result?.leadId;
check('IN-L1: a member registers a lead without a code',r.status===200&&typeof L2==='string');

// ════ UI-R2·역할별 화면 ════
const bossCodes=await view(boss,{view:'codes'}),memberCodes=await view(member,{view:'codes'}),bossSpend0=await view(boss,{view:'spend'});
const inflowHtml=(admin,codes,extra={})=>render(inflowUi.FranchiseInflow,{brandId:'fr-a',brandName:'가상 브랜드 fr-a',admin,branch:'A',storageLabels:[LABEL],onStatus:noop,initial:{codes,...(admin?{spend:bossSpend0,options:options0,imports:{imports:[],coverage:{}}}:{})},...extra});
const bossHtml=inflowHtml(true,bossCodes),memberHtml=inflowHtml(false,memberCodes);
const firstCount=html=>Math.min(...['귀속 1','코드 없음 1',C1].map(t=>html.indexOf(t)).filter(i=>i>=0));
check('UI-R2: the attribution note and the disclaimer come before every count on the owner/admin screen',bossHtml.indexOf(rc.RECRUITMENT_ATTRIBUTION_NOTE)>=0&&bossHtml.indexOf(rc.RECRUITMENT_ATTRIBUTION_NOTE)<firstCount(bossHtml)&&bossHtml.indexOf(DISCLAIMER)<firstCount(bossHtml)&&firstCount(bossHtml)<Infinity);
check('UI-R2: the attribution note and the disclaimer come before every count on the member screen',memberHtml.indexOf(rc.RECRUITMENT_ATTRIBUTION_NOTE)>=0&&memberHtml.indexOf(rc.RECRUITMENT_ATTRIBUTION_NOTE)<firstCount(memberHtml)&&memberHtml.indexOf(DISCLAIMER)<firstCount(memberHtml));
check('IN-V1: both roles see the code list with the code, its channel and the unattributed reason count',[bossHtml,memberHtml].every(h=>h.includes(C1)&&h.includes(C2)&&h.includes('박람회')&&h.includes('코드 없음 1')&&h.includes('귀속 1')));
check('IN-V1: owner/admin see the issue form, retire buttons, the spend section and the lead import section',button(bossHtml,'모집 코드 발급')&&bossHtml.includes(`aria-label="${C1} 사용 중지"`)&&bossHtml.includes('모집 비용')&&bossHtml.includes('리드 파일 가져오기'));
check('IN-V1: a member sees codes only: no issue form, no retire, no spend, no import, and the ask-an-admin note',!button(memberHtml,'모집 코드 발급')&&!memberHtml.includes('사용 중지')&&!memberHtml.includes('모집 비용 기록')&&!memberHtml.includes('리드 파일 가져오기')&&memberHtml.includes(inflowUi.MEMBER_ISSUE_NOTE));
check('IN-V2: the utm query and copy buttons are offered for a code with utm_campaign',bossHtml.includes(`aria-label="${C1} 코드 복사"`)&&bossHtml.includes(`aria-label="${C1} utm 복사"`)&&!bossHtml.includes(`aria-label="${C2} utm 복사"`));
const offHtml=inflowHtml(true,{...bossCodes,enabled:false});
check('IN-V3: with the switch off owner/admin keep retire and lose issue and spend recording',!button(offHtml,'모집 코드 발급')&&offHtml.includes(`aria-label="${C1} 사용 중지"`)&&!button(offHtml,'비용 기록')&&!offHtml.includes('리드 파일 가져오기'));
const branchB=inflowHtml(true,bossCodes,{branch:'B'});
check('IN-V3: a branch B brand hides code issue and lead import but keeps spend recording',!button(branchB,'모집 코드 발급')&&button(branchB,'비용 기록')&&!branchB.includes('리드 파일 가져오기'));

// 사용 중지
w=await write(boss,'code_retire',inflowUi.retireInput(bossCodes.codes.find(c=>c.code===C2),''));
check('IN-C2: retire with the screen payload stops the code from today',w.r.status===200&&codeRow(C2).retiredOn==='2026-10-05'&&codeRow(C2).status==='retired');

// ════ 모집 비용(IN-S, UI-F1) ════
check('UI-F1: the funding choices are the HQ recruitment budget only (no ad fund option)',JSON.stringify(Object.keys(inflowUi.FUNDING_LABELS))==='["hq_budget"]');
const spendForm=bossHtml.slice(bossHtml.indexOf('모집 비용 기록'));
check('UI-F1: the spend form has no ad-fund option and shows the ad-fund notice instead',!options(bossHtml).some(o=>o.includes('광고분담금'))&&spendForm.includes(rc.RECRUITMENT_MESSAGES.ad_fund_forbidden));
const referral=inflowUi.spendInput({...inflowUi.SPEND_BLANK,channel:'owner_referral',date:'2026-10-01',amount:'50,000',vat:'excluded',evidence:'가상 추천 카드 배포 기록'});
check('UI-F1: an owner referral spend is sent with amount 0 whatever was typed',referral.payload?.amount===0&&referral.problem===null);
const refHtml=inflowHtml(true,bossCodes,{initialSpendForm:{...inflowUi.SPEND_BLANK,channel:'owner_referral'}});
check('UI-F1: choosing owner referral locks the amount at 0 and shows the decision 27 note',/<input[^>]*aria-label="금액 \(원\)"[^>]*disabled=""[^>]*value="0"|<input[^>]*aria-label="금액 \(원\)"[^>]*value="0"[^>]*disabled=""/.test(refHtml)&&refHtml.includes(inflowUi.REFERRAL_NOTE));
check('IN-S1: the search ad channel shows the manual entry note',inflowHtml(true,bossCodes,{initialSpendForm:{...inflowUi.SPEND_BLANK,channel:'search_ad'}}).includes(rc.RECRUITMENT_MESSAGES.search_ad_manual));
check('IN-S1: amount text with thousand separators becomes an integer; vat and evidence are required before sending',inflowUi.spendInput({...inflowUi.SPEND_BLANK,channel:'portal',date:'2026-10-01',amount:'1,234,000',vat:'excluded',evidence:'가상 월 소진 내역'}).payload.amount===1234000&&inflowUi.spendInput({...inflowUi.SPEND_BLANK,channel:'portal',date:'2026-10-01',amount:'1000',vat:'',evidence:'가상'}).payload===null&&inflowUi.spendInput({...inflowUi.SPEND_BLANK,channel:'portal',date:'2026-10-01',amount:'1.5',vat:'excluded',evidence:'가상'}).payload===null);
const SPF={...inflowUi.SPEND_BLANK,channel:'portal',mode:'period',from:'2026-09-01',to:'2026-09-30',amount:'300,000',vat:'excluded',evidence:'가상 포털 9월 소진 내역',impressions:'1000',clicks:'40',formSubmits:''},SP=inflowUi.spendInput(SPF).payload;
check('IN-S1: a period spend payload carries funding, period, platform numbers and no empty keys',JSON.stringify(plain(SP))===JSON.stringify({channel:'portal',period:{from:'2026-09-01',to:'2026-09-30'},amount:300000,vat:'excluded',funding:'hq_budget',evidence:'가상 포털 9월 소진 내역',platform:{impressions:1000,clicks:40}}));
w=await write(boss,'spend_record',SP);const S1=w.r.body.result?.spendId;
check('IN-S1: owner/admin record the spend with the screen payload',w.r.status===200&&spendRow(S1).amountExVat===300000);
w=await write(boss,'spend_record',SP);
check('IN-S2: the same spend again is 409 with the existing row summary for the confirm step',w.r.status===409&&inflowUi.duplicatesOf(w.r).length===1&&inflowUi.duplicatesOf(w.r)[0].id===S1&&inflowUi.duplicatesOf(w.r)[0].amountExVat===300000);
w=await write(boss,'spend_record',inflowUi.spendInput(SPF,true).payload);const S2=w.r.body.result?.spendId;
check('IN-S2: confirming sends acknowledgeDuplicate and records with the acknowledged warning',w.r.status===200&&Array.isArray(w.r.body.warnings)&&w.r.body.warnings.includes('duplicate_acknowledged'));
w=await write(boss,'spend_void',inflowUi.voidInput(spendRow(S2),'duplicate'));
check('IN-S3: void with a reason code marks the row voided',w.r.status===200&&spendRow(S2).status==='voided');
const replace=inflowUi.spendInput({...inflowUi.spendFormOf(spendRow(S1)),amount:'280,000'});
check('IN-S3: fix-and-rewrite prefills the row and sends replacesSpendId',replace.payload?.replacesSpendId===S1&&replace.payload.amount===280000);
w=await write(boss,'spend_record',replace.payload);const S3=w.r.body.result?.spendId;
check('IN-S3: the replacement voids the old row as replaced',w.r.status===200&&spendRow(S1).voided?.reason==='replaced'&&spendRow(S3).amountExVat===280000);
const win=await view(boss,{view:'spend',from:'2026-09-15',to:'2026-10-05'});
const winHtml=inflowHtml(true,bossCodes,{initial:{codes:bossCodes,spend:win,options:options0,imports:{imports:[],coverage:{}}}});
check('IN-S4: a window that cuts a spend period shows the straddling row line, the period mismatch and the no-proration note',win.window.byChannel.portal.straddlingCount===1&&winHtml.includes('일부만 걸친 비용 1건')&&winHtml.includes('비용 기간 불일치')&&winHtml.includes(rc.NO_PRORATION_NOTE));
check('IN-S4: the list shows voided and replaced rows with won amounts',winHtml.includes('280,000원')&&winHtml.includes('무효화')&&winHtml.includes('교체'));
const memberSpend=await (async()=>{as(member);try{await common.franchiseGet({view:'spend',brandId:'fr-a'});return 200}catch(e){return e.status}})();
check('IN-S5: a member cannot read spend (403), and the member screen does not ask for it',memberSpend===403&&!memberHtml.includes('280,000'));

// ════ UI-Q1: 비멱등 생성 세 작업의 요청 번호 ════
const stubStatus=status=>{screenFetch=async()=>new Response(JSON.stringify({error:'가상 오류'}),{status,headers:{'content-type':'application/json'}})};
for(const action of ['code_issue','spend_record','lead_import_confirm']){
 stubStatus(503);const a=await common.sendAttempt(action,{brandId:'fr-a',x:1},null);
 stubStatus(503);const b=await common.sendAttempt(action,{brandId:'fr-a',x:1},a.next);
 stubStatus(400);const c=await common.sendAttempt(action,{brandId:'fr-a',x:1},b.next);
 check(`UI-Q1: ${action} keeps the request id after a 5xx for the same input and drops it after a 400`,a.next!==null&&b.next?.id===a.next.id&&c.next===null&&common.attemptId(a.next,JSON.stringify([action,{brandId:'fr-a',x:2}]))!==a.next.id);
}
stubStatus(503);const other=await common.sendAttempt('event_register',{brandId:'fr-a',x:1},null);
check('UI-Q1: other actions keep the old rule (a 5xx is an answer, the next try is a new id)',other.next===null);

// ════ 리드 가져오기(IN-I, UI-E1) ════
const CP949=Buffer.from('c1a2bcf6c0cfbdc32cc8f1b8c1c1f6bfaa0a323032362d31302d30352031343a30352cbcadbfef20b0adb3b2b1b80a','hex');
const local=await li.localFileCheck(new Uint8Array(CP949));
check('UI-E1: a CP949 file fails the device check with encoding_invalid and the screen offers EUC-KR reading',local.ok===false&&importUi.needsEucKr(local)&&importUi.EUC_KR_BUTTON==='EUC-KR로 읽기');
const euc=importUi.readForImport(new Uint8Array(CP949),'euc-kr');
const eucInput=importUi.inspectInput(euc);
check("UI-E1: 'EUC-KR로 읽기' sends transcodedFrom euc-kr and UTF-8 bytes in csvBase64",eucInput.transcodedFrom==='euc-kr'&&Buffer.from(eucInput.csvBase64,'base64').toString('utf8')==='접수일시,희망지역\n2026-10-05 14:05,서울 강남구\n'&&new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(eucInput.csvBase64,'base64')).length>0);
w=await write(boss,'lead_import_inspect',eucInput);
check('UI-E1: the server inspects the transcoded file and records the transcoding',w.r.status===200&&w.r.body.result.transcodedFrom==='euc-kr'&&w.r.body.result.headers.join()==='접수일시,희망지역');
check('IN-I1: the UTF-8 reading keeps the original bytes and no transcoding flag',(x=>x.transcodedFrom===null&&Buffer.from(x.bytes).equals(Buffer.from('a,b\n')))(importUi.readForImport(new Uint8Array(Buffer.from('a,b\n')),'utf-8'))&&importUi.bytesToBase64(new Uint8Array(Buffer.from('가상 파일')))===Buffer.from('가상 파일').toString('base64'));

const csv=(...lines)=>lines.join('\n')+'\n';
const HEAD='접수일시,희망지역,창업예산,희망시기,모집코드,이름,휴대폰,이메일';
const P=[['김가상','010-0000-2101','kim.iu@example.com'],['이테스트','010-0000-2102','lee.iu@example.com']];
const TEXT=csv(HEAD,`2026-10-01 10:00,서울 강남구,5천만~1억원,3개월 안,${C1},${P[0].join(',')}`,`2026-10-02 11:00,부산 해운대구,미정,미정,,${P[1].join(',')}`,`2026-10-02 12:00,부산 해운대구,미정,미정,,${P[1].join(',')}`);
const file=importUi.readForImport(new Uint8Array(Buffer.from(TEXT)),'utf-8');
w=await write(boss,'lead_import_inspect',importUi.inspectInput(file));
const insp=w.r.body.result;
check('IN-I2: inspection returns the headers and a suggested mapping that the screen uses',w.r.status===200&&insp.headers.length===8&&insp.suggestedMapping.receivedAt===0);
check('IN-I2: contact targets offer only their own contact header columns; other targets never offer a contact column',JSON.stringify(importUi.mappingChoices(insp.headers,'contactName'))==='[5]'&&JSON.stringify(importUi.mappingChoices(insp.headers,'contactPhone'))==='[6]'&&!importUi.mappingChoices(insp.headers,'region').some(i=>i>=5));
const inspHtml=render(importUi.LeadImport,{brandId:'fr-a',brandName:'가상 브랜드 fr-a',storageLabels:[LABEL],events:[],imports:{imports:[],coverage:{}},onImported:noop,initial:{file,inspection:insp}});
check('UI-F1: the mapping choices list the allowed targets only (no forbidden target such as a memo, an address or a resident number)',Object.values(li.LEAD_IMPORT_TARGETS).every(t=>inspHtml.includes(t))&&!/주민|메모|주소|외부 식별자/.test(options(inspHtml).join('|')));
const FORM={...importUi.IMPORT_BLANK,channel:'portal',provider:'가상창업포털',providedOn:'2026-10-04',from:'2026-09-20',to:'2026-10-03',consentSha:createHash('sha256').update('가상 동의 증빙').digest('hex'),consentLabel:LABEL,basis:'provided',mapping:{...insp.suggestedMapping,contactName:5,contactPhone:6,contactEmail:7}};
const input=importUi.importInput(file,FORM);
check('IN-I3: the preview input carries the file, channel, mapping, provenance and basis only',JSON.stringify(Object.keys(input).sort())==='["basis","channel","csvBase64","mapping","provenance"]'&&input.provenance.consentRef.storageLabel===LABEL);
w=await write(boss,'lead_import_preview',input);
const plan=w.r.body.result;
check('IN-I3: the preview counts rows and merges in the file by row number only',w.r.status===200&&plan.toCreate===2&&plan.merged.inFile.count===1&&JSON.stringify(plan.merged.inFile.rows)==='[4]');
const prevHtml=render(importUi.LeadImport,{brandId:'fr-a',brandName:'가상 브랜드 fr-a',storageLabels:[LABEL],events:[],imports:{imports:[],coverage:{}},onImported:noop,initial:{file,inspection:insp,form:FORM,plan}});
check('IN-I3: the preview screen shows the counts, the merged row numbers and the attribution note before the attribution counts, and no contact value',prevHtml.includes('만들 리드 2건')&&prevHtml.includes('파일 안에서 합쳐진 행 1건(4행)')&&prevHtml.indexOf(rc.RECRUITMENT_ATTRIBUTION_NOTE)<prevHtml.indexOf('제공처 파일 기준')&&P.flat().every(v=>!prevHtml.includes(v)));
const conf=importUi.confirmInput(input,plan);
check('IN-I4: the confirm input adds confirm and the expected plan hash and count',conf.confirm===true&&conf.expected.planSha256===plan.planSha256&&conf.expected.toCreate===2);
w=await write(boss,'lead_import_confirm',conf);
check('IN-I4: the confirm writes the leads',w.r.status===200&&w.r.body.result.created===2&&Array.isArray(w.r.body.result.leadCodes));
const imports=await view(boss,{view:'imports'});
const listHtml=render(importUi.LeadImport,{brandId:'fr-a',brandName:'가상 브랜드 fr-a',storageLabels:[LABEL],events:[],imports,onImported:noop});
check('IN-I5: the import records list shows the provider, the channel and the counts',listHtml.includes('가상창업포털')&&listHtml.includes('창업 포털')&&listHtml.includes('새 리드 2'));
const again=csv(HEAD,`2026-10-03 09:00,서울 강남구,미정,미정,,${P[0].join(',')}`);
const f2=importUi.readForImport(new Uint8Array(Buffer.from(again)),'utf-8'),in2=importUi.importInput(f2,{...FORM,provider:'가상박람회사',from:'2026-10-03',to:'2026-10-03'});
w=await write(boss,'lead_import_preview',in2);
check('IN-I6: a person already imported from another provider is merged into the existing lead by row number only',w.r.status===200&&w.r.body.result.merged.existing.count===1&&JSON.stringify(w.r.body.result.merged.existing.rows)==='[2]'&&w.r.body.result.toCreate===0);
const PIIFILE=csv('접수일시,희망지역,추가값','2026-10-01 10:00,서울 강남구,010-0000-2999');
const pii=importUi.readForImport(new Uint8Array(Buffer.from(PIIFILE)),'utf-8');
const localPii=await li.localFileCheck(pii.bytes);
const piiHtml=render(importUi.ImportErrors,{decision:localPii});
check('IN-I7: a personal-data cell is rejected on the device and the screen shows row and column only, never the value',localPii.ok===false&&piiHtml.includes('2행')&&!piiHtml.includes('010-0000-2999'));
w=await write(boss,'lead_import_preview',importUi.importInput(importUi.readForImport(new Uint8Array(Buffer.from(csv(HEAD,`2026-13-01 10:00,서울 강남구,미정,미정,,${P[0].join(',')}`))),'utf-8'),FORM));
const rowHtml=render(importUi.ImportErrors,{decision:w.r.body});
check('IN-I7: row errors from the server are shown as row, column and fixed message without the cell value',w.r.status===400&&rowHtml.includes('2행')&&rowHtml.includes('접수일시')&&rowHtml.includes(li.LEAD_IMPORT_MESSAGES.received_invalid)&&!rowHtml.includes('2026-13-01')&&P[0].every(v=>!rowHtml.includes(v)));

// ════ 리드 상세·보드(IN-L) ════
const detail=await view(boss,{view:'lead',leadId:L1}),memberDetail=await view(member,{view:'lead',leadId:L2});
const codesBox=(lead,admin)=>render(detailUi.LeadCodes,{lead,act:async()=>null,busy:false,admin});
const bossBox=codesBox(detail,true),memberBox=codesBox(memberDetail,false);
check('IN-L2: the lead detail shows the attribution label and the code with its channel',bossBox.includes(detail.attribution.label)&&bossBox.includes(C1));
check('IN-L2: owner/admin can strike a code with a reason; a member adds codes on an own lead but cannot strike',bossBox.includes(`aria-label="${C1} 제외"`)&&button(memberBox,'코드 추가')&&!memberBox.includes(' 제외"'));
check('IN-L2: the unattributed lead shows the no-code reason',memberBox.includes('유입 미확인')&&memberBox.includes('코드 없음'));
w=await write(member,'add_lead_codes',{leadId:L2,version:memberDetail.version,codes:detailUi.parseCodes('R9999999, r234 5678')});
check('IN-L3: the code input is split and sent as an array; an unregistered code is saved with a warning',w.r.status===200&&JSON.stringify(detailUi.parseCodes(' R9999999, r234 5678 '))==='["R9999999","R2345678"]'&&w.r.body.warnings.includes('code_not_registered'));
check('IN-L3: a malformed code is caught before sending',detailUi.codesProblem(['R12'])!==null&&detailUi.codesProblem(['R9999999'])===null&&detailUi.codesProblem(['R2345678','R2345679','R2345672','R2345673','R2345674','R2345675'])!==null);
w=await write(boss,'strike_lead_code',{leadId:L1,version:detail.version,code:C1,reason:'typo'});
check('IN-L3: owner/admin strike a code with a reason code',w.r.status===200);
const board=await view(boss,{view:'board',inflow:'unattributed'});
check('IN-L4: the board inflow filter the screen sends is accepted and returns unattributed leads only',board.leads.every(l=>l.attribution?.state==='unattributed')&&board.leads.length>=2&&typeof board.todos.codeConflict==='number');

// ════ 행사 편집기 비용 선택(IN-E) ════
const spendNow=await view(boss,{view:'spend'});
const choices=eventsUi.spendChoices(spendNow);
check('IN-E1: the event editor offers only active spend rows of the brand',choices.length===1&&choices[0].id===S3&&choices[0].label.includes('280,000원'));
const evView=await view(boss,{view:'events'}),expo=evView.events.find(e=>e.id===EXPO);
const editorHtml=render(eventsUi.EventEditor,{view:evView,event:expo,busy:false,problem:null,spends:choices,onSave:async()=>'ok',onCancel:noop});
check('IN-E1: owner/admin see the spend select and no R5 placeholder text',editorHtml.includes('모집 비용 연결')&&editorHtml.includes('280,000원')&&!editorHtml.includes('R5 뒤'));
w=await write(boss,'event_save',eventsUi.eventInput({type:'expo',campaignId:'ca-r',start:{now:false,local:eventsUi.kstLocal(expo.startsAt)},place:expo.placeLabel,capacity:String(expo.capacity),refs:[],spendRef:S3},expo));
check('IN-E1: saving with the chosen spend stores the reference; voiding that spend is then refused',w.r.status===200&&JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='recruitment_event' AND json_extract(data,'$.id')=?").get(EXPO).data).spendRef===S3&&(await write(boss,'spend_void',inflowUi.voidInput(spendRow(S3),'entry_error'))).r.status===409);

// ════ 적격 판정 화면(대표 결정 35, QU-*) ════
{
 const qualBox=lead=>render(detailUi.QualificationBox,{lead,act:async()=>null,busy:false,assignees:[]});
 let d=await view(member,{view:'lead',leadId:L2});
 let html=qualBox(d);
 check('QU-1: without criteria the box says to save criteria first and shows no judgment form',d.criteriaVersion===null&&html.includes('설정에서 적격 기준을 먼저 저장')&&!html.includes('판정 기록 (기준')&&html.includes('판정 없음'));
 check('QU-1: setup criteria version 1',(await f.profile(boss,'fr-a',{storageLabels:[LABEL],branch:'A',eligibility:{budgetBands:['100m_150m'],regions:['서울 강남구'],timingBands:['within_3m']}},1)).status===200);
 d=await view(member,{view:'lead',leadId:L2});html=qualBox(d);
 check('QU-2: the assigned member sees the verdict and reason selects and the button names the criteria version (no free-text field)',html.includes('>판정 기록 (기준 v1)</button>')&&html.includes('aria-label="적격 판정 기록"')&&!/<textarea|<input/.test(html.slice(html.indexOf('aria-label="적격 판정 기록"'),html.indexOf('판정 기록 (기준 v1)'))));
 check('QU-2: the reason options follow the verdict',JSON.stringify(Object.keys(detailUi.qualificationReasonLabels('rejected')))===JSON.stringify([...f.lib.QUALIFICATION_REASONS_BY_VERDICT.rejected])&&Object.keys(detailUi.qualificationReasonLabels('')).length===0);
 w=await write(member,'qualify_lead',{leadId:L2,version:d.version,verdict:'hold',reason:'awaiting_reply',criteriaVersion:d.criteriaVersion});
 check('QU-3: the screen payload records a judgment',w.r.status===200&&w.r.body.lead.qualification.verdict==='hold');
 html=qualBox(w.r.body.lead);
 check('QU-3: the box shows the current judgment and the history line with verdict, reason and criteria version',html.includes('<b>보류 · 답변 대기 · 기준 v1</b>')&&html.includes('aria-label="적격 판정 이력"'));
 const mine=await view(boss,{view:'board',qualification:'hold'});
 check('QU-4: the board qualification filter the screen sends returns the judged lead with its verdict',mine.leads.length===1&&mine.leads[0].id===L2&&mine.leads[0].qualification.verdict==='hold'&&mine.leads[0].qualification.current===true);
 const other=await view(boss,{view:'lead',leadId:L1});
 check('QU-5: an owner sees the form on any lead; without the server-given action the form is hidden but the current judgment stays',other.allowedActions.includes('qualify_lead')&&qualBox(other).includes('판정 기록 (기준 v1)')&&!qualBox({...w.r.body.lead,allowedActions:w.r.body.lead.allowedActions.filter(a=>a!=='qualify_lead')}).includes('판정 기록 (기준')&&qualBox({...w.r.body.lead,allowedActions:[]}).includes('보류 · 답변 대기'));
}

// ── 값 노출 없음 ──
check('no contact value or spend evidence text reaches the console',P.flat().every(v=>!logged.join('\n').includes(v))&&!logged.join('\n').includes('가상 포털 9월 소진 내역'));
console.log(JSON.stringify({passed:passed.length}));
