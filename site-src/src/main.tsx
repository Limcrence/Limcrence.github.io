import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, ArrowLeft, ArrowRight, LockKeyhole, LoaderCircle } from 'lucide-react';
import ReviewApp, { initializeLibrary } from './review-app';
import { base64, decryptLibrary, deriveKey, rememberedKey, REMEMBER_KEY, type Envelope } from './lib/secure';
import type { Library } from './lib/types';
import './reading.css';

function Gate(){
  const [unlocked,setUnlocked]=useState(false),[password,setPassword]=useState(''),[remember,setRemember]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function unlock(value:string,saved?:Uint8Array){
    setBusy(true);setError('');
    try{
      if(!crypto.subtle)throw new Error('请通过 HTTPS 或本地预览打开此页面');
      const response=await fetch('/reading/library.enc.json');
      if(!response.ok)throw new Error('题库暂时无法加载，请联网后重试');
      const envelope=await response.json() as Envelope;
      const key=saved||await deriveKey(value,envelope);
      let library:Library;
      try {library=await decryptLibrary(key,envelope) as Library;}catch {throw new Error(saved?'已保存的解锁信息已失效，请重新输入口令':'口令不正确，请再试一次');}
      initializeLibrary(library);
      if(remember&&!saved)localStorage.setItem(REMEMBER_KEY,base64(key));
      setPassword('');setUnlocked(true);
    }catch(e){setError(e instanceof Error?e.message:'解锁失败，请重试');if(saved)localStorage.removeItem(REMEMBER_KEY);}
    finally{setBusy(false);}
  }
  useEffect(()=>{const saved=rememberedKey();if(saved)void unlock('',saved);},[]);
  useEffect(()=>{if('serviceWorker'in navigator)void navigator.serviceWorker.register('/reading/sw.js',{scope:'/reading/'}).catch(()=>{});},[]);
  if(unlocked)return <ReviewApp lock={()=>{localStorage.removeItem(REMEMBER_KEY);setUnlocked(false);}}/>;
  return <main className="unlock-page"><a className="unlock-back" href="/"><ArrowLeft size={15}/>个人空间</a><div className="unlock-card"><span className="unlock-icon"><BookOpen size={28} strokeWidth={1.4}/></span><p className="eyebrow">YOUR PRIVATE READING DESK</p><h1>回来，接着学。</h1><p className="unlock-intro">输入访问口令，打开你的阅读复习空间。</p><form onSubmit={e=>{e.preventDefault();void unlock(password);}}><label htmlFor="access-password">访问口令<span><LockKeyhole size={12}/>题库已加密</span></label><input id="access-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" autoCapitalize="none" spellCheck={false} required disabled={busy} placeholder="输入口令"/><label className="remember-unlock"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} disabled={busy}/>在这台设备保持解锁</label>{error&&<p className="unlock-error" role="alert">{error}</p>}<button type="submit" className="button primary" disabled={busy||!password}>{busy?<><LoaderCircle className="spin" size={17}/>正在解锁</>:<>进入复习<ArrowRight size={17}/></>}</button></form><p className="unlock-note">进度保存在当前设备。换设备时，可用“导出 / 导入进度”接着复习。</p></div><footer className="unlock-footer">Limcrence · 阅读复习</footer></main>;
}
createRoot(document.getElementById('root')!).render(<Gate/>);
