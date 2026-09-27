// 트랙 R R15b 결정론 모집 카드 묶음(순수). 모집 자료(recruitment_asset)의 한 유형으로, 원문 한 편을 3~5장 카드로 나누고 1080×1350·1080×1920 PNG로 그릴 자리를 계산한다.
// 이 모듈은 판정만 한다: 카드 나누기·구조 검사, 원장(브랜드 사실)에 없는 수치 검사, 유입 코드 QR 링크 검사, 카드 템플릿, 그릴 글 상자 자리. 저장·승인·내보내기 게이트는 lib/franchise-assets.ts가 이 결과를 받아 쓴다.
// 생성형 이미지와 모델 호출은 없다(성장 계획 '하지 않을 것'). 시계·난수·조회·외부 호출이 없다(now·today·코드 목록은 인자). 기존 렌더러(lib/creative-render.ts)는 고치지 않는다.
// 근거: docs/FRANCHISE-RECRUITMENT-PLAN.ko.md R15 절 'R15b'. 거부 기준: 원장에 없는 수치가 든 카드 400, 유효하지 않은 유입 코드 QR 400. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
// 모델 경계(DP-10): 모델 경로가 이 모듈에 닿지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN).
import {factLine,footnoteLine,type VersionLite} from './franchise-facts';
import {recruitmentTokens,isRecruitmentCode} from './franchise-recruitment';
import {encodeQr} from './franchise-qr';
import {scanText} from './pii-scan';
import type {BrandFact} from './brand-facts';

function deepFreeze<T>(value:T):T{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const k of Object.keys(value))deepFreeze((value as Record<string,unknown>)[k])}
 return value;
}
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

export const CARDS_VERSION='fr-cards@2026-09-27.1';
// 한 카드에 들어갈 글(제목·QR 줄 제외) 한도. 가장 작은 글자(28px)로도 두 규격 모두 글 상자 안에 들어가게 잡았다(tests/franchise-cards.test.mjs CD-L).
export const CARD_LIMITS=deepFreeze({minCards:3,maxCards:5,cardChars:220,cardLines:10,qrCardChars:90,qrCardLines:4,urlBytes:200} as const);
export const CARD_SIZES=deepFreeze({
 feed:{width:1080,height:1350,label:'1080×1350 피드'},
 story:{width:1080,height:1920,label:'1080×1920 스토리'},
} as const);
export type CardSize=keyof typeof CARD_SIZES;
export const CARD_SIZE_KEYS:readonly CardSize[]=deepFreeze(['feed','story'] as const);
// 카드 제목 줄: '■ N장' 또는 '■ N장 [표지]'. 표지는 카드 위에 작게 그린다([의견]·[사실]·[COLLECTIVE 휴리스틱 · 법률 자문 아님] 등, 내용은 판정기가 본다).
const HEADING_RE=/^■ ([1-9])장(?: (.{1,40}))?$/;
// QR 줄: 'QR ' + https 링크 한 줄. 카드 묶음 전체에 하나까지.
const QR_RE=/^QR (\S+)$/;
export const QR_LINE_PREFIX='QR ';

export const CARD_CODES=deepFreeze(['card_number_unbacked','card_qr_invalid','card_structure'] as const);
export type CardCode=typeof CARD_CODES[number];
export const CARD_MESSAGES:Readonly<Record<CardCode,string>>=deepFreeze({
 card_structure:`카드 묶음은 '■ 1장'부터 차례로 3~5장이고, 카드마다 글이 있어야 합니다(제목 줄 제외 ${CARD_LIMITS.cardChars}자·${CARD_LIMITS.cardLines}줄 이하, QR 카드는 ${CARD_LIMITS.qrCardChars}자·${CARD_LIMITS.qrCardLines}줄 이하). QR 줄은 묶음 전체에 하나까지입니다.`,
 card_number_unbacked:'카드에 근거 사실(브랜드 사실 원장)에 없는 수치가 있습니다. 수치는 근거 사실로 선택한 사실의 값 그대로만 쓸 수 있습니다(날짜·시각·대표 전화번호 제외).',
 card_qr_invalid:`QR 링크는 https 주소 한 줄(${CARD_LIMITS.urlBytes}바이트 이하, 개인정보 없음)이고, 이 브랜드에서 발급해 사용 중인 모집 코드(R로 시작하는 8자) 하나가 utm_content나 경로에 있어야 합니다.`,
});

