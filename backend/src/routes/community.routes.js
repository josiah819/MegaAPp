import { Router } from 'express'
import { q, one, rows } from '../db.js'
import { requirePerm } from '../auth.js'
import { ah, audit, httpError, todayISO, addDays } from '../lib.js'

export const router = Router()
router.use(requirePerm('community.view'))

router.get('/', ah(async (req, res) => {
  const [posts, events, birthdays] = await Promise.all([
    rows(`SELECT p.*, u.name AS author_name, u.color AS author_color,
            (SELECT COUNT(*)::int FROM post_comments c WHERE c.post_id = p.id) AS comment_count
          FROM posts p LEFT JOIN users u ON u.id = p.author_id
          ORDER BY p.pinned DESC, p.created_at DESC LIMIT 60`),
    rows(`SELECT * FROM events WHERE date >= $1 ORDER BY date LIMIT 12`, [todayISO()]),
    rows(`SELECT id, name, color, birthday FROM users
          WHERE active AND birthday IS NOT NULL
            AND to_char(birthday, 'MM-DD') BETWEEN to_char($1::date, 'MM-DD') AND to_char($1::date + 21, 'MM-DD')
          ORDER BY to_char(birthday, 'MM-DD') LIMIT 8`, [todayISO()]),
  ])
  res.json({
    posts: posts.map(p => p.anonymous ? { ...p, author_name: 'Someone at camp', author_id: null, author_color: '#7C8780' } : p),
    events, birthdays,
  })
}))

router.get('/:id/comments', ah(async (req, res) => {
  res.json(await rows(
    `SELECT c.*, u.name AS author_name, u.color AS author_color
     FROM post_comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.post_id = $1 ORDER BY c.created_at`, [Number(req.params.id)]))
}))

router.post('/', requirePerm('community.post'), ah(async (req, res) => {
  const { kind = 'post', title = '', body, anonymous = false } = req.body || {}
  if (!body || !String(body).trim()) throw httpError(400, 'Write something first')
  if (kind === 'announcement' && !req.user.perms['community.announce']) {
    throw httpError(403, 'Announcements need the “Announce” permission')
  }
  if (!['post', 'announcement', 'prayer', 'praise'].includes(kind)) throw httpError(400, 'Unknown post type')
  const p = await one(
    `INSERT INTO posts (kind, author_id, anonymous, title, body) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [kind, req.user.id, !!anonymous && kind !== 'announcement', title, String(body).trim()])
  await audit(req.user, 'post.create', 'post', p.id, { kind })
  res.status(201).json(p)
}))

router.post('/:id/react', ah(async (req, res) => {
  const { emoji } = req.body || {}
  if (!emoji) throw httpError(400, 'Pick an emoji')
  const p = await one(`SELECT reactions FROM posts WHERE id = $1`, [Number(req.params.id)])
  if (!p) throw httpError(404, 'Post not found')
  const reactions = p.reactions || {}
  const list = new Set(reactions[emoji] || [])
  list.has(req.user.id) ? list.delete(req.user.id) : list.add(req.user.id)
  reactions[emoji] = [...list]
  if (!reactions[emoji].length) delete reactions[emoji]
  res.json(await one(`UPDATE posts SET reactions = $2 WHERE id = $1 RETURNING id, reactions`,
    [Number(req.params.id), JSON.stringify(reactions)]))
}))

router.post('/:id/comments', requirePerm('community.post'), ah(async (req, res) => {
  const { body } = req.body || {}
  if (!body || !String(body).trim()) throw httpError(400, 'Write something first')
  const c = await one(
    `INSERT INTO post_comments (post_id, author_id, body) VALUES ($1,$2,$3) RETURNING *`,
    [Number(req.params.id), req.user.id, String(body).trim()])
  res.status(201).json(c)
}))

router.patch('/:id/pin', requirePerm('community.moderate'), ah(async (req, res) => {
  const p = await one(`UPDATE posts SET pinned = NOT pinned WHERE id = $1 RETURNING id, pinned`, [Number(req.params.id)])
  if (!p) throw httpError(404, 'Post not found')
  res.json(p)
}))

router.delete('/:id', ah(async (req, res) => {
  const p = await one(`SELECT author_id FROM posts WHERE id = $1`, [Number(req.params.id)])
  if (!p) throw httpError(404, 'Post not found')
  if (p.author_id !== req.user.id && !req.user.perms['community.moderate']) {
    throw httpError(403, 'Only moderators can remove other people’s posts')
  }
  await q(`DELETE FROM posts WHERE id = $1`, [Number(req.params.id)])
  await audit(req.user, 'post.delete', 'post', req.params.id)
  res.json({ ok: true })
}))

// Events
router.post('/events', requirePerm('community.announce'), ah(async (req, res) => {
  const { title, date, end_date, location = '', emoji = '🌲', descr = '' } = req.body || {}
  if (!title || !date) throw httpError(400, 'Title and date are required')
  res.status(201).json(await one(
    `INSERT INTO events (title, date, end_date, location, emoji, descr) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title, date, end_date || null, location, emoji, descr]))
}))
router.delete('/events/:id', requirePerm('community.announce'), ah(async (req, res) => {
  await q(`DELETE FROM events WHERE id = $1`, [Number(req.params.id)])
  res.json({ ok: true })
}))
