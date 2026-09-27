// 트랙 R R15b 결정론 모집 카드 묶음 순수 모듈(lib/franchise-cards.ts) 회귀. 사례 번호 CD-*는 R15b PR 본문 수용 기준과 같다.
// 확인: 카드 나누기(CD-P), 구조 한도(CD-S), 원장에 없는 수치(CD-N, 계획 거부 기준 '400'), 유입 코드 QR 링크(CD-Q, 계획 거부 기준 '400'), 템플릿(CD-T), 그릴 자리(CD-L), 사유 코드·던지지 않음(CD-C), 구문 경계(CD-X).
// 근거: mocked(순수 함수, 합성 사실·코드, 외부 호출 0회). 법률 적합성은 not_run(LR-1 대상, 결정 20 보류). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const fc=await rt.load('lib/franchise-cards.ts'),ff=await rt.load('lib/franchise-facts.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);

// ── 합성 픽스처 ──
const V=[{id:'dvA',brandId:'b1',label:'2026-1',registeredAt:'2026-03-02T09:00:00+09:00',validFrom:'2026-03-02T00:00:00+09:00',validUntil:'2027-04-30T00:00:00+09:00',status:'active'}];
const base={brandId:'b1',status:'confirmed',source:'정보공개서',verifiedAt:'2026-09-20T00:00:00.000Z',validUntil:'2027-04-01T00:00:00.000Z',version:1,updatedAt:'2026-09-20T00:00:00.000Z'};
const SRC=(page,x={})=>({disclosureVersionId:'dvA',fiscalYear:2025,page,...x});
const F={
 total:{...base,id:'f-total',key:'startup_cost_total',value:'4,500만원',sourceRef:SRC(12),cost:{storeType:'소형 매장',includes:['가맹비','교육비','인테리어'],excludes:['임차보증금','권리금'],areaM2:33}},
 count:{...base,id:'f-count',key:'franchise_store_count',value:'12개',sourceRef:SRC(3,{asOf:'2025-12-31'})},
 menu:{...base,id:'f-menu',key:'signature_menu',value:'우유 도넛'},
};
const FACTS=[F.total,F.count,F.menu];
const FOOT='※ 정보공개서 등록 버전 2026-1(등록일 2026-03-02) · 기준 사업연도 2025년 · 확인일 2026-09-20';
const WAIT=['정보공개서를 받은 날부터 14일(변호사·가맹거래사에게 정보공개서 자문을 받았다면 7일)이 지나기 전에는 가맹계약을 체결하거나 가맹금을 받지 않습니다.'];
const TODAY='2026-10-10';
const CODES=[{code:'R2345678',brandId:'b1',retiredOn:null},{code:'RABCDEFG',brandId:'b2',retiredOn:null},{code:'RZXCVBNM',brandId:'b1',retiredOn:'2026-10-10'},{code:'RQWERTYU',brandId:'b1',retiredOn:'2026-10-11'},{code:'RASDFGHJ',brandId:'b1',retiredOn:'2026-10-01'}];
const URL_OK='https://ofd.example.kr/franchise?utm_campaign=card&utm_content=R2345678';
const ctx=(x={})=>({brandId:'b1',today:TODAY,facts:FACTS,versions:V,codes:CODES,allowedLines:WAIT,...x});
const bundle=(cards)=>cards.map((c,i)=>[`■ ${i+1}장${c.label?' '+c.label:''}`,...c.lines].join('\n')).join('\n\n');
const GOOD=[
 {label:'[의견]',lines:['매장에서 매일 굽는 우유 도넛 브랜드입니다.']},
 {label:'[사실]',lines:[ff.factLine(F.total).split('\n')[0],ff.factLine(F.total).split('\n')[1],FOOT]},
 {label:'[COLLECTIVE 휴리스틱 · 법률 자문 아님]',lines:[WAIT[0]]},
 {lines:['가맹 문의','QR '+URL_OK]},
];
const check1=(cards,x)=>plain(fc.checkCardBundle(bundle(cards),ctx(x)));
const codesOf=(cards,x)=>check1(cards,x).codes;

