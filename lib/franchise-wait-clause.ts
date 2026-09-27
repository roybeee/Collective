// 트랙 R R2 3차: 대기기간 절 단위 구성 판정(COLLECTIVE 휴리스틱 · 법률 자문 아님, 결정 20 보류).
// 가맹사업법 제7조③·제11조①: 정보공개서·가맹계약서안을 받은 날부터 14일(변호사·가맹거래사 자문을 받았으면 7일)이 지나기 전에는 계약·가맹금 수령을 못 한다.
// 문장 하나를 통째 패턴으로 보지 않고, 문서(정보공개서·계약서안)·행위(계약·서명·가맹금)·때(날짜·기간·당일·현장)·틀(경고·인용·묻고 답하기·대비)을 따로 읽어 조합한다.
// 1) 구성 적중(waitComposition): 대기기간 우회 규칙(h.wait_bypass_solicitation)의 패턴이 못 잡은 오기재를 더한다(해제 불가 id 그대로, 결정 25).
//    계약 당일 문서 전달, 대기기간 면제 틀, 설명회·박람회 현장 계약·가맹금, 표·화살표·영어로 적은 짧은 기간, 날짜·요일 계산, 앞 문장의 규칙을 뒤 문장이 뒤집는 대비, 우회 문구를 따와서 권하는 문장, 가맹금 먼저 받기.
// 2) 경고 틀(waitWarningFrame): 우회 문구를 따오거나 가리킨 뒤 경고로 끝나는 문장('…같은 말은 믿지 마세요', '…위반 소지가 있습니다', '…라고 하면 그 자리를 떠나세요')은 권유가 아니다.
//    대기기간 우회·본사 연계 자문 규칙의 적중에서 뺀다. 같은 문장에 '저희는 가능' 같은 대비나 압박이 있으면 빼지 않는다.
// 3) 묻고 답하기(answerDenies): '아니요'로 시작하지 않아도 답이 막는 말('…받지 않습니다', '…지난 후 진행합니다')이면 질문 속 표현을 주장으로 보지 않는다. 답 자체는 따로 판정한다.
// 이 모듈은 판정 보기(lib/franchise-compliance.ts matchView)를 받는다. 모델 입력·프롬프트와 무관하다. 패턴 규칙은 끝내 완전하지 않고 마지막 확인은 승인자다.

export type ClauseSentence={readonly s:string;readonly raw:string;readonly line:number;readonly parts?:readonly string[]};
export type WaitCompositionKind='same_day_document'|'waiver'|'onsite_contract'|'short_period'|'date_gap'|'contrast'|'quote_endorse'|'early_fee';
export type WaitComposition={kind:WaitCompositionKind;sentence:ClauseSentence};

// ── 낱말 묶음 ──
const DOC='(?:정보\\s?공개서|(?<![가-힣])공개서|(?<![가-힣])정공서|(?:가맹\\s?)?계약서\\s?(?:초\\s?)?안|FDD|[Dd]isclosure)';
const WAIT_TERM='(?:대기\\s?기간|숙려(?:\\s?기간)?|검토\\s?기간|대기\\s?(?:규정|의무|절차)|14\\s?일\\s?(?:대기|규정|규칙|룰)|2\\s?주\\s?(?:대기|규정|규칙))';
const FEE='(?:가맹비|가맹금|계약금|가계약금|예약금|가입비|교육비|보증금)';
const ACT=`(?:계약|체결|서명|사인|도장|${FEE}|입금|납부|결제|contract|sign)`;
const ADVICE='(?:자문|변호사|가맹\\s?거래사)';
const ADVICE_OFF='(?:자문|변호사|가맹\\s?거래사)\\s?(?:을|를|은|는|이|가)?\\s?(?:여부\\s?(?:와|과|에)?\\s?)?(?:없이|없어도|안\\s?받|받지\\s?않|무관|관계\\s?없|상관\\s?없|생략|불필요|필요\\s?없)';
const LONG='(?:D\\s?\\+\\s?(?:1[4-9]|[2-9]\\d)|(?<![\\d])(?:1[4-9]|[2-9]\\d)\\s?일|(?<![\\d])[2-9]\\s?주|보름|열나흘|이\\s?주(?:일)?)';
const US='(?:(?:저희|우리|당사)(?:\\s?(?:브랜드|본사|회사|쪽|측|매장))?|본사)';
// 막는 말(부정·금지·기다림·지킴). 구성 적중은 같은 문장에 이런 말이 있으면 성립하지 않는다(경고는 경고 틀이 본다).
const CAUTION_IMP='(?:미루|피하|거절하|거부하|조심하|주의하|의심하)(?:세요|십시오)';
const DENY=`(?:않|못\\s|못합|(?<!(?:필요|문제|걱정|상관|부담|지장)\\s?(?:가|는|도|이)?\\s?)없(?:습니다|어요|음)|불가|금지|위반|불법|위법|안\\s?됩니다|안\\s?돼요|${CAUTION_IMP}|지나야|지난\\s?(?:후|뒤|다음)|기다려야|기다리셔야|지킵|지켜|준수|예외\\s?없이|말고|마세요|마십시오)`;
const CONTRAST_US=`(?:${US}\\s?(?:는|만|은|쪽은|의\\s?경우|측은))`;
const ENABLE_STRONG='(?:바로|즉시|곧바로|당장|예외|생략|신경\\s?(?:안|쓰지)|없이도|(?:절차|기간|대기)\\s?없이|승인으로|필요\\s?(?:없|가\\s?없)|상관\\s?없|문제\\s?(?:없|안\\s?됩)|괜찮|특별\\s?(?:케이스|사례|처리)|재량|무시|건너뛰|패스)';
const ENABLE_WEAK='(?:가능(?:합니다|해요|하죠|함)|됩니다|돼요|되요|처리해\\s?드립니다|해\\s?드립니다)';

