import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'

type Tab = 'login' | 'signup'

const PERK_ICONS = [
  { key: 'todo', bg: 'var(--c-9q3jpj)', icon: 'M4 7.5l2 2 3-3.5M4 16.5l2 2 3-3.5M13 8h7M13 17h7' },
  {
    key: 'wallpaper',
    bg: 'var(--c-18sbq61)',
    icon: 'M3 6a3 3 0 013-3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3z M4 18l5.5-5 4 3.4 3-2.4L20 18',
  },
  {
    key: 'matching',
    bg: 'var(--c-1ni0y5h)',
    icon: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M17 8a2.6 2.6 0 010 5M19 20c0-2-.7-3.4-2-4.4',
  },
] as const

function tabStyle(on: boolean) {
  return {
    background: on ? 'var(--c-6rf2u5)' : 'transparent',
    color: on ? 'var(--c-2mhlk3)' : 'var(--c-1kei8bt)',
    boxShadow: on ? '0 4px 12px var(--c-1w98bua)' : 'none',
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
      className="relative min-h-svh w-full overflow-hidden font-sans text-[var(--c-32fr7s)] antialiased"
      style={{ background: 'var(--ff-page-gradient)' }}
    >
      <div
        className="absolute inset-0"
        style={{ backdropFilter: 'blur(3px)', background: 'var(--c-6rewwl)' }}
      />

      <div className="relative flex min-h-svh flex-col items-center justify-center gap-[22px] px-6 pt-12 pb-10">
        <div className="flex items-center gap-[11px]">
          <div
            className="h-[22px] w-[22px] rounded-[9px]"
            style={{
              background: 'linear-gradient(135deg, var(--c-1feyjhs), var(--c-yr829))',
            }}
          />
          <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[var(--c-3dfktp)]">
            {t('app.name')}
          </span>
        </div>

        <div className="flex w-full max-w-[900px] flex-wrap items-stretch justify-center gap-5">
          {/* card */}
          <div
            className="flex-[1_1_380px] rounded-[32px] px-8 pt-[30px] pb-8"
            style={{
              maxWidth: 456,
              background: 'var(--c-6rf1cr)',
              backdropFilter: 'blur(22px)',
              boxShadow: '0 20px 52px var(--c-1k1wm25)',
            }}
          >
            <div
              className="flex gap-1 rounded-[20px] p-[5px]"
              style={{ background: 'var(--c-rucw5u)' }}
            >
              <button
                onClick={() => switchTo('login')}
                className="flex-1 rounded-2xl border-none py-[13px] font-sans text-sm font-bold transition-all duration-[280ms]"
                style={tabStyle(isLogin)}
              >
                {t('auth.tabs.login')}
              </button>
              <button
                onClick={() => switchTo('signup')}
                className="flex-1 rounded-2xl border-none py-[13px] font-sans text-sm font-bold transition-all duration-[280ms]"
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
              <h1 className="m-0 text-2xl font-extrabold tracking-[-0.4px] text-[var(--c-3bsl4p)]">
                {isLogin ? t('auth.title.login') : t('auth.title.signup')}
              </h1>
              <p className="mt-[7px] mb-0 text-sm leading-[1.55] font-semibold text-[var(--c-1kei8ee)]">
                {isLogin ? t('auth.subtitle.login') : t('auth.subtitle.signup')}
              </p>

              <div className="mt-[22px] flex flex-col gap-3">
                {!isLogin && (
                  <label className="flex flex-col gap-[7px]">
                    <span className="text-[12.5px] font-bold tracking-[0.3px] text-[var(--c-1kei8zx)]">
                      {t('auth.name.label')}
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('auth.name.placeholder')}
                      className="rounded-[18px] border-[1.5px] border-[var(--c-1kei5ag)] bg-[var(--c-ijr2wt)] px-4 py-[14px] font-sans text-base font-semibold text-[var(--c-3bsl4p)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-semibold placeholder:text-[var(--c-1kei6x0)] focus:border-[var(--c-125fipz)] focus:shadow-[0_0_0_4px_var(--c-1bxn4lz)]"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-[7px]">
                  <span className="text-[12.5px] font-bold tracking-[0.3px] text-[var(--c-1kei8zx)]">
                    {t('auth.email.label')}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder={t('auth.email.placeholder')}
                    className="rounded-[18px] border-[1.5px] border-[var(--c-1kei5ag)] bg-[var(--c-ijr2wt)] px-4 py-[14px] font-sans text-base font-semibold text-[var(--c-3bsl4p)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-semibold placeholder:text-[var(--c-1kei6x0)] focus:border-[var(--c-125fipz)] focus:shadow-[0_0_0_4px_var(--c-1bxn4lz)]"
                  />
                </label>
                <label className="flex flex-col gap-[7px]">
                  <span className="text-[12.5px] font-bold tracking-[0.3px] text-[var(--c-1kei8zx)]">
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
                      className="flex-1 rounded-[18px] border-[1.5px] border-[var(--c-1kei5ag)] bg-[var(--c-ijr2wt)] py-[14px] pr-[90px] pl-4 font-sans text-base font-semibold text-[var(--c-3bsl4p)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-semibold placeholder:text-[var(--c-1kei6x0)] focus:border-[var(--c-125fipz)] focus:shadow-[0_0_0_4px_var(--c-1bxn4lz)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-2 rounded-[13px] border-none px-[14px] py-[11px] font-sans text-[13px] font-bold text-[var(--c-mfvyj7)]"
                      style={{ background: 'var(--c-arr1mz)' }}
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
                    className="px-3 py-[12px] text-[13px] font-bold text-[var(--c-1swujpp)] no-underline hover:text-[var(--c-ounphr)]"
                    onClick={(e) => e.preventDefault()}
                  >
                    {t('auth.forgotPassword')}
                  </a>
                </div>
              )}

              {error && (
                <p className="mt-[14px] mb-0 text-[13px] leading-[1.5] font-bold text-[var(--c-5nx3vn)]">{error}</p>
              )}
              {notice && (
                <p className="mt-[14px] mb-0 text-[13px] leading-[1.5] font-bold text-[var(--c-3bts4x)]">{notice}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-[18px] w-full rounded-[22px] border-none py-4 font-sans text-base font-extrabold text-[var(--c-2vtjkg)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_var(--c-1w98bv5)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                style={{
                  background: 'var(--ff-accent-soft)',
                  boxShadow: '0 10px 24px var(--c-1k1wm30)',
                }}
              >
                {submitting
                  ? t('auth.submit.processing')
                  : isLogin
                    ? t('auth.submit.login')
                    : t('auth.submit.signup')}
              </button>

              <div className="my-5 flex items-center gap-[14px]">
                <div className="h-px flex-1" style={{ background: 'var(--c-dhk6qj)' }} />
                <span className="text-[12.5px] font-bold text-[var(--c-1kei7l4)]">{t('auth.or')}</span>
                <div className="h-px flex-1" style={{ background: 'var(--c-dhk6qj)' }} />
              </div>

              <button
                type="button"
                onClick={handleGoogle}
                className="flex w-full items-center justify-center gap-[11px] rounded-[22px] border-[1.5px] border-[var(--c-1kei5ag)] bg-[var(--c-6rf2oz)] py-[14px] font-sans text-[15px] font-bold text-[var(--c-32fr7s)] transition-[background,border-color] duration-200 hover:border-[var(--c-1kei615)] hover:bg-white"
              >
                <span
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[13px] font-extrabold text-[var(--c-4qg41x)]"
                  style={{ background: 'var(--c-arr1mz)' }}
                >
                  G
                </span>
                {isLogin ? t('auth.google.login') : t('auth.google.signup')}
              </button>

              <div className="mt-[18px] text-center">
                <Link
                  to="/"
                  className="inline-block rounded-[18px] px-[18px] py-[11px] text-[13.5px] font-bold text-inherit no-underline transition-colors duration-200 hover:bg-[var(--c-91o5zw)]"
                  style={{ background: 'var(--c-rucw44)' }}
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
                background: 'var(--c-6rezvd)',
                backdropFilter: 'blur(18px)',
                boxShadow: '0 14px 36px var(--c-1w98bua)',
              }}
            >
              <div className="text-xs font-bold tracking-[1.2px] text-[var(--c-1kei7np)] uppercase">
                {t('auth.side.badge')}
              </div>
              <p className="mt-3 mb-0 text-[15.5px] leading-[1.55] font-bold text-[var(--c-3bsl4p)]">
                {t('auth.side.desc1')}
              </p>
              <p className="mt-[10px] mb-0 text-[13.5px] leading-[1.6] font-semibold text-[var(--c-1kei8bt)]">
                {t('auth.side.desc2')}
              </p>
            </div>
            <div className="flex flex-col gap-[10px]">
              {PERK_ICONS.map((p) => (
                <div
                  key={p.key}
                  className="flex items-center gap-[13px] rounded-[24px] px-[18px] py-[15px]"
                  style={{
                    background: 'var(--c-6rezq7)',
                    backdropFilter: 'blur(14px)',
                    boxShadow: '0 8px 20px var(--c-1k1wlew)',
                  }}
                >
                  <div
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[13px] text-[var(--c-33jyo4)]"
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
                    <span className="text-sm font-bold text-[var(--c-3bsl4p)]">
                      {t(`auth.perks.${p.key}.title`)}
                    </span>
                    <span className="text-[12.5px] font-semibold text-[var(--c-mfvyic)]">
                      {t(`auth.perks.${p.key}.desc`)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-1 max-w-[420px] text-center text-[12.5px] leading-[1.6] font-semibold text-[var(--c-1kei7l4)]">
          {t('auth.terms')}
        </p>
      </div>
    </div>
  )
}
