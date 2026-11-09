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

// C3 직접 게시 공급자(Publisher). Instagram Graph(lib/connectors/instagram-publish.ts)·Threads(lib/connectors/threads.ts)가 구현한다. 기존 Connector 형태는 그대로 두고 덧붙인다.
// 모든 메서드는 승인 뒤 사람이 '실행'을 눌렀을 때만 불린다(기본 꺼짐). 전송 뒤 결과를 모르면 outcome 'unknown'이며 자동 재시도하지 않는다(rate-queue 규율).
export type PublisherChannel = 'instagram_direct' | 'threads';
// 장수명 토큰과 계정 ID. login: Instagram API with Instagram Login(graph.instagram.com) 또는 Facebook Login for Business(graph.facebook.com). Threads는 graph.threads.net 고정.
export type DirectPublisherCredential = {channel: PublisherChannel; accessToken: string; userId: string; expiresAt?: string; login?: 'facebook' | 'instagram'};
export type PublishMediaType = 'IMAGE' | 'TEXT' | 'CAROUSEL' | 'REELS';
// text: 최종 캡션(AI 생성물·가상인물 표시 줄·게시 코드 줄이 이미 들어간 lib/execution.ts composeCaption 결과). imageUrl: 공개 https PNG 주소(표시 처리된 바이트의 공개 사본).
export type PublishDraft = {text: string; imageUrl?: string | null; mediaType?: PublishMediaType; children?: readonly string[]; videoUrl?: string | null};
export type PrepareResult = {ok: boolean; issues: string[]; imageReachable: boolean | null};
// outcome: rate-queue의 Outcome 또는 cached(같은 멱등 키로 이미 게시된 결과를 돌려줌, 재전송 없음). containerId: 1단계(컨테이너) 결과. id: 게시된 미디어 ID.
export type PublishOutcome = {outcome: 'success' | 'retryable' | 'rate_limited' | 'fatal' | 'unknown' | 'cached'; id?: string; containerId?: string; attempts: number; error?: string};
export type PublishStatus = {id: string; status: string; permalink?: string; raw: unknown};
// used·total·remaining는 공급자 응답에 없으면 null(0과 구분). durationSeconds: 창 길이(Meta는 86400).
export type PublishLimit = {used: number | null; total: number | null; durationSeconds: number | null; remaining: number | null; raw: unknown};
export type PublicationComment = {id: string; text: string; username: string | null; timestamp: string | null; likeCount: number | null};
export type Publisher = {
 key: PublisherChannel;
 account: string;
 prepare(draft: PublishDraft): Promise<PrepareResult>;
 submit(draft: PublishDraft, idempotencyKey: string): Promise<PublishOutcome>;
 status(id: string): Promise<PublishStatus>;
 limit(): Promise<PublishLimit>;
 collect(postId: string, window: CollectionWindow): Promise<Collected>;
 collectComments(postId: string): Promise<PublicationComment[]>;
 verify(): Promise<VerifiedAccount>;
};
