import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    initDependencies: () => ipcRenderer.invoke('init-dependencies'),
    selectFolder: (title?: string) => ipcRenderer.invoke('select-folder', title),
    searchYoutube: (query: any) => ipcRenderer.invoke('search-youtube', query),
    fetchMetadata: (url: string) => ipcRenderer.invoke('fetch-metadata', url),
    downloadSong: (data: any) => ipcRenderer.invoke('download-song', data),
    scanLibrary: (folder: string) => ipcRenderer.invoke('scan-library', folder),
    spotifyLogin: () => ipcRenderer.invoke('spotify-login'),
    spotifyGetToken: () => ipcRenderer.invoke('spotify-get-token'),
    spotifyLogout: () => ipcRenderer.invoke('spotify-logout'),
    djDetectLibraries: () => ipcRenderer.invoke('dj-detect-libraries'),
    djLoadLibraries: (req: any) => ipcRenderer.invoke('dj-load-libraries', req),
    djSelectXml: (title: string) => ipcRenderer.invoke('dj-select-xml', title),
    djOpenRekordbox: () => ipcRenderer.invoke('dj-open-rekordbox'),
    djGetDestinations: () => ipcRenderer.invoke('dj-get-destinations'),
    djSetDestinations: (destinations: any[]) => ipcRenderer.invoke('dj-set-destinations', destinations),
    djScanFolder: (folder: string) => ipcRenderer.invoke('dj-scan-folder', folder),
    djApplyTriage: (assignments: any[]) => ipcRenderer.invoke('dj-apply-triage', assignments),
    djRevealFile: (filePath: string) => ipcRenderer.invoke('dj-reveal-file', filePath),
});
