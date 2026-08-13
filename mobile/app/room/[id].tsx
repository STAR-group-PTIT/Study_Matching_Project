import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import {
  fetchRoomByCode,
  fetchRoomMembers,
  joinRoomByCode,
  type PublicRoom,
  type RoomMember,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';
import RoomCall from '@/components/RoomCall';
import {
  useTheme,
  type ThemeColors,
  type ThemeShadows,
  fonts,
  fontSize,
  radius,
  roomTypes,
  spacing,
} from '@/theme';

export default function RoomDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const code = id ?? '';
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // camera / mic permissions
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
  }, []);

  // Đã là member (mở lại phòng / từ lobby) thì vào thẳng call, không cần join
  const selfRow = userId ? members.find((m) => m.user_id === userId) : undefined;
  const selfStatus =
    selfRow?.status === 'member' ? 'member' : selfRow?.status === 'pending' ? 'pending' : null;

  const loadMembers = useCallback(async (roomId: string) => {
    try {
      setMembers(await fetchRoomMembers(roomId));
    } catch {
      // room_members_view chỉ trả dữ liệu khi mình là participant
      setMembers([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchRoomByCode(code);
        setRoom(r);
        if (r) await loadMembers(r.id);
      } catch {
        setMessage({ kind: 'error', text: 'Không tải được thông tin phòng.' });
      } finally {
        setLoading(false);
      }
    })();
  }, [code, loadMembers]);

  async function handleJoin() {
    if (!room || joining) return;
    setJoining(true);
    setMessage(null);
    try {
      const result = await joinRoomByCode(room.code);
      if (result.status === 'joined') {
        setMessage({ kind: 'ok', text: 'Bạn đã vào phòng.' });
        await loadMembers(room.id);
      } else if (result.status === 'pending') {
        setMessage({ kind: 'ok', text: 'Đã gửi yêu cầu, chờ host duyệt.' });
        await loadMembers(room.id);
      } else if (result.status === 'full') {
        setMessage({ kind: 'error', text: 'Phòng đã đầy.' });
      } else if (result.status === 'already_in_another_room') {
        setMessage({
          kind: 'error',
          text: `Bạn đang ở phòng ${result.otherRoomCode ?? 'khác'}, hãy rời phòng đó trước.`,
        });
      } else {
        setMessage({ kind: 'error', text: 'Không tìm thấy phòng.' });
      }
    } catch {
      setMessage({ kind: 'error', text: 'Có lỗi khi vào phòng, thử lại.' });
    } finally {
      setJoining(false);
    }
  }

  async function toggleCamera() {
    if (camOn) {
      setCamOn(false);
      return;
    }
    let perm = camPerm;
    if (!perm?.granted) perm = await requestCamPerm();
    if (perm?.granted) setCamOn(true);
  }

  async function toggleMic() {
    if (micOn) {
      setMicOn(false);
      return;
    }
    let perm = micPerm;
    if (!perm?.granted) perm = await requestMicPerm();
    if (perm?.granted) setMicOn(true);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accentDark} size="large" />
      </View>
    );
  }

  if (!room) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Không tìm thấy phòng.</Text>
      </View>
    );
  }

  const meta = roomTypes[room.room_type] ?? { name: room.room_type, rule: '', badgeBg: colors.surface3, badgeText: colors.muted };
  const full = room.member_count >= room.capacity;
  const camDenied = !!camPerm && !camPerm.granted && !camPerm.canAskAgain;
  const micDenied = !!micPerm && !micPerm.granted && !micPerm.canAskAgain;

  if (selfStatus === 'member' && userId) {
    return (
      <RoomCall
        code={room.code}
        roomId={room.id}
        userId={userId}
        initialCam={camOn}
        initialMic={micOn}
        onLeave={() => loadMembers(room.id)}
      />
    );
  }

  return (
    <LinearGradient colors={[...colors.pageGradient]} style={styles.flex}>
      <FlatList
        contentContainerStyle={styles.content}
        data={members}
        keyExtractor={(m) => m.id}
        ListHeaderComponent={
          <>
            <View style={styles.card}>
              <View style={styles.cardRow1}>
                <Text style={styles.roomName}>{room.name}</Text>
                <View style={[styles.badge, { backgroundColor: meta.badgeBg }]}>
                  <Text style={[styles.badgeText, { color: meta.badgeText }]}>{meta.name}</Text>
                </View>
              </View>
              <Text style={styles.hostLine}>Host {room.host_name}</Text>
              <Text style={styles.ruleLine}>{meta.rule}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  {room.duration_minutes} phút · {room.language}
                </Text>
                <Text style={[styles.metaText, { color: full ? colors.faint : colors.success }]}>
                  {room.member_count}/{room.capacity} người
                </Text>
              </View>
              <View style={styles.codePill}>
                <Text style={styles.codeLabel}>MÃ PHÒNG</Text>
                <Text style={styles.codeText}>{room.code}</Text>
              </View>
            </View>

            {message ? (
              <Text style={[styles.message, message.kind === 'ok' ? styles.messageOk : styles.messageErr]}>
                {message.text}
              </Text>
            ) : null}

            {selfStatus === null ? (
              <Pressable
                style={({ pressed }) => [styles.joinButton, pressed && styles.pressed]}
                onPress={handleJoin}
                disabled={joining || full}
              >
                {joining ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.joinText}>{full ? 'Phòng đã đầy' : 'Tham gia phòng'}</Text>
                )}
              </Pressable>
            ) : (
              <View style={styles.pendingCard}>
                <Text style={styles.pendingText}>
                  {selfStatus === 'pending' ? 'Đang chờ host duyệt yêu cầu vào phòng…' : 'Bạn đang ở trong phòng.'}
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Thiết bị của bạn</Text>
            <View style={styles.deviceCard}>
              <View style={styles.deviceRow}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>Camera</Text>
                  <Text style={styles.deviceHint}>
                    {camDenied
                      ? 'Quyền bị từ chối vĩnh viễn'
                      : camOn
                        ? 'Đang xem trước video'
                        : 'Bật để mở video trước khi vào phòng'}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.deviceToggle,
                    { backgroundColor: camOn ? colors.accentSoft : colors.surface2 },
                    pressed && styles.pressed,
                  ]}
                  onPress={toggleCamera}
                >
                  <Text style={[styles.deviceToggleText, { color: camOn ? colors.accentDark : colors.muted }]}>
                    {camOn ? 'Tắt' : 'Bật'}
                  </Text>
                </Pressable>
              </View>

              {camOn && camPerm?.granted ? (
                <CameraView
                  style={styles.cameraPreview}
                  facing="front"
                  mirror={false}
                  onMountError={() => setCamOn(false)}
                />
              ) : null}
              {camDenied ? (
                <Pressable onPress={() => Linking.openSettings()} style={styles.settingsLink}>
                  <Text style={styles.settingsLinkText}>Mở Cài đặt để cấp quyền camera</Text>
                </Pressable>
              ) : null}

              <View style={styles.divider} />

              <View style={styles.deviceRow}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>Micro</Text>
                  <Text style={styles.deviceHint}>
                    {micDenied
                      ? 'Quyền bị từ chối vĩnh viễn'
                      : micOn
                        ? 'Mic đã bật, sẵn sàng nói chuyện'
                        : 'Bật để xin quyền dùng micro'}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.deviceToggle,
                    { backgroundColor: micOn ? colors.accentSoft : colors.surface2 },
                    pressed && styles.pressed,
                  ]}
                  onPress={toggleMic}
                >
                  <Text style={[styles.deviceToggleText, { color: micOn ? colors.accentDark : colors.muted }]}>
                    {micOn ? 'Tắt' : 'Bật'}
                  </Text>
                </Pressable>
              </View>
              {micDenied ? (
                <Pressable onPress={() => Linking.openSettings()} style={styles.settingsLink}>
                  <Text style={styles.settingsLinkText}>Mở Cài đặt để cấp quyền micro</Text>
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.sectionTitle}>Thành viên ({members.length})</Text>
          </>
        }
        renderItem={({ item }) => (
          <View style={styles.memberRow}>
            <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
              <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.memberName}>{item.name}</Text>
            <Text style={styles.memberStatus}>
              {item.status === 'member' ? 'Trong phòng' : 'Chờ duyệt'}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyMembers}>
            {selfStatus ? 'Chưa có thành viên nào.' : 'Vào phòng để xem danh sách thành viên.'}
          </Text>
        }
      />
    </LinearGradient>
  );
}

