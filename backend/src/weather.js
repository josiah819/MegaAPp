// Open-Meteo current + daily forecast for the property. No API key needed.
// 30-minute cache; stale data is preferred over an outage.

let cache = { at: 0, data: null }

const WMO = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Rime fog'], 51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'],
  55: ['🌧️', 'Heavy drizzle'], 61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'], 85: ['🌨️', 'Snow showers'],
  86: ['🌨️', 'Snow showers'], 95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Storm + hail'], 99: ['⛈️', 'Storm + hail'],
}
export const wmo = code => WMO[code] || ['🌡️', '—']

export async function getWeather(lat = 45.2492, lon = -79.617) {
  if (cache.data && Date.now() - cache.at < 30 * 60 * 1000) return cache.data
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&forecast_days=4&timezone=auto`
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 5000)
    const res = await fetch(url, { signal: ctl.signal })
    clearTimeout(t)
    if (!res.ok) throw new Error(`open-meteo ${res.status}`)
    const j = await res.json()
    const [icon, label] = wmo(j.current?.weather_code)
    const data = {
      current: {
        temp: Math.round(j.current?.temperature_2m),
        feels: Math.round(j.current?.apparent_temperature),
        wind: Math.round(j.current?.wind_speed_10m),
        code: j.current?.weather_code, icon, label,
      },
      daily: (j.daily?.time || []).map((d, i) => {
        const [dicon, dlabel] = wmo(j.daily.weather_code[i])
        return {
          date: d, icon: dicon, label: dlabel,
          max: Math.round(j.daily.temperature_2m_max[i]),
          min: Math.round(j.daily.temperature_2m_min[i]),
          precip: j.daily.precipitation_probability_max[i],
        }
      }),
      fetched_at: new Date().toISOString(),
    }
    cache = { at: Date.now(), data }
    return data
  } catch (e) {
    console.error('weather fetch failed:', e.message)
    return cache.data // stale beats nothing
  }
}
