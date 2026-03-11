/*
 * OpenClip OBS Plugin — Entry Point
 *
 * Registers the plugin with OBS, starts the embedded HTTP API server, and
 * writes a port-file so the Electron app can discover the server address.
 */

#include <obs-module.h>
#include <obs-frontend-api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#ifdef _WIN32
#include <direct.h>  /* _mkdir */
#else
#include <sys/stat.h> /* mkdir */
#endif

#include "http-server.h"

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("openclip-obs", "en-US")

/* ── Port / marker file helpers ───────────────────────────────────────────── */

static char port_file_path[512]   = {0};
static char marker_file_path[512] = {0};

static void build_runtime_paths(void)
{
#ifdef _WIN32
	const char *appdata = getenv("APPDATA");
	if (!appdata)
		appdata = ".";
	snprintf(port_file_path, sizeof(port_file_path),
		 "%s\\open-clip\\runtime\\plugin_port", appdata);
	snprintf(marker_file_path, sizeof(marker_file_path),
		 "%s\\open-clip\\runtime\\plugin_loaded", appdata);
#else
	const char *home = getenv("HOME");
	if (!home)
		home = "/tmp";
	snprintf(port_file_path, sizeof(port_file_path),
		 "%s/.config/open-clip/runtime/plugin_port", home);
	snprintf(marker_file_path, sizeof(marker_file_path),
		 "%s/.config/open-clip/runtime/plugin_loaded", home);
#endif
}

/* Ensure parent directory of filepath exists, creating intermediate directories
 * as needed.  Uses native OS APIs — no shell invocation. */
static void ensure_parent_dir(const char *filepath)
{
	char dir[512];
	strncpy(dir, filepath, sizeof(dir) - 1);
	dir[sizeof(dir) - 1] = '\0';

	/* Walk backwards to find the last path separator */
	size_t len = strlen(dir);
	while (len > 0 && dir[len - 1] != '/' && dir[len - 1] != '\\')
		len--;
	if (len == 0)
		return;
	dir[len] = '\0';

	/* Walk forward and create each missing component */
	for (size_t i = 1; i <= len; i++) {
		if (i == len || dir[i] == '/' || dir[i] == '\\') {
			char sep = dir[i];
			dir[i] = '\0';
#ifdef _WIN32
			int rc = _mkdir(dir);
#else
			int rc = mkdir(dir, 0755);
#endif
			if (rc != 0 && errno != EEXIST)
				blog(LOG_WARNING,
				     "[openclip] mkdir failed for '%s': %d",
				     dir, errno);
			dir[i] = sep;
		}
	}
}

static void write_port_file(uint16_t port)
{
	ensure_parent_dir(port_file_path);
	FILE *f = fopen(port_file_path, "w");
	if (f) {
		fprintf(f, "%u", (unsigned)port);
		fclose(f);
	}
}

static void write_marker_file(void)
{
	ensure_parent_dir(marker_file_path);
	FILE *f = fopen(marker_file_path, "w");
	if (f) {
		fprintf(f, "1");
		fclose(f);
	}
}

static void remove_runtime_files(void)
{
	if (port_file_path[0])
		remove(port_file_path);
	if (marker_file_path[0])
		remove(marker_file_path);
}

/* ── OBS module callbacks ─────────────────────────────────────────────────── */

MODULE_EXPORT bool obs_module_load(void)
{
	blog(LOG_INFO, "[openclip] Loading OpenClip plugin v%s",
	     OPENCLIP_OBS_VERSION);

	build_runtime_paths();

	uint16_t port = http_server_start();
	if (port == 0) {
		blog(LOG_ERROR,
		     "[openclip] Failed to start HTTP server — plugin disabled");
		return true; /* return true so OBS doesn't show an error dialog */
	}

	blog(LOG_INFO, "[openclip] HTTP API listening on localhost:%u", port);

	write_port_file(port);
	write_marker_file();

	return true;
}

MODULE_EXPORT void obs_module_unload(void)
{
	blog(LOG_INFO, "[openclip] Unloading OpenClip plugin");

	http_server_stop();
	remove_runtime_files();
}

MODULE_EXPORT const char *obs_module_name(void)
{
	return "OpenClip";
}

MODULE_EXPORT const char *obs_module_description(void)
{
	return "OpenClip game-recording integration — provides an HTTP API for "
	       "scene management, recording control, and audio routing.";
}
