// X6 채널 미리보기 계산(lib/text-bytes.ts): EUC-KR 바이트(한글 2바이트·이모지), SMS/LMS 구분, 채널별 글자 한도 표시, 접기·해시태그·표시 줄·광고 표시. 순수 함수라 외부 호출 없음.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async url=>{throw new Error('외부 호출 금지: '+url)});
const t=await rt.load('lib/text-bytes.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));

// 1) EUC-KR 바이트
check('ASCII is one byte each',t.eucKrBytes('abc 123').bytes===7&&t.eucKrBytes('abc').unsupported===0);
check('Korean is two bytes each',t.eucKrBytes('안녕하세요').bytes===10);
check('mixed Korean and ASCII',t.eucKrBytes('(광고) 080-123-4567').bytes===2+4+1+12+1-1);
check('an emoji counts two bytes and is flagged unsupported',JSON.stringify(plain(t.eucKrBytes('😀')))===JSON.stringify({bytes:2,unsupported:1}));
check('emoji with a variation selector flags both code points',t.eucKrBytes('❤️').unsupported===2&&t.eucKrBytes('❤️').bytes===4);
check('empty text is zero bytes',t.eucKrBytes('').bytes===0);

// 2) SMS·LMS 구분: 90바이트 이하는 SMS, 2,000바이트 이하는 LMS, 넘으면 초과
check('45 Korean characters (90 bytes) is SMS',t.messageKind(t.eucKrBytes('가'.repeat(45)).bytes)==='SMS');
check('46 Korean characters (92 bytes) is LMS',t.messageKind(t.eucKrBytes('가'.repeat(46)).bytes)==='LMS');
check('1,001 Korean characters is over the LMS limit',t.messageKind(t.eucKrBytes('가'.repeat(1001)).bytes)==='over');
const sms=plain(t.previewCounter('sms','가'.repeat(45)));
check('SMS counter label shows bytes against 90',sms.unit==='바이트'&&sms.limit===90&&sms.used===90&&sms.over===false&&sms.label==='90/90바이트, SMS');
const lms=plain(t.previewCounter('sms','가'.repeat(46)));
check('LMS counter switches the limit to 2,000 bytes',lms.limit===2000&&lms.kind==='LMS'&&lms.label==='92/2,000바이트, LMS');
check('over-LMS counter is marked over',t.previewCounter('sms','가'.repeat(1001)).over===true);

// 3) 글자 한도: Instagram 2,200자, Threads 500자, 블로그는 계수 없음
const ig=plain(t.previewCounter('instagram','가'.repeat(2200)));
check('Instagram limit is 2,200 characters',ig.limit===2200&&ig.used===2200&&!ig.over&&ig.label==='2,200/2,200자');
check('Instagram 2,201 characters is over',t.previewCounter('instagram','가'.repeat(2201)).over===true);
check('Threads limit is 500 characters',t.previewCounter('threads','a'.repeat(500)).over===false&&t.previewCounter('threads','a'.repeat(501)).over===true&&t.previewCounter('threads','').limit===500);
check('an emoji is one character, not two',t.charCount('😀😀')===2&&t.previewCounter('threads','😀').used===1);
check('the blog preview has no counter',t.previewCounter('blog','글')===null);

// 4) 발행 계정 → 미리보기 채널
check('Threads direct account previews as Threads',t.previewChannelFor('threads:123')==='threads');
check('Instagram direct account previews as Instagram',t.previewChannelFor('instagram_direct:99')==='instagram');
check('Buffer channel and missing account preview as Instagram',t.previewChannelFor('channel-1')==='instagram'&&t.previewChannelFor(undefined)==='instagram');

// 5) 접기·해시태그·표시 줄·광고 표시
const long='가'.repeat(130);
check('captions over 125 characters fold',JSON.stringify(plain(t.foldCaption(long)))===JSON.stringify({shown:'가'.repeat(125),folded:true}));
check('short captions do not fold',t.foldCaption('짧은 글').folded===false&&t.foldCaption('짧은 글').shown==='짧은 글');
const parts=plain(t.captionParts('봄 신메뉴 #딸기도넛 #ODA_2026 출시'));
check('hashtags become tag parts',JSON.stringify(parts.filter(p=>p.tag).map(p=>p.text))==='["#딸기도넛","#ODA_2026"]'&&parts.map(p=>p.text).join('')==='봄 신메뉴 #딸기도넛 #ODA_2026 출시');
const line='이 게시물의 문구는 AI의 도움을 받아 작성하고 담당자가 확인했습니다.';
const split=plain(t.splitDisclosure('카피\n\n대표 메뉴: 도넛\n\n'+line,[line]));
check('disclosure lines are split out of the body',split.body==='카피\n\n대표 메뉴: 도넛'&&JSON.stringify(split.disclosure)===JSON.stringify([line]));
check('two-line disclosures split into both lines',t.splitDisclosure('본문','가\n나').disclosure.length===2);
const marks=plain(t.messageMarks('(광고) 봄 신메뉴 안내\n무료수신거부 080-123-4567'));
check('ad prefix and 080 opt-out line are found',marks.adPrefix===true&&marks.optOut==='무료수신거부 080-123-4567');
check('plain messages have no ad marks',JSON.stringify(plain(t.messageMarks('예약 확인 안내')))===JSON.stringify({adPrefix:false,optOut:null}));

console.log(JSON.stringify({passed:passed.length}));
