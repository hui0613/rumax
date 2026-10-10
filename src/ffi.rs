//! C ABI (FFI) layer for calling the rumax client from C / C++.
//!
//! Design notes:
//! - A single opaque handle [`RumaxClient`] owns a multi-threaded tokio runtime
//!   plus the underlying [`MaxClient`].
//! - All data crosses the boundary as UTF-8 JSON strings (payloads are
//!   `serde_json::Value` anyway), so there is no struct / ABI marshalling.
//! - Blocking calls use `Runtime::block_on`. Server pushes are delivered through
//!   a C callback invoked on a runtime worker thread.
//! - Every `char*` returned to the caller must be released with
//!   [`rumax_string_free`].
//!
//! See `include/rumax.h` for the C declaration and `examples/cpp_demo` for usage.

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::sync::{Arc, Mutex, OnceLock};

use rand::Rng;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::models::{Identity, UserAgent};
use crate::{MaxClient, QrLoginSession, SyncState};

/// Callback invoked for every server push / log event (UTF-8 JSON).
///
/// `event_json` is only valid for the duration of the call — copy it if you need
/// to keep it. The callback runs on a Rust runtime thread: do not block, and do
/// not call [`rumax_client_call`] from inside it (it would deadlock); use a
/// background queue or the async variant instead.
#[allow(non_camel_case_types)]
pub type rumax_event_cb =
    Option<unsafe extern "C" fn(event_json: *const c_char, user_data: *mut c_void)>;

struct EventSink {
    cb: rumax_event_cb,
    user: *mut c_void,
}

// Safety: the sink only stores raw pointers provided by the caller; it is guarded
// by a Mutex and accessed from the runtime thread. Ownership is the caller's
// responsibility (the pointers must stay valid while the callback is installed).
unsafe impl Send for EventSink {}
unsafe impl Sync for EventSink {}

/// Opaque client handle (`RumaxClient*`).
pub struct RumaxClient {
    runtime: tokio::runtime::Runtime,
    client: Arc<MaxClient>,
    sink: Arc<Mutex<EventSink>>,
    event_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

fn err_json(kind: &str, text: &str) -> String {
    json!({ "type": kind, "text": text }).to_string()
}

fn to_c_string(s: String) -> *mut c_char {
    match CString::new(s) {
        Ok(c) => c.into_raw(),
        Err(_) => CString::new(err_json("Other", "string contained a NUL byte"))
            .expect("static string is valid")
            .into_raw(),
    }
}

/// Writes an optional owned string into an out-parameter (`char**`).
unsafe fn write_out(out: *mut *mut c_char, value: Option<String>) {
    if !out.is_null() {
        *out = match value {
            Some(s) => to_c_string(s),
            None => ptr::null_mut(),
        };
    }
}

unsafe fn cstr_opt(p: *const c_char) -> Option<String> {
    if p.is_null() {
        return None;
    }
    CStr::from_ptr(p).to_str().ok().map(|s| s.to_string())
}

unsafe fn parse_payload(p: *const c_char) -> Value {
    match cstr_opt(p) {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(&s).unwrap_or_else(|_| json!({})),
        _ => json!({}),
    }
}

fn random_uuid_like<R: rand::Rng>(rng: &mut R) -> String {
    let mut b: [u8; 16] = rng.gen();
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13],
        b[14], b[15]
    )
}

fn gen_web_identity() -> Identity {
    const TIMEZONES: &[&str] = &[
        "Europe/Moscow",
        "Europe/Kaliningrad",
        "Asia/Yekaterinburg",
        "Asia/Novosibirsk",
        "Asia/Yakutsk",
        "Asia/Vladivostok",
    ];
    let mut rng = rand::thread_rng();
    let tz = TIMEZONES[rng.gen_range(0..TIMEZONES.len())];

    Identity {
        device_id: random_uuid_like(&mut rng),
        mt_instance: random_uuid_like(&mut rng),
        user_agent: UserAgent {
            device_type: "WEB".to_string(),
            app_version: "26.6.17".to_string(),
            os_version: "Linux".to_string(),
            timezone: tz.to_string(),
            screen: "1080x1920 1.0x".to_string(),
            push_device_type: Some("WEBPUSH".to_string()),
            arch: None,
            locale: "ru".to_string(),
            build_number: 0,
            device_name: "Firefox".to_string(),
            device_locale: "ru".to_string(),
            release: None,
            header_user_agent: Some(
                "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0"
                    .to_string(),
            ),
        },
    }
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

/// Creates a client. Returns NULL on failure.
#[no_mangle]
pub extern "C" fn rumax_client_new() -> *mut RumaxClient {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(_) => return ptr::null_mut(),
    };

    let handle = RumaxClient {
        runtime,
        client: Arc::new(MaxClient::new()),
        sink: Arc::new(Mutex::new(EventSink {
            cb: None,
            user: ptr::null_mut(),
        })),
        event_task: Mutex::new(None),
    };

    Box::into_raw(Box::new(handle))
}

