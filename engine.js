// ======================================================================
// Render3D Studio — WebGL2 Path Tracing Engine
// يقسم الإطار إلى بلاطات (Tiles) ويرندرها تدريجياً مع تراكم العينات
// ======================================================================

const VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos*0.5+0.5;
  gl_Position = vec4(aPos,0.0,1.0);
}`;

// Fragment shader path tracer الأساسي
const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;      // الدقة الكاملة للصورة
uniform vec4 uTileRect;        // x,y,w,h بالبكسل - البلاطة الحالية
uniform float uTime;
uniform int uFrame;            // رقم عينة التراكم
uniform int uBounces;
uniform sampler2D uAccum;      // بفر التراكم من الإطار السابق
uniform int uAccumCount;

// كاميرا
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uCamFov;
uniform float uCamAspect;
uniform int uDofEnabled;
uniform float uFocusDist;
uniform float uAperture;

// بيئة
uniform vec3 uEnvTop;
uniform vec3 uEnvBottom;
uniform float uEnvIntensity;

#define MAX_OBJS 48
#define MAX_LIGHTS 16
#define PI 3.14159265359

// أنواع الأجسام: 0=sphere,1=box,2=plane,3=cylinder,4=cone,5=torus
uniform int uObjCount;
uniform int uObjType[MAX_OBJS];
uniform vec3 uObjPos[MAX_OBJS];
uniform vec3 uObjScale[MAX_OBJS];
uniform mat3 uObjRotInv[MAX_OBJS]; // معكوس الدوران لتحويل الأشعة لفضاء الجسم
uniform mat3 uObjRot[MAX_OBJS];
// ماتريال لكل جسم
uniform vec3 uMatColor[MAX_OBJS];
uniform float uMatMetallic[MAX_OBJS];
uniform float uMatRoughness[MAX_OBJS];
uniform float uMatIOR[MAX_OBJS];
uniform float uMatTransmission[MAX_OBJS];
uniform vec3 uMatEmission[MAX_OBJS];

// إضاءات: 0=point,1=sun,2=area
uniform int uLightCount;
uniform int uLightType[MAX_LIGHTS];
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightDir[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
uniform float uLightIntensity[MAX_LIGHTS];
uniform float uLightRadius[MAX_LIGHTS];

// ------------------ RNG (PCG-ish hash) ------------------
uint rngState;
uint pcgHash(uint v){
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float randf(){
  rngState = pcgHash(rngState);
  return float(rngState) / 4294967296.0;
}
vec2 randf2(){ return vec2(randf(), randf()); }

vec3 cosineSampleHemisphere(vec3 n){
  vec2 u = randf2();
  float r = sqrt(u.x);
  float theta = 2.0*PI*u.y;
  float x = r*cos(theta);
  float y = r*sin(theta);
  float z = sqrt(max(0.0,1.0-u.x));
  vec3 up = abs(n.z) < 0.999 ? vec3(0,0,1) : vec3(1,0,0);
  vec3 t = normalize(cross(up,n));
  vec3 b = cross(n,t);
  return normalize(t*x + b*y + n*z);
}

vec3 sampleGGX(vec3 n, float roughness){
  vec2 u = randf2();
  float a = roughness*roughness;
  float phi = 2.0*PI*u.x;
  float cosTheta = sqrt((1.0-u.y)/(1.0+(a*a-1.0)*u.y));
  float sinTheta = sqrt(1.0-cosTheta*cosTheta);
  vec3 h = vec3(sinTheta*cos(phi), sinTheta*sin(phi), cosTheta);
  vec3 up = abs(n.z) < 0.999 ? vec3(0,0,1) : vec3(1,0,0);
  vec3 t = normalize(cross(up,n));
  vec3 b = cross(n,t);
  return normalize(t*h.x + b*h.y + n*h.z);
}

// ------------------ Ray-Object Intersections ------------------
struct Hit{
  float t;
  vec3 pos;
  vec3 nrm;
  int id;
};

bool intersectSphere(vec3 ro, vec3 rd, vec3 c, float r, out float t){
  vec3 oc = ro-c;
  float b = dot(oc,rd);
  float cc = dot(oc,oc)-r*r;
  float h = b*b-cc;
  if(h<0.0) return false;
  h = sqrt(h);
  float t0 = -b-h;
  float t1 = -b+h;
  t = t0>0.001 ? t0 : t1;
  return t>0.001;
}

bool intersectBox(vec3 ro, vec3 rd, vec3 halfSize, out float t, out vec3 nrmLocal){
  vec3 invD = 1.0/rd;
  vec3 t0s = (-halfSize-ro)*invD;
  vec3 t1s = (halfSize-ro)*invD;
  vec3 tsm = min(t0s,t1s);
  vec3 tbg = max(t0s,t1s);
  float tmin = max(max(tsm.x,tsm.y),tsm.z);
  float tmax = min(min(tbg.x,tbg.y),tbg.z);
  if(tmax<0.0 || tmin>tmax) return false;
  t = tmin>0.001 ? tmin : tmax;
  if(t<0.001) return false;
  vec3 p = ro+rd*t;
  vec3 d = abs(p)/halfSize;
  if(d.x>d.y && d.x>d.z) nrmLocal = vec3(sign(p.x),0,0);
  else if(d.y>d.z) nrmLocal = vec3(0,sign(p.y),0);
  else nrmLocal = vec3(0,0,sign(p.z));
  return true;
}

bool intersectPlane(vec3 ro, vec3 rd, vec2 halfSize, out float t){
  if(abs(rd.y)<1e-5) return false;
  t = -ro.y/rd.y;
  if(t<0.001) return false;
  vec3 p = ro+rd*t;
  if(abs(p.x)>halfSize.x || abs(p.z)>halfSize.y) return false;
  return true;
}

bool intersectCylinder(vec3 ro, vec3 rd, float r, float halfH, out float t, out vec3 nrmLocal){
  float a = rd.x*rd.x+rd.z*rd.z;
  float b = 2.0*(ro.x*rd.x+ro.z*rd.z);
  float c = ro.x*ro.x+ro.z*ro.z-r*r;
  float bestT = 1e9; bool found=false; vec3 bestN;
  if(a>1e-6){
    float disc=b*b-4.0*a*c;
    if(disc>=0.0){
      float sq=sqrt(disc);
      float ta=(-b-sq)/(2.0*a);
      float tb=(-b+sq)/(2.0*a);
      for(int i=0;i<2;i++){
        float tc = i==0?ta:tb;
        if(tc>0.001){
          vec3 p = ro+rd*tc;
          if(abs(p.y)<=halfH && tc<bestT){
            bestT=tc; found=true;
            bestN=normalize(vec3(p.x,0.0,p.z));
          }
        }
      }
    }
  }
  // top/bottom caps
  for(int s=-1;s<=1;s+=2){
    float fy = float(s)*halfH;
    if(abs(rd.y)>1e-6){
      float tc=(fy-ro.y)/rd.y;
      if(tc>0.001){
        vec3 p = ro+rd*tc;
        if(p.x*p.x+p.z*p.z<=r*r && tc<bestT){
          bestT=tc; found=true;
          bestN=vec3(0.0,float(s),0.0);
        }
      }
    }
  }
  if(found){ t=bestT; nrmLocal=bestN; }
  return found;
}

bool intersectCone(vec3 ro, vec3 rd, float r, float h, out float t, out vec3 nrmLocal){
  // apex at y=h/2, base at y=-h/2, radius r at base
  float k = r/h;
  vec3 o = ro - vec3(0.0,h*0.5,0.0);
  float a = rd.x*rd.x+rd.z*rd.z - k*k*rd.y*rd.y;
  float b = 2.0*(o.x*rd.x+o.z*rd.z + k*k*rd.y*(-o.y+h)*0.0 + k*k*rd.y*(-o.y));
  b = 2.0*(o.x*rd.x+o.z*rd.z) + 2.0*k*k*rd.y*(-o.y);
  float c = o.x*o.x+o.z*o.z - k*k*o.y*o.y;
  float bestT=1e9; bool found=false; vec3 bestN;
  if(abs(a)>1e-6){
    float disc=b*b-4.0*a*c;
    if(disc>=0.0){
      float sq=sqrt(disc);
      for(int i=0;i<2;i++){
        float tc=(-b + (i==0?-sq:sq))/(2.0*a);
        if(tc>0.001){
          vec3 p=ro+rd*tc;
          float py = p.y+h*0.5;
          if(py>=0.0 && py<=h && tc<bestT){
            bestT=tc; found=true;
            vec3 pAxis = vec3(p.x,0.0,p.z);
            vec3 side = normalize(pAxis);
            bestN = normalize(vec3(side.x, k, side.z));
          }
        }
      }
    }
  }
  // base cap
  if(abs(rd.y)>1e-6){
    float fy=-h*0.5;
    float tc=(fy-ro.y)/rd.y;
    if(tc>0.001){
      vec3 p=ro+rd*tc;
      if(p.x*p.x+p.z*p.z<=r*r && tc<bestT){
        bestT=tc; found=true;
        bestN=vec3(0.0,-1.0,0.0);
      }
    }
  }
  if(found){t=bestT; nrmLocal=bestN;}
  return found;
}

bool intersectTorus(vec3 ro, vec3 rd, float R, float r, out float t, out vec3 nrmLocal){
  // Solve quartic via iterative sphere-tracing approximation (robust enough for path tracing)
  float dist = 0.0;
  vec3 p = ro;
  bool hit=false;
  float totalT = 0.0;
  for(int i=0;i<64;i++){
    vec2 q = vec2(length(p.xz)-R, p.y);
    float d = length(q)-r;
    if(d<0.0008){ hit=true; break; }
    if(totalT>40.0) break;
    totalT += d;
    p = ro+rd*totalT;
  }
  if(!hit) return false;
  t = totalT;
  vec3 pos = ro+rd*t;
  vec2 q = vec2(length(pos.xz)-R, pos.y);
  vec3 cCenter = normalize(vec3(pos.x,0.0,pos.z))*R;
  nrmLocal = normalize(pos-cCenter);
  return true;
}

Hit sceneIntersect(vec3 ro, vec3 rd){
  Hit h; h.t=1e9; h.id=-1;
  for(int i=0;i<MAX_OBJS;i++){
    if(i>=uObjCount) break;
    vec3 lro = uObjRotInv[i]*(ro-uObjPos[i]);
    vec3 lrd = uObjRotInv[i]*rd;
    int type = uObjType[i];
    float t; vec3 nrmLocal;
    bool found=false;
    if(type==0){
      found = intersectSphere(lro,lrd,vec3(0.0),uObjScale[i].x,t);
      if(found){ vec3 p=lro+lrd*t; nrmLocal=normalize(p); }
    } else if(type==1){
      found = intersectBox(lro,lrd,uObjScale[i],t,nrmLocal);
    } else if(type==2){
      found = intersectPlane(lro,lrd,uObjScale[i].xz,t);
      nrmLocal = vec3(0.0,1.0,0.0);
    } else if(type==3){
      found = intersectCylinder(lro,lrd,uObjScale[i].x,uObjScale[i].y,t,nrmLocal);
    } else if(type==4){
      found = intersectCone(lro,lrd,uObjScale[i].x,uObjScale[i].y*2.0,t,nrmLocal);
    } else if(type==5){
      found = intersectTorus(lro,lrd,uObjScale[i].x,uObjScale[i].y,t,nrmLocal);
    }
    if(found && t<h.t && t>0.001){
      h.t=t; h.id=i;
      h.pos = ro+rd*t;
      h.nrm = normalize(uObjRot[i]*nrmLocal);
    }
  }
  return h;
}

bool sceneOcclude(vec3 ro, vec3 rd, float maxT){
  for(int i=0;i<MAX_OBJS;i++){
    if(i>=uObjCount) break;
    if(uMatEmission[i].x+uMatEmission[i].y+uMatEmission[i].z > 0.01) continue;
    vec3 lro = uObjRotInv[i]*(ro-uObjPos[i]);
    vec3 lrd = uObjRotInv[i]*rd;
    int type = uObjType[i];
    float t; vec3 nl;
    bool found=false;
    if(type==0) found=intersectSphere(lro,lrd,vec3(0.0),uObjScale[i].x,t);
    else if(type==1) found=intersectBox(lro,lrd,uObjScale[i],t,nl);
    else if(type==2){ found=intersectPlane(lro,lrd,uObjScale[i].xz,t); }
    else if(type==3) found=intersectCylinder(lro,lrd,uObjScale[i].x,uObjScale[i].y,t,nl);
    else if(type==4) found=intersectCone(lro,lrd,uObjScale[i].x,uObjScale[i].y*2.0,t,nl);
    else if(type==5) found=intersectTorus(lro,lrd,uObjScale[i].x,uObjScale[i].y,t,nl);
    if(found && t>0.001 && t<maxT-0.01) return true;
  }
  return false;
}

vec3 envColor(vec3 rd){
  float f = clamp(rd.y*0.5+0.5,0.0,1.0);
  return mix(uEnvBottom,uEnvTop,f) * uEnvIntensity;
}

// ------------------ Direct lighting (NEE) ------------------
vec3 directLighting(vec3 pos, vec3 nrm, vec3 viewDir, vec3 albedo, float metallic, float roughness){
  vec3 result = vec3(0.0);
  for(int i=0;i<MAX_LIGHTS;i++){
    if(i>=uLightCount) break;
    vec3 ldir; float dist; vec3 radiance;
    int lt = uLightType[i];
    if(lt==1){ // sun / directional
      ldir = normalize(-uLightDir[i]);
      vec3 jitter = vec3(randf2()-0.5, randf()-0.5)*uLightRadius[i]*0.3;
      ldir = normalize(ldir+jitter);
      dist = 1000.0;
      radiance = uLightColor[i]*uLightIntensity[i];
    } else { // point / area
      vec3 lp = uLightPos[i];
      if(lt==2){
        lp += vec3((randf()-0.5), 0.0, (randf()-0.5))*uLightRadius[i]*2.0;
      } else {
        lp += (vec3(randf2(),randf())-0.5)*uLightRadius[i]*2.0;
      }
      vec3 toL = lp-pos;
      dist = length(toL);
      ldir = toL/max(dist,0.0001);
      float atten = 1.0/max(dist*dist,0.01);
      radiance = uLightColor[i]*uLightIntensity[i]*atten;
    }
    float ndl = dot(nrm,ldir);
    if(ndl<=0.0) continue;
    vec3 shadowOrigin = pos + nrm*0.002;
    if(sceneOcclude(shadowOrigin, ldir, dist)) continue;

    vec3 h = normalize(ldir+viewDir);
    float ndh = max(dot(nrm,h),0.0);
    float ndv = max(dot(nrm,viewDir),0.0001);
    float a = roughness*roughness;
    float a2 = a*a;
    float d = a2/(PI*pow(ndh*ndh*(a2-1.0)+1.0,2.0)+0.0001);
    float k = (roughness+1.0); k=(k*k)/8.0;
    float g = (ndl/(ndl*(1.0-k)+k)) * (ndv/(ndv*(1.0-k)+k));
    vec3 f0 = mix(vec3(0.04),albedo,metallic);
    vec3 fr = f0 + (1.0-f0)*pow(1.0-max(dot(h,viewDir),0.0),5.0);
    vec3 spec = (d*g*fr)/max(4.0*ndl*ndv,0.001);
    vec3 diff = albedo*(1.0-metallic)/PI;
    result += (diff + spec) * radiance * ndl;
  }
  return result;
}

// ------------------ Path Tracing main loop ------------------
vec3 tracePath(vec3 ro, vec3 rd){
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);

  for(int bounce=0; bounce<12; bounce++){
    if(bounce>=uBounces) break;
    Hit h = sceneIntersect(ro,rd);
    if(h.id<0){
      radiance += throughput * envColor(rd);
      break;
    }
    vec3 albedo = uMatColor[h.id];
    float metallic = uMatMetallic[h.id];
    float roughness = clamp(uMatRoughness[h.id],0.03,1.0);
    float ior = uMatIOR[h.id];
    float transmission = uMatTransmission[h.id];
    vec3 emission = uMatEmission[h.id];

    radiance += throughput*emission;

    vec3 n = h.nrm;
    bool entering = dot(rd,n)<0.0;
    vec3 nrm = entering? n : -n;
    vec3 viewDir = -rd;

    // إضاءة مباشرة (Next Event Estimation) - فقط للأسطح غير الشفافة بالكامل
    if(transmission<0.99){
      radiance += throughput * directLighting(h.pos,nrm,viewDir,albedo,metallic,roughness) * (1.0-transmission);
    }

    // اختيار مسار: انكسار / انعكاس متخصص / انتشار
    float rr = randf();
    if(transmission>0.01 && rr<transmission){
      float eta = entering ? 1.0/ior : ior;
      vec3 refracted = refract(rd, nrm, eta);
      float fres = pow(1.0-abs(dot(viewDir,nrm)),5.0)*0.9+0.02;
      if(length(refracted)<0.001 || randf()<fres){
        rd = reflect(rd,nrm);
      } else {
        rd = refracted;
      }
      ro = h.pos + rd*0.003;
      throughput *= albedo;
    } else {
      float specProb = metallic*0.9+0.08;
      if(randf()<specProb){
        vec3 h_ = sampleGGX(nrm,roughness);
        rd = reflect(rd,h_);
        if(dot(rd,nrm)<0.0){ break; }
        vec3 f0 = mix(vec3(0.04),albedo,metallic);
        throughput *= mix(vec3(1.0),f0,0.85);
      } else {
        rd = cosineSampleHemisphere(nrm);
        throughput *= albedo;
      }
      ro = h.pos + nrm*0.003;
    }

    // Russian roulette
    if(bounce>3){
      float p = clamp(max(throughput.r,max(throughput.g,throughput.b)),0.05,1.0);
      if(randf()>p) break;
      throughput /= p;
    }
  }
  return radiance;
}

void main(){
  vec2 pixelCoord = gl_FragCoord.xy;
  // فقط البكسلات ضمن البلاطة الحالية
  if(pixelCoord.x < uTileRect.x || pixelCoord.x >= uTileRect.x+uTileRect.z ||
     pixelCoord.y < uTileRect.y || pixelCoord.y >= uTileRect.y+uTileRect.w){
    fragColor = texelFetch(uAccum, ivec2(pixelCoord), 0);
    return;
  }

  rngState = uint(pixelCoord.x)*1973u + uint(pixelCoord.y)*9277u + uint(uFrame)*26699u + uint(uTime*1000.0);
  rngState = pcgHash(rngState);

  vec2 jitter = randf2();
  vec2 uv = (pixelCoord+jitter)/uResolution;
  vec2 ndc = uv*2.0-1.0;

  float tanFov = tan(radians(uCamFov)*0.5);
  vec3 rd = normalize(uCamForward + uCamRight*ndc.x*tanFov*uCamAspect + uCamUp*ndc.y*tanFov);
  vec3 ro = uCamPos;

  if(uDofEnabled==1){
    vec3 focalPoint = ro + rd*uFocusDist;
    vec2 lensUV = randf2()*2.0-1.0;
    // sample disk
    float r = sqrt(max(lensUV.x*lensUV.x+lensUV.y*lensUV.y,0.0001));
    if(r>1.0){ lensUV/=r; }
    vec3 lensOffset = (uCamRight*lensUV.x + uCamUp*lensUV.y) * uAperture;
    ro = ro + lensOffset;
    rd = normalize(focalPoint-ro);
  }

  vec3 col = tracePath(ro,rd);
  col = max(col, vec3(0.0));

  vec3 prev = texelFetch(uAccum, ivec2(pixelCoord), 0).rgb;
  float n = float(uAccumCount);
  vec3 blended = (prev*n + col)/(n+1.0);

  fragColor = vec4(blended,1.0);
}
`;

