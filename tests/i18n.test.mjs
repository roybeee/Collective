// GLOBAL-PLAN G6 1단계: 화면 언어 사전(lib/i18n.ts)·언어별 형식(lib/format.ts)·산출물 출력 언어(lib/brief-language.ts와 지시문 한 줄).
// 순수 함수와 모의 런타임(메모리 SQLite)만 쓴다. 외부 호출 없음. 한국어 결과는 기존과 바이트 동일해야 한다.
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('external forbidden')});
let passed=0;
const check=async(name,fn)=>{try{await fn();passed++}catch(e){e.message=`${name}: ${e.message}`;throw e}};
const i18n=await load('lib/i18n.ts'),ko={...(await load('lib/i18n/ko.ts')).ko,...(await load('lib/i18n/ko-lazy.ts')).koLazy},en=(await load('lib/i18n/en.ts')).en,ja=(await load('lib/i18n/ja.ts')).ja,f=await load('lib/format.ts');

// 1) t(): 기본 한국어, {이름} 채우기, 없는 이름은 그대로, 사전에 없는 값은 한국어로 보이고 빠진 키로 센다.
await check('default locale is ko and t returns the Korean source',()=>{assert.equal(i18n.currentLocale(),'ko');assert.equal(i18n.t('nav.overview'),'워크스페이스');assert.equal(i18n.t('agenda.title'),'오늘의 안건')});
await check('interpolation fills named slots and keeps unknown ones',()=>{assert.equal(i18n.t('shell.workspaceEyebrow',{name:'올드페리'}),'올드페리 워크스페이스');assert.equal(i18n.t('agenda.topOnly',{shown:3,total:12}),'상위 3건만 보입니다(전체 12건).');assert.equal(i18n.t('inbox.select',{}),'{title} 선택');assert.equal(i18n.t('inbox.select'),'{title} 선택')});
await check('interpolation does not re-expand values that look like slots',()=>assert.equal(i18n.t('inbox.select',{title:'{n}'}),'{n} 선택'));
await check('no missing keys while Korean',()=>assert.equal(JSON.stringify(i18n.missingKeys()),'[]'));
await check('a lazy-screen key shows its name until its Korean section is registered',()=>{assert.ok(!i18n.hasKey('palette.title'));assert.equal(i18n.t('palette.title'),'palette.title');assert.equal(JSON.stringify(i18n.missingKeys()),'["ko:palette.title"]')});
await load('lib/i18n/lazy.ts');
await check('registering the lazy Korean section fills those keys without touching home keys',()=>{assert.ok(i18n.hasKey('palette.title'));assert.equal(i18n.t('palette.title'),'바로 가기');assert.equal(i18n.t('confirm.cancel'),'취소');assert.equal(i18n.t('nav.overview'),'워크스페이스');i18n.registerKorean({'nav.overview':'덮어쓰기'});assert.equal(i18n.t('nav.overview'),'워크스페이스')});
await check('hasKey and isLocale guard dynamic keys',()=>{assert.ok(i18n.hasKey('nav.franchise'));assert.ok(!i18n.hasKey('nav.unknown'));assert.ok(!i18n.hasKey('toString'));assert.ok(i18n.isLocale('ja')&&!i18n.isLocale('fr')&&!i18n.isLocale(null))});
const partial={...en};delete partial['nav.overview'];
i18n.registerDictionary('en',partial);
await check('setLocale switches to a registered dictionary (no storage in this runtime)',async()=>{assert.equal(await i18n.setLocale('en',{persist:false}),true);assert.equal(i18n.currentLocale(),'en');assert.equal(i18n.t('nav.campaigns'),'Campaigns');assert.equal(i18n.t('agenda.title'),'Today’s agenda')});
await check('a missing translation falls back to Korean and is counted',()=>{assert.equal(i18n.t('nav.overview'),'워크스페이스');assert.equal(JSON.stringify(i18n.missingKeys()),'["en:nav.overview","ko:palette.title"]');assert.equal(i18n.t('palette.title'),'Go to')});
await check('locale-bound money uses Intl in English',()=>assert.equal(i18n.localMoney(12345),'₩12,345'));
i18n.registerDictionary('ja',ja);
await check('a later request wins over an earlier one (no stale switch)',async()=>{const a=i18n.setLocale('ja',{persist:false}),b=i18n.setLocale('ko',{persist:false});assert.deepEqual(await Promise.all([a,b]),[false,true]);assert.equal(i18n.currentLocale(),'ko')});
await check('Japanese dictionary renders',async()=>{assert.equal(await i18n.setLocale('ja',{persist:false}),true);assert.equal(i18n.t('nav.overview'),'ワークスペース');assert.equal(i18n.localCompact(12000),'1.2万');assert.equal(i18n.localDay('2026-11-09'),'11月9日(月)')});
await check('invalid locale is refused and keeps the current one',async()=>{assert.equal(await i18n.setLocale('fr'),false);assert.equal(i18n.currentLocale(),'ja')});
await check('version snapshot rises on change',async()=>{const v=i18n.localeVersion();await i18n.setLocale('ko',{persist:false});assert.ok(i18n.localeVersion()>v);assert.equal(i18n.t('nav.overview'),'워크스페이스')});

