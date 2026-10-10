/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * rumax TypeScript SDK
 * =====================
 *
 * 设计目标
 * --------
 * 1. 与「是否经过 Java」无关：本文件不依赖任何 Android/Java/RN/Flutter API，
 *    只通过构造时传入的一个“透传函数” `RumaxTransport` 收发 JSON 字符串。
 *    Android 的 Java 层只负责把该字符串原样转给 native（`MasExtraFeature.rumaxExec`），
 *    再把返回的字符串原样回传。Web/C++/其它宿主同理。
 * 2. 应用层不接触 opcode：`call` 的每个 opcode 都有独立的方法。
 * 3. 严格类型：请求为可辨识联合（discriminated union），响应为 `RumaxResult<T>`。
 * 4. 统一入口：所有调用最终汇聚到 **`invoke()`**（预留为唯一入口）。
 *
 * 用法
 * ----
 * ```ts
 * import { Rumax } from './rumax';
 *
 * // 宿主提供的透传（这里以 Android/RN 为例；换成任意实现均可）
 * const transport: RumaxTransport = async (requestJson) => {
 *   // Android: return MasExtraFeature.rumaxExec(requestJson);
 *   // 或者 C++/Web/测试桩...
 *   return await NativeBridge.invoke(requestJson);
 * };
 *
 * const rumax = new Rumax(transport);
 *
 * const identity = await rumax.generateWebIdentity();
 * if (identity.success) {
 *   await rumax.connect(identity.data, false);
 * }
 * const res = await rumax.getChats([]);          // 无需关心 opcode=48
 * if (res.success) console.log(res.data.payload);
 * ```
 */

/* ========================================================================
 * 基础类型
 * ====================================================================== */

/** 任意 JSON 值。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** JSON 对象。 */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** 错误类型（可扩展）。 */
export type RumaxErrorType =
  | 'InvalidRequest'
  | 'UnknownType'
  | 'InvalidHandle'
  | 'ApiResponse'
  | 'Internal'
  | 'Transport'
  | 'Error'
  | 'Unknown'
  // 允许服务端/未来扩展的自定义类型
  | (string & {});

/** 结构化错误。 */
export interface RumaxError {
  type: RumaxErrorType;
  message: string;
}

/** 成功结果。 */
export interface RumaxSuccess<T> {
  success: true;
  data: T;
}

/** 失败结果。 */
export interface RumaxFailure {
  success: false;
  error: RumaxError;
}

/** 统一的返回结构。 */
export type RumaxResult<T> = RumaxSuccess<T> | RumaxFailure;

/* ========================================================================
 * 协议数据模型
 * ====================================================================== */

/** 协议响应（`call` 系列返回的 data）。业务数据在 `payload` 内。 */
export interface ProtocolResponse<P = JsonValue> {
  ver: number;
  cmd: number;
  seq: number;
  opcode: number;
  payload: P;
}

/** 身份（`generateWebIdentity` 返回）。 */
export interface Identity {
  deviceId: string;
  mtInstance: string;
  userAgent: UserAgent;
}

/** UserAgent。 */
export interface UserAgent {
  deviceType: string;
  appVersion: string;
  osVersion: string;
  timezone: string;
  screen: string;
  locale: string;
  deviceLocale: string;
  buildNumber: number;
  deviceName: string;
  pushDeviceType?: string;
  headerUserAgent?: string;
  arch?: string;
  release?: number;
}

/** 二维码登录会话（`qrLoginRequest` 返回）。 */
export interface QrLoginSession {
  qrLink: string;
  trackId: string;
  pollingInterval: number;
  ttl: number;
  expiresAt: number;
}

/** 同步状态（`loginByToken` 可选参数）。 */
export interface SyncState {
  chatsSync?: number;
  contactsSync?: number;
  draftsSync?: number;
  presenceSync?: number;
  configHash?: JsonValue | null;
}

/* ========================================================================
 * 请求类型（可辨识联合）
 * ====================================================================== */