export type Card={index:number;label:string|null;lines:string[];qr:string|null};
export type CardCodeLite={code:string;brandId:string;retiredOn:string|null};
export type CardCheck={codes:CardCode[];cards:Card[];qr:{url:string;code:string}|null;unbacked:string[];warnings:string[]};
export const CARD_WARNINGS=deepFreeze({noQr:'QR 줄이 없습니다. 카드에서 들어온 문의를 모집 코드로 귀속할 수 없습니다(권장, 막지 않음).'} as const);

// ── 카드 나누기 ──
// 첫 줄부터 카드 제목 줄이어야 하고(앞의 빈 줄은 허용), '■'로 시작하는데 제목 형식이 아닌 줄은 구조 오류다. 카드 글은 앞뒤 빈 줄을 뺀 줄이다.
export function parseCards(body:unknown):{cards:Card[];ok:boolean}{
 if(typeof body!=='string')return {cards:[],ok:false};
 const cards:Card[]=[];let ok=true,qrCount=0;
 for(const raw of body.split('\n')){
  const line=raw.trimEnd(),h=HEADING_RE.exec(line.trim());
  if(h){cards.push({index:Number(h[1]),label:h[2]??null,lines:[],qr:null});continue}
  if(line.trim().startsWith('■')){ok=false;continue}
  const card=cards.at(-1);
  if(!card){if(line.trim())ok=false;continue}
  const q=QR_RE.exec(line.trim());
  if(q){qrCount++;if(card.qr!==null)ok=false;card.qr=q[1];continue}
  card.lines.push(line);
 }
 for(const c of cards){while(c.lines.length&&!c.lines[0].trim())c.lines.shift();while(c.lines.length&&!c.lines.at(-1)!.trim())c.lines.pop()}
 return {cards,ok:ok&&qrCount<=1};
}
const textChars=(c:Card)=>Array.from(c.lines.join('')).length;
function structureOk(cards:readonly Card[]):boolean{
 if(cards.length<CARD_LIMITS.minCards||cards.length>CARD_LIMITS.maxCards)return false;
 return cards.every((c,i)=>c.index===i+1&&c.lines.some(l=>l.trim())&&(c.qr===null
  ?textChars(c)<=CARD_LIMITS.cardChars&&c.lines.length<=CARD_LIMITS.cardLines
  :textChars(c)<=CARD_LIMITS.qrCardChars&&c.lines.length<=CARD_LIMITS.qrCardLines));
}

