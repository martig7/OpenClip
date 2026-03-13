/*
 * OpenClip OBS Plugin — Scene Handlers
 */

#include "scene-handlers.h"
#include "api-utils.h"

#include <obs-frontend-api.h>
#include <obs.h>
#include <obs-module.h>

#include <string.h>

struct tmpl_copy_ctx {
	obs_scene_t *dest;
	int copied;
	int total;
};

static bool enum_copy_items_cb(obs_scene_t *scene, obs_sceneitem_t *item, void *param)
{
	(void)scene;
	struct tmpl_copy_ctx *d = param;
	d->total++;
	obs_source_t *src = obs_sceneitem_get_source(item);
	if (src) {
		obs_sceneitem_t *dup = obs_scene_add(d->dest, src);
		if (dup)
			d->copied++;
	}
	return true;
}

struct scene_items_ctx {
	cJSON *arr;
};

static bool enum_scene_items_cb(obs_scene_t *scene, obs_sceneitem_t *item, void *param)
{
	(void)scene;
	struct scene_items_ctx *ctx = param;

	obs_source_t *src = obs_sceneitem_get_source(item);
	if (!src)
		return true;

	cJSON *obj = cJSON_CreateObject();
	cJSON_AddNumberToObject(obj, "sceneItemId", (double)obs_sceneitem_get_id(item));
	cJSON_AddStringToObject(obj, "sourceName", obs_source_get_name(src));
	cJSON_AddStringToObject(obj, "inputKind", obs_source_get_id(src));
	cJSON_AddBoolToObject(obj, "visible", obs_sceneitem_visible(item));
	cJSON_AddItemToArray(ctx->arr, obj);

	return true;
}

cJSON *h_get_scenes(const cJSON *p)
{
	(void)p;
	struct obs_frontend_source_list scenes = {0};
	obs_frontend_get_scenes(&scenes);

	cJSON *arr = cJSON_CreateArray();
	for (size_t i = 0; i < scenes.sources.num; i++) {
		const char *name = obs_source_get_name(scenes.sources.array[i]);
		if (name)
			cJSON_AddItemToArray(arr, cJSON_CreateString(name));
	}
	obs_frontend_source_list_free(&scenes);
	return ok(arr);
}

cJSON *h_create_scene(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *existing = find_scene_source(name);
	if (existing) {
		obs_source_release(existing);
		char msg[256];
		snprintf(msg, sizeof(msg), "Scene \"%s\" already exists in OBS", name);
		return err(msg);
	}

	obs_scene_t *scene = obs_scene_create(name);
	if (!scene)
		return err("Failed to create scene");
	obs_scene_release(scene);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "sceneName", name);
	return ok(data);
}

cJSON *h_create_scene_from_template(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	const char *tmpl = p ? jstr(p, "templateSceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *existing = find_scene_source(name);
	if (existing) {
		obs_source_release(existing);
		char msg[256];
		snprintf(msg, sizeof(msg), "Scene \"%s\" already exists", name);
		return err(msg);
	}

	obs_scene_t *new_scene = obs_scene_create(name);
	if (!new_scene)
		return err("Failed to create scene");

	int copied = 0;
	int total = 0;

	if (tmpl && tmpl[0]) {
		obs_source_t *tmpl_src = find_scene_source(tmpl);
		if (!tmpl_src) {
			obs_scene_release(new_scene);
			char msg[256];
			snprintf(msg, sizeof(msg), "Template scene \"%s\" not found", tmpl);
			return err(msg);
		}
		obs_scene_t *tmpl_scene = obs_scene_from_source(tmpl_src);
		if (tmpl_scene) {
			struct tmpl_copy_ctx edata = {new_scene, 0, 0};
			obs_scene_enum_items(tmpl_scene, enum_copy_items_cb, &edata);
			copied = edata.copied;
			total = edata.total;
		}
		obs_source_release(tmpl_src);
	}

	obs_scene_release(new_scene);

	char msg[256];
	if (tmpl && tmpl[0])
		snprintf(msg, sizeof(msg), "Scene \"%s\" created with %d/%d sources from \"%s\"",
			 name, copied, total, tmpl);
	else
		snprintf(msg, sizeof(msg), "Scene \"%s\" created", name);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "sceneName", name);
	cJSON_AddStringToObject(data, "message", msg);
	cJSON_AddNumberToObject(data, "copiedSources", copied);
	return ok(data);
}

