import AsyncStorage from '@react-native-async-storage/async-storage';

export const SHALAT_LIST = ['Subuh', 'Dzuhur', 'Ashar', 'Maghrib', 'Isya'] as const;
export type NamaShalat = (typeof SHALAT_LIST)[number];

const KEY = 'ajan.checklist.v1';

export function tanggalKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function hariKosong(): Record<NamaShalat, boolean> {
  return { Subuh: false, Dzuhur: false, Ashar: false, Maghrib: false, Isya: false };
}

type Store = Record<string, Partial<Record<NamaShalat, boolean>>>;

async function load(): Promise<Store> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v) {
      const p = JSON.parse(v);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as Store;
    }
  } catch {
    /* abaikan, anggap kosong */
  }
  return {};
}

/** Centang hari tertentu (tanggalKey YYYY-MM-DD). */
export async function getHari(tgl: string): Promise<Record<NamaShalat, boolean>> {
  const s = await load();
  return { ...hariKosong(), ...(s[tgl] ?? {}) };
}

/** Balik centang satu waktu, kembalikan peta hari terbaru. */
export async function toggleHari(tgl: string, nama: NamaShalat): Promise<Record<NamaShalat, boolean>> {
  const s = await load();
  const h: Partial<Record<NamaShalat, boolean>> = { ...(s[tgl] ?? {}) };
  if (h[nama]) delete h[nama];
  else h[nama] = true;
  s[tgl] = h;
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
  return { ...hariKosong(), ...h };
}

/** Tandai satu waktu sebagai sudah (dipakai tombol notifikasi). */
export async function tandaiSudah(tgl: string, nama: string): Promise<Record<NamaShalat, boolean>> {
  const s = await load();
  const h: Partial<Record<NamaShalat, boolean>> = { ...(s[tgl] ?? {}) };
  if ((SHALAT_LIST as readonly string[]).includes(nama)) {
    h[nama as NamaShalat] = true;
  }
  s[tgl] = h;
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
  return { ...hariKosong(), ...h };
}

export interface HariStat {
  tgl: string;
  label: string;
  count: number;
}

export interface StatBulan {
  hari: HariStat[];
  total: number;
  mungkin: number;
  persen: number;
  streak: number;
}

/** Statistik bulan berjalan (tanggal 1 sampai hari ini). */
export async function getBulanBerjalan(): Promise<StatBulan> {
  const s = await load();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const todayIdx = now.getDate();
  const hari: HariStat[] = [];
  let total = 0;
  for (let d = 1; d <= todayIdx; d++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const h = s[key] ?? {};
    const count = SHALAT_LIST.filter((n) => h[n]).length;
    total += count;
    hari.push({ tgl: key, label: String(d), count });
  }
  const mungkin = todayIdx * 5;
  const persen = mungkin > 0 ? Math.round((total / mungkin) * 100) : 0;
  // streak: hari penuh (5/5) beruntun, mundur dari kemarin kalau hari ini belum penuh
  let streak = 0;
  const todayCount = hari.length ? hari[hari.length - 1].count : 0;
  const skip = todayCount >= 5 ? 0 : 1;
  for (let i = hari.length - 1 - skip; i >= 0; i--) {
    if (hari[i].count >= 5) streak++;
    else break;
  }
  return { hari, total, mungkin, persen, streak };
}
