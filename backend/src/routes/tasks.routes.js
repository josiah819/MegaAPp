import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, notify } from '../lib.js'

export const router = Router()
router.use(requirePerm('tasks.view'))

router.get('/', ah(async (req, res) => {
  const [statuses, phases, tasks] = await Promise.all([
    rows(`SELECT * FROM task_statuses ORDER BY ord`),
    rows(`SELECT * FROM phases ORDER BY ord`),
    rows(`SELECT t.*, l.name AS location_name, b.code AS booking_code, tk.code AS ticket_code,
            (SELECT COUNT(*)::int FROM tasks c WHERE c.parent_id = t.id) AS sub_count,
            (SELECT COUNT(*)::int FROM tasks c JOIN task_statuses cs ON cs.id = c.status_id
             WHERE c.parent_id = t.id AND cs.kind = 'done') AS sub_done
          FROM tasks t LEFT JOIN locations l ON l.id = t.location_id
          LEFT JOIN bookings b ON b.id = t.booking_id LEFT JOIN tickets tk ON tk.id = t.ticket_id
          ORDER BY t.ord, t.created_at`),
  ])
  res.json({ statuses, phases, tasks })
}))

router.post('/', requirePerm('tasks.edit'), ah(async (req, res) => {
  const { title, notes = '', status_id, priority = 1, phase_id, location_id, booking_id, ticket_id, due, tags = [], checklist = [], assignees = [], blocked_by = [], parent_id } = req.body || {}
  if (!title) throw httpError(400, 'The task needs a title')
  let sid = status_id
  if (!sid) {
    const first = await one(`SELECT id FROM task_statuses ORDER BY ord LIMIT 1`)
    sid = first?.id
  }
  if (parent_id) {
    const parent = await one(`SELECT id, parent_id FROM tasks WHERE id = $1`, [Number(parent_id)])
    if (!parent) throw httpError(404, 'Parent task not found')
    if (parent.parent_id) throw httpError(400, 'Sub-tasks of sub-tasks get lost — nest one level deep')
  }
  const max = await one(`SELECT COALESCE(MAX(ord),0)+1 AS o FROM tasks WHERE status_id = $1`, [sid])
  const t = await one(
    `INSERT INTO tasks (title, notes, status_id, priority, phase_id, location_id, booking_id, ticket_id, due, tags, checklist, ord, assignees, blocked_by, parent_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [title, notes, sid, priority, phase_id || null, location_id || null, booking_id || null, ticket_id || null,
      due || null, tags, JSON.stringify(checklist), max.o, assignees,
      (blocked_by || []).map(Number).filter(Boolean), parent_id ? Number(parent_id) : null, req.user.id])
  for (const uid of assignees.filter(u => u !== req.user.id)) {
    notify(uid, { icon: '✅', title: `New task: ${title}`, link: '/tasks' })
  }
  await audit(req.user, 'task.create', 'task', t.id, { title })
  res.status(201).json(t)
}))

router.patch('/:id', requirePerm('tasks.edit'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const b = req.body || {}
  const existing = await one(`SELECT * FROM tasks WHERE id = $1`, [id])
  if (!existing) throw httpError(404, 'Task not found')

  let completedAt
  if (b.status_id && b.status_id !== existing.status_id) {
    const s = await one(`SELECT kind FROM task_statuses WHERE id = $1`, [b.status_id])
    completedAt = s?.kind === 'done' ? new Date() : null
  }
  const t = await one(
    `UPDATE tasks SET
       title = COALESCE($2,title), notes = COALESCE($3,notes), status_id = COALESCE($4,status_id),
       priority = COALESCE($5,priority), phase_id = $6, location_id = $7, booking_id = $8,
       due = $9, tags = COALESCE($10,tags), checklist = COALESCE($11,checklist),
       ord = COALESCE($12,ord), assignees = COALESCE($13,assignees), updated_at = now(),
       completed_at = CASE WHEN $14 THEN $15 ELSE completed_at END,
       blocked_by = COALESCE($16, blocked_by)
     WHERE id = $1 RETURNING *`,
    [id, b.title, b.notes, b.status_id, b.priority,
      'phase_id' in b ? (b.phase_id || null) : existing.phase_id,
      'location_id' in b ? (b.location_id || null) : existing.location_id,
      'booking_id' in b ? (b.booking_id || null) : existing.booking_id,
      'due' in b ? (b.due || null) : existing.due,
      b.tags, b.checklist ? JSON.stringify(b.checklist) : null, b.ord, b.assignees,
      completedAt !== undefined, completedAt ?? null,
      b.blocked_by ? b.blocked_by.map(Number).filter(n => n && n !== id) : null])
  if (b.status_id && completedAt) await audit(req.user, 'task.complete', 'task', id, { title: t.title })
  res.json(t)
}))

router.delete('/:id', requirePerm('tasks.edit'), ah(async (req, res) => {
  const t = await one(`DELETE FROM tasks WHERE id = $1 RETURNING title`, [Number(req.params.id)])
  if (!t) throw httpError(404, 'Task not found')
  await audit(req.user, 'task.delete', 'task', req.params.id, t)
  res.json({ ok: true })
}))

// Workflow management
router.post('/statuses', requirePerm('tasks.manage'), ah(async (req, res) => {
  const { name, color = 'lake', kind = 'open' } = req.body || {}
  if (!name) throw httpError(400, 'The column needs a name')
  const max = await one(`SELECT COALESCE(MAX(ord),0)+1 AS o FROM task_statuses`)
  res.status(201).json(await one(
    `INSERT INTO task_statuses (name, color, kind, ord) VALUES ($1,$2,$3,$4) RETURNING *`, [name, color, kind, max.o]))
}))
router.patch('/statuses/:id', requirePerm('tasks.manage'), ah(async (req, res) => {
  const { name, color, kind, ord } = req.body || {}
  const s = await one(
    `UPDATE task_statuses SET name = COALESCE($2,name), color = COALESCE($3,color),
       kind = COALESCE($4,kind), ord = COALESCE($5,ord) WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name, color, kind, ord])
  if (!s) throw httpError(404, 'Column not found')
  res.json(s)
}))
router.delete('/statuses/:id', requirePerm('tasks.manage'), ah(async (req, res) => {
  const id = Number(req.params.id)
  const inUse = await one(`SELECT COUNT(*)::int AS n FROM tasks WHERE status_id = $1`, [id])
  if (inUse.n > 0) throw httpError(400, `Move the ${inUse.n} task(s) in this column first`)
  await q(`DELETE FROM task_statuses WHERE id = $1`, [id])
  res.json({ ok: true })
}))

