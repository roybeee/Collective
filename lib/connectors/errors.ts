import {ApiError} from '../server';

// security-ops-5: 워커가 실패 사유를 문구가 아니라 종류로 가르도록 표시한 오류. 상태 코드와 문구는 기존과 같다.
// 인증 실패(토큰 무효·만료, 키 불일치): 같은 자격증명으로 다시 시도해도 성공하지 않는다.
export class ConnectorAuthError extends ApiError {
 constructor(message: string) {
  super(400, message);
 }
}

// 수집에 쓸 자격증명이 없다(연결 전·해제됨). 연결 및 설정에서 다시 연결해야 한다.
export class ConnectorMissingError extends ApiError {
 constructor(message: string) {
  super(409, message);
 }
}
