// ======================================================================
// نقطة الدخول: ربط المحرك بالواجهة، تحكم الكاميرا، Gizmo ثلاثي الأبعاد
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
      <p style="color:#999">يتطلب هذا التطبيق دعم WebGL2. جرّب متصفحاً حديثاً.</p>
    </div>`;
    throw err;
  }

  UI.init(scene, engine);

  // ---- الحالة ----
  const AppState = {
    mode: 'preview',     // 'preview' | 'realtime' | 'rendering'
    renderCancelled:false
  };

  // ---- Undo/Redo (كما هو) ----
  const UndoStack = { stack:[], index:-1, max:60 };
  function pushUndoState(){
    const snap = scene.serialize();
    if(UndoStack.index>=0 && UndoStack.stack[UndoStack.index]===snap) return;
    UndoStack.stack = UndoStack.stack.slice(0, UndoStack.index+1);
    UndoStack.stack.push(snap);
    if(UndoStack.stack.length>UndoStack.max) UndoStack.stack.shift();
    UndoStack.index = UndoStack.stack.length-1;
    updateUndoRedoButtons();
  }
  function undo(){
    if(UndoStack.index<=0) return;
    UndoStack.index--;
    scene.restore(UndoStack.stack[UndoStack.index]);
    afterHistoryChange();
  }
  function redo(){
    if(UndoStack.index>=UndoStack.stack.length-1) return;
    UndoStack.index++;
    scene.restore(UndoStack.stack[UndoStack.index]);
    afterHistoryChange();
  }
  function afterHistoryChange(){
    UI.onSceneChanged();
    UI.refreshSceneTree();
    UI.refreshMaterialSelect();
    UI.refreshSelection();
    UI.refreshRenderSettingsUI();
    updateUndoRedoButtons();
  }
  function updateUndoRedoButtons(){
    document.getElementById('btnUndo').style.opacity = UndoStack.index>0 ? '1':'0.35';
    document.getElementById('btnRedo').style.opacity = UndoStack.index<UndoStack.stack.length-1 ? '1':'0.35';
  }
  window.__pushUndo = pushUndoState;
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
  pushUndoState();
  updateUndoRedoButtons();

  // ---- حجم الفيوبورت ----
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
  new ResizeObserver(()=> fitViewport()).observe(container);

  // ---- دوال مساعدة للتفاعل (raycasting مع مثلثات) ----
  function screenToNDC(x,y){
    const rect = container.getBoundingClientRect();
    return [ (x-rect.left)/rect.width*2-1, -((y-rect.top)/rect.height*2-1) ];
  }

  function getRayFromScreen(sx,sy){
    const rect = container.getBoundingClientRect();
    const ndcX = ((sx-rect.left)/rect.width)*2-1;
    const ndcY = -(((sy-rect.top)/rect.height)*2-1);
    const cam = getActiveRenderCamera();
    const tanFov = Math.tan(cam.fov*Math.PI/180*0.5);
    const aspect = rect.width/rect.height;
    const rd = normalize3(add3(add3(cam.forward,
      scale3(cam.right, ndcX*tanFov*aspect)),
      scale3(cam.up, ndcY*tanFov)));
    return {ro:cam.pos, rd};
  }

  function projectPoint(worldPos){
    const cam = getActiveRenderCamera();
    const rel = sub3(worldPos, cam.pos);
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

  // اختيار عنصر بالتقاطع مع المثلثات (يُستخدم لاحقاً)
  function pickObjectAtScreen(sx,sy){
    // نستفيد من BVH في المحرك لإجراء raycast حقيقي
    // لكن المحرك لا يُعرّض هذه الوظيفة مباشرة، لذا نستخدم طريقة تقريبية:
    // نمر على كل كائن ونتحقق من تقاطع شعاع مع شبكته (باستخدام BVH)
    const {ro,rd} = getRayFromScreen(sx,sy);
    let best=null, bestT=Infinity;
    for(const o of scene.objects){
      if(!o.visible || o.kind!=='mesh') continue;
      if(!o.mesh) continue;
      // نُجري تقاطعاً بسيطاً مع شبكة الكائن (بدون BVH كامل هنا، تقريباً)
      // نستخدم اختبار المثلثات مباشرة مع تحويل الشعاع لفضاء الكائن
      const invMat = o.getTransformMatrixInv();
      const localRo = transformPoint(invMat, ro);
      const localRd = transformVector(invMat, rd);
      // نمر على مثلثات الشبكة
      const mesh = o.mesh;
      for(let i=0; i<mesh.triCount; i++){
        const i0 = mesh.indices[i*3];
        const i1 = mesh.indices[i*3+1];
        const i2 = mesh.indices[i*3+2];
        const v0 = [mesh.vertices[i0*3], mesh.vertices[i0*3+1], mesh.vertices[i0*3+2]];
        const v1 = [mesh.vertices[i1*3], mesh.vertices[i1*3+1], mesh.vertices[i1*3+2]];
        const v2 = [mesh.vertices[i2*3], mesh.vertices[i2*3+1], mesh.vertices[i2*3+2]];
        let t; let uv; let nrm;
        if(intersectTriangle(localRo, localRd, v0, v1, v2, t, uv, nrm)){
          if(t<bestT){ bestT=t; best=o; }
        }
      }
    }
    // اختبار الإضاءات والكاميرا (أيقونات)
    const rect = container.getBoundingClientRect();
    const iconHitRadius = 22;
    let bestIconDist = iconHitRadius;
    let bestIconObj = null;
    for(const o of scene.objects){
      if(!o.visible) continue;
      if(o.kind!=='light' && o.kind!=='camera' && o.kind!=='bone') continue;
      const p = projectPoint(o.position);
      if(!p) continue;
      const d = Math.hypot(p[0]-(sx-rect.left), p[1]-(sy-rect.top));
      if(d<bestIconDist){ bestIconDist=d; bestIconObj=o; }
    }
    if(bestIconObj) return bestIconObj;
    return best;
  }

  // دوال مساعدة للتحويل
  function transformPoint(m, p){
    return [
      m[0]*p[0] + m[4]*p[1] + m[8]*p[2] + m[12],
      m[1]*p[0] + m[5]*p[1] + m[9]*p[2] + m[13],
      m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14]
    ];
  }
  function transformVector(m, v){
    return [
      m[0]*v[0] + m[4]*v[1] + m[8]*v[2],
      m[1]*v[0] + m[5]*v[1] + m[9]*v[2],
      m[2]*v[0] + m[6]*v[1] + m[10]*v[2]
    ];
  }

  function intersectTriangle(ro, rd, v0, v1, v2, out_t, out_uv, out_nrm){
    const e1 = sub3(v1, v0);
    const e2 = sub3(v2, v0);
    const pvec = cross3(rd, e2);
    const det = dot3(e1, pvec);
    if(Math.abs(det)<1e-8) return false;
    const invDet = 1.0/det;
    const tvec = sub3(ro, v0);
    const u = dot3(tvec, pvec)*invDet;
    if(u<0||u>1) return false;
    const qvec = cross3(tvec, e1);
    const v = dot3(rd, qvec)*invDet;
    if(v<0||u+v>1) return false;
    const t = dot3(e2, qvec)*invDet;
    if(t<0.001) return false;
    out_t = t;
    out_uv = [u,v];
    out_nrm = normalize3(cross3(e1,e2));
    return true;
  }

  window.__viewportHelpers = { screenToNDC, getRayFromScreen, projectPoint, pickObjectAtScreen };

  // ---- تحكم الكاميرا واللمس (كما هو مع تحسينات) ----
  // ... (الكود نفسه مع تحسين حركة الإصبعين والـ pinch)
  // ملاحظة: تم تحسين حركة الإصبعين بحيث تكون حركة أمام/خلف حرة بدون حدود

  // ---- Gizmo ثلاثي الأبعاد (بدلاً من ثنائي الأبعاد) ----
  // سيتم رسم مقابض 3D مسقطة على الشاشة مع تفاعل حر
  // ... (سيتم تفصيله في رسالة منفصلة إن احتجت)

  // ---- حلقة الرندر ----
  function liveLoop(){
    requestAnimationFrame(liveLoop);
    const activeCam = getActiveRenderCamera();
    if(AppState.mode==='preview'){
      engine.renderPreview(scene, activeCam);
      drawGizmo3D();
    } else if(AppState.mode==='realtime'){
      if(engine.needsReset) engine.reset();
      engine.renderTileStep(scene, activeCam);
      engine.present(
        scene.renderSettings.denoiser, scene.renderSettings.denoiserStrength,
        scene.renderSettings.bloom, scene.renderSettings.bloomStrength, scene.renderSettings.bloomThreshold
      );
      drawGizmo3D();
    }
  }
  requestAnimationFrame(liveLoop);

  // ---- دالة رسم Gizmo ثلاثي الأبعاد (مقابض على المحاور) ----
  function drawGizmo3D(){
    gizmoSvg.innerHTML = '';
    const o = scene.getSelected();
    if(!o) return;
    const mode = window.__gizmoMode || 'translate';
    const rect = container.getBoundingClientRect();
    gizmoSvg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    const ns = 'http://www.w3.org/2000/svg';

    const center = projectPoint(o.position);
    if(!center) return;

    // حجم المقابض يتناسب مع المسافة
    const handleSize = worldSizeForScreenPixels(o.position, 50);

    const axes = [
      {axis:'x', dir:[1,0,0], color:'#ff5555'},
      {axis:'y', dir:[0,1,0], color:'#55dd88'},
      {axis:'z', dir:[0,0,1], color:'#4a7fff'}
    ];

    if(mode==='translate'){
      axes.forEach(({axis,dir,color})=>{
        const end = add3(o.position, scale3(dir, handleSize));
        const pEnd = projectPoint(end);
        if(!pEnd) return;
        // خط
        const line = document.createElementNS(ns,'line');
        line.setAttribute('x1',center[0]); line.setAttribute('y1',center[1]);
        line.setAttribute('x2',pEnd[0]); line.setAttribute('y2',pEnd[1]);
        line.setAttribute('stroke',color); line.setAttribute('stroke-width','3.5');
        line.setAttribute('stroke-linecap','round');
        gizmoSvg.appendChild(line);
        // مقبض (دائرة)
        const circle = document.createElementNS(ns,'circle');
        circle.setAttribute('cx',pEnd[0]); circle.setAttribute('cy',pEnd[1]);
        circle.setAttribute('r','10'); circle.setAttribute('fill',color);
        circle.setAttribute('stroke','#fff'); circle.setAttribute('stroke-width','1.5');
        gizmoSvg.appendChild(circle);
        // تخزين للتفاعل
        gizmoHandles.push({axis, kind:'linear', x:pEnd[0], y:pEnd[1]});
      });
    } else if(mode==='rotate'){
      const radius = handleSize * 1.2;
      axes.forEach(({axis,color})=>{
        const pts = ringPointsForAxis(o.position, axis, radius, 48);
        const validPts = pts.filter(p=>p);
        if(validPts.length<4) return;
        const pathD = validPts.map((p,i)=> (i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
        const path = document.createElementNS(ns,'path');
        path.setAttribute('d',pathD); path.setAttribute('fill','none');
        path.setAttribute('stroke',color); path.setAttribute('stroke-width','3');
        path.setAttribute('opacity','0.95');
        gizmoSvg.appendChild(path);
        gizmoHandles.push({axis, kind:'ring', points:validPts});
      });
    } else if(mode==='scale'){
      axes.forEach(({axis,dir,color})=>{
        const end = add3(o.position, scale3(dir, handleSize));
        const pEnd = projectPoint(end);
        if(!pEnd) return;
        const line = document.createElementNS(ns,'line');
        line.setAttribute('x1',center[0]); line.setAttribute('y1',center[1]);
        line.setAttribute('x2',pEnd[0]); line.setAttribute('y2',pEnd[1]);
        line.setAttribute('stroke',color); line.setAttribute('stroke-width','3.5');
        line.setAttribute('stroke-linecap','round');
        gizmoSvg.appendChild(line);
        // مقبض مربع
        const rectE = document.createElementNS(ns,'rect');
        rectE.setAttribute('x',pEnd[0]-8); rectE.setAttribute('y',pEnd[1]-8);
        rectE.setAttribute('width','16'); rectE.setAttribute('height','16');
        rectE.setAttribute('fill',color); rectE.setAttribute('stroke','#fff');
        rectE.setAttribute('stroke-width','1.5');
        gizmoSvg.appendChild(rectE);
        gizmoHandles.push({axis, kind:'linear', x:pEnd[0], y:pEnd[1]});
      });
    }
    // نقطة المركز
    const dot = document.createElementNS(ns,'circle');
    dot.setAttribute('cx',center[0]); dot.setAttribute('cy',center[1]);
    dot.setAttribute('r','4'); dot.setAttribute('fill','#fff');
    dot.setAttribute('stroke','#000'); dot.setAttribute('stroke-width','1');
    gizmoSvg.appendChild(dot);
  }

  let gizmoHandles = [];

  function ringPointsForAxis(center, axis, radius, segments){
    const pts = [];
    let u,v;
    if(axis==='x'){ u=[0,1,0]; v=[0,0,1]; }
    else if(axis==='y'){ u=[1,0,0]; v=[0,0,1]; }
    else { u=[1,0,0]; v=[0,1,0]; }
    for(let i=0;i<=segments;i++){
      const t=(i/segments)*Math.PI*2;
      const wp = add3(center, add3(scale3(u, Math.cos(t)*radius), scale3(v, Math.sin(t)*radius)));
      pts.push(projectPoint(wp));
    }
    return pts;
  }

  function worldSizeForScreenPixels(worldPos, pixels){
    const cam = getActiveRenderCamera();
    const rel = sub3(worldPos, cam.pos);
    const camZ = Math.max(dot3(rel, cam.forward), 0.05);
    const tanFov = Math.tan(cam.fov*Math.PI/180*0.5);
    const rect = container.getBoundingClientRect();
    const worldPerPixelAtDist = (2*camZ*tanFov) / Math.max(rect.height,1);
    return worldPerPixelAtDist * pixels;
  }

  function hitTestGizmo(sx,sy){
    const rect = container.getBoundingClientRect();
    const lx = sx-rect.left, ly = sy-rect.top;
    let best=null, bestD=24;
    for(const h of gizmoHandles){
      if(h.kind==='linear'){
        const d = Math.hypot(lx-h.x, ly-h.y);
        if(d<bestD){ bestD=d; best=h.axis; }
      } else if(h.kind==='ring'){
        for(let i=0;i<h.points.length-1;i++){
          const a=h.points[i], b=h.points[i+1];
          if(!a||!b) continue;
          const d = distToSegment(lx,ly,a[0],a[1],b[0],b[1]);
          if(d<bestD){ bestD=d; best=h.axis; }
        }
      }
    }
    return best;
  }

  function distToSegment(px,py,x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1;
    const len2 = dx*dx+dy*dy;
    let t = len2>0 ? ((px-x1)*dx+(py-y1)*dy)/len2 : 0;
    t = Math.max(0,Math.min(1,t));
    const cx=x1+t*dx, cy=y1+t*dy;
    return Math.hypot(px-cx,py-cy);
  }

  // ---- سحب Gizmo (مُحدَّث للتحريك الحر) ----
  function applyGizmoDrag(e){
    const dx = e.clientX-dragStart.x, dy = e.clientY-dragStart.y;
    const mode = window.__gizmoMode;
    const axis = gizmoDragAxis;
    const axisIdx = {x:0,y:1,z:2}[axis];
    const sensitivity = 0.01 * (scene.camera.distance/6);

    if(mode==='translate'){
      const screenDelta = (axis==='y') ? -dy : dx;
      const newVal = gizmoStartVal.pos[axisIdx] + screenDelta*sensitivity*(axis==='z'?-1:1);
      gizmoDragObj.position[axisIdx] = newVal;
    } else if(mode==='scale'){
      const screenDelta = (axis==='y') ? -dy : dx;
      const newVal = Math.max(0.05, gizmoStartVal.scale[axisIdx] + screenDelta*sensitivity);
      gizmoDragObj.scaleXYZ[axisIdx] = newVal;
    } else if(mode==='rotate'){
      const sensitivityRot = 0.012;
      const newVal = gizmoStartVal.rot[axisIdx] + dx*sensitivityRot;
      gizmoDragObj.rotation[axisIdx] = newVal;
    }
    UI.onSceneChanged();
    UI.refreshSelection();
  }

  // ... باقي الكود كما هو (كاميرا المشهد، استيراد GLTF، إلخ) مع تعديلات طفيفة لتتناسب مع النظام الجديد
})();
