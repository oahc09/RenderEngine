﻿#version 430 core

layout (location=0) out vec4 color;
layout (location=1) out vec4 emission;

in vec2 texCoord;

// Transform ray from view to world space
uniform mat4 invView;

uniform vec3 camPos;

// used to adjust u coordinate based on aspect ratio
uniform vec2 screenResolution;

// Noise textures for cloud shapes and erosion
uniform sampler3D perlinworley;
uniform sampler3D worley;
// weather texture
uniform sampler2D weather;

// Light data
uniform vec3 lightDir;
uniform vec3 lightColor;

// Cloud evolution
uniform float time;
uniform float cloudType;
uniform float cloudSpeed;
uniform float coverageMultiplier;

// Cone sampling random offsets
uniform vec3 noiseKernel[6u] = vec3[] 
(
	vec3( 0.38051305,  0.92453449, -0.02111345),
	vec3(-0.50625799, -0.03590792, -0.86163418),
	vec3(-0.32509218, -0.94557439,  0.01428793),
	vec3( 0.09026238, -0.27376545,  0.95755165),
	vec3( 0.28128598,  0.42443639, -0.86065785),
	vec3(-0.16852403,  0.14748697,  0.97460106)
);

#define SPHERE_PROJECTION

// Cloud layer data
#ifdef SPHERE_PROJECTION
uniform vec3 sphereCenter = vec3(0,-1950,0);
uniform float sphereInnerRadius = 2000.0;
uniform float sphereOuterRadius = 2300.0;
#else
uniform vec3 planeMin = vec3(-2000, 30.0, -2000);
uniform vec3 planeMax = vec3(2000, 500.0, 2000);
vec2 planeDim = vec2(planeMax.xz - planeMin.xz);
#endif

// Cloud types height density gradients
#define STRATUS_GRADIENT vec4(0.0, 0.1, 0.2, 0.3)
#define STRATOCUMULUS_GRADIENT vec4(0.02, 0.2, 0.48, 0.625)
#define CUMULUS_GRADIENT vec4(0.01, 0.0625, 0.78, 1.0)

// ==========================================================================
// Lighting functions
float henyeyGreenstein(vec3 l, vec3 v, float g, float ca)
{
	float g2 = g * g;

	return ((1.0 - g2) / pow((1.0 + g2 - 2.0 * g * ca), 1.5 )) / 4.0 * 3.1415;
}

float beer(float density)
{
	return exp(-density);
}

float powder(float density, float ca)
{
	float f = 1.0 - exp(-density * 2.0);
	return mix(1.0, f, clamp(-ca * 0.5 + 0.5, 0.0, 1.0));
	return f;
}

float lightEnergy(vec3 l, vec3 v, float ca, float coneDensity, float realDensity)
{
	return 2.0 * beer(coneDensity) * powder(realDensity, ca) * (1.0/3.1415) * mix(henyeyGreenstein(l, v, 0.8, ca), henyeyGreenstein(l, v, -0.5, ca), 0.5);
}

vec3 ambientLight(float heightFrac)
{
	return mix(lightColor * 0.3, lightColor * 0.7, heightFrac);
}

// ==========================================================================
// Density functions

// Normalized height (0 - 1) within the cloud layer
float getHeightFraction(vec3 p)
{
#ifdef SPHERE_PROJECTION
	float y = p.y < 0.0? 1.0 - p.y : p.y;
	float fraction = fract(y / (0.5 * (sphereOuterRadius - sphereInnerRadius)) * 0.5 + 0.5);
#else
	float fraction = (p.y - planeMin.y) / (planeMax.y - planeMin.y);
#endif

	fraction = clamp(fraction, 0.0, 1.0);

	return fraction;
}

// Planar uv based on current point position and overall cloud layer size
vec2 getPlanarUV(vec3 p)
{
#ifdef SPHERE_PROJECTION
	return (p.xz - vec2(-sphereOuterRadius)) / (sphereOuterRadius * 2.0);
#else
	return (p.xz - planeMin.xz) / planeDim;
#endif
}

