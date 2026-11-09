// C8 당근 광고 서버: 연결(키 저장)·확인·해제·상태·성과 수집. 키는 lib/channel-credentials.ts 외부 채널 경로(kind channel_credential, 암호화)에 둔다(지점 > 브랜드 > 워크스페이스 기본).
// 스위치 daangn_ads(기본 꺼짐): 꺼져 있으면 연결·확인·수집·제안 생성·승인·반영은 409다. 해제·상태 조회·저장된 성과 조회·미확인 대조는 계속된다.
// 성과는 kind daangn_ads_performance(parent_id=지점 또는 '')에 lib/connectors/types.ts Collected 모양으로 남긴다. 기존 측정 초안(measurement_draft)은 커넥터 키 'naver_ads'|'instagram'에 묶여 있어 이번 판에서 잇지 않았다(docs/DAANGN-ADS.ko.md 4절).
import {ApiError, listRecords, readRecord, recordStatement, stamp, str, type Actor} from './server';
import {isEnabled} from './feature-flags';
import {externalCredentialStatus, loadExternalCredential, revokeExternalCredential, saveExternalCredential, type ResolvedScope} from './channel-credentials';
import {collectPerformance, parseDaangnCredential, verifyDaangn, type DaangnAdsCredential, type DaangnDeps} from './connectors/daangn-ads';
import {statsWindow} from './ads-proposals';
import type {Collected} from './connectors/types';
import type {Store} from './store-marketing';

export const DAANGN_CHANNEL = 'daangn_ads' as const;
export const DAANGN_FLAG_OFF = '당근 광고 스위치 꺼짐: 소유자가 기능 스위치 daangn_ads를 켜야 연결·수집·제안 생성·승인·반영을 할 수 있습니다. 해제·조회·미확인 대조는 계속됩니다.';
export const DAANGN_NOTICE = '당근 광고 OpenAPI는 공개 베타입니다. 인증 헤더·경로·필드 이름은 실계정 확인 전 가정이며, 수치는 당근 광고가 돌려준 값 그대로입니다(검증 전 성과를 사실처럼 쓰지 않습니다).';
export type DaangnScope = {brandId: string | null; storeId: string | null};
export type DaangnPerformanceRecord = {id: string; storeId: string | null; brandId: string | null; adAccountId: string; level: 'campaign' | 'adgroup'; targetId: string; collected: Collected; resolvedScope: ResolvedScope; collectedBy: string; createdAt: string};

export async function daangnOn(owner: string) { return isEnabled(owner, 'daangn_ads').catch(() => false); }
export async function requireDaangn(owner: string) { if (!(await daangnOn(owner))) throw new ApiError(409, DAANGN_FLAG_OFF); }
export function requireDaangnAdmin(who: Actor) { if (who.role !== 'owner' && who.role !== 'admin') throw new ApiError(403, '소유자·관리자만 당근 광고를 연결·수집·승인할 수 있습니다.'); }

// 지점은 이 워크스페이스의 지점이어야 하고 브랜드와 맞아야 한다. 외부 API를 부르기 전에 확인한다.
export async function daangnScope(owner: string, input: Record<string, unknown>): Promise<DaangnScope> {
 const given = (v: unknown) => v !== undefined && v !== null && v !== '';
 const storeId = given(input.storeId) ? str(input.storeId, '지점', 100, true) : null, brandId = given(input.brandId) ? str(input.brandId, '브랜드', 100, true) : null;
 if (!storeId) return {brandId, storeId: null};
 const store = await readRecord<Store>(owner, 'store', storeId);
 if (brandId && store.brandId !== brandId) throw new ApiError(400, '지점이 그 브랜드에 속하지 않습니다.');
 return {brandId: store.brandId, storeId};
}

