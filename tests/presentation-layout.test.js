const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const layout = require('../public/assets/js/presentation-layout.js');
const preview = require('../public/assets/js/presentation-preview.js');

test('slides fit available space with one scale at desktop, mobile and fullscreen sizes', () => {
  for (const [w,h] of [[1920,990],[1260,660],[670,580],[366,400],[0,0]]) {
    for (const aspect of ['16:9','4:3']) {
      const size = layout.fit(w,h,aspect);
      assert.ok(size.width <= w && size.height <= h + .0001);
      assert.ok(Math.abs(size.width-size.height*(aspect==='4:3'?4/3:16/9))<.0001);
      if (w) assert.ok(Math.abs(size.width-w)<.0001 || Math.abs(size.height-h)<.0001);
    }
  }
  assert.deepEqual(layout.fit(600,400,'16:9','1'), {width:960,height:540});
});

test('editing slide text preserves chemical indices and paragraphs without carrying arbitrary HTML', () => {
  const dom = new JSDOM('<div id="text">H<sub>2</sub>O<div>x<sup>2</sup><br>Nowa <b>linia</b></div><script>bad()</script></div>');
  assert.equal(layout.editableText(dom.window.document.getElementById('text')), 'H<sub>2</sub>O\nx<sup>2</sup>\nNowa linia');
  dom.window.close();
});

test('draft preview is bounded, account/repository scoped and expires; reloads preserve the tab snapshot', () => {
  const storage=()=>{const entries=new Map();return {entries,getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)}};
  const local=storage(),session=storage();
  const definition={presentationId:'test',slides:[{title:'Niezapisana zmiana'}]};
  const token=preview.write(local,{userId:'admin',repositoryId:'bio',definition},1000);
  const expected={token,userId:'admin',repositoryId:'bio',presentationId:'test'};
  assert.equal(preview.read(local,session,{...expected,userId:'other'},1001),null);
  assert.equal(preview.read(local,session,{...expected,repositoryId:'chem'},1001),null);
  assert.deepEqual(preview.read(local,session,expected,1001),definition);
  preview.write(local,{userId:'admin',repositoryId:'bio',definition:{...definition,slides:[]}},1002);
  assert.equal(local.entries.size,1);
  assert.deepEqual(preview.read(local,session,expected,1003),definition);
  assert.equal(preview.read(local,session,expected,3601003),null);
  assert.equal(local.entries.size,0);
  assert.equal(session.entries.size,0);
});
