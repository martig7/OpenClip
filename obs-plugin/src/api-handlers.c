/*
 * OpenClip OBS Plugin — API Handlers
 *
 * Implements every method the Electron app can call.  All OBS API work is
 * dispatched to the UI thread via obs_queue_task() so that it is thread-safe
 * even though the caller is the HTTP server thread.
 *
 * Methods (JSON-RPC style, POST /api):
 *
 *  Status / health
 *    getStatus
 *
 *  Recording
 *    startRecording   { sceneName? }
 *    stopRecording
 *    getRecordingStatus
 *
 *  Scenes
 *    getScenes
 *    createScene        { sceneName }
 *    createSceneFromTemplate  { sceneName, templateSceneName }
 *    createSceneFromScratch   { sceneName, addWindowCapture?, windowTitle?,
 *                               exe?, windowClass?, captureKind?,
 *                               addDesktopAudio?, addMicAudio? }
 *    deleteScene        { sceneName }
 *    switchScene        { sceneName }
 *    getSceneItems      { sceneName }
 *    duplicateSceneItem { fromScene, sceneItemId, toScene }
 *
 *  Sources
 *    addSource          { sceneName, inputName, inputKind, inputSettings? }
 *    removeSceneItem    { sceneName, sceneItemId }
 *    setItemTransform   { sceneName, sceneItemId, transform }
 *
 *  Audio
 *    getAudioInputs
 *    getSceneAudioSources  { sceneName }
 *    getInputAudioTracks   { inputName }
 *    setInputAudioTracks   { inputName, tracks }
 *
 *  Track names
 *    getTrackNames
 *    setTrackNames         { names: [str x 6] }
 *
 *  Video
 *    getVideoSettings
 */

#include "api-handlers.h"

#include <obs-module.h>
#include <obs-frontend-api.h>
#include <obs.h>
#include <cJSON.h>

#include <limits.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

#ifndef OPENCLIP_OBS_VERSION
#define OPENCLIP_OBS_VERSION "1.0.0"
#endif

/* ── Thread-safe dispatch ─────────────────────────────────────────────────── */

/* All handlers receive an api_task and fill in ->response on the UI thread. */

typedef struct {
	const char  *method;
	const cJSON *params;
	cJSON       *response;
} api_task_t;

/* Forward declarations of all handler functions. */
static void handle_on_ui_thread(void *data);

/* Per-method handlers — each returns a cJSON object.  Called on the UI thread. */
static cJSON *h_get_status(const cJSON *p);
static cJSON *h_start_recording(const cJSON *p);
static cJSON *h_stop_recording(const cJSON *p);
static cJSON *h_get_recording_status(const cJSON *p);
static cJSON *h_get_scenes(const cJSON *p);
static cJSON *h_create_scene(const cJSON *p);
static cJSON *h_create_scene_from_template(const cJSON *p);
static cJSON *h_create_scene_from_scratch(const cJSON *p);
static cJSON *h_delete_scene(const cJSON *p);
static cJSON *h_switch_scene(const cJSON *p);
static cJSON *h_get_scene_items(const cJSON *p);
static cJSON *h_duplicate_scene_item(const cJSON *p);
static cJSON *h_add_source(const cJSON *p);
static cJSON *h_remove_scene_item(const cJSON *p);
static cJSON *h_set_item_transform(const cJSON *p);
static cJSON *h_get_audio_inputs(const cJSON *p);
static cJSON *h_get_scene_audio_sources(const cJSON *p);
static cJSON *h_get_input_audio_tracks(const cJSON *p);
static cJSON *h_set_input_audio_tracks(const cJSON *p);
static cJSON *h_get_track_names(const cJSON *p);
static cJSON *h_set_track_names(const cJSON *p);
static cJSON *h_get_video_settings(const cJSON *p);

/* ── Convenience macros ───────────────────────────────────────────────────── */

