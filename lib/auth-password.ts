import {scrypt,randomBytes,timingSafeEqual} from 'node:crypto';
import {AuthError} from './auth-errors';
const options={N:32768,r:8,p:3,maxmem:64*1024*1024};
export function validatePassword(value:unknown):string {
 if(typeof value!=='string'||value.length<12||value.length>128||new TextEncoder().encode(value).length>512)throw new AuthError(400,'비밀번호는 12~128자로 입력해 주세요.');
 return value;
}
function derive(password:string,salt:Uint8Array):Promise<Uint8Array>{return new Promise((resolve,reject)=>scrypt(password,salt,32,options,(error,key)=>error?reject(error):resolve(key)))}
const hex=(value:Uint8Array)=>Array.from(value,b=>b.toString(16).padStart(2,'0')).join('');
const bytes=(value:string)=>Uint8Array.from(value.match(/../g)!,x=>parseInt(x,16));
export async function hashPassword(password:string){validatePassword(password);const salt=randomBytes(16);return `scrypt$32768$8$3$${hex(salt)}$${hex(await derive(password,salt))}`}
export async function verifyPassword(password:unknown,encoded:string|null){
 if(typeof password!=='string'||password.length>128||new TextEncoder().encode(password).length>512)return false;
 const valid=!!encoded&&/^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(encoded);
 const parts=valid?encoded!.split('$'):['','','','','00000000000000000000000000000000','0'.repeat(64)];
 const key=await derive(password,bytes(parts[4]));return timingSafeEqual(key,bytes(parts[5]))&&valid;
}