const re=(p:string,f='')=>new RegExp(p,f);
const DOC_RE=re(DOC),WAIT_RE=re(WAIT_TERM),ACT_RE=re(ACT),DENY_RE=re(DENY),LONG_RE=re(LONG),ADVICE_RE=re(ADVICE),ADVICE_OFF_RE=re(ADVICE_OFF);
const hasAdvice=(s:string)=>ADVICE_RE.test(s)&&!ADVICE_OFF_RE.test(s);

// ── 경고 틀 ──
// 문장 끝: 위반 소지·사실과 다름·믿지 마세요·그 자리를 떠나세요·다시 검토하세요·전문 기관에 문의하세요·거짓입니다·속지 마세요·입금하지 마세요.
const WARN_END_RE=re('(?:(?:위반|불법|위법)\\s?(?:소지|가능성|우려|여지)(?:가|이)?\\s?(?:있(?:습니다|어요|음)|큽니다|높습니다)|사실과\\s?다릅니다|사실이\\s?아닙니다|믿지\\s?(?:마세요|마십시오|마시기\\s?바랍니다)|(?:그\\s?)?자리를\\s?(?:떠나|뜨)(?:세요|십시오)|다시\\s?(?:검토|생각|확인)(?:해\\s?보|하)(?:세요|십시오|시길\\s?(?:바랍니다|권합니다))|(?:공정거래\\s?조정원|조정원|공정위|공정거래\\s?위원회|전문가|변호사|가맹\\s?거래사)(?:에|에게|께|과|와)?\\s?(?:먼저\\s?)?(?:문의|상담|신고|확인)(?:하|해\\s?보)(?:세요|십시오)|의심해\\s?(?:보세요|보십시오)|(?:거짓|허위|거짓말)(?:입니다|이에요|예요)|속지\\s?마세요|(?:입금|송금|서명|사인|계약|결제)(?:하)?지\\s?마(?:세요|십시오))[.!~\\s]*(?:$|[,;]\\s?(?<rest>[^,;]{0,40})$)');
// 하지 말라는 명령은 문장 가운데여도 경고다('…을 유도하는 상담이라면 서명하지 말고 서류만 챙겨 나오세요').
const WARN_ANY_RE=re('(?:입금|송금|서명|사인|계약|결제|납부)(?:을\\s?|를\\s?)?(?:하)?지\\s?(?:말고|마시고|마세요|마십시오)');
// 바른 금지 서술로 끝나는 문장('가계약금·예약금·상권 선점금도 가맹금에 해당하므로 대기기간 중에는 받을 수 없습니다'). 조건절('…하시면')이 앞에 있으면 아니다.
const PROHIBIT_END_RE=re('(?:받|수령하|요구하|계약하|체결하)(?:을\\s?수\\s?(?:는\\s?)?없|지\\s?않)(?:습니다|어요|음)[.!~\\s]*$');
const CONDITIONAL_RE=re('(?:시면|으면|하면|면\\s)');
// 따오거나 가리킨 표지: 따옴표, '…라는·다는·자는 말·제안', '…라고 하면·한다면', '…요구가 있으면', '…하는 것은', '같은 말·문구'.
const REPORT_RE=re('["\'“”‘’「」『』]|(?:라는|다는|이라는|자는|냐는|라고|다고|자고|하자고|하라고|라며|다며|이라며)(?:\\s|$)|(?:요구|권유|제안|요청|안내|말|설명)(?:가|이|을|를)?\\s?(?:있으면|있다면|받으면|받는다면|들으면|하면|한다면)|(?:한다면|하면|하시면|한다고\\s?하면)\\s?(?:그|이|해당)?\\s?(?:곳|브랜드|본사|업체)?|(?:하는|하자는|라는|같은)\\s?(?:것은|건|말은|문구는|안내는|제안은|광고는|설명은)|같은\\s?(?:말|문구|안내|제안|광고|표현)');
const PRESSURE_RE=re('(?:놓치|뺏기|빼앗기|밀리|늦으면|늦기\\s?전|서두르|마감|선착순|지금\\s?(?:바로\\s?)?(?:입금|계약)|안\\s?하시면|않으시면)');
const US_ENABLE_RE=re(`${CONTRAST_US}[^.\\n]{0,30}?(?:${ENABLE_STRONG}|${ENABLE_WEAK})`);
export function waitWarningFrame(x:ClauseSentence):boolean{
 if(x.parts)return false;
 const s=x.s;
 // 압박·'저희는 가능' 대비는 따온 문구 밖에서만 본다('"저희만 예외로 바로 계약 가능하다"는 말은 믿지 마세요'의 따온 문구는 경고 대상이다).
 const unquoted=x.raw.replace(/["'“”‘’「」『』][^"'“”‘’「」『』\n]{1,80}["'“”‘’「」『』]/g,' ');
 if(PRESSURE_RE.test(unquoted)||US_ENABLE_RE.test(unquoted))return false;
 const reported=REPORT_RE.test(x.raw)||REPORT_RE.test(s);
 // 바른 금지 서술로 끝나고 조건절·대비가 없는 문장.
 // 자문자가 든 문장('본사 지정 가맹거래사 외에는 계약하지 않습니다')은 본사 연계 자문 강제일 수 있어 보지 않는다.
 if(PROHIBIT_END_RE.test(s)&&!CONDITIONAL_RE.test(s)&&!ADVICE_RE.test(s)&&!/(?:지만|는데|으나|다만|외에는|말고는|아니면)/.test(s))return true;
 if(WARN_ANY_RE.test(s)&&reported)return true;
 const end=WARN_END_RE.exec(s);
 if(!end)return false;
 // 경고 뒤 짧은 절('…믿지 마세요, 예외는 없습니다')은 되는 쪽 말('가능·됩니다·바로')이 없을 때만 받는다.
 const rest=end.groups?.rest;
 if(rest&&re(`${ENABLE_STRONG}|${ENABLE_WEAK}`).test(rest)&&!DENY_RE.test(rest))return false;
 // 문장 끝 경고의 앞(따온 우회 문구)에 따옴·가리킴 표지가 있거나, 끝 자체가 하지 말라는 명령이면 경고 틀이다.
 return reported||/(?:마세요|마십시오|떠나세요|문의하세요|검토하세요)[.!~\s]*$/.test(end[0].replace(/[,;].*$/,''));
}

