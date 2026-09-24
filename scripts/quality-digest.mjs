// B2 주간 다이제스트 로컬 실행. 서버와 같은 순수 모듈(lib/quality-console.ts·lib/quality-kappa.ts·lib/quality-digest.ts)로 한국어 마크다운을 표준 출력에 낸다.
// 네트워크를 쓰지 않는다(fetch를 막고, 모듈은 console만 있는 vm 컨텍스트에서 돈다). 파일을 쓰지 않는다. 형식·운영 절차는 docs/QUALITY-CONSOLE.ko.md.
// 사용:
//  node scripts/quality-digest.mjs <응답.json>                                      GET /api/quality-console?week=YYYY-Www 응답 {week,summary,previous,kappa}. 주는 응답의 week다(--week가 다르면 종료 코드 2)
//  node scripts/quality-digest.mjs <레코드.json> [--week YYYY-Www]                   레코드 원본 {artifacts,decisions,usage,meetings,gradings,history?,jobs?}
//  node scripts/quality-digest.mjs --sqlite <로컬 D1 .sqlite> [--owner <워크스페이스>] [--week YYYY-Www]
// --week를 빼면 지난주(이번 주 바로 앞 ISO 주, 한국 시간)다. 잘못된 인자·입력은 종료 코드 2다.
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

if(typeof vm.SourceTextModule!=='function'){
 const child=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',fileURLToPath(import.meta.url),...process.argv.slice(2)],{stdio:'inherit'});
 process.exit(child.status??1);
}
globalThis.fetch=()=>{throw new Error('quality-digest.mjs는 네트워크를 쓰지 않습니다.')};
const die=message=>{process.stderr.write(message+'\n');process.exit(2)};
const USAGE='사용법: node scripts/quality-digest.mjs <응답.json | 레코드.json> [--week YYYY-Www]\n       node scripts/quality-digest.mjs --sqlite <로컬 D1 .sqlite> [--owner <워크스페이스>] [--week YYYY-Www]';
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);if(i<0)return undefined;const v=args[i+1];if(!v||v.startsWith('--'))die(`${name} 값이 없습니다.\n${USAGE}`);return v};
const sqlite=option('--sqlite'),owner=option('--owner'),weekArg=option('--week');
const file=args.find((a,i)=>!a.startsWith('--')&&!['--sqlite','--owner','--week'].includes(args[i-1]));
if(!sqlite&&!file)die(USAGE);

const {pureLoader}=await import('./eval/load-ts.mjs');
const load=pureLoader(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
const qc=await load('lib/quality-console.ts'),qd=await load('lib/quality-digest.ts');
const weekOf=()=>{
 const week=weekArg??qc.previousWeek(qc.isoWeekOf(new Date().toISOString()));
 if(!qc.weekRange(week))die(`주(YYYY-Www)를 확인하세요: ${week}`);
 return week;
};
const KINDS={artifact:'artifacts',history:'history',review_decision:'decisions',provider_usage:'usage',team_meeting:'meetings',grading:'gradings'};
// 로컬 D1(wrangler 상태의 sqlite 파일)을 읽기 전용으로 연다. 한 워크스페이스(owner) 행만 쓰고 판정은 기록 순서(rowid)다.
async function fromSqlite(path){
 const {DatabaseSync}=await import('node:sqlite');
 let db;try{db=new DatabaseSync(path,{readOnly:true})}catch{die(`sqlite 파일을 열 수 없습니다: ${path}`)}
 try{
  const owners=db.prepare(`SELECT DISTINCT owner FROM records WHERE kind IN (${Object.keys(KINDS).map(()=>'?').join(',')})`).all(...Object.keys(KINDS)).map(r=>r.owner);
  const who=owner??(owners.length===1?owners[0]:die(owners.length?`워크스페이스가 여러 개입니다. --owner로 고르세요: ${owners.join(', ')}`:'집계할 레코드가 없습니다.'));
  const input={artifacts:[],history:[],decisions:[],usage:[],meetings:[],gradings:[]};
  for(const r of db.prepare(`SELECT kind,data FROM records WHERE owner=? AND kind IN (${Object.keys(KINDS).map(()=>'?').join(',')}) ORDER BY rowid`).iterate(who,...Object.keys(KINDS)))input[KINDS[r.kind]].push(JSON.parse(r.data));
  return {...input,jobs:db.prepare('SELECT id,role,provider_id FROM jobs WHERE owner=?').all(who).map(j=>({...j}))};
 }catch(error){return die(`로컬 D1을 읽지 못했습니다: ${error.message}`)}finally{db.close()}
}
function fromFile(path){
 let json;try{json=JSON.parse(readFileSync(resolve(path),'utf8'))}catch{die(`입력 JSON 파일을 읽을 수 없습니다: ${path}`)}
 const body=json?.digest??json;
 if(body&&typeof body==='object'&&body.summary&&Array.isArray(body.kappa)){
  // 응답은 이미 그 주로 계산한 요약이다. 머리말의 주도 응답의 week를 쓰고, 다른 --week로 덮어쓰지 않는다(기간·수치와 주 이름이 어긋난다).
  if(weekArg&&body.week&&weekArg!==body.week)die(`--week ${weekArg}가 응답 JSON의 주 ${body.week}와 다릅니다. 그 주의 응답(GET /api/quality-console?week=${weekArg})을 받아 넣거나 --week를 빼세요.`);
  const week=body.week??weekArg??qc.isoWeekOf(body.summary.from);
  if(!qc.weekRange(week))die(`주(YYYY-Www)를 확인하세요: ${week}`);
  return qd.digestMarkdown({week,summary:body.summary,previous:body.previous??null,kappa:body.kappa,campaignId:body.campaignId??null,partial:body.partial??null});
 }
 if(body&&['artifacts','decisions','usage','meetings','gradings'].every(k=>Array.isArray(body[k])))return qd.digestMarkdown(qd.weeklyPayload(body,weekOf()));
 return die('입력 형식을 알 수 없습니다. 응답 {week,summary,previous,kappa} 또는 레코드 {artifacts,decisions,usage,meetings,gradings,jobs?}를 넣으세요.');
}
const markdown=sqlite?qd.digestMarkdown(qd.weeklyPayload(await fromSqlite(sqlite),weekOf())):fromFile(file);
process.stdout.write(markdown);
