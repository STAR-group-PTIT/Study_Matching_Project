import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Màn "Kiểm tra trước khi vào phòng" — xem trước camera (gương) + thanh đo mic thật
// trước khi connect LiveKit, để user chủ động biết thiết bị mình đang ổn hay không
// (Giai đoạn 9). Nếu trình duyệt từ chối quyền thì vẫn cho phép vào phòng — LiveKit
// sẽ tự xử lý phần còn lại. Toggle cam/mic ở đây dùng chung state với phòng, nên lựa
// chọn cuối cùng áp dụng luôn khi vào.
export default function DeviceCheck({
  cameraOn,
  micOn,
  onToggleCam,
  onToggleMic,
  onDone,
}: {
  cameraOn: boolean
  micOn: boolean
  onToggleCam: () => void
  onToggleMic: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [level, setLevel] = useState(0)
  const [permissionError, setPermissionError] = useState('')

  useEffect(() => {
    let cancelled = false
    let raf = 0
    let audioCtx: AudioContext | null = null

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: cameraOn, audio: micOn })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current?.getTracks().forEach((tr) => tr.stop())
        streamRef.current = stream
        setPermissionError('')

        const videoTrack = stream.getVideoTracks()[0]
        if (videoRef.current && videoTrack) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        } else if (videoRef.current) {
          videoRef.current.srcObject = null
        }

        const audioTrack = stream.getAudioTracks()[0]
        if (audioTrack) {
          audioCtx = new AudioContext()
          const source = audioCtx.createMediaStreamSource(stream)
          const analyser = audioCtx.createAnalyser()
          analyser.fftSize = 256
          source.connect(analyser)
          const data = new Uint8Array(analyser.frequencyBinCount)
          const tick = () => {
            analyser.getByteTimeDomainData(data)
            let peak = 0
            for (let i = 0; i < data.length; i++) {
              const v = Math.abs(data[i] - 128) / 128
              if (v > peak) peak = v
            }
            setLevel(Math.min(1, peak * 1.8))
            raf = requestAnimationFrame(tick)
          }
          tick()
        } else {
          setLevel(0)
        }
      } catch {
        if (cancelled) return
        setPermissionError(t('room.deviceCheck.denied'))
        setLevel(0)
        streamRef.current = null
        if (videoRef.current) videoRef.current.srcObject = null
      }
    }
    void setup()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      audioCtx?.close().catch(() => {})
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
      setLevel(0)
    }
  }, [cameraOn, micOn, t])

  return (
    <div
      className="relative flex h-svh w-full items-center justify-center overflow-hidden px-6 font-sans text-[#33475e] antialiased"
      style={{ background: 'var(--ff-page-gradient)' }}
    >
      <div className="flex w-full max-w-[420px] flex-col items-center gap-5 rounded-[30px] px-8 pt-8 pb-7 text-center">
        <div className="flex flex-col gap-[6px]">
          <h2 className="m-0 text-[22px] font-extrabold tracking-[-0.4px] text-[#2c3f55]">
            {t('room.deviceCheck.title')}
          </h2>
          <p className="m-0 text-[13.5px] leading-[1.55] font-semibold text-[rgba(51,71,94,0.55)]">
            {t('room.deviceCheck.subtitle')}
          </p>
        </div>

        {/* camera preview (gương) + thanh đo mic */}
        <div
          className="relative flex h-[200px] w-full items-center justify-center overflow-hidden rounded-[22px]"
          style={{
            background: 'rgba(44,63,85,0.85)',
            boxShadow: '0 16px 38px rgba(58,98,126,0.18)',
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className={`h-full w-full object-cover ${cameraOn ? 'scale-x-[-1]' : 'hidden'}`}
          />
          {!cameraOn && (
            <span className="flex flex-col items-center gap-[8px] text-[13px] font-bold text-[rgba(255,255,255,0.72)]">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <rect x="2.5" y="6.5" width="13" height="11" rx="3.5" />
                <path d="M15.5 11.5l6-3v7l-6-3z" />
                <path d="M3 20L21 4" />
              </svg>
              {t('room.deviceCheck.cameraOff')}
            </span>
          )}

          {/* thanh đo mic — nhảy theo âm lượng thật qua AnalyserNode */}
          <div className="absolute right-3 bottom-3 left-3 flex items-center gap-[8px] rounded-[14px] bg-[rgba(20,32,44,0.55)] px-3 py-[9px] backdrop-blur-[4px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" className="shrink-0">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11.5a6.5 6.5 0 0013 0" />
              <path d="M12 18v3" />
            </svg>
            <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.18)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(4, level * 100)}%`,
                  background: level > 0.75 ? 'rgba(255,158,120,0.95)' : 'rgba(126,201,198,0.95)',
                  transition: 'width 80ms linear',
                }}
              />
            </div>
          </div>
        </div>

        {permissionError && (
          <span className="w-full rounded-[16px] px-4 py-3 text-[12.5px] font-bold text-[#7a4a2c]">
            {permissionError}
          </span>
        )}

        {/* toggle cam/mic — cùng state với control bar trong phòng */}
        <div className="flex gap-[10px]">
          <button
            onClick={onToggleCam}
            className="flex items-center gap-[8px] rounded-[19px] border-none px-5 py-[11px] font-sans text-[13.5px] font-extrabold transition-colors duration-[220ms]"
            style={
              cameraOn
                ? { background: 'rgba(140,205,196,0.4)', color: '#2c5b53' }
                : { background: 'rgba(206,222,232,0.85)', color: 'rgba(51,71,94,0.62)' }
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <rect x="2.5" y="6.5" width="13" height="11" rx="3.5" />
              <path d="M15.5 11.5l6-3v7l-6-3z" />
              <path d={cameraOn ? 'M12 12' : 'M3 20L21 4'} />
            </svg>
            {cameraOn ? t('room.controls.camera') : t('room.controls.cameraOff')}
          </button>
          <button
            onClick={onToggleMic}
            className="flex items-center gap-[8px] rounded-[19px] border-none px-5 py-[11px] font-sans text-[13.5px] font-extrabold transition-colors duration-[220ms]"
            style={
              micOn
                ? { background: 'rgba(140,205,196,0.4)', color: '#2c5b53' }
                : { background: 'rgba(206,222,232,0.85)', color: 'rgba(51,71,94,0.62)' }
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11.5a6.5 6.5 0 0013 0" />
              <path d="M12 18v3" />
              <path d={micOn ? 'M3 20L21 4' : ''} />
            </svg>
            {micOn ? t('room.controls.mic') : t('room.controls.micOff')}
          </button>
        </div>

        <button
          onClick={onDone}
          className="w-full rounded-[22px] border-none py-[15px] font-sans text-base font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5"
          style={{ background: 'var(--ff-accent-soft)', boxShadow: '0 12px 26px rgba(58,98,126,0.16)' }}
        >
          {t('room.deviceCheck.enter')}
        </button>
      </div>
    </div>
  )
}
