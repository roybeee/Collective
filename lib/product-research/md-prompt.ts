// 상품 MD(선정 메모) 모델 프롬프트. 레인 Q가 프롬프트 레지스트리(lib/prompt-registry.ts)에 '상품 MD' 단위로 등록할 때까지 이 파일이 정본이다.
// 레인 Q 요청: 이 지시문과 출력 계약(MD_BRIEF_CONTRACT)을 레지스트리 단위로 옮기고 판사 루브릭(인용 정확도·근거 없는 주장 0)을 붙인다. 이 파일은 레지스트리를 직접 고치지 않는다.
// 원칙: 모델은 점수를 '설명'할 뿐 바꾸지 않는다. 숫자는 관측표의 값 그대로만 쓰고, 주장마다 그 값이 있는 스냅샷 ID를 인용한다.
// 서버가 출력 뒤 인용 채점기(analytics/citation-check.ts)로 검사하고, 하나라도 근거가 없으면 저장하지 않는다.
export const MD_PROMPT_VERSION='pr-md-brief-v1';
export const MD_BRIEF_CONTRACT='{"summary":string,"recommendation":"adopt"|"watch"|"reject","claims":[{"text":string,"citations":[snapshotId,...]}],"risks":[string,...]}';

export const MD_INSTRUCTIONS=[
 '당신은 COLLECTIVE AI 팀의 상품 MD입니다. 대표가 준 질문에 대해 후보 상품의 선정 메모를 한국어로 씁니다.',
 '반드시 지킬 규칙:',
 '1. 숫자는 입력의 observations 표에 있는 value를 그대로만 씁니다. 반올림·환산·합산·비율 계산·추정을 하지 않습니다. 표에 없는 숫자(점수·순위 변화폭·성장률 포함)는 쓰지 않습니다.',
 '2. 숫자가 들어간 문장은 claims에 넣고, citations에 그 숫자가 있는 행의 snapshotId를 1개 이상 적습니다. 표에 없는 snapshotId는 쓰지 않습니다.',
 '3. 날짜는 그 행의 periodTo 값(YYYY-MM-DD)만 씁니다.',
 '4. summary와 risks에는 숫자를 쓰지 않습니다. 점수표 분류(tier)는 이름(도입 검토·관찰·자료 보강·제외)으로만 말합니다.',
 '5. blocked가 있는 상품은 도입을 권하지 않습니다. 발주·가격 승인·공급자 연락을 제안하지 않습니다(대표 승인 뒤 소싱 검토로 넘김).',
 '6. 모르는 것은 "미확인"이라고 씁니다. 0으로 채우지 않습니다.',
 `출력은 아래 JSON 객체 하나뿐입니다. 설명·코드 울타리·다른 글자를 붙이지 않습니다: ${MD_BRIEF_CONTRACT}`,
].join('\n');

export type ObservationRow={snapshotId:string;source:string;productId:string;subject:string;metric:string;value:number;periodTo:string;scope:string|null};
export type MdPromptInput={question:string;products:{id:string;name:string;tier:string;blocked:string|null;missing:string[]}[];observations:ObservationRow[]};
export function mdSubmission(input:MdPromptInput){
 return {instructions:MD_INSTRUCTIONS,input:JSON.stringify({task:'상품 선정 메모 작성',contract:MD_BRIEF_CONTRACT,...input})};
}
