/*
 * Minimal obs-module.h stub — declares only what OpenClip needs.
 * These are public OBS API signatures (MIT-licensed).
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <stdarg.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── Logging ────────────────────────────────────────────────────────────── */
enum { LOG_ERROR = 100, LOG_WARNING = 200, LOG_INFO = 300, LOG_DEBUG = 400 };

__declspec(dllimport) void blogva(int log_level, const char *format, va_list args);

#ifndef blog
static inline void blog(int level, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    blogva(level, fmt, ap);
    va_end(ap);
}
#endif

/* ── Module macros ──────────────────────────────────────────────────────── */

typedef struct obs_module obs_module_t;

/* OBS looks for these exported symbols when loading a plugin DLL.
 * obs_module_set_pointer is REQUIRED — without it OBS rejects the DLL
 * as "not an OBS plugin". */
#define OBS_DECLARE_MODULE()                                                    \
    static obs_module_t *obs_module_pointer;                                    \
    __declspec(dllexport) void obs_module_set_pointer(obs_module_t *module) {   \
        obs_module_pointer = module;                                            \
    }                                                                           \
    __declspec(dllexport) uint32_t obs_module_ver(void) {                       \
        return (32 << 24) | (0 << 16) | 0;                                      \
    }

#define MODULE_EXPORT __declspec(dllexport)

#define OBS_MODULE_USE_DEFAULT_LOCALE(name, lang) /* no-op for our purposes */

#ifdef __cplusplus
}
#endif
