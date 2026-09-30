import {scanText} from './pii-scan';

/** One server-owned brand/location/SKU ledger. Catalog stock is not an input authority. */
export type InventoryInput = {sku: string; locationId: string; unit: 'piece' | 'pack'; onHand: number | null};
export type InventoryEventKind = 'stocktake' | 'receive' | 'reserve' | 'allocate' | 'ship' | 'release' | 'refund' | 'return';
export type InventoryEvent = {
  id: string; digest: string; version: number; kind: InventoryEventKind; quantity: number;
  reservationId: string; missionId: string; orderId: string;
  observedAt: string; recordedAt: string; evidenceRef: string;
  safeRelease: boolean; returnAccepted: boolean; disposition: 'unknown' | 'resalable' | 'not_resalable'; restock: boolean;
};
export type InventoryReservation = {reservationId: string; missionId: string; quantity: number; allocated: number; released: number; held: number};
export type InventoryOrder = {orderId: string; reservationId: string; missionId: string; quantity: number; held: number; shipped: number; released: number; refunded: number; returned: number; restocked: number};
export type InventoryProjection = {
  version: number; onHand: number | null; reserved: number; available: number | null; shortage: number | null;
  reservations: InventoryReservation[]; orders: InventoryOrder[]; lastObservedAt: string; lastRecordedAt: string;
};

const KINDS: InventoryEventKind[] = ['stocktake', 'receive', 'reserve', 'allocate', 'ship', 'release', 'refund', 'return'];

export class GrowthInventoryError extends Error {
  constructor(message: string) { super(message); this.name = 'GrowthInventoryError'; }
}

export function emptyInventoryInput(): InventoryInput { return {sku: '', locationId: '', unit: 'piece', onHand: null}; }

function fail(message: string): never { throw new GrowthInventoryError(message); }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('입력은 객체여야 합니다.');
  return value as Record<string, unknown>;
}

function id(value: unknown, required = false): string {
  if ((value === undefined || value === '') && !required) return '';
  if (typeof value !== 'string' || value.length > 160 || !/^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u.test(value) || scanText(value).length) return fail('직접 식별정보 없는 내부 식별자가 필요합니다.');
  if (/^(?:(?:sk[-_]|xox[baprs]-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})$/.test(value)) return fail('비밀키를 재고 식별자로 저장할 수 없습니다.');
  return value;
}

function units(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return fail(`${minimum} 이상의 안전한 정수 수량이 필요합니다.`);
  return value;
}

function choice<T extends string>(value: unknown, choices: readonly T[], fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!choices.includes(value as T)) return fail('지원하지 않는 재고 단위 또는 상태입니다.');
  return value as T;
}

function flag(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') return fail('확인값은 참 또는 거짓이어야 합니다.');
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== 'string') return fail('시간대가 있는 실제 ISO 일시가 필요합니다.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return fail('시간대가 있는 실제 ISO 일시가 필요합니다.');
  const [, y, m, d, h, minute, s, zone] = match;
  const day = new Date(`${y}-${m}-${d}T00:00:00Z`);
  const zoneValid = zone === 'Z' || (Number(zone.slice(1, 3)) <= 14 && Number(zone.slice(4)) < 60 && (Number(zone.slice(1, 3)) < 14 || Number(zone.slice(4)) === 0));
  if (Number(y) < 1000 || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== `${y}-${m}-${d}` || Number(h) > 23 || Number(minute) > 59 || Number(s) > 59 || !zoneValid) return fail('유효하지 않은 날짜 또는 시각입니다.');
  return value;
}

export function parseInventoryInput(value: unknown): InventoryInput {
  const input = record(value);
  return {sku: id(input.sku, true), locationId: id(input.locationId, true),
    unit: choice(input.unit, ['piece', 'pack'], 'piece'),
    onHand: input.onHand === undefined || input.onHand === null ? null : units(input.onHand)};
}

