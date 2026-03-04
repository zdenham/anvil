/**
 * Central index of all data-testid values used in the app.
 * Components should import from here rather than hardcoding strings.
 * E2E tests reference these same constants.
 */
export const TEST_IDS = {
  // ── Layout ──────────────────────────────────────────────
  mainLayout: 'main-layout',
  contentPane: 'content-pane',
  contentPaneHeader: 'content-pane-header',
  closePaneButton: 'close-pane-button',
  popOutButton: 'pop-out-button',

  // ── Tree Menu ───────────────────────────────────────────
  treeMenu: 'tree-menu',
  treePanelHeader: 'tree-panel-header',
  treeSection: (name: string) => `tree-section-${name}` as const,
  threadItem: (id: string) => `thread-item-${id}` as const,
  planItem: (id: string) => `plan-item-${id}` as const,
  terminalItem: (id: string) => `terminal-item-${id}` as const,
  prItem: (id: string) => `pr-item-${id}` as const,
  commitItem: (sha: string) => `commit-item-${sha}` as const,
  uncommittedItem: 'uncommitted-item',
  repoWorktreeSection: (repo: string) => `repo-worktree-section-${repo}` as const,
  menuDropdown: 'menu-dropdown',
  settingsButton: 'settings-button',
  logsButton: 'logs-button',
  archiveButton: 'archive-button',
  statusLegend: 'status-legend',

  // ── Control Panel ───────────────────────────────────────
  controlPanel: 'control-panel',
  controlPanelHeader: 'control-panel-header',
  controlPanelTabThread: 'control-panel-tab-thread',
  controlPanelTabChanges: 'control-panel-tab-changes',
  controlPanelTabPlan: 'control-panel-tab-plan',
  agentStatus: 'agent-status',

  // ── Thread Input ────────────────────────────────────────
  threadInput: 'thread-input',

  // ── Thread Messages ─────────────────────────────────────
  messageList: 'message-list',
  assistantMessage: (turnIndex: number) => `assistant-message-${turnIndex}` as const,
  userMessage: (turnIndex: number) => `user-message-${turnIndex}` as const,
  codeBlock: 'code-block',
  copyButton: 'copy-button',
  statusAnnouncement: 'status-announcement',

  // ── Inline Diff ─────────────────────────────────────────
  inlineDiffHeader: 'inline-diff-header',

  // ── Tool Blocks ─────────────────────────────────────────
  toolUse: (id: string) => `tool-use-${id}` as const,
  bashTool: (id: string) => `bash-tool-${id}` as const,
  bashOutput: (id: string) => `bash-output-${id}` as const,
  editTool: (id: string) => `edit-tool-${id}` as const,
  writeTool: (id: string) => `write-tool-${id}` as const,
  globTool: (id: string) => `glob-tool-${id}` as const,
  grepTool: (id: string) => `grep-tool-${id}` as const,
  lspTool: (id: string) => `lsp-tool-${id}` as const,
  taskTool: (id: string) => `task-tool-${id}` as const,
  readTool: (id: string) => `read-tool-${id}` as const,
  webSearchTool: (id: string) => `web-search-tool-${id}` as const,
  webFetchTool: (id: string) => `webfetch-tool-${id}` as const,
  notebookEditTool: (id: string) => `notebook-edit-tool-${id}` as const,
  skillTool: (id: string) => `skill-tool-${id}` as const,
  exitPlanModeTool: (id: string) => `exitplanmode-tool-${id}` as const,
  subAgentReference: (childThreadId: string) => `sub-agent-reference-${childThreadId}` as const,
  askUserQuestion: (id: string) => `ask-user-question-${id}` as const,

  // ── Permissions ─────────────────────────────────────────
  permissionPrompt: (requestId: string) => `permission-prompt-${requestId}` as const,
  permissionApproveButton: 'permission-approve-button',
  permissionDenyButton: 'permission-deny-button',

  // ── Changes & Diff Viewer ───────────────────────────────
  changesView: 'changes-view',
  changesDiffContent: 'changes-diff-content',
  commentGutterButton: (line: number) => `comment-gutter-button-${line}` as const,
  inlineCommentForm: 'inline-comment-form',
  inlineComment: (commentId: string) => `inline-comment-${commentId}` as const,
  floatingAddressButton: 'floating-address-button',

  // ── Find Bar ────────────────────────────────────────────
  findBar: 'find-bar',
  findBarInput: 'find-bar-input',
  findBarNext: 'find-bar-next',
  findBarPrev: 'find-bar-prev',

  // ── Search Panel ────────────────────────────────────────
  searchPanel: 'search-panel',
  searchInput: 'search-input',
  searchResults: 'search-results',
  searchResult: (index: number) => `search-result-${index}` as const,

  // ── Command Palette ─────────────────────────────────────
  commandPalette: 'command-palette',
  commandPaletteInput: 'command-palette-input',
  commandPaletteItem: (index: number) => `command-palette-item-${index}` as const,

  // ── Content Pane Details ────────────────────────────────
  fileContent: 'file-content',
  terminalContent: 'terminal-content',
  planContentPane: 'plan-content-pane',
  prContent: 'pr-content',
  prChecksSection: 'pr-checks-section',
  contextMeter: 'context-meter',
  breadcrumb: 'breadcrumb',
  archiveView: 'archive-view',

  // ── Spotlight ───────────────────────────────────────────
  spotlight: 'spotlight',
  spotlightInput: 'spotlight-input',
  spotlightResults: 'spotlight-results',
  spotlightResult: (index: number) => `spotlight-result-${index}` as const,

  // ── Settings ────────────────────────────────────────────
  settingsView: 'settings-view',
  settingsSection: (name: string) => `settings-section-${name}` as const,
  hotkeySettings: 'hotkey-settings',
  hotkeyInput: (action: string) => `hotkey-input-${action}` as const,
  repositorySettings: 'repository-settings',
  repoItem: (path: string) => `repo-item-${path}` as const,
  skillsSettings: 'skills-settings',
  skillItem: (name: string) => `skill-item-${name}` as const,
  aboutSettings: 'about-settings',
  quickActionsSettings: 'quick-actions-settings',
  quickActionItem: (key: string) => `quick-action-item-${key}` as const,
  quickActionEditModal: 'quick-action-edit-modal',

  // ── Onboarding ──────────────────────────────────────────
  onboardingFlow: 'onboarding-flow',
  onboardingStepWelcome: 'onboarding-step-welcome',
  onboardingStepRepository: 'onboarding-step-repository',
  onboardingStepHotkey: 'onboarding-step-hotkey',
  onboardingStepSpotlight: 'onboarding-step-spotlight',
  onboardingStepPermissions: 'onboarding-step-permissions',
  onboardingNextButton: 'onboarding-next-button',
  permissionsPrompt: 'permissions-prompt',

  // ── Secondary UI ────────────────────────────────────────
  debugPanel: 'debug-panel',
  eventList: 'event-list',
  eventDetail: 'event-detail',
  networkDebugger: 'network-debugger',
  logsToolbar: 'logs-toolbar',
  logsLevelFilter: (level: string) => `logs-level-filter-${level}` as const,
  clipboardManager: 'clipboard-manager',
  errorPanel: 'error-panel',
  globalToast: 'global-toast',
  buildModeIndicator: 'build-mode-indicator',
  resizeHandleHorizontal: 'resize-handle-horizontal',
  resizeHandleVertical: 'resize-handle-vertical',

  // ── Plan Tab States ─────────────────────────────────────
  planEmptyState: 'plan-empty-state',
  planLoadingState: 'plan-loading-state',
  planErrorState: 'plan-error-state',
  planNotFoundState: 'plan-not-found-state',
  planContent: 'plan-content',

  // ── Shared UI States ────────────────────────────────────
  loadingSpinner: 'loading-spinner',
  errorMessage: 'error-message',
  emptyState: 'empty-state',

  // ── Hotkey Recorder ─────────────────────────────────────
  hotkeyRecorder: 'hotkey-recorder',
  hotkeyRecorderOverlay: 'hotkey-recorder-overlay',
  hotkeyModifier: (mod: string) => `modifier-${mod}` as const,
  hotkeyKey: 'hotkey-key',
  hotkeyRecorderStatus: 'hotkey-recorder-status',

  // ── Question Carousel ───────────────────────────────────
  questionCarousel: (id: string) => `question-carousel-${id}` as const,
  optionItem: (index: number) => `option-item-${index}` as const,
} as const;