// 2) 첫 그림 전 lang 스크립트: 저장된 en·ja만 반영, 그 밖·저장소 오류는 그대로 ko.
const boot=(stored,throws=false)=>{const doc={documentElement:{lang:'ko'}};runInNewContext(i18n.LOCALE_BOOT_SCRIPT,{document:doc,localStorage:{getItem:k=>{if(throws)throw Error('blocked');return k==='locale'?stored:null}}});return doc.documentElement.lang};
await check('boot script sets html lang from storage before paint',()=>{assert.equal(boot('en'),'en');assert.equal(boot('ja'),'ja');assert.equal(boot('ko'),'ko');assert.equal(boot('fr'),'ko');assert.equal(boot(null),'ko');assert.equal(boot('en',true),'ko')});
await check('boot script holds no user value',()=>assert.ok(!/\$\{|<\/script/i.test(i18n.LOCALE_BOOT_SCRIPT)));

// 3) 형식: 한국어 결과는 기존과 같고, 영어·일본어는 Intl.
await check('money stays byte-identical in Korean',()=>{assert.equal(f.money(12345),'12,345원');assert.equal(f.money(12345,undefined,'ko'),'12,345원');assert.equal(f.money(null),'미확인');assert.equal(f.money(0),'0원');assert.equal(f.money(NaN,'없음'),'없음')});
await check('money in English and Japanese shows the won sign',()=>{assert.equal(f.money(12345,undefined,'en'),'₩12,345');assert.equal(f.money(12345,undefined,'ja'),'₩12,345');assert.equal(f.money(0,undefined,'en'),'₩0');assert.equal(f.money(null,undefined,'en'),'미확인')});
await check('compact units per locale',()=>{assert.equal(f.compact(12000),'1.2만');assert.equal(f.compact(12000,'en'),'12K');assert.equal(f.compact(12000,'ja'),'1.2万');assert.equal(f.compact(123456789,'ko'),'1.2억');assert.equal(f.compact(950,'en'),'950');assert.equal(f.compact(null,'en'),'미확인')});
await check('day labels per locale (KST, date-only stays on the Seoul day)',()=>{assert.equal(f.dayLabel('2026-11-09'),'11월 9일 (월)');assert.equal(f.dayLabel('2026-11-09','en'),'Mon, Nov 9');assert.equal(f.dayLabel('2026-11-09','ja'),'11月9日(月)');assert.equal(f.dayLabel('2026-11-08T15:30:00Z','ko'),'11월 9일 (월)');assert.equal(f.dayLabel('bad','en'),'미확인')});
await check('existing Korean formats are unchanged',()=>{assert.equal(f.count(1234),'1,234');assert.equal(f.dateTime('2026-10-01T05:30:00.000Z'),'2026-10-01 14:30');assert.equal(f.dayTime('2026-10-02T06:10:00Z'),'10월 2일 오후 3:10');assert.equal(f.percent(0.125),'12.5%')});

// 2단계: 날짜·시각·기간은 화면 언어를 따른다(setLocale이 lib/format.ts에 알린다). 한국어 결과와 서버(언어를 바꾸지 않는 런타임)는 그대로다.
await check('dates, times and durations follow the screen language; Korean stays byte-identical',async()=>{
 const sample=()=>[f.dateTime('2026-10-01T05:30:00.000Z'),f.dateTime(null),f.date('2026-10-01'),f.date('2026-10-01T20:00:00Z'),f.dayTime('2026-10-02T06:10:00Z'),f.duration(500),f.duration(125000),f.duration(3840000)].join(' | ');
 assert.equal(sample(),'2026-10-01 14:30 | 미확인 | 2026-10-01 | 2026-10-02 | 10월 2일 오후 3:10 | 1초 미만 | 2분 5초 | 1시간 4분');
 assert.equal(await i18n.setLocale('en',{persist:false}),true);
 assert.equal(sample(),'Oct 1, 2026, 14:30 | Unconfirmed | Oct 1, 2026 | Oct 2, 2026 | Oct 2, 3:10 PM | under 1s | 2m 5s | 1h 4m');
 assert.equal(f.dateTime(undefined,'없음'),'없음');
 assert.equal(await i18n.setLocale('ja',{persist:false}),true);
 assert.equal(sample(),'2026/10/01 14:30 | 未確認 | 2026/10/01 | 2026/10/02 | 10月2日 15:10 | 1秒未満 | 2分5秒 | 1時間4分');
 assert.equal(await i18n.setLocale('ko',{persist:false}),true);
 assert.equal(sample(),'2026-10-01 14:30 | 미확인 | 2026-10-01 | 2026-10-02 | 10월 2일 오후 3:10 | 1초 미만 | 2분 5초 | 1시간 4분');
});

// 4) 사전 완결성(키·자리표시 일치)은 tests/i18n-coverage.test.mjs가 본다. 여기서는 사전 모양만 확인한다.
await check('dictionaries are plain string maps',()=>{for(const d of [ko,en,ja])assert.ok(Object.values(d).every(v=>typeof v==='string'))});

// 5) 산출물 출력 언어: 판정·저장·지시문 한 줄.
const lang=await load('lib/brief-language.ts'),server=await load('lib/server.ts');
await check('parseOutputLanguage accepts ko/en/ja and defaults to ko',()=>{assert.equal(lang.parseOutputLanguage(undefined),'ko');assert.equal(lang.parseOutputLanguage(''),'ko');assert.equal(lang.parseOutputLanguage(null),'ko');for(const l of ['ko','en','ja'])assert.equal(lang.parseOutputLanguage(l),l);for(const bad of ['EN','fr',1,{},['en']])assert.equal(lang.parseOutputLanguage(bad),null)});
await check('stored value reads only exact en/ja',()=>{assert.equal(lang.outputLanguageOf({outputLanguage:'en'}),'en');assert.equal(lang.outputLanguageOf({outputLanguage:'fr'}),'ko');assert.equal(lang.outputLanguageOf(null),'ko');assert.equal(lang.outputLanguageOf({}),'ko')});
await check('instruction line is empty for Korean and one line for en/ja',()=>{assert.equal(lang.outputLanguageLine({}),'');assert.equal(lang.outputLanguageLine({outputLanguage:'ko'}),'');assert.equal(lang.outputLanguageLine(undefined),'');const e=lang.outputLanguageLine({outputLanguage:'en'}),j=lang.outputLanguageLine({outputLanguage:'ja'});assert.ok(e.startsWith('\n')&&e.includes('모든 산출물을 영어로 작성한다')&&e.split('\n').length===2);assert.ok(j.includes('모든 산출물을 일본어로 작성한다')&&j.split('\n').length===2)});
const base={brandId:'b1',title:'검증',goal:'재방문을 늘린다.'};
await check('validateCampaign keeps no key when outputLanguage is absent (bytes unchanged)',()=>{const out=server.validateCampaign(base);assert.ok(!('outputLanguage' in out));assert.ok(!JSON.stringify(out).includes('outputLanguage'))});
await check('validateCampaign stores en/ja and clears ko',()=>{assert.equal(server.validateCampaign({...base,outputLanguage:'en'}).outputLanguage,'en');assert.equal(server.validateCampaign({...base,outputLanguage:'ja'}).outputLanguage,'ja');const cleared=server.validateCampaign({...base,outputLanguage:'ko'});assert.equal(cleared.outputLanguage,undefined);assert.ok(!JSON.stringify(cleared).includes('outputLanguage'));assert.equal({...{outputLanguage:'en'},...cleared}.outputLanguage,undefined,'ko clears a stored language when merged')});
await check('validateCampaign rejects an unknown language with 400',()=>assert.throws(()=>server.validateCampaign({...base,outputLanguage:'fr'}),e=>e.status===400&&e.message===lang.OUTPUT_LANGUAGE_MESSAGE));

// 6) 지시문: 한국어는 그대로, 영어·일본어는 한 줄만 더해진다(역할·브리프). 회의는 같은 함수를 쓴다(lib/meeting-input.ts).
const roleInstruction=await load('lib/role-instruction.ts'),agency=await load('lib/agency.ts'),briefInput=await load('lib/brief-input.ts');
const campaign={id:'c1',brandId:'b1',title:'검증',goal:'재방문',audience:'',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'draft',version:1,createdAt:'',updatedAt:''};
for(const role of agency.roles.map(r=>r.id)){
 const plain=roleInstruction.buildRoleInstruction({role,campaign}),same=roleInstruction.buildRoleInstruction({role,campaign:{...campaign,outputLanguage:'ko'}});
 await check(`role ${role}: ko instruction unchanged`,()=>assert.equal(same,plain));
 for(const l of ['en','ja']){const line=lang.outputLanguageLine({outputLanguage:l}),built=roleInstruction.buildRoleInstruction({role,campaign:{...campaign,outputLanguage:l}});
  await check(`role ${role}: ${l} adds exactly one line`,()=>{assert.ok(built.includes(line));assert.equal(built.replace(line,''),plain)})}
}
const request={input:{brandId:'b1',title:'검증',goal:'재방문을 늘린다.',audience:'',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',plan:{}},context:{brand:{id:'b1',name:'가상분식',short:'GB',category:'분식',color:'#224466',tone:'',audience:'',constraints:'',description:'',knowledge:''},evidence:{facts:{confirmed:[],candidate:[],prohibited:[]},directives:[]},archive:{confirmedSources:[]},sourceMasking:[],trialLearning:null,previousCampaigns:[],recordedMetrics:[],approvedLearnings:[]},contextDate:'2026-11-09',storeAllow:[]};
const briefKo=briefInput.buildBriefSubmission(request),briefEn=briefInput.buildBriefSubmission({...request,input:{...request.input,outputLanguage:'en'}});
await check('brief: en adds one instruction line; ko instruction has no language line',()=>{const line=lang.outputLanguageLine({outputLanguage:'en'});assert.ok(!briefKo.instructions.includes('출력 언어:'));assert.equal(briefEn.instructions,briefKo.instructions+line)});
await check('brief input carries outputLanguage only when set',()=>{assert.ok(!briefKo.input.includes('outputLanguage'));assert.ok(briefEn.input.includes('"outputLanguage":"en"'))});
await check('meeting assembly appends the same guarded line',async()=>{const src=(await import('node:fs')).readFileSync('lib/meeting-input.ts','utf8');assert.ok(src.includes('+outputLanguageLine(m.snapshot.campaign)+(s.correction?CORRECTION:\'\')'))});

console.log(JSON.stringify({passed}));
