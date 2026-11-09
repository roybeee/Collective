// 산출물 출력 언어(GLOBAL-PLAN G6 1단계). 캠페인 브리프의 선택 항목이며 기본은 한국어다.
// 저장: 한국어는 키를 두지 않는다(이전 캠페인·브리프와 바이트 동일). 영어·일본어만 campaign.outputLanguage에 남는다(lib/server.ts validateCampaign).
// 지시문: 영어·일본어일 때만 역할·회의·브리프 지시문 끝에 한 줄을 더한다(outputLanguageLine). 한국어면 빈 문자열이라 지시문 바이트가 바뀌지 않는다.
// 이 줄은 화면 언어(lib/i18n.ts)와 무관하다. 화면을 영어로 봐도 산출물 언어는 캠페인마다 정한다.
export type OutputLanguage='ko'|'en'|'ja';
export const OUTPUT_LANGUAGES:readonly OutputLanguage[]=['ko','en','ja'];
export const OUTPUT_LANGUAGE_MESSAGE='산출물 언어는 ko·en·ja 중 하나여야 합니다.';
/** 입력 값 판정: 없음·빈 값은 'ko', ko·en·ja는 그대로, 그 밖은 null(400으로 거절할 값). */
export function parseOutputLanguage(value:unknown):OutputLanguage|null{
 if(value===undefined||value===null||value==='')return 'ko';
 return value==='ko'||value==='en'||value==='ja'?value:null;
}
/** 저장된 값 읽기: 정확한 en·ja만 인정하고 나머지(없음·검증 안 된 값)는 한국어로 본다. */
export const outputLanguageOf=(c?:{outputLanguage?:unknown}|null):OutputLanguage=>c?.outputLanguage==='en'||c?.outputLanguage==='ja'?c.outputLanguage:'ko';
const languageNames:Record<Exclude<OutputLanguage,'ko'>,string>={en:'영어',ja:'일본어'};
/** 지시문 끝에 붙는 한 줄. 한국어면 ''. 위 지시의 '한국어로 작성' 요구보다 앞서며 JSON 키·섹션 id·형식은 그대로 둔다. */
export function outputLanguageLine(c?:{outputLanguage?:unknown}|null):string{
 const language=outputLanguageOf(c);
 return language==='ko'?'':`\n출력 언어: 모든 산출물을 ${languageNames[language]}로 작성한다. 이 줄은 위 지시의 한국어 작성 요구보다 우선하며, JSON 키·섹션 id·형식은 그대로 둔다.`;
}
