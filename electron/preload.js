const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 独立弹窗
  openDialog: (payload) => ipcRenderer.invoke('dialog:open', payload),
  submitDialog: (result) => ipcRenderer.invoke('dialog:submit', result),
  cancelDialog: () => ipcRenderer.invoke('dialog:cancel'),

  // 配置
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  exportConfig: (config) => ipcRenderer.invoke('config:export', config),
  importConfig: () => ipcRenderer.invoke('config:import'),

  // 链接
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  openBatch: (urls) => ipcRenderer.invoke('link:openBatch', urls),

  // 按钮动作
  sendText: (text, autoEnter) => ipcRenderer.invoke('action:text', text, autoEnter),
  pressShortcut: (keys) => ipcRenderer.invoke('action:shortcut', keys),
  holdDown: (keys) => ipcRenderer.invoke('action:holdDown', keys),
  holdUp: (keys) => ipcRenderer.invoke('action:holdUp', keys),
  click: () => ipcRenderer.invoke('action:click'),
  doubleClick: () => ipcRenderer.invoke('action:doubleClick'),

  // 窗口控制
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  setAlwaysOnTop: (val) => ipcRenderer.invoke('window:setAlwaysOnTop', val),
  setFocusable: (val) => ipcRenderer.invoke('window:setFocusable', val),
  setBounds: (bounds) => ipcRenderer.invoke('window:setBounds', bounds),
  getBounds: () => ipcRenderer.invoke('window:getBounds'),
  collapse: (collapsed) => ipcRenderer.invoke('window:collapse', collapsed),
  resizeCurrentWindow: (height) => ipcRenderer.invoke('window:resizeCurrent', height),

  // 悬浮窗口
  createFloating: (itemId, position) => ipcRenderer.invoke('floating:create', itemId, position),
  closeFloating: (floatingId) => ipcRenderer.invoke('floating:close', floatingId),
  onConfigChanged: (callback) => {
    const listener = (_, config) => callback(config)
    ipcRenderer.on('config:changed', listener)
    return () => ipcRenderer.removeListener('config:changed', listener)
  },
})
