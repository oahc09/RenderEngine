/*
* @author Nadir Rom�n Guerrero
* @email nadir.ro.gue@gmail.com
*/

#pragma once

#include <glm\glm.hpp>
#include <string>

namespace Engine
{
	// Parent class of all of the classes which represent a light.
	// Represent a common interface between different light types
	class Light
	{
	private:
		bool enabled;
		std::string name;
		// Lights are stored in GPU as uniform buffer objects
		// This variable holds the buffer id
		unsigned int bufferIndex;
	protected:
		glm::mat4 modelMatrix;
		bool update;
	public:
		Light(std::string name);
		~Light();

		const std::string & getName() const;

		void setEnabled(bool val);
		const bool isEnabled() const;

		virtual void setColor(const glm::vec3 & color) = 0;
		virtual void setKa(float a) = 0;
		virtual void setKd(float d) = 0;
		virtual void setKs(float s) = 0;

		virtual void translate(const glm::vec3 & translation) = 0;

		const glm::mat4 & getModelMatrix() const;

		// Returns wether the uniform buffer object should be updated or not
		bool requiresUpdate();
		// Clears the udpate flag
		void clearUpdateFlag();

		void setBufferIndex(unsigned int bi);
		unsigned int getBufferIndex();
	};
}