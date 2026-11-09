// C5 플레이스 리뷰 답글·소식 초안(순수). 저장·권한·스위치는 lib/place-drafts-server.ts, 규칙과 한계는 docs/PLACE-DRAFTS.ko.md.
// 원칙: (1) 초안은 결정론 템플릿이다(모델 호출 없음). 템플릿에 넣는 사실은 확정 사실(lib/brand-facts.ts effectiveBrandFacts)뿐이다.
// (2) 문안의 금액·할인율·혜택·최상급 표현은 확정 사실 값에 없으면 막는다(가짜 주장 금지). 프로모션 소식은 [광고] 표기가 있어야 한다.
// (3) 네이버 스마트플레이스에는 공개 쓰기 API가 없다. 자동 제출은 없고, 사람이 승인한 문안만 복사·제출 지원 또는 점포 브라우저 작업으로 넘긴다.
import {checkCompliance, type ComplianceIssue} from './graders/compliance';
import {canonicalFactKey} from './fact-catalog';
import {maskText} from './pii-scan';
import type {BrandFact, FactRef} from './brand-facts';

export class PlaceDraftError extends Error { constructor(message: string) { super(message); this.name = 'PlaceDraftError'; } }

export const PLACE_DRAFT_KINDS = ['review_reply', 'news_post'] as const;
export type PlaceDraftKind = typeof PLACE_DRAFT_KINDS[number];
export const NEWS_TOPICS = ['notice', 'promotion', 'menu'] as const;
export type NewsTopic = typeof NEWS_TOPICS[number];
export const PLACE_DRAFT_STATUSES = ['draft', 'approved', 'submitted', 'verified', 'cancelled'] as const;
export type PlaceDraftStatus = typeof PLACE_DRAFT_STATUSES[number];
export type Sentiment = 'positive' | 'negative' | 'neutral';
export type VoiceStyle = 'formal' | 'friendly';
// 글자 상한(미확인 가정: 스마트플레이스 답글·소식 입력칸의 실제 상한을 관찰하지 못해 보수적으로 둔다).
export const PLACE_DRAFT_LIMITS = {source: 2000, reviewRef: 100, title: 60, condition: 300, body: 1000, reply: 1000, news: 2000, note: 500, history: 30} as const;
export const PLACE_DRAFT_LABELS: Record<PlaceDraftStatus, string> = {draft: '초안', approved: '승인됨(제출 전)', submitted: '제출 표시', verified: '게시 확인', cancelled: '취소'};

export type PlaceDraftSource = {text: string; origin: 'operator_paste'; reviewRef?: string; rating?: number | null; masked: {kind: string; count: number}[]};
export type NewsInput = {topic: NewsTopic; title: string; condition?: string; body?: string; period?: {from: string; to: string}};
export type ComplianceCheck = {issues: (Pick<ComplianceIssue, 'ruleId' | 'severity' | 'title' | 'excerpt'> & {category: string})[]; blocking: boolean; checkedAt: string; lexicon: string};
export type PlaceDraftTransition = {at: string; from: PlaceDraftStatus | null; to: PlaceDraftStatus; by: string; note?: string};
export type PlaceDraft = {
 id: string; storeId: string; brandId: string; kind: PlaceDraftKind; status: PlaceDraftStatus; version: number;
 source: PlaceDraftSource | null; news: NewsInput | null;
 draft: {text: string; template: string; sentiment: Sentiment | null; style: VoiceStyle; edited: boolean; factRefs: FactRef[]; voiceVersion: number | null};
 compliance: ComplianceCheck;
 approvedAt?: string; approvedBy?: string; approvedSha256?: string;
 submission?: {channel: 'manual' | 'device'; at: string; by: string; note?: string; deviceJobId?: string};
 deviceTask?: {jobId: string; createdAt: string; createdBy: string; jobStatus?: string};
 verification?: {at: string; by: string; note?: string; source: 'manual' | 'device'};
 history: PlaceDraftTransition[]; createdAt: string; createdBy: string; updatedAt: string;
};
export type DraftContext = {storeLabel: string; facts: readonly BrandFact[]; voice: {version: number; tone: readonly string[]; avoidTerms: readonly string[]} | null};

