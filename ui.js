// ======================================================================
// منطق واجهة المستخدم: لوحات، تبويبات، عناصر تحكم، Gizmo
// ======================================================================

const UI = {
  scene: null,
  engine: null,
  el: {},

  init(scene, engine){
    this.scene = scene;
    this.engine = engine;
    this.cacheEls();
    this.bindTopbar();
    this.bindSceneAdd();
    this.bindSceneTree();
    this.bindObjectProps();
    this.bindMaterialProps();
    this.bindCameraProps();
    this.bindRenderProps();
    this.bindOutputModal();
    this.bindGizmoModes();
    this.refreshSceneTree();
    this.refreshMaterialSelect();
    this.refreshSelection();
  },

  cacheEls(){
    const ids = ['panelScene','panelProps','btnMenuToggleLeft','btnMenuToggleRight',
      'btnCloseLeft','btnCloseRight','sceneTree','btnDuplicate','btnDelete',
      'noSelection','objectProps','lightProps','lightRadiusField',
      'propName','posX','posY','posZ','rotX','rotY','rotZ','scaleX','scaleY','scaleZ',
      'lightColor','lightIntensity','lightIntensityVal','lightRadius','lightRadiusVal',
      'noMatSelection','materialProps','materialSelect','btnNewMaterial','btnDupMaterial',
      'matName','matColor','matMetallic','matMetallicVal','matRoughness','matRoughnessVal',
      'matIOR','matIorVal','matTransmission','matTransVal','matEmission','matEmissionVal',
      'matEmissionColor','btnApplyMaterial',
      'camFov','camFovVal','camDofEnabled','camFocusDist','camFocusDistVal',
      'camAperture','camApertureVal','btnFocusPick',
      'envColorTop','envColorBottom','envIntensity','envIntensityVal',
      'bounces','bouncesVal','denoiserEnabled','denoiserStrength','denoiserStrengthVal',
      'tileSize','tileSizeVal',
      'btnOutputWindow','outputModal','btnCloseOutput','outputRes','customResFields',
      'customW','customH','outSamples','outSamplesVal','btnStartRender','btnCancelRender',
      'btnSaveRender','renderProgressBar','renderProgressText','outputCanvas',
      'objCount','fpsCounter','toast'];
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
    this._toastTimer = setTimeout(()=> t.classList.add('hidden'), 2200);
  },

  // ---------------- Topbar & Panels ----------------
  bindTopbar(){
    const isMobile = ()=> window.innerWidth <= 880;
    this.el.btnMenuToggleLeft.onclick = ()=>{
      this.el.panelScene.classList.toggle('collapsed-left');
      if(isMobile() && !this.el.panelScene.classList.contains('collapsed-left')){
        this.el.panelProps.classList.add('collapsed-right');
      }
    };
    this.el.btnMenuToggleRight.onclick = ()=>{
      this.el.panelProps.classList.toggle('collapsed-right');
      if(isMobile() && !this.el.panelProps.classList.contains('collapsed-right')){
        this.el.panelScene.classList.add('collapsed-left');
      }
    };
    this.el.btnCloseLeft.onclick = ()=> this.el.panelScene.classList.add('collapsed-left');
    this.el.btnCloseRight.onclick = ()=> this.el.panelProps.classList.add('collapsed-right');

    if(isMobile()){
      this.el.panelScene.classList.add('collapsed-left');
      this.el.panelProps.classList.add('collapsed-right');
    }

    this.tabBtns.forEach(btn=>{
      btn.onclick = ()=>{
        this.tabBtns.forEach(b=>b.classList.remove('active'));
        this.tabContents.forEach(c=>c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab'+btn.dataset.tab[0].toUpperCase()+btn.dataset.tab.slice(1)).classList.add('active');
      };
    });
  },

  // ---------------- Add objects/lights ----------------
  bindSceneAdd(){
    document.querySelectorAll('[data-add]').forEach(btn=>{
      btn.onclick = ()=>{
        const subtype = btn.dataset.add;
        const obj = new SceneObject('mesh', subtype);
        obj.position = [ (Math.random()-0.5)*1.5, subtype==='plane'?0:0.5, (Math.random()-0.5)*1.5];
        obj.name = {cube:'مكعب',sphere:'كرة',plane:'مستوى',cylinder:'اسطوانة',cone:'مخروط',torus:'حلقة'}[subtype];
        this.scene.addObject(obj);
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
        obj.name = {point:'إضاءة نقطية',sun:'إضاءة شمسية',area:'إضاءة مساحية'}[subtype];
        this.scene.addObject(obj);
        this.onSceneChanged();
        this.refreshSceneTree();
        this.refreshSelection();
        this.toast('تمت إضافة '+obj.name);
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
      const icon = o.kind==='light'? LIGHT_ICONS[o.subtype] : TYPE_ICONS[o.subtype];
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
    this.el.objCount.textContent = this.scene.objects.length+' عنصر';
  },

  bindSceneTree(){
    this.el.btnDuplicate.onclick = ()=>{
      if(!this.scene.selectedId) return;
      this.scene.duplicateObject(this.scene.selectedId);
      this.onSceneChanged();
      this.refreshSceneTree();
      this.refreshMaterialSelect();
      this.refreshSelection();
      this.toast('تم النسخ');
    };
    this.el.btnDelete.onclick = ()=>{
      if(!this.scene.selectedId) return;
      this.scene.removeObject(this.scene.selectedId);
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
    ['posX','posY','posZ'].forEach((id,i)=>{
      this.el[id].oninput = ()=>{
        const o = this.scene.getSelected(); if(!o) return;
        o.position[i] = parseFloat(this.el[id].value)||0;
        this.onSceneChanged();
      };
    });
    ['rotX','rotY','rotZ'].forEach((id,i)=>{
      this.el[id].oninput = ()=>{
        const o = this.scene.getSelected(); if(!o) return;
        o.rotation[i] = (parseFloat(this.el[id].value)||0) * Math.PI/180;
        this.onSceneChanged();
      };
    });
    ['scaleX','scaleY','scaleZ'].forEach((id,i)=>{
      this.el[id].oninput = ()=>{
        const o = this.scene.getSelected(); if(!o) return;
        o.scaleXYZ[i] = Math.max(0.01, parseFloat(this.el[id].value)||1);
        this.onSceneChanged();
      };
    });
    this.el.lightColor.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.color = hexToRgb(this.el.lightColor.value);
      this.onSceneChanged();
    };
    this.el.lightIntensity.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.intensity = parseFloat(this.el.lightIntensity.value);
      this.el.lightIntensityVal.textContent = o.light.intensity.toFixed(1);
      this.onSceneChanged();
    };
    this.el.lightRadius.oninput = ()=>{
      const o = this.scene.getSelected(); if(!o||o.kind!=='light') return;
      o.light.radius = parseFloat(this.el.lightRadius.value);
      this.el.lightRadiusVal.textContent = o.light.radius.toFixed(2);
      this.onSceneChanged();
    };
  },

  refreshSelection(){
    const o = this.scene.getSelected();
    const hasSel = !!o;
    this.el.btnDuplicate.disabled = !hasSel;
    this.el.btnDelete.disabled = !hasSel;
    this.el.noSelection.classList.toggle('hidden', hasSel);
    this.el.objectProps.classList.toggle('hidden', !hasSel);
    this.el.noMatSelection.classList.toggle('hidden', hasSel && o.kind==='mesh' ? false : true);
    this.el.materialProps.classList.toggle('hidden', !(hasSel && o.kind==='mesh'));

    if(!hasSel) return;

    this.el.propName.value = o.name;
    this.el.posX.value = o.position[0].toFixed(2);
    this.el.posY.value = o.position[1].toFixed(2);
    this.el.posZ.value = o.position[2].toFixed(2);
    this.el.rotX.value = (o.rotation[0]*180/Math.PI).toFixed(0);
    this.el.rotY.value = (o.rotation[1]*180/Math.PI).toFixed(0);
    this.el.rotZ.value = (o.rotation[2]*180/Math.PI).toFixed(0);
    this.el.scaleX.value = o.scaleXYZ[0].toFixed(2);
    this.el.scaleY.value = o.scaleXYZ[1].toFixed(2);
    this.el.scaleZ.value = o.scaleXYZ[2].toFixed(2);

    const isLight = o.kind==='light';
    this.el.lightProps.classList.toggle('hidden', !isLight);
    if(isLight){
      this.el.lightColor.value = rgbToHex(o.light.color);
      this.el.lightIntensity.value = o.light.intensity;
      this.el.lightIntensityVal.textContent = o.light.intensity.toFixed(1);
      this.el.lightRadius.value = o.light.radius;
      this.el.lightRadiusVal.textContent = o.light.radius.toFixed(2);
      this.el.lightRadiusField.classList.toggle('hidden', o.subtype==='sun'?false:false);
    }

    if(o.kind==='mesh'){
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
    this.el.matRoughness.value = mat.roughness;
    this.el.matRoughnessVal.textContent = mat.roughness.toFixed(2);
    this.el.matIOR.value = mat.ior;
    this.el.matIorVal.textContent = mat.ior.toFixed(2);
    this.el.matTransmission.value = mat.transmission;
    this.el.matTransVal.textContent = mat.transmission.toFixed(2);
    this.el.matEmission.value = mat.emission;
    this.el.matEmissionVal.textContent = mat.emission.toFixed(2);
    this.el.matEmissionColor.value = rgbToHex(mat.emissionColor);
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

    // تحديث القيم الحية على الشاشة (بدون تطبيق بعد)
    const bindRange = (id,valId,digits)=>{
      this.el[id].oninput = ()=> this.el[valId].textContent = parseFloat(this.el[id].value).toFixed(digits);
    };
    bindRange('matMetallic','matMetallicVal',2);
    bindRange('matRoughness','matRoughnessVal',2);
    bindRange('matIOR','matIorVal',2);
    bindRange('matTransmission','matTransVal',2);
    bindRange('matEmission','matEmissionVal',2);

    this.el.btnApplyMaterial.onclick = ()=>{
      const mat = this.scene.materials.find(m=>m.id===this.el.materialSelect.value);
      if(!mat) return;
      mat.name = this.el.matName.value || mat.name;
      mat.color = hexToRgb(this.el.matColor.value);
      mat.metallic = parseFloat(this.el.matMetallic.value);
      mat.roughness = parseFloat(this.el.matRoughness.value);
      mat.ior = parseFloat(this.el.matIOR.value);
      mat.transmission = parseFloat(this.el.matTransmission.value);
      mat.emission = parseFloat(this.el.matEmission.value);
      mat.emissionColor = hexToRgb(this.el.matEmissionColor.value);

      const o = this.scene.getSelected();
      if(o && o.kind==='mesh'){
        o.material = mat;
      }
      this.refreshMaterialSelect();
      this.el.materialSelect.value = mat.id;
      this.onSceneChanged();
      this.toast('تم تطبيق المتريال');
    };
  },

  // ---------------- Camera ----------------
  bindCameraProps(){
    const cam = this.scene.camera;
    this.el.camFov.oninput = ()=>{
      cam.fov = parseFloat(this.el.camFov.value);
      this.el.camFovVal.textContent = cam.fov;
      this.onSceneChanged();
    };
    this.el.camDofEnabled.onchange = ()=>{
      cam.dofEnabled = this.el.camDofEnabled.checked;
      this.onSceneChanged();
    };
    this.el.camFocusDist.oninput = ()=>{
      cam.focusDist = parseFloat(this.el.camFocusDist.value);
      this.el.camFocusDistVal.textContent = cam.focusDist.toFixed(1);
      this.onSceneChanged();
    };
    this.el.camAperture.oninput = ()=>{
      cam.aperture = parseFloat(this.el.camAperture.value);
      this.el.camApertureVal.textContent = cam.aperture.toFixed(3);
      this.onSceneChanged();
    };
    this.el.btnFocusPick.onclick = ()=>{
      cam.focusDist = cam.distance;
      this.el.camFocusDist.value = cam.focusDist;
      this.el.camFocusDistVal.textContent = cam.focusDist.toFixed(1);
      this.onSceneChanged();
      this.toast('تم ضبط التركيز على مركز المشهد');
    };
    this.el.envColorTop.oninput = ()=>{
      this.scene.env.top = hexToRgb(this.el.envColorTop.value);
      this.onSceneChanged();
    };
    this.el.envColorBottom.oninput = ()=>{
      this.scene.env.bottom = hexToRgb(this.el.envColorBottom.value);
      this.onSceneChanged();
    };
    this.el.envIntensity.oninput = ()=>{
      this.scene.env.intensity = parseFloat(this.el.envIntensity.value);
      this.el.envIntensityVal.textContent = this.scene.env.intensity.toFixed(2);
      this.onSceneChanged();
    };
  },

  // ---------------- Render settings ----------------
  bindRenderProps(){
    this.el.bounces.oninput = ()=>{
      this.scene.renderSettings.bounces = parseInt(this.el.bounces.value);
      this.el.bouncesVal.textContent = this.scene.renderSettings.bounces;
      this.onSceneChanged();
    };
    this.el.denoiserEnabled.onchange = ()=>{
      this.scene.renderSettings.denoiser = this.el.denoiserEnabled.checked;
    };
    this.el.denoiserStrength.oninput = ()=>{
      this.scene.renderSettings.denoiserStrength = parseFloat(this.el.denoiserStrength.value);
      this.el.denoiserStrengthVal.textContent = this.scene.renderSettings.denoiserStrength.toFixed(2);
    };
    this.el.tileSize.oninput = ()=>{
      this.scene.renderSettings.tileSize = parseInt(this.el.tileSize.value);
      this.el.tileSizeVal.textContent = this.scene.renderSettings.tileSize;
      this.engine.tileSize = this.scene.renderSettings.tileSize;
      this.engine.needsReset = true;
    };
  },

  // ---------------- Gizmo mode ----------------
  bindGizmoModes(){
    this.gmodeBtns.forEach(btn=>{
      btn.onclick = ()=>{
        this.gmodeBtns.forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        window.__gizmoMode = btn.dataset.mode;
      };
    });
    window.__gizmoMode = 'translate';
  },

  // ---------------- Output modal ----------------
  bindOutputModal(){
    this.el.btnOutputWindow.onclick = ()=>{
      this.el.outputModal.classList.remove('hidden');
    };
    this.el.btnCloseOutput.onclick = ()=>{
      this.el.outputModal.classList.add('hidden');
      if(window.__cancelRenderFn) window.__cancelRenderFn();
    };
    this.el.outputRes.onchange = ()=>{
      this.el.customResFields.classList.toggle('hidden', this.el.outputRes.value!=='custom');
    };
    this.el.outSamples.oninput = ()=>{
      this.el.outSamplesVal.textContent = this.el.outSamples.value;
    };
  },

  onSceneChanged(){
    if(this.engine) this.engine.needsReset = true;
  },

  setRenderProgress(pct, text){
    this.el.renderProgressBar.style.width = pct+'%';
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
