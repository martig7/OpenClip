/*
 * OpenClip OBS Plugin — HTTP Server
 *
 * A minimal, single-connection-at-a-time HTTP/1.1 server bound to 127.0.0.1.
 * Accepts POST /api requests with a JSON body { method, params } and returns
 * JSON responses. Only serves the Electron desktop app on localhost.
 */

#include "http-server.h"
#include "api-handlers.h"

#include <obs-module.h>
#include <cJSON.h>

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <process.h>  /* _beginthreadex */
#else
#include <pthread.h>
#include <signal.h>
#include <sys/time.h>  /* struct timeval for SO_RCVTIMEO */
#endif

/* ── State ────────────────────────────────────────────────────────────────── */

static volatile bool server_running = false;
static socket_t      listen_sock    = INVALID_SOCK;
static uint16_t      server_port    = 0;

#ifdef _WIN32
static HANDLE server_thread = NULL;
#else
static pthread_t server_thread;
static bool      thread_created = false;
#endif

/* ── Helpers ──────────────────────────────────────────────────────────────── */

static void send_all(socket_t sock, const char *buf, int len)
{
	int sent = 0;
	while (sent < len) {
		int n = send(sock, buf + sent, len - sent, 0);
		if (n <= 0)
			break;
		sent += n;
	}
}

static void send_json_response(socket_t sock, int status_code,
			       const char *status_text, const char *json_body)
{
	char header[512];
	int body_len = (int)strlen(json_body);
	int hdr_len = snprintf(header, sizeof(header),
		"HTTP/1.1 %d %s\r\n"
		"Content-Type: application/json\r\n"
		"Content-Length: %d\r\n"
		"Connection: close\r\n"
		"\r\n",
		status_code, status_text, body_len);

	/* Clamp hdr_len to the valid buffer range */
	if (hdr_len < 0)
		hdr_len = 0;
	else if (hdr_len >= (int)sizeof(header))
		hdr_len = (int)sizeof(header) - 1;
	header[hdr_len] = '\0';

	send_all(sock, header, hdr_len);
	send_all(sock, json_body, body_len);
}

static void send_cors_preflight(socket_t sock)
{
	/* The plugin API is only called by the local Electron app via Node.js
	 * HTTP (no browser CORS required). Reject cross-origin preflight
	 * requests entirely to reduce the attack surface. */
	const char *resp =
		"HTTP/1.1 403 Forbidden\r\n"
		"Connection: close\r\n"
		"Content-Length: 0\r\n"
		"\r\n";
	send_all(sock, resp, (int)strlen(resp));
}

static void send_error(socket_t sock, int code, const char *status,
		       const char *message)
{
	cJSON *obj = cJSON_CreateObject();
	if (!obj) {
		send_json_response(sock, code, status,
				   "{\"success\":false,\"error\":\"internal error\"}");
		return;
	}
	cJSON_AddBoolToObject(obj, "success", 0);
	cJSON_AddStringToObject(obj, "error", message);
	char *json = cJSON_PrintUnformatted(obj);
	if (!json) {
		cJSON_Delete(obj);
		send_json_response(sock, code, status,
				   "{\"success\":false,\"error\":\"internal error\"}");
		return;
	}
	send_json_response(sock, code, status, json);
	free(json);
	cJSON_Delete(obj);
}

/* ── Request parsing ──────────────────────────────────────────────────────── */

/* Read the full HTTP request into a buffer.  Returns total bytes read. */
static int recv_request(socket_t sock, char *buf, int buf_size)
{
	int total = 0;
	int content_length = -1;
	int header_end = -1;

	while (total < buf_size - 1) {
		int n = recv(sock, buf + total, buf_size - 1 - total, 0);
		if (n <= 0)
			break;
		total += n;
		buf[total] = '\0';

		/* Look for end of headers */
		if (header_end < 0) {
			char *hdr_end = strstr(buf, "\r\n\r\n");
			if (hdr_end) {
				header_end = (int)(hdr_end - buf) + 4;

				/* Extract Content-Length */
				const char *cl = strstr(buf, "Content-Length:");
				if (!cl)
					cl = strstr(buf, "content-length:");
				if (cl)
					content_length = atoi(cl + 15);
				else
					content_length = 0;
			}
		}

		/* Stop once we have the full body */
		if (header_end >= 0 && content_length >= 0) {
			/* Guard against header_end + content_length overflow */
			size_t h = (size_t)header_end;
			size_t cl = (size_t)content_length;
			if (cl > (size_t)(buf_size - 1) || h > (size_t)(buf_size - 1) - cl) {
				/* Content-Length would overflow or exceed buffer — treat as oversized request */
				const char *resp =
					"HTTP/1.1 413 Payload Too Large\r\n"
					"Connection: close\r\n"
					"Content-Length: 0\r\n"
					"\r\n";
				send_all(sock, resp, (int)strlen(resp));
				/* Signal error to caller; do not attempt to parse truncated body */
				total = -1;
				break;
			}
			int expected = header_end + content_length;
			if (total >= expected)
				break;
		}
	}
	return total;
}

