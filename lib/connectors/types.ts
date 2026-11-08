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

// C1 커넥터 프레임워크 v2: 능력 서술자. 기존 Connector 형태는 그대로 두고 덧붙이기만 한다(하위 호환). 목록은 lib/connectors/registry.ts다.
// riskTier: T1 읽기(지표 조회) · T2 내부 상태 변경(장부·연결) · T3 외부에 보이는 쓰기(게시·이미지 업로드·PAUSED 생성) · T4 돈·노출이 움직이는 쓰기(ACTIVE 광고·전환 전송).
// rateLimit: 계정 키마다 적용하는 호출 상한(lib/connectors/rate-queue.ts). credentialScope: 자격증명을 어느 단위까지 둘 수 있는지(lib/channel-credentials.ts F5: 지점 > 브랜드 > 워크스페이스).
// defaultOff: 모든 능력은 기능 스위치가 기본 꺼짐이다(상수 true로 고정해 서술자가 거짓을 적지 못하게 한다).
export type RiskTier = 'T1' | 'T2' | 'T3' | 'T4';
export type RateLimit = {perSecond?: number; perMinute?: number; perDay?: number};
export type CredentialScopeLevel = 'workspace' | 'brand' | 'store';
export type ConnectorCapability = {
 key: string;
 reads: readonly string[];
 writes: readonly string[];
 riskTier: RiskTier;
 rateLimit: RateLimit;
 credentialScope: CredentialScopeLevel;
 defaultOff: true;
 // 능력을 켜는 기능 스위치 이름(lib/feature-flags.ts). 스위치 없이 늘 켜진 읽기(기존 수집)는 null이다.
 flag: string | null;
 // 쓰기 결과를 모를 때(전송 뒤 타임아웃) 자동 재시도하지 않는다는 규율을 서술자에도 적는다. 읽기는 재시도해도 된다.
 retryUnknown: false;
};
export type ConnectorDescriptor = {key: string; label: string; module: string; capabilities: readonly ConnectorCapability[]};

export type Connector = {
 key: ConnectorKey;
 label: string;
 // 사용자 입력을 자격증명 형태로 검증한다. 저장 전에 호출한다.
 parse(input: Record<string, unknown>): ChannelCredential;
 // 실제 API를 호출해 자격증명이 동작하는지 확인한다. 저장 전에 호출한다.
 verify(credential: ChannelCredential): Promise<VerifiedAccount>;
 collect(credential: ChannelCredential, target: string, window: CollectionWindow): Promise<Collected>;
};
