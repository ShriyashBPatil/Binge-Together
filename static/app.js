// BingeTogether - Main Single Page Application Logic

// Global YouTube Callback definition before DOM ready
window.onYouTubeIframeAPIReady = () => {
  state.isYtReady = true;
  console.log("YouTube IFrame API Ready");
  if (state.pendingYtLoad) {
    state.pendingYtLoad();
    state.pendingYtLoad = null;
  }
};

// --- App State ---
const state = {
  token: localStorage.getItem('bt_token') || null,
  user: null,
  myUserId: null,
  currentRoom: null,
  ws: null,
  ytPlayer: null,
  isYtReady: !!(window.YT && window.YT.Player),
  pendingYtLoad: null,
  activePlayerType: 'youtube', // 'youtube' or 'mp4'
  activeVideoUrl: '',
  activeVideoTitle: '',
  isPlaying: false,
  isHost: false,
  hostOnlyControl: false,
  isRemoteAction: false, // Prevents echo stutter loop
  suppressBroadcastUntil: 0, // Timestamp to ignore player event echoes
  driftResetTimer: null,
  segmentStart: 0.0,
  segmentEnd: 0.0,
  isUploading: false,
  peerConnections: {}, // user_id -> RTCPeerConnection
  iceCandidateQueues: {}, // user_id -> Array of candidates
  micMuted: false,
  camOff: false,
  isStealthMode: false,
  guestName: sessionStorage.getItem('bt_guest_nickname') || '',
  guestAvatar: sessionStorage.getItem('bt_guest_avatar') || '',
  sidebarVisible: true,
  camsVisible: true,
  controlsHideTimer: null
};

// WebRTC ICE Servers Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Free public TURN relay for symmetric NAT fallback
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

