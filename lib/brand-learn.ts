// 브랜드 자동 학습(에픽 G1) 순수 추출기: 가져온 HTML 문자열(브랜드 사이트·네이버 플레이스 공개 페이지·Instagram 공개 페이지)에서
// 이름·로고·색·소개·주소·전화·영업시간·메뉴 가격·공식 계정·말투 신호를 '후보'로 뽑는다. 모델 호출·네트워크 없음, 같은 입력은 같은 결과(결정적).
// 결과는 모두 미확인 후보다. 확정은 사람이 사실 원장에서 한다(lib/brand-facts-server.ts saveBrandFact). 가져오기는 lib/brand-learn-server.ts가 한다.
// 필드마다 출처(source)와 신뢰(confidence)를 남긴다: og(Open Graph)·meta(meta 태그)·css(스타일 색)·text(본문 패턴)·link(앵커 주소).
export type LearnSource='og'|'meta'|'css'|'text'|'link';
export type LearnConfidence='strong'|'weak';
export type Learned<T=string>={value:T;source:LearnSource;confidence:LearnConfidence};
export type ColorCandidate={hex:string;count:number;source:'css'|'meta'};
export type VoiceStyle='해요체'|'합니다체'|'혼합'|'미확인';
// 문장 끝 어미 비율·이모지 밀도(100자당)·느낌표 문장 비율. 말투 원장(lib/brand-voice.ts)의 초안 참고용 신호이며 확정 말투가 아니다.
export type VoiceSignals={sentences:number;haeyo:number;hapnida:number;haeyoRatio:number|null;emojiPer100Chars:number;exclamationRatio:number;style:VoiceStyle};
export type BrandLearnResult={
 name?:Learned;logo?:Learned;tagline?:Learned;
 colors:ColorCandidate[];
 address:Learned[];phone:Learned[];hours:Learned[];menu:Learned[];social:Learned[];
 voice:VoiceSignals;textChars:number;
};
// 처리 상한: HTML 2MB, 본문 패턴 후보 각 20개, 색 후보 5개, 공식 계정 10개.
export const BRAND_LEARN_LIMITS={html:2_000_000,items:20,colors:5,social:10,line:160} as const;
const SOCIAL_HOSTS=['instagram.com','youtube.com','youtu.be','tiktok.com','facebook.com','x.com','twitter.com','threads.net','blog.naver.com','smartstore.naver.com','brand.naver.com','place.naver.com','map.naver.com','naver.me','pf.kakao.com','band.us','linktr.ee'];
// 흔한 배경·글자색은 브랜드 색 후보에서 뺀다(흰·검정·투명).
const NOT_BRAND_COLORS=new Set(['#ffffff','#000000']);

const ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'"};
export function decodeEntities(s:string){
 return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,code:string)=>{
  const key=code.toLowerCase();
  if(key in ENTITIES)return ENTITIES[key];
  if(key.startsWith('#x'))return safeChar(parseInt(key.slice(2),16),m);
  if(key.startsWith('#'))return safeChar(parseInt(key.slice(1),10),m);
  return m;
 });
}
const safeChar=(n:number,fallback:string)=>Number.isFinite(n)&&n>0&&n<0x110000?String.fromCodePoint(n):fallback;
// 태그 속성 읽기: name="v" · name='v' · name=v. 이름은 소문자로 맞춘다.
export function tagAttrs(tag:string):Record<string,string>{
 const out:Record<string,string>={};
 for(const m of tag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g))out[m[1].toLowerCase()]=decodeEntities(m[2]??m[3]??m[4]??'').trim();
 return out;
}
const tags=(html:string,name:string)=>[...html.matchAll(new RegExp(`<${name}\\b[^>]*>`,'gi'))].map(m=>tagAttrs(m[0]));
const metaValue=(metas:Record<string,string>[],key:string)=>metas.find(a=>(a.property===key||a.name===key)&&a.content)?.content;
const clip=(s:string,n:number)=>s.replace(/\s+/g,' ').trim().slice(0,n);
const resolveUrl=(raw:string,base?:string)=>{try{const u=new URL(raw,base);return /^https?:$/.test(u.protocol)?u.href:''}catch{return ''}};

