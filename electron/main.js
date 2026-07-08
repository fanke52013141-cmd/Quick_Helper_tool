const { app, BrowserWindow, ipcMain, clipboard, shell, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')

const isDev = process.env.NODE_ENV === 'development'
const psScript = path.join(__dirname, 'keyboard.ps1')

let mainWindow = null
let dialogWindow = null
let dialogResolve = null
const floatingWindows = new Map()
const boundsTimers = new Map()
let lastMainBounds = null
let heldKeys = null
const reminderTimers = new Map()
const reminderBarWindows = new Map()
const reminderPopupWindows = new Map()
let reminderSetupWindow = null
let reminderSetupResolve = null

app.setPath('userData', path.join(__dirname, '..', 'userdata'))

const logFile = path.join(app.getPath('userData'), 'debug.log')
function log(msg) {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  try { fs.appendFileSync(logFile, line) } catch (e) {}
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function loadConfig() {
  try {
    const p = getConfigPath()
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'))
    }
  } catch (e) {
    console.error('加载配置失败:', e)
  }
  return null
}

function saveConfig(config) {
  try {
    const p = getConfigPath()
    const dir = path.dirname(p)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('保存配置失败:', e)
    return false
  }
}

function getConfig() {
  const config = loadConfig() || {}
  const previousVersion = Number(config.version) || 0
  config.window = {
    alwaysOnTop: false,
    collapsed: false,
    width: 416,
    height: 560,
    ...(config.window || {}),
  }
  if (previousVersion < 4 && config.window.width <= 360 && config.window.height <= 400) {
    config.window.width = 416
    config.window.height = 560
  }
  if (previousVersion < 5 && config.window.width >= 500) {
    config.window.width = Math.round(config.window.width * 0.8)
  }
  config.version = Math.max(previousVersion, 5)
  config.floatingItems = Array.isArray(config.floatingItems) ? config.floatingItems : []
  config.items = Array.isArray(config.items) ? config.items : []
  return config
}

function broadcastConfigChanged() {
  const config = getConfig()
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send('config:changed', config)
  })
}

function syncFloatingWindows(config) {
  const activeIds = new Set((config.floatingItems || []).map(item => item.id))
  for (const [id, win] of floatingWindows.entries()) {
    if (!activeIds.has(id)) {
      if (!win.isDestroyed()) win.close()
      floatingWindows.delete(id)
    }
  }
  const cardSize = getFloatingCardSize(config)
  for (const floatingItem of config.floatingItems || []) {
    const win = floatingWindows.get(floatingItem.id)
    const sourceItem = config.items.find(item => item.id === floatingItem.itemId)
    if (!win || win.isDestroyed()) continue
    win.setAlwaysOnTop(true, 'floating')
    if (sourceItem?.type === 'todo') continue
    const bounds = win.getBounds()
    if (bounds.width !== cardSize.width || bounds.height !== cardSize.height) {
      win.setBounds({ ...bounds, ...cardSize })
    }
  }
}

function parseQuery(query) {
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  return Object.fromEntries(params.entries())
}

function loadApp(win, query = '') {
  if (isDev) {
    win.loadURL(`http://localhost:5173${query}`)
  } else {
    const htmlPath = path.join(__dirname, '..', 'dist', 'index.html')
    win.loadFile(htmlPath, { query: parseQuery(query) })
  }
}

function safeBounds(bounds, defaults) {
  const width = Number.isFinite(bounds?.width) ? Math.max(120, Math.min(1000, Math.round(bounds.width))) : defaults.width
  const height = Number.isFinite(bounds?.height) ? Math.max(80, Math.min(1000, Math.round(bounds.height))) : defaults.height
  const result = { width, height }
  if (Number.isFinite(bounds?.x)) result.x = Math.round(bounds.x)
  if (Number.isFinite(bounds?.y)) result.y = Math.round(bounds.y)
  return keepBoundsInWorkArea(result)
}