// ── 묻고 답하기 ──
const ANSWER_HEAD=/^\s*(?:(?:A|답|답변)\s?[.:：)]\s*)?/;
const ANSWER_LIMIT_RE=re('(?:받|하|드리|운영하|진행하|요구하|허용하|체결하)지\\s?(?:는\\s?)?않|(?:할|하실|받을|받으실|드릴)\\s?수\\s?(?:는\\s?)?없|불가|금지|지나야|지난\\s?(?:후|뒤|다음|이후)|기다리셔야|기다려야|이후에?\\s?(?:만\\s?)?(?:진행|가능|계약)|해당하(?:므로|기\\s?때문에|여)|(?<!\\d)(?:1[4-9]|[2-9]\\d)\\s?일\\s?(?:이\\s?)?(?:전|이전|지나|지난|후|뒤|이후)|(?<!\\d)2\\s?주\\s?(?:전|후|뒤|이후)|(?:정보\\s?공개서|공개서)만\\s?(?:드리|드립|제공)|지킨\\s?(?:후|뒤|다음)|지켜야|준수(?:합니다|하여|해서|한\\s?(?:후|뒤))');
const ANSWER_AFFIRM_RE=/^\s*(?:(?:A|답|답변)\s?[.:：)]\s*)?(?:네|예|물론|그럼요|당연|가능합니다|됩니다)/;
const ANSWER_TURN_RE=re(`(?:지만|는데|으나|다만|하지만|그래도|그런데)[^.\\n]{0,40}?(?:${ENABLE_STRONG}|${ENABLE_WEAK})|${CONTRAST_US}[^.\\n]{0,30}?(?:${ENABLE_STRONG}|${ENABLE_WEAK})`);
export function answerDenies(raw:string):boolean{
 const body=raw.replace(ANSWER_HEAD,'');
 return ANSWER_LIMIT_RE.test(body)&&!ANSWER_AFFIRM_RE.test(raw)&&!ANSWER_TURN_RE.test(body);
}

