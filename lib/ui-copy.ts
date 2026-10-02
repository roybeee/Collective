// 화면 문구 사전(UX-PLAN P2, 결정 4). 같은 뜻은 같은 말로 쓴다. 영어 보기는 시점을 따로 정하므로 en 열을 함께 둔다.
// 규칙: 저장(만들기·등록·접수·추가 통합) / 기록(영수증·사건 등 지난 사실) / 새로고침 / 다시 시도. 버전은 'v3'로 쓰고 '판'은 쓰지 않는다.
// 상태어는 AGENTS 어휘에 맞춘다: 미확인·보류·운영자 확인·검증됨·실행하지 않음·중단됨.
export type Locale='ko'|'en';
const dictionary={
 refresh:{ko:'새로고침',en:'Refresh'},
 retry:{ko:'다시 시도',en:'Try again'},
 retryLoad:{ko:'다시 불러오기',en:'Reload'},
 save:{ko:'저장',en:'Save'},
 record:{ko:'기록',en:'Record'},
 cancel:{ko:'취소',en:'Cancel'},
 close:{ko:'닫기',en:'Close'},
 more:{ko:'자세히',en:'Details'},
 loading:{ko:'불러오고 있습니다.',en:'Loading…'},
 loadFailed:{ko:'불러오지 못했습니다.',en:'Could not load.'},
 saveFailed:{ko:'저장하지 못했습니다. 입력은 그대로 있습니다.',en:'Could not save. Your input is kept.'},
 saved:{ko:'저장했습니다.',en:'Saved.'},
 recorded:{ko:'기록했습니다.',en:'Recorded.'},
 conflict:{ko:'다른 곳에서 먼저 바꿨습니다.',en:'Someone changed this first.'},
 keepMine:{ko:'내 입력 유지',en:'Keep my input'},
 showServer:{ko:'서버 값 보기',en:'Show saved version'},
 empty:{ko:'아직 기록이 없습니다.',en:'Nothing here yet.'},
 unknown:{ko:'미확인',en:'Unknown'},
 held:{ko:'보류',en:'On hold'},
 operatorAttested:{ko:'운영자 확인',en:'Operator-confirmed'},
 verified:{ko:'검증됨',en:'Verified'},
 notRun:{ko:'실행하지 않음',en:'Not run'},
 stopped:{ko:'중단됨',en:'Stopped'},
 unsavedLeave:{ko:'이동할까요?',en:'You have unsaved input. Leave anyway?'},
} as const;
export type CopyKey=keyof typeof dictionary;
export function t(key:CopyKey,locale:Locale='ko'):string{return dictionary[key][locale]}
export const copyKeys=Object.keys(dictionary) as CopyKey[];
/** 버전 표기: 3 → 'v3'. */
export const version=(n:number|null|undefined)=>typeof n==='number'?`v${n}`:t('unknown');
// 화면에 그대로 보이던 영문 값의 한국어 이름. 값(value)은 서버 계약 그대로 두고 표시만 바꾼다.
export const enumLabels={
 csChannel:{phone:'전화',chat:'채팅',email:'이메일',marketplace:'마켓플레이스',other:'기타'},
 experimentChannel:{storefront:'자사몰',organic:'자연 유입',meta:'Meta 광고',manual:'수동 기록'},
 assignmentUnit:{pseudonymous_visitor:'가명 방문자',pseudonymous_session:'가명 세션',store_day:'지점·일자'},
 geoEngine:{chatgpt:'ChatGPT',perplexity:'Perplexity',gemini:'Gemini',google_ai_overview:'Google AI 개요',naver:'네이버',other:'기타'},
} as const;
export function enumLabel<K extends keyof typeof enumLabels>(kind:K,value:string):string{return (enumLabels[kind] as Record<string,string>)[value]??value}