export interface VersionRequest {
  type: 'version';
}
export interface NewRequest {
  type: 'new';
}
export interface FreeRequest {
  type: 'free';
  handle: string;
}
export interface GenerateWebIdentityRequest {
  type: 'generateWebIdentity';
}
export interface ConnectRequest {
  type: 'connect';
  handle: string;
  identity: Identity | string;
  mobile?: boolean;
}
export interface IsConnectedRequest {
  type: 'isConnected';
  handle: string;
}
export interface DisconnectRequest {
  type: 'disconnect';
  handle: string;
}
export interface SetTokenRequest {
  type: 'setToken';
  handle: string;
  token: string;
}
export interface GetTokenRequest {
  type: 'getToken';
  handle: string;
}
export interface CallRequest {
  type: 'call';
  handle: string;
  opcode: number;
  payload?: JsonValue;
}
export interface LoginByTokenRequest {
  type: 'loginByToken';
  handle: string;
  syncState?: SyncState | string;
}
export interface QrLoginRequestRequest {
  type: 'qrLoginRequest';
  handle: string;
}
export interface QrLoginConfirmRequest {
  type: 'qrLoginConfirm';
  handle: string;
  session: QrLoginSession | string;
}
export interface SendMessageRequest {
  type: 'sendMessage';
  handle: string;
  chatId: number;
  text: string;
}
export interface EventBindRequest {
  type: 'event.bind';
  handle: string;
}

/** 所有请求的联合。 */
export type RumaxRequest =
  | VersionRequest
  | NewRequest
  | FreeRequest
  | GenerateWebIdentityRequest
  | ConnectRequest
  | IsConnectedRequest
  | DisconnectRequest
  | SetTokenRequest
  | GetTokenRequest
  | CallRequest
  | LoginByTokenRequest
  | QrLoginRequestRequest
  | QrLoginConfirmRequest
  | SendMessageRequest
  | EventBindRequest;

/* ========================================================================
 * 透传通道
 * ====================================================================== */

/**
 * 由宿主提供：把请求 JSON 原样送到 native（或任意后端），返回响应 JSON。
 * Android 侧即 `MasExtraFeature.rumaxExec(requestJson)`；本 SDK 不关心其实现。
 */
export type RumaxTransport = (requestJson: string) => string | Promise<string>;

/* ========================================================================
 * Opcode 常量（应用层无需关心，仅供内部/调试使用）
 * ====================================================================== */

export const Opcode = {
  handshake: 6,
  syncContacts: 8,
  login: 19,
  logout: 20,
  userSettings: 22,
  updateProfile: 16,
  assetsSection: 26,
  stickerData: 27,
  assetsByIds: 28,
  favoriteStickerSetAdd: 29,
  fetchContacts: 32,
  contactEdit: 34,
  contactPhotos: 39,
  removeContactPhoto: 43,
  getByPhone: 46,
  getChats: 48,
  fetchHistory: 49,
  readMessage: 50,
  getChatMedia: 51,
  deleteChat: 52,
  clearHistory: 54,
  chatUpdate: 55,
  joinGroup: 57,
  leaveGroup: 58,
  members: 59,
  searchPublic: 60,
  msgSend: 64,
  deleteMessages: 66,
  editMessage: 67,
  searchMsg: 68,
  botStart: 64,
  conference: 76,
  chatOperation: 77,
  callStart: 78,
  callHistory: 79,
  photoUpload: 80,
  videoUpload: 82,
  videoById: 83,
  callInviteLink: 84,
  fileUpload: 87,
  fileById: 88,
  resolveLink: 89,
  getSessions: 96,
  closeAllSessions: 97,
  submitExternalCallback: 105,
  sharePhone: 106,
  sendButtonCallback: 118,
  suspendBot: 119,
  botCommands: 144,
  botInfo: 145,
  openWebApp: 160,
  sendComplaint: 161,
  complaintReasons: 162,
  eraseCallRecords: 164,
  enterCallByLink: 166,
  addReaction: 178,
  removeReaction: 179,
  transcription: 202,
  removeFavoriteStickerSet: 259,
  moveAsset: 260,
  getFolders: 272,
  getFolderById: 273,
  updateFolder: 274,
  reorderFolders: 275,
  deleteFolders: 276,
} as const;

/* ========================================================================
 * 各接口参数类型
 * ====================================================================== */

