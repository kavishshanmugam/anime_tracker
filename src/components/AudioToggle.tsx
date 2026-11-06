import { useEffect, useState } from 'react'

export type Audio = 'sub' | 'dub'

/** Sub | Dub segmented switch. */
export default function AudioToggle({ value, onChange }: { value: Audio; onChange: (a: Audio) => void }) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-[4px] border border-border text-xs font-bold uppercase" title="Applies to every episode of this show">
      {(['sub', 'dub'] as const).map(a => (
        <button key={a} onClick={() => onChange(a)}
          className={`px-3 py-1.5 transition-colors ${value === a ? 'bg-accent text-white' : 'bg-bg-0 text-text-3 hover:text-text-1'}`}>
          {a}
        </button>
      ))}
    </div>
  )
}

/** Per-show Sub/Dub choice, defaulting to the Settings preference. */
export function useShowAudio(animeId: number | null | undefined): [Audio, (a: Audio) => void] {
  const [audio, setAudio] = useState<Audio>('sub')
  useEffect(() => {
    if (!animeId || !window.api) return
    Promise.all([window.api.db.getAppState(`audio_show_${animeId}`), window.api.db.getAppState('audio_pref')])
      .then(([show, def]) => setAudio((show ?? def) === 'dub' ? 'dub' : 'sub'))
      .catch(() => {})
  }, [animeId])
  const change = (a: Audio) => {
    setAudio(a)
    if (animeId) window.api?.db.setAppState(`audio_show_${animeId}`, a).catch(() => {})
  }
  return [audio, change]
}