// // --- DOM Elements ---
const el = {
  // Views
  viewBrowse: document.getElementById('view-browse'),
  viewRoom: document.getElementById('view-room'),
  viewAdmin: document.getElementById('view-admin'),
  roomLayout: document.getElementById('room-layout'),

  // Navigation
  navRooms: document.getElementById('nav-rooms'),
  navUploadBtn: document.getElementById('nav-upload-btn'),
  navAdmin: document.getElementById('nav-admin'),
  navUserArea: document.getElementById('nav-user-area'),
  btnMobileMenu: document.getElementById('btn-mobile-menu'),
  mobileNavDropdown: document.getElementById('mobile-nav-dropdown'),
  mNavRooms: document.getElementById('m-nav-rooms'),
  mNavUpload: document.getElementById('m-nav-upload'),
  mNavAdmin: document.getElementById('m-nav-admin'),

  // Hero & Browse
  btnCreateRoomModal: document.getElementById('btn-create-room-modal'),
  btnJoinCodeModal: document.getElementById('btn-join-code-modal'),
  btnRefreshRooms: document.getElementById('btn-refresh-rooms'),
  roomGridContainer: document.getElementById('room-grid-container'),
  totalRoomsCount: document.getElementById('total-rooms-count'),
  publicRoomsCount: document.getElementById('public-rooms-count'),

  // Room View
  roomTitleDisplay: document.getElementById('room-title-display'),
  roomCodeBadge: document.getElementById('room-code-badge'),
  roomHostBadge: document.getElementById('room-host-badge'),
  roomLockBadge: document.getElementById('room-lock-badge'),
  btnToggleRoomPrivacy: document.getElementById('btn-toggle-room-privacy'),
  roomPrivacyBtnText: document.getElementById('room-privacy-btn-text'),
  btnInviteEmailHeader: document.getElementById('btn-invite-email-header'),
  btnCopyInvite: document.getElementById('btn-copy-invite'),
  stealthModeBanner: document.getElementById('stealth-mode-banner'),
  btnExitStealth: document.getElementById('btn-exit-stealth'),
  btnLeaveRoom: document.getElementById('btn-leave-room'),
  queueCountBadge: document.getElementById('queue-count-badge'),
  btnToggleSidebarHeader: document.getElementById('btn-toggle-sidebar-header'),
  headerChatBtnText: document.getElementById('header-chat-btn-text'),

  // Media Source Selector
  tabYtSource: document.getElementById('tab-yt-source'),
  tabLocalSource: document.getElementById('tab-local-source'),
  tabUploadNew: document.getElementById('tab-upload-new'),
  panelYtSource: document.getElementById('panel-yt-source'),
  panelLocalSource: document.getElementById('panel-local-source'),
  ytUrlInput: document.getElementById('yt-url-input'),
  btnLoadYt: document.getElementById('btn-load-yt'),
  localVideoSelect: document.getElementById('local-video-select'),
  btnLoadLocal: document.getElementById('btn-load-local'),

  // Video Player
  playerCard: document.getElementById('player-card'),
  playerWrapper: document.getElementById('player-wrapper'),
  ytPlayerContainer: document.getElementById('yt-player-container'),
  html5PlayerContainer: document.getElementById('html5-player-container'),
  html5Video: document.getElementById('html5-video'),
  tapPlayOverlay: document.getElementById('tap-play-overlay'),
  btnTapPlay: document.getElementById('btn-tap-play'),
  syncOverlay: document.getElementById('sync-overlay'),
  syncOverlayText: document.getElementById('sync-overlay-text'),
  chatToastContainer: document.getElementById('chat-toast-container'),
  playerControlsToolbar: document.getElementById('player-controls-toolbar'),

  ctrlPlayPause: document.getElementById('ctrl-play-pause'),
  ctrlSeekbar: document.getElementById('ctrl-seekbar'),
  ctrlTimeDisplay: document.getElementById('ctrl-time-display'),
  ctrlSync: document.getElementById('ctrl-sync'),
  ctrlToggleCams: document.getElementById('ctrl-toggle-cams'),
  ctrlFsToggleMic: document.getElementById('ctrl-fs-toggle-mic'),
  ctrlFsToggleCam: document.getElementById('ctrl-fs-toggle-cam'),
  ctrlToggleChat: document.getElementById('ctrl-toggle-chat'),
  chatUnreadBadge: document.getElementById('chat-unread-badge'),
  ctrlFullscreen: document.getElementById('ctrl-fullscreen'),
  nowPlayingTitle: document.getElementById('now-playing-title'),

  // WebRTC & Chat
  playerPeersStrip: document.getElementById('player-peers-strip'),
  peersGridContainer: document.getElementById('peers-grid-container'),
  localVideo: document.getElementById('local-video'),
  localAvatarFallback: document.getElementById('local-avatar-fallback'),
  localAvatarImg: document.getElementById('local-avatar-img'),
  localPeerName: document.getElementById('local-peer-name'),
  localMicBadge: document.getElementById('local-mic-badge'),
  btnStartCall: document.getElementById('btn-start-call'),
  btnToggleMic: document.getElementById('btn-toggle-mic'),
  btnToggleCam: document.getElementById('btn-toggle-cam'),
  webrtcStatusMsg: document.getElementById('webrtc-status-msg'),
  participantCountNum: document.getElementById('participant-count-num'),
  participantList: document.getElementById('participant-list'),
  chatMessagesContainer: document.getElementById('chat-messages-container'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  playerChatOverlay: document.getElementById('player-chat-overlay'),
  playerChatMessages: document.getElementById('player-chat-messages'),
  playerChatForm: document.getElementById('player-chat-form'),
  playerChatInput: document.getElementById('player-chat-input'),
  btnClosePlayerChat: document.getElementById('btn-close-player-chat'),

  // Admin
  tabAdminUsers: document.getElementById('tab-admin-users'),
  tabAdminRooms: document.getElementById('tab-admin-rooms'),
  tabAdminVideos: document.getElementById('tab-admin-videos'),
  tabAdminSmtp: document.getElementById('tab-admin-smtp'),
  adminPanelUsers: document.getElementById('admin-panel-users'),
  adminPanelRooms: document.getElementById('admin-panel-rooms'),
  adminPanelVideos: document.getElementById('admin-panel-videos'),
  adminPanelSmtp: document.getElementById('admin-panel-smtp'),
  adminUsersTableBody: document.getElementById('admin-users-table-body'),
  adminRoomsTableBody: document.getElementById('admin-rooms-table-body'),
  adminVideosTableBody: document.getElementById('admin-videos-table-body'),
  btnRefreshAdminRooms: document.getElementById('btn-refresh-admin-rooms'),

  // SMTP Settings Elements
  formAdminSmtp: document.getElementById('form-admin-smtp'),
  smtpHostInput: document.getElementById('smtp-host-input'),
  smtpPortInput: document.getElementById('smtp-port-input'),
  smtpUserInput: document.getElementById('smtp-user-input'),
  smtpPassInput: document.getElementById('smtp-pass-input'),
  smtpFromEmailInput: document.getElementById('smtp-from-email-input'),
  smtpFromNameInput: document.getElementById('smtp-from-name-input'),
  smtpAppUrlInput: document.getElementById('smtp-app-url-input'),
  smtpUseTlsInput: document.getElementById('smtp-use-tls-input'),
  smtpUseSslInput: document.getElementById('smtp-use-ssl-input'),
  smtpWelcomeEmailInput: document.getElementById('smtp-welcome-email-input'),
  formTestSmtp: document.getElementById('form-test-smtp'),
  testSmtpEmailInput: document.getElementById('test-smtp-email-input'),
  testSmtpResult: document.getElementById('test-smtp-result'),
  btnSendTestEmail: document.getElementById('btn-send-test-email'),

  // Recovery Modal Elements
  modalForgotCredentials: document.getElementById('modal-forgot-credentials'),
  linkForgotCredentials: document.getElementById('link-forgot-credentials'),
  btnSubtabFindUser: document.getElementById('btn-subtab-find-user'),
  btnSubtabResetPass: document.getElementById('btn-subtab-reset-pass'),
  paneRecoveryFindUser: document.getElementById('pane-recovery-find-user'),
  paneRecoveryResetPass: document.getElementById('pane-recovery-reset-pass'),
  formForgotUsername: document.getElementById('form-forgot-username'),
  forgotUserEmail: document.getElementById('forgot-user-email'),
  forgotUserMsg: document.getElementById('forgot-user-msg'),
  formForgotPassRequest: document.getElementById('form-forgot-pass-request'),
  forgotPassTarget: document.getElementById('forgot-pass-target'),
  forgotPassReqMsg: document.getElementById('forgot-pass-req-msg'),
  formForgotPassConfirm: document.getElementById('form-forgot-pass-confirm'),
  resetCodeInput: document.getElementById('reset-code-input'),
  resetNewPassInput: document.getElementById('reset-new-pass-input'),
  resetPassConfirmMsg: document.getElementById('reset-pass-confirm-msg'),
  btnBackToStep1: document.getElementById('btn-back-to-step1'),

  // Modals
  modalGuestJoin: document.getElementById('modal-guest-join'),
  formGuestJoin: document.getElementById('form-guest-join'),
  guestTargetRoomCode: document.getElementById('guest-target-room-code'),
  guestTargetPasscode: document.getElementById('guest-target-passcode'),
  guestNicknameInput: document.getElementById('guest-nickname-input'),
  guestPreviewNickname: document.getElementById('guest-preview-nickname'),
  guestPreviewAvatarImg: document.getElementById('guest-preview-avatar-img'),
  guestSelectedAvatarUrl: document.getElementById('guest-selected-avatar-url'),
  avatarPickerGrid: document.getElementById('avatar-picker-grid'),
  btnRandomAvatar: document.getElementById('btn-random-avatar'),

  modalCreateRoom: document.getElementById('modal-create-room'),
  formCreateRoom: document.getElementById('form-create-room'),
  createRoomPrivate: document.getElementById('create-room-private'),
  groupPasscode: document.getElementById('group-passcode'),

  modalJoinPasscode: document.getElementById('modal-join-passcode'),
  formJoinPasscode: document.getElementById('form-join-passcode'),
  joinRoomCodeHidden: document.getElementById('join-room-code-hidden'),
  joinRoomPasscodeInput: document.getElementById('join-room-passcode-input'),

  // Queue & Upload
  queueCountNum: document.getElementById('queue-count-num'),
  queueListContainer: document.getElementById('queue-list-container'),
  btnClearQueue: document.getElementById('btn-clear-queue'),
  modalUploadVideo: document.getElementById('modal-upload-video'),
  uploadDropzone: document.getElementById('upload-dropzone'),
  uploadFileInput: document.getElementById('upload-file-input'),
  uploadProgressContainer: document.getElementById('upload-progress-container'),
  uploadProgressFill: document.getElementById('upload-progress-fill'),
  uploadStatusText: document.getElementById('upload-status-text'),
  uploadPercentText: document.getElementById('upload-percent-text'),

  modalLogin: document.getElementById('modal-login'),
  formLogin: document.getElementById('form-login'),
  btnLogin: document.getElementById('btn-open-login'),

  modalRegister: document.getElementById('modal-register'),
  formRegister: document.getElementById('form-register'),
  btnRegister: document.getElementById('btn-open-register'),

  modalEditUser: document.getElementById('modal-edit-user'),
  formEditUser: document.getElementById('form-edit-user'),
  editUserId: document.getElementById('edit-user-id'),
  editUserUsername: document.getElementById('edit-user-username'),
  editUserEmail: document.getElementById('edit-user-email'),
  editUserBio: document.getElementById('edit-user-bio'),
  editUserNewpass: document.getElementById('edit-user-newpass'),
  groupAdminToggle: document.getElementById('group-admin-toggle'),
  editUserIsadmin: document.getElementById('edit-user-isadmin'),
  btnDeleteAllVideos: document.getElementById('btn-delete-all-videos'),

  // Custom Neo-Brutalist Alerts, Confirms & Prompts
  modalCustomAlert: document.getElementById('modal-custom-alert'),
  alertModalHeader: document.getElementById('alert-modal-header'),
  alertModalIcon: document.getElementById('alert-modal-icon'),
  alertModalTitle: document.getElementById('alert-modal-title'),
  alertModalMsg: document.getElementById('alert-modal-msg'),
  btnAlertOk: document.getElementById('btn-alert-ok'),
  btnCloseAlertX: document.getElementById('btn-close-alert-x'),

  modalCustomConfirm: document.getElementById('modal-custom-confirm'),
  confirmModalHeader: document.getElementById('confirm-modal-header'),
  confirmModalIcon: document.getElementById('confirm-modal-icon'),
  confirmModalTitle: document.getElementById('confirm-modal-title'),
  confirmModalMsg: document.getElementById('confirm-modal-msg'),
  btnConfirmOk: document.getElementById('btn-confirm-ok'),
  confirmBtnOkText: document.getElementById('confirm-btn-ok-text'),
  btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
  btnCloseConfirmX: document.getElementById('btn-close-confirm-x'),

  modalCustomPrompt: document.getElementById('modal-custom-prompt'),
  promptModalTitle: document.getElementById('prompt-modal-title'),
  promptModalLabel: document.getElementById('prompt-modal-label'),
  promptModalInput: document.getElementById('prompt-modal-input'),
  formCustomPrompt: document.getElementById('form-custom-prompt'),
  btnPromptCancel: document.getElementById('btn-prompt-cancel'),
  btnClosePromptX: document.getElementById('btn-close-prompt-x'),
  toastContainer: document.getElementById('toast-container'),

  // Room Share & Invite Modal
  modalShareRoom: document.getElementById('modal-share-room'),
  subtabShareLink: document.getElementById('subtab-share-link'),
  subtabShareEmail: document.getElementById('subtab-share-email'),
  paneShareLink: document.getElementById('pane-share-link'),
  paneShareEmail: document.getElementById('pane-share-email'),
  roomQrCode: document.getElementById('room-qr-code'),
  shareRoomCodeBadge: document.getElementById('share-room-code-badge'),
  shareRoomPassBadge: document.getElementById('share-room-pass-badge'),
  shareRoomUrlInput: document.getElementById('share-room-url-input'),
  btnCopyModalUrl: document.getElementById('btn-copy-modal-url'),
  copyModalBtnText: document.getElementById('copy-modal-btn-text'),
  btnCopyInviteText: document.getElementById('btn-copy-invite-text'),
  copyInviteTextBtnLabel: document.getElementById('copy-invite-text-btn-label'),
  btnNativeShare: document.getElementById('btn-native-share'),
  shareWhatsapp: document.getElementById('share-whatsapp'),
  shareTelegram: document.getElementById('share-telegram'),
  shareTwitter: document.getElementById('share-twitter'),

  // Email Invite Tab Elements
  formSendRoomInvites: document.getElementById('form-send-room-invites'),
  inviteEmailTagInput: document.getElementById('invite-email-tag-input'),
  inviteCustomNote: document.getElementById('invite-custom-note'),
  btnSendEmailInvites: document.getElementById('btn-send-email-invites'),
  sendEmailBtnText: document.getElementById('send-email-btn-text'),
  btnCopyEmailTemplate: document.getElementById('btn-copy-email-template'),
  inviteEmailStatusMsg: document.getElementById('invite-email-status-msg'),
  emailChipsList: document.getElementById('email-chips-list'),
  emailChipsCounter: document.getElementById('email-chips-counter'),
  emailChipBox: document.getElementById('email-chip-box'),
  btnClearEmailChips: document.getElementById('btn-clear-email-chips'),
  btnAddEmailChip: document.getElementById('btn-add-email-chip')
};

// --- Standalone SVG Icons Dictionary (100% Offline & Reliable) ---
const ICONS = {
  'popcorn': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a2 2 0 0 0 0-4 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0 0 4"/><path d="M10 22 7 8"/><path d="m14 22 3-14"/><path d="M4 8h16l-2 14H6Z"/></svg>',
  'globe': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
  'upload-cloud': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>',
  'shield-check': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
  'log-in': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>',
  'user-plus': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>',
  'user': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  'user-cog': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="15" r="3"/><circle cx="9" cy="7" r="4"/><path d="M10 15H6a4 4 0 0 0-4 4v2"/><path d="m21.7 16.4-.9-.3"/><path d="m15.2 13.9-.9-.3"/><path d="m16.6 18.7.3-.9"/><path d="m19.1 12.2.3-.9"/><path d="m19.6 18.7-.4-.8"/><path d="m16.1 12.2-.4-.8"/><path d="m15.2 16.1.9-.3"/><path d="m21.7 13.6.9-.3"/></svg>',
  'log-out': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>',
  'plus-circle': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>',
  'key-round': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
  'zap': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  'video': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>',
  'video-off': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',
  'clapperboard': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  'refresh-cw': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  'arrow-left': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
  'arrow-right': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  'lock': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  'copy': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  'list-video': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/><path d="m16 12 5 3-5 3v-6Z"/></svg>',
  'play': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  'pause': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/></svg>',
  'maximize': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  'trash-2': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
  'mic': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  'mic-off': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  'phone-call': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/><path d="M14.05 2a9 9 0 0 1 8 7.94"/><path d="M14.05 6A5 5 0 0 1 18 10"/></svg>',
  'users': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  'message-square': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  'send': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  'info': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  'radio': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>',
  'folder': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  'play-square': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m10 8 6 4-6 4V8Z"/></svg>',
  'upload': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>',
  'film': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>',
  'tv': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>',
  'check': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  'loader': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/></svg>',
  'clock': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  'alert-circle': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
  'activity': '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2"/></svg>'
};

function getIcon(name, sizeClass = '') {
  const raw = ICONS[name] || '';
  if (!raw) return '';
  if (sizeClass) {
    return raw.replace('<svg class="lucide"', `<svg class="lucide ${sizeClass}"`);
  }
  return raw;
}

function refreshIcons(container = document) {
  try {
    const elements = container.querySelectorAll('i[data-lucide], span[data-lucide]');
    elements.forEach(el => {
      const name = el.getAttribute('data-lucide');
      if (ICONS[name]) {
        const classes = el.getAttribute('class') || '';
        const svgStr = ICONS[name].replace('<svg class="lucide"', `<svg class="lucide ${classes}"`);
        el.outerHTML = svgStr;
      }
    });
  } catch (e) {
    console.error("Error refreshing icons:", e);
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  refreshIcons();
  loadPublicRooms();
  
  try {
    await checkAuth();
  } catch (e) {
    console.warn("Auth check on load:", e);
  }

  // Check direct /admin path
  if (window.location.pathname === '/admin') {
    if (state.user && state.user.is_admin) {
      switchView('admin');
    } else if (state.user) {
      showCustomAlert("Administrator privileges required to access the Admin Panel.", "Access Denied", "error");
      switchView('browse');
    } else {
      showModal(el.modalLogin);
    }
  }

  // Check URL query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const resetTokenParam = urlParams.get('reset_token');
  if (resetTokenParam) {
    openRecoveryModal('reset-pass');
    if (el.resetCodeInput) el.resetCodeInput.value = resetTokenParam;
    if (el.formForgotPassRequest) el.formForgotPassRequest.classList.add('hidden');
    if (el.formForgotPassConfirm) el.formForgotPassConfirm.classList.remove('hidden');
  }

  const roomCodeParam = urlParams.get('room');
  if (roomCodeParam) {
    joinRoom(roomCodeParam);
  }
});

// --- API Helper ---
async function apiRequest(endpoint, method = 'GET', body = null, isFormData = false) {
  const headers = {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  if (body && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const options = {
    method,
    headers
  };

  if (body) {
    options.body = isFormData ? body : JSON.stringify(body);
  }

  const res = await fetch(endpoint, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = 'API Request Failed';
    if (typeof data.detail === 'string') {
      msg = data.detail;
    } else if (Array.isArray(data.detail)) {
      msg = data.detail.map(d => d.msg || JSON.stringify(d)).join(', ');
    } else if (data.detail) {
      msg = JSON.stringify(data.detail);
    }
    throw new Error(msg);
  }
  return data;
}

// --- Authentication & Profile ---
async function checkAuth() {
  if (!state.token) {
    renderUserNav(null);
    return;
  }
  try {
    const user = await apiRequest('/api/auth/me');
    state.user = user;
    state.myUserId = String(user.id);
    renderUserNav(user);
  } catch (err) {
    console.error("Auth token invalid:", err);
    logout();
  }
}

function renderUserNav(user) {
  if (!user) {
    el.navUserArea.innerHTML = `
      <button class="brutal-btn brutal-btn-yellow brutal-btn-sm" id="btn-open-login">
        ${getIcon('log-in', 'icon-xs')} Sign In
      </button>
      <button class="brutal-btn brutal-btn-mint brutal-btn-sm" id="btn-open-register">
        ${getIcon('user-plus', 'icon-xs')} Get Started
      </button>
    `;
    document.getElementById('btn-open-login').onclick = () => showModal(el.modalLogin);
    document.getElementById('btn-open-register').onclick = () => showModal(el.modalRegister);
    el.navAdmin.classList.add('hidden');
    document.querySelectorAll('.admin-only').forEach(node => node.classList.add('hidden'));
  } else {
    el.navUserArea.innerHTML = `
      <div class="user-nav-badge">
        <img src="${user.avatar_url}" class="user-avatar-img" alt="${user.username}">
        <span style="font-weight:700; font-size:0.88rem;">${escapeHtml(user.username)} ${user.is_admin ? '<span class="brutal-pill bg-pastel-yellow" style="font-size:0.6rem; padding:0.1rem 0.35rem;">ADMIN</span>' : ''}</span>
        <button class="brutal-btn brutal-btn-white brutal-btn-xs" id="btn-edit-profile-nav">
          ${getIcon('user', 'icon-xs')} Profile
        </button>
        <button class="brutal-btn brutal-btn-pink brutal-btn-xs" id="btn-logout">
          ${getIcon('log-out', 'icon-xs')} Logout
        </button>
      </div>
    `;
    document.getElementById('btn-logout').onclick = logout;
    document.getElementById('btn-edit-profile-nav').onclick = () => openEditProfileModal(user);

    if (user.is_admin) {
      el.navAdmin.classList.remove('hidden');
      document.querySelectorAll('.admin-only').forEach(node => node.classList.remove('hidden'));
    } else {
      el.navAdmin.classList.add('hidden');
      document.querySelectorAll('.admin-only').forEach(node => node.classList.add('hidden'));
    }
  }
  refreshIcons();
}

function logout() {
  localStorage.removeItem('bt_token');
  state.token = null;
  state.user = null;
  state.myUserId = null;
  renderUserNav(null);
  switchView('browse');
}

// --- View Router ---
function switchView(viewName) {
  [el.viewBrowse, el.viewRoom, el.viewAdmin].forEach(v => v.classList.remove('active', 'hidden'));
  
  el.navRooms.classList.remove('active');
  el.navAdmin.classList.remove('active');

  if (el.mNavRooms) el.mNavRooms.classList.remove('active');
  if (el.mNavAdmin) el.mNavAdmin.classList.remove('active');
  if (el.mobileNavDropdown) el.mobileNavDropdown.classList.add('hidden');

  if (viewName === 'browse') {
    el.viewBrowse.classList.add('active');
    el.viewRoom.classList.add('hidden');
    el.viewAdmin.classList.add('hidden');
    el.navRooms.classList.add('active');
    if (el.mNavRooms) el.mNavRooms.classList.add('active');
    loadPublicRooms();
  } else if (viewName === 'room') {
    el.viewRoom.classList.add('active');
    el.viewBrowse.classList.add('hidden');
    el.viewAdmin.classList.add('hidden');
  } else if (viewName === 'admin') {
    el.viewAdmin.classList.add('active');
    el.viewBrowse.classList.add('hidden');
    el.viewRoom.classList.add('hidden');
    el.navAdmin.classList.add('active');
    if (el.mNavAdmin) el.mNavAdmin.classList.add('active');
    loadAdminUsers();
  }
}

// --- Modal Helper ---
function showModal(modalEl) {
  if (modalEl) modalEl.classList.remove('hidden');
}
function hideModal(modalEl) {
  if (modalEl) modalEl.classList.add('hidden');
}

// --- Neo-Brutalist Toast Notifications ---
function showToast(message, type = 'info', duration = 3500) {
  if (!el.toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `brutal-toast toast-${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check';
  else if (type === 'error') iconName = 'alert-circle';
  else if (type === 'warning') iconName = 'alert-circle';

  toast.innerHTML = `
    <div class="toast-icon">${getIcon(iconName, 'icon-xs')}</div>
    <div class="toast-text">${escapeHtml(message)}</div>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;

  el.toastContainer.appendChild(toast);

  // Trigger bounce-in animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  const removeToast = () => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  };

  const closeBtn = toast.querySelector('.toast-close');
  if (closeBtn) closeBtn.onclick = removeToast;

  if (duration > 0) {
    setTimeout(removeToast, duration);
  }
}

// --- Custom Alert Dialog (Replaces native alert) ---
function showCustomAlert(message, title = "Notification", type = "info") {
  return new Promise((resolve) => {
    if (!el.modalCustomAlert) {
      alert(message);
      resolve();
      return;
    }

    if (el.alertModalTitle) el.alertModalTitle.textContent = title;
    if (el.alertModalMsg) el.alertModalMsg.textContent = message;

    // Header styling & icon
    if (el.alertModalHeader) {
      el.alertModalHeader.className = 'modal-header ' + (
        type === 'error' ? 'bg-pastel-pink' :
        type === 'success' ? 'bg-pastel-mint' :
        type === 'warning' ? 'bg-pastel-yellow' : 'bg-pastel-yellow'
      );
    }
    if (el.alertModalIcon) {
      const iconName = type === 'error' ? 'alert-circle' : type === 'success' ? 'check' : 'info';
      el.alertModalIcon.innerHTML = getIcon(iconName, 'icon-sm');
    }

    showModal(el.modalCustomAlert);

    const closeHandler = () => {
      hideModal(el.modalCustomAlert);
      if (el.btnAlertOk) el.btnAlertOk.onclick = null;
      if (el.btnCloseAlertX) el.btnCloseAlertX.onclick = null;
      resolve();
    };

    if (el.btnAlertOk) el.btnAlertOk.onclick = closeHandler;
    if (el.btnCloseAlertX) el.btnCloseAlertX.onclick = closeHandler;
  });
}

// --- Custom Confirm Dialog (Replaces native confirm) ---
function showCustomConfirm(message, title = "Confirm Action", confirmText = "Confirm →", cancelText = "Cancel", type = "warning") {
  return new Promise((resolve) => {
    if (!el.modalCustomConfirm) {
      resolve(confirm(message));
      return;
    }

    if (el.confirmModalTitle) el.confirmModalTitle.textContent = title;
    if (el.confirmModalMsg) el.confirmModalMsg.textContent = message;
    if (el.confirmBtnOkText) el.confirmBtnOkText.textContent = confirmText;
    if (el.btnConfirmCancel) el.btnConfirmCancel.textContent = cancelText;

    if (el.confirmModalHeader) {
      el.confirmModalHeader.className = 'modal-header ' + (
        type === 'danger' ? 'bg-pastel-pink' :
        type === 'success' ? 'bg-pastel-mint' :
        type === 'info' ? 'bg-pastel-cyan' : 'bg-pastel-pink'
      );
    }

    showModal(el.modalCustomConfirm);

    const cleanup = () => {
      hideModal(el.modalCustomConfirm);
      if (el.btnConfirmOk) el.btnConfirmOk.onclick = null;
      if (el.btnConfirmCancel) el.btnConfirmCancel.onclick = null;
      if (el.btnCloseConfirmX) el.btnCloseConfirmX.onclick = null;
    };

    if (el.btnConfirmOk) {
      el.btnConfirmOk.onclick = () => {
        cleanup();
        resolve(true);
      };
    }
    if (el.btnConfirmCancel) {
      el.btnConfirmCancel.onclick = () => {
        cleanup();
        resolve(false);
      };
    }
    if (el.btnCloseConfirmX) {
      el.btnCloseConfirmX.onclick = () => {
        cleanup();
        resolve(false);
      };
    }
  });
}

// --- Custom Prompt Dialog (Replaces native prompt) ---
function showCustomPrompt(message, defaultValue = "", placeholder = "", title = "Input Required") {
  return new Promise((resolve) => {
    if (!el.modalCustomPrompt) {
      resolve(prompt(message, defaultValue));
      return;
    }

    if (el.promptModalTitle) el.promptModalTitle.textContent = title;
    if (el.promptModalLabel) el.promptModalLabel.textContent = message;
    if (el.promptModalInput) {
      el.promptModalInput.value = defaultValue || "";
      el.promptModalInput.placeholder = placeholder || "";
    }

    showModal(el.modalCustomPrompt);
    if (el.promptModalInput) {
      setTimeout(() => el.promptModalInput.focus(), 50);
    }

    const cleanup = () => {
      hideModal(el.modalCustomPrompt);
      if (el.formCustomPrompt) el.formCustomPrompt.onsubmit = null;
      if (el.btnPromptCancel) el.btnPromptCancel.onclick = null;
      if (el.btnClosePromptX) el.btnClosePromptX.onclick = null;
    };

    if (el.formCustomPrompt) {
      el.formCustomPrompt.onsubmit = (e) => {
        e.preventDefault();
        const val = el.promptModalInput.value;
        cleanup();
        resolve(val);
      };
    }
    if (el.btnPromptCancel) {
      el.btnPromptCancel.onclick = () => {
        cleanup();
        resolve(null);
      };
    }
    if (el.btnClosePromptX) {
      el.btnClosePromptX.onclick = () => {
        cleanup();
        resolve(null);
      };
    }
  });
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Navigation
  if (el.navRooms) el.navRooms.onclick = () => switchView('browse');
  if (el.navUploadBtn) el.navUploadBtn.onclick = () => showModal(el.modalUploadVideo);
  if (el.navAdmin) el.navAdmin.onclick = () => switchView('admin');
  const btnBrand = document.getElementById('btn-brand');
  if (btnBrand) btnBrand.onclick = () => switchView('browse');

  // Mobile navigation drawer toggle
  if (el.btnMobileMenu && el.mobileNavDropdown) {
    el.btnMobileMenu.onclick = () => {
      el.mobileNavDropdown.classList.toggle('hidden');
    };
  }
  if (el.mNavRooms) el.mNavRooms.onclick = () => switchView('browse');
  if (el.mNavUpload) el.mNavUpload.onclick = () => {
    if (el.mobileNavDropdown) el.mobileNavDropdown.classList.add('hidden');
    showModal(el.modalUploadVideo);
  };
  if (el.mNavAdmin) el.mNavAdmin.onclick = () => switchView('admin');

  if (el.btnRefreshRooms) el.btnRefreshRooms.onclick = loadPublicRooms;
  if (el.btnCreateRoomModal) {
    el.btnCreateRoomModal.onclick = () => {
      if (!state.user) {
        showModal(el.modalLogin);
        return;
      }
      showModal(el.modalCreateRoom);
    };
  }
  if (el.btnJoinCodeModal) {
    el.btnJoinCodeModal.onclick = async () => {
      const code = await showCustomPrompt("Enter Room Code to join party:", "", "e.g. ABCD-1234", "Join Room by Code");
      if (code && code.trim()) joinRoom(code.trim().toUpperCase());
    };
  }

  if (el.createRoomPrivate && el.groupPasscode) {
    el.createRoomPrivate.onchange = (e) => {
      if (e.target.checked) el.groupPasscode.classList.remove('hidden');
      else el.groupPasscode.classList.add('hidden');
    };
  }

  // Close modals buttons
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.onclick = (e) => {
      const backdrop = e.target.closest('.modal-backdrop');
      if (backdrop) hideModal(backdrop);
    };
  });

  // Forms
  if (el.formGuestJoin) el.formGuestJoin.onsubmit = handleGuestJoinSubmit;
  if (el.btnRandomAvatar) el.btnRandomAvatar.onclick = randomizeGuestAvatar;
  if (el.guestNicknameInput) el.guestNicknameInput.oninput = updateGuestPreview;
  el.formLogin.onsubmit = handleLogin;
  el.formRegister.onsubmit = handleRegister;
  el.formCreateRoom.onsubmit = handleCreateRoom;
  el.formJoinPasscode.onsubmit = handleJoinPasscode;
  el.formEditUser.onsubmit = handleSaveUserEdit;

  // Media Source Tabs
  if (el.tabYtSource) {
    el.tabYtSource.onclick = () => {
      el.tabYtSource.classList.add('active');
      if (el.tabLocalSource) el.tabLocalSource.classList.remove('active');
      if (el.tabUploadNew) el.tabUploadNew.classList.remove('active');
      if (el.panelYtSource) el.panelYtSource.classList.remove('hidden');
      if (el.panelLocalSource) el.panelLocalSource.classList.add('hidden');
    };
  }
  if (el.tabLocalSource) {
    el.tabLocalSource.onclick = () => {
      el.tabLocalSource.classList.add('active');
      if (el.tabYtSource) el.tabYtSource.classList.remove('active');
      if (el.tabUploadNew) el.tabUploadNew.classList.remove('active');
      if (el.panelLocalSource) el.panelLocalSource.classList.remove('hidden');
      if (el.panelYtSource) el.panelYtSource.classList.add('hidden');
      loadUploadedVideosDropdown();
    };
  }
  if (el.tabUploadNew) el.tabUploadNew.onclick = () => showModal(el.modalUploadVideo);

  // Load Media Buttons
  if (el.btnLoadYt) el.btnLoadYt.onclick = handleLoadYtVideo;
  if (el.btnLoadLocal) el.btnLoadLocal.onclick = handleLoadLocalVideo;

  // Tap to play / unmute overlay
  if (el.btnTapPlay) el.btnTapPlay.onclick = handleTapToPlay;

  // Player Controls
  if (el.ctrlPlayPause) el.ctrlPlayPause.onclick = togglePlayback;
  if (el.ctrlSeekbar) el.ctrlSeekbar.onchange = handleSeekInput;
  if (el.ctrlSync) el.ctrlSync.onclick = requestSyncWithHost;
  if (el.ctrlToggleCams) el.ctrlToggleCams.onclick = () => toggleMemberCams();
  if (el.ctrlFsToggleMic) el.ctrlFsToggleMic.onclick = toggleMic;
  if (el.ctrlFsToggleCam) el.ctrlFsToggleCam.onclick = toggleCam;
  if (el.ctrlToggleChat) el.ctrlToggleChat.onclick = () => toggleChatSidebar();
  if (el.btnToggleSidebarHeader) el.btnToggleSidebarHeader.onclick = () => toggleChatSidebar();
  if (el.ctrlFullscreen) el.ctrlFullscreen.onclick = toggleFullscreen;

  // Setup Hover Auto-hide controls overlay
  setupPlayerControlsHover();

  // Leave & Room Controls
  if (el.btnLeaveRoom) el.btnLeaveRoom.onclick = leaveCurrentRoom;
  if (el.btnCopyInvite) el.btnCopyInvite.onclick = () => copyInviteLink('link');
  if (el.btnInviteEmailHeader) el.btnInviteEmailHeader.onclick = () => {
    if (!state.currentRoom) return;
    openShareRoomModal(state.currentRoom.room_code, state.currentRoom.passcode, 'email');
  };
  if (el.btnToggleRoomPrivacy) el.btnToggleRoomPrivacy.onclick = handleToggleRoomPrivacy;

  // Share Modal Subtabs
  if (el.subtabShareLink) el.subtabShareLink.onclick = () => switchShareModalTab('link');
  if (el.subtabShareEmail) el.subtabShareEmail.onclick = () => switchShareModalTab('email');

  // Share Modal Copy URL button
  if (el.btnCopyModalUrl) {
    el.btnCopyModalUrl.onclick = () => {
      if (!el.shareRoomUrlInput) return;
      const url = el.shareRoomUrlInput.value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url);
      } else {
        el.shareRoomUrlInput.select();
        document.execCommand('copy');
      }
      if (el.copyModalBtnText) {
        el.copyModalBtnText.textContent = "Copied!";
        setTimeout(() => {
          if (el.copyModalBtnText) el.copyModalBtnText.textContent = "Copy Link";
        }, 2000);
      }
      showToast("Invite link copied to clipboard!", "success");
    };
  }

  // Copy Full Invite Text & Copy Email Template
  if (el.btnCopyInviteText) el.btnCopyInviteText.onclick = copyFullInviteText;
  if (el.btnCopyEmailTemplate) el.btnCopyEmailTemplate.onclick = copyEmailTemplate;

  // Send Email Invites Form
  if (el.formSendRoomInvites) el.formSendRoomInvites.onsubmit = handleSendRoomInvites;

  // Email Chip Input Interactions
  if (el.inviteEmailTagInput) {
    el.inviteEmailTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addEmailChipFromInput();
      } else if (e.key === 'Backspace' && !el.inviteEmailTagInput.value) {
        removeLastEmailChip();
      }
    });
    el.inviteEmailTagInput.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text');
      const emails = pasted.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
      emails.forEach(email => addEmailChip(email));
    });
    el.inviteEmailTagInput.addEventListener('blur', () => {
      if (el.inviteEmailTagInput.value.trim()) addEmailChipFromInput();
    });
  }
  if (el.emailChipBox) {
    el.emailChipBox.addEventListener('click', () => el.inviteEmailTagInput && el.inviteEmailTagInput.focus());
  }
  if (el.btnClearEmailChips) {
    el.btnClearEmailChips.onclick = () => {
      inviteEmailChips = [];
      renderEmailChips();
    };
  }
  if (el.btnAddEmailChip) {
    el.btnAddEmailChip.onclick = () => {
      addEmailChipFromInput();
      el.inviteEmailTagInput && el.inviteEmailTagInput.focus();
    };
  }

  // WebRTC Controls
  if (el.btnStartCall) el.btnStartCall.onclick = () => initLocalWebRTC(true);
  if (el.btnToggleMic) el.btnToggleMic.onclick = toggleMic;
  if (el.btnToggleCam) el.btnToggleCam.onclick = toggleCam;

  // Chat Form
  if (el.chatForm) el.chatForm.onsubmit = sendChatMessage;
  if (el.playerChatForm) el.playerChatForm.onsubmit = sendPlayerChatMessage;
  if (el.btnClosePlayerChat) el.btnClosePlayerChat.onclick = () => toggleChatSidebar(false);

  // Upload Dropzone & Queue
  if (el.btnClearQueue) el.btnClearQueue.onclick = clearQueue;
  if (el.uploadDropzone && el.uploadFileInput) {
    el.uploadDropzone.onclick = () => el.uploadFileInput.click();
    el.uploadFileInput.onchange = handleFileUpload;
  }

  // Admin Tabs
  if (el.tabAdminUsers) {
    el.tabAdminUsers.onclick = () => {
      [el.tabAdminUsers, el.tabAdminRooms, el.tabAdminVideos, el.tabAdminSmtp].forEach(t => t && t.classList.remove('active'));
      [el.adminPanelUsers, el.adminPanelRooms, el.adminPanelVideos, el.adminPanelSmtp].forEach(p => p && p.classList.add('hidden'));
      el.tabAdminUsers.classList.add('active');
      el.adminPanelUsers.classList.remove('hidden');
      loadAdminUsers();
    };
  }
  if (el.tabAdminRooms) {
    el.tabAdminRooms.onclick = () => {
      [el.tabAdminUsers, el.tabAdminRooms, el.tabAdminVideos, el.tabAdminSmtp].forEach(t => t && t.classList.remove('active'));
      [el.adminPanelUsers, el.adminPanelRooms, el.adminPanelVideos, el.adminPanelSmtp].forEach(p => p && p.classList.add('hidden'));
      el.tabAdminRooms.classList.add('active');
      el.adminPanelRooms.classList.remove('hidden');
      loadAdminRooms();
    };
  }
  if (el.tabAdminVideos) {
    el.tabAdminVideos.onclick = () => {
      [el.tabAdminUsers, el.tabAdminRooms, el.tabAdminVideos, el.tabAdminSmtp].forEach(t => t && t.classList.remove('active'));
      [el.adminPanelUsers, el.adminPanelRooms, el.adminPanelVideos, el.adminPanelSmtp].forEach(p => p && p.classList.add('hidden'));
      el.tabAdminVideos.classList.add('active');
      el.adminPanelVideos.classList.remove('hidden');
      loadAdminVideos();
    };
  }
  if (el.tabAdminSmtp) {
    el.tabAdminSmtp.onclick = () => {
      [el.tabAdminUsers, el.tabAdminRooms, el.tabAdminVideos, el.tabAdminSmtp].forEach(t => t && t.classList.remove('active'));
      [el.adminPanelUsers, el.adminPanelRooms, el.adminPanelVideos, el.adminPanelSmtp].forEach(p => p && p.classList.add('hidden'));
      el.tabAdminSmtp.classList.add('active');
      el.adminPanelSmtp.classList.remove('hidden');
      loadAdminSmtpSettings();
    };
  }

  if (el.btnRefreshAdminRooms) el.btnRefreshAdminRooms.onclick = loadAdminRooms;
  if (el.formAdminSmtp) el.formAdminSmtp.onsubmit = handleSaveAdminSmtp;
  if (el.formTestSmtp) el.formTestSmtp.onsubmit = handleTestAdminSmtp;
  if (el.btnDeleteAllVideos) el.btnDeleteAllVideos.onclick = deleteAllAdminVideos;

  // Account Recovery Listeners
  if (el.linkForgotCredentials) {
    el.linkForgotCredentials.onclick = (e) => {
      e.preventDefault();
      hideModal(el.modalLogin);
      openRecoveryModal('find-user');
    };
  }
  if (el.btnSubtabFindUser) {
    el.btnSubtabFindUser.onclick = () => {
      el.btnSubtabFindUser.classList.add('active');
      el.btnSubtabResetPass.classList.remove('active');
      el.paneRecoveryFindUser.classList.remove('hidden');
      el.paneRecoveryResetPass.classList.add('hidden');
    };
  }
  if (el.btnSubtabResetPass) {
    el.btnSubtabResetPass.onclick = () => {
      el.btnSubtabResetPass.classList.add('active');
      el.btnSubtabFindUser.classList.remove('active');
      el.paneRecoveryResetPass.classList.remove('hidden');
      el.paneRecoveryFindUser.classList.add('hidden');
    };
  }
  if (el.formForgotUsername) el.formForgotUsername.onsubmit = handleForgotUsername;
  if (el.formForgotPassRequest) el.formForgotPassRequest.onsubmit = handleForgotPassRequest;
  if (el.formForgotPassConfirm) el.formForgotPassConfirm.onsubmit = handleForgotPassConfirm;
  if (el.btnBackToStep1) {
    el.btnBackToStep1.onclick = () => {
      el.formForgotPassConfirm.classList.add('hidden');
      el.formForgotPassRequest.classList.remove('hidden');
    };
  }

  // Stealth Eavesdrop Exit Handler
  if (el.btnExitStealth) {
    el.btnExitStealth.onclick = async () => {
      if (!state.currentRoom) return;
      const confirmed = await showCustomConfirm(
        "Exit Ghost / Eavesdrop mode and reveal yourself to all participants in this room?",
        "Exit Ghost Mode",
        "Go Public →",
        "Stay Invisible",
        "warning"
      );
      if (confirmed) {
        joinRoom(state.currentRoom.room_code, null, false);
      }
    };
  }
}