// ── 기간 읽기 ──
const KO_DAYS:Record<string,number>={하루:1,이틀:2,사흘:3,나흘:4,닷새:5,엿새:6,이레:7,열흘:10};
const PERIOD_RE=/D\s?\+\s?(\d{1,2})|(\d{1,2})\s?(?:영업\s?)?(?:일|days?)(?![가-힣])|(\d{1,2})\s?(?:일(?=\s?(?:만에|이면|뒤|후|내|이내|안에|째|차)))|(\d)\s?(?:주일?|weeks?)(?![가-힣])|(일주일|한\s?주|1\s?week)|(하루|이틀|사흘|나흘|닷새|엿새|이레|열흘)/g;
function periodsOf(s:string):number[]{
 const out:number[]=[];
 for(const m of s.matchAll(PERIOD_RE)){
  const d=m[1]??m[2]??m[3];
  if(d)out.push(Number(d));else if(m[4])out.push(Number(m[4])*7);else if(m[5])out.push(7);else if(m[6])out.push(KO_DAYS[m[6]]);
 }
 return out;
}
// 14일(자문 시 7일)은 기간을 채운 표기로 본다(저장소 말뭉치의 바른 문장 'D+14 이후 계약 가능'과 같게).
const tooShort=(days:number,s:string)=>days<(hasAdvice(s)?7:14)&&days>=0;

// ── 날짜 읽기 ──
type DateTok={at:number;end:number;month?:number;day?:number;year?:number;weekday?:number;week?:number};
const WEEKDAYS='월화수목금토일';
const DATE_RE=/(?:(\d{4})\s?[-.년/]\s?)?(\d{1,2})\s?(?:월|[/.]|(?<=\d{4}\s?[-.]\s?\d{1,2})-)\s?(\d{1,2})\s?일?(?![\d])|((?:다다음|다음|담|차|이번|금)\s?주\s?)?([월화수목금토일])요일/g;
function datesOf(s:string):DateTok[]{
 const out:DateTok[]=[];
 for(const m of s.matchAll(DATE_RE)){
  const at=m.index!,end=at+m[0].length;
  if(m[2]){const month=Number(m[2]),day=Number(m[3]);if(month>=1&&month<=12&&day>=1&&day<=31)out.push({at,end,month,day,year:m[1]?Number(m[1]):undefined})}
  else if(m[5])out.push({at,end,weekday:WEEKDAYS.indexOf(m[5]),week:!m[4]?0:/다다음/.test(m[4])?2:/다음|담|차/.test(m[4])?1:0});
 }
 return out;
}
const dayNumber=(t:DateTok,year:number)=>Date.UTC(t.year??year,(t.month??1)-1,t.day??1)/86400000;
function gapDays(doc:DateTok,act:DateTok):number|null{
 // 요일만 적었고 계약 요일이 앞이면('금요일에 받고 주말 지나 월요일에 사인') 다음 주로 본다.
 if(doc.weekday!==undefined&&act.weekday!==undefined){const g=((act.week??0)-(doc.week??0))*7+act.weekday-doc.weekday;return g<0&&!act.week&&!doc.week?g+7:g}
 if(doc.month===undefined||act.month===undefined)return null;
 const y=doc.year??2026,a=dayNumber(doc,y);
 let b=dayNumber({...act,year:act.year??y},y);
 if(act.year===undefined&&b<a&&(act.month<doc.month))b=dayNumber({...act,year:y+1},y);
 return b-a;
}
// 날짜 하나의 역할(문서 날·계약 날). 날짜는 원문 문장에서 읽는다(판정 보기는 '9/1'을 '91'로 붙인다).
const DOC_WORD_RE=re(`${DOC}|서류|교부|발송|수령`,'g'),ACT_WORD_RE=re('계약(?!\\s?(?:상담|문의|안내|절차\\s?안내))|체결|서명|사인|가맹비|가맹금|계약금|입금|납부|결제|contract','g');
function roleOf(s:string,t:DateTok,from:number,to:number):'doc'|'act'|null{
 const seg=s.slice(from,to),at=t.at-from;
 // 라벨 바로 뒤 값('교부일: 10월 1일 / 계약일: 10월 3일')은 라벨이 역할이다.
 const head=seg.slice(Math.max(0,at-12),at);
 if(/(?:계약|체결|서명|입금|납부|결제)\s?(?:일|날짜|예정일)?\s?[:：=]?\s?$/.test(head))return 'act';
 if(/(?:공개서|교부|발송|수령|제공|전달)\s?(?:일|날짜)?\s?[:：=]?\s?$/.test(head))return 'doc';
 // 날짜 뒤(다음 날짜 전까지)에 먼저 오는 낱말이 역할이다('10/1 정보공개서 발송, 10/5 계약'). 뒤에 없으면 앞의 가장 가까운 낱말('계약금 입금은 3월 9일까지').
 const after=seg.slice(at+t.end-t.at);
 const docA=[...after.matchAll(DOC_WORD_RE)][0]?.index??-1,actA=[...after.matchAll(ACT_WORD_RE)][0]?.index??-1;
 if(docA>=0||actA>=0)return actA<0||(docA>=0&&docA<actA)?'doc':'act';
 const before=seg.slice(0,at),docB=[...before.matchAll(DOC_WORD_RE)].pop()?.index??-1,actB=[...before.matchAll(ACT_WORD_RE)].pop()?.index??-1;
 if(docB<0&&actB<0)return null;
 return actB<0||(docB>=0&&docB>actB)?'doc':'act';
}
function dateGapShort(s:string):boolean{
 const ts=datesOf(s);
 if(ts.length<2||!(DOC_RE.test(s)||/서류/.test(s))||!ACT_RE.test(s))return false;
 const roles=ts.map((t,k)=>roleOf(s,t,k?ts[k-1].end:0,k+1<ts.length?ts[k+1].at:s.length));
 // 첫 문서 날과 그 뒤 첫 계약 날을 잇는다.
 const d=roles.indexOf('doc'),a=d<0?-1:roles.indexOf('act',d+1);
 if(a<0)return false;
 const doc=ts[d],act=ts[a];
 const gap=gapDays(doc,act);
 return gap!==null&&gap<(hasAdvice(s)?7:14)&&!/매주|격주|매월|요일마다/.test(s);
}

