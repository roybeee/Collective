export type RetentionSettings={automaticEnabled:boolean;updatedAt:string|null;lastAutomaticDay?:string;confirmedBy?:string;confirmationVersion?:string};
export type RetentionPlan={id:string;digest:string;createdAt:string;expiresAt:string;status:'ready'|'held'|'applied';counts:{kind:string;records:number}[];total:number;heldReasons:string[];externalDeletion:'unverified'|'not_applicable'};
export type RetentionReceipt={id:string;planId:string;digest:string;at:string;deleted:number;mode:'manual'|'automatic';externalDeletion:'unverified'|'not_applicable'};
export type ExternalDeletionEvidence={id:string;reference:string;note:string;at:string;recordedBy:string;verification:'operator_attested'};
