// ======================================================================
// إدارة المشهد: عناصر، ماتريالات، إضاءات، كاميرا
// ======================================================================

let __idCounter = 1;
function nextId(){ return 'obj_'+(__idCounter++); }

const TYPE_IDS = {cube:1, sphere:0, plane:2, cylinder:3, cone:4, torus:5};
const TYPE_ICONS = {cube:'🧊', sphere:'⚪', plane:'▭', cylinder:'🥫', cone:'🔺', torus:'🍩'};
const LIGHT_TYPE_IDS = {point:0, sun:1, area:2};
const LIGHT_ICONS = {point:'💡', sun:'☀', area:'▭'};

class Material{
  constructor(name){
    this.id = 'mat_'+(__idCounter++);
    this.name = name || 'متريال جديد';
    this.color = [0.78,0.78,0.78];
    this.metallic = 0.0;
    this.roughness = 0.5;
    this.ior = 1.45;
    this.transmission = 0.0;
    this.emission = 0.0;
    this.emissionColor = [1,1,1];
  }
  clone(){
    const m = new Material(this.name+' (نسخة)');
    m.color=[...this.color]; m.metallic=this.metallic; m.roughness=this.roughness;
    m.ior=this.ior; m.transmission=this.transmission; m.emission=this.emission;
    m.emissionColor=[...this.emissionColor];
    return m;
  }
}

class SceneObject{
  constructor(kind, subtype){
    this.id = nextId();
    this.kind = kind; // 'mesh' | 'light'
    this.subtype = subtype; // cube/sphere/... or point/sun/area
    this.name = (kind==='light'? (subtype+' Light') : subtype) + ' ' + (__idCounter);
    this.position = [0,0,0];
    this.rotation = [0,0,0]; // بالراديان
    this.scaleXYZ = [1,1,1];
    this.visible = true;

    if(kind==='mesh'){
      this.typeId = TYPE_IDS[subtype];
      this.material = new Material(subtype+' متريال');
    } else {
      this.lightType = LIGHT_TYPE_IDS[subtype];
      this.light = {
        color:[1,1,1],
        intensity: subtype==='sun'?3:(subtype==='point'?5:8),
        radius: subtype==='sun'?0.05:0.15
      };
      this.material = new Material('—');
    }
  }

  getScaleParams(){
    // تحويل scaleXYZ إلى المعطيات المطلوبة لكل نوع في الشيدر
    switch(this.subtype){
      case 'cube': return [0.5*this.scaleXYZ[0],0.5*this.scaleXYZ[1],0.5*this.scaleXYZ[2]];
      case 'sphere': return [0.5*this.scaleXYZ[0],0.5*this.scaleXYZ[0],0.5*this.scaleXYZ[0]];
      case 'plane': return [1*this.scaleXYZ[0],1,1*this.scaleXYZ[2]];
      case 'cylinder': return [0.5*this.scaleXYZ[0], 0.5*this.scaleXYZ[1], 0];
      case 'cone': return [0.5*this.scaleXYZ[0], 0.5*this.scaleXYZ[1], 0];
      case 'torus': return [0.35*this.scaleXYZ[0], 0.13*this.scaleXYZ[0], 0];
      default: return [...this.scaleXYZ];
    }
  }

  getRotationMatrix(){
    return mat3FromEuler(this.rotation[0], this.rotation[1], this.rotation[2]);
  }

  getLightDirection(){
    // اتجاه الإضاءة الشمسية مبني على الدوران
    const R = this.getRotationMatrix();
    // الاتجاه الافتراضي للأسفل (0,-1,0) مُدار
    const dx = R[0]*0 + R[3]*(-1) + R[6]*0;
    const dy = R[1]*0 + R[4]*(-1) + R[7]*0;
    const dz = R[2]*0 + R[5]*(-1) + R[8]*0;
    return [dx,dy,dz];
  }

  duplicate(){
    const clone = new SceneObject(this.kind, this.subtype);
    clone.name = this.name+' نسخة';
    clone.position = [this.position[0]+0.6, this.position[1], this.position[2]+0.6];
    clone.rotation = [...this.rotation];
    clone.scaleXYZ = [...this.scaleXYZ];
    if(this.kind==='mesh'){
      clone.material = this.material.clone();
      clone.material.name = this.material.name;
      // نسخ فعلي بدون "نسخة" في اسم الماتريال إن كان مرتبط بمكتبة
      clone.material = Object.assign(new Material(this.material.name), {
        color:[...this.material.color], metallic:this.material.metallic,
        roughness:this.material.roughness, ior:this.material.ior,
        transmission:this.material.transmission, emission:this.material.emission,
        emissionColor:[...this.material.emissionColor]
      });
    } else {
      clone.light = {...this.light, color:[...this.light.color]};
    }
    return clone;
  }
}

