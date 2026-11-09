// G5 GEO 자동 추적 — HERMES 관찰 지시·응답 검사(순수 모듈).
// 한 HERMES 실행은 (질문, 엔진) 한 쌍이다. 엔진의 공개 답변 화면 한 장을 브라우저로 열어 답변 앞 1,500자를 그대로 옮기고 인용 URL을 적는다.
// 응답은 정해진 JSON 하나여야 한다. 모르는 키·빠진 키·형식 오류·자기모순(발췌에 브랜드가 있는데 미언급 등)은 오류이며 부분 결과를 만들지 않는다.
// 로그인이 필요한 화면은 status login_required로만 받는다(자동 로그인 금지, 답변을 추측하지 않는다).
// brandCited·첫 언급 순서는 HERMES가 보고하지 않고 여기서 인용 URL·발췌로 계산한다(공식 URL 도메인·경로 일치).
import type {GeoEngine} from './geo-questions';

export const GEO_OBSERVATION_SCHEMA='geo-observation-1';
export const GEO_EXCERPT_MAX=1500,GEO_CITATIONS_MAX=20,GEO_NOTE_MAX=300;
export const GEO_STATUSES=['observed','login_required','unavailable'] as const;
export type GeoObservationStatus=typeof GEO_STATUSES[number];
export type GeoTarget={brandName:string;officialUrls:string[];competitors:string[]};
export type GeoCitation={url:string;title:string;domain:string;brand:boolean};
export type GeoParsed={status:GeoObservationStatus;observedAt:string;pageUrl:string;answerExcerpt:string;citations:GeoCitation[];brandMentioned:boolean|null;brandCited:boolean|null;firstMentionRank:number|null;competitorsMentioned:string[];note:string};
// 저장 행(kind geo_observation, 부모 브랜드). 발췌·인용·시각은 HERMES 브라우저 관찰의 기록이며 노출 보장이 아니다.
export type GeoObservation=GeoParsed&{id:string;brandId:string;questionId:string;questionText:string;locale:string;engine:GeoEngine;source:'hermes';runId:string;jobId:string;providerRunId:string;recordedAt:string};

// 엔진별 공개 답변 화면. 질문을 주소에 싣는 엔진은 그 주소를, 아니면 첫 화면에서 질문을 입력한다.
export const GEO_ENGINE_PAGES:Record<GeoEngine,{label:string;page:(q:string)=>string;how:string}>={
 chatgpt:{label:'ChatGPT',page:q=>'https://chatgpt.com/?q='+encodeURIComponent(q)+'&hints=search',how:'웹 검색 답변'},
 perplexity:{label:'Perplexity',page:q=>'https://www.perplexity.ai/search?q='+encodeURIComponent(q),how:'검색 답변'},
 gemini:{label:'Gemini',page:()=>'https://gemini.google.com/app',how:'첫 화면에 질문을 한 번 입력한 답변'},
 google_ai_overview:{label:'Google AI 개요',page:q=>'https://www.google.com/search?hl=ko&q='+encodeURIComponent(q),how:'검색 결과 위 AI 개요 블록(없으면 unavailable)'},
 naver:{label:'네이버 검색',page:q=>'https://search.naver.com/search.naver?query='+encodeURIComponent(q),how:'검색 결과 위 AI 브리핑·답변 블록(없으면 unavailable)'},
};

const norm=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,'');
export const mentions=(text:string,name:string)=>!!norm(name)&&norm(text).includes(norm(name));

// 공식 URL 하나를 비교 규칙으로 바꾼다. 경로가 있는 주소(플레이스·SNS 계정)는 같은 호스트+경로 접두어, 경로가 없으면 호스트(하위 도메인 포함)로 맞춘다.
type Matcher={host:string;path:string};
const hostOf=(h:string)=>h.toLowerCase().replace(/^www\./,'').replace(/^m\./,'');
export function officialMatchers(urls:readonly string[]):Matcher[]{
 const out:Matcher[]=[];
 for(const raw of urls){
  let u:URL;try{u=new URL(raw.trim())}catch{continue}
  if(u.protocol!=='https:'&&u.protocol!=='http:')continue;
  const path=u.pathname.replace(/\/+$/,'');
  out.push({host:hostOf(u.hostname),path});
 }
 return out.filter((m,i)=>out.findIndex(x=>x.host===m.host&&x.path===m.path)===i);
}
export function isOfficialUrl(url:string,matchers:readonly Matcher[]):boolean{
 let u:URL;try{u=new URL(url)}catch{return false}
 const host=hostOf(u.hostname),path=u.pathname.replace(/\/+$/,'');
 return matchers.some(m=>m.path?host===m.host&&(path===m.path||path.startsWith(m.path+'/')):host===m.host||host.endsWith('.'+m.host));
}
export const domainOf=(url:string)=>{try{return hostOf(new URL(url).hostname)}catch{return ''}};
// 첫 언급 순서: 발췌에서 브랜드가 처음 나온 위치보다 먼저 나온 경쟁 브랜드 수 + 1. 발췌에 브랜드가 없으면 null(발췌 밖 언급은 순서를 모른다).
export function firstMentionRank(excerpt:string,brandName:string,competitors:readonly string[]):number|null{
 const text=norm(excerpt),at=text.indexOf(norm(brandName));
 if(!norm(brandName)||at<0)return null;
 return 1+competitors.filter(c=>{const i=norm(c)?text.indexOf(norm(c)):-1;return i>=0&&i<at}).length;
}

