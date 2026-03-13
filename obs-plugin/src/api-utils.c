/*
 * OpenClip OBS Plugin — API Utilities
 *
 * Common utility functions used by all API handlers.
 */

#include "api-utils.h"

#include <obs-module.h>
#include <obs-frontend-api.h>
#include <obs.h>
#include <cJSON.h>

#include <string.h>

/* ── Response builders ─────────────────────────────────────────────────────── */

cJSON *ok(cJSON *data)
{
	cJSON *r = cJSON_CreateObject();
	cJSON_AddBoolToObject(r, "success", 1);
	if (data)
		cJSON_AddItemToObject(r, "data", data);
	else
		cJSON_AddNullToObject(r, "data");
	return r;
}

cJSON *err(const char *msg)
{
	cJSON *r = cJSON_CreateObject();
	cJSON_AddBoolToObject(r, "success", 0);
	cJSON_AddStringToObject(r, "error", msg ? msg : "Unknown error");
	return r;
}

/* ── JSON accessors ────────────────────────────────────────────────────────── */

const char *jstr(const cJSON *obj, const char *key)
{
	const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
	return (cJSON_IsString(item) && item->valuestring[0])
		       ? item->valuestring
		       : NULL;
}

int jint(const cJSON *obj, const char *key, int def)
{
	const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
	return cJSON_IsNumber(item) ? item->valueint : def;
}

bool jbool(const cJSON *obj, const char *key, bool def)
{
	const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
	if (cJSON_IsBool(item))
		return cJSON_IsTrue(item);
	return def;
}

int64_t jint64(const cJSON *obj, const char *key, int64_t def)
{
	const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
	return cJSON_IsNumber(item) ? (int64_t)item->valuedouble : def;
}

/* ── Audio kind check ──────────────────────────────────────────────────────── */

bool is_audio_input_kind(const char *id)
{
	if (!id)
		return false;
	return strcmp(id, "wasapi_output_capture") == 0 ||
	       strcmp(id, "wasapi_input_capture") == 0 ||
	       strcmp(id, "wasapi_process_output_capture") == 0 ||
	       strcmp(id, "coreaudio_input_capture") == 0 ||
	       strcmp(id, "coreaudio_output_capture") == 0 ||
	       strcmp(id, "pulse_input_capture") == 0 ||
	       strcmp(id, "pulse_output_capture") == 0;
}

/* ── Find a scene source by name ──────────────────────────────────────────── */

obs_source_t *find_scene_source(const char *name)
{
	if (!name)
		return NULL;

	struct obs_frontend_source_list scenes = {0};
	obs_frontend_get_scenes(&scenes);
	obs_source_t *found = NULL;
	for (size_t i = 0; i < scenes.sources.num; i++) {
		obs_source_t *s = scenes.sources.array[i];
		const char *n = obs_source_get_name(s);
		if (n && strcmp(n, name) == 0) {
			found = obs_source_get_ref(s);
			break;
		}
	}
	obs_frontend_source_list_free(&scenes);
	return found;
}

/* ── Fit a scene item to the canvas ───────────────────────────────────────── */

void fit_item_to_canvas(obs_sceneitem_t *item)
{
	struct obs_video_info ovi;
	if (!obs_get_video_info(&ovi))
		return;

	struct vec2 pos = {0.0f, 0.0f};
	obs_sceneitem_set_pos(item, &pos);
	obs_sceneitem_set_alignment(item, OBS_ALIGN_LEFT | OBS_ALIGN_TOP);
	obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_SCALE_INNER);
	obs_sceneitem_set_bounds_alignment(item, OBS_ALIGN_CENTER);

	struct vec2 bounds;
	bounds.x = (float)ovi.base_width;
	bounds.y = (float)ovi.base_height;
	obs_sceneitem_set_bounds(item, &bounds);
}
