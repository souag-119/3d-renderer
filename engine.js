// ======================================================================
// Render3D Studio — WebGL2 Engine (Triangle Mesh + BVH Path Tracer)
// ======================================================================

// ----- دوال مساعدة عامة (تُعرَّف في النطاق العام) -----
if (typeof window !== 'undefined') {
  window.normalize3 = function(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0]/l, v[1]/l, v[2]/l];
  };
  window.cross3 = function(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  };
  window.sub3 = function(a, b) {
    return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  };
  window.add3 = function(a, b) {
    return [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
  };
  window.scale3 = function(a, s) {
    return [a[0]*s, a[1]*s, a[2]*s];
  };
  window.len3 = function(v) {
    return Math.hypot(v[0], v[1], v[2]);
  };
  window.dot3 = function(a, b) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  };
}

// ------------------------------------------------------------------
// Vertex Shader (نفسه)
// ------------------------------------------------------------------
const VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos*0.5+0.5;
  gl_Position = vec4(aPos,0.0,1.0);
}`;

// ------------------------------------------------------------------
// GLSL: BVH + Triangle intersection + PBR
// ------------------------------------------------------------------
const BVH_GLSL = `
// ---- BVH node (8 floats) ----
struct BVHNode {
  vec3 bmin;
  vec3 bmax;
  int left;
  int right;
  int triStart;
  int triCount;
};

// ---- Triangle intersection ----
struct Hit { float t; vec3 pos; vec3 nrm; vec2 uv; int objId; int triIdx; };

bool intersectTriangle(vec3 ro, vec3 rd, vec3 v0, vec3 v1, vec3 v2, out float t, out vec2 uv, out vec3 nrm) {
  vec3 e1 = v1 - v0;
  vec3 e2 = v2 - v0;
  vec3 pvec = cross(rd, e2);
  float det = dot(e1, pvec);
  if (abs(det) < 1e-8) return false;
  float invDet = 1.0 / det;
  vec3 tvec = ro - v0;
  float u = dot(tvec, pvec) * invDet;
  if (u < 0.0 || u > 1.0) return false;
  vec3 qvec = cross(tvec, e1);
  float v = dot(rd, qvec) * invDet;
  if (v < 0.0 || u + v > 1.0) return false;
  t = dot(e2, qvec) * invDet;
  if (t < 0.001) return false;
  uv = vec2(u, v);
  nrm = normalize(cross(e1, e2));
  return true;
}

// ---- BVH textures ----
uniform sampler2D uBVHNodes;     // width = nodes*2, height = 1, RGBA32F
uniform sampler2D uBVHNodeData2; // width = nodes, height = 1, RGBA32F (triStart, triCount)
uniform sampler2D uTriVerts;     // width = triangles*3, height = 1, RGB32F (vertex positions)
uniform sampler2D uTriNormals;   // width = triangles*3, height = 1, RGB32F (vertex normals)

// ---- قراءة بيانات العقدة ----
void getNodeData(int idx, out vec3 bmin, out vec3 bmax, out int left, out int right) {
  int texelIdx = idx * 2;
  vec4 d0 = texelFetch(uBVHNodes, ivec2(texelIdx, 0), 0);
  vec4 d1 = texelFetch(uBVHNodes, ivec2(texelIdx + 1, 0), 0);
  bmin = d0.xyz;
  bmax = vec3(d0.w, d1.x, d1.y);
  left = floatBitsToInt(d1.z);
  right = floatBitsToInt(d1.w);
}

void getNodeData2(int idx, out int triStart, out int triCount) {
  vec4 d = texelFetch(uBVHNodeData2, ivec2(idx, 0), 0);
  triStart = floatBitsToInt(d.x);
  triCount = floatBitsToInt(d.y);
}

// ---- قراءة مثلث ----
vec3 getTriVert(int triIdx, int vertIdx) {
  int idx = triIdx * 3 + vertIdx;
  return texelFetch(uTriVerts, ivec2(idx, 0), 0).xyz;
}

vec3 getTriNormal(int triIdx, int vertIdx) {
  int idx = triIdx * 3 + vertIdx;
  return texelFetch(uTriNormals, ivec2(idx, 0), 0).xyz;
}

