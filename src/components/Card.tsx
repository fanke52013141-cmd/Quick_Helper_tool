import { Link, Folder, Type, Keyboard, CircleDot, ListTodo, Plus, Timer, Bell } from 'lucide-react'
import type { GridItem } from '../types'

interface Props {
  item: GridItem
  isHolding: boolean
  timerRemaining?: number
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  onPointerLeave?: (e: React.PointerEvent) => void
  onPointerCancel?: (e: React.PointerEvent) => void
}

function formatTimer(seconds: number) {
  const safeSeconds = Math.max(0, Math.ceil(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const secs = safeSeconds % 60
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function getTimerSeconds(item: GridItem) {
  if (item.type !== 'button' || item.buttonType !== 'timer') return null
  const [mode, hhRaw, mmRaw, ssRaw] = item.content.split('|')
  if (mode !== 'countdown') return null
  const hh = Number(hhRaw) || 0
  const mm = Number(mmRaw) || 0
  const ss = Number(ssRaw) || 0
  const total = (hh * 60 * 60) + (mm * 60) + ss
  return total > 0 ? total : null
}

function getItemIcon(item: GridItem) {
  const size = 22
  const sw = 1.7
  switch (item.type) {
    case 'link': return <Link size={size} strokeWidth={sw} color="#2563EB" />
    case 'folder': return <Folder size={size} strokeWidth={sw} color="#D29B35" />
    case 'button':
      if (item.buttonType === 'text') return <Type size={size} strokeWidth={sw} color="#22C55E" />
      if (item.buttonType === 'shortcut') return <Keyboard size={size} strokeWidth={sw} color="#8B5CF6" />
      if (item.buttonType === 'hold') return <CircleDot size={size} strokeWidth={sw} color="#EF4444" />
      return <Timer size={size} strokeWidth={sw} color="#F59E0B" />
    case 'todo': return <ListTodo size={size} strokeWidth={sw} color="#06B6D4" />
    case 'reminder': return <Bell size={size} strokeWidth={sw} color="#EC4899" />
  }
}

function getItemVisualClass(item: GridItem) {
  if (item.type === 'button') return `button-${item.buttonType}`
  return item.type
}

export default function Card({
  item,
  isHolding,
  timerRemaining,
  onClick,
  onContextMenu,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
}: Props) {
  const configuredTimer = getTimerSeconds(item)
  const timerToShow = typeof timerRemaining === 'number' ? timerRemaining : configuredTimer

  return (
    <div
      className={`card card-${getItemVisualClass(item)} ${isHolding ? 'hold-active' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
      title={item.title}
    >
      {typeof timerToShow === 'number' && timerToShow > 99 && <div className="timer-dot" />}
      {typeof timerToShow === 'number' && timerToShow <= 99 && <div className="timer-count">{Math.max(0, timerToShow)}</div>}
      <div className={`card-icon card-icon-${getItemVisualClass(item)}`}>
        {getItemIcon(item)}
      </div>
      <div className="card-title">{item.title}</div>
      {typeof timerToShow === 'number' && <div className="timer-bottom">{formatTimer(timerToShow)}</div>}
    </div>
  )
}

// 空白格
export function EmptyCard({ onClick }: { onClick: () => void }) {
  return (
    <div className="card empty" onClick={onClick} title="添加链接">
      <div className="card-icon card-icon-empty"><Plus size={24} strokeWidth={1.8} /></div>
      <div className="card-title">添加</div>
    </div>
  )
}