export interface SendMessageArgs {
  elements?: JsonValue[];
  attaches?: JsonValue[];
  /** 回复：被回复的 messageId */
  replyTo?: number | string;
  /** 完整的 reply 链接对象 */
  link?: JsonObject;
  notify?: boolean;
  cid?: number;
}

export interface FetchHistoryOptions {
  forward?: number;
  backward?: number;
  backwardTime?: number;
  forwardTime?: number;
  getChat?: boolean;
  fromTime?: number;
  itemType?: 'REGULAR' | 'DELAYED';
  getMessages?: boolean;
  interactive?: boolean;
}

export interface ChangeGroupSettingsOptions {
  allCanPinMessage?: boolean;
  onlyOwnerCanChangeIconTitle?: boolean;
  onlyAdminCanAddMember?: boolean;
  onlyAdminCanCall?: boolean;
  membersCanSeePrivateLink?: boolean;
}

/* ========================================================================
 * 客户端
 * ====================================================================== */

export class Rumax {
  private handle?: string;

  constructor(private readonly transport: RumaxTransport) {}

  /* ---------------- 统一入口（预留） ---------------- */

  /**
   * **唯一入口**：所有调用最终都经过这里。
   * 入参可以是请求对象（推荐）或原始请求 JSON 字符串。
   * 永不抛异常：传输层异常也会被转换为 `{success:false,error:{type:'Transport'}}`。
   */
  async invoke<R = JsonValue>(request: RumaxRequest | string): Promise<RumaxResult<R>> {
    let requestJson: string;
    try {
      requestJson = typeof request === 'string' ? request : JSON.stringify(request);
    } catch (e) {
      return fail('InvalidRequest', `cannot serialize request: ${(e as Error).message}`);
    }

    let responseJson: string;
    try {
      responseJson = await this.transport(requestJson);
    } catch (e) {
      return fail('Transport', `transport failed: ${(e as Error).message}`);
    }

    try {
      const parsed = JSON.parse(responseJson) as RumaxResult<R>;
      if (typeof parsed !== 'object' || parsed === null || !('success' in parsed)) {
        return fail('Transport', 'invalid response shape');
      }
      return parsed;
    } catch (e) {
      return fail('Transport', `cannot parse response: ${(e as Error).message}`);
    }
  }

  /** 便捷：发送任意原始请求 JSON，返回原始响应 JSON（不做解析）。 */
  invokeRaw(requestJson: string): Promise<string> {
    return Promise.resolve(this.transport(requestJson));
  }

  /* ---------------- 生命周期与连接 ---------------- */

  /** 库版本。 */
  version(): Promise<RumaxResult<string>> {
    return this.invoke<string>({ type: 'version' });
  }

  /** 创建客户端（通常无需手动调用，其它方法会自动创建）。 */
  async create(): Promise<RumaxResult<string>> {
    const r = await this.invoke<string>({ type: 'new' });
    if (r.success) this.handle = r.data;
    return r;
  }

  /** 销毁客户端（全局事件监听器不受影响）。 */
  async free(): Promise<RumaxResult<null>> {
    const h = this.handle;
    this.handle = undefined;
    if (!h) return ok(null);
    return this.invoke<null>({ type: 'free', handle: h });
  }

  /** 生成 WEB 身份（QR 登录必需）。 */
  generateWebIdentity(): Promise<RumaxResult<Identity>> {
    return this.invoke<Identity>({ type: 'generateWebIdentity' });
  }

  /** 连接并握手。`mobile=false` 走 WebSocket（QR 用），`true` 走 TCP/TLS。 */
  connect(identity: Identity | string, mobile = false): Promise<RumaxResult<null>> {
    return this.withHandle((handle) => ({ type: 'connect', handle, identity, mobile }));
  }

  /** 是否已连接。 */
  isConnected(): Promise<RumaxResult<boolean>> {
    return this.withHandle((handle) => ({ type: 'isConnected', handle }));
  }

  /** 断开连接。 */
  disconnect(): Promise<RumaxResult<null>> {
    return this.withHandle((handle) => ({ type: 'disconnect', handle }));
  }

  /** 设置登录 token。 */
  setToken(token: string): Promise<RumaxResult<null>> {
    return this.withHandle((handle) => ({ type: 'setToken', handle, token }));
  }

