import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/hooks/useToast'
import type { SourceDomain, SourcesSnapshot } from '@/types'

const VERDICT_STYLE: Record<SourceDomain['verdict'], string> = {
  safe: 'border-green-500/30 text-green-400',
  pending: 'border-yellow-500/30 text-yellow-300',
  blocked: 'border-red-500/30 text-red-400',
  unreachable: 'border-orange-500/30 text-orange-300',
  unchecked: 'border-border text-text-3',
}
const CHECK_ICON = { pass: '✓', warn: '!', fail: '✕', info: 'i' } as const
const CHECK_COLOR = { pass: 'text-green-400', warn: 'text-yellow-300', fail: 'text-red-400', info: 'text-text-3' } as const

function ago(ts?: number) {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function statusLabel(d: SourceDomain) {
  if (d.checking) return 'checking…'
  if (d.verdict === 'blocked') return 'blocked (unsafe)'
  if (d.verdict === 'unreachable') return 'unreachable — retry in 1h'
  if (d.verdict === 'unchecked') return 'not checked yet'
  if (!d.usable) return 'awaiting approval'
  if (d.coolingDown) return 'down — retrying later'
  if (d.verdict === 'pending') return d.approved ? 'approved (warnings)' : 'trusted list (warnings)'
  return 'safe'
}

function DomainRow({ d, busy, run }: { d: SourceDomain; busy: boolean; run: (fn: () => Promise<unknown>, ok?: string) => void }) {
  const [open, setOpen] = useState(false)
  const host = new URL(d.origin).hostname
  return (
    <div className="rounded-card border border-border bg-bg-0">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <button onClick={() => setOpen(v => !v)} className="text-text-3 w-4">{open ? '▾' : '▸'}</button>
        <a href={d.origin} target="_blank" rel="noopener noreferrer"
          title="Open this site in your normal browser to check it before approving"
          className="font-mono text-text-1 truncate underline decoration-text-3/40 underline-offset-2 hover:text-accent hover:decoration-accent">{host}</a>
        {d.verdict === 'pending' && !d.usable && <span className="text-[11px] text-yellow-300/80">check it ↗</span>}
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${VERDICT_STYLE[d.coolingDown && d.verdict === 'safe' ? 'pending' : d.verdict]}`}>
          {statusLabel(d)}
        </span>
        <span className="text-[11px] text-text-3">{d.source}</span>
        <div className="flex-1" />
        {d.latencyMs != null && <span className="text-xs text-text-3 font-mono">{d.latencyMs} ms</span>}
        {d.failures > 0 && <span className="text-xs text-text-3">{d.successes}✓ {d.failures}✕</span>}
        {d.verdict === 'pending' && !d.approved && (
          <button disabled={busy} onClick={() => run(() => window.api.sources.approve(d.origin, true), `Approved ${host}`)}
            className="rounded border border-yellow-500/40 px-2 py-0.5 text-xs text-yellow-300 hover:bg-yellow-500/10">Approve</button>
        )}
        {d.approved && d.source === 'discovered' && (
          <button disabled={busy} onClick={() => run(() => window.api.sources.approve(d.origin, false))}
            className="rounded border border-border px-2 py-0.5 text-xs text-text-3 hover:bg-bg-2">Revoke</button>
        )}
        <button disabled={busy || d.checking} onClick={() => run(() => window.api.sources.recheck(d.origin), `Re-checked ${host}`)}
          className="rounded border border-border px-2 py-0.5 text-xs text-text-3 hover:bg-bg-2">Re-check</button>
        <button disabled={busy} onClick={() => run(() => window.api.sources.removeDomain(d.origin))}
          className="rounded border border-border px-2 py-0.5 text-xs text-text-3 hover:bg-bg-2">Remove</button>
      </div>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-1">
          {d.checks.length === 0 && <p className="text-xs text-text-3">No safety report yet.</p>}
          {d.checks.map(c => (
            <div key={c.id} className="flex gap-2 text-xs">
              <span className={`w-3 font-bold ${CHECK_COLOR[c.status]}`}>{CHECK_ICON[c.status]}</span>
              <span className="text-text-2 w-44 shrink-0">{c.label}</span>
              <span className="text-text-3">{c.detail}</span>
            </div>
          ))}
          <p className="text-[11px] text-text-3 pt-1">
            Checked {ago(d.checkedAt)} · last OK {ago(d.lastOkAt)}{d.lastError ? ` · last error: ${d.lastError}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}

export default function SourcesSettings() {
  const { toast } = useToast()
  const [snap, setSnap] = useState<SourcesSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [manifestUrl, setManifestUrl] = useState('')
  const [gsbKey, setGsbKey] = useState('')
  const [addDomain, setAddDomain] = useState<{ providerId: string; url: string }>({ providerId: '', url: '' })
  const [newSource, setNewSource] = useState({ name: '', url: '', searchPath: '', layout: 'generic' as 'gogo' | 'generic' })
  const [showAddSource, setShowAddSource] = useState(false)
  const [siteLink, setSiteLink] = useState('')
  const [testTitle, setTestTitle] = useState('One Piece')

  const refresh = useCallback(async () => {
    const s = await window.api?.sources.snapshot()
    if (!s) return
    setSnap(s)
    setManifestUrl(u => u || s.manifestUrl)
    setAddDomain(a => a.providerId ? a : { ...a, providerId: s.providers[0]?.id ?? '' })
  }, [])

  useEffect(() => {
    refresh()
    const off = window.api?.sources.onChanged(() => refresh())
    const timer = setInterval(refresh, 5000)
    return () => { off?.(); clearInterval(timer) }
  }, [refresh])

  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      const r: any = await fn()
      if (r && typeof r === 'object' && 'message' in r) toast(r.message)
      else if (ok) toast(ok)
    } catch (e: any) {
      toast(e?.message ?? 'Failed')
    } finally {
      setBusy(false)
      refresh()
    }
  }, [refresh, toast])

  if (!snap) return null
  const pendingCount = snap.providers.flatMap(p => p.domains).filter(d => d.verdict === 'pending' && !d.usable).length

  return (
    <div className="pt-3 border-t border-border space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-text-2">Streaming Sources</h3>
        {pendingCount > 0 && (
          <span className="rounded bg-yellow-500/15 px-2 py-0.5 text-[11px] font-semibold text-yellow-300">{pendingCount} awaiting approval</span>
        )}
        <div className="flex-1" />
        <button disabled={busy} onClick={() => run(() => window.api.sources.discover(), 'Domain search finished')}
          className="rounded-card border border-border px-3 py-1.5 text-xs text-text-2 hover:bg-bg-1 disabled:opacity-50">Find new domains</button>
        <button disabled={busy} onClick={() => run(() => window.api.sources.recheck(), 'All domains re-checked')}
          className="rounded-card border border-border px-3 py-1.5 text-xs text-text-2 hover:bg-bg-1 disabled:opacity-50">Re-check all</button>
      </div>
      <p className="text-xs text-text-3">
        Every domain must pass security checks (HTTPS, malware/phishing DNS filters from Cloudflare and Quad9, domain age,
        no off-site redirects, parked-page and fake-site detection) before the player will load it. New domains that raise
        warnings are held for your approval. Inside the player, downloads, popups, permission prompts and navigation to
        unvetted sites are blocked.
      </p>

      {snap.providers.map((p, idx) => (
        <div key={p.id} className="rounded-card border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={p.enabled}
              onChange={e => run(() => window.api.sources.setProvider(p.id, { enabled: e.target.checked }))} />
            <span className="text-sm font-medium text-text-1">{p.name}</span>
            <span className="text-[11px] text-text-3">{p.layout === 'gogo' ? 'gogo layout' : 'generic layout'}{p.custom ? ' · custom' : ''}</span>
            {p.discovering && <span className="text-[11px] text-accent">searching for domains…</span>}
            <div className="flex-1" />
            <span className="text-[11px] text-text-3">discovery {ago(p.lastDiscoveryAt)}</span>
            <button disabled={busy || idx === 0} onClick={() => run(() => window.api.sources.moveProvider(p.id, -1))}
              className="px-1 text-text-3 hover:text-text-1 disabled:opacity-30" title="Higher priority">↑</button>
            <button disabled={busy || idx === snap.providers.length - 1} onClick={() => run(() => window.api.sources.moveProvider(p.id, 1))}
              className="px-1 text-text-3 hover:text-text-1 disabled:opacity-30" title="Lower priority">↓</button>
            <button disabled={busy} title={`Search "${testTitle}" on this source`}
              onClick={() => run(() => window.api.sources.testSearch(p.id, testTitle))}
              className="rounded border border-border px-2 py-0.5 text-xs text-text-3 hover:bg-bg-2">Test</button>
            <button disabled={busy || p.discovering} onClick={() => run(() => window.api.sources.discover(p.id), `Searched for ${p.name} domains`)}
              className="rounded border border-border px-2 py-0.5 text-xs text-text-3 hover:bg-bg-2">Find domains</button>
            {p.custom && (
              <button disabled={busy} onClick={() => run(() => window.api.sources.removeProvider(p.id), `Removed ${p.name}`)}
                className="rounded border border-border px-2 py-0.5 text-xs text-red-400 hover:bg-bg-2">Delete</button>
            )}
          </div>
          <div className="space-y-1.5">
            {p.domains.length === 0 && <p className="text-xs text-text-3">No domains yet.</p>}
            {p.domains.map(d => <DomainRow key={d.origin} d={d} busy={busy} run={run} />)}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 text-xs text-text-3">
        <span>Test searches use:</span>
        <input value={testTitle} onChange={e => setTestTitle(e.target.value)}
          className="w-48 rounded border border-border bg-bg-0 px-2 py-1 text-xs text-text-1 focus:border-accent outline-none" />
      </div>

      {/* Add domain to existing source */}
      <div className="flex gap-2 items-center">
        <select value={addDomain.providerId} onChange={e => setAddDomain({ ...addDomain, providerId: e.target.value })}
          className="rounded-card border border-border bg-bg-0 px-2 py-1.5 text-sm text-text-1">
          {snap.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={addDomain.url} onChange={e => setAddDomain({ ...addDomain, url: e.target.value })}
          placeholder="https://new-mirror.example"
          className="flex-1 rounded-card border border-border bg-bg-0 px-3 py-1.5 text-sm text-text-1 placeholder:text-text-3/50 focus:border-accent outline-none" />
        <button disabled={busy || !addDomain.url.trim()}
          onClick={() => run(async () => {
            const r = await window.api.sources.addDomain(addDomain.providerId, addDomain.url)
            if (r.ok) setAddDomain({ ...addDomain, url: '' })
            return r
          })}
          className="rounded-card bg-accent px-3 py-1.5 text-sm text-text-1 hover:bg-accent-hover disabled:opacity-50">
          {busy ? 'Checking…' : 'Check & add domain'}
        </button>
      </div>

      {/* Add a site from just a link */}
      <div className="rounded-card border border-accent/30 bg-accent/5 p-3 space-y-2">
        <p className="text-sm font-medium text-text-1">Add a site you trust</p>
        <p className="text-xs text-text-3">
          Paste any link from an anime site (homepage, show or episode page). Senpai runs the safety checks first, then
          works out how to search it and adds it as a source.
        </p>
        <div className="flex gap-2">
          <input value={siteLink} onChange={e => setSiteLink(e.target.value)} placeholder="https://…"
            onKeyDown={e => { if (e.key === 'Enter' && siteLink.trim()) (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click() }}
            className="flex-1 rounded-card border border-border bg-bg-0 px-3 py-1.5 text-sm text-text-1 placeholder:text-text-3/50 focus:border-accent outline-none" />
          <button disabled={busy || !siteLink.trim()}
            onClick={() => run(async () => {
              const r = await window.api.sources.addSiteByLink(siteLink)
              if (r.ok) setSiteLink('')
              return r
            })}
            className="rounded-card bg-accent px-3 py-1.5 text-sm text-text-1 hover:bg-accent-hover disabled:opacity-50">
            {busy ? 'Checking…' : 'Check & add'}
          </button>
        </div>
      </div>

      {/* Add a whole new source (manual) */}
      {!showAddSource ? (
        <button onClick={() => setShowAddSource(true)} className="text-xs text-text-3 hover:text-accent hover:underline">Advanced: define a source manually</button>
      ) : (
        <div className="rounded-card border border-border p-3 space-y-2">
          <p className="text-xs text-text-3">
            Generic layout finds the show by matching link titles on the search page, and learns the episode URL pattern the
            first time you pick an episode. Use “gogo layout” for gogoanime clones.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input value={newSource.name} onChange={e => setNewSource({ ...newSource, name: e.target.value })} placeholder="Name"
              className="rounded-card border border-border bg-bg-0 px-3 py-1.5 text-sm text-text-1 placeholder:text-text-3/50 focus:border-accent outline-none" />
            <input value={newSource.url} onChange={e => setNewSource({ ...newSource, url: e.target.value })} placeholder="https://site.example"
              className="rounded-card border border-border bg-bg-0 px-3 py-1.5 text-sm text-text-1 placeholder:text-text-3/50 focus:border-accent outline-none" />
            <input value={newSource.searchPath} onChange={e => setNewSource({ ...newSource, searchPath: e.target.value })}
              placeholder="Search path, e.g. /search?keyword={q}"
              className="rounded-card border border-border bg-bg-0 px-3 py-1.5 text-sm font-mono text-text-1 placeholder:text-text-3/50 focus:border-accent outline-none" />
            <select value={newSource.layout} onChange={e => setNewSource({ ...newSource, layout: e.target.value as 'gogo' | 'generic' })}
              className="rounded-card border border-border bg-bg-0 px-2 py-1.5 text-sm text-text-1">
              <option value="generic">Generic layout</option>
              <option value="gogo">Gogo layout</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button disabled={busy || !newSource.url.trim()}
              onClick={() => run(async () => {
                const r = await window.api.sources.addProvider(newSource)
                if (r.ok) { setNewSource({ name: '', url: '', searchPath: '', layout: 'generic' }); setShowAddSource(false) }
                return r
              })}
              className="rounded-card bg-accent px-3 py-1.5 text-sm text-text-1 hover:bg-accent-hover disabled:opacity-50">
              {busy ? 'Checking…' : 'Check & add source'}
            </button>
            <button onClick={() => setShowAddSource(false)} className="rounded-card border border-border px-3 py-1.5 text-sm text-text-3">Cancel</button>
          </div>
        </div>
      )}

      {/* Options */}
      <div className="space-y-2 pt-2 border-t border-border">
        <div className="flex gap-2 items-center">
          <label className="text-xs text-text-3 shrink-0 w-28">Source list URL</label>
          <input value={manifestUrl} onChange={e => setManifestUrl(e.target.value)}
            onBlur={() => manifestUrl !== snap.manifestUrl && run(() => window.api.sources.setOptions({ manifestUrl }), 'Source list URL saved')}
            className="flex-1 rounded-card border border-border bg-bg-0 px-3 py-1.5 text-xs font-mono text-text-1 focus:border-accent outline-none" />
          <button disabled={busy} onClick={() => run(() => window.api.sources.refreshManifest())}
            className="rounded-card border border-border px-3 py-1.5 text-xs text-text-2 hover:bg-bg-1">Update now</button>
        </div>
        <p className="text-[11px] text-text-3">
          Using {snap.manifestSource} list v{snap.manifestVersion} · fetched {ago(snap.manifestFetchedAt)}
          {snap.manifestError ? ` · ${snap.manifestError}` : ''}
        </p>
        <label className="flex items-center gap-2 text-xs text-text-2">
          <input type="checkbox" checked={snap.adblock} onChange={e => run(() => window.api.sources.setOptions({ adblock: e.target.checked }))} />
          Block ad &amp; malvertising domains in the player
        </label>
        <label className="flex items-center gap-2 text-xs text-text-2">
          <input type="checkbox" checked={snap.strictApproval} onChange={e => run(() => window.api.sources.setOptions({ strictApproval: e.target.checked }))} />
          Require my approval for every automatically discovered domain (even ones that pass all checks)
        </label>
        <div className="flex gap-2 items-center">
          <label className="text-xs text-text-3 shrink-0 w-28">Safe Browsing key</label>
          <input type="password" value={gsbKey} onChange={e => setGsbKey(e.target.value)}
            placeholder={snap.hasSafeBrowsingKey ? '•••••• (saved)' : 'Optional Google Safe Browsing API key'}
            className="flex-1 rounded-card border border-border bg-bg-0 px-3 py-1.5 text-xs text-text-1 placeholder:text-text-3/50 focus:border-accent outline-none" />
          <button disabled={busy} onClick={() => run(async () => { await window.api.sources.setOptions({ safeBrowsingKey: gsbKey || null }); setGsbKey('') }, gsbKey ? 'Key saved' : 'Key cleared')}
            className="rounded-card border border-border px-3 py-1.5 text-xs text-text-2 hover:bg-bg-1">{gsbKey ? 'Save' : 'Clear'}</button>
        </div>
      </div>

      {snap.discoveryLog.length > 0 && (
        <details className="text-xs text-text-3">
          <summary className="cursor-pointer">Discovery log</summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {snap.discoveryLog.map((l, i) => <li key={i}>{new Date(l.at).toLocaleString()} [{l.providerId}] {l.message}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}
