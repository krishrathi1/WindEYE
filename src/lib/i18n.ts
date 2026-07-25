// =============================================================================
// Internationalization
//
// A small string table plus a locale resolver. Competitors in this category get
// dinged for CJK text rendering as boxes; the font fallback that fixes that lives
// in index.css — this file covers the copy itself.
// =============================================================================

export type Locale = "en" | "es" | "fr" | "de" | "ja" | "zh" | "hi";

export const SUPPORTED_LOCALES: Array<{ code: Locale; label: string }> = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
  { code: "hi", label: "हिन्दी" },
];

type StringKey =
  | "timer"
  | "media"
  | "notifications"
  | "settings"
  | "focus"
  | "clipboard"
  | "shelf"
  | "prism"
  | "startTimer"
  | "pause"
  | "resume"
  | "stop"
  | "dismiss"
  | "noNotifications"
  | "allCaughtUp"
  | "volume"
  | "brightness"
  | "weather"
  | "battery"
  | "charging"
  | "pluggedIn"
  | "cameraInUse"
  | "micInUse"
  | "shelfEmpty"
  | "clipboardEmpty"
  | "liveActivities";

type Table = Record<StringKey, string>;

const en: Table = {
  timer: "Timer",
  media: "Media",
  notifications: "Notifs",
  settings: "Settings",
  focus: "Focus",
  clipboard: "Clips",
  shelf: "Shelf",
  prism: "Prism",
  startTimer: "Start Timer",
  pause: "Pause",
  resume: "Resume",
  stop: "Stop",
  dismiss: "Dismiss",
  noNotifications: "No notifications",
  allCaughtUp: "All caught up!",
  volume: "Volume",
  brightness: "Brightness",
  weather: "Weather",
  battery: "Battery",
  charging: "Charging",
  pluggedIn: "Plugged in",
  cameraInUse: "Camera in use",
  micInUse: "Microphone in use",
  shelfEmpty: "Shelf is empty",
  clipboardEmpty: "Clipboard is empty",
  liveActivities: "Live Activities",
};

// Only keys that differ meaningfully are translated; anything missing falls back
// to English rather than showing an empty string.
const TABLES: Record<Locale, Partial<Table>> = {
  en,
  es: {
    timer: "Temporizador", media: "Medios", notifications: "Avisos", settings: "Ajustes",
    focus: "Enfoque", clipboard: "Portapapeles", shelf: "Estante", startTimer: "Iniciar",
    pause: "Pausar", resume: "Reanudar", stop: "Detener", dismiss: "Descartar",
    noNotifications: "Sin notificaciones", allCaughtUp: "¡Todo al día!",
    volume: "Volumen", brightness: "Brillo", weather: "Clima", battery: "Batería",
    charging: "Cargando", pluggedIn: "Conectado", cameraInUse: "Cámara en uso",
    micInUse: "Micrófono en uso", shelfEmpty: "Estante vacío",
    clipboardEmpty: "Portapapeles vacío", liveActivities: "Actividades",
  },
  fr: {
    timer: "Minuteur", media: "Médias", notifications: "Notifs", settings: "Réglages",
    focus: "Focus", clipboard: "Presse-papiers", shelf: "Étagère", startTimer: "Démarrer",
    pause: "Pause", resume: "Reprendre", stop: "Arrêter", dismiss: "Ignorer",
    noNotifications: "Aucune notification", allCaughtUp: "Tout est à jour !",
    volume: "Volume", brightness: "Luminosité", weather: "Météo", battery: "Batterie",
    charging: "En charge", pluggedIn: "Branché", cameraInUse: "Caméra active",
    micInUse: "Micro actif", shelfEmpty: "Étagère vide",
    clipboardEmpty: "Presse-papiers vide", liveActivities: "Activités",
  },
  de: {
    timer: "Timer", media: "Medien", notifications: "Hinweise", settings: "Einstellungen",
    focus: "Fokus", clipboard: "Zwischenablage", shelf: "Ablage", startTimer: "Starten",
    pause: "Pause", resume: "Fortsetzen", stop: "Stopp", dismiss: "Schließen",
    noNotifications: "Keine Mitteilungen", allCaughtUp: "Alles erledigt!",
    volume: "Lautstärke", brightness: "Helligkeit", weather: "Wetter", battery: "Akku",
    charging: "Lädt", pluggedIn: "Angeschlossen", cameraInUse: "Kamera aktiv",
    micInUse: "Mikrofon aktiv", shelfEmpty: "Ablage leer",
    clipboardEmpty: "Zwischenablage leer", liveActivities: "Aktivitäten",
  },
  ja: {
    timer: "タイマー", media: "メディア", notifications: "通知", settings: "設定",
    focus: "集中", clipboard: "クリップ", shelf: "シェルフ", startTimer: "開始",
    pause: "一時停止", resume: "再開", stop: "停止", dismiss: "閉じる",
    noNotifications: "通知はありません", allCaughtUp: "すべて確認済み",
    volume: "音量", brightness: "明るさ", weather: "天気", battery: "バッテリー",
    charging: "充電中", pluggedIn: "電源接続", cameraInUse: "カメラ使用中",
    micInUse: "マイク使用中", shelfEmpty: "シェルフは空です",
    clipboardEmpty: "クリップボードは空です", liveActivities: "アクティビティ",
  },
  zh: {
    timer: "计时器", media: "媒体", notifications: "通知", settings: "设置",
    focus: "专注", clipboard: "剪贴板", shelf: "文件架", startTimer: "开始",
    pause: "暂停", resume: "继续", stop: "停止", dismiss: "关闭",
    noNotifications: "暂无通知", allCaughtUp: "全部已读",
    volume: "音量", brightness: "亮度", weather: "天气", battery: "电池",
    charging: "充电中", pluggedIn: "已接通电源", cameraInUse: "摄像头使用中",
    micInUse: "麦克风使用中", shelfEmpty: "文件架为空",
    clipboardEmpty: "剪贴板为空", liveActivities: "实时活动",
  },
  hi: {
    timer: "टाइमर", media: "मीडिया", notifications: "सूचनाएं", settings: "सेटिंग्स",
    focus: "फ़ोकस", clipboard: "क्लिपबोर्ड", shelf: "शेल्फ़", startTimer: "शुरू करें",
    pause: "रोकें", resume: "जारी रखें", stop: "बंद करें", dismiss: "खारिज करें",
    noNotifications: "कोई सूचना नहीं", allCaughtUp: "सब कुछ देख लिया!",
    volume: "आवाज़", brightness: "चमक", weather: "मौसम", battery: "बैटरी",
    charging: "चार्ज हो रहा है", pluggedIn: "प्लग इन", cameraInUse: "कैमरा चालू",
    micInUse: "माइक चालू", shelfEmpty: "शेल्फ़ ख़ाली है",
    clipboardEmpty: "क्लिपबोर्ड ख़ाली है", liveActivities: "लाइव गतिविधियाँ",
  },
};

const STORAGE_KEY = "windeye_locale";

/// Resolve the active locale: explicit user choice, else the OS/browser language,
/// else English.
export function resolveLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && stored in TABLES) return stored;
  } catch {
    // localStorage unavailable — fall through to language detection.
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  const base = nav.split("-")[0].toLowerCase() as Locale;
  return base in TABLES ? base : "en";
}

export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Non-fatal: the choice simply won't persist.
  }
}

export function createTranslator(locale: Locale) {
  const table = TABLES[locale] ?? {};
  return (key: StringKey): string => table[key] ?? en[key];
}
