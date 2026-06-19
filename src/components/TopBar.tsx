import { Grid2X2, Download, Upload, Pin, PinOff, ChevronUp, ChevronDown, Minus, X } from 'lucide-react'
import type { CardSize } from '../types'

interface Props {
  cardSize: CardSize
  alwaysOnTop: boolean
  collapsed: boolean
  onSizeCycle: () => void
  onImport: () => void
  onExport: () => void
  onAlwaysOnTop: () => void
  onCollapse: () => void
  onMinimize: () => void
  onClose: () => void
}

export default function TopBar(props: Props) {
  const sizeLabel = props.cardSize === 'small' ? '小' : props.cardSize === 'medium' ? '中' : '大'
  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-title">快捷工具</span>
      </div>
      <div className="topbar-right">
        <button className="icon-btn" title={`尺寸：${sizeLabel}`} onClick={props.onSizeCycle}>
          <Grid2X2 size={16} strokeWidth={1.8} />
        </button>
        <button className="icon-btn" title="导入" onClick={props.onImport}>
          <Download size={16} strokeWidth={1.8} />
        </button>
        <button className="icon-btn" title="导出" onClick={props.onExport}>
          <Upload size={16} strokeWidth={1.8} />
        </button>
        <button className={`icon-btn ${props.alwaysOnTop ? 'active' : ''}`} title={props.alwaysOnTop ? '取消置顶' : '置顶'} onClick={props.onAlwaysOnTop}>
          {props.alwaysOnTop ? <PinOff size={16} strokeWidth={1.8} /> : <Pin size={16} strokeWidth={1.8} />}
        </button>
        <button className="icon-btn" title={props.collapsed ? '展开' : '折叠'} onClick={props.onCollapse}>
          {props.collapsed ? <ChevronDown size={16} strokeWidth={1.8} /> : <ChevronUp size={16} strokeWidth={1.8} />}
        </button>
        <button className="icon-btn" title="最小化" onClick={props.onMinimize}>
          <Minus size={16} strokeWidth={1.8} />
        </button>
        <button className="icon-btn" title="关闭" onClick={props.onClose}>
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  )
}
