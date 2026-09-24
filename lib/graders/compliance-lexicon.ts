// 규제·플랫폼·업종 표시 가드레일(A2)의 어휘 사전. 판정 로직(compliance.ts)과 분리해 사전만 개정할 수 있게 둔다.
// 출처 URL은 국가법령정보센터 공식 페이지이며 2026-09-23에 법령 일련번호로 열리는 것을 확인했다. 이 사전은 법률 자문이 아니다.
// match: 문장 단위 정규식(바로 뒤 서술부가 부정·배제면 면제, negation.ts). context: 같은 문장(초안 라벨이면 뒤따르는 문단)에 있어야 적용.
// cleared: 같은 ###~###### 소제목 단락에 있으면 해소(표기·동의·권리 확인 등). 표기를 서술한 문장('해당 문안에 ‘#광고’를 표시한다')이면
// 같은 ## 섹션(렌더본의 #·## 제목과 구분선 사이) 안의 다른 소제목에 있어도 해소한다. also: 같은 문장에 함께 있어야 함. except: 문장이 맞으면 면제.
// held: 매치가 든 절(쉼표·연결 어미·줄표 사이)에서 매치 자리를 HELD_MARK로 바꾼 문자열이 맞으면 그 매치만 면제(같은 문장의 다른 문구 보류는 면제 사유가 아니다).
// ledgerKey: 확정 원장 항목 이름이 맞으면 해소. marked: [확인 필요]·미확정 표시 문장은 면제.
export type ComplianceSeverity='block'|'warn'|'info';
export const COMPLIANCE_CATEGORIES=['platform_review','endorsement','ai_label','ad_message','food_claim','cosmetic_claim','ecommerce_terms','rights'] as const;
export type ComplianceCategory=typeof COMPLIANCE_CATEGORIES[number];
export type ComplianceRule={id:string;category:ComplianceCategory;severity:ComplianceSeverity;title:string;match:string;context?:string;cleared?:string;also?:string;except?:string;held?:string;ledgerKey?:string;marked?:boolean;sources:string[]};
export const HELD_MARK='⟪M⟫';
export type ComplianceSource={title:string;url:string};

const law=(name:string)=>'https://www.law.go.kr/법령/'+name;
// 전송 채널의 메시지 초안·발송만 본다. '핵심 메시지 초안' 같은 브랜드 메시지는 광고성 정보 전송이 아니다.
const MESSAGE='(?:문자|SMS|LMS|MMS|알림톡|친구톡|앱\\s?푸시|푸시|카카오톡\\s?(?:채널\\s?)?메시지|광고\\s?메시지)[^.\\n]{0,12}(?:초안|문안|내용|발송|전송|보내|보낸)|메시지[^.\\n]{0,6}(?:발송|전송|보내|보낸)';
const PROMOTION='오픈|할인|이벤트|쿠폰|혜택|무료|증정|방문하세요|주문하세요|신메뉴|특가|프로모션|드립니다';
const PURCHASE_CTA='구매하기|바로\\s?구매|지금\\s?구매|구매하세요|장바구니|결제하기|주문하기|스토어에서\\s?(?:구매|주문)|온라인\\s?(?:판매|구매)';
// 발송을 미루거나 검토만 하는 계획 문장은 전송 문안이 아니다('수신 동의 고객이 생긴 뒤에 검토합니다').
const DEFERRAL='검토(?:합니다|한다|할\\s?예정|\\s?예정)|보류|(?:뒤|후|이후|다음)에?\\s?(?:검토|결정|판단|작성)';
// 버튼·링크 클릭 수 같은 측정 문장의 구매 버튼 언급은 구매 유도 문구가 아니다.
const MEASUREMENT='(?:버튼|링크)[^.\\n]{0,8}(?:클릭|노출|전환)|측정|지표|전환율';
// 구매 CTA 자체를 보류·미사용하거나 가격 확정 뒤 넣는·바꾸는 계획, 확인 계획에 적는다는 문장은 구매 유도 문구가 아니다(held: 매치가 든 절에서만 본다, M은 걸린 구매 문구 자리).
// '구매하기 CTA는 보류', '바로 구매 버튼은 가격 확정 후 추가', '가격 확정 후 CTA를 구매하기로 전환', '구매하기 문구 미사용', '(구매하기는 가격 확정 후)', '구매하기 CTA 사용 여부: 가격 확정 뒤 결정'.
// '헤드라인은 ‘지금 구매하세요’, 서브 문구는 보류', '장바구니 담기 CTA를 쓰고 할인 문구는 보류'처럼 다른 문구의 보류는 면제 사유가 아니다.
const M=HELD_MARK,AFTER_CONFIRM='(?:확정|확인|입력|등록)\\s?(?:뒤|후|이후|되면|된\\s?(?:뒤|후)|되는\\s?대로)';
const CTA_HELD=[`${M}[^.\\n]{0,12}(?:보류(?!\\s?없)|미사용)`,`${M}[^.\\n]{0,12}${AFTER_CONFIRM}[^.\\n]{0,12}(?:넣|추가|적|쓰|사용|노출|반영|바꾸|바꾼|바꿉|바꿔|교체|전환|변경)`,
 `${M}[^.\\n]{0,12}${AFTER_CONFIRM}에?\\s?(?:[)）|]|$)`,`${M}[^.\\n]{0,8}(?:사용|노출)\\s?여부[^.\\n]{0,16}(?:결정|판단|검토)`,
 `${AFTER_CONFIRM}[^.\\n]{0,20}${M}[^.\\n]{0,12}(?:으로|로)\\s?(?:바꾸|바꾼|바꿉|바꿔|교체|전환|변경|추가|넣)`,`${M}[^.\\n]{0,12}확인\\s?계획(?:에|으로)`].join('|');
