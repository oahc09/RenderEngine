#version 430 core

layout (location=0) out vec4 outColor;
layout (location=1) out vec4 outDepth;
layout (location=2) out vec4 outEmission;

in vec2 texCoord;

uniform sampler2D postProcessing_0; // color
uniform sampler2D postProcessing_1; // normal
uniform sampler2D postProcessing_2; // specular
uniform sampler2D postProcessing_3; // emissive
uniform sampler2D postProcessing_4; // pos
uniform sampler2D postProcessing_5; // depth

// ===============================================
// back ground color, used for fog effect
uniform vec3 backgroundColor;

uniform mat4 projMat;
uniform mat4 viewMat;
uniform vec3 cameraPos;

// Different lights data

uniform int numSpotLights;
uniform int numPointLights;

layout(std140, binding = 0) uniform DLBuffer
{
	vec4 DLdirection [];
	vec4 DLcolor [];
	vec4 DLkFactors [];
};

/*
layout(std140, binding = 1) uniform SLBuffer
{
	vec4 SLposition [];
	vec4 SLdirection [];
	vec4 SLcolor [];
	vec4 SLattenuation [];
	vec4 SLkFactors [];
};

layout(std140, binding = 2) uniform PLBuffer
{
	vec4 PLposition [];
	vec4 PLcolor [];
	vec4 PLattenuation [];
	vec4 PLkFactors [];
};
*/

// Objects properties to be used across shading fuctions
vec3 pos;
float distToCam;
vec3 Ka;
vec3 Kd;
vec3 Ks;
vec3 Ke;
vec3 N;
float depth;
float alpha = 100.0;
float colorFactor;

// ================================================================================
// SHADING FUNCTIONALITY
vec3 processDirectionalLight(in float visibility)
{
	colorFactor = clamp(dot(vec3(0,1,0), -DLdirection[0].xyz), 0.25, 1.0);
	vec3 c = vec3(0,0,0);

	vec3 L = DLdirection[0].xyz;
	vec3 lightColor = DLcolor[0].rgb;
	vec3 Kfactors = DLkFactors[0].xyz;

	// Ambient
	c += lightColor * Kfactors.x * Ka;

	// Diffuse
	c += (lightColor * Kfactors.y * Kd * max(dot(N,L), 0)) * visibility;

	// Specular
	vec3 R = normalize(reflect(-L, N));
	vec3 V = normalize(-pos);
	float sFactor = max(dot(R, V), 0.01);
	c += lightColor * Kfactors.z * Ks * pow(sFactor, alpha) * visibility;

	return c;
}

vec3 processAtmosphericFog(in vec3 shadedColor)
{
	float d = length(pos);
	float lerpVal = 1 / exp(0.0025 * d * d);
	
	return mix(backgroundColor * colorFactor, shadedColor, lerpVal);
}

// ================================================================================
// REFLECTION FUNCTIONALITY

vec3 raymarch(vec3 position, vec3 direction)
{
	vec3 PrevRaySample, RaySample;
	for (int RayStepIdx = 0; RayStepIdx < 16; RayStepIdx++)
	{
		PrevRaySample = RaySample;
		RaySample = (RayStepIdx * 0.02) * direction + position;
		float ZBufferVal = texture(postProcessing_5, RaySample.xy).x;
				
		if (RaySample.z > ZBufferVal )
		{
			vec3 MinRaySample = PrevRaySample;
			vec3 MaxRaySample = RaySample;
			vec3 MidRaySample;
			for (int i = 0; i < 6; i++)
			{
				MidRaySample = mix(MinRaySample, MaxRaySample, 0.5);
				float ZBufferVal = texture(postProcessing_5, MidRaySample.xy).x;

				if (MidRaySample.z > ZBufferVal)
					MaxRaySample = MidRaySample;
				else
					MinRaySample = MidRaySample;
			}

			return texture(postProcessing_0, MidRaySample.xy).rgb;
		}
	}

	return vec3(1,1,1);
}

vec3 computeReflectionColor()
{
	vec3 ssPos = vec3(texCoord, depth);

	vec3 camReflect = reflect(-pos, N);

	vec3 pointAlongRefl = camReflect * 10.0 + pos;
	vec4 projPointAlong = projMat * vec4(pointAlongRefl, 1);
	projPointAlong /= projPointAlong.w;
	projPointAlong.xy = projPointAlong.xy * vec2(0.5, 0.5) + vec2(0.5, 0.5);

	vec3 ssreflectdir = normalize(projPointAlong.xyz - ssPos);

	return raymarch(ssPos, ssreflectdir);
}

// ================================================================================

void main()
{
	vec4 gbufferemissive = texture(postProcessing_3, texCoord);
	vec4 gbuffernormal = texture(postProcessing_1, texCoord);
	vec4 gbufferspec = texture(postProcessing_2, texCoord);
	vec4 gbufferpos = texture(postProcessing_4, texCoord);
	depth = texture(postProcessing_5, texCoord).x;
	vec4 gbuffercolor = texture(postProcessing_0,  texCoord);

	distToCam = gbufferpos.w;
	N = gbuffernormal.xyz;
	pos = gbufferpos.xyz;

	// REFRACTION
	float camFactor = max(distToCam, 1);
	vec3 realColor = gbufferspec.w > 0? texture(postProcessing_0, texCoord + normalize(gbuffernormal.xz) * 0.01 / camFactor).rgb * gbuffercolor.rgb : gbuffercolor.rgb;

	// REFLECTION
	realColor = gbufferspec.w > 0? computeReflectionColor() * realColor : realColor;

	
	Ka = realColor;
	Kd = Ka;
	Ks = gbufferspec.xyz;
	Ke = gbufferemissive.xyz;

	vec3 shaded = processDirectionalLight(gbuffercolor.w);
	shaded = processAtmosphericFog(shaded);

	outColor = vec4(shaded, 1.0);
	outDepth = vec4(depth, 0, 0, 1);
	outEmission = gbufferemissive;
	gl_FragDepth = depth;
}