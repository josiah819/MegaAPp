import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Printer } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card, Btn, PageLoader, EmptyState, Select } from '../components/ui.jsx'
import { pageAnim } from '../motion.js'

/* Per-location QR posters — the FTF kiosk pattern. Each poster deep-links the
   public report form with the location preselected, so a guest in Cedarwood
   scans and types one sentence. Print on letter paper, 4 per page. */

function QrSvg({ url }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
  }, [url])
  return <span className="block w-full aspect-square [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />
}

export default function QrPosters() {
  const nav = useNavigate()
  const { settings } = useApp()
  const [reportPath, setReportPath] = useState(null)
  const [locations, setLocations] = useState(null)
  const [zone, setZone] = useState('')

  useEffect(() => {
    api.get('/admin/links').then(l => setReportPath(l.report || '')).catch(() => setReportPath(''))
    api.get('/locations').then(setLocations).catch(() => setLocations([]))
  }, [])

  if (reportPath === null || locations === null) return <PageLoader />
  if (!reportPath) {
    return <EmptyState icon="🔗" title="No guest report link" body="You need the tickets permission that exposes the public report link." />
  }

  const zones = [...new Set(locations.map(l => l.zone).filter(Boolean))].sort()
  const show = locations.filter(l => l.active !== false && (!zone || l.zone === zone))
  const orgName = settings.org?.name || 'Muskoka Woods'

  return (
    <motion.div {...pageAnim}>
      <div className="print:hidden">
        <button onClick={() => nav('/tickets')} className="flex items-center gap-1.5 text-[12.5px] font-head font-bold text-dim hover:text-ink transition mb-4">
          <ArrowLeft size={14} /> Facilities
        </button>
        <PageHead kicker="Facilities" title="QR posters"
          sub="One poster per location. Guests scan, the form opens with the location already chosen, and a private chat link comes back."
          actions={
            <div className="flex gap-2 items-center">
              <Select value={zone} onChange={setZone} className="!w-auto min-w-[140px]">
                <option value="">Every zone</option>
                {zones.map(z => <option key={z} value={z}>{z}</option>)}
              </Select>
              <Btn onClick={() => window.print()}><Printer size={15} /> Print {show.length}</Btn>
            </div>
          } />
      </div>

      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 gap-4 print:grid-cols-2 print:gap-6">
        {show.map(l => {
          const url = `${location.origin}${reportPath}?loc=${l.id}`
          return (
            <Card key={l.id} className="p-6 text-center print:break-inside-avoid print:shadow-none print:border print:border-line">
              <div className="text-[10.5px] font-head font-bold uppercase tracking-[0.22em] text-faint">{orgName}</div>
              <div className="font-head font-bold text-[18px] text-ink mt-1 leading-tight">{l.name}</div>
              {l.zone && <div className="text-[11.5px] text-dim">{l.zone}</div>}
              <div className="max-w-[180px] mx-auto my-4">
                <QrSvg url={url} />
              </div>
              <div className="font-head font-bold text-[13px] text-ink">Spot something broken?</div>
              <p className="text-[11.5px] text-dim mt-0.5 leading-snug">
                Scan to tell our team in 30 seconds — you’ll get a private link to follow along and chat.
              </p>
            </Card>
          )
        })}
      </div>
    </motion.div>
  )
}
