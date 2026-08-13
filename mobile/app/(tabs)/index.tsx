// Trang chủ (P2): đồng hồ Pomodoro compact (mirror đúng logic web Dashboard.tsx —
// đọc profiles defaults, ghi focus_sessions đúng rule: completed chỉ khi hết giờ tự nhiên,
// huỷ/skip ghi phút đã trôi qua) + card "Học cùng nhau" (CTA ghép ngẫu nhiên + preview
// phòng đang mở). Chưa có Endless, chưa có tiếng chuông — ngoài scope P2.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchProfilePomodoro,
  fetchPublicRooms,
  joinRoomByCode,
  logFocusSession,
  type PublicRoom,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';
import {
  useTheme,
  type ThemeColors,
  type ThemeShadows,
  fonts,
  fontSize,
  radius,
  spacing,
} from '@/theme';

type Phase = 'focus' | 'break';

const ROOMS_CACHE_KEY = 'ff-mobile-rooms-cache';

export default function HomeScreen() {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);

  // ---------- Pomodoro (logic mirror web Dashboard.tsx) ----------

  const [focusMin, setFocusMin] = useState(25);
  const [breakMin, setBreakMin] = useState(5);
  const [sessionCount, setSessionCount] = useState(4);
  const [autoStart, setAutoStart] = useState(true);
  const [phase, setPhase] = useState<Phase>('focus');
  const [round, setRound] = useState(1);
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(25 * 60);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);

  const runningRef = useRef(false);
  const focusMinRef = useRef(25);
  const breakMinRef = useRef(5);
  const sessionCountRef = useRef(4);
  const roundRef = useRef(1);
  const autoStartRef = useRef(true);
  const userIdRef = useRef<string | null>(null);
  const phaseStartRef = useRef(0);
  const prevPhaseRef = useRef<Phase>('focus');

  // Đồng bộ refs sau mỗi render (không ghi ref trong lúc render — react-hooks/refs).
  useEffect(() => {
    runningRef.current = running;
    focusMinRef.current = focusMin;
    breakMinRef.current = breakMin;
    sessionCountRef.current = sessionCount;
    roundRef.current = round;
    autoStartRef.current = autoStart;
  });

  // Dùng chung cho hoàn thành tự nhiên (hết giờ) lẫn bấm Skip — chỉ khác nhau ở số phút
  // ghi log (đủ vs. thực tế đã trôi qua) và có tự chạy tiếp phase kế hay không.
  function advancePhaseBody(
    prevPhase: Phase,
    opts: { minutesOverride?: number; continueRunning: boolean; natural?: boolean },
  ): Phase {
    const next: Phase = prevPhase === 'focus' ? 'break' : 'focus';
    const completedMinutes =
      opts.minutesOverride ?? (prevPhase === 'focus' ? focusMinRef.current : breakMinRef.current);
    const isFinalCompletion = next === 'focus' && roundRef.current >= sessionCountRef.current;
    if (next === 'focus' && !isFinalCompletion) setRound((r) => r + 1);
    const uid = userIdRef.current;
    if (uid && completedMinutes > 0) {
      void logFocusSession({
        userId: uid,
        phase: prevPhase,
        minutes: completedMinutes,
        startedAt: new Date(phaseStartRef.current).toISOString(),
        completed: !!opts.natural,
      });
    }
    if (isFinalCompletion) {
      setDone(true);
      setRunning(false);
      return prevPhase;
    }
    setRunning(opts.continueRunning);
    return next;
  }

  useEffect(() => {
    const id = setInterval(() => {
      if (!runningRef.current) return;
      setLeft((prevLeft) => {
        if (prevLeft <= 1) {
          setPhase((prevPhase) => advancePhaseBody(prevPhase, { continueRunning: autoStartRef.current, natural: true }));
          return 0; // placeholder, replaced right after via phase effect below
        }
        return prevLeft - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // when phase flips (either by timer completion or skip), snap `left` to the new phase's duration.
  useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      setLeft(phase === 'focus' ? focusMin * 60 : breakMin * 60);
      prevPhaseRef.current = phase;
      phaseStartRef.current = Date.now();
    }
  }, [phase, focusMin, breakMin]);

  // Pomodoro defaults từ profiles (đã đăng nhập trong tabs — không cần fallback khách).
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return;
      userIdRef.current = uid;
      try {
        const p = await fetchProfilePomodoro(uid);
        setFocusMin(p.focus_minutes);
        setBreakMin(p.break_minutes);
        setSessionCount(p.session_count);
        setAutoStart(p.auto_start_next);
        setLeft(p.focus_minutes * 60);
      } catch (e) {
        console.error('load pomodoro defaults failed', e);
      }
    })();
  }, []);

  function startPomodoro() {
    setDone(false);
    setPhase('focus');
    setRound(1);
    setLeft(focusMin * 60);
    setRunning(true);
    phaseStartRef.current = Date.now();
    setStarted(true);
  }

  function resetToIdle() {
    setRunning(false);
    setDone(false);
    setPhase('focus');
    setRound(1);
    setLeft(focusMin * 60);
    phaseStartRef.current = Date.now();
    setStarted(false);
  }

  // Huỷ giữa chừng vẫn ghi lại phần thời gian học đã trôi qua (nếu đang ở phase focus).
  function cancelPomodoro() {
    const uid = userIdRef.current;
    if (uid && phase === 'focus' && !done) {
      const elapsedMinutes = Math.round((focusMin * 60 - left) / 60);
      if (elapsedMinutes > 0) {
        void logFocusSession({
          userId: uid,
          phase: 'focus',
          minutes: elapsedMinutes,
          startedAt: new Date(phaseStartRef.current).toISOString(),
          completed: false,
        });
      }
    }
    resetToIdle();
  }

  // Bỏ qua phase hiện tại: ghi log đúng số phút ĐÃ trôi qua, rồi luôn tự chạy tiếp phase kế.
  function skipPhase() {
    const totalSec = (phase === 'focus' ? focusMin : breakMin) * 60;
    const elapsedMinutes = Math.round((totalSec - left) / 60);
    setPhase((prevPhase) =>
      advancePhaseBody(prevPhase, { minutesOverride: elapsedMinutes, continueRunning: true }),
    );
  }

  function toggleRun() {
    setRunning((r) => !r);
  }

  function nudgeLoop(delta: number) {
    setSessionCount((n) => Math.min(12, Math.max(1, n + delta)));
  }
  function nudgeFocus(delta: number) {
    setFocusMin((n) => Math.min(120, Math.max(5, n + delta)));
  }
  function nudgeBreak(delta: number) {
    setBreakMin((n) => Math.min(20, Math.max(1, n + delta)));
  }

  // ---------- "Học cùng nhau" card ----------

  const [publicRooms, setPublicRooms] = useState<PublicRoom[] | null>(null);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // render cached data immediately, then refresh from network
      const cached = await AsyncStorage.getItem(ROOMS_CACHE_KEY);
      if (cached && !cancelled) setPublicRooms(JSON.parse(cached) as PublicRoom[]);
      try {
        const fresh = await fetchPublicRooms();
        if (!cancelled) {
          setPublicRooms(fresh);
          AsyncStorage.setItem(ROOMS_CACHE_KEY, JSON.stringify(fresh)).catch(() => {});
        }
      } catch {
        // giữ cache — nếu chưa có cache thì để nguyên null (không hiện lỗi, preview là phụ)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // P3: mở màn lobby ghép ngẫu nhiên (find_or_create_lobby + Realtime) — tự xử lý đăng nhập
  // vì tabs đã guard auth từ trước.
  function startRandomMatch() {
    router.push('/lobby');
  }

  async function handleJoinRoom(room: PublicRoom) {
    if (joiningCode) return;
    setJoiningCode(room.code);
    try {
      const result = await joinRoomByCode(room.code);
      if (result.status === 'joined' || result.status === 'pending') {
        router.push(`/room/${room.code}`);
      } else if (result.status === 'full') {
        Alert.alert('Phòng đã đầy', 'Hãy thử phòng khác.');
      } else if (result.status === 'already_in_another_room') {
        Alert.alert(
          'Bạn đang ở một phòng khác',
          `Hãy rời phòng ${result.otherRoomCode ?? 'hiện tại'} trước khi vào phòng mới.`,
        );
      } else {
        Alert.alert('Không tìm thấy phòng', 'Phòng vừa đóng hoặc đã hết hạn.');
      }
    } catch {
      Alert.alert('Có lỗi xảy ra', 'Không vào được phòng, thử lại.');
    } finally {
      setJoiningCode(null);
    }
  }

  const formatTime = (total: number) => {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ---------- Pomodoro ---------- */}
      <View style={styles.pomodoroCard}>
        {!started ? (
          <>
            <Text style={styles.cardTitle}>Pomodoro</Text>
            <View style={styles.stepperRow}>
              <Stepper label="Vòng lặp" value={sessionCount} onDec={() => nudgeLoop(-1)} onInc={() => nudgeLoop(1)} />
              <Stepper label="Học" value={focusMin} onDec={() => nudgeFocus(-1)} onInc={() => nudgeFocus(1)} />
              <Stepper label="Nghỉ" value={breakMin} onDec={() => nudgeBreak(-1)} onInc={() => nudgeBreak(1)} />
            </View>
            <Pressable style={({ pressed }) => [styles.playButton, pressed && styles.pressed]} onPress={startPomodoro}>
              <Text style={styles.playButtonText}>Bắt đầu</Text>
            </Pressable>
          </>
        ) : done ? (
          <>
            <Text style={styles.cardTitle}>Đã hoàn thành ✓ 🎉</Text>
            <Text style={styles.doneSubtitle}>Bạn đã học xong {sessionCount} phiên, nghỉ ngơi thôi!</Text>
            <Pressable style={({ pressed }) => [styles.playButton, pressed && styles.pressed]} onPress={startPomodoro}>
              <Text style={styles.playButtonText}>Bắt đầu vòng mới</Text>
            </Pressable>
            <Pressable onPress={resetToIdle} hitSlop={8}>
              <Text style={styles.setupLink}>Về màn hình cài đặt</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.runningLabel}>
              {round}/{sessionCount} · {phase === 'focus' ? 'TẬP TRUNG' : 'NGHỈ NGƠI'}
            </Text>
            <Text style={styles.timerText}>{formatTime(left)}</Text>
            <View style={styles.controlRow}>
              <ControlButton label="Huỷ" onPress={cancelPomodoro} />
              <ControlButton label={running ? 'Tạm dừng' : 'Tiếp tục'} onPress={toggleRun} primary />
              <ControlButton label="Bỏ qua" onPress={skipPhase} />
            </View>
          </>
        )}
      </View>

      {/* ---------- Học cùng nhau ---------- */}
      <View style={styles.studyCard}>
        <View style={styles.studyHeader}>
          <Text style={styles.cardTitle}>Học cùng nhau</Text>
          <Text style={styles.studySubtitle}>Tìm bạn học và vào phòng ngay.</Text>
        </View>
        <Pressable style={({ pressed }) => [styles.matchButton, pressed && styles.pressed]} onPress={startRandomMatch}>
          <Text style={styles.matchButtonText}>Ghép ngẫu nhiên</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>
          Phòng đang mở ({publicRooms === null ? '…' : `${publicRooms.length} phòng`})
        </Text>
        {publicRooms === null ? (
          <ActivityIndicator color={colors.accentDark} style={styles.previewLoader} />
        ) : publicRooms.length === 0 ? (
          <Text style={styles.emptyText}>Chưa có phòng nào đang mở.</Text>
        ) : (
          publicRooms
            .slice(0, 3)
            .map((room) => <PreviewRoomRow key={room.id} room={room} joining={joiningCode === room.code} onJoin={() => handleJoinRoom(room)} />)
        )}
        <Pressable onPress={() => router.push('/rooms')} hitSlop={8}>
          <Text style={styles.seeAll}>Xem tất cả phòng →</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// Helper nhỏ đọc room preview khi đang chờ data — tách để render gọn.

