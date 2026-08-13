import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/lib/supabase';
import { fetchProfile, updateProfileName, updateProfilePomodoro, uploadAvatar } from '@/lib/api';
import { useTheme, fonts, ACCENT_PRESETS, spacing, radius, type ThemeMode } from '@/theme';
import { useWallpaper, WALLPAPERS } from '@/lib/wallpapers';
import { useI18n, type Lang } from '@/lib/i18n';

export default function ProfileScreen() {
  const { colors, shadows, mode, accentHue, setMode, setAccentHue } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);
  const { lang, setLang } = useI18n();
  const { wallpaper, setWallpaper } = useWallpaper();
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [copied, setCopied] = useState(false);

  const [focusMin, setFocusMin] = useState(25);
  const [breakMin, setBreakMin] = useState(5);
  const [sessionCount, setSessionCount] = useState(4);
  const [autoStart, setAutoStart] = useState(true);
  const [savingPomodoro, setSavingPomodoro] = useState(false);
  const [pomodoroSaved, setPomodoroSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid || cancelled) return;
      setUserId(uid);
      try {
        const p = await fetchProfile(uid);
        if (p && !cancelled) {
          setName(p.name);
          setTag(p.tag);
          setAvatarUrl(p.avatar_url);
          setFocusMin(p.focus_minutes);
          setBreakMin(p.break_minutes);
          setSessionCount(p.session_count);
          setAutoStart(p.auto_start_next);
        }
      } catch {
        // không load được thì giữ mặc định — ít gặp (mất mạng)
      }
    })();
    return () => {
      cancelled = true;
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const pickAvatar = useCallback(async () => {
    if (!userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Cần quyền thư viện ảnh', 'Bật quyền truy cập ảnh trong cài đặt để đổi avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingAvatar(true);
    try {
      // co ảnh về tối đa 480px cạnh dài (mirror web resizeAvatar) rồi upload bucket avatars
      const image = result.assets[0];
      const needsResize = Math.max(image.width, image.height) > 480;
      const uri = needsResize
        ? (
            await ImageManipulator.manipulateAsync(
              image.uri,
              [
                image.width >= image.height
                  ? { resize: { width: 480 } }
                  : { resize: { height: 480 } },
              ],
              { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
            )
          ).uri
        : image.uri;
      const url = await uploadAvatar(userId, uri, avatarUrl);
      setAvatarUrl(url);
    } catch {
      Alert.alert('Tải ảnh lên thất bại', 'Thử lại hoặc chọn ảnh khác.');
    } finally {
      setUploadingAvatar(false);
    }
  }, [userId, avatarUrl]);

  async function saveName() {
    if (!userId || savingName) return;
    const draft = nameDraft.trim();
    if (!draft) {
      setNameError('Tên không được để trống.');
      return;
    }
    if (draft.length > 40) {
      setNameError('Tên tối đa 40 ký tự.');
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await updateProfileName(userId, draft);
      setName(draft);
      setEditingName(false);
    } catch (e) {
      const msg = e instanceof Error && e.message === 'name_taken'
        ? 'Tên này đã có người dùng, hãy thử tên khác.'
        : 'Không lưu được tên, thử lại.';
      setNameError(msg);
    } finally {
      setSavingName(false);
    }
  }

  async function copyHandle() {
    if (!tag) return;
    await Clipboard.setStringAsync(`${name}#${tag}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function savePomodoro() {
    if (!userId || savingPomodoro) return;
    setSavingPomodoro(true);
    try {
      await updateProfilePomodoro(userId, { focus_minutes: focusMin, break_minutes: breakMin, session_count: sessionCount, auto_start_next: autoStart });
      setPomodoroSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setPomodoroSaved(false), 1800);
    } catch {
      Alert.alert('Lưu thất bại', 'Không lưu được cài đặt Pomodoro, thử lại.');
    } finally {
      setSavingPomodoro(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ---------- Avatar + tên ---------- */}
      <View style={[styles.card, styles.profileCard]}>
        <Pressable onPress={pickAvatar} disabled={uploadingAvatar}>
          {uploadingAvatar ? (
            <View style={[styles.avatar, { backgroundColor: colors.surface2 }]}>
              <ActivityIndicator color={colors.accentDark} />
            </View>
          ) : avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
              <Text style={styles.avatarInitial}>{name.charAt(0).toUpperCase() || '?'}</Text>
            </View>
          )}
        </Pressable>
        <Text style={styles.name}>{name}</Text>
        <Pressable onPress={copyHandle} disabled={!tag} style={styles.tagRow} hitSlop={8}>
          <Text style={styles.tagText}>{tag ? `${name}#${tag}` : '—'}</Text>
          <Text style={styles.copyText}>{copied ? 'Đã sao chép ✓' : 'Sao chép'}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.softButton, pressed && styles.pressed]} onPress={pickAvatar} disabled={uploadingAvatar}>
          <Text style={styles.softButtonText}>Đổi ảnh đại diện</Text>
        </Pressable>
      </View>

      {/* ---------- Sửa tên ---------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tên hiển thị</Text>
        {editingName ? (
          <>
            <TextInput
              style={styles.input}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Tên của bạn"
              placeholderTextColor={colors.faint}
              maxLength={40}
              autoFocus
            />
            {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
            <View style={styles.rowButtons}>
              <Pressable style={({ pressed }) => [styles.softButton, pressed && styles.pressed]} onPress={() => { setNameError(null); setEditingName(false); }}>
                <Text style={styles.softButtonText}>Huỷ</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={saveName} disabled={savingName}>
                {savingName ? <ActivityIndicator color={colors.onAccent} size="small" /> : <Text style={styles.primaryButtonText}>Lưu</Text>}
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable style={styles.nameRow} onPress={() => { setNameDraft(name); setEditingName(true); setNameError(null); }}>
            <Text style={styles.nameValue}>{name}</Text>
            <Text style={styles.editLink}>Sửa</Text>
          </Pressable>
        )}
      </View>

      {/* ---------- Pomodoro mặc định ---------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pomodoro mặc định</Text>
        <View style={styles.stepperRow}>
          <MiniStepper label="Vòng lặp" value={sessionCount} onDec={() => setSessionCount((v) => Math.max(1, v - 1))} onInc={() => setSessionCount((v) => Math.min(12, v + 1))} />
          <MiniStepper label="Học" value={focusMin} onDec={() => setFocusMin((v) => Math.max(5, v - 5))} onInc={() => setFocusMin((v) => Math.min(120, v + 5))} />
          <MiniStepper label="Nghỉ" value={breakMin} onDec={() => setBreakMin((v) => Math.max(1, v - 1))} onInc={() => setBreakMin((v) => Math.min(30, v + 1))} />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Tự động bắt đầu phiên kế tiếp</Text>
          <Switch
            value={autoStart}
            onValueChange={setAutoStart}
            trackColor={{ false: colors.surface3, true: colors.accentSoft }}
            thumbColor={autoStart ? colors.accentDark : colors.faint}
          />
        </View>
        <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={savePomodoro} disabled={savingPomodoro}>
          {savingPomodoro ? (
            <ActivityIndicator color={colors.onAccent} size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>{pomodoroSaved ? 'Đã lưu ✓' : 'Lưu cài đặt'}</Text>
          )}
        </Pressable>
      </View>

      {/* ---------- Giao diện ---------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Giao diện</Text>
        <View style={styles.segmented}>
          {(['light', 'dark'] as ThemeMode[]).map((m) => (
            <Pressable
              key={m}
              style={[styles.segment, mode === m && { backgroundColor: colors.accentSoft }]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.segmentText, mode === m && { color: colors.onAccent }]}>
                {m === 'light' ? 'Sáng' : 'Tối'}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.accentRow}>
          {ACCENT_PRESETS.map((p) => (
            <Pressable
              key={p.hue}
              style={[
                styles.accentDot,
                { backgroundColor: p.hue === 195 ? colors.accent : `hsl(${p.hue} 70% 62%)` },
                accentHue === p.hue && { borderColor: colors.text, borderWidth: 2 },
              ]}
              onPress={() => setAccentHue(p.hue)}
              hitSlop={6}
            >
              {accentHue === p.hue ? <View style={styles.accentDotInner} /> : null}
            </Pressable>
          ))}
        </View>
      </View>

      {/* ---------- Hình nền ---------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Hình nền</Text>
        <View style={styles.wallpaperRow}>
          {WALLPAPERS.map((w) => {
            const active = w.id === wallpaper.id;
            return (
              <Pressable key={w.id} onPress={() => setWallpaper(w.id)} style={[styles.wallpaperSwatchWrap, active && styles.wallpaperActive]}>
                <LinearGradientBox colors={mode === 'dark' ? w.dark : w.light} active={active} />
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hintText}>Chỉ áp dụng cho thiết bị này.</Text>
      </View>

      {/* ---------- Ngôn ngữ ---------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ngôn ngữ</Text>
        <View style={styles.segmented}>
          {(['vi', 'en'] as Lang[]).map((l) => (
            <Pressable
              key={l}
              style={[styles.segment, lang === l && { backgroundColor: colors.accentSoft }]}
              onPress={() => setLang(l)}
            >
              <Text style={[styles.segmentText, lang === l && { color: colors.onAccent }]}>
                {l === 'vi' ? 'Tiếng Việt' : 'English'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ---------- Đăng xuất ---------- */}
      <Pressable
        style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
        onPress={async () => {
          const confirmed = await new Promise<boolean>((resolve) => {
            Alert.alert('Đăng xuất', 'Bạn chắc chắn muốn đăng xuất?', [
              { text: 'Huỷ', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Đăng xuất', style: 'destructive', onPress: () => resolve(true) },
            ]);
          });
          if (!confirmed) return;
          await supabase.auth.signOut();
          router.replace('/login');
        }}
      >
        <Text style={styles.dangerButtonText}>Đăng xuất</Text>
      </Pressable>
    </ScrollView>
  );
}

function LinearGradientBox({ colors: cols, active }: { colors: string[]; active: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 76,
        height: 52,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? colors.accentDark : colors.surface3,
        backgroundColor: cols[0],
        overflow: 'hidden',
      }}
    >
      <View style={{ flex: 1, opacity: 0.85, backgroundColor: cols[1] ?? cols[0] }} />
    </View>
  );
}