const POSITIVE = /맛있|맛나|좋았|좋아요|좋네|친절|최고|또\s?(?:올|갈|방문)|재방문|만족|추천|감사|훌륭|깔끔|든든/;
const NEGATIVE = /별로|불친절|늦|실망|차갑|식었|비싸|위생|머리카락|이물|불쾌|최악|다시는|아쉬|느렸|짜요|짰|싱거|불편/;
const FRIENDLY = /친근|캐주얼|편안|다정|발랄|밝/;

// 리뷰 분위기: 별점이 있으면 별점(4~5 긍정, 1~2 부정, 3 중립), 없으면 단어. 부정 단어가 있으면 긍정 단어보다 우선한다(사과가 빠지지 않게).
export function sentimentOf(text: string, rating?: number | null): Sentiment {
 if (typeof rating === 'number' && rating >= 1 && rating <= 5) return rating >= 4 && !NEGATIVE.test(text) ? 'positive' : rating <= 2 ? 'negative' : NEGATIVE.test(text) ? 'negative' : 'neutral';
 return NEGATIVE.test(text) ? 'negative' : POSITIVE.test(text) ? 'positive' : 'neutral';
}
export const styleOf = (voice: DraftContext['voice']): VoiceStyle => voice && voice.tone.some(t => FRIENDLY.test(t)) ? 'friendly' : 'formal';
const factValue = (facts: readonly BrandFact[], key: string) => facts.find(f => canonicalFactKey(f.key) === key)?.value.trim() || null;
const usedRefs = (facts: readonly BrandFact[], keys: readonly string[]): FactRef[] => facts.filter(f => keys.includes(canonicalFactKey(f.key))).map(f => ({id: f.id, version: f.version})).sort((a, b) => a.id.localeCompare(b.id));

const REPLY_LINES: Record<VoiceStyle, Record<Sentiment, string[]>> = {
 formal: {
  positive: ['소중한 후기를 남겨 주셔서 감사합니다.', '말씀해 주신 부분은 매장 식구들과 함께 나누겠습니다.', '다음 방문 때도 만족하실 수 있도록 준비하겠습니다.'],
  negative: ['이용에 불편을 드려 죄송합니다.', '말씀해 주신 내용은 매장에서 확인하고 개선하겠습니다.'],
  neutral: ['방문해 주셔서 감사합니다.', '남겨 주신 의견은 매장 운영에 참고하겠습니다.'],
 },
 friendly: {
  positive: ['소중한 후기 남겨 주셔서 감사해요.', '말씀해 주신 부분은 매장 식구들과 함께 나눌게요.', '다음에도 기분 좋게 드시고 가실 수 있게 준비할게요.'],
  negative: ['불편을 드려서 정말 죄송해요.', '말씀해 주신 내용은 매장에서 꼭 확인하고 고칠게요.'],
  neutral: ['들러 주셔서 감사해요.', '남겨 주신 의견은 매장 운영에 참고할게요.'],
 },
};

// 리뷰 답글(결정론). 부정 리뷰에는 확정된 전화번호가 있을 때만 연락처 안내를 붙인다. 리뷰 원문·리뷰어 이름은 답글에 다시 쓰지 않는다.
export function reviewReplyDraft(source: Pick<PlaceDraftSource, 'text' | 'rating'>, ctx: DraftContext): PlaceDraft['draft'] {
 const sentiment = sentimentOf(source.text, source.rating), style = styleOf(ctx.voice), phone = sentiment === 'negative' ? factValue(ctx.facts, 'phone') : null;
 const lines = [`안녕하세요, ${ctx.storeLabel}입니다.`, ...REPLY_LINES[style][sentiment], ...(phone ? [style === 'formal' ? `더 자세한 상황은 ${phone}로 연락 주시면 직접 확인하겠습니다.` : `자세한 상황은 ${phone}로 연락 주시면 직접 확인할게요.`] : [])];
 return {text: lines.join(' '), template: `review_reply.${sentiment}.${style}`, sentiment, style, edited: false, factRefs: usedRefs(ctx.facts, phone ? ['phone'] : []), voiceVersion: ctx.voice?.version ?? null};
}

