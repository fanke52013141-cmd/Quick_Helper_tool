// ======================== 类型定义 ========================

export type CardSize = 'small' | 'medium' | 'large'
export type ItemType = 'link' | 'folder' | 'button' | 'todo' | 'reminder'
export type ButtonType = 'text' | 'shortcut' | 'hold' | 'timer'

export interface LinkRef {
  id: string
  title: string
  url: string
}

export interface BaseItem {
  id: string
  type: ItemType
  title: string
  sortOrder: number
}

export interface LinkItem extends BaseItem {
  type: 'link'
  url: string
}

export interface FolderItem extends BaseItem {
  type: 'folder'
  links: LinkRef[]
}

export interface ButtonItem extends BaseItem {
  type: 'button'
  buttonType: ButtonType
  content: string
  autoEnter?: boolean
}

export interface TodoEntry {
  id: string
  text: string
  completed: boolean
}

export interface TodoGroup {
  id: string
  name: string
  todos: TodoEntry[]
}

export interface TodoItem extends BaseItem {
  type: 'todo'
  groups: TodoGroup[]
}

export interface ReminderItem extends BaseItem {
  type: 'reminder'
  datetime: number
  triggered?: boolean
}

export type GridItem = LinkItem | FolderItem | ButtonItem | TodoItem | ReminderItem

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface FloatingItem {
  id: string
  itemId: string
  bounds: WindowBounds
  alwaysOnTop: boolean
  createdAt: number
}

export interface AppConfig {
  version: number
  grid: {
    columns: number
    cardSize: CardSize
  }
  window: WindowBounds & {
    alwaysOnTop: boolean
    collapsed: boolean
  }
  settings: {
    autoEnterAfterText: boolean
    bgColor: string
  }
  items: GridItem[]
  floatingItems: FloatingItem[]
}

// ======================== 默认配置 ========================

export const DEFAULT_CONFIG: AppConfig = {
  version: 5,
  grid: {
    columns: 4,
    cardSize: 'small',
  },
  window: {
    alwaysOnTop: false,
    collapsed: false,
    width: 416,
    height: 560,
  },
  settings: {
    autoEnterAfterText: true,
    bgColor: '#FDFDFD',
  },
  floatingItems: [],
  items: [
    {
      id: 'demo-link-1',
      type: 'link',
      title: 'GitHub',
      url: 'https://github.com',
      sortOrder: 0,
    },
    {
      id: 'demo-link-2',
      type: 'link',
      title: 'Google',
      url: 'https://google.com',
      sortOrder: 1,
    },
    {
      id: 'demo-folder-1',
      type: 'folder',
      title: '搜索',
      links: [
        { id: 'fl-1', title: '百度', url: 'https://baidu.com' },
        { id: 'fl-2', title: 'Bing', url: 'https://bing.com' },
      ],
      sortOrder: 2,
    },
    {
      id: 'demo-btn-1',
      type: 'button',
      buttonType: 'text',
      title: '你好',
      content: '你好，请问有什么可以帮您？',
      autoEnter: true,
      sortOrder: 3,
    },
    {
      id: 'demo-btn-2',
      type: 'button',
      buttonType: 'shortcut',
      title: '截图',
      content: 'ctrl+alt+a',
      sortOrder: 4,
    },
    {
      id: 'demo-todo-1',
      type: 'todo',
      title: '待办',
      groups: [
        {
          id: 'g-demo',
          name: '今日任务',
          todos: [
            { id: 't-demo-1', text: '试试右键添加新项目', completed: false },
            { id: 't-demo-2', text: '点击卡片试试功能', completed: false },
          ],
        },
      ],
      sortOrder: 5,
    },
  ],
}

// ======================== 卡片尺寸 ========================

export const CARD_SIZES: Record<CardSize, { card: number; icon: number; title: string }> = {
  small: { card: 65, icon: 24, title: '11px' },
  medium: { card: 86, icon: 28, title: '12px' },
  large: { card: 105, icon: 34, title: '13px' },
}

// ======================== 工具函数 ========================

export function genId(prefix: string = 'i'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function validateUrl(url: string): boolean {
  return /^https?:\/\/.+/.test(url)
}
