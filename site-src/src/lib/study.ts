import {createEmptyCard,fsrs,Rating,type Card} from 'ts-fsrs';
import type {Article,Library,Progress,Question} from './types';
import {passagePart} from './progress.ts';

export const STUDY_KEY='reading-desk-study-v1';
export type Outcome='again'|'hard'|'good';
export type ReviewMode='guided'|'independent';
type SavedCard=Omit<Card,'due'|'last_review'>&{due:number;last_review?:number};
export type StudyCard={memory:SavedCard;dueDay:string;lastDay:string;lastOutcome:Outcome;guidedPasses:number;independentPasses:number};
export type ReviewEvent={id:string;questionId:string;key:string;at:number;day:string;outcome:Outcome;mode:ReviewMode;seconds:number;part:string;learningCheck:boolean};
export type AttemptFeedback={eventId:string;at:number;answer:string[];result:'correct'|'wrong'|'partial'|'revealed';mode:ReviewMode;seconds:number;revealed:boolean;helped:boolean};
export type DailyPlan={day:string;ids:string[];due:string[];completed:string[];skipped:string[];independent:string[];responses:Record<string,AttemptFeedback>;estimates:Record<string,number>;minutes:number;createdAt:number;updatedAt:number};
export type StudyState={format:'reading-desk-study-v1';settings:{minutes:number;timeZone:string};cards:Record<string,StudyCard>;events:ReviewEvent[];plans:DailyPlan[];updatedAt:number};
const scheduler=fsrs({request_retention:0.9,enable_fuzz:false,enable_short_term:false,maximum_interval:120});
const targets:Record<string,number>={'1':.25,'2':.35,'3':.4,'':0};
const outcomes=['again','hard','good'];
export function createStudy(timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone):StudyState{return {format:'reading-desk-study-v1',settings:{minutes:30,timeZone},cards:{},events:[],plans:[],updatedAt:0};}
export function studyDay(at:number,timeZone:string){const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');}
export function shiftDay(day:string,n:number){return new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);}
export function questionPart(q:Question){return passagePart(q.passage_code)||passagePart(q.assignment_group)||'';}
export function paragraphHints(q:Question,article:Article){return [...new Set(q.review?.evidence.map(e=>e.paragraph)||[])].filter(label=>article.paragraphs.some(p=>p.label===label));}
export function paragraphDescription(labels:string[],article:Article){return labels.map(label=>{const index=article.paragraphs.findIndex(p=>p.label===label);return /^P\d+$/i.test(label)?`第 ${index+1} 段`:`第 ${index+1} 段（${label} 段）`;}).join('、');}
export function isParagraphMatch(q:Question){return q.question_type==='细节段落匹配';}
export function needsGroupSubmission(q:Question){return /Summary|Heading|表格|选词|匹配/.test(q.question_type);}
export type QuestionIndex={groups:Map<string,Question[]>;keyById:Map<string,string>};
export function indexQuestions(questions:Question[]):QuestionIndex{
  const grouped=new Map<string,Question[]>();
  for(const q of questions){const fingerprint=JSON.stringify([q.article_id,q.question_type,q.question,q.full_context,Object.entries(q.options).sort(),[...q.correct_answer_raw].sort(),q.points]);const group=grouped.get(fingerprint)||[];group.push(q);grouped.set(fingerprint,group);}
  const groups=new Map<string,Question[]>(),keyById=new Map<string,string>();
  for(const group of grouped.values()){const key=group.map(q=>q.id).sort()[0];groups.set(key,group);for(const q of group)keyById.set(q.id,key);}
  return {groups,keyById};
}
function seeded(value:string){let hash=2166136261;for(const c of value){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0)/4294967296;}
export const PASSAGE_START_SECONDS=40;
export const EXTRA_REVIEW_MINUTES=10;

function baselineSeconds(q:Question){
  const byPart:Record<string,number>={'1':80,'2':105,'3':130,'':105};
  return byPart[questionPart(q)]+(q.points>1?25:0);
}

function median(values:number[]){
  const ordered=[...values].sort((a,b)=>a-b);
  return (ordered[Math.floor((ordered.length-1)/2)]+ordered[Math.floor(ordered.length/2)])/2;
}

