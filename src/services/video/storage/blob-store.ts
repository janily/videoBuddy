import {get,put,BlobPreconditionFailedError,BlobError} from '@vercel/blob';
import {AtomicStore,StoreConflict,StoreMissing} from './atomic-store';
export class BlobStore implements AtomicStore{
 constructor(private token:string,private namespace:string){if(!token||!/^video-v5\/[a-zA-Z0-9_-]+$/.test(namespace))throw Error('CONFIGURATION_REQUIRED: private Blob namespace/token')}
 key(key:string){if(!/^[a-zA-Z0-9/_-]+(?:\.json)?$/.test(key))throw Error('INVALID_KEY');return `${this.namespace}/${key}${key.endsWith('.json')?'':'.json'}`}
 async readFresh<T>(key:string){const r=await get(this.key(key),{access:'private',token:this.token,useCache:false});if(!r||r.statusCode!==200||!r.stream)throw new StoreMissing();return{value:await new Response(r.stream).json() as T,etag:r.blob.etag}}
 async create<T>(key:string,value:T){try{await put(this.key(key),JSON.stringify(value),{access:'private',token:this.token,contentType:'application/json',addRandomSuffix:false,allowOverwrite:false})}catch(e){if(e instanceof BlobPreconditionFailedError||(e instanceof BlobError&&/already exists/i.test(e.message)))throw new StoreConflict();throw e}}
 async cas<T>(key:string,etag:string,value:T){try{await put(this.key(key),JSON.stringify(value),{access:'private',token:this.token,contentType:'application/json',addRandomSuffix:false,ifMatch:etag})}catch(e){if(e instanceof BlobPreconditionFailedError)throw new StoreConflict();throw e}}
}
export function productionStore(){if(!process.env.VIDEO_ENVIRONMENT||!process.env.BLOB_READ_WRITE_TOKEN)throw Error('CONFIGURATION_REQUIRED: private Blob');return new BlobStore(process.env.BLOB_READ_WRITE_TOKEN,`video-v5/${process.env.VIDEO_ENVIRONMENT}`)}