  /** 获取当前 token（未登录为 null）。 */
  getToken(): Promise<RumaxResult<string | null>> {
    return this.withHandle((handle) => ({ type: 'getToken', handle }));
  }

  /** 用已有 token 登录（LOGIN 19）。 */
  loginByToken(syncState?: SyncState): Promise<RumaxResult<ProtocolResponse>> {
    return this.withHandle((handle) => ({ type: 'loginByToken', handle, syncState }));
  }

  /** 请求二维码（opcode 288）。 */
  qrLoginRequest(): Promise<RumaxResult<QrLoginSession>> {
    return this.withHandle((handle) => ({ type: 'qrLoginRequest', handle }));
  }

  /** 等待扫码并完成登录（289 + 291 + LOGIN 19；**会阻塞**，请在子线程调用）。 */
  qrLoginConfirm(session: QrLoginSession | string): Promise<RumaxResult<ProtocolResponse>> {
    return this.withHandle((handle) => ({ type: 'qrLoginConfirm', handle, session }));
  }

  /** 发送文本消息（opcode 64，内含 not.ready 重试）。 */
  async sendMessage(chatId: number, text: string): Promise<RumaxResult<ProtocolResponse>> {
    return this.withHandle((handle) => ({ type: 'sendMessage', handle, chatId, text }));
  }

  /** 把该客户端的事件转发到全局监听器（无 token）。 */
  eventBind(): Promise<RumaxResult<null>> {
    return this.withHandle((handle) => ({ type: 'event.bind', handle }));
  }

  /* ---------------- call（通用，应用层一般不需要直接用） ---------------- */

  /** 通用 opcode 调用。应用层请优先使用下方具名方法。 */
  call<P = JsonValue>(
    opcode: number,
    payload: JsonValue = {},
  ): Promise<RumaxResult<ProtocolResponse<P>>> {
    return this.withHandle((handle) => ({ type: 'call', handle, opcode, payload }));
  }

  /* ======================================================================
   * 消息（messaging）
   * ==================================================================== */

  sendMessageEx(chatId: number, text: string, args: SendMessageArgs = {}) {
    const message: JsonObject = {
      text,
      cid: args.cid ?? -Date.now(),
      isLive: false,
      detectShare: false,
      elements: args.elements ?? [],
      attaches: args.attaches ?? [],
    };
    if (args.link) message.link = args.link;
    else if (args.replyTo !== undefined) message.link = { type: 'REPLY', messageId: Number(args.replyTo) };
    return this.call(Opcode.msgSend, { chatId, message, notify: args.notify ?? true });
  }

  addReaction(chatId: number, messageId: number, reaction: string) {
    return this.call(Opcode.addReaction, {
      chatId,
      messageId,
      reaction: { reactionType: 'EMOJI', id: reaction },
    });
  }

  removeReaction(chatId: number, messageId: number) {
    return this.call(Opcode.removeReaction, { chatId, messageId });
  }

  readMessage(chatId: number, messageId: number) {
    return this.call(Opcode.readMessage, {
      type: 'READ_MESSAGE',
      chatId,
      messageId,
      mark: Date.now(),
    });
  }

  pinMessage(chatId: number, messageId: number, notifyPin = true) {
    return this.call(Opcode.chatUpdate, { chatId, notifyPin, pinMessageId: messageId });
  }

  deleteMessage(chatId: number, messageId: number, forMe = false) {
    return this.deleteMessages(chatId, [messageId], forMe);
  }

  deleteMessages(chatId: number, messageIds: number[], forMe = false) {
    return this.call(Opcode.deleteMessages, { chatId, messageIds, forMe });
  }

  editMessage(chatId: number, messageId: number, text: string, attaches: JsonValue[] = [], elements: JsonValue[] = []) {
    return this.call(Opcode.editMessage, { chatId, messageId, text, elements, attaches });
  }

  fetchHistory(chatId: number, opts: FetchHistoryOptions = {}) {
    return this.call(Opcode.fetchHistory, {
      chatId,
      forward: opts.forward ?? 0,
      backward: opts.backward ?? 40,
      backwardTime: opts.backwardTime ?? 0,
      forwardTime: opts.forwardTime ?? 0,
      getChat: opts.getChat ?? false,
      from: opts.fromTime ?? Date.now(),
      itemType: opts.itemType ?? 'REGULAR',
      getMessages: opts.getMessages ?? true,
      interactive: opts.interactive ?? false,
    });
  }

