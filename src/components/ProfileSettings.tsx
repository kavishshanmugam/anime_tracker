import { useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibrary } from '@/hooks/useLibrary'
import { useToast } from '@/hooks/useToast'
import { AVATAR_COLORS, saveProfile, useProfile, type Profile } from '@/hooks/useProfile'

export function Avatar({ profile, size = 32 }: { profile: Profile; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) }
  return profile.avatar
    ? <img src={profile.avatar} alt="" style={style} className="shrink-0 rounded-full object-cover" />
    : <span style={{ ...style, backgroundColor: profile.color }} className="flex shrink-0 items-center justify-center rounded-full font-bold uppercase text-white">
        {profile.name.trim()[0] ?? 'S'}
      </span>
}

/** Shrink a picked image to a 160px square so it stays small in the database. */
function toAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const c = document.createElement('canvas')
      c.width = c.height = 160
      c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 160, 160)
      URL.revokeObjectURL(img.src)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('not an image'))
    img.src = URL.createObjectURL(file)
  })
}

const seg = (active: boolean) => `px-4 py-1.5 text-sm font-semibold ${active ? 'bg-accent text-white' : 'bg-bg-0 text-text-3 hover:text-text-1'}`

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div><p className="text-sm text-text-1">{title}</p><p className="text-xs text-text-3">{hint}</p></div>
      <div className="flex shrink-0 overflow-hidden rounded-[4px] border border-border">{children}</div>
    </div>
  )
}

export default function ProfileSettings() {
  const profile = useProfile()
  const { entries } = useLibrary()
  const { toast } = useToast()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const stats = useMemo(() => {
    const scored = entries.filter(e => e.entry.my_score)
    return {
      completed: entries.filter(e => e.entry.my_status === 'completed').length,
      watching: entries.filter(e => e.entry.my_status === 'watching').length,
      episodes: entries.reduce((n, e) => n + (e.entry.progress ?? 0), 0),
      mean: scored.length ? (scored.reduce((n, e) => n + (e.entry.my_score ?? 0), 0) / scored.length).toFixed(1) : '–',
    }
  }, [entries])

  const pickPicture = async (file: File | undefined) => {
    if (!file) return
    try { await saveProfile({ avatar: await toAvatar(file) }) } catch { toast("Couldn't read that picture") }
  }
  const setNotify = (key: keyof Profile['notify'], on: boolean) => saveProfile({ notify: { ...profile.notify, [key]: on } })
  const onOff = (key: keyof Profile['notify']) => (<>
    <button className={seg(profile.notify[key])} onClick={() => setNotify(key, true)}>On</button>
    <button className={seg(!profile.notify[key])} onClick={() => setNotify(key, false)}>Off</button>
  </>)

  return (<>
    <section className="space-y-4">
      <h2 className="font-display text-base font-semibold text-text-1">Profile</h2>
      <div className="flex items-center gap-5 rounded-card border border-border bg-bg-1 p-5">
        <Avatar profile={profile} size={84} />
        <div className="min-w-0 flex-1 space-y-3">
          <input
            type="text" value={profile.name} maxLength={30} placeholder="Your name"
            onChange={e => saveProfile({ name: e.target.value })}
            className="w-full max-w-xs rounded-card border border-border bg-bg-0 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            {AVATAR_COLORS.map(c => (
              <button key={c} onClick={() => saveProfile({ color: c, avatar: null })} title="Use this colour"
                style={{ backgroundColor: c }}
                className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-bg-1 ${!profile.avatar && profile.color === c ? 'ring-2 ring-text-1' : ''}`} />
            ))}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { pickPicture(e.target.files?.[0]); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} className="ml-2 rounded-card border border-border px-3 py-1 text-xs text-text-2 hover:bg-bg-2 hover:text-text-1">
              {profile.avatar ? 'Change picture' : 'Upload picture'}
            </button>
            {profile.avatar && <button onClick={() => saveProfile({ avatar: null })} className="text-xs text-text-3 hover:text-text-1">Remove</button>}
          </div>
          <p className="text-xs text-text-3">Only stored on this computer. Your name appears in the top bar and on your list.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['Completed', stats.completed], ['Watching', stats.watching], ['Episodes watched', stats.episodes], ['Mean score', stats.mean]].map(([label, value]) => (
          <div key={label} className="rounded-card border border-border bg-bg-1 px-4 py-3">
            <p className="font-display text-2xl font-black text-text-1">{value}</p>
            <p className="text-xs text-text-3">{label}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => navigate('/library')} className="rounded-card border border-border px-3 py-1.5 text-sm text-text-2 hover:bg-bg-1 hover:text-text-1">Open my list</button>
        <button onClick={() => navigate('/stats')} className="rounded-card border border-border px-3 py-1.5 text-sm text-text-2 hover:bg-bg-1 hover:text-text-1">Full stats</button>
      </div>
    </section>

    <section className="space-y-3">
      <h2 className="font-display text-base font-semibold text-text-1">App</h2>
      <Row title="Open on" hint="The page you see when Senpai starts.">
        <button className={seg(profile.startPage === 'home')} onClick={() => saveProfile({ startPage: 'home' })}>Home</button>
        <button className={seg(profile.startPage === 'library')} onClick={() => saveProfile({ startPage: 'library' })}>My List</button>
      </Row>
    </section>

    <section className="space-y-3">
      <h2 className="font-display text-base font-semibold text-text-1">Notifications</h2>
      <Row title="New episodes" hint="First episode out, season finished, and new episodes of shows you're watching.">{onOff('episodes')}</Row>
      <Row title="Sequels & spin-offs" hint="When something related to a show you watched is announced.">{onOff('sequels')}</Row>
      <Row title="English dubs" hint="When a show in your lists gets a dub, or its dub finishes.">{onOff('dubs')}</Row>
    </section>
  </>)
}
