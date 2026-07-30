import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

const WALLPAPERS = [
  'linear-gradient(160deg, #dff1f4 0%, #cfe6f2 45%, #e6f4ee 100%)',
  'linear-gradient(150deg, #e8f4f0 0%, #d5e9f4 100%)',
  'linear-gradient(200deg, #d9ecf5 0%, #eaf5f1 60%, #dceef0 100%)',
  'linear-gradient(135deg, #eef3f8 0%, #dbeaf0 50%, #cfe4e6 100%)',
  'radial-gradient(120% 100% at 20% 10%, #e9f6f2 0%, #d3e6f0 70%)',
  'linear-gradient(175deg, #f0f6f7 0%, #d8eaf0 55%, #cde5df 100%)',
]

const TRACKS = [
  'Mưa nhẹ ngoài cửa sổ',
  'Lo-fi bàn học',
  'Tiếng quán cà phê',
  'Sóng biển chậm',
  'Nhiễu trắng mềm',
]

const FOCUS_MINUTES = 25
const BREAK_MINUTES = 5
const ACCENT = 'var(--ff-accent)'

type Phase = 'focus' | 'break'
type Mode = 'dashboard' | 'focus'
type Panel = 'wp' | 'music' | 'todo' | null

type Task = {
  id: string
  name: string
  meta: string
  done: boolean
}

const INITIAL_TASKS: Task[] = [
  { id: 'g1', name: 'Ôn chương 4 – Đạo hàm', meta: '2 phiên · Toán', done: false },
  { id: 'g2', name: 'Làm 10 câu trắc nghiệm Lý', meta: '1 phiên · Vật lý', done: false },
  { id: 'g3', name: 'Đọc bài Reading Unit 7', meta: '1 phiên · Anh', done: true },
  { id: 'g4', name: 'Ghi chú lại lỗi sai đề thi thử', meta: '2 phiên · Ôn tập', done: false },
]

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

