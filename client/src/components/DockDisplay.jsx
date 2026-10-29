import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Music, ChevronUp, ChevronDown, WifiOff, X } from 'lucide-react'
import { useDisplayData } from '../hooks/useDisplayData'
import { useAuraColor } from '../hooks/useAuraColor'
import { cn } from '@/lib/utils'

/**
 * /dock — compact display for a ~6.3" phone in a dock (≈874×402 CSS px landscape).
 * Landscape: [now playing + QR | up next]. Portrait: stacked.
 * Compact current-track card (no lyrics), large QR, queue gets the rest.
 */

const TICK_MS = 250
const QR_OVERLAY_TIMEOUT_MS = 30000

function formatDuration(ms) {
  if (!ms || !Number.isFinite(ms)) return '0:00'
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
}

/** Keep the screen on while the view is visible (needs HTTPS or localhost). */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock = null
    let cancelled = false
    const request = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen')
      } catch { /* denied or insecure context — ignore */ }
    }
    const onVisible = () => { if (!cancelled && document.visibilityState === 'visible') request() }
    request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release?.().catch(() => {})
    }
  }, [])
}

function Art({ src, alt, className }) {
  const [error, setError] = useState(false)
  useEffect(() => setError(false), [src])
  if (!src || error) {
    return (
      <div className={cn('rounded-lg bg-white/10 flex items-center justify-center shrink-0', className)} aria-hidden="true">
        <Music className="h-1/3 w-1/3 text-white/40" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt || ''}
      className={cn('rounded-lg object-cover shrink-0', className)}
      loading="lazy"
      decoding="async"
      onError={() => setError(true)}
    />
  )
}

/** Only this subtree re-renders on the playback tick. */
function LiveProgress({ track, getPlaybackMs, auraColor }) {
  const [ms, setMs] = useState(() => getPlaybackMs())

  useEffect(() => {
    setMs(getPlaybackMs())
    if (!track?.is_playing) return
    const id = setInterval(() => setMs(getPlaybackMs()), TICK_MS)
    return () => clearInterval(id)
  }, [track, getPlaybackMs])

  const duration = track?.duration_ms || 0
  const pct = duration ? Math.min(100, Math.max(0, (ms / duration) * 100)) : 0

  return (
      <div className="mt-2.5">
        <div
          className="h-1 w-full rounded-full bg-white/15 overflow-hidden"
          role="progressbar"
          aria-label="Track progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div
            className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-linear"
            style={{ width: `${pct}%`, backgroundColor: auraColor ? `rgb(${auraColor})` : '#4ade80' }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] font-mono tabular-nums text-white/45">
          <span>{formatDuration(ms)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
  )
}

function NowPlayingCard({ track, initialized, getPlaybackMs, auraColor }) {
  if (!initialized) {
    return (
      <div className="flex items-center gap-3">
        <div className="h-20 w-20 rounded-lg bg-white/5 motion-safe:animate-pulse shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded bg-white/5 motion-safe:animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-white/5 motion-safe:animate-pulse" />
        </div>
      </div>
    )
  }
  if (!track) {
    return (
      <div className="flex items-center gap-3 text-white/45">
        <Art className="h-20 w-20" />
        <p className="text-base">Nothing playing</p>
      </div>
    )
  }
  return (
    <section aria-label="Now playing">
      <div className="flex items-center gap-3 min-w-0">
        <Art
          src={track.album_art}
          alt={track.album}
          className="h-20 w-20 landscape:h-[min(5.5rem,22vh)] landscape:w-[min(5.5rem,22vh)] shadow-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45 flex items-center gap-1.5">
            {track.is_playing ? (
              <>
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                </span>
                Now playing
              </>
            ) : 'Paused'}
          </p>
          <h1 className="mt-0.5 text-lg font-bold leading-tight line-clamp-2 [overflow-wrap:anywhere]">{track.name}</h1>
          <p className="text-sm text-white/60 leading-snug line-clamp-1">{track.artists}</p>
        </div>
      </div>
      <LiveProgress track={track} getPlaybackMs={getPlaybackMs} auraColor={auraColor} />
    </section>
  )
}

const QueueRow = memo(function QueueRow({ track, index, netVotes, showVotes }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-white/35">{index + 1}</span>
      <Art src={track.album_art} alt="" className="h-10 w-10 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-tight truncate">{track.name}</p>
        <p className="text-xs leading-tight text-white/55 truncate">{track.artists}</p>
      </div>
      {showVotes && netVotes !== 0 && (
        <span
          className={cn('flex items-center text-xs font-semibold shrink-0', netVotes > 0 ? 'text-green-400' : 'text-red-400')}
          aria-label={`${netVotes > 0 ? '+' : ''}${netVotes} votes`}
        >
          {netVotes > 0 ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
          {Math.abs(netVotes)}
        </span>
      )}
      <span className="shrink-0 text-xs font-mono tabular-nums text-white/35">{formatDuration(track.duration_ms)}</span>
    </li>
  )
})

/** QR sized to the largest square that fits its container. */
function FillQr({ value }) {
  const ref = useRef(null)
  const [size, setSize] = useState(120)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const next = Math.floor(Math.min(width, height))
      if (next > 0) setSize(next)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pad = 8
  return (
    <div ref={ref} className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <div className="rounded-xl bg-white" style={{ padding: pad }}>
        <QRCodeSVG value={value} size={Math.max(64, size - pad * 2)} />
      </div>
    </div>
  )
}

function QrOverlay({ url, onClose }) {
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const timer = setTimeout(onClose, QR_OVERLAY_TIMEOUT_MS)
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan to queue a song"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
      onClick={onClose}
    >
      <div className="rounded-2xl bg-white p-3">
        <QRCodeSVG value={url} size={260} className="h-[min(70vh,70vw)] w-[min(70vh,70vw)]" />
      </div>
      <p className="text-sm text-white/70 break-all text-center">{url}</p>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] rounded-full bg-white/10 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        aria-label="Close QR code"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  )
}

