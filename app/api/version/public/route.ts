import {json,failure} from '@/lib/server';
import {APP_BUILD,APP_TREE} from '@/lib/app-version';
// 게시 뒤 신원 확인용 공개 경로(대표 결정 2026-09-26): 로그인 없이 build와 tree만 돌려준다.
// 저장소가 공개라 새로 드러나는 것은 '운영이 어느 소스 트리인가'뿐이다. 소유자 정보(promptManifest 등)는 싣지 않는다.
// 소유자 신원이 필요한 값과 레지스트리 상태는 /api/version(소유자 인증)을 쓴다.
export async function GET(){try{return json({build:APP_BUILD,tree:APP_TREE})}catch(e){return failure(e)}}