  getVideoById(chatId: number, messageId: number, videoId: number, token?: string) {
    const payload: JsonObject = { chatId, messageId, videoId };
    if (token) payload.token = token;
    return this.call(Opcode.videoById, payload);
  }

  getFileById(chatId: number, messageId: number, fileId: number) {
    return this.call(Opcode.fileById, { chatId, messageId, fileId });
  }

  requestTranscription(chatId: number, messageId: number, mediaId: number) {
    return this.call(Opcode.transcription, { chatId, messageId, mediaId });
  }

  getComplaintReasons() {
    return this.call(Opcode.complaintReasons, { complainSync: 0 });
  }

  sendComplaint(reasonId: number, typeId: number, ids: number[], parentId?: number) {
    const payload: JsonObject = { reasonId, typeId, ids };
    if (parentId !== undefined) payload.parentId = parentId;
    return this.call(Opcode.sendComplaint, payload);
  }

  /* ======================================================================
   * 会话与群组（chats）
   * ==================================================================== */

  searchPublic(query: string, count = 20, type = 'ALL') {
    return this.call(Opcode.searchPublic, { query, count, type });
  }

  searchMsg(query: string, count = 50, marker?: string) {
    const payload: JsonObject = { query, count };
    if (marker) payload.marker = marker;
    return this.call(Opcode.searchMsg, payload);
  }

  getChats(chatIds: number[] = []) {
    return this.call(Opcode.getChats, { chatIds });
  }

  createGroup(title: string, participantIds: number[] = [], notify = true) {
    return this.call(Opcode.msgSend, {
      message: {
        cid: Date.now(),
        attaches: [{ _type: 'CONTROL', event: 'new', chatType: 'CHAT', title, userIds: participantIds }],
      },
      notify,
    });
  }

  deleteChat(chatId: number, lastEventTime = Date.now(), forAll = false) {
    return this.call(Opcode.deleteChat, { chatId, lastEventTime, forAll });
  }

  leaveGroup(chatId: number) {
    return this.call(Opcode.leaveGroup, { chatId });
  }

  changeGroupProfile(chatId: number, title?: string, description?: string) {
    const payload: JsonObject = { chatId };
    if (title !== undefined) payload.theme = title;
    if (description !== undefined) payload.description = description;
    return this.call(Opcode.chatUpdate, payload);
  }

  setChatPhoto(chatId: number, photoToken: string) {
    return this.call(Opcode.chatUpdate, { chatId, photoToken });
  }

  joinGroup(link: string) {
    return this.call(Opcode.joinGroup, { link });
  }

  resolveGroupByLink(link: string) {
    return this.call(Opcode.resolveLink, { link });
  }

  refreshInviteLink(chatId: number) {
    return this.call(Opcode.chatUpdate, { chatId, revokePrivateLink: true });
  }

  confirmJoinRequests(chatId: number, userIds: number[], showHistory = true) {
    return this.call(Opcode.chatOperation, {
      chatId, userIds, type: 'JOIN_REQUEST', showHistory, operation: 'add',
    });
  }

  declineJoinRequests(chatId: number, userIds: number[]) {
    return this.call(Opcode.chatOperation, { chatId, userIds, operation: 'remove' });
  }

