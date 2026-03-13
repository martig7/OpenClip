/*
 * OpenClip OBS Plugin — Scene Handlers
 *
 * Handlers for scene-related API methods:
 *   getScenes, createScene, createSceneFromTemplate, createSceneFromScratch,
 *   deleteScene, switchScene, getSceneItems, duplicateSceneItem
 */

#ifndef OPENCLIP_SCENE_HANDLERS_H
#define OPENCLIP_SCENE_HANDLERS_H

#include <cJSON.h>

cJSON *h_get_scenes(const cJSON *params);
cJSON *h_create_scene(const cJSON *params);
cJSON *h_create_scene_from_template(const cJSON *params);
cJSON *h_create_scene_from_scratch(const cJSON *params);
cJSON *h_delete_scene(const cJSON *params);
cJSON *h_switch_scene(const cJSON *params);
cJSON *h_get_scene_items(const cJSON *params);
cJSON *h_duplicate_scene_item(const cJSON *params);

#endif /* OPENCLIP_SCENE_HANDLERS_H */
