import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Check,CheckCircle2,ExternalLink,FileText,GripVertical,List,MapPin,RotateCcw,X} from 'lucide-react';
import type {Library,Origin,Progress,Question,SaveOperation} from './lib/types';
import type {ReadingSession} from './lib/snapshot';
import {freshRecord} from './lib/progress';
import {displayNumber,gradeAnswer,originalAnswer,shortSource} from './lib/grading';
import {isParagraphMatch,needsGroupSubmission,paragraphDescription,paragraphHints,type AttemptFeedback,type DailyPlan,type Outcome} from './lib/study';
import {isPersonMatch,personLocations,type PersonMention,type PersonLocation} from './lib/name-locations';

type Props={library:Library;session:ReadingSession;setSession:(s:ReadingSession)=>void;progress:Progress;update:(op:SaveOperation,debounced?:boolean)=>void;fontSize:number;changeFont:(n:number)=>void;back:(finished?:boolean)=>void;ready:boolean;markRemainder:(q:Question,value:Origin)=>void;dailyPlan?:DailyPlan;onSubmitted:(rows:{q:Question;feedback:AttemptFeedback}[],day?:string)=>boolean;onReviewed:(q:Question,f:AttemptFeedback,outcome:Outcome,day?:string)=>boolean;onSkip:(id:string,day:string)=>boolean;onRedo:(id:string,day?:string)=>boolean};
function Marked({text,needles,enabled,names=[]}:{text:string;needles:string[];enabled:boolean;names?:PersonMention[]}){
  if(!enabled&&!names.length)return <>{text}</>;const ranges:{start:number;end:number}[]=[];
  for(const needle of enabled?needles.filter(Boolean):[]){let pos=text.indexOf(needle);while(pos>=0){ranges.push({start:pos,end:pos+needle.length});pos=text.indexOf(needle,pos+needle.length);}}
  ranges.sort((a,b)=>a.start-b.start);const merged:typeof ranges=[];for(const r of ranges){const last=merged.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({...r});}
  const edges=[...new Set([0,text.length,...merged.flatMap(r=>[r.start,r.end]),...names.flatMap(r=>[r.start,r.end])])].filter(edge=>!names.some(n=>edge>n.start&&edge<n.end)).sort((a,b)=>a-b);
  const parts:ReactNode[]=[];
  for(let i=0;i<edges.length-1;i++){const start=edges[i],end=edges[i+1],name=names.find(n=>start>=n.start&&end<=n.end),value=text.slice(start,end);parts.push(name?<mark className="person-mention" data-person-key={name.key} data-person-start={name.start} data-person-paragraph={name.paragraphIndex} key={start}>{value}</mark>:merged.some(r=>start>=r.start&&end<=r.end)?<mark key={start}>{value}</mark>:value);}
  return <>{parts}</>;
}
function Text({text}:{text:string}){return <>{text.split(/(\[本题____\])/).map((p,i)=>p==='[本题____]'?<span className="target-blank" key={i}>本题空格</span>:<span key={i}>{p}</span>)}</>;}
export function Practice({library,session,setSession,progress,update,fontSize,changeFont,back,ready,markRemainder,dailyPlan,onSubmitted,onReviewed,onSkip,onRedo}:Props){
  const byId=useMemo(()=>new Map(library.questions.map(q=>[q.id,q])),[library]);
  const q=byId.get(session.ids[session.index])!,article=library.articles.find(a=>a.id===q.article_id)!,record=progress[q.id]||freshRecord(q.id);
  const [localFeedback,setLocalFeedback]=useState<Record<string,AttemptFeedback>>({}),[scopes,setScopes]=useState<string[]>([]),[keyHelp,setKeyHelp]=useState<string[]>([]);
  const [mobilePane,setMobilePane]=useState('question'),[highlight,setHighlight]=useState(true),[context,setContext]=useState(false),[queueOpen,setQueueOpen]=useState(false);
  const feedbacks={...localFeedback,...dailyPlan?.responses},feedback=feedbacks[q.id],shown=!!feedback;
  const passageRef=useRef<HTMLDivElement>(null),questionRef=useRef<HTMLDivElement>(null),formRef=useRef<HTMLFormElement>(null),queueRef=useRef<HTMLDialogElement>(null);
  const seconds=useRef<Record<string,number>>({});
  const nameCursors=useRef<Record<string,number>>({});
  const personMatch=isPersonMatch(q),people=useMemo(()=>personLocations(q,article),[q.id,article]);
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!shown)seconds.current[q.id]=(seconds.current[q.id]||0)+1;},1000);return()=>clearInterval(timer);},[q.id,shown]);
  const labels=paragraphHints(q,article),paragraphMatch=isParagraphMatch(q),checkpoint=!!dailyPlan?.independent.includes(q.id),independent=paragraphMatch||checkpoint||!labels.length;
  const scopeVisible=!personMatch&&(!independent||scopes.includes(q.id))&&labels.length>0;
  const needles=q.review?[...q.review.evidence.map(e=>e.text),...q.review.anchors]:[];
  const groupQuestions=library.questions.filter(x=>x.exercise_id===q.exercise_id&&x.group_id===q.group_id);
  const selectedGroup=session.ids.map(id=>byId.get(id)!).filter(x=>x.exercise_id===q.exercise_id&&x.group_id===q.group_id);
  const grouped=needsGroupSubmission(q)&&selectedGroup.length>1;
  const groupPending=selectedGroup.filter(x=>!feedbacks[x.id]&&!dailyPlan?.completed.includes(x.id)&&!dailyPlan?.skipped.includes(x.id));
  const answered=(item:Question)=>{const draft=progress[item.id]?.draft||[];return Object.keys(item.options).length?draft.length>0:!!draft[0]?.trim();};
  const groupMissing=groupPending.filter(x=>!answered(x));
  const answer=record.draft,hasOptions=Object.keys(q.options).length>0,multi=hasOptions&&q.points>1,hasAnswer=answered(q);
  const compactOptions=paragraphMatch||/Summary选词|人名|判断/.test(q.question_type)&&Object.values(q.options).every(label=>label.length<=32);
  const result=feedback?gradeAnswer(q,feedback.answer):null;
  const correctLabel=hasOptions?q.correct_answer_raw.map(key=>{const label=q.options[key]||'';return /判断/.test(q.question_type)?label||key:label&&label.length<=32?`${key} · ${label}`:key;}).join('、'):q.correct_answer;
  function scrollToLabel(label=labels[0]){const index=article.paragraphs.findIndex(p=>p.label===label);if(index>=0)requestAnimationFrame(()=>passageRef.current?.querySelector(`[data-paragraph-index="${index}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}));}
  function locate(label?:string){setMobilePane('passage');scrollToLabel(label);}
  function locatePerson(person:PersonLocation){
    if(!person.mentions.length)return;const key=q.id+':'+person.key,index=((nameCursors.current[key]??-1)+1)%person.mentions.length;nameCursors.current[key]=index;
    const mention=person.mentions[index];setMobilePane('passage');
    requestAnimationFrame(()=>passageRef.current?.querySelector(`[data-person-key="${person.key}"][data-person-start="${mention.start}"][data-person-paragraph="${mention.paragraphIndex}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}));
  }
  useEffect(()=>{setContext(false);questionRef.current?.scrollTo({top:0});if(labels.length&&scopeVisible)scrollToLabel();else passageRef.current?.scrollTo({top:0});},[q.id]);
  useEffect(()=>{if(queueOpen&&!queueRef.current?.open)queueRef.current?.showModal();if(!queueOpen&&queueRef.current?.open)queueRef.current?.close();},[queueOpen]);
  function move(offset=1,finished=false,skipped=false){
    if(session.kind==='daily'&&offset>0){const excluded=new Set([...(dailyPlan?.completed||[]),...(dailyPlan?.skipped||[]),...(finished||skipped?[q.id]:[])]);const after=session.ids.findIndex((id,i)=>i>session.index&&!excluded.has(id));const earlier=session.ids.findIndex(id=>!excluded.has(id)&&id!==q.id);const next=after>=0?after:earlier;if(next<0){back(true);return;}setSession({...session,index:next});}
    else{const next=session.index+offset;if(next>=session.ids.length){back(true);return;}if(next>=0)setSession({...session,index:next});}
  }
  function finish(outcome:Outcome='good'){if(!feedback||!ready)return;if(onReviewed(q,feedback,outcome,session.day))move(1,true);}
  function skip(){if(!ready)return;if(shown){finish(feedback.result==='correct'?'hard':'again');return;}if(session.day&&!onSkip(q.id,session.day))return;move(1,false,true);}
  function submit(direct=false){
    if(!ready||shown||!direct&&!hasAnswer)return;
    if(grouped&&!direct&&groupMissing.length){const missing=groupMissing.find(x=>x.id!==q.id);if(missing){setSession({...session,index:session.ids.indexOf(missing.id)});return;}}
    const items=grouped?groupPending:[q],at=Date.now();
    const rows=items.map(item=>{const value=[...(progress[item.id]?.draft||[])];const match=isParagraphMatch(item),hints=paragraphHints(item,library.articles.find(a=>a.id===item.article_id)!);const independentItem=!isPersonMatch(item)&&(match||!!dailyPlan?.independent.includes(item.id)||!hints.length);return {q:item,feedback:{eventId:crypto.randomUUID(),at,answer:value,result:direct?'revealed':gradeAnswer(item,value).result,mode:independentItem&&!scopes.includes(item.id)?'independent':'guided',seconds:Math.min(1800,seconds.current[item.id]||0),revealed:direct,helped:direct||keyHelp.includes(item.id)||(match&&scopes.includes(item.id))||(grouped&&selectedGroup.some(other=>!!feedbacks[other.id]))} as AttemptFeedback};});
    if(!onSubmitted(rows,session.day))return;setLocalFeedback(old=>({...old,...Object.fromEntries(rows.map(r=>[r.q.id,r.feedback]))}));
    if(grouped&&rows.length>1)setSession({...session,index:session.ids.indexOf(rows[0].q.id)});
    requestAnimationFrame(()=>{const feedback=questionRef.current?.querySelector<HTMLElement>('.answer-feedback');feedback?.focus({preventScroll:true});feedback?.scrollIntoView({behavior:'smooth',block:'start'});});
  }
  useEffect(()=>{function keyboard(e:KeyboardEvent){const target=e.target as HTMLElement;if(target.closest('input,textarea,select,button,summary,[contenteditable=true],dialog')||e.ctrlKey||e.metaKey||e.altKey||queueOpen)return;if(e.key==='Enter'){e.preventDefault();if(shown)finish();else formRef.current?.requestSubmit();}if(e.key==='ArrowRight'&&shown){e.preventDefault();finish();}if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}}document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard);});
  function choose(key:string){if(shown)return;update({questionId:q.id,op:'draft',value:multi?(answer.includes(key)?answer.filter(v=>v!==key):answer.length<q.points?[...answer,key]:answer):[key]});}
  function redo(){if(feedback&&!onReviewed(q,feedback,feedback.result==='correct'?'hard':'again',session.day))return;if(!onRedo(q.id,session.day))return;setLocalFeedback(old=>{const next={...old};delete next[q.id];return next;});update({questionId:q.id,op:'draft',value:[]});seconds.current[q.id]=0;questionRef.current?.scrollTo({top:0,behavior:'smooth'});}
  const mastery=record.state==='mastered';
  const Passage=<section className="passage-pane">
    <div className="pane-toolbar"><span>原文</span><div className="font-controls"><button type="button" aria-label="缩小原文字号" disabled={fontSize<=15} onClick={()=>changeFont(fontSize-1)}>A−</button><button type="button" aria-label="放大原文字号" disabled={fontSize>=22} onClick={()=>changeFont(fontSize+1)}>A+</button></div></div>
    <div className="passage-scroll" ref={passageRef} style={{fontSize}}>
      <div className="passage-heading"><p>{q.passage_code}</p><h1>{article.title}</h1></div>
      {article.paragraphs.map((p,i)=><p className={`passage-paragraph ${scopeVisible&&labels.includes(p.label)?'scope-paragraph':''} ${!personMatch&&shown&&highlight&&labels.includes(p.label)?'evidence-paragraph':''}`} key={`${p.label}-${i}`} data-paragraph-index={i}><span className="paragraph-label">{p.label}</span><Marked text={p.text} needles={needles} enabled={highlight&&(shown||keyHelp.includes(q.id))} names={people.flatMap(person=>person.mentions.filter(mention=>mention.paragraphIndex===i))}/></p>)}
    </div>
  </section>;

  const QuestionPane=<section className="question-pane">
    <div className="pane-toolbar"><span>{q.question_type}</span><button type="button" className="queue-trigger" onClick={()=>setQueueOpen(true)} aria-label="题目列表"><List size={16}/>{session.index+1} / {session.ids.length}</button></div>
    <form ref={formRef} className="question-form" onSubmit={e=>{e.preventDefault();submit();}}>
      <div className="question-scroll" ref={questionRef}>
        <div className="question-heading"><span>第 {displayNumber(q)} 题</span><details key={q.id} className="original-record" data-popover><summary>原记录</summary><div className="record-body"><p>原答案 <strong>{originalAnswer(q)}</strong>{mastery&&<span>已手动掌握</span>}</p><label>当时作答<select aria-label="本题原作答情况" value={record.origin||'unknown'} onChange={e=>update({questionId:q.id,op:'origin',value:e.target.value})}><option value="unknown">未标记</option><option value="serious">认真作答</option><option value="rushed">赶时间蒙答</option></select></label><button type="button" onClick={()=>markRemainder(q,'rushed')}>从本题起标为蒙答</button><button type="button" onClick={()=>update({questionId:q.id,op:'state',value:mastery?'learning':'mastered'})}>{mastery?'取消掌握标记':'手动标记掌握'}</button><a href={q.report_url} target="_blank" rel="noreferrer">学校原报告<ExternalLink size={12}/></a></div></details></div>
        {!shown&&personMatch&&<div className="location-hint person-locations" aria-label="人名出现位置"><MapPin size={15}/><div>{people.map(person=><button type="button" key={person.key} data-person-key={person.key} disabled={!person.mentions.length} onClick={()=>locatePerson(person)} title={`${person.label} · ${person.mentions.length} 处，点击依次定位`}><span>{person.key}</span>{person.shortLabel}<small>{person.mentions.length}</small></button>)}</div></div>}
        {!shown&&!personMatch&&<div className="location-hint">
          <MapPin size={15}/>
          {scopeVisible?<div className="scope-links">{labels.map(label=><button type="button" key={label} onClick={()=>locate(label)}>{paragraphDescription([label],article)}<ArrowRight size={12}/></button>)}</div>:<span>{labels.length?(paragraphMatch?'先独立匹配':'独立定位'):'独立补做'}</span>}
          {labels.length>0&&<details className="hint-menu" key={q.id} data-popover><summary>提示</summary><div>{!scopeVisible&&<button type="button" onClick={()=>{setScopes(old=>[...new Set([...old,q.id])]);locate();}}>显示相关段落</button>}<button type="button" onClick={()=>{setScopes(old=>[...new Set([...old,q.id])]);setKeyHelp(old=>[...new Set([...old,q.id])]);setHighlight(true);locate();}}>显示关键句</button></div></details>}
        </div>}
        {grouped&&!shown&&<p className="group-caption">本组 {selectedGroup.length} 题，答完一起核对。</p>}
        <p className="answer-instructions">{q.instructions}</p>
        <h2 className="question-text"><Text text={q.question}/></h2>
        {q.full_context&&<><button type="button" className="context-toggle" onClick={()=>setContext(!context)}><FileText size={14}/>{context?'收起题组':'展开题组'}</button>{context&&<div className="full-context"><p>{q.full_context}</p><details><summary>全部小题</summary>{groupQuestions.map(item=><p key={item.id}><strong>{displayNumber(item)}. </strong>{item.question}</p>)}</details></div>}</>}
        {!!q.image_urls.length&&<div className="question-images">{q.image_urls.filter(url=>/^https:\/\//.test(url)).map((url,i)=><img key={url} src={url} alt={`原题图示 ${i+1}`} loading="lazy"/>)}</div>}
        {hasOptions?<fieldset className={`answer-options ${compactOptions?'compact-options':''} ${/判断/.test(q.question_type)?'judgment-options':''}`} disabled={shown||!ready}><legend className="visually-hidden">{multi?`选择 ${q.points} 项`:'选择答案'}</legend>{Object.entries(q.options).map(([key,label])=>{
          const selected=answer.includes(key),correct=shown&&q.correct_answer_raw.includes(key),incorrect=shown&&selected&&!correct;
          return <label className={`answer-option ${selected?'selected':''} ${correct?'correct-option':''} ${incorrect?'wrong-option':''}`} key={key}><input type={multi?'checkbox':'radio'} name={`answer-${q.id}`} checked={selected} onChange={()=>choose(key)}/><span className="option-letter">{key}</span><span className="option-text">{label||`Paragraph ${key}`}</span>{correct&&<Check size={16}/>}</label>;
        })}</fieldset>:<label className="fill-answer"><span className="visually-hidden">你的答案</span><input aria-label="填写你的答案" autoComplete="off" spellCheck={false} placeholder="输入答案" value={answer[0]||''} maxLength={256} disabled={shown||!ready} onChange={e=>update({questionId:q.id,op:'draft',value:[e.target.value]})}/></label>}
        {shown&&<section className="answer-feedback" aria-live="polite" tabIndex={-1}>
          <div className={`feedback-heading ${feedback.revealed?'neutral':result!.result}`}><span>{feedback.revealed?'一起看依据':result!.result==='correct'?'答对了':result!.result==='partial'?`部分正确 ${result!.earned}/${result!.total}`:'再看一遍依据'}</span><button type="button" onClick={redo}><RotateCcw size={13}/>重做</button></div>
          <p className="correct-answer"><span>正确答案</span><strong>{correctLabel}</strong></p>
          {q.review?<>
            <div className="analysis-section evidence-section"><div className="analysis-title"><h3>原文依据</h3><button type="button" className="text-button" onClick={()=>locate()}><MapPin size={13}/>定位</button></div>{q.review.evidence.filter((e,i,all)=>all.findIndex(x=>x.paragraph===e.paragraph&&x.text===e.text)===i).map((e,i)=><blockquote key={i}><button type="button" onClick={()=>locate(e.paragraph)} aria-label={`定位 ${e.paragraph} 段`}>{e.paragraph}</button>{e.text}</blockquote>)}</div>
            <details className="review-detail" open key={`${q.id}:paraphrases`}><summary>同义替换</summary><p>{q.review.paraphrases}</p></details>
            <details className="review-detail" open key={`${q.id}:analysis`}><summary>解析</summary><p>{q.review.explanation}</p><small>AI 整理，请结合原文核对。</small></details>
          </>:<p className="inline-note">暂无独立解析，可结合原文与标准答案核对。</p>}
          <details className="review-detail note-detail" key={`${q.id}:note`}><summary>笔记{record.note&&<span className="note-dot" aria-label="已有笔记"/>}</summary><textarea aria-label="复习笔记" placeholder="记下容易错的地方" maxLength={4000} value={record.note} onChange={e=>update({questionId:q.id,op:'note',value:e.target.value})}/></details>
          {feedback.helped&&<p className="inline-note">已用提示，明天再试。</p>}
        </section>}
      </div>
      <footer className="answer-footer">
        {!shown?<><button type="button" className="footer-skip" onClick={skip} disabled={!ready}>跳过</button><button type="button" className="button secondary" disabled={!ready} onClick={()=>submit(true)}>{grouped?'看本组解析':'看解析'}</button><button className="button primary" type="submit" disabled={!hasAnswer||!ready}>{grouped&&groupMissing.some(x=>x.id!==q.id)?'下一小题':grouped?'核对本组':'提交'}<ArrowRight size={16}/></button></>
          :feedback.result==='correct'&&!feedback.helped?<div className="rating-actions" aria-label="本次理解情况"><button type="button" className="button secondary" disabled={!ready} onClick={()=>finish('again')}>没读懂</button><button type="button" className="button secondary" disabled={!ready} onClick={()=>finish('hard')}>不太稳</button><button type="button" className="button primary" disabled={!ready} onClick={()=>finish('good')}>懂了<ArrowRight size={16}/></button></div>
          :<button type="button" className="button primary feedback-continue" disabled={!ready} onClick={()=>finish()}>继续<ArrowRight size={16}/></button>}
      </footer>
    </form>
  </section>;
  return <main className="practice-main">
    <div className="practice-topline"><span title={q.passage_code}>{shortSource(q)} · {q.passage_code}</span></div>
    <div className="mobile-tabs" role="tablist" aria-label="阅读视图"><button role="tab" aria-selected={mobilePane==='passage'} onClick={()=>setMobilePane('passage')}>原文</button><button role="tab" aria-selected={mobilePane==='question'} onClick={()=>setMobilePane('question')}>题目</button></div>
    <div className={`reading-workspace mobile-${mobilePane}`}>{Passage}{QuestionPane}</div>
    <dialog ref={queueRef} onCancel={()=>setQueueOpen(false)} onClose={()=>setQueueOpen(false)} className="queue-dialog" aria-labelledby="queue-title"><div className="dialog-heading"><h2 id="queue-title">{session.kind==='daily'?'今日题目':'本次题目'}</h2><button type="button" className="icon-button" onClick={()=>setQueueOpen(false)} aria-label="关闭题目列表"><X size={21}/></button></div><div className="queue-list">{session.ids.map((id,i)=>{
      const item=byId.get(id)!;
      return <button className={id===q.id?'current':''} key={id} onClick={()=>{setSession({...session,index:i});setQueueOpen(false);}}><span>{String(i+1).padStart(2,'0')}</span><div><strong>{item.passage_code} · 第 {displayNumber(item)} 题</strong><p>{item.question_type}</p></div>{dailyPlan?.completed.includes(id)?<CheckCircle2 size={17}/>:id===q.id?<ArrowRight size={17}/>:null}</button>;
    })}</div></dialog>
  </main>;
}
