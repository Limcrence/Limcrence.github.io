"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { BookOpen, ArrowLeft, ArrowRight, Check, Search, MoreHorizontal, Download, Upload, X, GripVertical, ExternalLink, MapPin, RotateCcw, LoaderCircle, List, Cloud, FileText, CheckCircle2, LockKeyhole } from "lucide-react";
import { applyOperation, freshRecord, mergeProgress, passagePart, PROGRESS_KEY, validateRecords } from "./lib/progress";
import { displayNumber, gradeAnswer, originalAnswer, shortSource } from "./lib/grading";
import type { Article, Library, Origin, Progress, Question, ReviewRecord, SaveOperation } from "./lib/types";

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
type Session = {ids:string[];index:number};

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

export default function ReviewApp({lock}:{lock:()=>void}){
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
  const progressRef=useRef<Progress>({});
  const toolsRef=useRef<HTMLDetailsElement>(null);
  const importRef=useRef<HTMLInputElement>(null);
  const persist=useCallback((next:Progress)=>{
    progressRef.current=next;setProgress(next);
    try{localStorage.setItem(PROGRESS_KEY,JSON.stringify({format:'reading-desk-progress-v1',records:Object.values(next)}));setSaveError(false);}catch{setSaveError(true);}
  },[]);
  useEffect(()=>{
    try{
      const saved=localStorage.getItem(PROGRESS_KEY);
      if(saved){const parsed=JSON.parse(saved);if(parsed.format!=='reading-desk-progress-v1')throw new Error('format');const records=validateRecords(parsed.records,new Set(byId.keys()));progressRef.current=Object.fromEntries(records.map(r=>[r.questionId,r]));setProgress(progressRef.current);}
    }catch{setLoadError(true);}
    setReady(true);
    try{
      const last=JSON.parse(localStorage.getItem("reading-desk-session")||"null");
      if(last?.ids?.length&&last.ids.every((id:string)=>byId.has(id))&&last.index>=0&&last.index<last.ids.length)setLastSession(last);
      const size=Number(localStorage.getItem("reading-desk-font"));if(size>=15&&size<=22)setFontSize(size);
      const id=new URLSearchParams(location.hash.slice(1)).get("q");const q=id?byId.get(id):null;
      if(q){
        if(last?.ids?.includes(q.id)&&last.ids.every((qid:string)=>byId.has(qid)))setSession({ids:last.ids,index:last.ids.indexOf(q.id)});
        else{const group=questions.filter(x=>x.exercise_id===q.exercise_id&&(originalWrong(q)?originalWrong(x):q.status==="未作答"?x.status==="未作答":true));setSession({ids:group.map(x=>x.id),index:group.findIndex(x=>x.id===q.id)});}
      }
    }catch{}
    const onStorage=(e:StorageEvent)=>{if(e.key!==PROGRESS_KEY||!e.newValue)return;try{const records=validateRecords(JSON.parse(e.newValue).records,new Set(byId.keys()));const next=mergeProgress(progressRef.current,records);progressRef.current=next;setProgress(next);}catch{}};
    window.addEventListener('storage',onStorage);return()=>window.removeEventListener('storage',onStorage);
  },[]);
  useEffect(()=>{
    if(!session)return;
    try{localStorage.setItem("reading-desk-session",JSON.stringify(session));setLastSession(session);history.replaceState(null,"",`#q=${encodeURIComponent(session.ids[session.index])}`);}catch{}
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
  const start=(list:Question[],id?:string)=>{if(!list.length)return;setSession({ids:list.map(q=>q.id),index:id?Math.max(0,list.findIndex(q=>q.id===id)):0});};
  const back=()=>{setSession(null);try{history.replaceState(null,"",location.pathname);}catch{}};

  async function importBackup(file:File){
    if(file.size>12_000_000){setToast('备份文件太大，请选择导出的进度文件');return;}
    try{
      const data=JSON.parse(await file.text());if(data.format!=='reading-desk-progress-v1')throw new Error('备份格式不正确');
      const records=validateRecords(data.records,new Set(byId.keys()));
      if(loadError){exportBackup();setLoadError(false);}
      persist(mergeProgress(progressRef.current,records));setToast(`已合并 ${records.length} 条进度，较新的记录优先`);
    }catch(error){setToast(error instanceof Error?error.message:'导入失败，现有进度未改变');}
  }
  function exportBackup(){
    const data={format:"reading-desk-progress-v1",exportedAt:new Date().toISOString(),records:Object.values(progress)};
    const contents=loadError?(localStorage.getItem(PROGRESS_KEY)||'{}'):JSON.stringify(data,null,2);
    const url=URL.createObjectURL(new Blob([contents],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`阅读错题本-复习进度-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toolsRef.current?.removeAttribute("open");
  }
  const syncStatus=<span className={`sync-status ${saveError||loadError?'sync-error':''}`} role="status">{saveError?<button onClick={()=>persist(progressRef.current)}>保存失败 · 重试或导出</button>:loadError?<span>原进度读取失败，请勿清除浏览器数据</span>:<><Check size={14}/>已保存在此设备</>}</span>;

  return <div className={`app-shell ${session?"is-practicing":""}`}>
    <header className="app-header">
      <button className="brand" onClick={back} aria-label="返回练习库"><span className="brand-icon"><BookOpen size={21} strokeWidth={1.7}/></span><span>阅读错题本<small>READING DESK</small></span></button>
      <div className="header-middle">{session?<button className="back-link" onClick={back}><ArrowLeft size={16}/>练习库</button>:<span>原文、题目和解析，一起复习</span>}</div>
      <div className="header-actions">{syncStatus}<details className="tools-menu" ref={toolsRef}><summary className="icon-button" aria-label="更多操作"><MoreHorizontal size={21}/></summary><div className="dropdown"><a href="/">返回个人空间</a><button onClick={lock}><LockKeyhole size={16}/>锁定复习空间</button><p>换设备复习时，先导出再导入。<br/>不同设备不会自动同步。</p><button onClick={exportBackup} disabled={!ready}><Download size={16}/>导出复习进度</button><button onClick={()=>{importRef.current?.click();toolsRef.current?.removeAttribute("open");}} disabled={!ready}><Upload size={16}/>导入复习进度</button></div></details><input ref={importRef} type="file" accept=".json,application/json" className="visually-hidden" onChange={e=>{if(e.target.files?.[0])void importBackup(e.target.files[0]);e.target.value="";}}/></div>
    </header>

    {session?<Practice markRemainder={markRemainder} key={session.ids.join(",")} session={session} setSession={setSession} progress={progress} update={update} fontSize={fontSize} changeFont={n=>{setFontSize(n);try{localStorage.setItem("reading-desk-font",String(n));}catch{}}} back={back} ready={ready}/>:<div className="library-layout">
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

function Practice({session,setSession,progress,update,fontSize,changeFont,back,ready,markRemainder}:{session:Session;setSession:(s:Session)=>void;progress:Progress;update:(op:SaveOperation,debounced?:boolean)=>void;fontSize:number;changeFont:(n:number)=>void;back:()=>void;ready:boolean;markRemainder:(q:Question,value:Origin)=>void}){
  const q=byId.get(session.ids[session.index])!;
  const article=articleMap.get(q.article_id)!;
  const record=progress[q.id]||freshRecord(q.id);
  const [shownId,setShownId]=useState("");
  const shown=shownId===q.id;
  const setShown=(value:boolean)=>setShownId(value?q.id:"");
  const [revealOnly,setRevealOnly]=useState(false);
  const [highlight,setHighlight]=useState(true);
  const [mobilePane,setMobilePane]=useState("question");
  const [context,setContext]=useState(false);
  const [answerAtReveal,setAnswerAtReveal]=useState<string[]>([]);
  const [queueOpen,setQueueOpen]=useState(false);
  const queueRef=useRef<HTMLDialogElement>(null);
  const passageRef=useRef<HTMLDivElement>(null);
  const questionRef=useRef<HTMLDivElement>(null);
  const formRef=useRef<HTMLFormElement>(null);
  const currentId=q.id;
  const prevArticle=useRef(q.article_id);
  useEffect(()=>{
    setShown(false);setRevealOnly(false);setContext(false);setAnswerAtReveal([]);
    questionRef.current?.scrollTo({top:0});
    if(prevArticle.current!==q.article_id){passageRef.current?.scrollTo({top:0});prevArticle.current=q.article_id;}
  },[currentId,q.article_id]);
  useEffect(()=>{if(queueOpen&&!queueRef.current?.open)queueRef.current?.showModal();if(!queueOpen&&queueRef.current?.open)queueRef.current?.close();},[queueOpen]);
  const navigate=useCallback((offset:number)=>{const next=session.index+offset;if(next>=session.ids.length){back();return;}if(next>=0)setSession({...session,index:next});},[session,setSession,back]);
  useEffect(()=>{
    function keyboard(e:KeyboardEvent){
      const target=e.target as HTMLElement;
      if(target.closest("input,textarea,select,button,summary,[contenteditable=true],dialog")||e.ctrlKey||e.metaKey||e.altKey||queueOpen)return;
      if(e.key==="ArrowRight"){e.preventDefault();navigate(1);}if(e.key==="ArrowLeft"){e.preventDefault();navigate(-1);}
      if(e.key==="Enter"){e.preventDefault();if(shown)navigate(1);else formRef.current?.requestSubmit();}
    }document.addEventListener("keydown",keyboard);return()=>document.removeEventListener("keydown",keyboard);
  },[navigate,shown,queueOpen]);
  const options=Object.entries(q.options);
  const hasOptions=options.length>0;
  const multi=hasOptions&&q.points>1;
  const answer=record.draft;
  const hasAnswer=hasOptions?answer.length>0:!!answer[0]?.trim();
  const result=gradeAnswer(q,answerAtReveal);
  const groupQuestions=questions.filter(x=>x.exercise_id===q.exercise_id&&x.group_id===q.group_id);
  const currentExerciseQuestions=session.ids.filter(id=>byId.get(id)?.exercise_id===q.exercise_id);
  const review=q.review;
  const needles=review?[...review.evidence.map(e=>e.text),...review.anchors]:[];
  const locate=()=>{
    setMobilePane("passage");setHighlight(true);
    setTimeout(()=>{
      const label=review?.evidence[0]?.paragraph;
      const index=article.paragraphs.findIndex(p=>p.label===label);
      if(index>=0)passageRef.current?.querySelector(`[data-paragraph-index="${index}"]`)?.scrollIntoView({behavior:"smooth",block:"center"});
    },60);
  };
  const submit=(direct=false)=>{
    if(!direct&&!hasAnswer)return;
    setAnswerAtReveal([...answer]);setRevealOnly(direct);setShown(true);
    update({questionId:q.id,op:"attempt",value:{answer:[...answer],result:direct?"revealed":gradeAnswer(q,answer).result}});
    setTimeout(()=>questionRef.current?.querySelector(".answer-feedback")?.scrollIntoView({behavior:"smooth",block:"start"}),60);
  };
  function choose(key:string){
    if(shown)return;
    const next=multi?(answer.includes(key)?answer.filter(v=>v!==key):answer.length<q.points?[...answer,key]:answer):[key];
    update({questionId:q.id,op:"draft",value:next},true);
  }
  const mastery=record.state==="mastered";
  const changeMastery=()=>update({questionId:q.id,op:"state",value:mastery?"learning":"mastered"});

  const Passage=<section className="passage-pane"><div className="pane-toolbar"><span><BookOpen size={15}/>阅读原文</span><div className="font-controls"><button aria-label="缩小原文字号" disabled={fontSize<=15} onClick={()=>changeFont(fontSize-1)}>A−</button><button aria-label="放大原文字号" disabled={fontSize>=22} onClick={()=>changeFont(fontSize+1)}>A+</button></div></div><div className="passage-scroll" ref={passageRef} style={{fontSize}}><div className="passage-heading"><p>{q.passage_code}</p><h1>{article.title}</h1><small>{shortSource(q)}</small></div>{article.paragraphs.map((p,i)=><p className={`passage-paragraph ${shown&&highlight&&review?.evidence.some(e=>e.paragraph===p.label)?"evidence-paragraph":""}`} key={`${p.label}-${i}`} data-paragraph-index={i}><span className="paragraph-label">{p.label}</span><MarkedText text={p.text} needles={needles} enabled={shown&&highlight}/></p>)}<p className="article-note">P 编号用于阅读定位；字母段号保留原文标注。</p></div></section>;

  const QuestionPane=<section className="question-pane"><div className="pane-toolbar"><span>{q.question_type}</span><button className="text-button" onClick={()=>setQueueOpen(true)}><List size={15}/>题目列表<span>{session.index+1}/{session.ids.length}</span></button></div><form ref={formRef} className="question-form" onSubmit={e=>{e.preventDefault();if(!shown)submit();}}><div className="question-scroll" ref={questionRef}><div className="question-heading"><span className="eyebrow">QUESTION {displayNumber(q)}</span>{mastery&&<span className="mastered-label"><Check size={13}/>已掌握</span>}</div><div className="origin-controls"><label>当时这道题<select aria-label="本题原作答情况" value={record.origin||'unknown'} onChange={e=>update({questionId:q.id,op:'origin',value:e.target.value})}><option value="unknown">尚未标记</option><option value="serious">认真作答</option><option value="rushed">赶时间蒙答</option></select></label><button type="button" onClick={()=>markRemainder(q,'rushed')}>从本题到篇末标为蒙答</button></div><p className="answer-instructions">{q.instructions}</p><h2 className="question-text"><QuestionText text={q.question}/></h2>{q.full_context&&<button type="button" className="context-toggle" onClick={()=>setContext(!context)}><FileText size={15}/>{context?"收起完整题组":"查看完整摘要 / 题组"}</button>}{context&&<div className="full-context"><p>{q.full_context}</p><details><summary>该题组全部问题</summary>{groupQuestions.map(item=><p key={item.id}><strong>{displayNumber(item)}. </strong>{item.question}</p>)}</details></div>}
        {!!q.image_urls.length&&<div className="question-images">{q.image_urls.filter(url=>/^https:\/\//.test(url)).map((url,i)=><img key={url} src={url} alt={`原题图示 ${i+1}`} loading="lazy"/>)}<a href={q.report_url} target="_blank" rel="noreferrer">图示或编号看不清？打开原报告<ExternalLink size={13}/></a></div>}
        {hasOptions?<fieldset className={`answer-options ${q.question_type==="细节段落匹配"?"compact-options":""}`} disabled={shown||!ready}><legend>{multi?`请选择 ${q.points} 项` : "选择你的答案"}</legend>{options.map(([key,label])=>{
          const selected=answer.includes(key);const correct=shown&&q.correct_answer_raw.includes(key);const incorrect=shown&&selected&&!correct;
          return <label className={`answer-option ${selected?"selected":""} ${correct?"correct-option":""} ${incorrect?"wrong-option":""}`} key={key}><input type={multi?"checkbox":"radio"} name={`answer-${q.id}`} checked={selected} onChange={()=>choose(key)}/><span className="option-letter">{key}</span><span className="option-text">{label||`Paragraph ${key}`}</span>{correct&&<Check size={17}/>}</label>;
        })}</fieldset>:<label className="fill-answer">你的答案<input aria-label="填写你的答案" autoComplete="off" spellCheck={false} placeholder="在这里输入答案…" value={answer[0]||""} maxLength={256} disabled={shown||!ready} onChange={e=>update({questionId:q.id,op:"draft",value:[e.target.value]},true)}/><small>按原题词数要求作答，提交后核对。</small></label>}
        {shown&&<section className="answer-feedback" aria-live="polite"><div className={`feedback-heading ${revealOnly?"neutral":result.result}`}><span>{revealOnly?"一起看看这道题":result.result==="correct"?"这次答对了":result.result==="partial"?`选对了 ${result.earned}/${result.total} 项` :"再看一遍关键线索"}</span><button type="button" onClick={()=>{setShown(false);setRevealOnly(false);questionRef.current?.scrollTo({top:0,behavior:"smooth"});}}><RotateCcw size={14}/>再做一次</button></div><div className="answer-comparison"><div><span>原练习的答案</span><p className="old-answer">{originalAnswer(q)}</p></div><div><span>正确答案 · 原网站</span><p className="right-answer">{q.correct_answer}</p></div></div>{review?<><div className="analysis-section"><div className="analysis-title"><h3>原文定位 <small>{review.location}</small></h3><button type="button" className="text-button" onClick={locate}><MapPin size={14}/>定位原文</button></div>{review.evidence.filter((e,i,all)=>all.findIndex(x=>x.paragraph===e.paragraph&&x.text===e.text)===i).map((e,i)=><blockquote key={i}><span>{e.paragraph}</span>{e.text}</blockquote>)}<label className="highlight-toggle"><input type="checkbox" checked={highlight} onChange={e=>setHighlight(e.target.checked)}/>高亮原文中的关键句</label></div><div className="analysis-section"><h3>同义替换</h3><p className="paraphrases">{review.paraphrases}</p></div><div className="analysis-section"><h3>原错题解析</h3><p>{review.explanation}</p><small className="analysis-credit">定位与解析由 AI 整理，可结合原文核对。</small></div></>:<div className="analysis-section"><p>这道题暂无独立解析，可以结合左侧原文和原网站答案核对。</p></div>}<div className="note-section"><label htmlFor="question-note">我的复习笔记 <small>自动保存</small></label><textarea id="question-note" placeholder="记录这次容易混淆的词、定位线索或错因…" maxLength={4000} value={record.note} onChange={e=>update({questionId:q.id,op:"note",value:e.target.value},true)}/></div><a className="original-report" href={q.report_url} target="_blank" rel="noreferrer">查看学校原报告<ExternalLink size={13}/><span>报告题号 {q.question_number}</span></a></section>}
      </div><footer className="answer-footer"><button type="button" className="icon-button previous-question" disabled={session.index===0} onClick={()=>navigate(-1)} aria-label="上一题"><ArrowLeft size={18}/></button>{!shown?<><button type="button" className="reveal-button" disabled={!ready} onClick={()=>submit(true)}>暂时不会，看解析</button><Button className="primary" type="submit" disabled={!hasAnswer||!ready}>核对答案<Check size={17}/></Button></>:<><Button type="button" className={`mastery-button ${mastery?"is-mastered":""}`} onClick={changeMastery}>{mastery?<CheckCircle2 size={16}/>:<Check size={16}/>}{mastery?"已掌握":"标记已掌握"}</Button><Button className="primary" type="button" onClick={()=>navigate(1)}>{session.index===session.ids.length-1?"完成练习":"下一题"}<ArrowRight size={17}/></Button></>}</footer></form></section>;

  return <main className="practice-main"><div className="practice-topline"><div className="practice-breadcrumb"><span>{shortSource(q)}</span><span>/</span><strong>{q.passage_code}</strong></div><div className="practice-top-right"><span>{session.index+1} / {session.ids.length} 题</span><Button className="finish-button" onClick={back}>结束本次练习</Button></div></div><div className="mobile-tabs"><button className={mobilePane==="passage"?"active":""} onClick={()=>setMobilePane("passage")}>阅读原文</button><button className={mobilePane==="question"?"active":""} onClick={()=>setMobilePane("question")}>题目与解析</button></div><div className={`reading-workspace mobile-${mobilePane}`}><Group orientation="horizontal" className="reading-group" id="reading-layout"><Panel defaultSize="53%" minSize="32%" id="passage" className="passage-panel">{Passage}</Panel><Separator className="reading-separator"><GripVertical size={13}/></Separator><Panel defaultSize="47%" minSize="34%" id="question" className="question-panel">{QuestionPane}</Panel></Group></div><footer className="practice-bottom"><div className="question-chips"><span>本篇</span>{currentExerciseQuestions.map(id=>{const item=byId.get(id)!;return <button className={`${id===q.id?"current":""} ${progress[id]?.state==="mastered"?"mastered":""}`} key={id} onClick={()=>setSession({...session,index:session.ids.indexOf(id)})} aria-label={`第 ${displayNumber(item)} 题`}>{displayNumber(item)}</button>;})}</div><span className="keyboard-tip">← → 切题 <i/> Enter 提交</span></footer><dialog ref={queueRef} onCancel={()=>setQueueOpen(false)} onClose={()=>setQueueOpen(false)} className="queue-dialog"><div className="dialog-heading"><div><h2>本次练习</h2><p>{session.ids.length} 道题，点击直接切换。</p></div><button className="icon-button" onClick={()=>setQueueOpen(false)} aria-label="关闭题目列表"><X size={21}/></button></div><div className="queue-list">{session.ids.map((id,i)=>{const item=byId.get(id)!;return <button className={id===q.id?"current":""} key={id} onClick={()=>{setSession({...session,index:i});setQueueOpen(false);}}><span>{String(i+1).padStart(2,"0")}</span><div><strong>{item.passage_code} · 第 {displayNumber(item)} 题</strong><p>{shortSource(item)} · {item.question_type}</p></div>{progress[id]?.state==="mastered"?<CheckCircle2 size={18}/>:id===q.id?<ArrowRight size={17}/>:null}</button>;})}</div></dialog></main>;
}




