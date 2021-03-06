#include "postprocessprograms/SSGodRayProgram.h"

#include "WorldConfig.h"

#include <iostream>

const std::string Engine::SSGodRayProgram::PROGRAM_NAME = "SSGodRayProgram";

Engine::SSGodRayProgram::SSGodRayProgram(std::string name, unsigned long long params)
	:Engine::PostProcessProgram(name, params)
{
	fShaderFile = "shaders/postprocess/SSGodRays.frag";
}

Engine::SSGodRayProgram::SSGodRayProgram(const Engine::SSGodRayProgram & other)
	: Engine::PostProcessProgram(other)
{
	uLightScreenPos = other.uLightScreenPos;
	uWeight = other.uWeight;
	uDecay = other.uDecay;
	uDensity = other.uDensity;
	uExposure = other.uExposure;
	uOnlyPass = other.uOnlyPass;
}

void Engine::SSGodRayProgram::configureProgram()
{
	Engine::PostProcessProgram::configureProgram();

	uLightScreenPos = glGetUniformLocation(glProgram, "lightScreenPos");
	uWeight = glGetUniformLocation(glProgram, "weight");
	uExposure = glGetUniformLocation(glProgram, "exposure");
	uDensity = glGetUniformLocation(glProgram, "density");
	uDecay = glGetUniformLocation(glProgram, "decay");
	uOnlyPass = glGetUniformLocation(glProgram, "onlyPass");
	uAlpha = glGetUniformLocation(glProgram, "alpha");
}

void Engine::SSGodRayProgram::onRenderObject(const Engine::Object * obj, Engine::Camera * cam)
{
	Engine::PostProcessProgram::onRenderObject(obj, cam);

	// Project light position on screen
	glm::vec4 lightDir = glm::vec4(-cam->getPosition() + Engine::Settings::lightDirection * 20.0f, 1.0);
	lightDir = cam->getProjectionMatrix() * cam->getViewMatrix() * lightDir;
	lightDir /= lightDir.w;
	lightDir = lightDir * 0.5f + 0.5f;

	// Its a screen space effect based on sun position on screen. When its offscreen, it produces artifacts
	// make sure we only apply when its ok (with a little margin)
	bool outScreen = lightDir.z > 1.f || lightDir.x < -2.f || lightDir.x > 3.f || lightDir.y < -2.f || lightDir.y > 3.f;

	glUniform1i(uOnlyPass, outScreen);
	glUniform2fv(uLightScreenPos, 1, &lightDir[0]);

	// Send tweakable data
	glUniform1f(uWeight, Engine::Settings::godRaysWeight);
	glUniform1f(uExposure, Engine::Settings::godRaysExposure);
	glUniform1f(uDensity, Engine::Settings::godRaysDensity);
	glUniform1f(uDecay, Engine::Settings::godRaysDecay);
}

// ==========================================================================

Engine::Program * Engine::SSGodRayProgramFactory::createProgram(unsigned long long params)
{
	Engine::SSGodRayProgram * prog = new Engine::SSGodRayProgram(Engine::SSGodRayProgram::PROGRAM_NAME, params);
	prog->initialize();
	return prog;
}