/**
 * Galaxie Music v9 — Fix scan crash (creationTime undefined)
 */
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, FlatList, Linking, Modal, Platform, Pressable, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import {
  SafeAreaProvider, SafeAreaView, useSafeAreaInsets,
} from 'react-native-safe-area-context';

const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';
let MediaLibrary = null; let VolumeManager = null;
if (!IS_EXPO_GO) {
  try { MediaLibrary = require('expo-media-library'); } catch (e) { console.warn('MediaLibrary load failed:', e.message); }
  try { VolumeManager = require('react-native-volume-manager').VolumeManager; } catch (e) {}
}

const THEMES = [
  { id: 'galaxy',  name: 'Galaxie',   accent: '#A855F7', accent2: '#EC4899', bg: '#0A0620', surface: '#151032', surfaceHigh: '#1F1745', line: '#2E2456', text: '#F4F5F8', textDim: '#9B94C2' },
  { id: 'nebula',  name: 'Nébuleuse', accent: '#EC4899', accent2: '#F472B6', bg: '#1A0512', surface: '#260A1C', surfaceHigh: '#341428', line: '#4A1F38', text: '#F8F4F6', textDim: '#C49AA8' },
  { id: 'aurora',  name: 'Aurore',    accent: '#10B981', accent2: '#22D3EE', bg: '#031A14', surface: '#082A20', surfaceHigh: '#0E3D2E', line: '#1A5743', text: '#F4F8F6', textDim: '#8FB8A8' },
  { id: 'solar',   name: 'Solaire',   accent: '#F59E0B', accent2: '#EF4444', bg: '#1A1004', surface: '#261A0A', surfaceHigh: '#3A2713', line: '#573A1C', text: '#F8F5F0', textDim: '#C4A888' },
  { id: 'ocean',   name: 'Océan',     accent: '#06B6D4', accent2: '#3B82F6', bg: '#041620', surface: '#0A2432', surfaceHigh: '#0F3648', line: '#1A5468', text: '#F0F6F8', textDim: '#8AB8C4' },
  { id: 'mars',    name: 'Mars',      accent: '#EF4444', accent2: '#F97316', bg: '#1A0505', surface: '#260A0A', surfaceHigh: '#3A1313', line: '#571C1C', text: '#F8F0F0', textDim: '#C48888' },
];

const getThemeColors = (id) => {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  return { ...t, accentSoft: t.accent + '30', onAccent: t.bg };
};

const EQ_PRESETS = [
  { id: 'flat',    name: 'Plat',        icon: 'remove' },
  { id: 'bass',    name: 'Bass Boost',  icon: 'trending-up' },
  { id: 'vocal',   name: 'Vocal',       icon: 'mic' },
  { id: 'rock',    name: 'Rock',        icon: 'flash' },
  { id: 'pop',     name: 'Pop',         icon: 'star' },
  { id: 'jazz',    name: 'Jazz',        icon: 'musical-notes' },
  { id: 'classic', name: 'Classique',   icon: 'school' },
  { id: 'custom',  name: 'Personnalisé', icon: 'options' },
];

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = [
  { min: 5, label: '5 min' }, { min: 15, label: '15 min' }, { min: 30, label: '30 min' },
  { min: 45, label: '45 min' }, { min: 60, label: '1 h' },
];

const ROW_HEIGHT = 68;
const PLAYER_OPTIONS = { updateInterval: 250 };
const SECURE_KEYS = { FAV: 'galaxie_favorites', HIDDEN: 'galaxie_hidden' };
const CACHE_KEY = '@galaxie/tracks_cache';
const HISTORY_KEY = '@galaxie/history';

const SORTS = [
  { key: 'recent', label: 'Récents' },
  { key: 'title', label: 'Titre' },
  { key: 'artist', label: 'Artiste' },
  { key: 'duration', label: 'Durée' },
];

const LIBRARY_TABS = [
  { key: 'all',     label: 'Tous',     icon: 'list' },
  { key: 'fav',     label: 'Favoris',  icon: 'heart' },
  { key: 'recent',  label: 'Récents',  icon: 'time' },
  { key: 'folders', label: 'Dossiers', icon: 'folder' },
  { key: 'hidden',  label: 'Masqués',  icon: 'eye-off' },
];

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'mp2', 'mpga', 'm4a', 'm4b', 'm4r', 'aac', 'adts', 'wav', 'wave', 'flac',
  'ogg', 'oga', 'opus', 'spx', 'wma', 'aif', 'aiff', 'aifc', 'caf', 'amr', 'awb',
  '3gp', '3ga', 'mid', 'midi', 'kar', 'mka', 'weba', 'webm', 'ac3', 'eac3', 'dts',
  'ape', 'wv', 'tta', 'dsf', 'dff', 'mpc', 'mp4',
]);