  changeGroupSettings(chatId: number, options: ChangeGroupSettingsOptions) {
    const opts: JsonObject = {};
    if (options.allCanPinMessage !== undefined) {
      opts.ALL_CAN_PIN_MESSAGE = options.allCanPinMessage;
      opts.allCanPinMessage = options.allCanPinMessage;
    }
    if (options.onlyOwnerCanChangeIconTitle !== undefined) {
      opts.ONLY_OWNER_CAN_CHANGE_ICON_TITLE = options.onlyOwnerCanChangeIconTitle;
      opts.onlyOwnerCanChangeIconTitle = options.onlyOwnerCanChangeIconTitle;
    }
    if (options.onlyAdminCanAddMember !== undefined) {
      opts.ONLY_ADMIN_CAN_ADD_MEMBER = options.onlyAdminCanAddMember;
      opts.onlyAdminCanAddMember = options.onlyAdminCanAddMember;
    }
    if (options.onlyAdminCanCall !== undefined) {
      opts.ONLY_ADMIN_CAN_CALL = options.onlyAdminCanCall;
      opts.onlyAdminCanCall = options.onlyAdminCanCall;
    }
    if (options.membersCanSeePrivateLink !== undefined) {
      opts.MEMBERS_CAN_SEE_PRIVATE_LINK = options.membersCanSeePrivateLink;
      opts.membersCanSeePrivateLink = options.membersCanSeePrivateLink;
    }
    return this.call(Opcode.chatUpdate, { chatId, options: opts });
  }

  removeUsersFromGroup(chatId: number, userIds: number[], cleanMsgPeriod = 0) {
    return this.call(Opcode.chatOperation, { chatId, userIds, operation: 'remove', cleanMsgPeriod });
  }

  inviteUsersToGroup(chatId: number, userIds: number[], showHistory = true) {
    return this.call(Opcode.chatOperation, { chatId, userIds, showHistory, operation: 'add' });
  }

  getJoinRequests(chatId: number) {
    return this.call(Opcode.members, { chatId, type: 'JOIN_REQUEST', count: 100 });
  }

  setChatMute(chatId: number, dontDisturbUntil: number) {
    const chats: JsonObject = {};
    chats[String(chatId)] = { dontDisturbUntil };
    return this.call(Opcode.userSettings, { settings: { chats } });
  }

  updateUserSettings(settings: JsonObject) {
    return this.call(Opcode.userSettings, { settings: { user: settings } });
  }

  getFolders(folderSync = 0) {
    return this.call(Opcode.getFolders, { folderSync });
  }

  getFolderById(folderIds: string[]) {
    return this.call(Opcode.getFolderById, { folderIds });
  }

  updateFolder(id: string, title: string, include: number[] = [], filters: number[] = [], options: number[] = [], favorites: number[] = []) {
    return this.call(Opcode.updateFolder, { id, title, include, filters, options, favorites });
  }

  reorderFolders(foldersOrder: string[]) {
    return this.call(Opcode.reorderFolders, { foldersOrder });
  }

  deleteFolders(folderIds: string[]) {
    return this.call(Opcode.deleteFolders, { folderIds });
  }

  getChatMedia(chatId: number, messageId: number, attachTypes: string[], forward = 0, backward = 50) {
    return this.call(Opcode.getChatMedia, { chatId, messageId, attachTypes, forward, backward });
  }

  assignAdmin(chatId: number, userId: number, permissions: string[], alias?: string) {
    const entry: JsonObject = { permissions };
    if (alias) entry.alias = alias;
    const adminParticipants: JsonObject = {};
    adminParticipants[String(userId)] = entry;
    return this.call(Opcode.chatUpdate, { chatId, adminParticipants });
  }

  revokeAdmin(chatId: number, userId: number) {
    const adminParticipants: JsonObject = {};
    adminParticipants[String(userId)] = null;
    return this.call(Opcode.chatUpdate, { chatId, adminParticipants });
  }

  clearChatHistory(chatId: number, lastEventTime = Date.now(), forAll = false) {
    return this.call(Opcode.clearHistory, { chatId, lastEventTime, forAll });
  }

  /* ======================================================================
   * 联系人（contacts）
   * ==================================================================== */

  syncContacts() {
    return this.call(Opcode.syncContacts, { contactsSync: 0 });
  }

  getByPhone(phone: string) {
    return this.call(Opcode.getByPhone, { phone });
  }

  fetchContacts(userIds: number[]) {
    return this.call(Opcode.fetchContacts, { contactIds: userIds });
  }

  addContact(userId: number, firstName: string) {
    return this.call(Opcode.contactEdit, { contactId: userId, firstName, action: 'ADD' });
  }

  deleteContact(userId: number) {
    return this.call(Opcode.contactEdit, { contactId: userId, action: 'REMOVE' });
  }

  getContactPhotos(contactId: number, from = 0, count = 20) {
    return this.call(Opcode.contactPhotos, { contactId, from, count });
  }