// ════ CD-P 카드 나누기 ════
const p=plain(fc.parseCards(bundle(GOOD)));
check('CD-P1 four cards with index, label, lines and the QR link',p.ok&&p.cards.length===4&&p.cards.map(c=>c.index).join()==='1,2,3,4'&&p.cards[0].label==='[의견]'&&p.cards[3].label===null&&p.cards[3].qr===URL_OK&&same(p.cards[3].lines,['가맹 문의']));
check('CD-P2 blank lines around card text are dropped and leading blank lines are allowed',same(fc.parseCards('\n\n■ 1장\n\n글\n\n').cards[0].lines,['글'])&&fc.parseCards('\n\n■ 1장\n글').ok);
check('CD-P3 text before the first heading, an unknown ■ line and two QR lines are structure errors',!fc.parseCards('머리말\n■ 1장\n글').ok&&!fc.parseCards('■ 1장\n글\n■수익 3천\n').ok&&!fc.parseCards('■ 1장\n글\nQR https://a.kr/R2345678\n■ 2장\n글\nQR https://b.kr/R2345678').ok);
check('CD-P4 non-string bodies parse to no cards',[null,undefined,42,{}].every(b=>!fc.parseCards(b).ok&&fc.parseCards(b).cards.length===0));

// ════ CD-S 구조 ════
check('CD-S1 the good bundle has no codes and no warnings',same(codesOf(GOOD),[])&&same(check1(GOOD).warnings,[])&&check1(GOOD).qr.code==='R2345678');
const txt=n=>({lines:['브랜드 이야기 '+'가'.repeat(n)]});
check('CD-S2 two cards and six cards are structure errors, three and five are fine',same(codesOf([txt(1),txt(1)]),['card_structure'])&&same(codesOf([txt(1),txt(1),txt(1),txt(1),txt(1),txt(1)]),['card_structure'])&&same(codesOf([txt(1),txt(1),txt(1)]),[])&&same(codesOf([txt(1),txt(1),txt(1),txt(1),txt(1)]),[]));
check('CD-S3 numbering must run 1..N',same(plain(fc.checkCardBundle('■ 1장\n가\n■ 3장\n나\n■ 4장\n다',ctx())).codes,['card_structure'])&&same(plain(fc.checkCardBundle('■ 2장\n가\n■ 3장\n나\n■ 4장\n다',ctx())).codes,['card_structure']));
check('CD-S4 an empty card is a structure error',same(plain(fc.checkCardBundle('■ 1장\n가\n■ 2장\n\n■ 3장\n다',ctx())).codes,['card_structure']));
const lim=fc.CARD_LIMITS;
check('CD-S5 card text over the character limit fails and at the limit passes',same(codesOf([txt(lim.cardChars-'브랜드 이야기 '.length+1),txt(1),txt(1)]),['card_structure'])&&same(codesOf([txt(lim.cardChars-'브랜드 이야기 '.length),txt(1),txt(1)]),[]));
check('CD-S6 card text over the line limit fails',same(codesOf([{lines:Array.from({length:lim.cardLines+1},()=>'가')},txt(1),txt(1)]),['card_structure'])&&same(codesOf([{lines:Array.from({length:lim.cardLines},()=>'가')},txt(1),txt(1)]),[]));
check('CD-S7 the QR card has a tighter limit',same(codesOf([txt(1),txt(1),{lines:['가'.repeat(lim.qrCardChars+1),'QR '+URL_OK]}]),['card_structure'])&&same(codesOf([txt(1),txt(1),{lines:['가'.repeat(lim.qrCardChars),'QR '+URL_OK]}]),[]));
check('CD-S8 no QR line is allowed with a warning',same(codesOf([txt(1),txt(1),txt(1)]),[])&&same(check1([txt(1),txt(1),txt(1)]).warnings,[fc.CARD_WARNINGS.noQr]));

// ════ CD-N 원장에 없는 수치 ════
const num=(line,x)=>check1([{lines:[line]},txt(1),txt(1)],x);
check('CD-N1 a number that is not in any referenced fact is rejected with the token',same(num('가맹점 120개 돌파').codes,['card_number_unbacked'])&&same(num('가맹점 120개 돌파').unbacked,['120']));
check('CD-N2 numbers from referenced fact values pass, commas ignored',same(num('가맹점 12개').codes,[])&&same(num('창업비용 4500만원부터').codes,[])&&same(num('창업비용 4,500만원').codes,[]));
check('CD-N3 a fact value used without selecting the fact is rejected',same(num('가맹점 12개',{facts:[F.total]}).codes,['card_number_unbacked']));
check('CD-N4 exact fact lines and footnote lines pass even with page, year and area numbers',same(check1([{lines:ff.factLine(F.count).split('\n')},{lines:[FOOT]},txt(1)]).codes,[]));
check('CD-N5 the caller-allowed recommended sentence passes only when unchanged',same(num(WAIT[0]).codes,[])&&same(num(WAIT[0].replace('14일','3일')).codes,['card_number_unbacked'])&&same(num('정보공개서를 받고 14일 뒤 계약').unbacked,['14']));
check('CD-N6 dates, times and representative phone numbers are not claims',same(num('10월 15일 오후 2시 30분 설명회 · 2026년 · 14:00 · 2026-10-15 · 문의 1588-1234 · 02-123-4567').codes,[]));
check('CD-N7 durations and fractions are still numbers',same(num('30분 만에 조리').unbacked,['30'])&&same(num('3/4 가격').unbacked,['3','4']));
check('CD-N8 full-width digits are normalized',same(num('가맹점 １２０개').unbacked,['120'])&&same(num('가맹점 １２개').codes,[]));
check('CD-N9 heading numbers and the QR code are not counted',same(check1([txt(1),txt(1),{lines:['문의','QR '+URL_OK]}]).unbacked,[]));
check('CD-N10 a decimal must match the fact text',same(num('매장 3.5배').unbacked,['3.5']));

