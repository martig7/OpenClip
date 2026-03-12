/*
 * Minimal obs.h stub — declares only the libobs types and functions OpenClip uses.
 * These are public OBS API signatures (MIT-licensed, OBS Studio project).
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

/* ── Portability: import/visibility annotation ──────────────────────────── */
#if defined(_WIN32) || defined(__CYGWIN__)
#  define OBS_API __declspec(dllimport)
#elif defined(__GNUC__) || defined(__clang__)
#  define OBS_API __attribute__((visibility("default")))
#else
#  define OBS_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* ── Opaque handles ─────────────────────────────────────────────────────── */
typedef struct obs_source  obs_source_t;
typedef struct obs_scene   obs_scene_t;
typedef struct obs_sceneitem obs_sceneitem_t;
typedef struct obs_data    obs_data_t;
typedef struct config_data config_t;

/* ── Math types ─────────────────────────────────────────────────────────── */
struct vec2 { float x, y; };

/* ── Alignment constants ────────────────────────────────────────────────── */
#define OBS_ALIGN_CENTER  (0)
#define OBS_ALIGN_LEFT    (1 << 0)
#define OBS_ALIGN_RIGHT   (1 << 1)
#define OBS_ALIGN_TOP     (1 << 2)
#define OBS_ALIGN_BOTTOM  (1 << 3)

/* ── Bounds type ────────────────────────────────────────────────────────── */
enum obs_bounds_type {
    OBS_BOUNDS_NONE            = 0,
    OBS_BOUNDS_STRETCH         = 1,
    OBS_BOUNDS_SCALE_INNER     = 2,
    OBS_BOUNDS_SCALE_OUTER     = 3,
    OBS_BOUNDS_SCALE_TO_WIDTH  = 4,
    OBS_BOUNDS_SCALE_TO_HEIGHT = 5,
    OBS_BOUNDS_MAX_ONLY        = 6,
};

/* ── Task type ──────────────────────────────────────────────────────────── */
enum obs_task_type { OBS_TASK_UI, OBS_TASK_GRAPHICS, OBS_TASK_AUDIO, OBS_TASK_DESTROY };

typedef void (*obs_task_handler_t)(void *param);

/* ── Video info ─────────────────────────────────────────────────────────── */
/* This mirrors the layout of the real libobs obs_video_info struct.
 * Fields beyond output_height are included to match the upstream ABI.
 * See libobs/obs.h in the OBS source for authoritative definitions. */
struct obs_video_info {
    const char       *graphics_module;
    uint32_t          fps_num;
    uint32_t          fps_den;
    uint32_t          base_width;
    uint32_t          base_height;
    uint32_t          output_width;
    uint32_t          output_height;
    uint32_t          output_format;   /* video_format enum */
    uint32_t          adapter;
    bool              gpu_conversion;
    uint32_t          colorspace;      /* video_colorspace enum */
    uint32_t          range;           /* video_range_type enum */
    uint32_t          scale_type;      /* obs_scale_type enum */
};

/* ── Dynamic array for source lists (matches OBS DARRAY layout) ─────────────── */
struct obs_source_array {
    obs_source_t **array;
    size_t         num;
    size_t         capacity;
};

/* ── Source enumeration callback ─────────────────────────────────────────── */
typedef bool (*obs_enum_sources_proc_t)(void *data, obs_source_t *source);

/* ── Scene item enumeration callback ─────────────────────────────────────── */
typedef bool (*obs_scene_enum_items_proc_t)(obs_scene_t *scene, obs_sceneitem_t *item, void *param);

/* ── libobs functions (imported from obs.dll) ───────────────────────────── */

/* Version */
OBS_API const char *obs_get_version_string(void);

/* Task queue */
OBS_API void obs_queue_task(enum obs_task_type type, obs_task_handler_t handler, void *param, bool wait);

/* Video */
OBS_API bool obs_get_video_info(struct obs_video_info *ovi);

/* Source lifecycle */
OBS_API obs_source_t *obs_source_create(const char *id, const char *name, obs_data_t *settings, obs_data_t *hotkey_data);
OBS_API void          obs_source_release(obs_source_t *source);
OBS_API obs_source_t *obs_source_get_ref(obs_source_t *source);
OBS_API void          obs_source_remove(obs_source_t *source);
OBS_API obs_source_t *obs_get_source_by_name(const char *name);

/* Source properties */
OBS_API const char   *obs_source_get_name(const obs_source_t *source);
OBS_API const char   *obs_source_get_id(const obs_source_t *source);
OBS_API uint32_t      obs_source_get_audio_mixers(const obs_source_t *source);
OBS_API void          obs_source_set_audio_mixers(obs_source_t *source, uint32_t mixers);

/* Source enumeration */
OBS_API void obs_enum_sources(obs_enum_sources_proc_t cb, void *data);

/* Scene */
OBS_API obs_scene_t      *obs_scene_create(const char *name);
OBS_API void              obs_scene_release(obs_scene_t *scene);
OBS_API obs_scene_t      *obs_scene_from_source(obs_source_t *source);
OBS_API obs_sceneitem_t  *obs_scene_add(obs_scene_t *scene, obs_source_t *source);
OBS_API void              obs_scene_enum_items(obs_scene_t *scene, obs_scene_enum_items_proc_t cb, void *param);
OBS_API obs_sceneitem_t  *obs_scene_find_sceneitem_by_id(obs_scene_t *scene, int64_t id);

/* Scene item */
OBS_API obs_source_t *obs_sceneitem_get_source(const obs_sceneitem_t *item);
OBS_API int64_t       obs_sceneitem_get_id(const obs_sceneitem_t *item);
OBS_API bool          obs_sceneitem_visible(const obs_sceneitem_t *item);
OBS_API void          obs_sceneitem_remove(obs_sceneitem_t *item);
OBS_API void          obs_sceneitem_set_pos(obs_sceneitem_t *item, const struct vec2 *pos);
OBS_API void          obs_sceneitem_set_alignment(obs_sceneitem_t *item, uint32_t alignment);
OBS_API void          obs_sceneitem_set_bounds_type(obs_sceneitem_t *item, enum obs_bounds_type type);
OBS_API void          obs_sceneitem_set_bounds_alignment(obs_sceneitem_t *item, uint32_t alignment);
OBS_API void          obs_sceneitem_set_bounds(obs_sceneitem_t *item, const struct vec2 *bounds);

/* Data (settings) */
OBS_API obs_data_t   *obs_data_create(void);
OBS_API void          obs_data_release(obs_data_t *data);
OBS_API void          obs_data_set_string(obs_data_t *data, const char *name, const char *val);
OBS_API void          obs_data_set_int(obs_data_t *data, const char *name, long long val);
OBS_API void          obs_data_set_bool(obs_data_t *data, const char *name, bool val);

/* Config (profile) */
OBS_API const char   *config_get_string(config_t *config, const char *section, const char *name);
OBS_API void          config_set_string(config_t *config, const char *section, const char *name, const char *value);
OBS_API int           config_save(config_t *config);

/* Logging: blogva is declared in obs-module.h — do not duplicate here. */

/* Memory */
OBS_API void bfree(void *ptr);

#ifdef __cplusplus
}
#endif
