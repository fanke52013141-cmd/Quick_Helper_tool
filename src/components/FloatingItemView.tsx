import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import Card from './Card'
import type { AppConfig, GridItem } from '../types'

interface Props {
  config: AppConfig
  floatingId: string
  onConfigChange: (config: AppConfig) => void
  onClose: () => void
}

interface DragGesture {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  originX: number
  originY: number
  ready: boolean
  armed: boolean
  dragging: boolean
}

function isHoldButton(item: GridItem | null): item is Extract<GridItem, { type: 'button' }> {
  return !!item && item.type === 'button' && item.buttonType === 'hold'
}

export default function FloatingItemView({ config, floatingId, onConfigChange, onClose }: Props) {
  const [holding, setHolding] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [timerEnd, setTimerEnd] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState(Date.now())
  const [dragging, setDragging] = useState(false)
  const holdingRef = useRef(false)
  const heldContentRef = useRef<string | null>(null)
  const holdPendingRef = useRef<Promise<void> | null>(null)
  const dragGestureRef = useRef<DragGesture | null>(null)
  const dragTimerRef = useRef<number | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const pendingPositionRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)
  const floating = config.floatingItems.find(item => item.id === floatingId)
  const item = floating ? config.items.find(it => it.id === floating.itemId) : null

  useEffect(() => {
    if (!item || item.type !== 'todo') return
    if (collapsed) {
      window.api.resizeCurrentWindow(44)
      return
    }
    const todoCount = item.groups.reduce((sum, group) => sum + group.todos.length, 0)
    const nextHeight = Math.min(620, Math.max(120, 56 + item.groups.length * 44 + todoCount * 28))
    window.api.resizeCurrentWindow(nextHeight)
  }, [collapsed, item])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      if (dragTimerRef.current) clearTimeout(dragTimerRef.current)
      if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current)
      if (holdingRef.current && heldContentRef.current) {
        window.api.holdUp(heldContentRef.current)
        holdingRef.current = false
        heldContentRef.current = null
      }
    }
  }, [])

  const releaseHold = async () => {
    if (!holdingRef.current || !heldContentRef.current) return
    const keys = heldContentRef.current
    const pendingHold = holdPendingRef.current
    if (pendingHold) {
      try { await pendingHold } catch {}
    }
    holdingRef.current = false
    heldContentRef.current = null
    setHolding(false)
    await window.api.holdUp(keys)
  }

  const pressHold = async () => {
    if (!isHoldButton(item) || holdingRef.current) return
    holdingRef.current = true
    heldContentRef.current = item.content
    setHolding(true)

    const pendingHold = window.api.holdDown(item.content)
    holdPendingRef.current = pendingHold
    try {
      await pendingHold
    } catch (error) {
      holdingRef.current = false
      heldContentRef.current = null
      setHolding(false)
      throw error
    } finally {
      if (holdPendingRef.current === pendingHold) holdPendingRef.current = null
    }
  }

  const clearGestureTimers = () => {
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current)
    dragTimerRef.current = null
  }

  const handleFloatingPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return

    const gesture: DragGesture = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      originX: 0,
      originY: 0,
      ready: false,
      armed: false,
      dragging: false,
    }
    dragGestureRef.current = gesture
    suppressClickRef.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)

    window.api.getBounds().then(bounds => {
      if (dragGestureRef.current !== gesture || !bounds) return
      gesture.originX = bounds.x || 0
      gesture.originY = bounds.y || 0
      gesture.ready = true
    })

    dragTimerRef.current = window.setTimeout(() => {
      if (dragGestureRef.current === gesture) gesture.armed = true
    }, 260)

  }

  const handleFloatingPointerMove = (event: React.PointerEvent) => {
    const gesture = dragGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.lastX = event.screenX
    gesture.lastY = event.screenY
    if (!gesture.ready || !gesture.armed) return

    const deltaX = event.screenX - gesture.startX
    const deltaY = event.screenY - gesture.startY
    if (!gesture.dragging && Math.hypot(deltaX, deltaY) < 4) return

    event.preventDefault()
    if (!gesture.dragging) {
      gesture.dragging = true
      suppressClickRef.current = true
      setDragging(true)
      if (holdingRef.current) releaseHold().catch(console.error)
    }

    pendingPositionRef.current = {
      x: gesture.originX + deltaX,
      y: gesture.originY + deltaY,
    }
    if (!dragFrameRef.current) {
      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = null
        const position = pendingPositionRef.current
        if (position) window.api.moveCurrentWindow(position.x, position.y)
      })
    }
  }

  const finishFloatingGesture = (event: React.PointerEvent, cancelled = false) => {
    const gesture = dragGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    clearGestureTimers()
    dragGestureRef.current = null
    try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch {}

    if (gesture.dragging) {
      setDragging(false)
      const position = pendingPositionRef.current
      if (position) window.api.moveCurrentWindow(position.x, position.y)
      window.setTimeout(() => { suppressClickRef.current = false }, 0)
      if (holdingRef.current) releaseHold().catch(console.error)
      return
    }

    if (cancelled && holdingRef.current) releaseHold().catch(console.error)
  }

  const runItem = async () => {
    if (!item) return
    if (isHoldButton(item)) {
      if (holdingRef.current) await releaseHold()
      await pressHold()
      window.setTimeout(() => {
        if (holdingRef.current) releaseHold().catch(console.error)
      }, 800)
      return
    }
    if (item.type === 'link') {
      await window.api.openLink(item.url)
    } else if (item.type === 'folder') {
      await window.api.openBatch(item.links.map(link => link.url))
    } else if (item.type === 'button') {
      if (item.buttonType === 'text') {
        await window.api.sendText(item.content, item.autoEnter ?? config.settings.autoEnterAfterText)
      } else if (item.buttonType === 'shortcut') {
        await window.api.pressShortcut(item.content)
      } else if (item.buttonType === 'timer') {
        const [mode, hhRaw, mmRaw, ssRaw, action = 'click'] = item.content.split('|')
        const hh = Number(hhRaw) || 0
        const mm = Number(mmRaw) || 0
        const ss = Number(ssRaw) || 0
        let delay = 0
        if (mode === 'countdown') delay = ((hh * 60 * 60) + (mm * 60) + ss) * 1000
        else if (mode === 'time') {
          const target = new Date()
          target.setHours(hh, mm, ss, 0)
          if (target.getTime() < Date.now()) target.setDate(target.getDate() + 1)
          delay = target.getTime() - Date.now()
        }
        if (delay > 0) {
          const endAt = Date.now() + delay
          setTimerEnd(endAt)
          window.setTimeout(() => {
            setTimerEnd(null)
            action === 'doubleClick' ? window.api.doubleClick() : window.api.click()
          }, delay)
        }
      }
    }
  }

  const handleFloatingClick = () => {
    if (suppressClickRef.current) return
    runItem().catch(console.error)
  }

  const toggleTodo = (groupId: string, todoId: string) => {
    if (!item || item.type !== 'todo') return
    const nextItems = config.items.map(it => {
      if (it.id !== item.id || it.type !== 'todo') return it
      return {
        ...it,
        groups: it.groups.map(group => group.id === groupId ? {
          ...group,
          todos: group.todos.map(todo => todo.id === todoId ? { ...todo, completed: !todo.completed } : todo),
        } : group),
      }
    })
    onConfigChange({ ...config, items: nextItems })
  }

  if (!floating || !item) {
    return (
      <div className="floating-shell floating-card-shell">
        <div className="floating-titlebar compact">
          <span className="floating-title">内容不存在</span>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
      </div>
    )
  }

  if (item.type !== 'todo') {
    return (
      <div className={`floating-card-shell ${dragging ? 'dragging' : ''}`}>
        <button className="floating-card-close" title="关闭悬浮" onClick={onClose}><X size={12} /></button>
        <Card
          item={item}
          isHolding={holding}
          timerRemaining={timerEnd ? Math.max(0, Math.ceil((timerEnd - nowTick) / 1000)) : undefined}
          onClick={handleFloatingClick}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={handleFloatingPointerDown}
          onPointerMove={handleFloatingPointerMove}
          onPointerUp={(event) => finishFloatingGesture(event)}
          onPointerCancel={(event) => finishFloatingGesture(event, true)}
        />
      </div>
    )
  }

  return (
    <div className={`floating-shell floating-todo-shell ${collapsed ? 'collapsed' : ''}`}>
      <div className="floating-titlebar compact">
        <span className="floating-title">{item.title}</span>
        <button className="icon-btn" title={collapsed ? '展开' : '折叠'} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button className="icon-btn" title="关闭悬浮" onClick={onClose}><X size={14} /></button>
      </div>
      {!collapsed && (
        <div className="floating-body todo-fit-body">
          <div className="todo-groups floating-todo-groups">
            {item.groups.map(group => (
              <div key={group.id} className="todo-group">
                <div className="todo-group-header">
                  <span className="todo-group-title">{group.name}</span>
                </div>
                {group.todos.map(todo => (
                  <div key={todo.id} className={`todo-entry ${todo.completed ? 'completed' : ''}`}>
                    <div className={`todo-checkbox ${todo.completed ? 'checked' : ''}`} onClick={() => toggleTodo(group.id, todo.id)}>
                      {todo.completed && '✓'}
                    </div>
                    <span className="todo-text">{todo.text}</span>
                  </div>
                ))}
                {group.todos.length === 0 && <div className="floating-muted">暂无待办</div>}
              </div>
            ))}
            {item.groups.length === 0 && <div className="empty-state">暂无待办分组</div>}
          </div>
        </div>
      )}
    </div>
  )
}
