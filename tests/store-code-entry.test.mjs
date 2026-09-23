// A4-3 추적 코드 직접 입력 회귀: 주문 기록 창(save_order)·장부 양식 CSV(import_orders rows)의 trackingCode.
// 코드 조회(정규화·워크스페이스 안 id=코드·이 지점 코드), 모르는 코드 400·다른 지점 409·삭제된 캠페인 409, 게시 관문(게시 전·확인 전·취소 → 저장하되 귀속 없음과 사유),
// 적용 시작일 전 미귀속, 스위치(a4_auto_attribution) 꺼짐과 무관, 코드 칸 비움 = 칸 없음 = 기존 결과(새 주문·코드 귀속 사본이 있는 주문 수정 모두), 사용자 선택과 코드 충돌 409,
// 주문 수정 때 코드 유지·교체, 읽은 코드 5개 보존, 장부 양식 CSV의 코드 귀속·거절 건수·출처 문구·요청당 쿼리 수, 앱 게시 기록 없는 소재의 수동 귀속 경고(차단 없음),
// 권한(코드가 든 장부 양식 CSV는 관리자, 주문 기록 창의 코드 칸은 직원도 쓰고 넣은 사람을 남김), 개인정보 거부 유지.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const {sql,env}=rt;
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const sa=await rt.load('lib/store-attribution.ts'),server=await rt.load('lib/server.ts'),logic=await rt.load('lib/store-operations.ts'),flags=await rt.load('lib/feature-flags.ts'),route=await rt.load('app/api/store-operations/route.ts');

// 1) 순수 규칙: 직접 입력 근거 문구, 코드 자동 문구 판별, 게시 관문의 자동 문구 처리
check('the manual code evidence names the code and its type',sa.manualEvidence({code:'CAMP2345',type:'coupon'})==='추적 코드 CAMP2345(쿠폰) 직접 입력'&&sa.manualEvidence({code:'PDRA2345',type:'pos_tag'})==='추적 코드 PDRA2345(POS 태그) 직접 입력');
check('both code wordings are recognised as automatic and person text is not',sa.isCodeEvidence(sa.manualEvidence({code:'CAMP2345',type:'coupon'}))&&sa.isCodeEvidence(sa.autoEvidence({code:'CAMP2345',type:'qr'}))&&!sa.isCodeEvidence('계산대 구두 확인')&&!sa.isCodeEvidence('추적 코드 CAMP2345 확인')&&!sa.isCodeEvidence(''));
const gateOrder={orderDate:'2026-09-20',campaignId:'c1',creativeId:'cr1',channel:'social',attributionEvidence:sa.manualEvidence({code:'PCAN2345',type:'coupon'}),codeAttribution:{codeId:'PCAN2345',code:'PCAN2345',publicationId:'pc',conflictCodeIds:[]}};
const gated=plain(sa.publicationGateView(gateOrder,new Map([['pc',{status:'cancelled',scheduledDay:'2026-09-01'}]])));
check('the gate view treats the manual wording like the import wording',!gated.codeAttribution&&!gated.campaignId&&gated.channel==='unknown'&&gated.attributionEvidence==='');
check('the unpublished creative warning is the agreed wording',sa.UNPUBLISHED_CREATIVE_WARNING==='이 소재는 앱에서 게시된 기록이 없습니다. 앱 밖에서 게시했다면 근거에 적어 주세요.');
check('the ledger import notes name refusals and warnings only when counted',JSON.stringify(sa.entrySummaryNotes({beforePublication:1,pendingPublication:2,notYetValid:1,unpublishedCreatives:3}))===JSON.stringify(['게시 코드로 귀속하지 않음: 게시 전 주문 1건 · 게시 상태 확인 전 2건','코드 적용 시작일 전 주문 1건은 추적 코드로 귀속하지 않았습니다.','앱에서 게시된 기록이 없는 소재에 직접 귀속한 주문 3건: 앱 밖에서 게시했다면 근거에 적어 주세요.'])&&sa.entrySummaryNotes({}).length===0&&sa.entrySummaryNotes(undefined).length===0);

