// 규정 수정 제안(docs/COMPLIANCE-FIXES.ko.md): 순수 제안 계산(종류별 한국어 합성 예시·적용 뒤 재제안 0건·겹침 거절·숫자 지어내지 않음·결정론),
// 적용 요청 apply_compliance_fixes(스위치·권한·범위 역할·판 충돌·서버 재계산·새 버전·ai_edited·이력·사건 문구·다시 점검), 화면 연결(정적).
// 근거: mocked(메모리 SQLite, 쿠키 세션 주입, fetch 스텁). 모델·외부 네트워크 호출은 0회다. 데이터는 합성(실제 고객·매장 아님). 법률 자문이 아니다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const fx=await rt.load('lib/graders/compliance-fixes.ts'),cc=await rt.load('lib/graders/compliance.ts'),disclosure=await rt.load('lib/ai-disclosure.ts');
const server=await rt.load('lib/server.ts'),flags=await rt.load('lib/feature-flags.ts');
const sourcesRoute=await rt.load('app/api/artifact-sources/route.ts'),actionRoute=await rt.load('app/api/action/route.ts');
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const plain=x=>JSON.parse(JSON.stringify(x));
const fixesOf=(text,opts)=>plain(fx.computeComplianceFixes(text,opts));
const applyAll=(text,opts)=>fx.applyComplianceFixes(text,fx.computeComplianceFixes(text,opts));
const rules=(text,opts)=>plain(cc.checkCompliance(text,opts)).issues.map(i=>i.ruleId);
const digits=s=>new Set(s.match(/\d+/g)||[]);

