/*
 * OpenClip OBS Plugin — Source Handlers
 */

#include "source-handlers.h"
#include "api-utils.h"

#include <obs-frontend-api.h>
#include <obs.h>

#include <limits.h>
#include <string.h>

cJSON *h_add_source(const cJSON *p)
{
	const char *scene_name = p ? jstr(p, "sceneName") : NULL;
	const char *input_name = p ? jstr(p, "inputName") : NULL;
	const char *input_kind = p ? jstr(p, "inputKind") : NULL;
	if (!scene_name || !input_name || !input_kind)
		return err("sceneName, inputName, and inputKind are required");

	obs_source_t *scene_src = find_scene_source(scene_name);
	if (!scene_src)
		return err("Scene not found");

	obs_scene_t *scene = obs_scene_from_source(scene_src);
	if (!scene) {
		obs_source_release(scene_src);
		return err("Not a valid scene");
	}

	obs_data_t *settings = obs_data_create();
	const cJSON *input_settings = p ? cJSON_GetObjectItemCaseSensitive(p, "inputSettings") : NULL;
	if (cJSON_IsObject(input_settings)) {
		const cJSON *item = NULL;
		cJSON_ArrayForEach(item, input_settings) {
			if (cJSON_IsString(item))
				obs_data_set_string(settings, item->string, item->valuestring);
			else if (cJSON_IsNumber(item)) {
				if (item->valuedouble >= (double)LLONG_MIN &&
				    item->valuedouble <= (double)LLONG_MAX &&
				    item->valuedouble == (long long)item->valuedouble)
					obs_data_set_int(settings, item->string, (long long)item->valuedouble);
				else
					obs_data_set_double(settings, item->string, item->valuedouble);
			} else if (cJSON_IsBool(item))
				obs_data_set_bool(settings, item->string, cJSON_IsTrue(item));
		}
	}

	obs_source_t *src = obs_get_source_by_name(input_name);
	bool created = false;
	if (!src) {
		src = obs_source_create(input_kind, input_name, settings, NULL);
		created = true;
	}
	obs_data_release(settings);

	if (!src) {
		obs_source_release(scene_src);
		return err("Failed to create input source");
	}

	obs_sceneitem_t *item = obs_scene_add(scene, src);
	bool fit = p ? jbool(p, "fitToCanvas", false) : false;
	if (item && fit)
		fit_item_to_canvas(item);

	if (created)
		obs_source_release(src);
	else
		obs_source_release(src);

	obs_source_release(scene_src);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "added", item != NULL);
	cJSON_AddNumberToObject(data, "sceneItemId",
				item ? (double)obs_sceneitem_get_id(item) : -1);
	return ok(data);
}

cJSON *h_remove_scene_item(const cJSON *p)
{
	const char *scene_name = p ? jstr(p, "sceneName") : NULL;
	int item_id = p ? jint(p, "sceneItemId", -1) : -1;
	if (!scene_name || item_id < 0)
		return err("sceneName and sceneItemId are required");

	obs_source_t *scene_src = find_scene_source(scene_name);
	if (!scene_src)
		return err("Scene not found");

	obs_scene_t *scene = obs_scene_from_source(scene_src);
	if (!scene) {
		obs_source_release(scene_src);
		return err("Not a valid scene");
	}

	obs_sceneitem_t *item = obs_scene_find_sceneitem_by_id(scene, item_id);
	if (item)
		obs_sceneitem_remove(item);

	obs_source_release(scene_src);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "removed", item != NULL);
	return ok(data);
}

cJSON *h_set_item_transform(const cJSON *p)
{
	const char *scene_name = p ? jstr(p, "sceneName") : NULL;
	int item_id = p ? jint(p, "sceneItemId", -1) : -1;
	if (!scene_name || item_id < 0)
		return err("sceneName and sceneItemId are required");

	obs_source_t *scene_src = find_scene_source(scene_name);
	if (!scene_src)
		return err("Scene not found");

	obs_scene_t *scene = obs_scene_from_source(scene_src);
	if (!scene) {
		obs_source_release(scene_src);
		return err("Not a valid scene");
	}

	obs_sceneitem_t *item = obs_scene_find_sceneitem_by_id(scene, item_id);
	if (!item) {
		obs_source_release(scene_src);
		return err("Scene item not found");
	}

	const cJSON *transform = p ? cJSON_GetObjectItemCaseSensitive(p, "transform") : NULL;
	if (cJSON_IsObject(transform)) {
		const cJSON *btype = cJSON_GetObjectItemCaseSensitive(transform, "boundsType");
		if (cJSON_IsString(btype)) {
			if (strcmp(btype->valuestring, "OBS_BOUNDS_SCALE_INNER") == 0)
				obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_SCALE_INNER);
			else if (strcmp(btype->valuestring, "OBS_BOUNDS_STRETCH") == 0)
				obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_STRETCH);
		}

		const cJSON *px = cJSON_GetObjectItemCaseSensitive(transform, "positionX");
		const cJSON *py = cJSON_GetObjectItemCaseSensitive(transform, "positionY");
		if (cJSON_IsNumber(px) && cJSON_IsNumber(py)) {
			struct vec2 pos;
			pos.x = (float)px->valuedouble;
			pos.y = (float)py->valuedouble;
			obs_sceneitem_set_pos(item, &pos);
		}

		const cJSON *bw = cJSON_GetObjectItemCaseSensitive(transform, "boundsWidth");
		const cJSON *bh = cJSON_GetObjectItemCaseSensitive(transform, "boundsHeight");
		if (cJSON_IsNumber(bw) && cJSON_IsNumber(bh)) {
			struct vec2 bounds;
			bounds.x = (float)bw->valuedouble;
			bounds.y = (float)bh->valuedouble;
			obs_sceneitem_set_bounds(item, &bounds);
		}

		const cJSON *alignment = cJSON_GetObjectItemCaseSensitive(transform, "alignment");
		if (cJSON_IsNumber(alignment))
			obs_sceneitem_set_alignment(item, alignment->valueint);

		const cJSON *ba = cJSON_GetObjectItemCaseSensitive(transform, "boundsAlignment");
		if (cJSON_IsNumber(ba))
			obs_sceneitem_set_bounds_alignment(item, ba->valueint);
	}

	obs_source_release(scene_src);
	return ok(cJSON_CreateTrue());
}
