import type {Article,Question} from './types';

export type PersonMention={start:number;end:number;paragraphIndex:number;key:string};
export type PersonLocation={key:string;label:string;shortLabel:string;mentions:PersonMention[]};
export const isPersonMatch=(q:Question)=>/人名/.test(q.question_type);
function normalized(value:string){return value.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[‐‑‒–—−]/g,'-');}
function indexedText(value:string){
  let text='',offset=0;const starts:number[]=[],ends:number[]=[];
  for(const char of value){const n=normalized(char);for(let i=0;i<n.length;i++){text+=n[i];starts.push(offset);ends.push(offset+char.length);}offset+=char.length;}
  return {text,starts,ends};
}
function escaped(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
export function personLocations(q:Question,article:Article):PersonLocation[]{
  if(!isPersonMatch(q))return [];
  const candidates=Object.entries(q.options).map(([key,label])=>{
    const names=label.split(/\s+(?:and|&)\s+/i).map(n=>n.trim().replace(/^(?:(?:Professor|Prof\.?|Dr\.?|Sir|Mr\.?|Mrs\.?|Ms\.?)\s+)+/i,''));
    return {key,label,names,surnames:names.map(n=>n.split(/\s+/).at(-1)!).filter(Boolean)};
  });
  const surnameOwners=new Map<string,Set<string>>();
  for(const c of candidates)for(const surname of c.surnames){const key=normalized(surname).toLowerCase(),owners=surnameOwners.get(key)||new Set<string>();owners.add(c.key);surnameOwners.set(key,owners);}
  const paragraphs=article.paragraphs.map(p=>indexedText(p.text));
  return candidates.map(c=>{
    const mentions:PersonMention[]=[];
    for(const [paragraphIndex,paragraph] of paragraphs.entries()){
      const aliases=[...c.names.map(name=>({text:name,full:true})),...c.surnames.filter(name=>surnameOwners.get(normalized(name).toLowerCase())?.size===1).map(name=>({text:name,full:false}))];
      const found:PersonMention[]=[];
      for(const alias of aliases){
        const pattern=normalized(alias.text).split(/\s+/).map(word=>escaped(word).replace(/([a-z])([A-Z])/g,'$1\\s*$2')).join('\\s+');
        // Surnames stay case-sensitive: a common lower-case word is not a person.
        const expression=new RegExp(`(^|[^\\p{L}\\p{N}])(${pattern})(?=$|[^\\p{L}\\p{N}])`,alias.full?'giu':'gu');
        for(const match of paragraph.text.matchAll(expression)){
          const from=match.index!+match[1].length,to=from+match[2].length;
          found.push({key:c.key,paragraphIndex,start:paragraph.starts[from],end:paragraph.ends[to-1]});
        }
      }
      found.sort((a,b)=>a.start-b.start||b.end-a.end);
      for(const match of found)if(!mentions.some(other=>other.paragraphIndex===paragraphIndex&&match.start<other.end&&match.end>other.start))mentions.push(match);
    }
    return {key:c.key,label:c.label,shortLabel:c.surnames.join(' / '),mentions};
  });
}
