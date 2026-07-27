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

  // ==================================================================
  // حالة تطبيق عامة: وضع العرض (preview / realtime / rendering)
  // ==================================================================
  const AppState = {
    mode: 'preview',     // 'preview' | 'realtime' | 'rendering'
    renderCancelled:false
  };

  // ==================================================================
  // Undo / Redo
  // ==================================================================
  const UndoStack = { stack:[], index:-1, max:60 };
  function pushUndoState(){
    const snap = scene.serialize();
    // تجاهل إن كانت نفس الحالة الحالية
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
  pushUndoState(); // حالة أولية
  updateUndoRedoButtons();

  // ==================================================================
  // ملء الشاشة + تدوير تلقائي لـ landscape
  // ==================================================================
  const btnFullscreen = document.getElementById('btnFullscreen');
  btnFullscreen.addEventListener('click', async ()=>{
    try{
      if(!document.fullscreenElement){
        await document.documentElement.requestFullscreen();
        if(screen.orientation && screen.orientation.lock){
          try{ await screen.orientation.lock('landscape'); }catch(e){/* بعض المتصفحات لا تدعم القفل */}
        }
      } else {
        await document.exitFullscreen();
      }
    }catch(e){
      UI.toast('تعذر تفعيل ملء الشاشة على هذا الجهاز');
    }
  });

  // ==================================================================
  // حجم الفيوبورت
  // ==================================================================
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
  new ResizeObserver(()=> fitViewport()).observe(container);

  // ==================================================================
  // أدوات مساعدة هندسية
  // ==================================================================
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

  // -------- اختبار تقاطع شعاع مع جسم فعلي (raycasting حقيقي بدل نقطة المركز) --------
  function rayIntersectsObject(ro, rd, obj){
    // حوّل الشعاع لفضاء الجسم المحلي
    const Rm = obj.getRotationMatrix();
    const RmInv = mat3Transpose(Rm);
    const localRO = mat3MulVec3(RmInv, sub3(ro, obj.position));
    const localRD = mat3MulVec3(RmInv, rd);
    const s = obj.getScaleParams();

    switch(obj.subtype){
      case 'sphere': return raySphere(localRO, localRD, s[0]);
      case 'cube': return rayBox(localRO, localRD, s);
      case 'plane': return rayPlane(localRO, localRD, [s[0],s[2]]);
      case 'cylinder': return rayCylinder(localRO, localRD, s[0], s[1]);
      case 'cone': return rayCone(localRO, localRD, s[0], s[1]*2);
      case 'torus': return rayTorusApprox(localRO, localRD, s[0], s[1]);
      default: return null;
    }
  }
  function raySphere(ro,rd,r){
    const oc = ro;
    const b = dot3(oc,rd);
    const c = dot3(oc,oc)-r*r;
    const h = b*b-c;
    if(h<0) return null;
    const sq = Math.sqrt(h);
    const t0=-b-sq, t1=-b+sq;
    const t = t0>0.001?t0:t1;
    return t>0.001? t : null;
  }
  function rayBox(ro,rd,halfSize){
    const invD = [1/rd[0],1/rd[1],1/rd[2]];
    const t0s=[(-halfSize[0]-ro[0])*invD[0],(-halfSize[1]-ro[1])*invD[1],(-halfSize[2]-ro[2])*invD[2]];
    const t1s=[(halfSize[0]-ro[0])*invD[0],(halfSize[1]-ro[1])*invD[1],(halfSize[2]-ro[2])*invD[2]];
    const tsm=[Math.min(t0s[0],t1s[0]),Math.min(t0s[1],t1s[1]),Math.min(t0s[2],t1s[2])];
    const tbg=[Math.max(t0s[0],t1s[0]),Math.max(t0s[1],t1s[1]),Math.max(t0s[2],t1s[2])];
    const tmin=Math.max(tsm[0],tsm[1],tsm[2]);
    const tmax=Math.min(tbg[0],tbg[1],tbg[2]);
    if(tmax<0||tmin>tmax) return null;
    const t = tmin>0.001?tmin:tmax;
    return t>0.001?t:null;
  }
  function rayPlane(ro,rd,halfSize){
    if(Math.abs(rd[1])<1e-5) return null;
    const t=-ro[1]/rd[1];
    if(t<0.001) return null;
    const px=ro[0]+rd[0]*t, pz=ro[2]+rd[2]*t;
    if(Math.abs(px)>halfSize[0]||Math.abs(pz)>halfSize[1]) return null;
    return t;
  }
  function rayCylinder(ro,rd,r,halfH){
    const a=rd[0]*rd[0]+rd[2]*rd[2];
    const b=2*(ro[0]*rd[0]+ro[2]*rd[2]);
    const c=ro[0]*ro[0]+ro[2]*ro[2]-r*r;
    let bestT=Infinity;
    if(a>1e-6){
      const disc=b*b-4*a*c;
      if(disc>=0){
        const sq=Math.sqrt(disc);
        [(-b-sq)/(2*a),(-b+sq)/(2*a)].forEach(t=>{
          if(t>0.001){
            const py=ro[1]+rd[1]*t;
            if(Math.abs(py)<=halfH && t<bestT) bestT=t;
          }
        });
      }
    }
    [-1,1].forEach(s=>{
      const fy=s*halfH;
      if(Math.abs(rd[1])>1e-6){
        const t=(fy-ro[1])/rd[1];
        if(t>0.001){
          const px=ro[0]+rd[0]*t, pz=ro[2]+rd[2]*t;
          if(px*px+pz*pz<=r*r && t<bestT) bestT=t;
        }
      }
    });
    return bestT<Infinity?bestT:null;
  }
  function rayCone(ro,rd,r,h){
    const k=r/h;
    const oy = ro[1]-(-h*0.5+h); // apex-relative not needed exactly; approximate via bounding
    // نستخدم تقريب: box+sphere hybrid لالتقاط بسيط وسريع كفاية للاختيار
    return rayCylinder(ro,rd,r,h*0.5); // تقريب معقول لأغراض الالتقاط
  }
  function rayTorusApprox(ro,rd,R,r){
    // تقريب باستخدام sphere محيطة بنصف قطر R+r
    return raySphere(ro,rd,R+r);
  }

  function pickObjectAtScreen(sx,sy){
    const {ro,rd} = getRayFromScreen(sx,sy);
    let best=null, bestT=Infinity;
    for(const o of scene.objects){
      if(!o.visible) continue;
      if(o.kind==='mesh'){
        const t = rayIntersectsObject(ro,rd,o);
        if(t!==null && t<bestT){ bestT=t; best=o; }
      }
    }
    // اختبار الإضاءات والكاميرا: أيقونات بحجم ثابت بالشاشة (تُختار بالمسافة الشاشية من مركزها)
    const rect = container.getBoundingClientRect();
    const iconHitRadius = 22; // نصف قطر منطقة اللمس بالبكسل، ثابت بصرياً بغض النظر عن العمق
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
    // إن كانت أيقونة إضاءة/كاميرا أقرب شاشياً من أي تقاطع هندسي فعلي، نُفضّلها (الأيقونات دائماً أسهل التقاطاً)
    if(bestIconObj) return bestIconObj;
    return best;
  }

  // تعريض بعض الدوال للاستخدام في وحدات أخرى من هذا الملف (Gizmo/Touch)
  window.__viewportHelpers = { screenToNDC, getRayFromScreen, projectPoint, pickObjectAtScreen };

  // ==================================================================
  // تحكم الكاميرا واللمس
  // إصبع واحد: تدوير الكاميرا (orbit) أو تحريك Gizmo إن كان ممسوكاً
  // إصبعان: تكبير/تصغير (pinch) + تحريك جانبي (pan) في آن واحد حسب الحركة
  // ==================================================================
  let pointers = new Map();
  let dragMode = null; // 'orbit' | 'gizmo' | 'twoFinger'
  let dragStart = null;
  let gizmoDragAxis = null;
  let gizmoDragObj = null;
  let gizmoStartVal = null;
  let twoFingerStart = null;

  function getPointersArr(){ return [...pointers.values()]; }

  function isInteractiveTarget(el){
    return !!(el.closest && el.closest('button, .float-btn, .gmode, .render-fab, svg, .render-progress-overlay'));
  }

  container.addEventListener('pointerdown', (e)=>{
    if(isInteractiveTarget(e.target)) return; // اترك التعامل مع الزر لمعالجه الخاص
    try{ container.setPointerCapture(e.pointerId); }catch(err){ /* بعض المتصفحات قد ترفض الالتقاط في حالات نادرة */ }
    pointers.set(e.pointerId, {x:e.clientX,y:e.clientY});

    if(pointers.size===1){
      const axis = hitTestGizmo(e.clientX, e.clientY);
      if(axis && !SceneCameraState.active){
        dragMode = 'gizmo';
        gizmoDragAxis = axis;
        gizmoDragObj = scene.getSelected();
        dragStart = {x:e.clientX, y:e.clientY};
        gizmoStartVal = {
          pos:[...gizmoDragObj.position],
          rot:[...gizmoDragObj.rotation],
          scale:[...gizmoDragObj.scaleXYZ]
        };
      } else if(SceneCameraState.active){
        dragMode = 'sceneCam';
        sceneCameraPointerDown(e);
      } else {
        dragMode = 'orbit';
        dragStart = {x:e.clientX, y:e.clientY, yaw:scene.camera.yaw, pitch:scene.camera.pitch};
      }
    } else if(pointers.size===2){
      if(SceneCameraState.active){
        dragMode = 'sceneCam';
        sceneCameraPointerDown(e);
      } else {
      // بدء وضع إصبعين: نلغي أي عملية gizmo جارية
      dragMode = 'twoFinger';
      const pts = getPointersArr();
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      const midX = (pts[0].x+pts[1].x)/2, midY = (pts[0].y+pts[1].y)/2;
      twoFingerStart = {
        dist, midX, midY,
        camDistance: scene.camera.distance,
        camTarget: [...scene.camera.target],
        camYaw: scene.camera.yaw,
        camPitch: scene.camera.pitch
      };
      }
    }
  });

  container.addEventListener('pointermove', (e)=>{
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {x:e.clientX,y:e.clientY});

    if(dragMode==='sceneCam'){
      sceneCameraPointerMove(e);
      return;
    }

    if(pointers.size===2 && dragMode==='twoFinger'){
      const pts = getPointersArr();
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      const midX = (pts[0].x+pts[1].x)/2, midY = (pts[0].y+pts[1].y)/2;

      // تكبير/تصغير (pinch)
      const distDelta = dist - twoFingerStart.dist;
      scene.camera.distance = Math.max(0.4, twoFingerStart.camDistance - distDelta*0.02);

      // تحريك جانبي (pan) بحركة المنتصف
      const dx = midX - twoFingerStart.midX;
      const dy = midY - twoFingerStart.midY;
      const cam = scene.camera;
      const panX = scale3(cam.right, -dx*0.006*(scene.camera.distance/6));
      const panY = scale3(cam.up, dy*0.006*(scene.camera.distance/6));
      scene.camera.target = add3(add3(twoFingerStart.camTarget, panX), panY);

      scene.camera.update();
      UI.onSceneChanged();
      return;
    }

    if(dragMode==='orbit' && pointers.size===1){
      const dx = e.clientX-dragStart.x, dy = e.clientY-dragStart.y;
      scene.camera.yaw = dragStart.yaw - dx*0.008;
      scene.camera.pitch = Math.max(-1.5,Math.min(1.5, dragStart.pitch + dy*0.008));
      scene.camera.update();
      UI.onSceneChanged();
    } else if(dragMode==='gizmo' && gizmoDragObj){
      applyGizmoDrag(e);
    }
  });

  function endDrag(e){
    if(pointers.has(e.pointerId)) pointers.delete(e.pointerId);
    if(pointers.size<2 && dragMode==='twoFinger'){
      dragMode = pointers.size===1 ? 'orbit' : null;
      if(dragMode==='orbit'){
        const p = getPointersArr()[0];
        dragStart = {x:p.x, y:p.y, yaw:scene.camera.yaw, pitch:scene.camera.pitch};
      }
    }
    if(dragMode==='sceneCam' && pointers.size>=1){
      // إعادة تهيئة حالة السحب عند تغيّر عدد الأصابع أثناء التحكم بكاميرا المشهد
      sceneCameraPointerDown({clientX:getPointersArr()[0].x, clientY:getPointersArr()[0].y});
    }
    if(pointers.size===0){
      if(dragMode==='gizmo') UI.pushUndo();
      dragMode=null; gizmoDragAxis=null; gizmoDragObj=null;
      sceneCamSingleDrag=null; sceneCamTwoFingerStart=null;
    }
  }
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);

  container.addEventListener('wheel', (e)=>{
    e.preventDefault();
    if(SceneCameraState.active){
      sceneCameraWheel(e.deltaY);
      return;
    }
    scene.camera.distance = Math.max(0.4, Math.min(60, scene.camera.distance + e.deltaY*0.01));
    scene.camera.update();
    UI.onSceneChanged();
  }, {passive:false});

  // ---------------- اختيار عنصر باللمس (raycasting حقيقي على كامل الجسم) ----------------
  let clickStartPos = null;
  container.addEventListener('pointerdown', (e)=>{
    if(isInteractiveTarget(e.target)){ clickStartPos = null; return; }
    if(pointers.size<=1) clickStartPos = {x:e.clientX,y:e.clientY};
  }, {capture:true});
  container.addEventListener('pointerup', (e)=>{
    if(!clickStartPos) return;
    if(isInteractiveTarget(e.target)){ clickStartPos = null; return; }
    const moved = Math.hypot(e.clientX-clickStartPos.x, e.clientY-clickStartPos.y);
    if(moved < 8 && dragMode !== 'gizmo' && dragMode !== 'twoFinger'){
      const picked = pickObjectAtScreen(e.clientX, e.clientY);
      scene.selectedId = picked ? picked.id : null;
      UI.refreshSceneTree();
      UI.refreshSelection();
      UI.onSceneChanged();
    }
    clickStartPos = null;
  });



  // ==================================================================
  // Gizmo: رسم وتفاعل — حلقات التدوير مسطحة فعلياً على مستوى كل محور
  // ==================================================================
  const AXIS_COLORS = {x:'#ff5555', y:'#55dd88', z:'#4a7fff'};
  let gizmoHandles = [];

  function ringPointsForAxis(center, axis, radius, segments){
    const pts = [];
    let u,v;
    if(axis==='x'){ u=[0,1,0]; v=[0,0,1]; }
    else if(axis==='y'){ u=[1,0,0]; v=[0,0,1]; }
    else { u=[1,0,0]; v=[0,1,0]; }
    for(let i=0;i<=segments;i++){
      const t = (i/segments)*Math.PI*2;
      const wp = add3(center, add3(scale3(u, Math.cos(t)*radius), scale3(v, Math.sin(t)*radius)));
      pts.push(projectPoint(wp));
    }
    return pts;
  }

  // يحسب طولاً بالوحدات العالمية يقابل حجماً ثابتاً بالبكسل على الشاشة عند مسافة معينة من الكاميرا
  // هذا يضمن أن Gizmo وأيقونات الإضاءة/الكاميرا/العظام تبدو بنفس الحجم دائماً بغض النظر عن التكبير
  function worldSizeForScreenPixels(worldPos, pixels){
    const cam = getActiveRenderCamera();
    const rel = sub3(worldPos, cam.pos);
    const camZ = Math.max(dot3(rel, cam.forward), 0.05);
    const tanFov = Math.tan(cam.fov*Math.PI/180*0.5);
    const rect = container.getBoundingClientRect();
    const worldPerPixelAtDist = (2*camZ*tanFov) / Math.max(rect.height,1);
    return worldPerPixelAtDist * pixels;
  }

  function drawGizmo(){
    gizmoSvg.innerHTML = '';
    gizmoHandles = [];
    drawSceneDecorations();

    const o = scene.getSelected();
    if(!o) return;
    const mode = window.__gizmoMode||'translate';
    if(o.kind==='camera' && mode==='scale') return; // لا معنى لتحجيم الكاميرا
    const center = projectPoint(o.position);
    if(!center) return;
    const rect = container.getBoundingClientRect();
    gizmoSvg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    const ns = 'http://www.w3.org/2000/svg';

    const centerDot = document.createElementNS(ns,'circle');
    centerDot.setAttribute('cx',center[0]); centerDot.setAttribute('cy',center[1]);
    centerDot.setAttribute('r',4); centerDot.setAttribute('fill','#fff');
    centerDot.setAttribute('stroke','#000'); centerDot.setAttribute('stroke-width','1');
    gizmoSvg.appendChild(centerDot);

    const axes = [{axis:'x',dir:[1,0,0]},{axis:'y',dir:[0,1,0]},{axis:'z',dir:[0,0,1]}];
    const armLength = worldSizeForScreenPixels(o.position, 70); // ذراع بطول 70px ثابت بصرياً

    if(mode==='translate' || mode==='scale'){
      axes.forEach(({axis,dir})=>{
        const worldEnd = add3(o.position, scale3(dir,armLength));
        const p2 = projectPoint(worldEnd);
        if(!p2) return;
        const line = document.createElementNS(ns,'line');
        line.setAttribute('x1',center[0]); line.setAttribute('y1',center[1]);
        line.setAttribute('x2',p2[0]); line.setAttribute('y2',p2[1]);
        line.setAttribute('stroke',AXIS_COLORS[axis]);
        line.setAttribute('stroke-width','3.5');
        line.setAttribute('stroke-linecap','round');
        gizmoSvg.appendChild(line);

        const handleShape = mode==='scale' ? 'rect' : 'circle';
        const handle = document.createElementNS(ns, handleShape);
        if(handleShape==='circle'){
          handle.setAttribute('cx',p2[0]); handle.setAttribute('cy',p2[1]); handle.setAttribute('r',10);
        } else {
          handle.setAttribute('x',p2[0]-7); handle.setAttribute('y',p2[1]-7);
          handle.setAttribute('width',14); handle.setAttribute('height',14);
        }
        handle.setAttribute('fill',AXIS_COLORS[axis]);
        handle.setAttribute('stroke','#fff'); handle.setAttribute('stroke-width','1.5');
        gizmoSvg.appendChild(handle);

        gizmoHandles.push({axis, kind:'linear', x:p2[0], y:p2[1]});
      });
    } else if(mode==='rotate'){
      const radius = worldSizeForScreenPixels(o.position, 60);
      axes.forEach(({axis})=>{
        const pts = ringPointsForAxis(o.position, axis, radius, 48);
        const validPts = pts.filter(p=>p);
        if(validPts.length<4) return;
        const pathD = validPts.map((p,i)=> (i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
        const path = document.createElementNS(ns,'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill','none');
        path.setAttribute('stroke',AXIS_COLORS[axis]);
        path.setAttribute('stroke-width','3');
        path.setAttribute('opacity','0.95');
        gizmoSvg.appendChild(path);
        gizmoHandles.push({axis, kind:'ring', points:validPts});
      });
    }
  }

  function drawSceneDecorations(){
    const ns = 'http://www.w3.org/2000/svg';
    if(!gizmoSvg.querySelector('#arrowHead')){
      const defs = document.createElementNS(ns,'defs');
      defs.innerHTML = `<marker id="arrowHead" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#ffdd66"/>
      </marker>`;
      gizmoSvg.appendChild(defs);
    }
    scene.objects.forEach(o=>{
      if(!o.visible) return;
      if(o.kind==='light' && o.subtype==='sun'){
        const p0 = projectPoint(o.position);
        const dir = o.getLightDirection();
        const lineLen = worldSizeForScreenPixels(o.position, 55);
        const p1 = projectPoint(add3(o.position, scale3(dir, lineLen)));
        const isSel = o.id===scene.selectedId;
        if(p0 && p1){
          const line = document.createElementNS(ns,'line');
          line.setAttribute('x1',p0[0]); line.setAttribute('y1',p0[1]);
          line.setAttribute('x2',p1[0]); line.setAttribute('y2',p1[1]);
          line.setAttribute('stroke',isSel?'#4a7fff':'#ffdd66');
          line.setAttribute('stroke-width', isSel?'2.5':'1.5');
          line.setAttribute('marker-end','url(#arrowHead)');
          gizmoSvg.appendChild(line);
          const sunDot = document.createElementNS(ns,'circle');
          sunDot.setAttribute('cx',p0[0]); sunDot.setAttribute('cy',p0[1]);
          sunDot.setAttribute('r', isSel?7:5);
          sunDot.setAttribute('fill',isSel?'#4a7fff':'#ffdd66');
          sunDot.setAttribute('stroke','#00000055');
          gizmoSvg.appendChild(sunDot);
        }
      } else if(o.kind==='light' && o.subtype==='spot'){
        const p0 = projectPoint(o.position);
        const dir = o.getForwardDirection();
        const isSel = o.id===scene.selectedId;
        const len = worldSizeForScreenPixels(o.position, 65);
        const endCenter = add3(o.position, scale3(dir,len));
        const angle = (o.light.spotAngle||35)*Math.PI/180;
        const coneR = Math.tan(angle)*len;
        let u,v;
        const absY = Math.abs(dir[1]);
        if(absY<0.99){ u=normalize3(cross3([0,1,0],dir)); } else { u=[1,0,0]; }
        v=normalize3(cross3(dir,u));
        const segs=20; const ringPts=[];
        for(let i=0;i<=segs;i++){
          const t=(i/segs)*Math.PI*2;
          const wp = add3(endCenter, add3(scale3(u,Math.cos(t)*coneR), scale3(v,Math.sin(t)*coneR)));
          ringPts.push(projectPoint(wp));
        }
        const validRing = ringPts.filter(p=>p);
        if(p0 && validRing.length>3){
          const pathD = validRing.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
          const path = document.createElementNS(ns,'path');
          path.setAttribute('d',pathD); path.setAttribute('fill','none');
          path.setAttribute('stroke',isSel?'#4a7fff':'#ffaa44'); path.setAttribute('stroke-width','1.5'); path.setAttribute('opacity','0.85');
          gizmoSvg.appendChild(path);
          [0, Math.floor(segs/4), Math.floor(segs/2), Math.floor(3*segs/4)].forEach(idx=>{
            const p = validRing[idx];
            if(!p) return;
            const line = document.createElementNS(ns,'line');
            line.setAttribute('x1',p0[0]); line.setAttribute('y1',p0[1]);
            line.setAttribute('x2',p[0]); line.setAttribute('y2',p[1]);
            line.setAttribute('stroke',isSel?'#4a7fff':'#ffaa44'); line.setAttribute('stroke-width','1'); line.setAttribute('opacity','0.6');
            gizmoSvg.appendChild(line);
          });
          const spotDot = document.createElementNS(ns,'circle');
          spotDot.setAttribute('cx',p0[0]); spotDot.setAttribute('cy',p0[1]);
          spotDot.setAttribute('r', isSel?7:5);
          spotDot.setAttribute('fill',isSel?'#4a7fff':'#ffaa44');
          gizmoSvg.appendChild(spotDot);
        }
      } else if(o.kind==='light' && (o.subtype==='point'||o.subtype==='area')){
        const p0 = projectPoint(o.position);
        const isSel = o.id===scene.selectedId;
        if(p0){
          const dot = document.createElementNS(ns,'circle');
          dot.setAttribute('cx',p0[0]); dot.setAttribute('cy',p0[1]);
          dot.setAttribute('r', isSel?8:6);
          dot.setAttribute('fill', isSel?'#4a7fff':(o.subtype==='point'?'#ffe066':'#66ccff'));
          dot.setAttribute('stroke','#00000055');
          gizmoSvg.appendChild(dot);
          for(let i=0;i<6;i++){
            const a = (i/6)*Math.PI*2;
            const rx = p0[0]+Math.cos(a)*11, ry = p0[1]+Math.sin(a)*11;
            const rx2 = p0[0]+Math.cos(a)*15, ry2 = p0[1]+Math.sin(a)*15;
            const ray = document.createElementNS(ns,'line');
            ray.setAttribute('x1',rx); ray.setAttribute('y1',ry);
            ray.setAttribute('x2',rx2); ray.setAttribute('y2',ry2);
            ray.setAttribute('stroke', isSel?'#4a7fff':(o.subtype==='point'?'#ffe066':'#66ccff'));
            ray.setAttribute('stroke-width','1.2'); ray.setAttribute('opacity','0.7');
            gizmoSvg.appendChild(ray);
          }
        }
      } else if(o.kind==='camera'){
        drawCameraGizmo(o);
      } else if(o.kind==='bone'){
        const p0 = projectPoint(o.position);
        if(!p0) return;
        const isSel = o.id===scene.selectedId;
        // خط أرجواني للأب (إن وجد)
        if(o.boneParentId){
          const parent = scene.getObject(o.boneParentId);
          if(parent){
            const p1 = projectPoint(parent.position);
            if(p1){
              const line = document.createElementNS(ns,'line');
              line.setAttribute('x1',p0[0]); line.setAttribute('y1',p0[1]);
              line.setAttribute('x2',p1[0]); line.setAttribute('y2',p1[1]);
              line.setAttribute('stroke','#a855f7');
              line.setAttribute('stroke-width','2');
              line.setAttribute('opacity','0.85');
              gizmoSvg.appendChild(line);
            }
          }
        }
        const dot = document.createElementNS(ns,'circle');
        dot.setAttribute('cx',p0[0]); dot.setAttribute('cy',p0[1]);
        dot.setAttribute('r', isSel?8:6);
        dot.setAttribute('fill', isSel?'#ffffff':'#3b82f6');
        dot.setAttribute('stroke','#1e3a8a');
        dot.setAttribute('stroke-width','1.5');
        gizmoSvg.appendChild(dot);
        gizmoHandles.push({axis:null, kind:'bone-pick', objId:o.id, x:p0[0], y:p0[1]});
      }
    });
  }

  function drawCameraGizmo(o){
    const ns = 'http://www.w3.org/2000/svg';
    const fwd = o.getForwardDirection();
    let upv = [0,1,0];
    let right = cross3(fwd, upv);
    if(len3(right)<0.001) right=[1,0,0];
    right = normalize3(right);
    const up = normalize3(cross3(right, fwd));

    const focalDist = worldSizeForScreenPixels(o.position, 40);
    const camSize = focalDist*0.5;
    const corners = [
      add3(add3(o.position, scale3(right,camSize)), add3(scale3(up,camSize*0.7), scale3(fwd,focalDist))),
      add3(add3(o.position, scale3(right,-camSize)), add3(scale3(up,camSize*0.7), scale3(fwd,focalDist))),
      add3(add3(o.position, scale3(right,-camSize)), add3(scale3(up,-camSize*0.7), scale3(fwd,focalDist))),
      add3(add3(o.position, scale3(right,camSize)), add3(scale3(up,-camSize*0.7), scale3(fwd,focalDist)))
    ];
    const p0 = projectPoint(o.position);
    const pc = corners.map(c=>projectPoint(c));
    if(!p0 || pc.some(p=>!p)) return;

    const isSelected = o.id===scene.selectedId;
    const color = isSelected? '#4a7fff' : '#cccccc';

    pc.forEach(p=>{
      const line = document.createElementNS(ns,'line');
      line.setAttribute('x1',p0[0]); line.setAttribute('y1',p0[1]);
      line.setAttribute('x2',p[0]); line.setAttribute('y2',p[1]);
      line.setAttribute('stroke',color); line.setAttribute('stroke-width','1.3'); line.setAttribute('opacity','0.85');
      gizmoSvg.appendChild(line);
    });
    const framePath = pc.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')+' Z';
    const frame = document.createElementNS(ns,'path');
    frame.setAttribute('d',framePath); frame.setAttribute('fill','none');
    frame.setAttribute('stroke',color); frame.setAttribute('stroke-width','1.5');
    gizmoSvg.appendChild(frame);
    const body = document.createElementNS(ns,'rect');
    body.setAttribute('x',p0[0]-7); body.setAttribute('y',p0[1]-6);
    body.setAttribute('width',14); body.setAttribute('height',12);
    body.setAttribute('rx',2);
    body.setAttribute('fill',color); body.setAttribute('stroke','#000'); body.setAttribute('stroke-width','1');
    gizmoSvg.appendChild(body);

    gizmoHandles.push({axis:null, kind:'camera-pick', objId:o.id, x:p0[0], y:p0[1]});
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

  function applyGizmoDrag(e){
    const dx = e.clientX-dragStart.x, dy = e.clientY-dragStart.y;
    const mode = window.__gizmoMode;
    const axis = gizmoDragAxis;
    const axisIdx = {x:0,y:1,z:2}[axis];

    if(mode==='translate'){
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
      const sensitivity = 0.012;
      const newVal = gizmoStartVal.rot[axisIdx] + dx*sensitivity;
      gizmoDragObj.rotation[axisIdx] = newVal;
    }
    UI.onSceneChanged();
    UI.refreshSelection();
  }

  document.querySelectorAll('.gmode').forEach(btn=>{
    btn.onclick = ()=>{
      document.querySelectorAll('.gmode').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      window.__gizmoMode = btn.dataset.mode;
    };
  });
  window.__gizmoMode = 'translate';

  // ==================================================================
  // كاميرا المشهد: دخول/خروج + تحكم من الداخل (حركة عادية + تدوير مقود بإصبعين)
  // ==================================================================
  const SceneCameraState = {
    active: false,
    camObj: null,      // كائن SceneObject من نوع 'camera' الذي دخلنا منظوره
    pos: [0,0,0],
    yaw: 0, pitch: 0,   // زوايا حرة للتحرك الحر داخل الكاميرا (منفصلة عن orbit)
    roll: 0             // ميلان جانبي ("مقود السيارة") بإصبعين
  };

  function computeCamBasis(yaw, pitch, roll){
    // ابنِ اتجاه أمامي من yaw/pitch، ثم طبّق roll حول محور forward نفسه
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const forward = normalize3([cp*sy, sp, cp*cy]);
    let up0 = [0,1,0];
    let right = cross3(forward, up0);
    if(len3(right)<0.001) right=[1,0,0];
    right = normalize3(right);
    let up = normalize3(cross3(right, forward));
    // تطبيق roll: دوران right/up حول forward
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rightRolled = normalize3(add3(scale3(right,cr), scale3(up,sr)));
    const upRolled = normalize3(add3(scale3(up,cr), scale3(right,-sr)));
    return {forward, right:rightRolled, up:upRolled};
  }

  function enterSceneCamera(camObjRef){
    SceneCameraState.active = true;
    SceneCameraState.camObj = camObjRef;
    SceneCameraState.pos = [...camObjRef.position];
    SceneCameraState.yaw = camObjRef.rotation[1];
    SceneCameraState.pitch = -camObjRef.rotation[0];
    SceneCameraState.roll = 0;
    btnCameraToggle.classList.add('active');
    UI.toast('دخلت منظور: '+camObjRef.name);
    UI.onSceneChanged();
  }
  function exitSceneCamera(){
    SceneCameraState.active = false;
    btnCameraToggle.classList.remove('active');
    UI.onSceneChanged();
  }
  window.__enterSceneCamera = enterSceneCamera;

  const btnCameraToggle = document.getElementById('btnCameraToggle');
  btnCameraToggle.addEventListener('click', ()=>{
    if(SceneCameraState.active){
      exitSceneCamera();
    } else {
      // ادخل أول كاميرا موجودة بالمشهد، أو أنشئ واحدة إن لم توجد
      let camObjRef = scene.objects.find(o=>o.kind==='camera');
      if(!camObjRef){
        camObjRef = new SceneObject('camera','camera');
        camObjRef.position = [...scene.camera.pos];
        camObjRef.rotation = [-scene.camera.pitch, scene.camera.yaw, 0];
        camObjRef.name = 'كاميرا';
        scene.addObject(camObjRef, false);
        UI.pushUndo();
        UI.refreshSceneTree();
      }
      enterSceneCamera(camObjRef);
    }
  });

  // يُرجع كائن كاميرا "فعّالة" جاهزة للتمرير لمحرك الرندر (سواء orbit العادي أو منظور كاميرا المشهد)
  function getActiveRenderCamera(){
    if(!SceneCameraState.active || !SceneCameraState.camObj) return scene.camera;
    const basis = computeCamBasis(SceneCameraState.yaw, SceneCameraState.pitch, SceneCameraState.roll);
    const camSettings = SceneCameraState.camObj.camSettings;
    return {
      pos: SceneCameraState.pos,
      forward: basis.forward, right: basis.right, up: basis.up,
      fov: camSettings.fov, dofEnabled: camSettings.dofEnabled,
      focusDist: camSettings.focusDist, aperture: camSettings.aperture
    };
  }

  // ---------------- تحكم داخل كاميرا المشهد ----------------
  // إصبع واحد سحب: حركة حرة أمام/خلف/جانبي (كالتحرك العادي بالبيئة)
  // إصبعان: تدوير الكاميرا كـ"مقود سيارة" — الميل الجماعي لخط الإصبعين يُنتج Roll
  let sceneCamSingleDrag = null;
  let sceneCamTwoFingerStart = null;

  function sceneCameraPointerDown(e){
    if(pointers.size===1){
      sceneCamSingleDrag = {x:e.clientX, y:e.clientY, yaw:SceneCameraState.yaw, pitch:SceneCameraState.pitch};
    } else if(pointers.size===2){
      const pts = getPointersArr();
      const angle = Math.atan2(pts[1].y-pts[0].y, pts[1].x-pts[0].x);
      sceneCamTwoFingerStart = {angle, roll:SceneCameraState.roll};
    }
  }

  function sceneCameraPointerMove(e){
    if(pointers.size===2 && sceneCamTwoFingerStart){
      const pts = getPointersArr();
      const angle = Math.atan2(pts[1].y-pts[0].y, pts[1].x-pts[0].x);
      let delta = angle - sceneCamTwoFingerStart.angle;
      // طبّع الفارق ليبقى ضمن نطاق منطقي
      while(delta>Math.PI) delta -= Math.PI*2;
      while(delta<-Math.PI) delta += Math.PI*2;
      SceneCameraState.roll = sceneCamTwoFingerStart.roll + delta;
      UI.onSceneChanged();
      return;
    }
    if(pointers.size===1 && sceneCamSingleDrag){
      const dx = e.clientX-sceneCamSingleDrag.x, dy = e.clientY-sceneCamSingleDrag.y;
      SceneCameraState.yaw = sceneCamSingleDrag.yaw - dx*0.008;
      SceneCameraState.pitch = Math.max(-1.5,Math.min(1.5, sceneCamSingleDrag.pitch - dy*0.008));
      UI.onSceneChanged();
    }
  }

  // حركة أمام/خلف/جانبي داخل الكاميرا عبر أزرار وهمية بالسحب الرأسي إضافةً للنظر:
  // نستخدم سحب رأسي بإصبع واحد للنظر فقط (كما orbit)، ونضيف تحريكاً تلقائياً بسيطاً للأمام/خلف عبر عجلة الفأرة/pinch
  function sceneCameraWheel(deltaY){
    const basis = computeCamBasis(SceneCameraState.yaw, SceneCameraState.pitch, SceneCameraState.roll);
    const move = -deltaY*0.01;
    SceneCameraState.pos = add3(SceneCameraState.pos, scale3(basis.forward, move));
    UI.onSceneChanged();
  }

  // ==================================================================
  // حلقة الرندر الرئيسية
  // 3 أوضاع:
  //  - preview: معاينة raster خفيفة سريعة (قبل الضغط على زر الرندر)
  //  - realtime: Path Tracing تراكمي حي (وضع تقييم المشهد، يُفعّل من تبويب الرندر)
  //  - rendering: رندر نهائي بعدد عينات محدد لغرض الحفظ (يبدأ ويُوقف بنفس الزر)
  // ==================================================================
  let fpsCounter = {frames:0, last:performance.now()};
  let lastSavedBlobCanvas = null;

  const btnRenderToggle = document.getElementById('btnRenderToggle');
  const renderProgressBar = document.getElementById('renderProgressBar');
  const btnSaveRenderTab = document.getElementById('btnSaveRenderTab');

  function setFabState(state){
    // state: 'idle' | 'realtime' | 'rendering'
    if(state==='idle'){
      btnRenderToggle.classList.remove('active');
      btnRenderToggle.title = 'رندر';
      renderProgressBar.classList.add('hidden');
    } else if(state==='realtime'){
      btnRenderToggle.classList.add('active');
      btnRenderToggle.title = 'إيقاف المعاينة الحية';
      renderProgressBar.classList.add('hidden');
    } else if(state==='rendering'){
      btnRenderToggle.classList.add('active');
      btnRenderToggle.title = 'إيقاف الرندر';
      renderProgressBar.classList.remove('hidden');
    }
  }

  btnRenderToggle.addEventListener('click', ()=>{
    if(AppState.mode==='preview'){
      // ابدأ رندر
      if(scene.renderSettings.realtimeMode){
        startRealtime();
      } else {
        startFinalRender();
      }
    } else if(AppState.mode==='realtime'){
      stopRealtime();
    } else if(AppState.mode==='rendering'){
      AppState.renderCancelled = true;
    }
  });

  function startRealtime(){
    AppState.mode = 'realtime';
    engine.tileSize = scene.renderSettings.tileSize;
    engine.needsReset = true;
    setFabState('realtime');
  }
  function stopRealtime(){
    AppState.mode = 'preview';
    setFabState('idle');
  }

  async function startFinalRender(){
    AppState.mode = 'rendering';
    AppState.renderCancelled = false;
    setFabState('rendering');

    const resSel = document.getElementById('outputRes').value;
    let w,h;
    if(resSel==='custom'){
      w = parseInt(document.getElementById('customW').value)||1280;
      h = parseInt(document.getElementById('customH').value)||720;
    } else {
      [w,h] = resSel.split('x').map(Number);
    }
    const totalSamples = parseInt(document.getElementById('outSamples').value);

    // نستخدم نفس محرك الفيوبورت لكن بدقة مختلفة مؤقتاً، ثم نعيده لدقة الفيوبورت بعد الانتهاء
    const viewportW = engine.width, viewportH = engine.height;
    engine.tileSize = 9999;
    engine.resize(w,h);
    engine.reset();

    for(let s=0; s<totalSamples; s++){
      if(AppState.renderCancelled) break;
      engine.renderFullFrame(scene, getActiveRenderCamera());
      engine.present(
        scene.renderSettings.denoiser, scene.renderSettings.denoiserStrength,
        scene.renderSettings.bloom, scene.renderSettings.bloomStrength, scene.renderSettings.bloomThreshold
      );
      const pct = Math.round(((s+1)/totalSamples)*100);
      UI.setRenderProgress(pct, `جاري الرندر... ${s+1}/${totalSamples} عينة (${pct}%)`);
      await new Promise(r=>requestAnimationFrame(r));
    }

    const wasCancelled = AppState.renderCancelled;
    if(!wasCancelled){
      // احفظ لقطة من نتيجة الرندر النهائي لأجل زر الحفظ
      lastSavedBlobCanvas = document.createElement('canvas');
      lastSavedBlobCanvas.width = canvas.width;
      lastSavedBlobCanvas.height = canvas.height;
      lastSavedBlobCanvas.getContext('2d').drawImage(canvas, 0, 0);
      btnSaveRenderTab.classList.remove('hidden');
      UI.setRenderProgress(100, 'اكتمل الرندر ✔');
      UI.toast('اكتمل الرندر بنجاح');
    } else {
      UI.setRenderProgress(0, 'تم إيقاف الرندر');
      UI.toast('تم إيقاف الرندر');
    }

    // العودة لدقة الفيوبورت ووضع المعاينة
    engine.tileSize = scene.renderSettings.tileSize;
    fitViewport();
    AppState.mode = 'preview';
    setFabState('idle');
  }

  btnSaveRenderTab.addEventListener('click', ()=>{
    if(!lastSavedBlobCanvas) return;
    lastSavedBlobCanvas.toBlob((blob)=>{
      if(!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'render_'+Date.now()+'.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
      UI.toast('تم حفظ الصورة');
    }, 'image/png');
  });

  function liveLoop(){
    requestAnimationFrame(liveLoop);

    const activeCam = getActiveRenderCamera();

    if(AppState.mode==='preview'){
      // معاينة raster خفيفة: إضاءة واحدة من منظور الناظر فقط، لون + smooth/flat shading
      engine.renderPreview(scene, activeCam);
      drawGizmo();
    } else if(AppState.mode==='realtime'){
      if(engine.needsReset) engine.reset();
      engine.renderTileStep(scene, activeCam);
      engine.present(
        scene.renderSettings.denoiser, scene.renderSettings.denoiserStrength,
        scene.renderSettings.bloom, scene.renderSettings.bloomStrength, scene.renderSettings.bloomThreshold
      );
      drawGizmo();
    } else if(AppState.mode==='rendering'){
      // الرندر النهائي يُدار بواسطة startFinalRender (حلقة async منفصلة)؛ نكتفي هنا بعدم رسم gizmo فوقه
    }

    fpsCounter.frames++;
    const now = performance.now();
    if(now-fpsCounter.last>500){
      fpsCounter.frames=0; fpsCounter.last=now;
    }
  }
  requestAnimationFrame(liveLoop);

  // ==================================================================
  // استيراد نماذج GLTF/GLB
  // ملاحظة صادقة عن نطاق الدعم: محرك الرندر هنا مبني على أشكال هندسية
  // تحليلية (Path Tracing على SDF/تقاطعات تحليلية) وليس محرك مضلعات
  // (Mesh/Triangle rasterizer). لذلك هذا الاستيراد يركّز على استخراج
  // وعرض الهيكل العظمي (العقد/المفاصل) بدقة كاملة وقابلة للتحكم والتحديد،
  // بينما شبكة المضلعات المرئية (mesh) نفسها تُمثَّل تقريبياً كمجسّم
  // مكعب/كرة محيط بأبعاد الشبكة الأصلية لحين إضافة محرك مضلعات كامل.
  // ==================================================================

  async function importModelFile(file){
    try{
      UI.toast('جاري تحليل الملف...');
      const name = file.name.toLowerCase();
      let gltfJson, binBuffers = [], imageBlobs = {};

      if(name.endsWith('.glb')){
        const buf = await file.arrayBuffer();
        const parsed = parseGLB(buf);
        gltfJson = parsed.json;
        binBuffers = parsed.binChunks;
      } else if(name.endsWith('.gltf')){
        const text = await file.text();
        gltfJson = JSON.parse(text);
        // gltf منفرد بدون bin خارجي مرفق تلقائياً: ندعم فقط base64-embedded buffers هنا
      } else if(name.endsWith('.zip')){
        const buf = await file.arrayBuffer();
        const entries = await parseZip(buf);
        const gltfEntry = entries.find(e=>e.name.toLowerCase().endsWith('.gltf'));
        const glbEntry = entries.find(e=>e.name.toLowerCase().endsWith('.glb'));
        if(glbEntry){
          const parsed = parseGLB(glbEntry.data.buffer.slice(glbEntry.data.byteOffset, glbEntry.data.byteOffset+glbEntry.data.byteLength));
          gltfJson = parsed.json;
          binBuffers = parsed.binChunks;
        } else if(gltfEntry){
          gltfJson = JSON.parse(new TextDecoder().decode(gltfEntry.data));
          const binEntry = entries.find(e=>e.name.toLowerCase().endsWith('.bin'));
          if(binEntry) binBuffers = [binEntry.data.buffer.slice(binEntry.data.byteOffset, binEntry.data.byteOffset+binEntry.data.byteLength)];
        } else {
          UI.toast('لم يُعثر على ملف gltf/glb داخل الأرشيف');
          return;
        }
      } else {
        UI.toast('صيغة غير مدعومة');
        return;
      }

      if(!gltfJson){ UI.toast('تعذّر قراءة الملف'); return; }
      importSkeletonFromGLTF(gltfJson);
      UI.pushUndo();
      UI.onSceneChanged();
      UI.refreshSceneTree();
      UI.toast('تم استيراد النموذج (الهيكل العظمي والعقد)');
    }catch(err){
      console.error(err);
      UI.toast('خطأ أثناء الاستيراد: '+err.message);
    }
  }
  window.__importModelFile = importModelFile;

  // -------- GLB binary parser (magic + JSON chunk + BIN chunk) --------
  function parseGLB(arrayBuffer){
    const dv = new DataView(arrayBuffer);
    const magic = dv.getUint32(0, true);
    if(magic !== 0x46546C67) throw new Error('ليس ملف GLB صالحاً');
    const version = dv.getUint32(4, true);
    const length = dv.getUint32(8, true);
    let offset = 12;
    let json = null;
    const binChunks = [];
    while(offset < length){
      const chunkLength = dv.getUint32(offset, true); offset+=4;
      const chunkType = dv.getUint32(offset, true); offset+=4;
      const chunkData = arrayBuffer.slice(offset, offset+chunkLength);
      if(chunkType === 0x4E4F534A){ // 'JSON'
        json = JSON.parse(new TextDecoder().decode(chunkData));
      } else if(chunkType === 0x004E4942){ // 'BIN\0'
        binChunks.push(chunkData);
      }
      offset += chunkLength;
    }
    return {json, binChunks};
  }

  // -------- ZIP parser مبسّط (يدعم Stored وDeflate عبر DecompressionStream) --------
  async function parseZip(arrayBuffer){
    const dv = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const entries = [];
    // ابحث عن End Of Central Directory (EOCD) من نهاية الملف
    let eocdOffset = -1;
    for(let i=bytes.length-22; i>=0; i--){
      if(dv.getUint32(i,true)===0x06054b50){ eocdOffset=i; break; }
    }
    if(eocdOffset<0) throw new Error('ملف ZIP غير صالح');
    const cdOffset = dv.getUint32(eocdOffset+16, true);
    const cdEntries = dv.getUint16(eocdOffset+10, true);
    let ptr = cdOffset;
    const rawEntries = [];
    for(let i=0;i<cdEntries;i++){
      if(dv.getUint32(ptr,true)!==0x02014b50) break;
      const method = dv.getUint16(ptr+10,true);
      const compSize = dv.getUint32(ptr+20,true);
      const nameLen = dv.getUint16(ptr+28,true);
      const extraLen = dv.getUint16(ptr+30,true);
      const commentLen = dv.getUint16(ptr+32,true);
      const localHeaderOffset = dv.getUint32(ptr+42,true);
      const name = new TextDecoder().decode(bytes.slice(ptr+46, ptr+46+nameLen));
      rawEntries.push({name, method, compSize, localHeaderOffset});
      ptr += 46+nameLen+extraLen+commentLen;
    }
    for(const re of rawEntries){
      const lh = re.localHeaderOffset;
      if(dv.getUint32(lh,true)!==0x04034b50) continue;
      const nameLen = dv.getUint16(lh+26,true);
      const extraLen = dv.getUint16(lh+28,true);
      const dataStart = lh+30+nameLen+extraLen;
      const compData = bytes.slice(dataStart, dataStart+re.compSize);
      let data;
      if(re.method===0){
        data = compData; // Stored (بدون ضغط)
      } else if(re.method===8 && typeof DecompressionStream!=='undefined'){
        data = await inflateRaw(compData);
      } else {
        continue; // طريقة ضغط غير مدعومة في هذه البيئة
      }
      entries.push({name:re.name, data});
    }
    return entries;
  }

  async function inflateRaw(compressedBytes){
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([compressedBytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  // -------- استخراج الهيكل العظمي من GLTF JSON وبناء كائنات bone قابلة للتحديد --------
  function importSkeletonFromGLTF(gltfJson){
    if(!gltfJson.nodes || gltfJson.nodes.length===0){
      UI.toast('لا توجد عقد/هيكل عظمي في هذا الملف');
      return;
    }
    const idMap = new Map(); // فهرس عقدة GLTF -> id كائن SceneObject
    const importOffset = [ (Math.random()-0.5)*1.0, 0, (Math.random()-0.5)*1.0 ];

    // أنشئ كائن bone لكل عقدة (نتعامل مع كل العقد كمفاصل قابلة للعرض، سواء كانت meshes أو joints فعلية)
    gltfJson.nodes.forEach((node, idx)=>{
      const bone = new SceneObject('bone', 'bone');
      bone.name = node.name || ('عظمة '+idx);
      const t = node.translation || [0,0,0];
      bone.position = [t[0]+importOffset[0], t[1]+importOffset[1], t[2]+importOffset[2]];
      if(node.rotation){
        // تحويل تقريبي من quaternion لزوايا أويلر (كافٍ للعرض التقريبي)
        bone.rotation = quatToEulerApprox(node.rotation);
      }
      scene.addObject(bone, false);
      idMap.set(idx, bone.id);
    });

    // اربط الأبناء بالآباء عبر خاصية children بملف GLTF
    gltfJson.nodes.forEach((node, idx)=>{
      if(!node.children) return;
      const parentBoneId = idMap.get(idx);
      node.children.forEach(childIdx=>{
        const childBoneId = idMap.get(childIdx);
        const childObj = scene.getObject(childBoneId);
        if(childObj){
          childObj.boneParentId = parentBoneId;
          const parentObj = scene.getObject(parentBoneId);
          if(parentObj) parentObj.boneChildren.push(childBoneId);
          // اجعل موضع الابن نسبياً لموضع الأب (GLTF يخزّن translation محلياً بالنسبة للأب)
          const parentPos = parentObj.position;
          childObj.position = [
            childObj.position[0]-importOffset[0]+parentPos[0],
            childObj.position[1]-importOffset[1]+parentPos[1],
            childObj.position[2]-importOffset[2]+parentPos[2]
          ];
        }
      });
    });
  }

  function quatToEulerApprox(q){
    const [x,y,z,w] = q;
    const sinr_cosp = 2*(w*x+y*z);
    const cosr_cosp = 1-2*(x*x+y*y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);
    const sinp = 2*(w*y-z*x);
    const pitch = Math.abs(sinp)>=1 ? Math.sign(sinp)*Math.PI/2 : Math.asin(sinp);
    const siny_cosp = 2*(w*z+x*y);
    const cosy_cosp = 1-2*(y*y+z*z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);
    return [roll, pitch, yaw];
  }

})();
