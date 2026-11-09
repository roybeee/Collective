// 소재 예측 점수 순수 모듈 회귀(G2, docs/CREATIVE-SCORE.ko.md): 훅 강·약, 규제 차단 상한 20, 학습 규칙 충족/위반, 최근 게시물 유사도 감점, 채널 한도, AI 표시, 결정론,
// 사후 보정표(표본 부족·방향성·관측 기반, 단조 표가 등급을 바꾸고 비단조·방향성은 표본만 표시). 근거: mocked(합성 문안, 모델·네트워크·DB 없음).
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const cs=await rt.load('lib/creative-score.ts'),cal=await rt.load('lib/creative-calibration.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const part=(s,key)=>s.components.find(c=>c.key===key);

// ── 1) 가중치·라벨 ──
const weights=plain(cs.COMPONENT_WEIGHTS);
check('component weights sum to 100',Object.values(weights).reduce((a,b)=>a+b,0)===100);
check('every component has a Korean label',Object.keys(weights).every(k=>/[가-힣]/.test(cs.COMPONENT_LABELS[k])));
check('the label says estimate, rule based, no guarantee',cs.CREATIVE_SCORE_LABEL==='추정 · 규칙 기반 · 성과 보장 아님');

// ── 2) 훅 강·약 ──
const STRONG='비싼 간식 대신 평일 오후 3시 떡볶이 4,500원, 충분할까요?\n가상동 12 매장에서 포장 주문하세요.\n#가상분식 #평일간식 #포장 #동네맛집';
const WEAK='저희 가상분식은 오랜 시간 동안 정성을 다해 손님 한 분 한 분께 맛있는 분식을 제공해 드리고자 늘 노력하고 있으며 앞으로도 계속 그렇게 하겠습니다 많이 찾아주세요. 주문도 해주세요. 방문도 해주세요. 할인 증정 무료 쿠폰';
const strong=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'manual'})),weak=plain(cs.scoreCreative({text:WEAK,channel:'Instagram',origin:'manual'}));
check('a short question hook with a number beats a long declarative one',part(strong,'hook').points>part(weak,'hook').points&&part(strong,'hook').points===20);
check('hook evidence names the patterns',part(strong,'hook').evidence.join(' ').includes('질문형')&&part(strong,'hook').evidence.join(' ').includes('숫자 포함'));
check('one CTA and a single offer score clarity 15, competing CTAs and offers do not',part(strong,'clarity').points===15&&part(weak,'clarity').points<10);
check('price, time and place mentions raise specificity',part(strong,'specificity').points>=12&&part(weak,'specificity').points===0);
check('the strong draft scores higher overall and lands in a higher band',strong.score>weak.score&&strong.band==='높음'&&weak.band!=='높음');
check('every component stays within 0..max',[...strong.components,...weak.components].every(c=>c.points>=0&&c.points<=c.max));

// ── 3) 결정론 ──
const again=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'manual'}));
check('the same input yields the identical result',JSON.stringify(again)===JSON.stringify(strong));

// ── 4) 규제 차단 상한 / 경고 감점 ──
const blocked=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'manual',compliance:{issues:[{ruleId:'health_cure',severity:'block',title:'질병 치료 표현'}]}}));
check('a compliance block caps the total at 20 and flags it',blocked.score<=20&&part(blocked,'compliance').points===0&&blocked.flags.some(f=>/차단 1건/.test(f)&&/20점 상한/.test(f))&&blocked.band==='낮음');
const warned=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'manual',compliance:{issues:[{ruleId:'a',severity:'warn',title:'경고1'},{ruleId:'b',severity:'warn',title:'경고2'}]}}));
const clean=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'manual',compliance:{issues:[]}}));
check('each warning costs 3 compliance points',part(clean,'compliance').points===10&&part(warned,'compliance').points===4&&warned.score===clean.score-6);
check('no compliance input is neutral (5 of 10)',part(strong,'compliance').points===5);

// ── 5) 학습 규칙 충족/위반 ──
const rules=[{id:'r-test',guidance:'첫 장면에 ‘단면’을 보여 주면 공유가 늘었다(관찰).',direction:'test'},{id:'r-caution',guidance:'‘1위’ 표현은 반응이 나빴다.',direction:'caution'},{id:'r-none',guidance:'표현을 특정하지 않은 지침',direction:'test'}];
const satisfied=plain(cs.scoreCreative({text:'소스 가득한 단면을 먼저 보여 드립니다. 포장 주문하세요.',channel:'Instagram',rules}));
const violated=plain(cs.scoreCreative({text:'동네 1위 분식! 포장 주문하세요.',channel:'Instagram',rules}));
check('a satisfied test rule and an absent caution term add points with rule ids as evidence',part(satisfied,'learning_rules').points===10&&part(satisfied,'learning_rules').evidence.some(e=>e.startsWith('r-test 충족'))&&part(satisfied,'learning_rules').evidence.some(e=>e.startsWith('r-caution 충족')));
check('a violated caution rule and a missing test term subtract points and flag the rule',part(violated,'learning_rules').points===0&&part(violated,'learning_rules').evidence.some(e=>e.startsWith('r-caution 위반'))&&violated.flags.some(f=>f.includes('r-caution')));
check('a rule without quoted terms is reported as not checkable and does not move the score',part(satisfied,'learning_rules').evidence.some(e=>e.startsWith('r-none')&&e.includes('확인 불가')));
check('explicit terms are honoured',plain(cs.ruleTerms({id:'x',guidance:'없음',terms:['포장']})).join()==='포장');

