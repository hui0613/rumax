# rumax C++ 业务接口使用指南

> 本文档逐个说明如何从 C++ 调用 rumax 的业务接口。
> 除少数专用函数外，**所有业务调用都走通用原语**：
>
> ```c
> char* rumax_client_call(RumaxClient* c, uint16_t opcode, const char* payload_json, char** out_error);
> ```
>
> - 第 2 个参数是 opcode（协议命令号），第 3 个参数是请求 payload 的 JSON。
> - 成功返回 `Response` 的 JSON：`{"ver":10,"cmd":1,"seq":..,"opcode":..,"payload":{...}}`，**业务数据在 `payload` 里**；返回值需用 `rumax_string_free` 释放。
> - 失败返回 `NULL`，错误 JSON 写入 `out_error`（形如 `{"type":"ApiResponse","text":"..."}`），同样用 `rumax_string_free` 释放。
> - 需要登录后才能调用的接口，请先完成登录（QR / token / SMS）。
>
> **ID 类型**：`chatId` = `int64`，`userId`/`contactId` = `int64`，`messageId`/`videoId`/`fileId` = `uint64`。
> **示例中的 `c` 均为 `RumaxClient*`，`err` 为 `char*`。**

---

## 0. 通用调用封装（推荐先看一眼）

```cpp
// 调用并返回 payload 的 JSON 字符串（失败抛异常）。这里用 nlohmann/json 简化，仅供参考。
#include <rumax.h>
#include <stdexcept>
#include <string>

static std::string Call(RumaxClient* c, uint16_t opcode, const std::string& payload) {
    char* err = nullptr;
    char* resp = rumax_client_call(c, opcode, payload.c_str(), &err);
    if (!resp) {
        std::string msg = err ? err : "unknown error";
        if (err) rumax_string_free(err);
        throw std::runtime_error(msg);
    }
    std::string s = resp;
    rumax_string_free(resp);
    return s;                       // 形如 {"ver":10,"cmd":1,...,"payload":{...}}
}
```

---

## 1. 会话与群组（chats）

| 功能 | opcode |
|------|:---:|
| 全局搜索（用户/群/频道） | 60 |
| 搜索消息 | 68 |
| 按 ID 拉取会话 | 48 |
| 创建群组 | 64 |
| 删除会话 | 52 |
| 退出群组 | 58 |
| 修改群资料（标题/描述） | 55 |
| 设置群头像 | 55 |
| 通过链接加入 | 57 |
| 解析群/频道链接 | 89 |
| 刷新邀请链接 | 55 |
| 确认入群申请 | 77 |
| 拒绝入群申请 | 77 |
| 修改群设置 | 55 |
| 移除成员 | 77 |
| 邀请成员 | 77 |
| 获取入群申请 | 59 |
| 会话免打扰 | 22 |
| 更新用户设置 | 22 |
| 获取文件夹 | 272 |
| 按 ID 获取文件夹 | 273 |
| 更新文件夹 | 274 |
| 重排文件夹 | 275 |
| 删除文件夹 | 276 |
| 获取聊天媒体 | 51 |
| 设置管理员 | 55 |
| 撤销管理员 | 55 |
| 清空聊天记录 | 54 |

**示例：**