// ── 1) 종류별 제안(순수) ──
const SPONSOR='## 게시물 카피\n- 인플루언서에게 제품을 무상 제공하고 후기 게시를 요청한다.\n매장 분위기를 보여 준다.';
let f=fixesOf(SPONSOR);
check('sponsorship: one insert of #광고 at the start of the hit line (after the list marker)',f.length===1&&f[0].ruleId==='sponsorship_undisclosed'&&f[0].kind==='insert'&&f[0].after==='#광고 '&&f[0].before===''&&applyAll(SPONSOR).includes('- #광고 인플루언서에게'));
check('sponsorship fix clears the rule and is not suggested again',!rules(applyAll(SPONSOR)).includes('sponsorship_undisclosed')&&fixesOf(applyAll(SPONSOR)).length===0);
const BLOG='### 블로그 원고\n소정의 대가를 받고 블로그 체험단 글을 작성한다.';
check('a blog part gets the [광고] prefix instead of #광고',fixesOf(BLOG)[0]?.after==='[광고] '&&applyAll(BLOG).includes('\n[광고] 소정의'));
const OMIT='협찬 게시물로 올리되 광고 표기는 빼 주세요.';
f=fixesOf(OMIT);const omit=f.find(x=>x.ruleId==='disclosure_omitted');
check('disclosure_omitted: the omission instruction is replaced by a disclosure sentence, keeping the period',omit?.kind==='replace'&&omit.before==='광고 표기는 빼 주세요'&&omit.after==='‘#광고’ 표기를 게시물 첫머리에 넣는다'&&fx.applyComplianceFixes(OMIT,[omit]).endsWith('넣는다.'));
check('disclosure_omitted and sponsorship are both cleared after applying all',rules(applyAll(OMIT)).length===0&&fixesOf(applyAll(OMIT)).length===0);
const AI_OMIT='릴스는 AI 표시 없이 게시한다.';
check('an AI omission instruction becomes an AI label sentence',fixesOf(AI_OMIT).find(x=>x.ruleId==='disclosure_omitted')?.after==='AI 생성 표시를 게시물에 넣는다');
const VP='## 릴스\n가상 인플루언서 루나가 매장을 소개하는 릴스를 게시한다.\n생성형 AI로 만든 매장 이미지를 메인 배너에 쓴다.\n\n## 다음 섹션\n일반 문장입니다.';
f=fixesOf(VP);
const vp=f.find(x=>x.ruleId==='virtual_person_undisclosed'),ai=f.find(x=>x.ruleId==='ai_generated_unlabeled');
check('virtual person: appends the confirmed disclosure line from lib/ai-disclosure.ts at the end of the part',vp?.kind==='append'&&vp.after==='\n'+disclosure.VIRTUAL_PERSON_LINE&&applyAll(VP).includes('메인 배너에 쓴다.\n'+disclosure.VIRTUAL_PERSON_LINE));
check('AI media: appends the visible AI label and is flagged as needing a check',ai?.kind==='append'&&ai.after.startsWith('\nAI 생성 표시: ')&&ai.needsCheck===true);
check('both appends land before the next section and clear both rules',applyAll(VP).indexOf('## 다음 섹션')>applyAll(VP).indexOf('AI 생성 표시')&&rules(applyAll(VP)).length===0&&fixesOf(applyAll(VP)).length===0);
const SMS='오픈 알림 문자 초안: 가상분식 오픈! 첫 주문 고객께 김밥을 드립니다. 지금 방문하세요.';
f=fixesOf(SMS,{senderName:'가상분식'});
const label=f.find(x=>x.ruleId==='ad_label_missing'),optout=f.find(x=>x.ruleId==='optout_missing');
check('ad message: (광고) goes right after the draft label colon',label?.kind==='insert'&&label.after==='(광고) '&&applyAll(SMS).startsWith('오픈 알림 문자 초안: (광고) 가상분식'));
check('ad message: sender and an 080 placeholder line are appended and flagged 확인 필요',optout?.kind==='append'&&optout.after==='\n전송자: 가상분식, 무료 수신거부 '+fx.OPTOUT_PLACEHOLDER+' [확인 필요]'&&optout.needsCheck===true);
check('without a sender name the sender is a placeholder, not an invented name',fixesOf(SMS).find(x=>x.ruleId==='optout_missing').after.includes(fx.SENDER_PLACEHOLDER));
check('ad label and opt-out are cleared; consent has no automatic fix and stays',JSON.stringify(rules(applyAll(SMS)))==='["consent_missing"]'&&fixesOf(applyAll(SMS)).length===0);
const SMS_BLOCK='### 알림톡 발송 문안 B\n\n이번 주 신메뉴 할인 쿠폰을 드립니다. 방문하세요.';
check('a label-only draft line puts (광고) at the start of the following paragraph',applyAll(SMS_BLOCK).includes('\n\n(광고) 이번 주 신메뉴'));
const FOOD='## 상세\n이 식혜는 혈당을 낮춰 줍니다. 매일 아침 드세요.\n- 면역력 강화에 좋은 차입니다.\n맛있습니다.';
f=fixesOf(FOOD);
check('disease claim: every claim sentence gets its own remove fix',f.length===2&&f.every(x=>x.ruleId==='disease_claim'&&x.kind==='remove'&&x.after===''));
check('removing a sentence mid-line keeps the rest; removing a whole list line drops the line',applyAll(FOOD)==='## 상세\n매일 아침 드세요.\n맛있습니다.'&&fixesOf(applyAll(FOOD)).length===0);
const COSMETIC='이 크림은 여드름을 치료합니다. 순한 향입니다.';
check('drug-like cosmetic claim is removed',applyAll(COSMETIC)==='순한 향입니다.');
const RECRUIT={franchise:{scope:'recruitment'}};
const FR='## 모집\n업계 1위 브랜드와 함께하세요.\n월 수익 보장! 지금 상담하세요.';
const frRules=rules(FR,RECRUIT);
f=fixesOf(FR,RECRUIT);
check('franchise superlative is replaced by a 확인 필요 placeholder',frRules.includes('kr.fr.superlative_claims')&&f.find(x=>x.ruleId==='kr.fr.superlative_claims')?.after===fx.CLAIM_PLACEHOLDER);
check('franchise revenue guarantee is removed with no invented replacement sentence',!frRules.includes('kr.fr.revenue_guarantee')||f.find(x=>x.ruleId==='kr.fr.revenue_guarantee')?.after==='');
check('franchise fixes clear their rules in recruitment scope',['kr.fr.superlative_claims','kr.fr.revenue_guarantee'].every(id=>!rules(applyAll(FR,RECRUIT),RECRUIT).includes(id)));
check('a confirmed claim_basis fact leaves the superlative unflagged, so no fix is suggested',fixesOf(FR,{...RECRUIT,facts:{confirmed:[{key:'claim_basis',value:'합성 조사'}],prohibited:[]}}).every(x=>x.ruleId!=='kr.fr.superlative_claims'));
const MANUAL='영수증 리뷰 작성 시 음료 1잔을 증정합니다.\n지금 구매하세요.';
check('rules without a safe fix (review reward, price) produce no suggestion',rules(MANUAL).length>0&&fixesOf(MANUAL).length===0);
check('clean text has no suggestions',fixesOf('## 소개\n평일 오후에 들르기 좋은 분식집입니다.').length===0);

