// prompts/ 정본 검사(F3a, 대표 결정 2·3). CI verify 잡이 실행하고, 하나라도 통과하지 않으면 비영으로 끝난다.
// 검사: 파일 이름=단위, 스키마(schema 1·unit·body), 단위 목록과 1:1, 단위당 6,000자 상한, 코드 소유 영역 문구, 명령형 주입 패턴, 본문 URL,
// 브랜드·지점명(lib/agency.ts 시드 브랜드명 등 코드에서 가져온 목록), 가격 표기. 규칙은 등록 API와 같은 lib/prompt-units.ts 하나다.
// prompts/는 비제품 경로다. 앱 소스(app·lib·server·components·hooks)가 prompts/를 import하면 실패로 본다.
// 사용: node scripts/check-prompts.mjs [검사할 디렉터리, 기본 prompts]. 저장소 루트 기준으로 동작한다.
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join,resolve,dirname,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

// 순수 TS 로더(vm SourceTextModule)는 --experimental-vm-modules가 필요하다. 플래그 없이 부르면 같은 인자로 한 번 다시 실행한다.
if(!vm.SourceTextModule){const r=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',...process.argv.slice(1)],{stdio:'inherit'});process.exit(r.status??1)}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {pureLoader}=await import('./eval/load-ts.mjs');
const units=await pureLoader(root)('lib/prompt-units.ts');
const dir=resolve(process.cwd(),process.argv[2]||join(root,'prompts'));
const failures=[];
const fail=(file,reason,message)=>failures.push(`FAIL ${file}: [${reason}] ${message}`);

function checkFile(name){
 const path=join(dir,name),unit=name.replace(/\.json$/,'');
 if(!units.unitOf(unit))return fail(name,'schema','알 수 없는 단위 파일입니다. 파일 이름은 <단위>.json이어야 합니다.');
 if(statSync(path).size>units.PROMPT_FILE_MAX_BYTES)return fail(name,'length',`파일이 ${units.PROMPT_FILE_MAX_BYTES}바이트를 넘습니다.`);
 let json;try{json=JSON.parse(readFileSync(path,'utf8'))}catch{return fail(name,'schema','JSON 형식이 아닙니다.')}
 try{const {body}=units.parseUnitFile(json,unit);return units.validateUnitBody(unit,body)}
 catch(error){if(error&&typeof error==='object'&&'reason' in error)return fail(name,error.reason,error.message);throw error}
}
function checkDirectory(){
 if(!existsSync(dir)||!statSync(dir).isDirectory())return fail(relative(root,dir)||dir,'schema','검사할 디렉터리가 없습니다.');
 const names=readdirSync(dir).sort();
 for(const name of names.filter(n=>!n.endsWith('.json')))fail(name,'schema','prompts/에는 <단위>.json 파일만 둡니다.');
 for(const u of units.promptUnits)if(!names.includes(units.unitFile(u.unit)))fail(units.unitFile(u.unit),'missing','단위 파일이 없습니다. 모든 단위의 정본 파일이 있어야 등록할 수 있습니다.');
 return names.filter(n=>n.endsWith('.json')).map(n=>({name:n,chars:checkFile(n)}));
}
// 앱 빌드가 prompts/를 읽지 않는다(비제품 경로 판정의 전제). 해석은 D1의 불변 버전만 쓴다.
function checkNotImported(){
 const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='node_modules'?[]:walk(join(d,e.name))):/\.(?:ts|tsx|js|mjs|cjs)$/.test(e.name)?[join(d,e.name)]:[]);
 const importsPrompts=/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"][^'"]*\bprompts\//;
 for(const d of ['app','lib','server','components','hooks'].map(x=>join(root,x)).filter(existsSync))for(const file of walk(d))if(importsPrompts.test(readFileSync(file,'utf8')))fail(relative(root,file),'product_import','앱 소스가 prompts/를 import합니다. prompts/는 비제품 경로여야 합니다.');
}

const checked=checkDirectory();
checkNotImported();
for(const c of checked??[])if(typeof c.chars==='number')process.stdout.write(`ok   ${c.name.padEnd(28)} ${c.chars}자\n`);
if(failures.length){process.stderr.write(failures.join('\n')+`\n\n프롬프트 검사 실패 ${failures.length}건 (${relative(root,dir)||dir})\n`);process.exit(1)}
process.stdout.write(`\n프롬프트 검사 통과: ${checked.length}개 단위 (${relative(root,dir)||dir})\n`);
