import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import TrackPlayer from 'react-native-track-player';

// ✅ Enregistre le service de lecture au démarrage de l'app
TrackPlayer.registerPlaybackService(() => require('../../playbackService'));

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}