// ── 2) 성질(순수) ──
const MIX=[SPONSOR,VP,SMS,FOOD,OMIT].join('\n\n---\n\n');
const mixFixes=fixesOf(MIX,{senderName:'가상분식'});
check('a mixed document yields suggestions for every fixable rule hit',['sponsorship_undisclosed','virtual_person_undisclosed','ai_generated_unlabeled','ad_label_missing','optout_missing','disease_claim','disclosure_omitted'].every(id=>mixFixes.some(x=>x.ruleId===id)));
const once=applyAll(MIX,{senderName:'가상분식'});
check('idempotent: after applying all suggestions, recomputing yields none',fixesOf(once,{senderName:'가상분식'}).length===0);
check('idempotent: applying the (empty) second round changes nothing',applyAll(once,{senderName:'가상분식'})===once);
check('deterministic: the same text gives the same ids and ranges',JSON.stringify(fixesOf(MIX,{senderName:'가상분식'}))===JSON.stringify(mixFixes)&&new Set(mixFixes.map(x=>x.id)).size===mixFixes.length);
check('suggested ranges never overlap each other',fx.overlappingFixes(mixFixes).length===0);
check('every fix records its rule sources and a Korean rationale',mixFixes.every(x=>x.sources.length>0&&/[가-힣]/.test(x.rationale)&&x.preview.before!==x.preview.after));
check('no invented numbers: every number in the fixed text already appears in the original or the 080 placeholder',[...digits(once)].every(n=>digits(MIX).has(n)||n==='080'));
check('no fix text carries digits other than the 080 placeholder',mixFixes.every(x=>[...digits(x.after)].every(n=>n==='080')));
const ins={id:'a',range:{start:5,end:5},before:'',after:'X'},del={id:'b',range:{start:2,end:8},before:'cdefgh',after:''};
assert.throws(()=>fx.applyComplianceFixes('abcdefghij',[ins,del]),fx.ComplianceFixConflictError);passed++;
assert.throws(()=>fx.applyComplianceFixes('abcdefghij',[{id:'c',range:{start:0,end:4},before:'abcd',after:''},{id:'d',range:{start:3,end:6},before:'def',after:''}]),fx.ComplianceFixConflictError);passed++;
check('an insert at the edge of a removal is not an overlap',fx.applyComplianceFixes('abcdefghij',[{id:'e',range:{start:2,end:2},before:'',after:'['},del])==='ab[ij');
assert.throws(()=>fx.applyComplianceFixes('abcdefghij',[{id:'f',range:{start:0,end:2},before:'zz',after:''}]),fx.ComplianceFixConflictError);passed++;
check('applying does not mutate the fix list',(()=>{const list=fx.computeComplianceFixes(SMS);const copy=JSON.stringify(list);fx.applyComplianceFixes(SMS,list);return JSON.stringify(list)===copy})());

