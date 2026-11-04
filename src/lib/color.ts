// ponytail: simple canvas-based dominant color extraction, upgrade to MMCQ if quality matters
const cache = new Map<string, string>()

export async function extractDominantColor(imageUrl: string): Promise<string> {
  const cached = cache.get(imageUrl)
  if (cached) return cached

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 10
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data

        let bestColor = '#7E7BF2' // fallback to accent
        let bestSat = 0

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2]
          const max = Math.max(r, g, b), min = Math.min(r, g, b)
          const sat = max === 0 ? 0 : (max - min) / max
          const brightness = max / 255

          // prefer saturated, non-dark, non-white colors
          if (sat > 0.15 && brightness > 0.15 && brightness < 0.9 && sat > bestSat) {
            bestSat = sat
            bestColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
          }
        }

        cache.set(imageUrl, bestColor)
        resolve(bestColor)
      } catch {
        resolve('#7E7BF2')
      }
    }
    img.onerror = () => resolve('#7E7BF2')
    img.src = imageUrl
  })
}
