// Bật/tắt hành vi "tự ẩn UI + fullscreen khi bấm Bắt đầu Pomodoro" — lưu ở localStorage vì đây
// là hành vi của trình duyệt/thiết bị đang dùng (Fullscreen API vốn không đồng bộ được giữa các
// máy), không phải cấu hình tài khoản như focus/break minutes.
export const AUTO_FULLSCREEN_FOCUS_KEY = 'ff-auto-fullscreen-focus'

export function loadStoredAutoFullscreenFocus(): boolean {
  try {
    return localStorage.getItem(AUTO_FULLSCREEN_FOCUS_KEY) === '1'
  } catch {
    return false
  }
}

export function saveStoredAutoFullscreenFocus(value: boolean) {
  try {
    localStorage.setItem(AUTO_FULLSCREEN_FOCUS_KEY, value ? '1' : '0')
  } catch {
    // ignore (private mode / storage disabled)
  }
}
