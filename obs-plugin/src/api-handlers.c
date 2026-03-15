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

#include "api-utils.h"
#include "recording-handlers.h"
#include "scene-handlers.h"
#include "source-handlers.h"
#include "audio-handlers.h"
#include "video-handlers.h"

#include <obs-module.h>
#include <obs-frontend-api.h>
#include <obs.h>
#include <cJSON.h>

#include <string.h>

/* ── Thread-safe dispatch ─────────────────────────────────────────────────── */

typedef struct {
	const char  *method;
	const cJSON *params;
	cJSON       *response;
} api_task_t;

static void handle_on_ui_thread(void *data);

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

cJSON *api_dispatch(const char *method, const cJSON *params)
{
	api_task_t task;
	task.method   = method;
	task.params   = params;
	task.response = NULL;

	obs_queue_task(OBS_TASK_UI, handle_on_ui_thread, &task, true);

	if (!task.response)
		return err("Handler returned no response");
	return task.response;
}
