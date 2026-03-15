/*
 * OpenClip OBS Plugin — Video Handlers
 */

#include "video-handlers.h"
#include "api-utils.h"

#include <obs.h>

cJSON *h_get_video_settings(const cJSON *p)
{
	(void)p;
	struct obs_video_info ovi;
	if (!obs_get_video_info(&ovi))
		return err("Video subsystem not initialized");

	cJSON *data = cJSON_CreateObject();
	if (!data)
		return err("Failed to allocate response");
	cJSON_AddNumberToObject(data, "baseWidth", ovi.base_width);
	cJSON_AddNumberToObject(data, "baseHeight", ovi.base_height);
	cJSON_AddNumberToObject(data, "outputWidth", ovi.output_width);
	cJSON_AddNumberToObject(data, "outputHeight", ovi.output_height);
	cJSON_AddNumberToObject(data, "fpsNum", ovi.fps_num);
	cJSON_AddNumberToObject(data, "fpsDen", ovi.fps_den);
	return ok(data);
}
