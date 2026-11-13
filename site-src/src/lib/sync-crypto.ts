import { base64 } from './secure.ts';
export type SyncIdentity={vaultId:string;token:string;encryptionKey:CryptoKey};
export type CipherSnapshot={format:'reading-progress-aesgcm-v1';iv:string;data:string};
const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function deriveSyncIdentity(rawKey:Uint8Array):Promise<SyncIdentity>{
  const material=await crypto.subtle.importKey('raw',rawKey as BufferSource,'HKDF',false,['deriveBits']);
  const derive=(info:string)=>crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('limcrence-reading-sync-v1'),info:new TextEncoder().encode(info)},material,256);
  const encryption=await derive('encrypted-progress'),authentication=await derive('sync-authentication');
  const token=base64(new Uint8Array(authentication)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const vaultId=await hashText(token);
  return {vaultId,token,encryptionKey:await crypto.subtle.importKey('raw',encryption,'AES-GCM',false,['encrypt','decrypt'])};
}
export async function hashText(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function encryptSnapshot(identity:SyncIdentity,value:unknown):Promise<CipherSnapshot>{
  const compressed=await new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},identity.encryptionKey,compressed);
  const result:CipherSnapshot={format:'reading-progress-aesgcm-v1',iv:base64(iv),data:base64(new Uint8Array(encrypted))};
  if(result.data.length>1_500_000)throw new Error('存档过大，已保留本地进度，请先导出备份');
  return result;
}
export async function decryptSnapshot(identity:SyncIdentity,value:CipherSnapshot):Promise<unknown>{
  if(value?.format!=='reading-progress-aesgcm-v1'||typeof value.iv!=='string'||typeof value.data!=='string'||value.data.length>1_500_000)throw new Error('云端存档格式不正确');
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(value.iv)},identity.encryptionKey,decode(value.data));
  const response=new Response(new Blob([decrypted]).stream().pipeThrough(new DecompressionStream('gzip')));
  return JSON.parse(await response.text());
}
