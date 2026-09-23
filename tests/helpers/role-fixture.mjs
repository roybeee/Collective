// Provider mocks satisfy the same persisted contract as real submissions.
export function roleFixture(input){
 const task=JSON.parse(input).task;
 if(!task)return 'A provider artifact';
 if(task.role==='quality')return JSON.stringify({verdict:'needs_data',summary:'실측 확인 필요',findings:'측정 결과가 없는 초안으로 출시 전 검토가 필요합니다.',checks:['evidence','brand','execution','economics','measurement'].map(criterion=>({criterion,status:'needs_data',location:'캠페인 브리프 및 이전 작업물',finding:'확정 운영 자료가 제공되지 않았습니다.',fix:'출시 전에 운영자가 검증하세요.'})),taskChecks:[]});
 return JSON.stringify({contractVersion:task.outputContract.version,role:task.role,sections:task.outputContract.sections.map(s=>({id:s.id,content:`${s.title}\n자료 필요: 실제 운영 조건을 확인한 뒤 실행합니다. 현재 초안은 가설이며 담당자가 POS 기록과 현장 관찰로 검증합니다.`}))});
}