export default function DockDisplay() {
  const {
    nowPlaying, upNext, votes, connected, initialized,
    votingEnabled, auraEnabled, appUrl, getPlaybackMs,
  } = useDisplayData()
  const auraColor = useAuraColor(auraEnabled ? nowPlaying?.album_art : null)
  const [qrOpen, setQrOpen] = useState(false)
  const closeQr = useCallback(() => setQrOpen(false), [])
  useWakeLock()

  return (
    <div
      className={cn(
        'fixed inset-0 overflow-hidden select-none bg-gray-950 text-white',
        'flex flex-col landscape:flex-row',
        // keep clear of notches / dynamic island / home indicator
        'pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        'pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]',
        'gap-3'
      )}
    >
      {!connected && (
        <div role="status" className="absolute left-1/2 top-2 z-40 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-red-900/85 px-3 py-1 text-xs text-red-100">
          <WifiOff className="h-3 w-3" aria-hidden="true" /> Reconnecting…
        </div>
      )}

      {/* Left (landscape) / top (portrait): now playing + QR */}
      <div
        className="flex shrink-0 flex-col gap-3 rounded-2xl bg-white/[0.04] p-3 landscape:w-[40%] landscape:max-w-sm"
        style={auraColor ? { background: `linear-gradient(160deg, rgba(${auraColor}, 0.22), rgba(255,255,255,0.03) 70%)` } : undefined}
      >
        <NowPlayingCard track={nowPlaying} initialized={initialized} getPlaybackMs={getPlaybackMs} auraColor={auraColor} />

        {appUrl && (
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="hidden landscape:flex min-h-0 flex-1 flex-col items-center gap-1.5 rounded-xl bg-black/25 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            aria-label="Show large QR code to queue a song"
          >
            <FillQr value={appUrl} />
            <span className="shrink-0 text-center leading-tight">
              <span className="block text-sm font-semibold">Scan to queue a song</span>
              <span className="block text-[11px] text-white/45 truncate">{appUrl.replace(/^https?:\/\//, '')}</span>
            </span>
          </button>
        )}
      </div>

      {/* Right (landscape) / bottom (portrait): queue */}
      <section aria-labelledby="dock-upnext" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between px-1 pb-1">
          <h2 id="dock-upnext" className="text-[11px] font-semibold uppercase tracking-widest text-white/45">Up next</h2>
          {upNext.length > 0 && <span className="text-[11px] text-white/35 tabular-nums">{upNext.length} queued</span>}
        </div>
        {upNext.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-white/35">Queue is empty — scan to add a song</div>
        ) : (
          <ol className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 divide-y divide-white/5">
            {upNext.map((track, i) => (
              <QueueRow
                key={`${track.id}-${i}`}
                track={track}
                index={i}
                netVotes={votes[track.id] ?? 0}
                showVotes={votingEnabled && track.votable}
              />
            ))}
          </ol>
        )}

        {/* Portrait: QR strip at the bottom */}
        {appUrl && (
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="landscape:hidden mt-2 flex items-center gap-3 rounded-xl bg-white/[0.04] p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            aria-label="Show large QR code to queue a song"
          >
            <span className="rounded-lg bg-white p-1.5 shrink-0"><QRCodeSVG value={appUrl} size={128} /></span>
            <span className="min-w-0">
              <span className="block text-base font-semibold">Scan to queue a song</span>
              <span className="block text-xs text-white/45 truncate">{appUrl.replace(/^https?:\/\//, '')}</span>
              <span className="block text-xs text-white/35">Tap to enlarge</span>
            </span>
          </button>
        )}
      </section>

      {qrOpen && appUrl && <QrOverlay url={appUrl} onClose={closeQr} />}
    </div>
  )
}