function keepBoundsInWorkArea(bounds) {
  const display = Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    ? screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
    : screen.getPrimaryDisplay()
  const workArea = display.workArea
  const width = bounds.width
  const height = bounds.height
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height
  return {
    ...bounds,
    x: Number.isFinite(bounds.x) ? Math.min(Math.max(bounds.x, workArea.x), Math.max(workArea.x, maxX)) : bounds.x,
    y: Number.isFinite(bounds.y) ? Math.min(Math.max(bounds.y, workArea.y), Math.max(workArea.y, maxY)) : bounds.y,
  }
}

function defaultFloatingBounds(width, height) {
  const workArea = screen.getPrimaryDisplay().workArea
  return {
    width,
    height,
    x: workArea.x + workArea.width - width - 40,
    y: workArea.y + 80,
  }
}

function getFloatingCardSize(config) {
  const sizes = {
    small: { width: 96, height: 100 },
    medium: { width: 124, height: 116 },
    large: { width: 152, height: 136 },
  }
  return sizes[config?.grid?.cardSize] || sizes.small
}

function saveMainBoundsDebounced() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
  clearTimeout(boundsTimers.get('main'))
  boundsTimers.set('main', setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
    const bounds = mainWindow.getBounds()
    if (bounds.width < 120 || bounds.height < 50) return
    lastMainBounds = keepBoundsInWorkArea(bounds)
    const config = getConfig()
    config.window = { ...config.window, ...lastMainBounds }
    saveConfig(config)
    broadcastConfigChanged()
  }, 400))
}

function saveFloatingBoundsDebounced(floatingId, win) {
  if (!win || win.isDestroyed()) return
  const key = `floating:${floatingId}`
  clearTimeout(boundsTimers.get(key))
  boundsTimers.set(key, setTimeout(() => {
    if (!win || win.isDestroyed()) return
    const config = getConfig()
    const bounds = win.getBounds()
    const sourceFloating = config.floatingItems.find(item => item.id === floatingId)
    const sourceItem = config.items.find(item => item.id === sourceFloating?.itemId)
    const cardSize = getFloatingCardSize(config)
    const nextBounds = sourceItem?.type === 'todo' ? bounds : { x: bounds.x, y: bounds.y, ...cardSize }
    config.floatingItems = config.floatingItems.map(item => (
      item.id === floatingId ? { ...item, bounds: nextBounds } : item
    ))
    saveConfig(config)
    broadcastConfigChanged()
  }, 400))
}

