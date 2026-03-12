/*
 * OpenClip OBS Plugin — API Handler Header
 *
 * Declares the single dispatch function called by the HTTP server for every
 * incoming JSON request.  The handler runs OBS API calls on the UI thread via
 * obs_queue_task and returns a cJSON response object.
 */

#ifndef OPENCLIP_API_HANDLERS_H
#define OPENCLIP_API_HANDLERS_H

#include <cJSON.h>

/* Dispatch a JSON-RPC style request.
 *   method  – the "method" string from the request body
 *   params  – the "params" object (may be NULL)
 *
 * Returns a cJSON object that the caller must free:
 *   { "success": true,  "data": { ... } }
 *   { "success": false, "error": "..." }
 */
cJSON *api_dispatch(const char *method, const cJSON *params);

#endif /* OPENCLIP_API_HANDLERS_H */
