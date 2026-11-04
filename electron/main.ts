import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { initDatabase, registerAllHandlers, getAppState, setAppState } from './database'
import { registerStreamHandlers } from './stream-resolver'

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

  // ponytail: guard webview src to streaming domain only
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    // Strip away preload scripts
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
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
  if (wss) { try { wss.close() } catch {} }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
