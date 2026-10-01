import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from 'expo-audio';
import Notifications from './src/notif';
import * as SplashScreen from './src/splashscreen';
import {
  SHALAT_LIST,
  getBulanBerjalan,
  getHari,
  hariKosong,
  tandaiSudah,
  toggleHari,
  tanggalKey,
} from './src/checklist';
import type { NamaShalat, StatBulan } from './src/checklist';

// Tahan splash native sampai React siap, biar tidak ada kedipan.
SplashScreen.preventAutoHideAsync().catch(() => {});

const RED = '#B31217';
const RED_LIGHT = '#C1272D';
const DARK = '#2B0A0A';
const BG = '#FFFFFF';
const INK = '#111111';
const MUT = '#8A8A8A';
const CREAM = '#FFF5F3';
const PINK_BG = '#FFF1F1';

type Layar = 'splash' | 'jadwal' | 'semua' | 'detail' | 'tentang' | 'profil' | 'checklist' | 'grafik';

const JADWAL_DEFAULT = [
  { nama: 'Subuh', jam: '04:08', ikon: 'weather-night', sound: 'suara_subuh' },
  { nama: 'Dzuhur', jam: '11:29', ikon: 'weather-sunny', sound: 'suara_dzuhur' },
  { nama: 'Ashar', jam: '14:39', ikon: 'weather-partly-cloudy', sound: 'suara_ashar' },
  { nama: 'Maghrib', jam: '17:33', ikon: 'weather-sunset', sound: 'suara_maghrib' },
  { nama: 'Isya', jam: '18:43', ikon: 'moon-waning-crescent', sound: 'suara_isya' },
] as const;

const SEMUA_INGAT = ['Subuh', 'Dzuhur', 'Ashar', 'Maghrib', 'Isya'] as const;

const AUDIO: Record<string, number> = {
  Subuh: require('./assets/suara-subuh.mp3'),
  Dzuhur: require('./assets/suara-dzuhur.mp3'),
  Ashar: require('./assets/suara-ashar.mp3'),
  Maghrib: require('./assets/suara-maghrib.mp3'),
  Isya: require('./assets/suara-isya.mp3'),
};

