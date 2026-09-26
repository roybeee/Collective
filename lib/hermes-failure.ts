// Provider error text may contain secrets or sealed inputs. Return fixed labels only.
export function hermesFailureCategory(value:unknown):string {
 const text=typeof value==='string'?value:JSON.stringify(value??'');
 if(/insufficient_quota|quota|credit|billing|usage.limit|rate.limit|rate_limit|429/i.test(text))return '모델 사용 한도 또는 요청 제한';
 if(/auth|api.?key|credential|unauthorized|forbidden|401|403|token.expired/i.test(text))return '모델 인증 실패';
 if(/context.length|context_length|maximum.context|too.many.tokens|input.too.long/i.test(text))return '모델 입력 길이 초과';
 if(/model.not.found|model_not_found|unsupported.model|invalid.model|model.*does not exist/i.test(text))return '모델 설정 오류';
 if(/timeout|timed out|deadline|stale/i.test(text))return 'HERMES 내부 응답 시간 초과';
 if(/restart|interrupt|shutdown|cancel/i.test(text))return 'HERMES 재시작 또는 실행 중단';
 if(/mcp|aside|browser|tool/i.test(text))return 'HERMES 도구 실행 오류';
 if(/connect|network|socket|upstream|502|503|504/i.test(text))return '모델 서비스 연결 실패';
 if(/import|module|not found|no such file|permission denied|traceback/i.test(text))return 'HERMES 실행 환경 오류';
 return text&&text!=='""'?'분류되지 않은 HERMES 오류':'HERMES 오류 상세 미보고';
}
