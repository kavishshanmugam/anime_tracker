/** Sub/Dub + airing-status filters shared by Seasonal and My Lists. */
export default function FilterSelects({ audio, setAudio, status, setStatus }: {
  audio: '' | 'dub' | 'dub_complete' | 'sub_only'
  setAudio: (v: '' | 'dub' | 'dub_complete' | 'sub_only') => void
  status: '' | 'RELEASING' | 'FINISHED'
  setStatus: (v: '' | 'RELEASING' | 'FINISHED') => void
}) {
  const cls = 'rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-1'
  return (
    <>
      <select value={audio} onChange={e => setAudio(e.target.value as typeof audio)} className={cls} title="English dub availability">
        <option value="">Sub & Dub</option>
        <option value="dub">Has English dub</option>
        <option value="dub_complete">Dub complete</option>
        <option value="sub_only">Sub only</option>
      </select>
      <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className={cls}>
        <option value="">Airing & finished</option>
        <option value="RELEASING">Still airing</option>
        <option value="FINISHED">Finished airing</option>
      </select>
    </>
  )
}
