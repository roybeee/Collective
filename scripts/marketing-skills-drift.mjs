// 마케팅 스킬 드리프트 검사(로컬 전용, P0). docs/marketing-skills/provenance.json의 파일별 sha256을 로컬 스킬 저장소의 지금 파일과 대조한다.
// 스킬 저장소(기본 ~/marketing-skills, 환경변수 MARKETING_SKILLS_DIR로 바꿀 수 있음)가 없으면(CI·Sites 빌드) 건너뛰고 0으로 끝난다.
// 네트워크·git을 쓰지 않는다. 파일을 쓰지 않는다. 출력은 경로·해시·규칙 id뿐이며 스킬 본문을 출력하지 않는다.
// 사용: node scripts/marketing-skills-drift.mjs [--json]
// 종료 코드: 0 = 같음 또는 건너뜀, 1 = 바뀐 파일이 있음(사전 규칙 재검토 필요), 2 = 출처 기록을 읽지 못함.
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=process.env.MARKETING_SKILLS_DIR||join(homedir(),'marketing-skills');
const asJson=process.argv.includes('--json');
const out=report=>{process.stdout.write((asJson?JSON.stringify(report):report.lines.join('\n'))+'\n')};

let prov;
try{prov=JSON.parse(readFileSync(join(root,'docs/marketing-skills/provenance.json'),'utf8'))}
catch(error){process.stderr.write(`출처 기록을 읽지 못했습니다: ${error.message}\n`);process.exit(2)}

if(!existsSync(dir)){
 out({status:'skipped',reason:'skill repo absent',lines:[`건너뜀: 스킬 저장소가 없습니다(${dir}). CI·빌드 환경에서는 정상입니다.`]});
 process.exit(0);
}
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const files=prov.files.map(f=>{
 const path=join(dir,f.path);
 if(!existsSync(path))return {path:f.path,status:'missing',rules:f.rules};
 const now=sha(path);
 return {path:f.path,status:now===f.sha256?'same':'changed',rules:f.rules,pinned:f.sha256,now};
});
const changed=files.filter(f=>f.status!=='same');
const lines=[`스킬 저장소 ${dir} · 고정 커밋 ${prov.commit.slice(0,7)}(${prov.tag}) · 사전 ${prov.lexiconVersion}`,
 ...files.map(f=>`${f.status==='same'?'같음':f.status==='missing'?'없음':'바뀜'}  ${f.path}${f.status==='same'?'':`  → 다시 볼 규칙: ${f.rules.join(', ')||'(없음)'}`}`),
 changed.length?`바뀐 파일 ${changed.length}개: 규칙을 다시 쓰고 provenance.json을 새 커밋·해시로 갱신한 뒤 사전 버전을 올리세요.`:'드리프트 없음.'];
out({status:changed.length?'drift':'same',commit:prov.commit,files,lines});
process.exit(changed.length?1:0);
