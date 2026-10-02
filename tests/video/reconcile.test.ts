import{it,expect,beforeEach,afterEach}from'vitest';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{FileStore}from'./helpers/file-store';import{reconcileConversation}from'@/services/video/commands/reconcile';
let dir:string;beforeEach(async()=>dir=await mkdtemp(`${tmpdir()}/vb-recover-`));afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
it('unverifiable running work remains occupied and is never restarted',async()=>{
 const store=new FileStore(dir);await store.create('projects/p/control',{activeConversation:'op',controlVersion:1});await store.create('projects/p/operations/op',{status:'running',canonicalRunId:'r',kind:'chat'});let starts=0;
 expect(await reconcileConversation(store,'p',async()=>{throw Error('offline')},async()=>{starts++})).toBe('unknown');expect(starts).toBe(0);expect((await store.readFresh<{activeConversation:string}>('projects/p/control')).value.activeConversation).toBe('op');
});
it('a failed canonical run is marked interrupted and releases only its own lane',async()=>{
 const store=new FileStore(dir);await store.create('projects/p/control',{activeConversation:'op',controlVersion:1});await store.create('projects/p/operations/op',{status:'running',canonicalRunId:'r',kind:'chat'});
 expect(await reconcileConversation(store,'p',async()=> 'failed',async()=>{throw Error('must not restart')})).toBe('interrupted');expect((await store.readFresh<{activeConversation:null}>('projects/p/control')).value.activeConversation).toBeNull();
});
