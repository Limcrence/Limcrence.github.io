import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { gradeAnswer } from '../src/lib/grading.ts';
import { applyOperation, freshRecord, mergeProgress, passagePart, validateRecords } from '../src/lib/progress.ts';
import { decryptLibrary, deriveKey } from '../src/lib/secure.ts';
const root=new URL('../',import.meta.url);
const envelope=JSON.parse(await fs.readFile(new URL('public/reading/library.enc.json',root),'utf8'));
const password=(await fs.readFile(new URL('.private/access-key.txt',root),'utf8')).trim();
const key=await deriveKey(password,envelope);const library=await decryptLibrary(key,envelope);
assert.equal(library.questions.length,656);assert.equal(library.exercises.length,50);assert.equal(library.questions.filter(q=>q.review).length,207);
await assert.rejects(()=>decryptLibrary(new Uint8Array(32),envelope));
let alternatives=0;
for(const q of library.questions){
  assert.equal(gradeAnswer(q,q.correct_answer_raw).result,'correct',q.id);
  if(!Object.keys(q.options).length){
    for(const answer of q.correct_answer_raw.flatMap(s=>s.split(/\s*[/／]\s*/))){assert.equal(gradeAnswer(q,[`  ${answer.toUpperCase()}  `]).result,'correct',q.id);alternatives++;}
  }
}
const ids=new Set(library.questions.map(q=>q.id));const first=library.questions[0].id;
let progress=applyOperation({}, {questionId:first,op:'origin',value:'serious'},10);
progress=applyOperation(progress,{questionId:first,op:'draft',value:['A']},20);
progress=applyOperation(progress,{questionId:first,op:'attempt',value:{answer:['A'],result:'wrong'}},30);
assert.equal(progress[first].origin,'serious');assert.equal(progress[first].attempts,1);
const older={...freshRecord(first),origin:'rushed',updatedAt:1};assert.equal(mergeProgress(progress,[older])[first].origin,'serious');
assert.equal(validateRecords(Object.values(progress),ids)[0].origin,'serious');
assert.equal(validateRecords([{...progress[first],origin:undefined}],ids)[0].origin,'unknown');
assert.throws(()=>validateRecords([{...progress[first],questionId:'__proto__'}],ids));assert.throws(()=>validateRecords([{...progress[first],origin:'invented'}],ids));
assert.equal(passagePart('C21_T1_R3'),'3');assert.equal(passagePart('C17 T3 R1 TFNG'),'1');
const p3=library.questions.filter(q=>passagePart(q.passage_code)==='3');assert.ok(p3.length>0);
const ex=p3[0].exercise_id;const group=library.questions.filter(q=>q.exercise_id===ex);let states={};
for(const q of group.slice(0,2))states=applyOperation(states,{questionId:q.id,op:'origin',value:'serious'});
for(const q of group.slice(2))states=applyOperation(states,{questionId:q.id,op:'origin',value:'rushed'});
assert.ok(group.slice(0,2).every(q=>states[q.id].origin==='serious'));assert.ok(group.slice(2).every(q=>states[q.id].origin==='rushed'));
const plain=await fs.readFile(new URL('public/reading/library.enc.json',root),'utf8');assert.ok(!plain.includes(library.questions[0].question));assert.ok(!plain.includes(password));
console.log(JSON.stringify({questions:656,annotated:207,acceptedFillAlternatives:alternatives,encryptionRoundTrip:true,wrongKeyRejected:true,backupValidation:true,p3MarkingPreservesEarlierQuestions:true}));
