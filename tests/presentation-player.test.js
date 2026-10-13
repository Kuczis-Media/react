const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const model=require('../public/members/module/studio/presentation-model.js');
const backend=require('../netlify/presentation-common.js');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
async function player(t,{definition,roles=[],draft=false,readMedia,prepare}={}) {
  const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(read('members/module/presentation/index.html'),{url:'https://course.example/members/module/presentation/?presentation=test&repo=bio',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
  const w=dom.window,d=w.document;
  w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>null;
  w.ChemAuth={ready:Promise.resolve({authenticated:true,session:{ok:true}}),getUser:()=>({id:'user',app_metadata:{roles}}),getAccessToken:async()=>'test'};
  w.ChemContentLibrary={repositories:async()=>[{id:'bio'}], readMediaBlob:readMedia || (async()=>new w.Blob(['image']))};
  let urls = 0; w.URL.createObjectURL=()=>`blob:fixture-${++urls}`; w.URL.revokeObjectURL=()=>{};
  w.ChemPresentationStudioModel=model;
  ['assets/js/presentation-layout.js','assets/js/presentation-preview.js','assets/js/progressive-image.js'].forEach(file=>w.eval(read(file)));
  let fetches=0,progress=0;
  w.fetch=async()=>{fetches++;return{ok:true,json:async()=>({presentation:backend.normalizeDefinition(definition)})}};
  w.ChemProgress={materialId:()=> 'test',load:async()=>{},record:()=>null,update:async()=>{progress++;return {saved:true};}};
  if(draft){const token=w.ChemPresentationPreview.write(w.localStorage,{userId:'user',repositoryId:'bio',definition});w.history.replaceState({},'',`?presentation=test&repo=bio&preview=1&draft=${token}`);}
  t.after(()=>{w.close();assert.deepEqual(errors,[])});
  if (prepare) prepare(w);
  await w.eval(read('members/module/presentation/script.js'));
  return {w,d,fetches:()=>fetches,progress:()=>progress};
}

test('published slide quiz blocks navigation, renders chemical indices and treats authored explanation as text', async t=>{
  const definition=model.createPresentation({presentationId:'test',metadata:{status:'published'},slides:[{slideId:'s1',elements:[
    {elementId:'text',type:'text',content:'H<sub>2</sub>O'},
    {elementId:'quiz',type:'quiz',question:'Co powstaje?',options:[{id:'a',text:'Tlen',correct:false},{id:'b',text:'Woda',correct:true}],blockNextUntilCorrect:true,explanation:'<img src=x onerror="window.pwned=true">'}
  ]},{slideId:'s2',layout:'title'}]});
  const h=await player(t,{definition}),next=h.d.getElementById('presentation-player-next');
  assert.equal(h.d.getElementById('presentation-player').hidden,false);
  assert.equal(h.d.querySelector('.presentation-text-run').textContent,'H2O');
  assert.equal(h.d.querySelector('.presentation-text-run sub').textContent,'2');
  next.click();assert.equal(h.d.getElementById('presentation-player-position').textContent,'1 / 2');
  h.d.querySelectorAll('.presentation-quiz-option')[0].click();next.click();
  assert.equal(h.d.getElementById('presentation-player-position').textContent,'1 / 2');
  h.d.querySelectorAll('.presentation-quiz-option')[1].click();
  assert.equal(h.d.querySelector('.presentation-quiz-feedback img'),null);
  assert.match(h.d.querySelector('.presentation-quiz-feedback').textContent, /<img/);
  next.click();assert.equal(h.d.getElementById('presentation-player-position').textContent,'2 / 2');
  h.d.getElementById('presentation-player-previous').click();
  assert.equal(h.d.querySelector('.presentation-quiz-feedback img'),null);
  assert.equal(h.w.pwned,undefined);
});

test('current draft preview requires an admin and never fetches the stale remote definition or writes learner progress', async t=>{
  const definition=model.createPresentation({presentationId:'test',metadata:{title:'Bieżący szkic'}});
  const h=await player(t,{definition,roles:['admin'],draft:true});
  assert.equal(h.d.getElementById('presentation-player-title').textContent,'Bieżący szkic');
  assert.equal(h.fetches(),0);assert.equal(h.progress(),0);
  assert.equal(h.w.localStorage.getItem('chem.last-studied'),null);
  const denied=await player(t,{definition,draft:true});
  assert.equal(denied.d.getElementById('presentation-player-error').hidden,false);
  assert.equal(denied.fetches(),0);assert.equal(denied.progress(),0);
});

const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('presentation reuses nearby images, ignores stale decodes and keeps the outline controls stable', async t => {
  const full = pending(), reads = [];
  const definition=model.createPresentation({presentationId:'test',metadata:{status:'published'},slides:[
    {slideId:'one',elements:[{type:'image',ref:'photos/a.png',alt:'Pierwszy'}]},
    {slideId:'two',elements:[{type:'text',content:'Drugi slajd'}]}
  ]});
  const h=await player(t,{definition,readMedia:async input=>{reads.push(input);return input.variant ? new Blob(['small']) : full.promise;}});
  await settle();
  const image=h.d.querySelector('#presentation-player-stage img'), outline=h.d.querySelector('#presentation-player-outline button');
  assert.equal(image.dataset.mediaQuality,'thumbnail');
  h.d.getElementById('presentation-player-next').click();
  full.resolve(new Blob(['full'])); await settle();
  assert.match(h.d.getElementById('presentation-player-stage').textContent,/Drugi/);
  assert.equal(h.d.querySelector('#presentation-player-outline button'),outline);
  h.d.getElementById('presentation-player-previous').click(); await settle();
  assert.equal(h.d.querySelector('#presentation-player-stage img').dataset.mediaQuality,'full');
  assert.equal(reads.filter(input=>!input.variant).length,1,'Revisiting uses the cached URL, not another full image request');
});

test('presentation PDF waits for image and background decoding and keeps the active slide after print cleanup', async t=>{
  const full=pending(); let prints=0, printed=[];
  const definition=model.createPresentation({presentationId:'test',metadata:{status:'published'},slides:[
    {slideId:'one',backgroundType:'image',backgroundRef:'photos/background.png',elements:[{type:'image',ref:'photos/a.png'}]}
  ]});
  const h=await player(t,{definition,readMedia:async input=>input.variant?new Blob(['small']):full.promise,
    prepare(w){w.print=()=>{prints++;printed=[...w.document.querySelectorAll('#presentation-print-container img')].map(img=>img.dataset.mediaQuality);};}});
  h.d.getElementById('presentation-player-pdf').click(); await settle(); assert.equal(prints,0);
  full.resolve(new Blob(['full'])); await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(prints,1); assert.deepEqual(printed,['full','full']);
  h.w.dispatchEvent(new h.w.Event('afterprint'));
  assert.equal(h.d.getElementById('presentation-print-container'),null);
  assert.equal(h.d.querySelector('#presentation-player-stage img').dataset.mediaQuality,'full');
});

test('presentation keyboard and swipe gestures do not steal actions from buttons or drawing tools',async t=>{
  const definition=model.createPresentation({presentationId:'test',slides:[{slideId:'one',elements:[]},{slideId:'two',elements:[]}]});
  const h=await player(t,{definition,roles:['admin']});
  const stage=h.d.getElementById('presentation-player-stage'), pos=h.d.getElementById('presentation-player-position');
  const button=h.d.getElementById('presentation-player-outline-toggle');
  button.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));assert.equal(pos.textContent,'1 / 2');
  function swipe(){for(const [type,x] of [['touchstart',200],['touchend',60]]){const event=new h.w.Event(type,{bubbles:true});Object.defineProperty(event,'changedTouches',{value:[{clientX:x,clientY:50}]});stage.dispatchEvent(event);}}
  h.d.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'p',bubbles:true})); swipe(); assert.equal(pos.textContent,'1 / 2');
  h.d.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'p',bubbles:true})); swipe(); assert.equal(pos.textContent,'2 / 2');
});

