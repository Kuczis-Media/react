'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const repository = require('../netlify/content-repository');
const paging = require('../public/members/module/studio/paged-list');
const config = { configured: true, token: 'fixture', repository: 'fixture/content', ref: 'main', root: '' };
const response = value => new Response(JSON.stringify(value));
const sha = 'a'.repeat(40);
const {assetPage} = require('../netlify/functions/content-library')._test;

test('HTTP pages stay bounded and reject a changed catalog instead of skipping files', () => {
  const assets = Array.from({length:10000}, (_,i)=>({filename:`lesson-${i}.md`,sha,title:`Lekcja ${i}`}));
  const first = assetPage(assets,{pageSize:'500'});
  assert.equal(first.assets.length,500); assert.equal(first.pagination.total,10000);
  const second = assetPage(assets,{pageSize:'500',offset:first.pagination.nextOffset,version:first.pagination.version});
  assert.equal(second.assets[0].filename,'lesson-500.md');
  assert.equal(assetPage(assets,{pageSize:500,offset:9500}).pagination.nextOffset,null);
  assets.unshift({filename:'new.md',sha,title:'Nowa'});
  assert.throws(()=>assetPage(assets,{pageSize:500,offset:500,version:first.pagination.version}),error=>error.code==='CONTENT_LIBRARY_CHANGED');
  for (const query of [{pageSize:501},{pageSize:0},{pageSize:500,offset:-1}]) assert.throws(()=>assetPage(assets,query));
});

test('browser assembles all catalog pages with two requests at a time and seeds complete list caches', async t => {
  const {JSDOM}=require('jsdom'),fs=require('node:fs');
  const dom=new JSDOM('',{url:'https://course.example',runScripts:'outside-only'}),w=dom.window;
  t.after(()=>w.close());
  w.ChemAuth={getAccessToken:async()=> 'fixture'};
  const kinds=['lesson','prompt','exam','presentation','quiz'];
  const assets=Object.fromEntries(kinds.map(kind=>[kind,Array.from({length:1600},(_,i)=>({kind,filename:`${kind}-${i}`,sha,title:String(i)}))]));
  let calls=0,active=0,maxActive=0;
  w.fetch=async input=>{
    calls++;active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,0));
    const query=Object.fromEntries(new URL(input).searchParams);let payload;
    if (query.action==='studio-bootstrap') {
      const pages=Object.fromEntries(kinds.map(kind=>[kind,assetPage(assets[kind],query)]));
      payload={repository:{id:'bio'},repositories:[{id:'bio'}],assets:Object.fromEntries(kinds.map(kind=>[kind,pages[kind].assets])),pagination:Object.fromEntries(kinds.map(kind=>[kind,pages[kind].pagination]))};
    } else { assert.equal(query.repo,'bio'); payload=assetPage(assets[query.kind],query); }
    active--;return {ok:true,json:async()=>payload};
  };
  w.eval(fs.readFileSync(require.resolve('../public/assets/js/content-library'),'utf8'));
  const result=await w.ChemContentLibrary.studioBootstrap();
  for (const kind of kinds) assert.equal(result.assets[kind].length,1600);
  assert.equal(calls,16);assert.equal(maxActive,2);
  assert.equal((await w.ChemContentLibrary.list('lesson',{repositoryId:'bio'})).length,1600);
  assert.equal(calls,16,'Opening a builder uses the completed bootstrap cache');
});

test('all ten thousand materials remain reachable with at most twelve mounted rows', () => {
  const state = paging.createState(), items = Array.from({length:10000}, (_, i) => i), seen = [];
  for (;;) {
    const page = paging.page(state, 'lessons', items);
    assert.ok(page.items.length <= 12);
    seen.push(...page.items);
    if (!page.remaining) break;
    paging.more(state, 'lessons', items.length);
  }
  assert.deepEqual(seen, items);
  paging.more(state, 'lessons', items.length, -1);
  assert.equal(paging.page(state, 'lessons', items).start, 9984);
  assert.equal(paging.page(state, 'lessons', [1, 2]).items.length, 2, 'Shrinking search results clamp the current page');
});

test('GitHub lesson inventory includes files beyond the 1000 Contents limit', async () => {
  repository._test.clearCache();
  const calls = [];
  const assets = await repository.listAssets('lesson', { config, catalog: {}, fetchImpl: async url => {
    const path = new URL(url).pathname; calls.push(path);
    if (path.endsWith('/contents/lessons')) return response(Array.from({length:1000}, (_, i) => ({type:'file',name:`lesson-${i}.md`,size:50,sha})));
    if (path.endsWith('/contents')) return response([{type:'dir',name:'lessons',sha}]);
    if (path.includes('/git/trees/')) return response({truncated:false,tree:Array.from({length:5000}, (_,i)=>({type:'blob',path:`lesson-${i}.md`,size:50,sha}))});
    throw Error(path);
  }});
  assert.equal(assets.length, 5000);
  assert.ok(assets.some(asset => asset.filename === 'lesson-4999.md'));
  assert.equal(calls.length, 3);
});

test('Gitea paginates a large presentation tree and excludes folders without definitions', async () => {
  repository._test.clearCache();
  const calls = [], tree = Array.from({length:2500}, (_,i)=>[
    {type:'tree',path:`deck-${i}`,sha}, {type:'blob',path:`deck-${i}/presentation.json`,size:200,sha}
  ]).flat();
  tree.push({type:'tree',path:'photos-only',sha});
  const assets = await repository.listAssets('presentation', { config:{...config,provider:'gitea',apiUrl:'https://git.example/api/v1'}, catalog:{}, fetchImpl:async input => {
    const url = new URL(input); calls.push(url.href);
    if (url.pathname.endsWith('/contents/presentations')) return response(Array.from({length:1000}, (_,i)=>({type:'dir',name:`deck-${i}`,sha})));
    if (url.pathname.endsWith('/contents')) return response([{type:'dir',name:'presentations',sha}]);
    if (url.pathname.includes('/git/trees/')) {
      assert.equal(url.searchParams.get('recursive'), 'true');
      const page = Number(url.searchParams.get('page'));
      return response({truncated:page*1000<tree.length, tree:tree.slice((page-1)*1000,page*1000)});
    }
    throw Error(url.pathname);
  }});
  assert.equal(assets.length,2500);
  assert.equal(calls.filter(url=>url.includes('/git/trees/')).length,6);
  assert.ok(assets.every(asset=>asset.sha===sha && asset.size===200));
});

test('a truncated GitHub tree is reported instead of silently losing materials', async () => {
  repository._test.clearCache();
  await assert.rejects(repository.listAssets('presentation', { config, catalog:{}, fetchImpl: async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/contents/presentations')) return response(Array.from({length:30}, (_,i)=>({type:'dir',name:`deck-${i}`,sha})));
    if (path.endsWith('/contents')) return response([{type:'dir',name:'presentations',sha}]);
    return response({truncated:true,tree:[]});
  }}), error=>error.code==='CONTENT_DIRECTORY_TOO_LARGE');
});
