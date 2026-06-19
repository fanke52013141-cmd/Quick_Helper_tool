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
let heldKeys = null

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
  config.window = {
    alwaysOnTop: false,
    collapsed: false,
    width: 330,
    height: 360,
    ...(config.window || {}),
  }
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
  return result
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

function saveMainBoundsDebounced() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  clearTimeout(boundsTimers.get('main'))
  boundsTimers.set('main', setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const config = getConfig()
    config.window = { ...config.window, ...mainWindow.getBounds() }
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
    const nextBounds = sourceItem?.type === 'todo' ? bounds : { x: bounds.x, y: bounds.y, width: 72, height: 72 }
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

  mainWindow = new BrowserWindow({
    ...safeBounds(winConfig, { width: 330, height: 360 }),
    frame: false,
    transparent: false,
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

  mainWindow.setMinimumSize(200, 42)
  mainWindow.on('resize', saveMainBoundsDebounced)
  mainWindow.on('move', saveMainBoundsDebounced)
  mainWindow.on('closed', () => { mainWindow = null })
}

function createFloatingWindow(floatingItem) {
  const config = getConfig()
  const sourceItem = config.items.find(item => item.id === floatingItem.itemId)
  const isTodo = sourceItem?.type === 'todo'
  const existing = floatingWindows.get(floatingItem.id)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }

  const saved = floatingItem.bounds || {}
  const bounds = isTodo
    ? safeBounds(saved, { width: 360, height: 320 })
    : { width: 72, height: 72, x: Number.isFinite(saved.x) ? Math.round(saved.x) : undefined, y: Number.isFinite(saved.y) ? Math.round(saved.y) : undefined }
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: !isTodo,
    backgroundColor: isTodo ? '#FDFDFD' : '#00000000',
    resizable: isTodo,
    focusable: isTodo,
    alwaysOnTop: floatingItem.alwaysOnTop ?? true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  floatingWindows.set(floatingItem.id, win)
  loadApp(win, `?mode=floating&floatingId=${encodeURIComponent(floatingItem.id)}`)

  win.setMinimumSize(isTodo ? 220 : 72, isTodo ? 34 : 72)
  win.on('resize', () => saveFloatingBoundsDebounced(floatingItem.id, win))
  win.on('move', () => saveFloatingBoundsDebounced(floatingItem.id, win))
  win.on('closed', () => {
    floatingWindows.delete(floatingItem.id)
  })

  return win
}

function restoreFloatingWindows() {
  const config = getConfig()
  config.floatingItems.forEach(item => createFloatingWindow(item))
}

function openDialog(payload) {
  if (dialogWindow && !dialogWindow.isDestroyed()) {
    dialogWindow.focus()
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    dialogResolve = resolve
    dialogWindow = new BrowserWindow({
      width: payload?.dialogType === 'todoPanel' ? 620 : 560,
      height: payload?.dialogType === 'todoPanel' ? 620 : 520,
      frame: false,
      transparent: false,
      resizable: true,
      focusable: true,
      show: false,
      alwaysOnTop: true,
      parent: mainWindow || undefined,
      modal: false,
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

function runPs(action, keys = '') {
  return new Promise((resolve, reject) => {
    const allowedActions = new Set(['press', 'down', 'up', 'paste', 'enter', 'click', 'doubleClick'])
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

    execFile('powershell.exe', args, { timeout: 5000 }, (err, stdout, stderr) => {
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

ipcMain.handle('action:text', async (_, text, autoEnter) => {
  clipboard.writeText(String(text || ''))
  await new Promise(r => setTimeout(r, 50))
  await runPs('paste')
  if (autoEnter) {
    await new Promise(r => setTimeout(r, 80))
    await runPs('enter')
  }
})

ipcMain.handle('action:click', () => runPs('click'))
ipcMain.handle('action:doubleClick', () => runPs('doubleClick'))
ipcMain.handle('action:shortcut', (_, keys) => runPs('press', keys))
ipcMain.handle('action:holdDown', async (_, keys) => {
  await releaseHeldKeys()
  await runPs('down', keys)
  heldKeys = String(keys || '')
})
ipcMain.handle('action:holdUp', async (_, keys) => {
  const releaseKeys = keys || heldKeys
  heldKeys = null
  if (releaseKeys) await runPs('up', releaseKeys)
})

ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.minimize()
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
ipcMain.handle('window:collapse', (event, collapsed) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const bounds = win.getBounds()
  if (collapsed) {
    win._savedHeight = bounds.height > 80 ? bounds.height : (win._savedHeight || 360)
    win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 42 })
  } else {
    win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: win._savedHeight || 360 })
  }
})

ipcMain.handle('window:resizeCurrent', (event, height) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const bounds = win.getBounds()
  const nextHeight = Math.max(34, Math.min(900, Math.round(Number(height) || bounds.height)))
  win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: nextHeight })
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
  const width = item.type === 'todo' ? 360 : 72
  const height = item.type === 'todo' ? Math.min(620, Math.max(110, 46 + groupCount * 44 + todoCount * 28)) : 72
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
