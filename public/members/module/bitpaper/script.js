(async () => {
  'use strict';

  const authState = await window.ChemAuth.ready;
  if (!authState?.authenticated || !authState.session?.ok) return;

  /* ========= DOM & CTX ========= */
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');

  /* ========= CURSORS ========= */
  function makeCursor(svg, x=0, y=0){
    const data = encodeURIComponent(svg.trim());
    return `url("data:image/svg+xml;utf8,${data}") ${x} ${y}, crosshair`;
  }
  const PENCIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 21l3-1 11-11-2-2L4 18l-1 3Z" fill="#000"/><path d="M14 5l2 2 2-2-2-2-2 2Z" fill="#000"/></svg>`;
  const ERASER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 15l6-6a3 3 0 0 1 4 0l8 8-4 4H7l-4-4Z" fill="#000"/></svg>`;
  const CURSOR_PENCIL = makeCursor(PENCIL_SVG, 2, 20);
  const CURSOR_ERASER = makeCursor(ERASER_SVG, 12, 18);

  /* ========= STATE ========= */
  const state = {
    tool:'pan', color:'#111111',
    sizeStroke:6, sizeText:18, sizeEraser:24,
    pan:{x:0,y:0}, scale:1, spaceDown:false,
    drawing:false, dragging:false, activePointer:null,
    objects:[], history:[], future:[],
    selectionSet:new Set(), marquee:null,
    editor:null, windows:[], zCounter:100,
    dragContext:null
  };
  const MAX_BOARD_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_TASK_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_TASK_IMAGE_DATA_LENGTH = Math.ceil(MAX_TASK_IMAGE_BYTES * 4 / 3) + 256;
  const SAFE_IMAGE_DATA_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i;

  const statusEl = document.getElementById('status');
  const toastEl = document.getElementById('toast');

  /* ========= HELPERS ========= */
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function toast(msg){
    const el = document.createElement('div');
    el.className='item'; el.textContent=msg; toastEl.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(8px)'; }, 1800);
    setTimeout(()=>{ el.remove(); }, 2400);
  }
  function status(msg){ statusEl.textContent = msg; }
  function pointInRect(p, r, pad=0){
    return p.x>=r.x-pad && p.x<=r.x+r.w+pad && p.y>=r.y-pad && p.y<=r.y+r.h+pad;
  }

  /* ========= RESIZE / DPR ========= */
  function resize(){
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    draw();
  }
  window.addEventListener('resize', resize);

  /* ========= TOOLBAR SHOW/HIDE ========= */
  const toolbar = document.getElementById('toolbar');
  const hideToolbarBtn = document.getElementById('hideToolbar');
  const showToolbarBtn = document.getElementById('showToolbarBtn');
  hideToolbarBtn.addEventListener('click', ()=>{
    toolbar.style.display='none';
    showToolbarBtn.style.display='inline-flex';
  });
  showToolbarBtn.addEventListener('click', ()=>{
    toolbar.style.display='flex';
    showToolbarBtn.style.display='none';
  });

  /* ========= TOOLS ========= */
  const toolGroup = document.getElementById('toolGroup');
  toolGroup.addEventListener('click', (e)=>{
    const btn = e.target.closest('.btn'); if(!btn) return;
    setTool(btn.dataset.tool);
  });
  function setTool(t){
    state.tool = t;
    for(const b of toolGroup.querySelectorAll('.btn')) b.setAttribute('aria-pressed', String(b.dataset.tool===t));
    syncSliderToTool(); updateCursor(); status(`Narzędzie: ${t}`);
  }
  function updateCursor(){
    if(state.spaceDown || state.tool==='pan'){
      canvas.style.cursor = state.dragging ? 'grabbing' : 'grab';
    } else if(state.tool==='pencil'){ canvas.style.cursor = CURSOR_PENCIL;
    } else if(state.tool==='eraser'){ canvas.style.cursor = CURSOR_ERASER;
    } else if(state.tool==='select'){ canvas.style.cursor = 'crosshair';
    } else { canvas.style.cursor = 'text'; }
  }

  /* ========= COLORS ========= */
  const colors = document.getElementById('colors');
  colors.addEventListener('click', (e)=>{
    const sw = e.target.closest('.swatch'); if(!sw) return;
    state.color = sw.dataset.color;
    for(const s of colors.querySelectorAll('.swatch')) s.setAttribute('aria-checked', String(s===sw));
  });

  /* ========= SIZE SLIDER ========= */
  const size = document.getElementById('size'); const sizeLabel = document.getElementById('sizeLabel');
  const PENCIL_MIN=1, PENCIL_MAX=36, PENCIL_EXP=2.2;
  const ERASER_MIN=6, ERASER_MAX=64;
  const TEXT_MIN=12, TEXT_MAX=72;

  const linMap=(v, a1,b1, a2,b2)=> a2 + (b2-a2)*((v-a1)/(b1-a1));
  const pencilFromSlider=(v)=>Math.round(PENCIL_MIN + (PENCIL_MAX-PENCIL_MIN)*Math.pow((v-1)/99, PENCIL_EXP));
  const sliderFromPencil=(s)=>Math.round(1 + 99*Math.pow((clamp(s,PENCIL_MIN,PENCIL_MAX)-PENCIL_MIN)/(PENCIL_MAX-PENCIL_MIN), 1/PENCIL_EXP));
  const eraserFromSlider=(v)=>Math.round(linMap(v,1,100,ERASER_MIN,ERASER_MAX));
  const sliderFromEraser=(s)=>Math.round(linMap(clamp(s,ERASER_MIN,ERASER_MAX),ERASER_MIN,ERASER_MAX,1,100));
  const textFromSlider=(v)=>Math.round(linMap(v,1,100,TEXT_MIN,TEXT_MAX));
  const sliderFromText=(s)=>Math.round(linMap(clamp(s,TEXT_MIN,TEXT_MAX),TEXT_MIN,TEXT_MAX,1,100));

  function syncSliderToTool(){
    if(state.tool==='pencil'){
      size.value = sliderFromPencil(state.sizeStroke);
      sizeLabel.textContent = `Grubość: ${state.sizeStroke} px`;
    } else if(state.tool==='eraser'){
      size.value = sliderFromEraser(state.sizeEraser);
      sizeLabel.textContent = `Gumka: ${state.sizeEraser} px`;
    } else {
      size.value = sliderFromText(state.sizeText);
      sizeLabel.textContent = `Rozmiar tekstu: ${state.sizeText} px`;
    }
  }
  let pendingSizeSnapshot=null;
  let pendingSizeChanged=false;
  const selectedTextObjects=()=>Array.from(state.selectionSet).map(idx=>state.objects[idx]).filter(object=>object && object.type==='text');
  const beginSizeHistory=()=>{
    if(state.editor || state.tool==='pencil' || state.tool==='eraser' || !selectedTextObjects().length) return;
    if(!pendingSizeSnapshot) pendingSizeSnapshot=snapshot();
  };
  const finishSizeHistory=()=>{
    if(pendingSizeSnapshot && pendingSizeChanged) recordHistorySnapshot(pendingSizeSnapshot);
    pendingSizeSnapshot=null; pendingSizeChanged=false;
  };
  size.addEventListener('pointerdown', beginSizeHistory);
  size.addEventListener('input', (event)=>{
    const v = +size.value;
    if(state.tool==='pencil'){ state.sizeStroke=pencilFromSlider(v); sizeLabel.textContent=`Grubość: ${state.sizeStroke} px`; }
    else if(state.tool==='eraser'){ state.sizeEraser=eraserFromSlider(v); sizeLabel.textContent=`Gumka: ${state.sizeEraser} px`; }
    else { state.sizeText=textFromSlider(v); sizeLabel.textContent=`Rozmiar tekstu: ${state.sizeText} px`;
      if(state.editor && typeof state.editor.markDirty==='function') state.editor.markDirty();
      const selectedTexts=selectedTextObjects();
      const changesSelection=selectedTexts.some(object=>object.size!==state.sizeText);
      const immediateSnapshot = changesSelection && !state.editor && event.isTrusted===false ? snapshot() : null;
      if(changesSelection && !state.editor && !immediateSnapshot){
        if(!pendingSizeSnapshot) pendingSizeSnapshot=snapshot();
        pendingSizeChanged=true;
      }
      for(const object of selectedTexts) object.size=state.sizeText;
      if(state.editor){ state.editor.el.style.fontSize = (state.sizeText * state.scale) + 'px'; }
      draw();
      if(immediateSnapshot) recordHistorySnapshot(immediateSnapshot);
    }
  });
  size.addEventListener('change', finishSizeHistory);
  size.addEventListener('pointerup', finishSizeHistory);
  size.addEventListener('pointercancel', finishSizeHistory);
  size.addEventListener('blur', finishSizeHistory);

  /* ========= ACTIONS ========= */
  const btnSave = document.getElementById('btnSave');
  const btnLoad = document.getElementById('btnLoad');
  const btnPng  = document.getElementById('btnPng');
  const btnDelete = document.getElementById('btnDelete');
  const btnClear= document.getElementById('btnClear');
  const importFile = document.getElementById('importFile');

  btnSave.addEventListener('click', ()=>{
    const data = collectStateForExport();
    const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tablica-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; // wymusza .json
    a.click(); URL.revokeObjectURL(a.href);
    toast('Zapisano plik JSON.');
  });
  btnLoad.addEventListener('click', ()=> importFile.click());
  importFile.addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0]; if(!file) return;
    if(file.size > MAX_BOARD_FILE_BYTES){ alert('Plik planszy może mieć maksymalnie 15 MB.'); importFile.value=''; return; }
    const fr = new FileReader();
    fr.onload = ()=>{ try{ loadFromJsonString(fr.result); }catch(err){ alert('Błąd wczytywania: '+err.message); } };
    fr.readAsText(file); importFile.value='';
  });
  btnPng.addEventListener('click', ()=>{
    const w = window.innerWidth, h = window.innerHeight;
    const off = document.createElement('canvas'); off.width=w; off.height=h; const oc = off.getContext('2d');
    oc.fillStyle = '#ffffff'; oc.fillRect(0,0,w,h);
    drawTo(oc,w,h);
    const a = document.createElement('a'); a.href = off.toDataURL('image/png'); a.download = `tablica-${Date.now()}.png`; a.click();
  });
  btnDelete.addEventListener('click', ()=>{
    deleteSelection();
  });
  btnClear.addEventListener('click', ()=>{
    if(confirm('Wyczyścić całą planszę?')){
      pushHistory(); state.objects=[]; clearSelection(); closeEditor();
      for(const w of state.windows){ if(w.ro) w.ro.disconnect(); w.el.remove(); } state.windows=[];
      draw();
    }
  });

  /* ========= EXPORT / IMPORT ========= */
  function collectStateForExport(){
    const windows = state.windows.map(w=>{
      const content = w.el.querySelector('.tw-content');
      sanitizeTaskContent(content); // tylko obraz 1 szt.
      const rect = w.el.getBoundingClientRect();
      const cardsMeta = Array.from(content.querySelectorAll('.tw-card.tw-image')).map(card=>{
        const scale = parseFloat(card.dataset.scale || '1') || 1;
        return {type:'image', scale};
      });
      return {
        x:w.x, y:w.y, w:rect.width, h:rect.height,
        minimized:w.minimized || false,
        maximized: w.el.hasAttribute('data-max'),
        scroll: {top: content.scrollTop, left: content.scrollLeft},
        cards: cardsMeta,
        html: content.innerHTML
      };
    });
    return { type:'whiteboard-json', version:13, pan: state.pan, scale: state.scale, objects: state.objects, windows };
  }

  function normalizeBoardObjects(objects){
    if(!Array.isArray(objects)) return [];
    const normalized=[];
    for(const object of objects.slice(0, 5000)){
      if(!object || typeof object!=='object') continue;
      const color = /^#[0-9a-f]{6}$/i.test(String(object.color||'')) ? object.color : '#111111';
      if(object.type==='text'){
        normalized.push({
          type:'text',
          x:clamp(Number(object.x)||0, -1000000, 1000000),
          y:clamp(Number(object.y)||0, -1000000, 1000000),
          text:String(object.text||'').slice(0, 5000),
          size:clamp(Number(object.size)||18, 6, 240),
          color
        });
      } else if(object.type==='stroke' && Array.isArray(object.points)){
        const points=object.points.slice(0, 20000).map(point=>({
          x:clamp(Number(point?.x)||0, -1000000, 1000000),
          y:clamp(Number(point?.y)||0, -1000000, 1000000)
        }));
        if(points.length) normalized.push({type:'stroke', color, size:clamp(Number(object.size)||6, 1, 240), points});
      }
    }
    return normalized;
  }

  function loadFromJsonString(str){
    if(typeof str !== 'string' || str.length > MAX_BOARD_FILE_BYTES) throw new Error('Plik jest zbyt duży');
    const data = JSON.parse(str);
    if(!data || data.type!=='whiteboard-json') throw new Error('Nieprawidłowy plik');
    cancelActiveEditor();
    state.objects = normalizeBoardObjects(data.objects);
    state.pan = data.pan && Number.isFinite(Number(data.pan.x)) && Number.isFinite(Number(data.pan.y))
      ? {x:Number(data.pan.x), y:Number(data.pan.y)} : {x:0,y:0};
    state.scale = clamp(Number(data.scale) || 1, .1, 5);

    for(const w of [...state.windows]){ if(w.ro) w.ro.disconnect(); w.el.remove(); }
    state.windows=[];
    if(Array.isArray(data.windows)){ for(const w of data.windows.slice(0, 50)){ createTaskWindow({
      x:w.x,y:w.y,w:w.w,h:w.h, html:w.html, minimized:!!w.minimized, maximized:!!w.maximized,
      scroll: w.scroll, cards:w.cards, recordHistory:false
    }); } }
    clearSelection(); state.history=[]; state.future=[]; closeEditor(); draw();
  }

  // Autoload z query: ?path=plik.json
  (function autoloadFromQuery(){
    try{
      const params = new URLSearchParams(location.search);
      const path = (params.get('path') || '').trim();
      const safePath = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.json$/i.test(path) ? path : '';
      if(safePath){
        fetch(safePath, {cache:'no-store'}).then(r=>{
          if(!r.ok) throw new Error('HTTP '+r.status);
          return r.text();
        }).then(txt=>{ loadFromJsonString(txt); })
        .catch(err=>{ toast('Nie udało się wczytać z path: '+err.message); });
      }
    }catch(e){}
  })();

  /* ========= COORDS ========= */
  function worldToScreen(pt){ return {x: pt.x*state.scale + state.pan.x, y: pt.y*state.scale + state.pan.y}; }
  function screenToWorld(pt){ return {x: (pt.x - state.pan.x)/state.scale, y: (pt.y - state.pan.y)/state.scale}; }

  /* ========= GRID ========= */
  function drawGrid(){
    const step = 48; const {scale, pan} = state;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const startX = Math.floor((-pan.x)/ (step*scale)) * step;
    const startY = Math.floor((-pan.y)/ (step*scale)) * step;
    ctx.save(); ctx.translate(pan.x, pan.y); ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(0,0,0,.06)';
    for(let x = startX; x < (w-pan.x)/scale + step; x+=step){
      for(let y = startY; y < (h-pan.y)/scale + step; y+=step){
        ctx.beginPath(); ctx.arc(x, y, 0.9, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ========= DRAW ========= */
  function draw(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.setTransform(window.devicePixelRatio||1,0,0,window.devicePixelRatio||1,0,0);
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
    drawGrid();

    ctx.save();
    ctx.translate(state.pan.x, state.pan.y); ctx.scale(state.scale, state.scale);
    for(let i=0;i<state.objects.length;i++){
      const obj = state.objects[i];
      // Podczas edycji nie rysujemy tekstu edytowanego obiektu, aby uniknąć "cieniowania" (podwójnego renderu)
      if(state.editor && obj.type==='text' && i === state.editor.objIndex) continue;
      if(obj.type==='stroke') drawStroke(obj, ctx);
      else if(obj.type==='text') drawText(obj, ctx);
    }

    // selection bounds + handles
    if(state.selectionSet.size){
      const b = selectionBounds();
      if(b){
        ctx.save();
        ctx.lineWidth=1/state.scale; ctx.setLineDash([5,4]); ctx.strokeStyle='rgba(0,0,0,.45)';
        ctx.strokeRect(b.x-6, b.y-6, b.w+12, b.h+12);
        ctx.setLineDash([]);
        const hs = 5/state.scale; // small handles
        ctx.fillStyle='rgba(79,140,255,1)';
        for(const p of handlePoints(b)){ ctx.fillRect(p.x - hs, p.y - hs, hs*2, hs*2); }
        ctx.restore();
      }
    }

    // marquee
    if(state.marquee && state.marquee.active){
      const {start,current} = state.marquee;
      const rx = Math.min(start.x,current.x), ry = Math.min(start.y,current.y);
      const rw = Math.abs(start.x-current.x), rh = Math.abs(start.y-current.y);
      ctx.save();
      ctx.lineWidth=1/state.scale; ctx.setLineDash([6,4]); ctx.strokeStyle='rgba(0,0,0,.6)';
      ctx.fillStyle='rgba(79,140,255,.12)';
      ctx.fillRect(rx,ry,rw,rh); ctx.strokeRect(rx,ry,rw,rh);
      ctx.restore();
    }
    ctx.restore();

    layoutWindows();
    if(state.editor && state.editor.place) state.editor.place();
  }
  function drawTo(c,w,h){
    c.fillStyle='#fff'; c.fillRect(0,0,w,h);
    const step=48; const {scale, pan}=state;
    const startX=Math.floor((-pan.x)/(step*scale))*step;
    const startY=Math.floor((-pan.y)/(step*scale))*step;
    c.save(); c.translate(pan.x, pan.y); c.scale(scale, scale);
    c.fillStyle='rgba(0,0,0,.06)';
    for(let x=startX;x<(w-pan.x)/scale+step;x+=step){
      for(let y=startY;y<(h-pan.y)/scale+step;y+=step){
        c.beginPath(); c.arc(x,y,0.9,0,Math.PI*2); c.fill();
      }
    }
    for(const obj of state.objects){ if(obj.type==='stroke') drawStroke(obj, c); else if(obj.type==='text') drawText(obj, c); }
    c.restore();
  }

  function drawStroke(s,c){
    c.save(); c.lineJoin='round'; c.lineCap='round'; c.strokeStyle=s.color; c.lineWidth=s.size;
    c.beginPath();
    for(let i=0;i<s.points.length;i++){ const p=s.points[i]; if(i===0) c.moveTo(p.x,p.y); else c.lineTo(p.x,p.y); }
    c.stroke(); c.restore();
  }
  function drawText(t,c){
    c.save(); c.fillStyle=t.color; c.textBaseline='top';
    c.font=`${t.size}px Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const lines=t.text.split('\n'); const lh=Math.round(t.size*1.25);
    for(let i=0;i<lines.length;i++) c.fillText(lines[i], t.x, t.y+i*lh);
    c.restore();
  }

  /* ========= BOUNDS / HIT ========= */
  function textBounds(t){
    const tester=document.createElement('canvas').getContext('2d');
    tester.font=`${t.size}px Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const lines=t.text.split('\n'); let w=0;
    for(const line of lines){ w=Math.max(w, tester.measureText(line).width); }
    const h=Math.round(t.size*1.25)*lines.length;
    return {x:t.x,y:t.y,w,h};
  }
  function strokeBounds(s){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of s.points){ if(p.x<minX)minX=p.x; if(p.y<minY)minY=p.y; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; }
    return {x:minX,y:minY,w:maxX-minX,h:maxY-minY};
  }
  function objectBounds(o){ return o.type==='text'? textBounds(o) : o.type==='stroke'? strokeBounds(o) : null; }
  function rectsIntersect(a,b){ return a.x<=b.x+b.w && a.x+a.w>=b.x && a.y<=b.y+b.h && a.y+a.h>=b.y; }

  function selectionBounds(){
    if(!state.selectionSet.size) return null;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const idx of state.selectionSet){
      const b = objectBounds(state.objects[idx]); if(!b) continue;
      minX=Math.min(minX,b.x); minY=Math.min(minY,b.y); maxX=Math.max(maxX,b.x+b.w); maxY=Math.max(maxY,b.y+b.h);
    }
    if(minX===Infinity) return null;
    return {x:minX,y:minY,w:maxX-minX,h:maxY-minY};
  }
  function handlePoints(b){
    return [
      {x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x,y:b.y+b.h},{x:b.x+b.w,y:b.y+b.h}
    ];
  }
  function hitHandle(screenPt){
    const b = selectionBounds(); if(!b) return null;
    const hs = 8; // hit tolerance in px (screen)
    const pts = handlePoints(b).map(p=>({w:p, s: worldToScreen(p)}));
    for(let i=0;i<pts.length;i++){
      const s=pts[i].s;
      if(Math.abs(screenPt.x - s.x)<=hs && Math.abs(screenPt.y - s.y)<=hs){
        return {index:i, world:pts[i].w, center:{x:b.x+b.w/2,y:b.y+b.h/2}};
      }
    }
    return null;
  }

  // distance^2 point-segment
  function dist2PointSegment(p, v, w){
    const l2=(w.x-v.x)*(w.x-v.x)+(w.y-v.y)*(w.y-v.y); if(l2===0) return (p.x-v.x)**2+(p.y-v.y)**2;
    let t=((p.x-v.x)*(w.x-v.x)+(p.y-v.y)*(w.y-v.y))/l2; t=Math.max(0,Math.min(1,t));
    const proj={x: v.x+t*(w.x-v.x), y: v.y+t*(w.y-v.y)};
    return (p.x-proj.x)**2+(p.y-proj.y)**2;
  }
  function nearStroke(pt, s, tol){
    const tol2 = (tol*tol);
    for(let i=1;i<s.points.length;i++){
      if(dist2PointSegment(pt, s.points[i-1], s.points[i])<=tol2) return true;
    }
    return false;
  }

  /* ========= HISTORY ========= */
  function snapshot(){
    return JSON.stringify({
      objects:state.objects,
      windows: state.windows.map(w=>{
        const content = w.el.querySelector('.tw-content');
        return {x:w.x,y:w.y,w:w.w,h:w.h,minimized:w.minimized, maximized:w.el.hasAttribute('data-max'),
                scroll:{top:content.scrollTop,left:content.scrollLeft}, html: content.innerHTML};
      })
    });
  }
  function recordHistorySnapshot(serialized){
    state.history.push(serialized);
    if(state.history.length>150) state.history.shift();
    state.future=[];
  }
  function pushHistory(){ recordHistorySnapshot(snapshot()); }
  function restoreSnapshot(serialized){
    const saved = JSON.parse(serialized);
    state.objects = saved.objects||[];
    for(const w of [...state.windows]){ if(w.ro) w.ro.disconnect(); w.el.remove(); }
    state.windows=[];
    if(saved.windows){
      for(const w of saved.windows){
        createTaskWindow({
          x:w.x,y:w.y,w:w.w,h:w.h,html:w.html,
          minimized:!!w.minimized,maximized:!!w.maximized,scroll:w.scroll,
          recordHistory:false
        });
      }
    }
    clearSelection(); closeEditor(); draw();
  }
  function undo(){
    cancelActiveEditor();
    if(!state.history.length) return;
    state.future.push(snapshot());
    restoreSnapshot(state.history.pop());
  }
  function redo(){
    cancelActiveEditor();
    if(!state.future.length) return;
    state.history.push(snapshot());
    restoreSnapshot(state.future.pop());
  }

  /* ========= SELECTION ========= */
  function clearSelection(){ state.selectionSet.clear(); }
  function selectOnly(idx){ state.selectionSet.clear(); if(idx!=null) state.selectionSet.add(idx); }
  function selectByRect(rx,ry,rw,rh){
    state.selectionSet.clear();
    const r={x:rx,y:ry,w:rw,h:rh};
    for(let i=0;i<state.objects.length;i++){
      const o=state.objects[i]; const ob=objectBounds(o); if(!ob) continue;
      if(rectsIntersect(r, ob)) state.selectionSet.add(i);
    }
  }

  // Usuwa zaznaczone elementy — używane przez Delete/Backspace oraz przycisk X.
  function deleteSelection(){
    if(state.editor) return false;
    if(!state.selectionSet.size) return false;
    pushHistory();
    state.objects = state.objects.filter((_,i)=>!state.selectionSet.has(i));
    clearSelection();
    closeEditor();
    draw();
    return true;
  }

  /* ========= TRANSFORM SNAPSHOTS ========= */
  function snapshotSelected(){
    const snap=[];
    for(const idx of state.selectionSet){
      const o = state.objects[idx];
      if(o.type==='text'){ snap.push({idx, type:'text', x:o.x, y:o.y, size:o.size}); }
      else if(o.type==='stroke'){ snap.push({idx, type:'stroke', points: o.points.map(p=>({x:p.x,y:p.y}))}); }
    }
    return snap;
  }
  function applySnapshotDelta(snap, dx, dy){
    for(const s of snap){
      const o = state.objects[s.idx]; if(!o) continue;
      if(s.type==='text'){ o.x = s.x + dx; o.y = s.y + dy; }
      else if(s.type==='stroke'){ o.points = s.points.map(p=>({x:p.x+dx, y:p.y+dy})); }
    }
  }
  function applySnapshotScale(snap, cx, cy, k){
    k = Math.max(0.2, Math.min(5, k));
    for(const s of snap){
      const o = state.objects[s.idx]; if(!o) continue;
      if(s.type==='text'){
        o.x = cx + (s.x - cx) * k;
        o.y = cy + (s.y - cy) * k;
        o.size = Math.max(8, Math.round(s.size * k));
      } else if(s.type==='stroke'){
        o.points = s.points.map(p=>({x: cx + (p.x - cx)*k, y: cy + (p.y - cy)*k}));
      }
    }
  }

  /* ========= TEXT EDITOR (inline) ========= */
  function openEditor(worldPt, objIndex){
    cancelActiveEditor();

    const beforeSnapshot = snapshot();
    const isNewObject = objIndex==null;
    let targetObj;
    if(objIndex!=null){
      targetObj = state.objects[objIndex];
    } else {
      targetObj = { type:'text', x:worldPt.x, y:worldPt.y, text:'', size:state.sizeText, color:state.color };
      state.objects.push(targetObj);
      objIndex = state.objects.length - 1;
      selectOnly(objIndex);
    }
    // Zostawiamy zaznaczenie, żeby ramka była widoczna podczas edycji
    selectOnly(objIndex);

    const ed = document.createElement('div');
    ed.className = 'inline-editor';
    ed.contentEditable = 'true';
    ed.spellcheck = false;
    ed.style.color = targetObj.color;
    ed.style.font = `${targetObj.size*state.scale}px Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ed.style.lineHeight = '1.25';
    ed.dataset.objIndex = String(objIndex);
    ed.textContent = targetObj.text || '';

    const place = () => {
      const pos = worldToScreen({x:targetObj.x, y:targetObj.y});
      ed.style.left = Math.round(pos.x) + 'px';
      ed.style.top  = Math.round(pos.y) + 'px';
      ed.style.fontSize = (targetObj.size * state.scale) + 'px';
    };
    // Zarejestruj edytor PRZED pierwszym rysowaniem, aby canvas nie narysował tekstu (brak cienia)
    const originalObject = isNewObject ? null : JSON.parse(JSON.stringify(targetObj));
    let dirty = isNewObject;
    let finished = false;
    let onDocPointerDown = null;
    const markDirty = () => { dirty = true; };
    state.editor = { el: ed, objIndex, place, markDirty };
    place();
    draw();
    document.body.appendChild(ed);

    const cleanup = () => {
      if(onDocPointerDown) document.removeEventListener('pointerdown', onDocPointerDown);
      closeEditor();
    };

    const commit = () => {
      if(finished) return;
      const txt = (ed.innerText || '').replace(/\u00A0/g,' ').replace(/\u200B/g,'').trimEnd();
      if(txt !== targetObj.text) markDirty();
      targetObj.text = txt;
      if(!targetObj.text.trim()){
        // Remove empty object
        const idx = state.objects.indexOf(targetObj);
        if(idx>=0){ state.objects.splice(idx,1); }
        clearSelection();
      } else {
        selectOnly(objIndex);
        setTool('select');
      }
      const changed = isNewObject
        ? state.objects.includes(targetObj)
        : dirty && JSON.stringify(targetObj) !== JSON.stringify(originalObject);
      if(changed) recordHistorySnapshot(beforeSnapshot);
      finished = true;
      cleanup(); draw();
    };

    const cancel = () => {
      if(finished) return;
      finished = true;
      if(isNewObject){
        const idx = state.objects.indexOf(targetObj);
        if(idx>=0) state.objects.splice(idx,1);
        clearSelection();
      } else {
        Object.keys(targetObj).forEach(key=>delete targetObj[key]);
        Object.assign(targetObj, originalObject);
        selectOnly(objIndex);
      }
      cleanup(); draw();
    };
    state.editor.cancel=cancel;

    const onInput = () => {
      const nextText = (ed.innerText || '').replace(/\u00A0/g,' ').replace(/\u200B/g,'');
      if(nextText !== targetObj.text) markDirty();
      targetObj.text = nextText;
      draw();
      autoSize();
    };

    const autoSize = () => {
      // Width grows naturally until max-width; keep position aligned.
      // Height grows with content line count automatically.
      // No extra logic needed beyond relayout against world coords.
      place();
    };

    // Ensure a visible caret when empty
    if(!ed.textContent){ ed.textContent = '\u200B'; }
    ed.addEventListener('input', onInput);
    ed.addEventListener('keydown', (e)=>{
      if(e.key==='Escape'){ e.preventDefault(); cancel(); }
      // Ctrl/Cmd+Enter = commit
      if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='enter'){ e.preventDefault(); commit(); }
    });
    ed.addEventListener('blur', commit);

    // Don't close when clicking inside editor
    ed.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); });
    // Finish when clicking outside the editor (register after current event cycle)
    onDocPointerDown = (e)=>{ if(!ed.contains(e.target)){ commit(); } };
    setTimeout(()=>{ document.addEventListener('pointerdown', onDocPointerDown, { once:true }); }, 0);

    // Set initial minimum height for caret visibility
    ed.style.minHeight = Math.round(targetObj.size * state.scale * 1.25) + 'px';
    setTimeout(()=>{ ed.focus(); place(); }, 0);
  }
  function closeEditor(){ if(state.editor){ state.editor.el.remove(); state.editor=null; } }
  function cancelActiveEditor(){
    if(!state.editor) return;
    if(typeof state.editor.cancel==='function') state.editor.cancel();
    else closeEditor();
  }

  /* ========= ERASER ========= */
  function startEraseStroke(pt){
    const stroke={type:'stroke', color:'#ffffff', size:state.sizeEraser, points:[pt]};
    state.objects.push(stroke); return stroke;
  }
  function eraseTextsAt(pt){
    const r = state.sizeEraser / state.scale;
    for(let i=state.objects.length-1;i>=0;i--){
      const o=state.objects[i]; if(o.type!=='text') continue;
      const b=textBounds(o);
      if(pt.x>=b.x-r && pt.x<=b.x+b.w+r && pt.y>=b.y-r && pt.y<=b.y+b.h+r){ state.objects.splice(i,1); }
    }
  }

  /* ========= HIT TEST ========= */
  function hitObject(pt){
    for(let i=state.objects.length-1;i>=0;i--){
      const o=state.objects[i];
      if(o.type==='text'){
        const r=textBounds(o);
        if(pt.x>=r.x-6 && pt.x<=r.x+r.w+6 && pt.y>=r.y-6 && pt.y<=r.y+r.h+6) return i;
      } else if(o.type==='stroke'){
        const b=strokeBounds(o); const tol=6/state.scale;
        if(pt.x>=b.x-tol && pt.x<=b.x+b.w+tol && pt.y>=b.y-tol && pt.y<=b.y+b.h+tol){
          if(nearStroke(pt,o,tol)) return i;
        }
      }
    }
    return null;
  }

  /* ========= POINTER ========= */
  let currentStroke=null;

  function onPointerDown(e){
    if(state.editor) return; // nie rysuj pod edytorem
    const rect=canvas.getBoundingClientRect();
    const ptS={x:e.clientX-rect.left, y:e.clientY-rect.top};
    const pt=screenToWorld(ptS);

    // SPACE lub Ręka -> pan
    if(state.spaceDown || state.tool==='pan'){
      state.activePointer=e.pointerId; canvas.setPointerCapture(e.pointerId);
      state.dragging=true; state.dragContext={mode:'pan', start:{x:e.clientX,y:e.clientY}, pan:{...state.pan}};
      updateCursor(); status('Przesuwanie...'); draw(); return;
    }

    // SELECTION: najpierw uchwyt skali
    if(state.tool==='select' && state.selectionSet.size){
      const hh = hitHandle({x:e.clientX, y:e.clientY});
      if(hh){
        pushHistory();
        state.activePointer=e.pointerId; canvas.setPointerCapture(e.pointerId);
        state.dragging=true;
        state.dragContext={mode:'scale-selection', center:hh.center, startLen:Math.hypot(hh.world.x-hh.center.x, hh.world.y-hh.center.y)||1, snapshot:snapshotSelected()};
        return;
      }
    }

    if(state.tool==='pencil'){
      pushHistory();
      state.activePointer=e.pointerId; canvas.setPointerCapture(e.pointerId);
      currentStroke={type:'stroke', color:state.color, size:state.sizeStroke, points:[pt]};
      state.objects.push(currentStroke); state.drawing=true; draw(); return;
    }

    if(state.tool==='eraser'){
      pushHistory();
      state.activePointer=e.pointerId; canvas.setPointerCapture(e.pointerId);
      eraseTextsAt(pt);
      currentStroke=startEraseStroke(pt); state.drawing=true; draw(); return;
    }

    if(state.tool==='text'){
      const idx=hitObject(pt);
      if(idx!=null && state.objects[idx].type==='text'){ openEditor({x:state.objects[idx].x,y:state.objects[idx].y}, idx); }
      else{ openEditor(pt,null); }
      return;
    }

    if(state.tool==='select'){
      const idx = hitObject(pt);
      if(idx!=null){
        const already = state.selectionSet.has(idx);
        if(e.shiftKey){ if(already) state.selectionSet.delete(idx); else state.selectionSet.add(idx); }
        else { if(!already) selectOnly(idx); } // klik w zaznaczony nie zawęża
        pushHistory();
        state.activePointer=e.pointerId; canvas.setPointerCapture(e.pointerId);
        state.dragging=true; state.dragContext={mode:'move-selection', startWorld:pt, snapshot: snapshotSelected()};
        draw(); return;
      } else {
        // klik wewnątrz ramki selekcji = ruch grupy
        const b = selectionBounds();
        if(b && pointInRect(pt, b, 0)){
          pushHistory();
          state.activePointer=e.pointerId; canvas.setPointerCapture(e.pointerId);
          state.dragging=true; state.dragContext={mode:'move-selection', startWorld:pt, snapshot: snapshotSelected()};
          draw(); return;
        }
        // poza selekcją -> marquee (single-click = odznacz)
        state.marquee={start:pt, current:pt, active:true, moved:false};
        draw(); return;
      }
    }
  }

  function onPointerMove(e){
    if(state.activePointer!==e.pointerId) {
      // marquee nie używa capture
      if(state.marquee && state.marquee.active){
        const rect=canvas.getBoundingClientRect();
        const ptS={x:e.clientX-rect.left, y:e.clientY-rect.top};
        const pt=screenToWorld(ptS);
        // zaznaczanie prostokątem
        const dx=Math.abs(pt.x - state.marquee.start.x);
        const dy=Math.abs(pt.y - state.marquee.start.y);
        if(dx>2 || dy>2) state.marquee.moved = true;
        state.marquee.current = pt;
        const sx = Math.min(state.marquee.start.x, pt.x);
        const sy = Math.min(state.marquee.start.y, pt.y);
        const sw = Math.abs(state.marquee.start.x - pt.x);
        const sh = Math.abs(state.marquee.start.y - pt.y);
        selectByRect(sx,sy,sw,sh); draw();
      }
      return;
    }
    const rect=canvas.getBoundingClientRect();
    const ptS={x:e.clientX-rect.left, y:e.clientY-rect.top};
    const pt=screenToWorld(ptS);

    if(state.drawing){
      if(state.tool==='pencil' && currentStroke){ currentStroke.points.push(pt); draw(); }
      else if(state.tool==='eraser' && currentStroke){ eraseTextsAt(pt); currentStroke.points.push(pt); draw(); }
      return;
    }
    if(state.dragging && state.dragContext){
      if(state.dragContext.mode==='pan'){
        const dx=e.clientX-state.dragContext.start.x; const dy=e.clientY-state.dragContext.start.y;
        state.pan.x=state.dragContext.pan.x+dx; state.pan.y=state.dragContext.pan.y+dy; draw(); updateCursor(); return;
      }
      if(state.dragContext.mode==='move-selection'){
        const dx = pt.x - state.dragContext.startWorld.x;
        const dy = pt.y - state.dragContext.startWorld.y;
        applySnapshotDelta(state.dragContext.snapshot, dx, dy); draw(); return;
      }
      if(state.dragContext.mode==='scale-selection'){
        const curLen = Math.hypot(pt.x - state.dragContext.center.x, pt.y - state.dragContext.center.y) || 0.001;
        const k = curLen / state.dragContext.startLen;
        applySnapshotScale(state.dragContext.snapshot, state.dragContext.center.x, state.dragContext.center.y, k); draw(); return;
      }
    }
  }

  function onPointerUp(e){
    if(state.activePointer===e.pointerId){
      state.drawing=false; state.dragging=false; state.dragContext=null;
      canvas.releasePointerCapture(e.pointerId);
    }
    if(state.marquee){
      if(state.marquee.active && !state.marquee.moved){
        // pojedynczy klik w pusty obszar -> odznacz
        clearSelection(); draw();
      }
      state.marquee=null;
    }
    currentStroke=null; state.activePointer=null;
    updateCursor(); status('Gotowe.'); draw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  // Dblclick = szybka edycja istniejącego tekstu
  canvas.addEventListener('dblclick',(e)=>{
    const rect=canvas.getBoundingClientRect();
    const ptS={x:e.clientX-rect.left, y:e.clientY-rect.top};
    const pt=screenToWorld(ptS);
    const idx=hitObject(pt);
    if(idx!=null && state.objects[idx].type==='text'){
      const obj=state.objects[idx]; openEditor({x:obj.x,y:obj.y}, idx);
    }
  });

  /* ========= KEYBOARD ========= */
  window.addEventListener('keydown',(e)=>{
    if(e.key===' '){ state.spaceDown=true; updateCursor(); }
    if(!state.editor){
      if(e.key.toLowerCase()==='s') setTool('select');
      if(e.key.toLowerCase()==='p') setTool('pencil');
      if(e.key.toLowerCase()==='e') setTool('eraser');
      if(e.key.toLowerCase()==='t') setTool('text');
      if(e.key.toLowerCase()==='h' || e.key.toLowerCase()==='r') setTool('pan');
      if(e.key==='['){ size.value = clamp(+size.value-1, 1, 100); size.dispatchEvent(new Event('input')); }
      if(e.key===']'){ size.value = clamp(+size.value+1, 1, 100); size.dispatchEvent(new Event('input')); }
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); undo(); }
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='y'){ e.preventDefault(); redo(); }
      if(e.key==='Delete' || e.key==='Backspace'){
        if(deleteSelection()) e.preventDefault();
      }
    }
  });
  window.addEventListener('keyup', (e)=>{ if(e.key===' '){ state.spaceDown=false; updateCursor(); } });

  /* ========= TASK WINDOWS ========= */
  document.getElementById('addTaskWindow').addEventListener('click', ()=>{
    const center=screenToWorld({x:window.innerWidth/2, y:window.innerHeight/2});
    createTaskWindow({x:center.x-260,y:center.y-180,w:520,h:360});
  });

  function createTaskWindow({x=0,y=0,w=520,h=360, html='', minimized=false, maximized=false, scroll=null, cards=null, recordHistory=true}){
    x=clamp(Number(x)||0, -1000000, 1000000); y=clamp(Number(y)||0, -1000000, 1000000);
    w=clamp(Number(w)||520, 260, 2000); h=clamp(Number(h)||360, 180, 1600);
    if(recordHistory) pushHistory();
    const el=document.createElement('div'); el.className='task-window'; el.innerHTML=`
      <div class="tw-header"><span class="tw-title">Zadanie</span>
        <div class="tw-actions">
          <button data-act="min" title="Minimalizuj">–</button>
          <button data-act="max" title="Maksymalizuj">□</button>
          <button data-act="close" title="Zamknij">×</button>
        </div>
      </div>
      <div class="tw-content"><div class="drop-hint">Upuść obraz lub wklej (Ctrl+V)</div></div>`;
    const content=el.querySelector('.tw-content');
    if(html) restoreTaskContent(content, html);
    else sanitizeTaskContent(content);

    document.getElementById('stage').appendChild(el);
    const win={id:'w'+Math.random().toString(36).slice(2), x,y,w,h, minimized, el, z: ++state.zCounter, ro:null};
    el.style.width=w+'px'; el.style.height=h+'px'; el.style.zIndex=String(win.z);

    const header=el.querySelector('.tw-header');
    header.addEventListener('pointerdown', (e)=>{
      if(e.target.closest('.tw-actions')) return;
      header.setPointerCapture(e.pointerId);
      const start=screenToWorld({x:e.clientX,y:e.clientY});
      const off={x:start.x-win.x, y:start.y-win.y};
      const move=(ev)=>{ const cur=screenToWorld({x:ev.clientX,y:ev.clientY}); win.x=cur.x-off.x; win.y=cur.y-off.y; layoutWindows(); };
      const up=()=>{ header.releasePointerCapture(e.pointerId); header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', up); };
      header.addEventListener('pointermove', move); header.addEventListener('pointerup', up);
    });
    el.addEventListener('mousedown', ()=>{ bringToFront(win); });

    const btnMin = el.querySelector('[data-act="min"]');
    const btnMax = el.querySelector('[data-act="max"]');
    const btnClose = el.querySelector('[data-act="close"]');
    [btnMin,btnMax,btnClose].forEach(b=>b.addEventListener('click', ev=>ev.stopPropagation()));

    btnMin.addEventListener('click', ()=>{ win.minimized=!win.minimized; content.toggleAttribute('hidden', win.minimized); });
    btnMax.addEventListener('click', ()=>{
      if(!el.hasAttribute('data-max')){
        el.setAttribute('data-max','1');
        win.x=screenToWorld({x:10,y:78}).x; win.y=screenToWorld({x:10,y:78}).y;
        const W=window.innerWidth-20, H=window.innerHeight-96;
        win.w=W; win.h=H; el.style.width=W+'px'; el.style.height=H+'px';
      } else {
        el.removeAttribute('data-max');
        win.w=w; win.h=h; el.style.width=w+'px'; el.style.height=h+'px';
      }
      layoutWindows();
    });
    btnClose.addEventListener('click', ()=>{
      pushHistory();
      clearTaskWindowContent(content); // usuń obraz z pamięci okna
      if(win.ro) win.ro.disconnect(); el.remove();
      state.windows = state.windows.filter(w=>w!==win);
    });

    // Zoom kółkiem na obrazie
    content.addEventListener('wheel', (e)=>{
      const card = e.target.closest && e.target.closest('.tw-card.tw-image');
      if(!card) return;
      e.preventDefault();
      const img = card.querySelector('img'); if(!img) return;
      const cur = parseFloat(card.dataset.scale||'1') || 1;
      let next = cur + (e.deltaY<0 ? 0.1 : -0.1);
      next = Math.min(3, Math.max(0.5, next));
      card.dataset.scale = String(next);
      img.style.transform = `scale(${next})`;
    }, {passive:false});

    // DnD + Paste (TYLKO obrazy; jedno zdjęcie – set/replace)
    content.addEventListener('dragover', (e)=>{ e.preventDefault(); });
    content.addEventListener('drop', (e)=>{
      e.preventDefault();
      if(!e.dataTransfer) return; const files=e.dataTransfer.files; if(!files||!files.length) return;
      handleImagesIntoTask(files, content);
    });
    content.addEventListener('paste', (e)=>{
      if(!e.clipboardData) return;
      const items=e.clipboardData.items; const files=[];
      for(const it of items){
        if(it.kind==='file'){ const f=it.getAsFile(); if(f && f.type.startsWith('image/')) files.push(f); }
        // ignorujemy tekst
      }
      if(files.length){ e.preventDefault(); handleImagesIntoTask(files, content); }
    });

    if(minimized) content.setAttribute('hidden','');
    if(maximized){
      el.setAttribute('data-max','1');
      win.x=screenToWorld({x:10,y:78}).x; win.y=screenToWorld({x:10,y:78}).y;
      const W=window.innerWidth-20, H=window.innerHeight-96;
      win.w=W; win.h=H; el.style.width=W+'px'; el.style.height=H+'px';
    }
    if(scroll){ content.scrollTop = scroll.top||0; content.scrollLeft = scroll.left||0; }
    if(cards){
      const imported = Array.from(content.querySelectorAll('.tw-card.tw-image'));
      imported.forEach((card,i)=>{
        const meta = cards[i]; if(!meta) return;
        const img = card.querySelector('img');
        const safeScale = clamp(Number(meta.scale) || 1, .5, 3);
        card.dataset.scale=String(safeScale); if(img) img.style.transform = `scale(${safeScale})`;
      });
    }

    win.ro = new ResizeObserver(()=>{ const r = el.getBoundingClientRect(); win.w = r.width; win.h = r.height; });
    win.ro.observe(el);

    state.windows.push(win); layoutWindows(); bringToFront(win); return win;
  }

  /* ========= TASK HELPERS ========= */
  function safeTaskImageSource(value){
    const source = typeof value === 'string' ? value : '';
    return source.length <= MAX_TASK_IMAGE_DATA_LENGTH && SAFE_IMAGE_DATA_RE.test(source) ? source : '';
  }
  function renderTaskImage(container, source, scale=1){
    container.replaceChildren();
    const safeSource = safeTaskImageSource(source);
    if(!safeSource){ ensureDropHint(container, true); return null; }
    const safeScale = clamp(Number(scale) || 1, .5, 3);
    const card = document.createElement('div');
    card.className='tw-card tw-image'; card.dataset.type='image'; card.dataset.scale=String(safeScale);
    const body = document.createElement('div'); body.className='tw-card-body';
    const img = document.createElement('img'); img.src=safeSource; img.alt='obraz'; img.style.transform=`scale(${safeScale})`;
    body.appendChild(img); card.appendChild(body); container.appendChild(card);
    return card;
  }
  function restoreTaskContent(container, html){
    const template = document.createElement('template');
    template.innerHTML = String(html || '').slice(0, MAX_TASK_IMAGE_DATA_LENGTH + 4096);
    const card = template.content.querySelector('.tw-card.tw-image');
    const image = card && card.querySelector('img');
    renderTaskImage(container, image ? image.getAttribute('src') : '', card ? card.dataset.scale : 1);
  }
  function sanitizeTaskContent(container){
    const card = container.querySelector('.tw-card.tw-image');
    const image = card && card.querySelector('img');
    renderTaskImage(container, image ? image.getAttribute('src') : '', card ? card.dataset.scale : 1);
  }
  function clearTaskWindowContent(container){
    Array.from(container.querySelectorAll('.tw-card.tw-image')).forEach(el=>el.remove());
    ensureDropHint(container, true);
  }
  function setOrReplaceImage(container, dataUrl){
    renderTaskImage(container, dataUrl, 1);
  }
  function ensureDropHint(container, show){
    let hint = container.querySelector('.drop-hint');
    if(show){
      if(!hint){
        hint=document.createElement('div');
        hint.className='drop-hint';
        hint.textContent='Upuść obraz lub wklej (Ctrl+V)';
        container.prepend(hint);
      }
    } else {
      if(hint) hint.remove();
    }
  }
  function handleImagesIntoTask(files, container){
    for(const f of files){
      if(!f) continue;
      if(f.size <= MAX_TASK_IMAGE_BYTES && ['image/png','image/jpeg','image/webp','image/gif'].includes(f.type)){
        const r=new FileReader();
        r.onload=()=>{ setOrReplaceImage(container, r.result); };
        r.readAsDataURL(f);
        break; // jedno zdjęcie
      }
    }
  }

  function bringToFront(win){ win.z=++state.zCounter; win.el.style.zIndex=String(win.z); }
  function layoutWindows(){
    for(const w of state.windows){
      const pos=worldToScreen({x:w.x,y:w.y});
      w.el.style.left=Math.round(pos.x)+'px';
      w.el.style.top=Math.round(pos.y)+'px';
    }
  }

  /* ========= START ========= */
  resize(); setTool('pan'); syncSliderToTool(); updateCursor();
  toast('Klik w puste odznacza zaznaczenie ✅');
})();
