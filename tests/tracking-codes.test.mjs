// A4 추적 코드(순수 모듈) 회귀: 형식·정규화·생성·UTM 파싱·매칭 경계.
// 근거: mocked(외부 호출 0회). 난수는 테스트가 바이트로 준다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const tc=await rt.load('lib/tracking-codes.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));

// 1) 형식: 대문자 영숫자 4~12자, 혼동 문자(0·O·1·I·L) 제외
check('alphabet has no confusable characters',!/[01OIL]/.test(tc.CODE_ALPHABET)&&tc.CODE_ALPHABET.length===31&&new Set(tc.CODE_ALPHABET).size===31);
check('4 and 12 characters are the length bounds',tc.isValidCode('AB23')&&tc.isValidCode('ABCDEFGH2345')&&!tc.isValidCode('AB2')&&!tc.isValidCode('ABCDEFGH23456'));
check('confusable characters are invalid',['ABC0','ABC1','ABCO','ABCI','ABCL'].every(c=>!tc.isValidCode(c)));
check('raw lowercase or separators are invalid until normalised',!tc.isValidCode('abcd')&&!tc.isValidCode('AB-CD')&&!tc.isValidCode('AB CD')&&!tc.isValidCode(''));

// 2) 정규화: 대소문자·공백·하이픈 무시
check('normalising ignores case spaces and hyphens',tc.normalizeCode(' ab-cd ef ')==='ABCDEF'&&tc.normalizeCode('x7-k9-p2')==='X7K9P2');
check('full-width input is normalised',tc.normalizeCode('ＡＢ２３')==='AB23');
check('non-string input normalises to empty',tc.normalizeCode(undefined)===''&&tc.normalizeCode(123)==='');

// 3) 생성: 결정론적 입력(유형 접두어·길이) + 호출자가 준 난수 바이트
const bytes=Uint8Array.from({length:32},(_,i)=>i*7);
const a=tc.generateCode('coupon',bytes);
check('same type and bytes give the same code',a===tc.generateCode('coupon',bytes));
check('generated code carries the type prefix and default length 8',a.length===8&&a[0]==='C'&&tc.isValidCode(a));
check('each type has its own prefix',tc.generateCode('qr',bytes)[0]==='Q'&&tc.generateCode('pos_tag',bytes)[0]==='P'&&tc.generateCode('utm',bytes)[0]==='U');
check('different random bytes give a different code',a!==tc.generateCode('coupon',bytes.map(x=>(x+1)%256)));
check('length can be chosen within 4-12',tc.generateCode('qr',bytes,4).length===4&&tc.generateCode('qr',bytes,12).length===12);
assert.throws(()=>tc.generateCode('qr',bytes,3));assert.throws(()=>tc.generateCode('qr',bytes,13));passed.push('lengths outside 4-12 are refused');
check('bytes at or above 248 are skipped to avoid modulo bias',tc.generateCode('coupon',Uint8Array.from([255,248,0,1,2,3,4,5,6]))==='CABCDEFG');
assert.throws(()=>tc.generateCode('coupon',Uint8Array.from([255,255,255,0])));passed.push('too few usable random bytes is an error');
assert.throws(()=>tc.generateCode('sms',bytes));passed.push('unknown code type is refused');

// 4) UTM: utm_campaign/utm_content 조합
check('utm pair is parsed from a URL',JSON.stringify(plain(tc.parseUtm('https://x.test/menu?utm_source=ig&utm_campaign=Open_Week&utm_content=uk7-x9')))==='{"campaign":"open_week","content":"UK7X9"}');
check('utm pair is parsed from a bare query',plain(tc.parseUtm('utm_campaign=open&utm_content=AB23')).content==='AB23');
check('encoded values are decoded',plain(tc.parseUtm('?utm_campaign=open%2Dweek&utm_content=AB%2023')).campaign==='open-week');
check('missing utm_content is not a pair',tc.parseUtm('utm_campaign=open')===null&&tc.parseUtm('no utm here')===null);
check('utm campaign slug is lower-cased and validated',tc.normalizeUtmCampaign(' Open_Week ')==='open_week'&&tc.normalizeUtmCampaign('bad value')===''&&tc.normalizeUtmCampaign(7)==='');

// 5) 셀에서 코드 꺼내기와 매칭
check('several codes keep order and drop repeats',JSON.stringify(plain(tc.codeTokens('ab23; X7K9-P2 , ab23')).map(t=>t.code))==='["AB23","X7K9P2"]');
check('text that is not a code is ignored',plain(tc.codeTokens('오픈기념 10% 할인')).length===0&&plain(tc.codeTokens('')).length===0);
check('a utm cell yields one utm token',(()=>{const t=plain(tc.codeTokens('https://x.test/?utm_campaign=open&utm_content=AB23'));return t.length===1&&t[0].code==='AB23'&&t[0].utmCampaign==='open'})());
const code=(over={})=>({id:'AB23',code:'AB23',type:'coupon',storeId:'s1',campaignId:'c1',label:'',validFrom:'2026-01-01',createdAt:'x',createdBy:{id:'u',email:null},version:1,...over});
const codes=[code(),code({id:'UTM2',code:'UTM2',type:'utm',utmCampaign:'open'})];
check('plain token matches by code',tc.matchCode({code:'AB23'},codes)?.id==='AB23');
check('plain token may match a utm code by its content',tc.matchCode({code:'UTM2'},codes)?.id==='UTM2');
check('utm token needs a utm code with the same campaign',tc.matchCode({code:'UTM2',utmCampaign:'open'},codes)?.id==='UTM2'&&!tc.matchCode({code:'UTM2',utmCampaign:'other'},codes)&&!tc.matchCode({code:'AB23',utmCampaign:'open'},codes));
check('unknown token has no match',!tc.matchCode({code:'ZZZZ'},codes));
check('utm query is built from the code',tc.utmQuery(codes[1])==='utm_campaign=open&utm_content=UTM2'&&tc.utmQuery(codes[0])==='');

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
