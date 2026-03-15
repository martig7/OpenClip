/*
 * OpenClip OBS Plugin — Source Handlers
 *
 * Handlers for source-related API methods:
 *   addSource, removeSceneItem, setItemTransform
 */

#ifndef OPENCLIP_SOURCE_HANDLERS_H
#define OPENCLIP_SOURCE_HANDLERS_H

#include <cJSON.h>

cJSON *h_add_source(const cJSON *params);
cJSON *h_remove_scene_item(const cJSON *params);
cJSON *h_set_item_transform(const cJSON *params);

#endif /* OPENCLIP_SOURCE_HANDLERS_H */
