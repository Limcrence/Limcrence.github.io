import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import {Cloud,CloudOff,Check,LoaderCircle,X,Download,Smartphone,ArrowRight} from 'lucide-react';
import {createCloudAPI} from './lib/cloud-api';
import {CLOUD_ENDPOINT} from './lib/cloud-config';
import {SyncEngine,type Comparison,type SyncState} from './lib/sync-engine';
import {snapshotSummary,type ProgressSnapshot} from './lib/snapshot';
import type {SyncIdentity} from './lib/sync-crypto';

function time(value:number){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚无复习记录';}
export function CloudSync({identity,ready,engineRef,getSnapshot,applySnapshot,validate}:{identity:SyncIdentity;ready:boolean;engineRef:MutableRefObject<SyncEngine|null>;getSnapshot:()=>ProgressSnapshot;applySnapshot:(s:ProgressSnapshot)=>void;validate:(s:unknown)=>ProgressSnapshot}){
  const [state,setState]=useState<SyncState>({phase:'disabled',enabled:false,lastSyncAt:0,message:''});
  const [comparison,setComparison]=useState<Comparison|null>(null),[side,setSide]=useState<'local'|'cloud'|null>(null);
  const [notice,setNotice]=useState('');const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    if(!ready||!CLOUD_ENDPOINT)return;
    const engine=new SyncEngine({identity,api:createCloudAPI(CLOUD_ENDPOINT,identity),storage:localStorage,getSnapshot,applySnapshot,validate,onState:setState,onCompare:value=>{setComparison(value);setSide(null);}});
    engineRef.current=engine;void engine.sync();
    const refresh=()=>void engine.sync(),visibility=()=>{if(document.visibilityState==='visible')refresh();};
    const interval=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',visibility);
    return()=>{clearInterval(interval);engine.dispose();if(engineRef.current===engine)engineRef.current=null;window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',visibility);};
  },[identity,ready,engineRef,getSnapshot,applySnapshot,validate]);
  useEffect(()=>{if(comparison&&!dialog.current?.open)dialog.current?.showModal();if(!comparison&&dialog.current?.open)dialog.current?.close();},[comparison]);
  const busy=state.phase==='syncing';
  const status=state.phase==='disabled'?'未开启':state.phase==='syncing'?'同步中':state.phase==='pending'?'待同步':state.phase==='idle'?'已同步':state.phase==='conflict'?'请选择版本':state.phase==='offline'?'离线待同步':'同步未完成';
  async function manual(){setNotice('');if(!CLOUD_ENDPOINT){setNotice('云端服务正在连接，请稍后重试');return;}await engineRef.current?.manual();}
  async function choose(){if(!side)return;await engineRef.current?.choose(side);}
  useEffect(()=>{if(state.phase==='idle')setComparison(null);},[state.phase]);
  function cancel(){if(busy)return;setComparison(null);engineRef.current?.cancelComparison();}
  function downloadRecovery(){
    try{
      const saved=JSON.parse(engineRef.current?.recovery()||'[]')[0];const snapshot=saved?.[saved.replaced]||saved?.local;
      if(!snapshot){setNotice('暂时还没有覆盖前备份');return;}
      const blob=new Blob([JSON.stringify({format:'reading-desk-progress-v1',exportedAt:new Date().toISOString(),records:snapshot.records},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='阅读错题本-覆盖前进度备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{setNotice('备份暂时无法读取，现有进度保持原样');}
  }
  return <div className="cloud-control"><button className={`cloud-button cloud-${state.phase}`} onClick={()=>void manual()} disabled={!ready||busy} title={state.message||`最近同步 ${time(state.lastSyncAt)}`} aria-label="云端同步">{busy?<LoaderCircle className="spin" size={16}/>:state.phase==='offline'?<CloudOff size={16}/>:<Cloud size={16}/>}<span>云端同步<small>{status}</small></span>{state.phase==='idle'&&<Check size={13}/>}</button>{(state.message||notice)&&!comparison&&<span className="cloud-message" role="status">{notice||state.message}</span>}
  <dialog ref={dialog} className="sync-dialog" aria-labelledby="sync-title" onCancel={e=>{e.preventDefault();cancel();}}><div className="sync-heading"><div><p className="eyebrow">CLOUD SAVE</p><h2 id="sync-title">保留哪一份进度？</h2><p>选中的存档会留在这台设备，并同步到云端。</p></div><button className="icon-button" onClick={cancel} disabled={busy} aria-label="关闭同步对比"><X size={20}/></button></div>
  {comparison&&<><div className="sync-choices" role="radiogroup" aria-label="选择保留的进度">{(['local','cloud'] as const).map(kind=>{
    const snapshot=comparison[kind],summary=snapshotSummary(snapshot),selected=side===kind;
    return <button key={kind} role="radio" aria-checked={selected} className={`sync-choice ${selected?'selected':''}`} disabled={busy||!snapshot} onClick={()=>setSide(kind)}><div className="sync-choice-title">{kind==='local'?<Smartphone size={19}/>:<Cloud size={19}/>}<h3>{kind==='local'?'本地进度':'云端进度'}</h3><span className="choice-dot">{selected&&<Check size={11}/>}</span></div>{snapshot?<><div className="sync-stats"><div><strong>{summary.mastered}</strong><span>题已掌握</span></div><div><strong>{summary.questions}</strong><span>题已复习</span></div></div><p>{summary.notes} 条笔记 · {summary.attempts} 次作答<br/>{summary.marked} 题已标记原作答情况</p><div className="sync-time">{kind==='cloud'?'云端保存':'最近复习'}<br/><span>{time(kind==='cloud'?comparison.cloudTime:summary.updatedAt)}</span></div><span className="sync-card-action">{selected?'保留这一份':'选择这份进度'}<ArrowRight size={14}/></span></>:<p className="no-cloud-save">云端还没有存档。<br/>选择本地进度，建立第一次云端存档。</p>}</button>;
  })}</div><div className="sync-explainer"><Check size={15}/><p>选定后自动同步笔记、答题记录、掌握状态和练习位置。每次覆盖前，会在当前设备留一份恢复备份。</p></div>{(state.message||notice)&&<p className="sync-error-message" role="status">{notice||state.message}</p>}<div className="sync-footer"><button className="text-button" onClick={downloadRecovery} disabled={busy}><Download size={14}/>覆盖前备份</button><button className="button primary" disabled={!side||busy} onClick={()=>void choose()}>{busy?<><LoaderCircle className="spin" size={15}/>正在同步</>:side==='cloud'?'使用云端并自动同步':side==='local'?'保留本地并自动同步':'先选择一份进度'}</button></div><div className="sync-bottom"><span>存档在设备上加密，使用当前访问口令解锁。</span>{state.enabled&&<button onClick={()=>{engineRef.current?.pause();setComparison(null);}} disabled={busy}>暂停自动同步</button>}</div></>}
  </dialog></div>;
}