function jamKeMenit(jam: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(jam.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Satu channel notifikasi per waktu shalat (suara dikunci di level channel). */
const CHANNEL = (nama: string) => 'azan-' + nama.toLowerCase();

/** Kategori notifikasi susulan "Sudah shalat?" dengan tombol Sudah/Belum. */
const KAT_TANYA = 'tanyashalat';

/** Jeda antara adzan dan notifikasi susulan tanya-jawab (menit). */
const TANYA_SETELAH_MENIT = 30;

export default function App() {
  const [layar, setLayar] = useState<Layar>('splash');
  const [filter, setFilter] = useState('Semua');
  const [ingat, setIngat] = useState<Record<string, boolean>>({
    Subuh: true, Dzuhur: true, Ashar: true, Maghrib: true, Isya: true,
  });
  const [suaraCewe, setSuaraCewe] = useState(true);
  const [jamCustom, setJamCustom] = useState<Record<string, string>>({});
  const [lagiPutar, setLagiPutar] = useState<string | null>(null);
  const [izinNotif, setIzinNotif] = useState(false);
  const [sedangJadwal, setSedangJadwal] = useState(false);
  const [centang, setCentang] = useState<Record<NamaShalat, boolean>>(() => hariKosong());
  const [statBulan, setStatBulan] = useState<StatBulan | null>(null);

  /* ---- muat centang hari ini + statistik bulan ---- */
  const segarkanChecklist = async () => {
    const h = await getHari(tanggalKey());
    setCentang(h);
    setStatBulan(await getBulanBerjalan());
  };
  useEffect(() => {
    segarkanChecklist();
  }, []);

  const sentuhHari = async (nama: NamaShalat) => {
    const h = await toggleHari(tanggalKey(), nama);
    setCentang(h);
    setStatBulan(await getBulanBerjalan());
  };

  const player = useAudioPlayer(AUDIO.Subuh);

  const jamOf = (nama: string, fallback: string) => jamCustom[nama] ?? fallback;

  const putarAudio = (nama: string = 'Subuh') => {
    try {
      setLagiPutar(nama);
      player.replace(AUDIO[nama] ?? AUDIO.Subuh);
      player.play();
      setTimeout(() => setLagiPutar(null), 11000);
    } catch {
      setLagiPutar(null);
    }
  };

  /* ---- notifikasi: izin + channel ---- */
  useEffect(() => {
    (async () => {
      try {
        await Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });
        const { status } = await Notifications.getPermissionsAsync();
        let granted = status === 'granted';
        if (!granted) {
          const r = await Notifications.requestPermissionsAsync();
          granted = r.status === 'granted';
        }
        setIzinNotif(granted);
        // Android mengunci suara di level CHANNEL. Jadi tiap waktu shalat butuh
        // channel sendiri dengan file adzannya sendiri — channel 'azan' tunggal
        // yang suaranya ditimpa belakangan tetap bisu.
        for (const item of JADWAL_DEFAULT) {
          try {
            await Notifications.setNotificationChannelAsync(CHANNEL(item.nama), {
              name: 'Pengingat ' + item.nama,
              importance: Notifications.AndroidImportance.MAX,
              sound: item.sound + '.mp3',
              audioAttributes: {
                usage: Notifications.AndroidAudioUsage.ALARM,
                contentType: Notifications.AndroidAudioContentType.SONIFICATION,
              },
              vibrationPattern: [0, 500, 250, 500],
              enableVibrate: true,
              lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            });
          } catch {
            /* satu channel gagal jangan sampai memblokir sisanya */
          }
        }
        // Kategori tanya-jawab: tombol Sudah/Belum di notifikasi susulan.
        try {
          await Notifications.setNotificationCategoryAsync(KAT_TANYA, [
            {
              identifier: 'SUDAH',
              buttonTitle: 'Sudah',
              options: { isDestructive: false, opensAppToForeground: true },
            },
            {
              identifier: 'BELUM',
              buttonTitle: 'Belum',
              options: { isDestructive: false, opensAppToForeground: true },
            },
          ]);
        } catch {
          /* kategori gagal tidak memblokir alarm utama */
        }
      } catch {
        setIzinNotif(false);
      }
    })();
  }, []);

  /* ---- jawaban notifikasi tanya-jawab: Sudah -> centang, Belum -> tunda 15 menit ---- */
  const sesiSudah = useRef(false);
  useEffect(() => {
    const prosesTanya = async (resp: { actionIdentifier: string; data?: Record<string, unknown> }) => {
      const nama = String(resp.data?.nama ?? '');
      if (!nama || !SHALAT_LIST.includes(nama as NamaShalat)) return;
      if (resp.actionIdentifier === 'SUDAH') {
        const h = await tandaiSudah(tanggalKey(), nama);
        setCentang(h);
        setStatBulan(await getBulanBerjalan());
      } else if (resp.actionIdentifier === 'BELUM') {
        try {
          await Notifications.scheduleNotificationAsync({
            identifier: 'tanya-' + nama,
            content: {
              title: 'Waktunya ' + nama,
              body: 'Sudah masuk waktu ' + nama + '. Yuk shalat.',
              categoryIdentifier: KAT_TANYA,
              data: { nama },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 15 * 60,
              channelId: CHANNEL(nama),
            },
          });
        } catch { /* di web ini stub */ }
      }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(async (resp) => {
      await prosesTanya(resp);
    });
    // Jika app ditutup lalu user tap aksi, notifikasi hanya dibaca saat app dibuka.
    (async () => {
      if (sesiSudah.current) return;
      sesiSudah.current = true;
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last) await prosesTanya(last);
      } catch { /* abaikan */ }
    })();
    return () => sub.remove();
  }, []);

  /* ---- state tersimpan ---- */
  useEffect(() => {
    AsyncStorage.getItem('ajan.ingat.v1').then((v) => { if (v) setIngat(JSON.parse(v)); });
    AsyncStorage.getItem('ajan.suara.v1').then((v) => { if (v !== null) setSuaraCewe(v === 'cewe'); });
    AsyncStorage.getItem('ajan.jam.v1').then((v) => { if (v) setJamCustom(JSON.parse(v)); });
  }, []);

  /* ---- splash native dilepas begitu React siap ---- */
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  /* ---- jadwalkan ulang tiap kali jam / toggle berubah ---- */
  // Jam ditunda sebentar: tiap ketikan di input tidak perlu menjadwalkan ulang,
  // dan dua proses yang jalan bareng bisa bikin alarm dobel / salah jam.
  const [jamSiap, setJamSiap] = useState(false);
  const lagiJalan = useRef(false);

  useEffect(() => {
    setJamSiap(false);
    const t = setTimeout(() => setJamSiap(true), 600);
    return () => clearTimeout(t);
  }, [jamCustom]);

  useEffect(() => {
    if (!jamSiap) return;
    let batal = false;
    (async () => {
      if (lagiJalan.current) return;
      lagiJalan.current = true;
      try {
        setSedangJadwal(true);
        await Notifications.cancelAllScheduledNotificationsAsync();
        for (const item of JADWAL_DEFAULT) {
          if (!ingat[item.nama]) continue;
          const jam = jamOf(item.nama, item.jam);
          const menit = jamKeMenit(jam);
          if (menit === null) continue;
          if (batal) return;
          await Notifications.scheduleNotificationAsync({
            identifier: 'azan-' + item.nama,
            content: {
              title: 'Waktunya ' + item.nama,
              body: 'Sudah masuk waktu shalat ' + item.nama + ' (' + jam + '). Yuk tunaikan.',
              sound: item.sound + '.mp3',
              vibrate: [0, 500, 250, 500],
              priority: Notifications.AndroidNotificationPriority.MAX,
              data: { nama: item.nama },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
              hour: Math.floor(menit / 60),
              minute: menit % 60,
              channelId: CHANNEL(item.nama),
            },
          });
          // Tanya susulan 30 menit setelah adzan, dengan tombol Sudah/Belum.
          const menitTanya = (menit + TANYA_SETELAH_MENIT) % 1440;
          await Notifications.scheduleNotificationAsync({
            identifier: 'tanya-harian-' + item.nama,
            content: {
              title: 'Sudah shalat ' + item.nama + '?',
              body: 'Centang kalau sudah, biar Ajan hitung ibadahnya.',
              categoryIdentifier: KAT_TANYA,
              data: { nama: item.nama },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
              hour: Math.floor(menitTanya / 60),
              minute: menitTanya % 60,
              channelId: CHANNEL(item.nama),
            },
          });
        }
      } catch {
        /* diamkan: di web ini stub */
      } finally {
        lagiJalan.current = false;
        if (!batal) setSedangJadwal(false);
      }
    })();
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingat, jamSiap, izinNotif]);

  const toggleIngat = (nama: string) => {
    const next = { ...ingat, [nama]: !ingat[nama] };
    setIngat(next);
    AsyncStorage.setItem('ajan.ingat.v1', JSON.stringify(next));
  };

  const gantiSuara = (cewe: boolean) => {
    setSuaraCewe(cewe);
    AsyncStorage.setItem('ajan.suara.v1', cewe ? 'cewe' : 'cowo');
  };

  const ubahJam = (nama: string, jam: string) => {
    const bersih = jam.replace(/[^0-9:]/g, '').slice(0, 5);
    const next = { ...jamCustom, [nama]: bersih };
    setJamCustom(next);
    AsyncStorage.setItem('ajan.jam.v1', JSON.stringify(next));
  };

  return (
    <View style={s.root}>
      <StatusBar style={layar === 'splash' ? 'light' : 'dark'} />
      {layar === 'splash' && <Splash onMulai={() => setLayar('jadwal')} />}
      {layar === 'jadwal' && (
        <Jadwal
          filter={filter}
          setFilter={setFilter}
          ingat={ingat}
          jamOf={jamOf}
          onBukaDetail={() => setLayar('detail')}
          nav={setLayar}
        />
      )}
      {layar === 'detail' && (
        <Detail
          ingat={ingat}
          toggleIngat={toggleIngat}
          suaraCewe={suaraCewe}
          gantiSuara={gantiSuara}
          ubahJam={ubahJam}
          jamOf={jamOf}
          lagiPutar={lagiPutar}
          putarAudio={putarAudio}
          izinNotif={izinNotif}
          sedangJadwal={sedangJadwal}
          onKembali={() => setLayar('jadwal')}
        />
      )}
      {layar === 'semua' && (
        <Semua
          ingat={ingat}
          jamOf={jamOf}
          onBukaDetail={(nama) => setLayar('detail')}
          onKembali={() => setLayar('jadwal')}
          nav={setLayar}
        />
      )}
      {layar === 'checklist' && (
        <Checklist
          centang={centang}
          onSentuh={sentuhHari}
          segarkan={segarkanChecklist}
          nav={setLayar}
        />
      )}
      {layar === 'grafik' && (
        <Grafik stat={statBulan} nav={setLayar} />
      )}
      {layar === 'tentang' && <Tentang onKembali={() => setLayar('jadwal')} nav={setLayar} />}
      {layar === 'profil' && (
        <Profil
          suaraCewe={suaraCewe}
          gantiSuara={gantiSuara}
          izinNotif={izinNotif}
          onKembali={() => setLayar('jadwal')}
          nav={setLayar}
        />
      )}
    </View>
  );
}

