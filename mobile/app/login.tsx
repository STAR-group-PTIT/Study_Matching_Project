import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { signIn, signUp } from '@/lib/auth';
import { colors, fonts, radius, shadows } from '@/theme';

type Mode = 'login' | 'signup';

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit() {
    if (!email.trim() || !password) {
      setError('Vui lòng nhập email và mật khẩu.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const result =
      mode === 'login'
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password, name.trim() || email.trim().split('@')[0]);
    setBusy(false);
    if (!result.ok) {
      if (result.needConfirm) {
        setNotice(result.error);
        return;
      }
      setError(result.error);
      return;
    }
    router.replace('/(tabs)');
  }

  function handleGoogle() {
    setError(null);
    setNotice('Đăng nhập Google chưa được cấu hình trên mobile — hãy dùng email và mật khẩu.');
  }

  return (
    <LinearGradient colors={[...colors.pageGradient]} style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.scrollInner}>
            <View style={styles.logoRow}>
              <LinearGradient colors={[...colors.logoGradient]} style={styles.logoBox} />
              <Text style={styles.logoText}>Study matching</Text>
            </View>

          <BlurView intensity={34} tint="light" style={styles.card}>
            <View style={styles.tabWrap}>
              {(['login', 'signup'] as const).map((m) => {
                const on = mode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => switchMode(m)}
                    style={[styles.tab, on && styles.tabActive]}
                  >
                    <Text style={[styles.tabText, on && styles.tabTextActive]}>
                      {m === 'login' ? 'Đăng nhập' : 'Đăng ký'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.title}>{mode === 'login' ? 'Chào bạn trở lại' : 'Tạo tài khoản mới'}</Text>
            <Text style={styles.subtitle}>
              {mode === 'login'
                ? 'Đăng nhập để tìm phòng học và kết nối bạn học cùng.'
                : 'Vài giây để tạo tài khoản, sau đó vào phòng học ngay.'}
            </Text>

            <View style={styles.fieldGroup}>
              {mode === 'signup' && (
                <View style={styles.field}>
                  <Text style={styles.label}>Tên của bạn</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="VD: Minh Anh"
                    placeholderTextColor={colors.faint}
                    value={name}
                    onChangeText={setName}
                    autoComplete="name"
                  />
                </View>
              )}
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="ban@email.com"
                  placeholderTextColor={colors.faint}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Mật khẩu</Text>
                <View style={styles.pwWrap}>
                  <TextInput
                    style={[styles.input, styles.pwInput]}
                    placeholder="Tối thiểu 6 ký tự"
                    placeholderTextColor={colors.faint}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPw}
                    autoComplete="password"
                  />
                  <Pressable
                    onPress={() => setShowPw((v) => !v)}
                    style={styles.pwToggle}
                    hitSlop={8}
                  >
                    <Text style={styles.pwToggleText}>{showPw ? 'Ẩn' : 'Hiện'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.submit, pressed && styles.pressed]}
              onPress={handleSubmit}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.submitText}>
                  {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
                </Text>
              )}
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>hoặc</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              style={({ pressed }) => [styles.google, pressed && styles.pressed]}
              onPress={handleGoogle}
            >
              <View style={styles.googleBadge}>
                <Text style={styles.googleBadgeText}>G</Text>
              </View>
              <Text style={styles.googleText}>
                {mode === 'login' ? 'Đăng nhập với Google' : 'Đăng ký với Google'}
              </Text>
            </Pressable>

            <Text style={styles.terms}>
              Bằng cách tiếp tục, bạn đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư của chúng tôi.
            </Text>
          </BlurView>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 40 + (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0),
    paddingBottom: 40,
  },
  scrollInner: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  logoBox: {
    width: 22,
    height: 22,
    borderRadius: 9,
  },
  logoText: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.text,
  },
  card: {
    width: '100%',
    maxWidth: 456,
    borderRadius: radius.panel,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.62)',
    overflow: 'hidden',
    ...shadows.raised,
  },
  tabWrap: {
    flexDirection: 'row',
    backgroundColor: 'rgba(238, 246, 248, 0.9)',
    borderRadius: 20,
    padding: 5,
    gap: 4,
  },
  tab: {
    flex: 1,
    borderRadius: 15,
    paddingVertical: 11,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  tabText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.text,
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    letterSpacing: -0.4,
    color: colors.text,
    marginTop: 20,
  },
  subtitle: {
    fontFamily: fonts.semibold,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.muted,
    marginTop: 6,
  },
  fieldGroup: { gap: 14, marginTop: 20 },
  field: { gap: 7 },
  label: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    letterSpacing: 0.3,
    color: colors.body,
  },
  input: {
    borderRadius: radius.input,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.neutralFill,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
  },
  pwWrap: { position: 'relative' },
  pwInput: { paddingRight: 74 },
  pwToggle: {
    position: 'absolute',
    right: 6,
    top: 6,
    borderRadius: 13,
    backgroundColor: colors.surface2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pwToggleText: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    color: colors.accentDark,
  },
  error: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 19,
    color: colors.danger,
    marginTop: 12,
  },
  notice: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 19,
    color: colors.success,
    marginTop: 12,
  },
  submit: {
    marginTop: 18,
    borderRadius: radius.button,
    backgroundColor: colors.accentSoft,
    paddingVertical: 16,
    alignItems: 'center',
    ...shadows.button,
  },
  submitText: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    color: colors.onAccent,
  },
  pressed: { opacity: 0.85 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginVertical: 18,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.faint },
  google: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 14,
  },
  googleBadge: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBadgeText: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    color: colors.accentDark,
  },
  googleText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.body,
  },
  terms: {
    fontFamily: fonts.semibold,
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 18,
  },
});