// HERMES 지시. 입력은 질문·엔진·브랜드 이름·경쟁 브랜드 이름 목록(사실 원문·고객 정보 없음)이다.
export function geoSubmission(target:GeoTarget,question:string,engine:GeoEngine){
 const page=GEO_ENGINE_PAGES[engine];
 const instructions=[
  '당신은 AI 검색 노출 관찰자입니다. 아래 한 화면만 브라우저로 열어 보이는 그대로 기록합니다.',
  `1) ${page.label} 공개 화면(${page.how})을 엽니다: ${page.page(question)}`,
  '2) 질문 문장을 바꾸지 않습니다. 다른 화면·다른 질문·추가 검색은 하지 않습니다. 같은 화면 안 새로고침도 하지 않습니다.',
  '3) 로그인·본인확인·캡차 화면이 나오면 로그인하지 말고 status를 login_required로 적고 끝냅니다. 답변 블록이 없거나 열리지 않으면 unavailable입니다.',
  `4) observed면 답변 본문 앞 ${GEO_EXCERPT_MAX}자를 요약·번역 없이 그대로 answerExcerpt에 옮깁니다. 답변이 인용한 출처 링크(최대 ${GEO_CITATIONS_MAX}개, 화면 순서)를 citations에 적습니다.`,
  '5) brandMentioned: 답변 본문에 브랜드 이름이 나오면 true. competitorsMentioned: 아래 경쟁 브랜드 목록 중 답변에 나온 이름만 목록의 글자 그대로 적습니다(목록에 없는 이름은 적지 않습니다).',
  '6) 화면에 없는 내용을 추측하거나 지어내지 않습니다. 확인하지 못한 값은 status로 표시합니다.',
  `7) 다른 글 없이 JSON 객체 하나만 답합니다. 키는 정확히 schema("${GEO_OBSERVATION_SCHEMA}"), engine, question, status(observed|login_required|unavailable), observedAt(ISO 8601), pageUrl(연 화면 https 주소), answerExcerpt, citations([{url,title}]), brandMentioned(true|false, observed가 아니면 null), competitorsMentioned(배열), note(${GEO_NOTE_MAX}자 이하, 없으면 "")입니다. observed가 아니면 answerExcerpt는 "", citations는 []입니다.`,
 ].join('\n');
 const input=JSON.stringify({engine,question,brandName:target.brandName,competitors:target.competitors});
 return {input,instructions};
}

