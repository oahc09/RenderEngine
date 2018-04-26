#pragma once

#include "PostProcessProgram.h"

namespace Engine
{
	class SSAAProgram : public PostProcessProgram
	{
	public:
		static std::string PROGRAM_NAME;
	private:
		unsigned int uTexelSize;
	public:
		SSAAProgram(std::string name, unsigned long long params);
		SSAAProgram(const SSAAProgram & other);
		~SSAAProgram();

		void configureProgram();
		void onRenderObject(const Object * obj, const glm::mat4 & view, const glm::mat4 &proj);
	};

	class SSAAProgramFactory : public ProgramFactory
	{
	protected:
		Program * createProgram(unsigned long long parameters);
	};
}