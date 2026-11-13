import {CloudConflictError,type CloudAPI,type CloudRecord,type CloudWrite} from './cloud-api.ts';
import {decryptSnapshot,encryptSnapshot,hashText,type SyncIdentity} from './sync-crypto.ts';
import type {ProgressSnapshot} from './snapshot';
export type SyncPhase='disabled'|'idle'|'pending'|'syncing'|'offline'|'conflict'|'error';
export type SyncState={phase:SyncPhase;enabled:boolean;lastSyncAt:number;message:string};
export type Comparison={local:ProgressSnapshot;cloud:ProgressSnapshot|null;cloudTime:number;version:number|null};
type Pending={write:CloudWrite;hash:string};
type Meta={format:'reading-cloud-meta-v1';enabled:boolean;baseVersion:number|null;baseHash:string;lastSyncAt:number;pending?:Pending};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
type Options={identity:SyncIdentity;api:CloudAPI;storage:StorageLike;getSnapshot:()=>ProgressSnapshot;applySnapshot:(value:ProgressSnapshot)=>void;validate:(value:unknown)=>ProgressSnapshot;onState:(value:SyncState)=>void;onCompare:(value:Comparison)=>void;debounceMs?:number};
export class SyncEngine{
  private meta:Meta={format:'reading-cloud-meta-v1',enabled:false,baseVersion:null,baseHash:'',lastSyncAt:0};
  private timer:ReturnType<typeof setTimeout>|undefined;private busy=false;private held=false;private disposed=false;private rerun=false;private comparison:Comparison|null=null;
  private key:string;private backupsKey:string;
  private options:Options;
  constructor(options:Options){
    this.options=options;
    this.key='reading-desk-cloud-v1:'+options.identity.vaultId;this.backupsKey=this.key+':recovery';
    try {const raw=JSON.parse(options.storage.getItem(this.key)||'null');if(raw?.format==='reading-cloud-meta-v1'&&typeof raw.enabled==='boolean'&&(raw.baseVersion===null||Number.isSafeInteger(raw.baseVersion))&&typeof raw.baseHash==='string')this.meta=raw;}catch{}
    this.emit(this.meta.enabled?'idle':'disabled');
  }
  private emit(phase:SyncPhase,message=''){if(!this.disposed)this.options.onState({phase,enabled:this.meta.enabled,lastSyncAt:this.meta.lastSyncAt,message});}
  private save(){this.options.storage.setItem(this.key,JSON.stringify(this.meta));}
  private async fingerprint(value:ProgressSnapshot){return hashText(JSON.stringify(value));}
  private async cloudSnapshot(record:CloudRecord|null){return record?this.options.validate(await decryptSnapshot(this.options.identity,record.payload)):null;}
  private async compare(record:CloudRecord|null){
    const cloud=await this.cloudSnapshot(record);this.held=true;
    this.comparison={local:this.options.getSnapshot(),cloud,cloudTime:record?.updatedAt||0,version:record?.version??null};
    this.emit('conflict');this.options.onCompare(this.comparison);
  }
  localChanged(){if(this.disposed||!this.meta.enabled||this.held)return;if(this.busy){this.rerun=true;return;}this.emit('pending');clearTimeout(this.timer);this.timer=setTimeout(()=>void this.sync(),this.options.debounceMs??1200);}
  async manual(){
    if(this.disposed||this.busy)return;clearTimeout(this.timer);this.busy=true;this.emit('syncing');
    try{await this.compare(await this.options.api.read());}catch(error){this.fail(error);}finally{this.busy=false;}
  }
  cancelComparison(){this.held=false;this.comparison=null;this.emit(this.meta.enabled?'conflict':'disabled',this.meta.enabled?'已暂停自动同步，请选择保留的版本':'');if(this.meta.enabled)this.held=true;}
  private backup(local:ProgressSnapshot,cloud:ProgressSnapshot|null,replaced:'local'|'cloud'='local'){
    let old:unknown[]=[];try{old=JSON.parse(this.options.storage.getItem(this.backupsKey)||'[]');if(!Array.isArray(old))old=[];}catch{}
    // Abort a replacement if its recovery copy cannot be saved.
    this.options.storage.setItem(this.backupsKey,JSON.stringify([{savedAt:Date.now(),local,cloud,replaced},...old].slice(0,2)));
  }
  async choose(side:'local'|'cloud'){
    if(!this.comparison||this.busy)return;const comparison=this.comparison;
    this.busy=true;this.emit('syncing');
    try{
      const local=this.options.getSnapshot();
      if(await this.fingerprint(local)!==await this.fingerprint(comparison.local)){await this.compare(await this.options.api.read());return;}
      this.backup(local,comparison.cloud,side==='local'?'cloud':'local');
      if(side==='cloud'){
        if(!comparison.cloud)throw new Error('云端还没有存档，请先保留本地进度');
        const latest=await this.options.api.read();
        if(latest?.version!==comparison.version||await this.fingerprint(this.options.getSnapshot())!==await this.fingerprint(local)){await this.compare(latest);return;}
        this.meta={format:'reading-cloud-meta-v1',enabled:true,baseVersion:comparison.version,baseHash:await this.fingerprint(comparison.cloud),lastSyncAt:Date.now()};
        this.options.applySnapshot(comparison.cloud);this.save();
      }else{
        this.meta.enabled=true;await this.upload(local,comparison.version);
      }
      this.held=false;this.comparison=null;this.emit('idle');
    }catch(error){if(error instanceof CloudConflictError)await this.compare(await this.options.api.read()).catch(e=>this.fail(e));else this.fail(error);}
    finally{this.busy=false;if(this.rerun&&!this.held){this.rerun=false;this.localChanged();}}
  }
  private async upload(snapshot:ProgressSnapshot,version:number|null){
    const pending:Pending={hash:await this.fingerprint(snapshot),write:{expectedVersion:version,mutationId:crypto.randomUUID(),payload:await encryptSnapshot(this.options.identity,snapshot)}};
    this.meta.pending=pending;this.save();
    const result=await this.options.api.write(pending.write);
    this.meta.baseVersion=result.version;this.meta.baseHash=pending.hash;this.meta.lastSyncAt=result.updatedAt;delete this.meta.pending;this.save();
  }
  async sync(){
    if(this.disposed||!this.meta.enabled||this.held)return;if(this.busy){this.rerun=true;return;}
    this.busy=true;this.emit('syncing');
    try{
      let remote=await this.options.api.read();
      if(this.meta.pending){
        const pending=this.meta.pending;
        if(remote?.mutationId===pending.write.mutationId){this.meta.baseVersion=remote.version;this.meta.baseHash=pending.hash;this.meta.lastSyncAt=remote.updatedAt;delete this.meta.pending;this.save();}
        else if((remote?.version??null)===pending.write.expectedVersion){
          const accepted=await this.options.api.write(pending.write);this.meta.baseVersion=accepted.version;this.meta.baseHash=pending.hash;this.meta.lastSyncAt=accepted.updatedAt;delete this.meta.pending;this.save();remote=await this.options.api.read();
        }else{await this.compare(remote);return;}
      }
      const local=this.options.getSnapshot(),hash=await this.fingerprint(local);
      if((remote?.version??null)!==this.meta.baseVersion){
        if(!remote){await this.compare(null);return;}
        const cloud=await this.cloudSnapshot(remote);const cloudHash=await this.fingerprint(cloud!);
        if(hash!==this.meta.baseHash&&hash!==cloudHash){await this.compare(remote);return;}
        if(await this.fingerprint(this.options.getSnapshot())!==hash){await this.compare(remote);return;}
        if(hash!==cloudHash){this.backup(local,cloud);this.options.applySnapshot(cloud!);}
        this.meta.baseVersion=remote.version;this.meta.baseHash=cloudHash;this.meta.lastSyncAt=remote.updatedAt;this.save();
      }else if(hash!==this.meta.baseHash){await this.upload(local,this.meta.baseVersion);}
      this.emit('idle');
    }catch(error){if(error instanceof CloudConflictError)await this.compare(await this.options.api.read()).catch(e=>this.fail(e));else this.fail(error);}
    finally{this.busy=false;if(this.rerun&&!this.held){this.rerun=false;this.localChanged();}}
  }
  private fail(error:unknown){this.emit(typeof navigator!=='undefined'&&navigator.onLine===false?'offline':'error',error instanceof TypeError?'暂时无法连接云端，联网后会自动重试':error instanceof DOMException?(error.name==='TimeoutError'?'连接超时，本地进度已保留，稍后重试':'云端存档未能解密，当前本地进度已保留'):error instanceof Error?error.message:'同步未完成，本地进度已保留');}
  pause(){this.meta.enabled=false;this.held=false;this.comparison=null;clearTimeout(this.timer);this.save();this.emit('disabled');}
  recovery(){return this.options.storage.getItem(this.backupsKey)||'[]';}
  dispose(){this.disposed=true;clearTimeout(this.timer);}
}