// ── 원장에 없는 수치 ──
// 허용 줄(근거 사실의 사실 줄·각주 줄, 호출자가 넘기는 고정 안내 문장)은 줄 전체를 건너뛴다. 나머지 줄의 수치(숫자 덩어리, 천 단위 쉼표 무시)는 근거 사실의 사실 줄·각주·값에 나온 수치와 덩어리째 같아야 한다('12'가 있다고 '1'이 되지 않는다).
// 날짜(2026년·10월 15일·10월·2026-10-15)·시각(14:00·오후 2시 30분)·대표 전화번호 꼴(02-123-4567·1588-1234)은 주장 수치가 아니라 먼저 지운다. 기간('14일'·'30분 만에')과 분수는 지우지 않는다(수치 주장일 수 있다).
// 한글 수사('팔천만 원')는 보지 않는다(판정기 H8·H6이 본다, 남은 위험).
const DATE_TIME=[/\d{4}[-./]\d{1,2}[-./]\d{1,2}/g,/\d{4}\s*년/g,/\d{1,2}\s*월\s*\d{1,2}\s*일/g,/\d{1,2}\s*월/g,/\d{1,2}:\d{2}/g,/(?:오전|오후)\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?/g];
const PHONE=[/\b0\d{1,2}-\d{3,4}-\d{4}\b/g,/\b1\d{3}-\d{4}\b/g];
const NUMBER=/\d+(?:[.,]\d+)*/g;
const plainDigits=(s:string)=>s.replace(/,/g,'');
function numberTokens(line:string):string[]{
 let s=line.normalize('NFKC');
 for(const re of [...PHONE,...DATE_TIME])s=s.replace(re,' ');
 return [...s.matchAll(NUMBER)].map(m=>plainDigits(m[0]));
}
export function unbackedNumbers(cards:readonly Card[],facts:readonly BrandFact[],versions:readonly VersionLite[],allowedLines:readonly string[]=[]):string[]{
 const exact=new Set<string>(allowedLines.map(l=>l.normalize('NFC'))),backed=new Set<string>();
 for(const f of facts){
  const lines=[...factLine(f).split('\n'),...(()=>{const n=footnoteLine(f,versions);return n?[n]:[]})()];
  for(const l of lines)exact.add(l.normalize('NFC'));
  for(const m of [...lines,f.value].join('\n').normalize('NFKC').matchAll(NUMBER))backed.add(plainDigits(m[0]));
 }
 const out:string[]=[];
 for(const c of cards)for(const line of c.lines){
  if(exact.has(line.normalize('NFC')))continue;
  for(const t of numberTokens(line))if(!backed.has(t)&&!out.includes(t))out.push(t);
 }
 return out;
}

// ── QR 링크 ──
const utf8Length=(s:string)=>new TextEncoder().encode(s).length;
// 링크 검사: https, 사용자 정보 없음, 점이 든 호스트, 공백·제어 문자 없음, 200바이트 이하, 개인정보 없음, 모집 코드가 정확히 하나. 코드는 같은 브랜드에서 발급했고 오늘(KST) 사용 중지 전이어야 한다.
// 적용 시작일 전의 코드는 받는다(박람회 QR을 미리 인쇄한다, R5 validFrom 규칙과 같음).
export function qrLinkIssue(url:unknown,ctx:{brandId:string;today:string;codes:readonly CardCodeLite[]|null|undefined}):{ok:true;code:string}|{ok:false}{
 try{
  if(typeof url!=='string'||!url||utf8Length(url)>CARD_LIMITS.urlBytes||/[\s\p{Cc}]/u.test(url))return {ok:false};
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password||!u.hostname.includes('.')||u.hostname.endsWith('.'))return {ok:false};
  if(scanText(url).length)return {ok:false};
  const found=recruitmentTokens(url).codes;
  if(found.length!==1||!isRecruitmentCode(found[0]))return {ok:false};
  const code=found[0],book=Array.isArray(ctx.codes)?ctx.codes:[];
  const mine=book.filter(c=>isRecord(c)&&c.code===code);
  if(mine.length!==1||mine[0].brandId!==ctx.brandId)return {ok:false};
  const retired=mine[0].retiredOn;
  if(retired!==null&&!(typeof retired==='string'&&ctx.today<retired))return {ok:false};
  if(!encodeQr(url))return {ok:false};
  return {ok:true,code};
 }catch{return {ok:false}}
}