// ── 구성 규칙 ──
// 계약하는 날·계약 자리에서 문서를 준다('계약하시는 날 정보공개서를 같이 드립니다', '계약일에 공개서 + 계약서 한 번에').
const CONTRACT_MOMENT=re('(?:계약|체결|서명|사인)\\s?(?:을\\s?|를\\s?)?(?:하시는|하는|하실|할|하러\\s?오시는|진행하는|진행하실)?\\s?(?:날|당일|때|자리|미팅|시(?![가-힣])|현장)|계약\\s?체결\\s?(?:일|날|당일|시|때)|계약일|(?:계약|체결|서명|사인)\\s?(?:직전|바로\\s?전|하기\\s?(?:직전|바로\\s?전))|(?:계약서\\s?(?:쓰기|작성|쓰시기|작성하시기)|계약|서명|사인)\\s?(?:\\d+\\s?(?:분|시간)|몇\\s?(?:분|시간)|잠깐|잠시)\\s?전|계약서\\s?(?:를\\s?)?(?:작성|서명|사인)\\s?(?:하실|하시는|할|하는)?\\s?(?:때|날|자리|시(?![가-힣]))|(?:함께|같이|한꺼번에|한\\s?번에|동시에|일괄)[^.\\n]{0,24}?(?:계약|사인|서명|체결)|(?:계약|사인|서명|체결)[^.\\n]{0,24}?(?:함께|같이|한꺼번에|한\\s?번에|동시에|일괄)');
const BEFORE_MOMENT=re('(?:계약|체결|계약일)[^.\\n]{0,12}?(?:\\d+|열|보름|이)\\s?(?:일|주)[^.\\n]{0,6}?(?:전|이전|앞)|(?:계약|체결)\\s?(?:전에|전까지|이전에|하시기\\s?전)');
const GIVE=re('(?:드리|드립|드려|교부|전달|발송|보내|수령|받|제공|설명|가져|건네|내드|사인|서명|보여|보시|훑어|들으|읽어)');
// 다시 설명·사본 한 부 더·최종본과 비교·받은 날짜 확인·받으셨다면(가정)은 처음 주는 것이 아니다.
const SAME_DAY_NOT=/다시|한\s?번\s?더|한\s?부\s?더|사본|최종본|비교|재확인|날짜(?:를|가)?\s?확인|(?:셨|았|었)다면/;
function sameDayDocument(s:string):boolean{
 return !SAME_DAY_NOT.test(s)&&DOC_RE.test(s)&&CONTRACT_MOMENT.test(s)&&GIVE.test(s)&&!BEFORE_MOMENT.test(s)&&!LONG_RE.test(s)&&!DENY_RE.test(s);
}
// 대기기간을 면제·해당 없음·안 지켜도 되는 것으로 적는다('대기기간은 동의서에 서명하시면 면제됩니다', '14일 대기기간 규정은 해당 없습니다').
const WAIVE=re('(?:면제|해당\\s?(?:사항\\s?)?(?:이\\s?)?없|해당\\s?(?:되지|안\\s?되)|적용\\s?(?:대상이\\s?)?(?:아니|안\\s?됩|되지\\s?않)|안\\s?지켜도|지키지\\s?않아도|필요\\s?없다고\\s?하시면|생략(?:됩|해\\s?드|하셔도|가능)|신경\\s?(?:안|쓰지\\s?않)|포기(?:하시면|하셔도|각서|확인서|동의서)|(?:면제|생략|포기)\\s?(?:확인서|동의서|각서)|가이드\\s?라인|강제(?:는|가)?\\s?(?:아니|아닙)|강제성(?:이|은)?\\s?없|예외로\\s?(?:처리|해\\s?드|적용|진행)|(?:권고|권장|참고)\\s?사항|재량)');
const WAIVE_DENIED=re('(?:면제|생략|포기|단축|예외)\\s?(?:(?:는|은|가|이|도|를|을)\\s?)?(?:되지|할\\s?수|하실\\s?수|될\\s?수|해\\s?드릴\\s?수|받을\\s?수)\\s?(?:는\\s?)?(?:않|없)|예외\\s?없이|면제\\s?(?:대상이\\s?)?아닙|(?:면제|생략)(?:는|은)\\s?없|해당\\s?없는\\s?경우는\\s?없|(?:재량|가이드\\s?라인|권고\\s?사항|권장\\s?사항|참고\\s?사항|선택\\s?사항)(?:이|은|는)?\\s?(?:아닙|아니)|강제\\s?(?:사항|규정)?(?:입니다|이에요)');
function waiver(s:string):boolean{
 return WAIT_RE.test(s)&&WAIVE.test(s)&&!WAIVE_DENIED.test(s)&&!re(CAUTION_IMP).test(s)&&!/(?:위반|불법|위법|믿지\s?마|속지\s?마|사실과\s?다)/.test(s);
}
// 설명회·박람회·상담회 자리의 계약·가맹금('설명회 현장에서 가맹비 입금하시면 특별 할인', '박람회 현장 계약자 선착순').
const VENUE=re('(?:사업\\s?|창업\\s?|가맹\\s?)?(?:설명회|박람회|상담회|창업\\s?(?:쇼|페어|엑스포))|(?:1\\s?:\\s?1\\s?|가맹\\s?|창업\\s?)?상담\\s?(?:자리|현장|당일|때|오시는\\s?날|받으러\\s?오시는\\s?날)');
const ONSITE_PAY=re(`(?:현장|당일|자리|오늘|오시는\\s?날|방문하시는\\s?날|참석하시는\\s?날)[^.\\n]{0,16}?(?:${FEE}|계약(?:자|하시면|하신|\\s?시|\\s?체결|\\s?진행)|계약서\\s?(?:작성|서명|사인)|(?:입금|결제|납부|서명|사인)(?:하시면|하신|\\s?시(?![가-힣])|해\\s?주시면))|(?:${FEE}|계약)[^.\\n]{0,12}?(?:현장|당일)\\s?(?:입금|결제|납부|계약|서명|사인)|${FEE}\\s?(?:을|를)?\\s?(?:준비|지참|챙겨|가져)`);
function onsiteContract(s:string):boolean{
 return VENUE.test(s)&&ONSITE_PAY.test(s)&&!DENY_RE.test(s);
}
// 표·화살표·등호·영어로 적은 짧은 기간('정보공개서 수령 → 계약: 5일', '계약 가능 시점 = 공개서 받은 후 D+3', '검토기간 약 1 week, 이후 바로 contract').
// 번호 단계('① 정보공개서 수령 ② 3일 검토 ③ 계약'), 'D-10 정보공개서 → D-day 계약', 문장 끝 '…받고 계약까지'도 같은 모양이다.
const LAYOUT=/[→⇒>:=|/①②③④⑤⑥⑦⑧⑨⑩]|D\s?[+-]|week|days?|contract|이후\s?바로|그\s?다음\s?날|계약\s?까지|(?:^|\s)\d\s?[).]\s|(?:^|\s)1\s[^\d\n]{2,}\s2\s/;
// 대기기간 표 칸('대기기간: 7일 (자문 없어도 동일)')은 계약 낱말이 없어도 짧은 값이면 오기재다.
const WAIT_CELL=re(`${WAIT_TERM}\\s?[:=|]\\s?`);
function shortPeriod(s:string):boolean{
 if(!(DOC_RE.test(s)||WAIT_RE.test(s))||!(/(?:계약|체결|서명|사인|contract|sign|가맹금|가맹비)/.test(s)||WAIT_CELL.test(s))||!LAYOUT.test(s)||LONG_RE.test(s)||DENY_RE.test(s))return false;
 const ps=periodsOf(s);
 for(const m of s.matchAll(/D\s?-\s?(\d{1,2})(?!\d)/g))ps.push(Number(m[1]));
 if(/그\s?다음\s?날|다음\s?날/.test(s)&&ps.length)ps.push(ps[ps.length-1]+1);
 return ps.length>0&&ps.every(p=>tooShort(p,s));
}
// 우회 문구를 따와서 권한다('"자문 받으면 이틀이면 된다"고 하셨다면 그대로 진행하셔도 됩니다', '"…"는 안내, 저희도 동일하게 적용합니다').
const QUOTED=/["'“”‘’「」『』]([^"'“”‘’「」『』]{2,60})["'“”‘’「」『』]/;
const BYPASS_CUE=re(`${FEE}|선점|${DOC}|${WAIT_TERM}|14\\s?일|생략|면제|예외|나중에|이틀|하루|사흘|바로|빨리|즉시|당일|${ADVICE}|대기`);
const ENDORSE=re('(?:그대로\\s?진행|동일하게\\s?(?:적용|진행|운영)|저희도\\s?(?:같|동일|그렇게|마찬가지)|(?:지금|어서|오늘)\\s?(?:바로\\s?)?(?:입금|계약|결제)하세요|말처럼|공통\\s?(?:전략|비결|노하우)|문제\\s?(?:된|될|된\\s?적)\\s?(?:적|일)?\\s?(?:은|이)?\\s?없|(?:^|\\s)네,|맞습니다|사실입니다|진행하셔도\\s?(?:됩니다|돼요)|믿으셔도|따르시면|추천(?:합니다|드립니다)|정답|공식\\s?입장|사실(?:이에요|이예요|입니다|이죠)|맞(?:아요|죠)|저희도\\s?(?:재량|바로|그대로)|(?:바로|즉시)\\s?진행해\\s?드립)');
// 따온 문구 뒤 같은 문장이나 바로 다음 문장('흔히 "대기기간은 본사 재량"이라고 하죠. 저희도 재량껏 바로 진행해 드립니다.')이 권하면 따와서 권하는 문장이다.
function quoteEndorse(x:ClauseSentence,next?:ClauseSentence):boolean{
 const q=QUOTED.exec(x.raw);
 if(!q||!BYPASS_CUE.test(q[1]))return false;
 const outside=x.raw.slice(0,q.index)+' '+x.raw.slice(q.index+q[0].length)+(next&&next.line<=x.line+1?' '+next.raw:'');
 // 경고로 끝나도 따온 문구 밖에서 '저희는 바로 됩니다'로 뒤집으면('…는 말은 믿지 마세요, 저희는 바로 됩니다') 권하는 문장이다.
 if(US_ENABLE_RE.test(outside)&&!B_DENY.test(outside))return true;
 return ENDORSE.test(outside)&&!WARN_END_RE.test(x.s)&&!WARN_ANY_RE.test(x.s)&&!(next&&(WARN_END_RE.test(next.s)||DENY_RE.test(next.s)));
}
// 가맹금을 이름을 바꾸거나 먼저·절반·다른 계좌로 받는다('가맹비는 계약 전 교육 예약비 명목으로 먼저 받습니다', '가맹금은 대표 개인 계좌로 먼저 보내주시면', '사전 협약서로 묶어두고 가맹비 절반 받습니다').
const EARLY_FEE=re(`(?:가맹비|가맹금)[^.\\n]{0,30}?(?:먼저|미리|선결제|선납|지금|절반|일부|명목|개인\\s?계좌|계약\\s?전)[^.\\n]{0,24}?(?:받|보내|입금|결제|내|송금|납부)|(?:사전\\s?(?:협약서|계약서|약정서)|가\\s?계약서|확약서|예비\\s?계약서)[^.\\n]{0,30}?(?:묶|받|가맹비|가맹금|입금|계약금)|날짜\\s?(?:칸|란)?\\s?(?:을|는|은)?\\s?(?:비워|비우|공란)[^.\\n]{0,20}?(?:사인|서명|날인|도장)`
 // 의향서·예약서에 서명하고 보증금·예약금을 넣어 두게 한다, 대기기간 중 이름을 바꾼 돈(확보비·선등록비)을 받는다, 받은 날짜를 앞당겨·알아서 맞춰 적는다.
 +`|(?:의향서|예약서|신청서|약정서)[^.\\n]{0,24}?(?:${FEE}|확보비|선점비|등록비)[^.\\n]{0,16}?(?:넣|내|입금|받|보내)`
 +`|${WAIT_TERM}\\s?(?:중|동안|엔|에는|기간\\s?중)[^.\\n]{0,30}?(?:[가-힣]{1,6}비|[가-힣]{1,6}금)(?:만|로|으로|명목)?[^.\\n]{0,12}?(?:받|넣|입금|내)`
 +`|(?:수령일|교부일|제공일|발송일|받은\\s?날짜|받으신\\s?날짜|날짜)[^.\\n]{0,20}?(?:전으로|앞당겨|소급|알아서|맞춰\\s?(?:드|놓|적)|거꾸로)`);
