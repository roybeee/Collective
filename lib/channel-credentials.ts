import {ApiError, encrypt, decrypt, readRecord, listRecords, recordStatement, stamp, database} from './server';
import {connectorFor, connectorKeys, connectors} from './connectors';
import type {ChannelCredential, ConnectorKey} from './connectors/types';

// 토큰 만료가 이만큼 남으면 경고한다. Instagram 장수명 토큰(60일)을 위한 것이다.
export const TOKEN_WARNING_MS = 7 * 86400000;

// records에 저장되는 형태. secret만 암호문이고 나머지는 화면에 보여줄 공개 메타데이터다.
type StoredCredential = {
 channel: ConnectorKey;
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

async function stored(owner: string, channel: ConnectorKey) {
 try {
  return await readRecord<StoredCredential>(owner, 'channel_credential', channel);
 } catch (error) {
  if (error instanceof ApiError && error.status === 404) return null;
  throw error;
 }
}

// 저장 전에 실제 API로 검증한다. save_hermes / save_connection과 같은 규칙이다.
export async function saveCredential(owner: string, channel: unknown, input: Record<string, unknown>) {
 const connector = connectorFor(channel);
 const credential = connector.parse(input);
 const verified = await connector.verify(credential);
 const previous = await stored(owner, connector.key);
 const record: StoredCredential = {
  channel: connector.key,
  secret: await encrypt(JSON.stringify(credential)),
  account: verified.account,
  ...(verified.expiresAt ? {expiresAt: verified.expiresAt} : {}),
  createdAt: previous?.createdAt || stamp(),
  updatedAt: stamp(),
 };
 await recordStatement(owner, 'channel_credential', connector.key, record).run();
 return {channel: connector.key, account: verified.account, expiresAt: verified.expiresAt ?? null};
}

export async function loadCredential(owner: string, channel: unknown): Promise<ChannelCredential> {
 const connector = connectorFor(channel);
 const record = await stored(owner, connector.key);
 if (!record) throw new ApiError(409, `${connector.label} 연결이 필요합니다. 연결 및 설정에서 등록해 주세요.`);
 return JSON.parse(await decrypt(record.secret)) as ChannelCredential;
}

export async function revokeCredential(owner: string, channel: unknown) {
 const connector = connectorFor(channel);
 if (!(await stored(owner, connector.key))) return {revoked: false};
 // 레코드를 비우는 대신 기존 recordStatement 경로를 쓰면 암호문이 남으므로 직접 지운다.
 await database().prepare('DELETE FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:channel_credential:${connector.key}`, owner, 'channel_credential').run();
 return {revoked: true};
}

// 비밀값을 절대 포함하지 않는다. 화면과 API 응답은 이 함수만 사용한다.
export async function channelStatus(owner: string): Promise<{channels: ChannelStatus[]}> {
 const records = await listRecords<StoredCredential>(owner, 'channel_credential');
 const byChannel = new Map(records.map(r => [r.channel, r]));
 return {
  channels: connectorKeys.map(key => {
   const record = byChannel.get(key);
   const expiresAt = record?.expiresAt ?? null;
   return {
    channel: key,
    label: connectors[key]!.label,
    connected: !!record,
    account: record?.account || '',
    expiresAt,
    expiringSoon: !!expiresAt && Date.parse(expiresAt) - Date.now() < TOKEN_WARNING_MS,
    updatedAt: record?.updatedAt || null,
   };
  }),
 };
}
