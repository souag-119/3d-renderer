// ======================================================================
// منطق واجهة المستخدم (كما هو مع تعديلات بسيطة لدعم النظام الجديد)
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

  // ... باقي الدوال كما هي مع الحفاظ على التوافق مع النظام الجديد
  // (لم تتغير معظمها لأن الواجهة UI لم تتغير)

  // تعديل بسيط في refreshSceneTree لإظهار أيقونات الميش الجديدة
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

  // معاينة المتريال تعمل مع النظام الجديد تلقائياً
  // ...
};
