import { useState, useEffect, useRef, useCallback } from 'react'
import axios from '@/lib/api'

/**
 * Polling + state for display-style views (used by DockDisplay).
 * Mirrors the endpoints/intervals used by Display.jsx, but deliberately does NOT
 * tick progress here — progress lives in its own small component so the whole
 * view doesn't re-render 10x per second.
 */
const POLL_NOW_PLAYING_MS = 3000
const POLL_QUEUE_MS = 8000
const POLL_VOTES_MS = 10000
const POLL_CONFIG_MS = 10000
const MAX_QUEUE = 20

export function useDisplayData() {
  const [nowPlaying, setNowPlaying] = useState(null)
  const [upNext, setUpNext] = useState([])
  const [votes, setVotes] = useState({})
  const [connected, setConnected] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [votingEnabled, setVotingEnabled] = useState(false)
  const [auraEnabled, setAuraEnabled] = useState(false)
  const [queueUrl, setQueueUrl] = useState('')

  const nowPlayingRef = useRef(null)
  const lastFetchedAtRef = useRef(null)

  /** Extrapolated playback position (ms). Does not advance while paused. */
  const getPlaybackMs = useCallback(() => {
    const track = nowPlayingRef.current
    if (!track) return 0
    const base = track.progress_ms ?? 0
    if (!track.is_playing || lastFetchedAtRef.current == null) return base
    return base + (Date.now() - lastFetchedAtRef.current)
  }, [])

  // Now playing
  useEffect(() => {
    let cancelled = false
    let failCount = 0

    const fetchNowPlaying = async () => {
      try {
        const res = await axios.get('/api/now-playing', { timeout: 5000 })
        if (cancelled) return
        const track = res.data?.track ?? null
        const prevId = nowPlayingRef.current?.id

        // Optimistically drop the head of the queue when the track changes
        if (track?.id && prevId && track.id !== prevId) {
          setUpNext((prev) => prev.slice(1))
        }

        nowPlayingRef.current = track
        lastFetchedAtRef.current = Date.now()
        setNowPlaying(track)
        setConnected(true)
        failCount = 0
      } catch {
        failCount++
        if (failCount >= 3 && !cancelled) setConnected(false)
      } finally {
        if (!cancelled) setInitialized(true)
      }
    }

    fetchNowPlaying()
    const interval = setInterval(fetchNowPlaying, POLL_NOW_PLAYING_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Queue
  useEffect(() => {
    let cancelled = false
    const fetchQueue = async () => {
      try {
        const res = await axios.get('/api/queue/current', { timeout: 8000 })
        if (!cancelled) setUpNext(res.data?.queue?.slice(0, MAX_QUEUE) ?? [])
      } catch { /* keep last known queue */ }
    }
    fetchQueue()
    const interval = setInterval(fetchQueue, POLL_QUEUE_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Public config
  useEffect(() => {
    let cancelled = false
    const fetchConfig = async () => {
      try {
        const res = await axios.get('/api/config/public', { timeout: 5000 })
        if (cancelled) return
        setVotingEnabled(res.data?.voting_enabled ?? false)
        setAuraEnabled(res.data?.aura_enabled ?? false)
        setQueueUrl(res.data?.queue_url || '')
      } catch {
        if (!cancelled) setVotingEnabled(false)
      }
    }
    fetchConfig()
    const interval = setInterval(fetchConfig, POLL_CONFIG_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Votes (only when enabled)
  useEffect(() => {
    if (!votingEnabled) { setVotes({}); return }
    let cancelled = false
    const fetchVotes = async () => {
      try {
        const res = await axios.get('/api/queue/votes', { timeout: 5000 })
        if (!cancelled) setVotes(res.data?.votes ?? {})
      } catch { /* non-critical */ }
    }
    fetchVotes()
    const interval = setInterval(fetchVotes, POLL_VOTES_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [votingEnabled])

  const appUrl = queueUrl || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : '')

  return {
    nowPlaying, upNext, votes, connected, initialized,
    votingEnabled, auraEnabled, appUrl, getPlaybackMs,
  }
}