function Stepper({ label, value, onDec, onInc }: { label: string; value: number; onDec: () => void; onInc: () => void }) {
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

function ControlButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);
  return (
    <Pressable
      style={({ pressed }) => [styles.controlButton, primary && { backgroundColor: colors.accentSoft }, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Text style={[styles.controlButtonText, primary && { color: colors.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

function PreviewRoomRow({ room, joining, onJoin }: { room: PublicRoom; joining: boolean; onJoin: () => void }) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);
  const full = room.member_count >= room.capacity;
  return (
    <View style={styles.previewRow}>
      <View style={styles.previewInfo}>
        <Text style={styles.previewName} numberOfLines={1}>
          {room.name}
        </Text>
        <Text style={styles.previewCount}>
          {room.member_count}/{room.capacity} người
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.previewJoin,
          { backgroundColor: full ? colors.surface3 : colors.accentSoft },
          pressed && styles.pressed,
        ]}
        onPress={onJoin}
        disabled={full || joining}
      >
        <Text style={[styles.previewJoinText, { color: full ? colors.faint : colors.onAccent }]}>
          {joining ? 'Đang vào…' : full ? 'Đầy' : 'Tham gia'}
        </Text>
      </Pressable>
    </View>
  );
}

function makeStyles(c: ThemeColors, s: ThemeShadows) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.pageBg },
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
    pressed: { opacity: 0.9 },
    // Pomodoro
    pomodoroCard: {
      backgroundColor: c.glassCard,
      borderRadius: radius.panel,
      padding: spacing.lg,
      alignItems: 'center',
      gap: spacing.md,
      ...s.card,
    },
    cardTitle: {
      fontFamily: fonts.extrabold,
      fontSize: fontSize.lg,
      color: c.text,
    },
    stepperRow: {
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'center',
      flexWrap: 'wrap',
    },
    stepper: {
      alignItems: 'center',
      gap: 6,
      minWidth: 86,
    },
    stepperLabel: {
      fontFamily: fonts.bold,
      fontSize: fontSize.sm,
      color: c.muted,
    },
    stepperControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    stepButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.surface2,
      alignItems: 'center',
      justifyContent: 'center',
      ...s.button,
    },
    stepButtonText: {
      fontFamily: fonts.extrabold,
      fontSize: fontSize.lg,
      color: c.text,
      lineHeight: 24,
    },
    stepperValue: {
      fontFamily: fonts.extrabold,
      fontSize: fontSize.xl,
      color: c.text,
      minWidth: 34,
      textAlign: 'center',
    },
    playButton: {
      backgroundColor: c.accent,
      borderRadius: radius.button,
      paddingHorizontal: 44,
      paddingVertical: 13,
      ...s.button,
    },
    playButtonText: {
      fontFamily: fonts.extrabold,
      fontSize: fontSize.md,
      color: c.onAccent,
    },
    setupLink: {
      fontFamily: fonts.bold,
      fontSize: fontSize.sm,
      color: c.muted,
      marginTop: spacing.xs,
    },
    runningLabel: {
      fontFamily: fonts.bold,
      fontSize: fontSize.sm,
      color: c.accentDark,
      letterSpacing: 1.2,
    },
    timerText: {
      fontFamily: fonts.extrabold,
      fontSize: 44,
      color: c.text,
      fontVariant: ['tabular-nums'],
    },
    controlRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    controlButton: {
      borderRadius: radius.button,
      backgroundColor: c.surface2,
      paddingHorizontal: 20,
      paddingVertical: 11,
      ...s.button,
    },
    controlButtonText: {
      fontFamily: fonts.extrabold,
      fontSize: fontSize.sm,
      color: c.text,
    },
    doneSubtitle: {
      fontFamily: fonts.semibold,
      fontSize: fontSize.sm,
      color: c.muted,
      textAlign: 'center',
    },
    // Study card
    studyCard: {
      backgroundColor: c.glassCard,
      borderRadius: radius.panel,
      padding: spacing.lg,
      gap: spacing.md,
      ...s.card,
    },
    studyHeader: { gap: 2 },
    studySubtitle: {
      fontFamily: fonts.semibold,
      fontSize: fontSize.sm,
      color: c.muted,
    },
    matchButton: {
      backgroundColor: c.accent,
      borderRadius: radius.button,
      paddingVertical: 14,
      alignItems: 'center',
      ...s.button,
    },
    matchButtonText: {
      fontFamily: fonts.extrabold,
      fontSize: fontSize.md,
      color: c.onAccent,
    },
    sectionLabel: {
      fontFamily: fonts.bold,
      fontSize: fontSize.sm,
      color: c.muted,
      marginTop: spacing.sm,
    },
    previewLoader: { marginVertical: spacing.md },
    emptyText: {
      fontFamily: fonts.semibold,
      fontSize: fontSize.sm,
      color: c.muted,
      textAlign: 'center',
      paddingVertical: spacing.md,
    },
    previewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.input,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    previewInfo: { flex: 1, gap: 1 },
    previewName: {
      fontFamily: fonts.bold,
      fontSize: fontSize.base,
      color: c.text,
    },
    previewCount: {
      fontFamily: fonts.semibold,
      fontSize: fontSize.xs,
      color: c.muted,
    },
    previewJoin: {
      borderRadius: radius.pill,
      paddingHorizontal: 16,
      paddingVertical: 7,
    },
    previewJoinText: {
      fontFamily: fonts.extrabold,
      fontSize: fontSize.sm,
    },
    seeAll: {
      fontFamily: fonts.bold,
      fontSize: fontSize.sm,
      color: c.accentDark,
      textAlign: 'center',
      marginTop: spacing.xs,
    },
  });
}