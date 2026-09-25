// 부정·배제 판정(채점기·규제 가드레일 공용 사전). 문장 전체가 아니라 대상 표현 바로 뒤 서술부(같은 절, 40자 안)만 본다.
// 문장 어디에 부정어가 있든 면제하면 '(주류 제외)' 같은 조건 주석이나 '잊지 말고' 같은 권유형 어미 하나로 위반 전체가 빠진다.
// 예외 둘: 대상이 속한 절의 끝 서술부가 대상 명사구에 대한 표현 사용의 부정·금지면 거리와 무관하게 부정이고(긴 금지 목록, 새 주제어가 끼면 아니다),
// 인용 카피를 '처럼 쓴다'로 쓰면 부정이 아니다. 단독 '보류·삭제·제외'는 40자 안에서만 절 끝 부정으로 본다.

// 절 안 어디에 있어도 부정으로 보는 표현.
// '-지는·지도 않'(대조·강조 조사)도 같다('직접 사용되지는 않았으나', 2026-09-25 파일럿 1 품질 검토).
const STRONG=/[가-힣]지\s?(?:[는도]\s?)?(?:않|말(?:고|아|라|자|기|것)|마(?:세요|십시오|시고|라))|금지|제외|삭제|무관|안\s?(?:합니다|한다|해요|함|됩니다|된다|돼요|됨)|피합니다|피한다|피해야|피하고|피할|빼고|뺍니다|뺀다|대신|불가|금물/;
// '아닌·없습니다·없이'는 대상 표현이 부정 대상일 때만 부정이다: 대상 바로 뒤 8자 안, 쉼표 없이 나와야 한다.
// ('평범한 분식이 아닌 숯불 떡볶이'의 '아닌'은 숯불을 부정하지 않고, '효과, 부작용이 없습니다'는 효능 주장이다.)
const WEAK=/^[^,，]{0,8}?(?:아니라|아닌|아닙|없이|없습니다|없다|없음)/;
// 새 절이 시작되는 연결 어미(뒤에 공백·쉼표: '알리며,', '가고,'). '광고 '·'재고 ' 같은 명사 끝 '고'는 제외하고, 쉼표 앞 '고'는 동사 어간 뒤만 본다('최초 입고,'는 나열).
// '쓰되 '도 절 경계다('안 되'는 부정이라 제외). 끝맺음 뒤 쉼표('만든다,', '보세요,')도 절 경계다. 그 뒤는 다른 대상을 말한다('평점을 만든다, 이벤트는 보류').
// 인용 조사 '(이)라고'는 절 경계가 아니다('‘무료 자사 채널’이라고 단정하지 않는다', R3 기준선 MAPDAL 실측).
const CLAUSE_END=/(?<!광|재|참|최|공|신|경|원|창|라)고\s|(?<=[하않되이쓰두주리우기내넣받찾없있오가치키])고[,，]|(?<!안\s?)되[\s,，]|(?:며|면서|지만|는데|으나|니까)[\s,，]|(?:다|세요|어요|아요|해요|에요|예요)[,，]|[;；]/;
// '금지 표현: 숯불'처럼 부정 라벨 뒤에 나열한 표현. 대상 앞 마지막 콜론 바로 앞(20자 안)에 부정어가 있어야 한다.
const NEG_LABEL=/(?:금지|하지\s?않|쓰지\s?않|넣지\s?않|제외|피할|뺄)[^:：]{0,20}[:：]$/;
const SCOPE=40;
// '숯불·인기·가격 경쟁이 아니라'처럼 가운뎃점·빗금으로 이은 나열은 한 대상으로 보고, 나열 끝부터 서술부를 본다.
// 가운데 항목은 두 낱말까지 본다('위장 후기·대량 홍보·추천 조작 없음', '인기·판매 1위·최초'). 마지막 항목 뒤는 서술부 판정에 맡긴다.
const LIST_TAIL=/^[가-힣A-Za-z]{0,4}(?:\s?[·ㆍ/]\s?[가-힣A-Za-z0-9]{1,10}(?:\s[가-힣A-Za-z0-9]{1,6}(?=\s?[·ㆍ/]))?)+/;
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

