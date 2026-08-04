// ======================================================================
// main.js — نقطة الدخول، تحكم الكاميرا، Gizmo ثلاثي الأبعاد، استيراد GLTF
// ======================================================================

(function(){
  const canvas = document.getElementById('viewportCanvas');
  const container = document.getElementById('viewportContainer');
  const gizmoSvg = document.getElementById('gizmoOverlay');

  // ---- تهيئة المشهد والمحرك ----
  let scene, engine;
  try {
    scene = new Scene();
    engine = new PathTracerEngine(canvas);
  } catch (err) {
    document.body.innerHTML = `<div style="padding:40px;color:#fff;font-family:sans-serif;text-align:center">
      <h2>⚠ تعذر تشغيل محرك الرندر</h2>
      <p>${err.message}</p>
      <p style="color:#999">يتطلب هذا التطبيق دعم WebGL2. جرّب متصفحاً حديثاً.</p>
    </div>`;
    throw err;
  }

  UI.init(scene, engine);

  // ---- الحالة العامة ----
  const AppState = {
    mode: 'preview',     // 'preview' | 'realtime' | 'rendering'
    renderCancelled: false
  };

  // ---- Undo / Redo ----
  const UndoStack = { stack: [], index: -1, max: 60 };
  function pushUndoState() {
    const snap = scene.serialize();
    if (UndoStack.index >= 0 && UndoStack.stack[UndoStack.index] === snap) return;
    UndoStack.stack = UndoStack.stack.slice(0, UndoStack.index + 1);
    UndoStack.stack.push(snap);
    if (UndoStack.stack.length > UndoStack.max) UndoStack.stack.shift();
    UndoStack.index = UndoStack.stack.length - 1;
    updateUndoRedoButtons();
  }
  function undo() {
    if (UndoStack.index <= 0) return;
    UndoStack.index--;
    scene.restore(UndoStack.stack[UndoStack.index]);
    afterHistoryChange();
  }
  function redo() {
    if (UndoStack.index >= UndoStack.stack.length - 1) return;
    UndoStack.index++;
    scene.restore(UndoStack.stack[UndoStack.index]);
    afterHistoryChange();
  }
  function afterHistoryChange() {
    UI.onSceneChanged();
    UI.refreshSceneTree();
    UI.refreshMaterialSelect();
    UI.refreshSelection();
    UI.refreshRenderSettingsUI();
    updateUndoRedoButtons();
  }
  function updateUndoRedoButtons() {
    document.getElementById('btnUndo').style.opacity = UndoStack.index > 0 ? '1' : '0.35';
    document.getElementById('btnRedo').style.opacity = UndoStack.index < UndoStack.stack.length - 1 ? '1' : '0.35';
  }
  window.__pushUndo = pushUndoState;
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
  pushUndoState();
  updateUndoRedoButtons();

  // ---- ملء الشاشة ----
  document.getElementById('btnFullscreen').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        if (screen.orientation && screen.orientation.lock) {
          try { await screen.orientation.lock('landscape'); } catch(e) {}
        }
      } else {
        await document.exitFullscreen();
      }
    } catch(e) {
      UI.toast('تعذر تفعيل ملء الشاشة');
    }
  });

  // ---- حجم الفيوبورت ----
  function fitViewport() {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.floor(rect.width * dpr));
    const h = Math.max(64, Math.floor(rect.height * dpr));
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    engine.tileSize = scene.renderSettings.tileSize;
    engine.resize(w, h);
  }
  window.addEventListener('resize', fitViewport);
  fitViewport();
  new ResizeObserver(() => fitViewport()).observe(container);

  // ---- دوال مساعدة للتفاعل (Raycasting) ----
  function screenToNDC(x, y) {
    const rect = container.getBoundingClientRect();
    return [(x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height * 2 - 1)];
  }

  function getRayFromScreen(sx, sy) {
    const rect = container.getBoundingClientRect();
    const ndcX = ((sx - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((sy - rect.top) / rect.height) * 2 - 1);
    const cam = getActiveRenderCamera();
    const tanFov = Math.tan(cam.fov * Math.PI / 180 * 0.5);
    const aspect = rect.width / rect.height;
    const rd = normalize3(add3(add3(cam.forward,
      scale3(cam.right, ndcX * tanFov * aspect)),
      scale3(cam.up, ndcY * tanFov)));
    return { ro: cam.pos, rd: rd };
  }

  function projectPoint(worldPos) {
    const cam = getActiveRenderCamera();
    const rel = sub3(worldPos, cam.pos);
    const camZ = dot3(rel, cam.forward);
    if (camZ <= 0.01) return null;
    const camX = dot3(rel, cam.right);
    const camY = dot3(rel, cam.up);
    const tanFov = Math.tan(cam.fov * Math.PI / 180 * 0.5);
    const rect = container.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const ndcX = camX / (camZ * tanFov * aspect);
    const ndcY = camY / (camZ * tanFov);
    const sx = (ndcX * 0.5 + 0.5) * rect.width;
    const sy = (1 - (ndcY * 0.5 + 0.5)) * rect.height;
    return [sx, sy, camZ];
  }

  // تحويل نقطة بمصفوفة 4x4 (للـ raycasting)
  function transformPoint(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  }
  function transformVector(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2]
    ];
  }

  // اختبار تقاطع شعاع مع مثلث (مستقل)
  function intersectTriangle(ro, rd, v0, v1, v2, out_t, out_uv, out_nrm) {
    const e1 = sub3(v1, v0);
    const e2 = sub3(v2, v0);
    const pvec = cross3(rd, e2);
    const det = dot3(e1, pvec);
    if (Math.abs(det) < 1e-8) return false;
    const invDet = 1.0 / det;
    const tvec = sub3(ro, v0);
    const u = dot3(tvec, pvec) * invDet;
    if (u < 0 || u > 1) return false;
    const qvec = cross3(tvec, e1);
    const v = dot3(rd, qvec) * invDet;
    if (v < 0 || u + v > 1) return false;
    const t = dot3(e2, qvec) * invDet;
    if (t < 0.001) return false;
    out_t = t;
    out_uv = [u, v];
    out_nrm = normalize3(cross3(e1, e2));
    return true;
  }

  // اختيار عنصر بالتقاطع مع المثلثات
  function pickObjectAtScreen(sx, sy) {
    const { ro, rd } = getRayFromScreen(sx, sy);
    let best = null, bestT = Infinity;
    // اختبار الميش
    for (const o of scene.objects) {
      if (!o.visible || o.kind !== 'mesh') continue;
      if (!o.mesh) continue;
      const invMat = o.getTransformMatrixInv ? o.getTransformMatrixInv() : mat4Identity();
      const localRo = transformPoint(invMat, ro);
      const localRd = transformVector(invMat, rd);
      const mesh = o.mesh;
      for (let i = 0; i < mesh.triCount; i++) {
        const i0 = mesh.indices[i * 3];
        const i1 = mesh.indices[i * 3 + 1];
        const i2 = mesh.indices[i * 3 + 2];
        const v0 = [mesh.vertices[i0 * 3], mesh.vertices[i0 * 3 + 1], mesh.vertices[i0 * 3 + 2]];
        const v1 = [mesh.vertices[i1 * 3], mesh.vertices[i1 * 3 + 1], mesh.vertices[i1 * 3 + 2]];
        const v2 = [mesh.vertices[i2 * 3], mesh.vertices[i2 * 3 + 1], mesh.vertices[i2 * 3 + 2]];
        let t, uv, nrm;
        if (intersectTriangle(localRo, localRd, v0, v1, v2, t, uv, nrm)) {
          if (t < bestT) { bestT = t; best = o; }
        }
      }
    }
    // اختبار الأيقونات (إضاءات، كاميرات، عظام)
    const rect = container.getBoundingClientRect();
    const iconHitRadius = 22;
    let bestIconDist = iconHitRadius;
    let bestIconObj = null;
    for (const o of scene.objects) {
      if (!o.visible) continue;
      if (o.kind !== 'light' && o.kind !== 'camera' && o.kind !== 'bone') continue;
      const p = projectPoint(o.position);
      if (!p) continue;
      const d = Math.hypot(p[0] - (sx - rect.left), p[1] - (sy - rect.top));
      if (d < bestIconDist) { bestIconDist = d; bestIconObj = o; }
    }
    if (bestIconObj) return bestIconObj;
    return best;
  }

  window.__viewportHelpers = { screenToNDC, getRayFromScreen, projectPoint, pickObjectAtScreen };

  // ---- تحكم الكاميرا واللمس ----
  let pointers = new Map();
  let dragMode = null; // 'orbit' | 'gizmo' | 'twoFinger' | 'sceneCam'
  let dragStart = null;
  let gizmoDragAxis = null;
  let gizmoDragObj = null;
  let gizmoStartVal = null;
  let twoFingerStart = null;
  let sceneCamSingleDrag = null;
  let sceneCamTwoFingerStart = null;

  function getPointersArr() { return [...pointers.values()]; }

  function isInteractiveTarget(el) {
    return !!(el.closest && el.closest('button, .float-btn, .gmode, .render-fab, svg, .render-progress-overlay'));
  }

  // ---- Gizmo ثلاثي الأبعاد (رسم وتفاعل) ----
  let gizmoHandles = [];

  const AXIS_COLORS = { x: '#ff5555', y: '#55dd88', z: '#4a7fff' };

  function worldSizeForScreenPixels(worldPos, pixels) {
    const cam = getActiveRenderCamera();
    const rel = sub3(worldPos, cam.pos);
    const camZ = Math.max(dot3(rel, cam.forward), 0.05);
    const tanFov = Math.tan(cam.fov * Math.PI / 180 * 0.5);
    const rect = container.getBoundingClientRect();
    const worldPerPixelAtDist = (2 * camZ * tanFov) / Math.max(rect.height, 1);
    return worldPerPixelAtDist * pixels;
  }

  function ringPointsForAxis(center, axis, radius, segments) {
    const pts = [];
    let u, v;
    if (axis === 'x') { u = [0, 1, 0]; v = [0, 0, 1]; }
    else if (axis === 'y') { u = [1, 0, 0]; v = [0, 0, 1]; }
    else { u = [1, 0, 0]; v = [0, 1, 0]; }
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const wp = add3(center, add3(scale3(u, Math.cos(t) * radius), scale3(v, Math.sin(t) * radius)));
      pts.push(projectPoint(wp));
    }
    return pts;
  }

  function drawGizmo() {
    gizmoSvg.innerHTML = '';
    gizmoHandles = [];
    drawSceneDecorations();

    const o = scene.getSelected();
    if (!o) return;
    const mode = window.__gizmoMode || 'translate';
    if (o.kind === 'camera' && mode === 'scale') return;
    const center = projectPoint(o.position);
    if (!center) return;
    const rect = container.getBoundingClientRect();
    gizmoSvg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    const ns = 'http://www.w3.org/2000/svg';

    // نقطة المركز
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', center[0]); dot.setAttribute('cy', center[1]);
    dot.setAttribute('r', 4); dot.setAttribute('fill', '#fff');
    dot.setAttribute('stroke', '#000'); dot.setAttribute('stroke-width', '1');
    gizmoSvg.appendChild(dot);

    const axes = [{ axis: 'x', dir: [1, 0, 0] }, { axis: 'y', dir: [0, 1, 0] }, { axis: 'z', dir: [0, 0, 1] }];
    const handleSize = worldSizeForScreenPixels(o.position, 70);

    if (mode === 'translate' || mode === 'scale') {
      axes.forEach(({ axis, dir }) => {
        const end = add3(o.position, scale3(dir, handleSize));
        const pEnd = projectPoint(end);
        if (!pEnd) return;
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', center[0]); line.setAttribute('y1', center[1]);
        line.setAttribute('x2', pEnd[0]); line.setAttribute('y2', pEnd[1]);
        line.setAttribute('stroke', AXIS_COLORS[axis]);
        line.setAttribute('stroke-width', '3.5');
        line.setAttribute('stroke-linecap', 'round');
        gizmoSvg.appendChild(line);

        const handleShape = mode === 'scale' ? 'rect' : 'circle';
        const handle = document.createElementNS(ns, handleShape);
        if (handleShape === 'circle') {
          handle.setAttribute('cx', pEnd[0]); handle.setAttribute('cy', pEnd[1]); handle.setAttribute('r', 10);
        } else {
          handle.setAttribute('x', pEnd[0] - 7); handle.setAttribute('y', pEnd[1] - 7);
          handle.setAttribute('width', 14); handle.setAttribute('height', 14);
        }
        handle.setAttribute('fill', AXIS_COLORS[axis]);
        handle.setAttribute('stroke', '#fff'); handle.setAttribute('stroke-width', '1.5');
        gizmoSvg.appendChild(handle);
        gizmoHandles.push({ axis, kind: 'linear', x: pEnd[0], y: pEnd[1] });
      });
    } else if (mode === 'rotate') {
      const radius = handleSize * 1.2;
      axes.forEach(({ axis }) => {
        const pts = ringPointsForAxis(o.position, axis, radius, 48);
        const validPts = pts.filter(p => p);
        if (validPts.length < 4) return;
        const pathD = validPts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', AXIS_COLORS[axis]);
        path.setAttribute('stroke-width', '3');
        path.setAttribute('opacity', '0.95');
        gizmoSvg.appendChild(path);
        gizmoHandles.push({ axis, kind: 'ring', points: validPts });
      });
    }
  }

  function drawSceneDecorations() {
    const ns = 'http://www.w3.org/2000/svg';
    // رأس سهم للشمس
    if (!gizmoSvg.querySelector('#arrowHead')) {
      const defs = document.createElementNS(ns, 'defs');
      defs.innerHTML = `<marker id="arrowHead" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#ffdd66"/>
      </marker>`;
      gizmoSvg.appendChild(defs);
    }
    // رسم الأيقونات (إضاءات، كاميرات، عظام)
    scene.objects.forEach(o => {
      if (!o.visible) return;
      if (o.kind === 'light' && o.subtype === 'sun') {
        const p0 = projectPoint(o.position);
        const dir = o.getLightDirection();
        const lineLen = worldSizeForScreenPixels(o.position, 55);
        const p1 = projectPoint(add3(o.position, scale3(dir, lineLen)));
        const isSel = o.id === scene.selectedId;
        if (p0 && p1) {
          const line = document.createElementNS(ns, 'line');
          line.setAttribute('x1', p0[0]); line.setAttribute('y1', p0[1]);
          line.setAttribute('x2', p1[0]); line.setAttribute('y2', p1[1]);
          line.setAttribute('stroke', isSel ? '#4a7fff' : '#ffdd66');
          line.setAttribute('stroke-width', isSel ? '2.5' : '1.5');
          line.setAttribute('marker-end', 'url(#arrowHead)');
          gizmoSvg.appendChild(line);
          const dot = document.createElementNS(ns, 'circle');
          dot.setAttribute('cx', p0[0]); dot.setAttribute('cy', p0[1]);
          dot.setAttribute('r', isSel ? 7 : 5);
          dot.setAttribute('fill', isSel ? '#4a7fff' : '#ffdd66');
          dot.setAttribute('stroke', '#00000055');
          gizmoSvg.appendChild(dot);
        }
      } else if (o.kind === 'light' && o.subtype === 'spot') {
        const p0 = projectPoint(o.position);
        const dir = o.getForwardDirection();
        const isSel = o.id === scene.selectedId;
        const len = worldSizeForScreenPixels(o.position, 65);
        const endCenter = add3(o.position, scale3(dir, len));
        const angle = (o.light.spotAngle || 35) * Math.PI / 180;
        const coneR = Math.tan(angle) * len;
        let u, v;
        const absY = Math.abs(dir[1]);
        if (absY < 0.99) { u = normalize3(cross3([0, 1, 0], dir)); } else { u = [1, 0, 0]; }
        v = normalize3(cross3(dir, u));
        const segs = 20; const ringPts = [];
        for (let i = 0; i <= segs; i++) {
          const t = (i / segs) * Math.PI * 2;
          const wp = add3(endCenter, add3(scale3(u, Math.cos(t) * coneR), scale3(v, Math.sin(t) * coneR)));
          ringPts.push(projectPoint(wp));
        }
        const validRing = ringPts.filter(p => p);
        if (p0 && validRing.length > 3) {
          const pathD = validRing.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
          const path = document.createElementNS(ns, 'path');
          path.setAttribute('d', pathD); path.setAttribute('fill', 'none');
          path.setAttribute('stroke', isSel ? '#4a7fff' : '#ffaa44');
          path.setAttribute('stroke-width', '1.5'); path.setAttribute('opacity', '0.85');
          gizmoSvg.appendChild(path);
          [0, Math.floor(segs / 4), Math.floor(segs / 2), Math.floor(3 * segs / 4)].forEach(idx => {
            const p = validRing[idx];
            if (!p) return;
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', p0[0]); line.setAttribute('y1', p0[1]);
            line.setAttribute('x2', p[0]); line.setAttribute('y2', p[1]);
            line.setAttribute('stroke', isSel ? '#4a7fff' : '#ffaa44');
            line.setAttribute('stroke-width', '1'); line.setAttribute('opacity', '0.6');
            gizmoSvg.appendChild(line);
          });
          const dot = document.createElementNS(ns, 'circle');
          dot.setAttribute('cx', p0[0]); dot.setAttribute('cy', p0[1]);
          dot.setAttribute('r', isSel ? 7 : 5);
          dot.setAttribute('fill', isSel ? '#4a7fff' : '#ffaa44');
          gizmoSvg.appendChild(dot);
        }
      } else if (o.kind === 'light' && (o.subtype === 'point' || o.subtype === 'area')) {
        const p0 = projectPoint(o.position);
        const isSel = o.id === scene.selectedId;
        if (p0) {
          const dot = document.createElementNS(ns, 'circle');
          dot.setAttribute('cx', p0[0]); dot.setAttribute('cy', p0[1]);
          dot.setAttribute('r', isSel ? 8 : 6);
          dot.setAttribute('fill', isSel ? '#4a7fff' : (o.subtype === 'point' ? '#ffe066' : '#66ccff'));
          dot.setAttribute('stroke', '#00000055');
          gizmoSvg.appendChild(dot);
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const rx = p0[0] + Math.cos(a) * 11, ry = p0[1] + Math.sin(a) * 11;
            const rx2 = p0[0] + Math.cos(a) * 15, ry2 = p0[1] + Math.sin(a) * 15;
            const ray = document.createElementNS(ns, 'line');
            ray.setAttribute('x1', rx); ray.setAttribute('y1', ry);
            ray.setAttribute('x2', rx2); ray.setAttribute('y2', ry2);
            ray.setAttribute('stroke', isSel ? '#4a7fff' : (o.subtype === 'point' ? '#ffe066' : '#66ccff'));
            ray.setAttribute('stroke-width', '1.2'); ray.setAttribute('opacity', '0.7');
            gizmoSvg.appendChild(ray);
          }
        }
      } else if (o.kind === 'camera') {
        drawCameraGizmo(o);
      } else if (o.kind === 'bone') {
        const p0 = projectPoint(o.position);
        if (!p0) return;
        const isSel = o.id === scene.selectedId;
        if (o.boneParentId) {
          const parent = scene.getObject(o.boneParentId);
          if (parent) {
            const p1 = projectPoint(parent.position);
            if (p1) {
              const line = document.createElementNS(ns, 'line');
              line.setAttribute('x1', p0[0]); line.setAttribute('y1', p0[1]);
              line.setAttribute('x2', p1[0]); line.setAttribute('y2', p1[1]);
              line.setAttribute('stroke', '#a855f7');
              line.setAttribute('stroke-width', '2');
              line.setAttribute('opacity', '0.85');
              gizmoSvg.appendChild(line);
            }
          }
        }
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', p0[0]); dot.setAttribute('cy', p0[1]);
        dot.setAttribute('r', isSel ? 8 : 6);
        dot.setAttribute('fill', isSel ? '#ffffff' : '#3b82f6');
        dot.setAttribute('stroke', '#1e3a8a');
        dot.setAttribute('stroke-width', '1.5');
        gizmoSvg.appendChild(dot);
        gizmoHandles.push({ axis: null, kind: 'bone-pick', objId: o.id, x: p0[0], y: p0[1] });
      }
    });
  }

  function drawCameraGizmo(o) {
    const ns = 'http://www.w3.org/2000/svg';
    const fwd = o.getForwardDirection();
    let upv = [0, 1, 0];
    let right = cross3(fwd, upv);
    if (len3(right) < 0.001) right = [1, 0, 0];
    right = normalize3(right);
    const up = normalize3(cross3(right, fwd));
    const focalDist = worldSizeForScreenPixels(o.position, 40);
    const camSize = focalDist * 0.5;
    const corners = [
      add3(add3(o.position, scale3(right, camSize)), add3(scale3(up, camSize * 0.7), scale3(fwd, focalDist))),
      add3(add3(o.position, scale3(right, -camSize)), add3(scale3(up, camSize * 0.7), scale3(fwd, focalDist))),
      add3(add3(o.position, scale3(right, -camSize)), add3(scale3(up, -camSize * 0.7), scale3(fwd, focalDist))),
      add3(add3(o.position, scale3(right, camSize)), add3(scale3(up, -camSize * 0.7), scale3(fwd, focalDist)))
    ];
    const p0 = projectPoint(o.position);
    const pc = corners.map(c => projectPoint(c));
    if (!p0 || pc.some(p => !p)) return;
    const color = o.id === scene.selectedId ? '#4a7fff' : '#cccccc';
    pc.forEach(p => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', p0[0]); line.setAttribute('y1', p0[1]);
      line.setAttribute('x2', p[0]); line.setAttribute('y2', p[1]);
      line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1.3'); line.setAttribute('opacity', '0.85');
      gizmoSvg.appendChild(line);
    });
    const framePath = pc.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + ' Z';
    const frame = document.createElementNS(ns, 'path');
    frame.setAttribute('d', framePath); frame.setAttribute('fill', 'none');
    frame.setAttribute('stroke', color); frame.setAttribute('stroke-width', '1.5');
    gizmoSvg.appendChild(frame);
    const body = document.createElementNS(ns, 'rect');
    body.setAttribute('x', p0[0] - 7); body.setAttribute('y', p0[1] - 6);
    body.setAttribute('width', 14); body.setAttribute('height', 12);
    body.setAttribute('rx', 2);
    body.setAttribute('fill', color); body.setAttribute('stroke', '#000'); body.setAttribute('stroke-width', '1');
    gizmoSvg.appendChild(body);
    gizmoHandles.push({ axis: null, kind: 'camera-pick', objId: o.id, x: p0[0], y: p0[1] });
  }

  function hitTestGizmo(sx, sy) {
    const rect = container.getBoundingClientRect();
    const lx = sx - rect.left, ly = sy - rect.top;
    let best = null, bestD = 24;
    for (const h of gizmoHandles) {
      if (h.kind === 'linear') {
        const d = Math.hypot(lx - h.x, ly - h.y);
        if (d < bestD) { bestD = d; best = h.axis; }
      } else if (h.kind === 'ring') {
        for (let i = 0; i < h.points.length - 1; i++) {
          const a = h.points[i], b = h.points[i + 1];
          if (!a || !b) continue;
          const d = distToSegment(lx, ly, a[0], a[1], b[0], b[1]);
          if (d < bestD) { bestD = d; best = h.axis; }
        }
      }
    }
    return best;
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function applyGizmoDrag(e) {
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    const mode = window.__gizmoMode;
    const axis = gizmoDragAxis;
    const axisIdx = { x: 0, y: 1, z: 2 } [axis];
    const sensitivity = 0.01 * (scene.camera.distance / 6);

    if (mode === 'translate') {
      const screenDelta = (axis === 'y') ? -dy : dx;
      const newVal = gizmoStartVal.pos[axisIdx] + screenDelta * sensitivity * (axis === 'z' ? -1 : 1);
      gizmoDragObj.position[axisIdx] = newVal;
    } else if (mode === 'scale') {
      const screenDelta = (axis === 'y') ? -dy : dx;
      const newVal = Math.max(0.05, gizmoStartVal.scale[axisIdx] + screenDelta * sensitivity);
      gizmoDragObj.scaleXYZ[axisIdx] = newVal;
    } else if (mode === 'rotate') {
      const sensitivityRot = 0.012;
      const newVal = gizmoStartVal.rot[axisIdx] + dx * sensitivityRot;
      gizmoDragObj.rotation[axisIdx] = newVal;
    }
    UI.onSceneChanged();
    UI.refreshSelection();
  }

  document.querySelectorAll('.gmode').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.gmode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window.__gizmoMode = btn.dataset.mode;
    };
  });
  window.__gizmoMode = 'translate';

  // ---- أحداث اللمس والفأرة ----
  container.addEventListener('pointerdown', (e) => {
    if (isInteractiveTarget(e.target)) return;
    try { container.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      const axis = hitTestGizmo(e.clientX, e.clientY);
      if (axis && !SceneCameraState.active) {
        dragMode = 'gizmo';
        gizmoDragAxis = axis;
        gizmoDragObj = scene.getSelected();
        dragStart = { x: e.clientX, y: e.clientY };
        if (gizmoDragObj) {
          gizmoStartVal = {
            pos: [...gizmoDragObj.position],
            rot: [...gizmoDragObj.rotation],
            scale: [...gizmoDragObj.scaleXYZ]
          };
        }
      } else if (SceneCameraState.active) {
        dragMode = 'sceneCam';
        sceneCameraPointerDown(e);
      } else {
        dragMode = 'orbit';
        dragStart = { x: e.clientX, y: e.clientY, yaw: scene.camera.yaw, pitch: scene.camera.pitch };
      }
    } else if (pointers.size === 2) {
      if (SceneCameraState.active) {
        dragMode = 'sceneCam';
        sceneCameraPointerDown(e);
      } else {
        dragMode = 'twoFinger';
        const pts = getPointersArr();
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;
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

  container.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (dragMode === 'sceneCam') {
      sceneCameraPointerMove(e);
      return;
    }

    if (pointers.size === 2 && dragMode === 'twoFinger') {
      const pts = getPointersArr();
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;

      // تحريك أمام/خلف (بدون حدود)
      const distDelta = dist - twoFingerStart.dist;
      const moveAmount = distDelta * 0.02 * (Math.max(twoFingerStart.camDistance, 0.5) / 6);
      const cam = scene.camera;
      const forwardMove = scale3(cam.forward, moveAmount);
      scene.camera.distance = Math.max(0.02, twoFingerStart.camDistance - distDelta * 0.02);
      scene.camera.target = add3(twoFingerStart.camTarget, forwardMove);

      // تحريك جانبي (pan)
      const dx = midX - twoFingerStart.midX;
      const dy = midY - twoFingerStart.midY;
      const panX = scale3(cam.right, -dx * 0.006 * (Math.max(scene.camera.distance, 0.5) / 6));
      const panY = scale3(cam.up, dy * 0.006 * (Math.max(scene.camera.distance, 0.5) / 6));
      scene.camera.target = add3(add3(scene.camera.target, panX), panY);

      scene.camera.update();
      UI.onSceneChanged();
      return;
    }

    if (dragMode === 'orbit' && pointers.size === 1) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      scene.camera.yaw = dragStart.yaw - dx * 0.008;
      scene.camera.pitch = Math.max(-1.5, Math.min(1.5, dragStart.pitch + dy * 0.008));
      scene.camera.update();
      UI.onSceneChanged();
    } else if (dragMode === 'gizmo' && gizmoDragObj) {
      applyGizmoDrag(e);
    }
  });

  function endDrag(e) {
    if (pointers.has(e.pointerId)) pointers.delete(e.pointerId);
    if (pointers.size < 2 && dragMode === 'twoFinger') {
      dragMode = pointers.size === 1 ? 'orbit' : null;
      if (dragMode === 'orbit') {
        const p = getPointersArr()[0];
        dragStart = { x: p.x, y: p.y, yaw: scene.camera.yaw, pitch: scene.camera.pitch };
      }
    }
    if (dragMode === 'sceneCam' && pointers.size >= 1) {
      sceneCameraPointerDown({ clientX: getPointersArr()[0].x, clientY: getPointersArr()[0].y });
    }
    if (pointers.size === 0) {
      if (dragMode === 'gizmo') UI.pushUndo();
      dragMode = null; gizmoDragAxis = null; gizmoDragObj = null;
      sceneCamSingleDrag = null; sceneCamTwoFingerStart = null;
    }
  }
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (SceneCameraState.active) {
      sceneCameraWheel(e.deltaY);
      return;
    }
    scene.camera.distance = Math.max(0.02, scene.camera.distance + e.deltaY * 0.01 * Math.max(scene.camera.distance * 0.15, 0.5));
    scene.camera.update();
    UI.onSceneChanged();
  }, { passive: false });

  // ---- اختيار عنصر باللمس ----
  let clickStartPos = null;
  container.addEventListener('pointerdown', (e) => {
    if (isInteractiveTarget(e.target)) { clickStartPos = null; return; }
    if (pointers.size <= 1) clickStartPos = { x: e.clientX, y: e.clientY };
  }, { capture: true });
  container.addEventListener('pointerup', (e) => {
    if (!clickStartPos) return;
    if (isInteractiveTarget(e.target)) { clickStartPos = null; return; }
    const moved = Math.hypot(e.clientX - clickStartPos.x, e.clientY - clickStartPos.y);
    if (moved < 8 && dragMode !== 'gizmo' && dragMode !== 'twoFinger') {
      const picked = pickObjectAtScreen(e.clientX, e.clientY);
      scene.selectedId = picked ? picked.id : null;
      UI.refreshSceneTree();
      UI.refreshSelection();
      UI.onSceneChanged();
    }
    clickStartPos = null;
  });

  // ---- كاميرا المشهد (الدخول/الخروج) ----
  const SceneCameraState = {
    active: false,
    camObj: null,
    pos: [0, 0, 0],
    yawDelta: 0,
    pitchDelta: 0,
    roll: 0,
    baseRotation: [0, 0, 0]
  };

  function computeCamBasis(camObjRef, roll) {
    const forward = camObjRef.getForwardDirection();
    let up0 = [0, 1, 0];
    let right = cross3(forward, up0);
    if (len3(right) < 0.001) right = [1, 0, 0];
    right = normalize3(right);
    let up = normalize3(cross3(right, forward));
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rightRolled = normalize3(add3(scale3(right, cr), scale3(up, sr)));
    const upRolled = normalize3(add3(scale3(up, cr), scale3(right, -sr)));
    return { forward, right: rightRolled, up: upRolled };
  }

  function enterSceneCamera(camObjRef) {
    SceneCameraState.active = true;
    SceneCameraState.camObj = camObjRef;
    SceneCameraState.pos = [...camObjRef.position];
    SceneCameraState.baseRotation = [...camObjRef.rotation];
    SceneCameraState.yawDelta = 0;
    SceneCameraState.pitchDelta = 0;
    SceneCameraState.roll = 0;
    document.getElementById('btnCameraToggle').classList.add('active');
    UI.toast('دخلت منظور: ' + camObjRef.name);
    UI.onSceneChanged();
  }
  function exitSceneCamera() {
    SceneCameraState.active = false;
    document.getElementById('btnCameraToggle').classList.remove('active');
    UI.onSceneChanged();
  }
  window.__enterSceneCamera = enterSceneCamera;

  document.getElementById('btnCameraToggle').addEventListener('click', () => {
    if (SceneCameraState.active) {
      exitSceneCamera();
    } else {
      let camObjRef = scene.objects.find(o => o.kind === 'camera');
      if (!camObjRef) {
        camObjRef = new SceneObject('camera', 'camera');
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

  function getActiveRenderCamera() {
    if (!SceneCameraState.active || !SceneCameraState.camObj) return scene.camera;
    const camObj = SceneCameraState.camObj;
    const tempObj = {
      rotation: [
        camObj.rotation[0] + SceneCameraState.pitchDelta,
        camObj.rotation[1] + SceneCameraState.yawDelta,
        camObj.rotation[2]
      ],
      getRotationMatrix: SceneObject.prototype.getRotationMatrix,
      getForwardDirection: SceneObject.prototype.getForwardDirection
    };
    const basis = computeCamBasis(tempObj, SceneCameraState.roll);
    const camSettings = camObj.camSettings;
    return {
      pos: SceneCameraState.pos,
      forward: basis.forward, right: basis.right, up: basis.up,
      fov: camSettings.fov, dofEnabled: camSettings.dofEnabled,
      focusDist: camSettings.focusDist, aperture: camSettings.aperture
    };
  }

  function sceneCameraPointerDown(e) {
    if (pointers.size === 1) {
      sceneCamSingleDrag = { x: e.clientX, y: e.clientY, yawDelta: SceneCameraState.yawDelta, pitchDelta: SceneCameraState.pitchDelta };
    } else if (pointers.size === 2) {
      const pts = getPointersArr();
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      sceneCamTwoFingerStart = { angle, roll: SceneCameraState.roll };
    }
  }

  function sceneCameraPointerMove(e) {
    if (pointers.size === 2 && sceneCamTwoFingerStart) {
      const pts = getPointersArr();
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      let delta = angle - sceneCamTwoFingerStart.angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      SceneCameraState.roll = sceneCamTwoFingerStart.roll + delta;
      UI.onSceneChanged();
      return;
    }
    if (pointers.size === 1 && sceneCamSingleDrag) {
      const dx = e.clientX - sceneCamSingleDrag.x, dy = e.clientY - sceneCamSingleDrag.y;
      SceneCameraState.yawDelta = sceneCamSingleDrag.yawDelta - dx * 0.008;
      SceneCameraState.pitchDelta = Math.max(-1.5, Math.min(1.5, sceneCamSingleDrag.pitchDelta - dy * 0.008));
      UI.onSceneChanged();
    }
  }

  function sceneCameraWheel(deltaY) {
    const cam = getActiveRenderCamera();
    const move = -deltaY * 0.01;
    SceneCameraState.pos = add3(SceneCameraState.pos, scale3(cam.forward, move));
    UI.onSceneChanged();
  }

  // ---- حلقة الرندر ----
  let fpsCounter = { frames: 0, last: performance.now() };
  let lastSavedBlobCanvas = null;

  const btnRenderToggle = document.getElementById('btnRenderToggle');
  const renderProgressBar = document.getElementById('renderProgressBar');
  const btnSaveRenderTab = document.getElementById('btnSaveRenderTab');

  function setFabState(state) {
    if (state === 'idle') {
      btnRenderToggle.classList.remove('active');
      btnRenderToggle.title = 'رندر';
      renderProgressBar.classList.add('hidden');
    } else if (state === 'realtime') {
      btnRenderToggle.classList.add('active');
      btnRenderToggle.title = 'إيقاف المعاينة الحية';
      renderProgressBar.classList.add('hidden');
    } else if (state === 'rendering') {
      btnRenderToggle.classList.add('active');
      btnRenderToggle.title = 'إيقاف الرندر';
      renderProgressBar.classList.remove('hidden');
    }
  }

  btnRenderToggle.addEventListener('click', () => {
    if (AppState.mode === 'preview') {
      if (scene.renderSettings.realtimeMode) {
        startRealtime();
      } else {
        startFinalRender();
      }
    } else if (AppState.mode === 'realtime') {
      stopRealtime();
    } else if (AppState.mode === 'rendering') {
      AppState.renderCancelled = true;
    }
  });

  function startRealtime() {
    AppState.mode = 'realtime';
    engine.tileSize = scene.renderSettings.tileSize;
    engine.needsReset = true;
    setFabState('realtime');
  }
  function stopRealtime() {
    AppState.mode = 'preview';
    setFabState('idle');
  }

  async function startFinalRender() {
    AppState.mode = 'rendering';
    AppState.renderCancelled = false;
    setFabState('rendering');

    const resSel = document.getElementById('outputRes').value;
    let w, h;
    if (resSel === 'custom') {
      w = parseInt(document.getElementById('customW').value) || 1280;
      h = parseInt(document.getElementById('customH').value) || 720;
    } else {
      [w, h] = resSel.split('x').map(Number);
    }
    const totalSamples = parseInt(document.getElementById('outSamples').value);

    const viewportW = engine.width, viewportH = engine.height;
    engine.tileSize = 9999;
    engine.resize(w, h);
    engine.reset();

    for (let s = 0; s < totalSamples; s++) {
      if (AppState.renderCancelled) break;
      engine.renderFullFrame(scene, getActiveRenderCamera());
      engine.present(
        scene.renderSettings.denoiser, scene.renderSettings.denoiserStrength,
        scene.renderSettings.bloom, scene.renderSettings.bloomStrength, scene.renderSettings.bloomThreshold
      );
      const pct = Math.round(((s + 1) / totalSamples) * 100);
      UI.setRenderProgress(pct, `جاري الرندر... ${s+1}/${totalSamples} عينة (${pct}%)`);
      await new Promise(r => requestAnimationFrame(r));
    }

    const wasCancelled = AppState.renderCancelled;
    if (!wasCancelled) {
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

    engine.tileSize = scene.renderSettings.tileSize;
    fitViewport();
    AppState.mode = 'preview';
    setFabState('idle');
  }

  btnSaveRenderTab.addEventListener('click', () => {
    if (!lastSavedBlobCanvas) return;
    lastSavedBlobCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'render_' + Date.now() + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      UI.toast('تم حفظ الصورة');
    }, 'image/png');
  });

  function liveLoop() {
    requestAnimationFrame(liveLoop);
    const activeCam = getActiveRenderCamera();

    if (AppState.mode === 'preview') {
      engine.renderPreview(scene, activeCam);
      drawGizmo();
    } else if (AppState.mode === 'realtime') {
      if (engine.needsReset) engine.reset();
      engine.renderTileStep(scene, activeCam);
      engine.present(
        scene.renderSettings.denoiser, scene.renderSettings.denoiserStrength,
        scene.renderSettings.bloom, scene.renderSettings.bloomStrength, scene.renderSettings.bloomThreshold
      );
      drawGizmo();
    } else if (AppState.mode === 'rendering') {
      // الرندر النهائي يُدار بواسطة startFinalRender
    }

    fpsCounter.frames++;
    const now = performance.now();
    if (now - fpsCounter.last > 500) {
      fpsCounter.frames = 0; fpsCounter.last = now;
    }
  }
  requestAnimationFrame(liveLoop);

  // ---- استيراد GLTF (مع الهيكل العظمي) ----
  async function importModelFile(file) {
    try {
      UI.toast('جاري تحليل الملف...');
      const name = file.name.toLowerCase();
      let gltfJson, binBuffers = [];

      if (name.endsWith('.glb')) {
        const buf = await file.arrayBuffer();
        const parsed = parseGLB(buf);
        gltfJson = parsed.json;
        binBuffers = parsed.binChunks;
      } else if (name.endsWith('.gltf')) {
        const text = await file.text();
        gltfJson = JSON.parse(text);
      } else if (name.endsWith('.zip')) {
        const buf = await file.arrayBuffer();
        const entries = await parseZip(buf);
        const gltfEntry = entries.find(e => e.name.toLowerCase().endsWith('.gltf'));
        const glbEntry = entries.find(e => e.name.toLowerCase().endsWith('.glb'));
        if (glbEntry) {
          const parsed = parseGLB(glbEntry.data.buffer.slice(glbEntry.data.byteOffset, glbEntry.data.byteOffset + glbEntry.data.byteLength));
          gltfJson = parsed.json;
          binBuffers = parsed.binChunks;
        } else if (gltfEntry) {
          gltfJson = JSON.parse(new TextDecoder().decode(gltfEntry.data));
          const binEntry = entries.find(e => e.name.toLowerCase().endsWith('.bin'));
          if (binEntry) binBuffers = [binEntry.data.buffer.slice(binEntry.data.byteOffset, binEntry.data.byteOffset + binEntry.data.byteLength)];
        } else {
          UI.toast('لم يُعثر على ملف gltf/glb داخل الأرشيف');
          return;
        }
      } else {
        UI.toast('صيغة غير مدعومة');
        return;
      }

      if (!gltfJson) { UI.toast('تعذّر قراءة الملف'); return; }
      importSkeletonFromGLTF(gltfJson);
      UI.pushUndo();
      UI.onSceneChanged();
      UI.refreshSceneTree();
      UI.toast('تم استيراد النموذج (الهيكل العظمي والعقد)');
    } catch (err) {
      console.error(err);
      UI.toast('خطأ أثناء الاستيراد: ' + err.message);
    }
  }
  window.__importModelFile = importModelFile;

  // دوال مساعدة لـ GLTF
  function parseGLB(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const magic = dv.getUint32(0, true);
    if (magic !== 0x46546C67) throw new Error('ليس ملف GLB صالحاً');
    const version = dv.getUint32(4, true);
    const length = dv.getUint32(8, true);
    let offset = 12;
    let json = null;
    const binChunks = [];
    while (offset < length) {
      const chunkLength = dv.getUint32(offset, true); offset += 4;
      const chunkType = dv.getUint32(offset, true); offset += 4;
      const chunkData = arrayBuffer.slice(offset, offset + chunkLength);
      if (chunkType === 0x4E4F534A) {
        json = JSON.parse(new TextDecoder().decode(chunkData));
      } else if (chunkType === 0x004E4942) {
        binChunks.push(chunkData);
      }
      offset += chunkLength;
    }
    return { json, binChunks };
  }

  async function parseZip(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const entries = [];
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset < 0) throw new Error('ملف ZIP غير صالح');
    const cdOffset = dv.getUint32(eocdOffset + 16, true);
    const cdEntries = dv.getUint16(eocdOffset + 10, true);
    let ptr = cdOffset;
    const rawEntries = [];
    for (let i = 0; i < cdEntries; i++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) break;
      const method = dv.getUint16(ptr + 10, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localHeaderOffset = dv.getUint32(ptr + 42, true);
      const name = new TextDecoder().decode(bytes.slice(ptr + 46, ptr + 46 + nameLen));
      rawEntries.push({ name, method, compSize, localHeaderOffset });
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    for (const re of rawEntries) {
      const lh = re.localHeaderOffset;
      if (dv.getUint32(lh, true) !== 0x04034b50) continue;
      const nameLen = dv.getUint16(lh + 26, true);
      const extraLen = dv.getUint16(lh + 28, true);
      const dataStart = lh + 30 + nameLen + extraLen;
      const compData = bytes.slice(dataStart, dataStart + re.compSize);
      let data;
      if (re.method === 0) {
        data = compData;
      } else if (re.method === 8 && typeof DecompressionStream !== 'undefined') {
        data = await inflateRaw(compData);
      } else {
        continue;
      }
      entries.push({ name: re.name, data });
    }
    return entries;
  }

  async function inflateRaw(compressedBytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([compressedBytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function importSkeletonFromGLTF(gltfJson) {
    if (!gltfJson.nodes || gltfJson.nodes.length === 0) {
      UI.toast('لا توجد عقد/هيكل عظمي في هذا الملف');
      return;
    }
    const idMap = new Map();
    const importOffset = [(Math.random() - 0.5) * 1.0, 0, (Math.random() - 0.5) * 1.0];

    gltfJson.nodes.forEach((node, idx) => {
      const bone = new SceneObject('bone', 'bone');
      bone.name = node.name || ('عظمة ' + idx);
      const t = node.translation || [0, 0, 0];
      bone.position = [t[0] + importOffset[0], t[1] + importOffset[1], t[2] + importOffset[2]];
      if (node.rotation) {
        bone.rotation = quatToEulerApprox(node.rotation);
      }
      scene.addObject(bone, false);
      idMap.set(idx, bone.id);
    });

    gltfJson.nodes.forEach((node, idx) => {
      if (!node.children) return;
      const parentBoneId = idMap.get(idx);
      node.children.forEach(childIdx => {
        const childBoneId = idMap.get(childIdx);
        const childObj = scene.getObject(childBoneId);
        if (childObj) {
          childObj.boneParentId = parentBoneId;
          const parentObj = scene.getObject(parentBoneId);
          if (parentObj) parentObj.boneChildren.push(childBoneId);
          const parentPos = parentObj.position;
          childObj.position = [
            childObj.position[0] - importOffset[0] + parentPos[0],
            childObj.position[1] - importOffset[1] + parentPos[1],
            childObj.position[2] - importOffset[2] + parentPos[2]
          ];
        }
      });
    });
  }

  function quatToEulerApprox(q) {
    const [x, y, z, w] = q;
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);
    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);
    return [roll, pitch, yaw];
  }

  // ربط زر الاستيراد
  document.getElementById('btnImportModel').onclick = () => document.getElementById('importFileInput').click();
  document.getElementById('importFileInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importModelFile(file);
    document.getElementById('importFileInput').value = '';
  };

  // ---- دوال مساعدة إضافية (mat4Identity) في حالة عدم تعريفها ----
  if (typeof mat4Identity === 'undefined') {
    window.mat4Identity = function() {
      return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    };
  }
})();
