// 소재 예측 점수(G2, docs/CREATIVE-SCORE.ko.md). 게시 전 소재 본문을 결정론 규칙으로 0~100점으로 매기고 구성 요소별 근거를 남긴다.
// 순수 함수만 둔다(모델 호출·난수·시계 없음). 같은 입력은 항상 같은 결과다. 서버(lib/creative-score-server.ts)·화면·테스트가 그대로 쓴다.
// 점수는 '추정'이며 성과를 보장하지 않는다. 사후 보정표(lib/creative-calibration.ts)가 있으면 등급만 관측 비율 순위로 바꾸고 표본(n·기간)을 함께 보인다.
import {channelRegistry,channelAliases} from './channels';
import type {CalibrationTable} from './creative-calibration';
import {calibratedBand} from './creative-calibration';

export const CREATIVE_SCORE_VERSION='creative-score-v1';
export const CREATIVE_SCORE_LABEL='추정 · 규칙 기반 · 성과 보장 아님';
export type ScoreBand='낮음'|'보통'|'높음';
export const BAND_THRESHOLDS={high:70,normal:40} as const;
// 차단(block) 규제 위반이 있으면 총점은 이 값을 넘지 못한다.
export const COMPLIANCE_CAP=20;
export type ImageMeta={hasImage:boolean;aspect?:string|null;textOnImage?:boolean;aiDisclosure?:boolean};
// 학습 규칙은 id·지침·방향만 받는다. 판정 대상 표현은 terms(명시) 또는 지침 안의 따옴표 구절이다. 둘 다 없으면 확인 불가로 적고 점수를 바꾸지 않는다.
export type ScoreRule={id:string;guidance:string;direction?:'test'|'caution';terms?:string[]};
export type ComplianceInput={issues:readonly {ruleId:string;severity:'block'|'warn'|'info';title:string}[]};
export type VoiceInput={preferTerms:readonly string[];avoidTerms:readonly string[]};
export type FactsInput={confirmed:readonly {key:string;value:string}[];prohibited:readonly {key:string;value:string}[]};
export type CreativeScoreInput={text:string;channel:string;origin?:string;image?:ImageMeta|null;facts?:FactsInput|null;voice?:VoiceInput|null;rules?:readonly ScoreRule[];compliance?:ComplianceInput|null;recent?:readonly {id:string;text:string}[];calibration?:CalibrationTable|null};
export type ScoreComponent={key:string;label:string;points:number;max:number;evidence:string[]};
export type CreativeScore={version:string;score:number;band:ScoreBand;components:ScoreComponent[];flags:string[];sample:{n:number;window:string|null};label:string};

// 구성 요소와 최대 점수(합 100). 문서의 가중치 표와 같다.
export const COMPONENT_WEIGHTS={hook:20,clarity:15,specificity:15,brand_fit:10,channel_fit:10,compliance:10,learning_rules:10,novelty:5,ai_disclosure:5} as const;
export type ComponentKey=keyof typeof COMPONENT_WEIGHTS;
export const COMPONENT_LABELS:Record<ComponentKey,string>={hook:'첫 문장(훅)',clarity:'행동 유도 명확성',specificity:'구체성(가격·시간·장소)',brand_fit:'브랜드 말투 적합',channel_fit:'채널 형식 적합',compliance:'규제 점검',learning_rules:'학습 규칙',novelty:'최근 게시물과의 차이',ai_disclosure:'AI 생성 표시'};

const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
const compact=(s:string)=>s.replace(/\s+/g,'').toLowerCase();
const includes=(text:string,term:string)=>term.trim().length>0&&compact(text).includes(compact(term));
const component=(key:ComponentKey,points:number,evidence:string[]):ScoreComponent=>({key,label:COMPONENT_LABELS[key],points:clamp(Math.round(points),0,COMPONENT_WEIGHTS[key]),max:COMPONENT_WEIGHTS[key],evidence});

