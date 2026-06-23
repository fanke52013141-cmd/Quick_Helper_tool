import { useState, useEffect, useRef, useCallback } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import TopBar from './components/TopBar'
import Card, { EmptyCard } from './components/Card'
import ContextMenu, { menuIcons } from './components/ContextMenu'
import {
  LinkDialog, FolderDialog, ButtonDialog, TodoNameDialog, TodoPanelDialog,
} from './components/Dialogs'
import FloatingItemView from './components/FloatingItemView'
import type { AppConfig, GridItem, ButtonType, LinkRef, TodoGroup, CardSize } from './types'
import { DEFAULT_CONFIG, genId } from './types'

function isHoldButton(item: GridItem): item is Extract<GridItem, { type: 'button' }> {
  return item.type === 'button' && item.buttonType === 'hold'
}

// ======================== 可排序卡片包装 ========================
function SortableCard(props: {
  item: GridItem
  isHolding: boolean
  timerRemaining?: number
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  onPointerLeave?: (e: React.PointerEvent) => void
  onPointerCancel?: (e: React.PointerEvent) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.item.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card
        item={props.item}
        isHolding={props.isHolding}
        timerRemaining={props.timerRemaining}
        onClick={props.onClick}
        onContextMenu={props.onContextMenu}
        onPointerDown={props.onPointerDown}
        onPointerUp={props.onPointerUp}
        onPointerLeave={props.onPointerLeave}
        onPointerCancel={props.onPointerCancel}
      />
    </div>
  )
}

