import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useTheme, fonts } from '@/theme';

export default function TabsLayout() {
  const { colors } = useTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return null;

  if (!session) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accentDark,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 12 },
        headerStyle: { backgroundColor: colors.pageBg },
        headerTitleStyle: { fontFamily: fonts.bold, fontSize: 17 },
        headerShadowVisible: false,
        headerTintColor: colors.text,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trang chủ',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/profile')}
              hitSlop={8}
              style={{
                marginRight: 16,
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.onAccent }}>
                {session?.user.user_metadata?.name?.charAt(0)?.toUpperCase() ?? '?'}
              </Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="rooms" options={{ title: 'Phòng học' }} />
    </Tabs>
  );
}