function earlyFee(s:string):boolean{
 return EARLY_FEE.test(s)&&!DENY_RE.test(s)&&!WARN_END_RE.test(s);
}
// 앞 문장이 규칙(14일·대기기간·가맹금 금지)을 말하고 뒤 문장이 '저희는 바로 가능합니다'로 뒤집는다(두 문장 대비).
const RULE_CUE=re(`(?:${WAIT_TERM}|14\\s?일|2\\s?주|이\\s?주|7\\s?일|${DOC}|가맹금|규정|법상|법대로|원칙|법적으로)`);
const RULE_MODAL=re('(?:지나야|기다려야|기다리셔야|금지|없(?:습니다|어요)|못\\s|못합|안\\s?됩니다|불가|규정|원칙|알고\\s?계시죠|법대로|법상|원래|늦어(?:집|져|지)|걸립니다|걸려요)');
const CONTRAST_START=/^\s?(?:하지만|그러나|다만|근데|그런데|그래도|반면)?\s?/;
const B_DENY=re('(?:않|못\\s|못합|지킵|지켜|준수|기다|그대로|철저|예외\\s?없이|꼭|반드시)');
const BARE_ANSWER=/^\s*(?:(?:A|답|답변)\s?[.:：)]?\s*)?(?:아니요|아니오|아뇨|네|예)?[.!~\s]*$/;
function contrastPair(a:ClauseSentence,b:ClauseSentence):boolean{
 if(a.parts||b.parts||b.line>a.line+1)return false;
 if(!RULE_CUE.test(a.s)||!RULE_MODAL.test(a.s))return false;
 const body=b.s.replace(CONTRAST_START,'');
 if(!re(`^${CONTRAST_US}|^${US}\\s?(?:쪽|측)?(?:은|는)?|^(?:이|그)\\s?(?:곳|브랜드)`).test(body)&&!re(CONTRAST_US).test(body))return false;
 if(B_DENY.test(body))return false;
 return re(ENABLE_STRONG).test(body)||(body.length<=22&&re(ENABLE_WEAK).test(body));
}

