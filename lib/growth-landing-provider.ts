import type {GrowthProviderFields,GrowthProviderReceipt} from './growth-provider';
export type LandingProviderBinding={
 storeId:string;connectionVersion:number;baseUrl:string;tenantId:string;providerStoreId:string;
 productId:string;productVersion:number;beforeDigest:string;beforeFields:GrowthProviderFields;afterFields:GrowthProviderFields;
 authorityId:string;authorityVersion:number;boundAt:string;boundBy:string;
};
export type LandingProviderAttempt={
 requestId:string;operation:'apply'|'rollback';status:'unknown'|'verified'|'rejected';
 expectedDigest:string;expectedFields:GrowthProviderFields;approvalDigest:string;originalRequestId?:string;
 startedAt:string;reason:string;errorCode:string|null;receipt:GrowthProviderReceipt|null;verifiedAt:string|null;
};
export type LandingRecoveryApproval={connectionVersion:number;authorityId:string;authorityVersion:number;originalRequestId:string;expectedDigest:string;by:string;at:string;digest:string};
export type LandingProviderState={binding:LandingProviderBinding;attempt:LandingProviderAttempt|null;applyReceipt:GrowthProviderReceipt|null;recoveryApproval?:LandingRecoveryApproval};
