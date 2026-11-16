import {useMemo} from 'react';
import {ArrowRight,Search,SlidersHorizontal,X} from 'lucide-react';
import {passagePart} from './lib/progress';
import {displayNumber,shortSource} from './lib/grading';
import type {Library,Progress,Question} from './lib/types';
import type {ReadingSession} from './lib/snapshot';

export type LibraryFilters={tab:'learning'|'blank'|'mastered'|'all';part:string;source:string;sourceName:string;type:string;origin:string;search:string};
export const initialFilters:LibraryFilters={tab:'learning',part:'all',source:'all',sourceName:'all',type:'all',origin:'all',search:''};
const isWrong=(q:Question)=>['答错','部分正确'].includes(q.status);

export function ExerciseLibrary({library,progress,filters,onFilters,lastSession,ready,onPick}:{
  library:Library;progress:Progress;filters:LibraryFilters;onFilters:(f:LibraryFilters)=>void;
  lastSession:ReadingSession|null;ready:boolean;onPick:(questions:Question[])=>void;
}){
  const change=(field:keyof LibraryFilters,value:string)=>onFilters({...filters,[field]:value});
  const matches=useMemo(()=>library.questions.filter(q=>{
    const mastered=progress[q.id]?.state==='mastered';
    if(filters.tab==='learning'&&(!isWrong(q)||mastered))return false;
    if(filters.tab==='blank'&&(q.status!=='未作答'||mastered))return false;
    if(filters.tab==='mastered'&&!mastered)return false;
    if(filters.part!=='all'&&passagePart(q.passage_code)!==filters.part)return false;
    if(filters.source!=='all'&&q.source_type!==filters.source)return false;
    if(filters.sourceName!=='all'&&q.source_name!==filters.sourceName)return false;
    if(filters.type!=='all'&&q.question_type!==filters.type)return false;
    if(filters.origin!=='all'&&(progress[q.id]?.origin||'unknown')!==filters.origin)return false;
    return !filters.search.trim()||[q.passage_title,q.passage_code,q.source_name,q.question].join(' ').toLowerCase().includes(filters.search.trim().toLowerCase());
  }),[library,progress,filters]);
  const byExercise=new Map<string,Question[]>();
  for(const q of matches){const rows=byExercise.get(q.exercise_id)||[];rows.push(q);byExercise.set(q.exercise_id,rows);}
  const exercises=library.exercises.filter(e=>byExercise.has(e.id));
  const tabs:[LibraryFilters['tab'],string,number][]=[
    ['learning','错题',library.questions.filter(q=>isWrong(q)&&progress[q.id]?.state!=='mastered').length],
    ['blank','未做',library.questions.filter(q=>q.status==='未作答'&&progress[q.id]?.state!=='mastered').length],
    ['mastered','已掌握',Object.values(progress).filter(r=>r.state==='mastered').length],
    ['all','全部',library.questions.length]
  ];
  const filterCount=['source','sourceName','type','origin'].filter(key=>filters[key as keyof LibraryFilters]!=='all').length;
  return <main className="library-main">
    <div className="library-heading">
      <h1>选题 <small>{exercises.length} 篇</small></h1>
      <label className="library-search"><Search size={17}/><input aria-label="搜索练习或题目" value={filters.search} onChange={e=>change('search',e.target.value)} placeholder="搜索文章、练习"/>{filters.search&&<button type="button" aria-label="清空搜索" onClick={()=>change('search','')}><X size={15}/></button>}</label>
    </div>
    <div className="library-tabs" role="tablist" aria-label="题目范围">
      {tabs.map(([value,label,count])=><button key={value} role="tab" aria-selected={filters.tab===value} onClick={()=>change('tab',value)}>{label}<span>{count}</span></button>)}
    </div>
    <div className="library-filterline">
      <div className="part-switch" aria-label="文章部分">{[['all','全部'],['1','P1'],['2','P2'],['3','P3']].map(([value,label])=><button key={value} aria-pressed={filters.part===value} onClick={()=>change('part',value)}>{label}</button>)}</div>
      <details className="library-filters" data-popover>
        <summary><SlidersHorizontal size={15}/>筛选{filterCount>0&&<span>{filterCount}</span>}</summary>
        <div className="filter-fields">
          <label>来源<select aria-label="按来源筛选" value={filters.source} onChange={e=>onFilters({...filters,source:e.target.value,sourceName:'all'})}><option value="all">全部来源</option>{[...new Set(library.exercises.map(e=>e.source_type))].map(s=><option key={s}>{s}</option>)}</select></label>
          <label>练习<select aria-label="按练习筛选" value={filters.sourceName} onChange={e=>change('sourceName',e.target.value)}><option value="all">全部练习</option>{[...new Set(library.exercises.filter(e=>filters.source==='all'||e.source_type===filters.source).map(e=>e.source_name))].map(s=><option key={s} value={s}>{s.replace('26-27学年雅思阅读教材（Vivian）','教材专项练习')}</option>)}</select></label>
          <label>题型<select aria-label="按题型筛选" value={filters.type} onChange={e=>change('type',e.target.value)}><option value="all">全部题型</option>{[...new Set(library.questions.map(q=>q.question_type))].map(t=><option key={t}>{t}</option>)}</select></label>
          <label>原作答<select aria-label="按原作答情况筛选" value={filters.origin} onChange={e=>change('origin',e.target.value)}><option value="all">全部</option><option value="serious">认真作答</option><option value="rushed">赶时间蒙答</option><option value="unknown">未标记</option></select></label>
          {filterCount>0&&<button className="text-button" onClick={()=>onFilters({...filters,source:'all',sourceName:'all',type:'all',origin:'all'})}>重置筛选</button>}
        </div>
      </details>
    </div>
    <div className="exercise-list">
      {exercises.map(e=>{
        const rows=byExercise.get(e.id)!,part=passagePart(e.passage_code);
        const resume=lastSession&&!lastSession.kind&&lastSession.ids.length===rows.length&&rows.every(q=>lastSession.ids.includes(q.id))?lastSession:null;
        const current=resume?rows.find(q=>q.id===resume.ids[resume.index]):null;
        return <button className="exercise-row" key={e.id} disabled={!ready} onClick={()=>onPick(rows)} aria-label={`打开 ${e.title}`}>
          <span className="part-badge">{part?`P${part}`:'阅读'}</span>
          <span className="exercise-info"><strong>{e.title}</strong><span title={e.passage_code}>{shortSource(e)} · {e.passage_code}</span></span>
          <span className="exercise-count">{current?<><span className="resume-label">继续</span><small>第 {displayNumber(current)} 题</small></>:<>{rows.length}<small>题</small></>}</span><ArrowRight size={17}/>
        </button>;
      })}
    </div>
    {!exercises.length&&<div className="empty-state"><h2>没有匹配的题目</h2><button className="button" onClick={()=>onFilters(initialFilters)}>清除筛选</button></div>}
  </main>;
}