// Retrieves the weather data stored in the weather texture
vec3 getWeatherData(vec3 p)
{
	vec2 uv = getPlanarUV(p);
	return texture(weather, uv).rgb;
}

// Remap utility
float remapValue(float original, float oMin, float oMax, float nMin, float nMax)
{
	return nMin + ((original - oMin) / (oMax - oMin)) * (nMax - nMin);
}

// Retrieves the cloud density based on cloud type and weighting between default cloud models
float getDensityForCloud(float heightFraction, float cloudType)
{
	float stratusFactor = 1.0 - clamp(cloudType * 2.0, 0.0, 1.0);
	float stratoCumulusFactor = 1.0 - abs(cloudType - 0.5) * 2.0;
	float cumulusFactor = clamp(cloudType - 0.5, 0.0, 1.0) * 2.0;

	vec4 baseGradient = stratusFactor * STRATUS_GRADIENT + stratoCumulusFactor * STRATOCUMULUS_GRADIENT + cumulusFactor * CUMULUS_GRADIENT;

	// gradicent computation (see Siggraph 2017 Nubis-Decima talk)
	return remapValue(heightFraction, baseGradient.x, baseGradient.y, 0.0, 1.0) * remapValue(heightFraction, baseGradient.z, baseGradient.w, 1.0, 0.0);
}

float sampleCloudDensity(vec3 p, vec3 weatherData, float lod, bool expensive)
{
	// Position modifications
	vec3 wind = vec3(1,0.2,1);
	float cloudTopOffset = 50.0;
	float heightFraction = getHeightFraction (p);

	p += heightFraction * wind * cloudTopOffset;
	p += wind * time * cloudSpeed;

	// Apply uv (xz) scale to keep clouds un-stretched based on cloud layer thickness
#ifdef SPHERE_PROJECTION
	float hScale = sphereOuterRadius * 2.0;
	float vScale = sphereOuterRadius - sphereInnerRadius;
#else
	float hScale = planeMax.x - planeMin.x;
	float vScale = planeMax.y - planeMin.y;
#endif
	float uvScale = hScale / vScale;

	// Sample base cloud shape noises (Perlin-Worley + 3 Worley)
	vec2 uv = getPlanarUV(p) * uvScale;
	vec3 tex3dsample = vec3(uv, heightFraction);
	vec4 baseCloudNoise = textureLod(perlinworley, tex3dsample, lod);
	
	// Build the low frequency fbm modifier
	float lowFreqFBM = ( baseCloudNoise.g * 0.625) + ( baseCloudNoise.b * 0.25 ) + ( baseCloudNoise.a * 0.125 );
	float baseCloudShape = remapValue(baseCloudNoise.r, -(1.0 - lowFreqFBM), 1.0, 0.0, 1.0);

	// Apply density gradient based on cloud type
	float densityGradient = getDensityForCloud(heightFraction, cloudType);
	baseCloudShape *= densityGradient / heightFraction;

	// Apply coverage
	float coverageStart = weatherData.r;
	float coverageEnd = weatherData.g;
	float coverageV = mix(coverageStart, 0.0, heightFraction);
	float coverage = coverageV * coverageMultiplier;
	//coverage = pow(coverage, remapValue(heightFraction, 0.7, 0.8, 1.0, mix(1.0, 0.5, 1.0)));
	float coveragedCloud = remapValue(baseCloudShape, coverage, 1.0, 0.0, 1.0);
	coveragedCloud *= coverage;

	float finalCloud = coveragedCloud;

	if(expensive)
	{
		// Build−high frequency Worley noise FBM.
		vec3 erodeCloudNoise = textureLod(worley, vec3(uv, heightFraction) * 0.05, lod).rgb;
		float highFreqFBM = (erodeCloudNoise.r * 0.625) + (erodeCloudNoise.g * 0.25) + (erodeCloudNoise.b * 0.125);

		heightFraction = getHeightFraction(p);
		float highFreqNoiseModifier = mix(highFreqFBM, 1.0 - highFreqFBM, clamp(heightFraction * 10.0, 0.0, 1.0));

		coveragedCloud = coveragedCloud - highFreqNoiseModifier;// * (1.0 - coveragedCloud);

		finalCloud = remapValue(coveragedCloud, highFreqNoiseModifier * 0.2, 1.0, 0.0, 1.0);
	}

	return clamp(finalCloud, 0.0, 1.0);
}

