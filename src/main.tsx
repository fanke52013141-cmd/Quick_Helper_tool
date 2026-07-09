import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// 浏览器预览降级：Electron 中由 preload 注入真实 API。
if (!window.api && import.meta.env.DEV) {
  const noop = async () => undefined
  window.api = new Proxy({
    loadConfig: async () => null,
    saveConfig: async () => true,
    openDialog: async () => null,
    submitDialog: async () => true,
    cancelDialog: async () => true,
    importConfig: async () => null,
    exportConfig: async () => true,
    getBounds: async () => null,
    closeFloating: async () => true,
    openReminderSetup: async () => null,
    submitReminderSetup: () => undefined,
    createReminderBar: async () => undefined,
    closeReminderBar: async () => true,
    dismissReminder: async () => true,
    onConfigChanged: () => () => undefined,
  } as Partial<Window['api']>, {
    get(target, property) {
      return property in target ? target[property as keyof typeof target] : noop
    },
  }) as Window['api']
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
