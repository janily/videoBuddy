const semanticRejects=new Set(['MODEL_OUTPUT_INVALID','CRITIC_REVIEW_INVALID','CRITIC_EVIDENCE_INVALID','CRITIC_FACT_EVIDENCE_INVALID']);
export async function runAndArchiveProbeReview<T,R>(execute:()=>Promise<T>,archive:(review:T)=>Promise<R>):Promise<{status:'validated';review:T;reviewRef:R}|{status:'blocked';errorCode:string}>{
 let review:T;
 try{review=await execute()}catch(error){const errorCode=error instanceof Error?error.message:'';if(!semanticRejects.has(errorCode))throw error;return{status:'blocked',errorCode}}
 // Archive acknowledgement failures must escape; they are not model verdicts.
 return{status:'validated',review,reviewRef:await archive(review)};
}
