import { useEffect, useState } from 'react'
import { useToast } from '@/hooks/useToast'
import type { AccountsStatus, AccountView } from '@/types'

const INFO = {
  anilist: {
    name: 'AniList',
    devUrl: 'https://anilist.co/settings/developer',
    steps: (redirect: string) => [
      'Open AniList → Settings → Developer, and click "Create New Client".',
      'Name it "Senpai" and set the Redirect URL to exactly:',
      redirect,
      'Save, then copy the Client ID (a number) and paste it below.',
    ],
  },
  mal: {
    name: 'MyAnimeList',
    devUrl: 'https://myanimelist.net/apiconfig',
    steps: (redirect: string) => [
      'Open MyAnimeList → Account Settings → API, and click "Create ID".',
      'App Type: "other". App Redirect URL must be exactly:',
      redirect,
      'Fill in the remaining required fields, submit, then copy the Client ID and paste it below.',
    ],
  },
} as const

const ago = (t: number | null) => {
  if (!t) return 'never'
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`
}

function AccountCard({ service, view, redirect, onChange }: {
  service: 'anilist' | 'mal'; view: AccountView | null; redirect: string; onChange: (s: AccountsStatus) => void
}) {
  const { toast } = useToast()
  const info = INFO[service]
  const [clientId, setClientId] = useState(view?.clientId ?? '')
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(!view?.clientId)
  useEffect(() => { setClientId(view?.clientId ?? '') }, [view?.clientId])

  const connect = async () => {
    setBusy(true)
    try {
      onChange(await window.api.accounts.setClientId(service, clientId))
      const r = await window.api.accounts.login(service)
      toast(r.message)
      onChange(await window.api.accounts.status())
    } finally { setBusy(false) }
  }

  return (
    <section className="space-y-3 rounded-card border border-border bg-bg-1 p-4">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-base font-semibold text-text-1">{info.name}</h2>
        {view?.connected
          ? <span className="rounded bg-status-completed/15 px-2 py-0.5 text-[11px] font-bold text-status-completed">Connected{view.user ? ` as ${view.user}` : ''}</span>
          : <span className="rounded bg-bg-2 px-2 py-0.5 text-[11px] font-bold text-text-3">Not connected</span>}
        <div className="flex-1" />
        {view?.connected && (
          <button disabled={busy} onClick={async () => onChange(await window.api.accounts.logout(service))}
            className="rounded-[4px] border border-border px-3 py-1 text-xs text-text-3 hover:text-red-400">Disconnect</button>
        )}
      </div>

      {view?.connected ? (
        <p className="text-xs text-text-3">
          Changes you make in Senpai (status, progress, score, dates) are sent to {info.name} automatically. Last sync: {ago(view.lastSync)}
          {view.lastError && <span className="text-status-dropped"> · last error: {view.lastError}</span>}
        </p>
      ) : (
        <>
          <button onClick={() => setHelp(h => !h)} className="text-xs text-accent hover:underline">
            {help ? 'Hide setup steps' : 'How do I get a client ID?'} (one-time, ~1 minute)
          </button>
          {help && (
            <ol className="list-decimal space-y-1 pl-5 text-xs text-text-2">
              {info.steps(redirect).map((t, i) => t === redirect
                ? <li key={i} className="list-none"><code className="select-all rounded bg-bg-0 px-2 py-1 font-mono text-[11px] text-text-1">{redirect}</code></li>
                : <li key={i}>{i === 0 ? <>{t} <a href={info.devUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">Open {info.name}</a></> : t}</li>)}
            </ol>
          )}
          <div className="flex gap-2">
            <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Client ID"
              className="flex-1 rounded-card border border-border bg-bg-0 px-3 py-1.5 text-sm text-text-1 outline-none placeholder:text-text-3/50 focus:border-accent" />
            <button disabled={busy || !clientId.trim()} onClick={connect}
              className="rounded-[4px] bg-accent px-4 py-1.5 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50">
              {busy ? 'Waiting for sign-in…' : `Connect ${info.name}`}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export default function AccountsSettings() {
  const { toast } = useToast()
  const [st, setSt] = useState<AccountsStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  useEffect(() => { window.api?.accounts.status().then(setSt).catch(() => {}) }, [])
  if (!st) return null
  const any = st.anilist?.connected || st.mal?.connected
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-3">
        Connect your accounts and Senpai keeps them up to date: every episode you watch, status change, rating and finish date is
        synced. Sign-in happens on the official AniList / MyAnimeList page; your login token is stored encrypted on this PC.
      </p>
      <AccountCard service="anilist" view={st.anilist} redirect={st.anilistRedirect} onChange={setSt} />
      <AccountCard service="mal" view={st.mal} redirect={st.malRedirect} onChange={setSt} />
      {any && (
        <div className="flex items-center gap-3">
          <button disabled={syncing} onClick={async () => {
            setSyncing(true)
            try { const r = await window.api.accounts.syncAll(); setSt(r); toast(`Synced ${r.pushed} shows`) } finally { setSyncing(false) }
          }} className="rounded-[4px] border border-border px-4 py-2 text-sm font-semibold text-text-2 hover:bg-bg-1 disabled:opacity-50">
            {syncing ? 'Syncing whole library…' : 'Sync whole library now'}
          </button>
          <span className="text-xs text-text-3">Pushes every show in your lists (takes about a second per show).</span>
        </div>
      )}
    </div>
  )
}
