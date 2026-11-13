import type {CipherSnapshot,SyncIdentity} from './sync-crypto';
export type CloudRecord={version:number;updatedAt:number;mutationId:string;payload:CipherSnapshot};
export type CloudWrite={expectedVersion:number|null;mutationId:string;payload:CipherSnapshot};
export interface CloudAPI{read():Promise<CloudRecord|null>;write(value:CloudWrite):Promise<{version:number;updatedAt:number}>;}
export class CloudConflictError extends Error{constructor(){super('云端已有更新，请重新选择保留的版本');}}
export function createCloudAPI(endpoint:string,identity:SyncIdentity):CloudAPI{
  async function request(method:string,body?:CloudWrite){
    const response=await fetch(`${endpoint}/v1/vault/${identity.vaultId}`,{method,cache:'no-store',headers:{Authorization:`Bearer ${identity.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    if(response.status===409)throw new CloudConflictError();
    if(!response.ok){const message=response.status===401?'云端验证失败，请锁定后重新输入口令':response.status===413?'存档过大，已保留本地进度':`云端暂时无法连接（${response.status}），本地进度已保留`;throw new Error(message);}
    return response.json();
  }
  return {read:async()=>{const data=await request('GET');return data.record as CloudRecord|null;},write:async body=>request('PUT',body)};
}