static cJSON *ok(cJSON *data)
{
	cJSON *r = cJSON_CreateObject();
	cJSON_AddBoolToObject(r, "success", 1);
	if (data)
		cJSON_AddItemToObject(r, "data", data);
	else
		cJSON_AddNullToObject(r, "data");
	return r;
}

static cJSON *err(const char *msg)
{
	cJSON *r = cJSON_CreateObject();
	cJSON_AddBoolToObject(r, "success", 0);
	cJSON_AddStringToObject(r, "error", msg ? msg : "Unknown error");
	return r;
}

static const char *jstr(const cJSON *obj, const char *key)
{
	const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
	return (cJSON_IsString(item) && item->valuestring[0])
		       ? item->valuestring
		       : NULL;
}

static int jint(const cJSON *obj, const char *key, int def)
{
	const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
	return cJSON_IsNumber(item) ? item->valueint : def;
}

static bool jbool(const cJSON *obj, const char *key, bool def)
{
	const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
	if (cJSON_IsBool(item))
		return cJSON_IsTrue(item);
	return def;
}

/* ── Recording state (scene restore) ─────────────────────────────────────── */

static char previous_scene_name[256] = {0};

/* ── Audio kind set ───────────────────────────────────────────────────────── */

static bool is_audio_input_kind(const char *id)
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

static obs_source_t *find_scene_source(const char *name)
{
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

static void fit_item_to_canvas(obs_sceneitem_t *item)
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

/* ── Dispatch table ───────────────────────────────────────────────────────── */

typedef cJSON *(*handler_fn)(const cJSON *params);

struct method_entry {
	const char *name;
	handler_fn  fn;
};

static const struct method_entry METHOD_TABLE[] = {
	{"getStatus",                h_get_status},
	{"startRecording",           h_start_recording},
	{"stopRecording",            h_stop_recording},
	{"getRecordingStatus",       h_get_recording_status},
	{"getScenes",                h_get_scenes},
	{"createScene",              h_create_scene},
	{"createSceneFromTemplate",  h_create_scene_from_template},
	{"createSceneFromScratch",   h_create_scene_from_scratch},
	{"deleteScene",              h_delete_scene},
	{"switchScene",              h_switch_scene},
	{"getSceneItems",            h_get_scene_items},
	{"duplicateSceneItem",       h_duplicate_scene_item},
	{"addSource",                h_add_source},
	{"removeSceneItem",          h_remove_scene_item},
	{"setItemTransform",         h_set_item_transform},
	{"getAudioInputs",           h_get_audio_inputs},
	{"getSceneAudioSources",     h_get_scene_audio_sources},
	{"getInputAudioTracks",      h_get_input_audio_tracks},
	{"setInputAudioTracks",      h_set_input_audio_tracks},
	{"getTrackNames",            h_get_track_names},
	{"setTrackNames",            h_set_track_names},
	{"getVideoSettings",         h_get_video_settings},
	{NULL,                       NULL},
};

/* Called on the UI thread by obs_queue_task. */
static void handle_on_ui_thread(void *data)
{
	api_task_t *task = data;

	for (const struct method_entry *e = METHOD_TABLE; e->name; e++) {
		if (strcmp(e->name, task->method) == 0) {
			task->response = e->fn(task->params);
			return;
		}
	}

	char msg[128];
	snprintf(msg, sizeof(msg), "Unknown method: %s", task->method);
	task->response = err(msg);
}

/* Public entry point — called from HTTP server thread. */
cJSON *api_dispatch(const char *method, const cJSON *params)
{
	api_task_t task;
	task.method   = method;
	task.params   = params;
	task.response = NULL;

	/* Run the handler on the UI thread (blocking wait). */
	obs_queue_task(OBS_TASK_UI, handle_on_ui_thread, &task, true);

	if (!task.response)
		return err("Handler returned no response");
	return task.response;
}

/* ══════════════════════════════════════════════════════════════════════════
   HANDLER IMPLEMENTATIONS
   ══════════════════════════════════════════════════════════════════════════ */

/* ── getStatus ────────────────────────────────────────────────────────────── */

static cJSON *h_get_status(const cJSON *p)
{
	(void)p;
	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "pluginVersion", OPENCLIP_OBS_VERSION);
	cJSON_AddStringToObject(data, "obsVersion", obs_get_version_string());
	cJSON_AddBoolToObject(data, "recording",
			      obs_frontend_recording_active());
	return ok(data);
}

