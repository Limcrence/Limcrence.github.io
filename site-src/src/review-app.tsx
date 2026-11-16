import {Practice} from './practice';
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { BookOpen, ArrowLeft, ArrowRight, Check, Search, MoreHorizontal, Download, Upload, X, GripVertical, ExternalLink, MapPin, RotateCcw, LoaderCircle, List, Cloud, FileText, CheckCircle2, LockKeyhole } from "lucide-react";
import { applyOperation, freshRecord, mergeProgress, passagePart, PROGRESS_KEY, validateRecords } from "./lib/progress";
import { displayNumber, gradeAnswer, originalAnswer, shortSource } from "./lib/grading";
import type { Article, Library, Origin, Progress, Question, ReviewRecord, SaveOperation } from "./lib/types";
import {CloudSync} from './cloud-sync';
import type {SyncIdentity} from './lib/sync-crypto';
import type {SyncEngine} from './lib/sync-engine';
import {makeSnapshot,validateSnapshot,type ProgressSnapshot,type ReadingSession} from './lib/snapshot';
import {DailyDashboard} from './daily-dashboard';
import {STUDY_KEY,createStudy,validateStudy,buildDailyPlan,savePlan,completePlan,recordReview,studyDay,paragraphHints,paragraphDescription,isParagraphMatch,needsGroupSubmission,type StudyState,type DailyPlan,type AttemptFeedback,type Outcome} from './lib/study';

let library:Library;
let questions:Question[]=[];
let byId=new Map<string,Question>();
let articleMap=new Map<string,Article>();
const originalWrong = (q:Question) => ["答错","部分正确"].includes(q.status);
let wrong:Question[]=[];
let blank:Question[]=[];
let types:string[]=[];
export function initializeLibrary(value:Library){
  if(!Array.isArray(value.questions)||value.questions.length!==656||value.exercises.length!==50)throw new Error('题库校验失败');
  library=value;questions=value.questions;byId=new Map(questions.map(q=>[q.id,q]));articleMap=new Map(library.articles.map(a=>[a.id,a]));
  wrong=questions.filter(originalWrong);blank=questions.filter(q=>q.status==='未作答');types=[...new Set(questions.map(q=>q.question_type))];
}
type Tab = "learning" | "mastered" | "blank" | "all";
type Session = ReadingSession;

function Button({children,className="",...props}:React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}>{children}</button>;
}

function MarkedText({text,needles,enabled}:{text:string;needles:string[];enabled:boolean}) {
  if(!enabled)return <>{text}</>;
  const ranges:{start:number;end:number}[]=[];
  for(const needle of needles.filter(Boolean)){
    let pos=text.indexOf(needle);
    while(pos>=0){ranges.push({start:pos,end:pos+needle.length});pos=text.indexOf(needle,pos+needle.length);}
  }
  ranges.sort((a,b)=>a.start-b.start);
  const merged:typeof ranges=[];
  for(const r of ranges){const last=merged.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({...r});}
  const parts:ReactNode[]=[];let from=0;
  for(const r of merged){parts.push(text.slice(from,r.start),<mark key={r.start}>{text.slice(r.start,r.end)}</mark>);from=r.end;}
  parts.push(text.slice(from));return <>{parts}</>;
}

function QuestionText({text}:{text:string}) {
  return <>{text.split(/(\[本题____\])/).map((part,i)=>part==="[本题____]"?<span className="target-blank" key={i}>本题空格</span>:<span key={i}>{part}</span>)}</>;
}

