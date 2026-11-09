// X7 근거 3단계(docs/GLOBAL-PLAN.ko.md 에픽 X7)의 순수 판정(화면·테스트 공용). 퍼센트가 아니라 단계와 건수로만 보인다.
// 입력: 작업물 본문, 실행이 쓴 확정 사실 항목 이름(factKeys), 규제 점검 주의·차단 건수. 판정은 검토 보조 신호이며 품질·사실 판정이 아니다.
// - 근거 부족: 인용 문장이 없거나 인용 비율이 20% 미만, 규제 차단이 있음, 또는 [확인 필요] 표지가 3개 이상.
// - 근거 충분: 인용 비율 50% 이상, 확정 사실 1건 이상 인용, [확인 필요]·규제 주의·차단 0건.
// - 그 밖은 근거 일부.
// '근거 부족'이면 작업물 상세의 승인에 '직접 확인했습니다' 확인이 더 필요하다(app/panels.tsx ArtifactDialog, 서버는 manuallyVerified를 판정 기록에 남긴다).
import {claimSentences,CHECK_FLAG} from './citation-refs';

export type ConfidenceLevel='sufficient'|'partial'|'insufficient';
export const CONFIDENCE_LABELS:Record<ConfidenceLevel,string>={sufficient:'근거 충분',partial:'근거 일부',insufficient:'근거 부족'};
export type ConfidenceCounts={sentences:number;cited:number;confirmedFacts:number;checkFlags:number;warns:number;blocks:number};
export type EvidenceConfidence={level:ConfidenceLevel;label:string;counts:ConfidenceCounts};
export const LOW_RATIO=0.2,HIGH_RATIO=0.5,MANY_CHECK_FLAGS=3;

export function confidenceLevel(c:ConfidenceCounts):ConfidenceLevel{
 const ratio=c.sentences?c.cited/c.sentences:0;
 if(c.cited===0||ratio<LOW_RATIO||c.blocks>0||c.checkFlags>=MANY_CHECK_FLAGS)return 'insufficient';
 if(ratio>=HIGH_RATIO&&c.confirmedFacts>=1&&c.checkFlags===0&&c.warns===0)return 'sufficient';
 return 'partial';
}
export function evidenceConfidence(text:string,{factKeys=[],warns=0,blocks=0}:{factKeys?:readonly string[];warns?:number;blocks?:number}={}):EvidenceConfidence{
 const units=claimSentences(text,factKeys);
 const facts=new Set(units.flatMap(u=>u.refs.filter(r=>r.kind==='fact').map(r=>r.key)));
 const counts:ConfidenceCounts={sentences:units.length,cited:units.filter(u=>u.refs.length>0).length,confirmedFacts:facts.size,checkFlags:(text.match(CHECK_FLAG)||[]).length,warns,blocks};
 const level=confidenceLevel(counts);
 return {level,label:CONFIDENCE_LABELS[level],counts};
}
// 승인 전 직접 확인이 필요한지. AI가 쓴 작업물(ai·ai_edited)의 근거 부족만 해당한다(직접 등록은 인용 라벨이 없으므로 단계를 매기지 않는다).
export const needsManualVerification=(origin:string|undefined,confidence:EvidenceConfidence|null)=>(origin==='ai'||origin==='ai_edited')&&confidence?.level==='insufficient';
