// 로컬 산출물 재채점(F1a grade 모드). 네트워크·HERMES 호출 없이 실패 유형 사전 v1과 규제 가드레일(A2)을 돌린다.
// 사용: node scripts/eval/grade.mjs <case.json> [--json] [--detail]
// 입력(케이스 파일과 참조 파일)은 git이 추적하지 않는 경로(.gitignore 대상, 예: outputs/)에만 둔다. 추적 가능한 경로면 실행을 거부한다(exit 3).
// 결과는 표준 출력으로만 낸다. 파일을 쓰지 않는다. 케이스 형식은 docs/EVAL.ko.md '재채점(grade) 사용법'을 따른다.
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

if(typeof vm.SourceTextModule!=='function'){
 const child=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',fileURLToPath(import.meta.url),...process.argv.slice(2)],{stdio:'inherit'});
 process.exit(child.status??1);
}
const {pureLoader}=await import('./load-ts.mjs');
const {parseCampaignExport,parseMeetingExport,parseUsageCsv,detectContract}=await import('./segments.mjs');

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
let networkCalls=0;
globalThis.fetch=()=>{networkCalls++;throw new Error('grade.mjs는 네트워크를 쓰지 않습니다.')};
const die=(code,message)=>{process.stderr.write(message+'\n');process.exit(code)};
const args=process.argv.slice(2),flags=new Set(args.filter(a=>a.startsWith('--'))),casePath=args.find(a=>!a.startsWith('--'));
if(!casePath)die(2,'사용법: node scripts/eval/grade.mjs <case.json> [--json] [--detail]');

// git check-ignore를 통과한(무시 대상) 경로만 읽는다. 저장소 밖이라 판정할 수 없는 경로도 거부한다.
function readIgnored(path){
 let real;try{real=realpathSync(path)}catch{die(2,`입력 파일을 찾을 수 없습니다: ${path}`)}
 const r=spawnSync('git',['-C',dirname(real),'check-ignore','-q','--',real]);
 if(r.status!==0)die(3,`입력 경로가 git이 추적할 수 있는 위치입니다(git check-ignore 불통과): ${path}\n고객 원문과 골든셋은 .gitignore 대상 경로(예: outputs/)에 두세요.`);
 return readFileSync(real,'utf8');
}
const caseFile=resolve(casePath),spec=JSON.parse(readIgnored(caseFile));
if(spec.version!=='eval-case-v1')die(2,'케이스 파일 version은 eval-case-v1이어야 합니다.');

const load=pureLoader(root);
const {GRADERS,GRADERS_VERSION,runGraders,summarize}=await load('lib/graders/index.ts');
const {checkCompliance,COMPLIANCE_LEXICON}=await load('lib/graders/compliance.ts');
const {roles}=await load('lib/agency.ts'),{roleOutputContract}=await load('lib/role-output.ts'),{bodyOf}=await load('lib/graders/text.ts');
const titlesFor=role=>roleOutputContract(role).sections.map(s=>s.title);

function sourceItems(source){
 const text=readIgnored(resolve(dirname(caseFile),source.file));
 if(source.type==='campaign_export')return parseCampaignExport(text,{roles,titlesFor,contract:source.contract||{}});
 if(source.type==='meeting_export')return parseMeetingExport(text,{roles});
 if(source.type==='usage_csv')return parseUsageCsv(text);
 if(source.type==='role_markdown')return [{id:source.id||'role_'+source.role,kind:'role',role:source.role,contract:source.contract??detectContract(text,titlesFor(source.role)),text}];
 if(source.type==='role_json')return [{id:source.id||'role_'+source.role,kind:'role',role:source.role,contract:true,raw:text}];
 if(source.type==='items')return JSON.parse(text);
 return die(2,`알 수 없는 입력 종류: ${source.type}`);
}
// 같은 ID가 여러 입력에서 나오면 뒤에 #2, #3을 붙인다.
const unique=items=>items.map((item,i)=>{const n=items.slice(0,i).filter(x=>x.id===item.id).length;return n?{...item,id:`${item.id}#${n+1}`}:item});
const items=unique([...(spec.sources||[]).flatMap(s=>sourceItems(s).map(item=>({...item,sourceContext:s.context}))),...(spec.items||[])]);
const graded=items.map(({sourceContext,...item})=>{
 const ctx={...(spec.context||{}),...(sourceContext||{}),...(spec.itemContext?.[item.id]||{})};
 const compliance=['input','call'].includes(item.kind)?null:checkCompliance(bodyOf(item),{facts:ctx.facts});
 return {id:item.id,kind:item.kind,role:item.role,results:runGraders(item,ctx),compliance:compliance?.issues||[]};
});
const summary=summarize(graded.map(g=>g.results));
const issues=graded.flatMap(g=>g.compliance);
const bySeverity=Object.fromEntries(['block','warn','info'].map(s=>[s,issues.filter(i=>i.severity===s).length]));
const byCategory=issues.reduce((acc,i)=>({...acc,[i.category]:(acc[i.category]||0)+1}),{});
const detail=flags.has('--detail');
const report={gradersVersion:GRADERS_VERSION,graders:GRADERS.map(g=>g.id),items:graded.map(g=>({id:g.id,kind:g.kind,role:g.role,results:Object.fromEntries(g.results.map(r=>[r.id,detail?r:r.status])),...(detail?{compliance:g.compliance}:{complianceCount:g.compliance.length})})),summary,compliance:{version:COMPLIANCE_LEXICON.version,bySeverity,byCategory},notRun:spec.notRun||[],networkCalls};

if(flags.has('--json')){process.stdout.write(JSON.stringify(report,null,1)+'\n');process.exit(0)}
const mark={pass:'P',fail:'F',not_applicable:'N',grader_error:'E'};
const pct=r=>r===null?'  -':String(Math.round(r*100)).padStart(3)+'%';
const out=[`grade · ${GRADERS_VERSION} · 항목 ${graded.length}건 · 네트워크 호출 ${networkCalls}회`,'','유형별 집계 (pass/fail/na/error, 합격률)',
 ...GRADERS.map(g=>{const s=summary[g.id];return `${g.id.padEnd(28)} ${s.pass}/${s.fail}/${s.not_applicable}/${s.grader_error}  ${pct(s.passRate)}`}),
 '',`규제 가드레일 ${COMPLIANCE_LEXICON.version}: block ${bySeverity.block} · warn ${bySeverity.warn} · info ${bySeverity.info}`,
 '',`항목별 판정 (열 순서: ${GRADERS.map((g,i)=>i+1).join(' ')})`,
 ...graded.map(g=>`${g.id.padEnd(24)} ${g.results.map(r=>mark[r.status]).join(' ')}`),
 ...(report.notRun.length?['',...report.notRun.map(n=>`not_run: ${n.id} (${n.reason})`)]:[]),
 ...(detail?['','fail·error 근거',...graded.flatMap(g=>[...g.results.filter(r=>r.status==='fail'||r.status==='grader_error').map(r=>`${g.id} · ${r.id}: ${r.detail||''}`),...g.compliance.map(i=>`${g.id} · ${i.category}/${i.ruleId} [${i.severity}]: ${i.excerpt}`)])]:[])];
process.stdout.write(out.join('\n')+'\n');
