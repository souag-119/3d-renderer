// ======================================================================
// Render3D Studio — WebGL2 Engine
// Path Tracer (رندر نهائي ووضع حي) + Rasterizer خفيف (معاينة بدون رندر،
// إضاءة واحدة من منظور المستخدم، flat/smooth shading فقط) + Bloom محسّن.
// ======================================================================

const VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos*0.5+0.5;
  gl_Position = vec4(aPos,0.0,1.0);
}`;

// ------------------------------------------------------------------
// أكواد GLSL مشتركة: تقاطعات الأشكال الهندسية (تُدرج في كل شيدر يحتاجها)
// ------------------------------------------------------------------
const GEOMETRY_GLSL = `
struct Hit{ float t; vec3 pos; vec3 nrm; int id; };

bool intersectSphere(vec3 ro, vec3 rd, vec3 c, float r, out float t){
  vec3 oc = ro-c;
  float b = dot(oc,rd);
  float cc = dot(oc,oc)-r*r;
  float h = b*b-cc;
  if(h<0.0) return false;
  h = sqrt(h);
  float t0 = -b-h; float t1 = -b+h;
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
  float k = r/h;
  vec3 o = ro - vec3(0.0,h*0.5,0.0);
  float a = rd.x*rd.x+rd.z*rd.z - k*k*rd.y*rd.y;
  float b = 2.0*(o.x*rd.x+o.z*rd.z) + 2.0*k*k*rd.y*(-o.y);
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
  vec3 cCenter = normalize(vec3(pos.x,0.0,pos.z))*R;
  nrmLocal = normalize(pos-cCenter);
  return true;
}
`;

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
// Fragment shader: Path Tracer الرئيسي
// أنواع المتريال: 0=solid, 1=transparent, 2=volume, 3=mask
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
uniform int uAccumCount;

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

uniform int uObjCount;
uniform int uObjType[MAX_OBJS];
uniform int uMatType[MAX_OBJS];
uniform vec3 uObjPos[MAX_OBJS];
uniform vec3 uObjScale[MAX_OBJS];
uniform mat3 uObjRotInv[MAX_OBJS];
uniform mat3 uObjRot[MAX_OBJS];
uniform vec3 uMatColor[MAX_OBJS];
uniform float uMatMetallic[MAX_OBJS];
uniform float uMatRoughness[MAX_OBJS];
uniform float uMatIOR[MAX_OBJS];
uniform float uMatTransmission[MAX_OBJS];
uniform vec3 uMatEmission[MAX_OBJS];
uniform float uMatSubsurface[MAX_OBJS];
uniform float uMatVolumeDensity[MAX_OBJS];
uniform float uMatVolumeScatter[MAX_OBJS];
uniform float uMatMaskSoftness[MAX_OBJS];

${GEOMETRY_GLSL}

// أنواع الإضاءة: 0=point,1=sun,2=area,3=spot
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

Hit sceneIntersect(vec3 ro, vec3 rd, int skipId){
  Hit h; h.t=1e9; h.id=-1;
  for(int i=0;i<MAX_OBJS;i++){
    if(i>=uObjCount) break;
    if(i==skipId) continue;
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

// أقرب تقاطع مع الخروج من الجسم نفسه (للحصول على سماكة تقريبية لأجل subsurface)
float exitDistance(vec3 ro, vec3 rd, int objId){
  vec3 lro = uObjRotInv[objId]*(ro-uObjPos[objId]);
  vec3 lrd = uObjRotInv[objId]*rd;
  int type = uObjType[objId];
  float t; vec3 nl; bool found=false;
  if(type==0) found=intersectSphere(lro,lrd,vec3(0.0),uObjScale[objId].x,t);
  else if(type==1) found=intersectBox(lro,lrd,uObjScale[objId],t,nl);
  else if(type==3) found=intersectCylinder(lro,lrd,uObjScale[objId].x,uObjScale[objId].y,t,nl);
  else if(type==4) found=intersectCone(lro,lrd,uObjScale[objId].x,uObjScale[objId].y*2.0,t,nl);
  else if(type==5) found=intersectTorus(lro,lrd,uObjScale[objId].x,uObjScale[objId].y,t,nl);
  return found ? t : 0.0;
}

bool sceneOcclude(vec3 ro, vec3 rd, float maxT, int skipId){
  for(int i=0;i<MAX_OBJS;i++){
    if(i>=uObjCount) break;
    if(i==skipId) continue;
    if(uMatEmission[i].x+uMatEmission[i].y+uMatEmission[i].z > 0.01) continue;
    if(uMatType[i]==1 && uMatTransmission[i] > 0.85) continue;
    if(uMatType[i]==3) continue; // مواد البقعة (mask) لا تُلقي ظلاً
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

// حساب اتجاه/شدة إضاءة من مصدر معيّن نحو نقطة (يشمل مخروط السبوت وتوسّعه بالمسافة)
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
    // مخروط سبوت: الفتحة تتسع تدريجياً وناعمة عند المسافة، مبني على زاوية حقيقية
    vec3 spotDir = normalize(uLightDir[i]);
    float cosAngle = dot(-ldir, spotDir);
    float outerCos = cos(radians(uLightSpotAngle[i]));
    float innerCos = cos(radians(uLightSpotAngle[i]*(1.0-uLightSpotBlend[i])));
    float spotFactor = smoothstep(outerCos, innerCos, cosAngle);
    radiance *= spotFactor*spotFactor;
  }
}

vec3 directLighting(vec3 pos, vec3 nrm, vec3 viewDir, vec3 albedo, float metallic, float roughness, int skipId){
  vec3 result = vec3(0.0);
  for(int i=0;i<MAX_LIGHTS;i++){
    if(i>=uLightCount) break;
    vec3 ldir; float dist; vec3 radiance;
    evalLight(i, pos, ldir, dist, radiance);

    float ndl = dot(nrm,ldir);
    if(ndl<=0.0) continue;
    if(radiance.r+radiance.g+radiance.b < 0.0001) continue;
    vec3 shadowOrigin = pos + nrm*0.002;
    if(sceneOcclude(shadowOrigin, ldir, dist, skipId)) continue;

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

// نفوذ الضوء الفيزيائي التقريبي (Subsurface Scattering):
// نُقيس سماكة المادة فعلياً بإطلاق شعاع للخلف عبر الجسم، فكلما قلّت السماكة زاد النفوذ.
// اللون الناتج يعتمد على لون المادة نفسها ولون الضوء الساقط (وليس لون منفصل).
vec3 subsurfaceLighting(vec3 pos, vec3 nrm, vec3 viewDir, vec3 albedo, float sssAmount, int objId){
  vec3 result = vec3(0.0);
  for(int i=0;i<MAX_LIGHTS;i++){
    if(i>=uLightCount) break;
    vec3 ldir; float dist; vec3 radiance;
    evalLight(i, pos, ldir, dist, radiance);

    // نفوذ الضوء يظهر فقط عندما يكون مصدر الضوء خلف السطح بالنسبة للناظر
    // (أي: الضوء يصل للوجه المقابل للناظر، فينفذ عبر المادة الرقيقة ليظهر للناظر من الجهة الأخرى)
    float lightBehindSurface = dot(nrm, ldir); // سالب يعني الضوء قادم من الجهة المقابلة للسطح الظاهر
    if(lightBehindSurface >= 0.0) continue;

    // قِس السماكة الفعلية للمادة: أطلق شعاعاً من داخل السطح مباشرة نحو مصدر الضوء
    // (نفس اتجاه ldir، لكن انطلاقاً من نقطة داخل الجسم قليلاً) حتى يخرج من الجهة المقابلة القريبة من الضوء.
    // المسافة المقطوعة داخل المادة هي السماكة الفعلية التي يجب أن يخترقها الضوء ليصل لعين الناظر.
    float thickness = exitDistance(pos - nrm*0.002, ldir, objId);

    // العتبة المطلوبة لنفوذ الضوء: كلما زاد sssAmount زادت "قوة النفوذ" فتحتاج المادة سماكة أكبر لمنعه
    // (مطابق للطلب: عند sss عالٍ، السماكة المطلوبة لنفوذ الضوء تكبر)
    float requiredThinness = mix(0.03, 4.0, sssAmount*sssAmount);
    float penetration = exp(-thickness/max(requiredThinness,0.001));

    // كثافة الإضاءة الساقطة من الجهة الأخرى (كلما كان الضوء أكثر عمودية على السطح الخلفي، زاد النفوذ)
    float backFacingStrength = clamp(-lightBehindSurface, 0.0, 1.0);

    // اللون يتبع لون المادة نفسها ولون/شدة الضوء الساقط، ويظهر بشكل ناعم عند حواف الجسم (حيث السماكة أقل)
    vec3 sssColor = albedo;
    result += sssColor * radiance * backFacingStrength * penetration * sssAmount;
  }
  return result;
}

vec3 tracePath(vec3 ro, vec3 rd){
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);

  for(int bounce=0; bounce<12; bounce++){
    if(bounce>=uBounces) break;
    Hit h = sceneIntersect(ro,rd,-1);
    if(h.id<0){
      radiance += throughput * envColor(rd);
      break;
    }

    int mType = uMatType[h.id];

    // مادة "بقعة/Mask": لا تظهر إلا عند تقاطعها فعلياً مع مجسم آخر عند نفس النقطة تقريباً؛
    // نحاكي هذا بجعلها شفافة تماماً للأشعة العادية (تمرّ خلالها) إلا إذا كانت قريبة جداً
    // من سطح مجسم آخر (تقاطع ضمن سماكة صغيرة) فتُعرض كطبقة رقيقة فوقه.
    if(mType==3){
      // مادة "بقعة/Mask": تظهر فقط عند وقوعها فعلياً داخل حجم مجسم آخر (تقاطع حقيقي بين الحجمين)
      // بدل الاعتماد على مسافة تقاطع لاحقة على نفس مسار الشعاع (وهو مفهوم مختلف تماماً)
      vec3 albedoM = uMatColor[h.id];
      float softness = uMatMaskSoftness[h.id];

      // اختبر: هل نقطة السطح h.pos تقع داخل حجم أي مجسم آخر (غير Mask نفسه)؟
      // نقيس "عمق الغمر" بإطلاق شعاع قصير من h.pos للداخل عبر الجسم الآخر إن وُجد تقاطع في الاتجاهين
      float minPenetration = 1e9;
      bool insideAny = false;
      for(int oi=0; oi<MAX_OBJS; oi++){
        if(oi>=uObjCount) break;
        if(oi==h.id) continue;
        if(uMatType[oi]==3) continue; // تجاهل أجسام Mask الأخرى
        vec3 lro2 = uObjRotInv[oi]*(h.pos-uObjPos[oi]);
        // اختبار بسيط: هل النقطة داخل الشكل الهندسي محلياً؟ (كرة/صندوق كحدين شائعين كافيين عملياً)
        int type2 = uObjType[oi];
        bool inside = false;
        float depthEstimate = 0.0;
        if(type2==0){
          float d = length(lro2);
          inside = d < uObjScale[oi].x;
          depthEstimate = uObjScale[oi].x - d;
        } else if(type2==1){
          vec3 ab = abs(lro2);
          inside = ab.x<uObjScale[oi].x && ab.y<uObjScale[oi].y && ab.z<uObjScale[oi].z;
          depthEstimate = min(min(uObjScale[oi].x-ab.x, uObjScale[oi].y-ab.y), uObjScale[oi].z-ab.z);
        } else if(type2==3){
          float radial = length(lro2.xz);
          inside = radial<uObjScale[oi].x && abs(lro2.y)<uObjScale[oi].y;
          depthEstimate = min(uObjScale[oi].x-radial, uObjScale[oi].y-abs(lro2.y));
        }
        if(inside){
          insideAny = true;
          minPenetration = min(minPenetration, depthEstimate);
        }
      }

      if(!insideAny){
        // خارج أي جسم آخر تماماً: اجعلها شفافة كلياً ومرّ خلالها دون أي تأثير مرئي
        ro = h.pos + rd*0.004;
        continue;
      }

      // داخل جسم آخر: اعرض تأثير البقعة بحافة ناعمة حسب softness وعمق الغمر
      float edgeFade = clamp(minPenetration/max(softness*0.5+0.01,0.001), 0.0, 1.0);
      vec3 n = h.nrm;
      vec3 nrm = dot(rd,n)<0.0 ? n : -n;
      vec3 viewDir = -rd;
      vec3 direct = directLighting(h.pos,nrm,viewDir,albedoM,uMatMetallic[h.id],clamp(uMatRoughness[h.id],0.03,1.0),h.id);
      radiance += throughput*(uMatEmission[h.id]*uMatColor[h.id]+direct)*edgeFade;
      ro = h.pos + rd*0.004;
      continue;
    }

    vec3 albedo = uMatColor[h.id];
    float metallic = uMatMetallic[h.id];
    float roughness = clamp(uMatRoughness[h.id],0.03,1.0);
    float ior = uMatIOR[h.id];
    float transmission = mType==1 ? uMatTransmission[h.id] : 0.0;
    vec3 emission = uMatEmission[h.id];
    float subsurface = mType==0 ? uMatSubsurface[h.id] : 0.0;

    radiance += throughput*emission;

    vec3 n = h.nrm;
    bool entering = dot(rd,n)<0.0;
    vec3 nrm = entering? n : -n;
    vec3 viewDir = -rd;

    if(mType==2){
      // ضباب/دخان حقيقي: نسير (march) عبر حجم الجسم بخطوات صغيرة، ونحسب احتمال التشتت
      // في كل خطوة بناءً على الكثافة، بدل معاملة السطح كصلب ذي حواف حادة.
      float density = uMatVolumeDensity[h.id] * 4.0; // معامل تكثيف لجعل القيمة 0-1 محسوسة بصرياً
      float scatter = uMatVolumeScatter[h.id];
      float thickness = exitDistance(h.pos + rd*0.003, rd, h.id);
      float stepSize = max(thickness / 12.0, 0.01);
      vec3 marchPos = h.pos + rd*0.003;
      bool scattered = false;
      float traveled = 0.0;

      for(int s=0; s<12; s++){
        if(traveled >= thickness) break;
        // احتمال التشتت في هذه الخطوة يعتمد على الكثافة (Beer-Lambert مبسّط)
        float scatterProb = 1.0 - exp(-density*stepSize);
        if(randf() < scatterProb*scatter){
          // نقطة تشتت داخل الحجم: أضف إضاءة محيطية خافتة من هذه النقطة، ثم غيّر الاتجاه عشوائياً (Isotropic scattering)
          vec3 ambientAtPoint = envColor(rd) * 0.15;
          radiance += throughput * albedo * ambientAtPoint * 0.3;
          for(int li=0; li<MAX_LIGHTS; li++){
            if(li>=uLightCount) break;
            vec3 ldir; float ldist; vec3 lrad;
            evalLight(li, marchPos, ldir, ldist, lrad);
            if(!sceneOcclude(marchPos, ldir, ldist, h.id)){
              radiance += throughput * albedo * lrad * 0.25;
            }
          }
          // اتجاه عشوائي كروي كامل (تشتت متساوي الاتجاهات، مناسب للضباب/الدخان)
          vec2 u = randf2();
          float cosT = 1.0-2.0*u.x;
          float sinT = sqrt(max(0.0,1.0-cosT*cosT));
          float phi = 2.0*PI*u.y;
          rd = vec3(sinT*cos(phi), cosT, sinT*sin(phi));
          throughput *= albedo * 0.9;
          scattered = true;
          marchPos += rd*0.005;
          break;
        }
        traveled += stepSize;
        marchPos = h.pos + rd*(0.003+traveled);
      }

      if(!scattered){
        // لم يتشتت الشعاع: يمر عبر الضباب مع امتصاص طفيف حسب الكثافة والمسافة المقطوعة (يُبقي شفافية الحواف الرقيقة)
        float transmit = exp(-density*thickness*(1.0-scatter*0.5));
        throughput *= mix(vec3(1.0), albedo, (1.0-transmit)*0.6);
        rd = rd; // يستمر بنفس الاتجاه (لا تشتت)
      }

      ro = h.pos + rd*0.004;
      if(bounce>3){
        float p = clamp(max(throughput.r,max(throughput.g,throughput.b)),0.05,1.0);
        if(randf()>p) break;
        throughput /= p;
      }
      continue;
    }

    if(transmission<0.99){
      radiance += throughput * directLighting(h.pos,nrm,viewDir,albedo,metallic,roughness,h.id) * (1.0-transmission);
    }
    if(subsurface>0.01){
      radiance += throughput * subsurfaceLighting(h.pos,nrm,viewDir,albedo,subsurface,h.id);
    }

    float rr = randf();
    if(transmission>0.01 && rr<transmission){
      float eta = entering ? 1.0/ior : ior;
      vec3 refracted = refract(rd, nrm, eta);
      float fres = pow(1.0-abs(dot(viewDir,nrm)),5.0)*0.9+0.02;
      if(length(refracted)<0.001 || randf()<fres){
        rd = reflect(rd,nrm);
        ro = h.pos + rd*0.003;
      } else {
        rd = refracted;
        ro = h.pos + rd*0.003;
      }
      throughput *= mix(vec3(1.0), albedo, 0.35);
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
// شيدر المعاينة (بدون رندر Path Tracing): إضاءة واحدة فقط موجهة من
// منظور المستخدم نحو الأمام (Headlight)، ولا ينطبق عليها إلا اللون
// وSmooth/Flat shading (بدون معدن/خشونة/انعكاسات/شفافية).
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
uniform int uObjType[MAX_OBJS];
uniform vec3 uObjPos[MAX_OBJS];
uniform vec3 uObjScale[MAX_OBJS];
uniform mat3 uObjRotInv[MAX_OBJS];
uniform mat3 uObjRot[MAX_OBJS];
uniform vec3 uMatColor[MAX_OBJS];
uniform float uMatSmoothShade[MAX_OBJS];
uniform int uSelectedIdx;

${GEOMETRY_GLSL}

Hit sceneIntersect(vec3 ro, vec3 rd){
  Hit h; h.t=1e9; h.id=-1;
  for(int i=0;i<MAX_OBJS;i++){
    if(i>=uObjCount) break;
    vec3 lro=uObjRotInv[i]*(ro-uObjPos[i]);
    vec3 lrd=uObjRotInv[i]*rd;
    int type=uObjType[i]; float t; vec3 nl; bool found=false;
    if(type==0){ found=intersectSphere(lro,lrd,vec3(0.0),uObjScale[i].x,t); if(found){ vec3 p=lro+lrd*t; nl=normalize(p);} }
    else if(type==1) found=intersectBox(lro,lrd,uObjScale[i],t,nl);
    else if(type==2){ found=intersectPlane(lro,lrd,uObjScale[i].xz,t); nl=vec3(0.0,1.0,0.0); }
    else if(type==3) found=intersectCylinder(lro,lrd,uObjScale[i].x,uObjScale[i].y,t,nl);
    else if(type==4) found=intersectCone(lro,lrd,uObjScale[i].x,uObjScale[i].y*2.0,t,nl);
    else if(type==5) found=intersectTorus(lro,lrd,uObjScale[i].x,uObjScale[i].y,t,nl);
    if(found&&t<h.t&&t>0.001){ h.t=t; h.id=i; h.pos=ro+rd*t; h.nrm=normalize(uObjRot[i]*nl); }
  }
  return h;
}

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

  Hit h = sceneIntersect(ro,rd);
  if(h.id<0){
    fragColor = vec4(envColor(rd),1.0);
    return;
  }

  vec3 albedo = uMatColor[h.id];
  vec3 n = h.nrm;
  vec3 viewDir = -rd;
  bool front = dot(rd,n)<0.0;
  vec3 nrm = front? n : -n;

  // إضاءة واحدة فقط: من موضع الكاميرا نحو الأمام (Headlight) - تحاكي منظور المستخدم
  vec3 lightDir = viewDir; // الضوء يأتي من خلف الناظر مباشرة نحو السطح
  float ndl = max(dot(nrm,lightDir),0.0);

  // Flat vs Smooth shading: عند smoothShade منخفض نجعل الإضاءة أكثر تقطعاً بمحاذاة الأوجه
  // (لا يمكن رسم أوجه مسطحة حقيقية بدون بيانات مضلعات فعلية لكل شكل SDF، لذا نحاكي التأثير
  // بتقليل نعومة الانتقال بين الإضاءة والظل تناسبياً مع smoothShade)
  float smoothAmt = uMatSmoothShade[h.id];
  float shadeSharp = mix(0.15, 1.0, smoothAmt);
  ndl = pow(ndl, mix(2.5, 1.0, smoothAmt)) ;

  vec3 col = albedo*(0.2 + ndl*0.85);

  if(h.id==uSelectedIdx){
    float edge = pow(1.0-max(dot(nrm,viewDir),0.0), 1.5);
    col = mix(col, vec3(0.35,0.55,1.0), edge*0.6);
  }

  fragColor = vec4(col,1.0);
}
`;