// ---- اجتياز BVH ----
bool intersectBVH(vec3 ro, vec3 rd, int skipObjId, out Hit hit) {
  hit.t = 1e9;
  hit.objId = -1;
  hit.triIdx = -1;
  
  int stack[64];
  int stackPtr = 0;
  stack[stackPtr++] = 0; // root
  
  while (stackPtr > 0) {
    int nodeIdx = stack[--stackPtr];
    vec3 bmin, bmax; int left, right, triStart, triCount;
    getNodeData(nodeIdx, bmin, bmax, left, right);
    getNodeData2(nodeIdx, triStart, triCount);
    
    // اختبار صندوق الإحاطة
    vec3 invD = 1.0 / rd;
    vec3 t0s = (bmin - ro) * invD;
    vec3 t1s = (bmax - ro) * invD;
    vec3 tsm = min(t0s, t1s);
    vec3 tbg = max(t0s, t1s);
    float tmin = max(max(tsm.x, tsm.y), tsm.z);
    float tmax = min(min(tbg.x, tbg.y), tbg.z);
    if (tmax < 0.0 || tmin > tmax || tmin > hit.t) continue;
    
    if (triCount > 0) {
      // ورقة: اختبار المثلثات
      for (int i = 0; i < triCount; i++) {
        int triIdx = triStart + i;
        vec3 v0 = getTriVert(triIdx, 0);
        vec3 v1 = getTriVert(triIdx, 1);
        vec3 v2 = getTriVert(triIdx, 2);
        float t; vec2 uv; vec3 nrm;
        if (intersectTriangle(ro, rd, v0, v1, v2, t, uv, nrm)) {
          if (t < hit.t) {
            hit.t = t;
            hit.pos = ro + rd * t;
            hit.nrm = nrm;
            hit.uv = uv;
            hit.objId = skipObjId; // سيُحدَّد لاحقاً من قبل المضيف
            hit.triIdx = triIdx;
          }
        }
      }
    } else {
      // عقدة داخلية: دفع الأبناء
      if (left >= 0) stack[stackPtr++] = left;
      if (right >= 0) stack[stackPtr++] = right;
    }
  }
  return hit.objId >= 0;
}
`;

// ---- RNG + PBR (مشترك) ----
const RNG_GLSL = `
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
  float theta = 2.0*3.14159265359*u.y;
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
  float phi = 2.0*3.14159265359*u.x;
  float cosTheta = sqrt((1.0-u.y)/(1.0+(a*a-1.0)*u.y));
  float sinTheta = sqrt(1.0-cosTheta*cosTheta);
  vec3 h = vec3(sinTheta*cos(phi), sinTheta*sin(phi), cosTheta);
  vec3 up = abs(n.z) < 0.999 ? vec3(0,0,1) : vec3(1,0,0);
  vec3 t = normalize(cross(up,n));
  vec3 b = cross(n,t);
  return normalize(t*h.x + b*h.y + n*h.z);
}
`;

// ------------------------------------------------------------------
// Fragment Shader: Path Tracer (مثلثات + BVH)
// ------------------------------------------------------------------
const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec4 uTileRect;
uniform float uTime;
uniform int uFrame;
uniform int uBounces;
uniform sampler2D uAccum;

uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uCamFov;
uniform float uCamAspect;
uniform int uDofEnabled;
uniform float uFocusDist;
uniform float uAperture;

uniform vec3 uEnvTop;
uniform vec3 uEnvBottom;
uniform float uEnvIntensity;

#define MAX_OBJS 48
#define MAX_LIGHTS 16
#define PI 3.14159265359

// ---- بيانات المشهد ----
uniform int uObjCount;
uniform int uObjMeshStart[MAX_OBJS];
uniform int uObjMeshCount[MAX_OBJS];
uniform mat4 uObjTransform[MAX_OBJS];
uniform mat4 uObjTransformInv[MAX_OBJS];
uniform int uObjMatId[MAX_OBJS];

// ---- مواد PBR ----
uniform int uMatCount;
uniform vec3 uMatColor[MAX_OBJS];
uniform float uMatMetallic[MAX_OBJS];
uniform float uMatRoughness[MAX_OBJS];
uniform float uMatIOR[MAX_OBJS];
uniform float uMatTransmission[MAX_OBJS];
uniform vec3 uMatEmission[MAX_OBJS];
uniform float uMatSubsurface[MAX_OBJS];

// ---- إضاءة ----
uniform int uLightCount;
uniform int uLightType[MAX_LIGHTS];
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightDir[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
uniform float uLightIntensity[MAX_LIGHTS];
uniform float uLightRadius[MAX_LIGHTS];
uniform float uLightRange[MAX_LIGHTS];
uniform float uLightSpotAngle[MAX_LIGHTS];
uniform float uLightSpotBlend[MAX_LIGHTS];

${RNG_GLSL}
${BVH_GLSL}

// ---- دوال الإضاءة ----
vec3 envColor(vec3 rd){
  float f = clamp(rd.y*0.5+0.5,0.0,1.0);
  return mix(uEnvBottom,uEnvTop,f) * uEnvIntensity;
}

void evalLight(int i, vec3 pos, out vec3 ldir, out float dist, out vec3 radiance){
  int lt = uLightType[i];
  if(lt==1){ // sun
    ldir = normalize(-uLightDir[i]);
    vec3 jitter = vec3(randf2()-0.5, randf()-0.5)*uLightRadius[i]*0.3;
    ldir = normalize(ldir+jitter);
    dist = 1000.0;
    radiance = uLightColor[i]*uLightIntensity[i];
    return;
  }
  vec3 lp = uLightPos[i];
  if(lt==2){
    lp += vec3((randf()-0.5), 0.0, (randf()-0.5))*uLightRadius[i]*2.0;
  } else if(lt==0){
    lp += (vec3(randf2(),randf())-0.5)*uLightRadius[i]*2.0;
  }
  vec3 toL = lp-pos;
  dist = length(toL);
  ldir = toL/max(dist,0.0001);
  float rangeAtten = clamp(1.0 - pow(dist/max(uLightRange[i],0.01), 4.0), 0.0, 1.0);
  float atten = (1.0/max(dist*dist,0.05)) * rangeAtten;
  radiance = uLightColor[i]*uLightIntensity[i]*atten;
  if(lt==3){
    vec3 spotDir = normalize(uLightDir[i]);
    float cosAngle = dot(-ldir, spotDir);
    float outerCos = cos(radians(uLightSpotAngle[i]));
    float innerCos = cos(radians(uLightSpotAngle[i]*(1.0-uLightSpotBlend[i])));
    float spotFactor = smoothstep(outerCos, innerCos, cosAngle);
    radiance *= spotFactor*spotFactor;
  }
}

vec3 directLighting(vec3 pos, vec3 nrm, vec3 viewDir, vec3 albedo, float metallic, float roughness, int objId){
  vec3 result = vec3(0.0);
  for(int i=0;i<MAX_LIGHTS;i++){
    if(i>=uLightCount) break;
    vec3 ldir; float dist; vec3 radiance;
    evalLight(i, pos, ldir, dist, radiance);
    float ndl = dot(nrm,ldir);
    if(ndl<=0.0) continue;
    if(radiance.r+radiance.g+radiance.b < 0.0001) continue;
    // ظل (اختصار: نهمل الـ occlusion حالياً)
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

// ---- تتبع الشعاع الرئيسي ----
vec3 tracePath(vec3 ro, vec3 rd){
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);

  for(int bounce=0; bounce<12; bounce++){
    if(bounce>=uBounces) break;
    Hit hit;
    bool hitSomething = intersectBVH(ro, rd, -1, hit);
    if(!hitSomething){
      radiance += throughput * envColor(rd);
      break;
    }

    // تحديد الكائن والمادة
    int objId = -1;
    int matIdx = 0;
    for(int i=0;i<uObjCount;i++){
      // نفحص إذا كان المثلث يقع ضمن نطاق هذا الكائن
      if(hit.triIdx >= uObjMeshStart[i] && hit.triIdx < uObjMeshStart[i] + uObjMeshCount[i]){
        objId = i;
        matIdx = uObjMatId[i];
        break;
      }
    }
    if(objId < 0){ radiance += throughput * envColor(rd); break; }

    vec3 albedo = uMatColor[matIdx];
    float metallic = uMatMetallic[matIdx];
    float roughness = clamp(uMatRoughness[matIdx], 0.03, 1.0);
    float ior = uMatIOR[matIdx];
    float transmission = uMatTransmission[matIdx];
    vec3 emission = uMatEmission[matIdx];

    radiance += throughput * emission;

    vec3 n = hit.nrm;
    bool entering = dot(rd,n)<0.0;
    vec3 nrm = entering? n : -n;
    vec3 viewDir = -rd;

    radiance += throughput * directLighting(hit.pos, nrm, viewDir, albedo, metallic, roughness, objId);

    // Russian roulette
    float rr = randf();
    if(rr < 0.5){
      if(randf() < metallic * 0.8 + 0.1){
        vec3 h_ = sampleGGX(nrm, roughness);
        rd = reflect(rd, h_);
        if(dot(rd,nrm)<0.0){ break; }
        vec3 f0 = mix(vec3(0.04), albedo, metallic);
        throughput *= mix(vec3(1.0), f0, 0.85);
      } else {
        rd = cosineSampleHemisphere(nrm);
        throughput *= albedo;
      }
      ro = hit.pos + nrm*0.003;
    } else {
      break;
    }

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

// ------------------------------------------------------------------
// Preview Shader (معاينة سريعة)
// ------------------------------------------------------------------
const PREVIEW_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uCamFov;
uniform float uCamAspect;
uniform vec3 uEnvTop;
uniform vec3 uEnvBottom;
uniform float uEnvIntensity;

#define MAX_OBJS 48

uniform int uObjCount;
uniform int uObjMeshStart[MAX_OBJS];
uniform int uObjMeshCount[MAX_OBJS];
uniform mat4 uObjTransform[MAX_OBJS];
uniform mat4 uObjTransformInv[MAX_OBJS];
uniform int uObjMatId[MAX_OBJS];

uniform int uMatCount;
uniform vec3 uMatColor[MAX_OBJS];
uniform float uMatSmoothShade[MAX_OBJS];
uniform int uSelectedIdx;

${BVH_GLSL}

vec3 envColor(vec3 rd){
  float f=clamp(rd.y*0.5+0.5,0.0,1.0);
  return mix(uEnvBottom,uEnvTop,f)*uEnvIntensity;
}

void main(){
  vec2 pixelCoord = gl_FragCoord.xy;
  vec2 uv = pixelCoord/uResolution;
  vec2 ndc = uv*2.0-1.0;
  float tanFov = tan(radians(uCamFov)*0.5);
  vec3 rd = normalize(uCamForward + uCamRight*ndc.x*tanFov*uCamAspect + uCamUp*ndc.y*tanFov);
  vec3 ro = uCamPos;

  Hit hit;
  bool hitSomething = intersectBVH(ro, rd, -1, hit);
  if(!hitSomething){
    fragColor = vec4(envColor(rd),1.0);
    return;
  }

  // تحديد الكائن
  int objId = -1;
  for(int i=0;i<uObjCount;i++){
    if(hit.triIdx >= uObjMeshStart[i] && hit.triIdx < uObjMeshStart[i] + uObjMeshCount[i]){
      objId = i; break;
    }
  }
  if(objId < 0){ fragColor = vec4(envColor(rd),1.0); return; }

  vec3 albedo = uMatColor[objId];
  vec3 n = hit.nrm;
  vec3 viewDir = -rd;
  bool front = dot(rd,n)<0.0;
  vec3 nrm = front? n : -n;

  // إضاءة أمامية بسيطة
  vec3 lightDir = viewDir;
  float ndl = max(dot(nrm,lightDir),0.0);

  float smoothAmt = uMatSmoothShade[objId];
  float shadeSharp = mix(0.15, 1.0, smoothAmt);
  ndl = pow(ndl, mix(2.5, 1.0, smoothAmt));

  vec3 col = albedo*(0.2 + ndl*0.85);

  if(objId==uSelectedIdx){
    float edge = pow(1.0-max(dot(nrm,viewDir),0.0), 1.5);
    col = mix(col, vec3(0.35,0.55,1.0), edge*0.6);
  }

  fragColor = vec4(col,1.0);
}
`;