/* ── startRecording ───────────────────────────────────────────────────────── */

static cJSON *h_start_recording(const cJSON *p)
{
	if (obs_frontend_recording_active())
		return err("Already recording");

	const char *scene_name = p ? jstr(p, "sceneName") : NULL;

	if (scene_name && scene_name[0]) {
		/* Save current scene for later restore */
		obs_source_t *cur = obs_frontend_get_current_scene();
		if (cur) {
			const char *n = obs_source_get_name(cur);
			if (n)
				snprintf(previous_scene_name,
					 sizeof(previous_scene_name), "%s", n);
			obs_source_release(cur);
		}

		/* Switch to the requested scene */
		obs_source_t *target = find_scene_source(scene_name);
		if (target) {
			obs_frontend_set_current_scene(target);
			obs_source_release(target);
		} else {
			blog(LOG_WARNING,
			     "[openclip] Scene not found: %s", scene_name);
		}
	}

	obs_frontend_recording_start();

	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "recording", 1);
	return ok(data);
}

/* ── stopRecording ────────────────────────────────────────────────────────── */

static cJSON *h_stop_recording(const cJSON *p)
{
	(void)p;
	if (!obs_frontend_recording_active())
		return err("Not recording");

	obs_frontend_recording_stop();

	/* Restore previous scene */
	if (previous_scene_name[0]) {
		obs_source_t *prev = find_scene_source(previous_scene_name);
		if (prev) {
			obs_frontend_set_current_scene(prev);
			obs_source_release(prev);
		}
		previous_scene_name[0] = '\0';
	}

	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "recording", 0);
	return ok(data);
}

/* ── getRecordingStatus ───────────────────────────────────────────────────── */

static cJSON *h_get_recording_status(const cJSON *p)
{
	(void)p;
	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "recording",
			      obs_frontend_recording_active());
	return ok(data);
}

/* ── getScenes ────────────────────────────────────────────────────────────── */

static cJSON *h_get_scenes(const cJSON *p)
{
	(void)p;
	struct obs_frontend_source_list scenes = {0};
	obs_frontend_get_scenes(&scenes);

	cJSON *arr = cJSON_CreateArray();
	for (size_t i = 0; i < scenes.sources.num; i++) {
		const char *name =
			obs_source_get_name(scenes.sources.array[i]);
		if (name)
			cJSON_AddItemToArray(arr, cJSON_CreateString(name));
	}
	obs_frontend_source_list_free(&scenes);
	return ok(arr);
}

/* ── createScene ──────────────────────────────────────────────────────────── */

