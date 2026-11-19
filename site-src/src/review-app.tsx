import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,BookOpen,Check,Download,LockKeyhole,MoreHorizontal,Upload} from 'lucide-react';
import {Practice} from './practice';
import {DailyDashboard} from './daily-dashboard';
import {ExerciseLibrary,initialFilters} from './exercise-library';
import {CloudSync} from './cloud-sync';
import {applyOperation,mergeProgress,PROGRESS_KEY,validateRecords} from './lib/progress';
import type {Library,Origin,Progress,Question,SaveOperation} from './lib/types';
import type {SyncIdentity} from './lib/sync-crypto';
import type {SyncEngine} from './lib/sync-engine';
import {makeSnapshot,validateSnapshot,type ProgressSnapshot,type ReadingSession} from './lib/snapshot';
import {STUDY_KEY,createStudy,validateStudy,buildDailyPlan,addReviewRound,savePlan,completePlan,recordReview,type DailyPlan,type StudyState,type AttemptFeedback,type Outcome} from './lib/study';

let library:Library;
let questions:Question[]=[];
let byId=new Map<string,Question>();
const originalWrong=(q:Question)=>['答错','部分正确'].includes(q.status);
export function initializeLibrary(value:Library){
  if(!Array.isArray(value.questions)||value.questions.length!==656||value.exercises.length!==50)throw new Error('题库校验失败');
  library=value;questions=value.questions;byId=new Map(questions.map(q=>[q.id,q]));
}
type Session=ReadingSession;

