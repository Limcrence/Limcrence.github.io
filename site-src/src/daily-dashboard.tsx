import {ArrowRight,BookOpen,Check,CheckCircle2,Clock3,CalendarDays,RotateCcw} from 'lucide-react';
import type {Library,Progress} from './lib/types';
import {indexQuestions,questionPart,shiftDay,type DailyPlan,type StudyState} from './lib/study';
import {displayNumber,shortSource} from './lib/grading';

export function DailyDashboard({library,progress,study,plan,ready,onStart,onLibrary,onMinutes}:{library:Library;progress:Progress;study:StudyState;plan:DailyPlan;ready:boolean;onStart:()=>void;onLibrary:()=>void;onMinutes:(minutes:number)=>void}){
  const byId=new Map(library.questions.map(q=>[q.id,q])),index=indexQuestions(library.questions);
  const due=plan.due,remaining=plan.ids.filter(id=>!plan.completed.includes(id));
  const groups=[...new Set(plan.ids.map(id=>byId.get(id)!.article_id))];
  const done=!!plan.ids.length&&!remaining.length;
  const totalDue=Object.values(study.cards).filter(c=>c.dueDay<=plan.day).length;
  const week=Array.from({length:7},(_,i)=>shiftDay(plan.day,i-6));
  return <main className="daily-main">
    <div className="daily-page-heading"><div><p className="eyebrow">A LITTLE, EVERY DAY</p><h1>{done?'今天的复习，完成了。':'今天，读懂几道题。'}</h1><p>系统安排好先后，你只需要从这里开始。</p></div><button className="button" onClick={onLibrary}><BookOpen size={16}/>自由练习<ArrowRight size={15}/></button></div>
    <div className="daily-grid"><section className="today-card" aria-labelledby="daily-title">
      <div className="today-topline"><span><CalendarDays size={16}/>{plan.day.replaceAll('-',' . ')}</span><label>每日目标<select aria-label="每日复习时长" value={study.settings.minutes} onChange={e=>onMinutes(Number(e.target.value))}><option value="20">20 分钟</option><option value="30">30 分钟</option><option value="45">45 分钟</option></select></label></div>
      <h2 id="daily-title">{done?'今日计划已完成':'今日计划'}</h2>
      <div className="daily-number"><strong>{plan.completed.length}<span> / {plan.ids.length}</span></strong><span>题已完成</span>{done?<CheckCircle2 size={33}/>:<span className="daily-duration"><Clock3 size={15}/>约 {plan.minutes} 分钟</span>}</div>
      <div className="daily-track"><i style={{width:`${plan.ids.length?plan.completed.length/plan.ids.length*100:0}%`}}/></div>
      <div className="daily-counts"><div><RotateCcw size={17}/><strong>{due.length}</strong><span>到期复习</span></div><div><BookOpen size={17}/><strong>{plan.ids.length-due.length}</strong><span>首次精读 / 补做</span></div></div>
      <p className="daily-plan-description">{done?'这轮已经结束。下次复习日期也已安排好，想多练可以去自由练习。':plan.ids.length?`围绕 ${groups.length} 篇文章练习，逐题理解证据。今天暂时跳过的题不会记成答错。`:'今天没有需要安排的题目。可以休息，也可以在练习库自行选择。'}</p>
      <button className="button primary daily-start" disabled={!ready||!remaining.length} onClick={onStart}>{done?<><Check size={18}/>今日完成</>:<>{plan.completed.length||Object.keys(plan.responses).length?'继续今日复习':'开始今日复习'}<ArrowRight size={18}/></>}</button>
      {plan.minutes!==study.settings.minutes&&<p className="daily-small-note">今天已经开始的计划保持不变，新的时间目标从下次计划生效。</p>}
      {totalDue>due.length&&<p className="daily-small-note">还有 {totalDue-due.length} 个到期复习点，会按时间预算陆续安排。</p>}
    </section><aside className="daily-side"><section className="daily-week"><p className="eyebrow">YOUR RHYTHM</p><h2>一点点，积累起来。</h2><div className="week-dots">{week.map(day=>{const count=study.events.filter(e=>e.day===day&&!e.learningCheck).length;return <div key={day} className={day===plan.day?'is-today':''}><span className={count?'has-review':''}>{count?<Check size={16}/>:day.slice(-2)}</span><small>{day===plan.day?'今天':day.slice(5).replace('-','/')}</small></div>;})}</div><p>复习按你的学习时区安排<br/><span>{study.settings.timeZone}</span></p></section><section className="daily-principle"><h3>先理解，再拉长间隔。</h3><p>答错的题会更早再来。答对后确认读懂依据，下次见面的时间才会逐渐推后。</p><p>同一天看完解析立即重做，作为学习检查，不会直接增加长期掌握。</p></section></aside></div>
    {!!plan.ids.length&&<section className="daily-outline"><div className="daily-outline-heading"><h2>今天会遇见</h2><span>按文章合并 · 系统选题</span></div>{groups.map(article=>{const ids=plan.ids.filter(id=>byId.get(id)!.article_id===article),first=byId.get(ids[0])!;const minutes=Math.max(1,Math.round((ids.reduce((n,id)=>n+plan.estimates[id],0)+75)/60));return <div className="daily-article" key={article}><span className="daily-part">{questionPart(first)?`P${questionPart(first)}`:'阅读'}</span><div><p>{shortSource(first)} · {first.passage_code}</p><h3>{first.passage_title}</h3><span>{ids.map(id=>displayNumber(byId.get(id)!)).join('、')} 题 · {[...new Set(ids.map(id=>byId.get(id)!.question_type))].join(' / ')}</span></div><div className="daily-article-count"><strong>{ids.filter(id=>plan.completed.includes(id)).length} / {ids.length}</strong><span>约 {minutes} 分钟</span></div></div>;})}<p className="daily-footnote">P1 / P2 / P3 按周平衡。题量随理解用时调整，原练习成绩不会改变。{plan.skipped.length>0?`今天暂缓 ${plan.skipped.filter(id=>!plan.completed.includes(id)).length} 题，可继续完成。`:''}</p></section>}
  </main>;
}
