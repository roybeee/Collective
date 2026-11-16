// 규정 점검 회귀 오라클·정상 묶음 측정에 쓰는 로컬 말뭉치(사전 .16, 마케팅 묶음 mkt). 네트워크·모델 호출 없음.
// ① tests/*.mjs 안의 한글 문자열 리터럴(12자 이상) ② scripts/eval/specs/*.json 합성 케이스의 작업물 본문. 둘 다 저장소에 이미 있는 합성 글이다.
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

const HANGUL=/[가-힣]/;
const LITERAL=/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;
const unescape=s=>s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g,(m,c)=>c==='n'?'\n':c==='t'?'\t':c.length>1&&c[0]==='u'?String.fromCodePoint(parseInt(c.replace(/[u{}]/g,''),16)):c);
export const textKey=text=>createHash('sha256').update(text).digest('hex').slice(0,24);

export function testLiteralTexts(dir='tests'){
 const files=readdirSync(dir).filter(f=>f.endsWith('.mjs')).sort();
 const out=new Map();
 for(const f of files)for(const m of readFileSync(`${dir}/${f}`,'utf8').matchAll(LITERAL)){
  const raw=m[1]??m[2]??m[3]??'';
  if(raw.length<12||!HANGUL.test(raw))continue;
  const text=unescape(raw);
  if(!out.has(text))out.set(text,f);
 }
 return [...out].map(([text,file])=>({source:`test:${file}`,text}));
}
export function specArtifactTexts(dir='scripts/eval/specs'){
 return readdirSync(dir).filter(f=>f.endsWith('.json')).sort().flatMap(f=>{
  const spec=JSON.parse(readFileSync(`${dir}/${f}`,'utf8'));
  return (spec.records||[]).filter(r=>r.kind==='artifact'&&typeof r.data?.content==='string').map(r=>({source:`spec:${f}:${r.id}`,text:r.data.content}));
 });
}
export const corpus=()=>[...testLiteralTexts(),...specArtifactTexts()];
