// 일본어 화면 문구 구역 'geo'(ko-geo.ts와 키가 같다). ja.ts가 묶어 그 언어를 고를 때만 내려받는다.
import type {koGeo} from './ko-geo';
export const jaGeo:Record<keyof typeof koGeo,string>={
 'geo.v2.title':'観測プロトコル v2','geo.v2.lead':'同じ質問を同じエンジンに複数回・複数日に尋ねた記録だけで判定します。数値は観測記録であり、露出の保証ではありません。',
 'geo.v2.rule':'判定基準(運用基準): 優勢 {dominant} 以上 · 拮抗 {contested} 以上 · 劣勢 0 超 · 不在 0回 · 未観測は測定なし。互いに{gap}日以上離れた2時点がなければ判定保留です。直近{window}日の判定がその前の{window}日より下がれば防衛失敗です。',
 'geo.v2.repeats':'質問×エンジンごとに{n}回繰り返し測定します。上の予想トークンには繰り返しが含まれます。',
 'geo.v2.verdicts':'グループ×エンジン判定','geo.v2.noVerdicts':'判定できる観測はまだありません。','geo.v2.points':'{n}時点 · {days}日間隔','geo.v2.none':'なし',
 'geo.col.group':'グループ','geo.col.engine':'エンジン','geo.col.count':'観測','geo.col.points':'時点','geo.col.verdict':'判定','geo.col.previous':'前回の判定',
 'geo.group.category':'カテゴリ推薦(地域を含む)','geo.group.comparison':'比較','geo.group.brand':'ブランド直接',
 'geo.verdict.dominant':'優勢','geo.verdict.contested':'拮抗','geo.verdict.behind':'劣勢','geo.verdict.absent':'不在','geo.verdict.defense_failed':'防衛失敗','geo.verdict.unobserved':'未観測','geo.verdict.pending':'判定保留',
 'geo.v2.citations':'引用元(v2観測)','geo.source.official':'公式','geo.source.platform':'編集できるプラットフォーム','geo.source.third_party':'第三者','geo.source.unclassified':'未分類',
 'geo.v2.contexts':'回答の文脈(v2観測)','geo.tone.positive':'肯定','geo.tone.neutral':'中立','geo.tone.negative':'否定',
 'geo.change.title':'変更記録と再観測','geo.change.lead':'変更を記録すると、反映日から+14日・+42日に同じ条件で再測定を予約します。調査実行が自動のときだけ自動で動き、そうでなければ予定日を過ぎたあとここに表示されます。',
 'geo.change.kind':'変更の種類','geo.change.summary':'変更の要約','geo.change.appliedOn':'反映日(公開・インデックス確認日)','geo.change.basis':'反映の根拠','geo.change.save':'変更を記録','geo.change.saved':'変更を記録し、再観測を予約しました。','geo.change.needSummary':'先に変更の要約を書いてください。','geo.change.needDay':'反映日を選んでください。','geo.change.empty':'記録した変更はありません。',
 'geo.change.recheck':'+{offset}日 {day} {status}','geo.change.due':'再観測の予定日を過ぎました: {items}。「今すぐ測定」で直接実行できます。','geo.change.dueItem':'+{offset}日({day})',
 'geo.recheck.scheduled':'予約','geo.recheck.started':'測定開始',
 'geo.kind.entity_basics':'処方0のまとまり(公式情報ページ・地図登録情報・表記統一)','geo.kind.faq':'よくある質問の追加・修正','geo.kind.page':'公式ページ本文の修正','geo.kind.listing':'プラットフォーム登録情報の修正','geo.kind.other':'その他',
 'geo.basis.published':'公開確認','geo.basis.indexed':'インデックス確認',
};
