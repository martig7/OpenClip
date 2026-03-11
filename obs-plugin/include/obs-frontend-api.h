/*
 * Minimal obs-frontend-api.h stub — declares only the frontend functions OpenClip uses.
 * These are public OBS API signatures (MIT-licensed, OBS Studio project).
 */
#pragma once

#include "obs.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ── Source list used by frontend enumeration ────────────────────────────── */
/* Matches real OBS DARRAY(obs_source_t*) layout with nested .sources member */
struct obs_frontend_source_list {
    struct {
        obs_source_t **array;
        size_t         num;
        size_t         capacity;
    } sources;
};

/* ── Frontend API (imported from obs-frontend-api.dll) ───────────────────── */

/* Scene enumeration */
__declspec(dllimport) void obs_frontend_get_scenes(struct obs_frontend_source_list *sources);

/*
 * obs_frontend_source_list_free is an INLINE function in the real OBS SDK
 * (not exported from obs-frontend-api.dll).  We implement it here.
 */
static inline void obs_frontend_source_list_free(struct obs_frontend_source_list *source_list)
{
    if (!source_list)
        return;
    if (source_list->sources.array) {
        for (size_t i = 0; i < source_list->sources.num; i++)
            obs_source_release(source_list->sources.array[i]);
        bfree(source_list->sources.array);
    }
    source_list->sources.array    = NULL;
    source_list->sources.num      = 0;
    source_list->sources.capacity = 0;
}

/* Current scene */
__declspec(dllimport) obs_source_t *obs_frontend_get_current_scene(void);
__declspec(dllimport) void          obs_frontend_set_current_scene(obs_source_t *scene);

/* Recording */
__declspec(dllimport) bool obs_frontend_recording_active(void);
__declspec(dllimport) void obs_frontend_recording_start(void);
__declspec(dllimport) void obs_frontend_recording_stop(void);

/* Profile config */
__declspec(dllimport) config_t *obs_frontend_get_profile_config(void);

#ifdef __cplusplus
}
#endif
