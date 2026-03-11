/*
 * OpenClip OBS Plugin — HTTP Server Header
 *
 * Minimal HTTP/1.1 server that listens on localhost and routes JSON-RPC style
 * requests to the API handler layer.
 */

#ifndef OPENCLIP_HTTP_SERVER_H
#define OPENCLIP_HTTP_SERVER_H

#include <stdbool.h>
#include <stdint.h>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
typedef SOCKET socket_t;
#define INVALID_SOCK INVALID_SOCKET
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
typedef int socket_t;
#define INVALID_SOCK (-1)
#define closesocket close
#endif

/* Default port; falls back to next available if in use */
#define OPENCLIP_DEFAULT_PORT 28756
#define OPENCLIP_MAX_PORTS    10

/* Maximum HTTP request body size (256 KB) */
#define HTTP_MAX_BODY (256 * 1024)

/* Start the HTTP server on a background thread.  Returns the port actually
 * bound, or 0 on failure.  The server runs until http_server_stop() is called. */
uint16_t http_server_start(void);

/* Signal the server to shut down and wait for the thread to exit. */
void http_server_stop(void);

/* Returns the port the server is listening on, or 0 if not running. */
uint16_t http_server_port(void);

#endif /* OPENCLIP_HTTP_SERVER_H */