// شيدر العرض النهائي (tone mapping + denoise بسيط)
const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform int uDenoise;
uniform float uDenoiseStrength;

vec3 tonemapACES(vec3 x){
  float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}

void main(){
  vec2 texel = 1.0/uResolution;
  vec3 center = texture(uTex, vUv).rgb;
  vec3 result = center;

  if(uDenoise==1){
    // Bilateral-ish edge aware blur (denoiser تقريبي بسيط)
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for(int dx=-2; dx<=2; dx++){
      for(int dy=-2; dy<=2; dy++){
        vec2 off = vec2(float(dx),float(dy))*texel;
        vec3 samp = texture(uTex, vUv+off).rgb;
        float dist2 = dot(samp-center,samp-center);
        float spatial = exp(-(float(dx*dx+dy*dy))/8.0);
        float range = exp(-dist2/0.15);
        float w = spatial*range;
        sum += samp*w;
        wsum += w;
      }
    }
    vec3 denoised = sum/max(wsum,0.0001);
    result = mix(center, denoised, uDenoiseStrength);
  }

  result = tonemapACES(result*1.0);
  result = pow(result, vec3(1.0/2.2));
  fragColor = vec4(result,1.0);
}
`;

class PathTracerEngine{
  constructor(canvas){
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {antialias:false, preserveDrawingBuffer:true, powerPreference:'high-performance'});
    if(!this.gl) throw new Error('WebGL2 غير مدعوم على هذا الجهاز');
    this.gl.getExtension('EXT_color_buffer_float');
    this.gl.getExtension('OES_texture_float_linear');

    this.initGL();
    this.frame = 0;
    this.tileSize = 64;
    this.tileQueue = [];
    this.tileIndex = 0;
    this.width = 0; this.height = 0;
    this.needsReset = true;
    this.paused = false;
  }

  initGL(){
    const gl = this.gl;
    this.progTrace = this.buildProgram(VERT_SRC, FRAG_SRC);
    this.progDisplay = this.buildProgram(VERT_SRC, DISPLAY_FRAG);

    const quad = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.bindVertexArray(null);
  }

  buildProgram(vsSrc, fsSrc){
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
    if(!gl.getShaderParameter(vs, gl.COMPILE_STATUS)){
      throw new Error('Vertex shader error: '+gl.getShaderInfoLog(vs));
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
    if(!gl.getShaderParameter(fs, gl.COMPILE_STATUS)){
      throw new Error('Fragment shader error: '+gl.getShaderInfoLog(fs));
    }
    const prog = gl.createProgram();
    gl.attachShader(prog,vs); gl.attachShader(prog,fs);
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){
      throw new Error('Program link error: '+gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  resize(w,h){
    if(this.width===w && this.height===h) return;
    this.width=w; this.height=h;
    const gl = this.gl;
    this.canvas.width=w; this.canvas.height=h;
    gl.viewport(0,0,w,h);

    // FBOs للتراكم (ping-pong)
    if(this.fbo0) gl.deleteFramebuffer(this.fbo0);
    if(this.fbo1) gl.deleteFramebuffer(this.fbo1);
    if(this.tex0) gl.deleteTexture(this.tex0);
    if(this.tex1) gl.deleteTexture(this.tex1);

    const makeTarget = ()=>{
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,w,h,0,gl.RGBA,gl.FLOAT,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
      return {tex,fbo};
    };
    const a = makeTarget(); const b = makeTarget();
    this.tex0=a.tex; this.fbo0=a.fbo;
    this.tex1=b.tex; this.fbo1=b.fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);

    this.reset();
  }

  reset(){
    this.frame = 0;
    this.needsReset = false;
    this.buildTileQueue();
    // امسح البفرات
    const gl = this.gl;
    for(const fbo of [this.fbo0,this.fbo1]){
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clearColor(0,0,0,1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }

  buildTileQueue(){
    this.tileQueue = [];
    const ts = this.tileSize;
    for(let y=0; y<this.height; y+=ts){
      for(let x=0; x<this.width; x+=ts){
        this.tileQueue.push([x,y,Math.min(ts,this.width-x),Math.min(ts,this.height-y)]);
      }
    }
    this.tileIndex = 0;
  }

  setUniforms(prog, scene, tileRect){
    const gl = this.gl;
    const u = (name)=>gl.getUniformLocation(prog,name);
    gl.uniform2f(u('uResolution'), this.width, this.height);
    gl.uniform4f(u('uTileRect'), tileRect[0], this.height-tileRect[1]-tileRect[3], tileRect[2], tileRect[3]);
    gl.uniform1f(u('uTime'), performance.now()/1000);
    gl.uniform1i(u('uFrame'), this.frame);
    gl.uniform1i(u('uAccumCount'), this.frame);
    gl.uniform1i(u('uBounces'), scene.renderSettings.bounces);

    const cam = scene.camera;
    gl.uniform3f(u('uCamPos'), cam.pos[0],cam.pos[1],cam.pos[2]);
    gl.uniform3f(u('uCamForward'), cam.forward[0],cam.forward[1],cam.forward[2]);
    gl.uniform3f(u('uCamRight'), cam.right[0],cam.right[1],cam.right[2]);
    gl.uniform3f(u('uCamUp'), cam.up[0],cam.up[1],cam.up[2]);
    gl.uniform1f(u('uCamFov'), cam.fov);
    gl.uniform1f(u('uCamAspect'), this.width/this.height);
    gl.uniform1i(u('uDofEnabled'), cam.dofEnabled?1:0);
    gl.uniform1f(u('uFocusDist'), cam.focusDist);
    gl.uniform1f(u('uAperture'), cam.aperture);

    gl.uniform3f(u('uEnvTop'), ...scene.env.top);
    gl.uniform3f(u('uEnvBottom'), ...scene.env.bottom);
    gl.uniform1f(u('uEnvIntensity'), scene.env.intensity);

    const objs = scene.objects.filter(o=>o.visible && o.kind!=='light');
    gl.uniform1i(u('uObjCount'), objs.length);
    const lights = scene.objects.filter(o=>o.kind==='light' && o.visible);
    gl.uniform1i(u('uLightCount'), lights.length);

    objs.forEach((o,i)=>{
      gl.uniform1i(gl.getUniformLocation(prog,`uObjType[${i}]`), o.typeId);
      gl.uniform3f(gl.getUniformLocation(prog,`uObjPos[${i}]`), ...o.position);
      gl.uniform3f(gl.getUniformLocation(prog,`uObjScale[${i}]`), ...o.getScaleParams());
      const rot = o.getRotationMatrix();
      const rotInv = mat3Transpose(rot);
      gl.uniformMatrix3fv(gl.getUniformLocation(prog,`uObjRot[${i}]`), false, rot);
      gl.uniformMatrix3fv(gl.getUniformLocation(prog,`uObjRotInv[${i}]`), false, rotInv);
      const m = o.material;
      gl.uniform3f(gl.getUniformLocation(prog,`uMatColor[${i}]`), ...m.color);
      gl.uniform1f(gl.getUniformLocation(prog,`uMatMetallic[${i}]`), m.metallic);
      gl.uniform1f(gl.getUniformLocation(prog,`uMatRoughness[${i}]`), m.roughness);
      gl.uniform1f(gl.getUniformLocation(prog,`uMatIOR[${i}]`), m.ior);
      gl.uniform1f(gl.getUniformLocation(prog,`uMatTransmission[${i}]`), m.transmission);
      const em = m.emission*1.0;
      gl.uniform3f(gl.getUniformLocation(prog,`uMatEmission[${i}]`), m.emissionColor[0]*em, m.emissionColor[1]*em, m.emissionColor[2]*em);
    });

    lights.forEach((l,i)=>{
      gl.uniform1i(gl.getUniformLocation(prog,`uLightType[${i}]`), l.lightType);
      gl.uniform3f(gl.getUniformLocation(prog,`uLightPos[${i}]`), ...l.position);
      const dir = l.getLightDirection();
      gl.uniform3f(gl.getUniformLocation(prog,`uLightDir[${i}]`), ...dir);
      gl.uniform3f(gl.getUniformLocation(prog,`uLightColor[${i}]`), ...l.light.color);
      gl.uniform1f(gl.getUniformLocation(prog,`uLightIntensity[${i}]`), l.light.intensity);
      gl.uniform1f(gl.getUniformLocation(prog,`uLightRadius[${i}]`), l.light.radius);
    });
  }

  // يرندر بلاطة واحدة في كل استدعاء (للمعاينة الحية التقدمية)
  renderTileStep(scene){
    const gl = this.gl;
    if(this.width<=0 || this.height<=0 || !this.fbo0 || !this.fbo1){
      return {tilesTotal:0, tileIndex:0, frame:this.frame};
    }
    if(this.tileQueue.length===0){
      this.buildTileQueue();
    }
    if(this.tileIndex >= this.tileQueue.length){
      this.tileIndex = 0;
      this.frame++;
      // بعد اكتمال إطار كامل، بدّل عدد العينات المتراكمة
      [this.tex0,this.tex1] = [this.tex1,this.tex0];
      [this.fbo0,this.fbo1] = [this.fbo1,this.fbo0];
      this.buildTileQueue();
      if(this.frame > 4000) this.frame = 4000; // تجنب تجاوز
    }
    if(this.tileQueue.length===0){
      return {tilesTotal:0, tileIndex:0, frame:this.frame};
    }
    const tile = this.tileQueue[this.tileIndex];
    this.tileIndex++;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo1);
    gl.viewport(0,0,this.width,this.height);
    gl.useProgram(this.progTrace);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.progTrace,'uAccum'),0);
    this.setUniforms(this.progTrace, scene, tile);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    [this.tex0,this.tex1] = [this.tex1,this.tex0];
    [this.fbo0,this.fbo1] = [this.fbo1,this.fbo0];

    return {tilesTotal:this.tileQueue.length, tileIndex:this.tileIndex, frame:this.frame};
  }

  // رندر إطار كامل مباشرة (بلا تقسيم مرئي) - للرندر النهائي بعدد عينات محدد
  renderFullFrame(scene){
    const gl = this.gl;
    const tile = [0,0,this.width,this.height];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo1);
    gl.viewport(0,0,this.width,this.height);
    gl.useProgram(this.progTrace);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.progTrace,'uAccum'),0);
    this.setUniforms(this.progTrace, scene, tile);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    [this.tex0,this.tex1] = [this.tex1,this.tex0];
    [this.fbo0,this.fbo1] = [this.fbo1,this.fbo0];
    this.frame++;
  }

  present(denoise, denoiseStrength){
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.useProgram(this.progDisplay);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.progDisplay,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(this.progDisplay,'uResolution'), this.width, this.height);
    gl.uniform1i(gl.getUniformLocation(this.progDisplay,'uDenoise'), denoise?1:0);
    gl.uniform1f(gl.getUniformLocation(this.progDisplay,'uDenoiseStrength'), denoiseStrength);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
}

// ------------------ أدوات مصفوفات 3x3 ------------------
function mat3Identity(){ return new Float32Array([1,0,0, 0,1,0, 0,0,1]); }

function mat3FromEuler(rx,ry,rz){
  const cx=Math.cos(rx), sx=Math.sin(rx);
  const cy=Math.cos(ry), sy=Math.sin(ry);
  const cz=Math.cos(rz), sz=Math.sin(rz);
  // R = Rz * Ry * Rx  (column-major for GLSL mat3)
  const Rx = [1,0,0, 0,cx,sx, 0,-sx,cx];
  const Ry = [cy,0,-sy, 0,1,0, sy,0,cy];
  const Rz = [cz,sz,0, -sz,cz,0, 0,0,1];
  const RyRx = mat3Mul(Ry,Rx);
  const R = mat3Mul(Rz,RyRx);
  return new Float32Array(R);
}

function mat3Mul(a,b){
  // both column-major 3x3
  const r = new Array(9).fill(0);
  for(let c=0;c<3;c++){
    for(let row=0;row<3;row++){
      let sum=0;
      for(let k=0;k<3;k++){
        sum += a[k*3+row]*b[c*3+k];
      }
      r[c*3+row]=sum;
    }
  }
  return r;
}

function mat3Transpose(m){
  return new Float32Array([
    m[0],m[3],m[6],
    m[1],m[4],m[7],
    m[2],m[5],m[8]
  ]);
}
