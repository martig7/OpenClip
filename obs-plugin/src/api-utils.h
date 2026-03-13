/*
 * OpenClip OBS Plugin — API Utilities
 *
 * Common utility functions used by all API handlers.
 */

#ifndef OPENCLIP_API_UTILS_H
#define OPENCLIP_API_UTILS_H

#include <cJSON.h>
#include <obs.h>
#include <stdbool.h>
#include <stdint.h>

/* Response builders */
cJSON *ok(cJSON *data);
cJSON *err(const char *msg);

/* JSON accessors */
const char *jstr(const cJSON *obj, const char *key);
int jint(const cJSON *obj, const char *key, int def);
int64_t jint64(const cJSON *obj, const char *key, int64_t def);
bool jbool(const cJSON *obj, const char *key, bool def);

/* OBS helpers */
bool is_audio_input_kind(const char *id);
obs_source_t *find_scene_source(const char *name);
void fit_item_to_canvas(obs_sceneitem_t *item);

#endif /* OPENCLIP_API_UTILS_H */