// ======================== 主应用 ========================
export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [loaded, setLoaded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: any[] } | null>(null)
  const [holdingId, setHoldingId] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [timerEnds, setTimerEnds] = useState<Record<string, number>>({})
  const toastTimer = useRef<number | null>(null)
  const applyingRemoteConfig = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })
  const holdingIdRef = useRef<string | null>(null)
  const heldContentRef = useRef<string | null>(null)
  const params = new URLSearchParams(window.location.search)
  const appMode = params.get('mode')
  const isFloatingMode = appMode === 'floating'
  const isDialogMode = appMode === 'dialog'
  const floatingId = params.get('floatingId')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const dialogPayload = (() => {
    if (!isDialogMode) return null
    try { return JSON.parse(params.get('payload') || '{}') } catch { return {} }
  })()

  // 加载配置
  useEffect(() => {
    ;(async () => {
      const saved = await window.api.loadConfig()
      if (saved) {
        const merged = { ...DEFAULT_CONFIG, ...saved }
        merged.grid = { ...DEFAULT_CONFIG.grid, ...(saved.grid || {}) }
        merged.window = { ...DEFAULT_CONFIG.window, ...(saved.window || {}) }
        merged.settings = { ...DEFAULT_CONFIG.settings, ...(saved.settings || {}) }
        merged.items = saved.items || []
        merged.floatingItems = saved.floatingItems || []
        setConfig(merged)
        setCollapsed(merged.window.collapsed)
        setAlwaysOnTop(merged.window.alwaysOnTop)
        if (merged.window.alwaysOnTop) {
          window.api.setAlwaysOnTop(true)
        }
      }
      setLoaded(true)
      if (!isFloatingMode && !isDialogMode) window.api.setFocusable(false)
    })()
  }, [isFloatingMode, isDialogMode])

  // 保存配置
  const saveConfig = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig)
    window.api.saveConfig(newConfig)
  }, [])

  // 自动保存（防抖）
  const saveTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!loaded) return
    if (applyingRemoteConfig.current) {
      applyingRemoteConfig.current = false
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const toSave = { ...config, window: { ...config.window, collapsed, alwaysOnTop } }
      window.api.saveConfig(toSave)
    }, 500)
  }, [config, collapsed, alwaysOnTop, loaded])

  useEffect(() => {
    const updatePointer = (event: PointerEvent) => {
      lastPointer.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointermove', updatePointer, true)
    return () => window.removeEventListener('pointermove', updatePointer, true)
  }, [])

  useEffect(() => {
    const off = window.api.onConfigChanged?.((nextConfig: AppConfig) => {
      applyingRemoteConfig.current = true
      const merged = { ...DEFAULT_CONFIG, ...nextConfig }
      merged.grid = { ...DEFAULT_CONFIG.grid, ...(nextConfig.grid || {}) }
      merged.window = { ...DEFAULT_CONFIG.window, ...(nextConfig.window || {}) }
      merged.settings = { ...DEFAULT_CONFIG.settings, ...(nextConfig.settings || {}) }
      merged.items = nextConfig.items || []
      merged.floatingItems = nextConfig.floatingItems || []
      setConfig(merged)
      setCollapsed(merged.window.collapsed)
      setAlwaysOnTop(merged.window.alwaysOnTop)
    })
    return () => off?.()
  }, [])

  const [nowTick, setNowTick] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // 显示 toast
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2000)
  }, [])

  const setActiveHolding = useCallback((id: string | null, content: string | null = null) => {
    holdingIdRef.current = id
    heldContentRef.current = content
    setHoldingId(id)
  }, [])

  const releaseHold = useCallback(async (id?: string) => {
    const activeId = id || holdingIdRef.current
    const activeContent = heldContentRef.current
    if (!activeId || !activeContent) return

    setActiveHolding(null)
    await window.api.holdUp(activeContent)
  }, [setActiveHolding])

  const pressHold = useCallback(async (item: Extract<GridItem, { type: 'button' }>) => {
    if (deleteMode) return
    if (holdingIdRef.current === item.id) return

    if (holdingIdRef.current) {
      await releaseHold(holdingIdRef.current)
    }

    await window.api.holdDown(item.content)
    setActiveHolding(item.id, item.content)
  }, [deleteMode, releaseHold, setActiveHolding])

  const handleHoldPointerDown = (e: React.PointerEvent, item: GridItem) => {
    if (!isHoldButton(item) || e.button !== 0 || deleteMode) return
    e.preventDefault()
    e.stopPropagation()
    pressHold(item)
      .then(() => showToast(`按下：${item.title}`))
      .catch((error) => {
        showToast('长按失败')
        console.error(error)
      })
  }

  const handleHoldPointerUp = (e: React.PointerEvent, item: GridItem) => {
    if (!isHoldButton(item) || holdingIdRef.current !== item.id) return
    e.preventDefault()
    e.stopPropagation()
    releaseHold(item.id)
      .then(() => showToast(`释放：${item.title}`))
      .catch((error) => {
        showToast('释放失败')
        console.error(error)
      })
  }

  useEffect(() => {
    const activeId = holdingIdRef.current
    if (activeId && !config.items.some(item => item.id === activeId)) {
      releaseHold(activeId).catch(console.error)
    }
  }, [config.items, releaseHold])

  // 应用退出时释放长按
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (heldContentRef.current) {
        window.api.holdUp(heldContentRef.current)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // ======================== 窗口操作 ========================
  const handleMinimize = () => window.api.minimize()
  const handleClose = () => window.api.close()

  const handleAlwaysOnTop = async () => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    await window.api.setAlwaysOnTop(next)
  }

  const handleCollapse = async () => {
    const next = !collapsed
    setCollapsed(next)
    await window.api.collapse(next)
  }

  const handleSizeCycle = () => {
    const sizes: CardSize[] = ['small', 'medium', 'large']
    const idx = sizes.indexOf(config.grid.cardSize)
    const next = sizes[(idx + 1) % sizes.length]
    saveConfig({ ...config, grid: { ...config.grid, cardSize: next } })
  }

  // ======================== 右键菜单 ========================
  const showAddMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const items = [
      { label: '添加链接', icon: menuIcons.link, onClick: addLinkItem },
      { label: '添加文件夹', icon: menuIcons.folder, onClick: addFolderItem },
      { label: '添加文本按钮', icon: menuIcons.text, onClick: () => addButtonItem('text') },
      { label: '添加快捷键按钮', icon: menuIcons.shortcut, onClick: () => addButtonItem('shortcut') },
      { label: '添加长按按钮', icon: menuIcons.hold, onClick: () => addButtonItem('hold') },
      { label: '添加定时按钮', icon: menuIcons.timer, onClick: () => addButtonItem('timer') },
      { label: '添加 To-Do List', icon: menuIcons.todo, onClick: addTodoItem },
      { divider: true },
      { label: '批量删除', icon: menuIcons.delete, danger: true, onClick: startBatchDelete },
      { label: '清空面板', icon: menuIcons.delete, danger: true, onClick: clearAllItems },
    ]
    setContextMenu({ x: e.clientX, y: e.clientY, items })
  }

  const showCardMenu = (e: React.MouseEvent, item: GridItem) => {
    e.preventDefault()
    e.stopPropagation()
    const items: any[] = []

    if (item.type === 'link') {
      items.push({ label: '编辑', icon: menuIcons.edit, onClick: () => editLinkItem(item) })
    } else if (item.type === 'folder') {
      items.push({ label: '编辑', icon: menuIcons.edit, onClick: () => editFolderItem(item) })
    } else if (item.type === 'button') {
      items.push({ label: '编辑', icon: menuIcons.edit, onClick: () => editButtonItem(item) })
    } else if (item.type === 'todo') {
      items.push({ label: '打开待办', icon: menuIcons.todo, onClick: () => openTodoPanel(item) })
      items.push({ label: '重命名', icon: menuIcons.edit, onClick: () => renameTodoItem(item) })
    }

    items.push({ divider: true })
    items.push({ label: '铺到桌面', icon: menuIcons.pin, onClick: () => pinToDesktop(item.id) })
    items.push({ divider: true })
    items.push({ label: '删除', icon: menuIcons.delete, danger: true, onClick: () => deleteItem(item.id) })

    setContextMenu({ x: e.clientX, y: e.clientY, items })
  }

  // ======================== CRUD 操作 ========================
  const openDialog = async <T,>(payload: any) => {
    const result = await window.api.openDialog(payload)
    return result ? result as T : null
  }

  const addLinkItem = async () => {
    const result = await openDialog<{ title: string; url: string }>({ dialogType: 'link' })
    if (!result) return
    addItem({ id: genId('link'), type: 'link', title: result.title, url: result.url, sortOrder: config.items.length })
  }

  const editLinkItem = async (item: Extract<GridItem, { type: 'link' }>) => {
    const result = await openDialog<{ title: string; url: string }>({ dialogType: 'link', item: { title: item.title, url: item.url } })
    if (!result) return
    updateItem(item.id, result as any)
  }

  const addFolderItem = async () => {
    const result = await openDialog<{ title: string; links: LinkRef[] }>({ dialogType: 'folder' })
    if (!result) return
    addItem({ id: genId('folder'), type: 'folder', title: result.title, links: result.links, sortOrder: config.items.length })
  }

  const editFolderItem = async (item: Extract<GridItem, { type: 'folder' }>) => {
    const result = await openDialog<{ title: string; links: LinkRef[] }>({ dialogType: 'folder', item: { title: item.title, links: item.links } })
    if (!result) return
    updateItem(item.id, result as any)
  }

  const addTodoItem = async () => {
    const result = await openDialog<{ title: string }>({ dialogType: 'todoName' })
    if (!result) return
    addItem({ id: genId('todo'), type: 'todo', title: result.title, groups: [], sortOrder: config.items.length })
  }

  const renameTodoItem = async (item: Extract<GridItem, { type: 'todo' }>) => {
    const result = await openDialog<{ title: string }>({ dialogType: 'todoName', item: { title: item.title } })
    if (!result) return
    updateItem(item.id, { title: result.title } as any)
  }

  const openTodoPanel = async (item: Extract<GridItem, { type: 'todo' }>) => {
    const result = await openDialog<{ groups: TodoGroup[] }>({ dialogType: 'todoPanel', item })
    if (!result) return
    updateItem(item.id, { groups: result.groups } as any)
  }

  const openButtonEditor = async (payload: { buttonType?: ButtonType; item?: { title: string; buttonType: ButtonType; content: string; autoEnter?: boolean } }) => {
    return openDialog<{ title: string; buttonType: ButtonType; content: string; autoEnter: boolean }>({ dialogType: 'button', ...payload })
  }

  const addButtonItem = async (buttonType: ButtonType) => {
    const result = await openButtonEditor({ buttonType })
    if (!result) return
    addItem({ id: genId('btn'), type: 'button', ...result, sortOrder: config.items.length })
  }

  const editButtonItem = async (item: Extract<GridItem, { type: 'button' }>) => {
    const result = await openButtonEditor({
      item: {
        title: item.title,
        buttonType: item.buttonType,
        content: item.content,
        autoEnter: item.autoEnter,
      },
    })
    if (!result) return
    updateItem(item.id, result as any)
  }

  const pinToDesktop = async (id: string, position?: { x: number; y: number }) => {
    try {
      await window.api.createFloating(id, position)
      showToast('已铺到桌面')
    } catch (e) {
      showToast('铺到桌面失败')
      console.error(e)
    }
  }

  const addItem = (item: GridItem) => {
    const newConfig = {
      ...config,
      items: [...config.items, { ...item, sortOrder: config.items.length }],
    }
    saveConfig(newConfig)
    showToast(`已添加：${item.title}`)
  }

  const updateItem = (id: string, updates: Partial<GridItem>) => {
    const newConfig = {
      ...config,
      items: config.items.map(it => it.id === id ? { ...it, ...updates } as GridItem : it),
    }
    saveConfig(newConfig)
  }

  const startBatchDelete = () => {
    if (config.items.length === 0) {
      showToast('面板已经是空的')
      return
    }
    setDeleteMode(true)
    setSelectedIds([])
    showToast('请选择要删除的项目')
  }

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id])
  }

  const cancelBatchDelete = () => {
    setDeleteMode(false)
    setSelectedIds([])
  }

  const deleteSelectedItems = () => {
    if (selectedIds.length === 0) {
      showToast('请先选择项目')
      return
    }
    if (!confirm(`确定删除选中的 ${selectedIds.length} 个项目吗？`)) return
    const selectedSet = new Set(selectedIds)
    if (holdingIdRef.current && selectedSet.has(holdingIdRef.current)) {
      releaseHold(holdingIdRef.current).catch(console.error)
    }
    saveConfig({
      ...config,
      items: config.items.filter(item => !selectedSet.has(item.id)),
      floatingItems: config.floatingItems.filter(item => !selectedSet.has(item.itemId)),
    })
    cancelBatchDelete()
    showToast('已批量删除')
  }

  const deleteItem = (id: string) => {
    const item = config.items.find(it => it.id === id)
    if (!item) return
    if (!confirm(`确定删除「${item.title}」？`)) return
    if (holdingIdRef.current === id) {
      releaseHold(id).catch(console.error)
    }
    const newConfig = {
      ...config,
      items: config.items.filter(it => it.id !== id),
      floatingItems: config.floatingItems.filter(it => it.itemId !== id),
    }
    saveConfig(newConfig)
    showToast('已删除')
  }

  const clearAllItems = () => {
    if (config.items.length === 0) {
      showToast('面板已经是空的')
      return
    }
    if (!confirm(`确定删除当前面板的全部 ${config.items.length} 个项目吗？`)) return
    if (holdingIdRef.current) {
      releaseHold(holdingIdRef.current).catch(console.error)
    }
    saveConfig({ ...config, items: [], floatingItems: [] })
    showToast('已清空面板')
  }

  // ======================== 卡片点击处理 ========================
  const handleCardClick = async (item: GridItem) => {
    if (deleteMode) {
      toggleSelected(item.id)
      return
    }
    if (isHoldButton(item)) return

    try {
      if (item.type === 'link') {
        await window.api.openLink(item.url)
        showToast(`打开：${item.title}`)
      } else if (item.type === 'folder') {
        const urls = item.links.map(l => l.url)
        if (urls.length === 0) {
          showToast('文件夹为空')
          return
        }
        showToast(`正在打开 ${urls.length} 个链接...`)
        await window.api.openBatch(urls)
      } else if (item.type === 'button') {
        await handleButtonAction(item)
      } else if (item.type === 'todo') {
        await openTodoPanel(item)
      }
    } catch (e) {
      showToast('操作失败')
      console.error(e)
    }
  }

  const runTimerButton = (item: Extract<GridItem, { type: 'button' }>) => {
    const [mode, hhRaw, mmRaw, ssRaw, action = 'click'] = item.content.split('|')
    const hh = Number(hhRaw) || 0
    const mm = Number(mmRaw) || 0
    const ss = Number(ssRaw) || 0
    let delay = 0

    if (mode === 'countdown') {
      delay = ((hh * 60 * 60) + (mm * 60) + ss) * 1000
    } else if (mode === 'time') {
      const target = new Date()
      target.setHours(hh, mm, ss, 0)
      if (target.getTime() < Date.now()) target.setDate(target.getDate() + 1)
      delay = target.getTime() - Date.now()
    } else {
      showToast('定时配置错误')
      return
    }

    if (!Number.isFinite(delay) || delay <= 0) {
      showToast('定时配置错误')
      return
    }

    const endAt = Date.now() + delay
    setTimerEnds(prev => ({ ...prev, [item.id]: endAt }))
    showToast(`已设置：${item.title}`)
    window.setTimeout(() => {
      setTimerEnds(prev => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      if (action === 'doubleClick') window.api.doubleClick()
      else window.api.click()
    }, delay)
  }

  const handleButtonAction = async (item: Extract<GridItem, { type: 'button' }>) => {
    if (item.buttonType === 'text') {
      await window.api.sendText(item.content, item.autoEnter ?? config.settings.autoEnterAfterText)
      showToast(`已发送：${item.title}`)
    } else if (item.buttonType === 'shortcut') {
      await window.api.pressShortcut(item.content)
      showToast(`执行：${item.content}`)
    } else if (item.buttonType === 'timer') {
      runTimerButton(item)
    }
  }

  // ======================== 拖拽排序 ========================
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    const { x, y } = lastPointer.current
    const outsideWindow = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight

    if (outsideWindow) {
      pinToDesktop(String(active.id), { x: window.screenX + x, y: window.screenY + y })
      return
    }

    if (!over || active.id === over.id) return
    const oldIndex = config.items.findIndex(it => it.id === active.id)
    const newIndex = config.items.findIndex(it => it.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const newItems = arrayMove(config.items, oldIndex, newIndex)
    saveConfig({ ...config, items: newItems.map((it, i) => ({ ...it, sortOrder: i })) })
  }

  // ======================== 导入导出 ========================
  const handleExport = async () => {
    const toExport = { ...config, window: { ...config.window, collapsed, alwaysOnTop } }
    const ok = await window.api.exportConfig(toExport)
    showToast(ok ? '导出成功' : '已取消')
  }

  const handleImport = async () => {
    const imported = await window.api.importConfig()
    if (!imported) {
      showToast('导入取消')
      return
    }
    if (!imported.items) {
      showToast('配置格式错误')
      return
    }
    if (holdingIdRef.current) {
      releaseHold(holdingIdRef.current).catch(console.error)
    }
    // 询问合并还是替换
    const replace = confirm('点击"确定"替换全部配置，点击"取消"合并到现有配置')
    if (replace) {
      const merged = { ...DEFAULT_CONFIG, ...imported }
      merged.grid = { ...DEFAULT_CONFIG.grid, ...(imported.grid || {}) }
      merged.window = { ...DEFAULT_CONFIG.window, ...(imported.window || {}) }
      merged.settings = { ...DEFAULT_CONFIG.settings, ...(imported.settings || {}) }
      merged.items = imported.items || []
      merged.floatingItems = imported.floatingItems || []
      setConfig(merged)
      saveConfig(merged)
      showToast('配置已替换')
    } else {
      const existingIds = new Set(config.items.map(it => it.id))
      const newItems = imported.items.filter((it: GridItem) => !existingIds.has(it.id))
      const merged = { ...config, items: [...config.items, ...newItems] }
      saveConfig(merged)
      showToast(`已合并 ${newItems.length} 项`)
    }
  }

  // ======================== 渲染 ========================
  if (isDialogMode) {
    return (
      <div className="dialog-window-page">
        {dialogPayload?.dialogType === 'link' && (
          <LinkDialog
            item={dialogPayload.item ? { id: 'dialog-link', title: dialogPayload.item.title, url: dialogPayload.item.url } : undefined}
            onClose={() => window.api.cancelDialog()}
            onSave={(title, url) => window.api.submitDialog({ title, url })}
          />
        )}
        {dialogPayload?.dialogType === 'folder' && (
          <FolderDialog
            title={dialogPayload.item?.title}
            links={dialogPayload.item?.links}
            onClose={() => window.api.cancelDialog()}
            onSave={(title, links) => window.api.submitDialog({ title, links })}
          />
        )}
        {dialogPayload?.dialogType === 'button' && (
          <ButtonDialog
            item={dialogPayload.item}
            defaultButtonType={dialogPayload.buttonType}
            onClose={() => window.api.cancelDialog()}
            onSave={(title, buttonType: ButtonType, content, autoEnter) => window.api.submitDialog({ title, buttonType, content, autoEnter })}
          />
        )}
        {dialogPayload?.dialogType === 'todoName' && (
          <TodoNameDialog
            name={dialogPayload.item?.title}
            onClose={() => window.api.cancelDialog()}
            onSave={(title) => window.api.submitDialog({ title })}
          />
        )}
        {dialogPayload?.dialogType === 'todoPanel' && dialogPayload.item && (
          <TodoPanelDialog
            item={dialogPayload.item}
            onClose={() => window.api.cancelDialog()}
            onSave={(groups: TodoGroup[]) => window.api.submitDialog({ groups })}
          />
        )}
      </div>
    )
  }

  if (!loaded) {
    return <div className="app"><div className="empty-state">加载中...</div></div>
  }

  if (isFloatingMode && floatingId) {
    return (
      <FloatingItemView
        config={config}
        floatingId={floatingId}
        onConfigChange={saveConfig}
        onClose={() => window.api.closeFloating(floatingId)}
      />
    )
  }

  const sortedItems = [...config.items].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className={`app size-${config.grid.cardSize} ${collapsed ? 'collapsed' : ''}`}>
      <TopBar
        cardSize={config.grid.cardSize}
        alwaysOnTop={alwaysOnTop}
        collapsed={collapsed}
        onSizeCycle={handleSizeCycle}
        onImport={handleImport}
        onExport={handleExport}
        onAlwaysOnTop={handleAlwaysOnTop}
        onCollapse={handleCollapse}
        onMinimize={handleMinimize}
        onClose={handleClose}
      />

      {!collapsed && (
        <div className="grid-area" onContextMenu={showAddMenu}>
          {deleteMode && (
            <div className="batch-bar">
              <span>已选择 {selectedIds.length} 项</span>
              <button className="btn btn-primary" onClick={deleteSelectedItems}>删除选中</button>
              <button className="btn" onClick={cancelBatchDelete}>取消</button>
            </div>
          )}
          {sortedItems.length === 0 ? (
            <div className="empty-state" onContextMenu={showAddMenu}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>Empty</div>
              <div>右键空白处添加项目</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>链接 / 文件夹 / 按钮 / 待办</div>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sortedItems.map(it => it.id)} strategy={rectSortingStrategy}>
                <div className="grid">
                  {sortedItems.map(item => (
                    <div key={item.id} className="selectable-card-wrap">
                      {deleteMode && <div className={`select-check ${selectedIds.includes(item.id) ? 'checked' : ''}`}>{selectedIds.includes(item.id) && '✓'}</div>}
                      <SortableCard
                        item={item}
                        isHolding={holdingId === item.id}
                        timerRemaining={timerEnds[item.id] ? Math.max(0, Math.ceil((timerEnds[item.id] - nowTick) / 1000)) : undefined}
                        onClick={() => handleCardClick(item)}
                        onContextMenu={(e) => showCardMenu(e, item)}
                        onPointerDown={(e) => handleHoldPointerDown(e, item)}
                        onPointerUp={(e) => handleHoldPointerUp(e, item)}
                        onPointerLeave={(e) => handleHoldPointerUp(e, item)}
                        onPointerCancel={(e) => handleHoldPointerUp(e, item)}
                      />
                    </div>
                  ))}
                  {!deleteMode && <EmptyCard onClick={addLinkItem} />}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}