// 2) 준비: 지점 2곳, 캠페인·소재, 게시(예약 접수·내일 예약·승인 전·취소·게시 확인), 추적 코드(라우트로 만든다)
const owner='a43-owner-production-authenticated-id';
const save=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await save('store','s1',{id:'s1',brandId:'oda',name:'지점',status:'active',version:1},'oda');
await save('store','s2',{id:'s2',brandId:'oda',name:'다른 지점',status:'active',version:1},'oda');
for(const [id,storeId] of [['c1','s1'],['c2','s1'],['c-del','s1'],['c-s2','s2']])await save('campaign',id,{id,brandId:'oda',storeId,title:id});
for(const [id,campaignId,storeId] of [['cr1','c1','s1'],['cr2','c1','s1'],['cr3','c1','s1'],['cr-del','c-del','s1'],['cr-c2','c2','s1'],['cr-s2','c-s2','s2']])await save('execution_creative',id,{id,campaignId,brandId:'oda',storeId,version:1,title:id,createdAt:'2026-09-01T00:00:00.000Z'},campaignId);
const T=logic.koreaToday(),at=(day,hm='00:30')=>new Date(`${day}T${hm}:00+09:00`).toISOString();
const pubRecord=(id,status,scheduledAt,creativeId='cr1')=>({id,campaignId:'c1',creativeId,creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:'캡션',mediaUrl:'',scheduledAt,plannedCostKRW:0,version:1,status,createdAt:'x'});
const pub=(id,status,scheduledAt,creativeId)=>save('execution_publication',id,pubRecord(id,status,scheduledAt,creativeId),'c1');
await pub('p-acc','accepted',at(sa.addDays(T,-3)));
await pub('p-future','accepted',at(sa.addDays(T,1)));
await pub('p-draft','draft',at(sa.addDays(T,-3)));
await pub('p-can','cancelled',at(sa.addDays(T,-3)));
await pub('p-pub','published',at(sa.addDays(T,-3)),'cr2');
const call=async(body,storeId='s1')=>{const r=await route.POST(new Request('https://agency.test/api/store-operations',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({storeId,...body})}));return {status:r.status,...await r.json()}};
const week=sa.addDays(T,-7);
const makeCode=async(code,over={},storeId='s1')=>{const r=await call({action:'create_tracking_code',type:'coupon',campaignId:'c1',label:code,code,validFrom:week,...over},storeId);assert.equal(r.status,200,code+' '+r.error);return r.code};
await makeCode('CAMP2345',{creativeId:'cr1',channel:'social',arm:'A'});
await makeCode('CAMP6789');
await makeCode('PACC2345',{publicationId:'p-acc'});
await makeCode('PFUT2345',{publicationId:'p-future'});
await makeCode('PDRA2345',{publicationId:'p-draft',type:'pos_tag'});
await makeCode('PCAN2345',{publicationId:'p-can'});
await makeCode('PPUB2345',{publicationId:'p-pub'});
await makeCode('NEXT2345',{validFrom:T});
await makeCode('DEAD2345',{campaignId:'c-del'});
await makeCode('XSTR2345',{campaignId:'c-s2'},'s2');
await server.database().prepare('DELETE FROM records WHERE id=?').bind(`${owner}:campaign:c-del`).run();

