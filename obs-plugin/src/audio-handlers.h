/*
 * OpenClip OBS Plugin — Audio Handlers
 *
 * Handlers for audio-related API methods:
 *   getAudioInputs, getSceneAudioSources, getInputAudioTracks,
 *   setInputAudioTracks, getTrackNames, setTrackNames
 */

#ifndef OPENCLIP_AUDIO_HANDLERS_H
#define OPENCLIP_AUDIO_HANDLERS_H

#include <cJSON.h>

cJSON *h_get_audio_inputs(const cJSON *params);
cJSON *h_get_scene_audio_sources(const cJSON *params);
cJSON *h_get_input_audio_tracks(const cJSON *params);
cJSON *h_set_input_audio_tracks(const cJSON *params);
cJSON *h_get_track_names(const cJSON *params);
cJSON *h_set_track_names(const cJSON *params);

#endif /* OPENCLIP_AUDIO_HANDLERS_H */