// 매체 광고비 집행(검색·SNS 광고 운영)은 협찬 게시물이 아니다. 이 문맥의 '유료 광고'는 협찬 표기 대상에서 빼되, 인플루언서·체험단 같은 게시자 문맥이면 그대로 본다.
// '유료 광고 게시물·포스팅·후기'처럼 게시물을 가리키는 합성어는 집행·예산 문맥이어도 협찬 표기 대상이다.
const PAID_MEDIA='집행|예산|입찰|매체|광고\\s?(?:세트|관리자|계정|그룹)|캠페인\\s?(?:운영|세팅|설정)|CPC|CPM|CPA|CPV|ROAS|클릭당|노출당|타[기게겟]팅|부스팅|키워드\\s?광고|검색\\s?광고|파워링크|돌리|돌린|돌려|운영|게재|검토|세팅|노출';
const CREATOR='인플루언서|크리에이터|블로거|유튜버|틱톡커|셀럽|체험단|리뷰어|서포터즈|앰배서더|원고';
const PAID_POST='유료\\s?광고\\s?(?:용\\s?)?(?:게시(?:물|글)?|포스팅|포스트|후기|리뷰|원고)';
const PAID_AD=`${PAID_POST}|유료\\s?광고(?:(?<!(?:${PAID_MEDIA})[^.\\n]{0,30}유료\\s?광고)(?![^.\\n]{0,30}(?:${PAID_MEDIA}))|(?<=(?:${CREATOR})[^.\\n]{0,30}유료\\s?광고)|(?=[^.\\n]{0,30}(?:${CREATOR})))`;

