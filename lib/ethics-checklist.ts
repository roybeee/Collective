// 사람 확인 체크리스트(마케팅 스킬 이식 계획 P6, 스위치 ethics_review_checklist). 순수 모듈: DB·모델·네트워크를 쓰지 않는다.
// 결정론 규정 사전이 글자로 판정하지 못하는 항목(연출, 표기 위치, 권위, 누락, 필수 표시, 권리 범위, 입점처 수익, 취약층, 대상국, AI 표시 위치)을 사람이 확인할 질문으로 만든다.
// 질문 문장은 화면 사전(lib/i18n/ko-trust.ts 'ethics.item.<id>')에 우리 말로 쓴다. 이 파일은 항목 id·근거·포함 조건만 정한다.
// 근거(basis): 확인한 법령 행이 있으면 그 법령·조문(law, 링크는 규정 사전 출처 id로 서버가 붙인다), 없으면 미확인(unverified) 또는 운영 기준(operating).
// 이 목록은 표시와 기록만 한다. 승인을 막을지는 대표가 정한다(계획 6절 9). 법률 자문이 아니다.

export const ETHICS_CHECKLIST_VERSION='ethics-checklist-2026-11-16.1';
export const ETHICS_ITEM_IDS=['staged_spontaneous','disclosure_placement','authority_expert','material_omission','required_labeling','rights_scope','partner_revenue','vulnerable_minors','target_country','ai_disclosure_placement'] as const;
export type EthicsItemId=typeof ETHICS_ITEM_IDS[number];
// 내용 신호. foreign_language는 캠페인 산출물 언어가 한국어가 아닐 때다.
export const ETHICS_SIGNALS=['price','endorsement','ai_image','franchise','foreign_language'] as const;
export type EthicsSignal=typeof ETHICS_SIGNALS[number];
export type EthicsSignals=Readonly<Record<EthicsSignal,boolean>>;
export type EthicsBasis={kind:'law';sourceId:string;law:string;article:string}|{kind:'unverified'}|{kind:'operating'};
type ItemRule={id:EthicsItemId;when:'always'|readonly EthicsSignal[];basis:EthicsBasis};
// triggers: 이 항목을 넣게 한 신호(항상 넣는 항목은 빈 배열).
export type EthicsItem={id:EthicsItemId;basis:EthicsBasis;triggers:EthicsSignal[]};

const law=(sourceId:string,name:string,article:string):EthicsBasis=>({kind:'law',sourceId,law:name,article});
const FAIR='표시·광고의 공정화에 관한 법률',NOTICE='부당한 표시·광고행위의 유형 및 기준 지정고시',ENDORSE='추천·보증 등에 관한 표시·광고 심사지침';
export const ETHICS_ITEMS:readonly ItemRule[]=[
 {id:'staged_spontaneous',when:'always',basis:law('fair_labeling',FAIR,'제3조①')},
 {id:'disclosure_placement',when:['endorsement'],basis:law('endorsement_guideline',ENDORSE,'Ⅴ.6.나·다')},
 {id:'authority_expert',when:['endorsement'],basis:law('unfair_ad_notice',NOTICE,'Ⅲ.12')},
 {id:'material_omission',when:'always',basis:law('unfair_ad_notice',NOTICE,'Ⅲ.15')},
 {id:'required_labeling',when:['price','franchise'],basis:{kind:'unverified'}},
 {id:'rights_scope',when:'always',basis:law('unfair_competition_act','부정경쟁방지 및 영업비밀보호에 관한 법률','제2조1호 타목')},
 {id:'partner_revenue',when:['franchise'],basis:{kind:'operating'}},
 {id:'vulnerable_minors',when:'always',basis:{kind:'unverified'}},
 {id:'target_country',when:['foreign_language'],basis:{kind:'unverified'}},
 {id:'ai_disclosure_placement',when:['ai_image'],basis:law('ai_basic_act','인공지능 발전과 신뢰 기반 조성 등에 관한 기본법','제31조③')},
];