// ── 묶음 검사 ──
// 순서: 구조 → QR 링크 → 수치. 코드는 모두 400(입력으로 고칠 것)이다. facts는 근거로 선택해 확인을 마친 사실만 넘긴다(lib/franchise-assets.ts resolveRefs 뒤).
export function checkCardBundle(body:unknown,ctx:{brandId:string;today:string;facts:readonly BrandFact[];versions:readonly VersionLite[];codes:readonly CardCodeLite[]|null|undefined;allowedLines?:readonly string[]}):CardCheck{
 try{
  const {cards,ok}=parseCards(body),codes:CardCode[]=[];
  if(!ok||!structureOk(cards))codes.push('card_structure');
  const qrCard=cards.find(c=>c.qr!==null);
  let qr:CardCheck['qr']=null;
  if(qrCard){const r=qrLinkIssue(qrCard.qr,ctx);if(r.ok)qr={url:qrCard.qr as string,code:r.code};else codes.push('card_qr_invalid')}
  const unbacked=unbackedNumbers(cards,Array.isArray(ctx.facts)?ctx.facts:[],Array.isArray(ctx.versions)?ctx.versions:[],ctx.allowedLines??[]);
  if(unbacked.length)codes.push('card_number_unbacked');
  return {codes:[...new Set(codes)].sort(),cards,qr,unbacked,warnings:qrCard?[]:[CARD_WARNINGS.noQr]};
 }catch{return {codes:['card_structure'],cards:[],qr:null,unbacked:[],warnings:[]}}
}

// ── 템플릿 ──
// 카드 4장 뼈대. 2장 [사실]은 비워 두고 화면이 '사실 넣기'로 사실 줄·각주를 넣는다. 3장은 호출자가 넘기는 권장 안내 문장(대기기간)이다. 4장 QR 줄은 발급한 모집 코드 링크로 바꾼다.
export function cardTemplate(opts:{factLines?:readonly string[];processLines?:readonly string[];processLabel:string}):string{
 return [
  '■ 1장 [의견]','',
  '■ 2장 [사실]',...(opts.factLines??[]),'',
  `■ 3장 ${opts.processLabel}`,...(opts.processLines??[]),'',
  '■ 4장','가맹 문의',QR_LINE_PREFIX+'https://',
 ].join('\n');
}

// ── 그릴 자리(순수) ──
// 카드 한 장의 글 상자. 브랜드 이름(위) → 카드 번호 'N/전체'(오른쪽 위) → 표지(작게) → 글 → (QR 카드면) QR 정사각형. 렌더러(lib/franchise-card-render.ts)는 이 자리에 맞춰 글자 크기만 줄인다.
export type CardBlock={role:'brand'|'index'|'label'|'text';text:string;x:number;y:number;width:number;height:number;maxSize:number;minSize:number;weight:number;align:'left'|'right'};
export type CardLayout={width:number;height:number;blocks:CardBlock[];qr:{x:number;y:number;size:number}|null};
export function cardLayout(size:CardSize,card:Card,total:number,brandName:string):CardLayout{
 const s=CARD_SIZES[size],story=size==='story',m=72,w=s.width-m*2,top=story?300:236,qrSize=story?520:380,bottom=s.height-m;
 const textBottom=card.qr!==null?bottom-qrSize-48:bottom;
 const blocks:CardBlock[]=[
  {role:'brand',text:brandName,x:m,y:story?96:64,width:w-160,height:88,maxSize:44,minSize:28,weight:700,align:'left'},
  {role:'index',text:`${card.index}/${total}`,x:s.width-m-150,y:story?96:64,width:150,height:88,maxSize:36,minSize:24,weight:700,align:'right'},
  ...(card.label?[{role:'label' as const,text:card.label,x:m,y:top-64,width:w,height:48,maxSize:26,minSize:18,weight:700,align:'left' as const}]:[]),
  {role:'text',text:card.lines.join('\n'),x:m,y:top,width:w,height:textBottom-top,maxSize:story?72:64,minSize:28,weight:500,align:'left'},
 ];
 return {width:s.width,height:s.height,blocks,qr:card.qr!==null?{x:Math.round((s.width-qrSize)/2),y:bottom-qrSize,size:qrSize}:null};
}
// 내려받을 파일 이름: <자료 id>-v<판>-<규격>-<N>.png(ASCII만).
export const cardFileName=(assetId:string,version:number,size:CardSize,index:number)=>`${String(assetId).replace(/[^A-Za-z0-9_-]/g,'_')}-v${version}-${size}-${index}.png`;
