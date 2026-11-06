// Session preload for the streaming webview (runs sandboxed, in every frame).
// Exposes nothing to the page; it only installs the playback controller in the
// page's main world as early as possible so hls.js instances can be captured.
import { webFrame } from 'electron'
import { PLAYER_HOOK_SOURCE } from './player-hook'

webFrame.executeJavaScript(PLAYER_HOOK_SOURCE).catch(() => { /* page torn down */ })