// 색 정규화: #rgb·#rrggbb·rgb()/rgba() → #rrggbb 소문자. 알파·퍼센트 표기는 버린다.
export function normalizeColor(raw:string):string|null{
 const s=raw.trim().toLowerCase();
 const hex=/^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
 if(hex)return '#'+(hex[1].length===3?[...hex[1]].map(c=>c+c).join(''):hex[1]);
 const rgb=/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s);
 if(!rgb)return null;
 const parts=rgb.slice(1,4).map(Number);
 return parts.every(n=>n<=255)?'#'+parts.map(n=>n.toString(16).padStart(2,'0')).join(''):null;
}
function cssColors(html:string,themeColor:string|undefined):ColorCandidate[]{
 const styleText=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n')+'\n'+[...html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(m=>m[1]??m[2]??'').join('\n');
 const counts=new Map<string,number>();
 for(const m of styleText.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]{5,40}\)/g)){const hex=normalizeColor(m[0]);if(hex&&!NOT_BRAND_COLORS.has(hex))counts.set(hex,(counts.get(hex)??0)+1)}
 const fromCss:ColorCandidate[]=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([hex,count])=>({hex,count,source:'css' as const}));
 const theme=themeColor?normalizeColor(themeColor):null;
 const withTheme=theme&&!NOT_BRAND_COLORS.has(theme)?[{hex:theme,count:(counts.get(theme)??0)+1,source:'meta' as const},...fromCss.filter(c=>c.hex!==theme)]:fromCss;
 return withTheme.slice(0,BRAND_LEARN_LIMITS.colors);
}
// 본문 줄: 블록 태그 경계를 줄바꿈으로 바꾸고 script·style·주석을 뺀 뒤 태그를 지운다.
export function textLines(html:string):string[]{
 const stripped=html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
  .replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|li|h[1-6]|tr|td|th|section|article|header|footer|dt|dd|blockquote|figcaption)>/gi,'\n').replace(/<[^>]+>/g,' ');
 return decodeEntities(stripped).split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
}
const ADDRESS=/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|도)?\s?(?:[가-힣]{1,10}(?:시|구|군)\s?){1,2}(?:[가-힣]{1,10}(?:읍|면|동|가)\s?)?[가-힣\d]{1,20}(?:로|길|대로)\s?\d{1,4}(?:-\d{1,4})?(?:번길\s?\d{1,4})?(?:[ ,]{0,2}(?:\d{1,3}층|\d{1,4}호|[가-힣A-Za-z\d]{1,6}동(?!\s?\d)))*/g;
// 지역번호(02·031)·휴대전화(010)·안심번호(0507) 형식. 구분자는 -·.·빈칸이거나 없다.
const PHONE=/(?<!\d)0\d{1,3}[-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/g;
const HOURS=/\d{1,2}\s?:\s?\d{2}\s?[~\-–]\s?\d{1,2}\s?:\s?\d{2}/;
const PRICE=/\d{1,3}(?:,\d{3})+\s?원|\d{4,7}\s?원|\d+(?:\.\d+)?\s?만\s?원/;
const unique=<T>(xs:T[])=>[...new Set(xs)];
function patternLines(lines:string[],re:RegExp,source:LearnSource='text'):Learned[]{
 return unique(lines.filter(l=>re.test(l)).map(l=>clip(l,BRAND_LEARN_LIMITS.line))).slice(0,BRAND_LEARN_LIMITS.items).map(value=>({value,source,confidence:'weak' as const}));
}
function socialLinks(html:string,base?:string):Learned[]{
 const hrefs=tags(html,'a').map(a=>a.href||'').filter(Boolean).map(h=>resolveUrl(h,base)).filter(Boolean);
 const official=hrefs.map(h=>{try{const u=new URL(h);if(!SOCIAL_HOSTS.some(host=>u.hostname===host||u.hostname.endsWith('.'+host)))return '';u.search='';u.hash='';return u.href}catch{return ''}}).filter(Boolean);
 return unique(official).slice(0,BRAND_LEARN_LIMITS.social).map(value=>({value,source:'link' as const,confidence:'weak' as const}));
}
// 해요체는 '…요/…죠', 합니다체(합쇼체)는 '…니다/…니까'로 끝난다(바랍니다·드립니다 포함).
const HAEYO=/(?:요|죠)$/;
const HAPNIDA=/(?:니다|니까)$/;
const EMOJI=/\p{Extended_Pictographic}/gu;
// 문장 끝의 문장 부호·이모지·변형 선택자를 떼고 어미만 본다('가능해요 😊'도 해요체).
const TAIL=/[\s.!?~…,)\]}"'\u{FE0F}\p{Extended_Pictographic}]+$/u;
export function voiceSignals(lines:string[]):VoiceSignals{
 const text=lines.join('\n');
 const sentences=text.split(/(?<=[.!?。…])\s+|\n/).map(s=>s.trim()).filter(s=>s.length>=4);
 const stems=sentences.map(s=>s.replace(TAIL,''));
 const haeyo=stems.filter(s=>HAEYO.test(s)).length,hapnida=stems.filter(s=>HAPNIDA.test(s)).length,ending=haeyo+hapnida;
 const chars=text.replace(/\s/g,'').length,emoji=(text.match(EMOJI)||[]).length;
 const exclaim=sentences.filter(s=>/!\s*$/.test(s)).length;
 const style:VoiceStyle=ending<3?'미확인':haeyo>=hapnida*1.5?'해요체':hapnida>=haeyo*1.5?'합니다체':'혼합';
 return {sentences:sentences.length,haeyo,hapnida,haeyoRatio:ending?Math.round(haeyo/ending*100)/100:null,emojiPer100Chars:chars?Math.round(emoji/chars*10000)/100:0,exclamationRatio:sentences.length?Math.round(exclaim/sentences.length*100)/100:0,style};
}
// 페이지 제목에서 사이트 구분 접미(' | 사이트명', ' - 사이트명', ' : 네이버 플레이스')를 뗀다.
const titleCore=(t:string)=>clip(t,120).split(/\s[|\-–:]\s/)[0].trim();
export function learnBrandFromHtml(rawHtml:string,baseUrl?:string):BrandLearnResult{
 const html=String(rawHtml??'').slice(0,BRAND_LEARN_LIMITS.html);
 const metas=tags(html,'meta'),links=tags(html,'link');
 const title=/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
 const siteName=metaValue(metas,'og:site_name'),ogTitle=metaValue(metas,'og:title');
 const name:Learned|undefined=siteName?{value:clip(siteName,100),source:'og',confidence:'strong'}:ogTitle?{value:titleCore(decodeEntities(ogTitle)),source:'og',confidence:'weak'}:title&&titleCore(decodeEntities(title))?{value:titleCore(decodeEntities(title)),source:'meta',confidence:'weak'}:undefined;
 const ogImage=metaValue(metas,'og:image'),icon=links.find(l=>/(^|\s)(apple-touch-icon|icon)(\s|$)/i.test(l.rel||'')&&l.href)?.href;
 const logoUrl=ogImage?resolveUrl(ogImage,baseUrl):'',iconUrl=icon?resolveUrl(icon,baseUrl):'';
 const logo:Learned|undefined=logoUrl?{value:logoUrl,source:'og',confidence:'strong'}:iconUrl?{value:iconUrl,source:'meta',confidence:'weak'}:undefined;
 const description=metaValue(metas,'description'),ogDescription=metaValue(metas,'og:description');
 const tagline:Learned|undefined=description?{value:clip(description,300),source:'meta',confidence:'strong'}:ogDescription?{value:clip(ogDescription,300),source:'og',confidence:'weak'}:undefined;
 const lines=textLines(html);
 const addressHits=unique(lines.flatMap(l=>l.match(ADDRESS)||[]).map(a=>clip(a,BRAND_LEARN_LIMITS.line))).slice(0,BRAND_LEARN_LIMITS.items);
 const phoneHits=unique(lines.flatMap(l=>l.match(PHONE)||[]).map(p=>p.replace(/[. ]/g,'-').replace(/^(0\d{1,3})(\d{3,4})(\d{4})$/,'$1-$2-$3'))).slice(0,BRAND_LEARN_LIMITS.items);
 return {
  ...(name?{name}:{}),...(logo?{logo}:{}),...(tagline?{tagline}:{}),
  colors:cssColors(html,metaValue(metas,'theme-color')),
  address:addressHits.map((value,i)=>({value,source:'text' as const,confidence:i===0?'strong' as const:'weak' as const})),
  phone:phoneHits.map((value,i)=>({value,source:'text' as const,confidence:i===0?'strong' as const:'weak' as const})),
  hours:patternLines(lines,HOURS),
  menu:patternLines(lines,PRICE),
  social:socialLinks(html,baseUrl),
  voice:voiceSignals(lines),
  textChars:lines.join('\n').length,
 };
}
// 사실 원장 후보(lib/fact-import.ts planImport 입력 모양). 항목(key)마다 하나만 만든다: 같은 범위·같은 항목은 원장이 하나라서다.
// 이름·로고·색·말투는 사실 원장이 아니라 실행 기록(brand_learn_run)의 제안으로 남긴다(색 적용은 apply_visual).
export type LearnedCandidate={key:string;value:string;source:string;confidence:LearnConfidence};
export function learnedFactCandidates(result:BrandLearnResult,sourceUrl:string,observedAt:string):LearnedCandidate[]{
 const origin=(how:string)=>`브랜드 자동 학습 · ${sourceUrl} · ${how} · 관측 ${observedAt.slice(0,10)} · 미확인 후보`;
 const first=(xs:Learned[],key:string,how:string):LearnedCandidate[]=>xs.length?[{key,value:xs[0].value,source:origin(how),confidence:xs[0].confidence}]:[];
 const menu=result.menu.length?[{key:'menu_price',value:result.menu.slice(0,5).map(m=>m.value).join('\n'),source:origin('본문 가격 줄'),confidence:'weak' as const}]:[];
 const social=result.social.length?[{key:'official_account',value:result.social.map(s=>s.value).join('\n'),source:origin('페이지 링크'),confidence:'weak' as const}]:[];
 return [...first(result.address,'address','본문 주소 패턴'),...first(result.phone,'phone','본문 전화 패턴'),...first(result.hours,'hours','본문 영업시간 패턴'),...menu,...social];
}
// 화면 요약용: 찾은 사실 후보 수.
export const learnedFactCount=(result:BrandLearnResult)=>learnedFactCandidates(result,'',new Date(0).toISOString()).length;
