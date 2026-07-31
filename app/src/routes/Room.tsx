import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Room as LiveKitRoom, RoomEvent, Track } from 'livekit-client'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { playChime } from '../lib/sound'

type StatusKey = 'host' | 'focusing' | 'micOff' | 'camOff' | 'justJoined'
type Member = { id: string; name: string; statusKey: StatusKey; host: boolean; me?: boolean }
type Pending = { id: string; userId: string; name: string; wait: string }
type ChatMsg = { who: string; me: boolean; text: string }
type RoomRow = {
  id: string
  code: string
  name: string
  host_id: string
  admit_mode: 'auto' | 'manual'
  capacity: number
  duration_minutes: number
  break_minutes: number
  session_count: number
  timer_phase: 'focus' | 'break'
  timer_round: number
  timer_running: boolean
  timer_done: boolean
  timer_remaining_seconds: number | null
  timer_updated_at: string
  music_on: boolean
  music_track_index: number
}
type RealMemberRow = {
  id: string
  room_id: string
  user_id: string
  status: 'pending' | 'member'
  joined_at: string
  name: string
}
type RealMsgRow = {
  id: string
  room_id: string
  user_id: string
  text: string
  created_at: string
  name: string
}

function relativeWait(iso: string, t: (key: string, options?: Record<string, unknown>) => string) {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return t('room.wait.seconds', { count: sec })
  return t('room.wait.minutes', { min: Math.floor(sec / 60), sec: String(sec % 60).padStart(2, '0') })
}

function phaseTotalSeconds(r: RoomRow, phase: 'focus' | 'break') {
  return (phase === 'focus' ? r.duration_minutes : r.break_minutes) * 60
}
function computeLeftFromRoom(r: RoomRow) {
  const base = r.timer_remaining_seconds ?? phaseTotalSeconds(r, r.timer_phase)
  if (!r.timer_running) return Math.max(0, base)
  const elapsed = Math.floor((Date.now() - new Date(r.timer_updated_at).getTime()) / 1000)
  return Math.max(0, base - elapsed)
}

const TRACK_KEYS = ['t1', 't2', 't3', 't4', 't5'] as const
const TRACK_LENGTHS: Record<(typeof TRACK_KEYS)[number], string> = {
  t1: '42:10',
  t2: '58:24',
  t3: '1:20:00',
  t4: '35:47',
  t5: '1:05:12',
}

const FOCUS_MINUTES = 25
const BREAK_MINUTES = 5
const SESSION_COUNT_DEFAULT = 4
const ACCENT = 'var(--ff-accent)'
const ACCENT_SOFT = 'var(--ff-accent-soft)'

function TrackMediaEl({ track, kind, mirror }: { track: MediaStreamTrack; kind: 'video' | 'audio'; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = new MediaStream([track])
    return () => {
      el.srcObject = null
    }
  }, [track])
  if (kind === 'video') {
    return (
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        style={mirror ? { transform: 'scaleX(-1)' } : undefined}
      />
    )
  }
  return <audio ref={ref} autoPlay />
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function focusSecs() {
  return FOCUS_MINUTES * 60
}
function breakSecs() {
  return BREAK_MINUTES * 60
}

type Phase = 'focus' | 'break'
type Tab = 'chat' | 'music' | 'host'
type Admit = 'auto' | 'manual'
type Demo = 'two' | 'five'

function segStyle(on: boolean) {
  return {
    background: on ? '#ffffff' : 'transparent',
    color: on ? '#22483f' : 'rgba(51,71,94,0.55)',
    boxShadow: on ? '0 4px 12px rgba(58,98,126,0.12)' : 'none',
  }
}