const keyExtractor = (track) => track.id;
const formatTime = (s) => {
  const total = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const hueOf = (text) => { let hue = 7; for (let i = 0; i < text.length; i += 1) hue = (hue * 31 + text.charCodeAt(i)) % 360; return hue; };
const shuffled = (arr) => { const c = [...arr]; for (let i = c.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };

const parseName = (filename = '') => {
  const dot = filename.lastIndexOf('.');
  const hasExt = dot > 0 && filename.length - dot <= 6;
  const ext = hasExt ? filename.slice(dot + 1).toLowerCase() : '';
  const base = (hasExt ? filename.slice(0, dot) : filename).replace(/_/g, ' ').trim();
  const cut = base.indexOf(' - ');
  if (cut > 0) return { artist: base.slice(0, cut).trim(), title: base.slice(cut + 3).trim() || base, ext };
  return { artist: 'Artiste inconnu', title: base || 'Sans titre', ext };
};

const folderOf = (uri = '') => { try { const d = decodeURIComponent(uri); const p = d.split('/'); return p[p.length - 2] || 'Racine'; } catch (e) { return 'Racine'; } };
const looksLikeAudio = (a) => { const m = (a.mimeType || '').toLowerCase(); const e = (a.name || '').split('.').pop().toLowerCase(); return m.startsWith('audio/') || m.startsWith('video/') || m === 'application/ogg' || AUDIO_EXTENSIONS.has(e); };

// ✅ FIX : protège contre les éléments undefined/null
const fromMetadata = (m) => {
  if (!m || !m.id) return null;
  return {
    id: `lib:${m.id}`,
    uri: m.uri,
    duration: m.duration ? m.duration / 1000 : 0,
    addedAt: m.creationTime || Date.now(),
    folder: folderOf(m.uri),
    ...parseName(m.filename || ''),
  };
};
const fromPickedFile = (a) => ({ id: `file:${a.uri}`, uri: a.uri, duration: 0, addedAt: a.lastModified || Date.now(), folder: folderOf(a.uri), ...parseName(a.name || '') });
const mergeTracks = (prev, inc) => { const map = new Map(prev.map((t) => [t.id, t])); inc.forEach((t) => { if (t && t.id) map.set(t.id, t); }); return Array.from(map.values()); };

const styles = StyleSheet.create({
  root: { flex: 1 }, screen: { flex: 1 }, pressed: { opacity: 0.6 },
  decorLayer: { position: 'absolute', top: -100, left: -50, right: -50, height: 300, opacity: 0.55 },
  decorLayer2: { position: 'absolute', bottom: -100, right: -50, left: -50, height: 260, opacity: 0.35 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 4 },
  brand: { fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  brandSub: { fontSize: 12, marginTop: 1 },
  topActions: { flexDirection: 'row', gap: 6 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  filterWrapper: { height: 44, marginTop: 10 },
  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, alignItems: 'center' },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1 },
  filterChipText: { fontSize: 12, fontWeight: '700' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, marginHorizontal: 16, marginTop: 10, paddingHorizontal: 14, borderRadius: 14 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  actionsRow1: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  actionsRow2: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 10, paddingTop: 8 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, overflow: 'hidden' },
  primaryBtnText: { fontSize: 14, fontWeight: '700' },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1 },
  ghostBtnText: { fontSize: 14, fontWeight: '600' },
  toolBtn: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, borderWidth: 1 },
  toolBtnText: { fontSize: 11, fontWeight: '700' },
  list: { flex: 1 },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, position: 'relative' },
  rowActiveBar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2 },
  rowText: { flex: 1, marginHorizontal: 14 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 3 },
  rowTime: { fontSize: 12, fontVariant: ['tabular-nums'] },
  art: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  artLetter: { fontWeight: '800' },
  empty: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 14, marginBottom: 8, textAlign: 'center' },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyActions: { flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 20, width: '100%' },
  bigBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 20, borderRadius: 24, overflow: 'hidden', width: '100%', justifyContent: 'center' },
  bigBtnText: { fontSize: 15, fontWeight: '700' },
  debugText: { fontSize: 11, color: '#888', marginTop: 10, textAlign: 'center' },
  mini: { position: 'absolute', height: 68, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 4, borderRadius: 20, elevation: 12, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, overflow: 'hidden', borderWidth: 1 },
  miniText: { flex: 1, marginLeft: 12 },
  miniTitle: { fontSize: 15, fontWeight: '700' },
  miniSub: { fontSize: 12, marginTop: 2 },
  miniProgressTrack: { position: 'absolute', left: 16, right: 16, bottom: 0, height: 3, borderRadius: 2 },
  miniProgressFill: { height: 3, borderRadius: 2 },
  full: { flex: 1, paddingHorizontal: 24 },
  fullHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  fullHeaderTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  fullArt: { alignItems: 'center', marginTop: 12, position: 'relative' },
  fullArtGlow: { position: 'absolute', width: 320, height: 320, borderRadius: 160, top: -20, opacity: 0.35 },
  fullInfo: { marginTop: 14, alignItems: 'center' },
  fullTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  fullArtist: { fontSize: 14, marginTop: 4, textAlign: 'center' },
  seek: { width: '100%', height: 40, marginTop: 10 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  time: { fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  playBtn: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.6, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12, overflow: 'hidden' },
  repeatBadge: { position: 'absolute', fontSize: 9, fontWeight: '900' },
  extraBar: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12, paddingHorizontal: 4 },
  extraBtn: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, borderRadius: 12, minWidth: 60 },
  extraBtnText: { fontSize: 10, fontWeight: '700', marginTop: 3 },
  extraBtnLabel: { fontSize: 9, marginTop: 1, opacity: 0.7 },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, marginTop: 8 },
  volumeSlider: { flex: 1, height: 40 },
  volumeText: { width: 44, fontSize: 12, textAlign: 'right', fontVariant: ['tabular-nums'] },
  toast: { position: 'absolute', left: 20, right: 20, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1 },
  toastText: { fontSize: 14, textAlign: 'center' },
  sheetModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 18, paddingBottom: 28, paddingHorizontal: 20, maxHeight: '75%' },
  sheetTitle: { fontSize: 17, fontWeight: '800', marginBottom: 16 },
  sheetSub: { fontSize: 12, marginBottom: 12, opacity: 0.7 },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  themeCard: { width: '30%', aspectRatio: 1.4, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  themeCardText: { fontSize: 11, fontWeight: '700', marginTop: 4 },
  eqGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  eqCard: { width: '23%', aspectRatio: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  eqCardText: { fontSize: 10, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  speedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  speedChip: { width: '22%', paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1.5 },
  speedChipText: { fontSize: 14, fontWeight: '800' },
  sleepOption: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, borderWidth: 1 },
  sleepOptionText: { fontSize: 15, fontWeight: '600' },
  queueRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, gap: 12 },
  queueIndex: { width: 28, fontSize: 12, textAlign: 'center', fontVariant: ['tabular-nums'] },
  queueInfo: { flex: 1 },
  queueTitle: { fontSize: 14, fontWeight: '600' },
  queueSub: { fontSize: 11, marginTop: 2 },
  ctxBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  ctxSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 24, paddingHorizontal: 16 },
  ctxHeader: { paddingHorizontal: 12, paddingBottom: 14, borderBottomWidth: 1 },
  ctxTitle: { fontSize: 17, fontWeight: '800' },
  ctxSub: { fontSize: 13, marginTop: 3 },
  ctxItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12 },
  ctxItemText: { fontSize: 15, fontWeight: '600' },
  ctxDivider: { height: 1, marginVertical: 4 },
  folderCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, marginBottom: 8, borderWidth: 1 },
  folderName: { flex: 1, fontSize: 15, fontWeight: '700' },
  folderCount: { fontSize: 12 },
});

function Artwork({ title, size, radius, playing, colors }) {
  const hue = hueOf(title);
  const c1 = `hsl(${hue}, 60%, 32%)`;
  const c2 = `hsl(${(hue + 60) % 360}, 70%, 22%)`;
  return (
    <View style={[styles.art, { width: size, height: size, borderRadius: radius, borderWidth: playing ? 2 : 0, borderColor: playing ? colors.accent : 'transparent' }]}>
      <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[styles.artLetter, { fontSize: size * 0.42, color: `hsl(${hue}, 90%, 88%)` }]}>
          {(title.trim()[0] || '♪').toUpperCase()}
        </Text>
      </LinearGradient>
    </View>
  );
}

const AnimatedEqualizer = memo(function AnimatedEqualizer({ color, size = 18 }) {
  const bar1 = useRef(new Animated.Value(0.4)).current;
  const bar2 = useRef(new Animated.Value(0.7)).current;
  const bar3 = useRef(new Animated.Value(0.5)).current;
  const bar4 = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    const animLoop = (anim, duration) => Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.25, duration, useNativeDriver: true }),
    ]));
    const animations = [animLoop(bar1, 420), animLoop(bar2, 580), animLoop(bar3, 500), animLoop(bar4, 640)];
    animations.forEach((a) => a.start());
    return () => { bar1.stopAnimation(); bar2.stopAnimation(); bar3.stopAnimation(); bar4.stopAnimation(); };
  }, [bar1, bar2, bar3, bar4]);
  const barStyle = (anim) => ({ width: 3, height: size, marginHorizontal: 1, borderRadius: 2, backgroundColor: color, transform: [{ scaleY: anim }] });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', width: size * 0.9, height: size }}>
      <Animated.View style={barStyle(bar1)} /><Animated.View style={barStyle(bar2)} /><Animated.View style={barStyle(bar3)} /><Animated.View style={barStyle(bar4)} />
    </View>
  );
});

function IconButton({ name, onPress, onLongPress, size = 22, color, filled, active, colors }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, filled && { backgroundColor: colors.surface }, active && { backgroundColor: colors.accentSoft }, pressed && styles.pressed]}>
      <Ionicons name={name} size={size} color={color || colors.text} />
    </Pressable>
  );
}