// 소식(결정론). 운영자 문구(제목·조건·본문)는 그대로 넣고 확정 사실(영업시간·주소)만 덧붙인다. 프로모션은 첫 줄에 [광고] 표기를 넣는다.
export function newsPostDraft(news: NewsInput, ctx: DraftContext): PlaceDraft['draft'] {
 const style = styleOf(ctx.voice), hours = factValue(ctx.facts, 'hours'), address = factValue(ctx.facts, 'address');
 const period = news.period ? `${news.period.from}~${news.period.to}` : null;
 const head = news.topic === 'promotion' ? `[광고] ${news.title}` : news.title;
 const lead = news.topic === 'promotion' && news.condition ? `${ctx.storeLabel}에서 ${period ? `${period} 동안 ` : ''}${news.condition}` : news.topic === 'menu' ? `${ctx.storeLabel}의 메뉴 소식입니다.` : `${ctx.storeLabel} 소식입니다.`;
 const close = news.topic === 'promotion' ? (style === 'formal' ? '자세한 조건은 매장에 문의해 주세요.' : '자세한 조건은 매장에 물어봐 주세요.') : (style === 'formal' ? '방문에 참고해 주세요.' : '방문하실 때 참고해 주세요.');
 const info = [hours ? `영업시간: ${hours}` : '', address ? `주소: ${address}` : ''].filter(Boolean);
 const text = [head, '', lead, ...(news.body ? ['', news.body] : []), ...(info.length ? ['', ...info] : []), '', close].join('\n');
 return {text, template: `news_post.${news.topic}.${style}`, sentiment: null, style, edited: false, factRefs: usedRefs(ctx.facts, [...(hours ? ['hours'] : []), ...(address ? ['address'] : [])]), voiceVersion: ctx.voice?.version ?? null};
}

