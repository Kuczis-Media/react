'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
const markdown = '# Pierwszy\n\nTreść pierwszego kroku.\n\n---\n\n# Drugi\n\nTreść drugiego kroku.';
async function player(t, prepare) {
  const errors=[], console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(read('members/module/lesson/index.html'),{url:'https://course.test/members/module/lesson/?file=demo.md&repo=bio',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
  const w=dom.window,d=w.document;
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
  w.ChemAuth={ready:Promise.resolve({authenticated:true,session:{ok:true}}),getUser:()=>({app_metadata:{roles:['admin']}})};
  w.ChemContentLibrary={readLesson:async()=>({content:markdown}),repositories:async()=>[{id:'bio',default:true,label:'Biologia'},{id:'chem',label:'Chemia'}],list:async()=>[],search:(assets,query)=>assets.filter(asset=>asset.title.includes(query))};
  w.ChemProgress={load:async()=>{},record:()=>null,materialId:(kind,source)=>source,update:async()=>({saved:true}),reset:async()=>{}};
  for(const file of ['assets/js/lesson-navigation.js','assets/js/progressive-image.js','members/module/lesson/lesson-parser.js']) w.eval(read(file));
  t.after(()=>{w.close();assert.deepEqual(errors,[]);});
  if(prepare) prepare(w);
  await w.eval(read('members/module/lesson/script.js'));
  assert.equal(d.getElementById('error-state').hidden,true,d.getElementById('error-message').textContent);
  return {w,d};
}
const choose=(h,repo)=>{const select=h.d.getElementById('lesson-library-repository');select.value=repo;select.dispatchEvent(new h.w.Event('change'));};

test('the lesson library bounds 10,000 entries to 20 rows and searches beyond the current page',async t=>{
  const assets=Array.from({length:10000},(_,i)=>({filename:`lesson-${i}.md`,title:`Lekcja ${String(i).padStart(5,'0')}`,repositoryId:'bio'}));
  const h=await player(t,w=>{w.ChemContentLibrary.list=async()=>assets;});
  h.d.getElementById('lesson-library-button').click();await tick();
  const rows=()=>h.d.querySelectorAll('.lesson-library-item');
  assert.equal(rows().length,20);
  for(let i=0;i<25;i++) h.d.getElementById('lesson-library-next').click();
  assert.equal(rows().length,20);assert.match(rows()[0].textContent,/00500/);
  const input=h.d.getElementById('lesson-library-search');input.value='09999';input.dispatchEvent(new h.w.Event('input'));
  assert.equal(rows().length,1);assert.match(rows()[0].textContent,/09999/);
  assert.equal(h.d.getElementById('lesson-library-next').disabled,true);
  assert.equal(h.d.getElementById('lesson-library-previous').disabled,true);
});

test('switching library repositories ignores stale responses and leaves the open lesson repository unchanged',async t=>{
  const old=deferred(),next=deferred();
  const h=await player(t,w=>{w.ChemContentLibrary.list=(kind,{repositoryId})=>repositoryId==='bio'?old.promise:next.promise;});
  h.d.getElementById('lesson-library-button').click();await tick();choose(h,'chem');await tick();
  next.resolve([{filename:'chem.md',title:'Nowa chemia'}]);await tick();
  old.resolve([{filename:'bio.md',title:'Stara biologia'}]);await tick();
  assert.match(h.d.getElementById('lesson-library-list').textContent,/Nowa chemia/);
  assert.doesNotMatch(h.d.getElementById('lesson-library-list').textContent,/Stara biologia/);
  h.d.getElementById('lesson-library-close').click();h.d.getElementById('next-button').click();await tick();
  assert.ok(h.w.sessionStorage.getItem('chemdisk.lesson.v1:bio:demo.md'));
  assert.equal(h.w.sessionStorage.getItem('chemdisk.lesson.v1:chem:demo.md'),null);
});

test('a failed lesson library read can be retried and late errors from a closed dialog are ignored',async t=>{
  let attempts=0;const late=deferred();
  const h=await player(t,w=>{w.ChemContentLibrary.list=async(kind,{repositoryId})=>{
    if(repositoryId==='chem') return late.promise;
    if(++attempts===1) throw Error('offline');return [{filename:'ok.md',title:'Lekcja po ponowieniu'}];
  };});
  h.d.getElementById('lesson-library-button').click();await tick();
  assert.equal(h.d.getElementById('lesson-library-retry').hidden,false);
  h.d.getElementById('lesson-library-retry').click();await tick();
  assert.equal(attempts,2);assert.equal(h.d.getElementById('lesson-library-retry').hidden,true);
  choose(h,'chem');await tick();h.d.getElementById('lesson-library-close').click();
  h.d.getElementById('lesson-library-button').click();await tick();
  late.reject(Error('stale error'));await tick();
  assert.match(h.d.getElementById('lesson-library-list').textContent,/po ponowieniu/);
  assert.doesNotMatch(h.d.getElementById('lesson-library-status').textContent,/stale/);
});

test('lesson and progress requests start together and a failed progress read preserves the local resume position',async t=>{
  let started=false;
  const h=await player(t,w=>{
    const lesson=w.ChemLesson.parseLesson(markdown,'demo.md');
    w.sessionStorage.setItem('chemdisk.lesson.v1:bio:demo.md',JSON.stringify({signature:lesson.signature,index:1,maxReached:1}));
    w.ChemProgress.load=async()=>{started=true;throw Error('offline');};
    w.ChemContentLibrary.readLesson=async()=>{assert.equal(started,true);return{content:markdown};};
  });
  assert.match(h.d.getElementById('slide-content').textContent,/drugiego/);
});

test('resetting a lesson blocks duplicate navigation and its late response cannot rerender a new lesson',async t=>{
  const reset=deferred();let resets=0;
  const h=await player(t,w=>{w.ChemProgress.reset=()=>{resets++;return reset.promise;};});
  h.d.getElementById('reset-progress-button').click();h.d.getElementById('next-button').click();
  assert.equal(resets,1);assert.equal(h.d.getElementById('next-button').disabled,true);
  h.w.ChemContentLibrary.readLesson=async()=>({content:'# Nowa\n\nNowa treść.'});
  h.w.history.pushState({},'','?file=new.md&repo=chem');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await tick();
  const current=h.d.getElementById('slide-content').firstChild;
  reset.resolve();await tick();
  assert.equal(h.d.getElementById('slide-content').firstChild,current);
  assert.match(h.d.getElementById('slide-content').textContent,/Nowa treść/);
});
