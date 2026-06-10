import styles from './TextViewerDrawer.module.css'

export default function TextViewerDrawer({ isOpen, onClose, label, text }) {
  return (
    <>
      <div
        className={`${styles.overlay} ${isOpen ? styles.overlayVisible : ''}`}
        onClick={onClose}
      />
      <div className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ''}`}>
        <div className={styles.handle} />
        <div className={styles.header}>
          <span className={styles.label}>{label}</span>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <div className={styles.body}>
          {text ? (
            <p className={styles.text}>{text}</p>
          ) : (
            <div className={styles.empty}>No text extracted for this document.</div>
          )}
        </div>
      </div>
    </>
  )
}