// ------------------------------------------------------------------
// Bloom Shaders (نفسها)
// ------------------------------------------------------------------
const BRIGHTPASS_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform float uThreshold;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float lum = dot(c, vec3(0.299,0.587,0.114));
  float w = smoothstep(uThreshold, uThreshold+0.5, lum);
  fragColor = vec4(c*w, 1.0);
}
`;

const GAUSSIAN_BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform vec2 uDirection;
uniform float uRadius;

void main(){
  vec2 texel = uDirection/uResolution*uRadius;
  float weights[7];
  weights[0]=0.1633; weights[1]=0.1531; weights[2]=0.1258; weights[3]=0.0913;
  weights[4]=0.0577; weights[5]=0.0317; weights[6]=0.0148;
  vec3 result = texture(uTex, vUv).rgb * weights[0];
  for(int i=1;i<7;i++){
    vec2 off = texel*float(i);
    result += texture(uTex, vUv+off).rgb * weights[i];
    result += texture(uTex, vUv-off).rgb * weights[i];
  }
  fragColor = vec4(result,1.0);
}
`;

const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform sampler2D uBloomTex;
uniform vec2 uResolution;
uniform int uDenoise;
uniform float uDenoiseStrength;
uniform int uBloom;
uniform float uBloomStrength;

vec3 tonemapACES(vec3 x){
  float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}

void main(){
  vec2 texel = 1.0/uResolution;
  vec3 center = texture(uTex, vUv).rgb;
  vec3 result = center;

  if(uDenoise==1){
    vec3 sum = vec3(0.0); float wsum = 0.0;
    float lumCenter = dot(center, vec3(0.299,0.587,0.114));
    for(int dx=-3; dx<=3; dx++){
      for(int dy=-3; dy<=3; dy++){
        vec2 off = vec2(float(dx),float(dy))*texel;
        vec3 samp = texture(uTex, vUv+off).rgb;
        float lumSamp = dot(samp, vec3(0.299,0.587,0.114));
        float spatialDist2 = float(dx*dx+dy*dy);
        float spatial = exp(-spatialDist2/18.0);
        float lumDiff = abs(lumSamp-lumCenter);
        float edgeWeight = exp(-(lumDiff*lumDiff)/max(uDenoiseStrength*0.04+0.003,0.001));
        float w = spatial*edgeWeight;
        sum += samp*w; wsum += w;
      }
    }
    vec3 denoised = sum/max(wsum,0.0001);
    result = mix(center, denoised, uDenoiseStrength);
  }

  if(uBloom==1){
    vec3 bloomColor = texture(uBloomTex, vUv).rgb;
    result += bloomColor*uBloomStrength;
  }

  result = tonemapACES(result);
  result = pow(result, vec3(1.0/2.2));
  fragColor = vec4(result,1.0);
}
`;

const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
void main(){ fragColor = texture(uTex, vUv); }
`;

