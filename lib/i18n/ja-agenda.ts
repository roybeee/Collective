// 일본어 화면 문구 구역 'agenda'(ko-agenda.ts와 키가 같다). 서버가 만든 안건 제목·설명이다. ja.ts가 묶어 그 언어를 고를 때만 내려받는다.
import type {koAgenda} from './ko-agenda';
export const jaAgenda:Record<keyof typeof koAgenda,string>={
 'agenda.t.artifact':'{role}の作業物がレビュー待ち','agenda.t.artifactAny':'作業物がレビュー待ち','agenda.t.publicationApproved':'承認済みの投稿が受付待ち','agenda.t.publication':'投稿が承認待ち','agenda.t.meeting':'会議の進行が確認待ち','agenda.t.meetingQuestion':'会議で確認する事実','agenda.t.sequence':'連続実行の検収が確認待ち','agenda.t.dataRequest':'資料依頼が未対応','agenda.t.briefQuestions':'ブリーフの確認質問 {n}件',
 'agenda.d.meetingSteps':'確認する段階 {n}件','agenda.d.fixes':'修正依頼 {n}件',
 'agenda.t.billing100':'クレジットを使い切りました','agenda.t.billing80':'クレジットを80%使用','agenda.t.reconsent':'カカオ受信の再同意を確認','agenda.t.geoFailed':'AI検索露出の測定に失敗','agenda.t.geoPartial':'AI検索露出の測定が一部失敗','agenda.t.geoDone':'AI検索露出の測定が完了','agenda.t.placeNews':'プレイスのお知らせが承認待ち','agenda.t.placeReply':'プレイスのレビュー返信が承認待ち','agenda.t.adsDaangn':'Daangn広告の提案が承認待ち','agenda.t.adsNaver':'Naver検索広告の提案が承認待ち',
 'agenda.d.geo':'完了 {done}/{total}件','agenda.d.geoFailed':'完了 {done}/{total}件、失敗 {failed}件',
 'agenda.t.csOverdue':'顧客問い合わせの約束期限を超過','agenda.t.csSoon':'顧客問い合わせの約束期限が間近','agenda.t.signal':'新しい検知シグナル','agenda.t.expansion':'拡大提案が承認待ち','agenda.t.landing':'詳細ページの修正案が承認待ち','agenda.t.landingApproved':'承認した詳細ページの適用確認待ち','agenda.t.collaboration':'コラボコンテンツが承認待ち','agenda.t.missionOverdue':'販売ミッションの期限切れ','agenda.t.missionSoon':'販売ミッションの期限まで3日以内',
};