export async function loadDaangnCredential(owner: string, scope: DaangnScope) {
 const hit = await loadExternalCredential<DaangnAdsCredential>(owner, DAANGN_CHANNEL, scope);
 if (!hit) throw new ApiError(409, '당근 광고 연결이 필요합니다. 관리자가 광고주별 API 키와 광고 계정 ID를 등록해 주세요.');
 return hit;
}
// 연결: 입력 검증 → 단위 검증 → 실제 GET 확인 → 암호화 저장. 확인이 실패하면 저장하지 않는다. 응답에 키 원문은 없다.
export async function connectDaangn(who: Actor, input: Record<string, unknown>, deps?: DaangnDeps) {
 requireDaangnAdmin(who); await requireDaangn(who.owner);
 const credential = parseDaangnCredential(input), scope = await daangnScope(who.owner, input);
 const verified = await verifyDaangn(credential, deps);
 if (verified.agencyRight === false) throw new ApiError(400, '대행사 권한 목록(business-rights)에 이 광고 계정이 없습니다. 광고주의 권한 위임을 확인하세요.');
 const saved = await saveExternalCredential(who.owner, DAANGN_CHANNEL, credential, verified.account, scope);
 return {...saved, campaigns: verified.campaigns, agencyRight: verified.agencyRight, authHeader: credential.authHeader};
}
export async function verifyDaangnConnection(who: Actor, input: Record<string, unknown>, deps?: DaangnDeps) {
 requireDaangnAdmin(who); await requireDaangn(who.owner);
 const {credential, resolvedScope} = await loadDaangnCredential(who.owner, await daangnScope(who.owner, input));
 return {...(await verifyDaangn(credential, deps)), resolvedScope};
}
// 해제는 스위치와 무관하다(키 재발급·유출 대응). 당근 쪽 키 폐기는 광고주가 재발급으로 한다.
export async function revokeDaangn(who: Actor, input: Record<string, unknown>) {
 requireDaangnAdmin(who);
 return revokeExternalCredential(who.owner, DAANGN_CHANNEL, await daangnScope(who.owner, input));
}
export async function daangnStatus(owner: string, input: Record<string, unknown>) {
 const scope = await daangnScope(owner, input);
 return {...(await externalCredentialStatus(owner, DAANGN_CHANNEL, scope)), enabled: await daangnOn(owner), notice: DAANGN_NOTICE};
}

const day = (v: unknown, label: string) => { const s = str(v, label, 20, true); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s))) throw new ApiError(400, `${label}을 YYYY-MM-DD 형식으로 입력하세요.`); return s; };
// 성과 수집(읽기만): 대상 하나의 기간 일별 성과 합계를 Collected 모양으로 저장한다. 기간을 비우면 어제까지 14일이다.
export async function collectDaangn(who: Actor, input: Record<string, unknown>, deps?: DaangnDeps, now = Date.now()) {
 requireDaangnAdmin(who); await requireDaangn(who.owner);
 const level = input.level === undefined || input.level === 'campaign' ? 'campaign' : input.level === 'adgroup' ? 'adgroup' : null;
 if (!level) throw new ApiError(400, '수집 단위는 campaign 또는 adgroup입니다.');
 const targetId = str(input.targetId, '당근 광고 대상 ID', 64, true);
 if (!/^[A-Za-z0-9_-]+$/.test(targetId)) throw new ApiError(400, '당근 광고 대상 ID 형식을 확인하세요.');
 const fallback = statsWindow(now), window = {from: input.from ? day(input.from, '수집 시작일') : fallback.from, to: input.to ? day(input.to, '수집 종료일') : fallback.to};
 if (window.from > window.to) throw new ApiError(400, '수집 기간을 확인하세요.');
 const scope = await daangnScope(who.owner, input), {credential, resolvedScope} = await loadDaangnCredential(who.owner, scope);
 const collected = await collectPerformance(credential, {level, id: targetId}, window, deps);
 const record: DaangnPerformanceRecord = {id: [credential.adAccountId, level, targetId, window.from, window.to].join(':'), storeId: scope.storeId, brandId: scope.brandId, adAccountId: credential.adAccountId, level, targetId, collected, resolvedScope, collectedBy: who.id, createdAt: stamp()};
 await recordStatement(who.owner, 'daangn_ads_performance', record.id, record, scope.storeId ?? '').run();
 return record;
}
export async function listDaangnPerformance(owner: string, storeId?: string | null) {
 const rows = await listRecords<DaangnPerformanceRecord>(owner, 'daangn_ads_performance', storeId || undefined);
 return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