const TrackRow = memo(function TrackRow({ item, active, playing, onPress, onLongPress, isFav, colors, index }) {
  return (
    <Pressable onPress={() => onPress(item.id)} onLongPress={() => onLongPress(item)} delayLongPress={350}
      style={({ pressed }) => [styles.row, active && { backgroundColor: colors.accentSoft }, pressed && styles.pressed]}>
      {active && <View style={[styles.rowActiveBar, { backgroundColor: colors.accent }]} />}
      {index !== undefined && <Text style={{ width: 22, fontSize: 12, color: active ? colors.accent : colors.textDim, fontVariant: ['tabular-nums'] }}>{index + 1}</Text>}
      <Artwork title={item.title} size={46} radius={12} playing={active && playing} colors={colors} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: active ? colors.accent : colors.text }]}>{item.title}</Text>
        <Text numberOfLines={1} style={[styles.rowSub, { color: colors.textDim }]}>{item.artist}{item.ext ? ` · ${item.ext.toUpperCase()}` : ''}</Text>
      </View>
      {isFav && <Ionicons name="heart" size={15} color={colors.accent} style={{ marginRight: 6 }} />}
      {active ? (playing ? <AnimatedEqualizer color={colors.accent} size={18} /> : <Ionicons name="pause" size={18} color={colors.accent} />) : (
        <Text style={[styles.rowTime, { color: colors.textDim }]}>{item.duration ? formatTime(item.duration) : ''}</Text>
      )}
    </Pressable>
  );
});

function Toast({ message, top, colors }) {
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.toast, { top, backgroundColor: colors.surfaceHigh, borderColor: colors.line }]}>
      <Text style={[styles.toastText, { color: colors.text }]} numberOfLines={2}>{message}</Text>
    </View>
  );
}