export const COMPLIANCE_LEXICON:{version:string;checkedAt:string;platformPolicy:string;sources:Record<string,ComplianceSource>;rules:ComplianceRule[]}={
 version:'compliance-lexicon-2026-09-25.1',
 checkedAt:'2026-09-23',
 platformPolicy:'플랫폼별 리뷰 운영정책(예: 지도·예약 플랫폼) 공식 URL은 아직 확인하지 않았다. 게시 전 해당 플랫폼 공식 정책 페이지에서 확인하고, 확인되면 사전 버전을 올려 출처를 추가한다.',
 sources:{
  fair_labeling:{title:'표시·광고의 공정화에 관한 법률',url:law('표시ㆍ광고의공정화에관한법률')},
  endorsement_guideline:{title:'추천·보증 등에 관한 표시·광고 심사지침(공정거래위원회 고시)',url:'https://www.law.go.kr/행정규칙/추천ㆍ보증등에관한표시ㆍ광고심사지침'},
  ecommerce_act:{title:'전자상거래 등에서의 소비자보호에 관한 법률',url:law('전자상거래등에서의소비자보호에관한법률')},
  ai_basic_act:{title:'인공지능 발전과 신뢰 기반 조성 등에 관한 기본법',url:law('인공지능발전과신뢰기반조성등에관한기본법')},
  network_act:{title:'정보통신망 이용촉진 및 정보보호 등에 관한 법률 제50조(영리목적의 광고성 정보 전송 제한)',url:law('정보통신망이용촉진및정보보호등에관한법률')},
  food_labeling_act:{title:'식품 등의 표시·광고에 관한 법률',url:law('식품등의표시ㆍ광고에관한법률')},
  origin_act:{title:'농수산물의 원산지 표시 등에 관한 법률',url:law('농수산물의원산지표시등에관한법률')},
  cosmetics_act:{title:'화장품법',url:law('화장품법')},
  copyright_act:{title:'저작권법',url:law('저작권법')},
  unfair_competition_act:{title:'부정경쟁방지 및 영업비밀보호에 관한 법률(유명인 성명·초상 등 무단 사용)',url:law('부정경쟁방지및영업비밀보호에관한법률')},
  trademark_act:{title:'상표법',url:law('상표법')},
 },
 rules:[
  // ① 플랫폼 리뷰: 보상 조건부 리뷰 요청, 영수증 리뷰 이벤트, 체험단 대량 리뷰.
  {id:'review_reward',category:'platform_review',severity:'block',title:'보상을 조건으로 리뷰·별점을 요청',match:'(?:리뷰|후기|별점|평점)[^.\\n]{0,30}(?:작성\\s?시|남기(?:면|시면)|남겨\\s?주시면|작성하(?:면|시면)|인증\\s?시|인증하(?:면|시면)|써\\s?주시면|올려\\s?주시면|쓰(?:면|시면)|주시면|작성\\s?(?:고객|하신\\s?분)|참여\\s?(?:고객|하신\\s?분))[^.\\n]{0,30}(?:증정|드립니다|드려요|드려|제공|할인|쿠폰|적립|서비스|무료|지급|선물|사은품)',sources:['fair_labeling','endorsement_guideline']},
  {id:'receipt_review_event',category:'platform_review',severity:'block',title:'영수증·리뷰 이벤트',match:'영수증\\s?리뷰[^.\\n]{0,20}(?:이벤트|증정|혜택|적립)|리뷰\\s?이벤트',sources:['fair_labeling','endorsement_guideline']},
  {id:'bulk_review',category:'platform_review',severity:'block',title:'체험단·대량 리뷰 확보',match:'(?:체험단|리뷰어|서포터즈)[^.\\n]{0,20}\\d{2,}\\s?(?:명|건)|리뷰\\s?\\d{2,}\\s?건[^.\\n]{0,15}(?:확보|모집|작업|구매|대행)|(?:확보|모집|작업|구매|대행)[^.\\n]{0,15}리뷰\\s?\\d{2,}\\s?건|리뷰\\s?(?:대행|작업|구매)|(?:대량|다수)[^.\\n]{0,6}(?:리뷰|후기)',except:'^(?!.*(?:체험단|서포터즈|리뷰어|모집|대행|작업|구매)).*(?:목표|지표|KPI|측정)',sources:['fair_labeling','endorsement_guideline']},
  // ② 공정위 추천·보증: 가짜 체험담, 협찬·광고 표기 누락, 가상인물 미표시.
  {id:'fake_testimonial',category:'endorsement',severity:'block',title:'가짜·위장 체험담',match:'(?:고객|손님|소비자|구매자)[^.\\n]{0,6}(?:인\\s?척|처럼\\s?(?:꾸며|위장|작성))|가짜\\s?(?:후기|리뷰|체험담|계정)|위장\\s?(?:후기|리뷰)|(?:직원|지인|가족)[^.\\n]{0,12}(?:후기|리뷰)[^.\\n]{0,10}(?:작성|남기|올리)|(?:후기|리뷰)를?\\s?(?:대신|대리)\\s?(?:작성|써)',sources:['fair_labeling','endorsement_guideline']},
  {id:'sponsorship_undisclosed',category:'endorsement',severity:'block',title:'협찬·광고 관계 표기 누락',match:'협찬|체험단|원고료|제품을?\\s?(?:무상\\s?)?제공(?:받|하고|해)|무상\\s?제공|유료\\s?(?:게시|포스팅)|'+PAID_AD+'|광고비[^.\\n]{0,10}(?:지급|받)|대가를?\\s?(?:지급|받)',cleared:'\\[광고\\]|\\(광고\\)|#광고|#협찬|#유료광고|유료\\s?광고\\s?포함|소정의\\s?원고료|(?:광고|협찬)\\s?(?:표기|표시|문구)(?:를|을)?\\s?(?:포함|넣|명시|붙|달)|경제적\\s?(?:대가|이해관계)[^.\\n]{0,12}(?:표시|표기|밝|명시|공개)|제공받아\\s?작성',sources:['fair_labeling','endorsement_guideline']},
  {id:'disclosure_omitted',category:'endorsement',severity:'block',title:'광고·협찬 표기를 빼라는 지시',match:'(?:광고|협찬|유료|AI)\\s?(?:표기|표시|문구|해시태그|고지)[^.\\n]{0,8}(?:빼|생략|없이|숨기|지우|제거)',sources:['fair_labeling','endorsement_guideline']},
  {id:'virtual_person_undisclosed',category:'endorsement',severity:'block',title:'가상인물 추천·보증 표시 누락',match:'가상\\s?(?:인물|인간|모델|인플루언서)|버추얼\\s?(?:인플루언서|모델|휴먼)|AI\\s?(?:인플루언서|모델|아바타)|디지털\\s?휴먼',cleared:'가상\\s?인물(?:임|입니다|이라는|로\\s?표시|\\s?표시)|가상\\s?인간(?:임|입니다)|실제\\s?인물이\\s?아닙|#가상인간|#가상인물|#버추얼|AI\\s?(?:생성|합성)\\s?인물(?:임|입니다|\\s?표시)',sources:['endorsement_guideline','fair_labeling']},
  // ③ AI 기본법: 생성형 AI 결과물 표시 필요 플래그.
  {id:'ai_generated_unlabeled',category:'ai_label',severity:'warn',title:'AI 생성 소재 표시 필요',match:'(?:AI|인공지능|생성형)[^.\\n]{0,20}(?:이미지|영상|음성|목소리|사진|일러스트|캐릭터|배경|소재)|딥페이크|합성\\s?(?:음성|얼굴)',cleared:'AI\\s?(?:생성|활용|제작)[^.\\n]{0,12}(?:표시|표기|고지|워터마크|라벨)|인공지능[^.\\n]{0,12}(?:표시|표기|고지)|#AI\\s?생성|AI로\\s?(?:생성|제작)(?:됨|되었습니다)',sources:['ai_basic_act']},
  // ④ 정보통신망법: 광고 메시지의 (광고) 표기·야간 전송·수신 동의·수신거부 안내.
  {id:'ad_label_missing',category:'ad_message',severity:'block',title:'광고 메시지 (광고) 표기 누락',match:MESSAGE,context:PROMOTION,except:DEFERRAL,cleared:'\\(광고\\)|\\[광고\\]|（광고）',sources:['network_act']},
  {id:'consent_missing',category:'ad_message',severity:'warn',title:'광고 메시지 수신 동의 전제 누락',match:MESSAGE,context:PROMOTION,except:DEFERRAL,cleared:'수신\\s?(?:에\\s?)?동의|마케팅\\s?(?:정보\\s?)?수신|옵트인|opt-?in',sources:['network_act']},
  {id:'optout_missing',category:'ad_message',severity:'warn',title:'무료 수신거부 방법 안내 누락',match:MESSAGE,context:PROMOTION,except:DEFERRAL,cleared:'수신\\s?거부|무료\\s?거부|수신\\s?철회|080-?\\d',sources:['network_act']},
  {id:'night_send',category:'ad_message',severity:'warn',title:'야간(21시~08시) 광고 전송은 별도 동의 필요',match:'(?:밤|저녁|오후)\\s?(?:9|10|11)\\s?시|(?:새벽|오전)\\s?[0-7]\\s?시|(?<!\\d)(?:21|22|23|24)\\s?시(?!간)|(?<![\\d:])(?:21|22|23|0[0-7])\\s?:\\s?[0-5]\\d|자정|심야|야간',also:'발송|전송|보내|보낸|푸시',cleared:'야간[^.\\n]{0,10}동의|별도\\s?(?:야간\\s?)?(?:수신\\s?)?동의',sources:['network_act']},
  // ⑤ 식품 표시·광고: 질병 예방·치료 효능 오인, 원산지 주장(국내산·OO산·한우 등) 시 원장 미확정 경고. 확인 목록의 '원산지' 낱말은 주장이 아니다.
  {id:'disease_claim',category:'food_claim',severity:'block',title:'식품의 질병 예방·치료 효능 표현',match:'(?:당뇨|고혈압|혈압|혈당|비만|면역력?|질병|질환|감기|변비|치매|숙취)[^.\\n]{0,10}(?:예방|치료|개선|완화|낮춰|낮춘|낮추|강화|회복|효과|효능|높여|높인|줄여|줄인|해소|에\\s?좋은)|다이어트\\s?(?:효과|효능)|(?<![가-힣])암\\s?(?:예방|치료|억제)|항암|해독\\s?(?:효과|작용)',sources:['food_labeling_act']},
  {id:'origin_unconfirmed',category:'food_claim',severity:'warn',title:'원산지 주장(원장에 원산지 확정값 없음)',match:'(?:국내|국|수입|미국|호주|중국|칠레|브라질|스페인|캐나다|뉴질랜드|베트남|태국|일본|이탈리아|독일|노르웨이|러시아)산(?![가-힣]*업)|한우|한돈',ledgerKey:'원산지|산지',marked:true,sources:['origin_act','food_labeling_act']},
  // ⑥ 화장품: 의약품 오인, 미인증 기능성 표현.
  {id:'drug_claim',category:'cosmetic_claim',severity:'block',title:'화장품의 의약품 오인 표현',match:'(?:여드름|아토피|피부염|습진|건선|탈모|흉터|상처|염증|무좀|기미)[^.\\n]{0,12}(?:치료|완치|치유|재생|없애|없앤|사라지|사라진|낫)|(?:세포|피부|모발)\\s?재생|의약품\\s?(?:수준|급|효과)|약처럼|처방\\s?(?:없이|받은)',sources:['cosmetics_act']},
  {id:'functional_unverified',category:'cosmetic_claim',severity:'warn',title:'기능성 인증 근거 없는 기능성 표현',match:'미백|주름\\s?(?:개선|완화)|자외선\\s?차단|탈모\\s?(?:증상\\s?)?(?:완화|방지)|여드름성\\s?피부\\s?완화|피부\\s?장벽\\s?(?:강화|개선)|SPF\\s?\\d+|PA\\+',cleared:'기능성\\s?(?:화장품|인증|심사|보고)|식약처\\s?(?:심사|보고|인증)',ledgerKey:'기능성',sources:['cosmetics_act']},
  // ⑦ 전자상거래: 판매 조건·가격 표시 누락.
  {id:'price_missing',category:'ecommerce_terms',severity:'warn',title:'구매 유도 문구에 가격 표시 누락',match:PURCHASE_CTA,except:MEASUREMENT,held:CTA_HELD,cleared:'\\d{1,3}(?:,\\d{3})+\\s?원|\\d+\\s?원|가격[^.\\n]{0,6}\\d',sources:['ecommerce_act']},
  {id:'terms_missing',category:'ecommerce_terms',severity:'warn',title:'구매 유도 문구에 판매 조건(배송·교환·환불 등) 누락',match:PURCHASE_CTA,except:MEASUREMENT,held:CTA_HELD,cleared:'배송|교환|환불|반품|청약\\s?철회|판매\\s?(?:기간|조건)|픽업|수령',sources:['ecommerce_act']},
  {id:'discount_basis_missing',category:'ecommerce_terms',severity:'warn',title:'할인 표시에 기준 가격 누락',match:'\\d{1,2}\\s?%\\s?(?:할인|OFF|off|세일)|할인가|특가|반값|[\\d,]+\\s?원\\s?할인',cleared:'정가|정상가|기존\\s?가|할인\\s?전|원래\\s?가격|소비자가',marked:true,sources:['ecommerce_act','fair_labeling']},
  // ⑧ 권리: 아티스트 이름·사진·로고 사용 시 권리 확인 미기재.
  {id:'artist_rights_unconfirmed',category:'rights',severity:'warn',title:'아티스트·유명인 이름·사진·로고 권리 확인 미기재',match:'(?:아티스트|아이돌|멤버(?!십|\\s?전용|\\s?혜택|\\s?등급)|가수|배우|셀럽|연예인|유명인|포토\\s?카드|앨범\\s?(?:재킷|자켓|커버|이미지)|팬아트|초상|타사\\s?로고|방송\\s?(?:캡처|화면)|캐릭터\\s?IP)[^.\\n]{0,20}(?:사용|활용|게시|삽입|노출|넣|합성|인쇄|배치|배경)',cleared:'권리\\s?(?:확인|처리|확보)|초상권|저작권|퍼블리시티|사용\\s?(?:허락|승인|허가|계약)|라이선스|라이센스|소속사[^.\\n]{0,10}(?:승인|확인|허락|협의)',sources:['copyright_act','unfair_competition_act','trademark_act']},
 ],
};