```cpp
// 全局搜索（type 可为 "ALL"/"USER"/"CHAT"/"CHANNEL" 等）
Call(c, 60, R"({"query":"max","count":20,"type":"ALL"})");

// 搜索消息（marker 可省略，用于分页）
Call(c, 68, R"({"query":"hello","count":50})");

// 按 ID 拉取会话（空的 chatIds 表示拉取全部会话）
Call(c, 48, R"({"chatIds":[]})");
Call(c, 48, R"({"chatIds":[1234567890]})");

// 创建群组（participant_ids 可选）
Call(c, 64, R"({"message":{"cid":1,"attaches":[{"_type":"CONTROL","event":"new","chatType":"CHAT","title":"My group","userIds":[111,222]}]},"notify":true})");

// 删除 / 清空 / 退出
Call(c, 52, R"({"chatId":1234567890,"lastEventTime":0,"forAll":false})"); // 删除会话
Call(c, 54, R"({"chatId":1234567890,"lastEventTime":0,"forAll":false})"); // 清空记录
Call(c, 58, R"({"chatId":1234567890})");                                  // 退出群组

// 修改资料 / 头像
Call(c, 55, R"({"chatId":1234567890,"theme":"New title","description":"desc"})");
Call(c, 55, R"({"chatId":1234567890,"photoToken":"<token-from-upload>"})");

// 链接相关
Call(c, 57, R"({"link":"https://max.ru/join/xxxx"})");       // 加入
Call(c, 89, R"({"link":"https://max.ru/xxxx"})");            // 解析
Call(c, 55, R"({"chatId":1234567890,"revokePrivateLink":true})"); // 刷新邀请链接

// 入群申请
Call(c, 59, R"({"chatId":1234567890,"type":"JOIN_REQUEST","count":100})");            // 获取
Call(c, 77, R"({"chatId":1234567890,"userIds":[111,222],"type":"JOIN_REQUEST","showHistory":true,"operation":"add"})");    // 确认
Call(c, 77, R"({"chatId":1234567890,"userIds":[111],"operation":"remove"})");         // 拒绝

// 成员管理
Call(c, 77, R"({"chatId":1234567890,"userIds":[111],"showHistory":true,"operation":"add"})");              // 邀请
Call(c, 77, R"({"chatId":1234567890,"userIds":[111],"operation":"remove","cleanMsgPeriod":0})");          // 移除

// 群设置（只需传要修改的字段）
Call(c, 55, R"({"chatId":1234567890,"options":{"allCanPinMessage":true,"onlyAdminCanAddMember":true}})");

// 管理员
Call(c, 55, R"({"chatId":1234567890,"adminParticipants":{"111":{"permissions":["DELETE_MESSAGE","PIN_MESSAGE"],"alias":"mod"}}})");
Call(c, 55, R"({"chatId":1234567890,"adminParticipants":{"111":null}})");                 // 撤销

// 免打扰 / 用户设置
Call(c, 22, R"({"settings":{"chats":{"1234567890":{"dontDisturbUntil":0}}}})");
Call(c, 22, R"({"settings":{"user":{"SOMETHING":true}}})");

// 文件夹
Call(c, 272, R"({"folderSync":0})");
Call(c, 273, R"({"folderIds":["folder-1"]})");
Call(c, 274, R"({"id":"folder-1","title":"Work","include":[],"filters":[],"options":[],"favorites":[]})");
Call(c, 275, R"({"foldersOrder":["folder-1","folder-2"]})");
Call(c, 276, R"({"folderIds":["folder-2"]})");

// 聊天媒体（attachTypes 如 ["PHOTO","VIDEO","FILE"]）
Call(c, 51, R"({"chatId":1234567890,"messageId":0,"attachTypes":["PHOTO"],"forward":0,"backward":50})");
```

> 说明：`get_chats`(48) 是**按 ID 拉取**；若想获取"会话列表"，同样是发 48 并带上要拉取的 `chatIds`，或在登录（LOGIN 19）的响应里直接拿到 `payload.chats`。

---

## 2. 消息（messaging）

| 功能 | opcode |
|------|:---:|
| 发送消息 | 64 |
| 添加表情回应 | 178 |
| 移除表情回应 | 179 |
| 已读回执 | 50 |
| 置顶消息 | 55 |
| 删除消息 | 66 |
| 编辑消息 | 67 |
| 拉取历史 | 49 |
| 取视频下载地址 | 83 |
| 取文件下载地址 | 88 |
| 请求语音转写 | 202 |
| 获取投诉理由 | 162 |
| 投诉 | 161 |

