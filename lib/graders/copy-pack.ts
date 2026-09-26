import {contractObject,ROLE_OUTPUT_V2} from '../role-output';
import {parseCopyPack} from '../copy-pack';
import {verdict,type Grader} from './types';

// 카피 팩 v2(A3-1) 규칙 채점: 모델 원문 JSON이 role-output-v2일 때만 적용한다. v1 원문·저장 본문(text)만 있는 항목은 not_applicable이다.
// 팩이 없거나 형식 오류, 채널당 서로 다른 안 3개 미만, 장면 타임라인·실험 팔 위반이면 fail. 브리프 채널 누락 경고(warn)는 세지 않는다.
// 운영은 같은 규칙(lib/copy-pack.ts parseCopyPack)의 결과를 작업물 copyPackIssues로 남기고 작업물을 막지 않는다(soft).
export const copyPackVariants:Grader={id:'copy_pack_variants',content:true,grade(item){
 if(item.kind!=='role'||!item.raw)return verdict('not_applicable','원문 JSON 없음');
 const raw=contractObject(item.raw);
 if(raw?.contractVersion!==ROLE_OUTPUT_V2)return verdict('not_applicable','카피 팩 계약(role-output-v2) 아님');
 const {pack,issues}=parseCopyPack(raw.copyPack),errors=issues.filter(i=>i.level==='error');
 if(errors.length||!pack)return verdict('fail',errors.map(i=>i.message));
 const variants=pack.channels.reduce((n,c)=>n+c.variants.length,0);
 return verdict('pass',`${pack.channels.length}채널 · 안 ${variants} · 장면 ${pack.shortform?.scenes.length??0} · 실험 ${pack.experiments.length}`);
}};