// ── 6) 최근 게시물 유사도 ──
const recent=[{id:'p1',text:STRONG},{id:'p2',text:'전혀 다른 글. 봄 신메뉴 출시 안내.'}];
const dup=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',recent})),fresh=plain(cs.scoreCreative({text:'퇴근길 10분, 가상동 12 매장에서 떡볶이 포장을 받아 가세요. #가상분식 #퇴근길 #포장',channel:'Instagram',recent}));
check('an identical recent post zeroes novelty and flags it',part(dup,'novelty').points===0&&dup.flags.some(f=>f.includes('매우 유사'))&&part(dup,'novelty').evidence[0].includes('p1'));
check('a different draft keeps novelty points',part(fresh,'novelty').points>part(dup,'novelty').points);
check('no recent posts is neutral',part(strong,'novelty').points===4&&part(strong,'novelty').evidence[0].includes('중립'));
check('jaccard of disjoint sets is 0 and of identical sets is 1',cs.jaccard(new Set(['a','b']),new Set(['c']))===0&&cs.jaccard(new Set(['a','b']),new Set(['a','b']))===1);

// ── 7) 채널 한도 ──
const longText='가'.repeat(2300)+' #a #b #c';
const igLong=plain(cs.scoreCreative({text:longText,channel:'Instagram'})),blogLong=plain(cs.scoreCreative({text:longText,channel:'블로그'}));
check('2,300 characters exceed the Instagram limit but not the blog limit',part(igLong,'channel_fit').evidence[0].includes('초과')&&part(blogLong,'channel_fit').evidence[0].includes('안'));
const noTags=plain(cs.scoreCreative({text:'해시태그 없는 글. 주문하세요.',channel:'Instagram'})),withLink=plain(cs.scoreCreative({text:'자세히 https://example.test/menu 에서 확인하세요. #a #b #c',channel:'Instagram'}));
check('Instagram without hashtags loses the hashtag points',part(noTags,'channel_fit').evidence.some(e=>e.includes('해시태그 0개')&&e.includes('밖')));
check('a body link on Instagram is called out instead of credited',part(withLink,'channel_fit').evidence.some(e=>e.includes('눌리지 않습니다'))&&part(withLink,'channel_fit').points===7);
check('primaryChannel reads the first registry alias in the campaign channel text',cs.primaryChannel('인스타그램, 매장 안내')==='Instagram'&&cs.primaryChannel('당근마켓')==='당근'&&cs.primaryChannel('')==='기타'&&cs.primaryChannel('사내 게시판')==='사내 게시판');

// ── 8) AI 표시 ──
const aiNo=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'ai'})),aiYes=plain(cs.scoreCreative({text:STRONG+'\n이 게시물의 문구는 AI의 도움을 받아 작성하고 담당자가 확인했습니다.',channel:'Instagram',origin:'ai'})),aiImg=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'ai_edited',image:{hasImage:true,aiDisclosure:true}}));
check('an AI draft without disclosure gets 0 and a flag',part(aiNo,'ai_disclosure').points===0&&aiNo.flags.includes('AI 생성 표시 없음'));
check('disclosure in the text or on the image earns the points',part(aiYes,'ai_disclosure').points===5&&part(aiImg,'ai_disclosure').points===5&&part(aiImg,'ai_disclosure').evidence[0]==='이미지에 AI 표시');
check('human-written drafts need no disclosure',part(strong,'ai_disclosure').points===5);

// ── 9) 브랜드 말투·사실 ──
const voice={preferTerms:['소스 가득'],avoidTerms:['최고']},facts={confirmed:[{key:'가격',value:'4,500원'}],prohibited:[{key:'판매 순위',value:'동네 1위'}]};
const fit=plain(cs.scoreCreative({text:'소스 가득한 떡볶이 4,500원. 포장 주문하세요.',channel:'Instagram',voice,facts})),unfit=plain(cs.scoreCreative({text:'동네 1위 최고 떡볶이! 포장 주문하세요.',channel:'Instagram',voice,facts}));
check('preferred terms, no avoided terms and no rejected facts score full brand fit',part(fit,'brand_fit').points===10&&part(fit,'specificity').evidence.some(e=>e.includes('확정 사실 인용: 가격')));
check('avoided terms and rejected facts zero brand fit and flag both',part(unfit,'brand_fit').points===0&&unfit.flags.some(f=>f.includes('피할 표현'))&&unfit.flags.some(f=>f.includes('거절된 사실')));
check('leftover check markers cost specificity points',part(plain(cs.scoreCreative({text:'가격 [확인 필요] 떡볶이. 주문하세요.',channel:'Instagram'})),'specificity').evidence.some(e=>e.includes('확인 필요')));

