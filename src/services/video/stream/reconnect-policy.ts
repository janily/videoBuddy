export function streamHttpAction(status:number,code?:string):'retry'|'refresh_stop'|'connect'{
 if(status===409&&code==='OPERATION_NOT_STARTED')return 'retry';
 if(status===409||status===410)return 'refresh_stop';
 return status>=200&&status<300?'connect':'retry';
}
