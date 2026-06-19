import type { AppConfig, WindowBounds } from './types'

declare global {
  interface Window {
    api: {
      openDialog: (payload: any) => Promise<any | null>
      submitDialog: (result: any) => Promise<boolean>
      cancelDialog: () => Promise<boolean>
      loadConfig: () => Promise<AppConfig | null>
      saveConfig: (config: AppConfig) => Promise<boolean>
      exportConfig: (config: AppConfig) => Promise<boolean>
      importConfig: () => Promise<AppConfig | null>
      openLink: (url: string) => Promise<void>
      openBatch: (urls: string[]) => Promise<void>
      sendText: (text: string, autoEnter: boolean) => Promise<void>
      pressShortcut: (keys: string) => Promise<void>
      holdDown: (keys: string) => Promise<void>
      holdUp: (keys: string) => Promise<void>
      click: () => Promise<void>
      doubleClick: () => Promise<void>
      minimize: () => Promise<void>
      close: () => Promise<void>
      setAlwaysOnTop: (val: boolean) => Promise<void>
      setFocusable: (val: boolean) => Promise<void>
      setBounds: (bounds: WindowBounds) => Promise<void>
      getBounds: () => Promise<WindowBounds | null>
      collapse: (collapsed: boolean) => Promise<void>
      resizeCurrentWindow: (height: number) => Promise<void>
      createFloating: (itemId: string, position?: { x: number; y: number }) => Promise<void>
      closeFloating: (floatingId: string) => Promise<boolean>
      onConfigChanged?: (callback: (config: AppConfig) => void) => () => void
    }
  }
}

export {}