// ════ CD-Q 유입 코드 QR ════
const qrc=(url,x)=>check1([txt(1),txt(1),{lines:['문의','QR '+url]}],x).codes;
check('CD-Q1 a brand code link that is in use passes and returns the code',same(qrc(URL_OK),[])&&check1(GOOD).qr.url===URL_OK);
check('CD-Q2 a path code link passes',same(qrc('https://ofd.example.kr/r/R2345678'),[]));
const bad=u=>same(qrc(u),['card_qr_invalid']);
check('CD-Q3 http, userinfo, dotless host and trailing-dot host are rejected',bad('http://ofd.example.kr/?utm_content=R2345678')&&bad('https://user@ofd.example.kr/?utm_content=R2345678')&&bad('https://localhost/?utm_content=R2345678')&&bad('https://ofd.example.kr./?utm_content=R2345678'));
check('CD-Q4 a link over 200 bytes is rejected',bad('https://ofd.example.kr/'+'a'.repeat(160)+'?utm_content=R2345678')&&same(qrc('https://ofd.example.kr/'+'a'.repeat(140)+'?utm_content=R2345678'),[]));
check('CD-Q5 personal data in the link is rejected',bad('https://ofd.example.kr/?email=kim@example.com&utm_content=R2345678')&&bad('https://ofd.example.kr/?tel=010-0000-0107&utm_content=R2345678'));
check('CD-Q6 no code or two codes are rejected',bad('https://ofd.example.kr/franchise')&&bad('https://ofd.example.kr/?utm_content=R2345678&x=1&utm_content=RQWERTYU'));
check('CD-Q7 an unknown code and another brand code are rejected',bad('https://ofd.example.kr/?utm_content=RMNBVCXZ')&&bad('https://ofd.example.kr/?utm_content=RABCDEFG'));
check('CD-Q8 a code retired today or earlier is rejected and one retiring tomorrow passes',bad('https://ofd.example.kr/?utm_content=RZXCVBNM')&&bad('https://ofd.example.kr/?utm_content=RASDFGHJ')&&same(qrc('https://ofd.example.kr/?utm_content=RQWERTYU'),[]));
check('CD-Q9 a missing or broken code book fails closed',same(qrc(URL_OK,{codes:null}),['card_qr_invalid'])&&same(qrc(URL_OK,{codes:[...CODES,{code:'R2345678',brandId:'b1',retiredOn:null}]}),['card_qr_invalid']));
check('CD-Q10 the template placeholder link is invalid until replaced',same(qrc('https://'),['card_qr_invalid']));
check('CD-Q11 a lower-case or spaced code is read as the normalized code',same(qrc('https://ofd.example.kr/?utm_content=r2345678'),[]));

// ════ CD-T 템플릿 ════
const T=fc.cardTemplate({processLabel:'[COLLECTIVE 휴리스틱 · 법률 자문 아님]',processLines:WAIT});
const tp=plain(fc.parseCards(T));
check('CD-T1 the template is four cards, card 4 has the placeholder QR line',tp.ok&&tp.cards.length===4&&tp.cards[3].qr==='https://'&&tp.cards[2].label==='[COLLECTIVE 휴리스틱 · 법률 자문 아님]');
check('CD-T2 the empty template fails structure (cards 1 and 2 empty) and QR until filled',same(plain(fc.checkCardBundle(T,ctx())).codes,['card_qr_invalid','card_structure']));
const filled=T.replace('■ 1장 [의견]\n','■ 1장 [의견]\n매장에서 굽는 우유 도넛').replace('■ 2장 [사실]\n','■ 2장 [사실]\n'+ff.factLine(F.count)+'\n'+FOOT).replace('QR https://','QR '+URL_OK);
check('CD-T3 a filled template passes',same(plain(fc.checkCardBundle(filled,ctx())).codes,[]));
check('CD-T4 fact lines passed to the template land in card 2',fc.parseCards(fc.cardTemplate({processLabel:'[x]',factLines:['a','b']})).cards[1].lines.join('|')==='a|b');