export class GeoResponseError extends Error{constructor(message:string){super(message);this.name='GeoResponseError'}}
const bad=(m:string):never=>{throw new GeoResponseError(m)};
const KEYS=['schema','engine','question','status','observedAt','pageUrl','answerExcerpt','citations','brandMentioned','competitorsMentioned','note'];
const controlChars=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const webUrl=(v:unknown,label:string)=>{if(typeof v!=='string'||v.length>2048)bad(`${label} 형식이 올바르지 않습니다.`);let u:URL;try{u=new URL(v as string)}catch{return bad(`${label} 형식이 올바르지 않습니다.`)}if((u.protocol!=='https:'&&u.protocol!=='http:')||u.username||u.password)bad(`${label}은(는) 인증정보 없는 웹 주소여야 합니다.`);return u.toString()};
function extractJson(text:string):unknown{
 const t=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
 const start=t.indexOf('{'),end=t.lastIndexOf('}');
 if(start<0||end<start)bad('JSON 객체가 없습니다.');
 try{return JSON.parse(t.slice(start,end+1))}catch{return bad('JSON 형식이 아닙니다.')}
}
export type GeoParseContext={engine:GeoEngine;question:string;target:GeoTarget;notBefore:number;now:number};
export function parseGeoResponse(text:unknown,ctx:GeoParseContext):GeoParsed{
 if(typeof text!=='string'||!text.trim())bad('응답이 비었습니다.');
 const v=extractJson(text as string);
 if(!v||typeof v!=='object'||Array.isArray(v))bad('응답이 JSON 객체가 아닙니다.');
 const r=v as Record<string,unknown>;
 const extra=Object.keys(r).filter(k=>!KEYS.includes(k)),missing=KEYS.filter(k=>k!=='note'&&!(k in r));
 if(extra.length)bad(`정해지지 않은 키가 있습니다: ${extra.slice(0,5).join(', ')}`);
 if(missing.length)bad(`필수 키가 빠졌습니다: ${missing.join(', ')}`);
 if(r.schema!==GEO_OBSERVATION_SCHEMA)bad('schema 값이 다릅니다.');
 if(r.engine!==ctx.engine)bad('요청한 엔진과 응답 엔진이 다릅니다.');
 if(typeof r.question!=='string'||r.question.replace(/\s+/g,' ').trim()!==ctx.question.replace(/\s+/g,' ').trim())bad('요청한 질문과 응답 질문이 다릅니다.');
 if(!GEO_STATUSES.includes(r.status as GeoObservationStatus))bad('status는 observed·login_required·unavailable 중 하나입니다.');
 const status=r.status as GeoObservationStatus;
 const at=typeof r.observedAt==='string'?Date.parse(r.observedAt):NaN;
 if(!Number.isFinite(at)||at<ctx.notBefore-5*60000||at>ctx.now+60000)bad('observedAt이 실행 시간 범위 밖이거나 형식이 다릅니다.');
 const note=r.note===undefined?'':typeof r.note==='string'&&r.note.length<=GEO_NOTE_MAX&&!controlChars.test(r.note)?r.note.trim():bad('note 형식이 올바르지 않습니다.');
 if(!Array.isArray(r.citations)||!Array.isArray(r.competitorsMentioned))bad('citations·competitorsMentioned는 배열입니다.');
 const base={status,observedAt:new Date(at).toISOString(),note};
 if(status!=='observed'){
  if(r.answerExcerpt!==''||(r.citations as unknown[]).length||(r.competitorsMentioned as unknown[]).length||r.brandMentioned!==null)bad('관찰하지 못한 응답에는 발췌·인용·언급 값을 넣지 않습니다.');
  const pageUrl=r.pageUrl===''?'':webUrl(r.pageUrl,'pageUrl');
  return {...base,pageUrl,answerExcerpt:'',citations:[],brandMentioned:null,brandCited:null,firstMentionRank:null,competitorsMentioned:[]};
 }
 const pageUrl=webUrl(r.pageUrl,'pageUrl');
 if(typeof r.answerExcerpt!=='string'||!r.answerExcerpt.trim()||r.answerExcerpt.length>GEO_EXCERPT_MAX||controlChars.test(r.answerExcerpt))bad(`answerExcerpt는 1~${GEO_EXCERPT_MAX}자 원문입니다.`);
 if(typeof r.brandMentioned!=='boolean')bad('brandMentioned는 true 또는 false입니다.');
 const excerpt=r.answerExcerpt as string,matchers=officialMatchers(ctx.target.officialUrls);
 const rawCitations=r.citations as unknown[];
 if(rawCitations.length>GEO_CITATIONS_MAX)bad(`인용은 최대 ${GEO_CITATIONS_MAX}개입니다.`);
 const citations=rawCitations.map((c,i)=>{
  if(!c||typeof c!=='object'||Array.isArray(c))bad(`citations[${i}]는 객체입니다.`);
  const o=c as Record<string,unknown>,keys=Object.keys(o);
  if(keys.some(k=>k!=='url'&&k!=='title')||!('url' in o))bad(`citations[${i}]는 url·title만 가집니다.`);
  const url=webUrl(o.url,`citations[${i}].url`),title=o.title===undefined?'':typeof o.title==='string'&&o.title.length<=300&&!controlChars.test(o.title)?o.title.trim():bad(`citations[${i}].title 형식이 올바르지 않습니다.`);
  return {url,title,domain:domainOf(url),brand:isOfficialUrl(url,matchers)};
 });
 const list=ctx.target.competitors,names=(r.competitorsMentioned as unknown[]).map((n,i)=>{
  const hit=typeof n==='string'?list.find(c=>norm(c)===norm(n)):undefined;
  return hit??bad(`competitorsMentioned[${i}]가 경쟁 브랜드 목록에 없습니다.`);
 });
 if(r.brandMentioned===false&&mentions(excerpt,ctx.target.brandName))bad('발췌에 브랜드 이름이 있는데 brandMentioned가 false입니다.');
 return {...base,pageUrl,answerExcerpt:excerpt,citations,brandMentioned:r.brandMentioned as boolean,brandCited:citations.some(c=>c.brand),firstMentionRank:firstMentionRank(excerpt,ctx.target.brandName,list),competitorsMentioned:[...new Set(names)]};
}
// 공식 URL·경쟁 브랜드 목록. 브랜드 웹사이트·SNS 링크와 확정 사실 값 안의 웹 주소(공식 계정·플레이스 주소 등)만 쓴다.
export function geoTarget(brand:{name:string;intake?:{website?:string;socialLinks?:string;competitors?:string}},factValues:readonly string[]):GeoTarget{
 const urls=[brand.intake?.website??'',brand.intake?.socialLinks??'',...factValues].flatMap(t=>t.match(/https?:\/\/[^\s,<>"']+/g)??[]);
 const competitors=(brand.intake?.competitors??'').split(/[,\n·/|]/).map(x=>x.replace(/\s+/g,' ').trim()).filter(x=>x.length>=2&&x.length<=40&&!/https?:/.test(x));
 return {brandName:brand.name.trim(),officialUrls:[...new Set(urls)].slice(0,20),competitors:[...new Set(competitors)].slice(0,15)};
}
