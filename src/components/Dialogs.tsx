import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { X, Plus, Trash2, Type, Keyboard, CircleDot, Timer } from 'lucide-react'
import type { GridItem, ButtonType, LinkRef, TodoGroup, TodoEntry } from '../types'
import { genId, validateUrl } from '../types'

interface DialogShellProps {
  title: string
  onClose: () => void
  onSave?: () => void
  children: React.ReactNode
  saveLabel?: string
  className?: string
  hideFooter?: boolean
}

function DialogShell({ title, onClose, onSave, children, saveLabel = '保存', className = '', hideFooter = false }: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    let frame = 0
    const fitWindow = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        window.api.resizeCurrentWindow(Math.ceil(dialog.scrollHeight + 28))
      })
    }

    fitWindow()
    const observer = new ResizeObserver(fitWindow)
    observer.observe(dialog)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div ref={dialogRef} className={`dialog ${className}`} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} style={{ width: 26, height: 26 }}>
            <X size={14} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {!hideFooter && (
          <div className="dialog-footer">
            <button className="btn" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={onSave!}>{saveLabel}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ======================== 链接对话框 ========================
interface LinkDialogProps {
  item?: LinkRef
  onClose: () => void
  onSave: (title: string, url: string) => void
}

export function LinkDialog({ item, onClose, onSave }: LinkDialogProps) {
  const [title, setTitle] = useState(item?.title || '')
  const [url, setUrl] = useState(item?.url || '')
  const [error, setError] = useState('')

  const handleSave = () => {
    if (!title.trim()) return setError('请输入名称')
    if (!validateUrl(url)) return setError('链接需以 http:// 或 https:// 开头')
    onSave(title.trim(), url.trim())
  }

  return (
    <DialogShell title={item ? '编辑链接' : '添加链接'} onClose={onClose} onSave={handleSave}>
      <div>
        <div className="form-label">名称</div>
        <input className="form-input" value={title} onChange={(e) => { setTitle(e.target.value); setError('') }}
          placeholder="例如：GitHub" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleSave()} />
      </div>
      <div>
        <div className="form-label">链接</div>
        <input className="form-input" value={url} onChange={(e) => { setUrl(e.target.value); setError('') }}
          placeholder="https://example.com" onKeyDown={(e) => e.key === 'Enter' && handleSave()} />
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
    </DialogShell>
  )
}

// ======================== 文件夹对话框 ========================
interface FolderDialogProps {
  title?: string
  links?: LinkRef[]
  onClose: () => void
  onSave: (title: string, links: LinkRef[]) => void
}

export function FolderDialog({ title, links, onClose, onSave }: FolderDialogProps) {
  const [name, setName] = useState(title || '')
  const [items, setItems] = useState<LinkRef[]>(links ? [...links] : [{ id: genId('l'), title: '', url: '' }])

  const updateLink = (id: string, field: 'title' | 'url', val: string) => {
    setItems(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l))
  }
  const addLink = () => setItems(prev => [...prev, { id: genId('l'), title: '', url: '' }])
  const removeLink = (id: string) => setItems(prev => prev.filter(l => l.id !== id))

  const handleSave = () => {
    const valid = items.filter(l => l.title.trim() && validateUrl(l.url))
    if (!name.trim()) return
    onSave(name.trim(), valid)
  }

  return (
    <DialogShell title={title ? '编辑文件夹' : '添加文件夹'} onClose={onClose} onSave={handleSave}>
      <div>
        <div className="form-label">文件夹名称</div>
        <input className="form-input" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="例如：开发工具" autoFocus />
      </div>
      <div>
        <div className="form-label">链接列表</div>
        <div className="link-list-editor">
          {items.map((link, i) => (
            <div key={link.id} className="link-row">
              <input placeholder="名称" value={link.title} onChange={(e) => updateLink(link.id, 'title', e.target.value)} />
              <input placeholder="https://..." value={link.url} onChange={(e) => updateLink(link.id, 'url', e.target.value)} />
              <button className="icon-btn" onClick={() => removeLink(link.id)} style={{ width: 26, height: 26 }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button className="todo-add-btn" onClick={addLink}>
            <Plus size={14} /> 添加链接
          </button>
        </div>
      </div>
    </DialogShell>
  )
}

// ======================== 按钮对话框 ========================
interface ButtonDialogProps {
  item?: { title: string; buttonType: ButtonType; content: string; autoEnter?: boolean }
  defaultButtonType?: ButtonType
  onClose: () => void
  onSave: (title: string, buttonType: ButtonType, content: string, autoEnter: boolean) => void
}

export function ButtonDialog({ item, defaultButtonType, onClose, onSave }: ButtonDialogProps) {
  const [title, setTitle] = useState(item?.title || '')
  const [buttonType, setButtonType] = useState<ButtonType>(item?.buttonType || defaultButtonType || 'text')
  const [content, setContent] = useState(item?.content || '')
  const [autoEnter, setAutoEnter] = useState(item?.autoEnter ?? true)
  const [timerMode, setTimerMode] = useState<'countdown' | 'time'>(item?.content?.startsWith('time|') ? 'time' : 'countdown')
  const timerParts = item?.content?.split('|') || []
  const [timerHour, setTimerHour] = useState(timerParts[1] || '0')
  const [timerMinute, setTimerMinute] = useState(timerParts[2] || '0')
  const [timerSecond, setTimerSecond] = useState(timerParts[3] || (item?.content ? '0' : '10'))
  const [timerAction, setTimerAction] = useState<'click' | 'doubleClick'>(() => item?.content?.includes('doubleClick') ? 'doubleClick' : 'click')
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const recordRef = useRef<((e: KeyboardEvent) => void) | null>(null)

  const startRecording = () => {
    setRecording(true)
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        stopRecording()
        return
      }
      const parts: string[] = []
      if (e.ctrlKey) parts.push('ctrl')
      if (e.shiftKey) parts.push('shift')
      if (e.altKey) parts.push('alt')
      if (e.metaKey) parts.push('win')
      const key = e.key.toLowerCase()
      if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
        parts.push(key)
        setContent(parts.join('+'))
        stopRecording()
      }
    }
    recordRef.current = handler
    window.addEventListener('keydown', handler, true)
  }

  const stopRecording = () => {
    setRecording(false)
    if (recordRef.current) {
      window.removeEventListener('keydown', recordRef.current, true)
      recordRef.current = null
    }
  }

  useEffect(() => {
    return () => stopRecording()
  }, [])

  const handleSave = () => {
    if (!title.trim()) return setError('请输入按钮名称')
    if (buttonType === 'timer') {
      const h = Math.max(0, Number(timerHour) || 0)
      const m = Math.max(0, Number(timerMinute) || 0)
      const s = Math.max(0, Number(timerSecond) || 0)
      if (timerMode === 'countdown' && h === 0 && m === 0 && s === 0) return setError('请输入倒计时时间')
      if (timerMode === 'time' && (h > 23 || m > 59 || s > 59)) return setError('指定时间格式不正确')
      if (timerMode === 'countdown' && (m > 59 || s > 59)) return setError('分钟和秒不能超过 59')
      const nextContent = `${timerMode}|${h}|${m}|${s}|${timerAction}`
      onSave(title.trim(), buttonType, nextContent, autoEnter)
      return
    }
    if (!content.trim()) return setError('请输入内容')
    onSave(title.trim(), buttonType, content.trim(), autoEnter)
  }

  return (
    <DialogShell title={item ? '编辑按钮' : '添加按钮'} className="button-dialog" onClose={onClose} onSave={handleSave}>
      <div>
        <div className="form-label">按钮名称</div>
        <input className="form-input" value={title} onChange={(e) => { setTitle(e.target.value); setError('') }}
          placeholder="例如：您好" autoFocus />
      </div>
      <div>
        <div className="form-label">类型</div>
        <div className="type-group">
          <button className={`type-btn ${buttonType === 'text' ? 'active' : ''}`} onClick={() => setButtonType('text')}>
            <Type size={18} strokeWidth={1.8} />
            <span>文本</span>
          </button>
          <button className={`type-btn ${buttonType === 'shortcut' ? 'active' : ''}`} onClick={() => setButtonType('shortcut')}>
            <Keyboard size={18} strokeWidth={1.8} />
            <span>快捷键</span>
          </button>
          <button className={`type-btn ${buttonType === 'hold' ? 'active' : ''}`} onClick={() => setButtonType('hold')}>
            <CircleDot size={18} strokeWidth={1.8} />
            <span>长按</span>
          </button>
          <button className={`type-btn ${buttonType === 'timer' ? 'active' : ''}`} onClick={() => setButtonType('timer')}>
            <Timer size={18} strokeWidth={1.8} />
            <span>定时</span>
          </button>
        </div>
      </div>
      <div>
        <div className="form-label">内容</div>
        {buttonType === 'text' ? (
          <>
            <textarea className="form-textarea" value={content} onChange={(e) => setContent(e.target.value)}
              placeholder="输入要发送的文本..." rows={4} />
            <label className="checkbox-row" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={autoEnter} onChange={(e) => setAutoEnter(e.target.checked)} />
              <span>发送后自动回车</span>
            </label>
          </>
        ) : buttonType === 'timer' ? (
          <div className="timer-config">
            <div>
              <div className="form-label">触发方式</div>
              <select className="form-input" value={timerMode} onChange={(e) => setTimerMode(e.target.value as 'countdown' | 'time')}>
                <option value="countdown">倒计时</option>
                <option value="time">指定时间</option>
              </select>
            </div>
            <div className="timer-hms">
              <div>
                <div className="form-label">时</div>
                <input className="form-input" type="number" min="0" max={timerMode === 'time' ? 23 : 99} value={timerHour} onChange={(e) => setTimerHour(e.target.value)} />
              </div>
              <div>
                <div className="form-label">分</div>
                <input className="form-input" type="number" min="0" max="59" value={timerMinute} onChange={(e) => setTimerMinute(e.target.value)} />
              </div>
              <div>
                <div className="form-label">秒</div>
                <input className="form-input" type="number" min="0" max="59" value={timerSecond} onChange={(e) => setTimerSecond(e.target.value)} />
              </div>
            </div>
            <div>
              <div className="form-label">动作</div>
              <select className="form-input" value={timerAction} onChange={(e) => setTimerAction(e.target.value as 'click' | 'doubleClick')}>
                <option value="click">单击</option>
                <option value="doubleClick">双击</option>
              </select>
            </div>
          </div>
        ) : (
          <>
            <div className={`shortcut-recorder ${recording ? 'recording' : ''}`} onClick={recording ? stopRecording : startRecording}>
              {recording ? '按下组合键... (Esc 取消)' : content ? (
                <span className="shortcut-display">{content}</span>
              ) : '点击此处录制快捷键'}
            </div>
            <div className="form-label" style={{ marginTop: 8 }}>或手动输入</div>
            <input className="form-input" value={content} onChange={(e) => setContent(e.target.value)}
              placeholder="ctrl+alt+a" />
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
              格式: ctrl+shift+a, alt+f1, space 等
            </div>
          </>
        )}
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
    </DialogShell>
  )
}

// ======================== 待办命名对话框 ========================
interface TodoNameDialogProps {
  name?: string
  onClose: () => void
  onSave: (name: string) => void
}

export function TodoNameDialog({ name, onClose, onSave }: TodoNameDialogProps) {
  const [title, setTitle] = useState(name || '')
  const handleSave = () => {
    if (!title.trim()) return
    onSave(title.trim())
  }
  return (
    <DialogShell title={name ? '重命名' : '添加 To-Do List'} onClose={onClose} onSave={handleSave}>
      <div>
        <div className="form-label">名称</div>
        <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：工作待办" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleSave()} />
      </div>
    </DialogShell>
  )
}

// ======================== 待办面板对话框 ========================
interface TodoPanelProps {
  item: Extract<GridItem, { type: 'todo' }>
  onClose: () => void
  onChange: (groups: TodoGroup[]) => void
}

export function TodoPanelDialog({ item, onClose, onChange }: TodoPanelProps) {
  const [groups, setGroups] = useState<TodoGroup[]>(item.groups.length > 0 ? JSON.parse(JSON.stringify(item.groups)) : [{ id: genId('g'), name: '默认分组', todos: [] }])
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null)
  const firstRender = useRef(true)

  // 实时保存：groups 变化时立即同步到主配置
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    onChange(groups)
  }, [groups])

  const addGroup = () => {
    const id = genId('g')
    setGroups(prev => [...prev, { id, name: '新建分组', todos: [] }])
    setEditingGroupId(id)
  }

  const deleteGroup = (gid: string) => {
    if (confirm('确定删除该分组？')) {
      setGroups(prev => prev.filter(g => g.id !== gid))
    }
  }

  const renameGroup = (gid: string, name: string) => {
    setGroups(prev => prev.map(g => g.id === gid ? { ...g, name } : g))
    setEditingGroupId(null)
  }

  const addTodoAndEdit = (gid: string) => {
    const tid = genId('t')
    setGroups(prev => prev.map(g => g.id === gid ? { ...g, todos: [...g.todos, { id: tid, text: '', completed: false }] } : g))
    setEditingTodoId(tid)
  }

  const deleteTodo = (gid: string, tid: string) => {
    setGroups(prev => prev.map(g => g.id === gid ? { ...g, todos: g.todos.filter(t => t.id !== tid) } : g))
  }

  const toggleTodo = (gid: string, tid: string) => {
    setGroups(prev => prev.map(g => g.id === gid ? { ...g, todos: g.todos.map(t => t.id === tid ? { ...t, completed: !t.completed } : t) } : g))
  }

  // 保存待办文本：空内容自动删除，避免遗留空条目
  const saveTodo = (gid: string, tid: string, text: string) => {
    const trimmed = text.trim()
    setGroups(prev => prev.map(g => g.id === gid
      ? { ...g, todos: trimmed
        ? g.todos.map(t => t.id === tid ? { ...t, text: trimmed } : t)
        : g.todos.filter(t => t.id !== tid) }
      : g))
    setEditingTodoId(null)
  }

  return (
    <DialogShell title={item.title} className="todo-panel" onClose={onClose} hideFooter>
      <div className="todo-groups">
        {groups.map(group => (
          <div key={group.id} className="todo-group">
            <div className="todo-group-header">
              {editingGroupId === group.id ? (
                <input className="todo-group-title-input" defaultValue={group.name}
                  autoFocus onBlur={(e) => renameGroup(group.id, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingGroupId(null) }} />
              ) : (
                <span className="todo-group-title" onDoubleClick={() => setEditingGroupId(group.id)}>{group.name}</span>
              )}
              <div className="todo-group-actions">
                <button className="icon-btn" onClick={() => deleteGroup(group.id)} style={{ width: 24, height: 24 }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            {group.todos.map(todo => (
              <div
                key={todo.id}
                tabIndex={0}
                className={`todo-entry ${todo.completed ? 'completed' : ''}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTodoAndEdit(group.id)
                  }
                }}
              >
                <div className={`todo-checkbox ${todo.completed ? 'checked' : ''}`} onClick={() => toggleTodo(group.id, todo.id)}>
                  {todo.completed && '✓'}
                </div>
                {editingTodoId === todo.id ? (
                  <input className="todo-text-input" defaultValue={todo.text}
                    autoFocus onBlur={(e) => saveTodo(group.id, todo.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); saveTodo(group.id, todo.id, (e.target as HTMLInputElement).value) }
                      if (e.key === 'Escape') setEditingTodoId(null)
                    }} />
                ) : (
                  <span className="todo-text" onDoubleClick={() => setEditingTodoId(todo.id)}>{todo.text}</span>
                )}
                <div className="todo-entry-actions">
                  <button className="icon-btn" onClick={() => deleteTodo(group.id, todo.id)} style={{ width: 22, height: 22 }}>
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
            <div className="todo-add-btn" onClick={() => addTodoAndEdit(group.id)}>
              <Plus size={12} /> 添加待办
            </div>
          </div>
        ))}
        <div className="todo-add-btn" onClick={addGroup}>
          <Plus size={14} /> 新建分组
        </div>
      </div>
    </DialogShell>
  )
}