export default function Room() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id: code } = useParams<{ id: string }>()
  const user = useAuthStore((s) => s.user)

  const meMember = useMemo<Member>(
    () => ({ id: '12', name: t('room.you'), statusKey: 'host', host: true, me: true }),
    [t],
  )
  const demoSets = useMemo<Record<Demo, Member[]>>(
    () => ({
      two: [{ id: '10', name: 'Minh Anh', statusKey: 'focusing', host: false }, meMember],
      five: [
        { id: '10', name: 'Minh Anh', statusKey: 'focusing', host: false },
        { id: '11', name: 'Hà Vy', statusKey: 'micOff', host: false },
        { id: '13', name: 'Gia Bảo', statusKey: 'focusing', host: false },
        { id: '14', name: 'Thanh Trúc', statusKey: 'camOff', host: false },
        meMember,
      ],
    }),
    [meMember],
  )
  const tracks = useMemo(
    () =>
      TRACK_KEYS.map((key) => ({
        name: t(`room.mockTracks.${key}.name`),
        mood: t(`room.mockTracks.${key}.mood`),
        length: TRACK_LENGTHS[key],
      })),
    [t],
  )
  const statusLabel = (key: StatusKey) => t(`room.status.${key}`)

  const [realRoom, setRealRoom] = useState<RoomRow | null>(null)
  const [loadingRoom, setLoadingRoom] = useState(false)
  const isRealMode = !!user && !!realRoom
  const isHost = isRealMode ? realRoom!.host_id === user!.id : true
  const roomId = realRoom?.id

  const [running, setRunning] = useState(true)
  const [phase, setPhase] = useState<Phase>('focus')
  const [left, setLeft] = useState(focusSecs() - 512)
  const [round, setRound] = useState(2)
  const [done, setDone] = useState(false)
  const roundRef = useRef(round)
  roundRef.current = round

  const [cam, setCam] = useState(true)
  const [mic, setMic] = useState(false)
  const [chatOpen, setChatOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('chat')

  const [preferredCameraId, setPreferredCameraId] = useState('')
  const [preferredMicId, setPreferredMicId] = useState('')
  const [notificationSound, setNotificationSound] = useState(true)
  const preferredCameraIdRef = useRef(preferredCameraId)
  preferredCameraIdRef.current = preferredCameraId
  const preferredMicIdRef = useRef(preferredMicId)
  preferredMicIdRef.current = preferredMicId

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('preferred_camera_id, preferred_mic_id, notification_sound')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data) return
        setPreferredCameraId(data.preferred_camera_id ?? '')
        setPreferredMicId(data.preferred_mic_id ?? '')
        setNotificationSound(data.notification_sound)
      })
  }, [user])

  const [musicOn, setMusicOn] = useState(true)
  const [trackIndex, setTrackIndex] = useState(0)
  const [volume, setVolume] = useState(45)

  const [admit, setAdmit] = useState<Admit>('manual')
  const [pending, setPending] = useState<Pending[]>([
    { id: '1', userId: '1', name: 'Thanh Trúc', wait: t('room.wait.seconds', { count: 20 }) },
    { id: '2', userId: '2', name: 'Gia Bảo', wait: t('room.wait.minutes', { min: 1, sec: '05' }) },
  ])
  const [myStatus, setMyStatus] = useState<'member' | 'pending' | null>(null)
  const [membersLoaded, setMembersLoaded] = useState(false)

  const [demo, setDemo] = useState<Demo>('five')
  const [members, setMembers] = useState<Member[]>(demoSets.five.slice())
  const membersRef = useRef(members)
  membersRef.current = members
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())

  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMsg[]>([
    { who: 'Minh Anh', me: false, text: t('room.mockChat.m1') },
    { who: t('room.you'), me: true, text: t('room.mockChat.m2') },
    { who: 'Minh Anh', me: false, text: t('room.mockChat.m3') },
  ])

  useEffect(() => {
    if (!user || !code) {
      setRealRoom(null)
      return
    }
    let cancelled = false
    setLoadingRoom(true)
    supabase
      .from('rooms')
      .select(
        'id, code, name, host_id, admit_mode, capacity, duration_minutes, break_minutes, session_count, timer_phase, timer_round, timer_running, timer_done, timer_remaining_seconds, timer_updated_at, music_on, music_track_index',
      )
      .eq('code', code.toUpperCase())
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setLoadingRoom(false)
        setRealRoom(data ?? null)
        if (data) setAdmit(data.admit_mode)
      })
    return () => {
      cancelled = true
    }
  }, [user, code])

  useEffect(() => {
    if (!roomId) return
    const channel = supabase
      .channel('room-sync-' + roomId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => setRealRoom((prev) => (prev ? { ...prev, ...(payload.new as RoomRow) } : prev)),
      )
      .subscribe()
    return () => {
      channel.unsubscribe()
    }
  }, [roomId])

  useEffect(() => {
    if (!realRoom) return
    setPhase(realRoom.timer_phase)
    setRunning(realRoom.timer_running)
    setRound(realRoom.timer_round)
    setDone(realRoom.timer_done)
    setLeft(computeLeftFromRoom(realRoom))
    setMusicOn(realRoom.music_on)
    setTrackIndex(realRoom.music_track_index)
  }, [realRoom])

  // mỗi thành viên tự ghi phiên của mình khi thấy phase thật của phòng chuyển đổi
  // (host là nguồn chuyển phase, member chỉ quan sát qua Realtime — xem flipPhaseReal ở trên).
  const prevRealPhaseRef = useRef<Phase | null>(null)
  useEffect(() => {
    if (!realRoom || !user) return
    const prevPhase = prevRealPhaseRef.current
    if (prevPhase !== null && prevPhase !== realRoom.timer_phase && myStatus === 'member') {
      const completedMinutes = prevPhase === 'focus' ? realRoom.duration_minutes : realRoom.break_minutes
      const startedAt = new Date(Date.now() - completedMinutes * 60000).toISOString()
      supabase
        .from('focus_sessions')
        .insert({ user_id: user.id, room_id: realRoom.id, phase: prevPhase, minutes: completedMinutes, started_at: startedAt })
        .then(({ error }) => {
          if (error) console.error('log focus_session failed', error)
        })
    }
    prevRealPhaseRef.current = realRoom.timer_phase
  }, [realRoom, user, myStatus])

  // Chuông báo hết phase — tách khỏi effect ghi focus_sessions ở trên vì áp dụng cho cả host
  // lẫn member (ghi log thì chỉ member, host không có hàng trong room_members).
  const prevRealPhaseForSoundRef = useRef<Phase | null>(null)
  useEffect(() => {
    if (!realRoom) return
    const prevPhase = prevRealPhaseForSoundRef.current
    if (prevPhase !== null && prevPhase !== realRoom.timer_phase && notificationSound && (isHost || myStatus === 'member')) {
      playChime()
    }
    prevRealPhaseForSoundRef.current = realRoom.timer_phase
  }, [realRoom, isHost, myStatus, notificationSound])

  useEffect(() => {
    if (!realRoom || !user) return
    const uid = user.id
    let cancelled = false
    setMembersLoaded(false)

    function load() {
      supabase
        .from('room_members_view')
        .select('*')
        .eq('room_id', realRoom!.id)
        .then(({ data }) => {
          if (cancelled || !data) return
          const rows = data as RealMemberRow[]
          setMembers(
            rows
              .filter((r) => r.status === 'member')
              .map((r) => ({
                id: r.user_id,
                name: r.name,
                statusKey: 'focusing' as StatusKey,
                host: r.user_id === realRoom!.host_id,
                me: r.user_id === uid,
              })),
          )
          setPending(
            rows
              .filter((r) => r.status === 'pending')
              .map((r) => ({ id: r.id, userId: r.user_id, name: r.name, wait: relativeWait(r.joined_at, t) })),
          )
          const mine = rows.find((r) => r.user_id === uid)
          setMyStatus(mine ? mine.status : null)
          setMembersLoaded(true)
        })
    }
    load()

    const channel = supabase
      .channel('room-members-' + realRoom.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${realRoom.id}` },
        load,
      )
      .subscribe()

    return () => {
      cancelled = true
      channel.unsubscribe()
    }
  }, [realRoom, user, t])

  async function approveReal(p: Pending) {
    await supabase.from('room_members').update({ status: 'member' }).eq('id', p.id)
  }
  async function rejectReal(p: Pending) {
    await supabase.from('room_members').delete().eq('id', p.id)
  }
  async function kickReal(m: Member) {
    if (!realRoom) return
    await supabase.from('room_members').delete().eq('room_id', realRoom.id).eq('user_id', m.id)
  }
  async function setAdmitReal(next: Admit) {
    setAdmit(next)
    if (realRoom) await supabase.from('rooms').update({ admit_mode: next }).eq('id', realRoom.id)
  }
  async function leaveRoom() {
    if (isRealMode && user && realRoom) {
      await supabase.from('room_members').delete().eq('room_id', realRoom.id).eq('user_id', user.id)
    }
    navigate('/')
  }

  async function toggleRunningReal() {
    if (!realRoom) return
    const currentLeft = computeLeftFromRoom(realRoom)
    await supabase
      .from('rooms')
      .update({ timer_running: !realRoom.timer_running, timer_remaining_seconds: currentLeft, timer_updated_at: new Date().toISOString() })
      .eq('id', realRoom.id)
  }
  async function resetTimerReal() {
    if (!realRoom) return
    await supabase
      .from('rooms')
      .update({
        timer_running: false,
        timer_remaining_seconds: phaseTotalSeconds(realRoom, realRoom.timer_phase),
        timer_updated_at: new Date().toISOString(),
      })
      .eq('id', realRoom.id)
  }
  const flippingRef = useRef(false)
  const flipPhaseReal = useCallback(async () => {
    if (!realRoom || flippingRef.current) return
    flippingRef.current = true
    const nextPhase: Phase = realRoom.timer_phase === 'focus' ? 'break' : 'focus'
    const isFinalCompletion = nextPhase === 'focus' && realRoom.timer_round >= realRoom.session_count
    if (isFinalCompletion) {
      await supabase
        .from('rooms')
        .update({
          timer_running: false,
          timer_done: true,
          timer_remaining_seconds: 0,
          timer_updated_at: new Date().toISOString(),
        })
        .eq('id', realRoom.id)
      flippingRef.current = false
      return
    }
    await supabase
      .from('rooms')
      .update({
        timer_phase: nextPhase,
        timer_round: nextPhase === 'focus' ? realRoom.timer_round + 1 : realRoom.timer_round,
        timer_running: true,
        timer_remaining_seconds: phaseTotalSeconds(realRoom, nextPhase),
        timer_updated_at: new Date().toISOString(),
      })
      .eq('id', realRoom.id)
    flippingRef.current = false
  }, [realRoom])
  async function startNewRoundReal() {
    if (!realRoom) return
    await supabase
      .from('rooms')
      .update({
        timer_phase: 'focus',
        timer_round: 1,
        timer_done: false,
        timer_running: true,
        timer_remaining_seconds: phaseTotalSeconds(realRoom, 'focus'),
        timer_updated_at: new Date().toISOString(),
      })
      .eq('id', realRoom.id)
  }
  async function setMusicOnReal(next: boolean) {
    if (!realRoom) return
    await supabase.from('rooms').update({ music_on: next }).eq('id', realRoom.id)
  }
  async function setTrackIndexReal(next: number) {
    if (!realRoom) return
    await supabase.from('rooms').update({ music_track_index: next, music_on: true }).eq('id', realRoom.id)
  }

  useEffect(() => {
    if (!roomId || !user) return
    let cancelled = false
    supabase
      .from('room_messages_view')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at')
      .then(({ data }) => {
        if (cancelled || !data) return
        const rows = data as RealMsgRow[]
        setMessages(
          rows.map((m) => ({ who: m.user_id === user.id ? t('room.you') : m.name, me: m.user_id === user.id, text: m.text })),
        )
      })

    const channel = supabase
      .channel('room-messages-' + roomId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const row = payload.new as { user_id: string; text: string }
          if (row.user_id === user.id) return
          const senderName = membersRef.current.find((m) => m.id === row.user_id)?.name || t('room.unknownUser')
          setMessages((ms) => [...ms, { who: senderName, me: false, text: row.text }])
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      channel.unsubscribe()
    }
  }, [roomId, user, t])

  useEffect(() => {
    if (!roomId || !user) return
    const channel = supabase.channel('room-presence-' + roomId, { config: { presence: { key: user.id } } })
    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ online_at: new Date().toISOString() })
      })
    return () => {
      channel.unsubscribe()
    }
  }, [roomId, user])

  const lkRoomRef = useRef<LiveKitRoom | null>(null)
  const [videoTracks, setVideoTracks] = useState<Record<string, MediaStreamTrack>>({})
  const [audioTracks, setAudioTracks] = useState<Record<string, MediaStreamTrack>>({})
  const camRef = useRef(cam)
  camRef.current = cam
  const micRef = useRef(mic)
  micRef.current = mic

  // Connect to LiveKit only once actually admitted ('member', not 'pending') — mirrors
  // the same gate the livekit-token Edge Function enforces server-side.
  useEffect(() => {
    if (!isRealMode || !code || myStatus !== 'member') return
    let cancelled = false
    const lkRoom = new LiveKitRoom({ adaptiveStream: true, dynacast: true })
    lkRoomRef.current = lkRoom

    function setTrack(identity: string, track: Track) {
      if (track.kind === Track.Kind.Video) {
        setVideoTracks((m) => ({ ...m, [identity]: track.mediaStreamTrack }))
      } else if (track.kind === Track.Kind.Audio) {
        setAudioTracks((m) => ({ ...m, [identity]: track.mediaStreamTrack }))
      }
    }
    function clearTrack(identity: string, track: Track) {
      const key = track.kind === Track.Kind.Video ? 'video' : track.kind === Track.Kind.Audio ? 'audio' : null
      if (!key) return
      const setter = key === 'video' ? setVideoTracks : setAudioTracks
      setter((m) => {
        if (!(identity in m)) return m
        const next = { ...m }
        delete next[identity]
        return next
      })
    }

    lkRoom
      .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => setTrack(participant.identity, track))
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => clearTrack(participant.identity, track))
      .on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.track) setTrack(lkRoom.localParticipant.identity, pub.track)
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.track) clearTrack(lkRoom.localParticipant.identity, pub.track)
      })

    supabase.functions
      .invoke<{ token?: string; error?: string }>('livekit-token', { body: { code } })
      .then(async ({ data, error }) => {
        if (cancelled || error || !data?.token) return
        await lkRoom.connect(import.meta.env.VITE_LIVEKIT_URL, data.token)
        if (cancelled) {
          lkRoom.disconnect()
          return
        }
        await lkRoom.localParticipant.setCameraEnabled(
          camRef.current,
          preferredCameraIdRef.current ? { deviceId: preferredCameraIdRef.current } : undefined,
        )
        await lkRoom.localParticipant.setMicrophoneEnabled(
          micRef.current,
          preferredMicIdRef.current ? { deviceId: preferredMicIdRef.current } : undefined,
        )
      })

    return () => {
      cancelled = true
      lkRoom.disconnect()
      lkRoomRef.current = null
      setVideoTracks({})
      setAudioTracks({})
    }
  }, [isRealMode, code, myStatus])

  useEffect(() => {
    if (!isRealMode) return
    lkRoomRef.current?.localParticipant
      .setCameraEnabled(cam, preferredCameraId ? { deviceId: preferredCameraId } : undefined)
      .catch(() => {})
  }, [cam, isRealMode, preferredCameraId])
  useEffect(() => {
    if (!isRealMode) return
    lkRoomRef.current?.localParticipant
      .setMicrophoneEnabled(mic, preferredMicId ? { deviceId: preferredMicId } : undefined)
      .catch(() => {})
  }, [mic, isRealMode, preferredMicId])

  const runningRef = useRef(running)
  runningRef.current = running

  useEffect(() => {
    const id = setInterval(() => {
      if (isRealMode && realRoom) {
        const newLeft = computeLeftFromRoom(realRoom)
        setLeft(newLeft)
        if (newLeft <= 0 && realRoom.timer_running && isHost) flipPhaseReal()
        return
      }
      if (!runningRef.current) return
      setLeft((prevLeft) => {
        if (prevLeft <= 1) {
          setPhase((prevPhase) => {
            const next: Phase = prevPhase === 'focus' ? 'break' : 'focus'
            const isFinalCompletion = next === 'focus' && roundRef.current >= SESSION_COUNT_DEFAULT
            if (next === 'focus' && !isFinalCompletion) setRound((r) => r + 1)
            if (isFinalCompletion) {
              setDone(true)
              setRunning(false)
              return prevPhase
            }
            return next
          })
          return 0
        }
        return prevLeft - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [isRealMode, realRoom, isHost, flipPhaseReal])

  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (isRealMode) {
      prevPhaseRef.current = phase
      return
    }
    if (prevPhaseRef.current !== phase) {
      setLeft(phase === 'focus' ? focusSecs() : breakSecs())
      prevPhaseRef.current = phase
    }
  }, [phase, isRealMode])

  const total = isRealMode && realRoom ? phaseTotalSeconds(realRoom, phase) : phase === 'focus' ? focusSecs() : breakSecs()
  const sessionCount = isRealMode && realRoom ? realRoom.session_count : SESSION_COUNT_DEFAULT
  const progress = Math.min(1, Math.max(0, 1 - left / total))
  const dashOffset = 270.2 * (1 - progress)
  const m = Math.floor(left / 60)
  const s = left % 60
  const timeText = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')

  const queued = admit === 'manual' && pending.length > 0
  const effectiveTab: Tab = tab === 'host' && !isHost ? 'chat' : tab
  const currentTrack = tracks[trackIndex] || tracks[0]
  const n = Math.max(1, members.length)
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)

  const syncLabel =
    members.length > 2
      ? t('room.sync.withCount', { count: members.length - 1 })
      : t('room.sync.withName', { name: members.find((u) => !u.me)?.name || t('room.sync.fallbackRoom') })

  function openTab(next: Tab) {
    setChatOpen((open) => !(open && tab === next))
    setTab(next)
  }

  function resetTimer() {
    if (isRealMode) {
      resetTimerReal()
      return
    }
    setLeft(total)
    setRunning(false)
  }
  function startNewRound() {
    if (isRealMode) {
      startNewRoundReal()
      return
    }
    setPhase('focus')
    setRound(1)
    setDone(false)
    setLeft(focusSecs())
    setRunning(true)
  }
  function toggleRunning() {
    if (isRealMode) {
      toggleRunningReal()
      return
    }
    setRunning((r) => !r)
  }

  function approve(p: Pending) {
    if (isRealMode) {
      approveReal(p)
      return
    }
    setPending((ps) => ps.filter((x) => x.id !== p.id))
    setMembers((ms) => [...ms, { id: p.id, name: p.name, statusKey: 'justJoined', host: false }])
  }
  function reject(p: Pending) {
    if (isRealMode) {
      rejectReal(p)
      return
    }
    setPending((ps) => ps.filter((x) => x.id !== p.id))
  }
  function approveAll() {
    if (isRealMode) {
      pending.forEach((p) => approveReal(p))
      return
    }
    setMembers((ms) => [
      ...ms,
      ...pending.map((p) => ({ id: p.id, name: p.name, statusKey: 'justJoined' as StatusKey, host: false })),
    ])
    setPending([])
  }
  function kick(u: Member) {
    if (isRealMode) {
      kickReal(u)
      return
    }
    setMembers((ms) => ms.filter((x) => x.id !== u.id))
  }

  function send() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    if (isRealMode && realRoom && user) {
      setMessages((ms) => [...ms, { who: t('room.you'), me: true, text }])
      supabase.from('room_messages').insert({ room_id: realRoom.id, user_id: user.id, text }).then(() => {})
      return
    }
    setMessages((ms) => [...ms, { who: t('room.you'), me: true, text }])
  }

  const tiles = members.map((u) => {
    const me = !!u.me
    const online = !isRealMode || me || onlineIds.has(u.id)
    const videoTrack = isRealMode ? videoTracks[u.id] : undefined
    const audioTrack = isRealMode && !me ? audioTracks[u.id] : undefined
    const camOff = me ? !cam : isRealMode ? !videoTrack : u.statusKey === 'camOff'
    const displayStatusKey: StatusKey = isRealMode && !me ? (audioTrack ? 'focusing' : 'micOff') : u.statusKey
    const displayStatusLabel =
      isRealMode && !me ? (!online ? t('room.status.offline') : statusLabel(displayStatusKey)) : statusLabel(u.statusKey)
    return {
      id: u.id,
      name: u.name,
      initials: initials(u.name),
      status: me ? (mic ? t('room.status.micOn') : t('room.status.micOff')) : displayStatusLabel,
      statusColor: me ? (mic ? '#2c5b53' : 'rgba(51,71,94,0.45)') : online ? 'rgba(51,71,94,0.45)' : 'rgba(51,71,94,0.3)',
      feedLabel: camOff ? t('room.camOffFeed') : t('room.webcamOf', { name: u.name }),
      videoTrack: camOff ? undefined : videoTrack,
      audioTrack,
      avatarBg: me ? 'rgba(140,205,196,0.55)' : 'rgba(160,200,225,0.5)',
      avatarColor: me ? '#22483f' : '#2b4d68',
      tileBorder: me ? '2.5px solid rgba(126,201,198,0.95)' : '2px solid rgba(140,205,196,0.45)',
      tileShadow: me ? '0 14px 32px rgba(58,98,126,0.18)' : '0 10px 24px rgba(58,98,126,0.1)',
      self: me,
    }
  })

  if (user && loadingRoom) {
    return (
      <div
        className="flex h-svh w-full items-center justify-center font-sans text-[15px] font-bold text-[rgba(51,71,94,0.55)]"
        style={{ background: 'var(--ff-page-gradient)' }}
      >
        {t('room.loadingRoom')}
      </div>
    )
  }

  if (isRealMode && membersLoaded && myStatus === null) {
    return (
      <div
        className="relative flex h-svh w-full items-center justify-center overflow-hidden px-6 font-sans text-[#33475e] antialiased"
        style={{ background: 'var(--ff-page-gradient)' }}
      >
        <div
          className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-[30px] px-8 py-9 text-center"
          style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(22px)', boxShadow: '0 22px 56px rgba(58,98,126,0.15)' }}
        >
          <h2 className="m-0 text-xl font-extrabold text-[#2c3f55]">{t('room.notJoined.title')}</h2>
          <p className="mt-2 mb-0 text-[13.5px] font-semibold text-[rgba(51,71,94,0.55)]">
            {t('room.notJoined.desc')}
          </p>
          <button
            onClick={() => navigate('/matching')}
            className="rounded-[20px] border-none px-6 py-[13px] font-sans text-[14.5px] font-extrabold text-[#1e3549]"
            style={{ background: 'var(--ff-accent-soft)' }}
          >
            {t('room.notJoined.goToMatching')}
          </button>
        </div>
      </div>
    )
  }

  if (isRealMode && myStatus === 'pending') {
    return (
      <div
        className="relative flex h-svh w-full items-center justify-center overflow-hidden px-6 font-sans text-[#33475e] antialiased"
        style={{ background: 'var(--ff-page-gradient)' }}
      >
        <div
          className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-[30px] px-8 py-9 text-center"
          style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(22px)', boxShadow: '0 22px 56px rgba(58,98,126,0.15)' }}
        >
          <span
            className="flex h-[54px] w-[54px] items-center justify-center rounded-full text-[#7a4a2c]"
            style={{ background: 'rgba(226,190,150,0.4)' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <div>
            <h2 className="m-0 text-xl font-extrabold text-[#2c3f55]">{t('room.waitingApproval.title')}</h2>
            <p className="mt-2 mb-0 text-[13.5px] font-semibold text-[rgba(51,71,94,0.55)]">
              {t('room.waitingApproval.desc', { name: realRoom?.name })}
            </p>
          </div>
          <button
            onClick={leaveRoom}
            className="rounded-[20px] border-none px-6 py-[13px] font-sans text-[14.5px] font-extrabold text-[#43596f]"
            style={{ background: 'rgba(240,248,250,0.9)' }}
          >
            {t('room.waitingApproval.cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative h-svh w-full overflow-hidden font-sans text-[#33475e] antialiased"
      style={{ background: 'var(--ff-page-gradient)' }}
    >
      {/* top bar */}
      <div className="absolute top-[22px] right-[26px] left-[26px] z-[42] flex flex-wrap items-center justify-between gap-[10px]">
        <div
          className="flex items-center gap-[11px] rounded-[22px] py-[9px] pr-[18px] pl-[13px]"
          style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(16px)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)' }}
        >
          <div className="h-5 w-5 rounded-lg" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))' }} />
          <span className="text-base font-extrabold tracking-[-0.2px] text-[#2f4459]">{t('app.name')}</span>
          <span className="text-[13px] font-semibold text-[rgba(51,71,94,0.5)]">
            · {t('room.headerTag')}
          </span>
        </div>
        <div className="flex items-center gap-[10px]">
          {!isRealMode && (
            <div
              className="flex items-center gap-[5px] rounded-[20px] p-[5px]"
              style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(16px)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)' }}
            >
              {(['two', 'five'] as Demo[]).map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setDemo(key)
                    setMembers(demoSets[key].slice())
                  }}
                  className="rounded-[15px] border-none px-[14px] py-2 font-sans text-[12.5px] font-extrabold transition-all duration-[220ms]"
                  style={segStyle(demo === key)}
                >
                  {t(`room.demo.${key}`)}
                </button>
              ))}
            </div>
          )}
          <div
            className="flex items-center gap-[9px] rounded-[20px] px-[17px] py-[9px]"
            style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(16px)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)' }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: 'oklch(0.76 0.09 170)' }} />
            <span className="text-[13.5px] font-bold text-[#35566b]">{syncLabel}</span>
          </div>
        </div>
      </div>

      {/* video stage */}
      <div
        className={`absolute inset-0 py-[84px] pr-[26px] pl-[26px] transition-[padding] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${chatOpen ? 'md:pr-[392px]' : 'md:pr-[26px]'}`}
      >
        <div
          className="relative h-full w-full overflow-hidden rounded-[34px] p-4"
          style={{
            border: '2px solid rgba(140,205,196,0.4)',
            boxShadow: '0 22px 56px rgba(58,98,126,0.15)',
            background: 'repeating-linear-gradient(135deg, #dbe9ef 0 14px, #d2e3ea 14px 28px)',
          }}
        >
          <div
            className="grid h-full w-full gap-[14px]"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
              placeContent: 'stretch',
            }}
          >
            {tiles.map((tile) => (
              <div
                key={tile.id}
                className="relative m-auto w-full max-w-full overflow-hidden rounded-[24px]"
                style={{
                  maxHeight: '100%',
                  aspectRatio: '16 / 9',
                  border: tile.tileBorder,
                  boxShadow: tile.tileShadow,
                  background: 'repeating-linear-gradient(135deg, #e3eef2 0 12px, #dae8ee 12px 24px)',
                }}
              >
                {tile.videoTrack ? (
                  <TrackMediaEl track={tile.videoTrack} kind="video" mirror={tile.self} />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-[6px]">
                    <span
                      className="rounded-[11px] px-3 py-[7px] font-mono text-xs tracking-[0.5px] text-[rgba(51,71,94,0.5)]"
                      style={{ background: 'rgba(255,255,255,0.7)' }}
                    >
                      {tile.feedLabel}
                    </span>
                  </div>
                )}
                {tile.audioTrack && <TrackMediaEl track={tile.audioTrack} kind="audio" />}
                <div
                  className="absolute top-3 left-3 flex items-center gap-2 rounded-[18px] py-[6px] pr-[13px] pl-[7px]"
                  style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(14px)', boxShadow: '0 5px 15px rgba(58,98,126,0.1)' }}
                >
                  <span
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-[10px] text-[11.5px] font-extrabold"
                    style={{ background: tile.avatarBg, color: tile.avatarColor }}
                  >
                    {tile.initials}
                  </span>
                  <span className="text-[13px] font-extrabold text-[#2c3f55]">{tile.name}</span>
                  <span className="text-[11.5px] font-bold" style={{ color: tile.statusColor }}>
                    {tile.status}
                  </span>
                </div>
                {tile.self && (
                  <span
                    className="absolute top-[14px] right-[14px] flex items-center gap-[6px] rounded-full px-[11px] py-[5px] text-[11px] font-extrabold tracking-[0.4px] text-[#22483f]"
                    style={{ background: 'rgba(255,255,255,0.82)' }}
                  >
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'oklch(0.72 0.11 165)' }} />
                    {t('room.you')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* floating pomodoro */}
      <div
        className="absolute top-[106px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-[18px] rounded-[30px] py-[14px] pr-6 pl-4"
        style={{ background: 'rgba(255,255,255,0.62)', backdropFilter: 'blur(18px)', boxShadow: '0 16px 40px rgba(58,98,126,0.16)' }}
      >
        <div className="relative flex h-[92px] w-[92px] items-center justify-center">
          <svg viewBox="0 0 100 100" className="absolute h-[92px] w-[92px]" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="50" cy="50" r="43" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="8" />
            <circle
              cx="50"
              cy="50"
              r="43"
              fill="none"
              stroke={ACCENT}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="270.2"
              style={{ strokeDashoffset: dashOffset, transition: 'stroke-dashoffset 980ms linear' }}
            />
          </svg>
          <span className="relative text-xl font-extrabold text-[#2c3f55] tabular-nums">
            {done ? '🎉' : timeText}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-px">
            <span className="text-xs font-extrabold tracking-[1.2px] text-[rgba(51,71,94,0.5)] uppercase">
              {done
                ? t('room.pomodoro.doneTitle')
                : phase === 'focus'
                  ? t('room.pomodoro.focusing')
                  : t('room.pomodoro.onBreak')}
            </span>
            <span className="text-[13.5px] font-bold text-[#2c3f55]">
              {done
                ? t('room.pomodoro.doneHint', { count: sessionCount })
                : t('room.pomodoro.sessionBoth', { round, total: sessionCount })}
            </span>
          </div>
          <div className="flex gap-[7px]">
            {done ? (
              <button
                onClick={startNewRound}
                disabled={isRealMode && !isHost}
                className="rounded-2xl border-none px-[18px] py-[9px] font-sans text-[13px] font-extrabold text-[#1e3549] transition-transform duration-200 hover:enabled:-translate-y-px disabled:opacity-50"
                style={{ background: ACCENT_SOFT }}
              >
                {t('room.pomodoro.newRound')}
              </button>
            ) : (
              <>
                <button
                  onClick={toggleRunning}
                  disabled={isRealMode && !isHost}
                  className="rounded-2xl border-none px-[18px] py-[9px] font-sans text-[13px] font-extrabold text-[#1e3549] transition-transform duration-200 hover:enabled:-translate-y-px disabled:opacity-50"
                  style={{ background: ACCENT_SOFT }}
                >
                  {running ? t('room.pomodoro.pause') : t('room.pomodoro.resume')}
                </button>
                <button
                  onClick={resetTimer}
                  disabled={isRealMode && !isHost}
                  className="rounded-2xl border-none px-4 py-[9px] font-sans text-[13px] font-bold text-[#4a637d] hover:enabled:!bg-white disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.7)' }}
                >
                  {t('room.pomodoro.reset')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* bottom controls */}
      <div
        className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-[26px] p-[8px] md:bottom-7 md:max-w-none md:gap-2 md:p-[10px]"
        style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 34px rgba(58,98,126,0.15)' }}
      >
        <button
          onClick={() => setCam((c) => !c)}
          title={cam ? t('room.controls.camera') : t('room.controls.cameraOff')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold transition-all duration-[220ms] hover:brightness-[1.03] md:px-5"
          style={{ background: cam ? 'rgba(255,255,255,0.4)' : 'rgba(206,222,232,0.85)', color: cam ? '#354c65' : 'rgba(51,71,94,0.62)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <rect x="2.5" y="6.5" width="13" height="11" rx="3.5" />
            <path d="M15.5 11.5l6-3v7l-6-3z" />
            <path d={cam ? 'M12 12' : 'M3 20L21 4'} />
          </svg>
          <span className="hidden md:inline">{cam ? t('room.controls.camera') : t('room.controls.cameraOff')}</span>
        </button>
        <button
          onClick={() => setMic((v) => !v)}
          title={mic ? t('room.controls.mic') : t('room.controls.micOff')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold transition-all duration-[220ms] hover:brightness-[1.03] md:px-5"
          style={{ background: mic ? 'rgba(255,255,255,0.4)' : 'rgba(206,222,232,0.85)', color: mic ? '#354c65' : 'rgba(51,71,94,0.62)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 12a6.5 6.5 0 0013 0M12 18.5V21" />
            <path d={mic ? 'M12 12' : 'M3 20L21 4'} />
          </svg>
          <span className="hidden md:inline">{mic ? t('room.controls.mic') : t('room.controls.micOff')}</span>
        </button>
        <button
          onClick={() => openTab('chat')}
          title={t('room.controls.chat')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-all duration-[220ms] hover:!bg-[rgba(255,255,255,0.95)] md:px-5"
          style={{ background: chatOpen && effectiveTab === 'chat' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5-1 0-2-.15-2.9-.42L4.5 20l1.1-3.3A6.7 6.7 0 014 12.5C4 8.9 7.6 6 12 6s8 2.9 8 6.5z" />
          </svg>
          <span className="hidden md:inline">{t('room.controls.chat')}</span>
        </button>
        <button
          onClick={() => openTab('music')}
          title={t('room.controls.music')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-all duration-[220ms] hover:!bg-[rgba(255,255,255,0.95)] md:px-5"
          style={{ background: chatOpen && effectiveTab === 'music' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M9 18V6l10-2v12" />
            <circle cx="6.5" cy="18" r="2.6" />
            <circle cx="19" cy="16" r="2.6" />
          </svg>
          <span className="hidden md:inline">{t('room.controls.music')}</span>
        </button>
        {isHost && (
          <button
            onClick={() => openTab('host')}
            title={t('room.controls.manage')}
            className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-all duration-[220ms] hover:!bg-[rgba(255,255,255,0.95)] md:px-5"
            style={{ background: chatOpen && effectiveTab === 'host' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 19c.9-3 3.3-4.4 6-4.4S14.1 16 15 19" />
              <circle cx="9" cy="8.5" r="3.2" />
              <path d="M17 4.5l1.15 2.4 2.6.36-1.9 1.82.46 2.58L17 10.44l-2.31 1.22.46-2.58-1.9-1.82 2.6-.36z" />
            </svg>
            <span className="hidden md:inline">{t('room.controls.manage')}</span>
            {queued && (
              <span
                className="rounded-full px-2 py-[2px] text-xs font-extrabold text-[#7a4a2c]"
                style={{ background: 'oklch(0.87 0.075 55)' }}
              >
                {pending.length}
              </span>
            )}
          </button>
        )}
        <div className="mx-1 h-[26px] w-px shrink-0" style={{ background: 'rgba(51,71,94,0.13)' }} />
        <button
          onClick={leaveRoom}
          title={t('room.controls.leave')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-extrabold text-[#7a3f2c] transition-all duration-[220ms] hover:brightness-95 md:px-[22px]"
          style={{ background: 'oklch(0.86 0.055 45)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M15 5.5V4a2 2 0 00-2-2H6a2 2 0 00-2 2v16a2 2 0 002 2h7a2 2 0 002-2v-1.5" />
            <path d="M11 12h10m-3.5-3.5L21 12l-3.5 3.5" />
          </svg>
          <span className="hidden md:inline">{t('room.controls.leave')}</span>
        </button>
      </div>

      {/* side panel — bottom sheet on mobile, side panel on md+ */}
      <div
        className={`fixed inset-x-3 bottom-[112px] z-[28] flex max-h-[60vh] flex-col gap-[14px] rounded-[26px] p-[18px] md:absolute md:inset-x-auto md:top-[84px] md:right-[26px] md:max-h-none md:w-[340px] md:rounded-[30px] ${
          chatOpen ? 'translate-y-0 md:translate-x-0' : 'translate-y-[calc(100%+24px)] md:translate-y-0 md:translate-x-[380px]'
        }`}
        style={{
          background: 'rgba(255,255,255,0.84)',
          backdropFilter: 'blur(22px)',
          boxShadow: '0 18px 46px rgba(58,98,126,0.15)',
          opacity: chatOpen ? 1 : 0,
          pointerEvents: chatOpen ? 'auto' : 'none',
          transition: 'transform 440ms cubic-bezier(0.22,1,0.36,1), opacity 340ms ease',
        }}
      >
        <div className="mx-auto -mt-1 mb-1 h-1 w-9 shrink-0 rounded-full bg-[rgba(51,71,94,0.16)] md:hidden" />
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-[5px] rounded-[20px] p-[5px]" style={{ background: 'rgba(238,246,248,0.9)' }}>
            {(
              [
                { key: 'chat' as Tab, name: t('room.controls.chat'), show: true, badge: '' },
                { key: 'music' as Tab, name: t('room.controls.music'), show: true, badge: '' },
                {
                  key: 'host' as Tab,
                  name: t('room.controls.manage'),
                  show: isHost,
                  badge: queued ? String(pending.length) : '',
                },
              ] as const
            ).map(
              (x) =>
                x.show && (
                  <button
                    key={x.key}
                    onClick={() => setTab(x.key)}
                    className="flex flex-1 items-center justify-center gap-[7px] rounded-2xl border-none px-[6px] py-[9px] font-sans text-[13px] font-extrabold transition-all duration-[220ms]"
                    style={segStyle(effectiveTab === x.key)}
                  >
                    {x.name}
                    {x.badge && (
                      <span
                        className="rounded-full px-[7px] py-[2px] text-[11px] font-extrabold text-[#7a4a2c]"
                        style={{ background: 'oklch(0.87 0.075 55)' }}
                      >
                        {x.badge}
                      </span>
                    )}
                  </button>
                ),
            )}
          </div>
          <button
            onClick={() => setChatOpen(false)}
            className="border-none bg-transparent px-1 py-[6px] font-sans text-[13px] font-bold text-[rgba(51,71,94,0.5)]"
          >
            {t('room.panel.collapse')}
          </button>
        </div>

        {/* tab: chat */}
        {effectiveTab === 'chat' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-1 flex-col gap-[9px] overflow-y-auto">
              {messages.map((msg, i) => (
                <div key={i} className="flex max-w-[84%] flex-col gap-[3px]" style={{ alignSelf: msg.me ? 'flex-end' : 'flex-start' }}>
                  <span className="pl-1 text-[11.5px] font-bold text-[rgba(51,71,94,0.42)]">{msg.who}</span>
                  <span
                    className="rounded-[18px] px-[14px] py-[11px] text-[13.5px] leading-[1.5] font-semibold text-[#2c3f55]"
                    style={{ background: msg.me ? 'color-mix(in oklab, var(--ff-accent) 26%, white)' : 'rgba(238,246,248,0.95)' }}
                  >
                    {msg.text}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="flex items-center gap-2 rounded-[20px] py-[5px] pr-[5px] pl-[15px]"
              style={{ background: 'rgba(255,255,255,0.9)', boxShadow: '0 4px 14px rgba(58,98,126,0.08)' }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                }}
                placeholder={t('room.panel.chatPlaceholder')}
                className="min-w-0 flex-1 border-none bg-transparent py-[10px] font-sans text-[13.5px] font-semibold text-[#2c3f55] outline-none"
              />
              <button
                onClick={send}
                className="rounded-[15px] border-none px-4 py-[10px] font-sans text-[13px] font-extrabold text-[#1e3549]"
                style={{ background: ACCENT_SOFT }}
              >
                {t('room.panel.send')}
              </button>
            </div>
          </div>
        )}

        {/* tab: music */}
        {effectiveTab === 'music' && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="flex items-center gap-[13px] rounded-[24px] px-4 py-[15px]" style={{ background: 'rgba(238,246,248,0.9)' }}>
              <span className="flex h-[30px] w-[34px] shrink-0 items-end gap-[3px]">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-full flex-1 rounded-[3px]"
                    style={{
                      background: musicOn ? 'color-mix(in oklab, var(--ff-accent) 78%, white)' : 'rgba(51,71,94,0.18)',
                      transformOrigin: 'bottom',
                      animation: musicOn ? `ffEq 900ms ease-in-out infinite ${i * 300}ms` : 'none',
                    }}
                  />
                ))}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="text-sm font-extrabold text-[#2c3f55]">{currentTrack.name}</span>
                <span className="text-xs font-semibold text-[rgba(51,71,94,0.5)]">
                  {musicOn ? t('room.music.playing', { mood: currentTrack.mood }) : t('room.music.paused')}
                </span>
              </div>
              <button
                onClick={() => (isRealMode ? setMusicOnReal(!musicOn) : setMusicOn((v) => !v))}
                disabled={isRealMode && !isHost}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] border-none text-[#1e3549] hover:enabled:brightness-[0.97] disabled:opacity-50"
                style={{ background: ACCENT_SOFT }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d={musicOn ? 'M8 5h3.2v14H8zM12.8 5H16v14h-3.2z' : 'M8 5l11 7-11 7z'} />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-[11px]">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(51,71,94,0.45)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 9.5h3.5L13 5.5v13L8.5 14.5H5z" />
                <path d={volume === 0 ? 'M16.5 9.5l4 5m0-5l-4 5' : 'M16.5 9a4 4 0 010 6'} />
              </svg>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="ff-range min-w-0 flex-1"
              />
              <span className="w-[34px] text-right text-[12.5px] font-extrabold text-[rgba(51,71,94,0.55)]">{volume}%</span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-[10px]">
                <span className="text-xs font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                  {t('room.music.playlist')}
                </span>
                <span className="text-xs font-semibold text-[rgba(51,71,94,0.45)]">
                  {isHost ? t('room.music.broadcastToRoom') : t('room.music.onlyYouHear')}
                </span>
              </div>
              {tracks.map((track, i) => {
                const on = i === trackIndex
                return (
                  <button
                    key={TRACK_KEYS[i]}
                    onClick={() => {
                      if (isRealMode) {
                        setTrackIndexReal(i)
                        return
                      }
                      setTrackIndex(i)
                      setMusicOn(true)
                    }}
                    disabled={isRealMode && !isHost}
                    className="flex items-center gap-[11px] rounded-[20px] border-none px-[13px] py-[11px] text-left font-sans transition-all duration-200 hover:enabled:brightness-[0.98] disabled:cursor-default disabled:opacity-70"
                    style={{
                      background: on ? 'color-mix(in oklab, var(--ff-accent) 20%, white)' : 'rgba(238,246,248,0.8)',
                      boxShadow: on ? 'inset 0 0 0 1.5px color-mix(in oklab, var(--ff-accent) 55%, white)' : 'none',
                    }}
                  >
                    <span
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[11px]"
                      style={{ background: on ? 'rgba(255,255,255,0.85)' : 'rgba(160,200,225,0.35)', color: on ? '#22483f' : '#2b4d68' }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                        <path d="M9 18V6l10-2v12" />
                        <circle cx="6.5" cy="18" r="2.6" />
                        <circle cx="19" cy="16" r="2.6" />
                      </svg>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13.5px] font-extrabold" style={{ color: on ? '#22483f' : '#2c3f55' }}>
                        {track.name}
                      </span>
                      <span className="text-[11.5px] font-semibold text-[rgba(51,71,94,0.48)]">{track.mood}</span>
                    </span>
                    <span className="text-[11.5px] font-extrabold text-[rgba(51,71,94,0.42)]">{track.length}</span>
                  </button>
                )
              })}
            </div>

            <span className="text-[12.5px] leading-[1.5] font-semibold text-[rgba(51,71,94,0.5)]">
              {isHost ? t('room.music.hostNote') : t('room.music.memberNote')}
            </span>
          </div>
        )}

        {/* tab: host */}
        {effectiveTab === 'host' && isHost && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="flex flex-col gap-[9px]">
              <span className="text-xs font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                {t('room.host.admitMode')}
              </span>
              <div className="flex gap-[7px] rounded-[20px] p-[5px]" style={{ background: 'rgba(238,246,248,0.9)' }}>
                {(['auto', 'manual'] as Admit[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setAdmitReal(key)}
                    className="flex-1 rounded-2xl border-none px-[6px] py-[10px] font-sans text-[13px] font-extrabold transition-all duration-[220ms]"
                    style={segStyle(admit === key)}
                  >
                    {key === 'auto' ? t('room.host.autoAdmit') : t('room.host.manualAdmit')}
                  </button>
                ))}
              </div>
              <span className="text-[12.5px] leading-[1.5] font-semibold text-[rgba(51,71,94,0.58)]">
                {admit === 'auto' ? t('room.host.autoAdmitDesc') : t('room.host.manualAdmitDesc')}
              </span>
            </div>

            {admit === 'manual' && (
              <div className="flex flex-col gap-[9px]">
                <div className="flex items-baseline justify-between gap-[10px]">
                  <span className="text-xs font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                    {t('room.host.queueTitle')}
                  </span>
                  {pending.length > 1 && (
                    <button
                      onClick={approveAll}
                      className="border-none bg-transparent font-sans text-[12.5px] font-extrabold text-[#2c5b53]"
                    >
                      {t('room.host.approveAll')}
                    </button>
                  )}
                </div>
                {pending.length === 0 ? (
                  <span
                    className="rounded-[18px] p-[14px] text-center text-[13px] font-semibold text-[rgba(51,71,94,0.45)]"
                    style={{ background: 'rgba(238,246,248,0.8)' }}
                  >
                    {t('room.host.emptyQueue')}
                  </span>
                ) : (
                  pending.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-[10px] rounded-[20px] px-3 py-[10px]"
                      style={{ background: 'rgba(255,246,238,0.9)', boxShadow: 'inset 0 0 0 1.5px rgba(196,142,96,0.18)' }}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[12.5px] font-extrabold text-[#7a4a2c]"
                        style={{ background: 'rgba(226,190,150,0.45)' }}
                      >
                        {initials(p.name)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[13.5px] font-extrabold text-[#2c3f55]">{p.name}</span>
                        <span className="text-[11.5px] font-semibold text-[rgba(51,71,94,0.5)]">
                          {t('room.host.waitPrefix', { wait: p.wait })}
                        </span>
                      </div>
                      <button
                        onClick={() => approve(p)}
                        title={t('room.host.approveTitle')}
                        className="rounded-[14px] border-none px-[13px] py-2 font-sans text-[12.5px] font-extrabold text-[#1e3549] hover:brightness-[0.97]"
                        style={{ background: ACCENT_SOFT }}
                      >
                        {t('room.host.approve')}
                      </button>
                      <button
                        onClick={() => reject(p)}
                        title={t('room.host.rejectTitle')}
                        className="rounded-[14px] border-none px-[11px] py-2 font-sans text-[12.5px] font-extrabold text-[rgba(51,71,94,0.55)] hover:!text-[#7a3f2c]"
                        style={{ background: 'rgba(255,255,255,0.9)' }}
                      >
                        {t('room.host.reject')}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="flex flex-col gap-[9px]">
              <span className="text-xs font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                {t('room.host.membersInRoom', { count: members.length })}
              </span>
              {members.map((u) => (
                <div key={u.id} className="flex items-center gap-[10px] rounded-[20px] px-3 py-[10px]" style={{ background: 'rgba(238,246,248,0.85)' }}>
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[12.5px] font-extrabold"
                    style={{
                      background: u.host ? 'rgba(140,205,196,0.5)' : 'rgba(160,200,225,0.5)',
                      color: u.host ? '#22483f' : '#2b4d68',
                    }}
                  >
                    {initials(u.name)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13.5px] font-extrabold text-[#2c3f55]">{u.name}</span>
                    <span className="text-[11.5px] font-semibold text-[rgba(51,71,94,0.5)]">
                      {statusLabel(u.statusKey)}
                    </span>
                  </div>
                  {isHost && !u.host && (
                    <button
                      onClick={() => kick(u)}
                      className="rounded-[14px] border-none px-[13px] py-2 font-sans text-[12.5px] font-extrabold text-[#7a3f2c] hover:!bg-[oklch(0.86_0.055_45)]"
                      style={{ background: 'oklch(0.9 0.045 45)' }}
                    >
                      {t('room.host.kick')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