export function parseInventoryEvent(value: unknown): InventoryEvent {
  const input = record(value);
  const kind = choice(input.kind, KINDS);
  if (typeof input.digest !== 'string' || !/^[a-f0-9]{64}$/.test(input.digest)) return fail('서버에서 계산한 이벤트 다이제스트가 필요합니다.');
  const result: InventoryEvent = {
    id: id(input.id, true), digest: input.digest, version: units(input.version, 1), kind,
    quantity: units(input.quantity, kind === 'stocktake' ? 0 : 1),
    reservationId: id(input.reservationId), missionId: id(input.missionId), orderId: id(input.orderId),
    observedAt: instant(input.observedAt), recordedAt: instant(input.recordedAt), evidenceRef: id(input.evidenceRef, true),
    safeRelease: flag(input.safeRelease), returnAccepted: flag(input.returnAccepted),
    disposition: choice(input.disposition, ['unknown', 'resalable', 'not_resalable'], 'unknown'), restock: flag(input.restock),
  };
  if (Date.parse(result.observedAt) > Date.parse(result.recordedAt)) return fail('관측 시각은 기록 시각 뒤일 수 없습니다.');
  if (kind === 'reserve' && (!result.reservationId || !result.missionId || result.orderId)) return fail('미션 예약 식별자를 확인하세요.');
  if (['allocate', 'ship', 'refund', 'return'].includes(kind) && !result.orderId) return fail('주문 식별자가 필요합니다.');
  if (kind === 'release' && (!result.safeRelease || (!result.reservationId && !result.orderId))) return fail('미출고 예약의 안전한 해제 확인이 필요합니다.');
  if (kind !== 'return' && (result.returnAccepted || result.restock || result.disposition !== 'unknown')) return fail('반품 확인은 반품 이벤트에만 적용할 수 있습니다.');
  if (kind !== 'release' && result.safeRelease) return fail('해제 확인은 해제 이벤트에만 적용할 수 있습니다.');
  if (result.restock && (!result.returnAccepted || result.disposition !== 'resalable')) return fail('검수 수락·재판매 가능 확인 후에만 재입고할 수 있습니다.');
  return result;
}

function add(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result) || result < 0) return fail('재고 합계가 계산 가능한 범위를 벗어났습니다.');
  return result;
}

function totals(state: InventoryProjection): InventoryProjection {
  const reserved = [...state.reservations, ...state.orders].reduce((total, item) => add(total, item.held), 0);
  return {...state, reserved, available: state.onHand === null ? null : Math.max(0, state.onHand - reserved),
    shortage: state.onHand === null ? null : Math.max(0, reserved - state.onHand)};
}

function newReservation(state: InventoryProjection, event: InventoryEvent): InventoryProjection {
  if (state.reservations.some(item => item.reservationId === event.reservationId)) return fail('이미 존재하는 예약 식별자입니다.');
  if (state.available === null || event.quantity > state.available) return fail('확인된 가용 재고가 부족합니다.');
  const item: InventoryReservation = {reservationId: event.reservationId, missionId: event.missionId,
    quantity: event.quantity, allocated: 0, released: 0, held: event.quantity};
  return {...state, reservations: [...state.reservations, item]};
}

function allocateOrder(state: InventoryProjection, event: InventoryEvent): InventoryProjection {
  const reservation = state.reservations.find(item => item.reservationId === event.reservationId);
  if (event.reservationId && (!reservation || reservation.missionId !== event.missionId)) return fail('주문에 연결된 미션 예약이 일치하지 않습니다.');
  if (!event.reservationId && event.missionId) return fail('미션 배정은 명시적인 예약 연결이 필요합니다.');
  const existing = state.orders.find(item => item.orderId === event.orderId);
  if (existing && (existing.reservationId !== event.reservationId || existing.missionId !== event.missionId)) return fail('기존 주문의 예약 범위를 변경할 수 없습니다.');
  const moved = Math.min(reservation?.held ?? 0, event.quantity);
  const reservations = state.reservations.map(item => item.reservationId === event.reservationId ?
    {...item, held: item.held - moved, allocated: add(item.allocated, moved)} : item);
  const order: InventoryOrder = existing ? {...existing, quantity: add(existing.quantity, event.quantity), held: add(existing.held, event.quantity)} :
    {orderId: event.orderId, reservationId: event.reservationId, missionId: event.missionId,
      quantity: event.quantity, held: event.quantity, shipped: 0, released: 0, refunded: 0, returned: 0, restocked: 0};
  // Actual order allocations survive insufficient stock; totals exposes their shortage.
  return {...state, reservations, orders: existing ? state.orders.map(item => item.orderId === event.orderId ? order : item) : [...state.orders, order]};
}

function orderFor(state: InventoryProjection, event: InventoryEvent): InventoryOrder {
  const order = state.orders.find(item => item.orderId === event.orderId);
  if (!order || order.reservationId !== event.reservationId || order.missionId !== event.missionId) return fail('주문의 예약·미션 범위가 일치하지 않습니다.');
  return order;
}

function updateOrder(state: InventoryProjection, order: InventoryOrder, onHand = state.onHand): InventoryProjection {
  return {...state, onHand, orders: state.orders.map(item => item.orderId === order.orderId ? order : item)};
}

function shipOrder(state: InventoryProjection, event: InventoryEvent): InventoryProjection {
  const order = orderFor(state, event);
  if (event.quantity > order.held) return fail('출고 수량이 주문의 미출고 예약을 초과합니다.');
  if (state.onHand === null || event.quantity > state.onHand) return fail('출고할 실제 재고를 먼저 확인하세요.');
  return updateOrder(state, {...order, held: order.held - event.quantity, shipped: add(order.shipped, event.quantity)}, state.onHand - event.quantity);
}

