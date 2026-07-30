import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'

type Tab = 'login' | 'signup'

const PERK_ICONS = [
  { key: 'todo', bg: 'rgba(140,205,196,0.3)', icon: 'M4 7.5l2 2 3-3.5M4 16.5l2 2 3-3.5M13 8h7M13 17h7' },
  {
    key: 'wallpaper',
    bg: 'rgba(160,200,225,0.32)',
    icon: 'M3 6a3 3 0 013-3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3z M4 18l5.5-5 4 3.4 3-2.4L20 18',
  },
  {
    key: 'matching',
    bg: 'rgba(150,210,205,0.3)',
    icon: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M17 8a2.6 2.6 0 010 5M19 20c0-2-.7-3.4-2-4.4',
  },
] as const

function tabStyle(on: boolean) {
  return {
    background: on ? 'rgba(255,255,255,0.98)' : 'transparent',
    color: on ? '#25415c' : 'rgba(51,71,94,0.55)',
    boxShadow: on ? '0 4px 12px rgba(58,98,126,0.1)' : 'none',
  }
}

function translateAuthError(message: string, t: (key: string) => string) {
  if (message.includes('Invalid login credentials')) return t('auth.errors.invalidCredentials')
  if (message.includes('User already registered')) return t('auth.errors.alreadyRegistered')
  if (message.includes('Password should be at least')) return t('auth.errors.shortPassword')
  if (message.includes('Unable to validate email address') || message.includes('is invalid'))
    return t('auth.errors.invalidEmail')
  if (message.includes('rate limit')) return t('auth.errors.rateLimit')
  return message
}

