import {ApiError, readRecord, listRecords, recordStatement, stamp, database, str} from './server';
import {openRecordSecret, sealRecordSecret} from './credential-crypto-server';
import {connectorFor, connectorKeys, connectors} from './connectors';
import {ConnectorMissingError} from './connectors/errors';
import type {ChannelCredential, ConnectorKey, DirectPublisherCredential, PublisherChannel, VerifiedAccount} from './connectors/types';
import type {Brand} from './agency';
import type {Store} from './store-marketing';

// 토큰 만료가 이만큼 남으면 경고한다. Instagram 장수명 토큰(60일)을 위한 것이다.
export const TOKEN_WARNING_MS = 7 * 86400000;

// F5: 자격증명 단위. 비우면 기존 소유자 단위 레코드(워크스페이스 기본)다. storeId는 brandId와 함께만 쓴다.
export type CredentialScope = {brandId?: string | null; storeId?: string | null};
// 조회가 실제로 자격증명을 찾은 단위. 우선순위는 지점 > 브랜드 > 워크스페이스 기본이다.
export type ResolvedScope = {level: 'store'; brandId: string; storeId: string} | {level: 'brand'; brandId: string} | {level: 'workspace'};
type Unit = {brandId?: string; storeId?: string};

// records에 저장되는 형태. secret만 암호문이고 나머지는 화면에 보여줄 공개 메타데이터다.
// brandId·storeId는 브랜드·지점 단위 레코드에만 있다. 없는 레코드(기존 데이터 포함)는 워크스페이스 기본이다.
type StoredCredential = {
 channel: ConnectorKey;
 brandId?: string;
 storeId?: string;
 secret: string;
 account: string;
 expiresAt?: string;
 createdAt: string;
 updatedAt: string;
};

export type ChannelStatus = {
 channel: ConnectorKey;
 label: string;
 connected: boolean;
 account: string;
 expiresAt: string | null;
 expiringSoon: boolean;
 updatedAt: string | null;
};

// 브랜드(또는 지점) 단위 연결 상태. warning은 만료가 임박했거나 지난 토큰에만 붙는다.
export type BrandChannelStatus = ChannelStatus & {brandId: string; storeId?: string; warning?: string};

// id 규칙: '<owner>:channel_credential:<channel>[:<brandId>[:<storeId>]]'. 같은 kind를 쓰고 기존 레코드 id는 바꾸지 않는다.
const recordId = (channel: string, unit: Unit) => [channel, unit.brandId, unit.storeId].filter(Boolean).join(':');

// 구분자(:)가 든 값은 다른 단위의 id와 겹칠 수 있어 받지 않는다.
function unitId(value: unknown, label: string) {
 const id = str(value, label, 100, true);
 if (id.includes(':')) throw new ApiError(400, `${label} 입력을 확인해 주세요.`);
 return id;
}

function normalized(scope?: CredentialScope): Unit {
 const given = (v: unknown) => v !== undefined && v !== null && v !== '';
 if (!scope || (!given(scope.brandId) && !given(scope.storeId))) return {};
 if (!given(scope.brandId)) throw new ApiError(400, '지점을 지정하려면 브랜드를 선택하세요.');
 return {brandId: unitId(scope.brandId, '브랜드'), ...(given(scope.storeId) ? {storeId: unitId(scope.storeId, '지점')} : {})};
}

async function found<T>(owner: string, kind: string, id: string, message: string) {
 try {
  return await readRecord<T>(owner, kind, id);
 } catch (error) {
  if (error instanceof ApiError && error.status === 404) throw new ApiError(404, message);
  throw error;
 }
}

// 브랜드는 이 워크스페이스에 있어야 하고 지점은 그 브랜드의 지점이어야 한다. 보관한 지점에는 새로 연결하지 않는다(해제는 허용).
async function checkedUnit(owner: string, scope: CredentialScope | undefined, saving: boolean) {
 const unit = normalized(scope);
 if (!unit.brandId) return unit;
 await found<Brand>(owner, 'brand', unit.brandId, '브랜드를 찾을 수 없습니다.');
 if (unit.storeId) {
  const store = await found<Store>(owner, 'store', unit.storeId, '지점을 찾을 수 없습니다.');
  if (store.brandId !== unit.brandId) throw new ApiError(404, '해당 브랜드의 지점이 아닙니다.');
  if (saving && store.status !== 'active') throw new ApiError(409, '보관한 지점입니다.');
 }
 return unit;
}

async function stored(owner: string, channel: ConnectorKey, unit: Unit = {}) {
 try {
  return await readRecord<StoredCredential>(owner, 'channel_credential', recordId(channel, unit));
 } catch (error) {
  if (error instanceof ApiError && error.status === 404) return null;
  throw error;
 }
}

