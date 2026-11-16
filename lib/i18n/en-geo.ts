// 영어 화면 문구 구역 'geo'(ko-geo.ts와 키가 같다). en.ts가 묶어 그 언어를 고를 때만 내려받는다.
import type {koGeo} from './ko-geo';
export const enGeo:Record<keyof typeof koGeo,string>={
 'geo.v2.title':'Observation protocol v2','geo.v2.lead':'Verdicts use only records of the same question asked to the same engine several times on several days. Numbers are observation records, not a guarantee of exposure.',
 'geo.v2.rule':'Verdict thresholds (operating standard): dominant at {dominant} or more · contested at {contested} or more · behind above 0 · absent at 0 · unobserved means no measurement. Without two time points at least {gap} days apart the verdict is on hold. If the verdict for the last {window} days is lower than for the {window} days before, it is a failed defense.',
 'geo.v2.repeats':'Each question×engine pair is measured {n} times. The token estimate above includes the repeats.',
 'geo.v2.verdicts':'Verdict by group×engine','geo.v2.noVerdicts':'No observations to judge yet.','geo.v2.points':'{n} time points · {days} days apart','geo.v2.none':'None',
 'geo.col.group':'Group','geo.col.engine':'Engine','geo.col.count':'Observed','geo.col.points':'Time points','geo.col.verdict':'Verdict','geo.col.previous':'Previous verdict',
 'geo.group.category':'Category recommendation (incl. local)','geo.group.comparison':'Comparison','geo.group.brand':'Brand direct',
 'geo.verdict.dominant':'Dominant','geo.verdict.contested':'Contested','geo.verdict.behind':'Behind','geo.verdict.absent':'Absent','geo.verdict.defense_failed':'Failed defense','geo.verdict.unobserved':'Unobserved','geo.verdict.pending':'Verdict on hold',
 'geo.v2.citations':'Cited sources (v2 observations)','geo.source.official':'Official','geo.source.platform':'Editable platform','geo.source.third_party':'Third party','geo.source.unclassified':'Unclassified',
 'geo.v2.contexts':'Answer context (v2 observations)','geo.tone.positive':'Positive','geo.tone.neutral':'Neutral','geo.tone.negative':'Negative',
 'geo.change.title':'Change log and re-observation','geo.change.lead':'Recording a change schedules re-measurement under the same conditions +14 and +42 days after the applied day. It runs by itself only when research runs are automatic; otherwise it shows here once the due day passes.',
 'geo.change.kind':'Change type','geo.change.summary':'Change summary','geo.change.appliedOn':'Applied day (published or indexed)','geo.change.basis':'Applied basis','geo.change.save':'Record change','geo.change.saved':'Recorded the change and scheduled re-observation.','geo.change.needSummary':'Write the change summary first.','geo.change.needDay':'Choose the applied day.','geo.change.empty':'No changes recorded.',
 'geo.change.recheck':'+{offset} days {day} {status}','geo.change.due':'Re-observation is due: {items}. You can run it now with Measure now.','geo.change.dueItem':'+{offset} days ({day})',
 'geo.recheck.scheduled':'Scheduled','geo.recheck.started':'Measurement started','geo.recheck.skipped':'Skipped (campaign archived or deleted)',
 'geo.kind.entity_basics':'Prescription 0 bundle (official info page · map listing · consistent name)','geo.kind.faq':'FAQ added or edited','geo.kind.page':'Official page text edited','geo.kind.listing':'Platform listing edited','geo.kind.other':'Other',
 'geo.basis.published':'Publication confirmed','geo.basis.indexed':'Indexing confirmed',
};
