// ======================================================================
// منطق واجهة المستخدم: لوحات، تبويبات، عناصر تحكم
// ======================================================================

const UI = {
  scene: null,
  engine: null,
  el: {},

  init(scene, engine){
    this.scene = scene;
    this.engine = engine;
    this.cacheEls();
    this.bindPanelToggles();
    this.bindSceneAdd();
    this.bindSceneTree();
    this.bindObjectProps();
    this.bindMaterialProps();
    this.bindEnvProps();
    this.bindRenderProps();
    this.bindTabs();
    this.initMaterialPreview();
    this.refreshSceneTree();
    this.refreshMaterialSelect();
    this.refreshSelection();
    this.refreshRenderSettingsUI();
  },

  cacheEls(){
    const ids = ['panelScene','panelProps','btnMenuToggleLeft','btnMenuToggleRight',
      'btnCloseLeft','btnCloseRight','sceneTree','btnDuplicate','btnDelete',
      'noSelection','objectProps','lightProps','lightRadiusField','lightRangeField',
      'lightSpotAngleField','lightSpotBlendField','cameraObjProps','scaleTitle','scaleRow',
      'propName','posX','posY','posZ','rotX','rotY','rotZ','scaleX','scaleY','scaleZ',
      'lightColor','lightIntensity','lightIntensityVal','lightRadius','lightRadiusVal',
      'lightRange','lightRangeVal','lightSpotAngle','lightSpotAngleVal','lightSpotBlend','lightSpotBlendVal',
      'objCamFov','objCamFovVal','objCamDof','objCamFocus','objCamFocusVal','objCamAperture','objCamApertureVal',
      'btnUseThisCamera',
      'noMatSelection','materialProps','materialSelect','btnNewMaterial','btnDupMaterial',
      'matName','matColor','matMetallic','matMetallicVal','matSmoothness','matSmoothnessVal',
      'matIOR','matIorVal','matTransmission','matTransVal','matSubsurface','matSubsurfaceVal',
      'matSubsurfaceColor','matEmission','matEmissionVal','matEmissionColor','btnApplyMaterial',
      'matPreviewCanvas',
      'envColorTop','envColorBottom','envIntensity','envIntensityVal',
      'realtimeToggle','bounces','bouncesVal','denoiserEnabled','denoiserStrength','denoiserStrengthVal',
      'bloomEnabled','bloomStrength','bloomStrengthVal','bloomThreshold','bloomThresholdVal',
      'tileSize','tileSizeVal','outputRes','customResFields','customW','customH',
      'outSamples','outSamplesVal','btnSaveRenderTab',
      'btnRenderToggle','renderFabIcon','renderFabLabel',
      'renderProgressBar','renderProgressFill','renderProgressText',
      'objCountBadge','btnUndo','btnRedo','btnFullscreen','toast'];
    ids.forEach(id=> this.el[id]=document.getElementById(id));
    this.gmodeBtns = document.querySelectorAll('.gmode');
    this.tabBtns = document.querySelectorAll('.tab-btn');
    this.tabContents = document.querySelectorAll('.tab-content');
  },

  toast(msg){
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=> t.classList.add('hidden'), 2000);
  },

  // ---------------- Panels ----------------
  bindPanelToggles(){
    this.el.btnMenuToggleLeft.onclick = ()=>{
      this.el.panelScene.classList.toggle('collapsed-left');
      this.el.panelProps.classList.add('collapsed-right');
    };
    this.el.btnMenuToggleRight.onclick = ()=>{
      this.el.panelProps.classList.toggle('collapsed-right');
      this.el.panelScene.classList.add('collapsed-left');
    };
    this.el.btnCloseLeft.onclick = ()=> this.el.panelScene.classList.add('collapsed-left');
    this.el.btnCloseRight.onclick = ()=> this.el.panelProps.classList.add('collapsed-right');
  },

  bindTabs(){
    this.tabBtns.forEach(btn=>{
      btn.onclick = ()=>{
        this.tabBtns.forEach(b=>b.classList.remove('active'));
        this.tabContents.forEach(c=>c.classList.remove('active'));
        btn.classList.add('active');
        const key = btn.dataset.tab;
        document.getElementById('tab'+key[0].toUpperCase()+key.slice(1)).classList.add('active');
      };
    });
  },

  // ---------------- Add objects/lights/camera ----------------
  bindSceneAdd(){
    document.querySelectorAll('[data-add]').forEach(btn=>{
      btn.onclick = ()=>{
        const subtype = btn.dataset.add;
        const obj = new SceneObject('mesh', subtype);
        obj.position = [ (Math.random()-0.5)*1.5, subtype==='plane'?0:0.5, (Math.random()-0.5)*1.5];
        obj.name = {cube:'مكعب',sphere:'كرة',plane:'مستوى',cylinder:'اسطوانة',cone:'مخروط',torus:'حلقة'}[subtype];
        this.scene.addObject(obj);
        this.pushUndo();
        this.onSceneChanged();
        this.refreshSceneTree();
        this.refreshMaterialSelect();
        this.refreshSelection();
        this.toast('تمت إضافة '+obj.name);
      };
    });
    document.querySelectorAll('[data-addlight]').forEach(btn=>{
      btn.onclick = ()=>{
        const subtype = btn.dataset.addlight;
        const obj = new SceneObject('light', subtype);
        obj.position = [0,2,0];
        if(subtype==='spot'){ obj.rotation = [-Math.PI/2, 0, 0]; }
        obj.name = {point:'إضاءة نقطية',sun:'إضاءة شمسية',area:'إضاءة مساحية',spot:'إضاءة بقعة'}[subtype];
        this.scene.addObject(obj);
        this.pushUndo();
        this.onSceneChanged();
        this.refreshSceneTree();
        this.refreshSelection();
        this.toast('تمت إضافة '+obj.name);
      };
    });
    document.querySelectorAll('[data-addcamera]').forEach(btn=>{
      btn.onclick = ()=>{
        const obj = new SceneObject('camera', 'camera');
        const cam = this.scene.camera;
        obj.position = [...cam.pos];
        // احسب دوران تقريبي يطابق اتجاه نظر الكاميرا الحالية
        obj.rotation = [ -this.scene.camera.pitch, this.scene.camera.yaw, 0 ];
        obj.name = 'كاميرا';
        this.scene.addObject(obj);
        this.pushUndo();
        this.onSceneChanged();
        this.refreshSceneTree();
        this.refreshSelection();
        this.toast('تمت إضافة كاميرا');
      };
    });
  },

  // ---------------- Scene tree ----------------
  refreshSceneTree(){
    const ul = this.el.sceneTree;
    ul.innerHTML = '';
    this.scene.objects.forEach(o=>{
      const li = document.createElement('li');
      li.dataset.id = o.id;
      if(o.id===this.scene.selectedId) li.classList.add('selected');
      let icon = '◆';
      if(o.kind==='light') icon = LIGHT_ICONS[o.subtype];
      else if(o.kind==='camera') icon = '🎥';
      else icon = TYPE_ICONS[o.subtype];
      li.innerHTML = `<span class="obj-icon">${icon}</span><span class="obj-name">${o.name}</span><span class="vis-toggle ${o.visible?'':'hidden-obj'}">👁</span>`;
      li.onclick = (e)=>{
        if(e.target.classList.contains('vis-toggle')){
          o.visible = !o.visible;
          this.onSceneChanged();
          this.refreshSceneTree();
          return;
        }
        this.scene.selectedId = o.id;
        this.refreshSceneTree();
        this.refreshSelection();
      };
      ul.appendChild(li);
    });
    const meshCount = this.scene.objects.filter(o=>o.kind==='mesh').length;
    this.el.objCountBadge.textContent = meshCount+' عنصر';
  },

  bindSceneTree(){
    this.el.btnDuplicate.onclick = ()=>{
      if(!this.scene.selectedId) return;
      this.scene.duplicateObject(this.scene.selectedId);
      this.pushUndo();
      this.onSceneChanged();
      this.refreshSceneTree();
      this.refreshMaterialSelect();
      this.refreshSelection();
      this.toast('تم النسخ');
    };
    this.el.btnDelete.onclick = ()=>{
      if(!this.scene.selectedId) return;
      this.scene.removeObject(this.scene.selectedId);
      this.pushUndo();
      this.onSceneChanged();
      this.refreshSceneTree();
      this.refreshMaterialSelect();
      this.refreshSelection();
      this.toast('تم الحذف');
    };
  },

  // ---------------- Object properties ----------------
  bindObjectProps(){
    this.el.propName.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o) return;
      o.name = this.el.propName.value;
      this.refreshSceneTree();
    };
    this.el.propName.onchange = ()=> this.pushUndo();

    ['posX','posY','posZ'].forEach((id,i)=>{
      this.el[id].oninput = ()=>{
        const o = this.scene.getSelected(); if(!o) return;
        o.position[i] = parseFloat(this.el[id].value)||0;
        this.onSceneChanged();
      };
      this.el[id].onchange = ()=> this.pushUndo();
    });
    ['rotX','rotY','rotZ'].forEach((id,i)=>{
      this.el[id].oninput = ()=>{
        const o = this.scene.getSelected(); if(!o) return;
        o.rotation[i] = (parseFloat(this.el[id].value)||0) * Math.PI/180;
        this.onSceneChanged();
      };
      this.el[id].onchange = ()=> this.pushUndo();
    });
    ['scaleX','scaleY','scaleZ'].forEach((id,i)=>{
      this.el[id].oninput = ()=>{
        const o = this.scene.getSelected(); if(!o) return;
        o.scaleXYZ[i] = Math.max(0.01, parseFloat(this.el[id].value)||1);
        this.onSceneChanged();
      };
      this.el[id].onchange = ()=> this.pushUndo();
    });

    // إضاءة
    this.el.lightColor.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.color = hexToRgb(this.el.lightColor.value);
      this.onSceneChanged();
    };
    this.el.lightColor.onchange = ()=> this.pushUndo();
    this.el.lightIntensity.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.intensity = parseFloat(this.el.lightIntensity.value);
      this.el.lightIntensityVal.textContent = o.light.intensity.toFixed(1);
      this.onSceneChanged();
    };
    this.el.lightIntensity.onchange = ()=> this.pushUndo();
    this.el.lightRadius.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.radius = parseFloat(this.el.lightRadius.value);
      this.el.lightRadiusVal.textContent = o.light.radius.toFixed(2);
      this.onSceneChanged();
    };
    this.el.lightRadius.onchange = ()=> this.pushUndo();
    this.el.lightRange.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.range = parseFloat(this.el.lightRange.value);
      this.el.lightRangeVal.textContent = o.light.range.toFixed(1);
      this.onSceneChanged();
    };
    this.el.lightRange.onchange = ()=> this.pushUndo();
    this.el.lightSpotAngle.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.spotAngle = parseFloat(this.el.lightSpotAngle.value);
      this.el.lightSpotAngleVal.textContent = o.light.spotAngle.toFixed(0);
      this.onSceneChanged();
    };
    this.el.lightSpotAngle.onchange = ()=> this.pushUndo();
    this.el.lightSpotBlend.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.spotBlend = parseFloat(this.el.lightSpotBlend.value);
      this.el.lightSpotBlendVal.textContent = o.light.spotBlend.toFixed(2);
      this.onSceneChanged();
    };
    this.el.lightSpotBlend.onchange = ()=> this.pushUndo();

    // كاميرا ككائن
    this.el.objCamFov.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='camera') return;
      o.camSettings.fov = parseFloat(this.el.objCamFov.value);
      this.el.objCamFovVal.textContent = o.camSettings.fov;
      this.onSceneChanged();
    };
    this.el.objCamFov.onchange = ()=> this.pushUndo();
    this.el.objCamDof.onchange = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='camera') return;
      o.camSettings.dofEnabled = this.el.objCamDof.checked;
      this.onSceneChanged();
      this.pushUndo();
    };
    this.el.objCamFocus.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='camera') return;
      o.camSettings.focusDist = parseFloat(this.el.objCamFocus.value);
      this.el.objCamFocusVal.textContent = o.camSettings.focusDist.toFixed(1);
      this.onSceneChanged();
    };
    this.el.objCamFocus.onchange = ()=> this.pushUndo();
    this.el.objCamAperture.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='camera') return;
      o.camSettings.aperture = parseFloat(this.el.objCamAperture.value);
      this.el.objCamApertureVal.textContent = o.camSettings.aperture.toFixed(3);
      this.onSceneChanged();
    };
    this.el.objCamAperture.onchange = ()=> this.pushUndo();
    this.el.btnUseThisCamera.onclick = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='camera') return;
      const cam = this.scene.camera;
      cam.fov = o.camSettings.fov;
      cam.dofEnabled = o.camSettings.dofEnabled;
      cam.focusDist = o.camSettings.focusDist;
      cam.aperture = o.camSettings.aperture;
      cam.target = [...o.position];
      cam.distance = 0.01;
      cam.pitch = -o.rotation[0];
      cam.yaw = o.rotation[1];
      cam.update();
      this.onSceneChanged();
      this.toast('تم تفعيل عرض هذه الكاميرا');
    };
  },

  refreshSelection(){
    const o = this.scene.getSelected();
    const hasSel = !!o;
    this.el.btnDuplicate.disabled = !hasSel;
    this.el.btnDelete.disabled = !hasSel;
    this.el.noSelection.classList.toggle('hidden', hasSel);
    this.el.objectProps.classList.toggle('hidden', !hasSel);

    const isMesh = hasSel && o.kind==='mesh';
    this.el.noMatSelection.classList.toggle('hidden', isMesh);
    this.el.materialProps.classList.toggle('hidden', !isMesh);

    if(!hasSel) return;

    this.el.propName.value = o.name;
    this.el.posX.value = o.position[0].toFixed(2);
    this.el.posY.value = o.position[1].toFixed(2);
    this.el.posZ.value = o.position[2].toFixed(2);
    this.el.rotX.value = (o.rotation[0]*180/Math.PI).toFixed(0);
    this.el.rotY.value = (o.rotation[1]*180/Math.PI).toFixed(0);
    this.el.rotZ.value = (o.rotation[2]*180/Math.PI).toFixed(0);

    const isLight = o.kind==='light';
    const isCamera = o.kind==='camera';
    const isMeshType = o.kind==='mesh';

    this.el.scaleRow.classList.toggle('hidden', !isMeshType);
    this.el.scaleTitle.classList.toggle('hidden', !isMeshType);
    if(isMeshType){
      this.el.scaleX.value = o.scaleXYZ[0].toFixed(2);
      this.el.scaleY.value = o.scaleXYZ[1].toFixed(2);
      this.el.scaleZ.value = o.scaleXYZ[2].toFixed(2);
    }

    this.el.lightProps.classList.toggle('hidden', !isLight);
    this.el.cameraObjProps.classList.toggle('hidden', !isCamera);

    if(isLight){
      this.el.lightColor.value = rgbToHex(o.light.color);
      this.el.lightIntensity.value = o.light.intensity;
      this.el.lightIntensityVal.textContent = o.light.intensity.toFixed(1);
      this.el.lightRadius.value = o.light.radius;
      this.el.lightRadiusVal.textContent = o.light.radius.toFixed(2);

      const isPoint = o.subtype==='point';
      const isSpot = o.subtype==='spot';
      this.el.lightRangeField.classList.toggle('hidden', !(isPoint||isSpot));
      this.el.lightSpotAngleField.classList.toggle('hidden', !isSpot);
      this.el.lightSpotBlendField.classList.toggle('hidden', !isSpot);
      if(isPoint||isSpot){
        this.el.lightRange.value = o.light.range!==undefined?o.light.range:10;
        this.el.lightRangeVal.textContent = parseFloat(this.el.lightRange.value).toFixed(1);
      }
      if(isSpot){
        this.el.lightSpotAngle.value = o.light.spotAngle!==undefined?o.light.spotAngle:35;
        this.el.lightSpotAngleVal.textContent = this.el.lightSpotAngle.value;
        this.el.lightSpotBlend.value = o.light.spotBlend!==undefined?o.light.spotBlend:0.25;
        this.el.lightSpotBlendVal.textContent = parseFloat(this.el.lightSpotBlend.value).toFixed(2);
      }
    }

    if(isCamera){
      this.el.objCamFov.value = o.camSettings.fov;
      this.el.objCamFovVal.textContent = o.camSettings.fov;
      this.el.objCamDof.checked = o.camSettings.dofEnabled;
      this.el.objCamFocus.value = o.camSettings.focusDist;
      this.el.objCamFocusVal.textContent = o.camSettings.focusDist.toFixed(1);
      this.el.objCamAperture.value = o.camSettings.aperture;
      this.el.objCamApertureVal.textContent = o.camSettings.aperture.toFixed(3);
    }

    if(isMeshType){
      this.selectMaterialInDropdown(o.material);
      this.loadMaterialToForm(o.material);
    }
  },

  // ---------------- Materials ----------------
  refreshMaterialSelect(){
    const sel = this.el.materialSelect;
    sel.innerHTML = '';
    this.scene.materials.forEach(m=>{
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      sel.appendChild(opt);
    });
  },

  selectMaterialInDropdown(mat){
    this.el.materialSelect.value = mat.id;
  },

  loadMaterialToForm(mat){
    this.el.matName.value = mat.name;
    this.el.matColor.value = rgbToHex(mat.color);
    this.el.matMetallic.value = mat.metallic;
    this.el.matMetallicVal.textContent = mat.metallic.toFixed(2);
    const smoothness = Math.round((1-mat.roughness)*100);
    this.el.matSmoothness.value = smoothness;
    this.el.matSmoothnessVal.textContent = smoothness;
    this.el.matIOR.value = mat.ior;
    this.el.matIorVal.textContent = mat.ior.toFixed(2);
    this.el.matTransmission.value = mat.transmission;
    this.el.matTransVal.textContent = mat.transmission.toFixed(2);
    this.el.matSubsurface.value = mat.subsurface||0;
    this.el.matSubsurfaceVal.textContent = (mat.subsurface||0).toFixed(2);
    this.el.matSubsurfaceColor.value = rgbToHex(mat.subsurfaceColor||[1,0.2,0.2]);
    this.el.matEmission.value = mat.emission;
    this.el.matEmissionVal.textContent = mat.emission.toFixed(2);
    this.el.matEmissionColor.value = rgbToHex(mat.emissionColor);
    this.updateMaterialPreviewLive(mat);
  },

  // يبني كائن متريال مؤقت من نموذج الواجهة (بدون تطبيق فعلي) لأجل المعاينة الحية
  readMaterialFromForm(){
    return {
      color: hexToRgb(this.el.matColor.value),
      metallic: parseFloat(this.el.matMetallic.value),
      roughness: 1-(parseFloat(this.el.matSmoothness.value)/100),
      ior: parseFloat(this.el.matIOR.value),
      transmission: parseFloat(this.el.matTransmission.value),
      subsurface: parseFloat(this.el.matSubsurface.value),
      subsurfaceColor: hexToRgb(this.el.matSubsurfaceColor.value),
      emission: parseFloat(this.el.matEmission.value),
      emissionColor: hexToRgb(this.el.matEmissionColor.value)
    };
  },

  bindMaterialProps(){
    this.el.materialSelect.onchange = ()=>{
      const mat = this.scene.materials.find(m=>m.id===this.el.materialSelect.value);
      if(mat) this.loadMaterialToForm(mat);
    };
    this.el.btnNewMaterial.onclick = ()=>{
      const m = this.scene.addNewMaterial();
      this.refreshMaterialSelect();
      this.el.materialSelect.value = m.id;
      this.loadMaterialToForm(m);
      this.toast('تم إنشاء متريال جديد — اضغط تطبيق لربطه بالعنصر');
    };
    this.el.btnDupMaterial.onclick = ()=>{
      const mat = this.scene.materials.find(m=>m.id===this.el.materialSelect.value);
      if(!mat) return;
      const clone = mat.clone();
      this.scene.materials.push(clone);
      this.refreshMaterialSelect();
      this.el.materialSelect.value = clone.id;
      this.loadMaterialToForm(clone);
      this.toast('تم نسخ المتريال');
    };

    const bindLivePreview = (id,valId,digits,transform)=>{
      this.el[id].oninput = ()=>{
        let v = parseFloat(this.el[id].value);
        this.el[valId].textContent = transform ? transform(v) : v.toFixed(digits);
        this.updateMaterialPreviewLive(this.readMaterialFromForm());
      };
    };
    bindLivePreview('matMetallic','matMetallicVal',2);
    bindLivePreview('matSmoothness','matSmoothnessVal',0);
    bindLivePreview('matIOR','matIorVal',2);
    bindLivePreview('matTransmission','matTransVal',2);
    bindLivePreview('matSubsurface','matSubsurfaceVal',2);
    bindLivePreview('matEmission','matEmissionVal',2);
    this.el.matColor.oninput = ()=> this.updateMaterialPreviewLive(this.readMaterialFromForm());
    this.el.matSubsurfaceColor.oninput = ()=> this.updateMaterialPreviewLive(this.readMaterialFromForm());
    this.el.matEmissionColor.oninput = ()=> this.updateMaterialPreviewLive(this.readMaterialFromForm());

    this.el.btnApplyMaterial.onclick = ()=>{
      const mat = this.scene.materials.find(m=>m.id===this.el.materialSelect.value);
      if(!mat) return;
      mat.name = this.el.matName.value || mat.name;
      const formVals = this.readMaterialFromForm();
      Object.assign(mat, formVals);

      const o = this.scene.getSelected();
      if(o && o.kind==='mesh'){
        o.material = mat;
      }
      this.refreshMaterialSelect();
      this.el.materialSelect.value = mat.id;
      this.pushUndo();
      this.onSceneChanged();
      this.toast('تم تطبيق المتريال');
    };
  },

  // ---------------- معاينة المتريال الحية (كرة صغيرة WebGL) ----------------
  initMaterialPreview(){
    const canvas = this.el.matPreviewCanvas;
    try{
      this.matPreviewEngine = new PathTracerEngine(canvas);
      this.matPreviewEngine.resize(140,140);
      this.matPreviewScene = this._buildPreviewScene();
      this._matPreviewFrames = 0;
      this._runMatPreviewLoop();
    }catch(e){
      console.warn('تعذر تهيئة معاينة المتريال', e);
    }
  },

  _buildPreviewScene(){
    const s = {
      objects:[],
      env:{top:[0.08,0.08,0.09],bottom:[0.03,0.03,0.03],intensity:1.0},
      renderSettings:{bounces:5,denoiser:true,denoiserStrength:0.6},
      camera:{
        pos:[0,0,2.6], forward:[0,0,-1], right:[1,0,0], up:[0,1,0],
        fov:32, dofEnabled:false, focusDist:2.6, aperture:0
      },
      selectedId:null
    };
    const sphereObj = new SceneObject('mesh','sphere');
    sphereObj.position=[0,0,0];
    s.objects.push(sphereObj);
    const key = new SceneObject('light','point');
    key.position=[1.6,1.8,1.8]; key.light.intensity=14; key.light.color=[1,1,1]; key.light.range=30;
    s.objects.push(key);
    const rim = new SceneObject('light','point');
    rim.position=[-1.6,-0.6,1.2]; rim.light.intensity=5; rim.light.color=[0.5,0.6,1]; rim.light.range=30;
    s.objects.push(rim);
    s._sphereObj = sphereObj;
    return s;
  },

  updateMaterialPreviewLive(matValues){
    if(!this.matPreviewScene) return;
    Object.assign(this.matPreviewScene._sphereObj.material, matValues);
    this.matPreviewEngine.needsReset = true;
  },

  _runMatPreviewLoop(){
    const step = ()=>{
      requestAnimationFrame(step);
      if(!this.matPreviewEngine) return;
      if(this.matPreviewEngine.needsReset) this.matPreviewEngine.reset();
      if(this.matPreviewEngine.frame < 60){
        this.matPreviewEngine.tileQueue = [[0,0,140,140]];
        this.matPreviewEngine.tileIndex = 0;
        this.matPreviewEngine.renderTileStep(this.matPreviewScene, this.matPreviewScene.camera);
      }
      this.matPreviewEngine.present(true, 0.6, false, 0, 1);
    };
    requestAnimationFrame(step);
  },

  // ---------------- Env ----------------
  bindEnvProps(){
    this.el.envColorTop.oninput = ()=>{
      this.scene.env.top = hexToRgb(this.el.envColorTop.value);
      this.onSceneChanged();
    };
    this.el.envColorTop.onchange = ()=> this.pushUndo();
    this.el.envColorBottom.oninput = ()=>{
      this.scene.env.bottom = hexToRgb(this.el.envColorBottom.value);
      this.onSceneChanged();
    };
    this.el.envColorBottom.onchange = ()=> this.pushUndo();
    this.el.envIntensity.oninput = ()=>{
      this.scene.env.intensity = parseFloat(this.el.envIntensity.value);
      this.el.envIntensityVal.textContent = this.scene.env.intensity.toFixed(2);
      this.onSceneChanged();
    };
    this.el.envIntensity.onchange = ()=> this.pushUndo();
  },

  // ---------------- Render settings ----------------
  bindRenderProps(){
    this.el.realtimeToggle.onchange = ()=>{
      this.scene.renderSettings.realtimeMode = this.el.realtimeToggle.checked;
    };
    this.el.bounces.oninput = ()=>{
      this.scene.renderSettings.bounces = parseInt(this.el.bounces.value);
      this.el.bouncesVal.textContent = this.scene.renderSettings.bounces;
      this.onSceneChanged();
    };
    this.el.outSamples.oninput = ()=>{
      this.el.outSamplesVal.textContent = this.el.outSamples.value;
    };
    this.el.outputRes.onchange = ()=>{
      this.el.customResFields.classList.toggle('hidden', this.el.outputRes.value!=='custom');
    };
    this.el.denoiserEnabled.onchange = ()=>{
      this.scene.renderSettings.denoiser = this.el.denoiserEnabled.checked;
    };
    this.el.denoiserStrength.oninput = ()=>{
      this.scene.renderSettings.denoiserStrength = parseFloat(this.el.denoiserStrength.value);
      this.el.denoiserStrengthVal.textContent = this.scene.renderSettings.denoiserStrength.toFixed(2);
    };
    this.el.bloomEnabled.onchange = ()=>{
      this.scene.renderSettings.bloom = this.el.bloomEnabled.checked;
    };
    this.el.bloomStrength.oninput = ()=>{
      this.scene.renderSettings.bloomStrength = parseFloat(this.el.bloomStrength.value);
      this.el.bloomStrengthVal.textContent = this.scene.renderSettings.bloomStrength.toFixed(2);
    };
    this.el.bloomThreshold.oninput = ()=>{
      this.scene.renderSettings.bloomThreshold = parseFloat(this.el.bloomThreshold.value);
      this.el.bloomThresholdVal.textContent = this.scene.renderSettings.bloomThreshold.toFixed(2);
    };
    this.el.tileSize.oninput = ()=>{
      this.scene.renderSettings.tileSize = parseInt(this.el.tileSize.value);
      this.el.tileSizeVal.textContent = this.scene.renderSettings.tileSize;
      this.engine.tileSize = this.scene.renderSettings.tileSize;
      this.engine.needsReset = true;
    };
  },

  refreshRenderSettingsUI(){
    const rs = this.scene.renderSettings;
    this.el.realtimeToggle.checked = rs.realtimeMode;
    this.el.bounces.value = rs.bounces;
    this.el.bouncesVal.textContent = rs.bounces;
    this.el.denoiserEnabled.checked = rs.denoiser;
    this.el.denoiserStrength.value = rs.denoiserStrength;
    this.el.denoiserStrengthVal.textContent = rs.denoiserStrength.toFixed(2);
    this.el.bloomEnabled.checked = rs.bloom;
    this.el.bloomStrength.value = rs.bloomStrength;
    this.el.bloomStrengthVal.textContent = rs.bloomStrength.toFixed(2);
    this.el.bloomThreshold.value = rs.bloomThreshold;
    this.el.bloomThresholdVal.textContent = rs.bloomThreshold.toFixed(2);
    this.el.tileSize.value = rs.tileSize;
    this.el.tileSizeVal.textContent = rs.tileSize;
  },

  onSceneChanged(){
    if(this.engine) this.engine.needsReset = true;
  },

  // Undo/Redo hooks - يتم تعيينها من main.js
  pushUndo(){
    if(window.__pushUndo) window.__pushUndo();
  },

  setRenderProgress(pct, text){
    this.el.renderProgressFill.style.width = pct+'%';
    this.el.renderProgressText.textContent = text;
  }
};

function hexToRgb(hex){
  const v = parseInt(hex.slice(1),16);
  return [((v>>16)&255)/255, ((v>>8)&255)/255, (v&255)/255];
}
function rgbToHex(rgb){
  const c = rgb.map(x=>Math.round(Math.max(0,Math.min(1,x))*255));
  return '#'+c.map(x=>x.toString(16).padStart(2,'0')).join('');
}