export default function ReviewApp({lock,syncIdentity}:{lock:()=>void;syncIdentity:SyncIdentity}){
  const [progress,setProgress]=useState<Progress>({});
  const [ready,setReady]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const [loadError,setLoadError]=useState(false);
  const [session,setSession]=useState<Session|null>(null);
  const [lastSession,setLastSession]=useState<Session|null>(null);
  const [fontSize,setFontSize]=useState(17);
  const [toast,setToast]=useState("");
  const [view,setView]=useState<'today'|'library'>('today');
  const [filters,setFilters]=useState(initialFilters);
  const libraryScroll=useRef(0);
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
    const dismiss=(e:Event)=>document.querySelectorAll<HTMLDetailsElement>('details[data-popover]').forEach(menu=>{if(e instanceof KeyboardEvent?e.key==='Escape':!menu.contains(e.target as Node))menu.removeAttribute('open');});
    document.addEventListener('click',dismiss);document.addEventListener('keydown',dismiss);
    return()=>{document.removeEventListener('click',dismiss);document.removeEventListener('keydown',dismiss);};
  },[]);
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

  function start(list:Question[]){
    if(!list.length||loadError)return;
    libraryScroll.current=window.scrollY;
    const previous=lastSession&&!lastSession.kind&&lastSession.ids.length===list.length&&list.every(q=>lastSession.ids.includes(q.id))?lastSession:null;
    if(previous){setSession(previous);return;}
    let next=progressRef.current;
    for(const q of list)next=applyOperation(next,{questionId:q.id,op:'draft',value:[]});
    persist(next);setSession({ids:list.map(q=>q.id),index:0});
  }
  function back(finished=false){
    setView(session?.kind==='daily'?'today':'library');setSession(null);
    try{
      history.replaceState(null,'',location.pathname);
      if(finished){localStorage.setItem('reading-desk-session','null');positionRef.current=null;setLastSession(null);engineRef.current?.localChanged();}
    }catch{}
  }
  useEffect(()=>{if(!session&&view==='library')requestAnimationFrame(()=>window.scrollTo(0,libraryScroll.current));},[!!session,view]);

  const plan=useMemo(()=>ready?buildDailyPlan(library,progress,study,clock):null,[ready,progress,study,clock]);
  const extraPlan=useMemo(()=>plan?addReviewRound(library,progress,study,plan):null,[plan,progress,study]);
  function startDaily(target:DailyPlan|null){
    if(!target||!ready||loadError)return;
    const first=target.ids.findIndex(id=>!target.completed.includes(id));
    if(first<0)return;
    const nextPlan={...target,skipped:[],updatedAt:Date.now()};
    const existing=studyRef.current.plans.find(p=>p.day===target.day);
    if(!persistStudy(savePlan(studyRef.current,nextPlan)))return;
    const added=target.ids.filter(id=>!existing?.ids.includes(id));
    if(added.length){
      let next=progressRef.current;
      for(const id of added)next=applyOperation(next,{questionId:id,op:'draft',value:[]});
      persist(next);
    }
    setView('today');
    setSession({ids:target.ids,index:first,kind:'daily',day:target.day});
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
    const current=studyRef.current;
    const next=recordReview(current,library,{id:feedback.eventId,questionId:q.id,at:feedback.at,outcome:actual,mode:feedback.mode,seconds:feedback.seconds});
    const now=Date.now();
    if(day)return persistStudy(completePlan(next,day,q.id,false,now));
    return next===current||persistStudy({...next,updatedAt:Math.max(next.updatedAt,now)});
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
  const syncStatus=<span className={`local-status ${saveError||loadError?'has-error':'visually-hidden'}`} role="status">{saveError?<button onClick={()=>persist(progressRef.current)}>保存失败 · 重试</button>:loadError?'进度读取失败，请保留网站数据':<><Check size={14}/>已保存</>}</span>;
  return <div className={`app-shell ${session?'is-practicing':''}`}>
    <header className="app-header">
      <button className="brand" onClick={()=>session?back():setView('today')} aria-label={session?`返回${session.kind==='daily'?'今日':'选题'}`:'返回今日'}>{session?<><ArrowLeft size={19}/><span>{session.kind==='daily'?'今日':'选题'}</span></>:<><BookOpen size={21} strokeWidth={1.7}/><span>阅读错题本</span></>}</button>
      <div className="header-actions">
        {syncStatus}
        <CloudSync identity={syncIdentity} ready={ready&&!loadError} engineRef={engineRef} getSnapshot={getSnapshot} applySnapshot={applyCloud} validate={validateCloud}/>
        <details className="tools-menu" ref={toolsRef} data-popover><summary className="icon-button" aria-label="更多操作"><MoreHorizontal size={21}/></summary><div className="dropdown"><a href="/">个人空间</a><button onClick={lock}><LockKeyhole size={16}/>锁定</button><button onClick={exportBackup} disabled={!ready}><Download size={16}/>导出备份</button><button onClick={()=>{importRef.current?.click();toolsRef.current?.removeAttribute('open');}} disabled={!ready}><Upload size={16}/>导入备份</button></div></details>
        <input ref={importRef} type="file" accept=".json,application/json" className="visually-hidden" onChange={e=>{if(e.target.files?.[0])void importBackup(e.target.files[0]);e.target.value='';}}/>
      </div>
    </header>
    {!session&&<nav className="review-nav" aria-label="复习方式"><button aria-current={view==='today'?'page':undefined} onClick={()=>setView('today')}>今日</button><button aria-current={view==='library'?'page':undefined} onClick={()=>setView('library')}>选题</button></nav>}
    {session?<Practice library={library} onRedo={redoQuestion} markRemainder={markRemainder} key={`${session.day||'free'}:${session.ids.join(',')}`} session={session} setSession={setSession} progress={progress} update={update} fontSize={fontSize} changeFont={n=>{setFontSize(n);try{localStorage.setItem('reading-desk-font',String(n));}catch{}}} back={back} ready={ready&&!loadError} dailyPlan={study.plans.find(p=>p.day===session.day)} onSubmitted={submitted} onReviewed={reviewed} onSkip={skipDaily}/>
      :view==='today'?plan?<DailyDashboard library={library} study={study} plan={plan} extraPlan={extraPlan} ready={ready&&!loadError} onStart={()=>startDaily(extraPlan||plan)} onMinutes={minutes=>persistStudy({...studyRef.current,settings:{...studyRef.current.settings,minutes},updatedAt:Date.now()})}/>:<main className="workspace-loading" role="status">正在准备…</main>
      :<ExerciseLibrary library={library} progress={progress} filters={filters} onFilters={setFilters} lastSession={lastSession} ready={ready&&!loadError} onPick={start}/>}
    {toast&&<div className="toast" role="status">{toast}</div>}
  </div>;
}
