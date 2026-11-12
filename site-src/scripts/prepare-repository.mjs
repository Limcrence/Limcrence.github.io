import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const elements=[];
async function add(file,target){elements.push({path:target,mode:'100644',type:'blob',content:await fs.readFile(file,'utf8')});}
async function walk(directory,prefix){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const full=path.join(directory,entry.name),target=prefix+entry.name;if(entry.isDirectory())await walk(full,target+'/');else await add(full,target);}}
await walk(path.join(root,'dist'),'');
for(const directory of ['src','reading','public','scripts'])await walk(path.join(root,directory),'site-src/'+directory+'/');
for(const file of ['index.html','package.json','tsconfig.json','vite.config.ts','.gitignore'])await add(path.join(root,file),'site-src/'+file);
await add(path.join(root,'README.md'),'README.md');
elements.push({path:'.gitignore',mode:'100644',type:'blob',content:'site-src/node_modules/\nsite-src/dist/\nsite-src/.private/\n*.log\n'});
const password=(await fs.readFile(path.join(root,'.private/access-key.txt'),'utf8')).trim();
const raw=JSON.parse(await fs.readFile(path.join(root,'../reading-practice-web/app/data/library.json'),'utf8'));
for(const entry of elements){
  if(entry.path.includes('.private')||entry.content.includes(password))throw new Error('Private key would be published: '+entry.path);
  if(entry.content.includes(raw.questions[0].question)||entry.content.includes(raw.questions[0].student_answer_raw.join('DONOTMATCH'))&&entry.path.endsWith('library.json'))throw new Error('Plaintext library detected');
}
await fs.writeFile(path.join(root,'.private/repository-payload.json'),JSON.stringify(elements));
console.log(JSON.stringify({files:elements.length,characters:JSON.stringify(elements).length,paths:elements.map(e=>e.path)}));