// ════ CD-L 그릴 자리 ════
for(const size of fc.CARD_SIZE_KEYS){
 const s=fc.CARD_SIZES[size];
 for(const card of [{index:1,label:'[사실]',lines:['가'],qr:null},{index:4,label:null,lines:['가'],qr:URL_OK}]){
  const L=plain(fc.cardLayout(size,card,4,'올드페리도넛'));
  assert.ok(L.width===s.width&&L.height===s.height,'규격');
  for(const b of L.blocks)assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=s.width&&b.y+b.height<=s.height&&b.minSize<=b.maxSize,'글 상자가 카드 안: '+b.role);
  const text=L.blocks.find(b=>b.role==='text'),lineH=Math.ceil(text.minSize*1.5),perLine=Math.floor(text.width/text.minSize);
  const chars=card.qr?fc.CARD_LIMITS.qrCardChars:fc.CARD_LIMITS.cardChars,lines=card.qr?fc.CARD_LIMITS.qrCardLines:fc.CARD_LIMITS.cardLines;
  assert.ok((lines+Math.ceil(chars/perLine))*lineH<=text.height,`가장 긴 글도 최소 글자로 들어간다: ${size} ${card.qr?'QR':''}`);
  if(card.qr){assert.ok(L.qr&&L.qr.x>=0&&L.qr.x+L.qr.size<=s.width&&L.qr.y+L.qr.size<=s.height&&L.qr.y>=text.y+text.height,'QR 자리는 글 아래 카드 안')}else assert.equal(L.qr,null);
  const brand=L.blocks.find(b=>b.role==='brand'),idx=L.blocks.find(b=>b.role==='index');
  assert.ok(brand.x+brand.width<=idx.x&&idx.text===`${card.index}/4`,'브랜드와 번호가 겹치지 않는다');
 }
}
check('CD-L1 both sizes keep every block inside the card, the longest text fits at the smallest size and QR sits below the text',true);
check('CD-L2 sizes are 1080×1350 and 1080×1920',fc.CARD_SIZES.feed.width===1080&&fc.CARD_SIZES.feed.height===1350&&fc.CARD_SIZES.story.height===1920&&same(fc.CARD_SIZE_KEYS,['feed','story']));
check('CD-L3 file names are ASCII with version, size and index',fc.cardFileName('ra-1:x',3,'story',2)==='ra-1_x-v3-story-2.png');

// ════ CD-C 코드·던지지 않음 ════
check('CD-C1 three codes, each with a message',same(fc.CARD_CODES,['card_number_unbacked','card_qr_invalid','card_structure'])&&fc.CARD_CODES.every(c=>typeof fc.CARD_MESSAGES[c]==='string'&&fc.CARD_MESSAGES[c].length>10));
check('CD-C2 garbage input never throws and fails closed',[null,undefined,42,{},[],'■'].every(b=>{const r=plain(fc.checkCardBundle(b,ctx()));return r.codes.includes('card_structure')})&&same(plain(fc.checkCardBundle(bundle(GOOD),{brandId:'b1',today:TODAY})).codes,['card_number_unbacked','card_qr_invalid']));
check('CD-C3 codes are sorted and unique',(()=>{const c=plain(fc.checkCardBundle('■ 1장\n가맹점 120개\nQR http://x',ctx())).codes;return same(c,[...new Set(c)].sort())&&c.length===3})());
check('CD-C4 exported lists are frozen',Object.isFrozen(fc.CARD_CODES)&&Object.isFrozen(fc.CARD_LIMITS)&&Object.isFrozen(fc.CARD_SIZES.feed)&&Object.isFrozen(fc.CARD_MESSAGES));

// ════ CD-X 구문 경계 ════
const CODE=readFileSync('lib/franchise-cards.ts','utf8');
const imports=[...CODE.matchAll(/from '\.\/([^']+)'/g)].map(m=>m[1]).sort();
check('CD-X1 imports only pure modules',same(imports,['brand-facts','franchise-facts','franchise-qr','franchise-recruitment','pii-scan']));
check('CD-X2 no clock, randomness, storage, network or model call',!/Date\.now|new Date\(\)|Math\.random|database\(|listRecords|fetch\(|isEnabled|hermes/i.test(CODE));
check('CD-X3 no fetch was called',fetchCalls===0);
check('CD-X4 the version constant is exported',fc.CARDS_VERSION==='fr-cards@2026-09-27.1');

console.log(JSON.stringify({passed:passed.length}));