/* Parse method and path from the request line.
 * Returns pointer to body (past \r\n\r\n) or NULL. */
static const char *parse_request(const char *buf, char *method, int method_sz,
				 char *path, int path_sz)
{
	/* Request line: "POST /api HTTP/1.1\r\n..." */
	const char *sp1 = strchr(buf, ' ');
	if (!sp1)
		return NULL;
	int mlen = (int)(sp1 - buf);
	if (mlen >= method_sz)
		mlen = method_sz - 1;
	memcpy(method, buf, mlen);
	method[mlen] = '\0';

	const char *sp2 = strchr(sp1 + 1, ' ');
	if (!sp2)
		return NULL;
	int plen = (int)(sp2 - sp1 - 1);
	if (plen >= path_sz)
		plen = path_sz - 1;
	memcpy(path, sp1 + 1, plen);
	path[plen] = '\0';

	const char *body = strstr(buf, "\r\n\r\n");
	return body ? body + 4 : NULL;
}

/* ── Request handler ──────────────────────────────────────────────────────── */

static void handle_client(socket_t client)
{
	char *buf = malloc(HTTP_MAX_BODY + 4096);
	if (!buf) {
		closesocket(client);
		return;
	}

	int n = recv_request(client, buf, HTTP_MAX_BODY + 4096);
	if (n <= 0) {
		free(buf);
		closesocket(client);
		return;
	}

	char method[16], req_path[256];
	const char *body = parse_request(buf, method, sizeof(method),
					 req_path, sizeof(req_path));

	/* CORS preflight */
	if (strcmp(method, "OPTIONS") == 0) {
		send_cors_preflight(client);
		free(buf);
		closesocket(client);
		return;
	}

	/* Health check: GET / */
	if (strcmp(method, "GET") == 0 &&
	    (strcmp(req_path, "/") == 0 || strcmp(req_path, "/health") == 0)) {
		cJSON *resp = api_dispatch("getStatus", NULL);
		if (!resp) {
			send_error(client, 500, "Internal Server Error",
				   "getStatus returned no data");
			free(buf);
			closesocket(client);
			return;
		}
		char *json = cJSON_PrintUnformatted(resp);
		cJSON_Delete(resp);
		if (!json) {
			send_error(client, 500, "Internal Server Error",
				   "Failed to serialize status");
			free(buf);
			closesocket(client);
			return;
		}
		send_json_response(client, 200, "OK", json);
		free(json);
		free(buf);
		closesocket(client);
		return;
	}

	/* Main API: POST /api */
	if (strcmp(method, "POST") != 0 || strcmp(req_path, "/api") != 0) {
		send_error(client, 404, "Not Found",
			   "Use POST /api with JSON body");
		free(buf);
		closesocket(client);
		return;
	}

	if (!body || body[0] == '\0') {
		send_error(client, 400, "Bad Request", "Empty request body");
		free(buf);
		closesocket(client);
		return;
	}

	cJSON *req_json = cJSON_Parse(body);
	if (!req_json) {
		send_error(client, 400, "Bad Request", "Invalid JSON");
		free(buf);
		closesocket(client);
		return;
	}

	const cJSON *method_item = cJSON_GetObjectItem(req_json, "method");
	if (!cJSON_IsString(method_item) || !method_item->valuestring[0]) {
		send_error(client, 400, "Bad Request",
			   "Missing or empty \"method\" field");
		cJSON_Delete(req_json);
		free(buf);
		closesocket(client);
		return;
	}

	const cJSON *params = cJSON_GetObjectItem(req_json, "params");

	/* Dispatch to API handler (runs OBS calls on UI thread) */
	cJSON *response = api_dispatch(method_item->valuestring, params);
	if (!response) {
		send_error(client, 500, "Internal Server Error",
			   "API handler returned no response");
		cJSON_Delete(req_json);
		free(buf);
		closesocket(client);
		return;
	}

	char *resp_json = cJSON_PrintUnformatted(response);
	if (!resp_json) {
		cJSON_Delete(response);
		send_error(client, 500, "Internal Server Error",
			   "Failed to serialize response");
		cJSON_Delete(req_json);
		free(buf);
		closesocket(client);
		return;
	}

	send_json_response(client, 200, "OK", resp_json);

	free(resp_json);
	cJSON_Delete(response);
	cJSON_Delete(req_json);
	free(buf);
	closesocket(client);
}