// 첫 문장: 첫 줄 또는 첫 종결 부호까지. 제목 표식(#)·불릿은 뗀다.
export function firstSentence(text:string){
 const line=text.split('\n').map(l=>l.replace(/^[#>*\-\s]+/,'').trim()).find(Boolean)??'';
 return (line.split(/(?<=[.?!。])\s+/)[0]??'').trim();
}
const QUESTION=/\?|？|나요|까요|을까|ㄹ까|인가요|세요\?/,NUMBER=/\d/,CONTRAST=/하지만|그런데|대신|아니라|보다|vs|VS|말고|반면|오히려/;
function hook(text:string):ScoreComponent{
 const s=firstSentence(text),len=[...s].length,evidence:string[]=[];
 let points=0;
 if(!s)return component('hook',0,['첫 문장을 찾지 못했습니다']);
 if(len<=40){points+=8;evidence.push(`첫 문장 ${len}자(40자 이하)`)}else if(len<=60){points+=4;evidence.push(`첫 문장 ${len}자(41~60자, 절반 가점)`)}else evidence.push(`첫 문장 ${len}자(60자 초과, 가점 없음)`);
 for(const [re,label] of [[QUESTION,'질문형'],[NUMBER,'숫자 포함'],[CONTRAST,'대조 표현']] as const){if(re.test(s)){points+=4;evidence.push(label)}}
 return component('hook',points,evidence);
}
export const CTA_PATTERN=/예약|주문|방문|문의|신청|구매|클릭|저장|팔로우|공유|댓글|참여|DM|디엠|링크|확인해|보러\s?오|들러|받아\s?가|만나요|오세요|가세요/g;
export const OFFER_PATTERN=/할인|증정|1\+1|무료|쿠폰|이벤트|사은품|특가|세일/g;
const sentences=(text:string)=>text.split(/\n|(?<=[.?!。])\s+/).map(s=>s.trim()).filter(Boolean);
function clarity(text:string):ScoreComponent{
 const cta=new RegExp(CTA_PATTERN.source),ctaSentences=sentences(text).filter(s=>cta.test(s)).length;
 const offers=new Set((text.match(OFFER_PATTERN)??[]).map(o=>o.toLowerCase())).size,evidence:string[]=[];
 let points=0;
 if(ctaSentences===1){points+=10;evidence.push('행동 유도 문장 1개')}else if(ctaSentences===0)evidence.push('행동 유도 문장 없음');else{points+=4;evidence.push(`행동 유도 문장 ${ctaSentences}개(하나로 모으면 가점)`)}
 if(offers<=1){points+=5;evidence.push(offers?'제안(혜택) 1종':'혜택 표현 없음(경쟁 제안 없음)')}else evidence.push(`혜택 표현 ${offers}종이 경쟁합니다`);
 return component('clarity',points,evidence);
}
const PRICE=/\d[\d,]*\s?(?:원|만원|천원)/,TIME=/\d{1,2}\s?시|오전|오후|\d{1,2}\s?월\s?\d{1,2}\s?일|요일|주말|평일|영업\s?시간/,PLACE=/\d+\s?층|[가-힣]{1,10}(?:역|점)(?=\s|$|[,.])|[가-힣]+(?:로|길)\s?\d+|주소|매장|지점|근처/,MARKER=/\[[^\]]*(?:확인|자료|가설)[^\]]*\]|확인\s?필요|자료\s?필요|미확정/;
function specificity(text:string,facts:FactsInput|null|undefined):ScoreComponent{
 const evidence:string[]=[];
 let points=0;
 for(const [re,label] of [[PRICE,'가격'],[TIME,'시간·날짜'],[PLACE,'장소']] as const){if(re.test(text)){points+=4;evidence.push(`${label} 언급`)}}
 const cited=(facts?.confirmed??[]).filter(f=>f.value.trim().length>=2&&includes(text,f.value)).map(f=>f.key);
 if(cited.length){points+=3;evidence.push(`확정 사실 인용: ${[...new Set(cited)].slice(0,5).join(', ')}`)}
 if(MARKER.test(text)){points-=5;evidence.push('확인 필요·자료 필요 표시가 남아 있습니다')}
 if(!evidence.length)evidence.push('가격·시간·장소 언급 없음');
 return component('specificity',points,evidence);
}
function brandFit(text:string,voice:VoiceInput|null|undefined,facts:FactsInput|null|undefined):{component:ScoreComponent;flags:string[]}{
 const evidence:string[]=[],flags:string[]=[];
 let points=0;
 if(!voice){points+=6;evidence.push('확정 말투 없음(중립)')}
 else{
  const preferred=voice.preferTerms.filter(t=>includes(text,t)),avoided=voice.avoidTerms.filter(t=>includes(text,t));
  if(preferred.length){points+=4;evidence.push(`선호 표현 사용: ${preferred.slice(0,5).join(', ')}`)}else evidence.push('선호 표현 미사용');
  if(avoided.length){evidence.push(`피할 표현 사용: ${avoided.slice(0,5).join(', ')}`);flags.push(`브랜드 말투의 피할 표현 ${avoided.length}건`)}else{points+=3;evidence.push('피할 표현 없음')}
 }
 const prohibited=(facts?.prohibited??[]).filter(f=>f.value.trim().length>=2&&includes(text,f.value));
 if(prohibited.length){evidence.push(`거절된 사실 표현: ${prohibited.map(f=>f.key).slice(0,5).join(', ')}`);flags.push(`거절된 사실 표현 ${prohibited.length}건`)}else{points+=3;evidence.push('거절된 사실 표현 없음')}
 return {component:component('brand_fit',points,evidence),flags};
}
// 채널 형식 한도. 공식 수치가 아닌 운영 기준이며 docs/CREATIVE-SCORE.ko.md 표가 정본이다.
export type ChannelLimits={maxChars:number;hashtags:[number,number];linkInBody:'penalty'|'ok'};
export const CHANNEL_LIMITS:Record<string,ChannelLimits>={Instagram:{maxChars:2200,hashtags:[3,8],linkInBody:'penalty'},TikTok:{maxChars:2200,hashtags:[3,8],linkInBody:'penalty'},YouTube:{maxChars:5000,hashtags:[0,15],linkInBody:'ok'},블로그:{maxChars:20000,hashtags:[0,30],linkInBody:'ok'},당근:{maxChars:2000,hashtags:[0,5],linkInBody:'ok'}};
export const DEFAULT_LIMITS:ChannelLimits={maxChars:5000,hashtags:[0,30],linkInBody:'ok'};
// 캠페인 채널 문구('Instagram, 매장 안내')에서 첫 번째로 맞는 채널 레지스트리 이름. 없으면 첫 토큰(없으면 '기타').
export function primaryChannel(channels:string){
 const text=channels.toLowerCase();
 const hit=Object.keys(channelRegistry).map(name=>({name,at:Math.min(...channelAliases(name).map(a=>{const i=text.indexOf(a);return i<0?Infinity:i}))})).filter(x=>x.at<Infinity).sort((a,b)=>a.at-b.at)[0];
 return hit?.name??(channels.split(/[,·/]/)[0]?.trim()||'기타');
}
const HASHTAG=/(^|\s)#[\p{L}\p{N}_]+/gu,URL=/https?:\/\/\S+|www\.\S+/;
function channelFit(text:string,channel:string):ScoreComponent{
 const limits=CHANNEL_LIMITS[channel]??DEFAULT_LIMITS,len=[...text].length,tags=(text.match(HASHTAG)??[]).length,evidence:string[]=[];
 let points=0;
 if(len<=limits.maxChars){points+=4;evidence.push(`${len}자(${channel} 한도 ${limits.maxChars}자 안)`)}else evidence.push(`${len}자(${channel} 한도 ${limits.maxChars}자 초과)`);
 if(tags>=limits.hashtags[0]&&tags<=limits.hashtags[1]){points+=3;evidence.push(`해시태그 ${tags}개(권장 ${limits.hashtags[0]}~${limits.hashtags[1]})`)}else evidence.push(`해시태그 ${tags}개(권장 ${limits.hashtags[0]}~${limits.hashtags[1]} 밖)`);
 if(limits.linkInBody==='penalty'&&URL.test(text))evidence.push('본문 링크는 이 채널에서 눌리지 않습니다(프로필·스토리 링크 권장)');else{points+=3;evidence.push(URL.test(text)?'본문 링크 사용 가능 채널':'본문 링크 없음')}
 return component('channel_fit',points,evidence);
}
function compliance(input:ComplianceInput|null|undefined):{component:ScoreComponent;capped:boolean;flags:string[]}{
 if(!input)return {component:component('compliance',5,['규제 점검 결과 없음(중립)']),capped:false,flags:[]};
 const block=input.issues.filter(i=>i.severity==='block'),warn=input.issues.filter(i=>i.severity==='warn');
 if(block.length)return {component:component('compliance',0,block.map(i=>`차단: ${i.title}(${i.ruleId})`)),capped:true,flags:[`규제 점검 차단 ${block.length}건 — 총점 ${COMPLIANCE_CAP}점 상한`]};
 const evidence=warn.length?warn.map(i=>`경고: ${i.title}(${i.ruleId})`):['차단·경고 없음'];
 return {component:component('compliance',10-3*warn.length,evidence),capped:false,flags:warn.length?[`규제 점검 경고 ${warn.length}건`]:[]};
}
const QUOTED=/[‘“'"「『]([^’”'"」』]{2,40})[’”'"」』]/g;
export const ruleTerms=(rule:ScoreRule)=>[...new Set([...(rule.terms??[]),...[...rule.guidance.matchAll(QUOTED)].map(m=>m[1].trim())].filter(t=>t.length>=2))];
function learningRules(text:string,rules:readonly ScoreRule[]|undefined):{component:ScoreComponent;flags:string[]}{
 if(!rules?.length)return {component:component('learning_rules',5,['적용 규칙 없음(중립)']),flags:[]};
 const evidence:string[]=[],flags:string[]=[];
 let points=5;
 for(const rule of rules){
  const terms=ruleTerms(rule),hit=terms.filter(t=>includes(text,t));
  if(!terms.length){evidence.push(`${rule.id}: 판정 표현 없음(확인 불가)`);continue}
  const caution=rule.direction==='caution';
  if(hit.length&&!caution){points+=3;evidence.push(`${rule.id} 충족(+3): ${hit.slice(0,3).join(', ')}`)}
  else if(hit.length&&caution){points-=3;evidence.push(`${rule.id} 위반(−3): ${hit.slice(0,3).join(', ')}`);flags.push(`학습 규칙 ${rule.id}의 주의 표현 사용`)}
  else if(caution){points+=3;evidence.push(`${rule.id} 충족(+3): 주의 표현 없음`)}
  else{points-=3;evidence.push(`${rule.id} 미충족(−3): ${terms.slice(0,3).join(', ')} 없음`)}
 }
 return {component:component('learning_rules',points,evidence),flags};
}
export const tokens=(text:string)=>new Set(text.toLowerCase().split(/[\s.,!?;:()\[\]{}"'“”‘’…·\-—/]+/).filter(t=>[...t].length>=2));
export function jaccard(a:Set<string>,b:Set<string>){
 if(!a.size&&!b.size)return 0;
 let both=0;for(const t of a)if(b.has(t))both++;
 return both/(a.size+b.size-both);
}
function novelty(text:string,recent:readonly {id:string;text:string}[]|undefined):{component:ScoreComponent;flags:string[]}{
 if(!recent?.length)return {component:component('novelty',4,['비교할 최근 게시물 없음(중립)']),flags:[]};
 const mine=tokens(text),top=recent.map(r=>({id:r.id,sim:jaccard(mine,tokens(r.text))})).sort((a,b)=>b.sim-a.sim)[0];
 const pct=Math.round(top.sim*100),evidence=[`최근 ${recent.length}건 중 최대 유사도 ${pct}%(${top.id})`];
 if(top.sim<0.3)return {component:component('novelty',5,evidence),flags:[]};
 if(top.sim<0.5)return {component:component('novelty',3,evidence),flags:[]};
 if(top.sim<0.7)return {component:component('novelty',1,evidence),flags:[]};
 return {component:component('novelty',0,evidence),flags:['최근 게시물과 매우 유사(70% 이상)']};
}
export const AI_DISCLOSURE_TEXT=/AI(?:의|로|가|를)?\s?(?:도움|생성|작성|제작|만든)|#AI|AI\s?생성/;
const isAi=(origin?:string)=>origin==='ai'||origin==='ai_edited';
function aiDisclosure(text:string,origin:string|undefined,image:ImageMeta|null|undefined):{component:ScoreComponent;flags:string[]}{
 if(!isAi(origin))return {component:component('ai_disclosure',5,['사람 작성(표시 불필요)']),flags:[]};
 if(AI_DISCLOSURE_TEXT.test(text)||image?.aiDisclosure)return {component:component('ai_disclosure',5,[image?.aiDisclosure&&!AI_DISCLOSURE_TEXT.test(text)?'이미지에 AI 표시':'본문에 AI 표시']),flags:[]};
 return {component:component('ai_disclosure',0,['AI 생성물인데 표시가 없습니다']),flags:['AI 생성 표시 없음']};
}
export const bandOf=(score:number):ScoreBand=>score>=BAND_THRESHOLDS.high?'높음':score>=BAND_THRESHOLDS.normal?'보통':'낮음';

export function scoreCreative(input:CreativeScoreInput):CreativeScore{
 const text=input.text??'',channel=input.channel||'기타';
 const brand=brandFit(text,input.voice,input.facts),comp=compliance(input.compliance),rules=learningRules(text,input.rules),novel=novelty(text,input.recent),ai=aiDisclosure(text,input.origin,input.image);
 const components=[hook(text),clarity(text),specificity(text,input.facts),brand.component,channelFit(text,channel),comp.component,rules.component,novel.component,ai.component];
 const raw=components.reduce((s,c)=>s+c.points,0),score=clamp(comp.capped?Math.min(raw,COMPLIANCE_CAP):raw,0,100);
 const flags=[...comp.flags,...brand.flags,...rules.flags,...novel.flags,...ai.flags];
 if(input.image?.hasImage&&input.image.textOnImage)flags.push('이미지 위 글자가 많으면 노출이 줄 수 있습니다(참고)');
 const cal=input.calibration?calibratedBand(score,input.calibration):null;
 if(cal?.note)flags.push(cal.note);
 return {version:CREATIVE_SCORE_VERSION,score,band:cal?.band??bandOf(score),components,flags,sample:cal?{n:cal.n,window:cal.window}:{n:0,window:null},label:CREATIVE_SCORE_LABEL};
}