function MiniStepper({ label, value, onDec, onInc }: { label: string; value: number; onDec: () => void; onInc: () => void }) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]} onPress={onDec} hitSlop={6}>
          <Text style={styles.stepButtonText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]} onPress={onInc} hitSlop={6}>
          <Text style={styles.stepButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(c: ReturnType<typeof import('@/theme').buildColors>, s: ReturnType<typeof import('@/theme').buildShadows>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.pageBg },
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
    pressed: { opacity: 0.9 },
    card: {
      backgroundColor: c.glassCard,
      borderRadius: radius.panel,
      padding: spacing.md,
      gap: spacing.sm,
      ...s.card,
    },
    profileCard: { alignItems: 'center', gap: spacing.xs },
    avatar: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    avatarInitial: { fontFamily: fonts.bold, fontSize: 34, color: c.onAccent },
    name: { fontFamily: fonts.bold, fontSize: 19, color: c.text, marginTop: spacing.xs },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tagText: { fontFamily: fonts.semibold, fontSize: 14, color: c.muted },
    copyText: { fontFamily: fonts.bold, fontSize: 13, color: c.accentDark },
    softButton: {
      backgroundColor: c.accentSoft,
      borderRadius: radius.button,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      alignItems: 'center',
    },
    softButtonText: { fontFamily: fonts.bold, fontSize: 13, color: c.onAccent },
    primaryButton: {
      backgroundColor: c.accentDark,
      borderRadius: radius.button,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 40,
      marginTop: spacing.xs,
    },
    primaryButtonText: { fontFamily: fonts.bold, fontSize: 14, color: c.onAccent },
    cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: c.text },
    input: {
      backgroundColor: c.surface,
      borderRadius: radius.input,
      paddingHorizontal: spacing.sm,
      paddingVertical: 10,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: c.text,
    },
    errorText: { fontFamily: fonts.regular, fontSize: 13, color: c.danger },
    rowButtons: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
    nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    nameValue: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    editLink: { fontFamily: fonts.bold, fontSize: 13, color: c.accentDark },
    stepperRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
    stepper: { flex: 1, alignItems: 'center', gap: 6 },
    stepperLabel: { fontFamily: fonts.semibold, fontSize: 12, color: c.muted },
    stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    stepButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepButtonText: { fontFamily: fonts.bold, fontSize: 16, color: c.text },
    stepperValue: { fontFamily: fonts.bold, fontSize: 15, color: c.text, minWidth: 28, textAlign: 'center' },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
    switchLabel: { fontFamily: fonts.regular, fontSize: 14, color: c.text, flex: 1, paddingRight: spacing.sm },
    segmented: { flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.button, padding: 3, gap: 3 },
    segment: { flex: 1, borderRadius: radius.button - 3, paddingVertical: 8, alignItems: 'center' },
    segmentText: { fontFamily: fonts.semibold, fontSize: 14, color: c.muted },
    accentRow: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center', marginTop: spacing.xs },
    accentDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: c.surface3, alignItems: 'center', justifyContent: 'center' },
    accentDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.glassCard },
    wallpaperRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    wallpaperSwatchWrap: { borderRadius: 14, padding: 2, borderWidth: 2, borderColor: 'transparent' },
    wallpaperActive: { borderColor: c.accentDark },
    wallpaperSwatch: { width: 76, height: 52, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
    wallpaperSwatchOverlay: { flex: 1, opacity: 0.85 },
    hintText: { fontFamily: fonts.regular, fontSize: 12, color: c.faint },
    dangerButton: {
      backgroundColor: c.surface2,
      borderRadius: radius.button,
      paddingVertical: 12,
      alignItems: 'center',
    },
    dangerButtonText: { fontFamily: fonts.bold, fontSize: 14, color: c.danger },
  });
}