function estimatePace(questions:Map<string,Question>,events:ReviewEvent[]){
  const samples=events.filter(event=>!event.learningCheck&&event.seconds>=15&&questions.has(event.questionId)).slice(-36).map(event=>({
    part:event.part,
    ratio:event.seconds/baselineSeconds(questions.get(event.questionId)!),
  }));
  const overall=samples.length>=3?median(samples.map(sample=>sample.ratio)):1;
  const pace:Record<string,number>={};
  for(const part of Object.keys(targets)){
    const ratios=samples.filter(sample=>sample.part===part).slice(-12).map(sample=>sample.ratio);
    pace[part]=ratios.length>=3?median(ratios):overall;
  }
  return pace;
}

type DailySelection=Pick<DailyPlan,'ids'|'due'|'independent'|'estimates'>;
function selectDailyQuestions(library:Library,progress:Progress,study:StudyState,day:string,budget:number,excluded:string[]=[]):DailySelection{
  const index=indexQuestions(library.questions);
  const excludedKeys=new Set(excluded.map(id=>index.keyById.get(id)));
  const byId=new Map(library.questions.map(q=>[q.id,q]));
  const order=new Map(library.questions.map((q,i)=>[q.id,i]));
  const pace=estimatePace(byId,study.events);
  const weekStart=shiftDay(day,-6);
  const spent:Record<string,number>={'1':0,'2':0,'3':0,'':0};
  for(const event of study.events){
    if(event.day>=weekStart&&event.day<=day&&!event.learningCheck)spent[event.part]+=event.seconds;
  }
  const weekSeconds=Object.values(spent).reduce((sum,seconds)=>sum+seconds,0);
  const candidates=[...index.groups].flatMap(([key,rows])=>{
    if(excludedKeys.has(key))return [];
    const card=study.cards[key];
    if(card&&card.dueDay>day)return [];
    const relevant=rows.some(row=>['答错','部分正确','未作答'].includes(row.status)||progress[row.id]?.origin==='rushed');
    if(!card&&!relevant)return [];
    const q=[...rows].sort((a,b)=>Number(!!b.review)-Number(!!a.review)||Number(progress[b.id]?.origin==='serious')-Number(progress[a.id]?.origin==='serious'))[0];
    const part=questionPart(q);
    const seconds=Math.round(Math.max(35,Math.min(420,baselineSeconds(q)*pace[part])));
    const overdue=card?Math.max(0,(Date.parse(day)-Date.parse(card.dueDay))/86400000):0;
    const newWrong=rows.some(row=>['答错','部分正确'].includes(row.status)&&progress[row.id]?.origin!=='rushed');
    const priority=card?1000+Math.min(30,overdue)*12+(card.lastOutcome==='again'?130:0):newWrong?(progress[q.id]?.state==='mastered'?45:90):20;
    return [{q,part,seconds,card,priority:priority+seeded(day+key)*25}];
  });
  const preferredArticles=Math.max(2,Math.ceil(budget/720));
  const selected:typeof candidates=[];
  const articles=new Set<string>();
  const partTime:Record<string,number>={'1':0,'2':0,'3':0,'':0};
  let used=0;
  while(candidates.length){
    const cost=(candidate:typeof candidates[number])=>candidate.seconds+(articles.has(candidate.q.article_id)?0:PASSAGE_START_SECONDS);
    const rank=(candidate:typeof candidates[number])=>{
      const partShare=(spent[candidate.part]+partTime[candidate.part])/(weekSeconds+used+1);
      const familiarArticle=articles.has(candidate.q.article_id);
      const articlePreference=familiarArticle?22:articles.size>=preferredArticles?-60:0;
      return candidate.priority+(targets[candidate.part]-partShare)*120+articlePreference;
    };
    candidates.sort((a,b)=>rank(b)-rank(a));
    const pick=candidates.findIndex(candidate=>used+cost(candidate)<=budget);
    if(pick<0)break;
    const [candidate]=candidates.splice(pick,1);
    used+=cost(candidate);
    articles.add(candidate.q.article_id);
    selected.push(candidate);
    partTime[candidate.part]+=candidate.seconds;
  }
  const ordered=[...articles].flatMap(article=>selected.filter(candidate=>candidate.q.article_id===article)
    .sort((a,b)=>order.get(a.q.id)!-order.get(b.q.id)!));
  return {
    ids:ordered.map(candidate=>candidate.q.id),
    due:ordered.filter(candidate=>candidate.card).map(candidate=>candidate.q.id),
    independent:ordered.filter(({q,card})=>isParagraphMatch(q)||!!card&&card.guidedPasses>=2&&card.lastOutcome!=='again').map(candidate=>candidate.q.id),
    estimates:Object.fromEntries(ordered.map(candidate=>[candidate.q.id,candidate.seconds])),
  };
}

