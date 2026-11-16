import {ArrowRight,Check,CheckCircle2,Clock3} from 'lucide-react';
import type {Library} from './lib/types';
import {questionPart,shiftDay,type DailyPlan,type StudyState} from './lib/study';
import {shortSource} from './lib/grading';

export function DailyDashboard({library,study,plan,ready,onStart,onMinutes}:{library:Library;study:StudyState;plan:DailyPlan;ready:boolean;onStart:()=>void;onMinutes:(minutes:number)=>void}){
  const byId=new Map(library.questions.map(q=>[q.id,q]));
  const groups=[...new Set(plan.ids.map(id=>byId.get(id)!.article_id))];
  const remaining=plan.ids.filter(id=>!plan.completed.includes(id));
  const done=plan.ids.length>0&&remaining.length===0;
  const minutes=Math.ceil((remaining.reduce((total,id)=>total+plan.estimates[id],0)+new Set(remaining.map(id=>byId.get(id)!.article_id)).size*75)/60);
  const week=Array.from({length:7},(_,i)=>shiftDay(plan.day,i-6));
  const date=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(plan.day+'T12:00:00Z'));
  return <main className="daily-main">
    <div className="daily-heading"><h1>今日复习</h1><span>{date}</span></div>
    <section className="today-card" aria-label="今日计划">
      <div className="today-topline"><span><Clock3 size={16}/>{done?'已完成':`约 ${minutes} 分钟`}</span><label><span className="visually-hidden">每日目标</span><select aria-label="每日复习时长" value={study.settings.minutes} onChange={e=>onMinutes(Number(e.target.value))}><option value="20">每日 20 分钟</option><option value="30">每日 30 分钟</option><option value="45">每日 45 分钟</option></select></label></div>
      <div className="today-progress"><strong>{plan.completed.length}<span> / {plan.ids.length}</span></strong><span>已完成</span>{done&&<CheckCircle2 size={29}/>}</div>
      <div className="progress-track" role="progressbar" aria-label="今日完成进度" aria-valuenow={plan.completed.length} aria-valuemin={0} aria-valuemax={Math.max(1,plan.ids.length)}><i style={{width:`${plan.ids.length?plan.completed.length/plan.ids.length*100:0}%`}}/></div>
      <p className="today-breakdown">{done?'今天的任务完成了。':plan.ids.length?[plan.due.length?`复习 ${plan.due.length} 题`:'',plan.ids.length>plan.due.length?`首次精读 ${plan.ids.length-plan.due.length} 题`:''].filter(Boolean).join(' · '):'今天没有待复习的题。'}</p>
      <button className="button primary daily-start" disabled={!ready||!remaining.length} onClick={onStart}>{done?<><Check size={18}/>已完成</>:<>{plan.completed.length||Object.keys(plan.responses).length?'继续复习':'开始复习'}<ArrowRight size={18}/></>}</button>
      {plan.minutes!==study.settings.minutes&&<p className="inline-note">新目标从下次计划生效。</p>}
    </section>
    <section className="week-strip" aria-label="最近七天"><span>近 7 天</span><div className="week-dots">{week.map(day=>{const count=study.events.filter(e=>e.day===day&&!e.learningCheck).length;return <div key={day} className={day===plan.day?'is-today':''} aria-label={`${day} 复习 ${count} 题`}><span className={count?'has-review':''}>{count?<Check size={14}/>:Number(day.slice(-2))}</span></div>;})}</div></section>
    {!!plan.ids.length&&<details className="today-preview"><summary>任务清单<span>{groups.length} 篇</span></summary><div>{groups.map(article=>{
      const ids=plan.ids.filter(id=>byId.get(id)!.article_id===article),q=byId.get(ids[0])!;
      return <div className="today-article" key={article}><span className="part-badge">{questionPart(q)?`P${questionPart(q)}`:'阅读'}</span><div><h2>{q.passage_title}</h2><p title={q.passage_code}>{shortSource(q)} · {q.passage_code}</p></div><span>{ids.filter(id=>plan.completed.includes(id)).length}/{ids.length}</span></div>;
    })}</div></details>}
    <details className="study-help"><summary>计划说明</summary><p>答错的题优先安排，稳定答对后延长间隔。同日重做作为学习检查。</p><p>跳过不记错，没做完的题保留。P1 / P2 / P3 按周平衡。</p><small>学习时区：{study.settings.timeZone}</small></details>
  </main>;
}