test('opening a presentation does not wait for the repository catalogue and loads progress concurrently', async t => {
  const definition=model.createPresentation({presentationId:'test',slides:[{slideId:'one'},{slideId:'two'}]});
  const progress=pending(); let started=false, catalogueReads=0;
  const h=await player(t,{definition,prepare(w){
    w.ChemContentLibrary.repositories=()=>{catalogueReads++;return new Promise(()=>{});};
    w.ChemProgress.load=()=>{started=true;return progress.promise;};
    w.ChemProgress.record=()=>({details:{lastSlideId:'two'}});
    w.fetch=async()=>{assert.equal(started,true);progress.resolve();return{ok:true,json:async()=>({presentation:backend.normalizeDefinition(definition)})};};
  }});
  assert.equal(catalogueReads,0);
  assert.equal(h.d.getElementById('presentation-player-position').textContent,'2 / 2');
});

test('an explicit missing repository never opens a same-named presentation from another repository', async t => {
  const reads=[];
  const h=await player(t,{prepare(w){
    w.ChemContentLibrary.repositories=async()=>[{id:'other',default:true}];
    w.fetch=async url=>{reads.push(url.searchParams.get('repo'));return{ok:false,status:400,json:async()=>({error:'INVALID_CONTENT_REPOSITORY'})};};
  }});
  assert.deepEqual(reads,['bio']);
  assert.equal(h.d.getElementById('presentation-player-error').hidden,false);
  assert.equal(h.d.getElementById('presentation-player').hidden,true);
});

