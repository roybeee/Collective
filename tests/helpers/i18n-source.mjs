// 화면 원문 검사용(GLOBAL-PLAN G6 2단계): 화면 파일의 t('키') 호출을 한국어 사전 값으로 되돌린 원문을 돌려준다.
// 문구를 사전(lib/i18n/ko.ts·ko-lazy.ts)으로 옮긴 화면에서도 기존 원문 검사(`includes('…')`)가 같은 한국어 문장을 확인하게 한다.
// - JSX 속성 `={t('k')}` → `="값"`, JSX 자식 `{t('k')}` → `값`, 그 밖의 `t('k')`·`t('k',{…})` → `'값'`(자리표시 {n}은 그대로).
// - 사전에 없는 키는 바꾸지 않는다(검사가 실패해 드러난다).
import {readFileSync} from 'node:fs';
const unquote=s=>s.replace(/\\(.)/g,(_,c)=>c==='n'?'\n':c);
let cache=null;
export function koDictionary(){
 if(cache)return cache;
 cache={};
 for(const f of ['lib/i18n/ko.ts','lib/i18n/ko-lazy.ts'])for(const m of readFileSync(f,'utf8').matchAll(/'([\w.]+)':'((?:[^'\\]|\\.)*)'/g))cache[m[1]]=unquote(m[2]);
 return cache;
}
/** 파일 원문에서 t('키')를 한국어 값으로 되돌린다. */
export function koSource(file){
 const ko=koDictionary(),has=k=>Object.hasOwn(ko,k);
 return readFileSync(file,'utf8')
  .replace(/=\{t\('([\w.]+)'\)\}/g,(w,k)=>has(k)&&!ko[k].includes('"')?`="${ko[k]}"`:w)
  .replace(/\{t\('([\w.]+)'\)\}/g,(w,k)=>has(k)?ko[k]:w)
  .replace(/\bt\('([\w.]+)'(?:,\{[^{}]*\})?\)/g,(w,k)=>has(k)?`'${ko[k]}'`:w);
}
