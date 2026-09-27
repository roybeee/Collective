// 트랙 R R5b-2 리드 CSV 가져오기 경로 스위트(/api/franchise 작업 lead_import_inspect·lead_import_preview·lead_import_confirm, GET imports, 가져온 리드의 보기·귀속·보존 기한).
// 대표 결정 32(B안, 2026-09-27): 매핑한 이름·전화·이메일 열에서만 연락처를 받아 결정 22의 R4b 경로(암호화·중복 키·열람 감사·모델 전송 0건·H11 180일 파기)로 저장한다.
// 대표 결정(2026-09-27, 교차 파일 중복 병합): '리드 1건, 집계는 파일별'. 연락처 중복 키가 기존 리드와 겹치면 새 리드를 만들지 않고 그 리드에 제공처 기록만 덧붙인다.
// 명세 docs/FRANCHISE-R5-SPEC.ko.md 6.2 R5b-2 사례(RI-*)와 결정 32 사례(RB-* 연락처, RM-* 병합) 이름이 검사 이름에 붙는다. A안 전용 사례(RI-10 붙이기·RI-11 제공처 보관 작업 표)는 B안에서 해당이 없다.
// 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date, batch 가로채기, 난수 가로채기). 운영 real 확인은 not_run(미게시, LR-1 회신 전).
// 값은 모두 합성이다(이름 김가상·이테스트·박예시·최샘플·정모의, 전화 010-0000-1xxx, 이메일 *@example.com). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {franchiseFixture,captureConsole,HOUR,DAY,DISCLAIMER,plain} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const setNow=ms=>f.clock.set(ms-Date.now()),nowMs=()=>f.clock.now();
const kstDay=(d=0)=>new Date(nowMs()+9*HOUR+d*DAY).toISOString().slice(0,10);
setNow(Date.parse('2026-10-05T03:00:00Z'));
const li=await f.load('lib/franchise-lead-import.ts'),rc=await f.load('lib/franchise-recruitment.ts'),pii=await f.load('lib/pii-scan.ts');
const E=plain(f.lib.FRANCHISE_ERRORS),T=k=>E[k]?.text;
const WS='li-owner';
const boss=f.signIn('li-boss','admin',1000,WS),admin=f.signIn('li-admin','admin',2000,WS),member=f.signIn('li-member','member',3000,WS);
for(const b of ['fr-a','fr-c'])await f.brand(WS,b);

// ── 보조 ──
const responses=[];
const post=async(s,input)=>{const r=await f.post(s,input);responses.push(r.body);return r};
const get=async(s,q)=>{const r=await f.get(s,q);responses.push(r.body);return r};
const snapshot=()=>sql.prepare("SELECT id,data FROM records WHERE kind LIKE 'recruitment_%' OR kind LIKE 'franchise_%' ORDER BY id").all().map(r=>r.id+'\t'+r.data).join('\n');
const countKind=kind=>Number(sql.prepare('SELECT COUNT(*) n FROM records WHERE kind=? AND owner=?').get(kind,WS).n);
const audits=action=>sql.prepare("SELECT data FROM records WHERE kind='franchise_audit' AND json_extract(data,'$.action')=?").all(action).map(r=>JSON.parse(r.data));
const events=(leadId,type)=>sql.prepare("SELECT data FROM records WHERE kind='franchise_lead_event' AND parent_id=? AND json_extract(data,'$.type')=?").all(leadId,type).map(r=>JSON.parse(r.data));
const leads=()=>f.rows('franchise_lead');
const importRow=sha=>{const r=sql.prepare("SELECT data FROM records WHERE kind='recruitment_import' AND id=?").get(`${WS}:recruitment_import:${sha}`);return r?JSON.parse(r.data):null};
const allData=()=>sql.prepare('SELECT data FROM records').all().map(r=>r.data).join('\n');
const reasons=r=>(r.body.reasons||[]).map(x=>x.code);
const codesAre=(r,status,...list)=>r.status===status&&JSON.stringify(reasons(r))===JSON.stringify(list);
const fixed=(r,status,key)=>r.status===status&&r.body.error===T(key);
const sha=b=>createHash('sha256').update(b).digest('hex');
const b64=t=>Buffer.from(t).toString('base64');
const csv=(...lines)=>lines.join('\n')+'\n';
const HEADC='접수일시,희망지역,창업예산,희망시기,모집코드,이름,휴대폰,이메일';
const MAPC={receivedAt:0,region:1,budgetBand:2,timingBand:3,codes:4,contactName:5,contactPhone:6,contactEmail:7};
const row=(t,name,phone,email,code='',region='서울 강남구')=>`${t},${region},5천만~1억원,3개월 안,${code},${name},${phone},${email}`;
const CONSENT=sha('가상 동의 증빙 문서');
const PROV=(x={})=>({provider:'가상창업포털',providedOn:'2026-10-04',period:{from:'2026-09-01',to:'2026-10-03'},consentRef:{sha256:CONSENT,storageLabel:'본사 문서함'},...x});
const IMP=(action,text,x={})=>({action,brandId:'fr-a',csvBase64:b64(text),channel:'portal',mapping:MAPC,provenance:PROV(),basis:{type:'provided'},...x});
const preview=(text,x={},s=boss)=>post(s,IMP('lead_import_preview',text,x));
const expectOf=p=>({confirm:true,expected:{planSha256:p.body.result.planSha256,toCreate:p.body.result.toCreate}});
const confirm=(text,p,x={},s=boss)=>post(s,{...IMP('lead_import_confirm',text,x),...expectOf(p)});
const leadBySystemCode=code=>leads().find(l=>l.systemCode===code);
const leadView=(s,id)=>get(s,`view=lead&brandId=fr-a&leadId=${id}`);