  removeContactPhoto(photoId: number) {
    return this.call(Opcode.removeContactPhoto, { photoId });
  }

  /* ======================================================================
   * 频道（channels）
   * ==================================================================== */

  joinChannel(link: string) {
    return this.call(Opcode.joinGroup, { link });
  }

  leaveChannel(chatId: number) {
    return this.call(Opcode.leaveGroup, { chatId });
  }

  resolveChannelByName(name: string) {
    return this.call(Opcode.resolveLink, { link: `https://max.ru/${name}` });
  }

  getMembers(chatId: number, count = 100, marker?: number) {
    const payload: JsonObject = { type: 'MEMBER', chatId, count };
    if (marker !== undefined) payload.marker = marker;
    return this.call(Opcode.members, payload);
  }

  findMembers(chatId: number, query: string) {
    return this.call(Opcode.members, { type: 'MEMBER', query, chatId });
  }

  /* ======================================================================
   * 通话（calls）
   * ==================================================================== */

  getCalls(forward = true, count = 50) {
    return this.call(Opcode.callHistory, { forward, count });
  }

  startOutgoingCall(calleeId: number, isVideo: boolean, conversationId: string, internalParams = '{}') {
    return this.call(Opcode.callStart, {
      conversationId, calleeIds: [calleeId], internalParams, isVideo,
    });
  }

  openConference(conversationId: string) {
    return this.call(Opcode.conference, { conversationId });
  }

  enterCallByLink(joinLink: string, isVideo = false, internalParams = '{}') {
    return this.call(Opcode.enterCallByLink, { joinLink, internalParams, isVideo });
  }

  makeInviteLink(conversationId: string) {
    return this.call(Opcode.callInviteLink, { conversationId });
  }

  eraseCallRecords(historyIds: number[]) {
    return this.call(Opcode.eraseCallRecords, { historyIds });
  }

  /* ======================================================================
   * 文件与媒体（files）
   * ==================================================================== */

  getPhotoUpload(count = 1, profile = false) {
    return this.call(Opcode.photoUpload, { count, profile });
  }

  getVideoUpload(count = 1) {
    return this.call(Opcode.videoUpload, { uploaderType: 0, type: 0, count });
  }

  getFileUpload(count = 1, profile = false) {
    return this.call(Opcode.fileUpload, { count, profile });
  }

  getAudioUpload(count = 1) {
    return this.call(Opcode.videoUpload, { uploaderType: 1, type: 2, count });
  }

  getVideoNoteUpload(count = 1) {
    return this.call(Opcode.videoUpload, { uploaderType: 1, type: 1, count });
  }

  /* ======================================================================
   * 贴纸与表情（stickers）
   * ==================================================================== */

  getStickerSections(sync = 0) {
    return this.call(Opcode.stickerData, { type: 'STICKER', sync });
  }

  getFavoriteStickers(sync = 0) {
    return this.call(Opcode.stickerData, { type: 'FAVORITE_STICKER', sync });
  }

  getAnimojiSets(sync = 0) {
    return this.call(Opcode.stickerData, { type: 'ANIMOJI_SET', sync });
  }

  getAssetsSection(sectionId: string, from = 0, count = 50) {
    return this.call(Opcode.assetsSection, { sectionId, from, count });
  }

  getAssetsByIds(assetType: string, ids: number[]) {
    return this.call(Opcode.assetsByIds, { type: assetType, ids });
  }

  addFavoriteStickerSet(setId: number) {
    return this.call(Opcode.favoriteStickerSetAdd, { type: 'FAVORITE_STICKER_SET', id: setId });
  }

  removeFavoriteStickerSet(setId: number) {
    return this.call(Opcode.removeFavoriteStickerSet, { type: 'FAVORITE_STICKER_SET', ids: [setId] });
  }

  moveAsset(assetType: string, id: number, position: number) {
    return this.call(Opcode.moveAsset, { type: assetType, id, position });
  }

  resolveLink(link: string) {
    const clean = /^https?:\/\//.test(link) ? link : `https://max.ru/${link}`;
    return this.call(Opcode.resolveLink, { link: clean });
  }

