/*
 * OpenClip OBS Plugin — Audio Handlers
 */

#include "audio-handlers.h"
#include "api-utils.h"

#include <obs-frontend-api.h>
#include <obs.h>

#include <inttypes.h>
#include <string.h>

struct audio_enum_ctx {
	cJSON *arr;
};

static bool enum_audio_cb(void *param, obs_source_t *source)
{
	struct audio_enum_ctx *ctx = param;
	const char *id = obs_source_get_id(source);
	if (!is_audio_input_kind(id))
		return true;

	cJSON *obj = cJSON_CreateObject();
	cJSON_AddStringToObject(obj, "inputName", obs_source_get_name(source));
	cJSON_AddStringToObject(obj, "inputKind", id);
	cJSON_AddItemToArray(ctx->arr, obj);
	return true;
}

struct scene_audio_ctx {
	cJSON *arr;
};

static bool enum_scene_audio_cb(obs_scene_t *scene, obs_sceneitem_t *item, void *param)
{
	(void)scene;
	struct scene_audio_ctx *ctx = param;
	obs_source_t *src = obs_sceneitem_get_source(item);
	if (!src)
		return true;

	const char *kind = obs_source_get_id(src);
	if (!is_audio_input_kind(kind))
		return true;

	cJSON *obj = cJSON_CreateObject();
	cJSON_AddStringToObject(obj, "inputName", obs_source_get_name(src));
	cJSON_AddStringToObject(obj, "inputKind", kind);
	char id_str[32];
	snprintf(id_str, sizeof(id_str), "%" PRIi64, obs_sceneitem_get_id(item));
	cJSON_AddStringToObject(obj, "sceneItemId", id_str);
	cJSON_AddItemToArray(ctx->arr, obj);
	return true;
}

cJSON *h_get_audio_inputs(const cJSON *p)
{
	(void)p;
	struct audio_enum_ctx ctx;
	ctx.arr = cJSON_CreateArray();
	obs_enum_sources(enum_audio_cb, &ctx);
	return ok(ctx.arr);
}

cJSON *h_get_scene_audio_sources(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *src = find_scene_source(name);
	if (!src)
		return ok(cJSON_CreateArray());

	obs_scene_t *scene = obs_scene_from_source(src);
	struct scene_audio_ctx ctx;
	ctx.arr = cJSON_CreateArray();
	if (scene)
		obs_scene_enum_items(scene, enum_scene_audio_cb, &ctx);

	obs_source_release(src);
	return ok(ctx.arr);
}

cJSON *h_get_input_audio_tracks(const cJSON *p)
{
	const char *input_name = p ? jstr(p, "inputName") : NULL;
	if (!input_name)
		return err("inputName is required");

	obs_source_t *src = obs_get_source_by_name(input_name);
	if (!src)
		return err("Input not found");

	uint32_t mixers = obs_source_get_audio_mixers(src);
	obs_source_release(src);

	cJSON *tracks = cJSON_CreateObject();
	for (int i = 1; i <= 6; i++) {
		char key[4];
		snprintf(key, sizeof(key), "%d", i);
		cJSON_AddBoolToObject(tracks, key, (mixers >> (i - 1)) & 1);
	}
	return ok(tracks);
}

cJSON *h_set_input_audio_tracks(const cJSON *p)
{
	const char *input_name = p ? jstr(p, "inputName") : NULL;
	const cJSON *tracks = p ? cJSON_GetObjectItemCaseSensitive(p, "tracks") : NULL;
	if (!input_name || !cJSON_IsObject(tracks))
		return err("inputName and tracks are required");

	obs_source_t *src = obs_get_source_by_name(input_name);
	if (!src)
		return err("Input not found");

	uint32_t mixers = obs_source_get_audio_mixers(src);

	for (int i = 1; i <= 6; i++) {
		char key[4];
		snprintf(key, sizeof(key), "%d", i);
		const cJSON *val = cJSON_GetObjectItemCaseSensitive(tracks, key);
		if (cJSON_IsBool(val)) {
			if (cJSON_IsTrue(val))
				mixers |= (1u << (i - 1));
			else
				mixers &= ~(1u << (i - 1));
		}
	}

	obs_source_set_audio_mixers(src, mixers);
	obs_source_release(src);

	return ok(cJSON_CreateTrue());
}

cJSON *h_get_track_names(const cJSON *p)
{
	(void)p;
	config_t *config = obs_frontend_get_profile_config();
	cJSON *names = cJSON_CreateArray();

	for (int i = 1; i <= 6; i++) {
		char key[32];
		snprintf(key, sizeof(key), "Track%dName", i);

		const char *val = NULL;
		if (config) {
			val = config_get_string(config, "AdvOut", key);
			if (!val || !val[0])
				val = config_get_string(config, "SimpleOutput", key);
		}

		if (val && val[0]) {
			cJSON_AddItemToArray(names, cJSON_CreateString(val));
		} else {
			char def[16];
			snprintf(def, sizeof(def), "Track %d", i);
			cJSON_AddItemToArray(names, cJSON_CreateString(def));
		}
	}
	return ok(names);
}

cJSON *h_set_track_names(const cJSON *p)
{
	const cJSON *names = p ? cJSON_GetObjectItemCaseSensitive(p, "names") : NULL;
	if (!cJSON_IsArray(names))
		return err("names array is required");

	config_t *config = obs_frontend_get_profile_config();
	if (!config)
		return err("No active profile config");

	int i = 0;
	const cJSON *item = NULL;
	cJSON_ArrayForEach(item, names) {
		if (i >= 6)
			break;
		char key[32];
		snprintf(key, sizeof(key), "Track%dName", i + 1);

		const char *val = cJSON_IsString(item) ? item->valuestring : "";
		config_set_string(config, "AdvOut", key, val);
		config_set_string(config, "SimpleOutput", key, val);
		i++;
	}

	config_save(config);
	return ok(cJSON_CreateTrue());
}
