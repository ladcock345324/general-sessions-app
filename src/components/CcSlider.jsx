import { ccSliderColor } from '../ccFile'
import styles from './CcSlider.module.css'

// The CC "ripe date" progress bar. A DISPLAY, not an input — nothing here is
// draggable or focusable. `pct` is 0–100 (see ccWaitingInfo in ccFile.js); the
// fill colour comes from the CC_SLIDER_STOPS ramp in that same file.
// `compact` is the thin client-list version.
export default function CcSlider({ pct, compact = false }) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0))
  const color = ccSliderColor(p)
  return (
    <div
      className={`${styles.track}${compact ? ` ${styles.compact}` : ''}`}
      role="img"
      aria-label={`${Math.round(p)}% of the way to the ripe date`}
    >
      <div className={styles.fill} style={{ width: `${p}%`, background: color }} />
      <div className={styles.knob} style={{ left: `${p}%`, background: color }} />
    </div>
  )
}
