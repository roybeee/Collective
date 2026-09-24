import {identity,json,failure} from '@/lib/server';
import {APP_BUILD,APP_TREE} from '@/lib/app-version';
import {promptManifest} from '@/lib/prompt-registry';
// 운영 배포가 어느 GitHub 리비전에서 빌드됐는지 확인하는 유일한 경로.
// 소유자 인증을 요구하므로 주소창 직접 접근이 아니라 앱 페이지에서 same-origin fetch로 읽는다.
// promptManifest(F3a): 이 소유자의 프롬프트 레지스트리 active 매니페스트 해시(단위별 active 버전 목록의 sha256). active가 없으면 null, 읽기 실패는 'unknown'.
// tree는 코드 신원(runtime-verified 기준)이고 promptManifest는 레지스트리 상태(registry-active 기록)다. 둘을 섞지 않는다.
export async function GET(request:Request){try{const owner=await identity(request);return json({build:APP_BUILD,tree:APP_TREE,promptManifest:await promptManifest(owner).catch(()=>'unknown')})}catch(e){return failure(e)}}