router.post('/phases', requirePerm('tasks.manage'), ah(async (req, res) => {
  const { name, color = 'pine', starts, ends } = req.body || {}
  if (!name) throw httpError(400, 'The phase needs a name')
  const max = await one(`SELECT COALESCE(MAX(ord),0)+1 AS o FROM phases`)
  res.status(201).json(await one(
    `INSERT INTO phases (name, color, starts, ends, ord) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, color, starts || null, ends || null, max.o]))
}))
router.patch('/phases/:id', requirePerm('tasks.manage'), ah(async (req, res) => {
  const { name, color, starts, ends } = req.body || {}
  const p = await one(
    `UPDATE phases SET name = COALESCE($2,name), color = COALESCE($3,color),
       starts = COALESCE($4,starts), ends = COALESCE($5,ends) WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name, color, starts, ends])
  if (!p) throw httpError(404, 'Phase not found')
  res.json(p)
}))
router.delete('/phases/:id', requirePerm('tasks.manage'), ah(async (req, res) => {
  await q(`UPDATE tasks SET phase_id = NULL WHERE phase_id = $1`, [Number(req.params.id)])
  await q(`DELETE FROM phases WHERE id = $1`, [Number(req.params.id)])
  res.json({ ok: true })
}))

// ---- templates: reusable checklists stamped onto the board (Equinox gap) ----
router.get('/templates', requirePerm('tasks.templates'), ah(async (req, res) => {
  res.json(await rows(`SELECT t.*, u.name AS created_by_name FROM task_templates t
    LEFT JOIN users u ON u.id = t.created_by ORDER BY t.name`))
}))

router.post('/templates', requirePerm('tasks.templates'), ah(async (req, res) => {
  const { name, descr = '', items = [] } = req.body || {}
  if (!name) throw httpError(400, 'The template needs a name')
  if (!Array.isArray(items) || !items.length) throw httpError(400, 'Add at least one task to the template')
  const t = await one(
    `INSERT INTO task_templates (name, descr, items, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, descr, JSON.stringify(items), req.user.id])
  await audit(req.user, 'template.create', 'task', t.id, { name })
  res.status(201).json(t)
}))

router.patch('/templates/:id', requirePerm('tasks.templates'), ah(async (req, res) => {
  const { name, descr, items } = req.body || {}
  const t = await one(
    `UPDATE task_templates SET name = COALESCE($2,name), descr = COALESCE($3,descr), items = COALESCE($4,items)
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name, descr, items ? JSON.stringify(items) : null])
  if (!t) throw httpError(404, 'Template not found')
  res.json(t)
}))

router.delete('/templates/:id', requirePerm('tasks.templates'), ah(async (req, res) => {
  await q(`DELETE FROM task_templates WHERE id = $1`, [Number(req.params.id)])
  res.json({ ok: true })
}))

// Stamp the template onto the board. Each item's offset_days counts from the
// chosen start date; everything lands in the first (open) column.
router.post('/templates/:id/apply', requirePerm('tasks.templates'), ah(async (req, res) => {
  const tpl = await one(`SELECT * FROM task_templates WHERE id = $1`, [Number(req.params.id)])
  if (!tpl) throw httpError(404, 'Template not found')
  const { phase_id, location_id, start_date } = req.body || {}
  const first = await one(`SELECT id FROM task_statuses ORDER BY ord LIMIT 1`)
  const base = start_date || null
  let ord = (await one(`SELECT COALESCE(MAX(ord),0)+1 AS o FROM tasks`)).o
  const made = []
  for (const it of tpl.items || []) {
    const due = base && Number.isFinite(Number(it.offset_days))
      ? (() => { const d = new Date(`${base}T12:00:00`); d.setDate(d.getDate() + Number(it.offset_days)); return d.toISOString().slice(0, 10) })()
      : null
    made.push(await one(
      `INSERT INTO tasks (title, notes, status_id, priority, phase_id, location_id, due, tags, checklist, ord, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, title`,
      [it.title, it.notes || '', first?.id, Math.min(3, Math.max(0, Number(it.priority) || 1)),
        phase_id || null, location_id || null, due, it.tags || [],
        JSON.stringify(it.checklist || []), ord++, req.user.id]))
  }
  await audit(req.user, 'template.apply', 'task', tpl.id, { name: tpl.name, created: made.length })
  res.status(201).json({ created: made.length, tasks: made })
}))
