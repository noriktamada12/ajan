/**
 * Web stub untuk expo-notifications.
 * Modul ini native-only: mengimpor paket aslinya di web bikin seluruh bundle
 * gagal load (halaman putih). Metro otomatis memilih file ini di web.
 */
type Handler = { handleNotification: (...a: unknown[]) => Promise<unknown> };

const noopAsync = async () => undefined;

export default {
  setNotificationHandler: (_h: Handler) => undefined,
  getPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
  requestPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
  setNotificationChannelAsync: noopAsync,
  setNotificationCategoryAsync: noopAsync,
  cancelAllScheduledNotificationsAsync: noopAsync,
  scheduleNotificationAsync: async (_r: unknown) => 'web-stub',
  addNotificationResponseReceivedListener: (_l: (e: unknown) => void) => ({ remove: () => {} }),
  getLastNotificationResponseAsync: async () => null,
  AndroidImportance: { MAX: 7 },
  AndroidNotificationPriority: { MAX: 'max' },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidAudioUsage: { ALARM: 4 },
  AndroidAudioContentType: { SONIFICATION: 1 },
  SchedulableTriggerInputTypes: { DAILY: 'daily', TIME_INTERVAL: 'timeInterval', DATE: 'date' },
};