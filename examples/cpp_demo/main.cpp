// rumax C++ 调用示例
//
// 构建（先生成 Rust 动态库）：
//     cargo build --release
//     cmake -S examples/cpp_demo -B examples/cpp_demo/build
//     cmake --build examples/cpp_demo/build
// 运行：
//     ./examples/cpp_demo/build/cpp_demo --selftest     # 仅验证链接（不联网）
//     ./examples/cpp_demo/build/cpp_demo                # 完整 QR 登录流程（需扫码）

#include <rumax.h>

#include <cstdio>
#include <cstring>

namespace {

void on_event(const char* json, void* /*user_data*/) {
    // 注意：运行在 Rust 线程；不要在此调用阻塞式 rumax_client_call。
    std::printf("[event] %s\n", json);
}

// 打印错误并释放其内存。
void report_error(const char* what, char* err) {
    std::fprintf(stderr, "%s failed: %s\n", what, err ? err : "(no message)");
    if (err) {
        rumax_string_free(err);
    }
}

}  // namespace

int main(int argc, char** argv) {
    std::setvbuf(stdout, nullptr, _IONBF, 0);  // 立即输出，便于观察与重定向
    const bool selftest = (argc > 1 && std::strcmp(argv[1], "--selftest") == 0);

    std::printf("rumax version: %s\n", rumax_version());

    RumaxClient* client = rumax_client_new();
    if (client == nullptr) {
        std::fprintf(stderr, "rumax_client_new failed\n");
        return 1;
    }

    // 1) 生成 WEB 身份（QR 登录必需）
    char* identity = nullptr;
    char* err = nullptr;
    if (rumax_generate_web_identity(&identity, &err) != 0) {
        report_error("generate_web_identity", err);
        rumax_client_free(client);
        return 1;
    }
    std::printf("identity: %s\n", identity);

    if (selftest) {
        std::printf("selftest ok (linking works, no network used)\n");
        rumax_string_free(identity);
        rumax_client_free(client);
        return 0;
    }

    // 2) 连接（false = WebSocket，QR 登录需要 WEB 身份）
    if (rumax_client_connect(client, identity, /*is_mobile=*/false, &err) != 0) {
        report_error("connect", err);
        rumax_string_free(identity);
        rumax_client_free(client);
        return 1;
    }
    rumax_string_free(identity);
    std::printf("connected: %s\n", rumax_client_is_connected(client) ? "yes" : "no");

    // 3) 注册事件回调（接收新消息等推送）
    rumax_client_set_event_callback(client, on_event, nullptr);

    // 4) 请求二维码（opcode 288）
    char* session = nullptr;
    if (rumax_qr_login_request(client, &session, &err) != 0) {
        report_error("qr_login_request", err);
        rumax_client_free(client);
        return 1;
    }
    std::printf("QR session: %s\n", session);
    std::printf(">> 用 MAX App 扫描上面的 qrLink，并在手机上确认...\n");

    // 5) 等待扫码并完成登录（289 + 291 + LOGIN 19，阻塞）
    char* login = nullptr;
    if (rumax_qr_login_confirm(client, session, &login, &err) != 0) {
        report_error("qr_login_confirm", err);
        rumax_string_free(session);
        rumax_client_free(client);
        return 1;
    }
    std::printf("login ok: %s\n", login);
    rumax_string_free(login);
    rumax_string_free(session);

    // 6) 通用调用示例：拉取会话列表（opcode 48）
    char* resp = rumax_client_call(client, 48, "{\"chatIds\":[]}", &err);
    if (resp != nullptr) {
        std::printf("get_chats: %s\n", resp);
        rumax_string_free(resp);
    } else {
        report_error("call(48)", err);
    }

    std::printf("监听事件中，按 Enter 退出...\n");
    std::getchar();

    rumax_client_free(client);
    return 0;
}