export default function Dashboard() {
  const user = useAuthStore((s) => s.user)
  const [mode, setMode] = useState<Mode>('dashboard')
  const [hidden, setHidden] = useState(false)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<Phase>('focus')
  const [left, setLeft] = useState(FOCUS_MINUTES * 60)
  const [round, setRound] = useState(1)
  const [focusedMinutes, setFocusedMinutes] = useState(75)
  const [wp, setWp] = useState(0)
  const [panel, setPanel] = useState<Panel>(null)
  const [cameraOn, setCameraOn] = useState(true)
  const [track, setTrack] = useState(1)
  const [playing, setPlaying] = useState(true)
  const [draft, setDraft] = useState('')
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS)

  // Pomodoro defaults — 25/5 cho khách, ghi đè bằng profile thật khi đăng nhập (xem effect bên dưới).
  const [focusMin, setFocusMin] = useState(FOCUS_MINUTES)
  const [breakMin, setBreakMin] = useState(BREAK_MINUTES)
  const [autoStart, setAutoStart] = useState(true)

  const runningRef = useRef(running)
  runningRef.current = running
  const focusMinRef = useRef(focusMin)
  focusMinRef.current = focusMin
  const breakMinRef = useRef(breakMin)
  breakMinRef.current = breakMin
  const autoStartRef = useRef(autoStart)
  autoStartRef.current = autoStart
  const userRef = useRef(user)
  userRef.current = user
  const phaseStartRef = useRef(Date.now())

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('focus_minutes, break_minutes, auto_start_next')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data) return
        setFocusMin(data.focus_minutes)
        setBreakMin(data.break_minutes)
        setAutoStart(data.auto_start_next)
      })
  }, [user])

  useEffect(() => {
    const id = setInterval(() => {
      if (!runningRef.current) return
      setLeft((prevLeft) => {
        if (prevLeft <= 1) {
          setPhase((prevPhase) => {
            const next: Phase = prevPhase === 'focus' ? 'break' : 'focus'
            const completedMinutes = prevPhase === 'focus' ? focusMinRef.current : breakMinRef.current
            if (next === 'focus') setRound((r) => r + 1)
            if (prevPhase === 'focus') setFocusedMinutes((m) => m + completedMinutes)
            const uid = userRef.current?.id
            if (uid) {
              supabase
                .from('focus_sessions')
                .insert({
                  user_id: uid,
                  phase: prevPhase,
                  minutes: completedMinutes,
                  started_at: new Date(phaseStartRef.current).toISOString(),
                })
                .then(({ error }) => {
                  if (error) console.error('log focus_session failed', error)
                })
            }
            setRunning(autoStartRef.current)
            return next
          })
          return 0 // placeholder, replaced right after via phase effect below
        }
        return prevLeft - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // when phase flips (either by timer completion or skip), snap `left` to the new phase's duration.
  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      setLeft(phase === 'focus' ? focusMin * 60 : breakMin * 60)
      prevPhaseRef.current = phase
      phaseStartRef.current = Date.now()
    }
  }, [phase, focusMin, breakMin])

  // logged in → load real todos from Supabase; guest → keep the local mock list untouched.
  useEffect(() => {
    if (!user) {
      setTasks(INITIAL_TASKS)
      return
    }
    let cancelled = false
    supabase
      .from('todos')
      .select('id, name, meta, done')
      .order('created_at')
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        setTasks(data.map((row) => ({ id: row.id, name: row.name, meta: row.meta ?? '', done: row.done })))
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const total = phase === 'focus' ? focusMin * 60 : breakMin * 60
  const progress = Math.min(1, Math.max(0, 1 - left / total))
  const dashOffset = 917.3 * (1 - progress)

  const isFocus = mode === 'focus'
  const chromeVisible = !hidden
  const dashVisible = !hidden && !isFocus

  const openCount = tasks.filter((t) => !t.done).length
  const active = tasks.find((t) => !t.done)

  function toggleRun() {
    setRunning((r) => !r)
  }
  function resetTimer() {
    setLeft(total)
    setRunning(false)
    phaseStartRef.current = Date.now()
  }
  function skipPhase() {
    setPhase((p) => (p === 'focus' ? 'break' : 'focus'))
    setRunning(false)
  }

  function togglePanel(p: Exclude<Panel, null>) {
    setPanel((cur) => (cur === p ? null : p))
  }

  async function addTask() {
    const name = draft.trim()
    if (!name) return
    setDraft('')
    if (!user) {
      setTasks((t) => [...t, { id: 'g' + Date.now(), name, meta: '1 phiên · Mới', done: false }])
      return
    }
    const { data, error } = await supabase
      .from('todos')
      .insert({ user_id: user.id, name, meta: '1 phiên · Mới' })
      .select('id, name, meta, done')
      .single()
    if (!error && data) {
      setTasks((t) => [...t, { id: data.id, name: data.name, meta: data.meta ?? '', done: data.done }])
    }
  }

  function toggleTask(t: Task) {
    const nextDone = !t.done
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: nextDone } : x)))
    if (user) {
      supabase
        .from('todos')
        .update({ done: nextDone, completed_at: nextDone ? new Date().toISOString() : null })
        .eq('id', t.id)
        .then(({ error }) => {
          if (error) console.error('toggle todo failed', error)
        })
    }
  }

  const chromeStyle = {
    opacity: chromeVisible ? 1 : 0,
    transform: `translateY(${chromeVisible ? '0px' : '-12px'})`,
    pointerEvents: chromeVisible ? ('auto' as const) : ('none' as const),
    transition: 'opacity 480ms ease, transform 480ms ease',
  }
  const dashStyleBase = {
    opacity: dashVisible ? 1 : 0,
    pointerEvents: dashVisible ? ('auto' as const) : ('none' as const),
  }

  return (
    <div
      className="relative h-svh w-full overflow-hidden font-sans text-[#33475e] antialiased"
      style={{ background: WALLPAPERS[wp], transition: 'background 900ms ease' }}
    >
      <div
        className="absolute inset-0"
        style={{ backdropFilter: 'blur(2px)', background: 'rgba(255,255,255,0.14)' }}
      />

      {/* top bar */}
      <div className="absolute top-[26px] right-8 left-8 z-40 flex flex-wrap items-center justify-between gap-4">
        <div
          className="flex items-center gap-[11px] rounded-[22px] py-[9px] pr-[18px] pl-[13px]"
          style={{
            ...chromeStyle,
            background: 'rgba(255,255,255,0.6)',
            boxShadow: '0 6px 20px rgba(64,102,128,0.09)',
            backdropFilter: 'blur(14px)',
          }}
        >
          <div
            className="h-5 w-5 rounded-lg"
            style={{
              background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))',
            }}
          />
          <span className="text-base font-extrabold tracking-[-0.2px] text-[#2f4459]">
            FocusFlow
          </span>
          <span className="text-[13px] font-semibold text-[rgba(51,71,94,0.5)]">
            · {hidden ? 'Zen' : isFocus ? 'Focus mode' : 'Dashboard mode'}
          </span>
        </div>

        <div className="flex items-center gap-[10px]">
          {!user && (
            <Link
              to="/auth"
              className="rounded-[18px] px-4 py-[10px] font-sans text-[13px] font-extrabold text-[#1e3549] no-underline"
              style={{
                ...chromeStyle,
                background: 'var(--ff-accent-soft)',
                boxShadow: '0 6px 20px rgba(64,102,128,0.09)',
              }}
            >
              Đăng nhập
            </Link>
          )}
          <div
            className="flex gap-1 rounded-[20px] p-[5px]"
            style={{
              ...chromeStyle,
              background: 'rgba(255,255,255,0.6)',
              boxShadow: '0 6px 20px rgba(64,102,128,0.09)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <button
              onClick={() => {
                setMode('focus')
                setPanel(null)
                setHidden(false)
              }}
              className="rounded-[15px] border-none px-4 py-2 font-sans text-[13px] font-bold transition-all duration-[260ms]"
              style={{
                background: isFocus ? 'rgba(255,255,255,0.95)' : 'transparent',
                color: isFocus ? '#25415c' : 'rgba(51,71,94,0.55)',
              }}
            >
              Focus
            </button>
            <button
              onClick={() => {
                setMode('dashboard')
                setHidden(false)
              }}
              className="rounded-[15px] border-none px-4 py-2 font-sans text-[13px] font-bold transition-all duration-[260ms]"
              style={{
                background: !isFocus ? 'rgba(255,255,255,0.95)' : 'transparent',
                color: !isFocus ? '#25415c' : 'rgba(51,71,94,0.55)',
              }}
            >
              Dashboard
            </button>
          </div>
          <button
            onClick={() => {
              setHidden((h) => !h)
              setPanel(null)
            }}
            title="Ẩn / hiện giao diện"
            className="flex items-center gap-2 rounded-[18px] border-none px-[15px] py-[10px] font-sans text-[13px] font-bold text-[#3c5470] transition-all duration-[400ms] hover:!bg-[rgba(255,255,255,0.85)] hover:!opacity-100"
            style={{
              background: `rgba(255,255,255,${hidden ? 0.32 : 0.6})`,
              boxShadow: '0 6px 18px rgba(64,102,128,0.1)',
              backdropFilter: 'blur(14px)',
              opacity: hidden ? 0.42 : 1,
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            >
              <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
              <circle cx="12" cy="12" r="2.6" />
              <path d={hidden ? 'M4 20L20 4' : 'M12 12'} />
            </svg>
            <span>{hidden ? 'Hiện UI' : 'Ẩn UI'}</span>
          </button>
        </div>
      </div>

      {/* clock */}
      <div
        className="relative flex h-full flex-col items-center justify-center px-6 pt-[104px] pb-[152px]"
        style={{ gap: 'clamp(14px, 3vh, 24px)' }}
      >
        <div
          className="relative flex items-center justify-center"
          style={{
            transform: `scale(${isFocus || hidden ? 1 : 0.78})`,
            transition: 'transform 620ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          <div
            className="absolute rounded-full"
            style={{
              width: 'min(380px, 46vh)',
              height: 'min(380px, 46vh)',
              background: 'rgba(255,255,255,0.42)',
              backdropFilter: 'blur(18px)',
              boxShadow: '0 24px 70px rgba(58,98,126,0.14)',
            }}
          />
          <svg
            viewBox="0 0 330 330"
            className="relative"
            style={{
              width: 'min(330px, 40vh)',
              height: 'min(330px, 40vh)',
              transform: 'rotate(-90deg)',
            }}
          >
            <circle
              cx="165"
              cy="165"
              r="146"
              fill="none"
              stroke="rgba(255,255,255,0.65)"
              strokeWidth="14"
            />
            <circle
              cx="165"
              cy="165"
              r="146"
              fill="none"
              stroke={ACCENT}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray="917.3"
              style={{ strokeDashoffset: dashOffset, transition: 'stroke-dashoffset 980ms linear' }}
            />
          </svg>
          <div className="absolute flex flex-col items-center gap-[6px]">
            <span className="text-[13px] font-bold tracking-[1.6px] text-[rgba(51,71,94,0.55)] uppercase">
              {phase === 'focus' ? 'Đang tập trung' : 'Nghỉ ngắn'}
            </span>
            <span
              className="leading-none font-extrabold text-[#2c3f55] tabular-nums"
              style={{ fontSize: 'clamp(44px, 9.5vh, 82px)', letterSpacing: '-3px' }}
            >
              {fmt(left)}
            </span>
            <span className="text-[13px] font-semibold text-[rgba(51,71,94,0.5)]">
              Phiên {round} / 4
            </span>
          </div>
        </div>

        <div
          className="flex items-center gap-3"
          style={{
            opacity: chromeVisible ? 1 : 0,
            pointerEvents: chromeVisible ? 'auto' : 'none',
            transition: 'opacity 480ms ease',
          }}
        >
          <button
            onClick={toggleRun}
            className="rounded-[22px] border-none px-[42px] font-sans text-base font-extrabold tracking-[0.2px] text-[#21384f] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(58,98,126,0.18)]"
            style={{
              paddingTop: 'clamp(11px, 2.4vh, 15px)',
              paddingBottom: 'clamp(11px, 2.4vh, 15px)',
              background: 'rgba(255,255,255,0.82)',
              boxShadow: '0 10px 26px rgba(58,98,126,0.14)',
            }}
          >
            {running ? 'Tạm dừng' : left === total ? 'Bắt đầu' : 'Tiếp tục'}
          </button>
          <button
            onClick={resetTimer}
            className="rounded-[22px] border-none px-[26px] py-[15px] font-sans text-[15px] font-bold text-[#4a637d] transition-colors duration-200 hover:!bg-[rgba(255,255,255,0.75)]"
            style={{ background: 'rgba(255,255,255,0.5)', boxShadow: '0 8px 20px rgba(58,98,126,0.09)' }}
          >
            Reset
          </button>
          <button
            onClick={skipPhase}
            className="rounded-[22px] border-none px-[26px] py-[15px] font-sans text-[15px] font-bold text-[#4a637d] transition-colors duration-200 hover:!bg-[rgba(255,255,255,0.75)]"
            style={{ background: 'rgba(255,255,255,0.5)', boxShadow: '0 8px 20px rgba(58,98,126,0.09)' }}
          >
            {phase === 'focus' ? 'Nghỉ ngắn' : 'Học tiếp'}
          </button>
        </div>
      </div>

      {/* left widgets — hidden on mobile (would overlap the right column at narrow widths) */}
      <div
        className="absolute top-24 left-8 hidden w-[232px] flex-col gap-[14px] md:flex"
        style={{
          ...dashStyleBase,
          transform: `translateX(${dashVisible ? '0px' : '-24px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div
          className="rounded-[24px] px-5 py-[18px]"
          style={{
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 10px 28px rgba(58,98,126,0.1)',
          }}
        >
          <div className="mb-3 text-xs font-bold tracking-[1.2px] text-[rgba(51,71,94,0.5)] uppercase">
            Hôm nay
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[34px] leading-none font-extrabold text-[#2c3f55]">
              {focusedMinutes}
            </span>
            <span className="text-sm font-semibold text-[rgba(51,71,94,0.55)]">
              phút tập trung
            </span>
          </div>
          <div className="mt-4 flex gap-[6px]">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[7px] flex-1 rounded-full"
                style={{ background: i < round ? ACCENT : 'rgba(51,71,94,0.13)' }}
              />
            ))}
          </div>
        </div>
        <div
          className="rounded-[24px] px-5 py-[18px]"
          style={{
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 10px 28px rgba(58,98,126,0.1)',
          }}
        >
          <div className="mb-[10px] text-xs font-bold tracking-[1.2px] text-[rgba(51,71,94,0.5)] uppercase">
            Đang làm
          </div>
          <div className="text-[15px] leading-[1.4] font-bold text-[#2c3f55]">
            {active ? active.name : 'Xong hết việc hôm nay 🎉'}
          </div>
          <div className="mt-[6px] text-[13px] font-semibold text-[rgba(51,71,94,0.5)]">
            {openCount} việc còn lại · {tasks.length - openCount} đã xong
          </div>
        </div>
      </div>

      {/* right column — hidden on mobile, see left widgets comment */}
      <div
        className="absolute top-24 right-8 z-20 hidden w-[248px] flex-col gap-[14px] md:flex"
        style={{
          ...dashStyleBase,
          transform: `translateX(${dashVisible ? '0px' : '24px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div
          className="rounded-[24px] p-3"
          style={{
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 10px 28px rgba(58,98,126,0.1)',
          }}
        >
          <div
            className="relative flex h-[148px] items-center justify-center overflow-hidden rounded-[18px]"
            style={{
              background: 'linear-gradient(150deg, oklch(0.86 0.045 205), oklch(0.79 0.055 235))',
            }}
          >
            <div
              className="flex flex-col items-center gap-2 text-[rgba(255,255,255,0.9)]"
              style={{ opacity: cameraOn ? 0.95 : 0.5 }}
            >
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              >
                <circle cx="12" cy="9" r="3.4" />
                <path d="M5 19.5c1.3-3 4-4.4 7-4.4s5.7 1.4 7 4.4" />
              </svg>
              <span className="text-xs font-bold">
                {cameraOn ? 'Camera đang bật' : 'Camera đang tắt'}
              </span>
            </div>
            <div
              className="absolute top-[10px] left-[10px] flex items-center gap-[6px] rounded-full px-[9px] py-1 text-[11px] font-extrabold tracking-[0.4px] text-[#2c3f55]"
              style={{ background: 'rgba(255,255,255,0.82)' }}
            >
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ background: cameraOn ? '#4bbf9a' : 'rgba(51,71,94,0.28)' }}
              />
              Bạn
            </div>
          </div>
          <button
            onClick={() => setCameraOn((c) => !c)}
            className="mt-[10px] w-full rounded-[15px] border-none py-[10px] font-sans text-[13px] font-extrabold text-[#2c3f55] transition-colors duration-[220ms] hover:!bg-white"
            style={{ background: 'rgba(255,255,255,0.72)' }}
          >
            {cameraOn ? 'Tắt camera' : 'Bật camera'}
          </button>
        </div>

        <Link
          to="/matching"
          className="flex items-center gap-3 rounded-[24px] px-[18px] py-[15px] text-inherit no-underline transition-[transform,background] duration-[220ms] hover:!bg-white hover:!-translate-y-0.5"
          style={{
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 12px 30px rgba(58,98,126,0.14)',
          }}
        >
          <span
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] text-[#2c5b53]"
            style={{ background: 'rgba(140,205,196,0.32)' }}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            >
              <circle cx="9" cy="8.5" r="3.2" />
              <path d="M3 19c.9-3 3.3-4.4 6-4.4S14.1 16 15 19" />
              <path d="M16.4 5.6a3.2 3.2 0 010 5.8" />
              <path d="M18.6 14.9c1.4.8 2.3 2.2 2.6 4.1" />
            </svg>
          </span>
          <span className="flex flex-col gap-[2px]">
            <span className="text-sm font-extrabold text-[#2c3f55]">Học cùng nhau</span>
            <span className="text-xs font-semibold text-[rgba(51,71,94,0.55)]">
              Tìm bạn học online
            </span>
          </span>
        </Link>
      </div>

      {/* taskbar */}
      <div
        className="absolute bottom-[34px] left-1/2 flex max-w-[calc(100vw-24px)] items-center gap-1 overflow-x-auto rounded-[26px] p-[8px] md:max-w-none md:gap-2 md:p-[10px]"
        style={{
          ...dashStyleBase,
          background: 'rgba(255,255,255,0.66)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px rgba(58,98,126,0.14)',
          transform: `translate(-50%, ${dashVisible ? '0px' : '26px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <button
          onClick={() => togglePanel('wp')}
          title="Đổi hình nền"
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:px-5"
          style={{ background: panel === 'wp' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)' }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <rect x="3" y="4" width="18" height="16" rx="4" />
            <circle cx="9" cy="10" r="1.8" />
            <path d="M4 18l5.5-5 4 3.4 3-2.4L20 18" />
          </svg>
          <span className="hidden md:inline">Hình nền</span>
        </button>
        <button
          onClick={() => togglePanel('music')}
          title="Nhạc nền"
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:px-5"
          style={{
            background: panel === 'music' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)',
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <circle cx="7" cy="17" r="3" />
            <circle cx="18" cy="15" r="3" />
            <path d="M10 17V6l11-2v11" />
          </svg>
          <span className="hidden md:inline">Nhạc nền</span>
        </button>
        <button
          onClick={() => togglePanel('todo')}
          title="Danh sách việc"
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:px-5"
          style={{ background: panel === 'todo' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)' }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <path d="M4 7.5l2 2 3-3.5" />
            <path d="M4 16.5l2 2 3-3.5" />
            <path d="M13 8h7" />
            <path d="M13 17h7" />
          </svg>
          <span className="hidden md:inline">To-do</span>
          <span
            className="rounded-full px-2 py-[2px] text-xs font-extrabold text-[#2c5b53]"
            style={{ background: 'rgba(120,190,180,0.28)' }}
          >
            {openCount}
          </span>
        </button>
        <Link
          to="/matching"
          title="Học cùng nhau"
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] no-underline transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:hidden"
          style={{ background: 'rgba(255,255,255,0.35)' }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <circle cx="9" cy="8.5" r="3.2" />
            <path d="M3 19c.9-3 3.3-4.4 6-4.4S14.1 16 15 19" />
            <path d="M16.4 5.6a3.2 3.2 0 010 5.8" />
            <path d="M18.6 14.9c1.4.8 2.3 2.2 2.6 4.1" />
          </svg>
        </Link>
      </div>

      {/* wallpaper popup */}
      <div
        className="absolute bottom-[108px] left-1/2 w-[340px] rounded-[26px] p-5"
        style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 18px 44px rgba(58,98,126,0.16)',
          opacity: panel === 'wp' ? 1 : 0,
          transform: `translate(-50%, ${panel === 'wp' ? '0px' : '14px'})`,
          pointerEvents: panel === 'wp' ? 'auto' : 'none',
          transition: 'opacity 320ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div className="mb-[14px] flex items-center justify-between">
          <span className="text-[15px] font-extrabold text-[#2c3f55]">Hình nền</span>
          <button
            onClick={() => setPanel(null)}
            className="border-none bg-transparent font-sans text-[13px] font-bold text-[rgba(51,71,94,0.5)]"
          >
            Đóng
          </button>
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          {WALLPAPERS.map((css, i) => (
            <button
              key={i}
              onClick={() => setWp(i)}
              className="h-[66px] rounded-[18px] transition-transform duration-200 hover:!-translate-y-0.5"
              style={{
                background: css,
                border: i === wp ? `2px solid ${ACCENT}` : '2px solid rgba(255,255,255,0.7)',
                boxShadow: '0 4px 12px rgba(58,98,126,0.1)',
              }}
            />
          ))}
        </div>
        <div className="mt-[14px] text-xs font-semibold text-[rgba(51,71,94,0.5)]">
          Kéo ảnh của bạn vào đây để dùng làm hình nền riêng.
        </div>
      </div>

      {/* music popup */}
      <div
        className="absolute bottom-[108px] left-1/2 w-[320px] rounded-[26px] p-5"
        style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 18px 44px rgba(58,98,126,0.16)',
          opacity: panel === 'music' ? 1 : 0,
          transform: `translate(-50%, ${panel === 'music' ? '0px' : '14px'})`,
          pointerEvents: panel === 'music' ? 'auto' : 'none',
          transition: 'opacity 320ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div className="mb-[14px] flex items-center justify-between">
          <span className="text-[15px] font-extrabold text-[#2c3f55]">Nhạc nền</span>
          <button
            onClick={() => setPanel(null)}
            className="border-none bg-transparent font-sans text-[13px] font-bold text-[rgba(51,71,94,0.5)]"
          >
            Đóng
          </button>
        </div>
        <div className="flex flex-col gap-[6px]">
          {TRACKS.map((name, i) => (
            <button
              key={name}
              onClick={() => {
                setTrack(i)
                setPlaying(true)
              }}
              className="flex items-center justify-between gap-3 rounded-[17px] border-none px-[14px] py-3 text-left font-sans transition-colors duration-200 hover:!bg-[rgba(140,200,205,0.16)]"
              style={{ background: i === track ? 'rgba(140,200,205,0.22)' : 'rgba(255,255,255,0.55)' }}
            >
              <span className="text-sm font-bold text-[#2f4459]">{name}</span>
              <span className="text-xs font-semibold text-[rgba(51,71,94,0.45)]">
                {i === track ? (playing ? 'đang phát' : 'đã chọn') : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded-2xl border-none px-[18px] py-[10px] font-sans text-[13px] font-extrabold text-[#21384f]"
            style={{ background: 'rgba(140,205,196,0.35)' }}
          >
            {playing ? 'Tạm dừng nhạc' : 'Phát nhạc'}
          </button>
          <div
            className="relative h-[6px] flex-1 rounded-full"
            style={{ background: 'rgba(51,71,94,0.12)' }}
          >
            <div
              className="absolute top-0 bottom-0 left-0 rounded-full"
              style={{ width: '62%', background: ACCENT }}
            />
          </div>
        </div>
      </div>

      {/* todo slide-out */}
      <div
        className="absolute top-0 right-0 bottom-0 z-30 flex w-[352px] flex-col gap-4 px-[26px] pt-24 pb-[34px]"
        style={{
          background: 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(22px)',
          boxShadow: '-18px 0 50px rgba(58,98,126,0.14)',
          borderTopLeftRadius: 32,
          borderBottomLeftRadius: 32,
          transform: `translateX(${panel === 'todo' ? '0px' : '380px'})`,
          opacity: panel === 'todo' ? 1 : 0,
          pointerEvents: panel === 'todo' ? 'auto' : 'none',
          transition: 'transform 460ms cubic-bezier(0.22,1,0.36,1), opacity 360ms ease',
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xl font-extrabold text-[#2c3f55]">Việc cần làm</span>
          <button
            onClick={() => setPanel(null)}
            className="border-none bg-transparent font-sans text-[13px] font-bold text-[rgba(51,71,94,0.5)]"
          >
            Đóng
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {tasks.map((t) => (
            <div
              key={t.id}
              onClick={() => toggleTask(t)}
              className="flex cursor-pointer items-center gap-[13px] rounded-[20px] px-[15px] py-[14px] transition-colors duration-200 hover:!bg-[rgba(255,255,255,0.95)]"
              style={{ background: 'rgba(255,255,255,0.66)', boxShadow: '0 4px 14px rgba(58,98,126,0.07)' }}
            >
              <div
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg"
                style={{
                  border: t.done ? `2px solid ${ACCENT}` : '2px solid rgba(51,71,94,0.18)',
                  background: t.done ? ACCENT : 'rgba(255,255,255,0.9)',
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  style={{ opacity: t.done ? 1 : 0 }}
                >
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
              </div>
              <div className="flex flex-col gap-[2px]">
                <span
                  className="text-sm font-bold"
                  style={{
                    color: t.done ? 'rgba(51,71,94,0.42)' : '#2c3f55',
                    textDecoration: t.done ? 'line-through' : 'none',
                  }}
                >
                  {t.name}
                </span>
                <span className="text-xs font-semibold text-[rgba(51,71,94,0.42)]">{t.meta}</span>
              </div>
            </div>
          ))}
        </div>
        <div
          className="flex items-center gap-[10px] rounded-[20px] py-[6px] pr-[6px] pl-4"
          style={{ background: 'rgba(255,255,255,0.7)', boxShadow: '0 4px 14px rgba(58,98,126,0.07)' }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTask()
            }}
            placeholder="Thêm việc mới…"
            className="flex-1 border-none bg-transparent py-[10px] font-sans text-sm font-semibold text-[#2c3f55] outline-none"
          />
          <button
            onClick={addTask}
            className="rounded-2xl border-none px-[18px] py-[10px] font-sans text-sm font-extrabold text-[#21384f]"
            style={{ background: 'rgba(140,205,196,0.38)' }}
          >
            Thêm
          </button>
        </div>
      </div>
    </div>
  )
}
