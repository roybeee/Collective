// 결정 17: AI 생성물 표시(docs/AI-DISCLOSURE.ko.md). 순수 함수만 둔다(화면·서버 공용).
// 표시 문구는 대표·법률 검토로 확정하기 전의 초안이다. 코드 안에서는 이 상수 한 곳에만 둔다(캡션 조합·한도·일치 검사가 모두 이 값을 쓴다).
// 확정 문구로 바꿀 때는 이 상수·docs/AI-DISCLOSURE.ko.md 2절 인용문·tests/ai-disclosure.test.mjs의 기대값 LINE을 같은 PR에서 함께 바꾼다.
export const AI_DISCLOSURE_LINE='이 게시물의 문구는 AI의 도움을 받아 작성하고 담당자가 확인했습니다.';
// 작업물의 AI 생성 여부는 저장 필드 없이 B1 출처(origin)에서 파생한다. ai(AI 작성)·ai_edited(AI 초안을 사람이 고침)는 AI 생성물이다.
// 직접 작성(manual)은 아니다. 출처가 없거나 알 수 없는 값도 여기서는 false지만, 그런 작업물의 카피는 hasKnownOrigin으로 캡션에서 막는다(표시 누락 방지).
export function isAiGenerated(a:{origin?:string}):boolean{return a.origin==='ai'||a.origin==='ai_edited'}
// AI 생성물 여부를 판정할 수 있는 출처인지. 출처가 없거나 알 수 없으면 표시 줄을 붙일지 정할 수 없으므로 캡션 후보로 쓰지 않는다(fail closed).
export function hasKnownOrigin(a:{origin?:string}):boolean{return a.origin==='manual'||isAiGenerated(a)}
// 발행 캡션에 붙일 표시 줄. AI 카피(copy.aiGenerated===true)만 붙인다. 사실 카드·사실 캡션·게시 코드 줄(결정론 문구)은 대상이 아니다.
export function disclosureLine(copy?:{aiGenerated?:boolean}):string|null{return copy?.aiGenerated===true?AI_DISCLOSURE_LINE:null}
