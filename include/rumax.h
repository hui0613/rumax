/*
 * rumax.h — C ABI for the rumax Max Messenger client.
 *
 * This header is hand-written to match src/ffi.rs. It can also be regenerated
 * with cbindgen (see cbindgen.toml):
 *
 *     cargo install cbindgen
 *     cbindgen --config cbindgen.toml --crate rumax --output include/rumax.h
 *
 * Conventions:
 *  - Every `char*` returned by the library must be freed with `rumax_string_free`.
 *  - `out_error` (when non-NULL on success) receives NULL; on failure it receives
 *    an error JSON string `{ "type": "...", "text": "..." }` (also free it).
 *  - Blocking functions must NOT be called from inside the event callback.
 */
#ifndef RUMAX_H
#define RUMAX_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque client handle. */
typedef struct RumaxClient RumaxClient;

/*
 * Event callback, invoked for every server push / log event.
 *
 * `source` identifies the emitting library and is defined by that library
 * (for rumax it is always "mas.rumax"). It lets one global listener that is
 * shared by several native libraries tell the origins apart.
 * `event_json` is UTF-8 JSON and is only valid for the duration of the call.
 * `user_data` is the pointer passed to rumax_client_set_event_callback.
 * The callback runs on a Rust runtime thread: do not block and do not call the
 * blocking API from inside it.
 *
 * Event JSON shapes:
 *   { "type": "rx",  "response": { "ver":10, "cmd":0, "seq":0, "opcode":128, "payload": {...} } }
 *   { "type": "log", "request":  {...} }
 *   { "type": "log", "response": {...} }
 */
typedef void (*rumax_event_cb)(const char* source, const char* event_json, void* user_data);

/* ------------------------------- lifecycle ------------------------------- */

RumaxClient* rumax_client_new(void);
void         rumax_client_free(RumaxClient* c);

/* --------------------------- configuration/state -------------------------- */

/* Connect + handshake (opcode 6). `is_mobile`: true = TCP/TLS, false = WebSocket.
 * Returns 0 on success, non-zero on failure. */
int  rumax_client_connect(RumaxClient* c, const char* identity_json, bool is_mobile, char** out_error);

void rumax_client_disconnect(RumaxClient* c);
bool rumax_client_is_connected(const RumaxClient* c);

void  rumax_client_set_host(RumaxClient* c, const char* host, uint16_t port);
void  rumax_client_set_custom_ca(RumaxClient* c, bool enabled, const char* cert_path);
void  rumax_client_set_token(RumaxClient* c, const char* token);
char* rumax_client_get_token(RumaxClient* c);
void  rumax_client_set_user_id(RumaxClient* c, uint64_t user_id);

/* ------------------------------ generic call ------------------------------ */

/* Send an arbitrary request (blocking). Returns the Response JSON, or NULL on
 * failure (see out_error). `payload_json` may be NULL or "{}" for empty. */
char* rumax_client_call(RumaxClient* c, uint16_t opcode, const char* payload_json, char** out_error);

/* --------------------------------- events --------------------------------- */

/* Install (or clear, when cb == NULL) the event callback. */
void rumax_client_set_event_callback(RumaxClient* c, rumax_event_cb cb, void* user_data);

/* --------------------------- high-level helpers --------------------------- */

/* Generate a random WEB identity (required for QR login) as JSON. */
int rumax_generate_web_identity(char** out_identity_json, char** out_error);

/* Log in with an existing token (LOGIN 19 + optional LOGIN2 8).
 * `sync_state_json` may be NULL. Returns the LOGIN response JSON. */
int rumax_client_login_by_token(RumaxClient* c, const char* sync_state_json,
                                char** out_login_json, char** out_error);

/* Request a QR code (opcode 288). Returns the QrLoginSession JSON. */
int rumax_qr_login_request(RumaxClient* c, char** out_session_json, char** out_error);

/* Wait for the QR scan and complete login (289 + 291 + LOGIN 19).
 * `session_json` is the value returned by rumax_qr_login_request.
 * Returns the LOGIN response JSON. */
int rumax_qr_login_confirm(RumaxClient* c, const char* session_json,
                           char** out_login_json, char** out_error);

/* Send a text message (opcode 64) — convenience wrapper. */
int rumax_send_message(RumaxClient* c, int64_t chat_id, const char* text,
                       char** out_response_json, char** out_error);

/* ------------------------------- utilities -------------------------------- */

/* Free a string returned by this library. NULL is ignored. */
void rumax_string_free(char* s);

/* Library version (static string, do NOT free). */
const char* rumax_version(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* RUMAX_H */
