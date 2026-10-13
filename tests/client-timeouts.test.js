'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function client(t,file) {
  const dom=new JSDOM('',{url:'https://course.example/members/',runScripts:'outside-only'}), w=dom.window, timers=new Map();let id=0;
  t.after(()=>w.close());
  w.ChemAuth={ready:Promise.resolve({authenticated:true,session:{ok:true}}),getAccessToken:async()=> 'fixture'};
  w.setTimeout=(callback,delay)=>{timers.set(++id,{callback,delay});return id;};w.clearTimeout=id=>timers.delete(id);
  w.eval(fs.readFileSync(require.resolve('../public/assets/js/'+file),'utf8'));
  return {w,timers};
}
test('a stalled progress body times out and the next load retries instead of caching rejection', async t=>{
  const {w,timers}=client(t,'progress.js'); let calls=0;
  w.fetch=async(url,{signal})=>{calls++;return {ok:true,json:()=>calls===1?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new w.DOMException('Timeout','AbortError')))):Promise.resolve({records:{}})};};
  const first=w.ChemProgress.load(), failed=assert.rejects(first,error=>error.code==='PROGRESS_TIMEOUT');
  await tick(); [...timers.values()].find(timer=>timer.delay===12000).callback(); await failed;
  assert.deepEqual(await w.ChemProgress.load(),{records:{}}); assert.equal(calls,2); assert.equal(timers.size,0);
});
test('library JSON timeout covers the response body and failed reads can be retried', async t=>{
  const {w,timers}=client(t,'content-library.js');let calls=0;
  w.fetch=async(url,{signal})=>{calls++;return {ok:true,json:()=>calls===1?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new w.DOMException('Timeout','AbortError')))):Promise.resolve({assets:[{filename:'new.md'}]})};};
  const first=w.ChemContentLibrary.list('lesson',{repositoryId:'bio'}),failed=assert.rejects(first,error=>error.code==='CONTENT_REPOSITORY_TIMEOUT');
  await tick(); [...timers.values()].find(timer=>timer.delay===15000).callback(); await failed;
  assert.equal((await w.ChemContentLibrary.list('lesson',{repositoryId:'bio'}))[0].filename,'new.md');assert.equal(calls,2);assert.equal(timers.size,0);
});

test('bundled lesson timeout includes its body and checks size even without Content-Length', async t=>{
  const {w,timers}=client(t,'progressive-image.js');
  const source=fs.readFileSync(require.resolve('../public/members/module/lesson/script.js'),'utf8');
  const begin=source.indexOf('  async function fetchLessonMarkdown('),end=source.indexOf('  async function openLessonLibrary(',begin);
  w.eval(source.slice(begin,end)+'\nwindow.readBundledLesson=fetchLessonMarkdown;');
  w.fetch=async(url,{signal})=>({ok:true,status:200,headers:{get:()=>null},text:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new w.DOMException('timeout','AbortError'))))});
  const first=w.readBundledLesson('test.md',''),failed=assert.rejects(first,error=>error.name==='AbortError');
  await tick();[...timers.values()].find(timer=>timer.delay===12000).callback();await failed;
  assert.equal(timers.size,0);
  w.fetch=async()=>({ok:true,headers:{get:()=>null},text:async()=>'a'.repeat(512*1024+1)});
  await assert.rejects(w.readBundledLesson('test.md',''),/TOO_LARGE/);
  w.fetch=async()=>({ok:true,headers:{get:()=>null},text:async()=>'# Lekcja'});
  assert.equal(await w.readBundledLesson('test.md',''),'# Lekcja');assert.equal(timers.size,0);
});

test('queued Studio math skips previews replaced before MathJax is available', async t=>{
  const {w}=client(t,'progressive-image.js');
  const source=fs.readFileSync(require.resolve('../public/members/module/studio/script.js'),'utf8');
  const begin=source.indexOf('  function typesetMath(root, scope)'),end=source.indexOf('  function preparePreviewYouTube(',begin);
  w.eval(source.slice(begin,end)+'\nwindow.queueMath=typesetMath;');
  let release;const ready=new Promise(resolve=>{release=resolve;}),calls=[];
  w.MathJax={startup:{promise:ready},typesetPromise:async nodes=>calls.push(...nodes)};
  w.document.body.innerHTML='<main><div class="lesson-formula-display">old</div></main>';
  const root=w.document.querySelector('main');w.queueMath(root);
  root.innerHTML='<div class="lesson-formula-display">current</div>';w.queueMath(root);
  release();await w.__chemDiskMathPromise;
  assert.equal(calls.length,1);assert.equal(calls[0].textContent,'current');
});

test('real progress client never auto-saves presentation previews or the presenter window', async t=>{
  for(const query of ['preview=1','presenter=1','mode=presenter']) {
    const dom=new JSDOM('',{url:`https://course.example/members/module/presentation/?presentation=test&repo=bio&${query}`,runScripts:'outside-only'}),w=dom.window;
    t.after(()=>w.close());let writes=0;
    w.ChemAuth={ready:Promise.resolve({authenticated:true,session:{ok:true}}),getAccessToken:async()=>'fixture'};
    w.fetch=async()=>{writes++;return{ok:true,json:async()=>({saved:true})};};
    w.eval(fs.readFileSync(require.resolve('../public/assets/js/progress.js'),'utf8'));
    await tick();await w.ChemProgress.flush();await tick();assert.equal(writes,0,query);
  }
});