cJSON *h_create_scene_from_scratch(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *existing = find_scene_source(name);
	if (existing) {
		obs_source_release(existing);
		char msg[256];
		snprintf(msg, sizeof(msg), "Scene \"%s\" already exists", name);
		return err(msg);
	}

	obs_scene_t *new_scene = obs_scene_create(name);
	if (!new_scene)
		return err("Failed to create scene");

	cJSON *added = cJSON_CreateArray();
	cJSON *errors = cJSON_CreateArray();

	bool add_window = p ? jbool(p, "addWindowCapture", false) : false;
	bool add_desktop = p ? jbool(p, "addDesktopAudio", false) : false;
	bool add_mic = p ? jbool(p, "addMicAudio", false) : false;
	const char *window_title = p ? jstr(p, "windowTitle") : NULL;
	const char *exe = p ? jstr(p, "exe") : NULL;
	const char *wclass = p ? jstr(p, "windowClass") : NULL;
	const char *capture_kind = p ? jstr(p, "captureKind") : NULL;
	if (!capture_kind)
		capture_kind = "game_capture";

	if (add_window && window_title) {
		char input_name[300];
		char window_str[512];
		obs_data_t *settings = obs_data_create();

		if (exe && wclass)
			snprintf(window_str, sizeof(window_str), "%s:%s:%s", window_title, wclass, exe);
		else
			snprintf(window_str, sizeof(window_str), "%s", window_title);

		const char *kind = (strcmp(capture_kind, "window_capture") == 0) ? "window_capture" : "game_capture";

		snprintf(input_name, sizeof(input_name), "%s - %s", name,
			 (strcmp(kind, "window_capture") == 0) ? "Window Capture" : "Game Capture");

		if (strcmp(kind, "window_capture") == 0) {
			obs_data_set_string(settings, "window", window_str);
		} else {
			obs_data_set_string(settings, "capture_mode", "window");
			obs_data_set_string(settings, "window", window_str);
		}

		obs_source_t *src = obs_source_create(kind, input_name, settings, NULL);
		if (src) {
			obs_sceneitem_t *item = obs_scene_add(new_scene, src);
			if (item)
				fit_item_to_canvas(item);
			obs_source_release(src);
			cJSON_AddItemToArray(added, cJSON_CreateString(
				strcmp(kind, "game_capture") == 0 ? "game capture" : "window capture"));
		} else {
			cJSON_AddItemToArray(errors, cJSON_CreateString("Failed to create capture source"));
		}
		obs_data_release(settings);
	}

	if (add_desktop) {
		char input_name[300];
		snprintf(input_name, sizeof(input_name), "%s - Desktop Audio", name);
		obs_data_t *settings = obs_data_create();
		obs_source_t *src = obs_source_create("wasapi_output_capture", input_name, settings, NULL);
		if (src) {
			obs_scene_add(new_scene, src);
			obs_source_release(src);
			cJSON_AddItemToArray(added, cJSON_CreateString("desktop audio"));
		} else {
			cJSON_AddItemToArray(errors, cJSON_CreateString("desktop audio: creation failed"));
		}
		obs_data_release(settings);
	}

	if (add_mic) {
		char input_name[300];
		snprintf(input_name, sizeof(input_name), "%s - Microphone", name);
		obs_data_t *settings = obs_data_create();
		obs_source_t *src = obs_source_create("wasapi_input_capture", input_name, settings, NULL);
		if (src) {
			obs_scene_add(new_scene, src);
			obs_source_release(src);
			cJSON_AddItemToArray(added, cJSON_CreateString("microphone"));
		} else {
			cJSON_AddItemToArray(errors, cJSON_CreateString("microphone: creation failed"));
		}
		obs_data_release(settings);
	}

	obs_scene_release(new_scene);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "sceneName", name);
	cJSON_AddItemToObject(data, "addedSources", added);
	cJSON_AddItemToObject(data, "errors", errors);
	return ok(data);
}

cJSON *h_delete_scene(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *src = find_scene_source(name);
	if (!src) {
		char msg[256];
		snprintf(msg, sizeof(msg), "Scene \"%s\" does not exist", name);
		return err(msg);
	}

	obs_source_remove(src);
	obs_source_release(src);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "sceneName", name);
	return ok(data);
}

cJSON *h_switch_scene(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *src = find_scene_source(name);
	if (!src) {
		char msg[256];
		snprintf(msg, sizeof(msg), "Scene \"%s\" not found", name);
		return err(msg);
	}

	obs_frontend_set_current_scene(src);
	obs_source_release(src);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "sceneName", name);
	return ok(data);
}

cJSON *h_get_scene_items(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *src = find_scene_source(name);
	if (!src)
		return ok(cJSON_CreateArray());

	obs_scene_t *scene = obs_scene_from_source(src);
	if (!scene) {
		obs_source_release(src);
		return ok(cJSON_CreateArray());
	}

	struct scene_items_ctx ctx;
	ctx.arr = cJSON_CreateArray();
	obs_scene_enum_items(scene, enum_scene_items_cb, &ctx);

	obs_source_release(src);
	return ok(ctx.arr);
}

cJSON *h_duplicate_scene_item(const cJSON *p)
{
	const char *from = p ? jstr(p, "fromScene") : NULL;
	const char *to = p ? jstr(p, "toScene") : NULL;
	int64_t item_id = p ? jint64(p, "sceneItemId", -1) : -1;
	if (!from || !to || item_id < 0)
		return err("fromScene, toScene, and sceneItemId are required");

	obs_source_t *from_src = find_scene_source(from);
	obs_source_t *to_src = find_scene_source(to);
	if (!from_src || !to_src) {
		if (from_src) obs_source_release(from_src);
		if (to_src) obs_source_release(to_src);
		return err("Source or destination scene not found");
	}

	obs_scene_t *from_scene = obs_scene_from_source(from_src);
	obs_scene_t *to_scene = obs_scene_from_source(to_src);

	if (!from_scene || !to_scene) {
		obs_source_release(from_src);
		obs_source_release(to_src);
		return err("Source is not a valid scene");
	}

	obs_sceneitem_t *orig = obs_scene_find_sceneitem_by_id(from_scene, item_id);
	if (!orig) {
		obs_source_release(from_src);
		obs_source_release(to_src);
		return err("Scene item not found");
	}

	obs_source_t *item_source = obs_sceneitem_get_source(orig);
	obs_sceneitem_t *dup = obs_scene_add(to_scene, item_source);

	obs_source_release(from_src);
	obs_source_release(to_src);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "duplicated", dup != NULL);
	return ok(data);
}