export default function Auth() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('login')
  const [showPw, setShowPw] = useState(false)
  const [fade, setFade] = useState(1)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isLogin = tab === 'login'

  function switchTo(next: Tab) {
    if (next === tab) return
    setError(null)
    setNotice(null)
    setFade(0)
    setTimeout(() => {
      setTab(next)
      setFade(1)
    }, 160)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        navigate('/')
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name: name.trim() || undefined } },
        })
        if (error) throw error
        if (data.session) {
          navigate('/')
        } else {
          // "Confirm email" is on for this project — no session until the user clicks the link.
          setNotice(t('auth.notice.confirmEmail', { email }))
        }
      }
    } catch (err) {
      setError(translateAuthError(err instanceof Error ? err.message : String(err), t))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGoogle() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(translateAuthError(error.message, t))
  }

  return (
    <div
      className="relative min-h-svh w-full overflow-hidden font-sans text-[#33475e] antialiased"
      style={{ background: 'var(--ff-page-gradient)' }}
    >
      <div
        className="absolute inset-0"
        style={{ backdropFilter: 'blur(3px)', background: 'rgba(255,255,255,0.18)' }}
      />

      <div className="relative flex min-h-svh flex-col items-center justify-center gap-[22px] px-6 pt-12 pb-10">
        <div className="flex items-center gap-[11px]">
          <div
            className="h-[22px] w-[22px] rounded-[9px]"
            style={{
              background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))',
            }}
          />
          <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[#2f4459]">
            {t('app.name')}
          </span>
        </div>

        <div className="flex w-full max-w-[900px] flex-wrap items-stretch justify-center gap-5">
          {/* card */}
          <div
            className="flex-[1_1_380px] rounded-[32px] px-8 pt-[30px] pb-8"
            style={{
              maxWidth: 456,
              background: 'rgba(255,255,255,0.78)',
              backdropFilter: 'blur(22px)',
              boxShadow: '0 20px 52px rgba(58,98,126,0.13)',
            }}
          >
            <div
              className="flex gap-1 rounded-[20px] p-[5px]"
              style={{ background: 'rgba(238,246,248,0.9)' }}
            >
              <button
                onClick={() => switchTo('login')}
                className="flex-1 rounded-2xl border-none py-[11px] font-sans text-sm font-bold transition-all duration-[280ms]"
                style={tabStyle(isLogin)}
              >
                {t('auth.tabs.login')}
              </button>
              <button
                onClick={() => switchTo('signup')}
                className="flex-1 rounded-2xl border-none py-[11px] font-sans text-sm font-bold transition-all duration-[280ms]"
                style={tabStyle(!isLogin)}
              >
                {t('auth.tabs.signup')}
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="mt-6 transition-[opacity,transform] duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ opacity: fade, transform: fade ? 'translateY(0px)' : 'translateY(6px)' }}
            >
              <h1 className="m-0 text-2xl font-extrabold tracking-[-0.4px] text-[#2c3f55]">
                {isLogin ? t('auth.title.login') : t('auth.title.signup')}
              </h1>
              <p className="mt-[7px] mb-0 text-sm leading-[1.55] font-semibold text-[rgba(51,71,94,0.58)]">
                {isLogin ? t('auth.subtitle.login') : t('auth.subtitle.signup')}
              </p>

              <div className="mt-[22px] flex flex-col gap-3">
                {!isLogin && (
                  <label className="flex flex-col gap-[7px]">
                    <span className="text-[12.5px] font-bold tracking-[0.3px] text-[rgba(51,71,94,0.62)]">
                      {t('auth.name.label')}
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('auth.name.placeholder')}
                      className="rounded-[18px] border-[1.5px] border-[rgba(51,71,94,0.12)] bg-[rgba(255,255,255,0.9)] px-4 py-[14px] font-sans text-[15px] font-semibold text-[#2c3f55] outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-semibold placeholder:text-[rgba(51,71,94,0.38)] focus:border-[rgba(126,201,198,0.9)] focus:shadow-[0_0_0_4px_rgba(126,201,198,0.18)]"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-[7px]">
                  <span className="text-[12.5px] font-bold tracking-[0.3px] text-[rgba(51,71,94,0.62)]">
                    {t('auth.email.label')}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder={t('auth.email.placeholder')}
                    className="rounded-[18px] border-[1.5px] border-[rgba(51,71,94,0.12)] bg-[rgba(255,255,255,0.9)] px-4 py-[14px] font-sans text-[15px] font-semibold text-[#2c3f55] outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-semibold placeholder:text-[rgba(51,71,94,0.38)] focus:border-[rgba(126,201,198,0.9)] focus:shadow-[0_0_0_4px_rgba(126,201,198,0.18)]"
                  />
                </label>
                <label className="flex flex-col gap-[7px]">
                  <span className="text-[12.5px] font-bold tracking-[0.3px] text-[rgba(51,71,94,0.62)]">
                    {t('auth.password.label')}
                  </span>
                  <div className="relative flex items-center">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder={t('auth.password.placeholder')}
                      className="flex-1 rounded-[18px] border-[1.5px] border-[rgba(51,71,94,0.12)] bg-[rgba(255,255,255,0.9)] py-[14px] pr-[82px] pl-4 font-sans text-[15px] font-semibold text-[#2c3f55] outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-semibold placeholder:text-[rgba(51,71,94,0.38)] focus:border-[rgba(126,201,198,0.9)] focus:shadow-[0_0_0_4px_rgba(126,201,198,0.18)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-2 rounded-[13px] border-none px-3 py-2 font-sans text-[12.5px] font-bold text-[rgba(51,71,94,0.6)]"
                      style={{ background: 'rgba(238,246,248,0.95)' }}
                    >
                      {showPw ? t('auth.password.hide') : t('auth.password.show')}
                    </button>
                  </div>
                </label>
              </div>

              {isLogin && (
                <div className="mt-[10px] flex justify-end">
                  <a
                    href="#"
                    className="text-[13px] font-bold text-[oklch(0.58_0.075_220)] no-underline hover:text-[oklch(0.5_0.08_220)]"
                    onClick={(e) => e.preventDefault()}
                  >
                    {t('auth.forgotPassword')}
                  </a>
                </div>
              )}

              {error && (
                <p className="mt-[14px] mb-0 text-[13px] leading-[1.5] font-bold text-[#7a3f2c]">{error}</p>
              )}
              {notice && (
                <p className="mt-[14px] mb-0 text-[13px] leading-[1.5] font-bold text-[#2c5b53]">{notice}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-[18px] w-full rounded-[22px] border-none py-4 font-sans text-base font-extrabold text-[#1e3549] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(58,98,126,0.2)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                style={{
                  background: 'var(--ff-accent-soft)',
                  boxShadow: '0 10px 24px rgba(58,98,126,0.14)',
                }}
              >
                {submitting
                  ? t('auth.submit.processing')
                  : isLogin
                    ? t('auth.submit.login')
                    : t('auth.submit.signup')}
              </button>

              <div className="my-5 flex items-center gap-[14px]">
                <div className="h-px flex-1" style={{ background: 'rgba(51,71,94,0.13)' }} />
                <span className="text-[12.5px] font-bold text-[rgba(51,71,94,0.45)]">{t('auth.or')}</span>
                <div className="h-px flex-1" style={{ background: 'rgba(51,71,94,0.13)' }} />
              </div>

              <button
                type="button"
                onClick={handleGoogle}
                className="flex w-full items-center justify-center gap-[11px] rounded-[22px] border-[1.5px] border-[rgba(51,71,94,0.12)] bg-[rgba(255,255,255,0.92)] py-[14px] font-sans text-[15px] font-bold text-[#33475e] transition-[background,border-color] duration-200 hover:border-[rgba(51,71,94,0.22)] hover:bg-white"
              >
                <span
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[13px] font-extrabold text-[#5b7a92]"
                  style={{ background: 'rgba(238,246,248,0.95)' }}
                >
                  G
                </span>
                {isLogin ? t('auth.google.login') : t('auth.google.signup')}
              </button>

              <div className="mt-[18px] text-center">
                <Link
                  to="/"
                  className="inline-block rounded-[18px] px-[18px] py-[11px] text-[13.5px] font-bold text-inherit no-underline transition-colors duration-200 hover:bg-[rgba(238,246,248,1)]"
                  style={{ background: 'rgba(238,246,248,0.7)' }}
                >
                  {t('auth.guestLink')}
                </Link>
              </div>
            </form>
          </div>

          {/* why sign in */}
          <div className="flex flex-[1_1_280px] flex-col gap-[14px]" style={{ maxWidth: 360 }}>
            <div
              className="rounded-[30px] px-[26px] pt-[26px] pb-6"
              style={{
                background: 'rgba(255,255,255,0.58)',
                backdropFilter: 'blur(18px)',
                boxShadow: '0 14px 36px rgba(58,98,126,0.1)',
              }}
            >
              <div className="text-xs font-bold tracking-[1.2px] text-[rgba(51,71,94,0.48)] uppercase">
                {t('auth.side.badge')}
              </div>
              <p className="mt-3 mb-0 text-[15.5px] leading-[1.55] font-bold text-[#2c3f55]">
                {t('auth.side.desc1')}
              </p>
              <p className="mt-[10px] mb-0 text-[13.5px] leading-[1.6] font-semibold text-[rgba(51,71,94,0.55)]">
                {t('auth.side.desc2')}
              </p>
            </div>
            <div className="flex flex-col gap-[10px]">
              {PERK_ICONS.map((p) => (
                <div
                  key={p.key}
                  className="flex items-center gap-[13px] rounded-[24px] px-[18px] py-[15px]"
                  style={{
                    background: 'rgba(255,255,255,0.52)',
                    backdropFilter: 'blur(14px)',
                    boxShadow: '0 8px 20px rgba(58,98,126,0.07)',
                  }}
                >
                  <div
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[13px] text-[#35566b]"
                    style={{ background: p.bg }}
                  >
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={p.icon} />
                    </svg>
                  </div>
                  <div className="flex flex-col gap-[2px]">
                    <span className="text-sm font-bold text-[#2c3f55]">
                      {t(`auth.perks.${p.key}.title`)}
                    </span>
                    <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.5)]">
                      {t(`auth.perks.${p.key}.desc`)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-1 max-w-[420px] text-center text-[12.5px] leading-[1.6] font-semibold text-[rgba(51,71,94,0.45)]">
          {t('auth.terms')}
        </p>
      </div>
    </div>
  )
}