```cpp
// 发送文本（注意 message.cid 为客户端消息 id，建议用负数时间戳避免重复）
Call(c, 64, R"({"chatId":1234567890,"message":{"text":"Hello","cid":-1,"isLive":false,"detectShare":false,"elements":[],"attaches":[]},"notify":true})");

// 回复某条消息（在 message 里加 link）
Call(c, 64, R"({"chatId":1234567890,"message":{"text":"OK","cid":-2,"elements":[],"attaches":[],"link":{"type":"REPLY","messageId":1001}},"notify":true})");

// 表情回应 / 移除
Call(c, 178, R"({"chatId":1234567890,"messageId":1001,"reaction":{"reactionType":"EMOJI","id":"👍"}})");
Call(c, 179, R"({"chatId":1234567890,"messageId":1001})");

// 已读
Call(c, 50, R"({"type":"READ_MESSAGE","chatId":1234567890,"messageId":1001,"mark":0})");

// 置顶 / 删除 / 编辑
Call(c, 55, R"({"chatId":1234567890,"notifyPin":true,"pinMessageId":1001})");
Call(c, 66, R"({"chatId":1234567890,"messageIds":[1001,1002],"forMe":false})");
Call(c, 67, R"({"chatId":1234567890,"messageId":1001,"text":"edited","elements":[],"attaches":[]})");

// 历史（from 为毫秒时间戳，缺省=当前；backward 表示向前拉多少条）
Call(c, 49, R"({"chatId":1234567890,"forward":0,"backward":40,"backwardTime":0,"forwardTime":0,"getChat":false,"itemType":"REGULAR","getMessages":true,"interactive":false})");

// 媒体下载地址
Call(c, 83, R"({"chatId":1234567890,"messageId":1001,"videoId":555})");
Call(c, 88, R"({"chatId":1234567890,"messageId":1001,"fileId":666})");

// 语音转写 / 投诉
Call(c, 202, R"({"chatId":1234567890,"messageId":1001,"mediaId":777})");
Call(c, 162, R"({"complainSync":0})");
Call(c, 161, R"({"reasonId":1,"typeId":1,"ids":[1001]})");
```

> `rumax_send_message(c, chat_id, text, ...)` 是 opcode 64 的便捷封装，内部对 `not.ready` 会自动重试。

---

## 3. 联系人（contacts）

| 功能 | opcode |
|------|:---:|
| 同步联系人 | 8 |
| 按手机号查找 | 46 |
| 按 ID 拉取联系人 | 32 |
| 添加联系人 | 34 |
| 删除联系人 | 34 |
| 获取联系人头像列表 | 39 |
| 删除联系人头像 | 43 |

```cpp
// 同步联系人
Call(c, 8, R"({"contactsSync":0})");

// 按手机号查找（国际格式）
Call(c, 46, R"({"phone":"+8613800000000"})");

// 按用户 ID 批量拉取联系人资料
Call(c, 32, R"({"contactIds":[111,222,333]})");

// 添加 / 删除联系人
Call(c, 34, R"({"contactId":111,"firstName":"Alice","action":"ADD"})");
Call(c, 34, R"({"contactId":111,"action":"REMOVE"})");

// 头像列表 / 删除头像
Call(c, 39, R"({"contactId":111,"from":0,"count":20})");
Call(c, 43, R"({"photoId":999})");
```

> 想"获取所有联系人"：先 `sync_contacts`(8) 触发/更新同步，再用登录响应或 `fetch_contacts`(32) 取资料。协议没有单独的"列出全部联系人"opcode。

---

## 4. 频道（channels）

| 功能 | opcode |
|------|:---:|
| 加入频道 | 57 |
| 退出频道 | 58 |
| 按名称解析频道 | 89 |
| 获取成员 | 59 |
| 搜索成员 | 59 |

```cpp
Call(c, 57, R"({"link":"https://max.ru/channel-name"})");           // 加入
Call(c, 58, R"({"chatId":-1234567890})");                            // 退出（频道 chatId 常为负）
Call(c, 89, R"({"link":"https://max.ru/channel-name"})");            // 解析
Call(c, 59, R"({"type":"MEMBER","chatId":-1234567890,"count":100})");// 成员（marker 可选分页）
Call(c, 59, R"({"type":"MEMBER","query":"alice","chatId":-1234567890})"); // 搜索成员
```

---

## 5. 通话（calls）

| 功能 | opcode |
|------|:---:|
| 通话记录 | 79 |
| 发起去电 | 78 |
| 打开会议 | 76 |
| 通过链接进入 | 166 |
| 生成邀请链接 | 84 |
| 删除通话记录 | 164 |

