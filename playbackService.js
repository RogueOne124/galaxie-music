/**
 * playbackService.js
 * Service de lecture en arrière-plan pour react-native-track-player
 * Ce fichier gère les contrôles depuis l'écran de verrouillage,
 * la notification, le casque Bluetooth, etc.
 */
import TrackPlayer, { Event } from 'react-native-track-player';

module.exports = async function () {
  // ▶️ Bouton Play (écran verrouillé / notification / casque BT)
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());

  // ⏸️ Bouton Pause
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());

  // ⏭️ Bouton Suivant
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    TrackPlayer.skipToNext().catch(() => {});
  });

  // ⏮️ Bouton Précédent
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    TrackPlayer.skipToPrevious().catch(() => {});
  });

  // 🎚️ Barre de progression sur l'écran verrouillé
  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position).catch(() => {});
  });

  // ⏹️ Bouton Stop
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.stop().catch(() => {});
  });

  // 🎧 Perte de signal casque → pause auto
  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    if (event.permanent) {
      await TrackPlayer.stop();
    } else if (event.paused) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  });
};