function createWindow() {
  log('Creating main window...')
  const config = getConfig()
  const winConfig = config.window || {}
  // 启动时忽略折叠状态，始终以完整高度创建窗口，避免白屏
  const safeWinConfig = { ...winConfig }
  if (winConfig.height && winConfig.height < 120) {
    safeWinConfig.height = 560
  }

  lastMainBounds = safeBounds(safeWinConfig, { width: 416, height: 560 })
  mainWindow = new BrowserWindow({
    ...lastMainBounds,
    frame: false,
    transparent: false,
    backgroundColor: '#FDFDFD',
    resizable: true,
    alwaysOnTop: winConfig.alwaysOnTop || false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  loadApp(mainWindow)

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    log(`[RENDERER] ${message} (${sourceId}:${line})`)
  })

  mainWindow.setMinimumSize(400, 41)
  mainWindow.on('resize', saveMainBoundsDebounced)
  mainWindow.on('move', saveMainBoundsDebounced)
  mainWindow.on('restore', () => {
    if (lastMainBounds) mainWindow.setBounds(keepBoundsInWorkArea(lastMainBounds))
    // 最小化前会临时启用 focusable，以便 Windows 使用标准任务栏行为；
    // 恢复后重新进入“不抢输入焦点”的工具窗口模式。
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFocusable(false)
    }, 100)
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

function createFloatingWindow(floatingItem) {
  const config = getConfig()
  const sourceItem = config.items.find(item => item.id === floatingItem.itemId)
  const isTodo = sourceItem?.type === 'todo'
  const existing = floatingWindows.get(floatingItem.id)
  if (existing && !existing.isDestroyed()) {
    if (!isTodo) {
      const cardSize = getFloatingCardSize(config)
      existing.setSize(cardSize.width, cardSize.height)
    }
    existing.show()
    if (isTodo) existing.focus()
    return existing
  }

  const saved = floatingItem.bounds || {}
  const cardSize = getFloatingCardSize(config)
  const bounds = isTodo
    ? safeBounds(saved, { width: 360, height: 320 })
    : { ...cardSize, x: Number.isFinite(saved.x) ? Math.round(saved.x) : undefined, y: Number.isFinite(saved.y) ? Math.round(saved.y) : undefined }
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: !isTodo,
    backgroundColor: isTodo ? '#FDFDFD' : '#00000000',
    resizable: isTodo,
    focusable: isTodo,
    alwaysOnTop: true,
    maximizable: !isTodo,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  floatingWindows.set(floatingItem.id, win)
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (!isTodo) {
    // 非 todo 悬浮窗锁定固定大小，防止 Windows Aero Snap 把窗口放大
    win.setMaximumSize(cardSize.width, cardSize.height)
  }
  loadApp(win, `?mode=floating&floatingId=${encodeURIComponent(floatingItem.id)}`)

  const keepFloatingOnTop = () => {
    if (win.isDestroyed()) return
    win.setAlwaysOnTop(true, 'floating')
    win.moveTop()
  }
  win.on('show', keepFloatingOnTop)
  win.on('blur', keepFloatingOnTop)

  win.setMinimumSize(isTodo ? 220 : cardSize.width, isTodo ? 44 : cardSize.height)
  if (!isTodo) {
    // 双保险：若 Aero Snap 仍触发 resize，立即恢复固定尺寸
    win.on('resize', () => {
      if (win.isDestroyed()) return
      const [cw, ch] = win.getSize()
      if (cw !== cardSize.width || ch !== cardSize.height) {
        win.setSize(cardSize.width, cardSize.height)
      }
    })
  }
  win.on('resize', () => saveFloatingBoundsDebounced(floatingItem.id, win))
  win.on('move', () => saveFloatingBoundsDebounced(floatingItem.id, win))
  win.on('closed', () => {
    floatingWindows.delete(floatingItem.id)
  })

  return win
}

function restoreFloatingWindows() {
  const config = getConfig()
  config.floatingItems.forEach(fi => {
    const source = config.items.find(it => it.id === fi.itemId)
    if (source && source.type === 'reminder') createReminderBarWindow(fi)
    else createFloatingWindow(fi)
  })
}

// ===== 定时提醒系统 =====
function scheduleAllReminders() {
  for (const [, t] of reminderTimers) clearTimeout(t)
  reminderTimers.clear()
  const config = getConfig()
  config.items.filter(it => it.type === 'reminder' && !it.triggered).forEach(it => scheduleReminder(it))
}

function scheduleReminder(item) {
  if (!item || item.type !== 'reminder' || item.triggered) return
  const delay = (item.datetime || 0) - Date.now()
  if (delay <= 0) {
    triggerReminder(item)
    return
  }
  const t = setTimeout(() => triggerReminder(item), Math.min(delay, 2147483647))
  reminderTimers.set(item.id, t)
}

function triggerReminder(item) {
  reminderTimers.delete(item.id)
  const config = getConfig()
  const idx = config.items.findIndex(it => it.id === item.id)
  if (idx >= 0 && config.items[idx].type === 'reminder' && !config.items[idx].triggered) {
    config.items[idx] = { ...config.items[idx], triggered: true }
    saveConfig(config)
    broadcastConfigChanged()
  }
  createReminderPopupWindow(config.items[idx] || item)
}

function createReminderPopupWindow(item) {
  const existing = reminderPopupWindows.get(item.id)
  if (existing && !existing.isDestroyed()) { existing.focus(); return }
  const display = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    x: display.workArea.x, y: display.workArea.y,
    width: display.workArea.width, height: display.workArea.height,
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  reminderPopupWindows.set(item.id, win)
  win.setAlwaysOnTop(true, 'screen-saver')
  const query = { itemId: item.id, title: item.title || '', datetime: String(item.datetime || 0) }
  win.loadFile(path.join(__dirname, '..', 'dist', 'reminder-popup.html'), { query })
  win.on('closed', () => { reminderPopupWindows.delete(item.id) })
}

function createReminderBarWindow(floatingItem) {
  const config = getConfig()
  const sourceItem = config.items.find(it => it.id === floatingItem.itemId)
  if (!sourceItem || sourceItem.type !== 'reminder') return null
  const barId = floatingItem.id
  const existing = reminderBarWindows.get(barId)
  if (existing && !existing.isDestroyed()) { existing.show(); return existing }
  const width = 300, height = 52
  const saved = floatingItem.bounds || {}
  const bounds = keepBoundsInWorkArea({
    width, height,
    x: Number.isFinite(saved.x) ? Math.round(saved.x) : undefined,
    y: Number.isFinite(saved.y) ? Math.round(saved.y) : undefined,
  })
  const win = new BrowserWindow({
    ...bounds,
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, focusable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  reminderBarWindows.set(barId, win)
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setMaximumSize(width, height)
  win.on('resize', () => {
    if (win.isDestroyed()) return
    const [cw, ch] = win.getSize()
    if (cw !== width || ch !== height) win.setSize(width, height)
  })
  win.on('move', () => saveFloatingBoundsDebounced(barId, win))
  const query = { barId, itemId: sourceItem.id, title: sourceItem.title || '', datetime: String(sourceItem.datetime || 0) }
  win.loadFile(path.join(__dirname, '..', 'dist', 'reminder-bar.html'), { query })
  win.on('closed', () => { reminderBarWindows.delete(barId) })
  return win
}

function openDialog(payload) {
  if (dialogWindow && !dialogWindow.isDestroyed()) {
    dialogWindow.focus()
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    dialogResolve = resolve
    const dialogHeights = { link: 440, folder: 560, button: 720, todoName: 360, todoPanel: 760 }
    dialogWindow = new BrowserWindow({
      width: payload?.dialogType === 'todoPanel' ? 620 : 560,
      height: dialogHeights[payload?.dialogType] || 520,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      focusable: true,
      show: false,
      alwaysOnTop: false,
      parent: mainWindow || undefined,
      modal: !!mainWindow,
      hasShadow: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    dialogWindow.center()
    loadApp(dialogWindow, `?mode=dialog&payload=${encodeURIComponent(JSON.stringify(payload || {}))}`)
    dialogWindow.once('ready-to-show', () => {
      if (dialogWindow && !dialogWindow.isDestroyed()) {
        dialogWindow.show()
        dialogWindow.focus()
      }
    })

    dialogWindow.on('closed', () => {
      dialogWindow = null
      if (dialogResolve) {
        dialogResolve(null)
        dialogResolve = null
      }
    })
  })
}

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(String(url).trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function openSafeExternal(url) {
  if (!isSafeExternalUrl(url)) throw new Error('不支持的链接协议')
  return shell.openExternal(String(url).trim())
}

function getWinHwnd(win) {
  if (!win || win.isDestroyed()) return 0
  try {
    const buf = win.getNativeWindowHandle()
    return buf.readUInt32LE(0)
  } catch { return 0 }
}

const supportedShortcutKeys = new Set([
  'ctrl', 'control', 'leftctrl', 'rightctrl',
  'shift', 'leftshift', 'rightshift',
  'alt', 'leftalt', 'rightalt', 'option',
  'win', 'leftwin', 'rightwin', 'meta', 'cmd', 'command',
  'enter', 'return', 'tab', 'esc', 'escape', 'space',
  'backspace', 'delete', 'del', 'insert', 'home', 'end', 'pageup', 'pagedown',
  'up', 'arrowup', 'down', 'arrowdown', 'left', 'arrowleft', 'right', 'arrowright',
  'capslock', 'plus', '=', 'minus', '-', 'comma', ',', 'period', '.', 'slash', '/',
  'backquote', '`', 'semicolon', ';', 'quote', "'", 'bracketleft', '[',
  'bracketright', ']', 'backslash', '\\',
])
for (let i = 65; i <= 90; i++) supportedShortcutKeys.add(String.fromCharCode(i).toLowerCase())
for (let i = 0; i <= 9; i++) supportedShortcutKeys.add(String(i))
for (let i = 1; i <= 24; i++) supportedShortcutKeys.add(`f${i}`)

function normalizeShortcutKey(key) {
  const normalized = String(key || '').toLowerCase().trim()
  const aliases = {
    control: 'ctrl',
    meta: 'win',
    cmd: 'win',
    command: 'win',
    option: 'alt',
    escape: 'esc',
    return: 'enter',
    del: 'delete',
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    '=': 'plus',
  }
  return aliases[normalized] || normalized
}

function normalizeShortcutInput(keys) {
  const raw = String(keys ?? '')
  if (raw.length > 0 && raw.trim() === '') return 'space'

  const text = raw.trim().toLowerCase()
  if (!text) throw new Error('快捷键不能为空')
  if (text === '+') return 'plus'

  const parts = text.split('+').map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) throw new Error('快捷键不能为空')

  const normalizedParts = parts.map(part => {
    if (!supportedShortcutKeys.has(part)) throw new Error(`不支持的按键: ${part}`)
    return normalizeShortcutKey(part)
  })

  if (normalizedParts.length === 0) throw new Error('快捷键不能为空')
  return normalizedParts.join('+')
}

function runPs(action, keys = '', ownerHwnd = 0) {
  return new Promise((resolve, reject) => {
    const allowedActions = new Set(['press', 'down', 'up', 'paste', 'pasteEnter', 'enter', 'click', 'doubleClick'])
    if (!allowedActions.has(action)) {
      reject(new Error('Invalid keyboard action'))
      return
    }

    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      psScript,
      '-action',
      action,
    ]
    if (keys) args.push('-keys', String(keys))
    if (ownerHwnd) args.push('-ownerHwnd', String(ownerHwnd))

    execFile('powershell.exe', args, { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
      if (stdout) log(`PowerShell ${action} stdout: ${stdout.trim()}`)
      if (stderr) log(`PowerShell ${action} stderr: ${stderr.trim()}`)
      if (err) {
        log(`PowerShell ${action} failed: ${err.message}`)
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

async function releaseHeldKeys() {
  if (!heldKeys) return
  const keys = heldKeys
  heldKeys = null
  try { await runPs('up', keys) } catch (e) { log(`releaseHeldKeys failed: ${e.message}`) }
}

async function runWithoutToolFocus(event, action) {
  const win = BrowserWindow.fromWebContents(event.sender)
  const ownerHwnd = win && !win.isDestroyed() ? getWinHwnd(win) : 0
  // 保留工具窗口在 Z 序中的位置，让键盘脚本能可靠找到它下面的目标应用。
  // 切换 focusable 会让窗口暂时脱离 Z 序，导致粘贴被发送到桌面。
  await new Promise(r => setTimeout(r, 40))
  return action(ownerHwnd)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.setAlwaysOnTop(true)
      mainWindow.focus()
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const config = getConfig()
          mainWindow.setAlwaysOnTop(!!config.window.alwaysOnTop)
          mainWindow.setFocusable(false)
        }
      }, 300)
    } else {
      createWindow()
    }
  })

  app.whenReady().then(() => {
    createWindow()
    restoreFloatingWindows()
    scheduleAllReminders()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
        restoreFloatingWindows()
      }
    })
  })
}

