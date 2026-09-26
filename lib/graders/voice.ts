import {voiceAvoidHits} from '../brand-voice';
import {copyUnits} from './content';
import {verdict,type Grader} from './types';

// 브랜드 말투(A3-2) 피할 표현 채점: 역할 입력에 확정 말투(brandVoice)가 실린 항목만 적용한다(ctx.brandVoice). 없으면 not_applicable이다.
// 카피 구역 문장·따옴표 안 문구(content.ts copyUnits, unsupported_claim_term과 같은 구역·금지 맥락 제외)에 피할 표현이 부정·배제 없이 쓰이면 fail.
// '‘최고의’라는 표현은 쓰지 않는다'처럼 부정·금지 맥락이면 사용이 아니다(공용 부정 판정 negation.ts usesTerm).
export const brandVoiceAvoidTerm:Grader={id:'brand_voice_avoid_term',content:true,grade(item,ctx){
 if(item.kind!=='role'||!ctx.brandVoice)return verdict('not_applicable','브랜드 말투 입력 없음');
 const terms=ctx.brandVoice.avoidTerms.filter(t=>t.trim());
 if(!terms.length)return verdict('not_applicable','피할 표현 없음');
 const hits=voiceAvoidHits(copyUnits(item),terms);
 return hits.length?verdict('fail',hits):verdict('pass');
}};
