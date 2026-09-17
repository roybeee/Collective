import type {Brand} from './agency';
import type {BrandResearch} from './archive';
import {DEEP_RESEARCH_VERSION,defaultResearchPlan,type ResearchAccess} from './deep-research';
import {stamp,database,recordStatement} from './server';
export function unverifiedResearchAccess():ResearchAccess{return {checkedAt:stamp(),gateway:false,aside:'unverified',browser:'unverified',tools:[],notes:['등록을 지연시키지 않도록 도구 점검을 분리했습니다. 실제 접근 가능 여부는 조사 실행에서 확인합니다.']}}
export function initialResearch(brand:Brand,id:string,model:string):BrandResearch{return {id,brandId:brand.id,mode:'deep',protocol:DEEP_RESEARCH_VERSION,plan:defaultResearchPlan(brand),access:unverifiedResearchAccess(),status:'running',steps:[{id:id+'-investigation',stage:'investigation',status:'pending'}],model,stopRequested:false,createdAt:stamp(),updatedAt:stamp(),tokens:0,snapshot:{brand,observations:[]}}}
export function queueResearchStatements(owner:string,r:BrandResearch){return [recordStatement(owner,'brand_research',r.id,r,r.brandId),database().prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(owner+':brand-research:'+r.id,owner,'brand:'+r.brandId,'brand_research','in_progress',r.model,1,r.createdAt,r.updatedAt)]}