/* ---------- LAYAR 1: SPLASH (animasi) ---------- */
function Splash({ onMulai }: { onMulai: () => void }) {
  const [logo] = useState(() => new Animated.Value(0));
  const [teks] = useState(() => new Animated.Value(0));
  const [tombol] = useState(() => new Animated.Value(0));
  const [denyut] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const anim = Animated.parallel([
      Animated.spring(logo, { toValue: 1, friction: 6, tension: 48, useNativeDriver: true }),
      Animated.timing(teks, { toValue: 1, delay: 260, duration: 340, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true }),
      Animated.timing(tombol, { toValue: 1, delay: 440, duration: 300, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true }),
    ]);
    anim.start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(denyut, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(denyut, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    denyut.setValue(0);
    loop.start();
    // Pengaman: apa pun yang terjadi, semua elemen wajib terlihat.
    const jaring = setTimeout(() => {
      [logo, teks, tombol].forEach((v) => {
        // @ts-expect-error nilai internal hanya ada saat runtime
        if (v.__getValue?.() < 1) v.setValue(1);
      });
    }, 1400);
    return () => {
      anim.stop();
      loop.stop();
      clearTimeout(jaring);
    };
  }, [logo, teks, tombol, denyut]);

  const gayaLogo = {
    opacity: logo,
    transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
  };
  const gayaDenyut = {
    transform: [{ scale: denyut.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
  };
  const gayaTeks = {
    opacity: teks,
    transform: [{ translateY: teks.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  };
  const gayaTombol = {
    opacity: tombol,
    transform: [{ translateY: tombol.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };

  return (
    <View style={s.splash}>
      <Animated.View style={[s.logoRow, gayaLogo]}>
        <MaterialCommunityIcons name="mosque" size={30} color="#fff" />
        <View>
          <Text style={s.logoNama}>Ajan</Text>
          <Text style={s.logoSub}>PENGINGAT SHALAT</Text>
        </View>
      </Animated.View>
      <Animated.View style={[s.jantungWrap, gayaLogo]}>
        <Animated.View style={gayaDenyut}>
          <MaterialCommunityIcons name="moon-waning-crescent" size={150} color="#D91E1E" />
        </Animated.View>
        <View style={s.ecgRow}>
          <View style={s.ecgGaris} />
          <MaterialCommunityIcons name="bell-ring" size={34} color="#fff" />
          <View style={s.ecgGaris} />
        </View>
      </Animated.View>
      <View style={s.splashBawah}>
        <Animated.View style={gayaTeks}>
          <Text style={s.splashJudul}>
            Jangan Lewatkan{'\n'}Waktu <Text style={s.splashCare}>Shalatmu</Text>
          </Text>
          <Text style={s.splashSub}>
            Pengingat otomatis tiap masuk waktu shalat.{'\n'}Dengan suara yang lembut dan menenangkan.
          </Text>
        </Animated.View>
        <Animated.View style={[s.splashTombolRow, gayaTombol]}>
          <Pressable style={s.tombolMulai} onPress={onMulai} testID="btn-mulai">
            <Text style={s.tombolMulaiTeks}>Get Started</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color="#fff" />
          </Pressable>
          <Pressable style={s.lingkaranHati} onPress={onMulai} testID="btn-mulai-bulat">
            <MaterialCommunityIcons name="mosque" size={30} color={RED} />
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

/* ---------- LAYAR 2: JADWAL ---------- */
function Jadwal({
  filter,
  setFilter,
  ingat,
  jamOf,
  onBukaDetail,
  nav,
}: {
  filter: string;
  setFilter: (v: string) => void;
  ingat: Record<string, boolean>;
  jamOf: (n: string, f: string) => string;
  onBukaDetail: (nama?: string) => void;
  nav: (l: Layar) => void;
}) {
  const filters = ['Semua', 'Aktif', 'Nonaktif'];
  const tampil = JADWAL_DEFAULT.filter((j) =>
    filter === 'Semua' ? true : filter === 'Aktif' ? ingat[j.nama] : !ingat[j.nama]
  );
  const utama = JADWAL_DEFAULT[0];
  return (
    <View style={s.page}>
      <View style={s.bookHeader}>
        <Pressable style={s.avatarFoto} onPress={() => nav('profil')} testID="btn-profil-atas">
          <MaterialCommunityIcons name="mosque" size={26} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.salamKecil}>Assalamualaikum,</Text>
          <Text style={s.salamNama}>Salatiga</Text>
        </View>
        <Pressable style={s.bellWrap} onPress={() => onBukaDetail()} testID="btn-bell">
          <MaterialCommunityIcons name="bell-outline" size={22} color={INK} />
          <View style={s.bellDot} />
        </Pressable>
      </View>
      <Text style={s.bookJudul}>
        Jadwal{'\n'}<Text style={s.bookJudulMerah}>Shalat</Text>
      </Text>
      <View style={s.filterRow}>
        {filters.map((f) => (
          <Pressable
            key={f}
            testID={'filter-' + f}
            onPress={() => setFilter(f)}
            style={[s.chip, filter === f && s.chipAktif]}>
            <Text style={[s.chipTeks, filter === f && s.chipTeksAktif]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
        <Pressable testID="jadwal-utama" style={s.kartuMerah} onPress={() => onBukaDetail()}>
          <View style={s.kmAtas}>
            <View style={s.kmIkon}>
              <MaterialCommunityIcons name={utama.ikon} size={22} color={RED} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.kmJudul}>{utama.nama}{'\n'}Berikutnya</Text>
            </View>
            <View style={s.kmPill}>
              <Text style={s.kmPillTeks}>{jamOf(utama.nama, utama.jam)} WIB</Text>
            </View>
          </View>
          <View style={s.kmTengah}>
            <View style={s.avatarTumpuk}>
              {JADWAL_DEFAULT.slice(1, 5).map((j, i) => (
                <View key={j.nama} style={[s.miniAvatar, { marginLeft: i === 0 ? 0 : -10 }]}>
                  <MaterialCommunityIcons name={j.ikon} size={14} color="#fff" />
                </View>
              ))}
              <View style={s.miniPlus}>
                <Text style={s.miniPlusTeks}>+5</Text>
              </View>
            </View>
            <Text style={s.kmAvail}>5 waktu shalat hari ini</Text>
          </View>
          <View style={s.kmBawah}>
            <View>
              <Text style={s.kmDokter}>Pengingat suara aktif</Text>
              <Text style={s.kmSpesialis}>Otomatis bunyi tiap masuk waktu</Text>
            </View>
            <View style={s.kmPanah}>
              <MaterialCommunityIcons name="chevron-right" size={24} color={DARK} />
            </View>
          </View>
        </Pressable>
        {tampil.slice(1).map((j) => (
          <Pressable
            key={j.nama}
            testID={'kartu-' + j.nama}
            style={s.kartuPutih}
            onPress={() => onBukaDetail(j.nama)}>
            <View style={s.kpAtas}>
              <MaterialCommunityIcons name={j.ikon} size={24} color={RED} />
              <Text style={s.kpJudul}>{j.nama}</Text>
              <Text style={s.kpJam}>{jamOf(j.nama, j.jam)} WIB</Text>
            </View>
            <View style={s.kpBawah}>
              <Text style={s.kpTempat}>
                {ingat[j.nama] ? 'Pengingat aktif' : 'Pengingat mati'}
              </Text>
              <MaterialCommunityIcons
                name={ingat[j.nama] ? 'bell-ring' : 'bell-off-outline'}
                size={22}
                color={ingat[j.nama] ? RED : MUT}
              />
            </View>
          </Pressable>
        ))}
        <View style={{ height: 120 }} />
      </ScrollView>
      <Navbawah aktif="Home" nav={nav} />
    </View>
  );
}

/* ---------- LAYAR 3: DETAIL + PENGATURAN ---------- */
function Detail({
  ingat,
  toggleIngat,
  suaraCewe,
  gantiSuara,
  ubahJam,
  jamOf,
  lagiPutar,
  putarAudio,
  izinNotif,
  sedangJadwal,
  onKembali,
}: {
  ingat: Record<string, boolean>;
  toggleIngat: (n: string) => void;
  suaraCewe: boolean;
  gantiSuara: (c: boolean) => void;
  ubahJam: (n: string, j: string) => void;
  jamOf: (n: string, f: string) => string;
  lagiPutar: string | null;
  putarAudio: (n?: string) => void;
  izinNotif: boolean;
  sedangJadwal: boolean;
  onKembali: () => void;
}) {
  return (
    <View style={s.page}>
      <ScrollView style={s.detailScroll} showsVerticalScrollIndicator={false}>
        <View style={s.detailTopbar}>
          <Pressable testID="btn-kembali" onPress={onKembali} style={s.btnLingkaran}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={INK} />
          </Pressable>
          <View style={s.btnLingkaran}>
            <MaterialCommunityIcons name="cog-outline" size={22} color={INK} />
          </View>
        </View>
        <Text style={s.detailTgl}>Pengaturan Pengingat</Text>
        <Text style={s.detailJudul}>Pengingat{'\n'}Shalat</Text>
        <Text style={s.detailLabel}>Kota</Text>
        <Text style={s.detailId}>Salatiga</Text>
        <View style={s.fotoDokter}>
          <MaterialCommunityIcons name="mosque" size={54} color="#fff" />
        </View>
        <View style={s.kartuStatus}>
          <View style={s.statusAtas}>
            <Text style={s.statusJudul}>
              {izinNotif ? 'Notifikasi diizinkan' : 'Notifikasi belum diizinkan'}
            </Text>
            <View style={s.pillConfirmed}>
              <Text style={s.pillConfirmedTeks}>{izinNotif ? 'Aktif' : 'Cek HP'}</Text>
            </View>
          </View>
          <View style={s.timeline}>
            <View style={s.tlKiri}>
              <Text style={s.tlTgl}>Berikutnya</Text>
              <Text style={s.tlJam}>Subuh</Text>
              <View style={s.tlDot} />
            </View>
            <View style={s.tlGaris} />
            <View style={s.tlHati}>
              <MaterialCommunityIcons name="bell-ring" size={18} color="#fff" />
            </View>
            <View style={s.tlGaris} />
            <View style={s.tlKanan}>
              <Text style={s.tlTgl}>Pukul</Text>
              <Text style={s.tlJam}>{jamOf('Subuh', '04:08')}</Text>
              <View style={s.tlDot} />
            </View>
          </View>
        </View>
        <View style={s.kartuVisit}>
          <View style={s.visitHeader}>
            <Text style={s.visitJudul}>Suara Pengingat</Text>
            <View style={s.visitAksi}>
              <Pressable
                testID="btn-dengar"
                style={s.visitBtnKecil}
                onPress={() => putarAudio(suaraCewe ? 'Subuh' : 'Dzuhur')}>
                <MaterialCommunityIcons name="volume-high" size={16} color={RED} />
              </Pressable>
            </View>
          </View>
          <View style={s.visitRow}>
            <Pressable
              testID="suara-cewe"
              style={[s.visitInner, suaraCewe && s.visitInnerAktif]}
              onPress={() => gantiSuara(true)}>
              <Text style={s.visitTipe}>Suara{'\n'}Cewe</Text>
              <Text style={s.visitDur}>Pilihan</Text>
              <Text style={s.visitMenit}>Lembut</Text>
              <View style={s.visitPanah}>
                <MaterialCommunityIcons name={suaraCewe ? 'check' : 'arrow-right'} size={18} color={RED} />
              </View>
            </Pressable>
            <Pressable
              testID="suara-cowo"
              style={[s.visitInner, !suaraCewe && s.visitInnerAktif]}
              onPress={() => gantiSuara(false)}>
              <Text style={s.visitTipe}>Suara{'\n'}Cowo</Text>
              <Text style={s.visitDur}>Pilihan</Text>
              <Text style={s.visitMenit}>Tegas</Text>
              <View style={s.visitPanah}>
                <MaterialCommunityIcons name={!suaraCewe ? 'check' : 'arrow-right'} size={18} color={RED} />
              </View>
            </Pressable>
          </View>
        </View>
        <Text style={s.seksiJudul}>Atur Jam Sendiri</Text>
        <Text style={s.seksiSub}>
          {sedangJadwal ? 'Menyimpan jadwal...' : 'Perubahan langsung disimpan ke alarm HP.'}
        </Text>
        {SEMUA_INGAT.map((nama) => {
          const j = JADWAL_DEFAULT.find((x) => x.nama === nama)!;
          return (
            <View key={nama} style={s.expectBaris}>
              <Pressable testID={'dengar-' + nama} onPress={() => putarAudio(nama)} style={s.expectIkon}>
                <MaterialCommunityIcons name={j.ikon} size={24} color={RED} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={s.expectA}>{nama}</Text>
                <TextInput
                  testID={'jam-' + nama}
                  style={s.inputJam}
                  value={jamOf(nama, j.jam)}
                  onChangeText={(t) => ubahJam(nama, t)}
                  onEndEditing={() => putarAudio(nama)}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  placeholder={j.jam}
                />
              </View>
              <Pressable testID={'tes-' + nama} onPress={() => putarAudio(nama)} style={s.btnTesKecil}>
                <MaterialCommunityIcons
                  name={lagiPutar === nama ? 'volume-high' : 'play'}
                  size={18}
                  color={RED}
                />
              </Pressable>
              <Switch
                testID={'ingat-' + nama}
                value={!!ingat[nama]}
                onValueChange={() => toggleIngat(nama)}
                trackColor={{ false: '#E5E7EB', true: RED }}
              />
            </View>
          );
        })}
        <Pressable style={s.banner} onPress={() => putarAudio('Subuh')} testID="btn-tes">
          <View style={s.bannerIkon}>
            <MaterialCommunityIcons name="bell-ring-outline" size={24} color={RED} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.bannerTeks}>Dengerin dulu{'\n'}suara pengingatmu.</Text>
          </View>
          <View style={s.bannerBtn}>
            <Text style={s.bannerBtnTeks}>{lagiPutar ? 'Putar...' : 'Tes Suara'}</Text>
            <MaterialCommunityIcons name="play" size={16} color="#fff" />
          </View>
        </Pressable>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

/* ---------- LAYAR: SEMUA JADWAL ---------- */
function Semua({
  ingat,
  jamOf,
  onBukaDetail,
  onKembali,
  nav,
}: {
  ingat: Record<string, boolean>;
  jamOf: (n: string, f: string) => string;
  onBukaDetail: (nama: string) => void;
  onKembali: () => void;
  nav: (l: Layar) => void;
}) {
  return (
    <View style={s.page}>
      <ScrollView style={s.detailScroll} showsVerticalScrollIndicator={false}>
        <View style={s.detailTopbar}>
          <Pressable testID="sm-kembali" onPress={onKembali} style={s.btnLingkaran}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={INK} />
          </Pressable>
          <View style={s.btnLingkaran}>
            <MaterialCommunityIcons name="calendar-check-outline" size={22} color={INK} />
          </View>
        </View>
        <Text style={s.detailTgl}>Salatiga, hari ini</Text>
        <Text style={s.detailJudul}>Semua{'\n'}Jadwal</Text>
        <Text style={s.seksiJudul}>Lima Waktu Shalat</Text>
        <Text style={s.seksiSub}>Tekan salah satu buat buka pengaturannya.</Text>
        {JADWAL_DEFAULT.map((j) => (
          <Pressable
            key={j.nama}
            testID={'semua-' + j.nama}
            style={s.expectBaris}
            onPress={() => onBukaDetail(j.nama)}>
            <View style={s.expectIkon}>
              <MaterialCommunityIcons name={j.ikon} size={24} color={RED} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.expectA}>{j.nama}</Text>
              <Text style={s.expectB}>{ingat[j.nama] ? 'Pengingat aktif' : 'Pengingat mati'}</Text>
            </View>
            <Text style={s.smJam}>{jamOf(j.nama, j.jam)}</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={MUT} />
          </Pressable>
        ))}
        <View style={{ height: 140 }} />
      </ScrollView>
      <Navbawah aktif="Jadwal" nav={nav} />
    </View>
  );
}

/* ---------- LAYAR TENTANG ---------- */
function Tentang({ onKembali, nav }: { onKembali: () => void; nav: (l: Layar) => void }) {
  return (
    <View style={s.page}>
      <ScrollView style={s.detailScroll} showsVerticalScrollIndicator={false}>
        <View style={s.detailTopbar}>
          <Pressable testID="tb-kembali" onPress={onKembali} style={s.btnLingkaran}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={INK} />
          </Pressable>
        </View>
        <Text style={s.detailTgl}>Ajan v1.0.2</Text>
        <Text style={s.detailJudul}>Tentang{'\n'}Ajan</Text>
        <View style={s.fotoDokter}>
          <MaterialCommunityIcons name="mosque" size={54} color="#fff" />
        </View>
        <View style={s.kartuStatus}>
          <Text style={s.statusJudul}>Apa itu Ajan?</Text>
          <Text style={s.paragraf}>
            Ajan mengingatkanmu tiap masuk waktu shalat dengan suara adzan yang kamu pilih sendiri.
            Alarm berjalan di HP, jadi tetap bunyi walau aplikasi sedang ditutup.
          </Text>
        </View>
        <Text style={s.seksiJudul}>Cara Pakai</Text>
        {['Atur jam tiap waktu di layar Pengingat',
          'Nyalakan toggle waktu yang mau diingatkan',
          'Tekan tombol play buat dengar suaranya',
          'Alarm otomatis bunyi tiap hari'].map((t, i) => (
          <View key={t} style={s.expectBaris}>
            <View style={s.langkahNomor}>
              <Text style={s.langkahTeks}>{i + 1}</Text>
            </View>
            <Text style={[s.expectA, { flex: 1 }]}>{t}</Text>
          </View>
        ))}
        <View style={{ height: 140 }} />
      </ScrollView>
      <Navbawah aktif="Tentang" nav={nav} />
    </View>
  );
}

/* ---------- LAYAR PROFIL ---------- */
function Profil({
  suaraCewe,
  gantiSuara,
  izinNotif,
  onKembali,
  nav,
}: {
  suaraCewe: boolean;
  gantiSuara: (c: boolean) => void;
  izinNotif: boolean;
  onKembali: () => void;
  nav: (l: Layar) => void;
}) {
  return (
    <View style={s.page}>
      <ScrollView style={s.detailScroll} showsVerticalScrollIndicator={false}>
        <View style={s.detailTopbar}>
          <Pressable testID="pf-kembali" onPress={onKembali} style={s.btnLingkaran}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={INK} />
          </Pressable>
        </View>
        <Text style={s.detailTgl}>Profil</Text>
        <Text style={s.detailJudul}>Pengaturanmu</Text>
        <View style={s.profilKartu}>
          <View style={s.profilAvatar}>
            <MaterialCommunityIcons name="account" size={40} color="#fff" />
          </View>
          <View>
            <Text style={s.profilNama}>Mada</Text>
            <Text style={s.profilKota}>Salatiga, Indonesia</Text>
          </View>
        </View>
        <Text style={s.seksiJudul}>Preferensi Suara</Text>
        <View style={s.expectBaris}>
          <Pressable style={s.expectIkon} onPress={() => gantiSuara(true)}>
            <MaterialCommunityIcons name="account-voice" size={24} color={RED} />
          </Pressable>
          <Text style={[s.expectA, { flex: 1 }]}>Suara cewe (lembut)</Text>
          <Switch
            testID="pf-suara"
            value={suaraCewe}
            onValueChange={gantiSuara}
            trackColor={{ false: '#E5E7EB', true: RED }}
          />
        </View>
        <Text style={s.seksiJudul}>Status Izin</Text>
        <View style={s.expectBaris}>
          <View style={s.expectIkon}>
            <MaterialCommunityIcons
              name={izinNotif ? 'bell-check' : 'bell-off'}
              size={24}
              color={RED}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.expectA}>Notifikasi HP</Text>
            <Text style={s.expectB}>
              {izinNotif ? 'Sudah diizinkan' : 'Belum diizinkan, cek pengaturan HP'}
            </Text>
          </View>
        </View>
        <View style={{ height: 140 }} />
      </ScrollView>
      <Navbawah aktif="Profil" nav={nav} />
    </View>
  );
}

/* ---------- LAYAR: CHECKLIST HARIAN ---------- */
function Checklist({
  centang,
  onSentuh,
  segarkan,
  nav,
}: {
  centang: Record<NamaShalat, boolean>;
  onSentuh: (n: NamaShalat) => void;
  segarkan: () => void;
  nav: (l: Layar) => void;
}) {
  const sudah = SHALAT_LIST.filter((n) => centang[n]).length;
  const tanggalSekarang = new Date();
  const labelHari = tanggalSekarang.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return (
    <View style={s.page}>
      <View style={s.cwHeader}>
        <View>
          <Text style={s.cwLabel}>Hari ini</Text>
          <Text style={s.cwTanggal}>{labelHari}</Text>
        </View>
        <Pressable
          style={s.cwHitungWrap}
          onPress={segarkan}
          testID="cw-refresh">
          <MaterialCommunityIcons
            name={sudah >= 5 ? 'trophy' : 'check-circle'}
            size={26}
            color={sudah >= 5 ? '#D4A017' : RED}
          />
        </Pressable>
      </View>
      <View style={s.cwProgressRow}>
        <View style={s.cwProgressLabel}>
          <Text style={s.cwProgressTeks}>{sudah} dari 5</Text>
          <Text style={s.cwProgressSub}>
            {sudah >= 5 ? 'Semua berjaya. Barakallahu fiik' : 'Lanjutkan'}
          </Text>
        </View>
        <Pressable style={s.cwGrafikPill} onPress={() => nav('grafik')} testID="cw-buka-grafik">
          <Text style={s.cwGrafikPillTeks}>Grafik</Text>
          <MaterialCommunityIcons name="chart-bar" size={14} color={DARK} />
        </Pressable>
      </View>
      <ScrollView style={s.cwList} showsVerticalScrollIndicator={false}>
        {JADWAL_DEFAULT.map((j) => {
          const on = !!centang[j.nama as NamaShalat];
          return (
            <Pressable
              key={j.nama}
              testID={'centang-' + j.nama}
              style={[s.cwKartu, on && s.cwKartuOn]}
              onPress={() => onSentuh(j.nama as NamaShalat)}>
              <View style={[s.cwIkonWrap, on && s.cwIkonWrapOn]}>
                <MaterialCommunityIcons
                  name={on ? 'check' : j.ikon}
                  size={20}
                  color={on ? '#fff' : RED}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.cwNama, on && s.cwNamaOn]}>{j.nama}</Text>
                <Text style={s.cwJam}>{j.jam} WIB</Text>
              </View>
              <View style={[s.cwCentangBulir, on && s.cwCentangBulirOn]}>
                {on && <MaterialCommunityIcons name="check" size={14} color="#fff" />}
              </View>
            </Pressable>
          );
        })}
        <View style={{ height: 120 }} />
      </ScrollView>
      <Navbawah aktif="Centang" nav={nav} />
    </View>
  );
}

/* ---------- LAYAR: GRAFIK BULANAN ---------- */
function Grafik({ stat, nav }: { stat: StatBulan | null; nav: (l: Layar) => void }) {
  const bulanLabel = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const hari = stat?.hari ?? [];
  const max = 5;
  return (
    <View style={s.page}>
      <View style={s.grHeader}>
        <Text style={s.grJudul}>Pencapaian{'\n'}<Text style={s.grJudulMerah}>Bulanan</Text></Text>
        <Text style={s.grSub}>{bulanLabel}</Text>
      </View>
      {stat ? (
        <>
          <View style={s.grStatRow}>
            <View style={s.grStatKartu}>
              <Text style={s.grStatAngka}>{stat.total}</Text>
              <Text style={s.grStatLabel}>Shalat</Text>
            </View>
            <View style={s.grStatKartu}>
              <Text style={s.grStatAngka}>{stat.persen}%</Text>
              <Text style={s.grStatLabel}>Tingkat</Text>
            </View>
            <View style={s.grStatKartu}>
              <Text style={s.grStatAngka}>{stat.streak}</Text>
              <Text style={s.grStatLabel}>Hari beruntun</Text>
            </View>
          </View>
          <Text style={s.grGrafikLabel}>Per hari</Text>
          <View style={s.grBarsWrap}>
            {hari.map((h, i) => {
              const tinggi = Math.round((h.count / max) * 150);
              return (
                <View key={h.tgl} style={s.grBarKolom}>
                  <View style={s.grBarArea}>
                    <View
                      style={[
                        s.grBar,
                        { height: tinggi },
                        h.count >= 5 ? s.grBarPenuh : h.count >= 3 ? s.grBarSedang : null,
                      ]}
                    />
                  </View>
                  <Text style={[s.grBarLabel, i % 3 === 0 ? s.grBarLabelTampil : null]}>
                    {h.label}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={s.grRingkasan}>
            <MaterialCommunityIcons name="clipboard-check-outline" size={18} color={RED} />
            <Text style={s.grRingkasanTeks}>
              {stat.total} dari {stat.mungkin} shalat ({Math.round(
                (stat.total / Math.max(stat.mungkin, 1)) * 100
              )}%). Pantau terus grafiknya biar ibadah makin teratur.
            </Text>
          </View>
        </>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={s.grLoading}>Memuat grafik...</Text>
        </View>
      )}
      <View style={{ height: 100 }} />
      <Navbawah aktif="Grafik" nav={nav} />
    </View>
  );
}

function Navbawah({ aktif, nav }: { aktif: string; nav: (l: Layar) => void }) {
  const items: { nama: string; ikon: 'home' | 'calendar-check-outline' | 'checkbox-marked' | 'chart-bar' | 'account-outline'; tujuan: Layar }[] = [
    { nama: 'Home', ikon: 'home', tujuan: 'jadwal' },
    { nama: 'Jadwal', ikon: 'calendar-check-outline', tujuan: 'semua' },
    { nama: 'Centang', ikon: 'checkbox-marked', tujuan: 'checklist' },
    { nama: 'Grafik', ikon: 'chart-bar', tujuan: 'grafik' },
    { nama: 'Profil', ikon: 'account-outline', tujuan: 'profil' },
  ];
  return (
    <View style={s.navWrap}>
      <View style={s.nav}>
        {items.map((it, i) => {
          const on = aktif === it.nama;
          return (
            <Pressable
              key={it.nama}
              testID={'nav-' + i}
              style={s.navItem}
              onPress={() => nav(it.tujuan)}>
              {on ? (
                <View style={s.navAktifBg}>
                  <MaterialCommunityIcons name={it.ikon} size={22} color="#fff" />
                </View>
              ) : (
                <MaterialCommunityIcons name={it.ikon} size={22} color="#C9B0B0" />
              )}
              <Text style={[s.navTeks, on && s.navTeksAktif]}>{it.nama}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  page: { flex: 1, backgroundColor: BG },
  splash: { flex: 1, backgroundColor: '#1A0606' },
  logoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 60,
  },
  logoNama: { color: '#fff', fontSize: 20, fontWeight: '800' },
  logoSub: { color: 'rgba(255,255,255,0.7)', fontSize: 10, letterSpacing: 4 },
  jantungWrap: { alignItems: 'center', marginTop: 30 },
  ecgRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  ecgGaris: { width: 90, height: 2, backgroundColor: 'rgba(255,255,255,0.5)' },
  splashBawah: { paddingHorizontal: 26, marginTop: 40 },
  splashJudul: { color: '#fff', fontSize: 34, fontWeight: '800', lineHeight: 40 },
  splashCare: { color: '#E53232' },
  splashSub: { color: '#CFCFCF', fontSize: 13, lineHeight: 19, marginTop: 10 },
  splashTombolRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26,
  },
  tombolMulai: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#2B1212',
    borderRadius: 28, paddingVertical: 16, paddingHorizontal: 34, gap: 10,
  },
  tombolMulaiTeks: { color: '#fff', fontSize: 16, fontWeight: '700' },
  lingkaranHati: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  bookHeader: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 54,
    paddingHorizontal: 20, gap: 12,
  },
  avatarFoto: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: RED,
    alignItems: 'center', justifyContent: 'center',
  },
  salamKecil: { color: MUT, fontSize: 12 },
  salamNama: { color: INK, fontSize: 17, fontWeight: '700' },
  bellWrap: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F0E0DE',
  },
  bellDot: {
    position: 'absolute', top: 10, right: 11, width: 9, height: 9,
    borderRadius: 5, backgroundColor: RED,
  },
  bookJudul: { fontSize: 30, fontWeight: '800', color: INK, marginTop: 14, marginHorizontal: 20, lineHeight: 36 },
  bookJudulMerah: { color: RED },
  filterRow: { flexDirection: 'row', marginTop: 14, paddingHorizontal: 20, gap: 8 },
  chip: {
    backgroundColor: CREAM, borderRadius: 20, paddingVertical: 9,
    paddingHorizontal: 15, borderWidth: 1, borderColor: '#F0E0DE',
  },
  chipAktif: { backgroundColor: DARK, borderColor: DARK },
  chipTeks: { color: '#7A7A7A', fontSize: 12, fontWeight: '600' },
  chipTeksAktif: { color: '#fff' },
  list: { flex: 1, marginTop: 14, paddingHorizontal: 20 },
  kartuMerah: { backgroundColor: RED, borderRadius: 22, padding: 16, marginBottom: 14 },
  kmAtas: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kmIkon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  kmJudul: { color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 19 },
  kmPill: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 10 },
  kmPillTeks: { color: '#fff', fontSize: 10, fontWeight: '700' },
  kmTengah: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 10 },
  avatarTumpuk: { flexDirection: 'row', alignItems: 'center' },
  miniAvatar: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: RED,
  },
  miniPlus: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: DARK,
    alignItems: 'center', justifyContent: 'center', marginLeft: -10,
  },
  miniPlusTeks: { color: '#fff', fontSize: 10, fontWeight: '700' },
  kmAvail: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  kmBawah: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12,
  },
  kmDokter: { color: '#fff', fontSize: 15, fontWeight: '700' },
  kmSpesialis: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  kmPanah: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  kartuPutih: {
    backgroundColor: '#fff', borderRadius: 22, padding: 16, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  kpAtas: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kpJudul: { flex: 1, color: INK, fontSize: 15, fontWeight: '700' },
  kpJam: { color: '#9A9A9A', fontSize: 11 },
  kpBawah: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10,
  },
  kpTempat: { color: INK, fontSize: 13, fontWeight: '600' },
  navWrap: { position: 'absolute', bottom: 22, left: 20, right: 20 },
  nav: {
    flexDirection: 'row', backgroundColor: DARK, borderRadius: 28,
    paddingVertical: 12, paddingHorizontal: 8,
  },
  navItem: { flex: 1, alignItems: 'center' },
  navAktifBg: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: RED,
    alignItems: 'center', justifyContent: 'center',
  },
  navTeks: { fontSize: 10, color: '#A88F8F', marginTop: 3 },
  navTeksAktif: { color: '#fff', fontWeight: '700' },
  detailScroll: { flex: 1, paddingHorizontal: 20 },
  detailTopbar: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 54, marginBottom: 12,
  },
  btnLingkaran: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F0E0DE',
  },
  detailTgl: { color: '#9CA3AF', fontSize: 12 },
  detailJudul: { color: INK, fontSize: 28, fontWeight: '800', lineHeight: 34, marginTop: 4 },
  detailLabel: { color: '#9CA3AF', fontSize: 11, marginTop: 10 },
  detailId: { color: INK, fontSize: 16, fontWeight: '800', marginTop: 2 },
  fotoDokter: {
    width: 110, height: 110, borderRadius: 55, backgroundColor: RED,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end', marginTop: -90,
  },
  kartuStatus: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginTop: 14,
    borderWidth: 1, borderColor: '#F0E0DE',
  },
  statusAtas: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  statusJudul: { color: INK, fontSize: 14, fontWeight: '700', flex: 1 },
  pillConfirmed: { backgroundColor: RED, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 12 },
  pillConfirmedTeks: { color: '#fff', fontSize: 11, fontWeight: '700' },
  timeline: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  tlKiri: { alignItems: 'flex-start' },
  tlKanan: { alignItems: 'flex-end' },
  tlTgl: { color: MUT, fontSize: 10 },
  tlJam: { color: INK, fontSize: 13, fontWeight: '700', marginVertical: 2 },
  tlDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#D1D5DB', marginTop: 4 },
  tlGaris: { flex: 1, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: '#E5E7EB' },
  tlHati: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: RED,
    alignItems: 'center', justifyContent: 'center', marginHorizontal: 6,
  },
  kartuVisit: { backgroundColor: RED, borderRadius: 22, padding: 16, marginTop: 14 },
  visitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  visitJudul: { color: '#fff', fontSize: 16, fontWeight: '700' },
  visitAksi: { flexDirection: 'row', gap: 8 },
  visitBtnKecil: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  visitRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  visitInner: { flex: 1, backgroundColor: RED_LIGHT, borderRadius: 16, padding: 14 },
  visitInnerAktif: { borderWidth: 2, borderColor: '#fff' },
  visitTipe: { color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 18 },
  visitDur: { color: '#F5C6C6', fontSize: 11, marginTop: 10 },
  visitMenit: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 2 },
  visitPanah: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', marginTop: 10,
  },
  seksiJudul: { color: INK, fontSize: 17, fontWeight: '800', marginTop: 18, marginBottom: 6 },
  seksiSub: { color: MUT, fontSize: 12, marginBottom: 10 },
  expectBaris: {
    backgroundColor: '#fff', borderRadius: 16, padding: 12, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: '#F0E0DE',
  },
  expectIkon: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: PINK_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  expectA: { color: INK, fontSize: 14, fontWeight: '700' },
  expectB: { color: MUT, fontSize: 12 },
  inputJam: {
    color: INK, fontSize: 15, fontWeight: '700', borderWidth: 1,
    borderColor: '#F0E0DE', borderRadius: 10, paddingVertical: 4,
    paddingHorizontal: 10, marginTop: 4, width: 92,
  },
  btnTesKecil: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: PINK_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  banner: {
    backgroundColor: CREAM, borderRadius: 18, padding: 16, marginTop: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  bannerIkon: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: PINK_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  bannerTeks: { color: INK, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  bannerBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: RED,
    borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, gap: 6,
  },
  bannerBtnTeks: { color: '#fff', fontSize: 12, fontWeight: '700' },
  paragraf: { color: '#555', fontSize: 13, lineHeight: 20, marginTop: 8 },
  langkahNomor: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: PINK_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  langkahTeks: { color: RED, fontSize: 14, fontWeight: '800' },
  profilKartu: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginTop: 14,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderColor: '#F0E0DE',
  },
  profilAvatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: RED,
    alignItems: 'center', justifyContent: 'center',
  },
  profilNama: { color: INK, fontSize: 18, fontWeight: '800' },
  profilKota: { color: MUT, fontSize: 13, marginTop: 2 },
  smJam: { color: RED, fontSize: 15, fontWeight: '800', marginRight: 4 },
  /* ---- checklist harian ---- */
  cwHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingTop: 54, paddingHorizontal: 20,
  },
  cwLabel: { color: MUT, fontSize: 12 },
  cwTanggal: { color: INK, fontSize: 17, fontWeight: '800', marginTop: 2 },
  cwHitungWrap: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: PINK_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  cwProgressRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginTop: 16,
  },
  cwProgressLabel: { flex: 1 },
  cwProgressTeks: { color: INK, fontSize: 15, fontWeight: '800' },
  cwProgressSub: { color: MUT, fontSize: 12, marginTop: 2 },
  cwGrafikPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: DARK, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 14,
  },
  cwGrafikPillTeks: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cwList: { flex: 1, marginTop: 14, paddingHorizontal: 20 },
  cwKartu: {
    backgroundColor: '#fff', borderRadius: 20, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: '#F0E0DE',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cwKartuOn: { backgroundColor: RED, borderColor: RED },
  cwIkonWrap: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: PINK_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  cwIkonWrapOn: { backgroundColor: 'rgba(255,255,255,0.25)' },
  cwNama: { color: INK, fontSize: 16, fontWeight: '800' },
  cwNamaOn: { color: '#fff' },
  cwJam: { color: MUT, fontSize: 11, marginTop: 1 },
  cwCentangBulir: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 2, borderColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center',
  },
  cwCentangBulirOn: { backgroundColor: '#fff', borderColor: '#fff' },
  /* ---- grafik bulanan ---- */
  grHeader: { paddingTop: 54, paddingHorizontal: 20 },
  grJudul: { color: INK, fontSize: 30, fontWeight: '800', lineHeight: 36 },
  grJudulMerah: { color: RED },
  grSub: { color: MUT, fontSize: 13, marginTop: 4 },
  grStatRow: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 18,
  },
  grStatKartu: {
    flex: 1, backgroundColor: CREAM, borderRadius: 18, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#F0E0DE',
  },
  grStatAngka: { color: RED, fontSize: 22, fontWeight: '800' },
  grStatLabel: { color: MUT, fontSize: 11, marginTop: 2 },
  grGrafikLabel: {
    color: INK, fontSize: 14, fontWeight: '800',
    paddingHorizontal: 20, marginTop: 22,
  },
  grBarsWrap: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 20, marginTop: 12, height: 190,
  },
  grBarKolom: { flex: 1, alignItems: 'center' },
  grBarArea: {
    flex: 1, width: '60%', justifyContent: 'flex-end',
    backgroundColor: PINK_BG, borderRadius: 6,
  },
  grBar: {
    width: '100%', borderRadius: 6, backgroundColor: '#E9C9C9',
  },
  grBarSedang: { backgroundColor: RED_LIGHT },
  grBarPenuh: { backgroundColor: RED },
  grBarLabel: { color: '#C9C9C9', fontSize: 9, marginTop: 4 },
  grBarLabelTampil: { color: MUT, fontWeight: '700' },
  grRingkasan: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fff', borderRadius: 18, margin: 20, marginTop: 18,
    padding: 14, borderWidth: 1, borderColor: '#F0E0DE',
  },
  grRingkasanTeks: { flex: 1, color: '#555', fontSize: 13, lineHeight: 19 },
  grLoading: { color: MUT, fontSize: 14 },
});