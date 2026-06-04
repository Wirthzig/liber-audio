import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    initDependencies: () => ipcRenderer.invoke('init-dependencies'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    searchYoutube: (query: any) => ipcRenderer.invoke('search-youtube', query),
    fetchMetadata: (url: string) => ipcRenderer.invoke('fetch-metadata', url),
    downloadSong: (data: any) => ipcRenderer.invoke('download-song', data),
    scanLibrary: (folder: string) => ipcRenderer.invoke('scan-library', folder),
    spotifyLogin: () => ipcRenderer.invoke('spotify-login'),
    spotifyGetToken: () => ipcRenderer.invoke('spotify-get-token'),
    spotifyLogout: () => ipcRenderer.invoke('spotify-logout'),
});
