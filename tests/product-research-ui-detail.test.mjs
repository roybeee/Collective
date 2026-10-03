// 상품 리서치 화면 계산(lib/product-research/ui-detail.ts)을 고정한다: 시계열 대상 키(평가 H1), 지난주 대비(M7), 입력 한도(M8), 승인 관문(⑦).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({URL,TextEncoder}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:false}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const link=async m=>{if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status==='linked')await m.evaluate();return m.namespace};
const U=await link(moduleFor('lib/product-research/ui-detail.ts'));
const S=await link(moduleFor('lib/product-research/analytics/series.ts'));
const A=await link(moduleFor('lib/product-research/api.ts'));
const R=await link(moduleFor('lib/product-research/analytics/score.ts'));
let passed=0;
function check(name,actual,expected){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++}

// 1) 시계열 대상 키는 서버 subjectKey()와 같은 모양이다(상품 ID·묶음 ID와 비교하지 않는다).
const product={id:'prp_1',listings:[{sourceId:'coupang_ranking_manual',externalId:'e2e-1',title:'가상 약과 300g',url:null}],keywordGroupIds:['kg_1']};
const groups=[{id:'kg_1',label:'마라 소스',keywords:['마라소스','마라 쏘스 1kg'],categoryId:null,createdAt:'',updatedAt:''},{id:'kg_2',label:'다른 묶음',keywords:['불닭소스'],categoryId:null,createdAt:'',updatedAt:''}];
const subjects=U.productSubjects(product,groups);
check('listing key matches analytics subjectKey',subjects.has(S.subjectKey({type:'listing',sourceId:'coupang_ranking_manual',externalId:'e2e-1',title:'',brand:null,price:null,url:null,categoryPath:null})),true);
check('keyword key matches analytics subjectKey (normalized)',subjects.has(S.subjectKey({type:'keyword',text:'마라 쏘스 1kg'})),true);
check('keys of unrelated groups are left out',subjects.has(S.subjectKey({type:'keyword',text:'불닭소스'})),false);
check('product and group ids are never subject keys',[...subjects.keys()].some(k=>k==='prp_1'||k==='kg_1'),false);
const series=[
 {subjectKey:'ls:coupang_ranking_manual:e2e-1',metric:'rank',sourceId:'coupang_ranking_manual',points:[{at:'2026-10-03',value:3,snapshotId:'a'}]},
 {subjectKey:'ls:musinsa_ranking_manual:e2e-1',metric:'rank',sourceId:'musinsa_ranking_manual',points:[{at:'2026-10-02',value:5,snapshotId:'b'}]},
 {subjectKey:'kw:마라소스',metric:'search_trend',sourceId:'naver_datalab_search',points:[{at:'2026-09-28',value:40,snapshotId:'c'},{at:'2026-10-03',value:null,snapshotId:'d'}],limitations:['상대값']},
 {subjectKey:'ls:other:x',metric:'rank',sourceId:'coupang_ranking_manual',points:[{at:'2026-10-01',value:1,snapshotId:'a'}]},
];
const mine=U.productSeries(series,subjects);
check('only this product series are drawn',mine.map(x=>x.subjectKey),['ls:coupang_ranking_manual:e2e-1','kw:마라소스']);
check('shared axis is the union of days',U.seriesAxis(mine),['2026-09-28','2026-10-03']);
check('shared axis keeps the last 12 days only',U.seriesAxis([{points:Array.from({length:20},(_,i)=>({at:`2026-09-${String(i+1).padStart(2,'0')}`}))}]).length,12);
check('a day without observation is null (unknown), not zero',U.pointOn(mine[0],'2026-09-28'),null);
check('an observed null value stays null',U.pointOn(mine[1],'2026-10-03').value,null);
check('snapshot rows are the series points of that snapshot for this product only',U.snapshotRows(series,subjects,'a').map(r=>[r.subject,r.metric,r.value]),[['가상 약과 300g','rank',3]]);