const ADD_COMBINE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uWeightB;
void main(){
  vec3 a = texture(uTexA, vUv).rgb;
  vec3 b = texture(uTexB, vUv).rgb;
  fragColor = vec4(a + b*uWeightB, 1.0);
}
`;

// ======================================================================
// فئة المثلثات (TriangleMesh)
// ======================================================================
class TriangleMesh {
  constructor() {
    this.vertices = [];
    this.normals = [];
    this.uvs = [];
    this.indices = [];
    this.triCount = 0;
    this.vertexCount = 0;
    this.bvh = null;
  }

  addTriangle(v0, v1, v2, n0, n1, n2, uv0, uv1, uv2) {
    const base = this.vertexCount;
    this.vertices.push(v0[0], v0[1], v0[2]);
    this.vertices.push(v1[0], v1[1], v1[2]);
    this.vertices.push(v2[0], v2[1], v2[2]);
    if (n0) {
      this.normals.push(n0[0], n0[1], n0[2]);
      this.normals.push(n1[0], n1[1], n1[2]);
      this.normals.push(n2[0], n2[1], n2[2]);
    } else {
      const e1 = [v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]];
      const e2 = [v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]];
      const n = normalize3(cross3(e1, e2));
      for (let i=0; i<3; i++) this.normals.push(n[0], n[1], n[2]);
    }
    if (uv0) {
      this.uvs.push(uv0[0], uv0[1]);
      this.uvs.push(uv1[0], uv1[1]);
      this.uvs.push(uv2[0], uv2[1]);
    } else {
      this.uvs.push(0,0, 1,0, 0,1);
    }
    this.indices.push(base, base+1, base+2);
    this.triCount++;
    this.vertexCount += 3;
  }

  buildBVH() {
    if (this.triCount === 0) return;
    const tris = [];
    for (let i=0; i<this.triCount; i++) {
      const i0 = this.indices[i*3];
      const i1 = this.indices[i*3+1];
      const i2 = this.indices[i*3+2];
      const v0 = [this.vertices[i0*3], this.vertices[i0*3+1], this.vertices[i0*3+2]];
      const v1 = [this.vertices[i1*3], this.vertices[i1*3+1], this.vertices[i1*3+2]];
      const v2 = [this.vertices[i2*3], this.vertices[i2*3+1], this.vertices[i2*3+2]];
      const bmin = [Math.min(v0[0],v1[0],v2[0]), Math.min(v0[1],v1[1],v2[1]), Math.min(v0[2],v1[2],v2[2])];
      const bmax = [Math.max(v0[0],v1[0],v2[0]), Math.max(v0[1],v1[1],v2[1]), Math.max(v0[2],v1[2],v2[2])];
      tris.push({idx:i, bmin, bmax, v0, v1, v2});
    }
    this.bvh = this._buildBVHNode(tris);
    return this.bvh;
  }

  _buildBVHNode(tris) {
    if (tris.length === 0) return null;
    let bmin = [tris[0].bmin[0], tris[0].bmin[1], tris[0].bmin[2]];
    let bmax = [tris[0].bmax[0], tris[0].bmax[1], tris[0].bmax[2]];
    for (const t of tris) {
      bmin = [Math.min(bmin[0],t.bmin[0]), Math.min(bmin[1],t.bmin[1]), Math.min(bmin[2],t.bmin[2])];
      bmax = [Math.max(bmax[0],t.bmax[0]), Math.max(bmax[1],t.bmax[1]), Math.max(bmax[2],t.bmax[2])];
    }
    const node = {
      bmin, bmax, left:null, right:null, triStart:0, triCount:0,
      triIndices: tris.map(t=>t.idx), isLeaf:false
    };
    if (tris.length <= 4) {
      node.isLeaf = true;
      node.triStart = 0;
      node.triCount = tris.length;
      node.triIndices = tris.map(t=>t.idx);
      return node;
    }
    const extent = [bmax[0]-bmin[0], bmax[1]-bmin[1], bmax[2]-bmin[2]];
    let axis = 0;
    if (extent[1] > extent[0]) axis = 1;
    if (extent[2] > extent[axis]) axis = 2;
    const mid = (bmin[axis] + bmax[axis]) * 0.5;
    const leftTris = [], rightTris = [];
    for (const t of tris) {
      const center = (t.bmin[axis] + t.bmax[axis]) * 0.5;
      if (center < mid) leftTris.push(t);
      else rightTris.push(t);
    }
    if (leftTris.length === 0 || rightTris.length === 0) {
      const half = Math.floor(tris.length/2);
      for (let i=0; i<tris.length; i++) {
        if (i<half) leftTris.push(tris[i]);
        else rightTris.push(tris[i]);
      }
    }
    node.left = this._buildBVHNode(leftTris);
    node.right = this._buildBVHNode(rightTris);
    return node;
  }

  flattenBVH() {
    if (!this.bvh) return null;
    const nodes = [], triList = [];
    this._flattenNode(this.bvh, nodes, triList);
    return { nodes, triList };
  }

  _flattenNode(node, nodes, triList) {
    const idx = nodes.length;
    const triStart = triList.length;
    const triCount = node.isLeaf ? node.triIndices.length : 0;
    if (node.isLeaf) {
      for (const t of node.triIndices) triList.push(t);
    }
    nodes.push({
      bmin: node.bmin, bmax: node.bmax,
      left: node.left ? -1 : -1,
      right: node.right ? -1 : -1,
      triStart, triCount,
      isLeaf: node.isLeaf
    });
    if (node.left) {
      const lIdx = this._flattenNode(node.left, nodes, triList);
      nodes[idx].left = lIdx;
    }
    if (node.right) {
      const rIdx = this._flattenNode(node.right, nodes, triList);
      nodes[idx].right = rIdx;
    }
    return idx;
  }
}

// ======================================================================
// المحرك الرئيسي (PathTracerEngine)
// ======================================================================
class PathTracerEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('WebGL2 غير مدعوم على هذا الجهاز');
    this.gl.getExtension('EXT_color_buffer_float');
    this.gl.getExtension('OES_texture_float_linear');

    this.initGL();
    this.frame = 0;
    this.tileSize = 64;
    this.tileQueue = [];
    this.tileIndex = 0;
    this.width = 0; this.height = 0;
    this.needsReset = true;

    // بيانات المثلثات المُجمَّعة
    this.meshData = {
      vertices: [], normals: [], uvs: [],
      indices: [], bvhNodes: [], bvhTriList: [],
      objStart: [], objCount: []
    };
    this._bvhTex = null;
    this._bvhTex2 = null;
    this._triVertsTex = null;
    this._triNormalsTex = null;
    this._triCount = 0;
  }

  initGL() {
    const gl = this.gl;
    this.progTrace = this.buildProgram(VERT_SRC, FRAG_SRC);
    this.progPreview = this.buildProgram(VERT_SRC, PREVIEW_FRAG);
    this.progDisplay = this.buildProgram(VERT_SRC, DISPLAY_FRAG);
    this.progBrightpass = this.buildProgram(VERT_SRC, BRIGHTPASS_FRAG);
    this.progBlur = this.buildProgram(VERT_SRC, GAUSSIAN_BLUR_FRAG);
    this.progCopy = this.buildProgram(VERT_SRC, COPY_FRAG);
    this.progAddCombine = this.buildProgram(VERT_SRC, ADD_COMBINE_FRAG);

    const quad = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  buildProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error('Vertex shader error: ' + gl.getShaderInfoLog(vs));
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error('Fragment shader error: ' + gl.getShaderInfoLog(fs));
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  makeFloatTarget(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  resize(w, h) {
    if (this.width === w && this.height === h) return;
    this.width = w; this.height = h;
    const gl = this.gl;
    this.canvas.width = w; this.canvas.height = h;
    gl.viewport(0, 0, w, h);

    if (this.fbo0) gl.deleteFramebuffer(this.fbo0);
    if (this.fbo1) gl.deleteFramebuffer(this.fbo1);
    if (this.tex0) gl.deleteTexture(this.tex0);
    if (this.tex1) gl.deleteTexture(this.tex1);

    const makeTarget = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    };
    const a = makeTarget(); const b = makeTarget();
    this.tex0 = a.tex; this.fbo0 = a.fbo;
    this.tex1 = b.tex; this.fbo1 = b.fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Bloom levels
    if (this.bloomLevels) {
      this.bloomLevels.forEach(lvl => { gl.deleteFramebuffer(lvl.a.fbo); gl.deleteFramebuffer(lvl.b.fbo); gl.deleteTexture(lvl.a.tex); gl.deleteTexture(lvl.b.tex); });
    }
    this.bloomLevels = [];
    let lw = Math.floor(w/2), lh = Math.floor(h/2);
    for (let i=0; i<5; i++) {
      lw = Math.max(4, Math.floor(lw)); lh = Math.max(4, Math.floor(lh));
      this.bloomLevels.push({ w:lw, h:lh, a:this.makeFloatTarget(lw,lh), b:this.makeFloatTarget(lw,lh) });
      lw = Math.floor(lw/2); lh = Math.floor(lh/2);
      if (lw<4 || lh<4) break;
    }
    this.bloomW = this.bloomLevels[0].w; this.bloomH = this.bloomLevels[0].h;
    this.bloomA = this.bloomLevels[0].a;
    this.bloomB = this.bloomLevels[0].b;
    if (this.bloomComposite) gl.deleteFramebuffer(this.bloomComposite.fbo);
    if (this.bloomComposite) gl.deleteTexture(this.bloomComposite.tex);
    this.bloomComposite = this.makeFloatTarget(this.bloomW, this.bloomH);

    this.reset();
  }

  reset() {
    this.frame = 0;
    this.needsReset = false;
    this.buildTileQueue();
    const gl = this.gl;
    if (this.fbo0 && this.fbo1) {
      for (const fbo of [this.fbo0, this.fbo1]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.clearColor(0,0,0,1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  buildTileQueue() {
    this.tileQueue = [];
    const ts = this.tileSize;
    const tiles = [];
    for (let y=0; y<this.height; y+=ts) {
      for (let x=0; x<this.width; x+=ts) {
        const w = Math.min(ts, this.width-x), h = Math.min(ts, this.height-y);
        const cx = x+w/2, cy = y+h/2;
        const dx = cx-this.width/2, dy = cy-this.height/2;
        const dist = dx*dx+dy*dy;
        tiles.push({ rect:[x,y,w,h], dist });
      }
    }
    tiles.sort((a,b)=>a.dist-b.dist);
    this.tileQueue = tiles.map(t=>t.rect);
    this.tileIndex = 0;
  }

  // ---- رفع بيانات المثلثات و BVH إلى GPU ----
  _uploadMeshData(mesh, objIdx) {
    const baseTri = this.meshData.indices.length / 3;
    const baseVert = this.meshData.vertices.length / 3;

    // إلحاق القمم
    for (let i=0; i<mesh.vertices.length/3; i++) {
      this.meshData.vertices.push(mesh.vertices[i*3], mesh.vertices[i*3+1], mesh.vertices[i*3+2]);
      if (mesh.normals && i*3+2 < mesh.normals.length) {
        this.meshData.normals.push(mesh.normals[i*3], mesh.normals[i*3+1], mesh.normals[i*3+2]);
      } else {
        this.meshData.normals.push(0,1,0);
      }
      if (mesh.uvs && i*2+1 < mesh.uvs.length) {
        this.meshData.uvs.push(mesh.uvs[i*2], mesh.uvs[i*2+1]);
      } else {
        this.meshData.uvs.push(0,0);
      }
    }

    // إلحاق الفهارس
    for (let i=0; i<mesh.indices.length; i++) {
      this.meshData.indices.push(mesh.indices[i] + baseVert);
    }

    const triStart = this.meshData.indices.length / 3 - mesh.triCount;
    this.meshData.objStart[objIdx] = triStart;
    this.meshData.objCount[objIdx] = mesh.triCount;

    // BVH
    const flat = mesh.flattenBVH();
    if (flat) {
      const nodeOffset = this.meshData.bvhNodes.length;
      for (const node of flat.nodes) {
        const newNode = {
          bmin: node.bmin, bmax: node.bmax,
          left: node.left >=0 ? node.left + nodeOffset : -1,
          right: node.right >=0 ? node.right + nodeOffset : -1,
          triStart: node.triStart + triStart,
          triCount: node.triCount
        };
        this.meshData.bvhNodes.push(newNode);
      }
      for (const t of flat.triList) {
        this.meshData.bvhTriList.push(t + triStart);
      }
    }

    this._rebuildGPUTextures();
  }

  _rebuildGPUTextures() {
    const gl = this.gl;
    const data = this.meshData;

    // BVH Nodes
    const nodeCount = data.bvhNodes.length;
    if (nodeCount > 0) {
      const nodeData = new Float32Array(nodeCount * 8);
      const nodeData2 = new Float32Array(nodeCount * 4);
      for (let i=0; i<nodeCount; i++) {
        const n = data.bvhNodes[i];
        nodeData[i*8+0] = n.bmin[0];
        nodeData[i*8+1] = n.bmin[1];
        nodeData[i*8+2] = n.bmin[2];
        nodeData[i*8+3] = n.bmax[0];
        nodeData[i*8+4] = n.bmax[1];
        nodeData[i*8+5] = n.bmax[2];
        nodeData[i*8+6] = n.left;
        nodeData[i*8+7] = n.right;
        nodeData2[i*4+0] = n.triStart;
        nodeData2[i*4+1] = n.triCount;
        nodeData2[i*4+2] = 0;
        nodeData2[i*4+3] = 0;
      }
      if (this._bvhTex) gl.deleteTexture(this._bvhTex);
      if (this._bvhTex2) gl.deleteTexture(this._bvhTex2);
      this._bvhTex = this._uploadFloatTexture(nodeData, nodeCount*2, 1, 4);
      this._bvhTex2 = this._uploadFloatTexture(nodeData2, nodeCount, 1, 4);
    }

    // Triangle data
    const triCount = data.indices.length / 3;
    this._triCount = triCount;
    if (triCount > 0) {
      const vertData = new Float32Array(triCount * 9);
      const normData = new Float32Array(triCount * 9);
      for (let i=0; i<triCount; i++) {
        const i0 = data.indices[i*3];
        const i1 = data.indices[i*3+1];
        const i2 = data.indices[i*3+2];
        for (let j=0; j<3; j++) {
          const vi = [i0,i1,i2][j];
          vertData[i*9 + j*3 + 0] = data.vertices[vi*3];
          vertData[i*9 + j*3 + 1] = data.vertices[vi*3+1];
          vertData[i*9 + j*3 + 2] = data.vertices[vi*3+2];
          normData[i*9 + j*3 + 0] = data.normals[vi*3];
          normData[i*9 + j*3 + 1] = data.normals[vi*3+1];
          normData[i*9 + j*3 + 2] = data.normals[vi*3+2];
        }
      }
      if (this._triVertsTex) gl.deleteTexture(this._triVertsTex);
      if (this._triNormalsTex) gl.deleteTexture(this._triNormalsTex);
      this._triVertsTex = this._uploadFloatTexture(vertData, triCount*3, 1, 3);
      this._triNormalsTex = this._uploadFloatTexture(normData, triCount*3, 1, 3);
    }
  }

  _uploadFloatTexture(data, width, height, components) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const format = components===4 ? gl.RGBA32F : (components===3 ? gl.RGB32F : gl.RGBA32F);
    const pixelFormat = components===4 ? gl.RGBA : (components===3 ? gl.RGB : gl.RGBA);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, pixelFormat, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // ---- تعيين الـ uniforms ----
  setUniforms(prog, scene, tileRect, activeCam) {
    const gl = this.gl;
    const u = (name) => gl.getUniformLocation(prog, name);
    gl.uniform2f(u('uResolution'), this.width, this.height);
    if (tileRect) {
      gl.uniform4f(u('uTileRect'), tileRect[0], this.height-tileRect[1]-tileRect[3], tileRect[2], tileRect[3]);
    }
    gl.uniform1f(u('uTime'), performance.now()/1000);
    gl.uniform1i(u('uFrame'), this.frame);
    gl.uniform1i(u('uAccumCount'), this.frame);
    gl.uniform1i(u('uBounces'), (scene.renderSettings && scene.renderSettings.bounces) || 4);

    const cam = activeCam || scene.camera;
    gl.uniform3f(u('uCamPos'), cam.pos[0], cam.pos[1], cam.pos[2]);
    gl.uniform3f(u('uCamForward'), cam.forward[0], cam.forward[1], cam.forward[2]);
    gl.uniform3f(u('uCamRight'), cam.right[0], cam.right[1], cam.right[2]);
    gl.uniform3f(u('uCamUp'), cam.up[0], cam.up[1], cam.up[2]);
    gl.uniform1f(u('uCamFov'), cam.fov);
    gl.uniform1f(u('uCamAspect'), this.width/this.height);
    gl.uniform1i(u('uDofEnabled'), cam.dofEnabled?1:0);
    gl.uniform1f(u('uFocusDist'), cam.focusDist);
    gl.uniform1f(u('uAperture'), cam.aperture);

    gl.uniform3f(u('uEnvTop'), ...scene.env.top);
    gl.uniform3f(u('uEnvBottom'), ...scene.env.bottom);
    gl.uniform1f(u('uEnvIntensity'), scene.env.intensity);

    const meshes = scene.objects.filter(o => o.visible && o.kind === 'mesh');
    const lights = scene.objects.filter(o => o.kind === 'light' && o.visible);
    gl.uniform1i(u('uObjCount'), meshes.length);
    gl.uniform1i(u('uLightCount'), lights.length);

    // ربط نسيج BVH
    if (this._bvhTex) {
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._bvhTex);
      gl.uniform1i(u('uBVHNodes'), 2);
    }
    if (this._bvhTex2) {
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this._bvhTex2);
      gl.uniform1i(u('uBVHNodeData2'), 3);
    }
    if (this._triVertsTex) {
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this._triVertsTex);
      gl.uniform1i(u('uTriVerts'), 4);
    }
    if (this._triNormalsTex) {
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this._triNormalsTex);
      gl.uniform1i(u('uTriNormals'), 5);
    }

    // الكائنات
    meshes.forEach((o, i) => {
      const mat = o.getTransformMatrix ? o.getTransformMatrix() : mat4Identity();
      const invMat = o.getTransformMatrixInv ? o.getTransformMatrixInv() : mat4Identity();
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, `uObjTransform[${i}]`), false, mat);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, `uObjTransformInv[${i}]`), false, invMat);
      gl.uniform1i(gl.getUniformLocation(prog, `uObjMeshStart[${i}]`), o._meshStart || 0);
      gl.uniform1i(gl.getUniformLocation(prog, `uObjMeshCount[${i}]`), o._meshCount || 0);
      const matId = scene.materials.indexOf(o.material);
      gl.uniform1i(gl.getUniformLocation(prog, `uObjMatId[${i}]`), matId>=0 ? matId : 0);
    });

    // المواد
    const matCount = scene.materials.length;
    gl.uniform1i(u('uMatCount'), matCount);
    scene.materials.forEach((m, i) => {
      gl.uniform3f(gl.getUniformLocation(prog, `uMatColor[${i}]`), ...m.color);
      gl.uniform1f(gl.getUniformLocation(prog, `uMatMetallic[${i}]`), m.metallic);
      gl.uniform1f(gl.getUniformLocation(prog, `uMatRoughness[${i}]`), m.roughness);
      gl.uniform1f(gl.getUniformLocation(prog, `uMatIOR[${i}]`), m.ior);
      gl.uniform1f(gl.getUniformLocation(prog, `uMatTransmission[${i}]`), m.transmission);
      const em = m.emission * 1.0;
      gl.uniform3f(gl.getUniformLocation(prog, `uMatEmission[${i}]`), m.emissionColor[0]*em, m.emissionColor[1]*em, m.emissionColor[2]*em);
      gl.uniform1f(gl.getUniformLocation(prog, `uMatSubsurface[${i}]`), m.subsurface||0);
    });

    // الإضاءات
    lights.forEach((l, i) => {
      gl.uniform1i(gl.getUniformLocation(prog, `uLightType[${i}]`), l.lightType);
      gl.uniform3f(gl.getUniformLocation(prog, `uLightPos[${i}]`), ...l.position);
      const dir = l.lightType===1 ? l.getLightDirection() : l.getForwardDirection();
      gl.uniform3f(gl.getUniformLocation(prog, `uLightDir[${i}]`), ...dir);
      gl.uniform3f(gl.getUniformLocation(prog, `uLightColor[${i}]`), ...l.light.color);
      gl.uniform1f(gl.getUniformLocation(prog, `uLightIntensity[${i}]`), l.light.intensity);
      gl.uniform1f(gl.getUniformLocation(prog, `uLightRadius[${i}]`), l.light.radius);
      gl.uniform1f(gl.getUniformLocation(prog, `uLightRange[${i}]`), l.light.range || 10.0);
      gl.uniform1f(gl.getUniformLocation(prog, `uLightSpotAngle[${i}]`), l.light.spotAngle || 35);
      gl.uniform1f(gl.getUniformLocation(prog, `uLightSpotBlend[${i}]`), l.light.spotBlend || 0.25);
    });

    // Preview: selected index
    const selLoc = u('uSelectedIdx');
    if (selLoc) {
      const sel = scene.getSelected();
      const idx = sel ? meshes.indexOf(sel) : -1;
      gl.uniform1i(selLoc, idx);
    }
  }

  // ---- رفع الميش إلى المحرك ----
  _ensureMeshDataUploaded(scene) {
    const meshes = scene.objects.filter(o => o.kind === 'mesh' && o.visible);
    let needsUpload = false;
    for (const o of meshes) {
      if (!o._meshUploaded) { needsUpload = true; break; }
    }
    if (!needsUpload) return;

    // إعادة ضبط البيانات
    this.meshData = {
      vertices: [], normals: [], uvs: [],
      indices: [], bvhNodes: [], bvhTriList: [],
      objStart: [], objCount: []
    };

    for (let i=0; i<meshes.length; i++) {
      const o = meshes[i];
      if (!o.mesh) {
        o.mesh = this._generateDefaultMesh(o);
      }
      o._meshUploaded = true;
      o._meshStart = this.meshData.indices.length / 3;
      o._meshCount = o.mesh.triCount;
      this._uploadMeshData(o.mesh, i);
    }
    this._rebuildGPUTextures();
  }

  _generateDefaultMesh(obj) {
    const mesh = new TriangleMesh();
    const subtype = obj.subtype;
    const s = obj.getScaleParams();

    if (subtype === 'cube') {
      const hx=s[0], hy=s[1], hz=s[2];
      const verts = [
        [-hx,-hy,-hz], [ hx,-hy,-hz], [ hx, hy,-hz], [-hx, hy,-hz],
        [-hx,-hy, hz], [ hx,-hy, hz], [ hx, hy, hz], [-hx, hy, hz]
      ];
      const faces = [
        [0,1,2, 0,2,3], [4,6,5, 4,7,6],
        [0,4,5, 0,5,1], [3,2,6, 3,6,7],
        [0,3,7, 0,7,4], [1,5,6, 1,6,2]
      ];
      for (const f of faces) {
        const v0=verts[f[0]], v1=verts[f[1]], v2=verts[f[2]];
        const n = normalize3(cross3(sub3(v1,v0), sub3(v2,v0)));
        mesh.addTriangle(v0,v1,v2,n,n,n);
      }
    } else if (subtype === 'sphere') {
      const r = s[0];
      const segs = 20;
      for (let i=0; i<segs; i++) {
        for (let j=0; j<segs; j++) {
          const theta1 = (i/segs)*Math.PI*2;
          const theta2 = ((i+1)/segs)*Math.PI*2;
          const phi1 = (j/segs)*Math.PI;
          const phi2 = ((j+1)/segs)*Math.PI;
          const v0 = [r*Math.sin(phi1)*Math.cos(theta1), r*Math.cos(phi1), r*Math.sin(phi1)*Math.sin(theta1)];
          const v1 = [r*Math.sin(phi1)*Math.cos(theta2), r*Math.cos(phi1), r*Math.sin(phi1)*Math.sin(theta2)];
          const v2 = [r*Math.sin(phi2)*Math.cos(theta2), r*Math.cos(phi2), r*Math.sin(phi2)*Math.sin(theta2)];
          const v3 = [r*Math.sin(phi2)*Math.cos(theta1), r*Math.cos(phi2), r*Math.sin(phi2)*Math.sin(theta1)];
          const n0=normalize3(v0), n1=normalize3(v1), n2=normalize3(v2), n3=normalize3(v3);
          mesh.addTriangle(v0,v1,v2,n0,n1,n2);
          mesh.addTriangle(v0,v2,v3,n0,n2,n3);
        }
      }
    } else if (subtype === 'plane') {
      const hx=s[0], hz=s[2];
      const v0=[-hx,0,-hz], v1=[hx,0,-hz], v2=[hx,0,hz], v3=[-hx,0,hz];
      const n=[0,1,0];
      mesh.addTriangle(v0,v1,v2,n,n,n);
      mesh.addTriangle(v0,v2,v3,n,n,n);
    } else if (subtype === 'cylinder') {
      const r=s[0], h=s[1];
      const segs=24;
      for (let i=0; i<segs; i++) {
        const theta1=(i/segs)*Math.PI*2;
        const theta2=((i+1)/segs)*Math.PI*2;
        const x1=r*Math.cos(theta1), z1=r*Math.sin(theta1);
        const x2=r*Math.cos(theta2), z2=r*Math.sin(theta2);
        const v0=[x1,-h,z1], v1=[x1,h,z1], v2=[x2,h,z2], v3=[x2,-h,z2];
        const n1=normalize3([x1,0,z1]), n2=normalize3([x2,0,z2]);
        mesh.addTriangle(v0,v1,v2,n1,n1,n2);
        mesh.addTriangle(v0,v2,v3,n1,n2,n2);
        mesh.addTriangle([0,-h,0],v3,v0,[0,-1,0],[0,-1,0],[0,-1,0]);
        mesh.addTriangle([0,h,0],v1,v2,[0,1,0],[0,1,0],[0,1,0]);
      }
    } else if (subtype === 'cone') {
      const r=s[0], h=s[1]*2;
      const segs=24;
      for (let i=0; i<segs; i++) {
        const theta1=(i/segs)*Math.PI*2;
        const theta2=((i+1)/segs)*Math.PI*2;
        const x1=r*Math.cos(theta1), z1=r*Math.sin(theta1);
        const x2=r*Math.cos(theta2), z2=r*Math.sin(theta2);
        const v0=[x1,-h/2,z1], v1=[x2,-h/2,z2], v2=[0,h/2,0];
        const n1=normalize3([x1,0,z1]), n2=normalize3([x2,0,z2]);
        const n0=normalize3(add3(n1,[0,r/h,0]));
        const ntop=normalize3(add3(n2,[0,r/h,0]));
        mesh.addTriangle(v0,v1,v2,n0,ntop,[0,1,0]);
        mesh.addTriangle([0,-h/2,0],v0,v1,[0,-1,0],[0,-1,0],[0,-1,0]);
      }
    } else if (subtype === 'torus') {
      const R=s[0], r=s[1]||0.3;
      const segs1=20, segs2=16;
      for (let i=0; i<segs1; i++) {
        for (let j=0; j<segs2; j++) {
          const theta1=(i/segs1)*Math.PI*2;
          const theta2=((i+1)/segs1)*Math.PI*2;
          const phi1=(j/segs2)*Math.PI*2;
          const phi2=((j+1)/segs2)*Math.PI*2;
          const cx1=R*Math.cos(theta1), cz1=R*Math.sin(theta1);
          const cx2=R*Math.cos(theta2), cz2=R*Math.sin(theta2);
          const v0 = [cx1 + r*Math.cos(phi1)*Math.cos(theta1), r*Math.sin(phi1), cz1 + r*Math.cos(phi1)*Math.sin(theta1)];
          const v1 = [cx1 + r*Math.cos(phi2)*Math.cos(theta1), r*Math.sin(phi2), cz1 + r*Math.cos(phi2)*Math.sin(theta1)];
          const v2 = [cx2 + r*Math.cos(phi2)*Math.cos(theta2), r*Math.sin(phi2), cz2 + r*Math.cos(phi2)*Math.sin(theta2)];
          const v3 = [cx2 + r*Math.cos(phi1)*Math.cos(theta2), r*Math.sin(phi1), cz2 + r*Math.cos(phi1)*Math.sin(theta2)];
          const n0=normalize3([v0[0]-cx1, v0[1], v0[2]-cz1]);
          const n1=normalize3([v1[0]-cx1, v1[1], v1[2]-cz1]);
          const n2=normalize3([v2[0]-cx2, v2[1], v2[2]-cz2]);
          const n3=normalize3([v3[0]-cx2, v3[1], v3[2]-cz2]);
          mesh.addTriangle(v0,v1,v2,n0,n1,n2);
          mesh.addTriangle(v0,v2,v3,n0,n2,n3);
        }
      }
    }
    mesh.buildBVH();
    return mesh;
  }

  // ---- طرق الرندر ----
  renderTileStep(scene, activeCam) {
    const gl = this.gl;
    if (this.width<=0 || this.height<=0 || !this.fbo0 || !this.fbo1) {
      return { tilesTotal:0, tileIndex:0, frame:this.frame };
    }
    if (this.tileQueue.length === 0) this.buildTileQueue();
    if (this.tileIndex >= this.tileQueue.length) {
      this.tileIndex = 0;
      this.frame++;
      [this.tex0, this.tex1] = [this.tex1, this.tex0];
      [this.fbo0, this.fbo1] = [this.fbo1, this.fbo0];
      this.buildTileQueue();
      if (this.frame > 4000) this.frame = 4000;
    }
    if (this.tileQueue.length === 0) {
      return { tilesTotal:0, tileIndex:0, frame:this.frame };
    }
    const tile = this.tileQueue[this.tileIndex];
    this.tileIndex++;

    // تأكد من رفع بيانات الميش
    this._ensureMeshDataUploaded(scene);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo1);
    gl.viewport(0,0,this.width,this.height);
    gl.useProgram(this.progTrace);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.progTrace,'uAccum'),0);
    this.setUniforms(this.progTrace, scene, tile, activeCam);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    [this.tex0, this.tex1] = [this.tex1, this.tex0];
    [this.fbo0, this.fbo1] = [this.fbo1, this.fbo0];

    return { tilesTotal:this.tileQueue.length, tileIndex:this.tileIndex, frame:this.frame };
  }

  renderFullFrame(scene, activeCam) {
    const gl = this.gl;
    this._ensureMeshDataUploaded(scene);
    const tile = [0,0,this.width,this.height];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo1);
    gl.viewport(0,0,this.width,this.height);
    gl.useProgram(this.progTrace);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.progTrace,'uAccum'),0);
    this.setUniforms(this.progTrace, scene, tile, activeCam);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    [this.tex0, this.tex1] = [this.tex1, this.tex0];
    [this.fbo0, this.fbo1] = [this.fbo1, this.fbo0];
    this.frame++;
  }

  renderPreview(scene, activeCam) {
    const gl = this.gl;
    if (this.width<=0 || this.height<=0) return;
    this._ensureMeshDataUploaded(scene);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.useProgram(this.progPreview);
    this.setUniforms(this.progPreview, scene, null, activeCam);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }

  // ---- Bloom ----
  computeBloom(bloomThreshold, bloomRadius) {
    const gl = this.gl;
    const levels = this.bloomLevels;
    const lvl0 = levels[0];

    gl.bindFramebuffer(gl.FRAMEBUFFER, lvl0.a.fbo);
    gl.viewport(0,0,lvl0.w,lvl0.h);
    gl.useProgram(this.progBrightpass);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.progBrightpass,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(this.progBrightpass,'uThreshold'), bloomThreshold);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    const blurLevel = (lvl, srcTex) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, lvl.b.fbo);
      gl.viewport(0,0,lvl.w,lvl.h);
      gl.useProgram(this.progBlur);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(gl.getUniformLocation(this.progBlur,'uTex'),0);
      gl.uniform2f(gl.getUniformLocation(this.progBlur,'uResolution'), lvl.w, lvl.h);
      gl.uniform2f(gl.getUniformLocation(this.progBlur,'uDirection'), 1,0);
      gl.uniform1f(gl.getUniformLocation(this.progBlur,'uRadius'), bloomRadius);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, lvl.a.fbo);
      gl.viewport(0,0,lvl.w,lvl.h);
      gl.useProgram(this.progBlur);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, lvl.b.tex);
      gl.uniform1i(gl.getUniformLocation(this.progBlur,'uTex'),0);
      gl.uniform2f(gl.getUniformLocation(this.progBlur,'uResolution'), lvl.w, lvl.h);
      gl.uniform2f(gl.getUniformLocation(this.progBlur,'uDirection'), 0,1);
      gl.uniform1f(gl.getUniformLocation(this.progBlur,'uRadius'), bloomRadius);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    };

    blurLevel(lvl0, lvl0.a.tex);
    for (let i=1; i<levels.length; i++) {
      const prev=levels[i-1], cur=levels[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, cur.a.fbo);
      gl.viewport(0,0,cur.w,cur.h);
      gl.useProgram(this.progCopy);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prev.a.tex);
      gl.uniform1i(gl.getUniformLocation(this.progCopy,'uTex'),0);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      blurLevel(cur, cur.a.tex);
    }

    const lastIdx = levels.length-1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomComposite.fbo);
    gl.viewport(0,0,lvl0.w,lvl0.h);
    gl.useProgram(this.progCopy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, levels[lastIdx].a.tex);
    gl.uniform1i(gl.getUniformLocation(this.progCopy,'uTex'),0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    for (let i=lastIdx-1; i>=0; i--) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, lvl0.b.fbo);
      gl.viewport(0,0,lvl0.w,lvl0.h);
      gl.useProgram(this.progAddCombine);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, levels[i].a.tex);
      gl.uniform1i(gl.getUniformLocation(this.progAddCombine,'uTexA'),0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomComposite.tex);
      gl.uniform1i(gl.getUniformLocation(this.progAddCombine,'uTexB'),1);
      gl.uniform1f(gl.getUniformLocation(this.progAddCombine,'uWeightB'), 1.0);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomComposite.fbo);
      gl.viewport(0,0,lvl0.w,lvl0.h);
      gl.useProgram(this.progCopy);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, lvl0.b.tex);
      gl.uniform1i(gl.getUniformLocation(this.progCopy,'uTex'),0);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  present(denoise, denoiseStrength, bloom, bloomStrength, bloomThreshold) {
    const gl = this.gl;
    if (bloom) this.computeBloom(bloomThreshold, 2.2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.useProgram(this.progDisplay);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.progDisplay,'uTex'),0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloom ? this.bloomComposite.tex : this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.progDisplay,'uBloomTex'),1);
    gl.uniform2f(gl.getUniformLocation(this.progDisplay,'uResolution'), this.width, this.height);
    gl.uniform1i(gl.getUniformLocation(this.progDisplay,'uDenoise'), denoise?1:0);
    gl.uniform1f(gl.getUniformLocation(this.progDisplay,'uDenoiseStrength'), denoiseStrength);
    gl.uniform1i(gl.getUniformLocation(this.progDisplay,'uBloom'), bloom?1:0);
    gl.uniform1f(gl.getUniformLocation(this.progDisplay,'uBloomStrength'), bloomStrength!==undefined?bloomStrength:0.3);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
}

// ======================================================================
// تصدير الدوال والكلاسات العامة
// ======================================================================
if (typeof window !== 'undefined') {
  window.TriangleMesh = TriangleMesh;
  window.PathTracerEngine = PathTracerEngine;
  // دوال مساعدة موجودة بالفعل أعلى الملف
}