class Camera{
  constructor(){
    this.target = [0,0.5,0];
    this.distance = 6;
    this.yaw = 0.8;
    this.pitch = 0.4;
    this.fov = 50;
    this.dofEnabled = false;
    this.focusDist = 5;
    this.aperture = 0.05;
    this.update();
  }
  update(){
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.pos = [
      this.target[0] + this.distance*cp*sy,
      this.target[1] + this.distance*sp,
      this.target[2] + this.distance*cp*cy
    ];
    const fwd = normalize3([this.target[0]-this.pos[0], this.target[1]-this.pos[1], this.target[2]-this.pos[2]]);
    this.forward = fwd;
    const worldUp = [0,1,0];
    let right = cross3(fwd, worldUp);
    if(len3(right) < 0.001) right = [1,0,0];
    right = normalize3(right);
    this.right = right;
    this.up = normalize3(cross3(right, fwd));
  }
}

function normalize3(v){ const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; }
function cross3(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function len3(v){ return Math.hypot(v[0],v[1],v[2]); }

class Scene{
  constructor(){
    this.objects = [];
    this.materials = [];
    this.camera = new Camera();
    this.env = {
      top:[0.53,0.81,0.92],
      bottom:[0.96,0.94,0.91],
      intensity:1.0
    };
    this.renderSettings = {
      bounces:4,
      denoiser:true,
      denoiserStrength:0.5,
      tileSize:64
    };
    this.selectedId = null;
    this._buildDefaultScene();
  }

  _buildDefaultScene(){
    // أرضية
    const floor = new SceneObject('mesh','plane');
    floor.name = 'الأرضية';
    floor.scaleXYZ = [8,1,8];
    floor.material.color = [0.75,0.75,0.75];
    floor.material.roughness = 0.9;
    this.addObject(floor, false);

    // مكعب
    const cube = new SceneObject('mesh','cube');
    cube.name = 'مكعب أساسي';
    cube.position = [-1.1, 0.5, 0];
    cube.material.color = [0.85,0.25,0.25];
    cube.material.roughness = 0.4;
    this.addObject(cube, false);

    // كرة معدنية
    const sphere = new SceneObject('mesh','sphere');
    sphere.name = 'كرة معدنية';
    sphere.position = [1.1, 0.5, 0.3];
    sphere.material.color = [0.9,0.75,0.3];
    sphere.material.metallic = 1.0;
    sphere.material.roughness = 0.15;
    this.addObject(sphere, false);

    // إضاءة شمسية
    const sun = new SceneObject('light','sun');
    sun.name = 'شمس رئيسية';
    sun.rotation = [-0.9, 0.5, 0];
    sun.light.intensity = 3.5;
    sun.light.color = [1,0.97,0.9];
    this.addObject(sun, false);

    // إضاءة نقطية
    const pl = new SceneObject('light','point');
    pl.name = 'إضاءة تعبئة';
    pl.position = [-1.5,1.8,1.5];
    pl.light.intensity = 6;
    pl.light.color = [0.6,0.75,1.0];
    this.addObject(pl, false);
  }

  addObject(obj, select=true){
    this.objects.push(obj);
    if(obj.kind==='mesh' && !this.materials.includes(obj.material)){
      this.materials.push(obj.material);
    }
    if(select) this.selectedId = obj.id;
    return obj;
  }

  removeObject(id){
    const idx = this.objects.findIndex(o=>o.id===id);
    if(idx>=0) this.objects.splice(idx,1);
    if(this.selectedId===id) this.selectedId=null;
  }

  getObject(id){ return this.objects.find(o=>o.id===id); }
  getSelected(){ return this.selectedId ? this.getObject(this.selectedId) : null; }

  duplicateObject(id){
    const orig = this.getObject(id);
    if(!orig) return null;
    const clone = orig.duplicate();
    this.objects.push(clone);
    if(clone.kind==='mesh') this.materials.push(clone.material);
    this.selectedId = clone.id;
    return clone;
  }

  addNewMaterial(){
    const m = new Material('متريال '+(this.materials.length+1));
    this.materials.push(m);
    return m;
  }
}