// ── 3) 적용 요청(라우트) ──
const O='workspace',X='other-ws',now=new Date().toISOString(),tokens={};let at=Date.now();
const put=(kind,id,data,parent='',owner=O)=>server.recordStatement(owner,kind,id,data,parent).run();
const user=async(id,role,ws=O,membership)=>{
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',at++);
 const token=createHash('sha256').update('tok-'+id).digest('hex');tokens[id]=token;
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000,Date.now());
 if(membership)await put('membership',id,{userId:id,...membership,updatedAt:now,updatedBy:{id:'admin',email:null}});
};
await user('admin','admin');await user('member','member');await user('x-admin','admin',X);
await user('bm','member',O,{role:'brand_manager',brandIds:['gb'],storeIds:[]});
await user('bm-other','member',O,{role:'brand_manager',brandIds:['zz'],storeIds:[]});
await user('rv','member',O,{role:'reviewer',brandIds:['gb'],storeIds:[]});
const cookie=id=>({cookie:'__Host-collective_session='+tokens[id]});
const post=async(id,data)=>{const r=await actionRoute.POST(new Request('https://app.test/api/action',{method:'POST',headers:{...cookie(id),origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}};
const get=async(q,id='admin')=>{const r=await sourcesRoute.GET(new Request('https://app.test/api/artifact-sources'+q,{headers:cookie(id)}));return {status:r.status,data:await r.json()}};
await put('brand','gb',{id:'gb',name:'가상분식',short:'GB'});
await put('campaign','c1',{id:'c1',brandId:'gb',title:'가상분식 오픈',goal:'첫 포장 주문',audience:'',channels:'Instagram',stores:'',products:'떡볶이',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'review',version:1,createdAt:now,updatedAt:now});
const CONTENT='## 게시물 카피\n인플루언서에게 제품을 무상 제공하고 후기 게시를 요청한다.\n가상 인플루언서 루나가 매장을 소개한다.\n\n## 상세\n이 식혜는 혈당을 낮춰 줍니다. 매일 아침 드세요.';
const artifact=(id,extra={})=>({id,campaignId:'c1',campaignVersion:1,role:'content',title:'콘텐츠 '+id,content:CONTENT,version:1,status:'review',origin:'ai',createdAt:now,...extra});
for(const id of ['a1','a2','a3'])await put('artifact',id,artifact(id),'c1');
const stored=(kind,id)=>{const row=rt.sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? AND id=?').get(O,kind,`${O}:${kind}:${id}`);return row?JSON.parse(row.data):null};

let r=await get('?artifact=a1');
check('flag off: the read view has no fixes key (screen unchanged)',r.status===200&&!('fixes' in r.data.compliance)&&r.data.compliance.issues.length>=3);
r=await post('admin',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:['x']});
check('flag off: applying is 409 and writes nothing',r.status===409&&stored('artifact','a1').version===1);
await flags.setFeatureFlag(O,{flag:'compliance_fixes',enabled:true},{id:'admin',email:null});
r=await get('?artifact=a1');
const view=r.data.compliance.fixes;
check('flag on: the read view carries fixes for the current version with scope and law sources',view?.version===1&&view.scope.brandId==='gb'&&view.scope.campaignId==='c1'&&view.items.length===3&&view.items.every(i=>i.sources.every(s=>/^https:\/\//.test(s.url))&&!('range' in i)));
check('the read view fixes match the pure computation',JSON.stringify(view.items.map(i=>i.id))===JSON.stringify(fixesOf(CONTENT,{senderName:'가상분식'}).map(i=>i.id)));
check('a member can read the fixes (read is the same as sources)',(await get('?artifact=a1','member')).data.compliance.fixes?.items.length===3);
const ids=view.items.map(i=>i.id);
check('a plain member cannot apply (403)',(await post('member',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:ids})).status===403);
check('a reviewer cannot apply (403)',(await post('rv',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:ids})).status===403);
check('a brand manager of another brand cannot apply (403)',(await post('bm-other',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:ids})).status===403);
await flags.setFeatureFlag(X,{flag:'compliance_fixes',enabled:true},{id:'x-admin',email:null});
check('another workspace cannot apply (404)',(await post('x-admin',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:ids})).status===404);
check('a stale version is 409',(await post('admin',{action:'apply_compliance_fixes',artifactId:'a1',version:2,fixIds:ids})).status===409);
check('an unknown fix id is 409 (server recomputes; client text is never used)',(await post('admin',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:['sponsorship_undisclosed@0-0'],content:'클라이언트 글'})).status===409);
check('an empty or duplicate selection is 400',(await post('admin',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:[]})).status===400&&(await post('admin',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:[ids[0],ids[0]]})).status===400);
check('nothing was written by the rejected requests',stored('artifact','a1').version===1&&rt.sql.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='history'").get(O).n===0);

r=await post('admin',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:ids});
const a1=stored('artifact','a1');
check('admin apply returns 200 with the new version and applied count',r.status===200&&r.data.version===2&&r.data.applied===3&&r.data.id==='a1');
check('the new version holds exactly the server-applied text',a1.version===2&&a1.content===applyAll(CONTENT,{senderName:'가상분식'})&&a1.status==='review');
check('an AI artifact becomes ai_edited with its AI source and edit stats',a1.origin==='ai_edited'&&a1.aiSourceId==='a1:1'&&a1.aiSource?.id==='a1'&&!!a1.editStats);
check('the new version records which fixes were applied',a1.complianceFixes?.fromVersion===1&&a1.complianceFixes.count===3&&a1.complianceFixes.ruleIds.includes('disease_claim'));
const history=rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='history'").all(O).map(x=>JSON.parse(x.data));
check('the previous version is kept in history (same save path as save_artifact)',history.length===1&&history[0].originalId==='a1'&&history[0].version===1&&history[0].content===CONTENT);
const events=rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event'").all(O).map(x=>JSON.parse(x.data));
check('the history event says 규정 수정 제안 3건 적용 · v2',events.some(e=>e.message==='규정 수정 제안 3건 적용 · v2'&&e.campaignId==='c1'&&e.actor?.id==='admin'));
check('same-role sibling artifacts go outdated like a manual save',stored('artifact','a2').status==='outdated'&&stored('artifact','a3').status==='outdated');
const grading=stored('grading','a1:2');
check('the new version is regraded immediately (deterministic, no model)',grading?.status==='graded'&&grading.artifactVersion===2&&r.data.grading.status==='graded');
check('the returned compliance has the fixed issues cleared and no further suggestions',!r.data.compliance.issues.some(i=>['sponsorship_undisclosed','virtual_person_undisclosed','disease_claim'].includes(i.ruleId))&&r.data.compliance.fixes.items.length===0&&r.data.compliance.fixes.version===2);
check('the old version can no longer be applied (409)',(await post('admin',{action:'apply_compliance_fixes',artifactId:'a1',version:1,fixIds:ids})).status===409);

