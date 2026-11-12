import fs from 'node:fs/promises';
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const root=new URL('../',import.meta.url);
await fs.mkdir(new URL('.private/',root),{recursive:true});
const passwordPath=new URL('.private/access-key.txt',root);
let password;
try {password=(await fs.readFile(passwordPath,'utf8')).trim();}catch{
  const alphabet='abcdefghjkmnpqrstuvwxyz23456789';
  password=Array.from(randomBytes(20),b=>alphabet[b%alphabet.length]).join('').match(/.{1,5}/g).join('-');
  await fs.writeFile(passwordPath,password+'\n',{mode:0o600});
}
const data=JSON.parse(await fs.readFile(new URL('../../reading-practice-web/app/data/library.json',import.meta.url),'utf8'));
const salt=randomBytes(16),iv=randomBytes(12),iterations=600000;
const key=pbkdf2Sync(password,salt,iterations,32,'sha256');
const cipher=createCipheriv('aes-256-gcm',key,iv);
const encrypted=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(data)))),cipher.final(),cipher.getAuthTag()]);
await fs.writeFile(new URL('public/reading/library.enc.json',root),JSON.stringify({format:'reading-library-aesgcm-v1',iterations,salt:salt.toString('base64'),iv:iv.toString('base64'),data:encrypted.toString('base64')}));
console.log(JSON.stringify({encryptedBytes:encrypted.length,questions:data.questions.length,exercises:data.exercises.length,annotated:data.questions.filter(q=>q.review).length,keySavedLocally:true}));
