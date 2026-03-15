/*
 * OpenClip OBS Plugin — Recording Handlers
 */

#include "recording-handlers.h"
#include "api-utils.h"

#include <obs-frontend-api.h>
#include <obs.h>
#include <obs-module.h>

#ifndef OPENCLIP_OBS_VERSION
#define OPENCLIP_OBS_VERSION "1.0.0"
#endif

cJSON *h_get_status(const cJSON *p)
{
	(void)p;
	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "pluginVersion", OPENCLIP_OBS_VERSION);
	cJSON_AddStringToObject(data, "obsVersion", obs_get_version_string());
	cJSON_AddBoolToObject(data, "recording", obs_frontend_recording_active());
	return ok(data);
}

cJSON *h_start_recording(const cJSON *p)
{
	if (obs_frontend_recording_active())
		return err("Already recording");

	const char *scene_name = p ? jstr(p, "sceneName") : NULL;

	if (scene_name && scene_name[0]) {
		obs_source_t *target = find_scene_source(scene_name);
		if (target) {
			obs_frontend_set_current_scene(target);
			obs_source_release(target);
		} else {
			blog(LOG_WARNING, "[openclip] Scene not found: %s", scene_name);
		}
	}

	obs_frontend_recording_start();

	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "recording", 1);
	return ok(data);
}

cJSON *h_stop_recording(const cJSON *p)
{
	(void)p;
	if (!obs_frontend_recording_active())
		return err("Not recording");

	obs_frontend_recording_stop();

	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "recording", 0);
	return ok(data);
}

cJSON *h_get_recording_status(const cJSON *p)
{
	(void)p;
	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "recording", obs_frontend_recording_active());
	return ok(data);
}
