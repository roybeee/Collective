// 결정 17: AI 생성물 표시(docs/AI-DISCLOSURE.ko.md). 순수 함수만 둔다(화면·서버 공용).
// 표시 문구는 대표·법률 검토로 확정하기 전의 초안이다. 코드 안에서는 이 상수 한 곳에만 둔다(캡션 조합·한도·일치 검사가 모두 이 값을 쓴다).
// 확정 문구로 바꿀 때는 이 상수·docs/AI-DISCLOSURE.ko.md 2절 인용문·tests/ai-disclosure.test.mjs의 기대값 LINE을 같은 PR에서 함께 바꾼다.
export const AI_DISCLOSURE_LINE='이 게시물의 문구는 AI의 도움을 받아 작성하고 담당자가 확인했습니다.';
// 작업물의 AI 생성 여부는 저장 필드 없이 B1 출처(origin)에서 파생한다. ai(AI 작성)·ai_edited(AI 초안을 사람이 고침)는 AI 생성물이다.
// 직접 작성(manual)은 아니다. 출처가 없거나 알 수 없는 값도 여기서는 false지만, 그런 작업물의 카피는 hasKnownOrigin으로 캡션에서 막는다(표시 누락 방지).
export function isAiGenerated(a:{origin?:string}):boolean{return a.origin==='ai'||a.origin==='ai_edited'}
// AI 생성물 여부를 판정할 수 있는 출처인지. 출처가 없거나 알 수 없으면 표시 줄을 붙일지 정할 수 없으므로 캡션 후보로 쓰지 않는다(fail closed).
export function hasKnownOrigin(a:{origin?:string}):boolean{return a.origin==='manual'||isAiGenerated(a)}
// C2 가상인물 표시 줄(심사지침 문구, 텍스트용). 작업물·브리프가 가상인물 포함(virtualPerson:true)을 선언하면 캡션에 붙는다. 이미지용 라벨은 lib/ai-disclosure-image.ts VIRTUAL_PERSON_IMAGE_LABEL이다.
export const VIRTUAL_PERSON_LINE='AI를 기반으로 생성된 가상인물이 포함된 게시물입니다.';
export type CopyDisclosure={aiGenerated:boolean;virtualPerson?:true};
// 발행 카피 기록에 남길 표시 판정. aiGenerated는 출처에서 파생하고, 가상인물은 작업물의 선언(virtualPerson===true)만 믿는다(없으면 필드도 없다 — 이전 기록 모양 유지).
export function copyDisclosure(a:{origin?:string;virtualPerson?:boolean}):CopyDisclosure{return a.virtualPerson===true?{aiGenerated:isAiGenerated(a),virtualPerson:true}:{aiGenerated:isAiGenerated(a)}}
// 발행 캡션에 붙일 표시 줄. AI 카피(copy.aiGenerated===true)에 AI 표시 줄, 가상인물 선언(copy.virtualPerson===true)에 가상인물 줄을 붙인다(둘이면 두 줄, 줄바꿈 하나).
// 사실 카드·사실 캡션·게시 코드 줄(결정론 문구)은 대상이 아니다. 둘 다 없으면 null이라 이전 캡션과 바이트 단위로 같다.
export function disclosureLine(copy?:{aiGenerated?:boolean;virtualPerson?:boolean}):string|null{
 const lines=[...(copy?.aiGenerated===true?[AI_DISCLOSURE_LINE]:[]),...(copy?.virtualPerson===true?[VIRTUAL_PERSON_LINE]:[])];
 return lines.length?lines.join('\n'):null;
}