app.on('before-quit', () => {
  releaseHeldKeys()
})

app.on('window-all-closed', () => {
  releaseHeldKeys().finally(() => app.quit())
})

ipcMain.handle('dialog:open', (_, payload) => openDialog(payload))
ipcMain.handle('dialog:submit', (_, result) => {
  if (dialogResolve) {
    dialogResolve(result || null)
    dialogResolve = null
  }
  if (dialogWindow && !dialogWindow.isDestroyed()) dialogWindow.close()
  return true
})
ipcMain.handle('dialog:cancel', () => {
  if (dialogResolve) {
    dialogResolve(null)
    dialogResolve = null
  }
  if (dialogWindow && !dialogWindow.isDestroyed()) dialogWindow.close()
  return true
})

ipcMain.handle('config:load', () => getConfig())
ipcMain.handle('config:save', (_, config) => {
  const result = saveConfig(config)
  if (result) {
    syncFloatingWindows(getConfig())
    broadcastConfigChanged()
    scheduleAllReminders()
  }
  return result
})

ipcMain.handle('link:open', (_, url) => openSafeExternal(url))

function getHostname(url) {
  try { return new URL(String(url).trim()).hostname.replace(/^www\./, '') } catch { return '' }
}

function randomDelay(minMs, maxMs) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1))
}