// --- Rooms logic ---
async function loadPublicRooms() {
  el.roomGridContainer.innerHTML = `
    <div class="loading-state">
      <div class="modern-spinner"></div>
      <p>Loading active watch parties...</p>
    </div>
  `;
  try {
    const rooms = await apiRequest('/api/rooms');
    if (rooms.length === 0) {
      el.roomGridContainer.innerHTML = `
        <div class="loading-state">
          <p>No active rooms right now. Be the first to create one!</p>
        </div>
      `;
      return;
    }
    el.roomGridContainer.innerHTML = rooms.map(r => `
      <div class="room-card">
        <div>
          <div class="room-card-header">
            <span class="room-card-title">${escapeHtml(r.name)}</span>
            ${r.is_private ? `<span class="brutal-pill bg-pastel-pink">${getIcon('lock', 'icon-xs')} PRIVATE</span>` : `<span class="brutal-pill bg-pastel-mint">${getIcon('radio', 'icon-xs')} LIVE</span>`}
          </div>
          <p class="room-card-desc">${escapeHtml(r.description || 'Watch party session in progress.')}</p>
          <div class="room-card-meta">
            <span class="brutal-pill bg-pastel-purple">CODE: ${r.room_code}</span>
            <span class="brutal-pill bg-pastel-yellow">HOST: ${escapeHtml(r.host_username || 'Host')}</span>
            <span class="brutal-pill bg-pastel-cyan">${getIcon('users', 'icon-xs')} ${r.participant_count}</span>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
          <button class="brutal-btn brutal-btn-mint brutal-btn-sm" style="flex: 1;" onclick="joinRoom('${r.room_code}')">
            ENTER ROOM ${getIcon('arrow-right', 'icon-xs')}
          </button>
          <button class="brutal-btn brutal-btn-white brutal-btn-sm" onclick="openShareRoomModal('${r.room_code}')" title="Share room & QR code">
            ${getIcon('copy', 'icon-xs')}
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    el.roomGridContainer.innerHTML = `<div class="loading-state text-danger">Error loading rooms: ${escapeHtml(err.message)}</div>`;
  }
}

async function handleCreateRoom(e) {
  e.preventDefault();
  const name = document.getElementById('create-room-name').value;
  const description = document.getElementById('create-room-desc').value;
  const video_url = document.getElementById('create-room-yt').value;
  const is_private = el.createRoomPrivate.checked;
  const passcode = document.getElementById('create-room-passcode').value;
  const host_only_control = document.getElementById('create-room-hostonly').checked;

  try {
    const room = await apiRequest('/api/rooms', 'POST', {
      name,
      description,
      video_url: video_url || "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      video_title: video_url ? "Custom YouTube Video" : "Rick Roll Sample",
      video_type: "youtube",
      is_private,
      passcode: is_private ? passcode : null,
      host_only_control
    });
    hideModal(el.modalCreateRoom);
    joinRoom(room.room_code);
  } catch (err) {
    showCustomAlert("Failed to create room: " + err.message, "Creation Failed", "error");
  }
}

// --- Guest Identity & Themed Avatars ---
const THEME_AVATAR_PRESETS = [
  { label: 'PopBot', seed: 'PopBot', style: 'bottts', bg: 'ffd5dc' },
  { label: 'PixelHero', seed: 'PixelHero', style: 'bottts', bg: 'b6e3f4' },
  { label: 'CyberCat', seed: 'CyberCat', style: 'bottts', bg: 'd1d4f9' },
  { label: 'NeonAlien', seed: 'NeonAlien', style: 'bottts', bg: 'c0aede' },
  { label: 'RetroGamer', seed: 'RetroGamer', style: 'bottts', bg: 'ffdfbf' },
  { label: 'StarDrifter', seed: 'StarDrifter', style: 'bottts', bg: 'bbf7d0' },
  { label: 'GlitchKing', seed: 'GlitchKing', style: 'bottts', bg: 'fef08a' },
  { label: 'WaveRider', seed: 'WaveRider', style: 'bottts', bg: 'bae6fd' }
];

const RANDOM_NICKNAMES = [
  'RetroPilot', 'NeonBinger', 'PopcornHero', 'CyberWatcher', 'PixelDrifter', 
  'GlitchSurfer', 'SynthWave', 'CinemaGeek', 'VaporViewer', 'NightOwl'
];

function buildAvatarUrl(style, seed, bg) {
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bg}`;
}

function initGuestAvatarPicker(selectedUrl = '') {
  if (!el.avatarPickerGrid) return;
  
  if (!selectedUrl) {
    const defaultPreset = THEME_AVATAR_PRESETS[0];
    selectedUrl = buildAvatarUrl(defaultPreset.style, defaultPreset.seed, defaultPreset.bg);
  }

  el.guestSelectedAvatarUrl.value = selectedUrl;
  el.guestPreviewAvatarImg.src = selectedUrl;

  el.avatarPickerGrid.innerHTML = THEME_AVATAR_PRESETS.map(preset => {
    const url = buildAvatarUrl(preset.style, preset.seed, preset.bg);
    const isSelected = url === selectedUrl;
    return `
      <div class="avatar-option-card ${isSelected ? 'selected' : ''}" onclick="selectGuestAvatar('${url}')">
        <img src="${url}" class="avatar-option-img" alt="${preset.label}">
        <span class="avatar-option-label">${preset.label}</span>
      </div>
    `;
  }).join('');
}

window.selectGuestAvatar = function(url) {
  el.guestSelectedAvatarUrl.value = url;
  el.guestPreviewAvatarImg.src = url;
  document.querySelectorAll('.avatar-option-card').forEach(card => {
    const img = card.querySelector('img');
    if (img && img.src === url) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
};

function randomizeGuestAvatar() {
  const randomSeed = 'Guest_' + Math.random().toString(36).substring(2, 7);
  const colors = ['ffd5dc', 'b6e3f4', 'd1d4f9', 'c0aede', 'ffdfbf', 'bbf7d0', 'fef08a', 'bae6fd'];
  const randomBg = colors[Math.floor(Math.random() * colors.length)];
  const randomUrl = buildAvatarUrl('bottts', randomSeed, randomBg);
  
  const randomName = RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)] + Math.floor(Math.random() * 90 + 10);
  el.guestNicknameInput.value = randomName;
  el.guestPreviewNickname.textContent = randomName;
  selectGuestAvatar(randomUrl);
}

function updateGuestPreview() {
  const val = el.guestNicknameInput.value.trim() || 'Guest';
  el.guestPreviewNickname.textContent = val;
}

function openGuestJoinModal(roomCode, passcode = null) {
  el.guestTargetRoomCode.value = roomCode;
  el.guestTargetPasscode.value = passcode || '';

  const initialNick = state.guestName || (RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)] + Math.floor(Math.random() * 90 + 10));
  el.guestNicknameInput.value = initialNick;
  el.guestPreviewNickname.textContent = initialNick;

  const currentAvatar = state.guestAvatar || buildAvatarUrl('bottts', initialNick, 'b6e3f4');
  initGuestAvatarPicker(currentAvatar);

  showModal(el.modalGuestJoin);
}

function handleGuestJoinSubmit(e) {
  e.preventDefault();
  const nick = el.guestNicknameInput.value.trim();
  const avatar = el.guestSelectedAvatarUrl.value || buildAvatarUrl('bottts', nick, 'b6e3f4');
  const roomCode = el.guestTargetRoomCode.value;
  const passcode = el.guestTargetPasscode.value;

  if (!nick) return;

  state.guestName = nick;
  state.guestAvatar = avatar;
  sessionStorage.setItem('bt_guest_nickname', nick);
  sessionStorage.setItem('bt_guest_avatar', avatar);

  hideModal(el.modalGuestJoin);
  joinRoom(roomCode, passcode);
}

