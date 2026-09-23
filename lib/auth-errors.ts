export class AuthError extends Error {
 constructor(public status:number,message:string){super(message)}
}
export const invalidCredentials=()=>new AuthError(401,'이메일 또는 인증 정보를 확인해 주세요.');
export function authFailure(error:unknown){
 const known=error instanceof AuthError;
 return Response.json({error:known?error.message:'인증을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},{status:known?error.status:503,headers:{'Cache-Control':'no-store'}});
}