```cpp
Call(c, 79, R"({"forward":true,"count":50})");
Call(c, 78, R"({"conversationId":"conv-1","calleeIds":[111],"internalParams":"{}","isVideo":false})");
Call(c, 76, R"({"conversationId":"conv-1"})");
Call(c, 166, R"({"joinLink":"https://max.ru/call/xxx","internalParams":"{}","isVideo":true})");
Call(c, 84, R"({"conversationId":"conv-1"})");
Call(c, 164, R"({"historyIds":[1,2,3]})");
```

---

## 6. 贴纸 / 表情（stickers）

| 功能 | opcode |
|------|:---:|
| 贴纸分区 | 27 |
| 收藏贴纸 | 27 |
| Animoji 集 | 27 |
| 资产分区 | 26 |
| 按 ID 取资产 | 28 |
| 收藏贴纸集 | 29 |
| 取消收藏贴纸集 | 259 |
| 移动资产位置 | 260 |
| 解析链接 | 89 |
| 发送贴纸消息 | 64 |

```cpp
Call(c, 27, R"({"type":"STICKER","sync":0})");
Call(c, 27, R"({"type":"FAVORITE_STICKER","sync":0})");
Call(c, 27, R"({"type":"ANIMOJI_SET","sync":0})");
Call(c, 26, R"({"sectionId":"section-1","from":0,"count":50})");
Call(c, 28, R"({"type":"STICKER","ids":[1,2,3]})");
Call(c, 29, R"({"type":"FAVORITE_STICKER_SET","id":5})");
Call(c, 259, R"({"type":"FAVORITE_STICKER_SET","ids":[5]})");
Call(c, 260, R"({"type":"STICKER","id":1,"position":0})");
Call(c, 64, R"({"chatId":1234567890,"message":{"cid":-3,"text":"","elements":[],"attaches":[{"_type":"STICKER","stickerId":42}]},"notify":true})");
```

---

## 7. 机器人（bots）

| 功能 | opcode |
|------|:---:|
| 按钮回调 | 118 |
| 启动机器人（/start） | 64 |
| 机器人信息 | 145 |
| 机器人命令列表 | 144 |
| 暂停机器人 | 119 |
| 打开 WebApp | 160 |
| 与机器人共享手机号 | 106 |
| 外部回调 | 105 |

```cpp
Call(c, 118, R"({"chatId":1234567890,"messageId":1001,"callbackId":"btn-1","payload":"extra"})");
Call(c, 64, R"({"chatId":1234567890,"message":{"cid":-4,"attaches":[{"_type":"CONTROL","event":"botStarted","startPayload":"ref"}]}})");
Call(c, 145, R"({"botId":111})");
Call(c, 144, R"({"chatId":1234567890})");
Call(c, 119, R"({"botId":111})");
Call(c, 160, R"({"botId":111,"startParam":"p","chatId":1234567890})");
Call(c, 106, R"({"botId":111})");
Call(c, 105, R"({"url":"https://example.com/cb"})");
```

---

## 8. 用户 / 会话（user）

| 功能 | opcode |
|------|:---:|
| 退出登录 | 20 |
| 会话列表 | 96 |
| 关闭其它所有会话 | 97 |
| 更新资料 | 16 |
| 设置头像 | 16 |

```cpp
// 退出登录：先断开再发 20（Rust 版 logout 会先 disconnect）
rumax_client_call(c, 20, "{}", &err);
rumax_client_disconnect(c);

// 会话列表 / 关闭其它会话
Call(c, 96, R"({})");
Call(c, 97, R"({})");

// 更新资料（description / photoToken / avatarType 可选）
Call(c, 16, R"({"firstName":"Hui","lastName":"Zhong","description":"hi"})");
Call(c, 16, R"({"photoToken":"<token>","avatarType":"USER_AVATAR"})");
```

---

## 9. 文件与媒体（files）

### 9.1 获取上传位（opcode，走通用 call）

```cpp
Call(c, 80, R"({"count":1,"profile":false})");                 // 图片上传 URL
Call(c, 82, R"({"uploaderType":0,"type":0,"count":1})");       // 视频上传 URL
Call(c, 82, R"({"uploaderType":1,"type":2,"count":1})");       // 音频上传 URL
Call(c, 82, R"({"uploaderType":1,"type":1,"count":1})");       // 视频消息上传 URL
Call(c, 87, R"({"count":1,"profile":false})");                 // 文件上传 URL
```

