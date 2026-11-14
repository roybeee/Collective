// API 키(G9, docs/MCP-SERVER.ko.md) 순수 규칙: 화면·서버 공용. 저장·조회·해시·빈도 제한은 lib/api-keys-server.ts, MCP 도구는 lib/mcp/.
// 키 원문은 'ck_' + 16진 64자(난수 32바이트)다. 만든 직후 응답에만 한 번 오고 저장하지 않는다(SHA-256 해시가 레코드 id, 표시용 접두어·끝 4자만 남는다).
// 범위: read(읽기 도구만) · draft(읽기 + 캠페인 초안·작업물 초안 저장). 어떤 범위도 승인·발행·지출·고객 발송·AI 실행을 하지 않는다.

export const API_KEY_PREFIX='ck_';
export const API_KEY_SCOPES=['read','draft'] as const;
export type ApiKeyScope=typeof API_KEY_SCOPES[number];
export const API_KEY_SCOPE_LABELS:Record<ApiKeyScope,string>={read:'읽기',draft:'읽기 + 초안 저장'};
export const API_KEY_DEFAULT_DAYS=90,API_KEY_MAX_DAYS=365,API_KEY_LABEL_MAX=60,API_KEYS_MAX_ACTIVE=20,API_KEY_RATE_PER_MINUTE=60;
// 유효한 키가 없는 요청의 IP당 1분 한도(키 추측·무차별 대입 완화)와 호출 감사(api_call) 보존 기간.
export const API_KEY_INVALID_PER_IP_MINUTE=30,API_CALL_RETENTION_DAYS=90;
export const API_KEY_DAY_CHOICES=[30,90,180,365] as const;
export type ApiKeyCreator={id:string;role:'owner'|'admin'};
export type ApiKey={id:string;label:string;scope:ApiKeyScope;prefix:typeof API_KEY_PREFIX;last4:string;createdBy:ApiKeyCreator;createdAt:string;expiresAt:string;revokedAt:string|null;lastUsedAt:string|null};
export type ApiKeyState='active'|'expired'|'revoked';
export const API_KEY_STATE_LABELS:Record<ApiKeyState,string>={active:'사용 중',expired:'만료',revoked:'취소함'};
export type ApiKeyEntry=ApiKey&{state:ApiKeyState};
export const API_KEY_MESSAGES={
 off:'MCP 서버 기능이 꺼져 있습니다. 소유자가 기능 스위치 mcp_server를 켜야 API 키를 만들 수 있습니다.',
 adminOnly:'API 키는 대표·관리자만 보고 만들고 취소할 수 있습니다.',
 label:`키 이름(라벨)은 1~${API_KEY_LABEL_MAX}자로 적으세요.`,
 scope:'범위는 읽기(read) 또는 초안 저장(draft) 중 하나입니다.',
 days:`유효 기간은 1~${API_KEY_MAX_DAYS}일입니다.`,
 cap:`사용 중인 API 키는 ${API_KEYS_MAX_ACTIVE}개까지입니다. 쓰지 않는 키를 취소하세요.`,
 notFound:'그 API 키가 없습니다.',
 unauthorized:'API 키가 없거나 만료·취소됐습니다. 설정에서 새 키를 만들어 Authorization: Bearer 헤더로 보내세요.',
 rate:`요청이 많습니다. API 키당 1분에 ${API_KEY_RATE_PER_MINUTE}회까지입니다. 잠시 후 다시 시도하세요.`,
 ipRate:`유효한 API 키 없이 보낸 요청이 많습니다. 같은 주소에서 1분에 ${API_KEY_INVALID_PER_IP_MINUTE}회까지입니다. 잠시 후 올바른 키로 다시 시도하세요.`,
} as const;

// ── 입력 검증(경계) ── 테스트 런타임이 npm 패키지를 올리지 못해 lib은 외부 검증 라이브러리를 쓰지 않는다(lib/share-links.ts와 같다). 모르는 필드는 거부한다.
export type Parsed<T>={success:true;data:T}|{success:false;issue:{path:string;message:string}};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=(path:string,message:string):Parsed<never>=>({success:false,issue:{path,message}});
const extraKey=(v:Record<string,unknown>,allowed:readonly string[])=>Object.keys(v).find(k=>!allowed.includes(k));
export const isApiKeyScope=(v:unknown):v is ApiKeyScope=>typeof v==='string'&&(API_KEY_SCOPES as readonly string[]).includes(v);
export type CreateKeyInput={action:'create';label:string;scope:ApiKeyScope;days:number};
export function parseCreateKey(raw:unknown):Parsed<CreateKeyInput>{
 if(!record(raw)||raw.action!=='create')return fail('action','지원하지 않는 API 키 작업입니다.');
 const extra=extraKey(raw,['action','label','scope','days']);if(extra)return fail(extra,'알 수 없는 입력입니다.');
 const label=typeof raw.label==='string'?raw.label.trim():'';
 if(!label||label.length>API_KEY_LABEL_MAX||/[\x00-\x1f\x7f]/.test(label))return fail('label',API_KEY_MESSAGES.label);
 if(!isApiKeyScope(raw.scope))return fail('scope',API_KEY_MESSAGES.scope);
 const days=raw.days===undefined?API_KEY_DEFAULT_DAYS:raw.days;
 if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>API_KEY_MAX_DAYS)return fail('days',API_KEY_MESSAGES.days);
 return {success:true,data:{action:'create',label,scope:raw.scope,days}};
}
export type RevokeKeyInput={action:'revoke';id:string};
export function parseRevokeKey(raw:unknown):Parsed<RevokeKeyInput>{
 if(!record(raw)||raw.action!=='revoke')return fail('action','지원하지 않는 API 키 작업입니다.');
 const extra=extraKey(raw,['action','id']);if(extra)return fail(extra,'알 수 없는 입력입니다.');
 const id=typeof raw.id==='string'?raw.id.trim():'';
 if(!id||id.length>100)return fail('id','API 키 id를 확인하세요.');
 return {success:true,data:{action:'revoke',id}};
}

// ── 상태·표시 ──
export const isApiKeyToken=(v:unknown):v is string=>typeof v==='string'&&/^ck_[a-f0-9]{64}$/.test(v);
// Authorization: Bearer <키>. 스킴은 대소문자 무시, 앞뒤 공백 허용. 모양이 다르면 null.
export function bearerToken(header:string|null):string|null{
 const m=/^\s*Bearer\s+(\S+)\s*$/i.exec(header||'');
 return m&&isApiKeyToken(m[1])?m[1]:null;
}
export const expiryOf=(now:number,days:number)=>new Date(now+days*86400000).toISOString();
export function keyState(k:Pick<ApiKey,'expiresAt'|'revokedAt'>,now:number):ApiKeyState{
 if(k.revokedAt)return 'revoked';
 return Date.parse(k.expiresAt)>now?'active':'expired';
}
export const entryOf=(k:ApiKey,now:number):ApiKeyEntry=>({...k,state:keyState(k,now)});
export const maskedKey=(k:Pick<ApiKey,'prefix'|'last4'>)=>`${k.prefix}…${k.last4}`;
// 범위가 허용하는 도구 등급. draft는 read를 포함한다(초안을 붙일 캠페인을 먼저 읽어야 한다).
export const scopeAllows=(scope:ApiKeyScope,tier:'read'|'draft')=>tier==='read'||scope==='draft';
