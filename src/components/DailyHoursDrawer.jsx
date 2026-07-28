import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../localDB'
import { toDateInput, fromDateInput, formatDateDisplay, pickerHandlers, todayString, dateKey, shiftDate } from '../dateUtils'
import styles from './DailyHoursDrawer.module.css'

// Equivalent of ClientList.jsx's byLastName — not imported to avoid a
// component→page circular import (ClientList renders this drawer).
const byLastName = (a, b) => a.last_name.localeCompare(b.last_name)

// Same tiebreak used by useClientFile.js so a client's entries appear in the
// exact order they're displayed in on that client's own Hours section.
function sortEntries(a, b) {
  const sa = a.sort_order ?? 0
  const sb = b.sort_order ?? 0
  if (sa !== sb) return sa - sb
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function mostRecentHoursDate(hours) {
  let best = null
  let bestKey = -Infinity
  for (const h of hours) {
    const k = dateKey(h.entry_date)
    if (k > bestKey) { bestKey = k; best = h.entry_date }
  }
  return best
}

// Read-only, cross-client view of every hours entry logged on a given day.
// Never writes to Dexie or Supabase — no edit/delete/reorder controls here.
export default function DailyHoursDrawer({ isOpen, onClose }) {
  const data = useLiveQuery(async () => {
    const [hours, clients] = await Promise.all([db.hours.toArray(), db.clients.toArray()])
    return { hours, clients }
  }, [])

  const [selectedDate, setSelectedDate] = useState(null)
  const wasOpenRef = useRef(false)

  // On each fresh open, forget the prior date so the effect below recomputes
  // "most recent day with entries" rather than reusing whatever was last shown.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) setSelectedDate(null)
    wasOpenRef.current = isOpen
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || selectedDate !== null || data === undefined) return
    setSelectedDate(mostRecentHoursDate(data.hours) ?? todayString())
  }, [isOpen, selectedDate, data])

  const allHours = data?.hours ?? []
  const clientById = new Map((data?.clients ?? []).map(c => [c.id, c]))

  const entriesForDate = selectedDate == null
    ? []
    : allHours.filter(h => dateKey(h.entry_date) === dateKey(selectedDate))

  const groupsByClient = new Map()
  for (const h of entriesForDate) {
    const list = groupsByClient.get(h.client_id) ?? []
    list.push(h)
    groupsByClient.set(h.client_id, list)
  }
  const groups = [...groupsByClient.entries()]
    .map(([clientId, entries]) => ({
      client: clientById.get(clientId) ?? null,
      entries: [...entries].sort(sortEntries),
    }))
    .filter(g => g.client)
    .sort((a, b) => byLastName(a.client, b.client))

  const grandTotal = entriesForDate.reduce((sum, e) => sum + Number(e.hours), 0)

  return (
    <>
      <div
        className={`${styles.overlay} ${isOpen ? styles.overlayVisible : ''}`}
        onClick={onClose}
      />
      <div className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ''}`}>
        <div className={styles.handle} />
        <div className={styles.header}>
          <div className={styles.dateNav}>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => setSelectedDate(d => shiftDate(d, -1))}
              disabled={selectedDate == null}
            >
              ‹
            </button>
            <div className={styles.dateWrap}>
              <span className={styles.dateText}>
                {selectedDate == null ? '—' : formatDateDisplay(selectedDate)}
              </span>
              <input
                type="date"
                className={styles.dateInputHidden}
                value={toDateInput(selectedDate)}
                onChange={e => setSelectedDate(fromDateInput(e.target.value))}
                {...pickerHandlers()}
              />
            </div>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => setSelectedDate(d => shiftDate(d, 1))}
              disabled={selectedDate == null}
            >
              ›
            </button>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {groups.length > 0 && (
            <div className={styles.grandTotal}>
              <span>Total for the day</span>
              <span className={styles.hoursValue}>
                {grandTotal % 1 === 0 ? grandTotal : grandTotal.toFixed(1)}
              </span>
            </div>
          )}

          {groups.length === 0 ? (
            <div className={styles.empty}>
              No hours logged for {selectedDate == null ? 'this date' : formatDateDisplay(selectedDate)}.
            </div>
          ) : (
            groups.map(({ client, entries }) => {
              const clientTotal = entries.reduce((sum, e) => sum + Number(e.hours), 0)
              return (
                <div key={client.id} className={styles.clientGroup}>
                  <div className={styles.clientName}>{client.last_name}, {client.first_name}</div>
                  {entries.map(entry => (
                    <div key={entry.id} className={styles.entryRow}>
                      <span className={styles.entryDescription}>{entry.description}</span>
                      <span className={styles.hoursValue}>{entry.hours}</span>
                    </div>
                  ))}
                  <div className={styles.hoursTotal}>
                    <span>Subtotal</span>
                    <span className={styles.hoursValue}>
                      {clientTotal % 1 === 0 ? clientTotal : clientTotal.toFixed(1)}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
