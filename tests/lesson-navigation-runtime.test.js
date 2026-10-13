'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/members/module/lesson/script.js'), 'utf8');
const begin = source.indexOf('  async function goNext()');
const end = source.indexOf('  function goPrevious()', begin);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function navigation(save) {
  const label = {textContent:'Dalej'};
  const state = {loadRequestId:1,index:0,maxReached:0,sequential:true,completed:false,solved:new Set(),completedStepIds:new Set(),lesson:{slides:[{id:'one'},{id:'two'},{id:'three'}]}};
  const elements = {next:{disabled:false,querySelector:()=>label},previous:{disabled:true},navigation:{setAttribute(){},removeAttribute(){}},navigationHint:{textContent:''}};
  let renders = 0, writes = 0;
  const context = {state,elements,stepAccess:()=> 'allow',maySkipCurrent:()=>true,commitCurrentStudentAnswers:()=>({valid:true}),currentExamGate:()=>({satisfied:true}),refreshExamProgress:async()=>{},triggerLockShake(){},updateOutline(){},showCompletion(){},completeCurrentStepForNavigation:()=>state.completedStepIds.add(state.lesson.slides[state.index].id),saveProgress:()=>{writes++;return save();},renderSlide:()=>{renders++;},updateNavigationAccess:()=>{elements.next.disabled=false;}};
  vm.runInNewContext(source.slice(begin,end)+'\nthis.next = goNext;',context);
  return {...context,writes:()=>writes,renders:()=>renders};
}
test('double-clicking Next during a slow sequential save advances only one step', async()=>{
  const gate=deferred(), app=navigation(()=>gate.promise);
  const first=app.next(); await app.next(); await tick();
  assert.equal(app.writes(),1);assert.equal(app.state.index,1);assert.equal(app.elements.next.disabled,true);
  gate.resolve();await first;
  assert.equal(app.renders(),1);assert.equal(app.state.navigationPending,false);assert.equal(app.elements.next.disabled,false);
});
test('a rejected sequential save restores the unlocked range and allows a retry', async()=>{
  const app=navigation(async()=>{throw Object.assign(Error('offline'),{code:'STEP_NOT_UNLOCKED'});});
  await app.next();
  assert.equal(app.state.index,0);assert.equal(app.state.maxReached,0);assert.equal(app.state.navigationPending,false);
  assert.match(app.elements.navigationHint.textContent,/Warunek tego kroku/);
});
test('an old lesson save cannot render or alter navigation of the newly loaded lesson', async()=>{
  const gate=deferred(),app=navigation(()=>gate.promise),pending=app.next();
  await tick();app.state.loadRequestId++;app.state.index=0;app.elements.navigationHint.textContent='Nowa lekcja';
  gate.reject(Error('late failure'));await pending;
  assert.equal(app.state.index,0);assert.equal(app.renders(),0);assert.equal(app.elements.navigationHint.textContent,'Nowa lekcja');
});