// ==========================================================================
// Raymarchers

float raymarchToLight(vec3 pos, vec3 d, float stepSize)
{
	vec3 normLightDir = normalize(lightDir);
	vec3 startPos = pos;
	vec3 rayStep = normLightDir * stepSize;
	float coneRadius = 1.0;
	float coneStep = 1.0/6.0;
	float density = 0.0;
	float coneDensity = 0.0;
	float rcpThickness = 1.0 / (stepSize * 6);

	// Light raymarchToLight
	// 6 close samples
	for(int i = 0; i < 6; i++)
	{
		vec3 posInCone = startPos + coneRadius * noiseKernel[i] * float(i);
		float heightFraction = getHeightFraction(posInCone);
		if(heightFraction <= 1.0)
		{
			// sample the expensive way if we hare near borders (where density is low, like 0.3 or below)
			float cloudDensity = sampleCloudDensity(posInCone, getWeatherData(posInCone), float(i + 1), coneDensity < 0.3);
			if(cloudDensity > 0.0)
			{
				density += cloudDensity;
				float transmittance = 1.0 - (density * rcpThickness);
				coneDensity += (cloudDensity * transmittance);
			}
		}

		startPos += rayStep;
		coneRadius += coneStep;
	}

	// 1 far sample for shadowing
	pos += (rayStep * 8.0);
	float heightFraction = getHeightFraction(pos);
	if(heightFraction <= 1.0)
	{
		float cloudDensity = sampleCloudDensity(pos, getWeatherData(pos), 6.0, false);
		if(cloudDensity > 0.0)
		{
			density += cloudDensity;
			float transmittance = 1.0 - clamp(density * rcpThickness, 0.0, 1.0);
			coneDensity += (cloudDensity * transmittance);
		}
	}

	float ca = dot(normLightDir, d);

	// Compute light energy arriving at point
	return lightEnergy(normLightDir, d, ca, coneDensity, density);
}

float frontToBackRaymarch(vec3 startPos, vec3 endPos, out vec3 color)
{
	vec3 dir = endPos - startPos;
	float density = 0.0;
	float thick = length(dir);
	float rcpThick = 1.0 / thick;

#ifdef SPHERE_PROJECTION
	float delta = sphereOuterRadius - sphereInnerRadius;
#else
	float delta = planeMax.y - planeMin.y;
#endif

	int sampleCount = int(ceil(mix(64.0, 128.0, clamp(thick / delta, 0.0, 1.0))));

	// Light color attenuation based on sun's position
	vec3 lc = lightColor * (clamp(dot(vec3(0,1,0), normalize(lightDir)), 0.0, 1.0) + 0.01);

	vec3 pos = startPos;
	vec3 st = dir / float(sampleCount - 1);
	float stepSize = length(st);
	vec3 viewDir = normalize(dir);

	vec4 result = vec4(0.0);

	for(int i = 0; i < sampleCount; i++)
	{
		float cloudDensity = sampleCloudDensity(pos, getWeatherData(pos), 0.0, true); // SAMPLE CLOUD textureSamples

		if(cloudDensity > 0.0)	// IF WE HAVE DENSITY, LAUNCH LIGHT SAMPLING
		{
			density += cloudDensity;
			float lightEnergy = raymarchToLight(pos, viewDir, stepSize); // SAMPLE LIGHT

			float height = getHeightFraction(pos);
			vec4 src = vec4(lightColor * 0.7 * lightEnergy + ambientLight(height), cloudDensity); // ACCUMULATE 
			src.rgb *= src.a;
			result = (1.0 - result.a) * src + result;

			if(result.a >= 1.0) // EARLY EXIT ON FULL OPACITY
				break;
		}

		pos += st;
	}

	// Return alpha (density) and store final color
	color = result.xyz;
	return result.a;
}