static cJSON *h_create_scene(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	/* Check if it already exists */
	obs_source_t *existing = find_scene_source(name);
	if (existing) {
		obs_source_release(existing);
		char msg[256];
		snprintf(msg, sizeof(msg),
			 "Scene \"%s\" already exists in OBS", name);
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

/* ── createSceneFromTemplate ──────────────────────────────────────────────── */

/* Context + callback for copying scene items from a template scene. */
struct tmpl_copy_ctx {
	obs_scene_t *dest;
	int copied;
	int total;
};

static bool enum_copy_items_cb(obs_scene_t *scene, obs_sceneitem_t *item,
			       void *param)
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

static cJSON *h_create_scene_from_template(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	const char *tmpl = p ? jstr(p, "templateSceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	/* Check duplicate */
	obs_source_t *existing = find_scene_source(name);
	if (existing) {
		obs_source_release(existing);
		char msg[256];
		snprintf(msg, sizeof(msg),
			 "Scene \"%s\" already exists", name);
		return err(msg);
	}

	obs_scene_t *new_scene = obs_scene_create(name);
	if (!new_scene)
		return err("Failed to create scene");

	int copied = 0;
	int total = 0;

	if (tmpl && tmpl[0]) {
		obs_source_t *tmpl_src = find_scene_source(tmpl);
		if (tmpl_src) {
			obs_scene_t *tmpl_scene =
				obs_scene_from_source(tmpl_src);
			if (tmpl_scene) {
				struct tmpl_copy_ctx edata = {new_scene, 0, 0};

				obs_scene_enum_items(
					tmpl_scene, enum_copy_items_cb,
					&edata);
				copied = edata.copied;
				total = edata.total;
			}
			obs_source_release(tmpl_src);
		}
	}

	obs_scene_release(new_scene);

	char msg[256];
	if (tmpl && tmpl[0])
		snprintf(msg, sizeof(msg),
			 "Scene \"%s\" created with %d/%d sources from \"%s\"",
			 name, copied, total, tmpl);
	else
		snprintf(msg, sizeof(msg), "Scene \"%s\" created", name);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "sceneName", name);
	cJSON_AddStringToObject(data, "message", msg);
	cJSON_AddNumberToObject(data, "copiedSources", copied);
	return ok(data);
}

/* ── createSceneFromScratch ───────────────────────────────────────────────── */

static cJSON *h_create_scene_from_scratch(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *existing = find_scene_source(name);
	if (existing) {
		obs_source_release(existing);
		char msg[256];
		snprintf(msg, sizeof(msg),
			 "Scene \"%s\" already exists", name);
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

	/* Window/game capture */
	if (add_window && window_title) {
		char input_name[300];
		char window_str[512];
		obs_data_t *settings = obs_data_create();

		if (exe && wclass) {
			snprintf(window_str, sizeof(window_str),
				 "%s:%s:%s", window_title, wclass, exe);
		} else {
			snprintf(window_str, sizeof(window_str),
				 "%s", window_title);
		}

		const char *kind = (strcmp(capture_kind, "window_capture") == 0)
					   ? "window_capture"
					   : "game_capture";

		snprintf(input_name, sizeof(input_name), "%s - %s", name,
			 (strcmp(kind, "window_capture") == 0)
				 ? "Window Capture"
				 : "Game Capture");

		if (strcmp(kind, "window_capture") == 0) {
			obs_data_set_string(settings, "window", window_str);
		} else {
			obs_data_set_string(settings, "capture_mode", "window");
			obs_data_set_string(settings, "window", window_str);
		}

		obs_source_t *src =
			obs_source_create(kind, input_name, settings, NULL);
		if (src) {
			obs_sceneitem_t *item =
				obs_scene_add(new_scene, src);
			if (item)
				fit_item_to_canvas(item);
			obs_source_release(src);
			cJSON_AddItemToArray(added, cJSON_CreateString(
				strcmp(kind, "game_capture") == 0
					? "game capture"
					: "window capture"));
		} else {
			cJSON_AddItemToArray(errors,
					     cJSON_CreateString("Failed to create capture source"));
		}
		obs_data_release(settings);
	}

	/* Desktop audio */
	if (add_desktop) {
		char input_name[300];
		snprintf(input_name, sizeof(input_name),
			 "%s - Desktop Audio", name);
		obs_data_t *settings = obs_data_create();
		obs_source_t *src = obs_source_create(
			"wasapi_output_capture", input_name, settings, NULL);
		if (src) {
			obs_scene_add(new_scene, src);
			obs_source_release(src);
			cJSON_AddItemToArray(added,
					     cJSON_CreateString("desktop audio"));
		} else {
			cJSON_AddItemToArray(errors,
					     cJSON_CreateString("desktop audio: creation failed"));
		}
		obs_data_release(settings);
	}

	/* Microphone */
	if (add_mic) {
		char input_name[300];
		snprintf(input_name, sizeof(input_name),
			 "%s - Microphone", name);
		obs_data_t *settings = obs_data_create();
		obs_source_t *src = obs_source_create(
			"wasapi_input_capture", input_name, settings, NULL);
		if (src) {
			obs_scene_add(new_scene, src);
			obs_source_release(src);
			cJSON_AddItemToArray(added,
					     cJSON_CreateString("microphone"));
		} else {
			cJSON_AddItemToArray(errors,
					     cJSON_CreateString("microphone: creation failed"));
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

/* ── deleteScene ──────────────────────────────────────────────────────────── */

static cJSON *h_delete_scene(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *src = find_scene_source(name);
	if (!src) {
		char msg[256];
		snprintf(msg, sizeof(msg),
			 "Scene \"%s\" does not exist", name);
		return err(msg);
	}

	obs_source_remove(src);
	obs_source_release(src);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "sceneName", name);
	return ok(data);
}

/* ── switchScene ──────────────────────────────────────────────────────────── */

static cJSON *h_switch_scene(const cJSON *p)
{
	const char *name = p ? jstr(p, "sceneName") : NULL;
	if (!name)
		return err("sceneName is required");

	obs_source_t *src = find_scene_source(name);
	if (!src) {
		char msg[256];
		snprintf(msg, sizeof(msg),
			 "Scene \"%s\" not found", name);
		return err(msg);
	}

	obs_frontend_set_current_scene(src);
	obs_source_release(src);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddStringToObject(data, "sceneName", name);
	return ok(data);
}

/* ── getSceneItems ────────────────────────────────────────────────────────── */

struct scene_items_ctx {
	cJSON *arr;
};

static bool enum_scene_items_cb(obs_scene_t *scene, obs_sceneitem_t *item,
				void *param)
{
	(void)scene;
	struct scene_items_ctx *ctx = param;

	obs_source_t *src = obs_sceneitem_get_source(item);
	if (!src)
		return true;

	cJSON *obj = cJSON_CreateObject();
	cJSON_AddNumberToObject(obj, "sceneItemId",
				(double)obs_sceneitem_get_id(item));
	cJSON_AddStringToObject(obj, "sourceName",
				obs_source_get_name(src));
	cJSON_AddStringToObject(obj, "inputKind",
				obs_source_get_id(src));
	cJSON_AddBoolToObject(obj, "visible",
			      obs_sceneitem_visible(item));
	cJSON_AddItemToArray(ctx->arr, obj);

	return true;
}

static cJSON *h_get_scene_items(const cJSON *p)
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

/* ── duplicateSceneItem ───────────────────────────────────────────────────── */

static cJSON *h_duplicate_scene_item(const cJSON *p)
{
	const char *from = p ? jstr(p, "fromScene") : NULL;
	const char *to = p ? jstr(p, "toScene") : NULL;
	int item_id = p ? jint(p, "sceneItemId", -1) : -1;
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

	obs_sceneitem_t *orig = obs_scene_find_sceneitem_by_id(from_scene,
							       item_id);
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

/* ── addSource ────────────────────────────────────────────────────────────── */

static cJSON *h_add_source(const cJSON *p)
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

	/* Build settings from inputSettings param */
	obs_data_t *settings = obs_data_create();
	const cJSON *input_settings =
		p ? cJSON_GetObjectItemCaseSensitive(p, "inputSettings") : NULL;
	if (cJSON_IsObject(input_settings)) {
		const cJSON *item = NULL;
		cJSON_ArrayForEach(item, input_settings)
		{
			if (cJSON_IsString(item))
				obs_data_set_string(settings, item->string,
						    item->valuestring);
			else if (cJSON_IsNumber(item)) {
				if (item->valuedouble >= (double)LLONG_MIN &&
				    item->valuedouble <= (double)LLONG_MAX &&
				    item->valuedouble == (long long)item->valuedouble)
					obs_data_set_int(settings, item->string,
							 (long long)item->valuedouble);
				else
					obs_data_set_double(settings, item->string,
							    item->valuedouble);
			} else if (cJSON_IsBool(item))
				obs_data_set_bool(settings, item->string,
						  cJSON_IsTrue(item));
		}
	}

	/* Try to find existing source first, otherwise create new */
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
		obs_source_release(src); /* release the ref from get_source_by_name */

	obs_source_release(scene_src);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "added", item != NULL);
	cJSON_AddNumberToObject(data, "sceneItemId",
				item ? (double)obs_sceneitem_get_id(item) : -1);
	return ok(data);
}

/* ── removeSceneItem ──────────────────────────────────────────────────────── */

static cJSON *h_remove_scene_item(const cJSON *p)
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

	obs_sceneitem_t *item =
		obs_scene_find_sceneitem_by_id(scene, item_id);
	if (item)
		obs_sceneitem_remove(item);

	obs_source_release(scene_src);

	cJSON *data = cJSON_CreateObject();
	cJSON_AddBoolToObject(data, "removed", item != NULL);
	return ok(data);
}

/* ── setItemTransform ─────────────────────────────────────────────────────── */

static cJSON *h_set_item_transform(const cJSON *p)
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

	obs_sceneitem_t *item =
		obs_scene_find_sceneitem_by_id(scene, item_id);
	if (!item) {
		obs_source_release(scene_src);
		return err("Scene item not found");
	}

	const cJSON *transform =
		p ? cJSON_GetObjectItemCaseSensitive(p, "transform") : NULL;
	if (cJSON_IsObject(transform)) {
		const cJSON *btype =
			cJSON_GetObjectItemCaseSensitive(transform, "boundsType");
		if (cJSON_IsString(btype)) {
			if (strcmp(btype->valuestring,
				   "OBS_BOUNDS_SCALE_INNER") == 0)
				obs_sceneitem_set_bounds_type(
					item, OBS_BOUNDS_SCALE_INNER);
			else if (strcmp(btype->valuestring,
					"OBS_BOUNDS_STRETCH") == 0)
				obs_sceneitem_set_bounds_type(item,
							     OBS_BOUNDS_STRETCH);
		}

		const cJSON *px =
			cJSON_GetObjectItemCaseSensitive(transform, "positionX");
		const cJSON *py =
			cJSON_GetObjectItemCaseSensitive(transform, "positionY");
		if (cJSON_IsNumber(px) && cJSON_IsNumber(py)) {
			struct vec2 pos;
			pos.x = (float)px->valuedouble;
			pos.y = (float)py->valuedouble;
			obs_sceneitem_set_pos(item, &pos);
		}

		const cJSON *bw = cJSON_GetObjectItemCaseSensitive(transform,
								   "boundsWidth");
		const cJSON *bh = cJSON_GetObjectItemCaseSensitive(
			transform, "boundsHeight");
		if (cJSON_IsNumber(bw) && cJSON_IsNumber(bh)) {
			struct vec2 bounds;
			bounds.x = (float)bw->valuedouble;
			bounds.y = (float)bh->valuedouble;
			obs_sceneitem_set_bounds(item, &bounds);
		}

		const cJSON *alignment = cJSON_GetObjectItemCaseSensitive(
			transform, "alignment");
		if (cJSON_IsNumber(alignment))
			obs_sceneitem_set_alignment(item, alignment->valueint);

		const cJSON *ba = cJSON_GetObjectItemCaseSensitive(
			transform, "boundsAlignment");
		if (cJSON_IsNumber(ba))
			obs_sceneitem_set_bounds_alignment(item, ba->valueint);
	}

	obs_source_release(scene_src);
	return ok(cJSON_CreateTrue());
}

/* ── getAudioInputs ───────────────────────────────────────────────────────── */

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
	cJSON_AddStringToObject(obj, "inputName",
				obs_source_get_name(source));
	cJSON_AddStringToObject(obj, "inputKind", id);
	cJSON_AddItemToArray(ctx->arr, obj);
	return true;
}

static cJSON *h_get_audio_inputs(const cJSON *p)
{
	(void)p;
	struct audio_enum_ctx ctx;
	ctx.arr = cJSON_CreateArray();
	obs_enum_sources(enum_audio_cb, &ctx);
	return ok(ctx.arr);
}

/* ── getSceneAudioSources ─────────────────────────────────────────────────── */

struct scene_audio_ctx {
	cJSON *arr;
};

static bool enum_scene_audio_cb(obs_scene_t *scene, obs_sceneitem_t *item,
				void *param)
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
	cJSON_AddStringToObject(obj, "inputName",
				obs_source_get_name(src));
	cJSON_AddStringToObject(obj, "inputKind", kind);
	cJSON_AddNumberToObject(obj, "sceneItemId",
				(double)obs_sceneitem_get_id(item));
	cJSON_AddItemToArray(ctx->arr, obj);
	return true;
}