/// Destroys the client: disconnects, stops background tasks and frees memory.
#[no_mangle]
pub unsafe extern "C" fn rumax_client_free(c: *mut RumaxClient) {
    if c.is_null() {
        return;
    }
    let handle = Box::from_raw(c);

    if let Some(task) = handle.event_task.lock().unwrap().take() {
        task.abort();
    }

    let client = Arc::clone(&handle.client);
    let _ = catch_unwind(AssertUnwindSafe(|| {
        handle.runtime.block_on(async move { client.disconnect().await })
    }));

    drop(handle);
}

// ---------------------------------------------------------------------------
// configuration / state
// ---------------------------------------------------------------------------

/// Connects and performs the handshake (opcode 6).
/// `is_mobile`: 1 = TCP/TLS (MessagePack), 0 = WebSocket (JSON).
/// Returns 0 on success, non-zero on failure (details in `out_error`).
#[no_mangle]
pub unsafe extern "C" fn rumax_client_connect(
    c: *mut RumaxClient,
    identity_json: *const c_char,
    is_mobile: bool,
    out_error: *mut *mut c_char,
) -> i32 {
    write_out(out_error, None);
    if c.is_null() {
        write_out(out_error, Some(err_json("NotConnected", "null client handle")));
        return -1;
    }
    let handle = &*c;

    let res = catch_unwind(AssertUnwindSafe(|| {
        let s = cstr_opt(identity_json)
            .ok_or_else(|| err_json("Other", "identity_json is null or invalid UTF-8"))?;
        let identity: Identity = serde_json::from_str(&s)
            .map_err(|e| err_json("ParseError", &format!("invalid identity JSON: {e}")))?;
        handle
            .runtime
            .block_on(handle.client.connect(identity, is_mobile))
            .map(|_| ())
            .map_err(|e| e.to_json().to_string())
    }));

    match res {
        Ok(Ok(())) => 0,
        Ok(Err(msg)) => {
            write_out(out_error, Some(msg));
            -1
        }
        Err(_) => {
            write_out(out_error, Some(err_json("Other", "panic in connect")));
            -1
        }
    }
}

/// Disconnects and resets state.
#[no_mangle]
pub unsafe extern "C" fn rumax_client_disconnect(c: *mut RumaxClient) {
    if c.is_null() {
        return;
    }
    let handle = &*c;
    let client = Arc::clone(&handle.client);
    let _ = catch_unwind(AssertUnwindSafe(|| {
        handle.runtime.block_on(async move { client.disconnect().await })
    }));
}

/// Returns whether the client is currently connected.
#[no_mangle]
pub unsafe extern "C" fn rumax_client_is_connected(c: *const RumaxClient) -> bool {
    if c.is_null() {
        return false;
    }
    let handle = &*c;
    handle.runtime.block_on(handle.client.is_connected())
}

/// Overrides the server host/port (useful for test servers).
#[no_mangle]
pub unsafe extern "C" fn rumax_client_set_host(
    c: *mut RumaxClient,
    host: *const c_char,
    port: u16,
) {
    if c.is_null() {
        return;
    }
    if let Some(h) = cstr_opt(host) {
        let handle = &*c;
        handle.runtime.block_on(handle.client.set_host(h, port));
    }
}

/// Enables/disables a custom root CA. `cert_path` may be NULL to use the built-in CA.
#[no_mangle]
pub unsafe extern "C" fn rumax_client_set_custom_ca(
    c: *mut RumaxClient,
    enabled: bool,
    cert_path: *const c_char,
) {
    if c.is_null() {
        return;
    }
    let path = cstr_opt(cert_path);
    let handle = &*c;
    handle.runtime.block_on(handle.client.set_custom_ca(enabled, path));
}

/// Sets the login token.
#[no_mangle]
pub unsafe extern "C" fn rumax_client_set_token(c: *mut RumaxClient, token: *const c_char) {
    if c.is_null() {
        return;
    }
    if let Some(t) = cstr_opt(token) {
        let handle = &*c;
        handle.runtime.block_on(handle.client.set_token(t));
    }
}

/// Returns the current token, or NULL. Release with [`rumax_string_free`].
#[no_mangle]
pub unsafe extern "C" fn rumax_client_get_token(c: *mut RumaxClient) -> *mut c_char {
    if c.is_null() {
        return ptr::null_mut();
    }
    let handle = &*c;
    match handle.runtime.block_on(handle.client.get_token()) {
        Some(t) => to_c_string(t),
        None => ptr::null_mut(),
    }
}

