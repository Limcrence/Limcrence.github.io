import type { Progress,ReviewRecord } from './types';
import { validateRecords } from './progress.ts';
export type ReadingSession={ids:string[];index:number};
export type ProgressSnapshot={format:'reading-desk-snapshot-v1';records:ReviewRecord[];session:ReadingSession|null};
export function makeSnapshot(progress:Progress,session:ReadingSession|null):ProgressSnapshot{
  return {format:'reading-desk-snapshot-v1',records:Object.values(progress).sort((a,b)=>a.questionId.localeCompare(b.questionId)),session:session?{ids:[...session.ids],index:session.index}:null};
}
export function validateSnapshot(value:unknown,validIds:Set<string>):ProgressSnapshot{
  if(!value||typeof value!=='object'||(value as ProgressSnapshot).format!=='reading-desk-snapshot-v1')throw new Error('云端存档版本不受支持');
  const s=value as ProgressSnapshot;
  const records=validateRecords(s.records,validIds);
  if(s.session!==null&&(!s.session||!Array.isArray(s.session.ids)||s.session.ids.length<1||s.session.ids.length>validIds.size||!s.session.ids.every(id=>validIds.has(id))||!Number.isSafeInteger(s.session.index)||s.session.index<0||s.session.index>=s.session.ids.length))throw new Error('云端练习位置不正确');
  return makeSnapshot(Object.fromEntries(records.map(r=>[r.questionId,r])),s.session);
}
export function snapshotSummary(snapshot:ProgressSnapshot|null){
  const rows=snapshot?.records||[];
  return {questions:rows.filter(r=>r.attempts>0).length,attempts:rows.reduce((n,r)=>n+r.attempts,0),mastered:rows.filter(r=>r.state==='mastered').length,notes:rows.filter(r=>r.note.trim()).length,marked:rows.filter(r=>r.origin!=='unknown').length,updatedAt:Math.max(0,...rows.map(r=>r.updatedAt))};
}
