import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  AudioSession,
  LiveKitRoom,
  useTracks,
  useLocalParticipant,
  useParticipants,
  useSpeakingParticipants,
  VideoTrack,
  isTrackReference,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import { supabase } from '@/lib/supabase';
import { fetchRoomDetail, leaveRoom, type RoomDetail } from '@/lib/api';
import { computeLeftFromRoom, formatClock } from '@/lib/timer';
import { useTheme, type ThemeColors, type ThemeShadows, fonts, fontSize } from '@/theme';

const LIVEKIT_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL;

const SELF_OVERLAY = { width: 92, height: 138 };
const DOCK_TILE = 84;

export default function RoomCall({
  code,
  roomId,
  userId,
  initialCam,
  initialMic,
  onLeave,
}: {
  code: string;
  roomId: string;
  userId: string;
  initialCam: boolean;
  initialMic: boolean;
  onLeave?: () => void;
}) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);

  const [token, setToken] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const [mode, setMode] = useState<'grid' | 'speaker'>('grid');
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [left, setLeft] = useState(0);

  // Token từ edge livekit-token (chỉ mint cho member thật của đúng phòng)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke<{ token?: string; error?: string }>(
          'livekit-token',
          { body: { code } },
        );
        if (cancelled) return;
        if (error || !data?.token) {
          setConnectError('Không kết nối được phòng học. Thử lại sau.');
          return;
        }
        setToken(data.token);
      } catch {
        if (!cancelled) setConnectError('Không kết nối được phòng học. Thử lại sau.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Nạp chi tiết phòng (timer/status) — RLS cho participant đọc
  useEffect(() => {
    let cancelled = false;
    fetchRoomDetail(code)
      .then((d) => {
        if (!cancelled && d) setDetail(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Đồng bộ timer qua Realtime UPDATE rooms — read-only (chỉ host điều khiển)
  useEffect(() => {
    const channel = supabase
      .channel(`room-timer-${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          setDetail((payload.new as RoomDetail) ?? null);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // Tick 1s — tính left từ timer_updated_at (elapsed-time pattern web 0003)
  useEffect(() => {
    const id = setInterval(() => {
      if (detail) setLeft(computeLeftFromRoom(detail));
    }, 1000);
    return () => clearInterval(id);
  }, [detail]);

  // Audio session + tự ẩn control bar sau 5s không tương tác
  useEffect(() => {
    AudioSession.startAudioSession().catch(() => {});
    return () => {
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 5000);
  }, []);

  useEffect(() => {
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 5000);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handleLeave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await leaveRoom(userId, roomId);
    } catch {
      // rời kể cả khi xoá row lỗi — phòng tự dọn qua cleanup 0024
    }
    onLeave?.();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [leaving, userId, roomId, onLeave]);

  if (connectError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{connectError}</Text>
        <Pressable style={styles.primaryBtn} onPress={handleLeave}>
          <Text style={styles.primaryBtnText}>Quay lại</Text>
        </Pressable>
      </View>
    );
  }

  if (!token || !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Đang vào phòng…</Text>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={LIVEKIT_URL}
      token={token}
      connect={true}
      audio={false}
      video={false}
      options={{ adaptiveStream: { pixelDensity: 'screen' } }}
      onError={() => setConnectError('Mất kết nối phòng học.')}
    >
      <CallStage
        detail={detail}
        left={left}
        mode={mode}
        controlsVisible={controlsVisible}
        toggleControls={() => (controlsVisible ? setControlsVisible(false) : showControls())}
        setMode={setMode}
        initialCam={initialCam}
        initialMic={initialMic}
        handleLeave={handleLeave}
        leaving={leaving}
      />
    </LiveKitRoom>
  );
}

function CallStage({
  detail,
  left,
  mode,
  controlsVisible,
  toggleControls,
  setMode,
  initialCam,
  initialMic,
  handleLeave,
  leaving,
}: {
  detail: RoomDetail;
  left: number;
  mode: 'grid' | 'speaker';
  controlsVisible: boolean;
  toggleControls: () => void;
  setMode: (m: 'grid' | 'speaker') => void;
  initialCam: boolean;
  initialMic: boolean;
  handleLeave: () => void;
  leaving: boolean;
}) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);
  const { isCameraEnabled, isMicrophoneEnabled, localParticipant, cameraTrack } = useLocalParticipant();
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();

  // Kích hoạt cam/mic ban đầu đúng quyền user cấp ở màn kiểm tra thiết bị
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    localParticipant.setCameraEnabled(initialCam).catch(() => {});
    localParticipant.setMicrophoneEnabled(initialMic).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localParticipant]);

  const cameraTracks = useTracks([Track.Source.Camera]);
  const remoteTracks = useMemo(
    () =>
      cameraTracks.filter(
        (t) => isTrackReference(t) && t.participant.identity !== localParticipant.identity,
      ),
    [cameraTracks, localParticipant.identity],
  );

  const speakingParticipant = useMemo(
    () =>
      speaking.find((p) => p.identity !== localParticipant.identity) ??
      remoteTracks[0]?.participant ??
      null,
    [speaking, remoteTracks, localParticipant.identity],
  );

  const primaryRef =
    mode === 'speaker' && remoteTracks.length > 0
      ? remoteTracks.find((t) => t.participant.identity === speakingParticipant?.identity) ??
        remoteTracks[0]
      : null;
  const dockTracks = primaryRef
    ? remoteTracks.filter((t) => t.participant.identity !== primaryRef.participant.identity)
    : remoteTracks;

  const { cols, rows } = gridColsRows(remoteTracks.length);

  // Self-view: TrackReference thủ công từ TrackPublication của local participant
  const selfRef: TrackReference | undefined = cameraTrack
    ? {
        participant: localParticipant,
        publication: cameraTrack,
        source: Track.Source.Camera,
      }
    : undefined;

  return (
    <View style={styles.stage}>
      <Pressable style={styles.stageInner} onPress={toggleControls}>
        {remoteTracks.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.waitingText}>Đang chờ mọi người vào phòng…</Text>
          </View>
        ) : primaryRef ? (
          <View style={styles.stageInner}>
            <View style={styles.primaryWrap}>
              <Tile track={primaryRef} label={primaryRef.participant.name || 'Bạn học'} big colors={colors} shadows={shadows} />
            </View>
            {dockTracks.length > 0 && (
              <View style={styles.dock}>
                {dockTracks.map((t) => (
                  <View key={t.participant.identity} style={styles.dockTile}>
                    <Tile track={t} label={t.participant.name || 'Bạn học'} colors={colors} shadows={shadows} />
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.grid}>
            {remoteTracks.map((t) => (
              <View
                key={t.participant.identity}
                style={{ width: `${100 / cols}%`, height: `${100 / rows}%`, padding: 3 }}
              >
                <Tile track={t} label={t.participant.name || 'Bạn học'} colors={colors} shadows={shadows} />
              </View>
            ))}
          </View>
        )}

        {/* self-view luôn nổi (kiểu Meet) */}
        <View style={styles.selfOverlay} pointerEvents="none">
          {selfRef ? (
            <VideoTrack trackRef={selfRef} style={styles.selfVideo} objectFit="cover" mirror />
          ) : (
            <View style={styles.selfPlaceholder}>
              <Text style={styles.selfPlaceholderText}>Bạn</Text>
            </View>
          )}
        </View>
      </Pressable>

      {/* chip timer đồng bộ phòng (read-only) */}
      <View style={[styles.timerChip, !controlsVisible && styles.hiddenChip]} pointerEvents="none">
        <Text style={styles.timerPhase}>{detail.timer_phase === 'focus' ? 'TẬP TRUNG' : 'NGHỈ NGƠI'}</Text>
        <Text style={styles.timerClock}>{formatClock(left)}</Text>
        <Text style={styles.timerRound}>Phiên {detail.timer_round}/{detail.session_count}</Text>
      </View>

      {/* control bar tự ẩn */}
      {controlsVisible && (
        <View style={styles.controls}>
          <View style={styles.memberBadge}>
            <Text style={styles.memberBadgeText}>{participants.length}</Text>
          </View>
          <Pressable
            style={[styles.controlBtn, !isCameraEnabled && styles.controlBtnOff]}
            onPress={() => localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => {})}
          >
            <Text style={styles.controlLabel}>{isCameraEnabled ? 'Tắt cam' : 'Bật cam'}</Text>
          </Pressable>
          <Pressable
            style={[styles.controlBtn, !isMicrophoneEnabled && styles.controlBtnOff]}
            onPress={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {})}
          >
            <Text style={styles.controlLabel}>{isMicrophoneEnabled ? 'Tắt mic' : 'Bật mic'}</Text>
          </Pressable>
          <Pressable style={styles.controlBtn} onPress={() => setMode(mode === 'grid' ? 'speaker' : 'grid')}>
            <Text style={styles.controlLabel}>{mode === 'grid' ? 'Người nói' : 'Lưới'}</Text>
          </Pressable>
          <Pressable style={[styles.controlBtn, styles.leaveBtn]} onPress={handleLeave} disabled={leaving}>
            <Text style={styles.controlLabel}>{leaving ? 'Đang rời…' : 'Rời phòng'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function gridColsRows(n: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows };
}

function Tile({
  track,
  label,
  big,
  colors,
  shadows,
}: {
  track: TrackReferenceOrPlaceholder;
  label: string;
  big?: boolean;
  colors: ThemeColors;
  shadows: ThemeShadows;
}) {
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);
  if (!isTrackReference(track)) {
    return (
      <View style={styles.tilePlaceholder}>
        <Text style={[styles.tileInitial, big && styles.tileInitialBig]}>
          {label.charAt(0).toUpperCase()}
        </Text>
        <Text style={styles.tileName}>{label}</Text>
      </View>
    );
  }
  return (
    <View style={styles.tile}>
      <VideoTrack trackRef={track} style={styles.tileVideo} objectFit="cover" />
      <View style={styles.tileNameTag}>
        <Text style={styles.tileName}>{label}</Text>
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors, s: ThemeShadows) {
  return StyleSheet.create({
    stage: { flex: 1 },
    stageInner: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
    loadingText: { fontFamily: fonts.semibold, fontSize: fontSize.base, color: c.muted },
    errorText: {
      fontFamily: fonts.bold,
      fontSize: fontSize.base,
      color: c.danger,
      textAlign: 'center',
      paddingHorizontal: 24,
    },
    waitingText: { fontFamily: fonts.semibold, fontSize: fontSize.md, color: c.muted },
    primaryBtn: {
      backgroundColor: c.accent,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 22,
      ...s.button,
    },
    primaryBtnText: { fontFamily: fonts.extrabold, fontSize: fontSize.base, color: c.onAccent },
    grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
    primaryWrap: { flex: 1 },
    dock: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingBottom: 8,
    },
    dockTile: { width: DOCK_TILE, height: DOCK_TILE * 1.5, borderRadius: 12, overflow: 'hidden' },
    tile: {
      flex: 1,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: '#0d151b',
      position: 'relative',
    },
    tileVideo: { flex: 1 },
    tilePlaceholder: {
      flex: 1,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.surface3,
    },
    tileInitial: { fontFamily: fonts.extrabold, fontSize: 34, color: c.muted },
    tileInitialBig: { fontSize: 56 },
    tileNameTag: {
      position: 'absolute',
      left: 8,
      bottom: 8,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    tileName: { color: '#ffffff', fontFamily: fonts.semibold, fontSize: 12 },
    selfOverlay: {
      position: 'absolute',
      right: 12,
      top: 12,
      width: SELF_OVERLAY.width,
      height: SELF_OVERLAY.height,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: '#0d151b',
      ...s.card,
    },
    selfVideo: { flex: 1 },
    selfPlaceholder: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface3,
    },
    selfPlaceholderText: { fontFamily: fonts.extrabold, fontSize: 13, color: c.muted },
    timerChip: {
      position: 'absolute',
      top: 12,
      alignSelf: 'center',
      backgroundColor: c.glassCard,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 8,
      alignItems: 'center',
      ...s.card,
    },
    hiddenChip: { opacity: 0 },
    timerPhase: {
      fontFamily: fonts.extrabold,
      fontSize: 10,
      color: c.accentDark,
      letterSpacing: 1,
    },
    timerClock: {
      fontFamily: fonts.extrabold,
      fontSize: 20,
      color: c.text,
      fontVariant: ['tabular-nums'],
    },
    timerRound: { fontFamily: fonts.semibold, fontSize: 11, color: c.muted },
    controls: {
      position: 'absolute',
      bottom: 28,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.glassCard,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 10,
      ...s.card,
    },
    controlBtn: { alignItems: 'center', paddingHorizontal: 8 },
    controlBtnOff: { opacity: 0.55 },
    leaveBtn: { backgroundColor: c.danger, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    controlLabel: { fontFamily: fonts.bold, fontSize: 13, color: c.text },
    memberBadge: {
      backgroundColor: c.accent,
      borderRadius: 999,
      minWidth: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    memberBadgeText: { fontFamily: fonts.extrabold, fontSize: 14, color: c.onAccent },
  });
}