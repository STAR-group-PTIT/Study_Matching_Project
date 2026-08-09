const STORAGE_KEY = 'ff-onboarding-seen'

export function hasSeenOnboarding() {
  return localStorage.getItem(STORAGE_KEY) === '1'
}

export function markOnboardingSeen() {
  localStorage.setItem(STORAGE_KEY, '1')
}
