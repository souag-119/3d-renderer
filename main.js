// ======================================================================
// نقطة الدخول: ربط المحرك بالواجهة، تحكم الكاميرا، Gizmo، حلقة الرندر
// ======================================================================

(function(){
  const canvas = document.getElementById('viewportCanvas');
  const container = document.getElementById('viewportContainer');
  const gizmoSvg = document.getElementById('gizmoOverlay');

  let scene, engine;
  try{
    scene = new Scene();
    engine = new PathTracerEngine(canvas);
  }catch(err){
    document.body.innerHTML = `<div style="padding:40px;color:#fff;font-family:sans-serif;text-align:center">
      <h2>⚠ تعذر تشغيل محرك الرندر</h2>
      <p>${err.message}</p>
      <p style="color:#999">يتطلب هذا التطبيق دعم WebGL2. جرّب متصفحاً حديثاً مثل Chrome أو Edge.</p>
    </div>`;
    throw err;
  }

  UI.init(scene, engine);

  // ---------------- حجم الفيوبورت ----------------
  function fitViewport(){
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    const w = Math.max(64, Math.floor(rect.width*dpr));
    const h = Math.max(64, Math.floor(rect.height*dpr));
    canvas.style.width = rect.width+'px';
    canvas.style.height = rect.height+'px';
    engine.tileSize = scene.renderSettings.tileSize;
    engine.resize(w,h);
  }
  window.addEventListener('resize', fitViewport);
  fitViewport();
  setTimeout(fitViewport, 50);
  // مراقبة تغيّر حجم اللوحات (مثلاً عند فتح/إغلاق اللوحات الجانبية)
  new ResizeObserver(()=> fitViewport()).observe(container);

  // ---------------- تحكم الكاميرا (Orbit) ----------------
  let pointers = new Map();
  let lastPinchDist = null;
  let dragMode = null; // 'orbit' | 'pan' | 'gizmo'
  let dragStart = null;
  let gizmoDragAxis = null;
  let gizmoDragObj = null;
  let gizmoStartVal = null;

  function screenToNDC(x,y){
    const rect = container.getBoundingClientRect();
    return [ (x-rect.left)/rect.width*2-1, -((y-rect.top)/rect.height*2-1) ];
  }

  function projectPoint(worldPos){
    // إسقاط تقريبي (perspective) لموضع نقطة عالمية إلى شاشة الفيوبورت لأجل رسم الـ Gizmo
    const cam = scene.camera;
    const rel = [worldPos[0]-cam.pos[0], worldPos[1]-cam.pos[1], worldPos[2]-cam.pos[2]];
    const camZ = dot3(rel, cam.forward);
    if(camZ <= 0.01) return null;
    const camX = dot3(rel, cam.right);
    const camY = dot3(rel, cam.up);
    const tanFov = Math.tan(cam.fov*Math.PI/180*0.5);
    const rect = container.getBoundingClientRect();
    const aspect = rect.width/rect.height;
    const ndcX = camX/(camZ*tanFov*aspect);
    const ndcY = camY/(camZ*tanFov);
    const sx = (ndcX*0.5+0.5)*rect.width;
    const sy = (1-(ndcY*0.5+0.5))*rect.height;
    return [sx,sy,camZ];
  }
  function dot3(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

  container.addEventListener('pointerdown', (e)=>{
    container.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, {x:e.clientX,y:e.clientY});

    if(pointers.size===1){
      // تحقق أولاً إن كان النقر على مقبض Gizmo
      const axis = hitTestGizmo(e.clientX, e.clientY);
      if(axis){
        dragMode = 'gizmo';
        gizmoDragAxis = axis;
        gizmoDragObj = scene.getSelected();
        dragStart = {x:e.clientX, y:e.clientY};
        gizmoStartVal = {
          pos:[...gizmoDragObj.position],
          rot:[...gizmoDragObj.rotation],
          scale:[...gizmoDragObj.scaleXYZ]
        };
      } else {
        dragMode = e.shiftKey ? 'pan' : 'orbit';
        dragStart = {x:e.clientX, y:e.clientY, yaw:scene.camera.yaw, pitch:scene.camera.pitch, target:[...scene.camera.target]};
      }
    }
  });

  container.addEventListener('pointermove', (e)=>{
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {x:e.clientX,y:e.clientY});

    if(pointers.size===2){
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      if(lastPinchDist!=null){
        const delta = dist-lastPinchDist;
        scene.camera.distance = Math.max(0.5, scene.camera.distance - delta*0.02);
        scene.camera.update();
        UI.onSceneChanged();
      }
      lastPinchDist = dist;
      return;
    }

    if(dragMode==='orbit'){
      const dx = e.clientX-dragStart.x, dy = e.clientY-dragStart.y;
      scene.camera.yaw = dragStart.yaw - dx*0.008;
      scene.camera.pitch = Math.max(-1.5,Math.min(1.5, dragStart.pitch + dy*0.008));
      scene.camera.update();
      UI.onSceneChanged();
    } else if(dragMode==='pan'){
      const dx = e.clientX-dragStart.x, dy = e.clientY-dragStart.y;
      const cam = scene.camera;
      const panX = cam.right.map(v=>v*(-dx*0.005));
      const panY = cam.up.map(v=>v*(dy*0.005));
      scene.camera.target = [
        dragStart.target[0]+panX[0]+panY[0],
        dragStart.target[1]+panX[1]+panY[1],
        dragStart.target[2]+panX[2]+panY[2]
      ];
      scene.camera.update();
      UI.onSceneChanged();
    } else if(dragMode==='gizmo' && gizmoDragObj){
      applyGizmoDrag(e);
    }
  });

  function endDrag(e){
    if(pointers.has(e.pointerId)) pointers.delete(e.pointerId);
    if(pointers.size<2) lastPinchDist=null;
    if(pointers.size===0){
      dragMode=null; gizmoDragAxis=null; gizmoDragObj=null;
    }
  }
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);

  container.addEventListener('wheel', (e)=>{
    e.preventDefault();
    scene.camera.distance = Math.max(0.5, Math.min(60, scene.camera.distance + e.deltaY*0.01));
    scene.camera.update();
    UI.onSceneChanged();
  }, {passive:false});

  // نقر بسيط لاختيار عنصر (يستخدم اسقاط تقريبي للمسافة من مركز الأجسام)
  let clickStartPos = null;
  container.addEventListener('pointerdown', (e)=>{ clickStartPos = {x:e.clientX,y:e.clientY}; }, {capture:true});
  container.addEventListener('pointerup', (e)=>{
    if(!clickStartPos) return;
    const moved = Math.hypot(e.clientX-clickStartPos.x, e.clientY-clickStartPos.y);
    if(moved < 6 && dragMode !== 'gizmo'){
      trySelectAtScreen(e.clientX, e.clientY);
    }
  });

  function trySelectAtScreen(sx,sy){
    let best=null, bestDist=28;
    for(const o of scene.objects){
      const p = projectPoint(o.position);
      if(!p) continue;
      const d = Math.hypot(p[0]-(sx-container.getBoundingClientRect().left), p[1]-(sy-container.getBoundingClientRect().top));
      if(d<bestDist){ bestDist=d; best=o; }
    }
    if(best){
      scene.selectedId = best.id;
    } else {
      scene.selectedId = null;
    }
    UI.refreshSceneTree();
    UI.refreshSelection();
  }

  // ---------------- Gizmo drawing & interaction ----------------
  const AXIS_COLORS = {x:'#ff5b6a', y:'#4dd68c', z:'#5b8cff'};
  let gizmoHandles = []; // {axis, x1,y1,x2,y2, type}

  function drawGizmo(){
    gizmoSvg.innerHTML = '';
    gizmoHandles = [];
    const o = scene.getSelected();
    if(!o) return;
    const center = projectPoint(o.position);
    if(!center) return;
    const mode = window.__gizmoMode||'translate';
    const rect = container.getBoundingClientRect();
    gizmoSvg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);

    const axes = [
      {axis:'x', dir:[1,0,0]},
      {axis:'y', dir:[0,1,0]},
      {axis:'z', dir:[0,0,1]}
    ];
    const handleLen = 70;

    // مركز التحديد
    const ns = 'http://www.w3.org/2000/svg';
    const centerDot = document.createElementNS(ns,'circle');
    centerDot.setAttribute('cx',center[0]); centerDot.setAttribute('cy',center[1]);
    centerDot.setAttribute('r',5); centerDot.setAttribute('fill','#fff');
    centerDot.setAttribute('stroke','#000'); centerDot.setAttribute('stroke-width','1');
    gizmoSvg.appendChild(centerDot);

    if(mode==='translate' || mode==='scale'){
      axes.forEach(({axis,dir})=>{
        const worldEnd = [o.position[0]+dir[0]*0.9, o.position[1]+dir[1]*0.9, o.position[2]+dir[2]*0.9];
        const p2 = projectPoint(worldEnd);
        if(!p2) return;
        const line = document.createElementNS(ns,'line');
        line.setAttribute('x1',center[0]); line.setAttribute('y1',center[1]);
        line.setAttribute('x2',p2[0]); line.setAttribute('y2',p2[1]);
        line.setAttribute('stroke',AXIS_COLORS[axis]);
        line.setAttribute('stroke-width','4');
        line.setAttribute('stroke-linecap','round');
        gizmoSvg.appendChild(line);

        const handleShape = mode==='scale' ? 'rect' : 'circle';
        const handle = document.createElementNS(ns, handleShape);
        if(handleShape==='circle'){
          handle.setAttribute('cx',p2[0]); handle.setAttribute('cy',p2[1]); handle.setAttribute('r',9);
        } else {
          handle.setAttribute('x',p2[0]-7); handle.setAttribute('y',p2[1]-7);
          handle.setAttribute('width',14); handle.setAttribute('height',14);
        }
        handle.setAttribute('fill',AXIS_COLORS[axis]);
        handle.setAttribute('stroke','#fff'); handle.setAttribute('stroke-width','1.5');
        gizmoSvg.appendChild(handle);

        gizmoHandles.push({axis, x:p2[0], y:p2[1], mode});
      });
    } else if(mode==='rotate'){
      // حلقات دوران مبسطة كدوائر لكل محور حول المركز
      axes.forEach(({axis})=>{
        const ring = document.createElementNS(ns,'circle');
        ring.setAttribute('cx',center[0]); ring.setAttribute('cy',center[1]);
        const r = axis==='x'?55:(axis==='y'?42:30);
        ring.setAttribute('r', r);
        ring.setAttribute('fill','none');
        ring.setAttribute('stroke',AXIS_COLORS[axis]);
        ring.setAttribute('stroke-width','3');
        ring.setAttribute('stroke-dasharray','4 3');
        ring.setAttribute('opacity','0.85');
        gizmoSvg.appendChild(ring);
        gizmoHandles.push({axis, x:center[0]+r, y:center[1], mode:'rotate', cx:center[0], cy:center[1], r});
      });
    }
  }

  function hitTestGizmo(sx,sy){
    const rect = container.getBoundingClientRect();
    const lx = sx-rect.left, ly = sy-rect.top;
    let best=null, bestD=22;
    for(const h of gizmoHandles){
      let d;
      if(h.mode==='rotate'){
        d = Math.abs(Math.hypot(lx-h.cx,ly-h.cy)-h.r);
      } else {
        d = Math.hypot(lx-h.x, ly-h.y);
      }
      if(d<bestD){ bestD=d; best=h.axis; }
    }
    return best;
  }

  function applyGizmoDrag(e){
    const dx = e.clientX-dragStart.x, dy = e.clientY-dragStart.y;
    const mode = window.__gizmoMode;
    const axis = gizmoDragAxis;
    const axisIdx = {x:0,y:1,z:2}[axis];

    if(mode==='translate'){
      // حركة تقريبية بالإسقاط: نستخدم يمين/أعلى الكاميرا مسقطة على المحور المطلوب
      const screenDelta = (axis==='y') ? -dy : dx;
      const sensitivity = 0.01 * (scene.camera.distance/6);
      const newVal = gizmoStartVal.pos[axisIdx] + screenDelta*sensitivity*(axis==='z'?-1:1);
      gizmoDragObj.position[axisIdx] = newVal;
    } else if(mode==='scale'){
      const screenDelta = (axis==='y') ? -dy : dx;
      const sensitivity = 0.01;
      const newVal = Math.max(0.05, gizmoStartVal.scale[axisIdx] + screenDelta*sensitivity);
      gizmoDragObj.scaleXYZ[axisIdx] = newVal;
    } else if(mode==='rotate'){
      const sensitivity = 0.01;
      const newVal = gizmoStartVal.rot[axisIdx] + dx*sensitivity;
      gizmoDragObj.rotation[axisIdx] = newVal;
    }
    UI.onSceneChanged();
    UI.refreshSelection();
  }

  // ---------------- حلقة الرندر الرئيسية (المعاينة الحية) ----------------
  let fpsCounter = {frames:0, last:performance.now(), value:0};

  function liveLoop(){
    requestAnimationFrame(liveLoop);
    if(engine.needsReset){
      engine.reset();
    }
    if(!document.getElementById('outputModal').classList.contains('hidden')){
      // النافذة المنبثقة مفتوحة: لا داعي لتحديث الفيوبورت الخلفي بكثافة
      drawGizmo();
      return;
    }
    const info = engine.renderTileStep(scene);
    engine.present(scene.renderSettings.denoiser, scene.renderSettings.denoiserStrength);
    drawGizmo();

    fpsCounter.frames++;
    const now = performance.now();
    if(now-fpsCounter.last>500){
      fpsCounter.value = fpsCounter.frames/((now-fpsCounter.last)/1000);
      fpsCounter.frames=0; fpsCounter.last=now;
      document.getElementById('fpsCounter').textContent = fpsCounter.value.toFixed(0)+' FPS';
    }
  }
  requestAnimationFrame(liveLoop);

  // ---------------- الرندر النهائي (نافذة الإخراج) ----------------
  const outputCanvas = document.getElementById('outputCanvas');
  let outputEngine = null;
  let renderCancelled = false;
  let lastRenderedBlob = null;

  window.__cancelRenderFn = ()=>{ renderCancelled = true; };

  document.getElementById('btnStartRender').addEventListener('click', async ()=>{
    const resSel = document.getElementById('outputRes').value;
    let w,h;
    if(resSel==='custom'){
      w = parseInt(document.getElementById('customW').value)||1280;
      h = parseInt(document.getElementById('customH').value)||720;
    } else {
      [w,h] = resSel.split('x').map(Number);
    }
    const totalSamples = parseInt(document.getElementById('outSamples').value);

    outputCanvas.width = w; outputCanvas.height = h;
    outputCanvas.style.width = Math.min(w, 760)+'px';
    outputCanvas.style.height = 'auto';

    if(!outputEngine){
      outputEngine = new PathTracerEngine(outputCanvas);
    }
    outputEngine.tileSize = 9999; // إطار كامل كل مرة داخل نافذة الإخراج (تراكم بالعينات)
    outputEngine.resize(w,h);
    outputEngine.reset();

    document.getElementById('btnStartRender').classList.add('hidden');
    document.getElementById('btnCancelRender').classList.remove('hidden');
    document.getElementById('btnSaveRender').disabled = true;
    renderCancelled = false;

    for(let s=0; s<totalSamples; s++){
      if(renderCancelled) break;
      outputEngine.renderFullFrame(scene);
      outputEngine.present(scene.renderSettings.denoiser, scene.renderSettings.denoiserStrength);
      const pct = Math.round(((s+1)/totalSamples)*100);
      UI.setRenderProgress(pct, `جاري الرندر... ${s+1}/${totalSamples} عينة`);
      // اسمح للمتصفح بالتحديث المرئي
      await new Promise(r=>requestAnimationFrame(r));
    }

    document.getElementById('btnStartRender').classList.remove('hidden');
    document.getElementById('btnCancelRender').classList.add('hidden');
    document.getElementById('btnSaveRender').disabled = false;
    UI.setRenderProgress(renderCancelled?0:100, renderCancelled?'تم الإيقاف':'اكتمل الرندر ✔');
    UI.toast(renderCancelled?'تم إيقاف الرندر':'اكتمل الرندر بنجاح');
  });

  document.getElementById('btnCancelRender').addEventListener('click', ()=>{
    renderCancelled = true;
  });

  document.getElementById('btnSaveRender').addEventListener('click', ()=>{
    outputCanvas.toBlob((blob)=>{
      if(!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'render_'+Date.now()+'.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
      UI.toast('تم حفظ الصورة');
    }, 'image/png');
  });

})();
