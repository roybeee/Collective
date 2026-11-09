// 브랜드 자동 학습(G1) 순수 추출기(lib/brand-learn.ts)와 첫 캠페인 템플릿(lib/campaign-templates.ts). 근거: mocked(고정 HTML 3종, 네트워크·DB 없음).
// 고정물: ① 한식 매장 사이트(og·theme-color·CSS 색·주소·전화·영업시간·가격·해요체) ② 네이버 플레이스형 마크업(og만, 합니다체, 전화·영업시간 줄) ③ Instagram 공개 페이지형(og만, 본문 거의 없음).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console,URL,TextEncoder}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const learn=await load('lib/brand-learn.ts'),templates=await load('lib/campaign-templates.ts'),sample=await load('lib/brand-learn-sample.ts'),policy=await load('lib/campaign-policy.ts'),brief=await load('lib/brief.ts');
const plain=v=>JSON.parse(JSON.stringify(v));
let passed=0;const check=(name,value)=>{assert.ok(value,name);passed++};

// ① 한식 매장 사이트(합성). 실제 매장·번호가 아니다.
const restaurant=`<!doctype html><html lang="ko"><head><title>가상 한식당 본점 | 매일 짓는 솥밥</title>
<meta property="og:site_name" content="가상 한식당"><meta property="og:title" content="가상 한식당 본점"><meta name="description" content="직접 지은 솥밥과 제철 반찬(합성 설명)">
<meta property="og:image" content="https://cdn.example.test/og.png"><meta name="theme-color" content="#1D4ED8"><link rel="apple-touch-icon" href="/apple.png">
<style>.a{color:#1d4ed8}.b{background:#1D4ED8;border-color:#1d4ed8}.c{color:rgb(220, 38, 38)}.d{color:#fff;background:#000}.e{color:#16a34a}.f{color:#f59e0b}.g{color:#0ea5e9}.h{color:#9333ea}</style></head>
<body><h1>가상 한식당</h1><p>오늘도 갓 지은 밥을 준비했어요.</p><p>반찬은 매일 바뀌어요!</p><p>포장도 가능해요 😊</p>
<ul><li>솥밥 정식 12,000원</li><li>제육 솥밥 13,500원</li><li>된장찌개 9,000원</li></ul>
<div style="color:#1d4ed8">서울특별시 가상구 가상로 12, 2층</div><div>문의 02-1234-5678 / 010.9876.5432</div>
<p>영업시간 11:30~21:00 (브레이크 15:00~17:00)</p><p>일요일 휴무</p>
<footer><a href="https://www.instagram.com/example_hansik/?hl=ko">인스타</a><a href="https://map.naver.com/p/entry/place/12345#home">플레이스</a><a href="https://www.instagram.com/example_hansik/">인스타(중복)</a><a href="/about">소개</a></footer>
<script>var x="#ff00ff";</script></body></html>`;
const r1=plain(learn.learnBrandFromHtml(restaurant,'https://hansik.example.test/'));
check('name comes from og:site_name with strong confidence',r1.name.value==='가상 한식당'&&r1.name.source==='og'&&r1.name.confidence==='strong');
check('logo comes from og:image (strong) over the touch icon',r1.logo.value==='https://cdn.example.test/og.png'&&r1.logo.confidence==='strong');
check('tagline comes from meta description',r1.tagline.value==='직접 지은 솥밥과 제철 반찬(합성 설명)'&&r1.tagline.source==='meta');
check('theme-color leads the color list and css hex/rgb are counted, capped at 5, white/black excluded',r1.colors.length===5&&r1.colors[0].hex==='#1d4ed8'&&r1.colors[0].source==='meta'&&r1.colors[0].count===5&&r1.colors.some(c=>c.hex==='#dc2626')&&!r1.colors.some(c=>c.hex==='#ffffff'||c.hex==='#000000'||c.hex==='#ff00ff'));
check('color counts are descending with hex text',r1.colors.every((c,i,a)=>i===0||a[i-1].count>=c.count)&&r1.colors.every(c=>/^#[0-9a-f]{6}$/.test(c.hex)));
check('korean address is found (strong first)',r1.address[0].value==='서울특별시 가상구 가상로 12, 2층'&&r1.address[0].confidence==='strong'&&r1.address[0].source==='text');
check('phones are normalized to dashes',JSON.stringify(r1.phone.map(p=>p.value))==='["02-1234-5678","010-9876-5432"]'&&r1.phone[1].confidence==='weak');
check('hours line is captured',r1.hours.length===1&&r1.hours[0].value.includes('11:30~21:00'));
check('price lines are captured in order',r1.menu.map(m=>m.value).join('|')==='솥밥 정식 12,000원|제육 솥밥 13,500원|된장찌개 9,000원');
check('social links keep official hosts only, dedupe and strip query/hash',JSON.stringify(r1.social.map(s=>s.value))==='["https://www.instagram.com/example_hansik/","https://map.naver.com/p/entry/place/12345"]');
check('voice signals read 해요체 with an emoji and an exclamation',r1.voice.style==='해요체'&&r1.voice.haeyo>=3&&r1.voice.hapnida===0&&r1.voice.emojiPer100Chars>0&&r1.voice.exclamationRatio>0);
check('scripts and styles are not in the text',!JSON.stringify(r1).includes('ff00ff')&&r1.textChars>0);
check('result is deterministic',JSON.stringify(r1)===JSON.stringify(plain(learn.learnBrandFromHtml(restaurant,'https://hansik.example.test/'))));
const c1=plain(learn.learnedFactCandidates(r1,'https://hansik.example.test/','2026-11-09T00:00:00.000Z'));
check('fact candidates use catalog keys once each with a source line that names the url and date',c1.map(c=>c.key).join(',')==='address,phone,hours,menu_price,official_account'&&c1.every(c=>c.source.includes('https://hansik.example.test/')&&c.source.includes('2026-11-09')&&c.source.includes('미확인 후보')));
check('menu candidate joins up to five price lines',c1.find(c=>c.key==='menu_price').value.split('\n').length===3&&learn.learnedFactCount(r1)===5);

// ② 네이버 플레이스형 마크업: og 메타만 있고 본문은 합니다체 안내 줄.
const place=`<html><head><meta property="og:title" content="가상 카페 가상점 : 네이버"><meta property="og:description" content="방문자 리뷰와 영업시간을 확인합니다."><meta property="og:image" content="https://ldb-phinf.example.test/photo.jpg"></head>
<body><div class="place_section"><span>가상 카페 가상점</span><span>카페,디저트</span></div><div><span>영업 중</span><span>매일 09:00 - 22:00</span></div><div><span>0507-1234-5678</span></div>
<div><span>경기도 가상시 가상구 가상동 가상로 77 1층</span></div><ul><li>아메리카노 4,500원</li><li>크루아상 3,800원</li></ul>
<p>본 정보는 네이버에서 제공합니다. 영업시간은 매장 상황에 따라 다를 수 있습니다. 방문 전 확인하시기 바랍니다.</p></body></html>`;
const r2=plain(learn.learnBrandFromHtml(place,'https://m.place.naver.com/restaurant/1/home'));
check('place: og:title without site_name is weak and site suffix is trimmed',r2.name.value==='가상 카페 가상점'&&r2.name.confidence==='weak');
check('place: og:description is a weak tagline',r2.tagline.source==='og'&&r2.tagline.confidence==='weak');
check('place: no css colors yields an empty list',r2.colors.length===0);
check('place: 0507 phone, hours and price lines are found',r2.phone[0].value==='0507-1234-5678'&&r2.hours[0].value.includes('09:00 - 22:00')&&r2.menu.length===2);
check('place: 경기도 address found',r2.address[0].value.startsWith('경기도 가상시 가상구 가상동 가상로 77'));
check('place: voice reads 합니다체',r2.voice.style==='합니다체'&&r2.voice.hapnida>=3);

// ③ Instagram 공개 페이지형: og만, 본문 거의 없음.
const insta=`<html><head><meta property="og:title" content="가상브랜드(@example_brand) • Instagram 사진 및 동영상"><meta property="og:description" content="팔로워 1,234명, 팔로잉 12명, 게시물 345개"><meta property="og:image" content="https://scontent.example.test/p.jpg"><meta name="theme-color" content="#ffffff"></head><body><span>로그인</span></body></html>`;
const r3=plain(learn.learnBrandFromHtml(insta,'https://www.instagram.com/example_brand/'));
check('instagram: title core before the bullet, weak',r3.name.value==='가상브랜드(@example_brand) • Instagram 사진 및 동영상'.split(' • ')[0]||r3.name.confidence==='weak');
check('instagram: white theme-color is not a brand color',r3.colors.length===0);
check('instagram: no facts and voice unknown',learn.learnedFactCount(r3)===0&&r3.voice.style==='미확인'&&r3.address.length===0);
check('empty input yields an empty result',(()=>{const r=plain(learn.learnBrandFromHtml(''));return !r.name&&!r.logo&&r.colors.length===0&&r.voice.style==='미확인'})());
check('html over 2MB is truncated before parsing',learn.learnBrandFromHtml('<title>x</title>'+'a'.repeat(2_100_000)+'<p>서울특별시 가상구 가상로 1</p>').address.length===0);
check('entities and attribute forms decode',learn.decodeEntities('A&amp;B &#44032;&nbsp;&#x3b;')==='A&B 가 ;'&&learn.tagAttrs(`<meta name=description content='x "y"'>`).content==='x "y"');
check('normalizeColor handles #rgb, rgb() and rejects junk',learn.normalizeColor('#ABC')==='#aabbcc'&&learn.normalizeColor('rgb(255,0,0)')==='#ff0000'&&learn.normalizeColor('rgb(300,0,0)')===null&&learn.normalizeColor('red')===null);

// 서버 E2E 고정물(lib/brand-learn-sample.ts)도 같은 추출기로 이름·색·사실 후보가 나와야 한다.
const rs=plain(learn.learnBrandFromHtml(sample.BRAND_LEARN_SAMPLE_HTML,'http://127.0.0.1:8824'+sample.BRAND_LEARN_SAMPLE_PATH));
check('sample fixture yields name, 5 colors, logo and 5 fact candidates',rs.name.value==='가상 분식 연구소'&&rs.colors.length===5&&rs.colors[0].hex==='#c2410c'&&rs.logo.value==='http://127.0.0.1:8824/images/sample-logo.png'&&learn.learnedFactCount(rs)===5&&rs.voice.style==='해요체');

// 템플릿 3개: 브리프 입력 모양, [확인 필요] 표지, 수치·광고 표현 없음, 보호 항목 비움.
const ctx={brandId:'b1',name:'가상 분식',category:'분식',storeCount:2,confirmedFactCount:0};
const ids=plain(templates.campaignTemplates).map(t=>t.id);
check('three templates in order',ids.join(',')==='new_menu,off_season,review_event'&&templates.isTemplateId('new_menu')&&!templates.isTemplateId('x'));
const inputs=ids.map(id=>plain(templates.templateBriefInput(id,ctx)));
const guard=plain(policy.claimGuard({confirmed:[],prohibited:[]}));
for(const [i,input] of inputs.entries()){
 const id=ids[i],text=[input.title,input.goal,input.audience,input.channels,input.stores,input.products,input.constraints,input.sources,...Object.values(input.plan)].join('\n');
 check(`${id}: has brand, goal, kpi, hypothesis, experiment, tracking, decision, schedule`,input.brandId==='b1'&&input.title.includes('가상 분식')&&input.goal.length>10&&['kpi','hypothesis','experiment','tracking','decision','schedule'].every(k=>input.plan[k].length>5));
 check(`${id}: protected fields stay empty`,[...brief.protectedFields].every(k=>(k in input.plan?input.plan[k]:input[k]??'')===''));
 check(`${id}: budget and dates are unset`,input.budget===null&&input.startDate===''&&input.endDate==='');
 check(`${id}: placeholders are flagged [확인 필요] and store count is used`,text.includes('[확인 필요]')&&input.stores==='등록 지점 2곳');
 check(`${id}: no invented won amounts or percentages`,!/\d[\d,]*\s*원|\d+(?:\.\d+)?\s*%|\d+\s*명\b/.test(text));
 check(`${id}: no unverified ad claims outside negation lines`,plain(policy.unverifiedClaims(text,guard)).length===0);
 check(`${id}: experiment changes one variable and the schedule is a 30-day skeleton`,/한 변수만/.test(input.plan.experiment)&&/1주.*4주/.test(input.plan.schedule));
}
check('unknown store count is a placeholder, zero stores says 미등록',templates.templateBriefInput('new_menu',{...ctx,storeCount:null}).stores==='지점 [확인 필요]'&&templates.templateBriefInput('new_menu',{...ctx,storeCount:0}).stores==='지점 미등록');
check('review event constrains rewards disclosure and forbids fabricated reviews',/표시/.test(inputs[2].constraints)&&/만들지 않습니다/.test(inputs[2].constraints));
check('template input is a fresh object each call',templates.templateBriefInput('new_menu',ctx)!==templates.templateBriefInput('new_menu',ctx));
console.log(JSON.stringify({passed}));
