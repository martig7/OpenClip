/*
 * OpenClip OBS Plugin — Video Handlers
 *
 * Handlers for video-related API methods:
 *   getVideoSettings
 */

#ifndef OPENCLIP_VIDEO_HANDLERS_H
#define OPENCLIP_VIDEO_HANDLERS_H

#include <cJSON.h>

cJSON *h_get_video_settings(const cJSON *params);

#endif /* OPENCLIP_VIDEO_HANDLERS_H */