// 조회 후보는 요청한 브랜드의 지점·브랜드와 워크스페이스 기본뿐이다. 다른 브랜드의 레코드는 후보가 될 수 없다.
async function resolve(owner: string, channel: ConnectorKey, unit: Unit) {
 const candidates: ResolvedScope[] = [
  ...(unit.brandId && unit.storeId ? [{level: 'store' as const, brandId: unit.brandId, storeId: unit.storeId}] : []),
  ...(unit.brandId ? [{level: 'brand' as const, brandId: unit.brandId}] : []),
  {level: 'workspace'},
 ];
 for (const scope of candidates) {
  const record = await stored(owner, channel, 'brandId' in scope ? scope : {});
  if (record) return {record, scope};
 }
 return null;
}

// 저장 전에 실제 API로 검증한다. save_hermes / save_connection과 같은 규칙이다. 단위 검증이 먼저라 잘못된 단위로는 외부 API를 부르지 않는다.
export async function saveCredential(owner: string, channel: unknown, input: Record<string, unknown>, scope?: CredentialScope) {
 const connector = connectorFor(channel);
 const unit = await checkedUnit(owner, scope, true);
 const credential = connector.parse(input);
 const verified = await connector.verify(credential);
 const previous = await stored(owner, connector.key, unit);
 const record: StoredCredential = {
  channel: connector.key,
  ...unit,
  secret: await sealRecordSecret(owner, 'channel_credential', recordId(connector.key, unit), JSON.stringify(credential)),
  account: verified.account,
  ...(verified.expiresAt ? {expiresAt: verified.expiresAt} : {}),
  createdAt: previous?.createdAt || stamp(),
  updatedAt: stamp(),
 };
 await recordStatement(owner, 'channel_credential', recordId(connector.key, unit), record).run();
 return {channel: connector.key, ...unit, account: verified.account, expiresAt: verified.expiresAt ?? null};
}

export async function loadCredential(owner: string, channel: unknown, scope?: CredentialScope): Promise<{credential: ChannelCredential; resolvedScope: ResolvedScope}> {
 const connector = connectorFor(channel);
 const hit = await resolve(owner, connector.key, normalized(scope));
 if (!hit) throw new ConnectorMissingError(`${connector.label} 연결이 필요합니다. 연결 및 설정에서 등록해 주세요.`);
 const secret = await openRecordSecret(owner, 'channel_credential', recordId(connector.key, 'brandId' in hit.scope ? hit.scope : {}), hit.record.secret);
 return {credential: JSON.parse(secret) as ChannelCredential, resolvedScope: hit.scope};
}

