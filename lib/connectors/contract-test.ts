// C1 커넥터 계약 테스트 하네스(순수). AGENTS.md 품질 기준의 다섯 시나리오(성공·실패·타임아웃·재시작/재개·중복 실행)를 서술자를 구현한 커넥터에 돌린다.
// 커넥터는 네트워크 대신 AttemptResult를 돌려주는 execute만 구현하면 된다(모의 커넥터는 tests/connector-contract.test.mjs). 저널은 기본 메모리이며 D1 저널로 바꿔 끼울 수 있다.
// 규율: 쓰기는 보내기 전에 저널에 'sent'를 적고, 결과를 모르면 'unknown'으로 남겨 재개 때 다시 보내지 않는다. 같은 작업 id는 한 번만 실행하고 두 번째는 저장된 결과를 돌려준다.
import {runWithBackoff, type AttemptResult, type BackoffPolicy, type Outcome, type RunDeps} from './rate-queue';
import type {ConnectorCapability} from './types';

export type ContractOperation = {id: string; capability: string; payload?: unknown};
export type ContractConnector = {
 capabilities: readonly ConnectorCapability[];
 execute(op: ContractOperation, attempt: number): Promise<AttemptResult & {value?: unknown}>;
};
export type JournalState = 'pending' | 'sent' | 'done' | 'failed' | 'unknown';
export type JournalEntry = {id: string; state: JournalState; attempts: number; value?: unknown; outcome?: Outcome};
export type Journal = {get(id: string): Promise<JournalEntry | undefined>; set(entry: JournalEntry): Promise<void>};
export type SubmitResult = {id: string; executed: boolean; outcome: Outcome | 'refused_unknown' | 'cached'; attempts: number; value?: unknown; entry: JournalEntry};

export function memoryJournal(seed: readonly JournalEntry[] = []): Journal & {entries(): JournalEntry[]} {
 const rows = new Map(seed.map(e => [e.id, e]));
 return {
  async get(id) { return rows.get(id); },
  async set(entry) { rows.set(entry.id, entry); },
  entries() { return [...rows.values()]; },
 };
}
export const defaultPolicy: BackoffPolicy = {maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5000};

// 작업 하나를 저널·한도·백오프 규율로 보낸다.
export async function submit(connector: ContractConnector, journal: Journal, op: ContractOperation, deps: RunDeps, policy: BackoffPolicy = defaultPolicy): Promise<SubmitResult> {
 const capability = connector.capabilities.find(c => c.key === op.capability);
 if (!capability) throw new Error(`서술자에 없는 능력입니다: ${op.capability}`);
 const write = capability.writes.length > 0;
 const existing = await journal.get(op.id);
 if (existing?.state === 'done') return {id: op.id, executed: false, outcome: 'cached', attempts: existing.attempts, value: existing.value, entry: existing};
 // 재개: 보냈는데 결과를 모르는 쓰기는 다시 보내지 않는다(외부 계정에서 대조). 읽기·대기 중 작업은 다시 실행한다.
 if (write && (existing?.state === 'sent' || existing?.state === 'unknown')) {
  const entry: JournalEntry = {...existing, state: 'unknown', outcome: 'unknown'};
  await journal.set(entry);
  return {id: op.id, executed: false, outcome: 'refused_unknown', attempts: existing.attempts, entry};
 }
 const started = existing?.attempts ?? 0;
 const run = await runWithBackoff({
  key: `${op.capability}`,
  limit: capability.rateLimit,
  write,
  policy,
  send: attempt => connector.execute(op, attempt),
  onBeforeSend: async attempt => { if (write) await journal.set({id: op.id, state: 'sent', attempts: started + attempt}); },
 }, deps);
 const state: JournalState = run.outcome === 'success' ? 'done' : run.outcome === 'unknown' ? 'unknown' : 'failed';
 const entry: JournalEntry = {id: op.id, state, attempts: started + run.attempts, outcome: run.outcome, ...(run.outcome === 'success' ? {value: run.value} : {})};
 await journal.set(entry);
 return {id: op.id, executed: true, outcome: run.outcome, attempts: run.attempts, ...(run.outcome === 'success' ? {value: run.value} : {}), entry};
}

