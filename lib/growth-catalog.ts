import {scanText} from './pii-scan';

/** Draft validation and preparation checks; these never grant execution permission. */
export type CatalogInput = {
  sku: string;
  title: string;
  price: number | null;
  unitCost: number | null;
  variableCost: number | null;
  stock: number | null;
  stockUnit?: 'unknown' | 'piece' | 'pack';
  currency: 'KRW';
  taxBasis: 'unknown' | 'included' | 'excluded';
  fulfillment: string;
  refunds: string;
  rightsConfirmed: boolean;
  factIds: string[];
  validUntil: string;
};

export type OfferInput = {
  title: string;
  catalogId: string;
  catalogVersion: number;
  needId: string;
  /** Approved per-unit price, in the same tax basis as catalog costs. */
  price: number | null;
  quantity: number;
  landingUrl: string;
  purchaseReason: string;
  priceApproved: boolean;
};

export type CatalogReference = {id: string; version: number; input: CatalogInput};
export type CatalogStock = {status:'known'|'held';inventoryId:string|null;inventoryVersion:number|null;unit:'unknown'|'piece'|'pack';onHand:number|null;reserved:number|null;available:number|null;shortage:number|null;reasons:string[]};
export type GrowthCatalogReadiness = {missing: string[]; unitContribution: number | null};

export class GrowthCatalogError extends Error {
  constructor(message: string) { super(message); this.name = 'GrowthCatalogError'; }
}

export function emptyCatalogInput(): CatalogInput {
  return {sku: '', title: '', price: null, unitCost: null, variableCost: null,
    stock: null, stockUnit: 'unknown', currency: 'KRW', taxBasis: 'unknown', fulfillment: '', refunds: '',
    rightsConfirmed: false, factIds: [], validUntil: ''};
}

export function emptyOfferInput(): OfferInput {
  return {title: '', catalogId: '', catalogVersion: 0, needId: '', price: null,
    quantity: 1, landingUrl: '', purchaseReason: '', priceApproved: false};
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GrowthCatalogError('입력은 객체여야 합니다.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max = 200): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new GrowthCatalogError(`${field}: 유효한 문자열을 입력하세요(최대 ${max}자).`);
  }
  if (scanText(value).length) throw new GrowthCatalogError(`${field}: 직접 식별정보를 넣을 수 없습니다.`);
  return value.trim();
}

function amount(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new GrowthCatalogError(`${field}: 0 이상의 안전한 정수를 입력하세요.`);
  }
  return value;
}

function integer(value: unknown, field: string, fallback: number, min: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = amount(value, field);
  if (parsed === null || parsed < min) throw new GrowthCatalogError(`${field}: ${min} 이상의 정수가 필요합니다.`);
  return parsed;
}

function boolean(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new GrowthCatalogError(`${field}: 참 또는 거짓만 허용합니다.`);
  return value;
}

function expiry(value: string): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) throw new GrowthCatalogError('유효기한은 실제 날짜 또는 시간대가 있는 ISO 일시여야 합니다.');
  const [, year, month, day, hour, minute, second, , zone] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const calendarValid = Number(year) >= 1000 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === `${year}-${month}-${day}`;
  const timeValid = hour === undefined || (Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60);
  const zoneValid = !zone || zone === 'Z' || (Number(zone.slice(1, 3)) <= 14 && Number(zone.slice(4)) < 60 && (Number(zone.slice(1, 3)) < 14 || Number(zone.slice(4)) === 0));
  if (!calendarValid || !timeValid || !zoneValid) throw new GrowthCatalogError('유효기한의 날짜·시간이 유효하지 않습니다.');
  // A date-only deadline is valid through the end of that calendar day in Seoul.
  return hour === undefined ? date.getTime() + 15 * 60 * 60 * 1000 : Date.parse(value);
}

function landing(value: unknown): string {
  const result = text(value, '구매 링크', 2048);
  if (!result) return result;
  let url: URL;
  try { url = new URL(result); } catch { throw new GrowthCatalogError('구매 링크가 유효하지 않습니다.'); }
  const host = url.hostname.toLowerCase();
  const publicDomain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) &&
    !/(^|\.)(localhost|local|internal|test|invalid|lan|home|onion)$/.test(host);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !publicDomain || /[\s\\?#]/.test(result)) {
    throw new GrowthCatalogError('구매 링크는 인증정보·쿼리·해시가 없는 공개 HTTPS 주소여야 합니다.');
  }
  let decoded: string;
  try { decoded = decodeURIComponent(url.pathname); } catch { throw new GrowthCatalogError('구매 링크의 인코딩을 확인하세요.'); }
  if (scanText(decoded).length) throw new GrowthCatalogError('구매 링크에 직접 식별정보를 넣을 수 없습니다.');
  return result;
}

export function parseCatalogInput(value: unknown): CatalogInput {
  const input = record(value);
  const currency = input.currency ?? 'KRW';
  const taxBasis = input.taxBasis ?? 'unknown';
  const stockUnit = input.stockUnit ?? 'unknown';
  if (stockUnit !== 'unknown' && stockUnit !== 'piece' && stockUnit !== 'pack') throw new GrowthCatalogError('재고 수량 단위를 확인하세요.');
  if (currency !== 'KRW') throw new GrowthCatalogError('통화는 KRW만 지원합니다.');
  if (taxBasis !== 'unknown' && taxBasis !== 'included' && taxBasis !== 'excluded') throw new GrowthCatalogError('세금 기준이 유효하지 않습니다.');
  const factIds = input.factIds === undefined ? [] : input.factIds;
  if (!Array.isArray(factIds) || factIds.length > 100) throw new GrowthCatalogError('근거 ID는 최대 100개 배열이어야 합니다.');
  const ids = factIds.map(value => {
    const id = text(value, '근거 ID');
    if (!id || /\s/.test(id)) throw new GrowthCatalogError('근거 ID는 빈칸이나 공백을 포함할 수 없습니다.');
    return id;
  });
  const validUntil = text(input.validUntil, '유효기한', 40);
  expiry(validUntil);
  return {sku: text(input.sku, 'SKU'), title: text(input.title, '상품명'),
    price: amount(input.price, '판매 단가'), unitCost: amount(input.unitCost, '단위원가'),
    variableCost: amount(input.variableCost, '단위변동비'), stock: amount(input.stock, '재고'), stockUnit,
    currency, taxBasis, fulfillment: text(input.fulfillment, '배송 조건', 2000),
    refunds: text(input.refunds, '반품 조건', 2000), rightsConfirmed: boolean(input.rightsConfirmed, '권리 확인'),
    factIds: [...new Set(ids)], validUntil};
}