/* ── Server thread ────────────────────────────────────────────────────────── */

static
#ifdef _WIN32
unsigned __stdcall
#else
void *
#endif
server_thread_func(void *arg)
{
	(void)arg;
	blog(LOG_INFO, "[openclip] HTTP server thread started");

	while (server_running) {
		struct sockaddr_in addr;
		int addr_len = sizeof(addr);
		socket_t client = accept(listen_sock, (struct sockaddr *)&addr,
#ifdef _WIN32
					 &addr_len
#else
					 (socklen_t *)&addr_len
#endif
		);

		if (client == INVALID_SOCK) {
			if (!server_running)
				break;
			continue;
		}

		/* Set a 10-second timeout on the client socket */
#ifdef _WIN32
		DWORD tv = 10000;
#else
		struct timeval tv = {10, 0};
#endif
		setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, (const char *)&tv,
			   sizeof(tv));

		handle_client(client);
	}

	blog(LOG_INFO, "[openclip] HTTP server thread exiting");
#ifdef _WIN32
	return 0;
#else
	return NULL;
#endif
}

/* ── Public API ───────────────────────────────────────────────────────────── */

uint16_t http_server_start(void)
{
#ifdef _WIN32
	WSADATA wsa;
	if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
		blog(LOG_ERROR, "[openclip] WSAStartup failed");
		return 0;
	}
#endif

	listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if (listen_sock == INVALID_SOCK) {
		blog(LOG_ERROR, "[openclip] Failed to create socket");
#ifdef _WIN32
		WSACleanup();
#endif
		return 0;
	}

	/* Allow rapid restart */
	int opt = 1;
	setsockopt(listen_sock, SOL_SOCKET, SO_REUSEADDR, (const char *)&opt,
		   sizeof(opt));

	/* Try binding on the default port, then successive ports */
	struct sockaddr_in addr;
	memset(&addr, 0, sizeof(addr));
	addr.sin_family = AF_INET;
	addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); /* 127.0.0.1 only */

	uint16_t port = 0;
	for (int i = 0; i < OPENCLIP_MAX_PORTS; i++) {
		addr.sin_port = htons(OPENCLIP_DEFAULT_PORT + i);
		if (bind(listen_sock, (struct sockaddr *)&addr,
			 sizeof(addr)) == 0) {
			port = OPENCLIP_DEFAULT_PORT + (uint16_t)i;
			break;
		}
	}

	if (port == 0) {
		blog(LOG_ERROR,
		     "[openclip] Could not bind to any port in range %d-%d",
		     OPENCLIP_DEFAULT_PORT,
		     OPENCLIP_DEFAULT_PORT + OPENCLIP_MAX_PORTS - 1);
		closesocket(listen_sock);
		listen_sock = INVALID_SOCK;
#ifdef _WIN32
		WSACleanup();
#endif
		return 0;
	}

	if (listen(listen_sock, 4) != 0) {
		blog(LOG_ERROR, "[openclip] listen() failed");
		closesocket(listen_sock);
		listen_sock = INVALID_SOCK;
#ifdef _WIN32
		WSACleanup();
#endif
		return 0;
	}

	server_port = port;
	server_running = true;

#ifdef _WIN32
	server_thread = (HANDLE)_beginthreadex(NULL, 0, server_thread_func,
					       NULL, 0, NULL);
	if (!server_thread) {
		blog(LOG_ERROR, "[openclip] Failed to create server thread");
		server_running = false;
		closesocket(listen_sock);
		listen_sock = INVALID_SOCK;
		return 0;
	}
#else
	if (pthread_create(&server_thread, NULL, server_thread_func, NULL) != 0) {
		blog(LOG_ERROR, "[openclip] Failed to create server thread");
		server_running = false;
		closesocket(listen_sock);
		listen_sock = INVALID_SOCK;
		return 0;
	}
	thread_created = true;
#endif

	return port;
}

void http_server_stop(void)
{
	if (!server_running)
		return;

	server_running = false;

	/* Close the listening socket to unblock accept() */
	if (listen_sock != INVALID_SOCK) {
		closesocket(listen_sock);
		listen_sock = INVALID_SOCK;
	}

#ifdef _WIN32
	if (server_thread) {
		WaitForSingleObject(server_thread, 5000);
		CloseHandle(server_thread);
		server_thread = NULL;
	}
	WSACleanup();
#else
	if (thread_created) {
		pthread_join(server_thread, NULL);
		thread_created = false;
	}
#endif

	server_port = 0;
}

uint16_t http_server_port(void)
{
	return server_port;
}