/// Sets the current user id (used by telemetry).
#[no_mangle]
pub unsafe extern "C" fn rumax_client_set_user_id(c: *mut RumaxClient, user_id: u64) {
    if c.is_null() {
        return;
    }
    let handle = &*c;
    handle.runtime.block_on(handle.client.set_user_id(user_id));
}

// ---------------------------------------------------------------------------
// generic request
// ---------------------------------------------------------------------------

/// Sends an arbitrary request (blocking) and returns the `Response` as JSON.
///
/// - `payload_json` may be NULL or `{}` for an empty payload.
/// - On success returns a `char*` (free with [`rumax_string_free`]).
/// - On failure returns NULL and writes an error JSON to `out_error`.
#[no_mangle]
pub unsafe extern "C" fn rumax_client_call(
    c: *mut RumaxClient,
    opcode: u16,
    payload_json: *const c_char,
    out_error: *mut *mut c_char,
) -> *mut c_char {
    write_out(out_error, None);
    if c.is_null() {
        write_out(out_error, Some(err_json("NotConnected", "null client handle")));
        return ptr::null_mut();
    }
    let handle = &*c;
    let payload = parse_payload(payload_json);

    let res = catch_unwind(AssertUnwindSafe(|| {
        match handle
            .runtime
            .block_on(handle.client.send_and_wait(opcode, payload, 0))
        {
            Ok(resp) => serde_json::to_string(&resp)
                .map_err(|e| err_json("ParseError", &e.to_string())),
            Err(e) => Err(e.to_json().to_string()),
        }
    }));

    match res {
        Ok(Ok(s)) => to_c_string(s),
        Ok(Err(msg)) => {
            write_out(out_error, Some(msg));
            ptr::null_mut()
        }
        Err(_) => {
            write_out(out_error, Some(err_json("Other", "panic in call")));
            ptr::null_mut()
        }
    }
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

/// Installs (or clears, when `cb` is null) the event callback.
#[no_mangle]
pub unsafe extern "C" fn rumax_client_set_event_callback(
    c: *mut RumaxClient,
    cb: rumax_event_cb,
    user_data: *mut c_void,
) {
    if c.is_null() {
        return;
    }
    let handle = &*c;

    {
        let mut sink = handle.sink.lock().unwrap();
        sink.cb = cb;
        sink.user = user_data;
    }

    if let Some(task) = handle.event_task.lock().unwrap().take() {
        task.abort();
    }
    if cb.is_none() {
        return;
    }

    let mut rx = handle.client.subscribe();
    let sink = Arc::clone(&handle.sink);
    let task = handle.runtime.spawn(async move {
        loop {
            match rx.recv().await {
                Ok(value) => {
                    let text = value.to_string();
                    let (cb, user) = {
                        let guard = sink.lock().unwrap();
                        (guard.cb, guard.user)
                    };
                    if let Some(cb) = cb {
                        if let Ok(cstr) = CString::new(text) {
                            cb(cstr.as_ptr(), user);
                        }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    *handle.event_task.lock().unwrap() = Some(task);
}

// ---------------------------------------------------------------------------
// high-level convenience
// ---------------------------------------------------------------------------

/// Generates a random WEB identity (required for QR login). Returns JSON.
#[no_mangle]
pub unsafe extern "C" fn rumax_generate_web_identity(
    out_identity_json: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> i32 {
    write_out(out_identity_json, None);
    write_out(out_error, None);
    match serde_json::to_string(&gen_web_identity()) {
        Ok(s) => {
            write_out(out_identity_json, Some(s));
            0
        }
        Err(e) => {
            write_out(out_error, Some(err_json("ParseError", &e.to_string())));
            -1
        }
    }
}

/// Logs in with an existing token (LOGIN 19 + optional LOGIN2 8).
/// `sync_state_json` may be NULL. Returns the LOGIN response as JSON.
#[no_mangle]
pub unsafe extern "C" fn rumax_client_login_by_token(
    c: *mut RumaxClient,
    sync_state_json: *const c_char,
    out_login_json: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> i32 {
    write_out(out_login_json, None);
    write_out(out_error, None);
    if c.is_null() {
        write_out(out_error, Some(err_json("NotConnected", "null client handle")));
        return -1;
    }
    let handle = &*c;

    let state: Option<SyncState> = match cstr_opt(sync_state_json) {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(&s).ok(),
        _ => None,
    };

    let res = catch_unwind(AssertUnwindSafe(|| {
        match handle.runtime.block_on(handle.client.sync(state)) {
            Ok((login, _login2, _state)) => serde_json::to_string(&login)
                .map_err(|e| err_json("ParseError", &e.to_string())),
            Err(e) => Err(e.to_json().to_string()),
        }
    }));

    match res {
        Ok(Ok(s)) => {
            write_out(out_login_json, Some(s));
            0
        }
        Ok(Err(msg)) => {
            write_out(out_error, Some(msg));
            -1
        }
        Err(_) => {
            write_out(out_error, Some(err_json("Other", "panic in login_by_token")));
            -1
        }
    }
}

/// Requests a QR code (opcode 288). Returns `QrLoginSession` JSON.
#[no_mangle]
pub unsafe extern "C" fn rumax_qr_login_request(
    c: *mut RumaxClient,
    out_session_json: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> i32 {
    write_out(out_session_json, None);
    write_out(out_error, None);
    if c.is_null() {
        write_out(out_error, Some(err_json("NotConnected", "null client handle")));
        return -1;
    }
    let handle = &*c;

    let res = catch_unwind(AssertUnwindSafe(|| {
        match handle.runtime.block_on(handle.client.qr_login_request()) {
            Ok(session) => serde_json::to_string(&session)
                .map_err(|e| err_json("ParseError", &e.to_string())),
            Err(e) => Err(e.to_json().to_string()),
        }
    }));

    match res {
        Ok(Ok(s)) => {
            write_out(out_session_json, Some(s));
            0
        }
        Ok(Err(msg)) => {
            write_out(out_error, Some(msg));
            -1
        }
        Err(_) => {
            write_out(out_error, Some(err_json("Other", "panic in qr_login_request")));
            -1
        }
    }
}

/// Waits for the QR scan and completes login (289 + 291 + LOGIN 19).
/// `session_json` is the value returned by [`rumax_qr_login_request`].
/// Returns the LOGIN response as JSON.
#[no_mangle]
pub unsafe extern "C" fn rumax_qr_login_confirm(
    c: *mut RumaxClient,
    session_json: *const c_char,
    out_login_json: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> i32 {
    write_out(out_login_json, None);
    write_out(out_error, None);
    if c.is_null() {
        write_out(out_error, Some(err_json("NotConnected", "null client handle")));
        return -1;
    }
    let handle = &*c;

    let res = catch_unwind(AssertUnwindSafe(|| {
        let s = cstr_opt(session_json)
            .ok_or_else(|| err_json("ParseError", "session_json is null or invalid UTF-8"))?;
        let session: QrLoginSession = serde_json::from_str(&s)
            .map_err(|e| err_json("ParseError", &format!("invalid session JSON: {e}")))?;
        match handle.runtime.block_on(handle.client.qr_login_confirm(&session)) {
            Ok((login, _state)) => serde_json::to_string(&login)
                .map_err(|e| err_json("ParseError", &e.to_string())),
            Err(e) => Err(e.to_json().to_string()),
        }
    }));

    match res {
        Ok(Ok(s)) => {
            write_out(out_login_json, Some(s));
            0
        }
        Ok(Err(msg)) => {
            write_out(out_error, Some(msg));
            -1
        }
        Err(_) => {
            write_out(out_error, Some(err_json("Other", "panic in qr_login_confirm")));
            -1
        }
    }
}

/// Convenience wrapper for sending a text message (opcode 64).
#[no_mangle]
pub unsafe extern "C" fn rumax_send_message(
    c: *mut RumaxClient,
    chat_id: i64,
    text: *const c_char,
    out_response_json: *mut *mut c_char,
    out_error: *mut *mut c_char,
) -> i32 {
    write_out(out_response_json, None);
    write_out(out_error, None);
    if c.is_null() {
        write_out(out_error, Some(err_json("NotConnected", "null client handle")));
        return -1;
    }
    let text = match cstr_opt(text) {
        Some(t) => t,
        None => {
            write_out(out_error, Some(err_json("Other", "text is null or invalid UTF-8")));
            return -1;
        }
    };
    let handle = &*c;

    let res = catch_unwind(AssertUnwindSafe(|| {
        match handle
            .runtime
            .block_on(handle.client.send_message(chat_id, text, None))
        {
            Ok(resp) => serde_json::to_string(&resp)
                .map_err(|e| err_json("ParseError", &e.to_string())),
            Err(e) => Err(e.to_json().to_string()),
        }
    }));

    match res {
        Ok(Ok(s)) => {
            write_out(out_response_json, Some(s));
            0
        }
        Ok(Err(msg)) => {
            write_out(out_error, Some(msg));
            -1
        }
        Err(_) => {
            write_out(out_error, Some(err_json("Other", "panic in send_message")));
            -1
        }
    }
}

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------

/// Frees a string previously returned by this library. NULL is ignored.
#[no_mangle]
pub unsafe extern "C" fn rumax_string_free(s: *mut c_char) {
    if !s.is_null() {
        let _ = CString::from_raw(s);
    }
}

/// Returns the library version (static string, do NOT free).
#[no_mangle]
pub extern "C" fn rumax_version() -> *const c_char {
    static VERSION: OnceLock<CString> = OnceLock::new();
    VERSION
        .get_or_init(|| CString::new(env!("CARGO_PKG_VERSION")).unwrap_or_default())
        .as_ptr()
}
