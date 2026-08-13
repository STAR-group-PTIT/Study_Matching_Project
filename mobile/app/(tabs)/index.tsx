import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPublicRooms, type PublicRoom } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { colors, fonts, fontSize, radius, roomTypes, shadows, spacing } from '@/theme';

const CACHE_KEY = 'ff-mobile-rooms-cache';

export default function RoomsScreen() {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const fresh = await fetchPublicRooms();
      setRooms(fresh);
      setOffline(false);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
    } catch {
      // network/backend error -- fall back to the cached list, if any
      setOffline(true);
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached && rooms === null) setRooms(JSON.parse(cached) as PublicRoom[]);
    }
  }, [rooms]);

  useEffect(() => {
    (async () => {
      // render cached data immediately, then refresh from network
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) setRooms(JSON.parse(cached) as PublicRoom[]);
      await load();
    })();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleLogout() {
    await signOut();
    router.replace('/login');
  }

  if (rooms === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accentDark} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={rooms}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accentDark} />}
        ListHeaderComponent={
          <>
            <View style={styles.headerRow}>
              <Text style={styles.count}>
                {rooms.length} phòng đang mở{offline ? ' · dữ liệu ngoại tuyến' : ''}
              </Text>
              <Pressable onPress={handleLogout} hitSlop={8}>
                <Text style={styles.logout}>Đăng xuất</Text>
              </Pressable>
            </View>
            {rooms.length === 0 ? <Text style={styles.empty}>Chưa có phòng nào đang mở.</Text> : null}
          </>
        }
        renderItem={({ item }) => <RoomCard room={item} />}
      />
    </View>
  );
}

function RoomCard({ room }: { room: PublicRoom }) {
  const meta = roomTypes[room.room_type] ?? { name: room.room_type, badgeBg: colors.surface3, badgeText: colors.muted };
  const full = room.member_count >= room.capacity;

  return (
    <Pressable
      onPress={() => router.push(`/room/${room.code}`)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardRow1}>
        <Text style={styles.roomName} numberOfLines={1}>
          {room.name}
        </Text>
        <View style={[styles.badge, { backgroundColor: meta.badgeBg }]}>
          <Text style={[styles.badgeText, { color: meta.badgeText }]}>{meta.name}</Text>
        </View>
      </View>
      <Text style={styles.hostLine}>
        Host {room.host_name} · {room.duration_minutes} phút · {room.language}
      </Text>
      <View style={styles.cardRow3}>
        <View style={styles.people}>
          <View style={[styles.peopleHead, { borderColor: full ? colors.faint : colors.accentDark }]} />
          <View style={[styles.peopleBody, { borderColor: full ? colors.faint : colors.accentDark }]} />
          <Text style={[styles.countText, { color: full ? colors.faint : colors.success }]}>
            {room.member_count}/{room.capacity}
          </Text>
        </View>
        <View style={[styles.joinButton, { backgroundColor: full ? colors.surface3 : colors.accentSoft }]}>
          <Text style={[styles.joinText, { color: full ? colors.faint : colors.onAccent }]}>
            {full ? 'Đầy' : 'Tham gia'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.pageBg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.pageBg,
  },
  listContent: { padding: spacing.md, gap: spacing.md },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  count: {
    fontFamily: fonts.bold,
    fontSize: fontSize.sm,
    color: colors.muted,
    letterSpacing: 0.2,
  },
  logout: {
    fontFamily: fonts.bold,
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  empty: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingHorizontal: 18,
    paddingVertical: 15,
    gap: 7,
    ...shadows.card,
  },
  pressed: { opacity: 0.92 },
  cardRow1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  roomName: {
    flex: 1,
    fontFamily: fonts.extrabold,
    fontSize: 15.5,
    color: colors.text,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: fonts.extrabold,
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  hostLine: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  cardRow3: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  people: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  peopleHead: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1.6,
    marginRight: 9,
    marginBottom: 7,
  },
  peopleBody: {
    width: 17,
    height: 9,
    borderRadius: 9,
    borderWidth: 1.6,
    position: 'absolute',
    left: 4,
    top: 8,
  },
  countText: {
    fontFamily: fonts.extrabold,
    fontSize: 13.5,
    marginLeft: 18,
  },
  joinButton: {
    borderRadius: radius.input,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  joinText: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
  },
});