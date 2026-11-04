// Fixes the electron-builder winCodeSign cache symlink issue on Windows.
// The winCodeSign-2.6.0.7z archive contains macOS symlinks that 7-zip
// cannot create without Developer Mode or Admin privileges. This script
// downloads and extracts the archive, then patches the broken symlinks.

const https = require('https')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const CACHE_DIR = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign')
const TARGET_DIR = path.join(CACHE_DIR, 'winCodeSign-2.6.0')
const DOWNLOAD_URL = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z'

if (fs.existsSync(path.join(TARGET_DIR, 'windows-10'))) {
  console.log('  winCodeSign cache already valid, skipping.')
  process.exit(0)
}

console.log('  Preparing winCodeSign cache...')
fs.mkdirSync(CACHE_DIR, { recursive: true })

const archivePath = path.join(CACHE_DIR, 'winCodeSign-2.6.0.7z')
const sevenZip = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      const mod = u.startsWith('https') ? https : require('http')
      mod.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location)
          return
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
        const file = fs.createWriteStream(dest)
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
      }).on('error', reject)
    }
    follow(url)
  })
}

async function main() {
  // Download if not already present
  if (!fs.existsSync(archivePath)) {
    console.log('  Downloading winCodeSign-2.6.0...')
    await download(DOWNLOAD_URL, archivePath)
  }

  // Extract (will fail on symlinks but that's OK, exit code 2 = warnings only)
  const tempDir = path.join(CACHE_DIR, '_temp_extract')
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true })

  try {
    execSync(`"${sevenZip}" x -bd -y "${archivePath}" "-o${tempDir}"`, { stdio: 'pipe' })
  } catch (e) {
    // Exit code 2 = symlink warnings, files are still extracted
    if (e.status !== 2) throw e
  }

  // Fix the broken darwin symlinks (0-byte files → copy the real files)
  const darwinLib = path.join(tempDir, 'darwin', '10.12', 'lib')
  if (fs.existsSync(darwinLib)) {
    const fixes = [
      ['libcrypto.1.0.0.dylib', 'libcrypto.dylib'],
      ['libssl.1.0.0.dylib', 'libssl.dylib'],
    ]
    for (const [src, dest] of fixes) {
      const srcPath = path.join(darwinLib, src)
      const destPath = path.join(darwinLib, dest)
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  // Move to the expected directory name
  if (fs.existsSync(TARGET_DIR)) fs.rmSync(TARGET_DIR, { recursive: true })
  fs.renameSync(tempDir, TARGET_DIR)

  // Clean up archive
  try { fs.unlinkSync(archivePath) } catch {}

  console.log('  winCodeSign cache ready.')
}

main().catch(e => {
  console.error('  Cache fix failed:', e.message)
  // Don't fail the build — electron-builder might still work
  process.exit(0)
})