async function joinRoom(roomCode, passcode = null, isStealth = false) {
  // If guest without a nickname set yet, prompt with theme matching avatar picker
  if (!state.user && !state.guestName) {
    openGuestJoinModal(roomCode, passcode);
    return;
  }

  state.isStealthMode = !!isStealth;

  try {
    let url = `/api/rooms/${roomCode}`;
    if (passcode) url += `?passcode=${encodeURIComponent(passcode)}`;
    
    const room = await apiRequest(url);
    state.currentRoom = room;
    
    // Update room UI headers
    el.roomTitleDisplay.textContent = room.name;
    el.roomCodeBadge.textContent = `CODE: ${room.room_code}`;
    el.roomHostBadge.textContent = `Host: ${room.host_username || 'Host'}`;
    updateRoomPrivacyUI(room.is_private);

    // Show/hide stealth indicator banner
    if (state.isStealthMode && el.stealthModeBanner) {
      el.stealthModeBanner.classList.remove('hidden');
    } else if (el.stealthModeBanner) {
      el.stealthModeBanner.classList.add('hidden');
    }

    switchView('room');
    el.tapPlayOverlay.classList.remove('hidden');

    updateLocalPeerDisplay();
    connectWebSocket(room.room_code, state.isStealthMode);
    if (!state.isStealthMode) {
      initLocalWebRTC(false); // Auto-connect mic/cams only if not eavesdropping
    }
  } catch (err) {
    if (err.message.includes("Passcode required")) {
      el.joinRoomCodeHidden.value = roomCode;
      showModal(el.modalJoinPasscode);
    } else {
      showCustomAlert("Cannot join room: " + err.message, "Join Error", "error");
    }
  }
}

function updateRoomPrivacyUI(isPrivate) {
  if (isPrivate) {
    if (el.roomLockBadge) el.roomLockBadge.classList.remove('hidden');
  } else {
    if (el.roomLockBadge) el.roomLockBadge.classList.add('hidden');
  }

  const canManage = state.isHost || (state.user && state.user.is_admin);
  if (el.btnToggleRoomPrivacy) {
    if (canManage) {
      el.btnToggleRoomPrivacy.classList.remove('hidden');
      if (el.roomPrivacyBtnText) {
        el.roomPrivacyBtnText.textContent = isPrivate ? 'Make Public' : 'Make Private';
      }
      el.btnToggleRoomPrivacy.className = isPrivate ? 'brutal-btn brutal-btn-mint brutal-btn-xs' : 'brutal-btn brutal-btn-pink brutal-btn-xs';
    } else {
      el.btnToggleRoomPrivacy.classList.add('hidden');
    }
  }
}

async function handleToggleRoomPrivacy() {
  if (!state.currentRoom) return;
  const isCurrentlyPrivate = !!state.currentRoom.is_private;

  if (isCurrentlyPrivate) {
    const confirmed = await showCustomConfirm(
      "Make this room PUBLIC so anyone can discover and join without a passcode?",
      "Make Room Public",
      "Make Public →",
      "Keep Private",
      "info"
    );
    if (!confirmed) return;
    try {
      await apiRequest(`/api/rooms/${state.currentRoom.room_code}`, 'PUT', {
        is_private: false,
        passcode: ""
      });
      state.currentRoom.is_private = false;
      updateRoomPrivacyUI(false);
      showToast("Room is now Public!", "success");
    } catch (err) {
      showCustomAlert("Failed to update room privacy: " + err.message, "Privacy Error", "error");
    }
  } else {
    const code = await showCustomPrompt(
      "Enter an optional passcode for this private room (or leave blank to protect without passcode):",
      "",
      "Optional passcode",
      "Set Room Passcode"
    );
    if (code === null) return;
    try {
      await apiRequest(`/api/rooms/${state.currentRoom.room_code}`, 'PUT', {
        is_private: true,
        passcode: code.trim() || null
      });
      state.currentRoom.is_private = true;
      updateRoomPrivacyUI(true);
      showToast("Room is now Private!", "success");
    } catch (err) {
      showCustomAlert("Failed to update room privacy: " + err.message, "Privacy Error", "error");
    }
  }
}

function handleJoinPasscode(e) {
  e.preventDefault();
  const code = el.joinRoomCodeHidden.value;
  const pass = el.joinRoomPasscodeInput.value;
  hideModal(el.modalJoinPasscode);
  joinRoom(code, pass);
}

function switchShareModalTab(tab = 'link') {
  if (tab === 'email') {
    if (el.subtabShareLink) el.subtabShareLink.classList.remove('active');
    if (el.subtabShareEmail) el.subtabShareEmail.classList.add('active');
    if (el.paneShareLink) el.paneShareLink.classList.add('hidden');
    if (el.paneShareEmail) el.paneShareEmail.classList.remove('hidden');
    if (el.inviteEmailsInput) el.inviteEmailsInput.focus();
  } else {
    if (el.subtabShareLink) el.subtabShareLink.classList.add('active');
    if (el.subtabShareEmail) el.subtabShareEmail.classList.remove('active');
    if (el.paneShareLink) el.paneShareLink.classList.remove('hidden');
    if (el.paneShareEmail) el.paneShareEmail.classList.add('hidden');
  }
}

function openShareRoomModal(roomCode, passcode = null, initialTab = 'link') {
  if (!roomCode) return;
  const url = `${window.location.origin}/?room=${roomCode}`;

  // Automatically write to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showToast("Invite link copied to clipboard!", "success");
    }).catch(() => {
      showToast("Invite link ready to share!", "info");
    });
  } else {
    showToast("Invite link ready to share!", "info");
  }

  // Populate modal data
  if (el.shareRoomUrlInput) el.shareRoomUrlInput.value = url;
  if (el.shareRoomCodeBadge) el.shareRoomCodeBadge.textContent = `CODE: ${roomCode}`;
  
  if (el.shareRoomPassBadge) {
    if (passcode) {
      el.shareRoomPassBadge.textContent = `Passcode: ${passcode}`;
      el.shareRoomPassBadge.classList.remove('hidden');
    } else {
      el.shareRoomPassBadge.classList.add('hidden');
    }
  }

  // Reset email form feedback
  if (el.inviteEmailStatusMsg) {
    el.inviteEmailStatusMsg.classList.add('hidden');
    el.inviteEmailStatusMsg.innerHTML = '';
  }
  if (el.sendEmailBtnText) el.sendEmailBtnText.textContent = "SEND INVITATIONS →";
  if (el.btnSendEmailInvites) el.btnSendEmailInvites.disabled = false;
  // Reset email chips
  inviteEmailChips = [];
  renderEmailChips();

  // Render QR code
  if (el.roomQrCode) {
    el.roomQrCode.innerHTML = '';
    try {
      if (typeof QRCode !== 'undefined') {
        new QRCode(el.roomQrCode, {
          text: url,
          width: 150,
          height: 150,
          colorDark: "#121212",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      } else {
        el.roomQrCode.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}" alt="QR Code" width="150" height="150">`;
      }
    } catch (e) {
      console.warn("QR code render error:", e);
      el.roomQrCode.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}" alt="QR Code" width="150" height="150">`;
    }
  }

  // Wire social links
  const shareText = encodeURIComponent(`Watch videos in sync with me on BingeTogether! Join Room ${roomCode}: ${url}`);
  if (el.shareWhatsapp) el.shareWhatsapp.href = `https://api.whatsapp.com/send?text=${shareText}`;
  if (el.shareTelegram) el.shareTelegram.href = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`Join my watch party on BingeTogether! (Room: ${roomCode})`)}`;
  if (el.shareTwitter) el.shareTwitter.href = `https://twitter.com/intent/tweet?text=${shareText}`;

  // Native Web Share API if supported on mobile devices
  if (el.btnNativeShare) {
    if (navigator.share) {
      el.btnNativeShare.style.display = 'inline-flex';
      el.btnNativeShare.onclick = () => {
        navigator.share({
          title: `BingeTogether - Room ${roomCode}`,
          text: `Join my watch party on BingeTogether!`,
          url: url
        }).catch(() => {});
      };
    } else {
      el.btnNativeShare.style.display = 'none';
    }
  }

  // Reset copy button label
  if (el.copyModalBtnText) el.copyModalBtnText.textContent = "Copy Link";
  if (el.copyInviteTextBtnLabel) el.copyInviteTextBtnLabel.textContent = "Copy Full Invite Message (with Code & Link)";

  switchShareModalTab(initialTab);
  showModal(el.modalShareRoom);
}

function copyInviteLink(initialTab = 'link') {
  if (!state.currentRoom) return;
  openShareRoomModal(state.currentRoom.room_code, state.currentRoom.passcode, initialTab);
}

function copyFullInviteText() {
  const roomName = (state.currentRoom && state.currentRoom.name) ? state.currentRoom.name : 'Watch Party';
  const roomCode = (state.currentRoom && state.currentRoom.room_code) ? state.currentRoom.room_code : ((el.shareRoomUrlInput && el.shareRoomUrlInput.value.split('room=')[1]) || '');
  const pass = (state.currentRoom && state.currentRoom.is_private && state.currentRoom.passcode) ? `\nPasscode: ${state.currentRoom.passcode}` : '';
  const url = (el.shareRoomUrlInput && el.shareRoomUrlInput.value) || `${window.location.origin}/?room=${roomCode}`;

  const message = `🍿 Watch videos in sync with me on BingeTogether!\n\nRoom: ${roomName}\nRoom Code: ${roomCode}${pass}\nDirect Join Link: ${url}`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message);
  } else {
    const ta = document.createElement('textarea');
    ta.value = message;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  if (el.copyInviteTextBtnLabel) {
    el.copyInviteTextBtnLabel.textContent = "Copied to Clipboard!";
    setTimeout(() => {
      if (el.copyInviteTextBtnLabel) el.copyInviteTextBtnLabel.textContent = "Copy Full Invite Message (with Code & Link)";
    }, 2500);
  }
  showToast("Full invite message copied!", "success");
}

function copyEmailTemplate() {
  const roomName = (state.currentRoom && state.currentRoom.name) ? state.currentRoom.name : 'Watch Party';
  const roomCode = (state.currentRoom && state.currentRoom.room_code) ? state.currentRoom.room_code : ((el.shareRoomUrlInput && el.shareRoomUrlInput.value.split('room=')[1]) || '');
  const pass = (state.currentRoom && state.currentRoom.is_private && state.currentRoom.passcode) ? `\nPasscode: ${state.currentRoom.passcode}` : '';
  const url = (el.shareRoomUrlInput && el.shareRoomUrlInput.value) || `${window.location.origin}/?room=${roomCode}`;
  const customNote = (el.inviteCustomNote && el.inviteCustomNote.value.trim()) ? `\nMessage: ${el.inviteCustomNote.value.trim()}\n` : '';

  const emailText = `Subject: 🎬 You're invited to a Watch Party on BingeTogether!\n\nHi!\nYou're invited to join my synchronized watch party "${roomName}" on BingeTogether.${customNote}\n\nJoin Link: ${url}\nRoom Code: ${roomCode}${pass}\n\nSee you there!`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(emailText);
  } else {
    const ta = document.createElement('textarea');
    ta.value = emailText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  showToast("Email template copied to clipboard!", "success");
}

// ----- Email Chip Tag Input System -----
let inviteEmailChips = [];

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function renderEmailChips() {
  if (!el.emailChipsList) return;
  el.emailChipsList.innerHTML = '';
  inviteEmailChips.forEach((email, idx) => {
    const chip = document.createElement('span');
    chip.className = 'email-chip' + (isValidEmail(email) ? '' : ' invalid');
    chip.title = isValidEmail(email) ? email : `Invalid: ${email}`;
    chip.innerHTML = `${escapeHtml(email)}<button type="button" class="btn-remove-chip" data-idx="${idx}" aria-label="Remove">×</button>`;
    chip.querySelector('.btn-remove-chip').addEventListener('click', (e) => {
      e.stopPropagation();
      inviteEmailChips.splice(idx, 1);
      renderEmailChips();
    });
    el.emailChipsList.appendChild(chip);
  });
  if (el.emailChipsCounter) {
    const valid = inviteEmailChips.filter(isValidEmail).length;
    const total = inviteEmailChips.length;
    el.emailChipsCounter.textContent = total === 0 ? '0 added' : `${valid}/${total} valid`;
  }
}

function addEmailChip(raw) {
  const trimmed = raw.trim().toLowerCase().replace(/,/g, '');
  if (!trimmed) return;
  if (!inviteEmailChips.includes(trimmed)) {
    inviteEmailChips.push(trimmed);
    renderEmailChips();
  }
}

function addEmailChipFromInput() {
  if (!el.inviteEmailTagInput) return;
  const val = el.inviteEmailTagInput.value.trim();
  if (val) {
    addEmailChip(val);
    el.inviteEmailTagInput.value = '';
  }
}

function removeLastEmailChip() {
  if (inviteEmailChips.length > 0) {
    inviteEmailChips.pop();
    renderEmailChips();
  }
}

async function handleSendRoomInvites(e) {
  e.preventDefault();
  if (!state.currentRoom) {
    showCustomAlert("Please enter a room first before sending invites", "Notice", "warning");
    return;
  }

  // Commit any typed-but-not-added email
  addEmailChipFromInput();

  const customNote = el.inviteCustomNote ? el.inviteCustomNote.value.trim() : '';
  const emails = inviteEmailChips.filter(isValidEmail);

  if (emails.length === 0) {
    if (el.inviteEmailStatusMsg) {
      el.inviteEmailStatusMsg.className = 'brutal-alert brutal-alert-pink';
      el.inviteEmailStatusMsg.innerHTML = `${getIcon('alert-circle', 'icon-xs')} <span>Please add at least one valid email address (e.g. friend@gmail.com).</span>`;
      el.inviteEmailStatusMsg.classList.remove('hidden');
    }
    return;
  }

  const invalid = inviteEmailChips.filter(e => !isValidEmail(e));
  if (invalid.length > 0) {
    if (el.inviteEmailStatusMsg) {
      el.inviteEmailStatusMsg.className = 'brutal-alert brutal-alert-yellow';
      el.inviteEmailStatusMsg.innerHTML = `${getIcon('alert-triangle', 'icon-xs')} <span>Skipping ${invalid.length} invalid address(es): ${invalid.map(escapeHtml).join(', ')}</span>`;
      el.inviteEmailStatusMsg.classList.remove('hidden');
    }
  }

  try {
    if (el.btnSendEmailInvites) el.btnSendEmailInvites.disabled = true;
    if (el.sendEmailBtnText) el.sendEmailBtnText.innerHTML = `${getIcon('refresh-cw', 'icon-xs spin')} Sending...`;
    if (el.inviteEmailStatusMsg) {
      el.inviteEmailStatusMsg.className = 'brutal-alert brutal-alert-cyan';
      el.inviteEmailStatusMsg.innerHTML = `${getIcon('refresh-cw', 'icon-xs spin')} <span>Dispatching invitations to ${emails.length} email(s) via SMTP...</span>`;
      el.inviteEmailStatusMsg.classList.remove('hidden');
    }

    const payload = {
      emails: emails,
      custom_message: customNote,
      inviter_name: (state.currentUser && state.currentUser.username) ? state.currentUser.username : undefined
    };

    const res = await apiRequest(`/api/rooms/${state.currentRoom.room_code}/invite-email`, 'POST', payload);

    if (el.inviteEmailStatusMsg) {
      el.inviteEmailStatusMsg.className = 'brutal-alert brutal-alert-mint';
      el.inviteEmailStatusMsg.innerHTML = `${getIcon('check', 'icon-xs')} <span>${escapeHtml(res.message || `Invitations dispatched to ${emails.length} email(s)!`)}</span>`;
    }

    // Clear chips on success
    inviteEmailChips = [];
    renderEmailChips();
    showToast(res.message || "Invitations delivered via email!", "success");

  } catch (err) {
    if (el.inviteEmailStatusMsg) {
      el.inviteEmailStatusMsg.className = 'brutal-alert brutal-alert-pink';
      el.inviteEmailStatusMsg.innerHTML = `${getIcon('alert-circle', 'icon-xs')} <span>Failed to send: ${escapeHtml(err.message)}</span>`;
    }
    showToast("Failed to send invitations: " + err.message, "error");
  } finally {
    if (el.btnSendEmailInvites) el.btnSendEmailInvites.disabled = false;
    if (el.sendEmailBtnText) el.sendEmailBtnText.textContent = "SEND INVITATIONS →";
  }
}

function leaveCurrentRoom() {
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  state.isStealthMode = false;
  if (el.stealthModeBanner) el.stealthModeBanner.classList.add('hidden');
  closeWebRTCConnections();
  if (state.driftResetTimer) {
    clearTimeout(state.driftResetTimer);
    state.driftResetTimer = null;
  }
  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.pauseVideo) {
    try { state.ytPlayer.pauseVideo(); } catch(e) {}
  } else if (el.html5Video) {
    try { el.html5Video.pause(); } catch(e) {}
  }
  state.isPlaying = false;
  state.currentRoom = null;
  switchView('browse');
}

// --- WebSocket & Playback Synchronization ---
function connectWebSocket(roomCode, isStealth = false) {
  if (state.ws) state.ws.close();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let wsUrl = `${protocol}//${window.location.host}/ws/room/${roomCode}`;
  if (state.token) {
    wsUrl += `?token=${encodeURIComponent(state.token)}`;
  } else {
    const gName = state.guestName || 'Guest';
    const gAvatar = state.guestAvatar || buildAvatarUrl('bottts', gName, 'b6e3f4');
    wsUrl += `?guest_name=${encodeURIComponent(gName)}&guest_avatar=${encodeURIComponent(gAvatar)}`;
  }

  if (isStealth) {
    wsUrl += `&stealth=true`;
  }
  
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log("WebSocket connected to room", roomCode);
    // webrtc_request_peers is sent after room_init is received (see handleWebSocketMessage)
    // to ensure state.myUserId is set and local stream is ready
  };

  state.ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };

  state.ws.onclose = (event) => {
    console.log("WebSocket connection closed:", event.reason);
  };
}

function getCurrentTime() {
  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.getCurrentTime) {
    return state.ytPlayer.getCurrentTime();
  } else if (el.html5Video) {
    return el.html5Video.currentTime || 0;
  }
  return 0;
}

function getIsPlaying() {
  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.getPlayerState) {
    return state.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
  } else if (el.html5Video) {
    return !el.html5Video.paused;
  }
  return false;
}

