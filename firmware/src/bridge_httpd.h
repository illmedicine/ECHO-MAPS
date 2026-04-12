/**
 * Bridge HTTP server for local network communication with Echo Vue web app.
 */
#pragma once

/* Start the HTTP server for local discovery and control */
void bridge_httpd_start(void);

/* Stop the HTTP server */
void bridge_httpd_stop(void);