// 2) 지난주 대비: previousScore와 지금 판의 총점·모멘텀 차이. 모르면 null.
const card=(total,momentum)=>({total,subScores:[{key:'momentum',value:momentum}]});
check('week delta of total and momentum',U.weekDelta({score:card(70,64),previousScore:{total:61.5,momentum:70,computedAt:'2026-09-26'}}),{total:8.5,momentum:-6,since:'2026-09-26'});
check('no previous score means no delta',U.weekDelta({score:card(70,64),previousScore:null}),null);
check('unknown previous total stays unknown',U.weekDelta({score:card(70,64),previousScore:{total:null,momentum:60,computedAt:'x'}}).total,null);
const list=[{id:'a',score:card(70,60),previousScore:{total:60,momentum:60,computedAt:'x'}},{id:'b',score:card(50,40),previousScore:{total:58,momentum:50,computedAt:'x'}},{id:'c',score:card(40,40),previousScore:null},{id:'d',score:card(null,55),previousScore:{total:null,momentum:50,computedAt:'x'}}];
const m=U.movers(list);
check('risers sorted by change, momentum used when total unknown',m.risers.map(x=>x.id),['a','d']);
check('fallers',m.fallers.map(x=>x.id),['b']);
check('compared count excludes products without a previous score',m.compared,3);
check('signed text',[U.signed(3),U.signed(-2.5),U.signed(0),U.signed(null)],['+3','−2.5','0','미확인']);

// 3) 입력 한도는 api.ts 상수와 같다(서버가 400을 내기 전에 버튼을 막는다).
check('decision reason below REASON_MIN is blocked',U.decisionReasonWhy('a'.repeat(A.REASON_MIN-1))!=='',true);
check('decision reason at REASON_MIN passes',U.decisionReasonWhy('a'.repeat(A.REASON_MIN)),'');
check('decision reason over REASON_MAX is blocked',U.decisionReasonWhy('a'.repeat(A.REASON_MAX+1))!=='',true);
check('trimmed length is counted like the server',U.decisionReasonWhy('  abcd  ')!=='',true);
check('question optional up to QUESTION_MAX',[U.questionWhy('',false),U.questionWhy('a'.repeat(A.QUESTION_MAX),false),U.questionWhy('a'.repeat(A.QUESTION_MAX+1),false)!==''],['',''
 ,true]);
check('question required for briefs',U.questionWhy(' ',true)!=='',true);
check('price cap: empty is no limit',U.priceMaxWhy(''),'');
check('price cap: below 100 or non-integer is blocked',[U.priceMaxWhy('99')!=='',U.priceMaxWhy('1000.5')!=='',U.priceMaxWhy(String(A.PRICE_MAX_MAX+1))!==''],[true,true,true]);
check('price cap: 20,000 passes',U.priceMaxWhy('20,000'),'');
check('brand fit value range',[U.brandFitValueWhy('0'),U.brandFitValueWhy('100'),U.brandFitValueWhy('101')!=='',U.brandFitValueWhy('')!==''],['','',true,true]);
check('brand fit reason max',U.brandFitReasonWhy('a'.repeat(A.BRAND_FIT_REASON_MAX+1))!=='',true);
check('clear reason bounds',[U.clearReasonWhy('abcd')!=='',U.clearReasonWhy('abcde'),U.clearReasonWhy('a'.repeat(A.CLEAR_REASON_MAX+1))!==''],[true,'',true]);
check('import scope bounds',[U.scopeWhy('')!=='',U.scopeWhy('a'.repeat(A.IMPORT_SCOPE_MAX)),U.scopeWhy('a'.repeat(A.IMPORT_SCOPE_MAX+1))!==''],[true,'',true]);
check('observed date window',[U.observedWhy('2026-10-03','2026-10-03'),U.observedWhy('2026-10-04','2026-10-03')!=='',U.observedWhy(U.oldestImportDay('2026-10-03'),'2026-10-03'),U.observedWhy('2026-09-18','2026-10-03')!==''],['',true,'',true]);
check('oldest import day is IMPORT_MAX_AGE_DAYS back',U.oldestImportDay('2026-10-03'),'2026-09-19');
check('risk note max',U.riskNoteWhy('a'.repeat(A.RISK_NOTE_MAX+1))!=='',true);
check('backtest threshold',[U.thresholdWhy('0')!=='',U.thresholdWhy('20'),U.thresholdWhy('501')!==''],[true,'',true]);