// 합성 연락처. 원문이 D1·콘솔·응답 어디에 남는지 이 값으로 찾는다.
const P={a:['김가상','010-0000-1101','kim.a@example.com'],b:['이테스트','010-0000-1102','lee.b@example.com'],c:['박예시','010-0000-1103',''],d:['최샘플','010-0000-1104','choi.d@example.com'],e:['정모의','','jung.e@example.com']};
const RAW=Object.values(P).flatMap(([n,p,e])=>[n,p,p.replace(/-/g,''),e]).filter(Boolean);

// ── 준비: 스위치·프로필(보관 위치 라벨)·모집 코드·캠페인 ──
check('owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);
for(const [b,branch] of [['fr-a','A'],['fr-c','B']]){const r=await f.profile(boss,b,{branch,storageLabels:['본사 문서함']},0);assert.equal(r.status,200,JSON.stringify(r.body))}
const issued=await post(boss,{action:'code_issue',brandId:'fr-a',channel:'search_ad',label:'가상 검색광고',customCode:'R2345678',validFrom:'2026-09-01'});
assert.equal(issued.status,200,JSON.stringify(issued.body));
await server.recordStatement(WS,'campaign','ca-r',{id:'ca-r',brandId:'fr-a',title:'가상 모집',status:'approved',version:1,objective:'franchise_recruitment',createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'},'fr-a').run();

const FILE1=csv(HEADC,row('2026-10-02 10:00',...P.a,'R2345678'),row('2026-10-02 11:00',...P.b),row('2026-10-03 09:30',...P.c));
const SHA1=sha(Buffer.from(FILE1));

// ════ RI-1b 파일 검사 ════
let snap=snapshot();
let r=await post(boss,{action:'lead_import_inspect',brandId:'fr-a',csvBase64:b64(FILE1)});
check('RI-1b inspection returns headers, row count and the suggested mapping with the contact targets, writing nothing and keeping no receipt',r.status===200&&JSON.stringify(r.body.result.headers)===JSON.stringify(HEADC.split(','))&&r.body.result.rowCount===3&&JSON.stringify(r.body.result.suggestedMapping)===JSON.stringify(MAPC)&&r.body.result.fileSha256===SHA1&&snapshot()===snap&&audits('lead_import').length===0);
check('RI-1b the inspection response holds no contact value',!RAW.some(v=>JSON.stringify(r.body).includes(v)));

// ════ RI-1 미리보기 ════
const p1=await preview(FILE1);
check('RI-1 a preview is 200 with the plan counts and no write, lock-free receipt or server-only rows',p1.status===200&&p1.body.result.toCreate===3&&p1.body.result.providerLeadCount===3&&JSON.stringify(p1.body.result.merged)==='{"existing":{"count":0,"rows":[]},"inFile":{"count":0,"rows":[]}}'&&/^[0-9a-f]{64}$/.test(p1.body.result.planSha256)&&!('normalizedRows' in p1.body.result)&&snapshot()===snap&&p1.body.disclaimer===DISCLAIMER&&p1.body.result.importVersion===li.LEAD_IMPORT_VERSION);
check('RI-1 the preview response holds no contact value (rows and mapping only)',!RAW.some(v=>JSON.stringify(p1.body).includes(v)));
check('RI-12 the preview counts code attribution and the provider-file basis separately',JSON.stringify(p1.body.result.attribution)==='{"code":{"search_ad":1},"unattributed":{"no_code":2},"conflict":0,"fileBasis":{"portal":2}}'&&p1.body.result.note===rc.RECRUITMENT_ATTRIBUTION_NOTE);

// ════ RI-P 권한·분기 ════
snap=snapshot();
const memberCalls=[await post(member,{action:'lead_import_inspect',brandId:'fr-a',csvBase64:b64(FILE1)}),await preview(FILE1,{},member),await post(member,{...IMP('lead_import_confirm',FILE1),...expectOf(p1)})];
const memberView=await get(member,'view=imports&brandId=fr-a');
check('RI-P1 a member gets 403 on inspection, preview, confirm and the imports view, writing nothing',memberCalls.every(x=>fixed(x,403,'ADMIN_ONLY'))&&fixed(memberView,403,'ADMIN_ONLY')&&snapshot()===snap);
const adminPreview=await preview(FILE1,{},admin);
check('RI-P1 an admin (not only the owner) gets the same preview',adminPreview.status===200&&adminPreview.body.result.planSha256===p1.body.result.planSha256);
r=await post(boss,IMP('lead_import_preview',FILE1,{brandId:'fr-c'}));
check('RI-P3 a branch B brand is 409 branch_not_a',codesAre(r,409,'branch_not_a'));

// ════ RB 연락처 매핑(결정 32) ════
const META=csv('접수일시,희망지역','2026-10-02 10:00,서울 강남구');
r=await preview(META,{mapping:{receivedAt:0,region:1}});
check('RB-5 a ledger import without contact columns is 400 contact_mapping_invalid',codesAre(r,400,'contact_mapping_invalid'));
r=await preview(FILE1,{basis:undefined});
const consentBasis=await preview(FILE1,{basis:{type:'consent'}});
check('RB-5 a ledger import needs a basis and never takes consent',codesAre(r,400,'basis_invalid')&&codesAre(consentBasis,400,'basis_invalid'));
const noEmailMap={...MAPC};delete noEmailMap.contactEmail;
r=await preview(FILE1,{mapping:noEmailMap});
check('RB-2 an unmapped contact column rejects the whole file with its column number only',codesAre(r,400,'sensitive_column_in_file')&&JSON.stringify(r.body.errors)==='[{"column":"8번째 열"}]'&&!RAW.some(v=>JSON.stringify(r.body).includes(v)));

// ════ RI-6 개인정보 거부(확정) ════
const PIIFILE=csv(HEADC+',추가값',row('2026-10-02 10:00',...P.d)+',010-0000-1999');
const RID6='li-pii-0000001';
snap=snapshot();
r=await post(boss,{...IMP('lead_import_confirm',PIIFILE),requestId:RID6,confirm:true,expected:{planSha256:'0'.repeat(64),toCreate:1}});
const rejected=audits('lead_import_rejected');
check('RI-6 a confirm of a file with a phone number in an unmapped column is 400 pii_in_file with the row and column only',codesAre(r,400,'pii_in_file')&&JSON.stringify(r.body.errors)==='[{"row":2,"column":"추가값"}]'&&!JSON.stringify(r.body).includes('1999'));
check('RI-6 the rejection writes no lead and one plain audit row with counts and reason codes only (no file hash, no position)',countKind('franchise_lead')===0&&rejected.length===1&&rejected[0].count===1&&JSON.stringify(rejected[0].reasons)==='["pii_in_file"]'&&!('fileSha256' in rejected[0])&&!('requestAction' in rejected[0])&&!JSON.stringify(rejected[0]).includes('추가값'));
const FIXED=csv(HEADC,row('2026-10-02 10:00',...P.d)),FX={provenance:PROV({provider:'가상수정포털'})};
const pFixed=await preview(FIXED,FX);
r=await post(boss,{...IMP('lead_import_confirm',FIXED,FX),requestId:RID6,...expectOf(pFixed)});
check('RI-6 after fixing the file the same request id confirms with 200 (the old 400 is not replayed)',r.status===200&&r.body.result.created===1&&!r.body.replayed);

// ════ RI-2 확정 ════
const realBatch=env.DB.batch;let batchSizes=[];
env.DB.batch=async stmts=>{batchSizes.push(stmts.length);return realBatch(stmts)};
const RID2='li-confirm-0001';
const c1=await post(boss,{...IMP('lead_import_confirm',FILE1),requestId:RID2,...expectOf(p1)});
env.DB.batch=realBatch;
const imp1=importRow(SHA1),made=c1.body.result?.leadCodes?.map(leadBySystemCode)??[];
check('RI-2 the confirm creates one lead per person, one created event each, one import record and one receipt audit in one batch',c1.status===200&&c1.body.result.created===3&&made.length===3&&made.every(Boolean)&&made.every(l=>events(l.id,'created').length===1)&&!!imp1&&audits('lead_import').filter(a=>a.recordId===imp1.importId).length===1&&batchSizes.includes(3+5+3+2)&&Math.max(...batchSizes)===13);
check('RI-2 imported leads are inquiry leads with sealed contacts, receivedAt as the last activity, the import id and the declared basis',made.every(l=>l.stage==='inquiry'&&l.contactState==='present'&&/^v1\./.test(l.contact.name)&&(l.contact.phone===null||/^v1\./.test(l.contact.phone))&&(l.contact.email===null||/^v1\./.test(l.contact.email))&&l.memo===null&&l.lastActivityAt===l.receivedAt&&l.receivedPrecision==='time'&&Math.abs(Date.parse(l.createdAt)-nowMs())<5000&&/^ri-/.test(l.importId)&&l.importId===imp1.importId&&l.assigneeId===null&&l.task.sourceChannel==='portal'&&l.basis.type==='provided'&&l.basis.importId===imp1.importId&&l.basis.provider==='가상창업포털'&&l.basis.providedOn==='2026-10-04'&&l.basis.sourceNoticedAt===null&&!('sha256' in l.basis)&&/^L/.test(l.systemCode)));
check('RI-2 the received time is the provider time (KST 10:00 is 01:00Z) and codes carry source import',made[0].receivedAt==='2026-10-02T01:00:00.000Z'&&made[0].codes[0].code==='R2345678'&&made[0].codes[0].source==='import'&&!('codes' in made[1]));
check('RB-1 contact keys are stored for every phone and email (HMAC ids, no plain value)',Number(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='franchise_lead_key' AND parent_id IN (?,?,?)").get(...made.map(l=>l.id)).n)===5);
check('RB-1 no plain name, phone or email reaches any D1 row or the console',!RAW.some(v=>allData().includes(v))&&!RAW.some(v=>logged.some(l=>l.includes(v))));
check('RI-2 the import record holds the provenance, counts, versions and importer but no header name or cell value',imp1.fileSha256===SHA1&&imp1.hadBom===false&&imp1.encoding==='utf-8'&&imp1.channel==='portal'&&imp1.providerKey==='가상창업포털'&&imp1.provider==='가상창업포털'&&imp1.providedOn==='2026-10-04'&&JSON.stringify(imp1.period)==='{"from":"2026-09-01","to":"2026-10-03"}'&&imp1.consentRef.sha256===CONSENT&&imp1.basis.type==='provided'&&imp1.basis.declaredBy==='admin'&&imp1.counts.created===3&&imp1.counts.providerLeadCount===3&&imp1.counts.rows===3&&imp1.ruleVersion===rc.RECRUITMENT_VERSION&&imp1.importVersion===li.LEAD_IMPORT_VERSION&&imp1.importedBy.id==='li-boss'&&JSON.stringify(imp1.mapping)===JSON.stringify(MAPC)&&!JSON.stringify(imp1).includes('휴대폰')&&!JSON.stringify(imp1).includes('서울 강남구'));
check('RI-2 the confirm response carries new lead codes and counts only',c1.body.result.leadCodes.every(c=>/^L/.test(c))&&!RAW.some(v=>JSON.stringify(c1.body).includes(v)));

// ════ RI-3·4·7 멱등 ════
snap=snapshot();
r=await post(boss,{...IMP('lead_import_confirm',FILE1),requestId:RID2,...expectOf(p1)});
check('RI-3 the same request id and input replays 200 with the same result and no new row',r.status===200&&r.body.replayed===true&&JSON.stringify(r.body.result)===JSON.stringify(c1.body.result)&&snapshot()===snap);
r=await post(boss,{...IMP('lead_import_confirm',FIXED,FX),requestId:RID2,...expectOf(pFixed)});
check('RI-3b the same request id with another file is 409 REQUEST_REUSED and writes nothing',fixed(r,409,'REQUEST_REUSED')&&snapshot()===snap);
r=await confirm(FILE1,p1);
check('RI-4 a new request id for the same file is 409 file_duplicate (its own declared period also makes every row an overlap) and writes nothing',r.status===409&&reasons(r)[0]==='file_duplicate'&&snapshot()===snap);
const FILE2=csv(HEADC,row('2026-10-02 12:00','최샘플','010-0000-1105','')),F2={provenance:PROV({provider:'가상포털2'})};
const p2=await preview(FILE2,F2);
r=await post(boss,{...IMP('lead_import_confirm',FILE2,F2),confirm:true,expected:{planSha256:'f'.repeat(64),toCreate:1}});
check('RI-7 a different planSha256 is 409 expected_mismatch and writes nothing',codesAre(r,409,'expected_mismatch')&&snapshot()===snap&&p2.status===200);

// ════ RM 교차 파일·파일 안 병합(대표 결정: 리드 1건, 집계는 파일별) ════
const leadA=made[0],beforeA=leadA,countBefore=countKind('franchise_lead');
const FILEX=csv(HEADC,row('2026-10-04 09:00','김가상','01000001101','other.a@example.com'),row('2026-10-04 10:00',...P.d.slice(0,2),'new.d@example.com'));
const EXPO=x=>({channel:'expo',provenance:PROV({provider:'가상박람회',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'}}),basis:{type:'inquiry_response'},...x});
const px=await preview(FILEX,EXPO());
check('RM-1 preview: the same person from another provider file merges into the existing lead, shown as a count and a row number only',px.status===200&&px.body.result.toCreate===0&&JSON.stringify(px.body.result.merged)==='{"existing":{"count":2,"rows":[2,3]},"inFile":{"count":0,"rows":[]}}'&&px.body.result.providerLeadCount===2&&!RAW.some(v=>JSON.stringify(px.body).includes(v))&&!JSON.stringify(px.body).includes(leadA.id));
const cx=await confirm(FILEX,px,EXPO());
const aAfter=f.leadRow(leadA.id),impX=importRow(sha(Buffer.from(FILEX)));
check('RM-1 confirm: no new lead, the existing lead gets the provider record appended and the file counts one lead per person',cx.status===200&&countKind('franchise_lead')===countBefore&&cx.body.result.created===0&&aAfter.imports.length===2&&aAfter.imports[1].merged===true&&aAfter.imports[1].channel==='expo'&&aAfter.imports[1].provider==='가상박람회'&&aAfter.imports[1].importId===impX.importId&&impX.counts.providerLeadCount===2&&impX.counts.mergedExisting===2&&impX.counts.created===0&&importRow(SHA1).counts.providerLeadCount===3);
check('RM-1 the merge keeps the contact, basis and first import and moves the last activity to the later receipt',aAfter.contact.name===beforeA.contact.name&&aAfter.contact.email===beforeA.contact.email&&JSON.stringify(aAfter.basis)===JSON.stringify(beforeA.basis)&&aAfter.importId===beforeA.importId&&aAfter.lastActivityAt==='2026-10-04T00:00:00.000Z'&&aAfter.version===beforeA.version+1&&events(leadA.id,'import_merged').length===1&&events(leadA.id,'import_merged')[0].importId===impX.importId);
const lvA=await leadView(boss,leadA.id);
check('RM-1 the lead view lists both provider records (provider, channel, received time) without the consent hash',lvA.status===200&&lvA.body.imports.length===2&&lvA.body.imports[1].provider==='가상박람회'&&lvA.body.imports[1].channelLabel==='박람회'&&!JSON.stringify(lvA.body).includes(CONSENT));
const FILEY=csv(HEADC,row('2026-10-04 11:00','박새로','010-0000-1106','park.new@example.com'));
const py=await preview(FILEY,{provenance:PROV({provider:'가상커뮤니티',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'},consentRef:undefined}),channel:'community',basis:{type:'inquiry_response'}});
const cy=await confirm(FILEY,py,{provenance:PROV({provider:'가상커뮤니티',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'},consentRef:undefined}),channel:'community',basis:{type:'inquiry_response'}});
check('RM-2 a different person in another provider file becomes a new lead',cy.status===200&&cy.body.result.created===1&&countKind('franchise_lead')===countBefore+1);
const FILEZ=csv(HEADC,row('2026-10-04 12:00',...P.e),row('2026-10-04 13:00','정모의','','JUNG.E@example.com'),row('2026-10-04 14:00','한다른','010-0000-1107',''));
const ZP={provenance:PROV({provider:'가상블로그',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'},consentRef:undefined}),channel:'blog_post',basis:{type:'inquiry_response'}};
const pz=await preview(FILEZ,ZP);
const cz=await confirm(FILEZ,pz,ZP),impZ=importRow(sha(Buffer.from(FILEZ)));
check('RM-3 the same person twice in one file is one lead and one person in the file count',pz.status===200&&JSON.stringify(pz.body.result.merged)==='{"existing":{"count":0,"rows":[]},"inFile":{"count":1,"rows":[3]}}'&&cz.status===200&&cz.body.result.created===2&&impZ.counts.providerLeadCount===2&&impZ.counts.mergedInFile===1&&leads().filter(l=>l.importId===impZ.importId).length===2);
const manual=await f.createLead(boss,'fr-a',{contact:{name:'수기문의',phone:'010-0000-1108'}});
const ML=manual.body.result.leadId;
const FILEM=csv(HEADC,row('2026-10-04 15:00','수기문의','010-0000-1108',''));
const MP={provenance:PROV({provider:'가상유튜브',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'},consentRef:undefined}),channel:'youtube',basis:{type:'inquiry_response'}};
const pm=await preview(FILEM,MP),cm=await confirm(FILEM,pm,MP);
check('RM-4 a file row matching a manually registered lead merges into it',pm.body.result.toCreate===0&&pm.body.result.merged.existing.count===1&&cm.status===200&&f.leadRow(ML).imports.length===1&&f.leadRow(ML).imports[0].merged===true&&!('importId' in f.leadRow(ML)));
check('RM-4 a merged manual lead keeps its own attribution (no provider-file basis from a merge)',(await leadView(boss,ML)).body.attribution.state==='unattributed');
const FILEQ=csv(HEADC,row('2026-10-04 16:00','경합자','010-0000-1109',''));
const QP={provenance:PROV({provider:'가상커뮤니티2',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'},consentRef:undefined}),channel:'community',basis:{type:'inquiry_response'}};
const pq=await preview(FILEQ,QP);
await f.createLead(boss,'fr-a',{contact:{name:'경합자',phone:'010-0000-1109'}});
snap=snapshot();
r=await confirm(FILEQ,pq,QP);
check('RM-6 when a matching lead appears between preview and confirm the confirm is 409 expected_mismatch and writes nothing',codesAre(r,409,'expected_mismatch')&&snapshot()===snap);

// ════ RI-8 기간 겹침 ════
const FILEO=csv(HEADC,row('2026-10-03 15:00','오버랩','010-0000-1110',''),row('2026-10-04 15:00','새기간','010-0000-1111',''));
const OP={provenance:PROV({provider:'가상 창업포털',providedOn:'2026-10-04',period:{from:'2026-10-03',to:'2026-10-04'}})};
const po=await preview(FILEO,OP);
check('RI-8 rows inside an earlier declared period of the same provider key are skipped as overlap',po.status===200&&po.body.result.skipped.overlap===1&&po.body.result.toCreate===1);

// ════ RI-12 귀속 ════
const leadB=made[1];
const lvB=await leadView(boss,leadB.id),lvA2=await leadView(boss,leadA.id);
check('RI-12 a code-less imported lead is attributed on the provider-file basis and a coded one on the code',lvB.body.attribution.basis==='import'&&lvB.body.attribution.label==='제공처 파일 기준 · 창업 포털'&&lvB.body.attribution.channel==='portal'&&lvA2.body.attribution.basis==='code'&&lvA2.body.attribution.channel==='search_ad');
const inflowImport=await get(boss,'view=board&brandId=fr-a&inflow=import'),inflowPortal=await get(boss,'view=board&brandId=fr-a&inflow=portal');
check('RI-12 the board inflow filter import selects provider-file leads and the channel filter counts code attribution only',inflowImport.status===200&&inflowImport.body.leads.some(l=>l.id===leadB.id)&&!inflowImport.body.leads.some(l=>l.id===leadA.id)&&!inflowPortal.body.leads.some(l=>l.id===leadB.id));
const codesNow=await get(member,'view=codes&brandId=fr-a');
check('RI-12 the codes view counts the provider-file basis in its own column under the attribution note',codesNow.status===200&&Object.keys(codesNow.body)[0]==='attributionNote'&&codesNow.body.fileBasis.portal===3&&codesNow.body.byChannel.search_ad.attributed===1&&codesNow.body.byChannel.portal.attributed===0);
const EVS=await post(boss,{action:'event_save',brandId:'fr-a',campaignId:'ca-r',type:'tour',startsAt:'2026-10-20T14:00:00+09:00',placeLabel:'가상 박람회장',capacity:5,spendRef:null,assetRefs:[]});
const EVID=EVS.body.result?.eventId;
const FILEE=csv(HEADC,row('2026-10-04 17:00','행사참가','010-0000-1112',''));
const EP={channel:'expo',eventId:EVID,provenance:PROV({provider:'가상박람회2',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'}}),basis:{type:'provided'}};
const pe=await preview(FILEE,EP),ce=await confirm(FILEE,pe,EP),impE=importRow(sha(Buffer.from(FILEE)));
const leadE=leadBySystemCode(ce.body.result?.leadCodes?.[0]);
check('RI-12 an expo import keeps the event id on the record and on the provider-file attribution',EVS.status===200&&ce.status===200&&impE.eventId===EVID&&(await leadView(boss,leadE.id)).body.attribution.eventId===EVID&&leadE.task.sourceChannel==='expo');

// ════ RI-14·15·18 수집 근거 ════
r=await f.createLead(boss,'fr-a',{basis:{type:'provided'}});
const intake=await get(boss,'view=intake&brandId=fr-a');
check('RI-14 create_lead with basis provided is 400 and the intake basis choices leave provided out',r.status===400&&!('provided' in intake.body.labels.basis)&&Object.keys(intake.body.labels.basis).length===3);
const board=await get(boss,'view=board&brandId=fr-a&todo=source_notice');
check('RI-15 provided imports raise the source notice to-do',board.status===200&&board.body.todos.sourceNoticePending>=4&&board.body.leads.some(l=>l.id===leadB.id&&l.sourceNoticePending===true));
r=await post(boss,{action:'record_source_notice',brandId:'fr-a',leadId:leadB.id,version:f.leadRow(leadB.id).version,noticedAt:'now'});
check('RI-15 record_source_notice is 200 on a provided lead and clears the to-do',r.status===200&&f.leadRow(leadB.id).basis.sourceNoticedAt!==null&&!(await get(boss,'view=board&brandId=fr-a&todo=source_notice')).body.leads.some(l=>l.id===leadB.id));
const FILER=csv(HEADC,row('2026-10-04 18:00','추천인','010-0000-1113',''));
const RP={channel:'owner_referral',provenance:PROV({provider:'가상가맹점',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'},consentRef:undefined}),basis:{type:'referral'}};
const pr=await preview(FILER,RP),cr=await confirm(FILER,pr,RP),leadR=leadBySystemCode(cr.body.result?.leadCodes?.[0]);
check('RI-18 an owner referral import has sourceChannel referral and the franchisee referral basis',cr.status===200&&leadR.task.sourceChannel==='referral'&&leadR.basis.type==='referral'&&leadR.basis.referralFrom==='franchisee'&&leadR.basis.sourceNoticedAt===null);

// ════ RB-7 열람 감사·RI-17 보기 ════
r=await post(boss,{action:'reveal_contact',brandId:'fr-a',leadId:leadB.id,fields:['name','phone'],purpose:'call_back'});
check('RB-7 revealing an imported contact returns the value and leaves an audit row without it',r.status===200&&r.body.values.name===P.b[0]&&audits('reveal').some(a=>a.leadId===leadB.id)&&!audits('reveal').some(a=>JSON.stringify(a).includes(P.b[0])));
const lvRaw=JSON.stringify((await leadView(member,leadB.id)).body);
check('RI-17 an imported lead view shows masked contacts only and no 64-hex value (no customer_id finding)',!RAW.some(v=>lvRaw.includes(v))&&!pii.scanText(lvRaw).some(x=>x.kind==='customer_id')&&!lvRaw.includes(SHA1)&&!lvRaw.includes(CONSENT));

// ════ RI-16 잠금 ════
const token=await server.acquireLock(WS+':franchise');
const FILEL=csv(HEADC,row('2026-10-04 19:00','잠금확인','010-0000-1114',''));
const LP={provenance:PROV({provider:'가상잠금',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'}})};
const pl=await preview(FILEL,LP),il=await post(boss,{action:'lead_import_inspect',brandId:'fr-a',csvBase64:b64(FILEL)}),cl=await confirm(FILEL,pl,LP),ml=await f.createLead(member,'fr-a');
await server.releaseLock(WS+':franchise',token);
check('RI-16 inspection and preview take no lock (200 while the franchise lock is held) while confirm and create_lead wait (409)',pl.status===200&&il.status===200&&cl.status===409&&ml.status===409);

// ════ RI-5 가명 코드 ════
const existingCode=leadB.systemCode,idx=[...existingCode.slice(1)].map(ch=>'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.indexOf(ch));
const realRandom=webcrypto.getRandomValues;
let forced=1;
webcrypto.getRandomValues=a=>{if(a instanceof Uint8Array&&a.length===32&&forced>0){forced--;a.fill(0);idx.forEach((v,i)=>{a[i]=v});return a}return realRandom.call(webcrypto,a)};
const cl2=await confirm(FILEL,pl,LP);
webcrypto.getRandomValues=realRandom;
const leadL=leadBySystemCode(cl2.body.result?.leadCodes?.[0]);
check('RI-5 a generated lead code that already exists is drawn again: the new lead gets a different code',cl2.status===200&&forced===0&&!!leadL&&leadL.systemCode!==existingCode&&new Set(leads().map(l=>l.systemCode)).size===leads().length);
check('RI-5 no cell value is used as a lead code',!leads().some(l=>RAW.includes(l.systemCode)));
const FILEK=csv(HEADC,row('2026-10-04 20:00','코드실패','010-0000-1115',''));
const KP={provenance:PROV({provider:'가상코드',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'}})};
const pk=await preview(FILEK,KP);
snap=snapshot();
webcrypto.getRandomValues=a=>{if(a instanceof Uint8Array&&a.length===32){a.fill(0);idx.forEach((v,i)=>{a[i]=v});return a}return realRandom.call(webcrypto,a)};
r=await confirm(FILEK,pk,KP);
webcrypto.getRandomValues=realRandom;
check('RI-5 when every draw collides the confirm is 409 IMPORT_RETRY and writes nothing',fixed(r,409,'IMPORT_RETRY')&&snapshot()===snap);

// ════ RI-9 동시 확정 ════
const FILEC2=csv(HEADC,row('2026-10-04 21:00','동시확정','010-0000-1116',''));
const CP={provenance:PROV({provider:'가상동시',providedOn:'2026-10-04',period:{from:'2026-10-04',to:'2026-10-04'}})};
const pc=await preview(FILEC2,CP),importsBefore=countKind('recruitment_import');
const both=await Promise.all([confirm(FILEC2,pc,CP),confirm(FILEC2,pc,CP)]);
check('RI-9 two simultaneous confirms of one file with different request ids give one 200 and one 409, never 500, and one import',JSON.stringify(both.map(x=>x.status).sort())==='[200,409]'&&countKind('recruitment_import')===importsBefore+1&&importRow(sha(Buffer.from(FILEC2)))!==null);

// ════ GET imports ════
r=await get(boss,'view=imports&brandId=fr-a');
const listed=r.body.imports||[];
check('imports view: admins see each import with provenance, counts and versions, newest first, without a file row value',r.status===200&&listed.length===countKind('recruitment_import')&&listed.some(i=>i.importId===imp1.importId&&i.counts.providerLeadCount===3)&&listed.every(i=>typeof i.importedAt==='string')&&Date.parse(listed[0].importedAt)>=Date.parse(listed[listed.length-1].importedAt)&&!RAW.some(v=>JSON.stringify(r.body).includes(v))&&r.body.disclaimer===DISCLAIMER);
check('imports view: coverage lists the declared periods per provider key',Array.isArray(r.body.coverage['가상창업포털'])&&r.body.coverage['가상창업포털'].some(p=>p.from==='2026-09-01'&&p.to==='2026-10-03'));

// ════ RI-13 보존 기한(H11) ════
const OLD=kstDay(-179);
const FILEH=csv(HEADC,row(`${OLD} 10:00`,'오래된문의','010-0000-1117',''));
const HP={provenance:PROV({provider:'가상오래된포털',providedOn:kstDay(-1),period:{from:OLD,to:kstDay(-1)}})};
const ph=await preview(FILEH,HP),chh=await confirm(FILEH,ph,HP),leadH=leadBySystemCode(chh.body.result?.leadCodes?.[0]);
check('RI-13 a row received today-179 is imported with retention at receipt + 180 days',chh.status===200&&f.lib.retentionUntil(f.leadRow(leadH.id))===new Date(Date.parse(f.leadRow(leadH.id).receivedAt)+180*DAY).toISOString());
setNow(nowMs()+2*DAY);
const lvH=await leadView(boss,leadH.id);
check('RI-13 two days later the imported lead shows 보존 기한 지남 (expired)',lvH.body.contactState==='expired');
const FILEH2=csv(HEADC,row(`${kstDay(-1)} 10:00`,'오래된문의','010-0000-1117',''));
const H2P={provenance:PROV({provider:'가상재문의',providedOn:kstDay(-1),period:{from:kstDay(-1),to:kstDay(-1)}})};
const ph2=await preview(FILEH2,H2P);
check('RM-5 an expired matching lead is not a merge target: the preview creates a new lead',ph2.status===200&&ph2.body.result.toCreate===1&&ph2.body.result.merged.existing.count===0);
const ch2=await confirm(FILEH2,ph2,H2P);
check('RM-5 the confirm purges the expired lead first and the same number becomes a new lead',ch2.status===200&&f.leadRow(leadH.id).contactState==='purged'&&f.leadRow(leadH.id).contact===null&&leadBySystemCode(ch2.body.result.leadCodes[0]).contactState==='present');
r=await post(boss,{action:'update_contact',brandId:'fr-a',leadId:leadH.id,version:f.leadRow(leadH.id).version,contact:{phone:'010-0000-1118'}});
check('RI-13 the purged imported lead does not come back through a new activity (409 CONTACT_GONE)',fixed(r,409,'CONTACT_GONE'));

// ════ RI-P2 스위치 꺼짐 ════
check('owner turns the franchise switch off',(await f.setFlag(boss,false)).status===200);
snap=snapshot();
const offCalls=[await post(boss,{action:'lead_import_inspect',brandId:'fr-a',csvBase64:b64(FILEK)}),await preview(FILEK,KP),await confirm(FILEK,pk,KP)];
check('RI-P2 with the switch off inspection, preview and confirm are 409 OFF and write nothing',offCalls.every(x=>fixed(x,409,'OFF'))&&snapshot()===snap);

// ════ 감사·문구 ════
const BASE=['id','brandId','action','actor','at','requestAction','status','result','target','leadId'],EXTRA=['recordId','channel','periodFrom','periodTo','fileSha256','planSha256','inputSha256','count','skipped','reasons','ruleVersion','importVersion'];
const importAudits=[...audits('lead_import'),...audits('lead_import_rejected')];
check('audit rows of lead_import and lead_import_rejected use only the allowed keys and hold no header, provider label or cell value',importAudits.length>=10&&importAudits.every(a=>Object.keys(a).every(k=>BASE.includes(k)||EXTRA.includes(k)))&&!importAudits.some(a=>/가상창업포털|본사 문서함|휴대폰|서울 강남구/.test(JSON.stringify(a))));
check('the lead_import receipt carries the file and plan hash and the input hash',audits('lead_import').every(a=>/^[0-9a-f]{64}$/.test(a.fileSha256)&&/^[0-9a-f]{64}$/.test(a.planSha256)&&/^[0-9a-f]{64}$/.test(a.inputSha256)&&a.importVersion===li.LEAD_IMPORT_VERSION));
check('no response makes a legal-adequacy claim',!responses.some(b=>/법적으로 적합|준수 완료|합법/.test(JSON.stringify(b))));
check('no unexpected failure was logged and no external call was made',!logged.some(l=>/franchise_request_failed/.test(l))&&f.calls.length===0);
check('no plain contact value reached the console',!RAW.some(v=>logged.some(l=>l.includes(v))));
const IDS=['RI-1','RI-1b','RI-2','RI-3','RI-3b','RI-4','RI-5','RI-6','RI-7','RI-8','RI-9','RI-12','RI-13','RI-14','RI-15','RI-16','RI-17','RI-18','RI-P1','RI-P2','RI-P3','RB-1','RB-2','RB-5','RB-7','RM-1','RM-2','RM-3','RM-4','RM-5','RM-6'];
const missingIds=IDS.filter(id=>!passed.some(n=>n.startsWith(id+' ')));
assert.deepEqual(missingIds,[],'이름에 없는 사례 번호: '+missingIds.join(', '));passed.push(`every R5b-2 case id (${IDS.length}) has a named check`);

console.log(JSON.stringify({passed:passed.length}));
