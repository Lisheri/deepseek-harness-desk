/** `titlebar` namespace dictionaries: the window-top chrome (file operations, fold, undo/redo, add-workspace flow). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu.file': '文件操作',
  'menu.newChat': '新聊天',
  'menu.addWorkspace': '添加新工作区',
  'toggle.collapse': '收起侧边栏',
  'toggle.open': '展开侧边栏',
  'undo': '撤销',
  'redo': '重做',
  'folderError.title': '添加工作区失败',
  'folderError.retry': '重新选择',
  'cancel': '取消',
  'close': '关闭',
} satisfies Record<string, string>

/** The titlebar namespace key union. */
export type TitlebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'menu.file': 'File',
  'menu.newChat': 'New Chat',
  'menu.addWorkspace': 'Add Workspace',
  'toggle.collapse': 'Collapse sidebar',
  'toggle.open': 'Expand sidebar',
  'undo': 'Undo',
  'redo': 'Redo',
  'folderError.title': 'Failed to Add Workspace',
  'folderError.retry': 'Choose Again',
  'cancel': 'Cancel',
  'close': 'Close',
} satisfies Record<TitlebarKey, string>