// 요청한 단위의 레코드만 지운다. 브랜드를 해제해도 그 지점·워크스페이스 기본은 남는다.
export async function revokeCredential(owner: string, channel: unknown, scope?: CredentialScope) {
 const connector = connectorFor(channel);
 const unit = await checkedUnit(owner, scope, false);
 if (!(await stored(owner, connector.key, unit))) return {revoked: false};
 // 레코드를 비우는 대신 기존 recordStatement 경로를 쓰면 암호문이 남으므로 직접 지운다.
 await database().prepare('DELETE FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:channel_credential:${recordId(connector.key, unit)}`, owner, 'channel_credential').run();
 return {revoked: true};
}

function statusOf(channel: ConnectorKey, record: StoredCredential | undefined): ChannelStatus {
 const expiresAt = record?.expiresAt ?? null;
 return {
  channel,
  label: connectors[channel]!.label,
  connected: !!record,
  account: record?.account || '',
  expiresAt,
  expiringSoon: !!expiresAt && Date.parse(expiresAt) - Date.now() < TOKEN_WARNING_MS,
  updatedAt: record?.updatedAt || null,
 };
}

function brandStatus(channel: ConnectorKey, brandId: string, storeId: string | undefined, record: StoredCredential | undefined): BrandChannelStatus {
 const status = statusOf(channel, record);
 const warning = !status.expiringSoon ? '' : Date.parse(status.expiresAt!) <= Date.now() ? '토큰이 만료됐습니다. 새 토큰으로 다시 연결하세요.' : '토큰이 7일 안에 만료됩니다. 새 토큰으로 다시 연결하세요.';
 return {...status, brandId, ...(storeId ? {storeId} : {}), ...(warning ? {warning} : {})};
}

// 비밀값을 절대 포함하지 않는다. 화면과 API 응답은 이 함수만 사용한다.
// channels는 워크스페이스 기본(기존 소유자 단위)만, byBrand는 브랜드마다 채널별 브랜드 단위 상태와 저장된 지점 단위 상태다.
export async function channelStatus(owner: string): Promise<{channels: ChannelStatus[]; byBrand: BrandChannelStatus[]}> {
 const [records, brands] = await Promise.all([listRecords<StoredCredential>(owner, 'channel_credential'), listRecords<Brand>(owner, 'brand')]);
 const byChannel = new Map(records.filter(r => !r.brandId).map(r => [r.channel, r]));
 const scoped = records.filter(r => r.brandId && connectors[r.channel]);
 const brandLevel = new Map(scoped.filter(r => !r.storeId).map(r => [`${r.brandId}:${r.channel}`, r]));
 const known = new Set(brands.map(b => b.id));
 return {
  channels: connectorKeys.map(key => statusOf(key, byChannel.get(key))),
  byBrand: [
   ...brands.flatMap(b => connectorKeys.map(key => brandStatus(key, b.id, undefined, brandLevel.get(`${b.id}:${key}`)))),
   ...scoped.filter(r => r.storeId || !known.has(r.brandId!)).map(r => brandStatus(r.channel, r.brandId!, r.storeId, r)),
  ],
 };
}

// 이 브랜드·지점의 수집이 어느 단위 자격증명을 쓰는지 보여 준다(수집과 같은 우선순위). 암호문은 풀지 않는다.
export async function credentialResolution(owner: string, scope: CredentialScope) {
 const unit = await checkedUnit(owner, scope, false);
 return Promise.all(connectorKeys.map(async key => {
  const hit = await resolve(owner, key, unit);
  return {channel: key, label: connectors[key]!.label, resolvedScope: hit?.scope ?? null, account: hit?.record.account || '', expiresAt: hit?.record.expiresAt ?? null};
 }));
}

// ---- C3 직접 게시 자격증명(instagram_direct·threads). 같은 kind(channel_credential)·같은 id 규칙 '<channel>:<brandId>'을 쓰되 브랜드 단위만 허용한다(지점·워크스페이스 기본 없음).
// 기존 조회(channelStatus·credentialResolution)는 connectors에 없는 채널을 무시하므로 영향이 없다. version은 발행 승인 때 '발행 계정' 드리프트 검사에 쓴다(lib/execution.ts approvalDrift).
export const publisherChannels: readonly PublisherChannel[] = ['instagram_direct', 'threads'];
export const publisherLabels: Record<PublisherChannel, string> = {instagram_direct: 'Instagram 직접 게시(Graph API)', threads: 'Threads 게시'};
type StoredPublisherCredential = {channel: PublisherChannel; brandId: string; secret: string; account: string; userId: string; expiresAt?: string; login?: 'facebook' | 'instagram'; version: number; createdAt: string; updatedAt: string};
export type PublisherCredentialMeta = {channel: PublisherChannel; brandId: string; account: string; userId: string; expiresAt: string | null; expiringSoon: boolean; version: number; updatedAt: string};
export type PublisherVerifier = (credential: DirectPublisherCredential) => Promise<VerifiedAccount>;
// 브랜드 입력(unknown)을 단위 검사 입력으로. 문자열이 아니면 브랜드 없음으로 보고 뒤의 '브랜드를 선택' 검사가 막는다.
const brandScope = (value: unknown): CredentialScope => ({brandId: typeof value === 'string' ? value : null});

export function publisherChannel(value: unknown): PublisherChannel {
 if (value !== 'instagram_direct' && value !== 'threads') throw new ApiError(400, '직접 게시 채널(instagram_direct·threads)을 선택하세요.');
 return value;
}
// 사용자 입력 → 자격증명. 토큰 만료일은 토큰에서 읽을 수 없어 사용자가 발급 때 확인한 값을 보관하고 경고에만 쓴다.
export function parsePublisherCredential(channel: PublisherChannel, input: Record<string, unknown>): DirectPublisherCredential {
 const accessToken = str(input.accessToken, '액세스 토큰', 1000, true), userId = str(input.userId, channel === 'threads' ? 'Threads 계정 ID' : 'Instagram 계정 ID', 40, true);
 if (!/^\d{1,25}$/.test(userId)) throw new ApiError(400, '계정 ID는 숫자입니다.');
 const login = input.login === undefined || input.login === null || input.login === '' ? undefined : input.login;
 if (login !== undefined && login !== 'facebook' && login !== 'instagram') throw new ApiError(400, '로그인 종류는 facebook 또는 instagram입니다.');
 const expiresAt = str(input.expiresAt ?? '', '토큰 만료일', 40);
 if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw new ApiError(400, '토큰 만료일을 확인해 주세요.');
 return {channel, accessToken, userId, ...(expiresAt ? {expiresAt: new Date(expiresAt).toISOString()} : {}), ...(channel === 'instagram_direct' && login ? {login} : {})};
}
async function storedPublisher(owner: string, channel: PublisherChannel, brandId: string) {
 try { return await readRecord<StoredPublisherCredential>(owner, 'channel_credential', recordId(channel, {brandId})); }
 catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
}
const publisherMeta = (r: StoredPublisherCredential): PublisherCredentialMeta => ({channel: r.channel, brandId: r.brandId, account: r.account, userId: r.userId, expiresAt: r.expiresAt ?? null, expiringSoon: !!r.expiresAt && Date.parse(r.expiresAt) - Date.now() < TOKEN_WARNING_MS, version: r.version, updatedAt: r.updatedAt});
// 저장 전에 verify(/me)로 토큰이 그 계정의 것인지 확인한다. 실패하면 저장하지 않는다. 비밀값은 응답에 담지 않는다.
export async function savePublisherCredential(owner: string, channelInput: unknown, brandIdInput: unknown, input: Record<string, unknown>, verify: PublisherVerifier): Promise<PublisherCredentialMeta> {
 const channel = publisherChannel(channelInput), unit = await checkedUnit(owner, brandScope(brandIdInput), true);
 if (!unit.brandId) throw new ApiError(400, '직접 게시 연결은 브랜드를 선택해야 합니다.');
 const credential = parsePublisherCredential(channel, input), verified = await verify(credential), previous = await storedPublisher(owner, channel, unit.brandId);
 const record: StoredPublisherCredential = {
  channel, brandId: unit.brandId,
  secret: await sealRecordSecret(owner, 'channel_credential', recordId(channel, unit), JSON.stringify(credential)),
  account: verified.account, userId: credential.userId,
  ...(credential.expiresAt ? {expiresAt: credential.expiresAt} : {}), ...(credential.login ? {login: credential.login} : {}),
  version: (previous?.version || 0) + 1, createdAt: previous?.createdAt || stamp(), updatedAt: stamp(),
 };
 await recordStatement(owner, 'channel_credential', recordId(channel, unit), record).run();
 return publisherMeta(record);
}
export async function loadPublisherCredential(owner: string, channel: PublisherChannel, brandId: string): Promise<{credential: DirectPublisherCredential; meta: PublisherCredentialMeta} | null> {
 const record = await storedPublisher(owner, channel, brandId);
 if (!record) return null;
 const secret = await openRecordSecret(owner, 'channel_credential', recordId(channel, {brandId}), record.secret);
 return {credential: JSON.parse(secret) as DirectPublisherCredential, meta: publisherMeta(record)};
}
// 저장된 토큰으로 /me를 다시 불러 지금도 유효한지 본다. 저장은 바꾸지 않는다(계정 이름이 달라졌으면 응답에만 보인다).
export async function verifyPublisherCredential(owner: string, channelInput: unknown, brandIdInput: unknown, verify: PublisherVerifier) {
 const channel = publisherChannel(channelInput), unit = await checkedUnit(owner, brandScope(brandIdInput), false);
 const loaded = unit.brandId ? await loadPublisherCredential(owner, channel, unit.brandId) : null;
 if (!loaded) throw new ConnectorMissingError(`${publisherLabels[channel]} 연결이 없습니다. 먼저 연결하세요.`);
 const verified = await verify(loaded.credential);
 return {...loaded.meta, verifiedAccount: verified.account, verifiedAt: stamp()};
}
export async function revokePublisherCredential(owner: string, channelInput: unknown, brandIdInput: unknown) {
 const channel = publisherChannel(channelInput), unit = await checkedUnit(owner, brandScope(brandIdInput), false);
 if (!unit.brandId || !(await storedPublisher(owner, channel, unit.brandId))) return {revoked: false};
 await database().prepare('DELETE FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:channel_credential:${recordId(channel, unit)}`, owner, 'channel_credential').run();
 return {revoked: true};
}
// 브랜드의 직접 게시 연결 상태(비밀값 없음). 연결이 없는 채널은 connected:false다.
export async function publisherCredentialStatus(owner: string, brandIdInput: unknown): Promise<(PublisherCredentialMeta & {connected: true; label: string} | {channel: PublisherChannel; brandId: string; connected: false; label: string})[]> {
 const unit = await checkedUnit(owner, brandScope(brandIdInput), false);
 if (!unit.brandId) throw new ApiError(400, '브랜드를 선택하세요.');
 const brandId = unit.brandId;
 return Promise.all(publisherChannels.map(async channel => {
  const record = await storedPublisher(owner, channel, brandId);
  return record ? {...publisherMeta(record), connected: true as const, label: publisherLabels[channel]} : {channel, brandId, connected: false as const, label: publisherLabels[channel]};
 }));
}
