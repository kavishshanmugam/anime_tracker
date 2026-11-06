import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { initDatabase, registerAllHandlers, getAppState, setAppState } from './database'
import { registerStreamHandlers, guardWebview, getEngine, flushStreamState, STREAM_PARTITION } from './stream-resolver'

const isDev = !app.isPackaged

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let wss: any = null // WebSocket server ref for cleanup

function getWasmPath(): string {
  if (isDev) {
    return path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  }
  return path.join(process.resourcesPath, 'sql-wasm.wasm')
}

function getDbPath(): string {
  return path.join(app.getPath('userData'), 'senpai.db')
}

function backupDb(): void {
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) return

  const backupDir = path.join(app.getPath('userData'), 'backups')
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `senpai-${timestamp}.db`)
  fs.copyFileSync(dbPath, backupPath)

  // Keep last 5 backups
  const backups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('senpai-') && f.endsWith('.db'))
    .sort()
  while (backups.length > 5) {
    fs.unlinkSync(path.join(backupDir, backups.shift()!))
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  })

  // ponytail: check if vite dev server is running, else load built files
  const distPath = path.join(__dirname, '..', 'dist', 'index.html')
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else if (fs.existsSync(distPath)) {
    mainWindow.loadFile(distPath)
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(distPath)
  }

  // Webviews: no preload/node, sandboxed, forced into the hardened streaming
  // partition, and the initial src must be a domain that passed the safety gate.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // NOTE: don't enable nodeIntegrationInSubFrames — with a sandboxed webview it crashes Electron
    // (FATAL NOTREACHED) as soon as a page embeds a cross-origin player iframe. The playback controller
    // is injected into subframes by the main process instead (stream-resolver inVideoFrame).
    webPreferences.nodeIntegrationInSubFrames = false
    params.partition = STREAM_PARTITION
    const engine = getEngine()
    if (params.src && engine && !engine.isAllowedNavigation(params.src)) {
      console.warn(`[security] refused webview for unvetted URL ${params.src}`)
      event.preventDefault()
    }
  })

  // External links (window.open / target=_blank) open in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = mainWindow?.webContents.getURL() ?? ''
    if (url.startsWith('file:') || url.startsWith('http://localhost') || url.split('#')[0] === appUrl.split('#')[0]) return
    event.preventDefault()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// WebSocket server for browser extension communication
function startExtensionServer(): void {
  // ponytail: lazy import, only needed at runtime
  import('ws').then(({ WebSocketServer }) => {
    wss = new WebSocketServer({ host: '127.0.0.1', port: 9876 })

    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          // Forward to renderer
          mainWindow?.webContents.send('extension:message', msg)
        } catch { /* ignore malformed messages */ }
      })
    })

    wss.on('error', (err) => {
      console.error('Extension WS server error:', err.message)
    })
  }).catch(() => {
    console.warn('ws module not available, extension server disabled')
  })
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') guardWebview(contents)
})

app.whenReady().then(async () => {
  try {
    backupDb()
  } catch (e) {
    console.error('Backup failed:', e)
  }
  try {
    await initDatabase(getWasmPath(), getDbPath())
  } catch (e) {
    dialog.showErrorBox('Senpai - Database Error', `Failed to initialize database:\n${e}`)
    app.quit()
    return
  }
  registerAllHandlers(ipcMain)
  registerStreamHandlers(getAppState, setAppState)
  createWindow()
  startExtensionServer()
})

app.on('before-quit', () => {
  flushStreamState()
  if (wss) { try { wss.close() } catch {} }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
