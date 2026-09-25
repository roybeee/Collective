import {labelSchemaPaths,SCHEMA_PATH_LABELS} from './output-normalize';
import type {BriefResult} from './brief';

// 브리프 초안 결과의 사람이 읽는 문장(summary·제안 값·이유·질문·가정·참고 자료)에서 알려진 입력 스키마 경로를 한국어 라벨로 바꾼다.
// 표는 역할 산출물 정규화와 같다(lib/output-normalize.ts). 필드 키와 사용자가 적은 사실 후보(factCandidates)는 원문 그대로 둔다.
// 공용 라벨러는 URL·파일 경로를 피하려고 '/' 뒤 경로를 건너뛴다. 한글 바로 뒤의 '/경로'('[확인 사실: 주소/evidence.facts.confirmed]')는 URL이 아니라 여기서 바꾼다.
// 2026-09-25 파일럿 R2 S2 브리프 실측: '“당일 전량 소진”은 evidence.facts.prohibited에 해당하므로', '주소/evidence.facts.confirmed'.
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const SLASH_PATH=new RegExp(`(?<=[가-힣]/)(?:${Object.keys(SCHEMA_PATH_LABELS).sort((a,b)=>b.length-a.length).map(escape).join('|')})(?![\\w.])`,'g');
const label=(text:string)=>labelSchemaPaths(text.replace(SLASH_PATH,path=>SCHEMA_PATH_LABELS[path])).text;

export function labelBriefResult(result:BriefResult):BriefResult{
 return {
  ...result,
  summary:label(result.summary),
  suggestions:result.suggestions.map(s=>({...s,value:label(s.value),reason:label(s.reason)})),
  questions:result.questions.map(q=>({...q,question:label(q.question),why:label(q.why)})),
  assumptions:result.assumptions.map(label),
  contextUsed:result.contextUsed.map(label),
 };
}