// 4) 승인 관문: 서버 reviewApprovalError와 같은 판정(위험을 말하는 낱말이 사유에 있어야 통과).
const review={needsReview:true,blocked:null,review:{rules:['diet_claim'],reasons:['다이어트 효능 과장'],terms:['다이어트','감량','표현','광고']}};
check('blocked card cannot be approved',U.approvalWhy({...review,blocked:{reason:'가품 신호',rule:'counterfeit'}},'x',true,null).startsWith('선정 금지'),true);
check('needs review without ack is blocked',U.approvalWhy(review,'다이어트 표현을 뺐습니다.',false,null)!=='',true);
check('ack without a risk term is blocked',U.approvalWhy(review,'좋아 보여서 승인합니다.',true,null)!=='',true);
check('ack with a risk term passes',U.approvalWhy(review,'다이어트 효능 표현을 빼기로 했습니다.',true,null),'');
for(const [reason,ack] of [['좋아 보여서 승인합니다.',true],['다이어트 효능 표현을 빼기로 했습니다.',true],['다이어트 표현 확인',false]])
 check(`client gate agrees with server gate: ${reason}/${ack}`,U.approvalWhy(review,reason,ack,null)==='',R.reviewApprovalError(review,reason,ack)===null);
const tm={needsReview:true,blocked:null,review:{rules:['trademark_use'],reasons:['타사 상표'],terms:['상표','브랜드','권리자','라이선스','가상상표']}};
check('trademark rule accepts the brand name itself',[U.approvalWhy(tm,'가상상표 사용 허락을 받았습니다.',true,null),R.reviewApprovalError(tm,'가상상표 사용 허락을 받았습니다.',true)],['',null]);
check('saved review with open items blocks',U.approvalWhy(review,'아무 말',false,{checklist:[{rule:'a',checked:true},{rule:'b',checked:false}]})!=='',true);
check('saved review with all items checked passes without ack',U.approvalWhy(review,'아무 말',false,{checklist:[{rule:'a',checked:true}]}),'');
check('normal card has no gate',U.approvalWhy({needsReview:false,blocked:null,review:null},'',false,null),'');
const items=U.riskChecklist({review:review.review},['식품 표시사항 확인','다이어트 효능 과장','x'.repeat(A.RISK_RULE_MAX+20)]);
check('checklist = review reasons + base items, unique, each within RISK_RULE_MAX',[items.length,items[0],items.every(x=>x.length<=A.RISK_RULE_MAX)],[3,'다이어트 효능 과장',true]);
// 스냅샷 요청 범위: 사람이 읽는 항목만, 내부 호출 설정은 숨김
check('request scope lists readable items and hides internal call settings',U.requestScope({operation:'search',keyword:'마라소스',publishedAfter:'2026-09-01',maxResults:50,regionCode:'KR'}),['검색어 마라소스','게시 이후 2026-09-01']);
check('datalab groups and unit read as names and 주',U.requestScope({startDate:'2026-01-05',endDate:'2026-09-28',timeUnit:'week',keywordGroups:'마라:마라소스|마라탕소스;떡볶이:떡볶이소스'}),['키워드 묶음 마라, 떡볶이','시작일 2026-01-05','종료일 2026-09-28','단위 주']);
check('import scope keeps file, scope, date and rows; long values are cut',[U.requestScope({fileName:'c.csv',scope:'식품 소스',observedDate:'2026-10-01',format:'csv',rows:3}).join('|'),U.requestScope({keyword:'가'.repeat(100)})[0].length,U.requestScope(null).length],['범위 식품 소스|기준일 2026-10-01|파일 c.csv|행 수 3',4+80+1,0]);
// 평가 2회차 화면 보조: 서버 필수 리스크 항목 id, 출시 뒤 결과 한 줄, 보정 요약
const req=[{id:'diet_claim',text:'다이어트 효능 과장'}];
check('risk items put server-required items first and carry their ruleId',U.riskItemsWithIds({review:review.review},req,['식품 표시사항 확인']).filter(x=>x.ruleId).map(x=>[x.rule,x.ruleId]),[['다이어트 효능 과장','diet_claim']]);
check('launch outcome: not handed off / waiting / no SKU reason',[U.launchOutcomeText(null,false),U.launchOutcomeText(undefined,true).startsWith('캠페인 시장 근거로 넘김'),U.launchOutcomeText({decisionId:'d',productId:'p',campaignId:'c',handedOffAt:'2026-09-01T00:00:00Z',sku:null,reason:'연결된 SKU 없음',windows:[]},true)],['넘기지 않아 판매 결과 없음',true,'판매 결과 미확인: 연결된 SKU 없음']);
const win=(weeks,complete,orders,units,revenue)=>({weeks,complete,orders,units,revenue});
check('launch outcome uses the longest complete window, keeps null as 미확인 (never 0)',[U.launchOutcomeText({decisionId:'d',productId:'p',campaignId:'c',handedOffAt:'x',sku:'S1',reason:null,windows:[win(4,true,12,30,450000),win(8,true,20,null,800000),win(12,false,25,60,900000)]},true),U.launchOutcomeText({decisionId:'d',productId:'p',campaignId:'c',handedOffAt:'x',sku:'S1',reason:null,windows:[win(4,false,3,5,null),win(8,false,null,null,null)]},true)],['8주 주문 20건, 수량 미확인, 매출 800,000원','4주(진행 중) 주문 3건, 5개, 매출 미확인']);
check('calibration summary: none / mape / missing mape',[U.calibrationText(null).startsWith('아직 보정 보고가 없습니다'),U.calibrationText({at:'x',groups:3,mape:0.042,rows:[]}),U.calibrationText({at:'x',groups:1,mape:null,rows:[]})],[true,'키워드 묶음 3개, 평균 오차율 4.2%.','키워드 묶음 1개, 평균 오차율 미확인.']);
// 평가 3회차: 보정 보고 행(오차·까닭), 넘기기 카탈로그 상품 고르기, 가중치 재보정 후보 표
check('calibration rows: uncalibrated count, error text, reason note',[U.calibrationText({at:'x',groups:2,uncalibrated:1,mape:0.1,rows:[]}),U.calibrationErrorText({groupId:'g',label:'l',error:0.125}),U.calibrationErrorText({groupId:'g',label:'l',error:null,reason:'r'}),U.calibrationNote({groupId:'g',label:'l',error:null,reason:'잴 수 없어'}),U.calibrationNote({groupId:'g',label:'l',error:null}),U.calibrationNote({groupId:'g',label:'l',error:0.1})],['키워드 묶음 2개, 평균 오차율 10.0%. 보정하지 않은 묶음 1개(까닭은 아래 표).','12.5%','미확인','잴 수 없어','오차를 잴 기준점이 모자랍니다.','']);
const cat=(id,title,sku)=>({id,version:1,title,sku});
const cats={c1:[cat('k1','약과','SKU1')],c2:[cat('k1','약과','SKU1'),cat('k2','','SKU2')],c3:[]};
const pick=id=>{const x=U.catalogChoice(cats,id);return [x.items.length,!!x.why,x.auto]};
check('catalog choice: no campaign / none (reason) / one (auto) / many (pick)',[pick(''),pick('c3'),pick('c1'),pick('c2'),pick('unknown'),U.catalogLabel(cat('a','약과','S')),U.catalogLabel(cat('a','','S')),U.catalogLabel(cat('a','','')),/카탈로그 상품이 없어/.test(U.catalogChoice(cats,'c3').why)],[[0,true,null],[0,true,null],[1,false,'k1'],[2,false,null],[0,true,null],'약과 (S)','S','이름 없는 상품',true]);
const base={demand:0.12,momentum:0.25,durability:0.18,competition:0.1,profitability:0.1,feasibility:0.08,content:0.07,brand_fit:0.05,risk:0.05};
const wp={at:'x',weeks:8,n:9,minN:8,baseVersion:'w1',base,proposed:{...base,momentum:0.3,durability:0.13},correlations:[{key:'momentum',rho:0.5,n:9},{key:'risk',rho:null,n:3}],reason:null,caveats:[]};
const rowsW=U.weightRows(wp);
check('weights proposal rows: all 9 sub-scores in order, base/proposed/rho, null as 미확인',[rowsW.length,rowsW[1].key,rowsW[1].proposed,rowsW[1].rho,rowsW[8].rho,U.weightRows(null).length,U.weightText(null),U.weightText(0.25),U.signedRho(0.5),U.signedRho(-0.25),U.signedRho(null),U.weightRows({...wp,proposed:null})[0].proposed],[9,'momentum',0.3,0.5,null,0,'미확인','0.250','+0.50','−0.25','미확인',null]);
console.log(JSON.stringify({passed}));
