'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../netlify/chat-prompts');
const {geminiAdapter, openAiAdapter} = require('../netlify/ai-providers');

test('JSON aliases and plain or selected TXT reach both provider request bodies intact', async () => {
  const handlers = await Promise.all(['chat', 'chat-stream'].map(name=>import(`../netlify/functions/${name}.mjs`)));
  const instruction = 'Nie podawaj wyniku. Zadawaj jedno pytanie na raz.\nZachowaj dokładnie 3 etapy.';
  const files = [
    ...['prompt','instructions','instruction','system','systemInstruction','content'].map(key=>({filename:'guide.json',content:JSON.stringify({[key]:instruction})})),
    {filename:'guide.txt',content:instruction},
    {filename:'guide.txt',point:1,content:instruction},
    {filename:'points.txt',point:2,content:`::punkt 1\nInne zadanie.\n::punkt 2\n${instruction}`}
  ];
  for (const file of files) {
    const validation = prompts.validatePromptConfig({filename:file.filename,point:file.point,repositoryId:'biology'});
    assert.equal(validation.ok,true);
    for (const handler of handlers) {
      const system = await handler._test.buildSystemPrompt(validation.value, {readPrompt:async (name, repo)=>{
        assert.equal(name,file.filename); assert.equal(repo,'biology'); return {content:file.content};
      }});
      assert.ok(system.endsWith(instruction));
      assert.doesNotMatch(system,/najpierw wynik|Inne zadanie/);
      for (const adapter of [geminiAdapter,openAiAdapter]) {
        const bodies=[];
        await adapter.sendRequest({apiKey:'fixture',model:'fixture'}, {system,messages:[{role:'user',content:'Pomóż mi'}]}, {fetchImpl:async (url,options)=>{
          bodies.push(JSON.parse(options.body));
          return new Response(JSON.stringify(adapter.id==='gemini'?{candidates:[{content:{parts:[{text:'Pytanie'}]}}]}:{output:[{content:[{type:'output_text',text:'Pytanie'}]}]}));
        }});
        assert.equal(adapter.id==='gemini'?bodies[0].systemInstruction.parts[0].text:bodies[0].instructions,system);
      }
    }
  }
});

test('invalid, missing or oversized instructions fail instead of falling back to generic chat', async () => {
  const chat = await import('../netlify/functions/chat.mjs');
  for (const content of ['{}','broken JSON', JSON.stringify({instructions:'x'.repeat(10001)})]) {
    await assert.rejects(chat._test.buildSystemPrompt({filename:'guide.json',format:'json'}, {readPrompt:async()=>({content})}), error=>/^PROMPT_/.test(error.code));
  }
  await assert.rejects(chat._test.buildSystemPrompt({filename:'guide.txt',format:'txt',point:4}, {readPrompt:async()=>({content:'::punkt 1\nOnly one.'})}), error=>error.code==='PROMPT_POINT_NOT_FOUND');
});

test('model discovery follows every Google page and retains non-chat models with capability labels', async () => {
  const calls=[];
  const models=await geminiAdapter.listModels({apiKey:'secret-fixture'}, {fetchImpl:async (input,options)=>{
    const url=new URL(input); calls.push(url);
    assert.equal(options.headers['x-goog-api-key'],'secret-fixture');
    assert.ok(!url.href.includes('secret-fixture'));
    return new Response(JSON.stringify(url.searchParams.get('pageToken')?{models:[{name:'models/new-model',supportedGenerationMethods:['generateContent']},{name:'models/text',supportedGenerationMethods:['generateContent']}]}:{nextPageToken:'page + 2',models:[{name:'models/text',displayName:'Text',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]}));
  }});
  assert.equal(calls.length,2); assert.equal(calls[1].searchParams.get('pageToken'),'page + 2');
  assert.equal(models.length,3);
  assert.equal(models.find(model=>model.id==='embedding').chatSupported,false);
  assert.equal(models.find(model=>model.id==='new-model').chatSupported,true);
  const openai=await openAiAdapter.listModels({apiKey:'fixture'},{fetchImpl:async()=>new Response(JSON.stringify({data:[{id:'brand-new-model'},{id:'text-embedding-3-small'}]}))});
  assert.equal(openai.find(model=>model.id==='brand-new-model').chatSupported,null);
  assert.equal(openai.find(model=>model.id.includes('embedding')).chatSupported,false);
});

test('Google discovery rejects a repeated page token instead of looping forever', async () => {
  let calls=0;
  await assert.rejects(geminiAdapter.listModels({apiKey:'fixture'},{fetchImpl:async()=>{calls++;return new Response(JSON.stringify({models:[],nextPageToken:'repeat'}));}}),error=>error.code==='AI_PROVIDER_ERROR');
  assert.equal(calls,2);
});
