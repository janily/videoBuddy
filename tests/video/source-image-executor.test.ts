import {expect,it} from 'vitest';
import {prepareSourceImage} from '@/services/video/assets/image-preparation';
import {FileStore} from '@/services/video/storage/file-store';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
it('rejects revoked ownership before configuration, local writes or native admission',async()=>{const root=await mkdtemp(join(tmpdir(),'vb-image-prepare-')),projectId=randomUUID(),operationId=randomUUID(),assetId=randomUUID(),store=new FileStore(root);try{await expect(prepareSourceImage(root,{projectId,assetId,sourceMime:'image/png',sourceSha256:'a'.repeat(64),sourceBytes:100},{env:{},journal:{store,prefix:`projects/${projectId}/operations/${operationId}/media-effects`},assertActive:async()=>{throw Error('ASSET_REMOVED')}})).rejects.toThrow('ASSET_REMOVED');expect(await store.listKeys('projects',4)).toEqual([])}finally{await rm(root,{recursive:true,force:true})}});