export type ScenarioName = 'success' | 'failure' | 'timeout' | 'restart_resume' | 'duplicate_idempotent';
export type ScenarioResult = {scenario: ScenarioName; passed: boolean; details: string[]};
// 시나리오마다 execute의 행동을 정하는 스크립트. 하네스는 작업 id별로 몇 번째 호출인지 세서 결과를 고른다.
export type Script = Record<string, readonly (AttemptResult & {value?: unknown})[]>;
export type ScenarioConnectorFactory = (script: Script) => ContractConnector & {calls(): Record<string, number>};
export type ScenarioKeys = {read: string; write: string};

const immediate: RunDeps = {now: (() => { let t = 0; return () => (t += 1000); })(), random: () => 0.5, sleep: async () => undefined};

// 다섯 시나리오를 돌리고 결과를 돌려준다. 기대와 다르면 passed=false와 사유를 적는다(테스트가 assert한다).
export async function runContractScenarios(make: ScenarioConnectorFactory, keys: ScenarioKeys, deps: RunDeps = immediate): Promise<ScenarioResult[]> {
 const results: ScenarioResult[] = [];
 const expect = (details: string[], ok: boolean, what: string) => { if (!ok) details.push(what); };

 // 1) 성공: 쓰기 1회 → done, 결과 보존, 저널 sent→done.
 {
  const details: string[] = [], c = make({'w-ok': [{kind: 'response', status: 200, value: {id: 'remote-1'}}]}), j = memoryJournal();
  const r = await submit(c, j, {id: 'w-ok', capability: keys.write}, deps);
  expect(details, r.outcome === 'success' && r.attempts === 1 && JSON.stringify(r.value) === '{"id":"remote-1"}', `success: outcome=${r.outcome} attempts=${r.attempts}`);
  expect(details, (await j.get('w-ok'))?.state === 'done', 'success: journal is done');
  results.push({scenario: 'success', passed: !details.length, details});
 }
 // 2) 실패: 4xx 쓰기는 재시도 없이 failed. 5xx 읽기는 재시도해 두 번째에 성공한다.
 {
  const details: string[] = [], c = make({'w-bad': [{kind: 'response', status: 400}], 'r-flaky': [{kind: 'response', status: 503}, {kind: 'response', status: 200, value: 7}]}), j = memoryJournal();
  const bad = await submit(c, j, {id: 'w-bad', capability: keys.write}, deps);
  expect(details, bad.outcome === 'fatal' && bad.attempts === 1 && c.calls()['w-bad'] === 1 && (await j.get('w-bad'))?.state === 'failed', `failure: fatal write outcome=${bad.outcome} calls=${c.calls()['w-bad']}`);
  const flaky = await submit(c, j, {id: 'r-flaky', capability: keys.read}, deps);
  expect(details, flaky.outcome === 'success' && flaky.attempts === 2 && flaky.value === 7, `failure: retryable read outcome=${flaky.outcome} attempts=${flaky.attempts}`);
  results.push({scenario: 'failure', passed: !details.length, details});
 }
 // 3) 타임아웃: 보낸 뒤 타임아웃된 쓰기는 unknown·재시도 없음. 읽기 타임아웃은 재시도한다. 보내기 전 연결 실패 쓰기는 재시도한다.
 {
  const details: string[] = [], c = make({'w-timeout': [{kind: 'timeout', sent: true}, {kind: 'response', status: 200}], 'r-timeout': [{kind: 'timeout', sent: true}, {kind: 'response', status: 200, value: 1}], 'w-refused': [{kind: 'network_error', sent: false}, {kind: 'response', status: 200, value: 2}]}), j = memoryJournal();
  const w = await submit(c, j, {id: 'w-timeout', capability: keys.write}, deps);
  expect(details, w.outcome === 'unknown' && w.attempts === 1 && c.calls()['w-timeout'] === 1 && (await j.get('w-timeout'))?.state === 'unknown', `timeout: write outcome=${w.outcome} calls=${c.calls()['w-timeout']}`);
  const r = await submit(c, j, {id: 'r-timeout', capability: keys.read}, deps);
  expect(details, r.outcome === 'success' && r.attempts === 2, `timeout: read outcome=${r.outcome} attempts=${r.attempts}`);
  const refused = await submit(c, j, {id: 'w-refused', capability: keys.write}, deps);
  expect(details, refused.outcome === 'success' && refused.attempts === 2, `timeout: unsent write retried outcome=${refused.outcome} attempts=${refused.attempts}`);
  results.push({scenario: 'timeout', passed: !details.length, details});
 }
 // 4) 재시작·재개: 저널에 'sent'로 남은 쓰기(전송 직후 프로세스 종료)는 다시 보내지 않고 unknown으로 남긴다. 'pending' 읽기는 다시 실행한다. 'unknown' 쓰기도 다시 보내지 않는다.
 {
  const details: string[] = [], c = make({'w-sent': [{kind: 'response', status: 200}], 'r-pending': [{kind: 'response', status: 200, value: 3}], 'w-unknown': [{kind: 'response', status: 200}]});
  const j = memoryJournal([{id: 'w-sent', state: 'sent', attempts: 1}, {id: 'r-pending', state: 'pending', attempts: 0}, {id: 'w-unknown', state: 'unknown', attempts: 1, outcome: 'unknown'}]);
  const w = await submit(c, j, {id: 'w-sent', capability: keys.write}, deps);
  expect(details, !w.executed && w.outcome === 'refused_unknown' && !c.calls()['w-sent'] && (await j.get('w-sent'))?.state === 'unknown', `resume: sent write resent=${c.calls()['w-sent'] ?? 0} outcome=${w.outcome}`);
  const r = await submit(c, j, {id: 'r-pending', capability: keys.read}, deps);
  expect(details, r.executed && r.outcome === 'success' && r.value === 3, `resume: pending read outcome=${r.outcome}`);
  const u = await submit(c, j, {id: 'w-unknown', capability: keys.write}, deps);
  expect(details, !u.executed && !c.calls()['w-unknown'], `resume: unknown write resent=${c.calls()['w-unknown'] ?? 0}`);
  results.push({scenario: 'restart_resume', passed: !details.length, details});
 }
 // 5) 중복·멱등: 같은 작업 id를 두 번 보내면 한 번만 실행하고 두 번째는 저장 결과를 돌려준다. 동시 제출도 저널이 먼저 적힌 쪽만 실행된다(순차 호출로 검사).
 {
  const details: string[] = [], c = make({'w-dup': [{kind: 'response', status: 200, value: 'first'}, {kind: 'response', status: 200, value: 'second'}]}), j = memoryJournal();
  const a = await submit(c, j, {id: 'w-dup', capability: keys.write}, deps), b = await submit(c, j, {id: 'w-dup', capability: keys.write}, deps);
  expect(details, a.executed && a.value === 'first' && !b.executed && b.outcome === 'cached' && b.value === 'first' && c.calls()['w-dup'] === 1, `duplicate: calls=${c.calls()['w-dup']} second=${b.outcome}/${String(b.value)}`);
  results.push({scenario: 'duplicate_idempotent', passed: !details.length, details});
 }
 return results;
}

// 테스트·새 커넥터용 모의 커넥터: 스크립트대로 결과를 돌려주고 호출 수를 센다. 스크립트가 끝나면 마지막 결과를 반복한다.
export function scriptedConnector(capabilities: readonly ConnectorCapability[]): ScenarioConnectorFactory {
 return script => {
  const calls: Record<string, number> = {};
  return {
   capabilities,
   calls: () => ({...calls}),
   async execute(op) {
    calls[op.id] = (calls[op.id] ?? 0) + 1;
    const steps = script[op.id] ?? [{kind: 'thrown'}];
    return steps[Math.min(calls[op.id], steps.length) - 1];
   },
  };
 };
}