export function buildDailyPlan(library:Library,progress:Progress,study:StudyState,now=Date.now()):DailyPlan{
  const day=studyDay(now,study.settings.timeZone);
  const existing=study.plans.find(plan=>plan.day===day);
  if(existing)return existing;
  const selection=selectDailyQuestions(library,progress,study,day,study.settings.minutes*60);
  return {day,...selection,completed:[],skipped:[],responses:{},minutes:study.settings.minutes,createdAt:now,updatedAt:now};
}

export function addReviewRound(library:Library,progress:Progress,study:StudyState,plan:DailyPlan):DailyPlan|null{
  if(!plan.ids.length||plan.ids.some(id=>!plan.completed.includes(id)))return null;
  const extra=selectDailyQuestions(library,progress,study,plan.day,EXTRA_REVIEW_MINUTES*60,plan.ids);
  if(!extra.ids.length)return null;
  return {
    ...plan,
    ids:[...plan.ids,...extra.ids],
    due:[...plan.due,...extra.due],
    independent:[...plan.independent,...extra.independent],
    estimates:{...plan.estimates,...extra.estimates},
  };
}
export function savePlan(study:StudyState,plan:DailyPlan):StudyState{return {...study,plans:[...study.plans.filter(p=>p.day!==plan.day),plan].slice(-60),updatedAt:plan.updatedAt};}
export function completePlan(study:StudyState,day:string,id:string,skip=false,now=Date.now()):StudyState{
  const plan=study.plans.find(p=>p.day===day);if(!plan||!plan.ids.includes(id))return study;
  return savePlan(study,{...plan,completed:skip?plan.completed:[...new Set([...plan.completed,id])],skipped:skip?[...new Set([...plan.skipped,id])]:plan.skipped.filter(x=>x!==id),updatedAt:now});
}
export function recordReview(study:StudyState,library:Library,input:Omit<ReviewEvent,'day'|'part'|'key'|'learningCheck'>):StudyState{
  const existing=study.events.find(event=>event.id===input.id);
  if(existing){
    // A wrong answer is scheduled at submission. Finishing the explanation only updates its elapsed time.
    if(existing.questionId!==input.questionId||input.seconds<=existing.seconds)return study;
    return {...study,events:study.events.map(event=>event===existing?{...event,seconds:Math.min(1800,input.seconds)}:event),updatedAt:Math.max(study.updatedAt,input.at)};
  }
  const q=library.questions.find(q=>q.id===input.questionId);if(!q)return study;
  const key=indexQuestions(library.questions).keyById.get(q.id)!,old=study.cards[key],day=studyDay(input.at,study.settings.timeZone),sameDay=old?.lastDay===day;
  const event:ReviewEvent={...input,seconds:Math.max(0,Math.min(1800,input.seconds)),key,day,part:questionPart(q),learningCheck:sameDay};
  const card:Card=old?{...old.memory,due:new Date(old.memory.due),last_review:old.memory.last_review?new Date(old.memory.last_review):undefined}:createEmptyCard(new Date(input.at));
  const rating=input.outcome==='good'?Rating.Good:input.outcome==='hard'?Rating.Hard:Rating.Again;
  const reviewed=scheduler.repeat(card,new Date(input.at))[rating].card;
  let days=Math.max(1,Math.round(reviewed.scheduled_days));if(input.outcome==='again')days=1;
  if(!old&&input.outcome==='hard')days=Math.min(2,days);
  const memory:SavedCard={...reviewed,due:input.at+days*86400000,last_review:reviewed.last_review?.getTime()};
  let next:StudyCard={memory,dueDay:shiftDay(day,days),lastDay:day,lastOutcome:input.outcome,guidedPasses:(old?.guidedPasses||0)+(input.outcome==='good'&&input.mode==='guided'?1:0),independentPasses:(old?.independentPasses||0)+(input.outcome==='good'&&input.mode==='independent'?1:0)};
  // A same-day retry can expose a weakness, but cannot grow long-term stability.
  if(sameDay){next={...old,lastOutcome:input.outcome==='again'?'again':old.lastOutcome};if(input.outcome==='again')next={...next,dueDay:shiftDay(day,1),memory:{...old.memory,due:input.at+86400000}};}
  return {...study,cards:{...study.cards,[key]:next},events:[...study.events,event],updatedAt:input.at};
}
export function validateStudy(value:unknown,ids:Set<string>):StudyState{
  if(!value||typeof value!=='object')throw new Error('学习计划格式不正确');const s=value as StudyState;
  const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  const date=(d:unknown)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d));
  const validId=(id:unknown)=>typeof id==='string'&&ids.has(id);
  if(s.format!=='reading-desk-study-v1'||!s.settings||!Number.isInteger(s.settings.minutes)||s.settings.minutes<10||s.settings.minutes>90||typeof s.settings.timeZone!=='string'||!finite(s.updatedAt))throw new Error('学习设置不正确');
  try{studyDay(0,s.settings.timeZone);}catch{throw new Error('学习时区不正确');}
  if(!s.cards||typeof s.cards!=='object'||Array.isArray(s.cards)||Object.keys(s.cards).length>ids.size||!Array.isArray(s.events)||s.events.length>50000||!Array.isArray(s.plans)||s.plans.length>60)throw new Error('学习记录格式不正确');
  for(const [key,c] of Object.entries(s.cards)){
    if(!validId(key)||!c||!date(c.dueDay)||!date(c.lastDay)||!outcomes.includes(c.lastOutcome)||!Number.isInteger(c.guidedPasses)||c.guidedPasses<0||!Number.isInteger(c.independentPasses)||c.independentPasses<0||!c.memory)throw new Error('复习间隔记录不正确');
    for(const field of ['due','stability','difficulty','elapsed_days','scheduled_days','reps','lapses','state','learning_steps'] as const)if(!finite(c.memory[field]))throw new Error('复习算法状态不正确');
    if(![0,1,2,3].includes(c.memory.state)||c.memory.last_review!==undefined&&!finite(c.memory.last_review))throw new Error('复习算法时间不正确');
  }
  const eventIds=new Set<string>();for(const e of s.events){if(!e||typeof e.id!=='string'||e.id.length>100||eventIds.has(e.id)||!validId(e.questionId)||!validId(e.key)||!finite(e.at)||!date(e.day)||!outcomes.includes(e.outcome)||!['guided','independent'].includes(e.mode)||!finite(e.seconds)||e.seconds>1800||!['','1','2','3'].includes(e.part)||typeof e.learningCheck!=='boolean')throw new Error('复习日志不正确');eventIds.add(e.id);}
  const days=new Set<string>();for(const p of s.plans){
    if(!p||!date(p.day)||days.has(p.day)||![p.createdAt,p.updatedAt].every(finite)||!Number.isInteger(p.minutes)||p.minutes<10||p.minutes>90||!p.estimates||typeof p.estimates!=='object'||!p.responses||typeof p.responses!=='object')throw new Error('每日计划不正确');days.add(p.day);
    for(const field of ['ids','due','completed','skipped','independent'] as const)if(!Array.isArray(p[field])||p[field].length>ids.size||!p[field].every(validId)||new Set(p[field]).size!==p[field].length)throw new Error('每日题目不正确');
    if([...p.completed,...p.skipped,...p.independent,...p.due].some(id=>!p.ids.includes(id))||p.ids.some(id=>!finite(p.estimates[id])||p.estimates[id]>1800))throw new Error('每日进度不正确');
    for(const [id,r] of Object.entries(p.responses))if(!p.ids.includes(id)||!r||typeof r.eventId!=='string'||r.eventId.length>100||!finite(r.at)||!Array.isArray(r.answer)||r.answer.length>10||r.answer.some(a=>typeof a!=='string'||a.length>256)||!['correct','wrong','partial','revealed'].includes(r.result)||!['guided','independent'].includes(r.mode)||!finite(r.seconds)||r.seconds>1800||typeof r.revealed!=='boolean'||typeof r.helped!=='boolean')throw new Error('题组作答记录不正确');
  }
  return JSON.parse(JSON.stringify(s));
}
