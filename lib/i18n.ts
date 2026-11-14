// 화면 언어(GLOBAL-PLAN G6 1단계): 한국어(기준·기본) · 영어 · 일본어. 외부 라이브러리 없이 사전 하나와 작은 저장소만 둔다(홈 첫 로딩 예산, tests/ux-budget.json homeJsGzKB).
// - 한국어 사전(lib/i18n/ko.ts, 홈이 그리는 문구)은 정적으로 싣고, 영어·일본어 사전은 그 언어를 고를 때만 내려받는다(동적 import).
//   열 때 내려받는 화면의 한국어(lib/i18n/ko-lazy.ts)는 그 화면이 lib/i18n/lazy.ts를 가져올 때 registerKorean으로 더해진다.
// - 없는 키는 한국어로 보이고 missingKeys()에 남는다(로그는 남기지 않는다). 테스트·개발 화면에서 빠진 번역을 찾는 데 쓴다.
// - 선택은 localStorage 'locale'에 남고 html[lang]을 바꾼다. 첫 그림 전 lang은 LOCALE_BOOT_SCRIPT가 맞춘다(app/layout.tsx).
// - React 구독(useT·useLocale)은 lib/i18n-react.ts에 있다. 이 파일은 서버·테스트 런타임에서도 읽힌다(window·localStorage가 없으면 한국어).
import {ko,type MessageKey} from './i18n/ko';
import {compact,dayLabel,money,setDisplayLocale,type DisplayLocale} from './format';
export type {MessageKey} from './i18n/ko';
export type Locale=DisplayLocale;
export const LOCALES:readonly Locale[]=['ko','en','ja'];
export const LOCALE_KEY='locale';
// 첫 그림 전에 html[lang]을 저장된 언어로 맞춘다. 고정 문자열이며 사용자 값이 없다. 저장소를 못 쓰면 한국어(서버 HTML의 lang="ko")로 둔다.
export const LOCALE_BOOT_SCRIPT=`(function(){try{var l=localStorage.getItem('${LOCALE_KEY}');if(l==='en'||l==='ja')document.documentElement.lang=l}catch(e){}})()`;
type Dictionary=Partial<Record<MessageKey,string>>;
type Vars=Record<string,string|number>;
export const isLocale=(value:unknown):value is Locale=>value==='ko'||value==='en'||value==='ja';
export const hasKey=(key:string):key is MessageKey=>Object.hasOwn(state.korean,key);
const loaders:Record<Exclude<Locale,'ko'>,()=>Promise<Dictionary>>={en:()=>import('./i18n/en').then(m=>m.en),ja:()=>import('./i18n/ja').then(m=>m.ja)};
const state={locale:'ko' as Locale,version:0,request:0,started:false,korean:{...ko} as Dictionary,dictionaries:{} as Partial<Record<Exclude<Locale,'ko'>,Dictionary>>,missing:new Set<string>()};
const listeners=new Set<()=>void>();
const notify=()=>{state.version++;listeners.forEach(l=>l())};
const fill=(text:string,vars?:Vars)=>vars?text.replace(/\{(\w+)\}/g,(whole,name:string)=>Object.hasOwn(vars,name)?String(vars[name]):whole):text;

/** 현재 언어의 문구. 없는 키는 한국어로 보이고 missingKeys()에 남는다. vars: '{name}' 자리를 채운다(없는 이름은 그대로 둔다). */
export function t(key:MessageKey,vars?:Vars):string{
 const own=state.locale==='ko'?undefined:state.dictionaries[state.locale]?.[key];
 if(own!==undefined)return fill(own,vars);
 const korean=state.korean[key];
 if(state.locale!=='ko'||korean===undefined)state.missing.add(`${state.locale}:${key}`);
 return fill(korean??key,vars);
}
/** 빠진 번역 목록('en:nav.overview' 형식). 화면 로그 대신 테스트·개발 도구가 읽는다. */
export const missingKeys=()=>[...state.missing].sort();
export const currentLocale=()=>state.locale;
/** 구독용 스냅샷: 언어나 사전이 바뀔 때마다 오른다(useSyncExternalStore). */
export const localeVersion=()=>state.version;
/** 영어·일본어 사전을 직접 넣는다(테스트, 또는 이미 받은 사전). 넣은 언어가 지금 언어면 다시 그린다. */
export function registerDictionary(locale:Exclude<Locale,'ko'>,dictionary:Dictionary){state.dictionaries={...state.dictionaries,[locale]:dictionary};if(locale===state.locale)notify()}
/** 열 때 내려받는 화면의 한국어 원본을 더한다(lib/i18n/lazy.ts). 같은 키는 덮지 않는다. */
export function registerKorean(section:Dictionary){state.korean={...section,...state.korean}}
function readStored():Locale{try{const v=typeof localStorage==='undefined'?null:localStorage.getItem(LOCALE_KEY);return isLocale(v)?v:'ko'}catch{return 'ko'}}
function applyLang(locale:Locale){if(typeof document!=='undefined')document.documentElement.lang=locale}
async function dictionaryFor(locale:Locale):Promise<Dictionary>{
 if(locale==='ko')return state.korean;
 const have=state.dictionaries[locale];if(have)return have;
 const loaded=await loaders[locale]();
 state.dictionaries={...state.dictionaries,[locale]:loaded};return loaded;
}
/** 언어를 바꾼다. 사전을 받은 뒤에 바꾸므로 반쯤 번역된 화면이 보이지 않는다. 늦게 끝난 이전 요청은 무시한다. 사전을 받지 못하면 false(지금 언어 유지). */
export async function setLocale(locale:Locale,{persist=true}:{persist?:boolean}={}):Promise<boolean>{
 if(!isLocale(locale))return false;
 const request=++state.request;
 try{await dictionaryFor(locale)}catch{if(request===state.request)applyLang(state.locale);return false}
 if(request!==state.request)return false;
 if(persist){try{localStorage.setItem(LOCALE_KEY,locale)}catch{/* 사생활 보호 모드 등: 이번 화면에만 적용 */}}
 applyLang(locale);
 if(state.locale!==locale){state.locale=locale;setDisplayLocale(locale);notify()}
 return true;
}
/** 저장된 언어로 시작한다(첫 구독 때 한 번). 한국어면 아무것도 내려받지 않는다. */
export function startLocale(){if(state.started)return;state.started=true;const stored=readStored();if(stored!=='ko')void setLocale(stored,{persist:false})}
// 다른 탭에서 바꾼 언어도 따른다.
export function subscribeLocale(listener:()=>void){
 startLocale();listeners.add(listener);
 const onStorage=(e:StorageEvent)=>{if(e.key===LOCALE_KEY)void setLocale(isLocale(e.newValue)?e.newValue:'ko',{persist:false})};
 if(typeof window!=='undefined')window.addEventListener('storage',onStorage);
 return()=>{listeners.delete(listener);if(typeof window!=='undefined')window.removeEventListener('storage',onStorage)};
}
// 지금 언어로 형식을 맞춘다(lib/format.ts의 언어 인자 버전). 한국어 결과는 기존 money()와 같다.
export const localMoney=(value:number|null|undefined)=>money(value,undefined,state.locale);
export const localCompact=(value:number|null|undefined)=>compact(value,state.locale);
export const localDay=(value:unknown)=>dayLabel(value,state.locale);
