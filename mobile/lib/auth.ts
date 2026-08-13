import { supabase } from './supabase';

export type AuthResult =
  | { ok: true; error?: never; needConfirm?: never }
  | { ok: false; error: string; needConfirm?: boolean };

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: translateAuthError(error.message) };
  return { ok: true };
}

export async function signUp(email: string, password: string, name: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (error) return { ok: false, error: translateAuthError(error.message) };
  // Project bật "Confirm email" — chưa có session cho tới khi user bấm link xác nhận.
  if (!data.session) {
    return {
      ok: false,
      needConfirm: true,
      error: `Đã gửi email xác nhận tới ${email}. Bấm link trong email để kích hoạt tài khoản.`,
    };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Sai email hoặc mật khẩu.';
  if (m.includes('user already registered') || m.includes('email already registered'))
    return 'Email này đã được đăng ký.';
  if (m.includes('password should be at least')) return 'Mật khẩu phải có ít nhất 6 ký tự.';
  if (m.includes('invalid email')) return 'Email không hợp lệ.';
  if (m.includes('rate limit')) return 'Bạn đang thao tác quá nhanh, thử lại sau ít phút.';
  return 'Đã có lỗi xảy ra, vui lòng thử lại.';
}