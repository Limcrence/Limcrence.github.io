import type { Origin, Progress, ReviewRecord, SaveOperation } from './types';
export const PROGRESS_KEY='reading-desk-pages-progress-v1';
export const freshRecord=(id:string):ReviewRecord=>({questionId:id,state:'learning',note:'',draft:[],lastAnswer:[],lastResult:'',attempts:0,updatedAt:0,origin:'unknown'});
export function applyOperation(progress:Progress,op:SaveOperation,now=Date.now()):Progress {
  const record={...(progress[op.questionId]||freshRecord(op.questionId)),updatedAt:now};
  if(op.op==='draft')record.draft=op.value as string[];
  if(op.op==='note')record.note=op.value as string;
  if(op.op==='state')record.state=op.value as 'learning'|'mastered';
  if(op.op==='origin')record.origin=op.value as Origin;
  if(op.op==='attempt'){
    const attempt=op.value as {answer:string[];result:ReviewRecord['lastResult']};
    record.lastAnswer=[...attempt.answer];record.lastResult=attempt.result;record.attempts++;
    if(attempt.result==='wrong'||attempt.result==='partial')record.state='learning';
  }
  return {...progress,[op.questionId]:record};
}
export function validateRecords(value:unknown,validIds:Set<string>):ReviewRecord[]{
  if(!Array.isArray(value)||value.length>2000)throw new Error('进度文件格式不正确');
  return value.map(item=>{
    if(!item||typeof item!=='object'||!validIds.has(item.questionId))throw new Error('进度包含不属于此题库的题目');
    if(!['learning','mastered'].includes(item.state)||typeof item.note!=='string'||item.note.length>4000)throw new Error('复习状态或笔记格式不正确');
    for(const field of ['draft','lastAnswer'])if(!Array.isArray(item[field])||item[field].length>10||item[field].some((x:unknown)=>typeof x!=='string'||x.length>256))throw new Error('答案格式不正确');
    if(!['','correct','wrong','partial','revealed'].includes(item.lastResult)||!Number.isSafeInteger(item.attempts)||item.attempts<0||!Number.isFinite(item.updatedAt)||item.updatedAt<0)throw new Error('复习记录格式不正确');
    if(item.origin!==undefined&&!['unknown','serious','rushed'].includes(item.origin))throw new Error('原作答标记不正确');
    return {...freshRecord(item.questionId),state:item.state,note:item.note,draft:[...item.draft],lastAnswer:[...item.lastAnswer],lastResult:item.lastResult,attempts:item.attempts,updatedAt:item.updatedAt,origin:item.origin||'unknown'};
  });
}
export function mergeProgress(current:Progress,incoming:ReviewRecord[]):Progress {
  const next={...current};
  for(const record of incoming)if(!next[record.questionId]||record.updatedAt>next[record.questionId].updatedAt)next[record.questionId]=record;
  return next;
}
export function passagePart(code:string){return code.match(/(?:_|\s)R([123])(?:\b|_)/i)?.[1]||'';}
