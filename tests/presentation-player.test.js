const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const model=require('../public/members/module/studio/presentation-model.js');
const backend=require('../netlify/presentation-common.js');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
async function player(t,{definition,roles=[],draft=false}={}) {
  const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(read('members/module/presentation/index.html'),{url:'https://course.example/members/module/presentation/?presentation=test&repo=bio',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
  const w=dom.window,d=w.document;
  w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>null;
  w.ChemAuth={ready:Promise.resolve({authenticated:true,session:{ok:true}}),getUser:()=>({id:'user',app_metadata:{roles}}),getAccessToken:async()=>'test'};
  w.ChemContentLibrary={repositories:async()=>[{id:'bio'}]};
  w.ChemPresentationStudioModel=model;
  ['assets/js/presentation-layout.js','assets/js/presentation-preview.js'].forEach(file=>w.eval(read(file)));
  let fetches=0,progress=0;
  w.fetch=async()=>{fetches++;return{ok:true,json:async()=>({presentation:backend.normalizeDefinition(definition)})}};
  w.ChemProgress={materialId:()=> 'test',load:async()=>{},record:()=>null,update:async()=>{progress++}};
  if(draft){const token=w.ChemPresentationPreview.write(w.localStorage,{userId:'user',repositoryId:'bio',definition});w.history.replaceState({},'',`?presentation=test&repo=bio&preview=1&draft=${token}`);}
  t.after(()=>{w.close();assert.deepEqual(errors,[])});
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