static cJSON *h_get_scene_audio_sources(const cJSON *p)
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

/* ── getInputAudioTracks ──────────────────────────────────────────────────── */

static cJSON *h_get_input_audio_tracks(const cJSON *p)
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

/* ── setInputAudioTracks ──────────────────────────────────────────────────── */

static cJSON *h_set_input_audio_tracks(const cJSON *p)
{
	const char *input_name = p ? jstr(p, "inputName") : NULL;
	const cJSON *tracks =
		p ? cJSON_GetObjectItemCaseSensitive(p, "tracks") : NULL;
	if (!input_name || !cJSON_IsObject(tracks))
		return err("inputName and tracks are required");

	obs_source_t *src = obs_get_source_by_name(input_name);
	if (!src)
		return err("Input not found");

	uint32_t mixers = obs_source_get_audio_mixers(src);

	for (int i = 1; i <= 6; i++) {
		char key[4];
		snprintf(key, sizeof(key), "%d", i);
		const cJSON *val =
			cJSON_GetObjectItemCaseSensitive(tracks, key);
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

/* ── getTrackNames ────────────────────────────────────────────────────────── */

static cJSON *h_get_track_names(const cJSON *p)
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
				val = config_get_string(config, "SimpleOutput",
							key);
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

/* ── setTrackNames ────────────────────────────────────────────────────────── */

static cJSON *h_set_track_names(const cJSON *p)
{
	const cJSON *names =
		p ? cJSON_GetObjectItemCaseSensitive(p, "names") : NULL;
	if (!cJSON_IsArray(names))
		return err("names array is required");

	config_t *config = obs_frontend_get_profile_config();
	if (!config)
		return err("No active profile config");

	int i = 0;
	const cJSON *item = NULL;
	cJSON_ArrayForEach(item, names)
	{
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

/* ── getVideoSettings ─────────────────────────────────────────────────────── */

static cJSON *h_get_video_settings(const cJSON *p)
{
	(void)p;
	struct obs_video_info ovi;
	if (!obs_get_video_info(&ovi))
		return err("Video subsystem not initialized");

	cJSON *data = cJSON_CreateObject();
	cJSON_AddNumberToObject(data, "baseWidth", ovi.base_width);
	cJSON_AddNumberToObject(data, "baseHeight", ovi.base_height);
	cJSON_AddNumberToObject(data, "outputWidth", ovi.output_width);
	cJSON_AddNumberToObject(data, "outputHeight", ovi.output_height);
	cJSON_AddNumberToObject(data, "fpsNum", ovi.fps_num);
	cJSON_AddNumberToObject(data, "fpsDen", ovi.fps_den);
	return ok(data);
}
