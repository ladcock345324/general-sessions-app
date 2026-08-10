/**
 * Same-incident bracket grouping, shared by the client list (ClientRow) and the
 * single-client header case mini-list (ClientFile).
 *
 * Both of those lists are FLAT — every incident's cases are concatenated and
 * then sorted purely on the numeric part of the case number, with incident not
 * part of the sort at all. Two cases from one incident are therefore NOT
 * guaranteed to land next to each other: incident A holding GS1000 and GS3000
 * while incident B holds GS2000 sorts to A, B, A.
 *
 * A bracket is only ever drawn when EVERY case of an incident occupies
 * consecutive positions. A split group gets no bracket at all, rather than one
 * that would appear to capture the neighbouring incident's case. Sort order is
 * never modified to force grouping.
 *
 * Deliberately a shared module rather than a per-file copy (the convention most
 * small helpers in this app follow): this guard is the thing standing between a
 * correct bracket and one that silently misstates which cases share an
 * incident, and two copies of it would be free to drift apart.
 *
 * @param {Array<{id: string, incident_id: string}>} cases — already in display order
 * @returns {Array<{bracket: boolean, items: Array}>} consecutive blocks
 */
export function bracketBlocks(cases) {
  const positions = new Map()
  cases.forEach((c, i) => {
    const list = positions.get(c.incident_id) ?? []
    list.push(i)
    positions.set(c.incident_id, list)
  })

  const runStarts = new Map()
  for (const idxs of positions.values()) {
    if (idxs.length < 2) continue
    if (!idxs.every((v, k) => k === 0 || v === idxs[k - 1] + 1)) continue
    runStarts.set(idxs[0], idxs.length)
  }

  const blocks = []
  for (let i = 0; i < cases.length;) {
    const len = runStarts.get(i)
    if (len) {
      blocks.push({ bracket: true, items: cases.slice(i, i + len) })
      i += len
    } else {
      blocks.push({ bracket: false, items: [cases[i]] })
      i += 1
    }
  }
  return blocks
}