function releaseHold(state: InventoryProjection, event: InventoryEvent): InventoryProjection {
  if (event.orderId) {
    const order = orderFor(state, event);
    if (event.quantity > order.held) return fail('주문의 미출고 수량만 해제할 수 있습니다.');
    return updateOrder(state, {...order, held: order.held - event.quantity, released: add(order.released, event.quantity)});
  }
  const reservation = state.reservations.find(item => item.reservationId === event.reservationId);
  if (!reservation || reservation.missionId !== event.missionId || event.quantity > reservation.held) return fail('미션의 아직 배정되지 않은 예약만 해제할 수 있습니다.');
  return {...state, reservations: state.reservations.map(item => item.reservationId === event.reservationId ?
    {...item, held: item.held - event.quantity, released: add(item.released, event.quantity)} : item)};
}

function returnOrder(state: InventoryProjection, event: InventoryEvent): InventoryProjection {
  const order = orderFor(state, event);
  if (event.quantity > order.shipped - order.returned) return fail('반품은 아직 반품되지 않은 출고 수량 이내여야 합니다.');
  if (!event.returnAccepted) return state;
  const restored = event.restock ? event.quantity : 0;
  const onHand = state.onHand === null ? null : add(state.onHand, restored);
  return updateOrder(state, {...order, returned: add(order.returned, event.quantity), restocked: add(order.restocked, restored)}, onHand);
}

function applyEvent(state: InventoryProjection, event: InventoryEvent): InventoryProjection {
  switch (event.kind) {
    case 'stocktake': return {...state, onHand: event.quantity};
    case 'receive': return {...state, onHand: state.onHand === null ? null : add(state.onHand, event.quantity)};
    case 'reserve': return newReservation(state, event);
    case 'allocate': return allocateOrder(state, event);
    case 'ship': return shipOrder(state, event);
    case 'release': return releaseHold(state, event);
    case 'return': return returnOrder(state, event);
    case 'refund': {
      const order = orderFor(state, event);
      const refunded = add(order.refunded, event.quantity);
      if (refunded > order.quantity) return fail('환불 수량이 주문 수량을 초과합니다.');
      // A monetary refund neither proves a physical return nor cancels unshipped holds.
      return updateOrder(state, {...order, refunded});
    }
  }
}

function nextProjection(state: InventoryProjection, event: InventoryEvent, now: number): InventoryProjection {
  if (event.version !== state.version + 1) return fail('재고 이벤트 버전이 연속적이지 않습니다.');
  if (Date.parse(event.recordedAt) > now) return fail('미래 시각의 재고 이벤트를 적용할 수 없습니다.');
  if ((state.lastObservedAt && Date.parse(event.observedAt) < Date.parse(state.lastObservedAt)) ||
    (state.lastRecordedAt && Date.parse(event.recordedAt) < Date.parse(state.lastRecordedAt))) return fail('과거 시각의 이벤트는 최신 재고 대사 후 기록해야 합니다.');
  return totals({...applyEvent(state, event), version: event.version, lastObservedAt: event.observedAt, lastRecordedAt: event.recordedAt});
}

/** Requires the complete immutable stream for exactly one server-controlled inventory identity. */
export function projectInventory(value: InventoryInput, events: InventoryEvent[], now = Date.now()): InventoryProjection {
  const input = parseInventoryInput(value);
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) return fail('평가 시각이 유효하지 않습니다.');
  if (!Array.isArray(events) || events.length > 100_000) return fail('완전한 재고 이벤트 배열이 필요합니다.');
  const initial: InventoryProjection = {version: 0, onHand: input.onHand, reserved: 0, available: input.onHand,
    shortage: input.onHand === null ? null : 0, reservations: [], orders: [], lastObservedAt: '', lastRecordedAt: ''};
  const seen = new Map<string, string>();
  return events.reduce((state, raw) => {
    const event = parseInventoryEvent(raw);
    const canonical = JSON.stringify(event);
    const existing = seen.get(event.id);
    if (existing !== undefined) {
      if (existing !== canonical) return fail('같은 이벤트 ID의 내용 또는 다이제스트가 변경되었습니다.');
      return state;
    }
    seen.set(event.id, canonical);
    return nextProjection(state, event, now);
  }, initial);
}

/** Validation only; server CAS/transaction must persist the event and the shared reservation together. */
export function transitionInventory(input: InventoryInput, events: InventoryEvent[], event: InventoryEvent, now = Date.now()): InventoryProjection {
  return projectInventory(input, [...events, event], now);
}