  sendStickerMessage(chatId: number, stickerId: number, notify = true) {
    return this.call(Opcode.msgSend, {
      chatId,
      message: {
        cid: -Date.now(),
        text: '',
        elements: [],
        attaches: [{ _type: 'STICKER', stickerId }],
      },
      notify,
    });
  }

  /* ======================================================================
   * 机器人（bots）
   * ==================================================================== */

  sendButtonCallback(chatId: number, messageId: number, callbackId: string, payload?: string) {
    const body: JsonObject = { chatId, messageId, callbackId };
    if (payload !== undefined) body.payload = payload;
    return this.call(Opcode.sendButtonCallback, body);
  }

  sendBotStart(chatId: number, startPayload?: string) {
    const attach: JsonObject = { _type: 'CONTROL', event: 'botStarted' };
    if (startPayload !== undefined) attach.startPayload = startPayload;
    return this.call(Opcode.msgSend, {
      chatId,
      message: { cid: -Date.now(), attaches: [attach] },
    });
  }

  getBotInfo(botId: number) {
    return this.call(Opcode.botInfo, { botId });
  }

  getChatBotCommands(chatId: number) {
    return this.call(Opcode.botCommands, { chatId });
  }

  suspendBot(botId: number) {
    return this.call(Opcode.suspendBot, { botId });
  }

  openWebApp(botId: number, startParam?: string, chatId?: number) {
    const payload: JsonObject = { botId };
    if (startParam) payload.startParam = startParam;
    if (chatId !== undefined) payload.chatId = chatId;
    return this.call(Opcode.openWebApp, payload);
  }

  sharePhoneWithBot(botId: number) {
    return this.call(Opcode.sharePhone, { botId });
  }

  submitExternalCallback(url: string) {
    return this.call(Opcode.submitExternalCallback, { url });
  }

  /* ======================================================================
   * 用户与会话（user）
   * ==================================================================== */

  logout() {
    return this.call(Opcode.logout, {});
  }

  getSessions() {
    return this.call(Opcode.getSessions, {});
  }

  closeAllSessions() {
    return this.call(Opcode.closeAllSessions, {});
  }

  updateProfile(firstName: string, lastName: string, description?: string, avatarToken?: string) {
    const payload: JsonObject = { firstName, lastName };
    if (description !== undefined) payload.description = description;
    if (avatarToken !== undefined) {
      payload.photoToken = avatarToken;
      payload.avatarType = 'USER_AVATAR';
    }
    return this.call(Opcode.updateProfile, payload);
  }

  setProfilePhoto(photoToken: string) {
    return this.call(Opcode.updateProfile, { photoToken, avatarType: 'USER_AVATAR' });
  }

  /* ---------------- 内部工具 ---------------- */

  /** 确保已有 handle，然后按 handle 构造请求并调用 `invoke`。 */
  private async withHandle<R>(make: (handle: string) => RumaxRequest): Promise<RumaxResult<R>> {
    if (!this.handle) {
      const created = await this.create();
      if (!created.success) return created as unknown as RumaxResult<R>;
    }
    return this.invoke<R>(make(this.handle as string));
  }
}

/* ========================================================================
 * 辅助函数
 * ====================================================================== */

export function ok<T>(data: T): RumaxSuccess<T> {
  return { success: true, data };
}

export function fail(type: RumaxErrorType, message: string): RumaxFailure {
  return { success: false, error: { type, message } };
}

/** 断言成功并取出 data，失败时抛出（供希望用 try/catch 的调用方使用）。 */
export function unwrap<T>(result: RumaxResult<T>): T {
  if (result.success) return result.data;
  const err = new Error(`[${result.error.type}] ${result.error.message}`);
  (err as any).type = result.error.type;
  throw err;
}

/** 判断是否为成功结果。 */
export function isOk<T>(result: RumaxResult<T>): result is RumaxSuccess<T> {
  return result.success === true;
}

/** 判断是否为失败结果。 */
export function isErr<T>(result: RumaxResult<T>): result is RumaxFailure {
  return result.success === false;
}

/** 工厂：便于不用 `new`。 */
export function createRumax(transport: RumaxTransport): Rumax {
  return new Rumax(transport);
}

export default Rumax;