function makeStyles(c: ThemeColors, s: ThemeShadows) {
  return StyleSheet.create({
    flex: { flex: 1 },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: c.pageBg,
    },
    content: { padding: spacing.md, gap: spacing.md, paddingTop: 96 },
    card: {
      backgroundColor: c.glassCard,
      borderRadius: radius.card,
      padding: 18,
      gap: 7,
      ...s.card,
    },
    cardRow1: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
    roomName: {
      fontFamily: fonts.extrabold,
      fontSize: 18,
      color: c.text,
      flexShrink: 1,
    },
    badge: { borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 3 },
    badgeText: { fontFamily: fonts.extrabold, fontSize: 11.5, letterSpacing: 0.3 },
    hostLine: { fontFamily: fonts.semibold, fontSize: fontSize.sm, color: c.muted },
    ruleLine: { fontFamily: fonts.semibold, fontSize: fontSize.sm, color: c.body, lineHeight: 20 },
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    metaText: { fontFamily: fonts.bold, fontSize: fontSize.sm, color: c.text },
    codePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      backgroundColor: c.accentTint,
      borderRadius: radius.input,
      paddingHorizontal: 14,
      paddingVertical: 7,
      marginTop: 4,
    },
    codeLabel: { fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 1.2, color: c.accentDark },
    codeText: { fontFamily: fonts.extrabold, fontSize: 14, color: c.text, letterSpacing: 1.5 },
    message: { fontFamily: fonts.bold, fontSize: fontSize.sm, textAlign: 'center' },
    messageOk: { color: c.success },
    messageErr: { color: c.danger },
    joinButton: {
      backgroundColor: c.accentSoft,
      borderRadius: radius.button,
      paddingVertical: 15,
      alignItems: 'center',
      ...s.button,
    },
    joinText: { fontFamily: fonts.extrabold, fontSize: fontSize.md, color: c.onAccent },
    pressed: { opacity: 0.85 },
    pendingCard: {
      backgroundColor: c.glassCard,
      borderRadius: radius.input,
      padding: 14,
      alignItems: 'center',
      ...s.card,
    },
    pendingText: { fontFamily: fonts.semibold, fontSize: fontSize.sm, color: c.muted },
    sectionTitle: {
      fontFamily: fonts.extrabold,
      fontSize: fontSize.md,
      color: c.text,
      letterSpacing: -0.2,
      marginTop: spacing.sm,
    },
    deviceCard: {
      backgroundColor: c.glassCard,
      borderRadius: radius.card,
      padding: 18,
      ...s.card,
    },
    deviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    deviceInfo: { flex: 1, gap: 2 },
    deviceName: { fontFamily: fonts.bold, fontSize: fontSize.base, color: c.text },
    deviceHint: { fontFamily: fonts.semibold, fontSize: fontSize.xs, color: c.muted, lineHeight: 18 },
    deviceToggle: {
      borderRadius: radius.input,
      paddingHorizontal: 22,
      paddingVertical: 10,
    },
    deviceToggleText: { fontFamily: fonts.extrabold, fontSize: 14 },
    cameraPreview: {
      height: 200,
      borderRadius: radius.card,
      marginTop: 14,
      overflow: 'hidden',
      backgroundColor: c.surface3,
    },
    settingsLink: { marginTop: 8 },
    settingsLinkText: {
      fontFamily: fonts.bold,
      fontSize: fontSize.xs,
      color: c.accentDark,
      textDecorationLine: 'underline',
    },
    divider: { height: 1, backgroundColor: c.border, marginVertical: 14 },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.glassCard,
      borderRadius: radius.input,
      padding: 12,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { fontFamily: fonts.extrabold, fontSize: fontSize.base, color: c.onAccent },
    memberName: { flex: 1, fontFamily: fonts.bold, fontSize: fontSize.base, color: c.text },
    memberStatus: { fontFamily: fonts.semibold, fontSize: fontSize.xs, color: c.muted },
    emptyMembers: {
      fontFamily: fonts.semibold,
      fontSize: fontSize.sm,
      color: c.muted,
      textAlign: 'center',
    },
    errorText: { fontFamily: fonts.bold, fontSize: fontSize.md, color: c.danger },
  });
}