import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  db: {
    getAllAnime: () => ipcRenderer.invoke('db:getAllAnime'),
    getAnime: (id: number) => ipcRenderer.invoke('db:getAnime', id),
    getAnimeByMalId: (malId: number) => ipcRenderer.invoke('db:getAnimeByMalId', malId),
    getAnimeByAnilistId: (anilistId: number) => ipcRenderer.invoke('db:getAnimeByAnilistId', anilistId),
    upsertAnime: (data: any) => ipcRenderer.invoke('db:upsertAnime', data),
    getLibrary: () => ipcRenderer.invoke('db:getLibrary'),
    getLibraryEntry: (animeId: number) => ipcRenderer.invoke('db:getLibraryEntry', animeId),
    upsertLibraryEntry: (data: any) => ipcRenderer.invoke('db:upsertLibraryEntry', data),
    deleteLibraryEntry: (animeId: number) => ipcRenderer.invoke('db:deleteLibraryEntry', animeId),
    getAiringSchedule: (from: string, to: string) => ipcRenderer.invoke('db:getAiringSchedule', from, to),
    upsertAiringSchedule: (data: any) => ipcRenderer.invoke('db:upsertAiringSchedule', data),
    getFranchiseWatches: () => ipcRenderer.invoke('db:getFranchiseWatches'),
    upsertFranchiseWatch: (data: any) => ipcRenderer.invoke('db:upsertFranchiseWatch', data),
    updateFranchiseWatchState: (id: number, state: string) => ipcRenderer.invoke('db:updateFranchiseWatchState', id, state),
    addWatchEvent: (data: any) => ipcRenderer.invoke('db:addWatchEvent', data),
    getWatchEvents: (animeId: number) => ipcRenderer.invoke('db:getWatchEvents', animeId),
    addNotInterested: (animeId: number, reason?: string) => ipcRenderer.invoke('db:addNotInterested', animeId, reason),
    getNotInterested: () => ipcRenderer.invoke('db:getNotInterested'),
    exportData: () => ipcRenderer.invoke('db:exportData'),
    importData: (json: string) => ipcRenderer.invoke('db:importData', json),
    getStats: () => ipcRenderer.invoke('db:getStats'),
    search: (query: string) => ipcRenderer.invoke('db:search', query),
    getAppState: (key: string) => ipcRenderer.invoke('db:getAppState', key),
    setAppState: (key: string, value: string) => ipcRenderer.invoke('db:setAppState', key, value),
  },
  fs: {
    selectFile: (filters?: any[]) => ipcRenderer.invoke('fs:selectFile', filters),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    selectSavePath: (defaultName?: string, filters?: any[]) => ipcRenderer.invoke('fs:selectSavePath', defaultName, filters),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  },
  stream: {
    resolveEpisode: (title: string, ep: number, opts?: { titleEn?: string; providerId?: string; excludeOrigins?: string[]; audio?: 'sub' | 'dub'; anilistId?: number }) =>
      ipcRenderer.invoke('stream:resolveEpisode', title, ep, opts),
    getSkipTimes: (malId: number, ep: number, duration?: number) => ipcRenderer.invoke('stream:getSkipTimes', malId, ep, duration),
    learnFromUrl: (title: string, url: string, ep: number) => ipcRenderer.invoke('stream:learnFromUrl', title, url, ep),
    reportFailure: (url: string, reason: string) => ipcRenderer.invoke('stream:reportFailure', url, reason),
    useLink: (title: string, url: string, ep: number) => ipcRenderer.invoke('stream:useLink', title, url, ep),
    episodeCount: (title: string, audio: 'sub' | 'dub', opts?: { titleEn?: string; anilistId?: number }) => ipcRenderer.invoke('stream:episodeCount', title, audio, opts),
    clearCache: (title?: string) => ipcRenderer.invoke('stream:clearCache', title),
    prefetch: (title: string, titleEn?: string) => ipcRenderer.invoke('stream:prefetch', title, titleEn),
    cancelPrefetch: (title: string) => ipcRenderer.invoke('stream:cancelPrefetch', title),
    player: (webContentsId: number, cmd: unknown) => ipcRenderer.invoke('stream:player', webContentsId, cmd),
    onBlocked: (callback: (info: { kind: string; detail: string }) => void) => {
      const fn = (_e: unknown, info: { kind: string; detail: string }) => callback(info)
      ipcRenderer.on('stream:blocked', fn)
      return () => { ipcRenderer.removeListener('stream:blocked', fn) }
    },
  },
  sources: {
    snapshot: () => ipcRenderer.invoke('sources:snapshot'),
    refreshManifest: () => ipcRenderer.invoke('sources:refreshManifest'),
    discover: (providerId?: string) => ipcRenderer.invoke('sources:discover', providerId),
    recheck: (origin?: string) => ipcRenderer.invoke('sources:recheck', origin),
    approve: (origin: string, approved: boolean) => ipcRenderer.invoke('sources:approve', origin, approved),
    removeDomain: (origin: string) => ipcRenderer.invoke('sources:removeDomain', origin),
    addDomain: (providerId: string, url: string) => ipcRenderer.invoke('sources:addDomain', providerId, url),
    addProvider: (input: { name: string; url: string; searchPath?: string; layout: 'gogo' | 'generic' }) => ipcRenderer.invoke('sources:addProvider', input),
    removeProvider: (id: string) => ipcRenderer.invoke('sources:removeProvider', id),
    addSiteByLink: (url: string) => ipcRenderer.invoke('sources:addSiteByLink', url),
    testSearch: (id: string, title: string) => ipcRenderer.invoke('sources:testSearch', id, title),
    setProvider: (id: string, pref: { enabled?: boolean }) => ipcRenderer.invoke('sources:setProvider', id, pref),
    moveProvider: (id: string, dir: -1 | 1) => ipcRenderer.invoke('sources:moveProvider', id, dir),
    setOptions: (opts: { manifestUrl?: string; adblock?: boolean; strictApproval?: boolean; safeBrowsingKey?: string | null }) =>
      ipcRenderer.invoke('sources:setOptions', opts),
    onChanged: (callback: () => void) => {
      const fn = () => callback()
      ipcRenderer.on('stream:stateChanged', fn)
      return () => { ipcRenderer.removeListener('stream:stateChanged', fn) }
    },
  },
  accounts: {
    status: () => ipcRenderer.invoke('accounts:status'),
    setClientId: (service: 'anilist' | 'mal', clientId: string) => ipcRenderer.invoke('accounts:setClientId', service, clientId),
    login: (service: 'anilist' | 'mal') => ipcRenderer.invoke('accounts:login', service),
    logout: (service: 'anilist' | 'mal') => ipcRenderer.invoke('accounts:logout', service),
    syncAll: () => ipcRenderer.invoke('accounts:syncAll'),
  },
  app: {
    getDataPath: () => ipcRenderer.invoke('app:getDataPath'),
    onDeepLink: (callback: (url: string) => void) => {
      ipcRenderer.removeAllListeners('deep-link')
      ipcRenderer.on('deep-link', (_event, url) => callback(url))
    },
    onExtensionMessage: (callback: (msg: any) => void) => {
      ipcRenderer.removeAllListeners('extension:message')
      ipcRenderer.on('extension:message', (_event, msg) => callback(msg))
    },
  },
})