function Sheet({ visible, onClose, title, sub, colors, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetModal} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surfaceHigh }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
          {sub && <Text style={[styles.sheetSub, { color: colors.textDim }]}>{sub}</Text>}
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ContextMenu({ track, visible, onClose, isFav, isHidden, colors, onToggleFav, onToggleHidden, onQueue, onPlayNext, onInfo, onDelete, onShare, onGotoFolder }) {
  if (!track) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.ctxBg} onPress={onClose}>
        <Pressable style={[styles.ctxSheet, { backgroundColor: colors.surfaceHigh }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.ctxHeader, { borderColor: colors.line }]}>
            <Text style={[styles.ctxTitle, { color: colors.text }]} numberOfLines={1}>{track.title}</Text>
            <Text style={[styles.ctxSub, { color: colors.textDim }]} numberOfLines={1}>{track.artist}{track.ext ? ` · ${track.ext.toUpperCase()}` : ''}{track.folder ? ` · ${track.folder}` : ''}</Text>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Pressable style={styles.ctxItem} onPress={() => { onPlayNext(track); onClose(); }}>
              <Ionicons name="play-skip-forward" size={22} color={colors.accent} />
              <Text style={[styles.ctxItemText, { color: colors.accent }]}>Lire ensuite</Text>
            </Pressable>
            <Pressable style={styles.ctxItem} onPress={() => { onQueue(track); onClose(); }}>
              <Ionicons name="list" size={22} color={colors.text} />
              <Text style={[styles.ctxItemText, { color: colors.text }]}>Ajouter à la file</Text>
            </Pressable>
            <View style={[styles.ctxDivider, { backgroundColor: colors.line }]} />
            <Pressable style={styles.ctxItem} onPress={() => { onToggleFav(track); onClose(); }}>
              <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={22} color={isFav ? colors.accent : colors.text} />
              <Text style={[styles.ctxItemText, { color: colors.text }]}>{isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}</Text>
            </Pressable>
            <Pressable style={styles.ctxItem} onPress={() => { onGotoFolder(track); onClose(); }}>
              <Ionicons name="folder-open-outline" size={22} color={colors.text} />
              <Text style={[styles.ctxItemText, { color: colors.text }]}>Voir le dossier</Text>
            </Pressable>
            <Pressable style={styles.ctxItem} onPress={() => { onShare(track); onClose(); }}>
              <Ionicons name="share-social-outline" size={22} color={colors.text} />
              <Text style={[styles.ctxItemText, { color: colors.text }]}>Partager</Text>
            </Pressable>
            <Pressable style={styles.ctxItem} onPress={() => { onInfo(track); onClose(); }}>
              <Ionicons name="information-circle-outline" size={22} color={colors.text} />
              <Text style={[styles.ctxItemText, { color: colors.text }]}>Détails</Text>
            </Pressable>
            <View style={[styles.ctxDivider, { backgroundColor: colors.line }]} />
            <Pressable style={styles.ctxItem} onPress={() => { onToggleHidden(track); onClose(); }}>
              <Ionicons name={isHidden ? 'eye' : 'eye-off'} size={22} color={colors.textDim} />
              <Text style={[styles.ctxItemText, { color: colors.textDim }]}>{isHidden ? 'Afficher à nouveau' : 'Masquer de la liste'}</Text>
            </Pressable>
            <Pressable style={styles.ctxItem} onPress={() => { onClose(); setTimeout(() => onDelete(track), 300); }}>
              <Ionicons name="trash-outline" size={22} color="#EF4444" />
              <Text style={[styles.ctxItemText, { color: '#EF4444' }]}>Supprimer définitivement</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Player() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [themeId, setThemeId] = useState('galaxy');
  const colors = useMemo(() => getThemeColors(themeId), [themeId]);
  const player = useAudioPlayer(null, PLAYER_OPTIONS);
  const status = useAudioPlayerStatus(player);

  const [tracks, setTracks] = useState([]);
  const [libState, setLibState] = useState(IS_EXPO_GO ? 'manual' : 'loading');
  const [libMessage, setLibMessage] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortIndex, setSortIndex] = useState(0);
  const [filter, setFilter] = useState('all');
  const [activeFolder, setActiveFolder] = useState(null);
  const [favorites, setFavorites] = useState(new Set());
  const [hidden, setHidden] = useState(new Set());
  const [history, setHistory] = useState([]);
  const [ctxTrack, setCtxTrack] = useState(null);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [eqPreset, setEqPreset] = useState('flat');
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [sleepTimerMin, setSleepTimerMin] = useState(0);
  const [sleepRemaining, setSleepRemaining] = useState(0);

  const [currentId, setCurrentId] = useState(null);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [toast, setToast] = useState(null);

  const currentRef = useRef(null);
  const queueRef = useRef([]);
  const baseRef = useRef([]);
  const endHandled = useRef(false);
  const startedAt = useRef(0);
  const failStreak = useRef(0);
  const errorTimer = useRef(null);
  const toastTimer = useRef(null);
  const sleepTimerRef = useRef(null);
  const latest = useRef({});
  const lockScreenActive = useRef(false);

  const sortKey = SORTS[sortIndex].key;
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const current = currentId ? byId.get(currentId) : null;

  const folders = useMemo(() => {
    const map = new Map();
    tracks.forEach((t) => { const f = t.folder || 'Racine'; map.set(f, (map.get(f) || 0) + 1); });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tracks]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tracks.filter((t) => {
      if (filter === 'hidden') return hidden.has(t.id);
      if (hidden.has(t.id)) return false;
      if (filter === 'fav') return favorites.has(t.id);
      if (filter === 'recent') return history.includes(t.id);
      if (filter === 'folders' && activeFolder) return t.folder === activeFolder;
      return true;
    });
    if (q) list = list.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q));
    if (sortKey === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortKey === 'artist') list.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    else if (sortKey === 'duration') list.sort((a, b) => (a.duration || 0) - (b.duration || 0));
    else list.sort((a, b) => b.addedAt - a.addedAt);
    return list;
  }, [tracks, query, sortKey, filter, favorites, hidden, history, activeFolder]);

  const duration = status.duration > 0 ? status.duration : (current && current.duration) || 0;
  const position = Math.min(status.currentTime || 0, duration || 0);
  const progress = duration ? position / duration : 0;
  const effectiveVolume = muted ? 0 : volume;
  let volumeIcon = 'volume-high';
  if (effectiveVolume === 0) volumeIcon = 'volume-mute';
  else if (effectiveVolume < 0.34) volumeIcon = 'volume-low';
  else if (effectiveVolume < 0.67) volumeIcon = 'volume-medium';
  const artSize = Math.max(140, Math.min(width - 100, height * 0.26, 280));

  const showToast = useCallback((msg) => {
    setToast(msg); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [fav, hid, hist] = await Promise.all([
          SecureStore.getItemAsync(SECURE_KEYS.FAV),
          SecureStore.getItemAsync(SECURE_KEYS.HIDDEN),
          AsyncStorage.getItem(HISTORY_KEY),
        ]);
        if (fav) setFavorites(new Set(JSON.parse(fav)));
        if (hid) setHidden(new Set(JSON.parse(hid)));
        if (hist) setHistory(JSON.parse(hist));
      } catch (e) {}
    })();
  }, []);

  useEffect(() => { SecureStore.setItemAsync(SECURE_KEYS.FAV, JSON.stringify([...favorites])).catch(() => {}); }, [favorites]);
  useEffect(() => { SecureStore.setItemAsync(SECURE_KEYS.HIDDEN, JSON.stringify([...hidden])).catch(() => {}); }, [hidden]);
  useEffect(() => { AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100))).catch(() => {}); }, [history]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          if (Array.isArray(cached) && cached.length > 0) { setTracks(cached); setLibState(IS_EXPO_GO ? 'manual' : 'ready'); setLibMessage(`Cache: ${cached.length} titres`); }
        }
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    if (tracks.length === 0) return;
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(tracks)).catch(() => {});
  }, [tracks]);

  const scanDevice = useCallback(async (silent = false) => {
    setLibMessage('');
    if (!MediaLibrary) {
      console.warn('[scan] MediaLibrary non chargé');
      setLibState('manual');
      setLibMessage('Module média non chargé');
      return;
    }
    if (Platform.OS !== 'android') {
      setLibState('manual');
      setLibMessage('Non supporté sur iOS/web');
      return;
    }
    if (!silent) setLibState('loading');

    try {
      const current = await MediaLibrary.getPermissionsAsync();
      console.log('[scan] permission actuelle:', current.status, 'canAskAgain:', current.canAskAgain);
      let granted = current.granted;

      if (!granted && (current.status === 'undetermined' || current.canAskAgain)) {
        const asked = await MediaLibrary.requestPermissionsAsync();
        console.log('[scan] après demande:', asked.status, asked.granted);
        granted = asked.granted;
      }

      if (!granted) {
        try {
          const granular = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
          console.log('[scan] granulaire:', granular.status, granular.granted);
          granted = granular.granted;
        } catch (e) {
          console.warn('[scan] granulaire échoué:', e.message);
        }
      }

      if (!granted) {
        console.log('[scan] permission refusée');
        setLibState('denied');
        setLibMessage('Permission refusée');
        if (!silent) showToast('Permission refusée');
        return;
      }

      const found = [];
      let cursor = undefined;
      const PAGE = 500;
      for (let i = 0; i < 30; i++) {
        const result = await MediaLibrary.getAssetsAsync({
          mediaType: MediaLibrary.MediaType.audio,
          sortBy: [MediaLibrary.SortBy.default],
          first: PAGE,
          after: cursor,
        });
        // ✅ FIX : filtre les éléments null/undefined
        if (result && Array.isArray(result.assets)) {
          found.push(...result.assets.filter(Boolean));
        }
        if (!result || !result.hasNextPage) break;
        cursor = result.endCursor;
      }

      console.log('[scan] fichiers trouvés:', found.length);
      // ✅ FIX : filtre les null après map
      const mapped = found.map(fromMetadata).filter(Boolean);
      setTracks((prev) => mergeTracks(prev, mapped));
      setLibState('ready');
      setLibMessage(`${mapped.length} titres scannés`);

      if (!silent) {
        showToast(mapped.length > 0
          ? `${mapped.length} fichier(s) trouvé(s)`
          : 'Aucun fichier audio trouvé');
      }
    } catch (e) {
      console.warn('[scan] erreur:', e);
      setLibState('error');
      setLibMessage(`Erreur: ${e.message}`);
      if (!silent) showToast('Erreur de scan');
    }
  }, [showToast]);

  const pickFiles = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const accepted = result.assets.filter(looksLikeAudio);
      const skipped = result.assets.length - accepted.length;
      if (accepted.length) { setTracks((prev) => mergeTracks(prev, accepted.map(fromPickedFile))); setLibState((s) => (s === 'loading' ? 'ready' : s)); }
      showToast(skipped ? `${accepted.length} ajouté(s), ${skipped} ignoré(s)` : `${accepted.length} titre(s) ajouté(s)`);
    } catch (e) { showToast("Impossible d'ouvrir le sélecteur"); }
  }, [showToast]);

  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {}); }, []);

  useEffect(() => {
    if (IS_EXPO_GO || !MediaLibrary) return;
    let cancelled = false;
    const run = async () => {
      try {
        const { status: st } = await MediaLibrary.getPermissionsAsync();
        console.log('[auto-scan] statut:', st);
        if (cancelled) return;

        if (st === 'granted') {
          scanDevice(true);
        } else if (st === 'undetermined' || st === 'denied') {
          scanDevice(false);
        } else {
          setLibState('manual');
        }
      } catch (e) {
        if (!cancelled) setLibState('manual');
      }
    };
    run();
    return () => { cancelled = true; };
  }, [scanDevice]);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {
      Alert.alert('Info', 'Va dans Paramètres → Applications → Galaxie Music → Autorisations');
    });
  }, []);

  const rescan = useCallback(() => scanDevice(false), [scanDevice]);

  useEffect(() => {
    if (!VolumeManager) return;
    let listener = null;
    (async () => {
      try { const { volume: v } = await VolumeManager.getVolume(); if (typeof v === 'number') setVolume(v); } catch (e) {}
      try { listener = VolumeManager.addVolumeListener((r) => { setVolume(r.volume); setMuted(r.volume === 0); }); } catch (e) {}
    })();
    return () => { try { listener?.remove?.(); } catch (e) {} };
  }, []);

  useEffect(() => { player.volume = volume; player.muted = muted; }, [player, volume, muted, currentId]);
  useEffect(() => { if (player && 'playbackRate' in player) { try { player.playbackRate = playbackSpeed; } catch (e) {} } }, [player, playbackSpeed, currentId]);

  useEffect(() => {
    clearInterval(sleepTimerRef.current);
    if (sleepTimerMin <= 0) { setSleepRemaining(0); return; }
    setSleepRemaining(sleepTimerMin * 60);
    sleepTimerRef.current = setInterval(() => {
      setSleepRemaining((s) => {
        if (s <= 1) { clearInterval(sleepTimerRef.current); try { player.pause(); } catch (e) {} showToast('⏰ Minuteur éteint la musique'); setSleepTimerMin(0); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(sleepTimerRef.current);
  }, [sleepTimerMin, player, showToast]);

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.playing) failStreak.current = 0;
      if (s.error) {
        if (!errorTimer.current) {
          errorTimer.current = setTimeout(() => {
            errorTimer.current = null;
            if (!endHandled.current) { endHandled.current = true; latest.current.onError(); }
          }, 500);
        }
        return;
      }
      if (errorTimer.current) { clearTimeout(errorTimer.current); errorTimer.current = null; }
      if (s.didJustFinish && !endHandled.current && Date.now() - startedAt.current > 150) { endHandled.current = true; latest.current.onEnd(); }
    });
    return () => { sub.remove(); clearTimeout(errorTimer.current); errorTimer.current = null; };
  }, [player]);

  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(errorTimer.current); clearInterval(sleepTimerRef.current); }, []);

  const handleVolumeChange = useCallback((v) => { setVolume(v); setMuted(v === 0); if (VolumeManager) { try { VolumeManager.setVolume(v); } catch (e) {} } }, []);

  const startTrack = (id) => {
    const track = byId.get(id);
    if (!track) return;
    currentRef.current = id; endHandled.current = false; startedAt.current = Date.now();
    clearTimeout(errorTimer.current); errorTimer.current = null;
    setCurrentId(id); setSeeking(false);
    setHistory((h) => [id, ...h.filter((x) => x !== id)].slice(0, 100));
    try {
      player.replace({ uri: track.uri, name: track.title });
      player.play();
      if ('playbackRate' in player) { try { player.playbackRate = playbackSpeed; } catch (e) {} }
      try {
        if (lockScreenActive.current && player.updateLockScreenMetadata) { player.updateLockScreenMetadata({ title: track.title, artist: track.artist }); }
        else if (player.setActiveForLockScreen) {
          player.setActiveForLockScreen(true, { title: track.title, artist: track.artist }, { showSeekBackward: true, showSeekForward: true });
          lockScreenActive.current = true;
        }
      } catch (e) {}
    } catch (e) { showToast(`Lecture impossible : ${track.title}`); }
  };

  const playFrom = (id, list = visible, randomOrder = shuffle) => {
    const ids = list.map((t) => t.id);
    baseRef.current = ids;
    queueRef.current = randomOrder ? [id, ...shuffled(ids.filter((x) => x !== id))] : ids;
    startTrack(id);
  };

  const playAll = (randomOrder) => {
    if (!visible.length) return;
    setShuffle(randomOrder);
    const first = randomOrder ? visible[Math.floor(Math.random() * visible.length)] : visible[0];
    playFrom(first.id, visible, randomOrder);
  };

  const step = (dir, auto = false) => {
    const queue = queueRef.current;
    if (!queue.length) return;
    let next = queue.indexOf(currentRef.current) + dir;
    if (next < 0 || next >= queue.length) {
      if (auto && repeat !== 'all') { player.pause(); player.seekTo(0); return; }
      next = (next + queue.length) % queue.length;
    }
    startTrack(queue[next]);
  };

  const onEnd = () => { if (repeat === 'one') { endHandled.current = false; player.seekTo(0); player.play(); return; } step(1, true); };
  const onError = () => { const track = byId.get(currentRef.current); showToast(`Format non pris en charge : ${track ? track.title : 'fichier'}`); failStreak.current += 1; if (failStreak.current >= 5) { failStreak.current = 0; return; } step(1, true); };
  const togglePlay = () => { if (!current) { if (visible.length) playFrom(visible[0].id); return; } if (status.playing) { player.pause(); return; } if (status.duration > 0 && status.currentTime >= status.duration - 0.3) player.seekTo(0); endHandled.current = false; player.play(); };
  const previous = () => { if (status.currentTime > 3) { player.seekTo(0); return; } step(-1); };
  const toggleShuffle = () => { const next = !shuffle; setShuffle(next); const base = baseRef.current; const now = currentRef.current; queueRef.current = next && now ? [now, ...shuffled(base.filter((x) => x !== now))] : base; };
  const cycleRepeat = () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));
  const cycleSort = () => setSortIndex((i) => (i + 1) % SORTS.length);
  const toggleSearch = () => { setSearchOpen((o) => !o); setQuery(''); };
  const handleRowPress = (id) => { if (id === currentRef.current) { setFullOpen(true); return; } playFrom(id); };
  const handleRowLongPress = (track) => { setCtxTrack(track); setCtxOpen(true); };

  const toggleFavorite = useCallback((track) => {
    setFavorites((prev) => { const next = new Set(prev); if (next.has(track.id)) { next.delete(track.id); showToast('Retiré des favoris'); } else { next.add(track.id); showToast('Ajouté aux favoris ❤️'); } return next; });
  }, [showToast]);

  const toggleHidden = useCallback((track) => {
    setHidden((prev) => { const next = new Set(prev); if (next.has(track.id)) { next.delete(track.id); showToast('Titre affiché'); } else { next.add(track.id); showToast('Titre masqué'); } return next; });
  }, [showToast]);

  const addToQueue = useCallback((track) => {
    if (queueRef.current.includes(track.id)) { showToast('Déjà dans la file'); return; }
    queueRef.current = [...queueRef.current, track.id]; showToast('Ajouté à la file');
  }, [showToast]);

  const playNext = useCallback((track) => {
    const queue = queueRef.current;
    const curIdx = queue.indexOf(currentRef.current);
    if (curIdx === -1) {
      if (queue.length === 0) { baseRef.current = [track.id]; queueRef.current = [track.id]; }
      else { queueRef.current = [track.id, ...queue.filter((x) => x !== track.id)]; }
      startTrack(track.id); showToast('Lecture lancée'); return;
    }
    const filtered = queue.filter((x) => x !== track.id);
    const newIdx = filtered.indexOf(currentRef.current);
    filtered.splice(newIdx + 1, 0, track.id);
    queueRef.current = filtered; baseRef.current = filtered; showToast('Sera lu juste après ⏭️');
  }, [showToast]);

  const showInfo = useCallback((track) => {
    Alert.alert(track.title, `Artiste : ${track.artist}\nDossier : ${track.folder || 'Racine'}\nFormat : ${track.ext ? track.ext.toUpperCase() : 'inconnu'}\nDurée : ${track.duration ? formatTime(track.duration) : 'inconnue'}\nSource : ${track.id.startsWith('lib:') ? 'Bibliothèque' : 'Importé'}\n\nURI :\n${track.uri}`, [{ text: 'OK' }]);
  }, []);

  const gotoFolder = useCallback((track) => { setFilter('folders'); setActiveFolder(track.folder || 'Racine'); showToast(`Dossier : ${track.folder || 'Racine'}`); }, [showToast]);

  const deleteTrack = useCallback((track) => {
    Alert.alert('Supprimer', `Supprimer "${track.title}" ? Cette action est irréversible.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        try {
          if (!track.id.startsWith('lib:') || !MediaLibrary) { showToast('Non disponible pour les fichiers importés'); return; }
          await MediaLibrary.deleteAssetsAsync([track.id.replace('lib:', '')]);
          setTracks((prev) => prev.filter((t) => t.id !== track.id));
          if (currentRef.current === track.id) { currentRef.current = null; setCurrentId(null); player.pause(); }
          showToast('Titre supprimé');
        } catch (e) { showToast('Impossible de supprimer'); }
      }},
    ]);
  }, [player, showToast]);

  const shareTrack = useCallback(async (track) => {
    try {
      const Sharing = require('expo-sharing');
      const available = await Sharing.isAvailableAsync();
      if (!available) { showToast('Partage non disponible'); return; }
      await Sharing.shareAsync(track.uri, { mimeType: 'audio/mpeg', dialogTitle: `Partager "${track.title}"` });
    } catch (e) { showToast('Impossible de partager'); }
  }, [showToast]);

  useEffect(() => { latest.current = { onEnd, onError, handleRowPress }; });
  const onRowPress = useCallback((id) => latest.current.handleRowPress(id), []);
  const onRowLongPress = useCallback((track) => handleRowLongPress(track), []);

  const renderItem = useCallback(
    ({ item, index }) => (
      <TrackRow item={item} active={item.id === currentId} playing={status.playing} onPress={onRowPress} onLongPress={onRowLongPress} isFav={favorites.has(item.id)} colors={colors} index={filter === 'folders' && activeFolder ? index : undefined} />
    ),
    [currentId, status.playing, onRowPress, onRowLongPress, favorites, colors, filter, activeFolder],
  );

  const getItemLayout = useCallback((_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index }), []);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <LinearGradient colors={[colors.accent + '22', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.decorLayer} pointerEvents="none" />
      <LinearGradient colors={['transparent', colors.accent2 + '18']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.decorLayer2} pointerEvents="none" />

      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={[styles.topBar, { paddingLeft: 16 + (insets.left || 0), paddingRight: 16 + (insets.right || 0) }]}>
          <View>
            <Text style={[styles.brand, { color: colors.text }]}>Galaxie</Text>
            <Text style={[styles.brandSub, { color: colors.textDim }]}>{tracks.length} titre{tracks.length > 1 ? 's' : ''}{libState === 'loading' && ' · scan…'}</Text>
          </View>
          <View style={styles.topActions}>
            <IconButton name="color-palette" filled colors={colors} onPress={() => setThemeOpen(true)} />
            <IconButton name={searchOpen ? 'close' : 'search'} filled colors={colors} onPress={toggleSearch} />
            {!IS_EXPO_GO && <IconButton name="refresh" filled colors={colors} onPress={rescan} />}
            <IconButton name="add" filled colors={colors} onPress={pickFiles} />
          </View>
        </View>

        <View style={styles.filterWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filterRow, { paddingLeft: 16 + (insets.left || 0), paddingRight: 16 + (insets.right || 0) }]}>
            {LIBRARY_TABS.map((f) => {
              const isActive = filter === f.key;
              const count = f.key === 'fav' ? favorites.size : f.key === 'hidden' ? hidden.size : f.key === 'folders' ? folders.length : f.key === 'recent' ? history.length : tracks.length;
              return (
                <Pressable key={f.key} onPress={() => { setFilter(f.key); if (f.key !== 'folders') setActiveFolder(null); }}
                  style={[styles.filterChip, { backgroundColor: isActive ? colors.accent : colors.surface, borderColor: isActive ? colors.accent : colors.line }]}>
                  <Ionicons name={f.icon} size={13} color={isActive ? colors.onAccent : colors.text} />
                  <Text style={[styles.filterChipText, { color: isActive ? colors.onAccent : colors.text }]}>{f.label} {count > 0 ? `· ${count}` : ''}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {searchOpen && (
          <View style={[styles.searchBox, { backgroundColor: colors.surface, marginLeft: 16 + (insets.left || 0), marginRight: 16 + (insets.right || 0) }]}>
            <Ionicons name="search" size={18} color={colors.textDim} />
            <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Titre ou artiste" placeholderTextColor={colors.textDim} returnKeyType="search" style={[styles.searchInput, { color: colors.text }]} />
          </View>
        )}

        <View style={[styles.actionsRow1, { paddingLeft: 16 + (insets.left || 0), paddingRight: 16 + (insets.right || 0) }]}>
          <Pressable onPress={() => playAll(false)} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
            <LinearGradient colors={[colors.accent, colors.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14 }}>
              <Ionicons name="play" size={16} color={colors.onAccent} />
              <Text style={[styles.primaryBtnText, { color: colors.onAccent }]}>Tout lire</Text>
            </LinearGradient>
          </Pressable>
          <Pressable style={[styles.ghostBtn, { borderColor: colors.line, backgroundColor: colors.surface }]} onPress={() => playAll(true)}>
            <Ionicons name="shuffle" size={16} color={colors.text} />
            <Text style={[styles.ghostBtnText, { color: colors.text }]}>Aléatoire</Text>
          </Pressable>
          <Pressable style={[styles.ghostBtn, { borderColor: colors.line, backgroundColor: colors.surface }]} onPress={cycleSort}>
            <Ionicons name="swap-vertical" size={16} color={colors.text} />
            <Text style={[styles.ghostBtnText, { color: colors.text }]}>{SORTS[sortIndex].label}</Text>
          </Pressable>
        </View>

        <View style={[styles.actionsRow2, { paddingLeft: 16 + (insets.left || 0), paddingRight: 16 + (insets.right || 0) }]}>
          <Pressable style={[styles.toolBtn, { backgroundColor: colors.surface, borderColor: colors.line }]} onPress={() => setEqOpen(true)}>
            <Ionicons name="options-outline" size={15} color={colors.text} />
            <Text style={[styles.toolBtnText, { color: colors.text }]}>Égaliseur</Text>
          </Pressable>
          <Pressable style={[styles.toolBtn, { backgroundColor: colors.surface, borderColor: colors.line }]} onPress={() => setSpeedOpen(true)}>
            <Ionicons name="speedometer-outline" size={15} color={colors.text} />
            <Text style={[styles.toolBtnText, { color: colors.text }]}>{playbackSpeed}x</Text>
          </Pressable>
          <Pressable style={[styles.toolBtn, { backgroundColor: colors.surface, borderColor: sleepTimerMin > 0 ? colors.accent : colors.line }]} onPress={() => setTimerOpen(true)}>
            <Ionicons name="moon-outline" size={15} color={sleepTimerMin > 0 ? colors.accent : colors.text} />
            <Text style={[styles.toolBtnText, { color: sleepTimerMin > 0 ? colors.accent : colors.text }]}>{sleepTimerMin > 0 ? formatTime(sleepRemaining) : 'Minuteur'}</Text>
          </Pressable>
          <Pressable style={[styles.toolBtn, { backgroundColor: colors.surface, borderColor: colors.line }]} onPress={() => setQueueOpen(true)}>
            <Ionicons name="list-outline" size={15} color={colors.text} />
            <Text style={[styles.toolBtnText, { color: colors.text }]}>File · {queueRef.current.length}</Text>
          </Pressable>
        </View>

        {filter === 'folders' && !activeFolder ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
            {folders.map(([name, count]) => (
              <Pressable key={name} onPress={() => setActiveFolder(name)} style={[styles.folderCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <Ionicons name="folder" size={28} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.folderName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
                  <Text style={[styles.folderCount, { color: colors.textDim }]}>{count} titre{count > 1 ? 's' : ''}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
              </Pressable>
            ))}
            {folders.length === 0 && <Text style={{ color: colors.textDim, textAlign: 'center', padding: 40 }}>Aucun dossier détecté</Text>}
          </ScrollView>
        ) : (
          <FlatList
            style={styles.list} data={visible} keyExtractor={keyExtractor} renderItem={renderItem} getItemLayout={getItemLayout}
            extraData={`${currentId}|${status.playing}|${themeId}|${favorites.size}|${hidden.size}|${filter}|${activeFolder}|${libState}`}
            initialNumToRender={14} maxToRenderPerBatch={12} windowSize={9} removeClippedSubviews keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: (current ? 100 : 24) + insets.bottom }}
            ListHeaderComponent={activeFolder ? (
              <Pressable onPress={() => setActiveFolder(null)} style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="arrow-back" size={18} color={colors.accent} />
                <Text style={{ color: colors.accent, fontWeight: '700' }}>Retour · {activeFolder}</Text>
              </Pressable>
            ) : null}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons
                  name={libState === 'denied' ? 'lock-closed' : libState === 'loading' ? 'hourglass-outline' : filter === 'fav' ? 'heart-outline' : filter === 'hidden' ? 'eye-off-outline' : filter === 'recent' ? 'time-outline' : 'planet'}
                  size={54}
                  color={colors.accent}
                />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  {query.trim() ? 'Aucun résultat'
                    : libState === 'denied' ? "Permission d'accès requise"
                    : libState === 'loading' ? 'Analyse de ta musique…'
                    : filter === 'fav' ? 'Aucun favori'
                    : filter === 'hidden' ? 'Aucun masqué'
                    : filter === 'recent' ? 'Aucun récent'
                    : 'Aucun titre'}
                </Text>
                <Text style={[styles.emptyText, { color: colors.textDim }]}>
                  {query.trim() ? 'Essaie un autre titre.'
                    : libState === 'denied' ? "Autorise l'accès à tes fichiers audio pour que l'app trouve automatiquement tes MP3."
                    : libState === 'loading' ? 'Recherche de tous tes MP3 sur le téléphone…'
                    : filter === 'fav' ? 'Appui long sur un titre → Favori'
                    : filter === 'hidden' ? 'Les titres masqués apparaissent ici.'
                    : filter === 'recent' ? 'Les titres écoutés apparaissent ici.'
                    : 'Appuie sur + pour ajouter des MP3.'}
                </Text>

                {libMessage && !IS_EXPO_GO && (
                  <Text style={styles.debugText}>{libMessage}</Text>
                )}

                {!query.trim() && filter === 'all' && libState !== 'loading' && (
                  <View style={styles.emptyActions}>
                    {libState === 'denied' && !IS_EXPO_GO && (
                      <>
                        <Pressable onPress={rescan} style={({ pressed }) => [styles.bigBtn, pressed && styles.pressed]}>
                          <LinearGradient colors={[colors.accent, colors.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 20, width: '100%', justifyContent: 'center' }}>
                            <Ionicons name="checkmark-circle" size={20} color={colors.onAccent} />
                            <Text style={[styles.bigBtnText, { color: colors.onAccent }]}>Autoriser l'accès</Text>
                          </LinearGradient>
                        </Pressable>
                        <Pressable onPress={openSettings} style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.line, backgroundColor: colors.surface, height: 44, paddingHorizontal: 16 }, pressed && styles.pressed]}>
                          <Ionicons name="settings-outline" size={18} color={colors.text} />
                          <Text style={[styles.ghostBtnText, { color: colors.text }]}>Ouvrir les paramètres</Text>
                        </Pressable>
                      </>
                    )}

                    <Pressable onPress={pickFiles} style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.line, backgroundColor: colors.surface, height: 44, paddingHorizontal: 16 }, pressed && styles.pressed]}>
                      <Ionicons name="add" size={18} color={colors.text} />
                      <Text style={[styles.ghostBtnText, { color: colors.text }]}>Ajouter manuellement</Text>
                    </Pressable>

                    {!IS_EXPO_GO && libState !== 'denied' && (
                      <Pressable onPress={rescan} style={[styles.ghostBtn, { borderColor: colors.line, backgroundColor: colors.surface, height: 44, paddingHorizontal: 16 }]}>
                        <Ionicons name="refresh" size={18} color={colors.text} />
                        <Text style={[styles.ghostBtnText, { color: colors.text }]}>Rescanner</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            }
          />
        )}

        {current && (
          <Pressable style={[styles.mini, { bottom: insets.bottom + 12, backgroundColor: colors.surfaceHigh, borderColor: colors.line, left: 12 + (insets.left || 0), right: 12 + (insets.right || 0) }]} onPress={() => setFullOpen(true)}>
            <LinearGradient colors={[colors.accent + '18', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
            <Artwork title={current.title} size={48} radius={12} playing={status.playing} colors={colors} />
            <View style={styles.miniText}>
              <Text numberOfLines={1} style={[styles.miniTitle, { color: colors.text }]}>{current.title}</Text>
              <Text numberOfLines={1} style={[styles.miniSub, { color: colors.textDim }]}>{current.artist}</Text>
            </View>
            {status.playing && <AnimatedEqualizer color={colors.accent} size={20} />}
            <IconButton name={favorites.has(current.id) ? 'heart' : 'heart-outline'} size={22} colors={colors} color={favorites.has(current.id) ? colors.accent : colors.text} onPress={() => toggleFavorite(current)} />
            <IconButton name={status.playing ? 'pause' : 'play'} size={26} colors={colors} onPress={togglePlay} />
            <IconButton name="play-skip-forward" colors={colors} onPress={() => step(1)} />
            <View style={[styles.miniProgressTrack, { backgroundColor: colors.line }]}>
              <LinearGradient colors={[colors.accent, colors.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.miniProgressFill, { width: `${progress * 100}%` }]} />
            </View>
          </Pressable>
        )}
      </View>

      <Toast message={toast} top={insets.top + 12} colors={colors} />

      <ContextMenu track={ctxTrack} visible={ctxOpen} onClose={() => setCtxOpen(false)} isFav={ctxTrack ? favorites.has(ctxTrack.id) : false} isHidden={ctxTrack ? hidden.has(ctxTrack.id) : false} colors={colors} onToggleFav={toggleFavorite} onToggleHidden={toggleHidden} onQueue={addToQueue} onPlayNext={playNext} onInfo={showInfo} onDelete={deleteTrack} onShare={shareTrack} onGotoFolder={gotoFolder} />

      <Sheet visible={themeOpen} onClose={() => setThemeOpen(false)} title="Choisir un thème" sub="Personnalise l'apparence de l'app" colors={colors}>
        <View style={styles.themeGrid}>
          {THEMES.map((t) => {
            const isActive = t.id === themeId;
            return (
              <Pressable key={t.id} style={[styles.themeCard, { backgroundColor: t.bg, borderColor: isActive ? t.accent : t.line, borderWidth: isActive ? 3 : 2 }]} onPress={() => { setThemeId(t.id); setThemeOpen(false); }}>
                <LinearGradient colors={[t.accent, t.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 26, height: 26, borderRadius: 13 }} />
                <Text style={[styles.themeCardText, { color: t.text }]}>{t.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      <Sheet visible={eqOpen} onClose={() => setEqOpen(false)} title="Égaliseur" sub="Presets audio optimisés" colors={colors}>
        <View style={styles.eqGrid}>
          {EQ_PRESETS.map((p) => {
            const isActive = p.id === eqPreset;
            return (
              <Pressable key={p.id} style={[styles.eqCard, { backgroundColor: isActive ? colors.accent : colors.surface, borderColor: isActive ? colors.accent : colors.line }]} onPress={() => { setEqPreset(p.id); showToast(`Égaliseur : ${p.name}`); setEqOpen(false); }}>
                <Ionicons name={p.icon} size={22} color={isActive ? colors.onAccent : colors.text} />
                <Text style={[styles.eqCardText, { color: isActive ? colors.onAccent : colors.text }]}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      <Sheet visible={speedOpen} onClose={() => setSpeedOpen(false)} title="Vitesse de lecture" sub="Ralenti ou accélère la musique" colors={colors}>
        <View style={styles.speedGrid}>
          {SPEEDS.map((s) => {
            const isActive = s === playbackSpeed;
            return (
              <Pressable key={s} style={[styles.speedChip, { backgroundColor: isActive ? colors.accent : colors.surface, borderColor: isActive ? colors.accent : colors.line }]} onPress={() => { setPlaybackSpeed(s); showToast(`Vitesse : ${s}x`); setSpeedOpen(false); }}>
                <Text style={[styles.speedChipText, { color: isActive ? colors.onAccent : colors.text }]}>{s}x</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      <Sheet visible={timerOpen} onClose={() => setTimerOpen(false)} title="Minuteur de sommeil" sub="Coupe la musique automatiquement" colors={colors}>
        {sleepTimerMin > 0 && (
          <Pressable style={[styles.sleepOption, { backgroundColor: colors.accent + '22', borderColor: colors.accent }]} onPress={() => { setSleepTimerMin(0); showToast('Minuteur annulé'); setTimerOpen(false); }}>
            <Ionicons name="close-circle" size={22} color={colors.accent} />
            <Text style={[styles.sleepOptionText, { color: colors.accent }]}>Annuler ({formatTime(sleepRemaining)})</Text>
          </Pressable>
        )}
        {SLEEP_OPTIONS.map((o) => (
          <Pressable key={o.min} style={[styles.sleepOption, { backgroundColor: colors.surface, borderColor: colors.line }]} onPress={() => { setSleepTimerMin(o.min); showToast(`Minuteur : ${o.label}`); setTimerOpen(false); }}>
            <Ionicons name="moon" size={20} color={colors.text} />
            <Text style={[styles.sleepOptionText, { color: colors.text }]}>{o.label}</Text>
          </Pressable>
        ))}
      </Sheet>

      <Sheet visible={queueOpen} onClose={() => setQueueOpen(false)} title={`File d'attente (${queueRef.current.length})`} sub="Ordre de lecture actuel" colors={colors}>
        {queueRef.current.length === 0 ? (
          <Text style={{ color: colors.textDim, textAlign: 'center', padding: 30 }}>File vide</Text>
        ) : (
          queueRef.current.map((id, index) => {
            const t = byId.get(id);
            if (!t) return null;
            const isCurrent = id === currentRef.current;
            return (
              <Pressable key={id} style={styles.queueRow} onPress={() => { startTrack(id); setQueueOpen(false); }}>
                <Text style={[styles.queueIndex, { color: isCurrent ? colors.accent : colors.textDim }]}>{index + 1}</Text>
                {isCurrent ? <AnimatedEqualizer color={colors.accent} size={16} /> : <Ionicons name="musical-note" size={16} color={colors.textDim} />}
                <View style={styles.queueInfo}>
                  <Text style={[styles.queueTitle, { color: isCurrent ? colors.accent : colors.text }]} numberOfLines={1}>{t.title}</Text>
                  <Text style={[styles.queueSub, { color: colors.textDim }]} numberOfLines={1}>{t.artist}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </Sheet>

      <Modal visible={fullOpen} animationType="slide" onRequestClose={() => setFullOpen(false)} presentationStyle="fullScreen">
        <SafeAreaView style={[styles.full, { backgroundColor: colors.bg }]} edges={['top', 'bottom', 'left', 'right']}>
          <LinearGradient colors={[colors.accent + '20', 'transparent', colors.accent2 + '15']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
          <View style={styles.fullHeader}>
            <IconButton name="chevron-down" size={26} colors={colors} onPress={() => setFullOpen(false)} />
            <Text style={[styles.fullHeaderTitle, { color: colors.textDim }]}>En lecture</Text>
            <IconButton name={current && favorites.has(current.id) ? 'heart' : 'heart-outline'} size={22} colors={colors} color={current && favorites.has(current.id) ? colors.accent : colors.text} onPress={() => current && toggleFavorite(current)} />
          </View>
          <View style={styles.fullArt}>
            <LinearGradient colors={[colors.accent + '55', colors.accent2 + '33', 'transparent']} start={{ x: 0.5, y: 0.5 }} end={{ x: 0.5, y: 1 }} style={styles.fullArtGlow} pointerEvents="none" />
            <Artwork title={current ? current.title : ''} size={artSize} radius={24} playing={status.playing} colors={colors} />
          </View>
          <View style={styles.fullInfo}>
            <Text numberOfLines={1} style={[styles.fullTitle, { color: colors.text }]}>{current ? current.title : ''}</Text>
            <Text numberOfLines={1} style={[styles.fullArtist, { color: colors.textDim }]}>{current ? current.artist : ''}{current && current.ext ? ` · ${current.ext.toUpperCase()}` : ''}</Text>
          </View>
          <Slider style={styles.seek} minimumValue={0} maximumValue={Math.max(duration, 1)} value={seeking ? seekValue : position} disabled={!current || !duration} minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.line} thumbTintColor={colors.accent} onSlidingStart={(v) => { setSeekValue(v); setSeeking(true); }} onValueChange={(v) => { if (seeking) setSeekValue(v); }} onSlidingComplete={async (v) => { try { await player.seekTo(v); } finally { setSeeking(false); } }} />
          <View style={styles.timeRow}>
            <Text style={[styles.time, { color: colors.textDim }]}>{formatTime(seeking ? seekValue : position)}</Text>
            <Text style={[styles.time, { color: colors.textDim }]}>{formatTime(duration)}</Text>
          </View>
          <View style={styles.controls}>
            <IconButton name="shuffle" color={shuffle ? colors.accent : colors.textDim} colors={colors} onPress={toggleShuffle} />
            <IconButton name="play-skip-back" size={28} colors={colors} onPress={previous} />
            <Pressable onPress={togglePlay} style={({ pressed }) => [styles.playBtn, { shadowColor: colors.accent }, pressed && styles.pressed]}>
              <LinearGradient colors={[colors.accent, colors.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={status.playing ? 'pause' : 'play'} size={32} color={colors.onAccent} />
              </LinearGradient>
            </Pressable>
            <IconButton name="play-skip-forward" size={28} colors={colors} onPress={() => step(1)} />
            <Pressable style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]} onPress={cycleRepeat}>
              <Ionicons name="repeat" size={22} color={repeat === 'off' ? colors.textDim : colors.accent} />
              {repeat === 'one' && <Text style={[styles.repeatBadge, { color: colors.accent }]}>1</Text>}
            </Pressable>
          </View>
          <View style={styles.extraBar}>
            <Pressable style={styles.extraBtn} onPress={() => setEqOpen(true)}>
              <Ionicons name="options-outline" size={20} color={eqPreset !== 'flat' ? colors.accent : colors.text} />
              <Text style={[styles.extraBtnText, { color: eqPreset !== 'flat' ? colors.accent : colors.text }]}>Égaliseur</Text>
              <Text style={[styles.extraBtnLabel, { color: colors.textDim }]}>{EQ_PRESETS.find((e) => e.id === eqPreset)?.name || 'Plat'}</Text>
            </Pressable>
            <Pressable style={styles.extraBtn} onPress={() => setSpeedOpen(true)}>
              <Ionicons name="speedometer-outline" size={20} color={playbackSpeed !== 1 ? colors.accent : colors.text} />
              <Text style={[styles.extraBtnText, { color: playbackSpeed !== 1 ? colors.accent : colors.text }]}>Vitesse</Text>
              <Text style={[styles.extraBtnLabel, { color: colors.textDim }]}>{playbackSpeed}x</Text>
            </Pressable>
            <Pressable style={styles.extraBtn} onPress={() => setTimerOpen(true)}>
              <Ionicons name="moon-outline" size={20} color={sleepTimerMin > 0 ? colors.accent : colors.text} />
              <Text style={[styles.extraBtnText, { color: sleepTimerMin > 0 ? colors.accent : colors.text }]}>Minuteur</Text>
              <Text style={[styles.extraBtnLabel, { color: colors.textDim }]}>{sleepTimerMin > 0 ? formatTime(sleepRemaining) : 'Désactivé'}</Text>
            </Pressable>
            <Pressable style={styles.extraBtn} onPress={() => setQueueOpen(true)}>
              <Ionicons name="list-outline" size={20} color={colors.text} />
              <Text style={[styles.extraBtnText, { color: colors.text }]}>File</Text>
              <Text style={[styles.extraBtnLabel, { color: colors.textDim }]}>{queueRef.current.length}</Text>
            </Pressable>
          </View>
          <View style={styles.volumeRow}>
            <IconButton name={volumeIcon} filled active={showVolume} color={muted ? colors.accent : colors.text} colors={colors} onPress={() => setShowVolume((o) => !o)} onLongPress={() => { const next = !muted; setMuted(next); if (VolumeManager) { try { VolumeManager.setVolume(next ? 0 : volume || 1); } catch (e) {} } }} />
            {showVolume && (
              <>
                <Slider style={styles.volumeSlider} minimumValue={0} maximumValue={1} step={0.01} value={effectiveVolume} minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.line} thumbTintColor={colors.accent} onValueChange={handleVolumeChange} />
                <Text style={[styles.volumeText, { color: colors.textDim }]}>{Math.round(effectiveVolume * 100)}%</Text>
              </>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export default function MusicPlayer() {
  return (
    <SafeAreaProvider>
      <Player />
    </SafeAreaProvider>
  );
}