// ==========================================================================
// Collision detection
#ifdef SPHERE_PROJECTION
bool intersectSphere(vec3 o, vec3 d, out vec3 minT, out vec3 maxT)
{
	// Intersect inner sphere
	vec3 sphereToOrigin = o - sphereCenter;
	float b = dot(d, sphereToOrigin);
	float c = dot(sphereToOrigin, sphereToOrigin);
	float sqrtOpInner = b*b - (c - sphereInnerRadius*sphereInnerRadius);

	// No solution (we are outside the sphere, looking away from it)
	if(sqrtOpInner < 0.0)
	{
		return false;
	}

	float deInner = sqrt(sqrtOpInner);
	float solAInner = -b - deInner;
	float solBInner = -b + deInner;

	float maxSInner = max(solAInner, solBInner);
	maxSInner = maxSInner < 0.0? 0.0 : maxSInner;

	// Intersect outer sphere
	float sqrtOpOuter = b*b - (c - sphereOuterRadius*sphereOuterRadius);

	// No solution - same as inner sphere
	if(sqrtOpOuter < 0.0)
	{
		return false;
	}
	
	float deOuter = sqrt(sqrtOpOuter);
	float solAOuter = -b - deOuter;
	float solBOuter = -b + deOuter;

	float maxSOuter = max(solAOuter, solBOuter);
	maxSOuter = maxSOuter < 0.0? 0.0 : maxSOuter;

	// Compute entering and exiting ray points
	float minSol = min(maxSInner, maxSOuter);
	float maxSol = max(maxSInner, maxSOuter);

	minT = o + d * minSol;
	maxT = o + d * maxSol;

	return minT.y > -100.0; // only above the horizon
}
#else 
bool intersectBox(vec3 o, vec3 d, out vec3 minT, out vec3 maxT)
{
	// compute intersection of ray with all six bbox planes
	vec3 invR = 1.0 / d;
	vec3 tbot = invR * (planeMin - o);
	vec3 ttop = invR * (planeMax - o);
	// re-order intersections to find smallest and largest on each axis
	vec3 tmin = min (ttop, tbot);
	vec3 tmax = max (ttop, tbot);
	// find the largest tmin and the smallest tmax
	vec2 t0 = max (tmin.xx, tmin.yz);
	float tnear = max (t0.x, t0.y);
	t0 = min (tmax.xx, tmax.yz);
	float tfar = min (t0.x, t0.y);
	
	// check for hit
	bool hit;
	if ((tnear > tfar) || tfar < 0.0)
		hit = false;
	else
		hit = true;

	minT = tnear < 0.0? o : o + d * tnear; // if we are inside the bb, start point is cam pos
	maxT = o + d * tfar;

	return hit;
}
#endif

void main()
{
	// Ray direction
	float ar = screenResolution.x / screenResolution.y;
	vec2 fulluv = texCoord * vec2(ar, 1.0) * 2.0 - 1.0;
	float z = ar / tan(radians(45.0));
	vec3 viewDir = normalize(vec3(fulluv, -z));
	vec3 worldDir = normalize( (invView * vec4(viewDir, 0)).xyz);
	// Volume intersection points
	vec3 startPos, endPos;

#ifdef SPHERE_PROJECTION
	bool intersect = intersectSphere(camPos, worldDir, startPos, endPos);
#else
	bool intersect = intersectBox(camPos, worldDir, startPos, endPos);
#endif
	
	if(intersect)
	{
		vec3 outColor;
		float density = frontToBackRaymarch(startPos, endPos, outColor);
		density = clamp(density, 0.0, 1.0);
		
		color = vec4(outColor, density);
		emission = vec4(0,0,0,0);
		gl_FragDepth = 0.999; // behind everything, but in front of the cubemap
	}
	else
	{
		discard;
	}
}