export default function ReviewApp({lock,syncIdentity}:{lock:()=>void;syncIdentity:SyncIdentity}){
  const [progress,setProgress]=useState<Progress>({});
  const [ready,setReady]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const [loadError,setLoadError]=useState(false);
  const [source,setSource]=useState("all");
  const [sourceName,setSourceName]=useState("all");
  const [type,setType]=useState("all");
  const [part,setPart]=useState("all");
  const [origin,setOrigin]=useState("all");
  const [search,setSearch]=useState("");
  const [tab,setTab]=useState<Tab>("learning");
  const [session,setSession]=useState<Session|null>(null);
  const [lastSession,setLastSession]=useState<Session|null>(null);
  const [fontSize,setFontSize]=useState(17);
  const [toast,setToast]=useState("");
  const [view,setView]=useState<'today'|'library'>('today');
  const [study,setStudy]=useState<StudyState>(()=>createStudy());
  const [clock,setClock]=useState(Date.now());
  const progressRef=useRef<Progress>({});
  const studyRef=useRef<StudyState>(study);
  const positionRef=useRef<ReadingSession|null>(null);
  const engineRef=useRef<SyncEngine|null>(null);
  const toolsRef=useRef<HTMLDetailsElement>(null);
  const importRef=useRef<HTMLInputElement>(null);
  const persist=useCallback((next:Progress,notify=true)=>{
    progressRef.current=next;setProgress(next);
    try{localStorage.setItem(PROGRESS_KEY,JSON.stringify({format:'reading-desk-progress-v1',records:Object.values(next)}));setSaveError(false);}catch{setSaveError(true);}
    if(notify)engineRef.current?.localChanged();
  },[]);
  const persistStudy=useCallback((next:StudyState,notify=true)=>{
    try{localStorage.setItem(STUDY_KEY,JSON.stringify(next));studyRef.current=next;setStudy(next);setSaveError(false);if(notify)engineRef.current?.localChanged();return true;}
    catch{setSaveError(true);setToast('学习计划未能保存，请导出备份后重试');return false;}
  },[]);
  const getSnapshot=useCallback(()=>makeSnapshot(progressRef.current,positionRef.current,studyRef.current),[]);
  const applyCloud=useCallback((value:ProgressSnapshot)=>{
    // Save first; a failed local write must not acknowledge a cloud replacement.
    localStorage.setItem(PROGRESS_KEY,JSON.stringify({format:'reading-desk-progress-v1',records:value.records}));
    localStorage.setItem('reading-desk-session',JSON.stringify(value.session));
    const nextStudy=value.study||{...createStudy(studyRef.current.settings.timeZone),settings:studyRef.current.settings};
    localStorage.setItem(STUDY_KEY,JSON.stringify(nextStudy));studyRef.current=nextStudy;setStudy(nextStudy);
    positionRef.current=value.session;persist(Object.fromEntries(value.records.map(r=>[r.questionId,r])),false);setLastSession(value.session);setSession(value.session);
    if(!value.session)history.replaceState(null,'',location.pathname);
  },[persist]);
  const validateCloud=useCallback((value:unknown)=>validateSnapshot(value,new Set(byId.keys())),[]);
  useEffect(()=>{
    try{
      const saved=localStorage.getItem(PROGRESS_KEY);
      if(saved){const parsed=JSON.parse(saved);if(parsed.format!=='reading-desk-progress-v1')throw new Error('format');const records=validateRecords(parsed.records,new Set(byId.keys()));progressRef.current=Object.fromEntries(records.map(r=>[r.questionId,r]));setProgress(progressRef.current);}
      const savedStudy=localStorage.getItem(STUDY_KEY);if(savedStudy){const next=validateStudy(JSON.parse(savedStudy),new Set(byId.keys()));studyRef.current=next;setStudy(next);}
    }catch{setLoadError(true);}
    setReady(true);
    try{
      const last=JSON.parse(localStorage.getItem("reading-desk-session")||"null");
      if(last?.ids?.length&&last.ids.every((id:string)=>byId.has(id))&&last.index>=0&&last.index<last.ids.length){setLastSession(last);positionRef.current=last;}
      const size=Number(localStorage.getItem("reading-desk-font"));if(size>=15&&size<=22)setFontSize(size);
      const id=new URLSearchParams(location.hash.slice(1)).get("q");const q=id?byId.get(id):null;
      if(q){
        if(last?.ids?.includes(q.id)&&last.ids.every((qid:string)=>byId.has(qid)))setSession({...last,index:last.ids.indexOf(q.id)});
        else{const group=questions.filter(x=>x.exercise_id===q.exercise_id&&(originalWrong(q)?originalWrong(x):q.status==="未作答"?x.status==="未作答":true));setSession({ids:group.map(x=>x.id),index:group.findIndex(x=>x.id===q.id)});}
      }
    }catch{}
    const onStorage=(e:StorageEvent)=>{if(!e.newValue)return;try{if(e.key===STUDY_KEY){const next=validateStudy(JSON.parse(e.newValue),new Set(byId.keys()));studyRef.current=next;setStudy(next);}else if(e.key===PROGRESS_KEY){const records=validateRecords(JSON.parse(e.newValue).records,new Set(byId.keys()));progressRef.current=Object.fromEntries(records.map(r=>[r.questionId,r]));setProgress(progressRef.current);}else return;engineRef.current?.localChanged();}catch{setLoadError(true);}};
    window.addEventListener('storage',onStorage);return()=>window.removeEventListener('storage',onStorage);
  },[]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!session)return;
    try{localStorage.setItem("reading-desk-session",JSON.stringify(session));positionRef.current=session;setLastSession(session);history.replaceState(null,"",`#q=${encodeURIComponent(session.ids[session.index])}`);engineRef.current?.localChanged();}catch{}
  },[session]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(""),3500);return()=>clearTimeout(timer);},[toast]);
  const update=useCallback((op:SaveOperation,_debounced=false)=>{if(loadError){setToast('原进度未能读取，请先导出备份或导入有效进度');return;}persist(applyOperation(progressRef.current,op));},[persist,loadError]);
  const markRemainder=(question:Question,value:Origin)=>{
    if(loadError){setToast('原进度未能读取，请先导出原始备份并导入有效进度');return;}
    let next=progressRef.current;
    const index=questions.findIndex(q=>q.id===question.id);
    const remainder=questions.filter((q,i)=>q.exercise_id===question.exercise_id&&i>=index);
    for(const q of remainder)next=applyOperation(next,{questionId:q.id,op:'origin',value});
    persist(next);setToast(`已将本题至本篇末尾的 ${remainder.length} 题标为赶时间蒙答，前面的题保持原样`);
  };

  const masteredCount=wrong.filter(q=>progress[q.id]?.state==="mastered").length;
  const matches=useMemo(()=>questions.filter(q=>{
    if(tab==="learning"&&(!originalWrong(q)||progress[q.id]?.state==="mastered"))return false;
    if(tab==="mastered"&&progress[q.id]?.state!=="mastered")return false;
    if(tab==="blank"&&(q.status!=="未作答"||progress[q.id]?.state==="mastered"))return false;
    if(source!=="all"&&q.source_type!==source)return false;
    if(sourceName!=="all"&&q.source_name!==sourceName)return false;
    if(type!=="all"&&q.question_type!==type)return false;
    if(part!=="all"&&passagePart(q.passage_code)!==part)return false;
    if(origin!=="all"&&(progress[q.id]?.origin||"unknown")!==origin)return false;
    const haystack=[q.source_name,q.assignment_group,q.passage_code,q.passage_title,q.question,q.question_type].join(" ").toLowerCase();
    return !search||haystack.includes(search.toLowerCase().trim());
  }),[tab,progress,source,sourceName,type,part,origin,search]);
  const exercises=library.exercises.filter(e=>matches.some(q=>q.exercise_id===e.id));
  const start=(list:Question[],id?:string)=>{if(!list.length)return;let next=progressRef.current;for(const q of list)next=applyOperation(next,{questionId:q.id,op:'draft',value:[]});persist(next);setSession({ids:list.map(q=>q.id),index:id?Math.max(0,list.findIndex(q=>q.id===id)):0});};
  const back=()=>{setSession(null);try{history.replaceState(null,"",location.pathname);}catch{}};
  const plan=useMemo(()=>ready?buildDailyPlan(library,progress,study,clock):null,[ready,progress,study,clock]);
  function startDaily(){
    if(!plan||!ready||loadError)return;
    const existing=studyRef.current.plans.find(p=>p.day===plan.day),nextPlan={...plan,skipped:[],updatedAt:Date.now()};
    if(!persistStudy(savePlan(studyRef.current,nextPlan)))return;
    const first=plan.ids.findIndex(id=>!plan.completed.includes(id));if(first<0)return;
    if(!existing){let next=progressRef.current;for(const id of plan.ids)next=applyOperation(next,{questionId:id,op:'draft',value:[]});persist(next);}
    setView('today');setSession({ids:plan.ids,index:first,kind:'daily',day:plan.day});
  }
  function submitted(rows:{q:Question;feedback:AttemptFeedback}[],day?:string){
    if(loadError)return false;let next=progressRef.current,nextStudy=studyRef.current;
    for(const {q,feedback} of rows){next=applyOperation(next,{questionId:q.id,op:'attempt',value:{answer:feedback.answer,result:feedback.result}});if(feedback.result!=='correct'||feedback.helped)nextStudy=recordReview(nextStudy,library,{id:feedback.eventId,questionId:q.id,at:feedback.at,outcome:'again',mode:feedback.mode,seconds:feedback.seconds});}
    if(day){const p=nextStudy.plans.find(p=>p.day===day);if(p)nextStudy=savePlan(nextStudy,{...p,responses:{...p.responses,...Object.fromEntries(rows.map(r=>[r.q.id,r.feedback]))},updatedAt:Date.now()});}
    if(!persistStudy(nextStudy))return false;persist(next);return true;
  }
  function reviewed(q:Question,feedback:AttemptFeedback,outcome:Outcome,day?:string){
    if(loadError)return false;
    const actual=feedback.result!=='correct'||feedback.helped?'again':outcome;
    let next=recordReview(studyRef.current,library,{id:feedback.eventId,questionId:q.id,at:feedback.at,outcome:actual,mode:feedback.mode,seconds:feedback.seconds});
    if(day)next=completePlan(next,day,q.id);return persistStudy(next);
  }
  function skipDaily(id:string,day:string){return persistStudy(completePlan(studyRef.current,day,id,true));}
  function redoQuestion(id:string,day?:string){
    if(!day)return true;const p=studyRef.current.plans.find(p=>p.day===day);if(!p)return false;
    const responses={...p.responses};delete responses[id];
    return persistStudy(savePlan(studyRef.current,{...p,responses,completed:p.completed.filter(x=>x!==id),updatedAt:Date.now()}));
  }

  async function importBackup(file:File){
    if(file.size>12_000_000){setToast('备份文件太大，请选择导出的进度文件');return;}
    try{
      const data=JSON.parse(await file.text());if(!['reading-desk-progress-v1','reading-desk-snapshot-v1','reading-desk-snapshot-v2'].includes(data.format))throw new Error('备份格式不正确');
      const snapshot=data.format==='reading-desk-progress-v1'?null:validateSnapshot(data,new Set(byId.keys()));
      const records=snapshot?.records||validateRecords(data.records,new Set(byId.keys()));
      if(loadError){exportBackup();setLoadError(false);}
      if(snapshot?.study&&snapshot.study.updatedAt>=studyRef.current.updatedAt){exportBackup();if(!persistStudy(snapshot.study))return;}
      persist(mergeProgress(progressRef.current,records));setToast(`已合并 ${records.length} 条进度，较新的记录和学习计划优先`);
    }catch(error){setToast(error instanceof Error?error.message:'导入失败，现有进度未改变');}
  }
  function exportBackup(){
    const data={...getSnapshot(),exportedAt:new Date().toISOString()};
    const contents=loadError?(localStorage.getItem(PROGRESS_KEY)||'{}'):JSON.stringify(data,null,2);
    const url=URL.createObjectURL(new Blob([contents],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`阅读错题本-复习进度-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toolsRef.current?.removeAttribute("open");
  }
  const syncStatus=<span className={`sync-status ${saveError||loadError?'sync-error':''}`} role="status">{saveError?<button onClick={()=>persist(progressRef.current)}>保存失败 · 重试或导出</button>:loadError?<span>原进度读取失败，请勿清除浏览器数据</span>:<><Check size={14}/>已保存在此设备</>}</span>;

  return <div className={`app-shell ${session?"is-practicing":""}`}>
    <header className="app-header">
      <button className="brand" onClick={()=>{back();setView('today');}} aria-label="返回今日计划"><span className="brand-icon"><BookOpen size={21} strokeWidth={1.7}/></span><span>阅读错题本<small>READING DESK</small></span></button>
      <div className="header-middle">{session?<button className="back-link" onClick={back}><ArrowLeft size={16}/>{session.kind==='daily'?'今日计划':'练习库'}</button>:<nav className="main-nav"><button className={view==='today'?'active':''} onClick={()=>setView('today')}>今日计划</button><button className={view==='library'?'active':''} onClick={()=>setView('library')}>练习库</button></nav>}</div>
      <div className="header-actions">{syncStatus}<CloudSync identity={syncIdentity} ready={ready&&!loadError} engineRef={engineRef} getSnapshot={getSnapshot} applySnapshot={applyCloud} validate={validateCloud}/><details className="tools-menu" ref={toolsRef}><summary className="icon-button" aria-label="更多操作"><MoreHorizontal size={21}/></summary><div className="dropdown"><a href="/">返回个人空间</a><button onClick={lock}><LockKeyhole size={16}/>锁定复习空间</button><p>点右上角“云端同步”，选好版本后自动保存到云端。导出文件也可作为独立备份。</p><button onClick={exportBackup} disabled={!ready}><Download size={16}/>导出复习进度</button><button onClick={()=>{importRef.current?.click();toolsRef.current?.removeAttribute("open");}} disabled={!ready}><Upload size={16}/>导入复习进度</button></div></details><input ref={importRef} type="file" accept=".json,application/json" className="visually-hidden" onChange={e=>{if(e.target.files?.[0])void importBackup(e.target.files[0]);e.target.value="";}}/></div>
    </header>

    {session?<Practice library={library} onRedo={redoQuestion} markRemainder={markRemainder} key={`${session.day||'free'}:${session.ids.join(',')}`} session={session} setSession={setSession} progress={progress} update={update} fontSize={fontSize} changeFont={n=>{setFontSize(n);try{localStorage.setItem("reading-desk-font",String(n));}catch{}}} back={back} ready={ready&&!loadError} dailyPlan={study.plans.find(p=>p.day===session.day)} onSubmitted={submitted} onReviewed={reviewed} onSkip={skipDaily}/>:view==='today'?plan?<DailyDashboard library={library} progress={progress} study={study} plan={plan} ready={ready&&!loadError} onStart={startDaily} onLibrary={()=>setView('library')} onMinutes={minutes=>persistStudy({...studyRef.current,settings:{...studyRef.current.settings,minutes},updatedAt:Date.now()})}/>:<main className="daily-main">正在准备今日计划…</main>:<div className="library-layout">
      <aside className="sidebar"><div className="sidebar-top"><p className="eyebrow">我的练习</p>{[["all","全部练习",BookOpen],["周测","每周周测",FileText],["专项练习","题型专项",List],["真题汇总","考场真题",BookOpen]].map(([value,label,Icon])=>{const IconComponent=Icon as typeof BookOpen;return <button key={String(value)} className={`sidebar-link ${source===value?"active":""}`} onClick={()=>{setSource(String(value));setSourceName("all");}}><IconComponent size={18}/><span>{String(label)}</span><small>{library.exercises.filter(e=>value==="all"||e.source_type===value).length}</small></button>;})}</div><div className="sidebar-bottom"><span className="quiet-label">复习进度</span><div className="mastery-number">{masteredCount}<span> / {wrong.length} 题已掌握</span></div><div className="progress-track"><i style={{width:`${masteredCount/wrong.length*100}%`}}/></div><p>学会一道，就少一道。</p><span className="data-date">题库整理于 2026.11.08</span></div></aside>
      <main className="library-main">
        <nav className="mobile-sources" aria-label="按来源筛选">{[['all','全部'],['周测','周测'],['专项练习','专项练习'],['真题汇总','真题汇总']].map(([value,label])=><button key={value} className={source===value?'active':''} onClick={()=>{setSource(value);setSourceName('all');}}>{label}</button>)}</nav>
        <div className="page-heading"><div><p className="eyebrow">YOUR READING PRACTICE</p><h1>继续，把错题弄明白。</h1><p className="page-intro">先重做，再看解析。认真做错和赶时间蒙答，可以分开复习。</p></div><Button className="primary start-all" disabled={!ready||matches.length===0} onClick={()=>start(matches)}><BookOpen size={17}/>开始复习<ArrowRight size={17}/></Button></div>
        <section className="overview-strip" aria-label="错题统计"><div><strong>{wrong.length}</strong><span>错题与部分正确题组</span></div><div><strong>{blank.length}</strong><span>原练习中的未作答题</span></div><div><strong>{library.exercises.length}</strong><span>已完成的练习篇目</span></div><div className="overview-tip"><span className="tiny-leaf">↗</span><p>先重做，再看解析。<small>做对后，可标记为已掌握。</small></p></div></section>
        {lastSession&&<button className="resume-strip" disabled={!ready} onClick={()=>setSession(lastSession)}><span className="resume-icon"><RotateCcw size={17}/></span><span>继续上次练习<small>{shortSource(byId.get(lastSession.ids[lastSession.index])!)} · {byId.get(lastSession.ids[lastSession.index])!.passage_code}</small></span><ArrowRight size={18}/></button>}
        <div className="library-toolbar"><div className="tabs" role="tablist" aria-label="题目范围">{[["learning","待复习",wrong.length-masteredCount],["mastered","已掌握",Object.values(progress).filter(r=>r.state==="mastered").length],["blank","补做漏题",blank.filter(q=>progress[q.id]?.state!=="mastered").length],["all","全部题目",questions.length]].map(([value,label,count])=><button key={value} role="tab" aria-selected={tab===value} className={tab===value?"active":""} onClick={()=>setTab(value as Tab)}>{label}<span>{count}</span></button>)}</div></div>
        <div className="filter-row"><label className="search-field"><Search size={17}/><input aria-label="搜索练习或题目" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索篇名、练习编号或题目…"/>{search&&<button onClick={()=>setSearch("")} aria-label="清空搜索"><X size={15}/></button>}</label><select aria-label="按练习筛选" value={sourceName} onChange={e=>setSourceName(e.target.value)}><option value="all">所有练习分组</option>{[...new Set(library.exercises.filter(e=>source==="all"||e.source_type===source).map(e=>e.source_name))].map(s=><option key={s} value={s}>{s.replace("26-27学年雅思阅读教材（Vivian）","教材专项练习")}</option>)}</select><select aria-label="按题型筛选" value={type} onChange={e=>setType(e.target.value)}><option value="all">所有题型</option>{types.map(t=><option key={t}>{t}</option>)}</select><select aria-label="按文章部分筛选" value={part} onChange={e=>setPart(e.target.value)}><option value="all">P1 / P2 / P3 全部</option>{['1','2','3'].map(p=><option key={p} value={p}>只看 P{p}</option>)}</select><select aria-label="按原作答情况筛选" value={origin} onChange={e=>setOrigin(e.target.value)}><option value="all">所有作答情况</option><option value="serious">认真作答</option><option value="rushed">赶时间蒙答</option><option value="unknown">尚未标记</option></select></div>
        <p className="origin-help">P3 的错题都保留。进入题目后，可标记当时是认真作答还是赶时间蒙答。</p>
        <div className="list-heading"><span>{source==="all"?"全部练习":source} <b>{exercises.length}</b></span><small>{matches.length} 道题 · 最近周测优先</small></div>
        <div className="exercise-list">{exercises.map(e=>{
          const qs=matches.filter(q=>q.exercise_id===e.id);const allWrong=wrong.filter(q=>q.exercise_id===e.id);const done=allWrong.filter(q=>progress[q.id]?.state==="mastered").length;
          return <article className="exercise-row" key={e.id}><div className="exercise-symbol"><FileText size={21} strokeWidth={1.5}/></div><div className="exercise-info"><div className="exercise-meta"><span>{shortSource(e)}</span><span>{e.passage_code}</span></div><h2>{e.title}</h2><p>{[...new Set(qs.map(q=>q.question_type))].join(" · ")}</p></div><div className="exercise-status"><strong>{qs.length}<small> 题</small></strong><span>{done>0?`已掌握 ${done}/${allWrong.length}`:`原得分 ${e.website_score}/${e.website_total}`}</span></div><Button className="row-start" disabled={!ready} onClick={()=>start(qs)}>去练习<ArrowRight size={16}/></Button></article>;
        })}</div>
        {!exercises.length&&<div className="empty-state"><CheckCircle2 size={35}/><h2>{tab==="mastered"?"学会后，在这里找到它们。":"这个筛选下没有待练习的题目。"}</h2><p>可以切换题型或练习分组，继续下一道。</p><Button onClick={()=>{setSearch("");setSource("all");setSourceName("all");setType("all");setPart("all");setOrigin("all");setTab("learning");}}>查看待复习错题</Button></div>}
        <footer className="library-footnote">共 50 篇已完成练习；未开始的练习不在题库中。正确答案来自原网站，错题定位与解析由 AI 整理。</footer>
      </main>
    </div>}
    {toast&&<div className="toast" role="status">{toast}</div>}
  </div>;
}
