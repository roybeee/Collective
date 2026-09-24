import {listRecords} from './server';
import {storeAllowValues} from './ai-context';
import type {Store} from './store-marketing';

// 제작 경로 가림 허용 값(레인 A 입력 최소화, docs/INPUT-MINIMIZATION.ko.md 2.4). 브랜드 단위 캠페인(지점 미지정)은 점포 맥락에 지점 레코드가 없으므로
// 그 브랜드 active 지점 전부의 주소·사업장 유선 번호를 허용 값으로 쓴다. 지점 캠페인은 점포 맥락의 지점 값만 쓰므로 빈 목록이다. 값은 로그·이벤트에 쓰지 않는다.
export async function brandStoreAllow(owner:string,scope:{brandId:string;storeId?:string|null}):Promise<string[]>{
 if(scope.storeId)return [];
 return (await listRecords<Store>(owner,'store',scope.brandId)).filter(s=>s.status==='active').flatMap(storeAllowValues);
}