ipcMain.handle('link:openBatch', async (_, urls) => {
  const safeUrls = Array.isArray(urls) ? urls.filter(isSafeExternalUrl) : []
  const openedHosts = new Map()
  for (let i = 0; i < safeUrls.length; i++) {
    const url = String(safeUrls[i]).trim()
    const host = getHostname(url)
    const seenHost = host && openedHosts.has(host)

    await shell.openExternal(url)
    if (host) openedHosts.set(host, (openedHosts.get(host) || 0) + 1)

    if (i < safeUrls.length - 1) {
      const delay = seenHost ? randomDelay(3500, 6000) : randomDelay(1200, 2400)
      await new Promise(r => setTimeout(r, delay))
    }
  }
})

ipcMain.handle('action:text', (event, text, autoEnter) =>
  runWithoutToolFocus(event, async (hwnd) => {
    clipboard.writeText(String(text || ''))
    await new Promise(r => setTimeout(r, 50))
    await runPs(autoEnter ? 'pasteEnter' : 'paste', '', hwnd)
  }))

ipcMain.handle('action:click', () => runPs('click'))
ipcMain.handle('action:doubleClick', () => runPs('doubleClick'))
ipcMain.handle('action:shortcut', (event, keys) => {
  const shortcut = normalizeShortcutInput(keys)
  return runWithoutToolFocus(event, (hwnd) => runPs('press', shortcut, hwnd))
})
ipcMain.handle('action:holdDown', async (event, keys) => {
  const shortcut = normalizeShortcutInput(keys)
  await releaseHeldKeys()
  await runWithoutToolFocus(event, (hwnd) => runPs('down', shortcut, hwnd))
  heldKeys = shortcut
})
ipcMain.handle('action:holdUp', async (event, keys) => {
  const releaseKeys = keys ? normalizeShortcutInput(keys) : heldKeys
  heldKeys = null
  if (releaseKeys) await runWithoutToolFocus(event, (hwnd) => runPs('up', releaseKeys, hwnd))
})

ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    win.setFocusable(true)
    win.minimize()
  }
})
ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.close()
})
ipcMain.handle('window:setAlwaysOnTop', (event, val) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.setAlwaysOnTop(!!val)
})
ipcMain.handle('window:setFocusable', (event, val) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.setFocusable(!!val)
})
ipcMain.handle('window:setBounds', (event, bounds) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.setBounds(safeBounds(bounds, win.getBounds()))
})
ipcMain.handle('window:getBounds', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? win.getBounds() : null
})
ipcMain.handle('window:moveCurrent', (event, x, y) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return null
  const bounds = win.getBounds()
  const nextBounds = keepBoundsInWorkArea({
    ...bounds,
    x: Number.isFinite(Number(x)) ? Math.round(Number(x)) : bounds.x,
    y: Number.isFinite(Number(y)) ? Math.round(Number(y)) : bounds.y,
  })
  win.setPosition(nextBounds.x, nextBounds.y, false)
  return nextBounds
})
ipcMain.handle('window:collapse', (event, collapsed) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const bounds = win.getBounds()
  if (collapsed) {
    win._savedHeight = bounds.height > 70 ? bounds.height : (win._savedHeight || 560)
    const nextBounds = keepBoundsInWorkArea({ x: bounds.x, y: bounds.y, width: bounds.width, height: 41 })
    win.setBounds(nextBounds)
    if (win === mainWindow) lastMainBounds = { ...nextBounds, height: win._savedHeight }
    // 折叠时不保存 bounds 到 config，避免把 41px 高度持久化导致重启白屏
  } else {
    const nextBounds = keepBoundsInWorkArea({ x: bounds.x, y: bounds.y, width: bounds.width, height: win._savedHeight || 560 })
    win.setBounds(nextBounds)
    if (win === mainWindow) lastMainBounds = nextBounds
  }
})

