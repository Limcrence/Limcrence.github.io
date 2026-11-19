import fs from 'node:fs/promises';
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const root=new URL('../',import.meta.url);
const envelopePath=new URL('public/reading/library.enc.json',root);
const previous=await fs.readFile(envelopePath,'utf8').then(JSON.parse,error=>{
  if(error.code!=='ENOENT')throw error;
  return null;
});
await fs.mkdir(new URL('.private/',root),{recursive:true});
const passwordPath=new URL('.private/access-key.txt',root);
let password;
try {password=(await fs.readFile(passwordPath,'utf8')).trim();}catch(error){
  if(previous||error.code!=='ENOENT')throw error;
  const alphabet='abcdefghjkmnpqrstuvwxyz23456789';
  password=Array.from(randomBytes(20),b=>alphabet[b%alphabet.length]).join('').match(/.{1,5}/g).join('-');
  await fs.writeFile(passwordPath,password+'\n',{mode:0o600});
}
const data=JSON.parse(await fs.readFile(new URL('../../reading-practice-web/app/data/library.json',import.meta.url),'utf8'));
const iterations=600000;
if(previous&&(previous.format!=='reading-library-aesgcm-v1'||previous.iterations!==iterations))throw new Error('Existing library format is not supported');
// The current salt and password also determine the user's saved unlock key and cloud vault.
const salt=previous?Buffer.from(previous.salt,'base64'):randomBytes(16);
const key=pbkdf2Sync(password,salt,iterations,32,'sha256');
if(previous){
  const data=Buffer.from(previous.data,'base64');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(previous.iv,'base64'));
  decipher.setAuthTag(data.subarray(-16));
  decipher.update(data.subarray(0,-16));
  decipher.final();
}
const iv=randomBytes(12);
const cipher=createCipheriv('aes-256-gcm',key,iv);
const encrypted=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(data)))),cipher.final(),cipher.getAuthTag()]);
await fs.writeFile(envelopePath,JSON.stringify({format:'reading-library-aesgcm-v1',iterations,salt:salt.toString('base64'),iv:iv.toString('base64'),data:encrypted.toString('base64')}));
console.log(JSON.stringify({encryptedBytes:encrypted.length,questions:data.questions.length,exercises:data.exercises.length,annotated:data.questions.filter(q=>q.review).length,keySavedLocally:true}));
