// G8 다크패턴 점검표(전자상거래법 제21조의2 온라인 인터페이스 다크패턴 금지, 제13조 제6항 정기결제 고지 취지). 화면 소스를 읽어 확인하는 정적 점검과 가격 계산 대조다.
// 1 순차공개 가격: 가격은 처음부터 부가세 포함 총액이고 서버 결제 금액과 같다. 2 사전선택: 동의·선택 칸은 처음에 비어 있다.
// 3 잘못된 계층구조: 구매와 환불 요청 버튼은 같은 모양이다. 4 취소·탈퇴 방해: 구매가 있는 곳에 환불 요청이 있다. 5 반복 간섭: 팝업·주기 재요청이 없다.
// 숨은 갱신: 자동 갱신·자동 결제는 없고, 그런 말이 나오면 '없음' 또는 '별도 동의'와 함께다. 근거: 정적 소스 점검(법률 자문 아님).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const src=f=>readFileSync(f,'utf8');
const ui={billing:src('app/billing-panel.tsx'),signup:src('app/signup-form.tsx'),login:src('app/auth-form.tsx')};
const screens=Object.values(ui);
// 주석 줄(설명)을 뺀 코드만 본다.
const code=s=>s.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const pure=await rt.load('lib/billing.ts');

// 2) 사전선택 금지
check('no pre-checked inputs on any purchase or signup screen',screens.every(s=>!/defaultChecked|checked=\{true\}|checked\s*(?=[\s/>])(?!=)/.test(s)));
check('consent states start unchecked (no useState(true) on these screens)',screens.every(s=>!/useState\(true\)/.test(s))&&/\[terms,setTerms\]=useState\(false\)/.test(ui.signup)&&/\[privacy,setPrivacy\]=useState\(false\)/.test(ui.signup)&&/\[marketing,setMarketing\]=useState\(false\)/.test(ui.signup));
const boxes=ui.signup.split('<Checkbox ').slice(1).map(s=>s.slice(0,s.indexOf('/>')));
check('required consents are required; marketing is optional and labelled 선택',boxes.length===3&&boxes.filter(b=>/\brequired\b/.test(b)).length===2&&!/\brequired\b/.test(boxes.find(b=>b.includes('name="marketing"')))&&/\(선택\) 마케팅/.test(ui.signup)&&(ui.signup.match(/\(필수\)/g)||[]).length===2);
check('no default selection of an upsell, plan or pack',!/defaultValue|selected=\{true\}|autoFocus/.test(ui.billing));

// 1) 순차공개 가격 금지
check('the purchase screen shows the VAT-inclusive total next to every price',/부가세 포함/.test(ui.billing)&&/priceText\(p\.price\)/.test(ui.billing)&&/krw\(p\.price\.totalKrw\)\}, 부가세 포함/.test(ui.billing));
const totals=pure.CREDIT_PACKS.map(p=>pure.priceWithVat(p.supplyKrw));
check('the shown total equals supply + 10% VAT for every pack (the server charges this amount)',totals.every(t=>t.totalKrw===t.supplyKrw+t.vatKrw&&t.vatKrw===Math.round(t.supplyKrw/10)));
check('the server order amount is computed from the same total (no extra fee added later)',/amountKrw:price\.totalKrw/.test(src('lib/billing-server.ts'))&&!/fee|수수료/.test(src('lib/billing-server.ts')));
check('placeholder prices carry the owner-decision note on screen',/data\.priceNote/.test(ui.billing)&&pure.PRICE_PLACEHOLDER_NOTE.includes('대표 확정 필요'));

// 3·4) 계층구조·취소 방해
const purchase=/<Button variant="(\w+)"[^>]*onClick=\{\(\)=>void buy\(p\)\}/.exec(ui.billing),refund=/<Button variant="(\w+)"[^>]*onClick=\{\(\)=>void refund\(o\.orderId\)\}/.exec(ui.billing);
check('a refund request exists wherever a purchase exists',!!purchase&&!!refund&&/환불 요청/.test(ui.billing));
check('purchase and refund request buttons have the same visual weight',purchase[1]===refund[1]);
check('the refund request is one click (no confirm dialog, no reason form required)',!/window\.confirm|confirm\(/.test(ui.billing.replace(/\/api\/billing\/confirm/g,''))&&/reason:'고객 요청'/.test(ui.billing));
check('signup has a way back to login at every step',(ui.signup.match(/\{back\}/g)||[]).length===2);

// 5) 반복 간섭
check('no nagging: no intervals, timers or pop-up windows on the purchase screen',!/setInterval|setTimeout|window\.open|alert\(/.test(ui.billing));

// 숨은 갱신 금지
const sentences=ui.billing.split(/[.。]/).filter(s=>/자동 ?갱신|자동 ?결제|정기 ?결제/.test(s));
check('every mention of auto-renewal says there is none or requires separate consent',sentences.length>0&&sentences.every(s=>/없|별도 동의/.test(s)));
check('no billing-key (자동결제) API is called in this build',!/billingKey|billing-key|\/billing\/authorizations/.test(src('lib/billing-server.ts')+ui.billing));

// 접근성 있는 인증(WCAG 2.2 3.3.8): 퍼즐·CAPTCHA 없음, 비밀번호 관리자 허용
check('no CAPTCHA or puzzle on signup',!/captcha|recaptcha|turnstile|puzzle|퍼즐/i.test(code(ui.signup)+code(src('app/api/auth/signup/route.ts'))));
check('password fields allow password managers (autocomplete set, no paste blocking)',/autoComplete="new-password"/.test(ui.signup)&&/autoComplete="username"/.test(ui.signup)&&!/onPaste|onCopy/.test(ui.signup));

console.log(JSON.stringify({passed:passed.length}));