export function parseOfferInput(value: unknown): OfferInput {
  const input = record(value);
  return {title: text(input.title, '오퍼명'), catalogId: text(input.catalogId, '상품 ID'),
    catalogVersion: integer(input.catalogVersion, '상품 버전', 0, 0), needId: text(input.needId, '수요 ID'),
    price: amount(input.price, '오퍼 단가'), quantity: integer(input.quantity, '수량', 1, 1),
    landingUrl: landing(input.landingUrl), purchaseReason: text(input.purchaseReason, '구매 이유', 2000),
    priceApproved: boolean(input.priceApproved, '가격 승인')};
}

function contribution(price: number | null, input: CatalogInput): number | null {
  if (price === null || input.unitCost === null || input.variableCost === null) return null;
  const totalCost = input.unitCost + input.variableCost;
  if (!Number.isSafeInteger(totalCost)) return null;
  // All amounts share the declared tax basis; no VAT exemption or rate is inferred.
  return price - totalCost;
}

export function catalogReadiness(value: CatalogInput, now = Date.now(), stock?: CatalogStock): GrowthCatalogReadiness {
  if (!Number.isFinite(now)) throw new GrowthCatalogError('평가 시각이 유효하지 않습니다.');
  const input = parseCatalogInput(value);
  const deadline = expiry(input.validUntil);
  const unitContribution = contribution(input.price, input);
  const missing = [
    !input.sku && 'SKU를 입력하세요.', !input.title && '상품명을 입력하세요.',
    input.price === null && '판매 단가를 확인하세요.', input.unitCost === null && '단위원가를 확인하세요.',
    input.variableCost === null && '단위변동비를 확인하세요.',
    (!input.stockUnit || input.stockUnit === 'unknown') && '상품의 재고 수량 단위를 확인하세요.',
    (!stock || stock.status !== 'known') && '현재 매장·SKU의 공유 재고 장부를 확인하세요.',
    stock?.status === 'known' && stock.unit !== input.stockUnit && '상품과 공유 재고 단위가 일치해야 합니다.',
    stock?.status === 'known' && (stock.available === null || stock.available <= 0) && '판매 가능한 공유 재고가 부족합니다.',
    ...(stock?.reasons ?? []),
    input.taxBasis === 'unknown' && '가격과 비용의 동일한 세금 기준을 확인하세요.',
    !input.fulfillment && '배송 조건을 입력하세요.', !input.refunds && '반품 조건을 입력하세요.',
    !input.rightsConfirmed && '판매 권리를 확인하세요.', !input.factIds.length && '검증할 상품 근거를 연결하세요.',
    deadline === null && '근거 유효기한을 입력하세요.', deadline !== null && deadline <= now && '상품 근거가 만료되었습니다.',
    unitContribution === null && '단위 공헌이익을 계산할 수 없습니다.',
    unitContribution !== null && unitContribution <= 0 && '단위 공헌이익이 양수여야 합니다.',
  ].filter((item): item is string => typeof item === 'string');
  return {missing, unitContribution};
}

export function offerReadiness(value: OfferInput, catalog: CatalogReference | null, now = Date.now(), stock?: CatalogStock): GrowthCatalogReadiness {
  const input = parseOfferInput(value);
  if (!Number.isFinite(now)) throw new GrowthCatalogError('평가 시각이 유효하지 않습니다.');
  const basis = catalog ? catalogReadiness(catalog.input, now, stock) : null;
  const unitContribution = catalog ? contribution(input.price, catalog.input) : null;
  const missing = [
    ...(basis?.missing ?? []), !catalog && '연결할 상품이 없습니다.',
    catalog !== null && catalog.id !== input.catalogId && '연결 상품이 일치하지 않습니다.',
    catalog !== null && (catalog.version !== input.catalogVersion || input.catalogVersion < 1) && '최신 상품 버전을 연결하세요.',
    !input.title && '오퍼명을 입력하세요.', !input.needId && '수요를 연결하세요.',
    !input.landingUrl && '구매 링크를 입력하세요.', !input.purchaseReason && '구매 이유를 입력하세요.',
    !input.priceApproved && '오퍼 가격 승인이 필요합니다.', input.price === null && '오퍼 단가를 확인하세요.',
    stock?.status === 'known' && stock.available !== null && input.quantity > stock.available && '오퍼 수량보다 공유 가용 재고가 부족합니다.',
    input.price !== null && !Number.isSafeInteger(input.price * input.quantity) && '오퍼 총액이 계산 가능한 범위를 초과합니다.',
    unitContribution === null && '오퍼 단위 공헌이익을 계산할 수 없습니다.',
    unitContribution !== null && unitContribution <= 0 && '오퍼 단위 공헌이익이 양수여야 합니다.',
  ].filter((item): item is string => typeof item === 'string');
  return {missing: [...new Set(missing)], unitContribution};
}