async function handleWebSocketMessage(msg) {
  switch (msg.type) {
    case 'stealth_status':
      state.isStealthMode = true;
      if (el.stealthModeBanner) el.stealthModeBanner.classList.remove('hidden');
      break;

    case 'room_init':
      state.isHost = msg.is_host;
      state.hostOnlyControl = msg.host_only_control;
      state.myUserId = String(msg.user_id);
      state.activeVideoUrl = msg.active_video_url;
      state.activeVideoTitle = msg.active_video_title;
      loadMedia(msg.active_video_url, msg.active_video_title, msg.active_video_type, msg.current_time, msg.is_playing);
      renderChatHistory(msg.chat_history);
      if (msg.queue_items) renderQueue(msg.queue_items);

      // Auto request host live position when joining as guest
      if (!state.isHost) {
        setTimeout(() => requestSyncWithHost(), 800);
      }

      // Now that myUserId is set and WS is ready, request the peer list for WebRTC
      // Give the local stream a moment to initialize if it's still being acquired
      setTimeout(() => {
        if (state.localStream && state.ws && state.ws.readyState === WebSocket.OPEN && !state.isStealthMode) {
          state.ws.send(JSON.stringify({ type: 'webrtc_request_peers' }));
        }
      }, 600);
      break;

    case 'room_settings_updated':
      if (state.currentRoom) {
        if (msg.is_private !== undefined) {
          state.currentRoom.is_private = msg.is_private;
          updateRoomPrivacyUI(msg.is_private);
        }
        if (msg.name) {
          state.currentRoom.name = msg.name;
          if (el.roomTitleDisplay) el.roomTitleDisplay.textContent = msg.name;
        }
      }
      break;

    case 'request_sync_from_host':
      if (state.isHost && state.ws && state.ws.readyState === WebSocket.OPEN) {
        const curr = getCurrentTime();
        const playing = getIsPlaying();
        state.ws.send(JSON.stringify({ type: 'host_sync_broadcast', time: curr, is_playing: playing }));
      }
      break;

    case 'host_sync_response':
      if (String(msg.sender_id) !== getUserId()) {
        handleHostSyncResponse(msg);
      }
      break;

    case 'queue_update':
      if (msg.queue_items) renderQueue(msg.queue_items);
      break;

    case 'participants_update':
      renderParticipants(msg.participants);
      break;

    case 'chat_message':
      appendChatMessage(msg);
      break;

    case 'change_video':
      state.activeVideoUrl = msg.video_url;
      state.activeVideoTitle = msg.video_title;
      loadMedia(msg.video_url, msg.video_title, msg.video_type, 0.0, false);
      break;

    case 'playback_play':
      if (String(msg.sender_id) !== getUserId()) {
        seekAndPlay(msg.time);
      }
      break;

    case 'playback_pause':
      if (String(msg.sender_id) !== getUserId()) {
        seekAndPause(msg.time);
      }
      break;

    case 'playback_seek':
      if (String(msg.sender_id) !== getUserId()) {
        performSeek(msg.time);
      }
      break;

    case 'webrtc_peers_list':
      handleWebRTCPeersList(msg.peers);
      break;

    case 'webrtc_offer':
      handleWebRTCOffer(msg);
      break;

    case 'webrtc_answer':
      handleWebRTCAnswer(msg);
      break;

    case 'webrtc_candidate':
      handleWebRTCCandidate(msg);
      break;

    case 'webrtc_peer_disconnected':
      removeWebRTCPeer(msg.peer_id);
      break;

    case 'system_error':
      showCustomAlert(msg.message, "System Alert", "warning");
      break;

    case 'room_closed':
      await showCustomAlert(msg.message, "Room Closed", "error");
      leaveCurrentRoom();
      break;
  }
}

function getUserId() {
  return state.myUserId ? String(state.myUserId) : (state.user ? String(state.user.id) : null);
}

// --- Player & Media Engine ---
function loadMedia(url, title, type = 'youtube', startTime = 0.0, autoplay = false, segmentStart = 0.0, segmentEnd = 0.0) {
  setRemoteActionGuard(4000);
  state.activePlayerType = type;
  state.pendingSeekTime = parseFloat(startTime || 0);
  state.segmentStart = parseFloat(segmentStart || 0);
  state.segmentEnd = parseFloat(segmentEnd || 0);
  el.nowPlayingTitle.textContent = title || url || "Media Stream";

  if (type === 'youtube') {
    el.ytPlayerContainer.classList.remove('hidden');
    el.html5PlayerContainer.classList.add('hidden');
    
    const ytId = extractYouTubeID(url);
    if (!ytId) return;

    const renderYtPlayer = () => {
      if (window.YT && window.YT.Player) {
        if (!state.ytPlayer) {
          try {
            state.ytPlayer = new YT.Player('yt-player', {
              height: '100%',
              width: '100%',
              videoId: ytId,
              playerVars: {
                'autoplay': autoplay ? 1 : 0,
                'controls': 0,
                'disablekb': 1,
                'fs': 0,
                'modestbranding': 1,
                'rel': 0,
                'iv_load_policy': 3,
                'start': Math.floor(startTime),
                'enablejsapi': 1
              },
              events: {
                'onReady': (event) => {
                  if (state.pendingSeekTime > 0) {
                    try { event.target.seekTo(state.pendingSeekTime, true); } catch(e) {}
                  }
                  if (autoplay) {
                    try { event.target.playVideo(); } catch(e) {}
                  }
                },
                'onStateChange': onYtStateChange
              }
            });
          } catch (e) {
            console.error("Error building YT.Player, falling back to direct iframe:", e);
            fallbackYtIframe(ytId);
          }
        } else if (state.ytPlayer.loadVideoById) {
          state.ytPlayer.loadVideoById({'videoId': ytId, 'startSeconds': startTime});
          if (startTime > 0) {
            try { state.ytPlayer.seekTo(startTime, true); } catch(e) {}
          }
          if (autoplay) state.ytPlayer.playVideo();
          else state.ytPlayer.pauseVideo();
        }
      } else {
        fallbackYtIframe(ytId);
      }
    };

    if (window.YT && window.YT.Player) {
      renderYtPlayer();
    } else {
      state.pendingYtLoad = renderYtPlayer;
      fallbackYtIframe(ytId);
    }
  } else {
    // MP4 / HTML5 Range Stream
    el.html5PlayerContainer.classList.remove('hidden');
    el.ytPlayerContainer.classList.add('hidden');

    const fullUrl = new URL(url, window.location.href).href;
    const isSameSrc = (el.html5Video.src === fullUrl || el.html5Video.currentSrc === fullUrl);
    if (!isSameSrc) {
      el.html5Video.src = url;
    }

    const applySeekAndPlay = () => {
      if (startTime >= 0) {
        try {
          if (Math.abs(el.html5Video.currentTime - startTime) > 0.5) {
            el.html5Video.currentTime = startTime;
          }
        } catch (e) {
          console.warn("Error setting currentTime:", e);
        }
      }
      if (autoplay) {
        el.html5Video.play().catch(() => {
          el.tapPlayOverlay.classList.remove('hidden');
        });
      } else {
        el.html5Video.pause();
      }
    };

    if (isSameSrc || el.html5Video.readyState >= 1) {
      applySeekAndPlay();
    } else {
      el.html5Video.onloadedmetadata = () => {
        applySeekAndPlay();
      };
    }

    el.html5Video.onplay = () => onNativePlay();
    el.html5Video.onpause = () => onNativePause();
    el.html5Video.ontimeupdate = updateTimeDisplay;
    el.html5Video.onended = () => handleSegmentAutoAdvance();

    // Auto-resume if live stream temporarily reaches current written disk boundary
    el.html5Video.onstalled = el.html5Video.onwaiting = () => {
      if (title.includes("Live Uploading")) {
        setTimeout(() => {
          if (state.isPlaying && el.html5Video.paused) {
            el.html5Video.play().catch(() => {});
          }
        }, 1200);
      }
    };
  }
}

