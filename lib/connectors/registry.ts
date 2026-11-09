// C1 커넥터 레지스트리(순수). 지금 코드가 외부 시스템을 읽거나 쓰는 경로를 능력 서술자로 적는다(docs/CONNECTORS.ko.md).
// 이 파일은 동작을 바꾸지 않는다. 각 모듈의 호출 한도·위험도·자격증명 단위를 한곳에서 읽을 수 있게 하고, 계약 테스트(lib/connectors/contract-test.ts)가 서술자를 받는다.
// 새 커넥터를 만들면 여기에 서술자를 더하고 tests/connector-contract.test.mjs의 하네스를 그 모의 커넥터로 돌린다.
import type {ConnectorCapability, ConnectorDescriptor, RiskTier} from './types';

const capability = (c: Omit<ConnectorCapability, 'defaultOff' | 'retryUnknown'>): ConnectorCapability => ({...c, defaultOff: true, retryUnknown: false});

export const connectorRegistry: readonly ConnectorDescriptor[] = [
 {key: 'instagram', label: 'Instagram 인사이트', module: 'lib/connectors/instagram.ts', capabilities: [
  capability({key: 'instagram.insights.read', reads: ['media_insights', 'account'], writes: [], riskTier: 'T1', rateLimit: {perMinute: 60, perDay: 4800}, credentialScope: 'store', flag: null}),
 ]},
 {key: 'naver_ads', label: '네이버 검색광고 통계', module: 'lib/connectors/naver-ads.ts', capabilities: [
  capability({key: 'naver_ads.stats.read', reads: ['campaign_stats', 'customer'], writes: [], riskTier: 'T1', rateLimit: {perSecond: 5, perDay: 10000}, credentialScope: 'store', flag: null}),
  // C4 쓰기(lib/connectors/naver-ads-write.ts): 승인된 제안만 보낸다. 자동 입찰 없음. 읽기는 반영 뒤 대조용 GET이다. 한도 숫자는 FAQ가 비공개라 보수적 초깃값(429는 큐가 대기).
  capability({key: 'naver_ads.ncc.write', reads: ['campaign', 'adgroup', 'keyword', 'ad'], writes: ['campaign', 'adgroup', 'keyword', 'bid', 'lock', 'ad'], riskTier: 'T3', rateLimit: {perSecond: 5, perMinute: 120, perDay: 3000}, credentialScope: 'store', flag: 'naver_ads_write'}),
 ]},
 {key: 'ftc_franchise', label: '공정위 가맹정보 공개 API', module: 'lib/connectors/ftc-franchise.ts', capabilities: [
  capability({key: 'ftc_franchise.stats.read', reads: ['brand_frcs_stats'], writes: [], riskTier: 'T1', rateLimit: {perSecond: 2, perDay: 1000}, credentialScope: 'workspace', flag: 'r_franchise'}),
 ]},
 {key: 'buffer', label: 'Buffer 발행', module: 'lib/publisher-buffer.ts', capabilities: [
  capability({key: 'buffer.channels.read', reads: ['organizations', 'channels', 'post_status'], writes: [], riskTier: 'T1', rateLimit: {perMinute: 60}, credentialScope: 'brand', flag: null}),
  capability({key: 'buffer.post.publish', reads: [], writes: ['create_post'], riskTier: 'T3', rateLimit: {perMinute: 10, perDay: 100}, credentialScope: 'brand', flag: null}),
 ]},
 {key: 'meta_ads', label: 'Meta 광고', module: 'lib/meta-*.ts', capabilities: [
  capability({key: 'meta_ads.insights.read', reads: ['insights', 'account', 'bundle'], writes: [], riskTier: 'T1', rateLimit: {perMinute: 60}, credentialScope: 'brand', flag: 'meta_ads_bundle'}),
  capability({key: 'meta_ads.image.upload', reads: [], writes: ['adimages'], riskTier: 'T3', rateLimit: {perMinute: 10, perDay: 50}, credentialScope: 'brand', flag: 'meta_ads_image_upload'}),
  capability({key: 'meta_ads.campaign.paused_write', reads: [], writes: ['campaign:PAUSED'], riskTier: 'T3', rateLimit: {perMinute: 5, perDay: 20}, credentialScope: 'brand', flag: 'meta_ads_paused_write'}),
  capability({key: 'meta_ads.child.create', reads: [], writes: ['adset:PAUSED', 'adcreative', 'ad:PAUSED'], riskTier: 'T3', rateLimit: {perMinute: 5, perDay: 20}, credentialScope: 'brand', flag: 'meta_ads_child_create'}),
  capability({key: 'meta_ads.campaign.execution', reads: ['spend'], writes: ['campaign:ACTIVE', 'emergency_stop'], riskTier: 'T4', rateLimit: {perMinute: 5, perDay: 20}, credentialScope: 'brand', flag: 'meta_ads_execution'}),
  capability({key: 'meta_ads.conversion.capi', reads: [], writes: ['conversion_event'], riskTier: 'T4', rateLimit: {perSecond: 5, perDay: 5000}, credentialScope: 'brand', flag: 'meta_ads_capi'}),
 ]},
 {key: 'store_browser', label: '네이버 점포 브라우저(로컬 장치)', module: 'lib/store-browser-*.ts', capabilities: [
  capability({key: 'store_browser.hours.read', reads: ['business_hours'], writes: [], riskTier: 'T1', rateLimit: {perMinute: 6, perDay: 200}, credentialScope: 'store', flag: 'store_browser_execution'}),
  capability({key: 'store_browser.hours.write', reads: [], writes: ['business_hours'], riskTier: 'T3', rateLimit: {perMinute: 1, perDay: 20}, credentialScope: 'store', flag: 'store_browser_execution'}),
 ]},
];

