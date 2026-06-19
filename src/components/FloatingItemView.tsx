import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import Card from './Card'
import type { AppConfig, GridItem } from '../types'

interface Props {
  config: AppConfig
  floatingId: string
  onConfigChange: (config: AppConfig) => void
  onClose: () => void
}

export default function FloatingItemView({ config, floatingId, onConfigChange, onClose }: Props) {
  const [holding, setHolding] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [timerEnd, setTimerEnd] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState(Date.now())
  const floating = config.floatingItems.find(item => item.id === floatingId)
  const item = floating ? config.items.find(it => it.id === floating.itemId) : null

  useEffect(() => {
    if (!item || item.type !== 'todo') return
    if (collapsed) {
      window.api.resizeCurrentWindow(34)
      return
    }
    const todoCount = item.groups.reduce((sum, group) => sum + group.todos.length, 0)
    const nextHeight = Math.min(620, Math.max(110, 46 + item.groups.length * 44 + todoCount * 28))
    window.api.resizeCurrentWindow(nextHeight)
  }, [collapsed, item])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      if (holding && item?.type === 'button' && item.buttonType === 'hold') {
        window.api.holdUp(item.content)
      }
    }
  }, [holding, item])

  const runItem = async () => {
    if (!item) return
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
      } else if (holding) {
        await window.api.holdUp(item.content)
        setHolding(false)
      } else {
        await window.api.holdDown(item.content)
        setHolding(true)
      }
    }
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
      <div className="floating-card-shell">
        <button className="floating-card-close" title="关闭悬浮" onClick={onClose}><X size={12} /></button>
        <Card
          item={item}
          isHolding={holding}
          timerRemaining={timerEnd ? Math.max(0, Math.ceil((timerEnd - nowTick) / 1000)) : undefined}
          onClick={runItem}
          onContextMenu={(event) => event.preventDefault()}
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
