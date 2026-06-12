import pg from 'pg'

const { Pool } = pg

// DATE columns come back as plain 'YYYY-MM-DD' strings, not local-midnight
// Date objects — the whole app compares dates as ISO strings.
pg.types.setTypeParser(1082, v => v)

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
})

export const q = (text, params) => pool.query(text, params)

// One row or null
export async function one(text, params) {
  const r = await q(text, params)
  return r.rows[0] || null
}

export async function rows(text, params) {
  const r = await q(text, params)
  return r.rows
}

export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
