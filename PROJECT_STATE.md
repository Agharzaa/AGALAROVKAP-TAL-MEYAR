# Meyar — layihənin vəziyyəti

Yenilənib: 07.10.2026 (gecə). Növbəti sessiya buradan davam etməlidir.

## Kontekst

- **Məqsəd:** Azərbaycan şirkətləri üçün 1C-dən güclü, avtomatlaşdırılmış masaüstü uçot sistemi. Uçot modeli 1C AZ-ın subkonto modelidir. Avtomatika heç vaxt təxmin etmir: əmin olmadığı yerdə mühasibə saxlayır.
- **Qərarlar:** istifadəçi ilə razılaşdırılmış bütün uçot qərarları `docs/QERARLAR.md`-dədir. Kod onlara tabedir.
- **Texnologiya:** Electron 44.5.1, React 19.3, TypeScript 7 strict, Vite 8, zod 4.6.5, SQLite (`node:sqlite`, WAL). Uçot ayrıca worker thread-lərdə işləyir.
- **Dizayn:** Windows 11 (Fluent 2) üslubu (10.10.2026, istifadəçi: "Windows şirkəti ilə birlikdə dizayn edilmiş kimi, tam peşəkar"): proqramın öz başlıq zolağı (Windows düymələri sağda, snap), solda NavigationView (bölmələr açılır: sənədlər, yarat, hesabatlar, kitabçalar), açıq məzmun qatı, Fluent düymə/sahə/cədvəl/dialoq/bildiriş, Fluent ikonları, Segoe UI Variable. Vurğu rəngi Microsoft-un mühasibat yaşılı (#107C41). İş qaydası 1C kimi: formalar pəncərədə, əmr panelində "Uçota al və bağla" (Ctrl+Enter), aşağıda pəncərələr paneli (Windows taskbar kimi).
- **Repo:** https://github.com/Agharzaa/AGALAROVKAP-TAL-MEYAR. Quraşdırıcı `download` branch-ində dərc olunur.
- **Köhnə kod:** v2 (qaimə, ödəniş, bank çıxarışı) `v0.2.0` tag-ındadır (c49c4fd). v3-də istifadə olunmur, yalnız istinad üçündür.

## Mərhələ 1 — hazır (0.3.0)

| Sahə                                                                                                                                         | Sübut                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Domain: pul/miqdar, hesab planı və subkonto, yazılış yoxlaması, storno                                                                       | `tests/domain`                                                                                                     |
| Ledger v3: kitabçalar, əl ilə əməliyyat, storno ilə düzəliş/ləğv, registrlər, bağlı dövr, dəyişməz jurnal/audit, idempotentlik, versiya      | `tests/integration`                                                                                                |
| Sentyabr misalı (QERARLAR) qəpikbəqəpik: cəmlər 43 000 / 65 891,14 / 63 288,14; 223.01 Kapital 35 251,24                                     | `tests/integration/ledger.test.ts`                                                                                 |
| Dövriyyə balansı (açıq saldo, subkonto üzrə açılış, natamam aylar), hesab kartı, bütövlük yoxlaması, başlanğıc nəzarətləri                   | `tests/integration`                                                                                                |
| UI (jsdom + real Ledger): ilk şirkət, əl ilə əməliyyat klaviatura ilə, storno, DBC açılışı və Excel, kontragent + müqavilə, saxlanmamış tab  | `tests/ui` — 5 test                                                                                                |
| Real Electron (mənbədən və paketlənmiş Linux build): worker `app.asar.unpacked`-dan yüklənir; şirkət, kataloq (50 hesab), DBC, bütövlük — ok | `MEYAR_SMOKE`                                                                                                      |
| Yük testi, 500 000 yazılış                                                                                                                   | DBC il ~0,6 s; natamam ay ~0,9 s; 211 açılışı ~0,7 s; hesab kartı ~0,04 s; başlanğıc ~1,0 s; bütövlük ~8 s (fonda) |

## 0.3.1 — hesab planı real 1C ilə tutuşdurulub (07.10.2026 axşam)

| Sahə                                                                                                                                                               | Sübut                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Real 1C bazasına yalnız oxumaq üçün baxıldı ("1C Mühasibat AzStandart 2.0"); real məlumat köçürülmədi. Nəticə və təsdiqlənmiş qərarlar: `docs/QERARLAR.md` (axşam) | —                                                                                |
| 521/522 subhesablar; 211/531 .01/.02; 243/543 + hesablaşma sənədi; 701 nomenklatura qrupu → xərc maddəsi; 222.01–.04, 344, 422, 534 (83 hesab)                     | `tests/domain`, `tests/integration` (Sentyabr misalı eyni rəqəmlərlə keçir)      |
| Sxem v2: 0.3.0 bazası açılanda yenilənir, yalnız yazılışı olmayan hesab ailələrində; ad dəyişikliyi istifadəçinin adını əzmir; audit qeydi                         | `schema v1 → v2` testi; real Electron-da 0.3.0 bazası 50 → 83 hesab, bütövlük ok |
| Yük testi 500 000 yazılış: DBC il ~0,4 s; natamam ay ~0,6 s; 211.01 kontragentlər üzrə ~0,6 s; başlanğıc ~0,6 s; bütövlük ~5 s                                     | `npm run test:perf`                                                              |

## 0.3.2 — 1C tutuşdurmasının ikinci hissəsi (07.10.2026 gecə)

- 521/522: "Ödəniş növü" subkontosu (vergi / faiz / sanksiya); 521.07 Ödəniş növü → Kontragent.
- 221.01–221.05, 244.01 / 244.02; 301: Kontragent → Kapitalda dəyişiklik növü. 90 hesab.
- Sxem v3: v2 kimi təhlükəsiz yeniləmə. Real Electron-da 0.3.1 bazası v3-ə keçdi, bütövlük ok. Testlər: `npm test`, `npm run test:ui`.

## Mərhələ 2 — qaimələr (0.4.0, 07.10.2026 gecə)

| Sahə                                                                                                                             | Sübut                                         |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Satış və alış qaiməsi: sətir ƏDV-si, "ƏDV daxildir" seçimi, valyuta + məzənnə, e-qaimə nömrəsi bir dəfə, storno ilə düzəliş/ləğv | `tests/integration/invoices.test.ts`          |
| Sentyabr misalı qaimələrlə: 43 000 / 65 891,14 / 63 288,14 — əl ilə versiya ilə eyni                                             | `invoices.test.ts`                            |
| FIFO maya dəyəri, avansların avtomatik əvəzləşdirilməsi (manat və valyuta)                                                       | `invoices.test.ts`, `tests/domain`            |
| Sxem v4: qaimələr, kitabça rolları, nomenklatura qrupu, FIFO indeksləri                                                          | `schema v1 → current` testi                   |
| UI: satış/alış qaimələri siyahısı və redaktoru, yazılışlar sənədin altında, hesab kartından keçid                                | `tests/ui` (6 test), Electron ekran şəkilləri |
| Müstəqil audit (işi yazmayan ayrıca yoxlayıcı, 3 tur): 8 + 4 qüsur tapıldı, hamısı düzəldi və reqressiya testi kimi qalır        | `invoices.test.ts` ("audit", "re-audit")      |
| Yük testi: 500 000 yazılışlı bazada satış qaiməsi (FIFO + avans) ~0,1 s                                                          | `npm run test:perf`                           |
| Real Electron: 0.3.0 bazası 0.4.0-a yenilənir (50 → 90 hesab, rollar, bütövlük ok)                                               | `MEYAR_SMOKE`                                 |

## 0.4.1 — qaimə və pəncərələr üzrə istəklər (07.10.2026 gecə)

| Sahə                                                                                                                              | Sübut                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| E-qaimə nömrəsi bir sahədir (`MT2610007`); sxem v5 köhnə seriya + nömrəni birləşdirir                                             | `invoices.test.ts`, `tests/ui`                |
| Siyahıda və redaktorda kontragentə dar yer                                                                                        | Electron ekran şəkilləri                      |
| Qaimənin yazılışlarını əl ilə düzəltmək (1C "Əl ilə düzəliş"); bayraq sənəddə saxlanılır, storno ilə                              | `invoices.test.ts`, `tests/ui`                |
| 1C kimi pəncərələr: sürüşdürmə, ölçü, kiçilt/böyüt/bağla, pəncərələr paneli, kaskad, yan-yana, hamısını bağla, Ctrl+Tab / Ctrl+F4 | `tests/ui` (7 test), Electron ekran şəkilləri |

## 0.4.2 — yaşıl dizayn (10.10.2026)

- İstifadəçi "Klassik ofis" lent menyusunu bəyənmədi; köhnə Meyar ERP v1.17-nin (meyar-desktop repo) yaşıl dizaynı əsas götürüldü: modullar yuxarıda, lent menyu yoxdur (1366×768 ekranda iş sahəsi ~100 px böyüdü).
- Başlanğıc səhifəsi "İdarəetmə paneli": əsas göstəricilər (pul, 211, 531, 543, 521), gözləyən işlər, bütün növ son sənədlər, nəzarət, qalıqlar.
- Siyahı və hesabatlar böyüdülmüş pəncərədə, sənədlər onların üstündə pəncərə kimi açılır; seçim pəncərə növünə görə yadda qalır.

## 0.4.3 — "Mühasib masası" dizaynı (10.10.2026)

- 0.4.2-dəki yaşıl görünüş köhnə proqramın surəti kimi qəbul edilmədi; sıfırdan yeni dizayn: 1C-nin iş qaydası (bölmələr → funksiyalar → jurnal → sənəd forması, əmr paneli, Ctrl+Enter), öz vizual dili.
- Testlər: `npm test` (46), `npm run test:ui` (7); Electron ekran şəkilləri 1366×768-də yoxlanıldı.

## 0.4.4 — uzun iş günü üçün (10.10.2026)

- Miqyas: Ctrl + / Ctrl − / Ctrl 0, Ctrl + siçan təkəri və status sətrindəki "− 100% +" (80–150%); proqram yadda saxlayır.
- Proqram ilk dəfə tam ekran açılır, sonra ölçü və yerini yadda saxlayır (ekran ayrılıbsa, standarta qayıdır).
- Hər forma növü son qoyulduğu yerdə və ölçüdə açılır; eyni növdən ikinci forma üst-üstə düşmür.

## 0.4.5 — Windows 11 (Fluent) dizaynı (10.10.2026)

- Başlıq zolağı proqramın özünündür (titleBarOverlay), naviqasiya Windows NavigationView kimi, bütün idarəetmə elementləri Fluent 2 ölçü və rənglərində, ikonlar Fluent System Icons (@fluentui/react-icons).
- Testlər: `npm test` (46), `npm run test:ui` (7); Electron ekran şəkilləri 1366×768.

## 0.4.6 — "Jurnal" dizaynı, 1C kimi əsas menyu (10.10.2026)

- İstifadəçi Fluent/Office görünüşünü bəyənmədi; üç maketdən 2-cini ("Jurnal") seçdi, "bir az daha yaxşısı" ilə.
- Görünüş mühasibat kitabı kimi: kağız fon (#fbfaf8), mürəkkəb-göy yazı (#1c2a44), cədvəllərdə göy xətli sətirlər, başlıq altında və yekunlarda ikiqat xətt, cari yer qırmızı haşiyə xətti ilə (#b0303b). Şriftlər proqrama daxildir: Inter (iş, rəqəmlər), Lora (başlıqlar, etiketlər, yekunlar).
- Yuxarıda başlıq zolağı (Meyar, axtarış Ctrl+K, şirkət, dövr), altında 1C kimi əsas menyu: Başlanğıc, Bank və kassa, Satış, Alış, Anbar, Mühasibat, Hesabatlar, Kitabçalar, Müəssisə; hər birinin açılan menyusunda Sənədlər / Yarat / Hesabatlar / Kitabçalar sütunları. Sağda "Yarat".
- Pəncərələr paneli aşağıda kitab vərəqləri kimi; status sətrində Excel kimi miqyas sürgüsü.
- Sol naviqasiya paneli və lent menyusu çıxarıldı.

## Açıq məsələlər

- **1C ilə hələ açıq qalanlar:** "Pul vəsaitlərinin hərəkəti maddəsi" subkontosu (bank mərhələsində), qalan hesabların adları, "Ödəniş növü" kitabçasının real 1C-dəki elementləri.
- **Quraşdırıcı:** v0.4.1 CI tərəfindən GitHub Releases-də imzalanmamış sınaq versiyası kimi dərc olunub (`Meyar-Setup-0.4.1.exe`). Köhnə baza (0.3.x, 0.4.0) quraşdırılanda avtomatik yenilənir; Windows-da istifadəçi yoxlamalıdır.
- **Audit:** mərhələ 1-in auditi öz yoxlamamdır; mərhələ 2 müstəqil yoxlayıcıdan keçib.
- **Windows:** quraşdırma və açılış istifadəçi tərəfindən təsdiqlənməlidir. İmzalanmamış sınaq versiyasıdır.

## Növbəti mərhələlər (istifadəçi təsdiqindən sonra)

2. ~~Qaimələr~~ — hazır (0.4.0, 0.4.1).
3. **Növbəti:** Bank sənədi: sərbəst müxabir hesab, çoxsətirli; 223.01/224.04 cütü; çıxarış idxalı və öyrənən qaydalar.
4. DVX e-qaimələri: Excel idxalı və kabinetə PIN ilə giriş (köhnə meyar-erp-desktop v1.12–v1.14 kodundan). PIN açıq mətn kimi saxlanılmır.
5. İdarə paneli, ay bağlanışı (6/7 → 801 → 341), kassa, valyuta yenidən qiymətləndirilməsi (243.02 / 543.02 avansları da daxil).

## Əmrlər

```sh
npm ci
npm run typecheck && npm test && npm run test:ui && npm run build
npm run test:perf                                   # MEYAR_PERF_POSTINGS=500000
MEYAR_DATA_DIR=/tmp/m MEYAR_SMOKE=/tmp/m/smoke.json electron .
WINEDEBUG=-all npx electron-builder --win nsis --x64 --publish never
```