ipcMain.handle('window:resizeCurrent', (event, height) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const bounds = win.getBounds()
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
  const workArea = display.workArea
  const minimumHeight = win === dialogWindow ? 80 : 44
  const nextHeight = Math.max(minimumHeight, Math.min(workArea.height - 48, Math.round(Number(height) || bounds.height)))
  // 保留用户当前 Y 位置，仅做工作区边界约束（修复移到左上/右上角时被强制垂直居中跳回的问题）
  const nextBounds = keepBoundsInWorkArea({ x: bounds.x, y: bounds.y, width: bounds.width, height: nextHeight })
  win.setBounds(nextBounds)
})

ipcMain.handle('floating:create', (_, itemId, position) => {
  const config = getConfig()
  const item = config.items.find(it => it.id === itemId)
  if (!item) throw new Error('内容不存在')

  const existing = config.floatingItems.find(f => f.itemId === itemId)
  if (existing) {
    createFloatingWindow(existing)
    return existing
  }

  const todoCount = item.type === 'todo' ? item.groups.reduce((sum, group) => sum + group.todos.length, 0) : 0
  const groupCount = item.type === 'todo' ? item.groups.length : 0
  const cardSize = getFloatingCardSize(config)
  const width = item.type === 'todo' ? 360 : cardSize.width
  const height = item.type === 'todo' ? Math.min(620, Math.max(120, 56 + groupCount * 44 + todoCount * 28)) : cardSize.height
  const bounds = position && Number.isFinite(position.x) && Number.isFinite(position.y)
    ? { width, height, x: Math.round(position.x - width / 2), y: Math.round(position.y - 20) }
    : defaultFloatingBounds(width, height)
  const floatingItem = {
    id: `float-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemId,
    bounds,
    alwaysOnTop: true,
    createdAt: Date.now(),
  }

  config.floatingItems = [...config.floatingItems, floatingItem]
  saveConfig(config)
  createFloatingWindow(floatingItem)
  broadcastConfigChanged()
  return floatingItem
})

ipcMain.handle('floating:close', (_, floatingId) => {
  const config = getConfig()
  config.floatingItems = config.floatingItems.filter(item => item.id !== floatingId)
  saveConfig(config)

  const win = floatingWindows.get(floatingId)
  if (win && !win.isDestroyed()) win.close()
  floatingWindows.delete(floatingId)
  broadcastConfigChanged()
  return true
})

ipcMain.handle('config:export', async (_, config) => {
  const { dialog } = require('electron')
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出配置',
    defaultPath: 'quick-tools-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, JSON.stringify(config, null, 2), 'utf-8')
    return true
  }
  return false
})

ipcMain.handle('config:import', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入配置',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const data = fs.readFileSync(result.filePaths[0], 'utf-8')
      return JSON.parse(data)
    } catch (e) {
      return null
    }
  }
  return null
})

// ===== 定时提醒 IPC =====
ipcMain.handle('reminder:openSetup', (event, item) => {
  log('[reminder:openSetup] called, item=' + JSON.stringify(item || {}))
  return new Promise((resolve) => {
    if (reminderSetupWindow && !reminderSetupWindow.isDestroyed()) {
      reminderSetupWindow.focus()
      resolve(null)
      return
    }
    reminderSetupResolve = resolve
    const query = {}
    if (item && item.title) query.title = String(item.title)
    if (item && item.datetime) query.datetime = String(item.datetime)
    try {
      reminderSetupWindow = new BrowserWindow({
        width: 440, height: 380,
        frame: false, transparent: true, backgroundColor: '#00000000',
        resizable: false, focusable: true, show: true,
        alwaysOnTop: true, hasShadow: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
      })
      log('[reminder:openSetup] window created, loading file...')
      reminderSetupWindow.loadFile(path.join(__dirname, '..', 'dist', 'reminder-setup.html'), { query })
      reminderSetupWindow.webContents.on('did-finish-load', () => {
        log('[reminder:openSetup] page loaded, showing window')
        if (reminderSetupWindow && !reminderSetupWindow.isDestroyed()) reminderSetupWindow.show()
      })
      reminderSetupWindow.webContents.on('did-fail-load', (e, code, desc) => {
        log('[reminder:openSetup] FAILED to load: ' + code + ' ' + desc)
      })
      reminderSetupWindow.on('closed', () => {
        log('[reminder:openSetup] window closed')
        reminderSetupWindow = null
        if (reminderSetupResolve) { reminderSetupResolve(null); reminderSetupResolve = null }
      })
    } catch (e) {
      log('[reminder:openSetup] ERROR creating window: ' + e.message)
      reminderSetupWindow = null
      if (reminderSetupResolve) { reminderSetupResolve(null); reminderSetupResolve = null }
    }
  })
})

ipcMain.on('reminder:setupSubmit', (_, result) => {
  if (reminderSetupResolve) { reminderSetupResolve(result || null); reminderSetupResolve = null }
  if (reminderSetupWindow && !reminderSetupWindow.isDestroyed()) reminderSetupWindow.close()
})

ipcMain.handle('reminder:createBar', (_, itemId, position) => {
  const config = getConfig()
  const item = config.items.find(it => it.id === itemId)
  if (!item) throw new Error('内容不存在')
  const existing = config.floatingItems.find(f => f.itemId === itemId)
  if (existing) {
    createReminderBarWindow(existing)
    return existing
  }
  const width = 300, height = 52
  const bounds = position && Number.isFinite(position.x) && Number.isFinite(position.y)
    ? { width, height, x: Math.round(position.x - width / 2), y: Math.round(position.y - 20) }
    : defaultFloatingBounds(width, height)
  const floatingItem = {
    id: `float-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemId,
    bounds,
    alwaysOnTop: true,
    createdAt: Date.now(),
  }
  config.floatingItems = [...config.floatingItems, floatingItem]
  saveConfig(config)
  createReminderBarWindow(floatingItem)
  broadcastConfigChanged()
  return floatingItem
})

ipcMain.handle('reminder:closeBar', (_, barId) => {
  const config = getConfig()
  config.floatingItems = config.floatingItems.filter(item => item.id !== barId)
  saveConfig(config)
  const win = reminderBarWindows.get(barId)
  if (win && !win.isDestroyed()) win.close()
  reminderBarWindows.delete(barId)
  broadcastConfigChanged()
  return true
})

ipcMain.handle('reminder:dismiss', (event, itemId) => {
  const win = reminderPopupWindows.get(itemId)
  if (win && !win.isDestroyed()) win.close()
  return true
})