export function descriptorFor(key: string): ConnectorDescriptor | undefined {
 return connectorRegistry.find(d => d.key === key);
}
export function capabilityFor(key: string): ConnectorCapability | undefined {
 return connectorRegistry.flatMap(d => d.capabilities).find(c => c.key === key);
}
export function capabilitiesByTier(tier: RiskTier): ConnectorCapability[] {
 return connectorRegistry.flatMap(d => d.capabilities).filter(c => c.riskTier === tier);
}
// 서술자 규칙: 쓰기(writes)가 있으면 T3 이상, 읽기만이면 T1(또는 T2), 키는 '<커넥터>.<자원>.<동작>', 한도는 한 종류 이상, 중복 키 없음. 테스트가 레지스트리 전체를 이 규칙으로 검사한다.
export function describeViolations(descriptors: readonly ConnectorDescriptor[] = connectorRegistry): string[] {
 const seen = new Set<string>();
 return descriptors.flatMap(d => d.capabilities.flatMap(c => {
  const issues: string[] = [];
  if (!c.key.startsWith(d.key + '.') || c.key.split('.').length !== 3) issues.push(`${c.key}: 키는 '${d.key}.<자원>.<동작>' 형식이어야 합니다.`);
  if (seen.has(c.key)) issues.push(`${c.key}: 중복 키입니다.`); seen.add(c.key);
  if (c.writes.length && (c.riskTier === 'T1' || c.riskTier === 'T2')) issues.push(`${c.key}: 외부 쓰기는 T3 이상이어야 합니다.`);
  if (!c.writes.length && (c.riskTier === 'T3' || c.riskTier === 'T4')) issues.push(`${c.key}: 쓰기가 없는 능력은 T1·T2여야 합니다.`);
  if (!c.reads.length && !c.writes.length) issues.push(`${c.key}: 읽기 또는 쓰기 대상이 있어야 합니다.`);
  if (![c.rateLimit.perSecond, c.rateLimit.perMinute, c.rateLimit.perDay].some(n => typeof n === 'number' && n > 0)) issues.push(`${c.key}: 한도가 하나 이상 필요합니다.`);
  if (c.defaultOff !== true || c.retryUnknown !== false) issues.push(`${c.key}: defaultOff는 true, retryUnknown은 false여야 합니다.`);
  return issues;
 }));
}