const base={source:'pos',orderNumber:'X',orderDate:T,mode:'hall',status:'paid',paidAmount:1000,refundAmount:0,channel:'unknown'};
const saveOrder=(data,extra={})=>call({action:'save_order',data:{...base,...data},...extra});
const orderBy=number=>{const row=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='store_order' AND json_extract(data,'$.orderNumber')=?").get(owner,number);return row?JSON.parse(row.data):null};
const editOrder=(o,data={})=>call({action:'save_order',id:o.id,version:o.version,data:{source:o.source,orderNumber:o.orderNumber,orderDate:o.orderDate,mode:o.mode,status:o.status,paidAmount:o.paidAmount,refundAmount:o.refundAmount,costs:o.costs,channel:o.channel,experimentId:o.experimentId,campaignId:o.campaignId||'',creativeId:o.creativeId||'',attributionEvidence:o.attributionEvidence,note:o.note,...data}});

// 3) 코드 입력 귀속: 정규화한 코드로 찾아 캠페인·소재·팔·유입 채널을 채운다. 스위치는 기본 꺼짐이다.
check('the automatic attribution switch is off by default',await flags.isEnabled(owner,'a4_auto_attribution')===false);
let res=await saveOrder({orderNumber:'M1',trackingCode:' camp-2345 '});
let o=orderBy('M1');
check('a typed code attributes the order with the switch off',res.status===200&&o.campaignId==='c1'&&o.creativeId==='cr1'&&o.channel==='social');
check('the order keeps a code attribution copy with the arm and who typed it',JSON.stringify(o.codeAttribution)===JSON.stringify({codeId:'CAMP2345',code:'CAMP2345',arm:'A',conflictCodeIds:[],enteredBy:{id:owner,email:null}}));
check('an empty evidence is filled with the direct-entry wording',o.attributionEvidence==='추적 코드 CAMP2345(쿠폰) 직접 입력'&&JSON.stringify(o.trackingCodes)==='["CAMP2345"]');
check('the response says the order was attributed by the code',JSON.stringify(res.attribution)===JSON.stringify({via:'code',code:'CAMP2345'}));
res=await saveOrder({orderNumber:'M2',trackingCode:'CAMP2345',attributionEvidence:'계산대 쿠폰 제시 확인'});
check('a person-written evidence is kept',res.status===200&&orderBy('M2').attributionEvidence==='계산대 쿠폰 제시 확인'&&orderBy('M2').codeAttribution.codeId==='CAMP2345');
res=await saveOrder({orderNumber:'M3',trackingCode:'CAMP2345',campaignId:'c1',creativeId:'cr1'});
check('choosing the same campaign and creative as the code is fine',res.status===200&&orderBy('M3').codeAttribution.codeId==='CAMP2345');
res=await saveOrder({orderNumber:'M4',trackingCode:'CAMP2345',channel:'daangn'});
check('a channel the person chose is kept over the code channel',res.status===200&&orderBy('M4').channel==='daangn'&&orderBy('M4').codeAttribution.codeId==='CAMP2345');
res=await saveOrder({orderNumber:'M5',trackingCode:'CAMP6789'});
check('a code without a creative attributes to its campaign only',res.status===200&&orderBy('M5').campaignId==='c1'&&!orderBy('M5').creativeId&&orderBy('M5').channel==='unknown');
await flags.setFeatureFlag(owner,{flag:'a4_auto_attribution',enabled:false},{id:owner,email:null});
res=await saveOrder({orderNumber:'M6',trackingCode:'CAMP2345'});
check('a typed code attributes even with the switch explicitly off',res.status===200&&orderBy('M6').codeAttribution?.codeId==='CAMP2345');

// 4) 코드 거절: 모르는 코드 400, 형식 오류 400(값을 싣지 않는다), 다른 지점 409, 삭제된 캠페인 409, 사용자 선택과 다른 코드 409
const count=()=>sql.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='store_order'").get(owner).n;
let before=count();
res=await saveOrder({orderNumber:'R1',trackingCode:'ZZZZ2345'});
check('an unknown code is a 400 with a clear message',res.status===400&&res.error.includes('등록되지 않은 추적 코드')&&count()===before);
res=await saveOrder({orderNumber:'R2',trackingCode:'010-1234-5678'});
check('a malformed code is a 400 that does not echo the value',res.status===400&&res.error.includes('4~12자')&&!res.error.includes('1234')&&!res.error.includes('5678')&&count()===before);
res=await saveOrder({orderNumber:'R3',trackingCode:'XSTR2345'});
check('a code of another store is a 409',res.status===409&&res.error.includes('다른 지점')&&count()===before);
res=await saveOrder({orderNumber:'R4',trackingCode:'DEAD2345'});
check('a code whose campaign was deleted is refused',res.status===409&&res.error.includes('쓸 수 없는 추적 코드')&&count()===before);
res=await saveOrder({orderNumber:'R5',trackingCode:'CAMP2345',campaignId:'c2',attributionEvidence:'직원 확인'});
check('a campaign chosen apart from the code is a 409',res.status===409&&res.error.includes('CAMP2345')&&count()===before);
res=await saveOrder({orderNumber:'R6',trackingCode:'CAMP2345',campaignId:'c1',creativeId:'cr2',attributionEvidence:'직원 확인'});
check('a creative chosen apart from the code is a 409',res.status===409&&count()===before);
res=await saveOrder({orderNumber:'R7',trackingCode:'CAMP6789',campaignId:'c1',creativeId:'cr1',attributionEvidence:'직원 확인'});
check('a creative added to a campaign-only code is a 409 (the code decides)',res.status===409&&count()===before);

// 5) 게시 관문: 게시 전·확인 전·취소 게시의 코드는 저장하되 코드 귀속 없이 사유를 보인다. 적용 시작일 전 주문도 같다.
res=await saveOrder({orderNumber:'G1',trackingCode:'PACC2345'});
o=orderBy('G1');
check('a live publication code attributes to the publication',res.status===200&&o.codeAttribution.publicationId==='p-acc'&&o.creativeId==='cr1'&&res.attribution.via==='code'&&!res.attribution.warning);
const refused=async(number,code,reason)=>{const r=await saveOrder({orderNumber:number,trackingCode:code}),x=orderBy(number);return r.status===200&&x&&!x.codeAttribution&&!x.campaignId&&!x.creativeId&&x.channel==='unknown'&&x.attributionEvidence===''&&JSON.stringify(x.trackingCodes)===JSON.stringify([code])&&r.attribution.via==='none'&&r.attribution.code===code&&r.attribution.publicationRefusal===reason&&typeof r.attribution.warning==='string'&&r.attribution.warning.includes(code)};
check('an order before the scheduled Korean day is saved without the code attribution',await refused('G2','PFUT2345','before_publication'));
check('a code of a publication not confirmed yet is saved without the attribution (pending)',await refused('G3','PDRA2345','pending'));
check('a code of a cancelled publication is saved without the attribution',await refused('G4','PCAN2345','not_live'));
res=await saveOrder({orderNumber:'G5',trackingCode:'PFUT2345',campaignId:'c1',creativeId:'cr1'});
check('a campaign picked only to mirror a refused code is not kept',res.status===200&&!orderBy('G5').campaignId&&!orderBy('G5').codeAttribution);
res=await saveOrder({orderNumber:'G6',trackingCode:'PFUT2345',campaignId:'c1',creativeId:'cr1',attributionEvidence:'계산대 구두 확인'});
check('a person-written evidence keeps the manual attribution when the code is refused',res.status===200&&orderBy('G6').campaignId==='c1'&&orderBy('G6').creativeId==='cr1'&&!orderBy('G6').codeAttribution&&res.attribution.via==='manual'&&res.attribution.publicationRefusal==='before_publication');
res=await saveOrder({orderNumber:'G7',trackingCode:'PFUT2345',channel:'social'});
check('a chosen channel without evidence still needs evidence when the code is refused',res.status===400&&res.error.includes('근거')&&!orderBy('G7'));
res=await saveOrder({orderNumber:'G8',orderDate:sa.addDays(T,-1),trackingCode:'NEXT2345'});
check('an order before the code start date is saved without the attribution',res.status===200&&!orderBy('G8').codeAttribution&&!orderBy('G8').campaignId&&res.attribution.beforeValidFrom===true&&res.attribution.warning.includes('적용 시작일'));
res=await saveOrder({orderNumber:'G9',trackingCode:'PPUB2345'});
check('a published publication code attributes with its creative',res.status===200&&orderBy('G9').codeAttribution.publicationId==='p-pub'&&orderBy('G9').creativeId==='cr2');

// 6) 코드 칸 비움 = 기존 흐름(바이트 단위). 칸이 없을 때와 저장 결과·오류가 같다.
const shape=x=>JSON.stringify(Object.entries(x).filter(([k])=>!['id','orderNumber','createdAt','updatedAt'].includes(k)));
res=await saveOrder({orderNumber:'L1'});const l2=await saveOrder({orderNumber:'L2',trackingCode:''});
check('an empty code field saves an unattributed order like before',res.status===200&&l2.status===200&&shape(orderBy('L1'))===shape(orderBy('L2')));
const manual={campaignId:'c1',creativeId:'cr1',attributionEvidence:'계산대 구두 확인',note:'메모'};
res=await saveOrder({orderNumber:'L3',...manual});const l4=await saveOrder({orderNumber:'L4',...manual,trackingCode:''});
check('an empty code field saves a manual attribution like before',res.status===200&&l4.status===200&&shape(orderBy('L3'))===shape(orderBy('L4'))&&res.attribution.via==='manual'&&l4.attribution.via==='manual');
res=await saveOrder({orderNumber:'L5',campaignId:'c1'});const l6=await saveOrder({orderNumber:'L6',campaignId:'c1',trackingCode:''});
check('an empty code field still needs evidence for a manual attribution',res.status===400&&l6.status===400&&res.error===l6.error);

// 7) 앱 게시 기록 없는 소재의 수동 귀속: 막지 않고 경고한다(앱 밖 게시 가능성).
res=await saveOrder({orderNumber:'W1',campaignId:'c1',creativeId:'cr3',attributionEvidence:'전단 쿠폰 확인'});
check('a manual attribution to a creative never published in the app is saved with a warning',res.status===200&&orderBy('W1').creativeId==='cr3'&&res.attribution.via==='manual'&&res.attribution.unpublishedCreative===true&&res.attribution.warning===sa.UNPUBLISHED_CREATIVE_WARNING);
res=await saveOrder({orderNumber:'W2',campaignId:'c1',creativeId:'cr1',attributionEvidence:'전단 쿠폰 확인'});
const w3=await saveOrder({orderNumber:'W3',campaignId:'c1',creativeId:'cr2',attributionEvidence:'전단 쿠폰 확인'}),w4=await saveOrder({orderNumber:'W4',campaignId:'c1',attributionEvidence:'전단 쿠폰 확인'});
check('accepted or published creatives and campaign-only attributions carry no warning',res.status===200&&!res.attribution.warning&&w3.status===200&&!w3.attribution.warning&&w4.status===200&&!w4.attribution.warning);
check('a code attribution carries no unpublished creative warning',!(await saveOrder({orderNumber:'W5',trackingCode:'CAMP2345'})).attribution.warning);

// 8) 주문 수정: 같은 코드는 유지, 다른 코드는 교체. 칸을 비우면 칸을 보내지 않을 때와 바이트 단위로 같다(기존 사본 규칙: 대상이 같으면 사본 유지, 바꾸면 사본만 뺀다).
o=orderBy('M1');
res=await editOrder(o,{trackingCode:'CAMP2345',note:'영수증 재확인'});
check('editing with the same code keeps the code attribution',res.status===200&&orderBy('M1').codeAttribution.codeId==='CAMP2345'&&orderBy('M1').note==='영수증 재확인'&&orderBy('M1').attributionEvidence==='추적 코드 CAMP2345(쿠폰) 직접 입력');
res=await editOrder(orderBy('M1'),{trackingCode:'CAMP2345',campaignId:'c2',creativeId:''});
check('changing the campaign while the code stays is a 409',res.status===409&&orderBy('M1').campaignId==='c1');
res=await editOrder(orderBy('M1'),{trackingCode:'CAMP6789'});
o=orderBy('M1');
check('a different code replaces the attribution and its wording',res.status===200&&o.codeAttribution.codeId==='CAMP6789'&&o.campaignId==='c1'&&!o.creativeId&&o.attributionEvidence==='추적 코드 CAMP6789(쿠폰) 직접 입력'&&JSON.stringify(o.trackingCodes)==='["CAMP2345","CAMP6789"]');
res=await editOrder(orderBy('M1'),{trackingCode:'PFUT2345'});
o=orderBy('M1');
check('replacing with a refused code drops the old attribution and says why',res.status===200&&!o.codeAttribution&&!o.campaignId&&o.attributionEvidence===''&&res.attribution.publicationRefusal==='before_publication');
res=await editOrder(orderBy('M2'),{trackingCode:''});
o=orderBy('M2');
check('an empty code field on an edit keeps the copy like an edit without the field',res.status===200&&o.codeAttribution?.codeId==='CAMP2345'&&o.campaignId==='c1'&&o.creativeId==='cr1'&&o.attributionEvidence==='계산대 쿠폰 제시 확인'&&res.attribution.via==='code');
for(const n of ['E1','E2'])await saveOrder({orderNumber:n,trackingCode:'CAMP2345'});
const blankKeep=await editOrder(orderBy('E1'),{trackingCode:'',note:'같은 대상'}),absentKeep=await editOrder(orderBy('E2'),{note:'같은 대상'});
check('an empty code field equals an absent field when the target stays',blankKeep.status===200&&absentKeep.status===200&&shape(orderBy('E1'))===shape(orderBy('E2'))&&orderBy('E1').codeAttribution?.codeId==='CAMP2345'&&JSON.stringify(blankKeep.attribution)===JSON.stringify(absentKeep.attribution));
const blankMove=await editOrder(orderBy('E1'),{trackingCode:'',campaignId:'c2',creativeId:''}),absentMove=await editOrder(orderBy('E2'),{campaignId:'c2',creativeId:''});
check('an empty code field equals an absent field when the campaign changes',blankMove.status===200&&absentMove.status===200&&shape(orderBy('E1'))===shape(orderBy('E2'))&&!orderBy('E1').codeAttribution&&orderBy('E1').campaignId==='c2'&&JSON.stringify(blankMove.attribution)===JSON.stringify(absentMove.attribution));
res=await editOrder(orderBy('M4'),{note:'코드 칸 없이 수정'});
check('an edit without the code field keeps the copy (existing rule)',res.status===200&&orderBy('M4').codeAttribution?.codeId==='CAMP2345');

// 9) 가져온 주문(스위치 켬)의 확인 전 게시 사본은 같은 코드로 고쳐도 그대로 둔다(A4-2 규칙). 응답은 사유를 알린다.
await flags.setFeatureFlag(owner,{flag:'a4_auto_attribution',enabled:true},{id:owner,email:null});
res=await call({action:'import_orders',csv:`주문번호,주문일시,결제금액,쿠폰코드\nPOS1,${T},7000,PACC2345\nPOS2,${T},7000,PACC2345\nPOS3,${T},7000,PACC2345\nREAD1,${T},7000,RDAA2345;RDBB2345;RDCC2345;RDDD2345;RDEE2345;RDFF2345`,mapping:{orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',code:'쿠폰코드'},dryRun:false});
check('a POS import attributes to the live publication',res.status===200&&orderBy('POS1').codeAttribution?.publicationId==='p-acc');
await flags.setFeatureFlag(owner,{flag:'a4_auto_attribution',enabled:false},{id:owner,email:null});
await save('execution_publication','p-acc',pubRecord('p-acc','blocked',at(sa.addDays(T,-3))),'c1');
res=await editOrder(orderBy('POS1'),{trackingCode:'PACC2345',note:'확인 전 수정'});
o=orderBy('POS1');
check('an unchanged code of a pending publication keeps the copy and the import wording',res.status===200&&o.codeAttribution?.publicationId==='p-acc'&&o.attributionEvidence===sa.autoEvidence({code:'PACC2345',type:'coupon'})&&o.note==='확인 전 수정');
check('the response says the kept copy is out of the report until confirmed',res.attribution.via==='code'&&res.attribution.publicationRefusal==='pending'&&res.attribution.warning.includes('귀속 보고'));
await save('execution_publication','p-acc',pubRecord('p-acc','accepted',at(sa.addDays(T,-3))),'c1');
const posKeepBlank=await editOrder(orderBy('POS2'),{trackingCode:'',note:'대상 유지'}),posKeepAbsent=await editOrder(orderBy('POS3'),{note:'대상 유지'});
check('on an imported order an empty code field equals an absent field when the target stays',posKeepBlank.status===200&&posKeepAbsent.status===200&&shape(orderBy('POS2'))===shape(orderBy('POS3'))&&orderBy('POS2').codeAttribution?.publicationId==='p-acc'&&orderBy('POS2').campaignId==='c1');
const posMoveBlank=await editOrder(orderBy('POS2'),{trackingCode:'',campaignId:'c2',creativeId:''}),posMoveAbsent=await editOrder(orderBy('POS3'),{campaignId:'c2',creativeId:''});
check('on an imported order an empty code field equals an absent field when the campaign changes',posMoveBlank.status===200&&posMoveAbsent.status===200&&shape(orderBy('POS2'))===shape(orderBy('POS3'))&&!orderBy('POS2').codeAttribution&&orderBy('POS2').campaignId==='c2');
res=await editOrder(orderBy('READ1'),{trackingCode:'CAMP6789'});
o=orderBy('READ1');
check('typing a code on an order with five read codes keeps the codes the import read',res.status===200&&o.codeAttribution?.code==='CAMP6789'&&JSON.stringify(o.trackingCodes)===JSON.stringify(['RDAA2345','RDBB2345','RDCC2345','RDDD2345','RDEE2345']));

// 10) 직접 입력한 게시 코드도 게시가 취소되면 보고서·수정이 가져오기 자동 귀속과 같게 다룬다.
const report=async()=>(await call({action:'attribution_report',from:T,to:T}));
let rep=await report();
check('the report counts a typed publication code by publication',rep.status===200&&rep.byPublication.find(g=>g.key==='p-pub')?.orders===1);
await save('execution_publication','p-pub',pubRecord('p-pub','cancelled',at(sa.addDays(T,-3)),'cr2'),'c1');
rep=await report();
check('after the publication is cancelled the typed code order leaves the publication rows',!rep.byPublication.some(g=>g.key==='p-pub')&&rep.notes.some(x=>x.includes('게시 관문 밖')));
res=await editOrder(orderBy('G9'),{note:'취소 뒤 수정'});
check('editing it saves it unattributed like an import refusal',res.status===200&&!orderBy('G9').codeAttribution&&!orderBy('G9').campaignId&&res.attribution.publicationRefusal==='not_live');

// 11) 장부 양식 CSV(rows)의 trackingCode 열: 같은 조회·관문, 결과 요약에 코드 귀속·거절 건수. 오류는 원자적이다.
const csv=['source,orderNumber,orderDate,mode,status,paidAmount,refundAmount,campaignId,creativeId,attributionEvidence,trackingCode',`pos,C1,${T},hall,paid,100,0,,,,camp2345`,`pos,C2,${T},hall,paid,100,0,,,,PFUT2345`,`pos,C3,${T},hall,paid,100,0,,,,PDRA2345`,`pos,C4,${T},hall,paid,100,0,,,,PCAN2345`,`pos,C5,${sa.addDays(T,-1)},hall,paid,100,0,,,,NEXT2345`,`pos,C6,${T},hall,paid,100,0,c1,cr3,전단 확인,`,`pos,C7,${T},hall,paid,100,0,,,,`].join('\n');
const rows=logic.parseOrderCsv(csv);
check('the ledger form accepts a trackingCode column',rows.length===7&&rows[0].trackingCode==='camp2345'&&logic.orderCsvTemplate.includes('trackingCode'));
res=await call({action:'import_orders',rows});
check('ledger rows with codes are saved',res.status===200&&res.count===7);
check('the ledger import summary counts code attributions and refusals',JSON.stringify(res.summary)===JSON.stringify({codeAttributed:1,publicationRefused:3,beforePublication:1,unpublished:1,pendingPublication:1,notYetValid:1,unpublishedCreatives:1}));
check('a ledger row code is attributed like a typed code and its wording names the ledger file',orderBy('C1').codeAttribution?.codeId==='CAMP2345'&&orderBy('C1').attributionEvidence==='추적 코드 CAMP2345(쿠폰) 직접 입력 · 장부 양식 CSV'&&!orderBy('C2').codeAttribution&&!orderBy('C2').campaignId);
check('a ledger row with an empty code keeps the existing flow',!orderBy('C7').codeAttribution&&!orderBy('C7').trackingCodes&&orderBy('C6').creativeId==='cr3');
before=count();
res=await call({action:'import_orders',rows:[{...base,orderNumber:'U1',trackingCode:'CAMP2345'},{...base,orderNumber:'U2',trackingCode:'ZZZZ2345'}]});
check('an unknown ledger code names its row and saves nothing',res.status===400&&res.error.startsWith('3행')&&res.error.includes('등록되지 않은')&&count()===before);
res=await call({action:'import_orders',rows:[{...base,orderNumber:'U3',trackingCode:'XSTR2345'}]});
check('a ledger code of another store is a 409',res.status===409&&count()===before);

// 12) 개인정보 거부 규칙 유지: 장부 양식 행의 메모·근거·코드 칸의 휴대폰 번호는 값 없이 거부한다.
res=await call({action:'import_orders',rows:[{...base,orderNumber:'P1',trackingCode:'CAMP2345',note:'고객 010-1234-5678'}]});
check('a phone number in a ledger note is still refused with a code',res.status===400&&res.error.includes('휴대폰')&&!res.error.includes('1234'));
res=await call({action:'import_orders',rows:[{...base,orderNumber:'P2',trackingCode:'010-2345-6789'}]});
check('a phone number in the ledger code column is refused without the value',res.status===400&&res.error.includes('휴대폰')&&!res.error.includes('2345-6789')&&count()===before);

// 13) 장부 양식 CSV 200행이 같은 게시 코드를 써도 코드 조회·게시 읽기·캠페인 검사는 요청 안에서 한 번이다(D1 요청당 쿼리 한도). 수동 귀속 행도 같은 캠페인·소재 검사를 다시 하지 않는다.
check('the ledger direct-entry wording is a code wording for the gate view',sa.isCodeEvidence(sa.manualEvidence({code:'CAMP2345',type:'coupon'},true))&&sa.manualEvidence({code:'CAMP2345',type:'coupon'},true)==='추적 코드 CAMP2345(쿠폰) 직접 입력 · 장부 양식 CSV');
const prepare=env.DB.prepare;let statements=0;
const counted=async body=>{statements=0;env.DB.prepare=q=>{statements++;return prepare(q)};try{return await call(body)}finally{env.DB.prepare=prepare}};
res=await counted({action:'import_orders',rows:Array.from({length:200},(_,i)=>({...base,orderNumber:'Q'+i,trackingCode:'PACC2345'}))});
check('200 ledger rows sharing one publication code stay within 3 statements a row',res.status===200&&res.summary.codeAttributed===200&&statements<=600);
res=await counted({action:'import_orders',rows:Array.from({length:200},(_,i)=>({...base,orderNumber:'H'+i,campaignId:'c1',creativeId:'cr1',attributionEvidence:'전단 확인'}))});
check('200 hand-attributed ledger rows stay within 3 statements a row',res.status===200&&res.count===200&&statements<=600);

// 14) 권한: 코드가 든 장부 양식 CSV는 POS CSV 확정처럼 관리자만 올린다. 주문 기록 창의 코드 칸은 직원도 쓰고, 넣은 사람을 코드 귀속 사본(enteredBy)에 남긴다.
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return token};
const as=async(token,body)=>{const r=await route.POST(new Request('https://agency.test/api/store-operations',{method:'POST',headers:{'Content-Type':'application/json',cookie:'__Host-collective_session='+token,origin:'https://agency.test'},body:JSON.stringify({storeId:'s1',...body})}));return {status:r.status,...await r.json()}};
const member=signIn('a43-member','member',500),admin=signIn('a43-admin','admin',2000);
before=count();
res=await as(member,{action:'import_orders',rows:[{...base,orderNumber:'S1',trackingCode:'CAMP2345'},{...base,orderNumber:'S2'}]});
check('a member cannot import ledger rows that carry a tracking code',res.status===403&&res.error.includes('관리자')&&count()===before);
res=await as(member,{action:'import_orders',rows:[{...base,orderNumber:'S3'},{...base,orderNumber:'S4',trackingCode:''}]});
check('a member still imports ledger rows without codes',res.status===200&&res.count===2&&!orderBy('S4').codeAttribution);
res=await as(admin,{action:'import_orders',rows:[{...base,orderNumber:'S5',trackingCode:'CAMP2345'}]});
check('an admin imports ledger rows with codes and is recorded as the actor',res.status===200&&orderBy('S5').codeAttribution?.enteredBy?.id==='a43-admin'&&orderBy('S5').codeAttribution.enteredBy.email==='a43-admin@test.invalid');
res=await as(member,{action:'save_order',data:{...base,orderNumber:'S6',trackingCode:'CAMP2345'}});
check('a member may type a code in the order dialog and is recorded as the actor',res.status===200&&res.attribution.via==='code'&&orderBy('S6').codeAttribution?.enteredBy?.id==='a43-member'&&orderBy('S6').codeAttribution.enteredBy.email==='a43-member@test.invalid');

// 15) 화면: 주문 기록 창은 코드 칸을 비워 연다(비우면 칸 없음과 같다). 지금 귀속한 코드와 읽거나 입력했지만 귀속하지 않은 코드는 칸 아래 안내에 보인다.
const panel=readFileSync('app/store-operations-panel.tsx','utf8');
check('the order dialog opens with an empty code field',!panel.includes('trackingCode:initial?.codeAttribution?.code')&&panel.includes("trackingCode:'',attributionEvidence:initial?.attributionEvidence"));
check('the order dialog names the current code and codes read or typed without attribution',panel.includes('지금 귀속한 추적 코드')&&panel.includes('읽거나 입력했지만 귀속하지 않은 코드')&&!panel.includes('가져올 때 읽은 코드'));

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
