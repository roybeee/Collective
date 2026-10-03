// 분석 계층 공용 해시(순수·동기). 점수표 inputDigest·결정형 ID가 같은 입력에서 늘 같은 값을 내도록 키 정렬 JSON + SHA-256을 쓴다.
// crypto.subtle은 비동기라 순수 계산 흐름(점수표·백테스트)에 끼우기 어렵다. 그래서 FIPS 180-4 그대로 동기 구현을 둔다.
const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const rotr=(x:number,n:number)=>(x>>>n)|(x<<(32-n));
export function sha256Hex(text:string):string{
 const msg=new TextEncoder().encode(text),bitLen=msg.length*8,total=((msg.length+9+63)>>6)<<6,buf=new Uint8Array(total);
 buf.set(msg);buf[msg.length]=0x80;
 // 길이는 64비트 빅엔디언. 2^32비트(512MB) 넘는 입력은 다루지 않으므로 하위 32비트와 상위 몫만 적는다.
 const hi=Math.floor(bitLen/0x100000000),lo=bitLen>>>0;
 for(let i=0;i<4;i++){buf[total-8+i]=(hi>>>(24-8*i))&255;buf[total-4+i]=(lo>>>(24-8*i))&255}
 const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],W=new Array<number>(64);
 for(let o=0;o<total;o+=64){
  for(let t=0;t<16;t++)W[t]=(buf[o+4*t]<<24)|(buf[o+4*t+1]<<16)|(buf[o+4*t+2]<<8)|buf[o+4*t+3];
  for(let t=16;t<64;t++){const a=W[t-15],b=W[t-2];W[t]=(W[t-16]+(rotr(a,7)^rotr(a,18)^(a>>>3))+W[t-7]+(rotr(b,17)^rotr(b,19)^(b>>>10)))|0}
  let [a,b,c,d,e,f,g,h]=H;
  for(let t=0;t<64;t++){
   const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[t]+W[t])|0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;
   h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
  }
  H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
 }
 return H.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
}
// 키 정렬 JSON. undefined 필드는 빼고(JSON과 같음), NaN·Infinity는 null로 적는다. 배열 순서는 의미가 있으므로 유지한다.
export function stableJson(value:unknown):string{
 if(value===null||value===undefined)return 'null';
 if(typeof value==='number')return Number.isFinite(value)?JSON.stringify(value):'null';
 if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>v===undefined?'null':stableJson(v)).join(',')+']';
 if(typeof value==='object'){const o=value as Record<string,unknown>;return '{'+Object.keys(o).filter(k=>o[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stableJson(o[k])).join(',')+'}'}
 return 'null';
}
export const digestOf=(value:unknown)=>'sha256:'+sha256Hex(stableJson(value));
export const shortId=(prefix:string,value:unknown)=>prefix+'_'+sha256Hex(typeof value==='string'?value:stableJson(value)).slice(0,16);
