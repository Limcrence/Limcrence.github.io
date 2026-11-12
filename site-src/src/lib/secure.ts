export type Envelope = { format: string; iterations: number; salt: string; iv: string; data: string };
export const REMEMBER_KEY = 'reading-desk-unlock-v1';
function bytes(value:string) {return Uint8Array.from(atob(value), c=>c.charCodeAt(0));}
export function base64(value:Uint8Array) {return btoa(Array.from(value,b=>String.fromCharCode(b)).join(''));}
export async function deriveKey(password:string,envelope:Envelope) {
  const seed=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(envelope.salt),iterations:envelope.iterations},seed,256));
}
export async function decryptLibrary(rawKey:Uint8Array,envelope:Envelope) {
  if(envelope.format!=='reading-library-aesgcm-v1'||envelope.iterations!==600000)throw new Error('题库格式不受支持');
  const key=await crypto.subtle.importKey('raw',rawKey as BufferSource,'AES-GCM',false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv)},key,bytes(envelope.data));
  const stream=new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
export function rememberedKey(){try {const value=localStorage.getItem(REMEMBER_KEY);return value?bytes(value):null;}catch{return null;}}
