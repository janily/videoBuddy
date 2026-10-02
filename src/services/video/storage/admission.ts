import {randomUUID} from 'node:crypto';
import {AtomicStore,createOrRead,updateJson} from './atomic-store';
type Reservation={id:string;owner:string;reservationId:string;reservedAt:string};
export class Admission{
 constructor(private store:AtomicStore,private key:string,private globalLimit=2,private ownerLimit=1){}
 async reserve(owner:string,id:string):Promise<Reservation>{
  await createOrRead(this.store,this.key,{reservations:[] as Reservation[]});
  const candidate={owner,id,reservationId:randomUUID(),reservedAt:new Date().toISOString()};
  const next=await updateJson(this.store,this.key,(c:{reservations:Reservation[]})=>{
   if(c.reservations.some(r=>r.id===id&&r.owner===owner))return c;
   if(c.reservations.length>=this.globalLimit||c.reservations.filter(r=>r.owner===owner).length>=this.ownerLimit)throw Error('CAPACITY_LIMIT');
   return{reservations:[...c.reservations,candidate]};
  });return next.reservations.find(r=>r.id===id&&r.owner===owner)!;
 }
 async release(id:string,reservationId:string,terminalVerified:boolean){if(!terminalVerified)return;await updateJson(this.store,this.key,(c:{reservations:Reservation[]})=>({reservations:c.reservations.filter(r=>!(r.id===id&&r.reservationId===reservationId))}));}
}
