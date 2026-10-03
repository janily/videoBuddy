export class StoreConflict extends Error { constructor(){super('STORE_CONFLICT')} }
export class StoreMissing extends Error { constructor(){super('STORE_NOT_FOUND')} }
export interface AtomicStore {
 listKeys?(prefix:string,maxDepth:number):Promise<string[]>;
 readFresh<T>(key:string):Promise<{value:T;etag:string}>;
 create<T>(key:string,value:T):Promise<void>;
 cas<T>(key:string,etag:string,value:T):Promise<void>;
}
export async function updateJson<T>(store:AtomicStore,key:string,mutator:(current:T)=>T|Promise<T>):Promise<T>{
 for(let attempt=0;attempt<5;attempt++){
  const current=await store.readFresh<T>(key);
  const next=await mutator(structuredClone(current.value));
  if(new TextEncoder().encode(JSON.stringify(next)).length>256*1024)throw Error('CONTROL_SIZE_LIMIT');
  try{await store.cas(key,current.etag,next);return next}catch(error){if(!(error instanceof StoreConflict))throw error;if(attempt===4)throw error;await new Promise(resolve=>setTimeout(resolve,2**attempt*10+Math.random()*10));}
 }
 throw new StoreConflict();
}
export async function createOrRead<T>(store:AtomicStore,key:string,value:T):Promise<T>{
 try{await store.create(key,value);return value}catch(error){if(!(error instanceof StoreConflict))throw error;return(await store.readFresh<T>(key)).value;}
}
