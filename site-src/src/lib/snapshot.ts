import type { Progress,ReviewRecord } from './types';
import { validateRecords } from './progress.ts';
import {validateStudy,type StudyState} from './study.ts';
export type ReadingSession={ids:string[];index:number;kind?:'daily';day?:string};
export type ProgressSnapshot={format:'reading-desk-snapshot-v2';records:ReviewRecord[];session:ReadingSession|null;study:StudyState|null};
export function makeSnapshot(progress:Progress,session:ReadingSession|null,study:StudyState|null=null):ProgressSnapshot{
  return {format:'reading-desk-snapshot-v2',records:Object.values(progress).sort((a,b)=>a.questionId.localeCompare(b.questionId)),session:session?{ids:[...session.ids],index:session.index,...(session.kind==='daily'?{kind:session.kind,day:session.day}:{})}:null,study};
}
export function validateSnapshot(value:unknown,validIds:Set<string>):ProgressSnapshot{
  if(!value||typeof value!=='object'||!['reading-desk-snapshot-v1','reading-desk-snapshot-v2'].includes((value as ProgressSnapshot).format))throw new Error('云端存档版本不受支持，请刷新页面');
  const s=value as ProgressSnapshot;
  const records=validateRecords(s.records,validIds);
  if(s.session!==null&&(!s.session||!Array.isArray(s.session.ids)||s.session.ids.length<1||s.session.ids.length>validIds.size||!s.session.ids.every(id=>validIds.has(id))||!Number.isSafeInteger(s.session.index)||s.session.index<0||s.session.index>=s.session.ids.length))throw new Error('云端练习位置不正确');
  if(s.session?.kind!==undefined&&(s.session.kind!=='daily'||typeof s.session.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.session.day)))throw new Error('每日练习位置不正确');
  const study=s.format==='reading-desk-snapshot-v2'&&s.study!==null?validateStudy(s.study,validIds):null;
  if(s.session?.kind==='daily'&&(!study||!study.plans.some(p=>p.day===s.session!.day&&s.session!.ids.every(id=>p.ids.includes(id)))))throw new Error('每日练习与计划不一致');
  return makeSnapshot(Object.fromEntries(records.map(r=>[r.questionId,r])),s.session,study);
}
export function snapshotSummary(snapshot:ProgressSnapshot|null){
  const rows=snapshot?.records||[];
  return {questions:rows.filter(r=>r.attempts>0).length,attempts:rows.reduce((n,r)=>n+r.attempts,0),mastered:rows.filter(r=>r.state==='mastered').length,notes:rows.filter(r=>r.note.trim()).length,marked:rows.filter(r=>r.origin!=='unknown').length,planned:snapshot?.study?.events.length||0,updatedAt:Math.max(0,snapshot?.study?.updatedAt||0,...rows.map(r=>r.updatedAt))};
}