返回里包含 `url` 与 `fileId`/`photoToken` 等，用于第 9.2 步。

### 9.2 实际上传（**暂无 C 接口**）

`upload_photo` / `upload_video` / `upload_file` 是 **HTTP 上传**（不是 opcode），当前 FFI **尚未导出**。
如需在 C++ 侧上传，可选：
- 用 C++ 的 HTTP 库（libcurl 等）自行 POST 到 9.1 拿到的 `url`；
- 或等我补齐 `rumax_upload_photo/...`（见文末）。

---

## 10. 鉴权与登录（auth）

### 10.1 已有专用函数

```cpp
// 生成 WEB 身份（QR 登录必需）
char* identity = nullptr, * err = nullptr;
rumax_generate_web_identity(&identity, &err);

// 连接（false = WebSocket）
rumax_client_connect(c, identity, /*is_mobile=*/false, &err);

// 二维码登录
char* session = nullptr;
rumax_qr_login_request(c, &session, &err);          // opcode 288，返回含 qrLink/trackId
// ...展示二维码、用户扫码确认...
char* login = nullptr;
rumax_qr_login_confirm(c, session, &login, &err);   // 289 + 291 + LOGIN 19（阻塞）

// 用已有 token 登录
rumax_client_set_token(c, "<token>");
char* login2 = nullptr;
rumax_client_login_by_token(c, nullptr, &login2, &err);   // LOGIN 19 (+8)
```

### 10.2 短信验证码登录（**暂无 C 接口**）

`start_auth`(17) / `resend_auth`(17) / `check_code`(18) / `check_password`(115) / `submit_register`(23) 依赖内部状态（指纹 `mode`、`temp_token`、自动 `set_token`）。
若直接用 `rumax_client_call(17/18, ...)`，会缺少指纹与 token 保存，**不建议**。→ 见文末「可补齐项」。

---

## 11. 事件 / 推送

```cpp
static void on_event(const char* json, void* /*ud*/) {
    // 服务端推送：{"type":"rx","response":{...}}
    // 收发日志：  {"type":"log",...}
    std::printf("[event] %s\n", json);
}
rumax_client_set_event_callback(c, on_event, nullptr);
```

> 回调运行在 Rust 线程：**不要**在其中调用阻塞的 `rumax_client_call`。

---

## 12. 专用函数一览（非通用 call）

| 函数 | 作用 |
|------|------|
| `rumax_client_new` / `rumax_client_free` | 创建 / 销毁客户端 |
| `rumax_client_connect` / `rumax_client_disconnect` / `rumax_client_is_connected` | 连接管理（握手 opcode 6） |
| `rumax_client_set_host` / `rumax_client_set_custom_ca` | 自定义服务器与 CA |
| `rumax_client_set_token` / `rumax_client_get_token` / `rumax_client_set_user_id` | token 与用户 |
| `rumax_client_call` | 通用请求（本文档所有 opcode 调用） |
| `rumax_client_set_event_callback` | 事件订阅 |
| `rumax_generate_web_identity` | 生成 WEB 身份 |
| `rumax_client_login_by_token` | token 登录（LOGIN 19/8） |
| `rumax_qr_login_request` / `rumax_qr_login_confirm` | 二维码登录（288/289/291/19） |
| `rumax_send_message` | 发消息便捷封装（64，带重试） |
| `rumax_string_free` / `rumax_version` | 内存释放 / 版本 |

---

## 13. 可补齐项（如需要请告知）

| 缺口 | 建议新增函数 | 原因 |
|------|-------------|------|
| 文件实际上传 | `rumax_upload_photo` / `rumax_upload_video` / `rumax_upload_file` | 走 HTTP，非 opcode |
| 短信登录 | `rumax_start_auth` / `rumax_resend_auth` / `rumax_check_code` / `rumax_check_password` / `rumax_submit_register` | 依赖指纹与 temp_token 状态 |
| 遥测/行为模拟 | `rumax_set_telemetry_chats` / `rumax_spawn_telemetry_task` | 非 opcode，本地任务 |
| 便捷封装（可选） | `rumax_get_chats` / `rumax_fetch_history` 等 | 减少 C++ 侧拼 JSON |
