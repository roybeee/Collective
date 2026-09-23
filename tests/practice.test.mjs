import assert from 'node:assert/strict';
import {SourceTextModule,createContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
const context=createContext({console});const cache=new Map();
async function load(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,{context,identifier:path});cache.set(path,m);await m.link((s,r)=>load(resolve(dirname(r.identifier),s+'.ts')));return m;}
const q=await load('lib/quality.ts');await q.evaluate();const {enforceQuality,parseStandaloneQuality,qualityMarkdown}=q.namespace;
const meet=await load('lib/meetings.ts');await meet.evaluate();
const practice=await load('lib/practice.ts');await practice.evaluate();
const checks=Object.keys(q.namespace.qualityCriteria).map(criterion=>({criterion,status:'pass',location:'content: 개선본 / CTA',finding:'브리프의 이용 조건과 완성 카피를 대조함',fix:'해당 없음'}));
const taskChecks=[{role:'content',status:'pass',location:'content: 개선본 / 타임라인',finding:'15초 타임라인과 실제 대사 작성됨',fix:'해당 없음'}];
const base={verdict:'ready_for_review',summary:'검토 준비',findings:'사용자 승인 필요'};
let count=0;function check(name,fn){fn();count++;console.log('PASS',name)}
check('all criteria and assigned tasks permit review, never automatic approval',()=>assert.equal(enforceQuality(base,{checks,taskChecks},['content']).verdict,'ready_for_review'));
check('contradictory needs_data overrides model readiness',()=>assert.equal(enforceQuality(base,{checks:checks.map((x,i)=>i===0?{...x,status:'needs_data',finding:'실제 가격 자료 없음',fix:'상품 담당자 확인'}:x),taskChecks},['content']).verdict,'needs_data'));
check('one required revision overrides ready',()=>assert.equal(enforceQuality(base,{checks:checks.map((x,i)=>i===1?{...x,status:'revise'}:x),taskChecks},['content']).verdict,'revise'));
check('missing/duplicate criteria cannot pass',()=>{assert.equal(enforceQuality(base,{checks:checks.slice(1),taskChecks},['content']).verdict,'revise');assert.equal(enforceQuality(base,{checks:[...checks.slice(1),checks[1]],taskChecks},['content']).verdict,'revise')});
check('missing or invented task role cannot pass',()=>{assert.equal(enforceQuality(base,{checks,taskChecks:[]},['content']).verdict,'revise');assert.equal(enforceQuality(base,{checks,taskChecks:[{...taskChecks[0],role:'invented'}]},['content']).verdict,'revise')});
// 과잉(합의 과제가 없는데 taskChecks를 채움)과 누락·불일치를 다른 문구로 알린다(AQ6).
check('extra task checks without assigned tasks get a distinct gate message',()=>{const extra=enforceQuality(base,{checks,taskChecks},[]);assert.equal(extra.verdict,'revise');assert.ok(extra.gateIssues.some(x=>x.includes('합의 과제가 없어')&&x.includes('checks')));assert.ok(!extra.gateIssues.some(x=>x.includes('누락')));const missing=enforceQuality(base,{checks,taskChecks:[]},['content']);assert.ok(missing.gateIssues.some(x=>x.includes('누락')));assert.ok(!missing.gateIssues.some(x=>x.includes('합의 과제가 없어')))});
check('empty location and malformed checks cannot pass',()=>{assert.equal(enforceQuality(base,{checks:checks.map(x=>({...x,location:''})),taskChecks},['content']).verdict,'revise');assert.equal(enforceQuality(base,{checks:[null],taskChecks},['content']).verdict,'revise')});
check('outdated downstream tasks still need revision',()=>assert.equal(enforceQuality(base,{checks,taskChecks},['content'],['data']).verdict,'revise'));
check('model conservative verdict never upgraded',()=>assert.equal(enforceQuality({...base,verdict:'needs_data'},{checks,taskChecks},['content']).verdict,'needs_data'));
check('plain text standalone quality retained as revision',()=>{const r=parseStandaloneQuality('가격은 확인 필요하지만 통과입니다');assert.equal(r.verdict,'revise');assert.ok(qualityMarkdown(r).includes('가격은 확인 필요'))});
check('standalone quality validates full rubric',()=>assert.equal(parseStandaloneQuality(JSON.stringify({...base,checks,taskChecks:[]})).verdict,'ready_for_review'));
check('standalone quality with extra task checks keeps the review as revise',()=>{const r=parseStandaloneQuality(JSON.stringify({...base,checks,taskChecks}),true);assert.equal(r.verdict,'revise');assert.ok(r.gateIssues.length===1&&qualityMarkdown(r).includes('## 추가 확인 필요'))});
check('strict standalone quality rejects only unparseable JSON',()=>{assert.throws(()=>parseStandaloneQuality('가격은 확인 필요하지만 통과입니다',true),/JSON/);assert.equal(parseStandaloneQuality(JSON.stringify({verdict:'ready_for_review'}),true).verdict,'revise')});
check('instructions cite readable ref labels instead of internal IDs',()=>{assert.ok(!practice.namespace.evidenceDiscipline.includes('작업물 ID'));assert.ok(practice.namespace.evidenceDiscipline.includes('ref 라벨'));assert.ok(!q.namespace.qualityContract.includes('작업물 ID'));assert.ok(q.namespace.qualityContract.includes('ref 라벨'))});
check('quality locations are scrubbed for display but preserved separately',()=>{const raw='ai-f8710d51c4f2a179f4eb21008f184872 v1 §2';const r=q.namespace.scrubQualityReview(enforceQuality(base,{checks:checks.map((x,i)=>i===0?{...x,location:raw,fix:'37da2d59-038a-4403-8374-de1f01f430f7 기준 재작성'}:x),taskChecks},['content']));assert.equal(r.checks[0].locationRef,raw);assert.ok(!/ai-[0-9a-f]{32}/.test(r.checks[0].location));assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(qualityMarkdown(r)));assert.equal(r.checks[1].locationRef,undefined)});
const previous=[{phase:'synthesis',output:{tasks:[{role:'content'}]}}],step={phase:'quality'};
check('legacy meetings accept their original schema',()=>assert.equal(meet.namespace.parseMeetingOutput(JSON.stringify(base),step,previous,false).verdict,'ready_for_review'));
check('new meeting schema downgrades missing rubric',()=>assert.equal(meet.namespace.parseMeetingOutput(JSON.stringify(base),step,previous,true).verdict,'revise'));
check('task deficit survives meeting parsing',()=>assert.equal(meet.namespace.parseMeetingOutput(JSON.stringify({...base,checks,taskChecks:[]}),step,previous,true).verdict,'revise'));
check('full and discussion instructions differ',()=>{const full=practice.namespace.rolePractice('content'),discussion=practice.namespace.rolePractice('content','discussion');assert.ok(full.includes('타임라인'));assert.ok(full.includes('필수 산출물'));assert.ok(!discussion.includes('필수 산출물'));assert.ok(discussion.includes('최대 병목 1개'))});
check('channel practices do not claim unknown channels are configured',()=>{assert.ok(practice.namespace.campaignPractice({channels:'',stores:'',goal:'',products:''}).includes('미확정'));assert.ok(practice.namespace.campaignPractice({channels:'인스타, 오프라인',stores:'성수',goal:'보관함 이용',products:''}).includes('QR/POS'))});
check('the quality report states what it did not review',()=>{const md=qualityMarkdown({...base,checks,taskChecks});assert.ok(md.includes('검수 범위'));assert.ok(md.includes('법적 검토는 포함하지 않습니다'))});
console.log(JSON.stringify({passed:count}));
