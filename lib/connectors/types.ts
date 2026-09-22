import type {Arm} from '../learning';
import type {StoreMetricKey} from '../store-marketing';
import type {ConnectorKey} from '../channels';

// 채널 어휘의 단일 원본은 lib/channels.ts다. 여기서는 다시 정의하지 않고 통과시킨다.
export type {ConnectorKey};
export type CollectionWindow = {from: string; to: string};

// 커넥터는 숫자만 주지 않는다. 기존 코드 전체가 "같은 계정·채널·범위·정의·기간길이에서만 비교"를
// 강제하므로, 그 판단에 필요한 메타데이터를 함께 돌려준다. 모르는 값은 null로 남기고 0과 구분한다.
export type Collected = {
 arm?: Arm;
 storeValues?: Partial<Record<StoreMetricKey, number | null>>;
 account: string;
 definition: string;
 window: CollectionWindow;
 fetchedAt: string;
 // 접근 불가, 부분 데이터, 지연 반영처럼 수치의 해석을 제한하는 사실.
 limitations: string[];
 raw: unknown;
};

export type NaverAdsCredential = {channel: 'naver_ads'; apiKey: string; secretKey: string; customerId: string};
export type InstagramCredential = {channel: 'instagram'; accessToken: string; userId: string; expiresAt?: string};
export type ChannelCredential = NaverAdsCredential | InstagramCredential;

export type VerifiedAccount = {account: string; expiresAt?: string};

export type Connector = {
 key: ConnectorKey;
 label: string;
 // 사용자 입력을 자격증명 형태로 검증한다. 저장 전에 호출한다.
 parse(input: Record<string, unknown>): ChannelCredential;
 // 실제 API를 호출해 자격증명이 동작하는지 확인한다. 저장 전에 호출한다.
 verify(credential: ChannelCredential): Promise<VerifiedAccount>;
 collect(credential: ChannelCredential, target: string, window: CollectionWindow): Promise<Collected>;
};
