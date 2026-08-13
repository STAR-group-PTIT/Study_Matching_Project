import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useQuickMatch } from '@/lib/quickMatch';
import {
  useTheme,
  type ThemeColors,
  type ThemeShadows,
  fonts,
  fontSize,
  radius,
  spacing,
} from '@/theme';

const ERROR_TEXT: Record<string, string> = {
  matchServiceDown: 'Không kết nối được dịch vụ ghép. Kiểm tra mạng rồi thử lại.',
  matchGeneric: 'Có lỗi xảy ra khi ghép. Thử lại nhé.',
  alreadyInRoom: 'Bạn đang ở trong một phòng khác. Hãy rời phòng đó trước khi ghép ngẫu nhiên.',
};

export default function LobbyScreen() {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);
  const { stage, matchError, roomCode, memberCount, capacity, secondsRemaining, lobbyMembers, start, cancel } =
    useQuickMatch();
  const startedRef = useRef(false);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const ok = await start();
      if (!ok) {
        // chưa đăng nhập — quay về login
        router.replace('/login');
        return;
      }
      setStarting(false);
    })();
  }, [start]);

  // Lobby chốt xong → vào phòng thật.
  useEffect(() => {
    if (stage === 'matched' && roomCode) {
      router.replace(`/room/${roomCode}`);
    }
  }, [stage, roomCode]);

  function renderStage() {
    switch (stage) {
      case 'lobby':
        return (
          <View style={styles.card}>
            <Text style={styles.emoji}>👥</Text>
            <Text style={styles.title}>Đang tìm nhóm học…</Text>
            <Text style={styles.progress}>
              {memberCount}/{capacity} người đã vào
            </Text>
            {lobbyMembers.length > 0 ? (
              <View style={styles.memberList}>
                {lobbyMembers.map((m) => (
                  <View key={m.user_id} style={styles.memberRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{m.name?.charAt(0).toUpperCase() ?? '?'}</Text>
                    </View>
                    <Text style={styles.memberName}>{m.name ?? 'Bạn học'}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>Chia sẻ mã phòng để mời bạn bè vào đây.</Text>
            )}
            {secondsRemaining !== null ? (
              <Text style={[styles.countdown, secondsRemaining <= 10 && { color: colors.danger }]}>
                Tự ghép trong {secondsRemaining}s
              </Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              onPress={() => {
                cancel();
                router.back();
              }}
            >
              <Text style={styles.cancelText}>Huỷ tìm kiếm</Text>
            </Pressable>
          </View>
        );
      case 'expired': {
        const msg = ERROR_TEXT[matchError] ?? ERROR_TEXT.matchGeneric;
        return (
          <View style={styles.card}>
            <Text style={styles.emoji}>⏳</Text>
            <Text style={styles.title}>
              {matchError === 'alreadyInRoom' ? 'Bạn đang ở phòng khác' : 'Chưa tìm được nhóm'}
            </Text>
            <Text style={styles.hint}>{msg}</Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              onPress={() => void start()}
            >
              <Text style={styles.retryText}>Thử lại</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={() => router.back()}>
              <Text style={styles.cancelText}>Quay lại</Text>
            </Pressable>
          </View>
        );
      }
      default:
        // idle (đang khởi động) hoặc matched đang chờ navigate
        return (
          <View style={styles.card}>
            <ActivityIndicator color={colors.accentDark} size="large" />
            <Text style={styles.hint}>Đang chuẩn bị ghép…</Text>
          </View>
        );
    }
  }

  return (
    <LinearGradient colors={[...colors.pageGradient]} style={styles.flex}>
      <View style={styles.content}>
        {starting ? null : renderStage()}
      </View>
    </LinearGradient>
  );
}

function makeStyles(c: ThemeColors, s: ThemeShadows) {
  return StyleSheet.create({
    flex: { flex: 1 },
    content: { flex: 1, justifyContent: 'center', padding: spacing.lg },
    card: {
      backgroundColor: c.glassCard,
      borderRadius: radius.panel,
      padding: 28,
      gap: 10,
      alignItems: 'center',
      ...s.card,
    },
    emoji: { fontSize: 34 },
    title: { fontFamily: fonts.extrabold, fontSize: fontSize.xl, color: c.text },
    progress: { fontFamily: fonts.bold, fontSize: fontSize.md, color: c.accentDark },
    countdown: { fontFamily: fonts.bold, fontSize: fontSize.sm, color: c.muted },
    memberList: { width: '100%', marginTop: 4, gap: 8 },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.surface2,
      borderRadius: radius.input,
      padding: 10,
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { fontFamily: fonts.extrabold, fontSize: fontSize.sm, color: c.onAccent },
    memberName: { flex: 1, fontFamily: fonts.bold, fontSize: fontSize.base, color: c.text },
    hint: { fontFamily: fonts.semibold, fontSize: fontSize.sm, color: c.muted, textAlign: 'center', lineHeight: 20 },
    retryButton: {
      backgroundColor: c.accentSoft,
      borderRadius: radius.button,
      paddingVertical: 14,
      paddingHorizontal: 40,
      marginTop: 10,
      alignItems: 'center',
      ...s.button,
    },
    retryText: { fontFamily: fonts.extrabold, fontSize: fontSize.md, color: c.onAccent },
    cancelButton: {
      backgroundColor: c.surface2,
      borderRadius: radius.button,
      paddingVertical: 12,
      paddingHorizontal: 32,
      marginTop: 8,
      alignItems: 'center',
    },
    cancelText: { fontFamily: fonts.bold, fontSize: fontSize.base, color: c.muted },
    pressed: { opacity: 0.85 },
  });
}
