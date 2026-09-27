// 트랙 R R15b-3 인터뷰 영상 완성본 해시(순수). 점주·대표 인터뷰 영상은 content 역할의 15초 대본(모집 자료 유형 interview_video, 승인·R2 판정은 모집 자료 흐름 그대로)으로
// 사람이 촬영하고, 앱은 완성본 파일의 SHA-256·크기·촬영일·라벨만 그 자료 판에 남긴다. 영상 파일은 올리지 않는다(브라우저에서 해시만 계산한다).
// 판정만 한다: 대표·관리자, 승인된 판, 인터뷰 영상 자료, 해시 형식, 크기, 촬영일(승인일(KST) ~ 오늘), 라벨(개인정보 검사는 서버가 한다), 같은 해시 중복·한도.
// 시계·조회·외부 호출이 없다(now 인자). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님. 모델 경계: 앱의 모델 경로가 이 모듈에 닿지 않는다(FORBIDDEN).
import {isDate,isInstant,toKstDate,kstDateOf} from './franchise-rules';

export const MEDIA_VERSION='fr-media@2026-09-28.1';
export const MEDIA_ASSET_TYPES:readonly string[]=Object.freeze(['interview_video']);
export const MEDIA_LIMITS=Object.freeze({items:10,labelChars:60,maxBytes:4*1024**3});
export type MediaRecord={sha256:string;bytes:number;label:string;filmedOn:string;recordedAt:string;by:{id:string;role:string}};
export const MEDIA_CODES=Object.freeze(['media_duplicate','media_invalid','media_limit','media_not_approved','media_role','media_switch_off','media_type'] as const);
export type MediaCode=typeof MEDIA_CODES[number];
export const MEDIA_CODE_STATUS:Readonly<Record<MediaCode,400|403|409>>=Object.freeze({media_duplicate:409,media_invalid:400,media_limit:409,media_not_approved:409,media_role:403,media_switch_off:409,media_type:400});
export const MEDIA_MESSAGES:Readonly<Record<MediaCode,string>>=Object.freeze({
 media_duplicate:'같은 완성본 해시가 이미 기록돼 있습니다.',
 media_invalid:`완성본 해시(SHA-256 64자)·파일 크기(1바이트~4GB)·촬영일(승인일부터 오늘까지, KST)·라벨(1~${MEDIA_LIMITS.labelChars}자)을 확인하세요.`,
 media_limit:`완성본은 판마다 ${MEDIA_LIMITS.items}개까지 기록합니다.`,
 media_not_approved:'승인된 인터뷰 영상 대본 판에만 완성본 해시를 기록할 수 있습니다.',
 media_role:'완성본 해시는 대표·관리자가 기록합니다.',
 media_switch_off:'가맹 모집 기능이 꺼져 있어 완성본 해시를 기록할 수 없습니다.',
 media_type:'인터뷰 영상 대본 자료에만 완성본 해시를 기록합니다.',
});
export type MediaDecision={ok:true;value:MediaRecord}|{ok:false;status:400|403|409;reasons:MediaCode[];message:string};
const fail=(code:MediaCode):MediaDecision=>({ok:false,status:MEDIA_CODE_STATUS[code],reasons:[code],message:MEDIA_MESSAGES[code]});
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const HEX64=/^[0-9a-f]{64}$/;
const hasControl=(s:string)=>Array.from(s).some(ch=>{const c=ch.codePointAt(0)??0;return c<0x20||(c>=0x7f&&c<=0x9f)||c===0x2028||c===0x2029});
const labelOk=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>=1&&Array.from(v.trim()).length<=MEDIA_LIMITS.labelChars&&!hasControl(v);
// asset: 저장된 모집 자료 판(유형·상태·승인·기존 media). 순서: 스위치 → 역할 → 유형 → 승인 → 입력 → 중복 → 한도.
export function mediaDecision(asset:unknown,input:unknown,ctx:{enabled:boolean;actor:{id:string;role:string};now:string}):MediaDecision{
 try{
  if(ctx.enabled!==true)return fail('media_switch_off');
  if(!isRecord(ctx.actor)||(ctx.actor.role!=='owner'&&ctx.actor.role!=='admin'))return fail('media_role');
  if(!isRecord(asset)||!MEDIA_ASSET_TYPES.includes(String(asset.type)))return fail('media_type');
  const approval=asset.approval;
  if(asset.status!=='approved'||!isRecord(approval)||!isInstant(approval.at))return fail('media_not_approved');
  if(!isRecord(input)||!isInstant(ctx.now))return fail('media_invalid');
  const sha=typeof input.sha256==='string'?input.sha256.toLowerCase():'',bytes=input.bytes,on=input.filmedOn,label=input.label;
  if(!HEX64.test(sha)||typeof bytes!=='number'||!Number.isSafeInteger(bytes)||bytes<1||bytes>MEDIA_LIMITS.maxBytes||!isDate(on)||on>toKstDate(ctx.now)||on<kstDateOf(approval.at as string)||!labelOk(label))return fail('media_invalid');
  const media=Array.isArray(asset.media)?asset.media as MediaRecord[]:[];
  if(media.some(m=>isRecord(m)&&m.sha256===sha))return fail('media_duplicate');
  if(media.length>=MEDIA_LIMITS.items)return fail('media_limit');
  return {ok:true,value:{sha256:sha,bytes,label:label.trim(),filmedOn:on,recordedAt:ctx.now,by:{id:ctx.actor.id,role:ctx.actor.role}}};
 }catch{return fail('media_invalid')}
}