test('default alias uses the resolved repository for progress, editing and explicitly owned images', async t => {
  const reads=[],materials=[];
  const definition=model.createPresentation({presentationId:'test',slides:[{elements:[{type:'image',ref:'assets/shared/a.png',repositoryId:'chem'}]}]});
  const h=await player(t,{definition,roles:['admin'],readMedia:async input=>{reads.push(input.repositoryId);return new Blob(['image']);},prepare(w){
    w.history.replaceState({},'','?presentation=test');
    w.ChemProgress.materialId=(kind,source)=>{materials.push(source);return'test';};
    w.fetch=async()=>({ok:true,json:async()=>({presentation:backend.normalizeDefinition(definition),repositoryId:'bio'})});
  }});
  await settle();
  assert.deepEqual(materials,['bio:test']);assert.deepEqual(reads,['chem','chem']);
  assert.match(h.d.getElementById('presentation-player-edit').href,/repo=bio/);
});

test('a presentation body timeout is shown accurately and Retry recovers', async t => {
  const timers=new Map();let seq=0,w,attempts=0;
  const definition=model.createPresentation({presentationId:'test'});
  const loading=player(t,{definition,prepare(win){
    w=win;
    w.setTimeout=(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;};w.clearTimeout=id=>timers.delete(id);
    w.fetch=async(url,{signal})=>({ok:true,json:()=>++attempts===1
      ?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new w.DOMException('timeout','AbortError'))))
      :Promise.resolve({presentation:backend.normalizeDefinition(definition)})});
  }});
  await settle();[...timers.values()].find(timer=>timer.ms===12000).fn();
  const h=await loading;
  assert.match(h.d.getElementById('presentation-player-error-copy').textContent,/zbyt długo/);
  h.d.getElementById('presentation-player-retry').click();await settle();
  assert.equal(h.d.getElementById('presentation-player').hidden,false);assert.equal(attempts,2);
});

test('an expired presentation token refreshes once and invalid successful JSON is a readable error', async t=>{
  const refreshes=[];let calls=0;
  const h=await player(t,{prepare(w){
    w.ChemAuth.getAccessToken=async options=>{refreshes.push(options.forceRefresh);return'fixture';};
    w.fetch=async()=>++calls===1?{ok:false,status:401,json:async()=>({})}:{ok:true,json:async()=>({})};
  }});
  assert.deepEqual(refreshes,[false,true]);assert.equal(calls,2);
  assert.match(h.d.getElementById('presentation-player-error-copy').textContent,/nieprawidłowy/);
});

test('failed and out-of-order presentation saves never claim the latest progress was saved', async t=>{
  const saves=[];
  const definition=model.createPresentation({presentationId:'test',slides:[{slideId:'one'},{slideId:'two'}]});
  const h=await player(t,{definition,prepare(w){w.ChemProgress.update=()=>{const p=pending();saves.push(p);return p.promise;};}});
  h.d.getElementById('presentation-player-next').click();
  saves[1].resolve(null);await settle();
  assert.match(h.d.getElementById('presentation-player-save').textContent,/Nie udało/);
  saves[0].resolve({saved:true});await settle();
  assert.match(h.d.getElementById('presentation-player-save').textContent,/Nie udało/);
  h.d.querySelector('.presentation-save-retry').click();saves[2].resolve({saved:true});await settle();
  assert.equal(h.d.getElementById('presentation-player-save').textContent,'Postęp zapisany');
});
