import { Link, Folder, Type, Keyboard, CircleDot, ListTodo, Download, Upload, Pencil, Trash2, Pin, Timer, Bell } from 'lucide-react'

interface MenuItem {
  label: string
  icon?: React.ReactNode
  onClick?: () => void
  danger?: boolean
  divider?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  // 防止超出窗口边界
  const maxX = window.innerWidth - 180
  const maxY = window.innerHeight - items.length * 32 - 20
  const px = Math.min(x, maxX)
  const py = Math.min(y, maxY)

  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="context-menu" style={{ left: px, top: py }} onClick={(e) => e.stopPropagation()}>
        {items.map((item, i) => (
          item.divider ? (
            <div key={i} className="context-menu-divider" />
          ) : (
            <div
              key={i}
              className={`context-menu-item ${item.danger ? 'danger' : ''}`}
              onClick={() => { item.onClick?.(); onClose() }}
            >
              {item.icon}
              <span>{item.label}</span>
            </div>
          )
        ))}
      </div>
    </>
  )
}

// 预设菜单图标
export const menuIcons = {
  link: <Link size={14} strokeWidth={1.8} />,
  folder: <Folder size={14} strokeWidth={1.8} />,
  text: <Type size={14} strokeWidth={1.8} />,
  shortcut: <Keyboard size={14} strokeWidth={1.8} />,
  hold: <CircleDot size={14} strokeWidth={1.8} />,
  timer: <Timer size={14} strokeWidth={1.8} />,
  todo: <ListTodo size={14} strokeWidth={1.8} />,
  reminder: <Bell size={14} strokeWidth={1.8} />,
  import: <Download size={14} strokeWidth={1.8} />,
  export: <Upload size={14} strokeWidth={1.8} />,
  edit: <Pencil size={14} strokeWidth={1.8} />,
  pin: <Pin size={14} strokeWidth={1.8} />,
  delete: <Trash2 size={14} strokeWidth={1.8} />,
}
