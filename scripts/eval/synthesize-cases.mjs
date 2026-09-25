// 합성 평가 케이스 생성기 CLI(G4). 스펙 하나 → import_cases 본문 JSON 하나. 운영 D1·HERMES는 부르지 않는다(외부 네트워크 0회).
// 사용: node --experimental-vm-modules scripts/eval/synthesize-cases.mjs --spec <스펙.json> --out <출력.json>
// 저장소 루트에서, 운영에 게시된 커밋을 체크아웃한 깨끗한 작업 트리에서 실행한다. 가져오기(import_cases)는 생성 트리(generator.tree)가 운영 앱 트리와 다르면 거부한다.
// 봉인(sealed) 스펙과 그 출력은 저장소 밖에 둔다(프롬프트를 고치는 작업 트리에서 보이지 않게). 출력에는 합성 데이터만 담긴다.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {synthesizeCases} from './synthesize.mjs';

const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined};
const specPath=arg('--spec'),out=arg('--out');
if(!specPath||!out){process.stderr.write('사용법: --spec <스펙.json> --out <출력.json>\n');process.exit(2)}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
// 작업 트리에 커밋하지 않은 변경이 있으면 트리 신원을 주장하지 않는다(dirty). 가져오기가 거부한다.
const dirty=git('status','--porcelain','--untracked-files=no').length>0;
const generator={commit:git('rev-parse','HEAD'),tree:dirty?'dirty':git('rev-parse','HEAD^{tree}')};
const result=await synthesizeCases(JSON.parse(readFileSync(specPath,'utf8')),{generator});
writeFileSync(out,JSON.stringify(result,null,1)+'\n');
process.stdout.write(JSON.stringify({specId:result.specId,cases:result.cases.length,tree:generator.tree,out})+'\n');