// ── 10) 사후 보정표 ──
const NOW='2026-11-09T00:00:00.000Z',old=(d=10)=>new Date(Date.parse(NOW)-d*86400000).toISOString();
const obs=(i,score,ctr,over={})=>({artifactId:'a'+i,score,band:score>=70?'높음':score>=40?'보통':'낮음',components:[{key:'hook',points:Math.round(score/5),max:20},{key:'clarity',points:15-Math.round(score/10),max:15}],publishedAt:old(),impressions:1000,clicks:Math.round(1000*ctr),...over});
const few=plain(cal.buildCalibration({brandId:'b',channel:'Instagram',observations:[obs(1,50,0.02),obs(2,60,0.03)],now:NOW}));
check('fewer than 10 eligible observations produce no table',few.status==='insufficient'&&few.bins.length===0&&few.n===2&&/표본 부족/.test(few.label));
const synth=n=>Array.from({length:n},(_,i)=>obs(i,Math.round(10+i*(80/Math.max(1,n-1))),0.01+i*0.001));
const directional=plain(cal.buildCalibration({brandId:'b',channel:'Instagram',observations:synth(12),now:NOW}));
check('10..29 observations give a directional table with the small-sample label',directional.status==='directional'&&directional.label==='방향성(표본 부족)'&&directional.bins.length===3&&directional.n===12);
const usable=plain(cal.buildCalibration({brandId:'b',channel:'Instagram',observations:[...synth(36),obs(99,50,0.02,{publishedAt:old(2)}),obs(98,50,0.02,{impressions:10,clicks:1}),obs(97,50,0.02,{impressions:5,clicks:9})],now:NOW}));
check('30+ observations give a usable, monotonic table with a window and component signs',usable.status==='usable'&&usable.monotonic===true&&usable.n===36&&usable.window.from<=usable.window.to&&usable.components.find(c=>c.key==='hook').sign==='+'&&usable.components.find(c=>c.key==='clarity').sign==='-');
check('recent, low-impression and invalid observations are excluded and counted',usable.excluded.tooRecent===1&&usable.excluded.tooFewImpressions===1&&usable.excluded.invalid===1);
check('bins are ordered by score and carry a median CTR',usable.bins.every((b,i)=>i===0||b.from>=usable.bins[i-1].to)&&usable.bins.every(b=>b.medianCtr>=0&&b.medianCtr<=1&&b.n>0));
check('agreement is a share in 0..1 and limits deny causal claims',usable.agreement>=0&&usable.agreement<=1&&usable.limits.some(l=>l.includes('귀속 ≠ 증분')));
check('the table is deterministic',JSON.stringify(plain(cal.buildCalibration({brandId:'b',channel:'Instagram',observations:synth(36),now:NOW})))===JSON.stringify(plain(cal.buildCalibration({brandId:'b',channel:'Instagram',observations:synth(36),now:NOW}))));
// 점수 계산이 표를 읽는 방식
const withUsable=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'manual',calibration:usable}));
check('a usable monotonic table sets the band from the observed rank and shows n and window',withUsable.sample.n===36&&/\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}/.test(withUsable.sample.window)&&withUsable.flags.some(f=>f.startsWith('보정표 적용 · n=36'))&&['낮음','보통','높음'].includes(withUsable.band));
const withDirectional=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'manual',calibration:directional}));
check('a directional table keeps the rule band and only adds the sample note',withDirectional.band===strong.band&&withDirectional.sample.n===12&&withDirectional.flags.some(f=>f.includes('방향성(표본 부족)')&&f.includes('n=12')));
const nonMono={...usable,bins:[{from:0,to:30,n:12,medianCtr:0.05},{from:31,to:60,n:12,medianCtr:0.01},{from:61,to:100,n:12,medianCtr:0.03}],monotonic:false};
const withNonMono=plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'manual',calibration:nonMono}));
check('a non-monotonic table does not change the band',withNonMono.band===strong.band&&withNonMono.flags.some(f=>f.includes('비단조')));
check('an insufficient table changes nothing',JSON.stringify(plain(cs.scoreCreative({text:STRONG,channel:'Instagram',origin:'manual',calibration:few})))===JSON.stringify(strong));
check('calibratedBand maps the bottom bin to 낮음 and the top bin to 높음',cal.calibratedBand(usable.bins[0].from,usable).band==='낮음'&&cal.calibratedBand(100,usable).band==='높음');

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
