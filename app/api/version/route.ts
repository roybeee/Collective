import {identity,json,failure} from '@/lib/server';
import {APP_BUILD,APP_TREE} from '@/lib/app-version';
// 운영 배포가 어느 GitHub 리비전에서 빌드됐는지 확인하는 유일한 경로.
// 소유자 인증을 요구하므로 주소창 직접 접근이 아니라 앱 페이지에서 same-origin fetch로 읽는다.
export async function GET(request:Request){try{await identity(request);return json({build:APP_BUILD,tree:APP_TREE})}catch(e){return failure(e)}}