// 범위 역할(브랜드 매니저, 배정 브랜드 안)은 적용할 수 있다. 일부만 고르면 고른 것만 바뀐다.
await put('artifact','b1',artifact('b1',{role:'cmo',campaignVersion:1}),'c1');
const bView=(await get('?artifact=b1','bm')).data.compliance.fixes;
const onlyFood=bView.items.filter(i=>i.ruleId==='disease_claim').map(i=>i.id);
r=await post('bm',{action:'apply_compliance_fixes',artifactId:'b1',version:1,fixIds:onlyFood});
const b1=stored('artifact','b1');
check('a brand manager in scope can apply (200)',r.status===200&&b1.version===2);
check('only the picked fix changed the text',b1.content===fx.applyComplianceFixes(CONTENT,fx.computeComplianceFixes(CONTENT).filter(x=>onlyFood.includes(x.id)))&&b1.content.includes('#광고')===false&&!b1.content.includes('혈당'));
check('remaining suggestions are returned for the new version',r.data.compliance.fixes.items.length===2&&r.data.compliance.fixes.items.every(i=>i.ruleId!=='disease_claim'));
check('the regrade records the scoped role',stored('grading','b1:2')?.regradedBy?.role==='brand_manager');
// save_artifact는 같은 묶음 함수로 바뀌었고 결과는 이전과 같다(사건 문구·이력).
r=await post('admin',{action:'save_artifact',id:'b1',version:2,campaignId:'c1',role:'cmo',title:'콘텐츠 b1',content:'직접 고친 본문입니다.'});
check('save_artifact still saves a new version with the usual event text',r.status===200&&stored('artifact','b1').version===3&&stored('artifact','b1').origin==='ai_edited'&&rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event'").all(O).map(x=>JSON.parse(x.data)).some(e=>/작업물 수정 · v3$/.test(e.message)));
check('no model or network call happened',fetchCalls===0);

// ── 4) 화면 연결(정적) ──
const panel=readFileSync('components/app/compliance-panel.tsx','utf8'),list=readFileSync('components/app/compliance-fixes.tsx','utf8');
check('the panel loads the fix list lazily only when the view has fixes',/lazy\(\(\)=>import\('\.\/compliance-fixes'\)\)/.test(panel)&&/compliance\.fixes&&/.test(panel)&&/regradeArtifact\(artifactId\)/.test(panel));
check('the fix list reuses the word diff, asks a confirm card with what/where/reversible and sends only ids',/<VersionDiff compact /.test(list)&&/askConfirm\(/.test(list)&&/reversible:t\('fixes\.reversible'\)/.test(list)&&/applyComplianceFixes\(artifactId,fixes\.version,chosen\.map\(f=>f\.id\)\)/.test(list));
check('rules without a fix say 직접 고쳐야 합니다',readFileSync('lib/i18n/ko-trust.ts','utf8').includes("'fixes.manual':'직접 고쳐야 합니다."));
console.log(JSON.stringify({passed}));