// 본문에서 읽는 신호(가격·추천·AI 이미지·가맹). 넓게 잡는다: 사람이 '해당 없음'으로 닫을 수 있고, 놓치면 확인할 기회가 없다.
const PRICE=/\d[\d,]*\s?(?:원|만\s?원|달러|엔)(?![가-힣])|[₩$¥€]\s?\d|가격|판매가|정가|정상가|할인|특가|세일|배송비|무료\s?배송|\bprice\b|\bdiscount\b/i;
const ENDORSEMENT=/협찬|광고|체험단|후기|리뷰|추천|인플루언서|앰배서더|서포터즈|홍보대사|전문가|의사|약사|교수|인증|수상|선정|#ad\b|#pr\b|sponsor|endorse|testimonial|\breview/i;
const AI_IMAGE=/(?:AI|인공지능|생성형)[^.\n]{0,20}(?:이미지|영상|사진|일러스트|캐릭터|아바타|모델|인플루언서)|딥페이크|합성\s?(?:사진|얼굴|음성|영상)|가상\s?(?:인물|인간|모델|인플루언서)|버추얼|디지털\s?휴먼/i;
const FRANCHISE=/가맹|프랜차이즈|창업\s?(?:설명회|문의|비용|지원|상담)|점주\s?모집|입점\s?(?:제안|모집|문의|혜택)|\bfranchise/i;
export function contentSignals(text:string):Pick<EthicsSignals,'price'|'endorsement'|'ai_image'|'franchise'>{
 return {price:PRICE.test(text),endorsement:ENDORSEMENT.test(text),ai_image:AI_IMAGE.test(text),franchise:FRANCHISE.test(text)};
}
export const NO_SIGNALS:EthicsSignals=Object.freeze({price:false,endorsement:false,ai_image:false,franchise:false,foreign_language:false});
// 본문 신호와 기록 신호(AI 이미지 등록·가맹 모집 목적)를 합치고, 산출물 언어가 ko가 아니면 대상국 신호를 켠다.
export function ethicsSignals(text:string,extra:{outputLanguage:string;aiImage?:boolean;franchise?:boolean}):EthicsSignals{
 const found=contentSignals(text);
 return {...found,ai_image:found.ai_image||extra.aiImage===true,franchise:found.franchise||extra.franchise===true,foreign_language:extra.outputLanguage!=='ko'};
}
export function ethicsChecklist(signals:EthicsSignals):EthicsItem[]{
 return ETHICS_ITEMS.flatMap(rule=>{
  if(rule.when==='always')return [{id:rule.id,basis:rule.basis,triggers:[]}];
  const triggers=rule.when.filter(s=>signals[s]);
  return triggers.length?[{id:rule.id,basis:rule.basis,triggers}]:[];
 });
}

// 사람 표시. 확인(confirmed)·보류(held)·해당 없음(not_applicable). 메모는 선택이고 300자 이하다.
export const ETHICS_MARK_STATUSES=['confirmed','held','not_applicable'] as const;
export type EthicsMarkStatus=typeof ETHICS_MARK_STATUSES[number];
export const ETHICS_NOTE_MAX=300;
export type EthicsMarkInput={itemId:EthicsItemId;status:EthicsMarkStatus;note:string};
export type EthicsMark=EthicsMarkInput&{id:string;artifactId:string;artifactVersion:number;campaignId:string;checklistVersion:string;actor:{id:string;role:string};createdAt:string};
const isItemId=(v:unknown):v is EthicsItemId=>typeof v==='string'&&(ETHICS_ITEM_IDS as readonly string[]).includes(v);
const isStatus=(v:unknown):v is EthicsMarkStatus=>typeof v==='string'&&(ETHICS_MARK_STATUSES as readonly string[]).includes(v);
// 입력 검사. 문제가 있으면 사람이 읽는 한국어 사유, 없으면 정리한 입력이다. 현재 목록에 없는 항목은 거절한다.
export function parseEthicsMark(value:Record<string,unknown>,items:readonly EthicsItem[]):{error:string}|{mark:EthicsMarkInput}{
 if(!isItemId(value.itemId))return {error:'확인 항목을 확인해 주세요.'};
 if(!items.some(i=>i.id===value.itemId))return {error:'이 작업물의 확인 목록에 없는 항목입니다. 새로고침 후 다시 고르세요.'};
 if(!isStatus(value.status))return {error:'확인·보류·해당 없음 중 하나를 고르세요.'};
 if(value.note!==undefined&&value.note!==null&&typeof value.note!=='string')return {error:'메모 형식을 확인해 주세요.'};
 const note=typeof value.note==='string'?value.note.trim():'';
 if(note.length>ETHICS_NOTE_MAX)return {error:`메모는 ${ETHICS_NOTE_MAX}자 이하로 적어 주세요.`};
 return {mark:{itemId:value.itemId,status:value.status,note}};
}
// 항목별 마지막 표시(기록 순서대로 받은 목록에서 뒤의 것이 이긴다). 원본 기록은 그대로 남는다(추가 전용).
export function latestMarks<T extends {itemId:string}>(marks:readonly T[]):T[]{
 const last=new Map<string,T>();
 for(const m of marks)last.set(m.itemId,m);
 return [...last.values()];
}