const SUPERLATIVE = /최고|최초|유일|1위|일등|넘버원|No\.?\s?1|100\s?%|무조건|완벽|국내\s?최|업계\s?최|가장\s?(?:맛있|저렴|싼)/gi;
const NUMBER_CLAIM = /\d[\d,.]*\s?(?:만\s?원|원|%|퍼센트)|\d+\s?\+\s?\d+|반값|무료|공짜|1\s?\+\s?1/g;
const compact = (s: string) => s.normalize('NFKC').replace(/[\s,]/g, '').toLowerCase();
const AD_LABEL = /^\s*(?:\[광고\]|\(광고\))/;
// 운영자 자유 문구의 수치·최상급 주장이 확정 사실 값 안에 있는지. 확정 사실에 없으면 가짜 주장 후보로 막는다(blocking).
function claimIssues(free: string, facts: readonly BrandFact[]): ComplianceCheck['issues'] {
 const pool = facts.map(f => compact(f.value)).join('|');
 const unconfirmed = (re: RegExp) => [...new Set([...free.matchAll(re)].map(m => m[0].trim()))].filter(v => !pool.includes(compact(v)));
 return [
  ...unconfirmed(NUMBER_CLAIM).map(v => ({category: 'place_claim', ruleId: 'place_unconfirmed_value', severity: 'block' as const, title: '확정 사실에 없는 금액·할인·혜택', excerpt: v})),
  ...unconfirmed(SUPERLATIVE).map(v => ({category: 'place_claim', ruleId: 'place_unconfirmed_superlative', severity: 'block' as const, title: '확정 사실에 없는 최상급·보장 표현', excerpt: v})),
 ];
}
// 규정 점검: 공통 표시·광고 사전(lib/graders/compliance.ts, 확정·거절 사실 원장) + 플레이스 규칙(광고 표기·확정 사실 대조·길이·피할 표현).
export function checkPlaceDraft(input: {kind: PlaceDraftKind; text: string; news: NewsInput | null; facts: readonly BrandFact[]; prohibited: readonly BrandFact[]; avoidTerms: readonly string[]; now: string}): ComplianceCheck {
 const report = checkCompliance(input.text, {facts: {confirmed: input.facts.map(f => ({key: f.key, value: f.value})), prohibited: input.prohibited.map(f => ({key: f.key, value: f.value}))}});
 const max = input.kind === 'review_reply' ? PLACE_DRAFT_LIMITS.reply : PLACE_DRAFT_LIMITS.news;
 const issues: ComplianceCheck['issues'] = [
  ...report.issues.map(i => ({category: i.category, ruleId: i.ruleId, severity: i.severity, title: i.title, excerpt: i.excerpt})),
  ...(input.kind === 'news_post' && input.news?.topic === 'promotion' && !AD_LABEL.test(input.text) ? [{category: 'place_label', ruleId: 'place_promotion_label', severity: 'block' as const, title: '프로모션 소식 첫 줄에 [광고] 표기가 없습니다', excerpt: input.text.split('\n')[0].slice(0, 60)}] : []),
  // 템플릿은 운영자 문구를 그대로 넣고 확정 사실만 덧붙이므로 실제 문안 전체를 본다(사람이 고친 문안도 같은 기준).
  ...claimIssues(input.text, input.facts),
  ...(input.text.length > max ? [{category: 'place_length', ruleId: 'place_length', severity: 'block' as const, title: `${max}자를 넘습니다`, excerpt: `${input.text.length}자`}] : []),
  ...(!input.text.trim() ? [{category: 'place_length', ruleId: 'place_empty', severity: 'block' as const, title: '문안이 비었습니다', excerpt: ''}] : []),
  ...input.avoidTerms.filter(t => t && input.text.includes(t)).map(t => ({category: 'brand_voice', ruleId: 'place_voice_avoid', severity: 'warn' as const, title: '브랜드 말투에서 피할 표현', excerpt: t})),
 ];
 return {issues, blocking: issues.some(i => i.severity === 'block'), checkedAt: input.now, lexicon: report.version};
}

// 붙여 넣은 리뷰 원문은 저장 전에 개인정보 패턴(전화·이메일·주소 등)을 가린다. 가린 종류·건수만 남긴다.
export function sourceOf(input: {text: string; reviewRef?: string; rating?: number | null}): PlaceDraftSource {
 const masked = maskText(input.text);
 return {text: masked.text, origin: 'operator_paste', ...(input.reviewRef ? {reviewRef: input.reviewRef} : {}), rating: input.rating ?? null, masked: masked.findings.map(f => ({kind: f.kind, count: f.count}))};
}

const EDGES: Record<PlaceDraftStatus, readonly PlaceDraftStatus[]> = {draft: ['approved', 'cancelled'], approved: ['submitted', 'cancelled'], submitted: ['verified'], verified: [], cancelled: []};
export function transitionDraft(d: PlaceDraft, to: PlaceDraftStatus, by: string, at: string, note?: string): PlaceDraft {
 if (!EDGES[d.status].includes(to)) throw new PlaceDraftError(`${PLACE_DRAFT_LABELS[d.status]} 상태에서는 ${PLACE_DRAFT_LABELS[to]}(으)로 바꿀 수 없습니다.`);
 const entry: PlaceDraftTransition = {at, from: d.status, to, by, ...(note ? {note} : {})};
 return {...d, status: to, version: d.version + 1, updatedAt: at, history: [...d.history, entry].slice(-PLACE_DRAFT_LIMITS.history)};
}
// 승인 문안 해시(SHA-256 hex). 승인 뒤 문안이 바뀌면 제출·장치 작업을 막는다.
export async function sha256Hex(text: string) {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
