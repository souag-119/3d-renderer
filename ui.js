// ======================================================================
// منطق واجهة المستخدم: لوحات، تبويبات، عناصر تحكم، نظام المتريال الجديد
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
    this.bindMiniTabs();
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
      'btnImportModel','importFileInput',
      'noSelection','objectProps','lightProps','lightRadiusField','lightRangeField',
      'lightSpotAngleField','lightSpotBlendField','cameraObjProps','scaleTitle','scaleRow',
      'propName','posX','posY','posZ','rotX','rotY','rotZ','scaleX','scaleY','scaleZ',
      'lightColor','lightIntensity','lightIntensityNum','lightRadius','lightRadiusNum',
      'lightRange','lightRangeNum','lightSpotAngle','lightSpotAngleNum','lightSpotBlend','lightSpotBlendNum',
      'objCamFov','objCamFovNum','objCamDof','objCamFocus','objCamFocusVal','objCamAperture','objCamApertureVal',
      'btnUseThisCamera',
      'noMatSelection','materialProps','materialSelect','btnNewMaterial','btnDupMaterial',
      'matName','matColor',
      'matMetallic','matMetallicNum','matRoughness','matRoughnessNum',
      'matSmoothShade','matSmoothShadeVal','matSubsurface','matSubsurfaceNum',
      'matEmission','matEmissionNum','matEmissionColor',
      'matTransmission','matTransmissionNum','matIOR','matIORNum',
      'matMetallicT','matMetallicTNum','matRoughnessT','matRoughnessTNum',
      'matVolDensity','matVolDensityNum','matVolScatter','matVolScatterNum',
      'matMetallicM','matMetallicMNum','matRoughnessM','matRoughnessMNum',
      'matEmissionM','matEmissionMNum','matMaskSoftness','matMaskSoftnessNum',
      'matGroupSolid','matGroupTransparent','matGroupVolume','matGroupMask',
      'btnApplyMaterial','matPreviewCanvas',
      'btnTexColor','btnTexNormal','btnTexRoughness','texColorInput','texNormalInput','texRoughnessInput','texStatusRow',
      'envColorTop','envColorBottom','envIntensity','envIntensityVal',
      'realtimeToggle','bounces','bouncesVal','denoiserEnabled','denoiserStrength','denoiserStrengthVal',
      'bloomEnabled','bloomStrength','bloomStrengthVal','bloomThreshold','bloomThresholdVal',
      'tileSize','tileSizeVal','outputRes','customResFields','customW','customH',
      'outSamples','outSamplesVal','btnSaveRenderTab',
      'btnRenderToggle','btnCameraToggle',
      'renderProgressBar','renderProgressFill','renderProgressText',
      'objCountBadge','btnUndo','btnRedo','btnFullscreen','toast'];
    ids.forEach(id=> this.el[id]=document.getElementById(id));
    this.tabBtns = document.querySelectorAll('.tab-btn');
    this.tabContents = document.querySelectorAll('.tab-content');
    this.miniTabBtns = document.querySelectorAll('.mini-tab-btn');
    this.miniTabContents = document.querySelectorAll('.mini-tab-content');
    this.matTypeBtns = document.querySelectorAll('.mat-type-btn');
  },

  toast(msg){
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=> t.classList.add('hidden'), 2000);
  },

  // ---------------- Panels (بدون أنيميشن، تظهر في المنتصف) ----------------
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

  bindMiniTabs(){
    this.miniTabBtns.forEach(btn=>{
      btn.onclick = ()=>{
        this.miniTabBtns.forEach(b=>b.classList.remove('active'));
        this.miniTabContents.forEach(c=>c.classList.remove('active'));
        btn.classList.add('active');
        const key = btn.dataset.minitab;
        document.getElementById('miniTab'+key[0].toUpperCase()+key.slice(1)).classList.add('active');
      };
    });
  },

  bindTabs(){
    this.tabBtns.forEach(btn=>{
      btn.onclick = ()=>{
        this.tabBtns.forEach(b=>b.classList.remove('active'));
        this.tabContents.forEach(c=>c.classList.remove('active'));
        btn.classList.add('active');
        const key = btn.dataset.tab;
        document.getElementById('tab'+key[0].toUpperCase()+key.slice(1)).classList.add('active');
        const matApplyBar = document.getElementById('matApplyBar');
        if(matApplyBar) matApplyBar.classList.toggle('hidden', key!=='material');
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

    this.el.btnImportModel.onclick = ()=> this.el.importFileInput.click();
    this.el.importFileInput.onchange = (e)=>{
      const file = e.target.files[0];
      if(!file) return;
      if(window.__importModelFile) window.__importModelFile(file);
      this.el.importFileInput.value = '';
    };
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
      else if(o.kind==='bone') icon = '🦴';
      else icon = TYPE_ICONS[o.subtype] || '◆';
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

  // ---------------- ربط شريط تمرير بحقل رقمي متزامن معه (كلاهما يُحدّثان نفس القيمة) ----------------
  linkSliderNum(sliderId, numId, onChange, opts={}){
    const slider = this.el[sliderId], num = this.el[numId];
    if(!slider || !num) return;
    const apply = (val)=>{
      slider.value = val;
      num.value = opts.digits!==undefined ? Number(val).toFixed(opts.digits) : val;
      onChange(parseFloat(val));
    };
    slider.oninput = ()=>{ num.value = opts.digits!==undefined?parseFloat(slider.value).toFixed(opts.digits):slider.value; onChange(parseFloat(slider.value)); };
    slider.onchange = ()=> this.pushUndo();
    num.oninput = ()=>{
      let v = parseFloat(num.value);
      if(isNaN(v)) return;
      slider.value = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), v));
      onChange(v); // نسمح بتجاوز الحد الأقصى للشريط عبر الحقل الرقمي (لزيادة شدة الضوء مثلاً)
    };
    num.onchange = ()=> this.pushUndo();
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

    // إضاءة: اللون
    this.el.lightColor.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.color = hexToRgb(this.el.lightColor.value);
      this.onSceneChanged();
    };
    this.el.lightColor.onchange = ()=> this.pushUndo();

    // إضاءة: شرائح + حقول رقمية (تسمح بتجاوز الحد الأقصى)
    this.linkSliderNum('lightIntensity','lightIntensityNum', v=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.intensity = v; this.onSceneChanged();
    }, {digits:1});
    this.linkSliderNum('lightRadius','lightRadiusNum', v=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.radius = v; this.onSceneChanged();
    }, {digits:2});
    this.linkSliderNum('lightRange','lightRangeNum', v=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.range = v; this.onSceneChanged();
    }, {digits:1});
    this.linkSliderNum('lightSpotAngle','lightSpotAngleNum', v=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.spotAngle = v; this.onSceneChanged();
    }, {digits:0});
    this.linkSliderNum('lightSpotBlend','lightSpotBlendNum', v=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.spotBlend = v; this.onSceneChanged();
    }, {digits:2});

    // كاميرا ككائن
    this.linkSliderNum('objCamFov','objCamFovNum', v=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='camera') return;
      o.camSettings.fov = v; this.onSceneChanged();
    }, {digits:0});
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
      if(window.__enterSceneCamera) window.__enterSceneCamera(o);
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
      this.el.lightIntensity.value = Math.min(o.light.intensity, parseFloat(this.el.lightIntensity.max));
      this.el.lightIntensityNum.value = o.light.intensity.toFixed(1);
      this.el.lightRadius.value = o.light.radius;
      this.el.lightRadiusNum.value = o.light.radius.toFixed(2);

      const isPoint = o.subtype==='point';
      const isSpot = o.subtype==='spot';
      this.el.lightRangeField.classList.toggle('hidden', !(isPoint||isSpot));
      this.el.lightSpotAngleField.classList.toggle('hidden', !isSpot);
      this.el.lightSpotBlendField.classList.toggle('hidden', !isSpot);
      if(isPoint||isSpot){
        this.el.lightRange.value = o.light.range!==undefined?o.light.range:10;
        this.el.lightRangeNum.value = parseFloat(this.el.lightRange.value).toFixed(1);
      }
      if(isSpot){
        this.el.lightSpotAngle.value = o.light.spotAngle!==undefined?o.light.spotAngle:35;
        this.el.lightSpotAngleNum.value = this.el.lightSpotAngle.value;
        this.el.lightSpotBlend.value = o.light.spotBlend!==undefined?o.light.spotBlend:0.25;
        this.el.lightSpotBlendNum.value = parseFloat(this.el.lightSpotBlend.value).toFixed(2);
      }
    }

    if(isCamera){
      this.el.objCamFov.value = Math.min(o.camSettings.fov, parseFloat(this.el.objCamFov.max));
      this.el.objCamFovNum.value = o.camSettings.fov;
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

  setMaterialTypeUI(matType){
    this.matTypeBtns.forEach(b=> b.classList.toggle('active', b.dataset.mattype===matType));
    this.el.matGroupSolid.classList.toggle('hidden', matType!=='solid');
    this.el.matGroupTransparent.classList.toggle('hidden', matType!=='transparent');
    this.el.matGroupVolume.classList.toggle('hidden', matType!=='volume');
    this.el.matGroupMask.classList.toggle('hidden', matType!=='mask');
  },

  loadMaterialToForm(mat){
    this.el.matName.value = mat.name;
    this.el.matColor.value = rgbToHex(mat.color);
    this.setMaterialTypeUI(mat.matType||'solid');

    // نوع صلب
    this.el.matMetallic.value = mat.metallic; this.el.matMetallicNum.value = mat.metallic.toFixed(2);
    const roughPct = Math.round((mat.roughness||0.5)*100);
    this.el.matRoughness.value = roughPct; this.el.matRoughnessNum.value = roughPct;
    const smoothPct = Math.round((mat.smoothShade!==undefined?mat.smoothShade:1)*100);
    this.el.matSmoothShade.value = smoothPct; this.el.matSmoothShadeVal.textContent = smoothPct;
    this.el.matSubsurface.value = mat.subsurface||0; this.el.matSubsurfaceNum.value = (mat.subsurface||0).toFixed(2);
    this.el.matEmission.value = mat.emission||0; this.el.matEmissionNum.value = (mat.emission||0).toFixed(2);
    this.el.matEmissionColor.value = rgbToHex(mat.emissionColor||[1,1,1]);

    // نوع شفاف
    this.el.matTransmission.value = mat.transmission!==undefined?mat.transmission:0.9;
    this.el.matTransmissionNum.value = parseFloat(this.el.matTransmission.value).toFixed(2);
    this.el.matIOR.value = mat.ior||1.45; this.el.matIORNum.value = (mat.ior||1.45).toFixed(2);
    this.el.matMetallicT.value = mat.metallic||0; this.el.matMetallicTNum.value = (mat.metallic||0).toFixed(2);
    const roughPctT = Math.round((mat.roughness!==undefined?mat.roughness:0.05)*100);
    this.el.matRoughnessT.value = roughPctT; this.el.matRoughnessTNum.value = roughPctT;

    // نوع ضباب
    this.el.matVolDensity.value = mat.volumeDensity!==undefined?mat.volumeDensity:0.3;
    this.el.matVolDensityNum.value = parseFloat(this.el.matVolDensity.value).toFixed(2);
    this.el.matVolScatter.value = mat.volumeScatter!==undefined?mat.volumeScatter:0.5;
    this.el.matVolScatterNum.value = parseFloat(this.el.matVolScatter.value).toFixed(2);

    // نوع بقعة
    this.el.matMetallicM.value = mat.metallic||0; this.el.matMetallicMNum.value = (mat.metallic||0).toFixed(2);
    const roughPctM = Math.round((mat.roughness||0.5)*100);
    this.el.matRoughnessM.value = roughPctM; this.el.matRoughnessMNum.value = roughPctM;
    this.el.matEmissionM.value = mat.emission||0; this.el.matEmissionMNum.value = (mat.emission||0).toFixed(2);
    this.el.matMaskSoftness.value = mat.maskSoftness!==undefined?mat.maskSoftness:0.3;
    this.el.matMaskSoftnessNum.value = parseFloat(this.el.matMaskSoftness.value).toFixed(2);

    this.updateTexStatus(mat);
    this.updateMaterialPreviewLive(this.readMaterialFromForm());
  },

  updateTexStatus(mat){
    const parts = [];
    if(mat.texColor) parts.push('لون✓');
    if(mat.texNormal) parts.push('Normal✓');
    if(mat.texRoughness) parts.push('خشونة✓');
    this.el.texStatusRow.textContent = parts.length ? ('تكسشرز محمّلة: '+parts.join('، ')) : 'لا توجد تكسشرز مستوردة';
  },

  // يبني كائن متريال مؤقت من نموذج الواجهة (بدون تطبيق فعلي) لأجل المعاينة الحية
  readMaterialFromForm(){
    const activeTypeBtn = document.querySelector('.mat-type-btn.active');
    const matType = activeTypeBtn ? activeTypeBtn.dataset.mattype : 'solid';
    const base = {
      matType,
      color: hexToRgb(this.el.matColor.value)
    };
    if(matType==='solid'){
      return Object.assign(base, {
        metallic: parseFloat(this.el.matMetallic.value),
        roughness: parseFloat(this.el.matRoughness.value)/100,
        smoothShade: parseFloat(this.el.matSmoothShade.value)/100,
        subsurface: parseFloat(this.el.matSubsurface.value),
        emission: parseFloat(this.el.matEmission.value),
        emissionColor: hexToRgb(this.el.matEmissionColor.value)
      });
    } else if(matType==='transparent'){
      return Object.assign(base, {
        transmission: parseFloat(this.el.matTransmission.value),
        ior: parseFloat(this.el.matIOR.value),
        metallic: parseFloat(this.el.matMetallicT.value),
        roughness: parseFloat(this.el.matRoughnessT.value)/100,
        smoothShade: 1.0
      });
    } else if(matType==='volume'){
      return Object.assign(base, {
        volumeDensity: parseFloat(this.el.matVolDensity.value),
        volumeScatter: parseFloat(this.el.matVolScatter.value),
        smoothShade: 1.0
      });
    } else if(matType==='mask'){
      return Object.assign(base, {
        metallic: parseFloat(this.el.matMetallicM.value),
        roughness: parseFloat(this.el.matRoughnessM.value)/100,
        emission: parseFloat(this.el.matEmissionM.value),
        maskSoftness: parseFloat(this.el.matMaskSoftness.value),
        smoothShade: 1.0
      });
    }
    return base;
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

    this.matTypeBtns.forEach(btn=>{
      btn.onclick = ()=>{
        this.setMaterialTypeUI(btn.dataset.mattype);
        this.updateMaterialPreviewLive(this.readMaterialFromForm());
      };
    });

    // كل الشرائح والحقول الرقمية تُحدّث المعاينة الحية فوراً
    const liveFields = [
      ['matMetallic','matMetallicNum',2],['matRoughness','matRoughnessNum',0],
      ['matSmoothShade',null,0],['matSubsurface','matSubsurfaceNum',2],
      ['matEmission','matEmissionNum',2],
      ['matTransmission','matTransmissionNum',2],['matIOR','matIORNum',2],
      ['matMetallicT','matMetallicTNum',2],['matRoughnessT','matRoughnessTNum',0],
      ['matVolDensity','matVolDensityNum',2],['matVolScatter','matVolScatterNum',2],
      ['matMetallicM','matMetallicMNum',2],['matRoughnessM','matRoughnessMNum',0],
      ['matEmissionM','matEmissionMNum',2],['matMaskSoftness','matMaskSoftnessNum',2]
    ];
    liveFields.forEach(([sliderId,numId,digits])=>{
      if(!this.el[sliderId]) return;
      this.el[sliderId].oninput = ()=>{
        if(numId && this.el[numId]) this.el[numId].value = parseFloat(this.el[sliderId].value).toFixed(digits);
        if(sliderId==='matSmoothShade') this.el.matSmoothShadeVal.textContent = this.el.matSmoothShade.value;
        this.updateMaterialPreviewLive(this.readMaterialFromForm());
      };
      if(numId && this.el[numId]){
        this.el[numId].oninput = ()=>{
          let v = parseFloat(this.el[numId].value);
          if(isNaN(v)) return;
          this.el[sliderId].value = v;
          this.updateMaterialPreviewLive(this.readMaterialFromForm());
        };
      }
    });
    this.el.matColor.oninput = ()=> this.updateMaterialPreviewLive(this.readMaterialFromForm());
    this.el.matEmissionColor.oninput = ()=> this.updateMaterialPreviewLive(this.readMaterialFromForm());

    // استيراد Textures
    const bindTexBtn = (btnId, inputId, propName)=>{
      this.el[btnId].onclick = ()=> this.el[inputId].click();
      this.el[inputId].onchange = (e)=>{
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = ()=>{
          const mat = this.scene.materials.find(m=>m.id===this.el.materialSelect.value);
          if(mat){
            mat[propName] = reader.result;
            this.updateTexStatus(mat);
            this.toast('تم استيراد التكسشر');
          }
        };
        reader.readAsDataURL(file);
        this.el[inputId].value = '';
      };
    };
    bindTexBtn('btnTexColor','texColorInput','texColor');
    bindTexBtn('btnTexNormal','texNormalInput','texNormal');
    bindTexBtn('btnTexRoughness','texRoughnessInput','texRoughness');

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

  // ---------------- معاينة المتريال (بدون Path Tracing - إضاءة جانبية بسيطة فقط) ----------------
  initMaterialPreview(){
    const canvas = this.el.matPreviewCanvas;
    try{
      this.matPreviewEngine = new PathTracerEngine(canvas);
      this.matPreviewEngine.resize(140,140);
      this.matPreviewScene = this._buildPreviewScene();
      this._runMatPreviewLoop();
    }catch(e){
      console.warn('تعذر تهيئة معاينة المتريال', e);
    }
  },

  _buildPreviewScene(){
    const camPos = normalize3([0.55,0.25,0.9]);
    const dist = 2.6;
    const s = {
      objects:[],
      env:{top:[0.1,0.1,0.11],bottom:[0.04,0.04,0.04],intensity:1.0},
      camera:{
        pos:[camPos[0]*dist,camPos[1]*dist,camPos[2]*dist],
        forward: normalize3([-camPos[0],-camPos[1],-camPos[2]]),
        right:[1,0,0], up:[0,1,0],
        fov:32, dofEnabled:false, focusDist:dist, aperture:0
      },
      selectedId:null
    };
    // احسب right/up فعلياً بناءً على forward لضمان تعامد صحيح (الإضاءة "جانبية" بصرياً على الكرة)
    const worldUp = [0,1,0];
    let right = cross3(s.camera.forward, worldUp);
    if(len3(right)<0.001) right=[1,0,0];
    right = normalize3(right);
    s.camera.right = right;
    s.camera.up = normalize3(cross3(right, s.camera.forward));

    const sphereObj = new SceneObject('mesh','sphere');
    sphereObj.position=[0,0,0];
    s.objects.push(sphereObj);
    s._sphereObj = sphereObj;
    return s;
  },

  updateMaterialPreviewLive(matValues){
    if(!this.matPreviewScene) return;
    Object.assign(this.matPreviewScene._sphereObj.material, matValues);
  },

  _runMatPreviewLoop(){
    const step = ()=>{
      requestAnimationFrame(step);
      if(!this.matPreviewEngine) return;
      // معاينة raster فورية بدون تراكم (بدون رندر) - إضاءة جانبية بسيطة فقط
      this.matPreviewEngine.renderPreview(this.matPreviewScene, this.matPreviewScene.camera);
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