// ------------------------------------------------------------------
// Bloom محسّن: استخراج السطوع (Bright-pass) ثم بلور غاوسي فصلي (Separable)
// على عدة مقاطع لإنتاج توهج ناعم واقعي بدل تشويش بكسلي.
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

// بلور غاوسي فصلي بنطاق أوسع (13 عينة) لهالة توهج ناعمة وواسعة النطاق فعلياً
const GAUSSIAN_BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform vec2 uDirection; // (1,0) أفقي أو (0,1) رأسي
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

// شيدر العرض النهائي (tone mapping + denoise + دمج bloom الجاهز من نسيج منفصل)
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
    // فلتر ثنائي الاتجاه محسّن (7x7) مع وزن حافة أكثر تسامحاً مع التغيرات الطبيعية للإضاءة
    // لكن أكثر صرامة مع الاختلافات الحادة (حواف الأجسام)، لتفادي بهتان التفاصيل وحبيبات الضجيج معاً
    vec3 sum = vec3(0.0); float wsum = 0.0;
    float lumCenter = dot(center, vec3(0.299,0.587,0.114));
    for(int dx=-3; dx<=3; dx++){
      for(int dy=-3; dy<=3; dy++){
        vec2 off = vec2(float(dx),float(dy))*texel;
        vec3 samp = texture(uTex, vUv+off).rgb;
        float lumSamp = dot(samp, vec3(0.299,0.587,0.114));

        float spatialDist2 = float(dx*dx+dy*dy);
        float spatial = exp(-spatialDist2/18.0); // نطاق مكاني أوسع (7x7 فعّالة بالكامل)

        // وزن الحافة يعتمد على فارق السطوع (luminance) بدل فارق اللون الكامل RGB
        // هذا يحافظ على حواف الأجسام (حيث يتغير السطوع بشكل حاد) بينما يُنعّم الضجيج
        // داخل نفس السطح (حيث يتغير اللون بعشوائية بسيطة لكن السطوع القاعدي متقارب)
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

// شيدر بسيط لنسخ نسيج (يُستخدم بين مراحل bloom)
const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
void main(){ fragColor = texture(uTex, vUv); }
`;

// يجمع نسيجاً حالياً مع نسيج آخر (مستوى bloom أخشن) ليُنتج تراكماً تدريجياً للتوهج
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
  }

  initGL(){
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

  makeFloatTarget(w,h){
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,w,h,0,gl.RGBA,gl.FLOAT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {tex,fbo};
  }

  resize(w,h){
    if(this.width===w && this.height===h) return;
    this.width=w; this.height=h;
    const gl = this.gl;
    this.canvas.width=w; this.canvas.height=h;
    gl.viewport(0,0,w,h);

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

    // سلسلة Bloom متعددة المستويات (mip chain) لإنتاج توهج يمتد فعلياً حول الأجسام الساطعة
    // بدل بلور ضيق النطاق - كل مستوى بنصف دقة المستوى السابق
    if(this.bloomLevels){
      this.bloomLevels.forEach(lvl=>{ gl.deleteFramebuffer(lvl.a.fbo); gl.deleteFramebuffer(lvl.b.fbo); gl.deleteTexture(lvl.a.tex); gl.deleteTexture(lvl.b.tex); });
    }
    this.bloomLevels = [];
    let lw = Math.floor(w/2), lh = Math.floor(h/2);
    const numLevels = 5;
    for(let i=0;i<numLevels;i++){
      lw = Math.max(4, Math.floor(lw)); lh = Math.max(4, Math.floor(lh));
      this.bloomLevels.push({ w:lw, h:lh, a:this.makeFloatTarget(lw,lh), b:this.makeFloatTarget(lw,lh) });
      lw = Math.floor(lw/2); lh = Math.floor(lh/2);
      if(lw<4||lh<4) break;
    }
    // نبقي bloomA/bloomB للتوافق (المستوى الأول) - النتيجة النهائية المُركَّبة تُخزَّن هنا
    this.bloomW = this.bloomLevels[0].w; this.bloomH = this.bloomLevels[0].h;
    this.bloomA = this.bloomLevels[0].a;
    this.bloomB = this.bloomLevels[0].b;
    if(this.bloomComposite) gl.deleteFramebuffer(this.bloomComposite.fbo);
    if(this.bloomComposite) gl.deleteTexture(this.bloomComposite.tex);
    this.bloomComposite = this.makeFloatTarget(this.bloomW, this.bloomH);

    this.reset();
  }

  reset(){
    this.frame = 0;
    this.needsReset = false;
    this.buildTileQueue();
    const gl = this.gl;
    if(this.fbo0 && this.fbo1){
      for(const fbo of [this.fbo0,this.fbo1]){
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.clearColor(0,0,0,1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
  }

  buildTileQueue(){
    this.tileQueue = [];
    const ts = this.tileSize;
    const tiles = [];
    for(let y=0; y<this.height; y+=ts){
      for(let x=0; x<this.width; x+=ts){
        const w = Math.min(ts,this.width-x), h = Math.min(ts,this.height-y);
        const cx = x+w/2, cy = y+h/2;
        const dx = cx - this.width/2, dy = cy - this.height/2;
        const dist = dx*dx+dy*dy;
        tiles.push({rect:[x,y,w,h], dist});
      }
    }
    tiles.sort((a,b)=>a.dist-b.dist);
    this.tileQueue = tiles.map(t=>t.rect);
    this.tileIndex = 0;
  }

  setUniforms(prog, scene, tileRect, activeCam){
    const gl = this.gl;
    const u = (name)=>gl.getUniformLocation(prog,name);
    gl.uniform2f(u('uResolution'), this.width, this.height);
    if(tileRect){
      gl.uniform4f(u('uTileRect'), tileRect[0], this.height-tileRect[1]-tileRect[3], tileRect[2], tileRect[3]);
    }
    gl.uniform1f(u('uTime'), performance.now()/1000);
    gl.uniform1i(u('uFrame'), this.frame);
    gl.uniform1i(u('uAccumCount'), this.frame);
    gl.uniform1i(u('uBounces'), (scene.renderSettings&&scene.renderSettings.bounces)||4);

    const cam = activeCam || scene.camera;
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

    const objs = scene.objects.filter(o=>o.visible && o.kind==='mesh');
    gl.uniform1i(u('uObjCount'), objs.length);
    const lights = scene.objects.filter(o=>o.kind==='light' && o.visible);
    gl.uniform1i(u('uLightCount'), lights.length);

    const selIdx = objs.findIndex(o=>o.id===scene.selectedId);
    const selLoc = u('uSelectedIdx');
    if(selLoc) gl.uniform1i(selLoc, selIdx);

    const MAT_TYPE_IDS = {solid:0, transparent:1, volume:2, mask:3};

    objs.forEach((o,i)=>{
      gl.uniform1i(gl.getUniformLocation(prog,`uObjType[${i}]`), o.typeId);
      gl.uniform3f(gl.getUniformLocation(prog,`uObjPos[${i}]`), ...o.position);
      gl.uniform3f(gl.getUniformLocation(prog,`uObjScale[${i}]`), ...o.getScaleParams());
      const rot = o.getRotationMatrix();
      const rotInv = mat3Transpose(rot);
      gl.uniformMatrix3fv(gl.getUniformLocation(prog,`uObjRot[${i}]`), false, rot);
      gl.uniformMatrix3fv(gl.getUniformLocation(prog,`uObjRotInv[${i}]`), false, rotInv);
      const m = o.material;
      const mTypeLoc = gl.getUniformLocation(prog,`uMatType[${i}]`);
      if(mTypeLoc) gl.uniform1i(mTypeLoc, MAT_TYPE_IDS[m.matType]!==undefined?MAT_TYPE_IDS[m.matType]:0);
      gl.uniform3f(gl.getUniformLocation(prog,`uMatColor[${i}]`), ...m.color);
      gl.uniform1f(gl.getUniformLocation(prog,`uMatMetallic[${i}]`), m.metallic);
      gl.uniform1f(gl.getUniformLocation(prog,`uMatRoughness[${i}]`), m.roughness);
      const smoothLoc = gl.getUniformLocation(prog,`uMatSmoothShade[${i}]`);
      if(smoothLoc) gl.uniform1f(smoothLoc, m.smoothShade!==undefined?m.smoothShade:1.0);
      const iorLoc = gl.getUniformLocation(prog,`uMatIOR[${i}]`);
      if(iorLoc) gl.uniform1f(iorLoc, m.ior);
      const transLoc = gl.getUniformLocation(prog,`uMatTransmission[${i}]`);
      if(transLoc) gl.uniform1f(transLoc, m.transmission);
      const emLoc = gl.getUniformLocation(prog,`uMatEmission[${i}]`);
      if(emLoc){
        const em = m.emission*1.0;
        gl.uniform3f(emLoc, m.emissionColor[0]*em, m.emissionColor[1]*em, m.emissionColor[2]*em);
      }
      const sssLoc = gl.getUniformLocation(prog,`uMatSubsurface[${i}]`);
      if(sssLoc) gl.uniform1f(sssLoc, m.subsurface||0);
      const volDLoc = gl.getUniformLocation(prog,`uMatVolumeDensity[${i}]`);
      if(volDLoc) gl.uniform1f(volDLoc, m.volumeDensity!==undefined?m.volumeDensity:0.3);
      const volSLoc = gl.getUniformLocation(prog,`uMatVolumeScatter[${i}]`);
      if(volSLoc) gl.uniform1f(volSLoc, m.volumeScatter!==undefined?m.volumeScatter:0.5);
      const maskLoc = gl.getUniformLocation(prog,`uMatMaskSoftness[${i}]`);
      if(maskLoc) gl.uniform1f(maskLoc, m.maskSoftness!==undefined?m.maskSoftness:0.3);
    });

    lights.forEach((l,i)=>{
      gl.uniform1i(gl.getUniformLocation(prog,`uLightType[${i}]`), l.lightType);
      gl.uniform3f(gl.getUniformLocation(prog,`uLightPos[${i}]`), ...l.position);
      const dir = l.lightType===1 ? l.getLightDirection() : l.getForwardDirection();
      gl.uniform3f(gl.getUniformLocation(prog,`uLightDir[${i}]`), ...dir);
      gl.uniform3f(gl.getUniformLocation(prog,`uLightColor[${i}]`), ...l.light.color);
      gl.uniform1f(gl.getUniformLocation(prog,`uLightIntensity[${i}]`), l.light.intensity);
      const radLoc = gl.getUniformLocation(prog,`uLightRadius[${i}]`);
      if(radLoc) gl.uniform1f(radLoc, l.light.radius);
      const rangeLoc = gl.getUniformLocation(prog,`uLightRange[${i}]`);
      if(rangeLoc) gl.uniform1f(rangeLoc, l.light.range!==undefined?l.light.range:10.0);
      const spotAngleLoc = gl.getUniformLocation(prog,`uLightSpotAngle[${i}]`);
      if(spotAngleLoc) gl.uniform1f(spotAngleLoc, l.light.spotAngle!==undefined?l.light.spotAngle:35);
      const spotBlendLoc = gl.getUniformLocation(prog,`uLightSpotBlend[${i}]`);
      if(spotBlendLoc) gl.uniform1f(spotBlendLoc, l.light.spotBlend!==undefined?l.light.spotBlend:0.25);
    });
  }

  renderTileStep(scene, activeCam){
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
      [this.tex0,this.tex1] = [this.tex1,this.tex0];
      [this.fbo0,this.fbo1] = [this.fbo1,this.fbo0];
      this.buildTileQueue();
      if(this.frame > 4000) this.frame = 4000;
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
    this.setUniforms(this.progTrace, scene, tile, activeCam);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    [this.tex0,this.tex1] = [this.tex1,this.tex0];
    [this.fbo0,this.fbo1] = [this.fbo1,this.fbo0];

    return {tilesTotal:this.tileQueue.length, tileIndex:this.tileIndex, frame:this.frame};
  }

  renderFullFrame(scene, activeCam){
    const gl = this.gl;
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

    [this.tex0,this.tex1] = [this.tex1,this.tex0];
    [this.fbo0,this.fbo1] = [this.fbo1,this.fbo0];
    this.frame++;
  }

  // معاينة سريعة (rasterizer تقريبي) - إطار واحد فوري بدون تراكم، إضاءة واحدة فقط
  renderPreview(scene, activeCam){
    const gl = this.gl;
    if(this.width<=0||this.height<=0) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.useProgram(this.progPreview);
    this.setUniforms(this.progPreview, scene, null, activeCam);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }

  // ينفذ خط أنابيب Bloom كاملاً (استخراج سطوع + بلور أفقي/رأسي متعدد المرات) وينتج نسيج bloom نهائي
  computeBloom(bloomThreshold, bloomRadius){
    const gl = this.gl;
    const levels = this.bloomLevels;
    const lvl0 = levels[0];

    // 1) استخراج المناطق الساطعة من tex0 إلى المستوى الأول (bright-pass)
    gl.bindFramebuffer(gl.FRAMEBUFFER, lvl0.a.fbo);
    gl.viewport(0,0,lvl0.w,lvl0.h);
    gl.useProgram(this.progBrightpass);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.progBrightpass,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(this.progBrightpass,'uThreshold'), bloomThreshold);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    // 2) بلور غاوسي فصلي على المستوى الأول، ثم downsample (نسخ) إلى المستوى التالي وتكرار البلور
    // هذا يُنتج توهجاً يمتد لمسافات مختلفة (كل مستوى أخشن يغطي نطاقاً أوسع بصرياً)
    const blurLevel = (lvl, srcTex)=>{
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
    for(let i=1;i<levels.length;i++){
      const prev = levels[i-1], cur = levels[i];
      // downsample: انسخ نتيجة المستوى السابق (المُبَلوَر) إلى دقة أصغر
      gl.bindFramebuffer(gl.FRAMEBUFFER, cur.a.fbo);
      gl.viewport(0,0,cur.w,cur.h);
      gl.useProgram(this.progCopy);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prev.a.tex);
      gl.uniform1i(gl.getUniformLocation(this.progCopy,'uTex'),0);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      // بلور هذا المستوى الأخشن (نطاق أوسع بصرياً بنفس عدد العينات لأن الدقة أصغر)
      blurLevel(cur, cur.a.tex);
    }

    // 3) اجمع كل المستويات تصاعدياً (من الأخشن للأنعم) في bloomComposite بدقة المستوى الأول
    // ابدأ بنسخ أخشن مستوى كقاعدة
    const lastIdx = levels.length-1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomComposite.fbo);
    gl.viewport(0,0,lvl0.w,lvl0.h);
    gl.useProgram(this.progCopy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, levels[lastIdx].a.tex);
    gl.uniform1i(gl.getUniformLocation(this.progCopy,'uTex'),0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    for(let i=lastIdx-1;i>=0;i--){
      // بدّل composite لمؤقت عبر bloomB كمخزن وسيط، ثم اجمع مع المستوى i
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
      // انسخ الناتج مرة أخرى إلى bloomComposite لأجل التكرار التالي
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

  present(denoise, denoiseStrength, bloom, bloomStrength, bloomThreshold){
    const gl = this.gl;

    if(bloom){
      this.computeBloom(bloomThreshold, 2.2);
    }

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

function mat3Identity(){ return new Float32Array([1,0,0, 0,1,0, 0,0,1]); }

function mat3FromEuler(rx,ry,rz){
  const cx=Math.cos(rx), sx=Math.sin(rx);
  const cy=Math.cos(ry), sy=Math.sin(ry);
  const cz=Math.cos(rz), sz=Math.sin(rz);
  const Rx = [1,0,0, 0,cx,sx, 0,-sx,cx];
  const Ry = [cy,0,-sy, 0,1,0, sy,0,cy];
  const Rz = [cz,sz,0, -sz,cz,0, 0,0,1];
  const RyRx = mat3Mul(Ry,Rx);
  const R = mat3Mul(Rz,RyRx);
  return new Float32Array(R);
}

function mat3Mul(a,b){
  const r = new Array(9).fill(0);
  for(let c=0;c<3;c++){
    for(let row=0;row<3;row++){
      let sum=0;
      for(let k=0;k<3;k++){ sum += a[k*3+row]*b[c*3+k]; }
      r[c*3+row]=sum;
    }
  }
  return r;
}

function mat3Transpose(m){
  return new Float32Array([m[0],m[3],m[6], m[1],m[4],m[7], m[2],m[5],m[8]]);
}

function mat3MulVec3(m,v){
  return [
    m[0]*v[0]+m[3]*v[1]+m[6]*v[2],
    m[1]*v[0]+m[4]*v[1]+m[7]*v[2],
    m[2]*v[0]+m[5]*v[1]+m[8]*v[2]
  ];
}
