/*
 * OpenClip OBS Plugin — Recording Handlers
 *
 * Handlers for recording-related API methods:
 *   getStatus, startRecording, stopRecording, getRecordingStatus
 */

#ifndef OPENCLIP_RECORDING_HANDLERS_H
#define OPENCLIP_RECORDING_HANDLERS_H

#include <cJSON.h>

cJSON *h_get_status(const cJSON *params);
cJSON *h_start_recording(const cJSON *params);
cJSON *h_stop_recording(const cJSON *params);
cJSON *h_get_recording_status(const cJSON *params);

#endif /* OPENCLIP_RECORDING_HANDLERS_H */
