import {ApiError} from './server';
import {naverAds} from './connectors/naver-ads';
import type {ChannelKey, Connector} from './connectors/types';

// 공식 통계 API가 있는 채널만 등록한다.
// 네이버 플레이스(스마트플레이스)와 당근 비즈프로필은 공식 통계 API가 없어 수동 입력으로 남는다.
export const connectors: Partial<Record<ChannelKey, Connector>> = {
 naver_ads: naverAds,
};

export function connectorFor(key: unknown): Connector {
 const connector = typeof key === 'string' ? connectors[key as ChannelKey] : undefined;
 if (!connector) throw new ApiError(400, '자동 수집을 지원하는 채널을 선택하세요.');
 return connector;
}

export const connectorKeys = Object.keys(connectors) as ChannelKey[];
