import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { MapPin, X } from 'lucide-react'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import { PageHead, Card } from '../components/ui.jsx'
import { pageAnim, SPRING } from '../motion.js'

export default function MapPage() {
  const { can } = useApp()
  const nav = useNavigate()
  const [locations, setLocations] = useState([])
  const [picked, setPicked] = useState(null)

  useEffect(() => {
    if (can('locations.view')) api.get('/locations').then(setLocations).catch(() => {})
  }, []) // eslint-disable-line

  useEffect(() => {
    const onMsg = e => {
      if (e.data?.type !== 'mw-map-select') return
      const match = locations.find(l => l.map_ref && l.map_ref === e.data.id)
      setPicked({ name: e.data.name, location: match })
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [locations])

  return (
    <motion.div {...pageAnim}>
      <PageHead kicker="Property" title="3D Map"
        sub="The whole property, modelled from real survey data — drag to orbit, click any building." />
      <Card className="overflow-hidden relative">
        <iframe src="/map3d/index.html" title="Muskoka Woods virtual property map"
          className="w-full h-[64vh] lg:h-[calc(100dvh-280px)] min-h-[440px] block border-0" />
        <AnimatePresence>
          {picked?.location && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              transition={SPRING}
              className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 pl-3.5 pr-1.5 py-1.5 rounded-full bg-brand-deep text-white shadow-pop">
              <MapPin size={13} className="text-green" />
              <span className="text-[12.5px] font-head font-semibold whitespace-nowrap">{picked.name}</span>
              <button onClick={() => nav(`/locations?focus=${picked.location.id}`)}
                className="px-2.5 py-1 rounded-full bg-green text-[#16321c] text-[11.5px] font-head font-bold whitespace-nowrap">
                Open in Locations
              </button>
              <button onClick={() => setPicked(null)} className="p-1 text-white/60 hover:text-white"><X size={13} /></button>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}
