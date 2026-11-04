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
    resolveEpisode: (title: string, ep: number, titleEn?: string) => ipcRenderer.invoke('stream:resolveEpisode', title, ep, titleEn),
    resolveShow: (title: string) => ipcRenderer.invoke('stream:resolveShow', title),
    getSources: (title: string, ep: number, malId?: number) => ipcRenderer.invoke('stream:getSources', title, ep, malId),
    getSkipTimes: (malId: number, ep: number, duration?: number) => ipcRenderer.invoke('stream:getSkipTimes', malId, ep, duration),
    learnSlug: (title: string, slug: string) => ipcRenderer.invoke('stream:learnSlug', title, slug),
    clearCache: (title: string) => ipcRenderer.invoke('stream:clearCache', title),
    prefetch: (title: string) => ipcRenderer.invoke('stream:prefetch', title),
    cancelPrefetch: (title: string) => ipcRenderer.invoke('stream:cancelPrefetch', title),
    siteHealth: () => ipcRenderer.invoke('stream:siteHealth'),
    setApiUrl: (url: string) => ipcRenderer.invoke('stream:setApiUrl', url),
    getApiUrl: () => ipcRenderer.invoke('stream:getApiUrl'),
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
