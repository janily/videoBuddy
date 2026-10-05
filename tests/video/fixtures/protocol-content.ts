import type {reviewApprovedContent} from '@/services/video/render/content-review';
/** Explicit unit boundary: verifies publication protocol, not semantic/media QA. */
export function protocolContentVerifier(filmSha256:string,filmSpecSha256:string):typeof reviewApprovedContent{
 return async()=>({schemaVersion:1,inputHash:'0'.repeat(64),compositionHash:'0'.repeat(64),evidenceHash:'0'.repeat(64),requirementsRef:{key:'unit-protocol-only',sha256:'0'.repeat(64),bytes:1,mime:'application/json'},batches:[],report:{schemaVersion:1,filmSha256,filmSpecSha256,factsManifestSha256:'0'.repeat(64),scope:'two_round_provided_frames_and_verified_transcripts',result:'pass',facts:[],conflicts:[],batchCount:0,audio:'transcripts_only',continuousMotion:'not_supplied',deliveryEligible:false},deliveryEligible:false});
}