function fallbackYtIframe(ytId) {
  const container = document.getElementById('yt-player-container');
  if (container) {
    container.innerHTML = `<iframe id="yt-fallback-frame" width="100%" height="100%" src="https://www.youtube.com/embed/${ytId}?enablejsapi=1&autoplay=1&controls=0&disablekb=1&fs=0&modestbranding=1&rel=0&iv_load_policy=3" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }
}

function extractYouTubeID(url) {
  if (!url) return 'dQw4w9WgXcQ';
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : url;
}

function handleTapToPlay() {
  el.tapPlayOverlay.classList.add('hidden');
  setRemoteActionGuard(4000);

  const targetTime = (state.pendingSeekTime && state.pendingSeekTime > 0) ? state.pendingSeekTime : getCurrentTime();

  if (state.activePlayerType === 'youtube') {
    if (state.ytPlayer && state.ytPlayer.playVideo) {
      if (targetTime > 0) {
        try { state.ytPlayer.seekTo(targetTime, true); } catch(e) {}
      }
      state.ytPlayer.playVideo();
    } else {
      const fallbackFrame = document.getElementById('yt-fallback-frame');
      if (fallbackFrame) {
        fallbackFrame.src = fallbackFrame.src;
      }
    }
  } else if (el.html5Video) {
    if (targetTime > 0) {
      try { el.html5Video.currentTime = targetTime; } catch(e) {}
    }
    el.html5Video.play().catch(e => console.error("Tap play error:", e));
  }

  // Request fresh position from host
  setTimeout(() => requestSyncWithHost(), 400);
}

// --- Player State Events (With Remote Suppress Guard) ---
function setRemoteActionGuard(durationMs = 2000) {
  state.isRemoteAction = true;
  state.suppressBroadcastUntil = Date.now() + durationMs;
  setTimeout(() => {
    state.isRemoteAction = false;
  }, durationMs);
}

function setPlaybackRate(rate) {
  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.setPlaybackRate) {
    try { state.ytPlayer.setPlaybackRate(rate); } catch(e) {}
  } else if (el.html5Video) {
    try { el.html5Video.playbackRate = rate; } catch(e) {}
  }
}

function handleHostSyncResponse(msg) {
  const targetTime = parseFloat(msg.time) || 0;
  state.pendingSeekTime = targetTime;
  const hostIsPlaying = !!msg.is_playing;
  const myTime = getCurrentTime();
  const myPlaying = getIsPlaying();
  const drift = Math.abs(myTime - targetTime);

  // 1. Playback state mismatch:
  if (hostIsPlaying && !myPlaying) {
    seekAndPlay(targetTime);
    return;
  } else if (!hostIsPlaying && myPlaying) {
    seekAndPause(targetTime);
    return;
  }

  // 2. Both playing: Check drift
  if (hostIsPlaying) {
    if (drift > 1.2) {
      // Noticeable drift: seek directly
      performSeek(targetTime);
    } else if (drift > 0.35) {
      // Micro drift: adjust playback rate for smooth alignment without audio stutter
      const targetRate = myTime > targetTime ? 0.95 : 1.05;
      setPlaybackRate(targetRate);
      if (state.driftResetTimer) clearTimeout(state.driftResetTimer);
      state.driftResetTimer = setTimeout(() => {
        setPlaybackRate(1.0);
      }, 1500);
    }
  } else {
    // Both paused
    if (drift > 0.5) {
      performSeek(targetTime);
    }
  }
}

function onYtStateChange(event) {
  // Prevent echo loop from remote commands or host-only restrictions
  if (Date.now() < state.suppressBroadcastUntil || state.isRemoteAction) return;
  if (state.hostOnlyControl && !state.isHost) return;

  if (event.data === YT.PlayerState.PLAYING) {
    state.isPlaying = true;
    updatePlayPauseBtn(true);
    broadcastPlaybackEvent('playback_play', state.ytPlayer.getCurrentTime());
  } else if (event.data === YT.PlayerState.PAUSED) {
    state.isPlaying = false;
    updatePlayPauseBtn(false);
    broadcastPlaybackEvent('playback_pause', state.ytPlayer.getCurrentTime());
  }
}

function updatePlayPauseBtn(isPlaying) {
  if (!el.ctrlPlayPause) return;
  if (isPlaying) {
    el.ctrlPlayPause.innerHTML = getIcon('pause', 'icon-sm');
  } else {
    el.ctrlPlayPause.innerHTML = getIcon('play', 'icon-sm');
  }
}

function onNativePlay() {
  if (Date.now() < state.suppressBroadcastUntil || state.isRemoteAction) return;
  if (state.hostOnlyControl && !state.isHost) return;

  state.isPlaying = true;
  updatePlayPauseBtn(true);
  broadcastPlaybackEvent('playback_play', el.html5Video.currentTime);
}

function onNativePause() {
  if (Date.now() < state.suppressBroadcastUntil || state.isRemoteAction) return;
  if (state.hostOnlyControl && !state.isHost) return;

  state.isPlaying = false;
  updatePlayPauseBtn(false);
  broadcastPlaybackEvent('playback_pause', el.html5Video.currentTime);
}

function broadcastPlaybackEvent(type, time) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({ type, time }));
}

function togglePlayback() {
  if (state.hostOnlyControl && !state.isHost) {
    showToast("Only the host can control playback in this room.", "warning");
    return;
  }

  // Clear suppression for explicit user actions
  state.suppressBroadcastUntil = 0;
  state.isRemoteAction = false;

  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.getPlayerState) {
    const ytState = state.ytPlayer.getPlayerState();
    if (ytState === YT.PlayerState.PLAYING) {
      state.ytPlayer.pauseVideo();
      state.isPlaying = false;
      updatePlayPauseBtn(false);
      broadcastPlaybackEvent('playback_pause', state.ytPlayer.getCurrentTime());
    } else {
      state.ytPlayer.playVideo();
      state.isPlaying = true;
      updatePlayPauseBtn(true);
      broadcastPlaybackEvent('playback_play', state.ytPlayer.getCurrentTime());
    }
  } else if (el.html5Video) {
    if (el.html5Video.paused) {
      el.html5Video.play().catch(() => {});
      state.isPlaying = true;
      updatePlayPauseBtn(true);
      broadcastPlaybackEvent('playback_play', el.html5Video.currentTime);
    } else {
      el.html5Video.pause();
      state.isPlaying = false;
      updatePlayPauseBtn(false);
      broadcastPlaybackEvent('playback_pause', el.html5Video.currentTime);
    }
  }
}

function handleSeekInput() {
  if (state.hostOnlyControl && !state.isHost) {
    showToast("Only the host can control playback in this room.", "warning");
    return;
  }

  const percent = parseFloat(el.ctrlSeekbar.value);
  let seekTime = 0;
  if (state.segmentEnd > state.segmentStart) {
    const segDur = state.segmentEnd - state.segmentStart;
    seekTime = state.segmentStart + (percent / 100) * segDur;
  } else {
    let duration = 1;
    if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.getDuration) {
      duration = state.ytPlayer.getDuration();
    } else if (el.html5Video) {
      duration = el.html5Video.duration || 1;
    }
    seekTime = (percent / 100) * duration;
  }
  
  // User initiated seek: broadcast immediately
  state.suppressBroadcastUntil = 0;
  performSeekDirect(seekTime);
  broadcastPlaybackEvent('playback_seek', seekTime);
}

function performSeekDirect(time) {
  setRemoteActionGuard(1500);
  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.seekTo) {
    state.ytPlayer.seekTo(time, true);
  } else if (el.html5Video) {
    el.html5Video.currentTime = time;
    if (state.isPlaying) {
      el.html5Video.play().catch(() => {});
    }
  }
}

function performSeek(time) {
  setRemoteActionGuard(2000);
  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.seekTo) {
    const curr = state.ytPlayer.getCurrentTime ? state.ytPlayer.getCurrentTime() : 0;
    if (Math.abs(curr - time) > 0.5) {
      state.ytPlayer.seekTo(time, true);
    }
  } else if (el.html5Video) {
    if (Math.abs(el.html5Video.currentTime - time) > 0.5) {
      el.html5Video.currentTime = time;
    }
  }
}

function seekAndPlay(time) {
  setRemoteActionGuard(2500);
  performSeek(time);
  state.isPlaying = true;
  updatePlayPauseBtn(true);
  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.playVideo) {
    state.ytPlayer.playVideo();
  } else if (el.html5Video) {
    el.html5Video.play().catch(() => {
      el.tapPlayOverlay.classList.remove('hidden');
    });
  }
}

function seekAndPause(time) {
  setRemoteActionGuard(2000);
  performSeek(time);
  state.isPlaying = false;
  updatePlayPauseBtn(false);
  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.pauseVideo) {
    state.ytPlayer.pauseVideo();
  } else if (el.html5Video) {
    el.html5Video.pause();
  }
}

function updateTimeDisplay() {
  let curr = 0, dur = 0;
  if (state.activePlayerType === 'youtube' && state.ytPlayer && state.ytPlayer.getCurrentTime) {
    curr = state.ytPlayer.getCurrentTime();
    dur = state.ytPlayer.getDuration();
  } else if (el.html5Video) {
    curr = el.html5Video.currentTime || 0;
    dur = el.html5Video.duration || 0;
  }

  if (state.segmentEnd > state.segmentStart) {
    const segDur = state.segmentEnd - state.segmentStart;
    const segCurr = Math.max(0, Math.min(segDur, curr - state.segmentStart));
    if (segDur > 0) {
      el.ctrlSeekbar.value = (segCurr / segDur) * 100;
    }
    el.ctrlTimeDisplay.textContent = `${formatTime(segCurr)} / ${formatTime(segDur)}`;

    if (state.isHost && curr >= state.segmentEnd - 0.5) {
      handleSegmentAutoAdvance();
    }
  } else {
    if (dur > 0) {
      el.ctrlSeekbar.value = (curr / dur) * 100;
    }
    el.ctrlTimeDisplay.textContent = `${formatTime(curr)} / ${formatTime(dur)}`;
  }
}

function formatTime(secs) {
  if (isNaN(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

setInterval(updateTimeDisplay, 1000);

// Host Periodic Playback Heartbeat (Sync Pulse)
setInterval(() => {
  if (state.currentRoom && state.isHost && state.ws && state.ws.readyState === WebSocket.OPEN) {
    const curr = getCurrentTime();
    const playing = getIsPlaying();
    state.ws.send(JSON.stringify({
      type: 'host_sync_broadcast',
      time: curr,
      is_playing: playing
    }));
  }
}, 2000);

function requestSyncWithHost() {
  if (state.currentRoom && state.ws && state.ws.readyState === WebSocket.OPEN) {
    if (state.isHost) {
      const curr = getCurrentTime();
      const playing = getIsPlaying();
      state.ws.send(JSON.stringify({ type: 'host_sync_broadcast', time: curr, is_playing: playing }));
    } else {
      if (el.syncOverlay && el.syncOverlayText) {
        el.syncOverlayText.textContent = "Syncing playback with host...";
        el.syncOverlay.classList.remove('hidden');
        setTimeout(() => el.syncOverlay.classList.add('hidden'), 1200);
      }
      state.ws.send(JSON.stringify({ type: 'request_sync' }));
    }
  }
}

function toggleFullscreen() {
  const playerTarget = el.playerCard || document.getElementById('player-card') || el.playerWrapper;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (playerTarget && playerTarget.requestFullscreen) {
      playerTarget.requestFullscreen().catch(err => {
        console.warn("Fullscreen request error, toggling theater mode fallback:", err);
        toggleTheaterMode();
      });
    } else if (playerTarget && playerTarget.webkitRequestFullscreen) {
      playerTarget.webkitRequestFullscreen();
    } else {
      toggleTheaterMode();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

function toggleTheaterMode() {
  const roomPage = document.querySelector('.room-page-container');
  if (roomPage) {
    roomPage.classList.toggle('is-theater-stage');
    const isTheater = roomPage.classList.contains('is-theater-stage');
    if (el.ctrlTheater) {
      el.ctrlTheater.classList.toggle('active', isTheater);
    }
  }
}

function toggleChatSidebar(forceOpen = null) {
  if (forceOpen !== null) {
    state.sidebarVisible = forceOpen;
  } else {
    state.sidebarVisible = !state.sidebarVisible;
  }

  const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);

  if (el.roomLayout) {
    el.roomLayout.classList.toggle('sidebar-collapsed', !state.sidebarVisible);
  }

  if (el.playerChatOverlay) {
    // In fullscreen mode, show the in-player chat overlay if opened
    if (isFull) {
      el.playerChatOverlay.classList.toggle('hidden', !state.sidebarVisible);
      if (state.sidebarVisible && el.playerChatInput) {
        setTimeout(() => el.playerChatInput.focus(), 50);
      }
    } else {
      // In normal mode, if user opened chat, keep overlay hidden since sidebar chat is visible
      el.playerChatOverlay.classList.add('hidden');
    }
  }

  if (el.ctrlToggleChat) {
    el.ctrlToggleChat.classList.toggle('active', state.sidebarVisible);
    if (state.sidebarVisible && el.chatUnreadBadge) {
      el.chatUnreadBadge.classList.add('hidden');
    }
  }

  if (el.btnToggleSidebarHeader) {
    el.btnToggleSidebarHeader.classList.toggle('active', state.sidebarVisible);
  }

  if (el.headerChatBtnText) {
    el.headerChatBtnText.textContent = state.sidebarVisible ? "Hide Sidebar" : "Show Chat / Video";
  }
}

function toggleMemberCams(forceState = null) {
  if (forceState !== null) {
    state.camsVisible = forceState;
  } else {
    state.camsVisible = !state.camsVisible;
  }

  if (el.playerPeersStrip) {
    el.playerPeersStrip.classList.toggle('hidden', !state.camsVisible);
  }

  if (el.ctrlToggleCams) {
    el.ctrlToggleCams.classList.toggle('active', state.camsVisible);
  }
}

function setupPlayerControlsHover() {
  const showControls = () => {
    if (el.playerCard) {
      el.playerCard.classList.add('show-controls');
      el.playerCard.classList.remove('hide-cursor');
    }
    if (el.playerWrapper) {
      el.playerWrapper.classList.add('show-controls');
    }

    if (state.controlsHideTimer) clearTimeout(state.controlsHideTimer);
    state.controlsHideTimer = setTimeout(() => {
      if (el.playerCard) {
        el.playerCard.classList.remove('show-controls');
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          el.playerCard.classList.add('hide-cursor');
        }
      }
      if (el.playerWrapper) {
        el.playerWrapper.classList.remove('show-controls');
      }
    }, 2500);
  };

  const hitZone = document.getElementById('player-bottom-hit-zone');
  const targets = [
    el.playerCard,
    el.playerWrapper,
    hitZone,
    document.getElementById('player-card'),
    document.getElementById('player-wrapper')
  ].filter(Boolean);

  targets.forEach(target => {
    target.addEventListener('mousemove', showControls);
    target.addEventListener('mouseenter', showControls);
    target.addEventListener('touchstart', showControls, { passive: true });
    target.addEventListener('pointermove', showControls);
    target.addEventListener('mouseleave', () => {
      if (state.controlsHideTimer) clearTimeout(state.controlsHideTimer);
      state.controlsHideTimer = setTimeout(() => {
        if (el.playerCard) el.playerCard.classList.remove('show-controls');
        if (el.playerWrapper) el.playerWrapper.classList.remove('show-controls');
      }, 400);
    });
  });

  // Global mouse activity in fullscreen mode
  document.addEventListener('mousemove', () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      showControls();
    }
  });

  window.triggerShowPlayerControls = showControls;
}

function showChatToast(msg) {
  if (!el.chatToastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'chat-toast-item';
  const avatarUrl = msg.avatar_url || buildAvatarUrl('bottts', msg.username, 'ffd5dc');
  toast.innerHTML = `
    <img src="${avatarUrl}" class="chat-toast-avatar" alt="${escapeHtml(msg.username)}">
    <div class="chat-toast-body">
      <span class="chat-toast-user">${escapeHtml(msg.username)}</span>
      <span class="chat-toast-msg">${escapeHtml(msg.content)}</span>
    </div>
  `;
  toast.onclick = () => {
    toggleChatSidebar(true);
    toast.remove();
  };
  el.chatToastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(25px)';
    setTimeout(() => toast.remove(), 350);
  }, 4500);
}

document.addEventListener('fullscreenchange', () => {
  const isFull = !!document.fullscreenElement;
  document.body.classList.toggle('is-in-fullscreen', isFull);
  if (el.playerCard) el.playerCard.classList.toggle('is-fullscreen', isFull);
  if (window.triggerShowPlayerControls) window.triggerShowPlayerControls();
});
document.addEventListener('webkitfullscreenchange', () => {
  const isFull = !!document.webkitFullscreenElement;
  document.body.classList.toggle('is-in-fullscreen', isFull);
  if (el.playerCard) el.playerCard.classList.toggle('is-fullscreen', isFull);
  if (window.triggerShowPlayerControls) window.triggerShowPlayerControls();
});

// Media Source Load Handlers
function handleLoadYtVideo() {
  const url = el.ytUrlInput.value.trim();
  if (!url) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({
    type: 'change_video',
    video_url: url,
    video_title: "YouTube Video",
    video_type: "youtube"
  }));
}

async function loadUploadedVideosDropdown() {
  try {
    const videos = await apiRequest('/api/media/videos');
    el.localVideoSelect.innerHTML = videos.length === 0
      ? '<option value="">No uploaded MP4 videos yet</option>'
      : videos.map(v => `<option value="${v.stream_url}" data-title="${escapeHtml(v.original_name)}">${escapeHtml(v.original_name)} (${(v.file_size / (1024*1024)).toFixed(1)} MB)</option>`).join('');
  } catch (err) {
    console.error("Error fetching videos:", err);
  }
}

function handleLoadLocalVideo() {
  const selectedOpt = el.localVideoSelect.options[el.localVideoSelect.selectedIndex];
  if (!selectedOpt || !selectedOpt.value) return;
  const streamUrl = selectedOpt.value;
  const title = selectedOpt.getAttribute('data-title');
  state.ws.send(JSON.stringify({
    type: 'change_video',
    video_url: streamUrl,
    video_title: title,
    video_type: "mp4"
  }));
}

// --- Segmented 10-Minute Video Queue & Upload Engine ---
function renderQueue(items) {
  state.currentQueue = items || [];
  if (el.queueCountNum) el.queueCountNum.textContent = state.currentQueue.length;
  if (!el.queueListContainer) return;

  if (state.currentQueue.length === 0) {
    el.queueListContainer.innerHTML = '<div class="queue-empty" style="color: var(--text-muted); font-size: 0.85rem;">No items in queue</div>';
    return;
  }

  el.queueListContainer.innerHTML = state.currentQueue.map(item => {
    let statusBadge = '';
    if (item.status === 'playing') {
      statusBadge = `<span class="brutal-pill bg-pastel-mint" style="font-size:0.72rem; padding:2px 8px; display:inline-flex; align-items:center; gap:0.3rem;">${getIcon('play', 'icon-xs')} Playing</span>`;
    } else if (item.status === 'uploading') {
      statusBadge = `<span class="brutal-pill bg-pastel-cyan" style="font-size:0.72rem; padding:2px 8px; display:inline-flex; align-items:center; gap:0.3rem;">${getIcon('loader', 'icon-xs')} Uploading (${item.progress || 0}%)</span>`;
    } else if (item.status === 'ready') {
      statusBadge = `<span class="brutal-pill bg-pastel-mint" style="font-size:0.72rem; padding:2px 8px; display:inline-flex; align-items:center; gap:0.3rem;">${getIcon('check', 'icon-xs')} Ready</span>`;
    } else {
      statusBadge = `<span class="brutal-pill bg-pastel-yellow" style="font-size:0.72rem; padding:2px 8px; display:inline-flex; align-items:center; gap:0.3rem;">${getIcon('clock', 'icon-xs')} Queued</span>`;
    }

    const isHostBtn = state.isHost ? `
      <button class="btn btn-xs btn-primary" onclick="playQueueItem(${item.id})">Play</button>
      <button class="btn btn-xs btn-danger" onclick="deleteQueueItem(${item.id})">&times;</button>
    ` : '';

    return `
      <div class="queue-item-card" style="display:flex; align-items:center; justify-content:space-between; padding:8px; margin-bottom:6px; background:rgba(255,255,255,0.05); border-radius:6px; font-size:0.85rem;">
        <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:8px;">
          <strong style="color:var(--text-color);">${escapeHtml(item.title)}</strong>
          <div style="margin-top:2px;">${statusBadge}</div>
        </div>
        <div style="display:flex; gap:4px;">${isHostBtn}</div>
      </div>
    `;
  }).join('');
}

async function playQueueItem(itemId) {
  if (!state.currentRoom || !state.isHost) return;
  const item = (state.currentQueue || []).find(q => q.id === itemId);
  if (!item) return;
  
  await apiRequest(`/api/rooms/${state.currentRoom.room_code}/queue/${itemId}`, 'PUT', { status: 'playing' });
  if (state.ws) state.ws.send(JSON.stringify({ type: 'queue_broadcast' }));
  
  state.ws.send(JSON.stringify({
    type: 'change_video',
    video_url: item.video_url,
    video_title: item.title,
    video_type: item.video_type || 'mp4',
    start_time: item.start_time || 0.0,
    end_time: item.end_time || 0.0
  }));
}

async function deleteQueueItem(itemId) {
  if (!state.currentRoom) return;
  await apiRequest(`/api/rooms/${state.currentRoom.room_code}/queue/${itemId}`, 'DELETE');
  if (state.ws) state.ws.send(JSON.stringify({ type: 'queue_broadcast' }));
}

async function clearQueue() {
  if (!state.currentRoom || !state.isHost) {
    showToast("Only the host can clear the room queue.", "warning");
    return;
  }
  const confirmed = await showCustomConfirm(
    "Are you sure you want to clear all items in the video queue?",
    "Clear Queue",
    "Clear Queue →",
    "Cancel",
    "danger"
  );
  if (!confirmed) return;
  try {
    await apiRequest(`/api/rooms/${state.currentRoom.room_code}/queue`, 'DELETE');
    if (state.ws) state.ws.send(JSON.stringify({ type: 'queue_broadcast' }));
    showToast("Video queue cleared.", "info");
  } catch (err) {
    showCustomAlert("Clear queue failed: " + err.message, "Queue Error", "error");
  }
}

function handleSegmentAutoAdvance() {
  if (!state.isHost || !state.currentQueue || state.currentQueue.length === 0) return;
  const currentIndex = state.currentQueue.findIndex(q => q.status === 'playing');
  const nextItem = state.currentQueue.find((q, idx) => idx > currentIndex && (q.status === 'ready' || q.status === 'queued'));
  if (nextItem) {
    console.log("Auto-advancing to next video segment in queue:", nextItem.title);
    playQueueItem(nextItem.id);
  }
}

function getVideoDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(video.duration || 0);
    };
    video.onerror = () => resolve(0);
    video.src = URL.createObjectURL(file);
  });
}

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (state.isUploading) {
    showToast("An upload is already in progress. Please wait for it to complete.", "warning");
    return;
  }

  if (!state.token) {
    showCustomAlert("Please sign in to upload video files.", "Authentication Required", "info");
    showModal(el.modalLogin);
    return;
  }

  state.isUploading = true;
  el.uploadProgressContainer.classList.remove('hidden');
  el.uploadProgressFill.style.width = '0%';
  el.uploadPercentText.textContent = '0%';
  el.uploadStatusText.textContent = 'Initializing chunked upload...';

  const startTime = Date.now();

  try {
    // 1. Initialize upload session
    const initRes = await apiRequest('/api/media/upload/init', 'POST', {
      filename: file.name,
      file_size: file.size
    });

    const uploadId = initRes.upload_id;
    const chunkSize = initRes.chunk_size || (2 * 1024 * 1024);
    const totalChunks = Math.ceil(file.size / chunkSize);

    el.uploadStatusText.textContent = `Uploading ${totalChunks} chunks...`;

    // 2. Upload chunks sequentially with automatic retry
    for (let index = 0; index < totalChunks; index++) {
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunkBlob = file.slice(start, end);

      let success = false;
      let attempts = 0;
      while (!success && attempts < 3) {
        attempts++;
        try {
          const formData = new FormData();
          formData.append('upload_id', uploadId);
          formData.append('chunk_index', index);
          formData.append('chunk_file', chunkBlob, `chunk_${index}.part`);

          await apiRequest('/api/media/upload/chunk', 'POST', formData, true);
          success = true;
        } catch (chunkErr) {
          if (attempts >= 3) throw chunkErr;
          await new Promise(r => setTimeout(r, 600));
        }
      }

      const percent = Math.round(((index + 1) / totalChunks) * 100);
      el.uploadProgressFill.style.width = `${percent}%`;
      el.uploadPercentText.textContent = `${percent}%`;

      const uploadedMb = (end / (1024 * 1024)).toFixed(1);
      const totalMb = (file.size / (1024 * 1024)).toFixed(1);
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speedMbSec = elapsedSec > 0 ? (end / (1024 * 1024) / elapsedSec).toFixed(1) : '0';

      el.uploadStatusText.textContent = `Uploading chunk ${index + 1}/${totalChunks} (${uploadedMb}/${totalMb} MB, ${speedMbSec} MB/s)...`;
    }

    // 3. Finalize upload & process container (faststart optimization)
    el.uploadStatusText.textContent = "Finalizing video...";
    const compFormData = new FormData();
    compFormData.append('upload_id', uploadId);
    compFormData.append('filename', file.name);

    const videoResult = await apiRequest('/api/media/upload/complete', 'POST', compFormData, true);

    el.uploadStatusText.textContent = "Upload Complete!";
    el.uploadProgressFill.style.width = '100%';
    el.uploadPercentText.textContent = '100%';

    // Refresh uploaded video lists
    loadLocalVideos();
    if (state.user && state.user.is_admin) {
      loadAdminVideos();
    }

    setTimeout(() => {
      hideModal(el.modalUploadVideo);
      el.uploadProgressContainer.classList.add('hidden');
    }, 600);

    // If inside a room, automatically stream the uploaded video!
    if (state.currentRoom && state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({
        type: 'change_video',
        video_url: videoResult.stream_url,
        video_title: videoResult.original_name || file.name,
        video_type: 'mp4'
      }));
    } else {
      showToast(`Video "${file.name}" uploaded successfully!`, "success");
    }

  } catch (err) {
    console.error("Upload error:", err);
    showCustomAlert("Upload failed: " + err.message, "Upload Error", "error");
    el.uploadStatusText.textContent = "Upload Failed: " + err.message;
  } finally {
    state.isUploading = false;
    e.target.value = '';
  }
}

// --- WebRTC Peer-to-Peer Mesh Audio/Video Engine ---
function updateLocalPeerDisplay() {
  const avatar = state.user ? state.user.avatar_url : (state.guestAvatar || buildAvatarUrl('bottts', state.guestName || 'You', 'b6e3f4'));
  const name = state.user ? state.user.username : (state.guestName || 'Guest');
  
  if (el.localAvatarImg) el.localAvatarImg.src = avatar;
  if (el.localPeerName) el.localPeerName.textContent = `You (${name})`;
  if (el.localMicBadge) el.localMicBadge.innerHTML = state.micMuted ? getIcon('mic-off', 'icon-xs') : getIcon('mic', 'icon-xs');

  const isCamActive = state.localStream && !state.camOff && state.localStream.getVideoTracks().some(t => t.enabled);
  if (el.localVideo) {
    el.localVideo.classList.toggle('hidden', !isCamActive);
  }
  if (el.localAvatarFallback) {
    el.localAvatarFallback.classList.toggle('hidden', isCamActive);
  }
}

async function initLocalWebRTC(userInitiated = false) {
  updateLocalPeerDisplay();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    el.webrtcStatusMsg.innerHTML = 'Note: Modern browsers require <strong>HTTPS</strong> or <strong>localhost</strong> to prompt for physical camera/mic permissions over IP.<br>For HTTP IP access: enable Chrome flag <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> for <code>http://' + window.location.host + '</code>';
    if (userInitiated) {
      showCustomAlert(
        "Browser Security Policy: Camera & Microphone permissions require HTTPS or localhost. To enable on HTTP IP, open chrome://flags/#unsafely-treat-insecure-origin-as-secure and add http://" + window.location.host,
        "Browser Security Policy",
        "warning"
      );
    }
    return;
  }

  try {
    if (el.webrtcStatusMsg) el.webrtcStatusMsg.textContent = 'Requesting camera & microphone access...';

    // Try video + audio first, fall back to audio-only
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }
      });
    } catch (err) {
      console.warn("Video+Audio failed, trying audio-only...", err);
      try {
        state.localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      } catch (audioErr) {
        throw audioErr;
      }
    }

    if (el.localVideo) el.localVideo.srcObject = state.localStream;
    if (el.webrtcStatusMsg) el.webrtcStatusMsg.textContent = 'Camera & Microphone active. Connecting peers...';
    updateLocalPeerDisplay();

    // If already connected to existing peers, add tracks to those connections
    Object.entries(state.peerConnections).forEach(([peerId, pc]) => {
      if (pc.connectionState !== 'closed') {
        state.localStream.getTracks().forEach(track => {
          const senders = pc.getSenders();
          const alreadyAdded = senders.some(s => s.track && s.track.kind === track.kind);
          if (!alreadyAdded) {
            pc.addTrack(track, state.localStream);
          }
        });
      }
    });

    // Request fresh peer list from server
    if (state.ws && state.ws.readyState === WebSocket.OPEN && !state.isStealthMode) {
      state.ws.send(JSON.stringify({ type: 'webrtc_request_peers' }));
    }
  } catch (err) {
    console.warn("WebRTC permission error:", err);
    if (userInitiated) {
      showCustomAlert("Could not access camera or microphone: " + err.message, "Media Access Denied", "error");
    }
    if (el.webrtcStatusMsg) el.webrtcStatusMsg.textContent = 'Camera/Microphone permission denied or unavailable.';
    updateLocalPeerDisplay();
  }
}

function handleWebRTCPeersList(peers) {
  peers.forEach(peer => {
    createPeerConnection(peer.user_id, true);
  });
}

function createPeerConnection(peerId, isInitiator) {
  if (state.peerConnections[peerId]) return state.peerConnections[peerId];

  console.log(`[WebRTC] Creating peer connection to ${peerId}, initiator: ${isInitiator}`);
  const pc = new RTCPeerConnection(rtcConfig);
  state.peerConnections[peerId] = pc;
  state.iceCandidateQueues[peerId] = [];

  // Add local tracks
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => {
      console.log(`[WebRTC] Adding local ${track.kind} track to PC for ${peerId}`);
      pc.addTrack(track, state.localStream);
    });
  }

  // Handle remote track — display it in the peer tile
  pc.ontrack = (event) => {
    console.log(`[WebRTC] Got remote ${event.track.kind} track from ${peerId}`);
    let peerBox = document.getElementById(`peer-box-${peerId}`);
    if (!peerBox) {
      peerBox = document.createElement('div');
      peerBox.id = `peer-box-${peerId}`;
      peerBox.className = 'peer-tile';
      const defaultAvatar = buildAvatarUrl('bottts', `User_${peerId}`, 'b6e3f4');
      peerBox.innerHTML = `
        <video id="video-peer-${peerId}" autoplay playsinline></video>
        <div class="peer-avatar-fallback hidden" id="avatar-fallback-${peerId}">
          <img src="${defaultAvatar}" class="peer-avatar-img" id="peer-avatar-img-${peerId}" alt="User ${peerId}">
        </div>
        <div class="peer-tag-bar">
          <span class="peer-name-tag" id="peer-name-tag-${peerId}">User ${peerId}</span>
          <span class="peer-state-badge" id="peer-mic-badge-${peerId}">${getIcon('mic', 'icon-xs')}</span>
        </div>
      `;
      if (el.peersGridContainer) el.peersGridContainer.appendChild(peerBox);
    }
    const remoteVideo = document.getElementById(`video-peer-${peerId}`);
    if (remoteVideo) {
      if (event.streams && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      }
      remoteVideo.play().catch(() => {});
    }
  };

  // Connection state logging and recovery
  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] Connection state for ${peerId}: ${pc.connectionState}`);
    if (el.webrtcStatusMsg) {
      if (pc.connectionState === 'connected') {
        el.webrtcStatusMsg.textContent = 'Voice & Video Call Connected';
      } else if (pc.connectionState === 'failed') {
        el.webrtcStatusMsg.textContent = 'Peer connection failed. Retrying ICE...';
        if (pc.restartIce) pc.restartIce();
      } else if (pc.connectionState === 'disconnected') {
        el.webrtcStatusMsg.textContent = 'Peer disconnected. Waiting to reconnect...';
      }
    }
  };

  // ICE gathering state logging
  pc.onicegatheringstatechange = () => {
    console.log(`[WebRTC] ICE gathering state for ${peerId}: ${pc.iceGatheringState}`);
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[WebRTC] ICE connection state for ${peerId}: ${pc.iceConnectionState}`);
  };

  // ICE Candidate forwarding
  pc.onicecandidate = (event) => {
    if (event.candidate && state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({
        type: 'webrtc_candidate',
        target_id: String(peerId),
        candidate: event.candidate
      }));
    }
  };

  if (isInitiator) {
    pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
          type: 'webrtc_offer',
          target_id: String(peerId),
          offer: pc.localDescription
        }));
      }
    }).catch(err => console.error("WebRTC offer error:", err));
  }

  return pc;
}

async function handleWebRTCOffer(msg) {
  const pc = createPeerConnection(msg.sender_id, false);
  await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
  
  // Flush queued candidates
  if (state.iceCandidateQueues[msg.sender_id]) {
    while (state.iceCandidateQueues[msg.sender_id].length > 0) {
      const cand = state.iceCandidateQueues[msg.sender_id].shift();
      await pc.addIceCandidate(cand);
    }
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      type: 'webrtc_answer',
      target_id: msg.sender_id,
      answer: pc.localDescription
    }));
  }
}

async function handleWebRTCAnswer(msg) {
  const pc = state.peerConnections[msg.sender_id];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
    
    // Flush queued candidates
    if (state.iceCandidateQueues[msg.sender_id]) {
      while (state.iceCandidateQueues[msg.sender_id].length > 0) {
        const cand = state.iceCandidateQueues[msg.sender_id].shift();
        await pc.addIceCandidate(cand);
      }
    }
  }
}

async function handleWebRTCCandidate(msg) {
  const pc = state.peerConnections[msg.sender_id];
  if (msg.candidate) {
    const cand = new RTCIceCandidate(msg.candidate);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      await pc.addIceCandidate(cand);
    } else {
      if (!state.iceCandidateQueues[msg.sender_id]) {
        state.iceCandidateQueues[msg.sender_id] = [];
      }
      state.iceCandidateQueues[msg.sender_id].push(cand);
    }
  }
}

function removeWebRTCPeer(peerId) {
  if (state.peerConnections[peerId]) {
    state.peerConnections[peerId].close();
    delete state.peerConnections[peerId];
  }
  delete state.iceCandidateQueues[peerId];
  const box = document.getElementById(`peer-box-${peerId}`);
  if (box) box.remove();
}

function closeWebRTCConnections() {
  Object.keys(state.peerConnections).forEach(id => removeWebRTCPeer(id));
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
  }
  updateLocalPeerDisplay();
}

function toggleMic() {
  if (!state.localStream) {
    initLocalWebRTC(true);
    return;
  }
  state.micMuted = !state.micMuted;
  state.localStream.getAudioTracks().forEach(t => t.enabled = !state.micMuted);
  const icon = state.micMuted ? getIcon('mic-off', 'icon-xs') : getIcon('mic', 'icon-xs');
  if (el.btnToggleMic) {
    el.btnToggleMic.innerHTML = icon;
    el.btnToggleMic.classList.toggle('active', state.micMuted);
  }
  if (el.ctrlFsToggleMic) {
    el.ctrlFsToggleMic.innerHTML = icon;
    el.ctrlFsToggleMic.classList.toggle('active', state.micMuted);
  }
  updateLocalPeerDisplay();
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'peer_state_change', mic_muted: state.micMuted, cam_off: state.camOff }));
  }
}

function toggleCam() {
  if (!state.localStream) {
    initLocalWebRTC(true);
    return;
  }
  state.camOff = !state.camOff;
  state.localStream.getVideoTracks().forEach(t => t.enabled = !state.camOff);
  const icon = state.camOff ? getIcon('video-off', 'icon-xs') : getIcon('video', 'icon-xs');
  if (el.btnToggleCam) {
    el.btnToggleCam.innerHTML = icon;
    el.btnToggleCam.classList.toggle('active', state.camOff);
  }
  if (el.ctrlFsToggleCam) {
    el.ctrlFsToggleCam.innerHTML = icon;
    el.ctrlFsToggleCam.classList.toggle('active', state.camOff);
  }
  updateLocalPeerDisplay();
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'peer_state_change', mic_muted: state.micMuted, cam_off: state.camOff }));
  }
}

// --- Roster & Chat UI ---
function renderParticipants(participants) {
  el.participantCountNum.textContent = participants.length;
  el.participantList.innerHTML = participants.map(p => `
    <li class="participant-item">
      <img src="${p.avatar_url}" class="participant-avatar" alt="${escapeHtml(p.username)}">
      <span style="flex:1; display:flex; align-items:center; gap:0.4rem;">
        <strong>${escapeHtml(p.username)}</strong>
        ${p.is_host ? '<span class="brutal-pill bg-pastel-yellow" style="font-size:0.6rem; padding:0.05rem 0.35rem;">HOST</span>' : ''}
      </span>
      ${p.mic_muted 
        ? `<span title="Muted" style="opacity:0.6;">${getIcon('mic-off', 'icon-xs')}</span>` 
        : `<span title="Mic Active">${getIcon('mic', 'icon-xs')}</span>`}
    </li>
  `).join('');

  // Update peer camera fallbacks in WebRTC grid
  participants.forEach(p => {
    if (String(p.user_id) === getUserId()) {
      updateLocalPeerDisplay();
    } else {
      let peerBox = document.getElementById(`peer-box-${p.user_id}`);
      if (!peerBox) {
        // Create tile if not present yet
        peerBox = document.createElement('div');
        peerBox.id = `peer-box-${p.user_id}`;
        peerBox.className = 'peer-tile';
        peerBox.innerHTML = `
          <video id="video-peer-${p.user_id}" autoplay playsinline class="${p.cam_off ? 'hidden' : ''}"></video>
          <div class="peer-avatar-fallback ${p.cam_off ? '' : 'hidden'}" id="avatar-fallback-${p.user_id}">
            <img src="${p.avatar_url}" class="peer-avatar-img" id="peer-avatar-img-${p.user_id}" alt="${escapeHtml(p.username)}">
          </div>
          <div class="peer-tag-bar">
            <span class="peer-name-tag" id="peer-name-tag-${p.user_id}">${escapeHtml(p.username)}</span>
            <span class="peer-state-badge" id="peer-mic-badge-${p.user_id}">${p.mic_muted ? getIcon('mic-off', 'icon-xs') : getIcon('mic', 'icon-xs')}</span>
          </div>
        `;
        el.peersGridContainer.appendChild(peerBox);
      } else {
        const vid = document.getElementById(`video-peer-${p.user_id}`);
        const fallback = document.getElementById(`avatar-fallback-${p.user_id}`);
        const avatarImg = document.getElementById(`peer-avatar-img-${p.user_id}`);
        const micBadge = document.getElementById(`peer-mic-badge-${p.user_id}`);
        const nameTag = document.getElementById(`peer-name-tag-${p.user_id}`);

        if (nameTag) nameTag.textContent = p.username;
        if (avatarImg && p.avatar_url) avatarImg.src = p.avatar_url;
        if (micBadge) micBadge.innerHTML = p.mic_muted ? getIcon('mic-off', 'icon-xs') : getIcon('mic', 'icon-xs');

        if (vid) vid.classList.toggle('hidden', !!p.cam_off);
        if (fallback) fallback.classList.toggle('hidden', !p.cam_off);
      }
    }
  });
}

function renderChatHistory(messages) {
  if (el.chatMessagesContainer) el.chatMessagesContainer.innerHTML = '';
  if (el.playerChatMessages) el.playerChatMessages.innerHTML = '';
  messages.forEach(appendChatMessage);
}

function appendChatMessage(msg) {
  const isSelf = String(msg.user_id) === getUserId();
  const createBubble = () => {
    const div = document.createElement('div');
    div.className = `chat-bubble ${msg.is_system ? 'system-msg' : (isSelf ? 'self-msg' : '')}`;
    if (msg.is_system) {
      div.innerHTML = `<span style="display:inline-flex; align-items:center; gap:0.35rem;">${getIcon('info', 'icon-xs')} ${formatMarkdown(msg.content)}</span>`;
    } else {
      div.innerHTML = `
        <div class="chat-sender-header">
          <strong>${escapeHtml(msg.username)}</strong>
          <span>${msg.timestamp || ''}</span>
        </div>
        <div class="chat-sender-body">${escapeHtml(msg.content)}</div>
      `;
    }
    return div;
  };
  
  if (el.chatMessagesContainer) {
    el.chatMessagesContainer.appendChild(createBubble());
    el.chatMessagesContainer.scrollTop = el.chatMessagesContainer.scrollHeight;
  }

  if (el.playerChatMessages) {
    el.playerChatMessages.appendChild(createBubble());
    el.playerChatMessages.scrollTop = el.playerChatMessages.scrollHeight;
  }

  // If chat is collapsed and message is not from self, show floating notification toast over video
  if (!msg.is_system && !isSelf && !state.sidebarVisible) {
    showChatToast(msg);
    if (el.chatUnreadBadge) el.chatUnreadBadge.classList.remove('hidden');
  }
}

function sendChatMessage(e) {
  if (e) e.preventDefault();
  const text = (el.chatInput ? el.chatInput.value.trim() : '');
  if (!text || !state.ws) return;
  state.ws.send(JSON.stringify({ type: 'chat_message', content: text }));
  if (el.chatInput) el.chatInput.value = '';
}

function sendPlayerChatMessage(e) {
  if (e) e.preventDefault();
  const text = (el.playerChatInput ? el.playerChatInput.value.trim() : '');
  if (!text || !state.ws) return;
  state.ws.send(JSON.stringify({ type: 'chat_message', content: text }));
  if (el.playerChatInput) el.playerChatInput.value = '';
}

// --- Auth Submit Handlers ---
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await apiRequest('/api/auth/login', 'POST', { username, password });
    state.token = res.access_token;
    state.user = res.user;
    state.myUserId = String(res.user.id);
    localStorage.setItem('bt_token', res.access_token);
    renderUserNav(res.user);
    hideModal(el.modalLogin);
    showToast("Signed in successfully!", "success");
  } catch (err) {
    showCustomAlert("Login failed: " + err.message, "Login Failed", "error");
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;

  try {
    const res = await apiRequest('/api/auth/register', 'POST', { username, email, password });
    state.token = res.access_token;
    state.user = res.user;
    state.myUserId = String(res.user.id);
    localStorage.setItem('bt_token', res.access_token);
    renderUserNav(res.user);
    hideModal(el.modalRegister);
    showToast("Registration successful! Welcome to BingeTogether.", "success");
  } catch (err) {
    showCustomAlert("Registration failed: " + err.message, "Registration Failed", "error");
  }
}

function openEditProfileModal(targetUser) {
  el.editUserId.value = targetUser.id;
  el.editUserUsername.value = targetUser.username;
  el.editUserEmail.value = targetUser.email;
  el.editUserBio.value = targetUser.bio || '';
  el.editUserNewpass.value = '';
  
  if (state.user && state.user.is_admin) {
    el.groupAdminToggle.classList.remove('hidden');
    el.editUserIsadmin.checked = targetUser.is_admin;
  } else {
    el.groupAdminToggle.classList.add('hidden');
  }

  showModal(el.modalEditUser);
}

async function handleSaveUserEdit(e) {
  e.preventDefault();
  const userId = el.editUserId.value;
  const username = el.editUserUsername.value;
  const email = el.editUserEmail.value;
  const bio = el.editUserBio.value;
  const newPassword = el.editUserNewpass.value;
  const isAdmin = el.editUserIsadmin.checked;

  try {
    if (state.user.is_admin && String(userId) !== String(state.user.id)) {
      // Admin editing another user
      await apiRequest(`/api/admin/users/${userId}`, 'PUT', {
        username,
        email,
        bio,
        new_password: newPassword || null,
        is_admin: isAdmin
      });
      loadAdminUsers();
    } else {
      // User updating own profile
      let currentPassword = null;
      if (newPassword) {
        currentPassword = await showCustomPrompt("Enter your current password to confirm this change:", "", "Current password", "Confirm Password Change");
        if (!currentPassword) return;
      }
      const updated = await apiRequest('/api/profile', 'PUT', {
        email,
        bio,
        new_password: newPassword || null,
        current_password: currentPassword
      });
      state.user = updated;
      state.myUserId = String(updated.id);
      renderUserNav(updated);
    }
    hideModal(el.modalEditUser);
    showToast("User details updated successfully!", "success");
  } catch (err) {
    showCustomAlert("Update failed: " + err.message, "Update Failed", "error");
  }
}

// --- Admin Panel Engine ---
async function loadAdminUsers() {
  el.adminUsersTableBody.innerHTML = '<tr><td colspan="6">Loading users...</td></tr>';
  try {
    const users = await apiRequest('/api/admin/users');
    el.adminUsersTableBody.innerHTML = users.map(u => `
      <tr>
        <td>#${u.id}</td>
        <td><strong>${escapeHtml(u.username)}</strong></td>
        <td>${escapeHtml(u.email)}</td>
        <td>${u.is_admin ? '<span class="badge badge-admin">ADMIN</span>' : '<span class="badge">USER</span>'}</td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td>
          <button class="btn btn-xs btn-secondary" onclick="openAdminEditUser(${u.id})">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="deleteUserAsAdmin(${u.id}, '${escapeHtml(u.username)}')">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    el.adminUsersTableBody.innerHTML = `<tr><td colspan="6" class="error-msg">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openAdminEditUser(userId) {
  const users = await apiRequest('/api/admin/users');
  const target = users.find(u => u.id === userId);
  if (target) openEditProfileModal(target);
}

async function deleteUserAsAdmin(userId, username) {
  const confirmed = await showCustomConfirm(
    `Are you sure you want to delete user "${username}"?`,
    "Delete User",
    "Delete User →",
    "Cancel",
    "danger"
  );
  if (!confirmed) return;
  try {
    await apiRequest(`/api/admin/users/${userId}`, 'DELETE');
    loadAdminUsers();
    showToast(`User ${username} deleted.`, "info");
  } catch (err) {
    showCustomAlert("Delete failed: " + err.message, "Delete Failed", "error");
  }
}

async function loadAdminRooms() {
  if (!el.adminRoomsTableBody) return;
  el.adminRoomsTableBody.innerHTML = '<tr><td colspan="7" class="text-center">Loading active watch rooms...</td></tr>';
  try {
    const rooms = await apiRequest('/api/admin/rooms/active');
    if (rooms.length === 0) {
      el.adminRoomsTableBody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:2rem;">No active watch rooms currently online.</td></tr>';
      return;
    }
    el.adminRoomsTableBody.innerHTML = rooms.map(r => `
      <tr>
        <td>
          <span class="brutal-pill bg-pastel-purple font-mono">${escapeHtml(r.room_code)}</span>
          <span class="brutal-pill ${r.is_private ? 'bg-pastel-pink' : 'bg-pastel-mint'}" style="font-size:0.65rem; margin-top:0.2rem; display:inline-block;">${r.is_private ? 'Private' : 'Public'}</span>
        </td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td><span class="brutal-pill bg-pastel-yellow">${escapeHtml(r.host_username || 'Host')}</span></td>
        <td><span style="font-size:0.8rem; max-width:180px; display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(r.active_video_title || 'None')}</span></td>
        <td><span class="brutal-pill bg-pastel-mint">${r.participant_count} Members</span></td>
        <td>
          <div style="display:flex; flex-wrap:wrap; gap:0.25rem;">
            ${r.members.map(m => `<span class="brutal-pill bg-pastel-cyan" style="font-size:0.65rem;">${escapeHtml(m.username)}</span>`).join('') || '<span style="color:var(--text-muted);">None</span>'}
          </div>
        </td>
        <td>
          <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
            <button class="brutal-btn brutal-btn-mint brutal-btn-xs" onclick="joinRoom('${r.room_code}')" title="Join room as normal user">Join</button>
            <button class="brutal-btn brutal-btn-purple brutal-btn-xs" onclick="joinRoom('${r.room_code}', null, true)" title="Eavesdrop in stealth mode (invisible to all room members)">Ghost</button>
            <button class="brutal-btn ${r.is_private ? 'brutal-btn-mint' : 'brutal-btn-pink'} brutal-btn-xs" onclick="toggleRoomPrivacyAsAdmin('${r.room_code}', ${!r.is_private})" title="Toggle Public / Private Mode">${r.is_private ? 'Make Public' : 'Make Private'}</button>
            <button class="brutal-btn brutal-btn-yellow brutal-btn-xs" onclick="broadcastToRoomAsAdmin('${r.room_code}')" title="Send broadcast alert">Alert</button>
            <button class="brutal-btn brutal-btn-pink brutal-btn-xs" onclick="forceCloseRoomAsAdmin('${r.room_code}')" title="Force terminate room">Close</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    el.adminRoomsTableBody.innerHTML = `<tr><td colspan="7" class="error-msg">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function toggleRoomPrivacyAsAdmin(roomCode, makePrivate) {
  let passcode = null;
  if (makePrivate) {
    const pass = await showCustomPrompt(`Set optional passcode for private room ${roomCode} (or leave blank for no passcode):`, "", "Optional passcode", "Make Room Private");
    if (pass === null) return;
    passcode = pass.trim() || null;
  } else {
    const confirmed = await showCustomConfirm(`Are you sure you want to make room ${roomCode} PUBLIC?`, "Make Room Public", "Make Public →", "Cancel", "info");
    if (!confirmed) return;
  }

  try {
    await apiRequest(`/api/rooms/${roomCode}`, 'PUT', {
      is_private: makePrivate,
      passcode: passcode
    });
    showToast(`Room ${roomCode} is now ${makePrivate ? 'Private' : 'Public'}.`, "success");
    loadAdminRooms();
  } catch (err) {
    showCustomAlert("Privacy update failed: " + err.message, "Privacy Error", "error");
  }
}

async function broadcastToRoomAsAdmin(roomCode) {
  const message = await showCustomPrompt(`Enter broadcast alert message to send to all viewers in Room ${roomCode}:`, "", "Announcement text...", "Broadcast Alert to Room");
  if (!message || !message.trim()) return;

  try {
    const res = await apiRequest(`/api/admin/rooms/${roomCode}/broadcast`, 'POST', { message: message.trim() });
    showToast(res.message || "Announcement broadcast sent!", "success");
  } catch (err) {
    showCustomAlert("Broadcast failed: " + err.message, "Broadcast Error", "error");
  }
}

async function forceCloseRoomAsAdmin(roomCode) {
  const confirmed = await showCustomConfirm(
    `Are you sure you want to force close room ${roomCode}? All connected users will be disconnected.`,
    "Force Close Room",
    "Close Room →",
    "Cancel",
    "danger"
  );
  if (!confirmed) return;
  try {
    await apiRequest(`/api/admin/rooms/${roomCode}`, 'DELETE');
    loadAdminRooms();
    showToast(`Room ${roomCode} closed.`, "info");
  } catch (err) {
    showCustomAlert("Action failed: " + err.message, "Error", "error");
  }
}

// --- Admin SMTP & Email Management ---
async function loadAdminSmtpSettings() {
  try {
    const s = await apiRequest('/api/admin/settings');
    if (el.smtpHostInput) el.smtpHostInput.value = s.smtp_host || '';
    if (el.smtpPortInput) el.smtpPortInput.value = s.smtp_port || 587;
    if (el.smtpUserInput) el.smtpUserInput.value = s.smtp_user || '';
    if (el.smtpPassInput) {
      el.smtpPassInput.value = '';
      el.smtpPassInput.placeholder = s.smtp_password_is_set ? '•••••••• (Stored securely - leave blank to keep)' : 'Enter SMTP password';
    }
    if (el.smtpFromEmailInput) el.smtpFromEmailInput.value = s.smtp_from_email || '';
    if (el.smtpFromNameInput) el.smtpFromNameInput.value = s.smtp_from_name || 'BingeTogether';
    if (el.smtpAppUrlInput) el.smtpAppUrlInput.value = s.app_url || window.location.origin;
    if (el.smtpUseTlsInput) el.smtpUseTlsInput.checked = String(s.smtp_use_tls).toLowerCase() !== 'false';
    if (el.smtpUseSslInput) el.smtpUseSslInput.checked = String(s.smtp_use_ssl).toLowerCase() === 'true';
    if (el.smtpWelcomeEmailInput) el.smtpWelcomeEmailInput.checked = String(s.welcome_email_enabled).toLowerCase() !== 'false';
  } catch (err) {
    console.error("Failed loading SMTP settings:", err);
  }
}

async function handleSaveAdminSmtp(e) {
  e.preventDefault();
  const payload = {
    smtp_host: el.smtpHostInput.value.trim(),
    smtp_port: parseInt(el.smtpPortInput.value.trim()) || 587,
    smtp_user: el.smtpUserInput.value.trim(),
    smtp_from_email: el.smtpFromEmailInput.value.trim(),
    smtp_from_name: el.smtpFromNameInput.value.trim() || 'BingeTogether',
    app_url: el.smtpAppUrlInput.value.trim() || window.location.origin,
    smtp_use_tls: el.smtpUseTlsInput.checked,
    smtp_use_ssl: el.smtpUseSslInput.checked,
    welcome_email_enabled: el.smtpWelcomeEmailInput.checked
  };

  const passwordVal = el.smtpPassInput.value;
  if (passwordVal) {
    payload.smtp_password = passwordVal;
  }

  try {
    const res = await apiRequest('/api/admin/settings', 'PUT', payload);
    showToast(res.message || "SMTP Settings saved successfully!", "success");
    loadAdminSmtpSettings();
  } catch (err) {
    showCustomAlert("Failed to save SMTP settings: " + err.message, "Settings Error", "error");
  }
}

async function handleTestAdminSmtp(e) {
  e.preventDefault();
  const toEmail = el.testSmtpEmailInput.value.trim();
  if (!toEmail) {
    showCustomAlert("Please enter a recipient email address.", "Recipient Required", "warning");
    return;
  }

  if (el.testSmtpResult) {
    el.testSmtpResult.className = 'brutal-alert brutal-alert-yellow';
    el.testSmtpResult.innerHTML = `${getIcon('refresh-cw', 'icon-xs spin')} <span>Connecting to SMTP server and sending test email to ${escapeHtml(toEmail)}...</span>`;
    el.testSmtpResult.classList.remove('hidden');
  }

  try {
    const res = await apiRequest('/api/admin/settings/test-smtp', 'POST', { to_email: toEmail });
    if (el.testSmtpResult) {
      el.testSmtpResult.className = 'brutal-alert brutal-alert-mint';
      el.testSmtpResult.innerHTML = `${getIcon('check', 'icon-xs')} <span>${escapeHtml(res.message || 'Test email delivered successfully!')}</span>`;
    }
  } catch (err) {
    if (el.testSmtpResult) {
      el.testSmtpResult.className = 'brutal-alert brutal-alert-pink';
      el.testSmtpResult.innerHTML = `${getIcon('alert-circle', 'icon-xs')} <span>SMTP Error: ${escapeHtml(err.message)}</span>`;
    }
  }
}

// --- Account Recovery (Find Username & Reset Password) ---
function openRecoveryModal(initialTab = 'find-user') {
  showModal(el.modalForgotCredentials);
  if (initialTab === 'find-user') {
    if (el.btnSubtabFindUser) el.btnSubtabFindUser.click();
  } else {
    if (el.btnSubtabResetPass) el.btnSubtabResetPass.click();
  }
}

async function handleForgotUsername(e) {
  e.preventDefault();
  const email = el.forgotUserEmail.value.trim();
  if (!email) return;

  if (el.forgotUserMsg) {
    el.forgotUserMsg.className = 'brutal-alert brutal-alert-yellow';
    el.forgotUserMsg.innerHTML = `${getIcon('refresh-cw', 'icon-xs spin')} <span>Searching for your username...</span>`;
    el.forgotUserMsg.classList.remove('hidden');
  }

  try {
    const res = await apiRequest('/api/auth/forgot-username', 'POST', { email });
    if (el.forgotUserMsg) {
      el.forgotUserMsg.className = 'brutal-alert brutal-alert-mint';
      el.forgotUserMsg.innerHTML = `${getIcon('check', 'icon-xs')} <span>${escapeHtml(res.message)}</span>`;
    }
    el.forgotUserEmail.value = '';
  } catch (err) {
    if (el.forgotUserMsg) {
      el.forgotUserMsg.className = 'brutal-alert brutal-alert-pink';
      el.forgotUserMsg.innerHTML = `${getIcon('alert-circle', 'icon-xs')} <span>${escapeHtml(err.message)}</span>`;
    }
  }
}

async function handleForgotPassRequest(e) {
  e.preventDefault();
  const target = el.forgotPassTarget.value.trim();
  if (!target) return;

  if (el.forgotPassReqMsg) {
    el.forgotPassReqMsg.className = 'brutal-alert brutal-alert-yellow';
    el.forgotPassReqMsg.innerHTML = `${getIcon('refresh-cw', 'icon-xs spin')} <span>Sending 6-digit reset code...</span>`;
    el.forgotPassReqMsg.classList.remove('hidden');
  }

  try {
    const res = await apiRequest('/api/auth/forgot-password', 'POST', { email_or_username: target });
    if (el.forgotPassReqMsg) {
      el.forgotPassReqMsg.className = 'brutal-alert brutal-alert-mint';
      el.forgotPassReqMsg.innerHTML = `${getIcon('check', 'icon-xs')} <span>${escapeHtml(res.message)}</span>`;
    }
    // Transition to Step 2
    setTimeout(() => {
      if (el.formForgotPassRequest) el.formForgotPassRequest.classList.add('hidden');
      if (el.formForgotPassConfirm) {
        el.formForgotPassConfirm.classList.remove('hidden');
        if (el.resetCodeInput) el.resetCodeInput.focus();
      }
    }, 1000);
  } catch (err) {
    if (el.forgotPassReqMsg) {
      el.forgotPassReqMsg.className = 'brutal-alert brutal-alert-pink';
      el.forgotPassReqMsg.innerHTML = `${getIcon('alert-circle', 'icon-xs')} <span>${escapeHtml(err.message)}</span>`;
    }
  }
}

async function handleForgotPassConfirm(e) {
  e.preventDefault();
  const token = el.resetCodeInput.value.trim();
  const newPassword = el.resetNewPassInput.value;

  if (!token || !newPassword) {
    showCustomAlert("Please fill in both the reset code and your new password.", "Required Fields", "warning");
    return;
  }

  if (el.resetPassConfirmMsg) {
    el.resetPassConfirmMsg.className = 'brutal-alert brutal-alert-yellow';
    el.resetPassConfirmMsg.innerHTML = `${getIcon('refresh-cw', 'icon-xs spin')} <span>Updating password...</span>`;
    el.resetPassConfirmMsg.classList.remove('hidden');
  }

  try {
    const res = await apiRequest('/api/auth/reset-password', 'POST', {
      token,
      new_password: newPassword
    });

    if (el.resetPassConfirmMsg) {
      el.resetPassConfirmMsg.className = 'brutal-alert brutal-alert-mint';
      el.resetPassConfirmMsg.innerHTML = `${getIcon('check', 'icon-xs')} <span>${escapeHtml(res.message)}</span>`;
    }

    setTimeout(() => {
      hideModal(el.modalForgotCredentials);
      showModal(el.modalLogin);
      showToast("Password updated! Please sign in with your new password.", "success");
    }, 1200);
  } catch (err) {
    if (el.resetPassConfirmMsg) {
      el.resetPassConfirmMsg.className = 'brutal-alert brutal-alert-pink';
      el.resetPassConfirmMsg.innerHTML = `${getIcon('alert-circle', 'icon-xs')} <span>${escapeHtml(err.message)}</span>`;
    }
  }
}

async function loadAdminVideos() {
  if (!el.adminVideosTableBody) return;
  el.adminVideosTableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading uploaded videos...</td></tr>';
  try {
    const videos = await apiRequest('/api/admin/videos');
    if (videos.length === 0) {
      el.adminVideosTableBody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:2rem;">No uploaded videos found.</td></tr>';
      return;
    }
    el.adminVideosTableBody.innerHTML = videos.map(v => `
      <tr>
        <td>#${v.id}</td>
        <td><strong>${escapeHtml(v.original_name)}</strong></td>
        <td><span class="brutal-pill bg-pastel-cyan">${(v.file_size / (1024 * 1024)).toFixed(1)} MB</span></td>
        <td><span class="brutal-pill bg-pastel-yellow">${escapeHtml(v.uploader_username)}</span></td>
        <td>${new Date(v.created_at).toLocaleDateString()}</td>
        <td>
          <button class="brutal-btn brutal-btn-pink brutal-btn-xs" onclick="deleteVideoAsAdmin(${v.id}, '${escapeHtml(v.original_name)}')">Delete File</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    el.adminVideosTableBody.innerHTML = `<tr><td colspan="6" class="error-msg">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function deleteVideoAsAdmin(videoId, originalName) {
  const confirmed = await showCustomConfirm(
    `Are you sure you want to delete video "${originalName}" from the server?`,
    "Delete Video",
    "Delete Video →",
    "Cancel",
    "danger"
  );
  if (!confirmed) return;
  try {
    await apiRequest(`/api/admin/videos/${videoId}`, 'DELETE');
    loadAdminVideos();
    if (typeof loadUploadedVideosDropdown === 'function') {
      loadUploadedVideosDropdown();
    }
    showToast(`Video "${originalName}" deleted from server.`, "info");
  } catch (err) {
    showCustomAlert("Delete failed: " + err.message, "Delete Failed", "error");
  }
}

async function deleteAllAdminVideos() {
  const confirmed = await showCustomConfirm(
    "WARNING: Are you sure you want to permanently delete ALL uploaded video files from the server disk and database? This action cannot be undone.",
    "Delete All Videos",
    "Delete All →",
    "Cancel",
    "danger"
  );
  if (!confirmed) return;
  try {
    const res = await apiRequest('/api/admin/videos', 'DELETE');
    showToast(res.message || "All videos deleted successfully.", "success");
    loadAdminVideos();
    if (typeof loadUploadedVideosDropdown === 'function') {
      loadUploadedVideosDropdown();
    }
  } catch (err) {
    showCustomAlert("Delete all videos failed: " + err.message, "Error", "error");
  }
}

// Security Escape Helper
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

function formatMarkdown(str) {
  let s = escapeHtml(str);
  s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');
  return s;
}