// 모집 문장의 구성 적중. 첫 적중 하나(문장 순서). 경고 틀 문장과 아니라고 답한 질문(denied)은 건너뛴다.
export function waitComposition(sentences:readonly ClauseSentence[],skip:(x:ClauseSentence)=>boolean):WaitComposition|null{
 const plain=sentences.filter(x=>!x.parts);
 for(let k=0;k<plain.length;k++){
  const x=plain[k];
  const framed=waitWarningFrame(x),s=x.s;
  // 묻고 짧게 답한 뒤('Q. 14일 꼭 기다려야 하나요? A. 아니요! 저희는 3일이면 됩니다.') 뒤집는 문장은 짧은 답 다음 문장을 본다.
  let j=k+1;
  while(j<plain.length&&j<=k+2&&BARE_ANSWER.test(plain[j].raw))j++;
  const next=plain[j]&&plain[j].line<=x.line+1?plain[j]:undefined;
  // 아니라고 답한 질문(skip)은 질문 자체를 주장으로 보지 않지만, 규칙을 묻고 뒤 문장이 뒤집는 대비는 본다.
  // 날짜가 둘 이상인 문장은 날짜 계산이 정한다(기간을 채운 '교부일 10/1, 계약일 10/20'은 계약일 문서 전달이 아니다).
  const dated=datesOf(x.raw).length>=2;
  const kind:WaitCompositionKind|null=skip(x)||framed?null:dated?(dateGapShort(x.raw)&&!DENY_RE.test(s)?'date_gap':null):sameDayDocument(s)?'same_day_document':waiver(s)?'waiver':onsiteContract(s)?'onsite_contract'
   :shortPeriod(s)?'short_period':quoteEndorse(x,next)?'quote_endorse':earlyFee(s)?'early_fee':null;
  if(kind)return {kind,sentence:kind==='quote_endorse'&&next?{s:x.s+' '+next.s,raw:x.raw+' '+next.raw,line:x.line}:x};
  if(next&&!skip(next)&&!waitWarningFrame(next)&&contrastPair(x,next))return {kind:'contrast',sentence:{s:x.s+' '+next.s,raw:x.raw+' '+next.raw,line:x.line}};
 }
 return null;
}