// 따옴표 안쪽 구간 [start,end). 곧은 따옴표는 차례로 짝을 짓는다.
const QUOTE=/[‘“"「『][^‘’“”"「」『』\n]*[’”"」』]/g;
export const quoteSpans=(s:string)=>[...s.matchAll(QUOTE)].map(m=>({start:m.index!+1,end:m.index!+m[0].length-1}));
// 인용 카피를 사용하는 문맥: 닫는 따옴표 바로 뒤 '처럼 쓴다·로 쓰되·를 사용한다'. '쓰지 않는다'와 관형형('처럼 쓰는 표현은 금지')은 사용이 아니다.
// '써서는 안 된다'·'사용해서는 안 됩니다'·'써도 되는지는'처럼 뒤에 '는·도'가 붙으면 사용 서술이 아니다(뒤 부정 판정에 맡긴다).
const QUOTED_USE=/^\s?(?:(?:문구|표현|카피|문장|헤드라인|제목|슬로건)\s?)?(?:처럼|같이|으로|로|이라고|라고|를|을)\s?(?:쓴다|씁니다|써(?:요|서)?|쓰(?:고|며|되|는데|면서|세요|자)|(?:사용|표기|작성|강조|안내|노출)(?:한다|합니다|해(?:요|서)?|하(?:고|며|되|는데|면서|세요|자))|(?:적|넣)(?:는다|습니다|어(?:요|서)?|고|으며|되|는데|으면서|으세요|자))(?!\s?(?:싶|보|볼)|서?\s?(?:는|도)(?![가-힣]))/;
// 절 끝 서술부가 표현 사용의 부정·배제(쓰지 않는다·사용하지 않는다·금지·삭제·제외·보류·빼고)인지. 절 안 나열 전체를 부정한다(먼 대상은 FAR_NEGATION만).
// 표현 사용과 무관한 부정('쿠폰은 발행하지 않습니다')과 '없음·아니다'(효능 주장 '부작용이 없습니다')는 먼 대상을 부정하지 않는다.
// 추천·보증 행위의 부정('직원·지인 후기 작성 요청은 제안하지 않습니다', '후기를 만들지 않는다')도 표현 사용의 배제로 본다.
const USE_VERB='(?:쓰|사용하|넣|적|싣|담|표기하|표시하|노출하|언급하|주장하|내세우|강조하|활용하|제안하|권하|만들|요청하|작성하|게시하|올리|유도하)';
const USE_NEG=`${USE_VERB}지\\s?(?:않|말|마)(?:는다|습니다|아요|음|을\\s?것|는\\s?것|기로\\s?(?:한다|합니다|함)|도록\\s?(?:한다|합니다|함)|아야\\s?(?:한다|합니다|함)|고|며|되|세요|십시오|\\s?것)?`;
const HOLD_END='(?:한다|합니다|된다|됩니다|함|하고|하며|이다|입니다)?',AVOID='빼고|뺀다|뺍니다|빼야\\s?(?:한다|합니다)|피한다|피합니다|피해야\\s?(?:한다|합니다)';
// 표현의 부재('… 보장 표현이 없고', '… 문구가 포함되지 않는다', '… 문구가 들어가지 않는다')도 사용 배제다(수용 기준·점검 문장). 머리 명사가 표현·문구 등이어야 한다:
// '부작용이 없습니다'(효능 주장)와 '…이 있다'는 아니다(2026-09-25 파일럿 1 합의 단계 실측).
// 꾸밈말이 붙은 수사('더 이상의 표현이 없습니다', '이보다 좋은 문구가 없다', '대신할 표현이 없다')는 광고 문안이라 부정이 아니다(명사 앞 관형형 어미면 제외).
const ABSENT_EXPR='(?<![의은는운한된른던할을쓸]\\s?)(?:표현|문구|카피|문안|단어|어휘|문장|언급|예시)(?:이|가|은|는|도)?\\s?(?:없(?:다|고|으며|음|습니다|어야\\s?(?:한다|합니다))|(?:포함되|들어가)지\\s?않(?:는다|습니다|고|으며|음)?)';
// 확정·확인 뒤로 미룬 승인·결정('… 구매·혜택 유도 표현은 가격과 해당 조건이 확정된 뒤 별도 승인합니다')은 지금 쓰지 않는다는 보류다. '확정된 뒤 바로 씁니다'(조건부 사용)는 아니다(R3 기준선 MAPDAL 실측).
const DEFER='(?:확정|확인|검증|승인)(?:된|되는|한)\\s?(?:뒤|후|다음)(?:에)?\\s?(?:별도(?:로)?\\s?)?(?:승인|결정|검토)(?:한다|합니다|함|하며|하고)?';
const FINAL_NEGATION=new RegExp(`(?:${USE_NEG}|(?:금지|삭제|제외|배제|보류|금물)${HOLD_END}|${AVOID}|${ABSENT_EXPR}|${DEFER})$`);
// 대상 뒤 40자 밖의 먼 부정은 표현 사용의 부정·금지·사용 보류만 인정한다. 단독 '보류·삭제·제외'는 먼 앞 행위를 부정하지 않는다
// ('가짜 후기 3건을 올려 초기 평점을 만드는 방안, 외부 이벤트는 보류').
const FAR_NEGATION=new RegExp(`(?:${USE_NEG}|(?:금지|금물)${HOLD_END}|(?:사용|표기|노출|언급|게재|기재)\\s?(?:금지|삭제|제외|배제|보류)${HOLD_END}|${AVOID}|${ABSENT_EXPR}|${DEFER})$`);
// 절 끝 부정은 대상 명사구의 것이어야 한다. 대상 뒤 첫 은/는/을/를 낱말(대상 명사구의 머리: '표현은', '문구는', '게시물을') 다음에
// 새 주제어(명사+은/는)가 나오면 절 끝 부정은 그 주제어의 것이다('…게시물을 올리는 계획, 유료 광고 집행은 보류', '…영상에서 가격은 쓰지 않는다').
// 부사어('에는·에서는·까지는·전에는·때는·(으)로는·지금은')와 관형형('있는·하는·되는·같은·주는')은 주제어가 아니고, 따옴표 안 낱말과 '쓰지는 않는다'의 '쓰지는'도 보지 않는다.
// '…는·…던' 낱말 바로 뒤에 조사가 붙은 낱말이 오면 앞 낱말은 관형형이고('순위를 암시하는 표현은', '메뉴라는 표현은', '평점을 높이는 방식은'),
// 뒤 낱말은 대상이 든 관형절이 꾸미는 머리라 새 주제어가 아니다.
const WORD=/[^\s,，]+/g,PARTICLE=/[은는을를]$/,TOPIC=/[은는]$/,MODIFIER=/(?:는|던)$/;
const ADVERBIAL=/(?:에|에서|까지|전에|때|로|으로|에게|부터|뒤에|후에|동안|이번에|다음에|경우에)[은는]$|^(?:지금|현재|우선|당분간|당장|일단|오늘|아직|앞으로|나중|처음|초기|이번|평소)[은는]$/;
const ADNOMINAL=/(?:있|없|않|같|하|되|싶|좋|많)[은는]$|^(?:주|보|가|오|쓰|받|찾|파|먹|넣|담|알|만드|올리|알리|즐기|나오)[은는]$/;
const TAIL_PUNCT='.,!?…。"\'’”」』]';
// 끝 문장부호·닫는 따옴표와 끝 괄호 주석('쓰지 않는다(근거 확인 전).')을 벗긴 서술부.
export function predicateOf(clause:string){
 let t=clause.trimEnd();
 for(;;){
  const last=t.at(-1)||'',open=last===')'||last==='）'?Math.max(t.lastIndexOf('('),t.lastIndexOf('（')):-1;
  if(last&&TAIL_PUNCT.includes(last))t=t.slice(0,-1).trimEnd();
  else if(open>=0)t=t.slice(0,open).trimEnd();
  else return t;
 }
}
// 정렬된 xs에서 x 이하인 마지막 원소의 위치(없으면 -1).
function lastAtOrBefore(xs:number[],x:number){
 let lo=0,hi=xs.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(xs[mid]<=x)lo=mid+1;else hi=mid}
 return lo-1;
}
// 문장 분석(따옴표 구간·절 경계·콜론 위치)은 문장마다 한 번만 한다. 대상마다 문장 끝까지 다시 훑으면 긴 나열에서 제곱 시간이 된다.
// 따옴표 안의 연결 어미('싸고 맛있는')는 절 경계가 아니다. 한 문장의 대상 위치들은 연달아 판정되므로 마지막 문장 하나만 기억한다.
// heads·topics: 따옴표 밖 은/는/을/를 낱말(부사어·관형형 제외)의 조사 위치와 그 가운데 새 주제어가 될 수 있는 은/는 위치(관형절의 머리 제외).
// topicHeads: heads 가운데 은/는 낱말(관형절의 머리 포함)인지.
type Sentence={quotes:{start:number;end:number}[];quoteStarts:number[];cuts:number[];cutEnds:number[];colons:number[];heads:number[];topicHeads:boolean[];topics:number[]};
type Word={w:string;start:number;at:number};
function particleWords(s:string,inQuote:(i:number)=>boolean){
 const words:Word[]=[...s.matchAll(WORD)].map(m=>({w:m[0],start:m.index!,at:m.index!+m[0].length-1}));
 const marked=(x:Word)=>PARTICLE.test(x.w)&&!inQuote(x.at)&&!ADVERBIAL.test(x.w)&&!ADNOMINAL.test(x.w)&&!(/지[은는]$/.test(x.w)&&/^\s?(?:않|못|말)/.test(s.slice(x.at+1,x.at+4)));
 const modifies=(i:number)=>MODIFIER.test(words[i].w)&&i+1<words.length&&!/[,，]/.test(s.slice(words[i].at+1,words[i+1].start))&&marked(words[i+1]);
 return words.flatMap((x,i)=>marked(x)&&!modifies(i)?[{...x,head:i>0&&modifies(i-1)}]:[]);
}
function analyze(s:string):Sentence{
 const quotes=quoteSpans(s),quoteStarts=quotes.map(q=>q.start);
 const inQuote=(i:number)=>{const k=lastAtOrBefore(quoteStarts,i);return k>=0&&i<quotes[k].end};
 const cuts=[...s.matchAll(new RegExp(CLAUSE_END.source,'g'))].filter(m=>!inQuote(m.index!)),words=particleWords(s,inQuote);
 return {quotes,quoteStarts,cuts:cuts.map(m=>m.index!),cutEnds:cuts.map(m=>m.index!+m[0].length),colons:[...s.matchAll(/[:：]/g)].map(m=>m.index!),heads:words.map(x=>x.at),topicHeads:words.map(x=>TOPIC.test(x.w)),topics:words.filter(x=>TOPIC.test(x.w)&&!x.head).map(x=>x.at)};
}
function lastSentence(fn:(s:string)=>Sentence){
 let last:{s:string;value:Sentence}|undefined;
 return (s:string)=>{if(last?.s!==s)last={s,value:fn(s)};return last.value};
}
const sentenceOf=lastSentence(analyze);
function quotedUse(s:string,a:Sentence,start:number){
 const k=lastAtOrBefore(a.quoteStarts,start),q=k>=0&&start<a.quotes[k].end?a.quotes[k]:undefined;
 return !!q&&QUOTED_USE.test(s.slice(q.end+1,q.end+61));
}
// [from,end)에 새 주제어(은/는)가 있는지. 위치 목록은 정렬돼 있어 이분 탐색으로 찾는다.
const topicIn=(a:Sentence,from:number,end:number)=>{const t=lastAtOrBefore(a.topics,from-1)+1;return t<a.topics.length&&a.topics[t]<end};
// 대상의 절 끝. 대상 명사구의 머리가 주제어(은/는)로 그 절 안에 있으면, 절 서술부가 표현 사용이 아니고('검토하되', '확인한 뒤') 다음 절에 새 주제어가 없는 동안
// 주제어가 이어진다('판매 1위 표현은 자료가 오면 검토하되, 지금은 쓰지 않는다'). '…에만 쓰고, 그 전에는 쓰지 않는다'처럼 앞 절이 사용 서술이면 잇지 않는다.
const USED=/(?:쓰|쓴|써|사용하|사용한|넣|넣은|적|올리|올린|알리|알린|게시하|노출하|강조하|소개하|홍보하|내세우)[가-힣]{0,3}$/;
// 절 서술부가 이미 부정·보류면('…까지 보류하고, 자연 유입 게시물만 올린다') 거기서 끝난다. 긴 문장에서 제곱 시간이 되지 않게 최대 3절까지만 잇는다.
const JOIN_LIMIT=3;
function clauseEnd(s:string,a:Sentence,from:number){
 let k=lastAtOrBefore(a.cuts,from-1)+1;
 const h=lastAtOrBefore(a.heads,from-1)+1,persists=h<a.heads.length&&a.topicHeads[h],last=k+JOIN_LIMIT;
 const joins=(k:number)=>{const p=predicateOf(s.slice(Math.max(from,a.cutEnds[k]-40),a.cutEnds[k]));return !USED.test(p)&&!FINAL_NEGATION.test(p.slice(-24))};
 while(persists&&k<last&&k<a.cuts.length&&a.heads[h]<a.cuts[k]&&joins(k)&&!topicIn(a,a.cutEnds[k],k+1<a.cuts.length?a.cutEnds[k+1]:s.length))k++;
 return k<a.cuts.length?a.cutEnds[k]:s.length;
}
// [from,end)에서 대상 명사구의 머리 뒤에 새 주제어가 있는지.
function otherTopic(a:Sentence,from:number,end:number){
 const h=lastAtOrBefore(a.heads,from-1)+1;
 return h<a.heads.length&&a.heads[h]<end&&topicIn(a,a.heads[h]+1,end);
}
// 대상이 속한 절(from부터 다음 연결 어미까지)의 끝 서술부만 본다. 표현 사용의 부정·금지(FAR_NEGATION)는 거리와 무관하다.
// 단독 '보류·삭제·제외'는 대상 뒤 40자 안이고 그 사이에 따옴표 나열이 아닌 쉼표가 없을 때만 대상의 것이다('헤드라인은 ‘지금 구매하세요’, 서브 문구는 보류한다').
const PLAIN_COMMA=/[,，](?!\s?[‘“'"「『])/;
function clauseNegated(s:string,a:Sentence,from:number){
 const end=clauseEnd(s,a,from);
 if(otherTopic(a,from,end))return false;
 const start=Math.max(from,end-200),predicate=predicateOf(s.slice(start,end)),tail=predicate.slice(-24),m=FINAL_NEGATION.exec(tail);
 if(!m)return false;
 if(FAR_NEGATION.test(tail))return true;
 const at=start+predicate.length-tail.length+m.index;
 return at-from<=SCOPE&&!PLAIN_COMMA.test(s.slice(from,at));
}
function negLabel(s:string,a:Sentence,start:number){
 const k=lastAtOrBefore(a.colons,start-1);
 return k>=0&&NEG_LABEL.test(s.slice(Math.max(0,a.colons[k]-30),a.colons[k]+1));
}
// s는 neutralize를 거친 문장, [start,end)는 대상 표현의 위치다.
// 대상 앞 금지·거절 수식('금지된 “당일 전량 소진” 표현이 … 포함됨', '거절된 ‘…’ 주장')은 대상을 금지 대상으로 가리킨다(R3 기준선 S2 중단 조건 실측).
const PRE_NEGATION=/(?:금지된|금지\s?대상인|거절된|사용\s?금지된|쓰면\s?안\s?되는|써서는\s?안\s?되는)\s?[“‘"'「『]?$/;
// 주장이 아닌 언급(R3 기준선 S3 실측): 따옴표 안이 주의·금지 규칙 이름('‘할인 마감 문구 주의’ 버전 1', '「할인 마감 문구 주의」')이거나,
// 대상 뒤가 '여부'('레벨 테스트의 무료 여부')이거나, 대상이 주제어인 절이 '확정 사실이 아니다'로 이어지면('‘무료 레벨 테스트’는 … 확정 사실이 아니므로') 사용이 아니다.
// '무료인가요?'처럼 대상을 묻는 질문의 서술부('인가요·인지·일까요·입니까')도 '여부'와 같다(S3 FAQ 질문).
const RULE_NAME=/(?:주의|금지|경고|보류|피하기|자제)\s*$/,WHETHER=/^[’”"」』]?\s?(?:(?:제공\s?|적용\s?)?여부|인가요|인지|일까요|입니까)/;
const TOPIC_NOT_FACT=/^[^.,’”"」』]{0,20}?[’”"」』]?\s?(?:은|는|도|(?:이)?라는\s?(?:표현|주장|문구)은)[^.]{0,60}?(?:(?:확정|확인된|검증된)\s?(?:사실|정보|혜택)(?:이|가)?\s?아니|(?:확정|확인|검증)(?:되지|하지)\s?않(?:았|은|는|으|아)|(?:확정|확인된|검증된)\s?사실\s?(?:목록|원장)?(?:에는|에|엔)?\s?없)/;
// 캠페인·브리프 목표 원문 인용('캠페인 목표는 ‘… 무료 레벨 테스트 상담 신청을 늘린다’이며')도 입력 인용이다. '메시지 목표는 ‘…’'는 제작 계획이라 아니다.
const GOAL_CITE=/(?:캠페인|브리프(?:의)?|사업)\s?목표(?:는|은|:|：)\s?$/;
// 인용 뒤 '(이)라는 목표(행동)'도 목표 인용이다('‘무료 레벨 테스트 상담 신청’이라는 목표 행동을 … 분리하지 않은 점'). '(이)라는 문구로 광고를 만든다'는 아니다.
const GOAL_CITE_AFTER=/^(?:이)?라는\s?(?:캠페인\s?)?목표/;
// 둘러싼 따옴표는 문장 분석의 인용 구간(이분 탐색)으로 찾는다. 긴 금지 나열에서 매 대상마다 인용을 다시 훑지 않게 한다(제곱 시간 방지).
function inRuleName(s:string,a:Sentence,start:number){
 const k=lastAtOrBefore(a.quoteStarts,start),q=k>=0&&start<a.quotes[k].end?a.quotes[k]:undefined;
 return !!q&&(RULE_NAME.test(s.slice(q.start,q.end))||GOAL_CITE.test(s.slice(Math.max(0,q.start-17),q.start-1))||GOAL_CITE_AFTER.test(s.slice(q.end+1,q.end+12)));
}
export function negatedAt(s:string,start:number,end:number){
 const a=sentenceOf(s);
 if(PRE_NEGATION.test(s.slice(Math.max(0,start-14),start)))return true;
 if(inRuleName(s,a,start)||WHETHER.test(s.slice(end,end+8))||TOPIC_NOT_FACT.test(s.slice(end,end+100)))return true;
 if(negLabel(s,a,start))return true;
 if(quotedUse(s,a,start))return false;
 const from=end+(LIST_TAIL.exec(s.slice(end,end+SCOPE))?.[0].length||0),after=s.slice(from,from+SCOPE),cut=CLAUSE_END.exec(after);
 return STRONG.test(cut?after.slice(0,cut.index+cut[0].length):after)||WEAK.test(after)||clauseNegated(s,a,from);
}
// 라벨·제목·표 머리칸이 통째로 금지·보류 목록인지. 가운뎃점·빗금·쉼표·'및·또는'·'과/와'로 나눈 항목이 모두 금지·보류 항목이거나 보조 항목(이유·근거 등)이고 금지 항목이 하나 이상이어야 한다.
// 금지 항목은 금지·보류 서술로 끝나는 항목이다('금지 표현', '보류', '사용하지 않을 표현', '게시 보류'). '보류 해제 후 실행', '보류 없이 바로 진행', '삭제 요청 대응 뒤 게시할 후기 이벤트',
// '할인 제외 상품 홍보 문안', '보류 여부', '보류 사유'처럼 금지어 뒤에 다른 말이 이어지면 금지 항목이 아니다. '대체 문구·대체 카피'는 실제로 쓸 카피라 보조 항목이 아니다.
// '채널 역할·…·금지 표현·…'(계약 제목), '추천안·나머지 안 보류 이유', '선택/제외'(결정 칸)처럼 다른 항목과 섞이면 금지 맥락이 아니다.
// 조건 주석 괄호('(할인 제외)')는 지우고, 괄호 전체가 금지·보류 한 낱말('(사용 금지)', '(보류)')이면 라벨의 일부로 본다. 그 밖의 괄호('(인기·1위 등)', '(보류 해제)', '(근거 없는 표현 삭제)')는 뺀다.
const PROHIBITIVE=/(?:금지|보류|삭제|제외|배제|피할|(?:사용|쓰|넣|하)지\s?않(?:을|는)?)\s?(?:표현|문구|카피|문안|단어|어휘|어|키워드|항목|목록|사항|대상|것|행위)?$/;
// 실패·중단·위반 판정 칸('실패 기준', '중단 조건', '위반 사례')도 규칙 목록이지 사용이 아니다.
const FAILURE_LABEL=/^(?:실패|중단|위반|탈락|불합격|위험)\s?(?:기준|조건|사례|신호|예시|요소)$/;
const BARE_LABEL=/^\s*(?:사용|게시|노출|진행|집행)?\s?(?:금지|보류|삭제|제외)\s*$/;
const AUXILIARY=/^(?:이유|사유|근거|기준|목록|예시|처리|조치|조건|대안)$/;
const LABEL_ITEMS=/[·ㆍ/,，]|\s(?:및|또는|그리고)\s|(?<=[가-힣])(?:과|와)\s/;
// 합성 라벨: 판정어를 가운뎃점·빗금·쉼표로 잇고 공통 접미('기준' 등)를 끝에 한 번 쓴 칸('탈락·수정 기준', '실패/중단 조건')은 판정어마다 접미를 붙여 본다.
// 모든 판정어가 실패 판정(FAILURE_LABEL)이거나 그 곁말(FAILURE_COMPANION: 수정·반려·보완·재작업·보류 기준)이고 실패 판정이 하나 이상이면 규칙 칸이다.
// 곁말만 있거나('수정 기준') 합격이 섞이면('합격·수정 기준') 규칙 칸이 아니다(2026-09-25 ODA 전략 재채점 실측).
const SHARED_SUFFIX=/^([가-힣]{1,4}(?:\s?[·ㆍ/,，]\s?[가-힣]{1,4})+)\s?(기준|조건|사례|신호|예시|요소)$/;
const FAILURE_COMPANION=/^(?:수정|반려|보완|재작업|보류)\s?(?:기준|조건|신호)$/;
function compoundFailureLabel(label:string){
 const m=SHARED_SUFFIX.exec(label.trim());
 if(!m)return false;
 const parts=m[1].split(/[·ㆍ/,，]/).map(x=>`${x.trim()} ${m[2]}`);
 return parts.some(x=>FAILURE_LABEL.test(x))&&parts.every(x=>FAILURE_LABEL.test(x)||FAILURE_COMPANION.test(x));
}
export function prohibitiveLabel(label:string){
 if(compoundFailureLabel(neutralize(label)))return true;
 const items=neutralize(label).replace(/[(（]([^()（）]*)[)）]/g,(m,inner:string)=>BARE_LABEL.test(inner)?` ${inner} `:' ').split(LABEL_ITEMS).map(x=>x.trim()).filter(Boolean);
 const banned=(x:string)=>PROHIBITIVE.test(x)||FAILURE_LABEL.test(x);
 return items.some(banned)&&items.every(x=>banned(x)||AUXILIARY.test(x));
}
// 표현을 공백·대소문자와 무관하게 찾는 정규식. 정규식 특수문자는 글자로 본다.
export const termPattern=(term:string)=>new RegExp(term.replace(/\s+/g,'').split('').map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*'),'gi');
const empty=(term:string)=>!term.replace(/\s+/g,'');
export const mentions=(sentence:string,term:string)=>!empty(term)&&termPattern(term).test(sentence);
// 표현이 부정·배제 없이 쓰인 곳이 하나라도 있으면 true. within이 있으면 그 위치(예: 따옴표 안)의 표현만 본다.
export function usesTerm(sentence:string,term:string,within?:(at:number)=>boolean){
 if(empty(term))return false;
 const s=neutralize(sentence);
 return [...s.matchAll(termPattern(term))].some(m=>(!within||within(m.index!))&&!negatedAt(s,m.index!,m.index!+m[0].length));
}
