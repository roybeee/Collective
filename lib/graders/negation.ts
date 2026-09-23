// 부정·배제 판정(채점기·규제 가드레일 공용 사전). 문장 전체가 아니라 대상 표현 바로 뒤 서술부(같은 절, 40자 안)만 본다.
// 문장 어디에 부정어가 있든 면제하면 '(주류 제외)' 같은 조건 주석이나 '잊지 말고' 같은 권유형 어미 하나로 위반 전체가 빠진다.

// 절 안 어디에 있어도 부정으로 보는 표현.
const STRONG=/[가-힣]지\s?(?:않|말(?:고|아|라|자|기|것)|마(?:세요|십시오|시고|라))|금지|제외|삭제|무관|안\s?(?:합니다|한다|해요|함|됩니다|된다|돼요|됨)|피합니다|피한다|피해야|피하고|피할|빼고|뺍니다|뺀다|대신|불가|금물/;
// '아닌·없습니다·없이'는 대상 표현이 부정 대상일 때만 부정이다: 대상 바로 뒤 8자 안, 쉼표 없이 나와야 한다.
// ('평범한 분식이 아닌 숯불 떡볶이'의 '아닌'은 숯불을 부정하지 않고, '효과, 부작용이 없습니다'는 효능 주장이다.)
const WEAK=/^[^,，]{0,8}?(?:아니라|아닌|아닙|없이|없습니다|없다|없음)/;
// 새 절이 시작되는 연결 어미. '광고 '·'재고 ' 같은 명사 끝 '고'는 제외한다.
const CLAUSE_END=/(?<!광|재|참|최|공|신|경|원|창)고\s|(?:며|면서|지만|는데|으나|니까)\s|[;；]/;
// '금지 표현: 숯불'처럼 부정 라벨 뒤에 나열한 표현.
const NEG_LABEL=/(?:금지|하지\s?않|쓰지\s?않|넣지\s?않|제외|피할|뺄)[^:：]{0,20}[:：][^:：]*$/;
const SCOPE=40;
// '숯불·인기·가격 경쟁이 아니라'처럼 가운뎃점·빗금으로 이은 나열은 한 대상으로 보고, 나열 끝부터 서술부를 본다.
const LIST_TAIL=/^[가-힣A-Za-z]{0,4}(?:\s?[·ㆍ/]\s?[가-힣A-Za-z0-9]{1,10})+/;
// 라벨·제목처럼 짧은 구절 전체에 쓰는 부정 판정.
export const NEGATION=new RegExp(`${STRONG.source}|아니라|아닌|아닙|없이|없습니다`);

// 조건 주석 괄호('(주류 제외)', '(1인 1회, 중복 참여 금지)')와 권유·강조 관용구('잊지 말고', '어디에도 없습니다')는 부정이 아니다.
// 같은 길이의 공백으로 바꿔 문장 안 위치를 보존한다. '(진행 금지)'처럼 괄호 전체가 앞 행위의 부정이면 남긴다.
const CONDITION_NOTE=/[(（]([^()（）]{0,40})[)）]/g,CONDITION=/제외|금지|불가|한정/;
const BARE_NEGATION=/^\s*(?:진행|사용|운영|실시|시행|게시|발송|적용|이용)?\s?(?:금지|불가)\s*$/;
const PROMO_IDIOM=/(?:잊|놓치|빠뜨리|망설이|주저하)지\s?(?:말|마|않을|않는|못할)[가-힣]*|(?:어디에서도|어디에도|어디서도)\s?(?:찾을\s?수\s?없|없|못)[가-힣]*|(?:비교할|잊을|놓칠|따라올)\s?수\s?없[가-힣]*/g;
const blank=(m:string)=>' '.repeat(m.length);
export function neutralize(sentence:string){
 return sentence.replace(CONDITION_NOTE,(m,inner:string)=>CONDITION.test(inner)&&!BARE_NEGATION.test(inner)?blank(m):m).replace(PROMO_IDIOM,blank);
}
// s는 neutralize를 거친 문장, [start,end)는 대상 표현의 위치다.
export function negatedAt(s:string,start:number,end:number){
 if(NEG_LABEL.test(s.slice(0,start)))return true;
 const from=end+(LIST_TAIL.exec(s.slice(end,end+SCOPE))?.[0].length||0),after=s.slice(from,from+SCOPE),cut=CLAUSE_END.exec(after);
 return STRONG.test(cut?after.slice(0,cut.index+cut[0].length):after)||WEAK.test(after);
}
// 표현을 공백·대소문자와 무관하게 찾는 정규식. 정규식 특수문자는 글자로 본다.
export const termPattern=(term:string)=>new RegExp(term.replace(/\s+/g,'').split('').map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*'),'gi');
const empty=(term:string)=>!term.replace(/\s+/g,'');
export const mentions=(sentence:string,term:string)=>!empty(term)&&termPattern(term).test(sentence);
// 표현이 부정·배제 없이 쓰인 곳이 하나라도 있으면 true.
export function usesTerm(sentence:string,term:string){
 if(empty(term))return false;
 const s=neutralize(sentence);
 return [...s.matchAll(termPattern(term))].some(m=>!negatedAt(s,m.index!,m.index!+m[0].length));
}
