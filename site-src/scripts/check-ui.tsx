// In-memory React/DOM integration tests. This does not launch or control a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://unit.test/reading/',pretendToBeVisual:true});
const win=dom.window;
for(const key of ['window','document','Node','Element','DOMRect','MutationObserver','HTMLElement','HTMLInputElement','HTMLDialogElement','Event','MouseEvent','KeyboardEvent','localStorage','history','location'])Object.defineProperty(globalThis,key,{value:key==='window'?win:win[key],configurable:true,writable:true});
globalThis.getComputedStyle=win.getComputedStyle.bind(win);
win.matchMedia=query=>({matches:false,media:query,addEventListener(){},removeEventListener(){}});
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=function(){};win.HTMLElement.prototype.scrollTo=function(){};win.HTMLElement.prototype.scrollIntoView=function(){};
win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};win.HTMLDialogElement.prototype.close=function(){this.open=false;};
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};win.ResizeObserver=globalThis.ResizeObserver;
globalThis.fetch=async()=>{throw new Error('A DOM test attempted a network request');};
const {default:React,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {default:ReviewApp,initializeLibrary}=await import('../src/review-app.tsx');
const {deriveSyncIdentity}=await import('../src/lib/sync-crypto.ts');
const {createStudy,STUDY_KEY,studyDay,shiftDay,indexQuestions,validateStudy}=await import('../src/lib/study.ts');
const {PROGRESS_KEY}=await import('../src/lib/progress.ts');
const library=JSON.parse(await fs.readFile(new URL('../../reading-practice-web/app/data/library.json',import.meta.url),'utf8'));
initializeLibrary(library);const identity=await deriveSyncIdentity(new Uint8Array(32).fill(8));
const byId=new Map(library.questions.map(q=>[q.id,q])),index=indexQuestions(library.questions),ids=new Set(byId.keys());
let root;
async function mount(){root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(ReviewApp,{syncIdentity:identity,lock(){}}));});}
async function unmount(){await act(async()=>root.unmount());}
async function click(button){assert.ok(button,'expected a control');await act(async()=>{button.click();});}
function button(text){return [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);}
const savedStudy=()=>JSON.parse(localStorage.getItem(STUDY_KEY));
const position=()=>JSON.parse(localStorage.getItem('reading-desk-session'));
function currentQuestion(){const p=position();return byId.get(p.ids[p.index]);}
async function answerCorrect(q){
  if(Object.keys(q.options).length){for(const key of q.correct_answer_raw){const label=[...document.querySelectorAll('.answer-option')].find(label=>label.querySelector('.option-letter')?.textContent===key);await click(label?.querySelector('input'));}}
  else{const input=document.querySelector('input[aria-label="填写你的答案"]');await act(async()=>{Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value').set.call(input,q.correct_answer_raw[0].split(/\s*[/／]\s*/)[0]);input.dispatchEvent(new win.Event('input',{bubbles:true}));});}
}
try{
  await mount();assert.ok(button('开始复习'));await click(button('开始复习'));
  const firstPlan=savedStudy().plans[0],originalIds=[...firstPlan.ids];
  assert.ok(document.querySelector('.location-hint'));assert.equal(document.querySelector('.answer-feedback'),null);assert.equal(document.querySelector('mark'),null);
  await click([...document.querySelectorAll('button')].find(b=>['看解析','看本组解析'].includes(b.textContent.trim())));
  assert.ok(document.querySelector('.answer-feedback'));assert.ok(document.querySelector('mark'));
  const first=currentQuestion();const firstKey=index.keyById.get(first.id);assert.equal(savedStudy().cards[firstKey].dueDay,shiftDay(firstPlan.day,1));
  await click(button('继续'));assert.equal(savedStudy().plans[0].completed.length,1);
  await unmount();await mount();assert.deepEqual(savedStudy().plans[0].ids,originalIds);assert.equal(position().kind,'daily');assert.equal(savedStudy().plans[0].completed.length,1);
  for(let i=0;i<30&&!document.querySelector('.today-card');i++){
    if(!document.querySelector('.answer-feedback'))await click([...document.querySelectorAll('button')].find(b=>['看解析','看本组解析'].includes(b.textContent.trim())));
    await click(button('继续'));
  }
  assert.equal(savedStudy().plans[0].completed.length,originalIds.length);assert.ok(button('已完成')?.disabled);
  validateStudy(savedStudy(),ids);assert.equal(position(),null);
  assert.deepEqual([...document.querySelectorAll('.review-nav > button')].map(b=>b.textContent),['今日','选题']);
  await click(button('选题'));assert.equal(button('开始复习'),undefined);assert.equal(button('自由练习'),undefined);
  await click([...document.querySelectorAll('.part-switch > button')].find(b=>b.textContent==='P2'));
  const articleButton=document.querySelector('.exercise-row'),articleLabel=articleButton.getAttribute('aria-label');
  await click(articleButton);const freeIds=[...position().ids];assert.ok(freeIds.length>1);assert.ok(freeIds.every(id=>byId.get(id).passage_code.includes('R2')));
  const draftQuestion=currentQuestion();await answerCorrect(draftQuestion);
  await click(document.querySelector('.queue-trigger'));await click(document.querySelectorAll('.queue-list > button')[1]);assert.equal(position().index,1);
  await click([...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='返回选题'));
  assert.equal(document.querySelector('.part-switch > button[aria-pressed="true"]').textContent,'P2');
  await click([...document.querySelectorAll('.exercise-row')].find(b=>b.getAttribute('aria-label')===articleLabel));
  assert.equal(position().index,1);assert.ok(JSON.parse(localStorage.getItem(PROGRESS_KEY)).records.find(r=>r.questionId===draftQuestion.id).draft.length);
  await unmount();

  // A matching task must withhold the answer paragraph until the user requests help.
  const matching=library.questions.find(q=>q.question_type==='细节段落匹配'&&q.review);
  localStorage.setItem('reading-desk-session',JSON.stringify({ids:[matching.id],index:0}));history.replaceState(null,'',`#q=${matching.id}`);
  await mount();assert.ok(document.querySelector('.location-hint').textContent.includes('先独立匹配'));assert.equal(document.querySelector('.scope-paragraph'),null);
  await click(document.querySelector('.hint-menu > summary'));await click(button('显示相关段落'));assert.ok(document.querySelector('.scope-paragraph'));assert.equal(document.querySelector('mark'),null);
  await answerCorrect(matching);await click(button('提交'));
  const matchingCard=savedStudy().cards[index.keyById.get(matching.id)];assert.ok(matchingCard);assert.equal(matchingCard.lastOutcome,'again');
  await click(button('继续'));assert.equal(savedStudy().cards[index.keyById.get(matching.id)].independentPasses,0);await unmount();

  // Submit a shared-summary group once, before any member's feedback is revealed.
  localStorage.clear();history.replaceState(null,'','/reading/');
  const firstSummary=library.questions.find(q=>q.question_type==='Summary选词填空'&&q.review&&library.questions.filter(x=>x.exercise_id===q.exercise_id&&x.group_id===q.group_id&&x.review).length>=2);
  const group=library.questions.filter(q=>q.exercise_id===firstSummary.exercise_id&&q.group_id===firstSummary.group_id&&q.review).slice(0,2);
  let s=createStudy('Asia/Tokyo');const now=Date.now(),day=studyDay(now,s.settings.timeZone);
  const groupPlan={day,ids:group.map(q=>q.id),due:[],completed:[],skipped:[],independent:[],responses:{},estimates:Object.fromEntries(group.map(q=>[q.id,180])),minutes:30,createdAt:now,updatedAt:now};
  s.plans=[groupPlan];localStorage.setItem(STUDY_KEY,JSON.stringify(s));await mount();await click(button('开始复习'));
  await answerCorrect(group[0]);await click(button('下一小题'));assert.equal(currentQuestion().id,group[1].id);assert.equal(document.querySelector('.answer-feedback'),null);assert.equal(Object.keys(savedStudy().plans[0].responses).length,0);
  await answerCorrect(group[1]);await click(button('核对本组'));assert.equal(currentQuestion().id,group[0].id);assert.equal(Object.keys(savedStudy().plans[0].responses).length,2);
  await click(button('懂了'));assert.equal(currentQuestion().id,group[1].id);assert.ok(document.querySelector('.answer-feedback'));await click(button('懂了'));
  const records=JSON.parse(localStorage.getItem(PROGRESS_KEY)).records;assert.ok(group.every(q=>records.find(r=>r.questionId===q.id).attempts===1));assert.equal(savedStudy().plans[0].completed.length,2);assert.equal(savedStudy().events.length,2);validateStudy(savedStudy(),ids);
  console.log(JSON.stringify({dailyStart:true,paragraphScopeBeforeAnswer:true,noPrematureEvidenceHighlight:true,failedTaskScheduledTomorrow:true,refreshResumesSamePlan:true,dailyCompletion:true,matchingHintDoesNotCountAsIndependentSuccess:true,groupFeedbackWaitsForAllAnswers:true,groupAttemptsCountedOnce:true,oneTaskEntryPerView:true,filtersAndFreePracticeCursorPreserved:true,finishedSessionDoesNotOfferFalseResume:true,actualBrowserLayoutVerified:false}));
}finally{if(root)await unmount();dom.window.close();}
