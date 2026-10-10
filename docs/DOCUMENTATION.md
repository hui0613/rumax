# rumax 文档说明

`rumax` 是一个用 Rust 编写的 **Max Messenger 内部私有 API 客户端库**（crate 名 `rumax`，版本 `0.2.1`）。
它并非服务端，而是一个通过 WebSocket / TCP-TLS 与 Max 官方服务器通信、并按协议封装的客户端 SDK。

> ⚠️ **免责声明**：根据 `openmax-server.md`，当前实现**仅供测试与学习**，不适用于生产环境。

---

## 目录

1. [项目概述](#1-项目概述)
2. [项目结构](#2-项目结构)
3. [依赖与构建](#3-依赖与构建)
4. [架构设计](#4-架构设计)
5. [快速开始](#5-快速开始)
6. [核心 API](#6-核心-api)
7. [业务接口参考](#7-业务接口参考)
8. [数据模型](#8-数据模型)
9. [错误处理](#9-错误处理)
10. [示例与测试](#10-示例与测试)
11. [注意事项](#11-注意事项)

---

## 1. 项目概述

| 项 | 值 |
|----|----|
| 名称 | rumax |
| 版本 | 0.2.1 |
| 语言 / 版本 | Rust（edition 2021） |
| 类型 | 库（`[lib]`，非二进制） |
| 描述 | Rust client for the internal Max Messenger API |
| 仓库 | https://github.com/me0wkie/rumax |
| 许可 | MIT |
| 目标服务 | `wss://ws-api.oneme.ru/websocket`（Web） / `api2.oneme.ru:443`（Mobile） |

核心能力：

- **双传输通道**：Web（WebSocket + JSON/LZ4）与 Mobile（TCP + TLS + MessagePack）。
- **请求-响应模型**：基于 `seq` 序号的多路复用，`send_and_wait` 阻塞等待对应响应。
- **指纹伪装**：基于 APK 构建指纹生成 anti-fraud 参数，模拟真实移动客户端。
- **行为模拟**：随机导航图 + 遥测事件上报，模拟真人使用轨迹。
- **事件订阅**：通过广播通道 `subscribe()` 获取服务端推送与请求日志。

---

## 2. 项目结构

```
rumax/
├── Cargo.toml                 # 包定义、依赖、示例声明
├── README.md                  # 简要说明（俄文）
├── openmax-server.md          # 测试服务器证书/接入说明
├── assets/
│   ├── mobile_versions.json   # APK 版本指纹数据（供指纹生成器使用）
│   └── rootca_ssl_rsa2022.crt # 内置根证书（Mintsifry Root CA）
├── examples/                  # 可运行示例
│   ├── identity.rs            # 生成随机设备身份
│   ├── register.rs            # 注册全流程
│   ├── login.rs               # 登录
│   ├── token.rs               # 用 token 登录
│   └── media_test.rs          # 媒体上传测试
├── src/
│   ├── lib.rs                 # MaxClient 核心与会话管理
│   ├── constants.rs           # 端点、超时、UA 等常量
│   ├── errors.rs              # 统一错误类型 Error
│   ├── navigation.rs          # 导航图与行为规划器
│   ├── api/                   # 业务接口（按模块拆分）
│   │   ├── auth.rs            # 鉴权/注册/同步
│   │   ├── messaging.rs       # 消息
│   │   ├── chats.rs           # 聊天/群组/文件夹
│   │   ├── contacts.rs        # 联系人
│   │   ├── calls.rs           # 通话
│   │   ├── files.rs           # 文件与媒体上传
│   │   ├── stickers.rs        # 贴纸/表情
│   │   ├── channels.rs        # 频道
│   │   ├── bots.rs            # 机器人
│   │   ├── user.rs            # 用户/会话设置
│   │   └── telemetry.rs       # 遥测与行为模拟
│   ├── fingerprint/           # 客户端指纹生成
│   │   ├── fingerprint.rs
│   │   └── versions.rs
│   ├── models/                # 数据结构
│   │   ├── common.rs          # Request/Response/Identity/UserAgent
│   │   ├── history.rs         # FetchHistoryOptions
│   │   ├── keyboard.rs        # 内联键盘
│   │   ├── bot.rs             # BotCommand/BotInfo
│   │   ├── folder.rs          # ChatFolder
│   │   └── elements.rs        # 富文本样式
│   └── transport/             # 传输层抽象与实现
│       ├── mod.rs             # TransportReader/Writer trait
│       ├── web.rs             # WebSocket 实现
│       └── mobile.rs          # TCP/TLS + MessagePack 实现
└── tests/
    └── bot_keyboard_tests.rs  # 机器人键盘测试
```

---

## 3. 依赖与构建

### 主要依赖

| 依赖 | 用途 |
|------|------|
| `tokio` | 异步运行时 |
| `serde` / `serde_json` | JSON 序列化 |
| `rmpv` | MessagePack 编解码（Mobile 通道） |
| `yawc` | WebSocket 客户端（Web 通道） |
| `tokio-rustls` / `rustls` | TLS 支持 |
| `reqwest` | HTTP（文件上传、版本数据拉取） |
| `lz4_flex` | 压缩 |
| `sha2` / `hex` | 指纹哈希 |
| `chrono` | 时间戳 |
| `rand` | 随机身份/行为 |

### 构建

```sh
cargo build            # 构建库
cargo build --examples # 构建所有示例
```

### 常量（`src/constants.rs`）

| 常量 | 值 |
|------|----|
| `WEBSOCKET_URI` | `wss://ws-api.oneme.ru/websocket` |
| `MOBILE_HOST` | `api2.oneme.ru` |
| `MOBILE_PORT` | `443` |
| `ORIGIN_HEADER` | `https://web.max.ru` |
| `DEFAULT_TIMEOUT` | 10 秒 |
| `PING_INTERVAL` | 30 秒 |

---

## 4. 架构设计

### 4.1 分层

```
┌─────────────────────────────────────────────┐
│              MaxClient（lib.rs）              │
│  connect / send_and_wait / subscribe / call  │
├─────────────────────────────────────────────┤
│         api/*（业务接口，按 opcode 封装）      │
├─────────────────────────────────────────────┤
│   TransportReader / TransportWriter (trait)  │
│  ┌───────────────┐   ┌────────────────────┐  │
│  │  WebTransport │   │  MobileTransport   │  │
│  │  WebSocket    │   │  TCP + TLS + MsgPack│ │
│  └───────────────┘   └────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 4.2 请求-响应模型

- 每个请求携带自增 `seq`，`MaxClient` 用 `pending: HashMap<seq, oneshot::Sender>` 维护等待队列。
- `send_and_wait(opcode, payload, cmd)` 发送后等待对应 `seq` 的响应（默认 10s 超时）。
- 后台 `read_task` 读取响应：命中 `pending` 则回填 `oneshot`，否则作为**服务端推送**通过 `event_tx` 广播。
- 若响应 `payload` 含 `"error"` 字段，则返回 `Error::ApiResponse`。

### 4.3 心跳

`ping_task` 每 30 秒发送 opcode `1`（`{"interactive": true}`）保活；失败则关闭连接并清空所有 pending 请求。

### 4.4 握手

`connect(identity, is_mobile)` 建立连接后发送 opcode `6` 握手，从响应中提取 `callsSeed` 用于后续指纹生成。

### 4.5 指纹伪装（`fingerprint/`）

- Web 通道：不生成指纹。
- Mobile 通道：结合 `assets/mobile_versions.json` 中对应版本的 APK 构建指纹（证书/dex/so 的 SHA256）与 `callsSeed`、`deviceId` 计算指纹字节，放入 `request_code` 的 `mode` 字段。

### 4.6 行为模拟（`navigation.rs` + `api/telemetry.rs`）

- `NavigationPlanner` 基于带权导航图在 `Background/Chats/Chat/Search/Contacts/Calls/Settings/MiniApp` 各屏间随机游走，并模拟停顿与回退。
- `telemetry.rs` 周期性发送 `PERF` 遥测事件（opcode `5`），模拟登录、会话空闲、返回、渲染等行为。

---

## 5. 快速开始

### 5.1 创建客户端并连接

```rust
use std::sync::Arc;
use rumax::{MaxClient, models::Identity};

let client = Arc::new(MaxClient::new());

// identity 需包含 device_id / mt_instance / user_agent
let identity: Identity = /* 生成或加载 */;

// 第二个参数：true = Mobile(TCP/TLS)，false = Web(WebSocket)
client.connect(identity, true).await?;
```

### 5.2 注册流程（参考 `examples/register.rs`）

```rust
let resp = client.start_auth("+7XXXXXXXXXX".into()).await?; // opcode 17
let code = /* 用户输入短信验证码 */;
let resp = client.check_code(code).await?;                   // opcode 18
client.submit_register("Ivan".into(), None).await?;          // opcode 23
```

### 5.3 发送消息

```rust
let resp = client
    .send_message(chat_id, "Hello!".into(), None)   // opcode 64
    .await?;
```

### 5.4 订阅事件

```rust
let mut rx = client.subscribe();
while let Ok(event) = rx.recv().await {
    // event["type"] == "rx"  → 服务端推送
    // event["type"] == "log" → 请求/响应日志
}
```

---

## 6. 核心 API

`MaxClient`（`src/lib.rs`）主要方法：

| 方法 | 说明 |
|------|------|
| `new()` | 创建客户端 |
| `connect(identity, is_mobile)` | 建立连接并握手，返回握手响应 |
| `disconnect()` | 断开连接并重置状态 |
| `is_connected()` | 是否已连接 |
| `send_and_wait(opcode, payload, cmd)` | 发送请求并等待响应（底层通用方法） |
| `call(action_id, payload)` | `send_and_wait` 的别名 |
| `subscribe()` | 获取事件广播接收器 |
| `set_token(token)` / `set_temp_token(token)` / `get_token()` | token 管理 |
| `set_user_id()` | 设置当前用户 ID |
| `set_host(addr, port)` / `set_custom_ca(enabled, path)` / `enable_custom_ca(enabled)` | 自定义服务器与 CA |
| `set_telemetry_chats(chats)` | 设置遥测使用的聊天列表 |

---

## 7. 业务接口参考

> 下列方法均定义在 `impl MaxClient`，返回 `ClientResult<Response>`（部分上传方法返回 `serde_json::Value`）。
> 括号内为协议 opcode。

### 7.1 鉴权 `api/auth.rs`

| 方法 | opcode | 说明 |
|------|:---:|------|
| `start_auth(phone)` / `resend_auth(phone)` | 17 | 请求/重发验证码 |
| `check_code(code)` | 18 | 校验验证码 |
| `check_password(password, track_id)` | 115 | 两步验证 |
| `submit_register(first_name, last_name)` | 23 | 注册并保存 token |
| `sync(sync_state)` | 19 / 8 | 重登录与增量同步（含 Login2） |
| `qr_login_request()` | 288 | 请求二维码登录（返回 `QrLoginSession`） |
| `qr_login_poll(track_id)` | 289 | 单次轮询二维码状态（`status.loginAvailable`） |
| `qr_login_submit(track_id)` | 291 | 确认扫码后换取 token（`LOGIN_BY_QR`） |
| `qr_login_wait(&session)` | 289 + 291 | 轮询至 `loginAvailable`，然后换取 token 并写入客户端 |
| `qr_login_confirm(&session)` | 289 + 291 + 19 | 等待扫码并执行 LOGIN，完成授权 |

#### 7.1.1 二维码登录流程

对应 `max-api-docs` 与 PyMax 的 QR 授权流程（opcode 288 / 289 / 291）：

```
INIT (6) → QR_AUTH_REQUEST (288) → 展示二维码
        → 用户用 MAX App 扫码并确认
        → QR_AUTH_POLL (289) 轮询，直至 status.loginAvailable == true
        → LOGIN_BY_QR (291) {trackId} → 获取 tokenAttrs.LOGIN.token
        → LOGIN (19)
```

| 步骤 | 方法 | 说明 |
|------|------|------|
| 1 | `qr_login_request()` | 返回 `QrLoginSession { qr_link, track_id, polling_interval, ttl, expires_at }` |
| 2 | （调用方） | 将 `qr_link` 渲染为二维码展示给用户 |
| 3 | `qr_login_wait(&session)` | 按 `polling_interval` 轮询 289，检测到 `loginAvailable=true` 后调用 291（`qr_login_submit`）换取 token 并 `set_token` |
| 4 | `qr_login_confirm(&session)` | 在第 3 步基础上继续执行 `sync()`（LOGIN 19），之后即可使用其余全部功能 |

> - 错误 `track.not.found` 表示二维码已过期或已被使用，需重新调用 `qr_login_request()`。
> - 若服务器要求二次验证，291 的响应会含 `passwordChallenge`，此时需用其中的 `trackId` 调用 `check_password(password, track_id)`（opcode 115）。
> - 生成二维码图片可直接使用 `QrLoginSession.qr_link`（见 `examples/qr_login.rs`）。
> - QR 登录仅对 **WEB** 身份开放，请使用 `deviceType: "WEB"` 的身份并通过 WebSocket 连接（参见 `examples/qr_login.rs`）。
> - `sync()`（LOGIN 19）会根据身份自动选择 payload：**WEB** 使用精简的 `WebSyncPayload`（`token`/`chatsCount`/`interactive` 及各 `*Sync`，不含 `userAgent`/`exp`/`configHash`）；**移动端**使用带 `userAgent`、二进制指纹与 `exp` 的完整 payload。`LOGIN2`(8) 仅移动端执行。

`sync` 返回 `(Response, Option<Response>, SyncState)`，用于增量同步 `chatsSync/contactsSync/draftsSync/presenceSync` 与 `configHash`。

### 7.2 消息 `api/messaging.rs`

| 方法 | opcode |
|------|:---:|
| `send_message(chat_id, text, args)` | 64 |
| `add_reaction(chat_id, message_id, reaction)` | 178 |
| `remove_reaction(chat_id, message_id)` | 179 |
| `read_message(chat_id, message_id)` | 50 |
| `pin_message(chat_id, message_id, notify_pin)` | 55 |
| `delete_message(chat_id, message_id, for_me)` | 66 |
| `delete_messages(chat_id, message_ids, for_me)` | 66 |
| `edit_message(chat_id, message_id, text, attaches, elements)` | 67 |
| `fetch_history(chat_id, options)` | 49 |
| `get_video_by_id(chat_id, message_id, video_id, token)` | 83 |
| `get_file_by_id(chat_id, message_id, file_id)` | 88 |
| `request_transcription(chat_id, message_id, media_id)` | 202 |
| `get_complaint_reasons()` | 162 |
| `send_complaint(reason_id, type_id, ids, parent_id)` | 161 |

> `send_message` 支持通过 `args` 传入 `elements`、`attaches`、`link`、`replyTo`、`notify`、`cid` 等；
> 遇到 `not.ready` 错误会自动重试最多 60 次（每次间隔 1s）。

### 7.3 聊天 / 群组 / 文件夹 `api/chats.rs`

| 方法 | opcode |
|------|:---:|
| `search_public(query, count, search_type)` | 60 |
| `search_msg(query, count, marker)` | 68 |
| `get_chats(chat_ids)` | 48 |
| `create_group(title, participant_ids, notify)` | 64 |
| `delete_chat(chat_id, last_event_time, for_all)` | 52 |
| `leave_group(chat_id)` | 58 |
| `change_group_profile(chat_id, title, description)` | 55 |
| `set_chat_photo(chat_id, photo_token)` | 55 |
| `join_group(link)` | 57 |
| `resolve_group_by_link(link)` | 89 |
| `refresh_invite_link(chat_id)` | 55 |
| `confirm_join_requests(chat_id, user_ids, show_history)` | 77 |
| `decline_join_requests(chat_id, user_ids)` | 77 |
| `change_group_settings(...)` | 55 |
| `remove_users_from_group(chat_id, user_ids, clean_msg_period)` | 77 |
| `invite_users_to_group(chat_id, user_ids, show_history)` | 77 |
| `get_join_requests(chat_id)` | 59 |
| `set_chat_mute(chat_id, dont_disturb_until)` | 22 |
| `update_user_settings(settings)` | 22 |
| `get_folders(folder_sync)` | 272 |
| `get_folder_by_id(folder_ids)` | 273 |
| `update_folder(...)` | 274 |
| `reorder_folders(folders_order)` | 275 |
| `delete_folders(folder_ids)` | 276 |
| `get_chat_media(chat_id, message_id, attach_types, forward, backward)` | 51 |
| `assign_admin(chat_id, user_id, permissions, alias)` | 55 |
| `revoke_admin(chat_id, user_id)` | 55 |
| `clear_chat_history(chat_id, last_event_time, for_all)` | 54 |

### 7.4 联系人 `api/contacts.rs`

| 方法 | opcode |
|------|:---:|
| `sync_contacts()` | 8 |
| `get_by_phone(phone)` | 46 |
| `fetch_contacts(user_ids)` | 32 |
| `add_contact(user_id, first_name)` | 34 |
| `delete_contact(user_id)` | 34 |
| `get_contact_photos(contact_id, from, count)` | 39 |
| `remove_contact_photo(photo_id)` | 43 |

### 7.5 通话 `api/calls.rs`

| 方法 | opcode |
|------|:---:|
| `get_calls(forward, count)` | 79 |
| `start_outgoing_call(callee_id, is_video, conversation_id, internal_params)` | 78 |
| `open_conference(conversation_id)` | 76 |
| `enter_by_link(join_link, is_video, internal_params)` | 166 |
| `make_invite_link(conversation_id)` | 84 |
| `erase_call_records(history_ids)` | 164 |

### 7.6 文件上传 `api/files.rs`

| 方法 | opcode / 方式 |
|------|------|
| `get_photo_upload(count, profile)` | 80 |
| `get_video_upload(count, profile)` | 82 |
| `get_file_upload(count, profile)` | 87 |
| `get_audio_upload(count)` | 82 |
| `get_video_note_upload(count)` | 82 |
| `upload_photo(upload_url, file, file_name, mime)` | HTTP multipart |
| `upload_video(upload_url, video_id, token, file, file_name)` | HTTP octet-stream |
| `upload_file(upload_url, file_id, file, file_name)` | HTTP 流式上传 |

> 上传方法直接返回 `serde_json::Value`，错误以 `{"error": "..."}` 形式返回。

### 7.7 贴纸 / 表情 `api/stickers.rs`

| 方法 | opcode |
|------|:---:|
| `get_sticker_sections(sync)` | 27 |
| `get_favorite_stickers(sync)` | 27 |
| `get_animoji_sets(sync)` | 27 |
| `get_assets_section(section_id, from, count)` | 26 |
| `get_assets_by_ids(asset_type, ids)` | 28 |
| `add_favorite_sticker_set(set_id)` | 29 |
| `remove_favorite_sticker_set(set_id)` | 259 |
| `move_asset(asset_type, id, position)` | 260 |
| `resolve_link(link)` | 89 |
| `send_sticker_message(chat_id, sticker_id, notify)` | 64 |

### 7.8 频道 `api/channels.rs`

| 方法 | opcode |
|------|:---:|
| `join_channel(link)` | 57（复用加入群组） |
| `leave_channel(chat_id)` | 58（复用退出群组） |
| `resolve_channel_by_name(link)` | 89 |
| `get_members(chat_id, count, marker)` | 59 |
| `find_members(chat_id, query)` | 59 |

### 7.9 机器人 `api/bots.rs`

| 方法 | opcode |
|------|:---:|
| `send_button_callback(chat_id, message_id, callback_id, payload)` | 118 |
| `send_bot_start(chat_id, start_payload)` | 64 |
| `get_bot_info(bot_id)` | 145 |
| `get_chat_bot_commands(chat_id)` | 144 |
| `suspend_bot(bot_id)` | 119 |
| `open_web_app(bot_id, start_param, chat_id)` | 160 |
| `share_phone_with_bot(bot_id)` | 106 |
| `submit_external_callback(url)` | 105 |

### 7.10 用户 / 会话 `api/user.rs`

| 方法 | opcode |
|------|:---:|
| `logout()` | 20 |
| `get_sessions()` | 96 |
| `close_all_sessions()` | 97 |
| `update_profile(first_name, last_name, description, avatar_token)` | 16 |
| `set_profile_photo(photo_token)` | 16 |

### 7.11 遥测 `api/telemetry.rs`

| 方法 | 说明 |
|------|------|
| `set_telemetry_chats(chats)` | 设置遥测涉及的聊天 |
| `spawn_telemetry_task()` | 启动遥测/行为模拟后台任务 |
| `send_events(...)`（内部） | 上报事件，opcode 5 |

---

## 8. 数据模型

`src/models/` 主要类型：

| 类型 | 文件 | 说明 |
|------|------|------|
| `Request` | `common.rs` | `{ver, cmd, seq, opcode, payload}` |
| `Response` | `common.rs` | `{ver, cmd, seq, opcode, payload}` |
| `Identity` | `common.rs` | `{device_id, mt_instance, user_agent}` |
| `UserAgent` | `common.rs` | 设备类型、App 版本、OS、时区、分辨率、架构、区域等 |
| `SyncState` | `api/auth.rs` | 各域同步时间戳与 `config_hash` |
| `Login2Flags` | `api/auth.rs` | 是否需要 profile/contact/config 补充拉取 |
| `FetchHistoryOptions` | `history.rs` | 历史消息拉取参数（forward/backward、itemType 等） |
| `InlineKeyboardButton` / `InlineKeyboardLayout` / `InlineKeyboardAttachment` | `keyboard.rs` | 内联键盘 |
| `BotCommand` / `BotInfo` | `bot.rs` | 机器人命令与信息 |
| `ChatFolder` / `FoldersPayload` | `folder.rs` | 聊天文件夹 |
| `RichTextStyle` | `elements.rs` | 富文本样式（加粗/斜体/链接/提及等） |
| `TelemetryChat` | `api/telemetry.rs` | 遥测聊天项 `{chat_id, chat_type}` |
| `QrLoginSession` | `api/auth.rs` | 二维码登录会话 `{qr_link, track_id, polling_interval, ttl, expires_at}` |

---

## 9. 错误处理

统一错误类型 `Error`（`src/errors.rs`），别名 `ClientResult<T> = Result<T, Error>`：

| 变体 | 说明 |
|------|------|
| `NotConnected` | 未连接 |
| `ConnectionFailed(String)` | 连接失败 |
| `ConnectionClosed(String)` | 连接关闭 |
| `SendFailed(String)` | 发送失败 |
| `ParseError(serde_json::Error)` | 解析错误 |
| `RequestTimeout(Duration)` | 请求超时（默认 10s） |
| `ApiResponse(Value)` | 服务端返回 `error` 字段 |
| `OneshotRecvError` / `IoError` / `TauriError` / `Other` | 其他错误 |

辅助方法：`Error::kind()->&str`、`Error::to_json()->Value`（便于前端/日志序列化）。

---

## 10. 示例与测试

### 运行示例

```sh
# 注册（首次使用）
cargo run --example register

# 二维码扫码登录
cargo run --example qr_login

# 登录
cargo run --example login

# 使用已保存 token 登录（需 .session.token 文件）
cargo run --example token

# 媒体上传测试
cargo run --example media_test
```

调试日志：

```sh
RUST_LOG=debug cargo run --example register
```

### 配置文件约定

| 文件 | 说明 |
|------|------|
| `.device.id` | 设备身份（`Identity` 的 JSON） |
| `.session.token` | 会话 token |
| `assets/mobile_versions.json` | APK 版本指纹数据 |

### 测试

```sh
cargo test
```

`tests/bot_keyboard_tests.rs` 覆盖机器人内联键盘相关逻辑。

---

## 11. 注意事项

1. **仅供测试**：当前实现对 `openmax-server` 的兼容**不适用于生产环境**。
2. **自定义服务器/CA**：可通过 `set_host` 与 `set_custom_ca` 指向自建测试服务器与证书。
3. **指纹依赖版本数据**：Mobile 通道的 `request_code` 需要 `assets/mobile_versions.json` 中存在对应 `app_version`，否则会报错。
4. **超时与重试**：默认请求超时 10 秒；`send_message` 对 `not.ready` 自动重试。
5. **连接保活**：心跳失败会自动关闭连接并使所有 pending 请求返回 `ConnectionClosed`。
6. **合规使用**：请遵守目标服务的使用条款与当地法律法规，仅将本项目用于授权范围内的测试与研究。
