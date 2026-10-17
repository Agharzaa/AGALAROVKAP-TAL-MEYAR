# Meyar — layihənin vəziyyəti

Yenilənib: 16.10.2026. Növbəti sessiya buradan davam etməlidir.

## Kontekst

- **Məqsəd:** Azərbaycan şirkətləri üçün 1C-dən güclü, avtomatlaşdırılmış masaüstü uçot sistemi. Uçot modeli 1C AZ-ın subkonto modelidir. Avtomatika heç vaxt təxmin etmir: əmin olmadığı yerdə mühasibə saxlayır.
- **Qərarlar:** istifadəçi ilə razılaşdırılmış bütün uçot qərarları `docs/QERARLAR.md`-dədir. Kod onlara tabedir.
- **Texnologiya:** Electron 44.5.1, React 19.3, TypeScript 7 strict, Vite 8, zod 4.6.5, SQLite (`node:sqlite`, WAL). Uçot ayrıca worker thread-lərdə işləyir.
- **Dizayn:** "Jurnal" (0.4.6, istifadəçinin seçimi): mühasibat kitabı üslubu, yuxarıda 1C kimi əsas menyu, formalar pəncərədə, "Uçota al və bağla" (Ctrl+Enter). Ətraflı: aşağıda 0.4.6 bölməsi.
- **İş yeri:** Windows kompüterdə klon `C:\Users\rxfet\Desktop\AGALAROVKAP-TAL-MEYAR` (Node 24.20, Git 2.55). Masaüstündəki `meyar-0.1.0-source` köhnə nüsxədir, istifadə olunmur.
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

## Mərhələ 3a — bank sənədi, əl ilə (14.10.2026)

Plan və qərarlar: `docs/MERHELE-3-BANK.md` (təsdiqlənib), `docs/QERARLAR.md` (2026-10-14).

| Sahə                                                                                                                     | Sübut                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Sxem v6: `bank_documents`; 0.4.6 bazası (v5) Windows-da real Electron ilə v6-ya yeniləndi, bütövlük ok                   | `schema v1 → current` testi, `MEYAR_SMOKE` |
| Bank daxilolması (BD-) və məxarici (BX-): istənilən müxabir hesab, çoxsətirli, manat və valyuta, storno ilə düzəliş/ləğv | `tests/integration/bank.test.ts`           |
| 211 / 531 sətri hesablaşma sənədi olmadan: açıq qaimələrə ən köhnədən bölgü, qalanı avans (543 / 243)                    | `bank.test.ts`, `tests/domain`             |
| ƏDV depoziti (224.04) qaimənin yalnız ƏDV hissəsini, cari hesab qalanını bağlayır; QERARLAR misalı qəpikbəqəpik          | `bank.test.ts` (B1/B2)                     |
| Sentyabr misalı bank sənədləri ilə: 43 000 / 65 891,14 / 63 288,14; 223.01 Kapital 35 251,24                             | `bank.test.ts` (B1)                        |
| Qaimədə istifadə olunmuş avansın bank sənədi düzəldilmir / ləğv edilmir                                                  | `bank.test.ts` (B7)                        |
| Kredit + faiz bir sənəddə, öz hesabları arası 222.01, valyuta (USD) bölgüsü, valyuta mübadiləsi (222.04)                 | `bank.test.ts` (B4–B6)                     |
| UI: bank sənədləri jurnalı, forma (şablonlar, klaviatura), hesab kartından və İş masasından keçid                        | `tests/ui` (8 test)                        |
| Yük testi (100 000 yazılış): bank daxilolması ~4 ms (hədd 300 ms); digər həddlər dəyişməyib                              | `npm run test:perf`                        |

Testlər Windows-da: `npm test` 57, `npm run test:ui` 8, `npm run test:perf` keçir.

**Yoxlanmayıb:** yeni formanın görünüşü real Electron pəncərəsində ekran şəkli ilə yoxlanmayıb (yalnız jsdom testi). Mərhələ 3a üçün müstəqil audit hələ aparılmayıb.

## Mərhələ 3b — ƏDV cütü və nəzarət siqnalları (14.10.2026)

| Sahə                                                                                                                                                                           | Sübut                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| 223.xx və 224.04 sənədlərinin cütü: eyni ödəyici (bankdakı VÖEN, yoxdursa kontragentin VÖEN-i), eyni istiqamət, ±3 gün; avtomatik yalnız hər iki tərəfdə yeganə namizəd olanda | `bank.test.ts` (B3)                      |
| Cüt yalnız alıcı/malsatan ilə hesablaşma sənədləri arasında (211/531/243/543 sətri); büdcəyə ƏDV ödənişi, kapital, öz köçürmələr cütləşmir və siqnal vermir                    | `bank.test.ts` (B3)                      |
| 18/118 yoxlaması (±0,01 AZN): fərq siqnaldır, sənəd saxlanılır                                                                                                                 | `bank.test.ts` (B3)                      |
| Əl ilə cütləşdirmə / ayırma (`bank.pair`), ləğvdə və uyğunsuz düzəlişdə cüt avtomatik ayrılır; audit jurnalında                                                                | `bank.test.ts` (B3)                      |
| Sxem v7: bağlı dövr qoruyucusu cütə toxunmur — bağlı dövrdəki yarının cütü açıq dövrdəki ləğvlə ayrılır                                                                        | `bank.test.ts`, real Electron (v6 → v7)  |
| İş masası: yolda qalmış köçürmə (222.01 / 222.03), cütsüz ƏDV hissəsi, 18/118 fərqi; siqnaldan sənədə keçid                                                                    | `bank.test.ts` (B5), `tests/ui` (9 test) |
| Formada "ƏDV cütü" paneli: cüt sənəd, 18/118 nəticəsi, namizədlər, "Cütləşdir" / "Cütü ayır"                                                                                   | `tests/ui`                               |

Testlər Windows-da: `npm test` 62, `npm run test:ui` 9, `npm run test:perf` keçir; real Electron təmiz və v6 bazasında ok.

**Yoxlanmayıb:** formanın yeni panelinin görünüşü ekran şəkli ilə; müstəqil audit (mərhələ 3-ün sonunda).

## Mərhələ 3c — bank çıxarışının yüklənməsi (14.10.2026)

| Sahə                                                                                                                                                                                    | Sübut                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Oxuyucu: başlıq blokundakı IBAN, əvvələ/sona qalıq (AZ/RU/EN etiketlər, overdraft), debet/kredit və ya işarəli məbləğ, qarşı tərəfin hesabı; "fayl öz-özünə tarazdır" yoxlaması         | `tests/domain` (2 format)                      |
| Sxem v8: `statement_imports`, `statement_lines` (bankın yazdığı sahələr dəyişdirilmir, silinmir)                                                                                        | `schema v1 → current`, real Electron (v7 → v8) |
| Bank hesabı IBAN-a görə; IBAN yoxdursa istifadəçi seçir; uyğunsuzluq rədd olunur                                                                                                        | `statements.test.ts`                           |
| Dublikat yoxdur (barmaq izi + eyni sətrin təkrar sayı): ikinci yükləmə 0 yeni sətir, üst-üstə düşən dövr yalnız yeni sətirləri əlavə edir, eyni gündə iki eyni komissiya ikisi də qalır | `statements.test.ts` (B9)                      |
| Üç vəziyyət: gözləyir (təklif / naməlum), uçota alınıb, kənara qoyulub (səbəblə, geri qaytarılır). Avtomatik uçot yoxdur — qaydalar 3d-də                                               | `statements.test.ts` (B12)                     |
| Sətirdən bank sənədi: forma çıxarışdan doldurulur, tarix/hesab/məbləğ çıxarışa bərabər olmalıdır (düzəlişdə də); ləğv sətri geri qaytarır                                               | `statements.test.ts`, `tests/ui`               |
| Əl ilə daxil edilmiş ödəniş ±2 gün: "Bu sənədlə bağla" təklifi, ikinci sənəd yaranmır                                                                                                   | `statements.test.ts` (B13)                     |
| Bank ↔ uçot: əvvələ və sona qalıq, fərq                                                                                                                                                 | `statements.test.ts` (B14), `tests/ui`         |
| Pul vəsaitlərinin hərəkəti maddəsi: sətrin atributu, ayrıca kitabça (8 başlanğıc element, IFRS 7/IAS 7 qrupları, 1C-də yoxlanılmayıb)                                                   | `statements.test.ts`                           |
| Yük: 5 000 sətir yüklənir ~0,1 s (hədd 10 s), açılır ~0,1 s (hədd 3 s)                                                                                                                  | `npm run test:perf`                            |

Testlər Windows-da: `npm test` 70, `npm run test:ui` 10, `npm run test:perf` keçir; real Electron təmiz və v7 bazasında ok.

**Sadələşdirmə / sonraya:** sətrin forması ayrıca pəncərədə açılır (çıxarış pəncərəsində yan panel və "növbəti sətir" axını yoxdur); pul hərəkəti hesabatı mərhələ 5-də (idarə paneli). **Real bank faylları ilə yoxlanmayıb** — yalnız sintetik formatlar; istifadəçidən anonimləşdirilmiş nümunələr gözlənilir.

## Mərhələ 3d — öyrənən qaydalar (14.10.2026)

| Sahə                                                                                                                                                                                               | Sübut                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Sxem v9: `bank_rules` (silinmir, arxivləşir, versiyalı, tarixçə), `budget_codes`, çıxarış sətrində `manual_only` / `auto_note`                                                                     | `schema v1 → current`, real Electron (v8 → v9) |
| Qayda mühasibin qərarından: bank sənədində "Qayda kimi saxla" → layihə (VÖEN varsa söz lazım deyil; yoxdursa təyinatdan 4+ hərfli, rəqəmsiz 2 söz), mühasib düzəldir; "Təklif" rejimində başlayır  | `rules.test.ts` (B10), `tests/ui`              |
| Ən dəqiq qayda qalib gəlir (VÖEN > söz > bank hesabı > məbləğ aralığı); eyni dəqiqlikdə fərqli yazılış — ziddiyyət, heç nə uçota alınmır; eyni şərtli ikinci qayda rədd olunur                     | `rules.test.ts` (B11), `tests/domain`          |
| "Avtomatik" rejim yalnız mühasib qoşanda: idxalda və "Avtomatik qaydaları tətbiq et" ilə; hər sətir ayrıca savepoint-də (biri alınmasa digərləri gedir, səbəb sətirdə qalır); audit "qayda X (vN)" | `rules.test.ts`, `tests/perf`                  |
| Sabit məbləğli sətirlər + qalan (kredit: faiz sabit, əsas borc qalan); valyuta hesabında avtomatik uçot yoxdur (məzənnə)                                                                           | `rules.test.ts`                                |
| Geri qaytarma: avtomatik sənədin ləğvi sətri qaytarır və o sətri artıq yalnız təklif edir                                                                                                          | `rules.test.ts` (B10), `tests/ui`              |
| Büdcə təsnifat kodu → 521/522 subhesab + ödəniş növü (cədvəli mühasib doldurur); təyinatda "BTK"/"büdcə təsnifat kodu" və ya cədvəldə olan 6 rəqəm                                                 | `rules.test.ts`, `tests/domain`                |
| Yük: 5 000 sətir, ~700 avtomatik uçot ilə idxal ~0,4 s (hədd 10 s)                                                                                                                                 | `npm run test:perf`                            |

Testlər Windows-da: `npm test` 75, `npm run test:ui` 11, `npm run test:perf` keçir; real Electron təmiz və v8 bazasında ok.

**Mərhələ 3 tamamlandı (3a–3d), versiya 0.5.0.** Mərhələ 3 və audit `main`-də GitHub-a push edilib (15.10.2026). Qalan: real bank faylları ilə oxuyucunun yoxlanması (istifadəçidən anonimləşdirilmiş nümunələr).

## Mərhələ 3 auditi (15.10.2026)

Müstəqil yoxlayıcı (kodu yazmayan sessiya), 2 tur: 7e75bc1 (3a), 646fde0 (3b), 8a33381 (3c), 561a144 (3d). Hər qüsur üçün əvvəl uğursuz reqressiya testi yazıldı (`audit:` adlı testlər), sonra minimal düzəliş.

| #   | Ağırlıq | Qüsur                                                                                                                                                                                                                  | Düzəliş                                                                                                     | Test                 |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Yüksək  | "Avtomatik" qayda əl ilə daxil edilmiş ödənişi (eyni hesab, istiqamət, məbləğ, ±2 gün) görmürdü və ikinci bank sənədi yaradırdı — pul hərəkəti ikiqat uçota düşürdü. B13 yalnız təklif rejimində qorunurdu.            | `applyRules` əvvəlcə `handTypedMatches` yoxlayır; uyğun sənəd varsa sətir gözləyir, səbəb `auto_note`-dadır | `rules.test.ts`      |
| 2   | Orta    | Qayda layihəsi bank sənədinin konkret hesablaşma sənədini (qaiməni) qaydaya köçürürdü; avtomatik qayda sonrakı hər ödənişi həmin köhnə qaiməyə bağlayardı (211/531-də əks qalıq, açıq qaimələr bağlanmır).             | `ruleDraft` hesablaşma sənədini boşaldır; `rule.save` sabit hesablaşma sənədini rədd edir                   | `rules.test.ts`      |
| 3   | Orta    | Avans qoruması (QERARLAR 2026-10-14 §4) yalnız yekun qalığı yoxlayırdı: bank sənədinin tarixi avansı əvəzləşdirən qaimədən sonraya köçürüləndə aradakı günlərdə 543/243 əks qalığa düşürdü, dəyişiklik qəbul olunurdu. | `guardAdvances` qalığı gün-gün yoxlayır (qaimə yalnız öz tarixindəki avansı əvəzləşdirir)                   | `bank.test.ts`       |
| 4   | Aşağı   | Çıxarış sətrindən yaradılmış sənədin tarixi düzəlişdə ±2 gün dəyişə bilirdi, halbuki tarix bankın yazdığıdır (±2 gün yalnız sonradan əl ilə bağlanmış sənəd üçündür).                                                  | `bindStatementLine`: `origin = 'statement'` olan sənəddə tarix dəqiq                                        | `statements.test.ts` |

**Qüsur tapılmayan yoxlamalar:** qaimələrə bölgü və ƏDV depozit/cari hesab payları (B2 misalı, depozit avansının sonrakı qaimədə əvəzləşməsi), valyutada kumulyativ yuvarlaqlaşdırma (`splitProportionally`), storno ilə düzəliş/ləğvdə sənədin özünü iki dəfə saymaması, bağlı dövr (sənəd, ləğv, cüt), dublikat qoruması (barmaq izi + təkrar sayı, üst-üstə düşən fayllar), cütün ayrılması, `manual_only`, savepoint-in geri qaytarılması (audit və sənəd birlikdə geri gedir), tenant izolyasiyası (bütün oxumalar `company_id` ilə; id-lər UUID), dinamik SQL-də yalnız daxili sabitlər (injection yoxdur), idempotentlik (`statement.import` təkrarı nəticəni qaytarır), sxem v6–v9 köhnə bazada (`schema v1 → current`).

**Açıq suallar üzrə qərarlar (15.10.2026; istifadəçi: "ən məntiqli və düzgün nədirsə, onu et"; `docs/QERARLAR.md` 2026-10-15):**

1. **Ödənilmiş qaimənin ləğvi və ya azaldılması bloklanır** (B7-dəki avans qoruması ilə eyni məntiq): qaimənin öz hesablaşma açarı (211 / 531, hesablaşma sənədi = bu qaimə) əvvəl olmayan artıq ödənişə düşə bilməz. Mesaj ödəniş sənədini göstərir: "əvvəlcə ödəniş sənədini düzəldin". Valyuta qaiməsi valyuta məbləği ilə yoxlanır. `invoices.ts → guardSettlement`; test `bank.test.ts`.
2. **Fiziki şəxs və xarici kontragent tam məbləği cari hesaba ödəyəndə** qaimə ƏDV daxil tam bağlanır: onların ƏDV depozit hesabı yoxdur. Hüquqi şəxs və dövlət təşkilatı üçün QERARLAR §3 dəyişmir (ƏDV payını depozit bağlayır). ƏDV ödəyicisi olmayan hüquqi şəxsin tam ödənişini mühasib qaiməni sətirdə əl ilə seçərək tam bağlayır. ƏDV ödəyicisi olan fərdi sahibkarın iki hissəli ödənişi də düzgün gedir (cari hesab əvvəl ƏDV-siz hissəni, depozit ƏDV-ni bağlayır). `bank.ts → autoSettle`; test `bank.test.ts`.
3. **Sonrakı sənədlər avtomatik yenidən keçirilmir** — bu, düzgün davranış kimi saxlanıldı: bir sənədin düzəlişi başqa, artıq uçotda olan sənədləri səssiz dəyişməməlidir (audit izi, bağlı dövr). Qaimə yenidən açılırsa, mühasib sonrakı ödənişi yenidən saxlayır və ya qaiməni əl ilə seçir.
4. **Artıq ödənilmiş qaiməyə əl ilə bağlanma** saxlanılır, sənədin başlığında xəbərdarlıq çıxır ("SQ-… qaiməsi artıq ödənilib — artıq ödəniş … AZN"). `reports.ts → bankDetail.warnings`, `bank-editor.tsx`; test `bank.test.ts`.
5. **Eyni dəqiqlikli, eyni yazılışlı qaydalarda "təklif" üstündür**: avtomatik uçot yalnız sətri tanıyan bütün bərabər qaydalar "avtomatik" olanda. `domain/rules.ts → chooseRule`; test `tests/domain`.

Testlər Windows-da: `npm run typecheck`, `npm test` 83, `npm run test:ui` 12 (formadakı xəbərdarlıq daxil), `npm run test:perf` keçir (5 000 sətirlik çıxarış ~700 avtomatik uçotla ~0,5 s). Real Electron (Windows, təmiz baza, `MEYAR_SMOKE`): şirkət, 90 hesab, DBC, bütövlük — ok.

## Mərhələ 4 — DVX e-qaimələri

Plan və qərarlar: `docs/MERHELE-4-EQAIME.md` (təsdiqlənib 15.10.2026, §11 tövsiyələri qəbul), `docs/QERARLAR.md` (2026-10-15, mərhələ 4). Köhnə DVX qoşulmasına istinad: quraşdırılmış Meyar ERP v1.17.2 (`%LOCALAPPDATA%\Programs\Meyar ERP`); Masaüstündəki v1.12–v1.14 qovluqları və nümunə Excel faylı artıq yoxdur.

### 4a — idxal və e-qaimə qutusu (15.10.2026)

| Sahə                                                                                                                                                                                                           | Sübut                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Sxem v10: `eq_imports`, `eq_documents`, `eq_status_history`, `eq_product_map` (4b üçün), `invoices.origin / eq_document_id`; DVX sahələri dəyişdirilmir, silinmir; mal sətirləri və başlıq bir dəfə tamamlanır | `eqaime.test.ts` (E16), `schema v1 → current`    |
| Oxuyucu: "Qaimələr üzrə" (ƏDV bazaları ayrı) və "Mallar üzrə" (sətirlər e-qaimə üzrə qruplaşır), başlıq blokundan istiqamət, Excel tarix nömrəsi, "Cəmi" sətri atlanır; statuslar sərt: tanınmayan — `unknown` | `tests/domain/eqaime.test.ts` (E1, **sintetik**) |
| Bir dəfə: istiqamət + VÖEN + nömrə; eyni fayl ikinci dəfə — 0 yeni, heç nə dəyişmir; üst-üstə düşən dövr yalnız yenini əlavə edir; eyni nömrə iki malsatandan — iki e-qaimə                                    | `eqaime.test.ts` (E2, E4)                        |
| İstiqamət qoruması: başlıqdakı "Gələnlər/Göndərilənlər" seçimə zidddirsə, şirkətin VÖEN-i səhv tərəfdədirsə və ya ümumiyyətlə yoxdursa — bütün fayl rədd; öz VÖEN-i kontragent yerində — sətir rədd            | `eqaime.test.ts` (E3), `tests/ui`                |
| DVX statusu izlənir (tarixçə ilə): gözləyən → təsdiqlənib; ləğv / imtina — avtomatik kənara qoyulur, geri qaytarılmır; eyni e-qaimə fərqli məbləğlə — ziddiyyət, mövcud qeyd toxunulmaz                        | `eqaime.test.ts` (E12)                           |
| Qutu pəncərəsi (Alış / Satış → "… e-qaimələr (DVX)"): ilkin baxış, tablar (Gözləyir · DVX-də gözləyir · Ziddiyyət · Uçota alınıb · Kənar qoyulub), e-qaimənin sətirləri və status tarixçəsi, kənara qoyma      | `tests/ui` (13 test)                             |
| Yük: 5 000 e-qaimə / 50 000 mal sətri yüklənir ~0,3 s (hədd 10 s), qutu açılır ~0,05 s (hədd 3 s); 500 000 yazılışlı bazada digər həddlər dəyişməyib                                                           | `npm run test:perf`                              |

Testlər Windows-da: `npm run typecheck`, `npm test` 94, `npm run test:ui` 13, `npm run test:perf` keçir. Real Electron (Windows, `MEYAR_SMOKE`): təmiz baza və 0.5.0 kodu ilə yaradılmış v9 bazası (alış qaiməsi ilə) — v10-a yeniləndi, qaimə toxunulmaz, bütövlük ok. Yeni pəncərənin görünüşü ekran şəkli ilə yoxlanmayıb (yalnız jsdom testi).

**Real DVX faylı ilə yoxlanmayıb:** oxuyucunun sütun sözləri v1.17-nin oxuduğu DVX ixracından götürülüb; istifadəçi anonimləşdirilmiş faylları göndərəcək (Gələnlər / Göndərilənlər × Qaimələr üzrə / Mallar üzrə).

### 4b — e-qaimələrin uçotu (15.10.2026)

| Sahə                                                                                                                                                                                                                                                                                                                                                                 | Sübut                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Uçot yalnız `invoice.save` ilə: alınan e-qaimə → AQ-, göndərilən → SQ-. Avtomatik qaimənin yazılışları əl ilə yazılmış eyni qaimə ilə eynidir (ƏDV 241 / 521.01, FIFO, avansın əvəzləşməsi)                                                                                                                                                                          | `eqaime-book.test.ts` (E5, E6)    |
| Təklif mühərriki: kontragent VÖEN-ə görə (avtomatik yaradılmır, "Kontragenti yarat" düyməsi), müqavilə — yeganə aktiv və ya VÖEN üçün seçilmiş, sətirlər — uyğunluq xəritəsi (VÖEN+kod+ad → … → kod), səbəblər sətirdə                                                                                                                                               | E7                                |
| Qəpikbəqəpik: Meyar-ın qaiməsi DVX-in ƏDV-siz məbləğini və ƏDV-sini təkrarlamalıdır (qiymət DVX-dən və ya məbləğ / miqdar, 4 onluq); fərq — təklif, rəqəmlərlə                                                                                                                                                                                                       | E8                                |
| Yalnız yekunlar: xidmət üçün "bütün qaimə" uyğunluğu ƏDV bazalarına görə sətirlər qurur; mal üçün "Mallar üzrə" gözlənilir                                                                                                                                                                                                                                           | E9                                |
| Əl ilə yazılmış qaimə: eyni nömrə — bağlanır (fərqli məbləğ — ziddiyyət); nömrəsiz, eyni kontragent + cəmi, ±5 gün — "Bağla" təklifi, nömrə yazılır, yazılışlar dəyişmir; ikinci qaimə yaranmır                                                                                                                                                                      | E13                               |
| Qaimə e-qaiməyə bağlıdırsa, sonrakı düzəlişdə də DVX-ə uyğun qalmalıdır; DVX-də ləğv — ziddiyyət, qaimə ləğv olunanda e-qaimə kənara qoyulur                                                                                                                                                                                                                         | `eqaime-book.test.ts`             |
| Avtomatik rejim yalnız mühasibin "avtomatik" etdiyi uyğunluqlarla; geri qaytarma (storno) e-qaiməni yalnız təklif edir; bir uğursuz e-qaimə digərlərini dayandırmır (savepoint, səbəb sətirdə); bağlı dövr — təklif                                                                                                                                                  | E14, E15                          |
| Öyrənmə: qaimədə "Uyğunluq kimi saxla" — sətir-sətir "təklif" uyğunluqları (bir neçə müqavilədə müqavilə də); "E-qaimə uyğunluqları" kitabçası: rejim, düzəliş, arxiv, istifadə sayı, versiya tarixçəsi                                                                                                                                                              | `eqaime-book.test.ts`, `tests/ui` |
| UI: qutuda Təklif · Naməlum · DVX-də gözləyir · Ziddiyyət · Avtomatik · Uçota alınıb · Kənar qoyulub; Enter — e-qaimədən dolu qaimə, Ctrl+Enter — uçota al və bağla; "Avtomatik uyğunluqları tətbiq et"                                                                                                                                                              | `tests/ui` (14 test)              |
| Yük (500 000 yazılışlı baza): 5 000 e-qaimə + 1 200 avtomatik qaimə ~8,3 s (hədd 10 s), qutu ~0,3 s. Bunun üçün qaimə yazılışında iki yavaşlıq düzəldi: e-qaimə nömrəsinin bir dəfəlik yoxlaması indeksi istifadə etmirdi (hər qaimədə bütün qaimələr oxunurdu); anbar qoruyucusu qalığı yalnız artıran alışda da bütün tarixçəni hesablayırdı. Qaimə ~80 ms → ~7 ms | `npm run test:perf`               |

Testlər Windows-da: `npm run typecheck`, `npm test` 105, `npm run test:ui` 14, `npm run test:perf` keçir.

**Sadələşdirmə / sonraya:** DVX sətirləri qaimə formasında başlıqdakı zolaqda göstərilir (hər sətrin yanında yox); Ctrl+Enter formanı bağlayır, qutu növbəti sətri özü açmır. Kabinet pəncərəsi — 4d. Yeni pəncərələrin görünüşü ekran şəkli ilə yoxlanmayıb.

### 4c — DVX statusları və tutuşdurma (15.10.2026)

| Sahə                                                                                                                                                                                                                                                                                                                                                                                            | Sübut                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| DVX-də ləğv / imtina, uçotda var: "Ziddiyyət" tabı və İş masası siqnalı; səssiz storno yoxdur — "Qaiməni ləğv et" düyməsi (storno), sonra e-qaimə kənara qoyulur; ödənilmiş qaimə ləğv olunmur (mesaj ödəniş sənədini göstərir)                                                                                                                                                                 | `eqaime-book.test.ts` (E10), `tests/ui` |
| Düzəliş e-qaiməsi heç vaxt avtomatik deyil. Əsas uçotda deyilsə — düzəliş onun yerinə uçota alınır, əsas "DVX: düzəliş … ilə əvəz olunub" səbəbi ilə kənara qoyulur (geri qaytarılmır); əsas uçotdadırsa — həmin qaimə (öz tarixi ilə) düzəlişin sətirləri ilə storno + yeni yazılışla dəyişir, qaimənin e-qaimə nömrəsi düzəlişin nömrəsi olur; ikinci qaimə qadağandır; bağlı dövrdə — əl ilə | E11 (3 hal), `tests/ui`                 |
| Əsas e-qaimə DVX-də "düzəliş edilib" statusu alanda, uçotdakı qaiməsi düzəliş gələnədək "Ziddiyyət"dədir                                                                                                                                                                                                                                                                                        | E11                                     |
| DVX ↔ uçot (qutuda, iş dövrü üzrə): ay-ay DVX-in ƏDV-si (təsdiqlənmiş, düzəlişlə əvəzlənmiş əsaslar sayılmır) və uçotdakı qaimələrin ƏDV-si, fərq; uçota alınmamış e-qaimələr; yüklənmiş DVX dövründə olub DVX-də olmayan e-qaimə nömrəli qaimələr; nömrəsiz qaimələr                                                                                                                           | `eqaime-book.test.ts`, `tests/ui`       |
| İş masası (açıq dövr): ziddiyyətlər, uçota alınmamış e-qaimələr (ƏDV ilə), ay üzrə ƏDV fərqi, DVX-də tapılmayan nömrələr — "Qutunu aç" keçidi ilə                                                                                                                                                                                                                                               | `eqaime-book.test.ts`                   |
| Yük (500 000 yazılış): 5 000 e-qaimə + 1 200 avtomatik qaimə ~7,9 s (hədd 10 s; yeni qaimədə mənasız ödəniş sorğuları da çıxarıldı), İş masası e-qaimə siqnalları ilə ~0,8 s (hədd 1,5 s), aylıq tutuşdurma ~0,06 s                                                                                                                                                                             | `npm run test:perf`                     |

Testlər Windows-da: `npm run typecheck`, `npm test` 110, `npm run test:ui` 15, `npm run test:perf` keçir.

**Fərziyyə (real faylla yoxlanmalıdır):** DVX-in düzəliş e-qaiməsi əsasın tam yeni məzmunudur (fərq deyil) və "Düzəliş edilən qaimə" sütununda əsasın nömrəsini göstərir.

### 4d — DVX kabineti (16.10.2026)

| Sahə                                                                                                                                                                                                                                              | Sübut                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Qutuda "DVX kabinetini aç": rəsmi `https://new.e-taxes.gov.az/etaxes/` ayrıca pəncərədə; istifadəçi özü daxil olur (ASAN İmza, SİMA, istifadəçi kodu + parol + PIN). Pəncərədə preload və Meyar skripti yoxdur, sahələr oxunmur, heç nə saxlanmır | `src/main/dvx-portal.ts`                                                   |
| Yalnız HTTPS e-taxes.gov.az, asanimza.az, asan.az, sima.az (və alt domenləri); oxşar adlar, http, istifadəçi:parol@ ünvanlar rədd; `window.open` eyni pəncərədə; kənar keçid bloklanır, qutuda mesaj                                              | `tests/domain/dvx-policy.test.ts`, Electron smoke                          |
| Sessiya yaddaşda (partition `persist:`-siz, hər pəncərəyə yeni); pəncərə bağlananda kukilər, saxlanc və keş silinir                                                                                                                               | Electron smoke: bağlandıqdan sonra 0 kuki                                  |
| Kabinetin öz "Excel-ə ixrac" endirməsi tutulur: yalnız .xlsx/.xls/.csv, 50 MB-a qədər, kabinetin özündən (blob/data daxil); fayl müvəqqəti fayldan oxunub dərhal silinir və həmin istiqamətin qutusunda adi ilkin baxışa düşür (mənbə "portal")   | Electron smoke (fayl gəldi, .exe rədd, müvəqqəti fayl qalmadı), `tests/ui` |

Testlər Windows-da: `npm run typecheck`, `npm test` 113, `npm run test:ui` 16. Real Electron (`MEYAR_SMOKE` + `MEYAR_SMOKE_DVX=1`, yerli sınaq serveri e-taxes.gov.az əvəzinə): ok.

**Yoxlanmayıb (yalnız istifadəçi edə bilər):** real e-taxes.gov.az girişi ASAN İmza / SİMA ilə — giriş domenlərinin siyahısı (asanimza.az, asan.az, sima.az) real girişdə dəqiqləşməlidir; kabinetin ixracı köhnə .xls formatındadırsa, oxuyucu onu hələ açmır (istifadəçi .xlsx kimi saxlamalı olacaq) — real faylla yoxlanacaq.

## Mərhələ 4 auditi (16.10.2026)

Müstəqil yoxlayıcı (kodu yazmayan sessiya), 2 tur, `53623fc..50bd7cd` (4a–4d). Hər qüsur üçün əvvəl uğursuz reqressiya testi yazıldı (`audit:` adlı testlər), sonra minimal düzəliş, ayrıca commit. Tur 1 — 1–7, tur 2 (düzəlişlərdən sonra yenidən oxunuş, UI və portal yolu, ziddiyyətlərin ömrü) — 8–12.

| #   | Ağırlıq | Qüsur                                                                                                                                                                                                                                                                            | Düzəliş                                                                                                                          | Test                              |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | Yüksək  | "Mallar üzrə" faylında oxunmayan mal sətri yalnız özü atılırdı: e-qaimə qalan sətirlərlə, cəmi onlardan hesablanaraq yüklənirdi — DVX-dəkindən kiçik e-qaimə (avtomatik də) uçota düşə bilərdi.                                                                                  | `readEqTable`: belə e-qaimə bütövlükdə yüklənmir, problem siyahısında adı ilə                                                    | `tests/domain/eqaime.test.ts`     |
| 2   | Yüksək  | "Mallar üzrə" hesabatı növü (qaytarma, avans), aksizi, yol vergisini çap etmir; növ boş olanda "əsas" sayılırdı — yalnız mal hesabatı ilə gələn qaytarma / avans e-qaiməsi adi alış / satış kimi **avtomatik** uçota alınırdı.                                                   | Növü çap olunmayan və "Qaimələr üzrə" ilə tamamlanmamış e-qaimə yalnız təklifdir (səbəb: "Qaimələr üzrə hesabatını da yükləyin") | `eqaime-book.test.ts`, `tests/ui` |
| 3   | Orta    | `eqaime.link` nömrəsiz qaiməyə e-qaimə nömrəsini bir dəfəlik yoxlamasız yazırdı; nömrə başqa qaimədə olanda yalnız baza indeksi dayandırırdı ("Bu məlumat artıq mövcuddur").                                                                                                     | `invoice.save`-dəki yoxlama: "E-qaimə … artıq AQ-… qaiməsində yazılıb"                                                           | `eqaime-book.test.ts`             |
| 4   | Orta    | ±5 gün fərqlə əl ilə bağlanmış qaiməyə düzəliş e-qaiməsi tətbiq olunmurdu (forma qaimənin öz tarixini saxlayır, yoxlama yalnız düzəlişin və ya əsasın dəqiq tarixini qəbul edirdi); tətbiq olunsa da, sonrakı hər düzəliş tarixə görə rədd olunardı.                             | Bağlanmış qaimədə ±5 gün əsas e-qaimənin tarixinə də aiddir; düzəliş "link" uçotunu saxlayır                                     | `eqaime-book.test.ts`             |
| 5   | Orta    | §5.1: uçotdakı e-qaimə DVX-də yenidən "gözləyir" və ya tanınmayan statusa keçəndə siqnal yox idi ("Uçota alınıb"da qalırdı, İş masası susurdu).                                                                                                                                  | "Təsdiqlənib"dən başqa hər status uçotdakı e-qaiməni "Ziddiyyət"ə salır, İş masasında sayılır                                    | `eqaime-book.test.ts`             |
| 6   | Aşağı   | Bir malsatanın e-qaiməsi əl ilə yazılmış qaiməyə bağlananda avtomatik keçid həmin nömrəli **bütün** qaimələri unudurdu — başqa malsatanın eyni nömrəli e-qaiməsi (E4) həmin keçiddə bağlanmırdı, avtomatik uyğunluqla "artıq uçotdadır" xətası alırdı.                           | Yalnız bağlanan qaimə çıxarılır                                                                                                  | `eqaime-book.test.ts`             |
| 7   | Aşağı   | İş masası "uçota alınmayıb" siqnalı gözləyən əsas e-qaiməni və onu əvəz edən düzəlişi iki dəfə sayır, ƏDV-lərini toplayırdı (DVX ↔ uçot isə yalnız düzəlişi göstərir).                                                                                                           | Təsdiqlənmiş düzəlişlə əvəzlənən əsas e-qaimə siqnalda sayılmır                                                                  | `eqaime-book.test.ts`             |
| 8   | Yüksək  | Kabinetdən endirilən fayl həmin istiqamətin **bütün** açıq qutularında, o cümlədən iş sahəsində açıq qalan başqa şirkətin qutusunda ilkin baxışa düşürdü; yalnız kontragentin VÖEN-i olan faylda şirkəti heç nə sübut etmir — bir şirkətin e-qaimələri digərinə yüklənə bilərdi. | Fayl (və rədd mesajı) yalnız kabineti açan qutuya gəlir                                                                          | `tests/ui`                        |
| 9   | Orta    | DVX eyni e-qaiməni fərqli məbləğlə göndərəndə (ziddiyyət, §5.3) avtomatik keçid saxlanan məbləği yenə uçota alırdı.                                                                                                                                                              | Ziddiyyətli e-qaimə yalnız təklifdir, ziddiyyət səbəb kimi                                                                       | `eqaime-book.test.ts`             |
| 10  | Orta    | Yalnız mal hesabatı ilə (növsüz) əl ilə uçota alınmış e-qaimə sonra "Qaimələr üzrə"də düzəliş (əsası da uçotda — mal iki dəfə), qaytarma, avans və ya aksizli çıxanda heç bir siqnal yox idi.                                                                                    | Uçotdakı e-qaimənin başlığı tamamlananda növ "əsas" deyilsə və ya aksiz / yol vergisi varsa — ziddiyyət                          | `eqaime-book.test.ts`             |
| 11  | Orta    | Uçotdan yaranan ziddiyyət (bağlanmış qaimə ilə məbləğ fərqi) qaimə ləğv ediləndə də qalırdı: e-qaimə həmişəlik "Ziddiyyət"də, 9-a görə avtomatik də keçməzdi.                                                                                                                    | Uçot ziddiyyətləri "Uçot: " ilə başlayır və qaimə ləğv ediləndə silinir; iki DVX faylı arasındakı ziddiyyət qalır                | `eqaime-book.test.ts`             |
| 12  | Aşağı   | Məbləği fərqli bağlanmış qaimə DVX məbləğlərinə düzəldiləndən sonra da ziddiyyət qalırdı (İş masasında həmişəlik).                                                                                                                                                               | DVX-ə uyğun yenidən saxlama bağlantının məbləğ ziddiyyətini həll edir (növ ziddiyyətini yox)                                     | `eqaime-book.test.ts`             |

**Qüsur tapılmayan yoxlamalar:** `invoices.ts`-dəki sürət dəyişiklikləri məntiqcə eynidir — `guardStock` yalnız mənfi gün dəltası olan malı yoxlayır (bütün dəltalar ≥ 0 olanda kumulyativ dəyişiklik heç vaxt mənfi olmur, şərt `now < now − change` ödənə bilməz); yeni qaimədə `guardSettlement` və `settlementBalance` buraxılır (id yeni yaradılır, heç bir sənəd ona istinad edə bilməz; mövcud qaimənin yazılışı həmişə ən azı bir sətirdir, çünki sətir məbləği ≥ 0,01); `eq_key<>''` indeksdən istifadə üçündür. Bir dəfəlik açar (istiqamət + VÖEN + nömrə; satışda şirkət üzrə unikal indeks, alışda malsatan üzrə), əl ilə qaimə + e-qaimə (eyni nömrə → bağlanır, nömrəsiz → yalnız təklif), düzəliş + əsas (`bindEq`: ikinci qaimə qadağan, əsas kənara), istiqamət (`check`), avtomatik yalnız "auto" uyğunluqla və qəpikbəqəpik (`priced`, sətir və yekun yoxlamaları), bağlı dövr (`propose`, `tx.open`, bağlı qaiməni dəyişməyə qoymayan trigger — `eqaime.link` də ondan keçmir), DVX sahələrinin trigger-ləri, tenant izolyasiyası (bütün oxumalar `company_id` ilə; xarici açarlar kompozit), idempotentlik (eyni fayl — 0 yeni; əmr açarı təkrarı nəticəni qaytarır), kabinet pəncərəsi (ünvan siyahısı, `will-navigate` / `will-redirect` / `setWindowOpenHandler`, IPC-də göndərənin yoxlanması, yaddaşda sessiya). Real Electron smoke (`MEYAR_SMOKE` + `MEYAR_SMOKE_DVX=1`) audit sonunda yenidən: fayl gəldi, `.exe` və kənar ünvanlar rədd, müvəqqəti fayl qalmadı, bağlandıqdan sonra 0 kuki.

**Davranış dəyişikliyi (2-ci qüsur):** növü çap etməyən "Mallar üzrə" faylı ilə avtomatik uçot artıq yoxdur — mal e-qaimələrinin avtomatik keçməsi üçün həmin dövrün "Qaimələr üzrə" faylı da yüklənməlidir (dizaynın §3.2-si növü məhz oradan götürür). Real "Mallar üzrə" faylı növ sütunu çap edirsə, bu öz-özünə aradan qalxır.

**Açıq suallar — qərarlaşdırılıb (16.10.2026, istifadəçi tövsiyələri təsdiqlədi; `docs/QERARLAR.md` 2026-10-16) və tətbiq olunub:** testlər `eqaime-book.test.ts` ("2026-10-16 §…"), Electron smoke (50 MB). Aşağıda auditin ilkin mətni:

1. **Düzəlişin ƏDV dövrü tutuşdurmada.** Düzəliş əsas qaiməni onun öz tarixində dəyişir (§5.2), DVX ↔ uçot isə düzəliş e-qaiməsini öz tarixinin ayında sayır, əsası çıxarır. Düzəliş başqa aya düşəndə hər iki ayda ƏDV fərqi və İş masası siqnalı həmişəlik qalır. Tövsiyə: mühasib dizaynın §11 sual 2-sinə cavab verənədək tutuşdurma düzəlişi əsasın ayında saysın (uçotdakı kimi); qərar "düzəliş öz tarixində" olarsa, qaimə tarixi də düzəlişin tarixi olmalıdır.
2. **Bağlı dövrdəki ziddiyyətlər İş masasında görünmür.** Siqnallar yalnız açıq dövr üçündür; bağlı dövrdə uçotda olan e-qaimə DVX-də ləğv edilsə, bunu yalnız qutunun "Ziddiyyət" tabı göstərir. Səbəb: orada qaimə ləğv olunmur və siqnal həmişəlik qalardı. Tövsiyə: İş masasında bağlı dövr ziddiyyətləri də göstərilsin, qutuda "əks yazılış açıq dövrdə aparıldı — qəbul et" qeydi ilə bağlansın (yeni əmr, audit izi ilə).
3. **İstiqaməti sübut olunmayan fayl.** Yalnız kontragentin VÖEN-i olan ("Qaimələr üzrə" — v1.17 sütunlarına görə belədir) və başlığında / adında "Gələnlər / Göndərilənlər" olmayan fayl istifadəçinin seçdiyi istiqamətlə qəbul olunur — heç nə sübut etmir (§5.4 başlıq yoxlamasını yalnız ziddiyyət olanda tələb edir). Tövsiyə: belə fayl rədd edilsin və ya ilkin baxışda istiqamətin açıq təsdiqi istənsin; real faylın başlığı ilə qərar verilsin.
4. **Satışda ƏDV müqayisəsi e-qaiməsiz qaimələri də sayır.** Fiziki şəxslərə (pərakəndə) satış qaimələri e-qaiməsizdir, amma ƏDV-ləri "uçotdakı" tərəfə düşür — satış qutusunda İş masasının ay ƏDV fərqi həmişəlik ola bilər. Tövsiyə: aylıq müqayisədə yalnız e-qaimə nömrəli qaimələr, nömrəsizlər ayrıca siyahıda (artıq var) qalsın.
5. **Kabinet endirməsinin həddi** (kiçik, möhkəmləndirmə): 50 MB yoxlaması ölçüsü əvvəlcədən bilinən faylda endirmədən əvvəl, bilinməyəndə endirmədən sonra (fayl diskə yazıldıqdan sonra) aparılır; e-taxes.gov.az-ın ixracı üçün risk görünmür. Tövsiyə: real girişdə ixracın ölçünü bildirib-bildirmədiyi yoxlansın; bildirmirsə, endirmə 50 MB-ı keçəndə dayandırılsın.

Testlər Windows-da: `npm run typecheck`, `npm test` 124, `npm run test:ui` 17, `npm run test:perf` keçir (500 000 yazılışlı baza: 5 000 e-qaimə + 1 200 avtomatik qaimə ~5,0 s, qutu ~0,24 s, İş masası e-qaimə siqnalları ilə ~0,63 s, aylıq tutuşdurma ~0,04 s). Real Electron (`MEYAR_SMOKE` + `MEYAR_SMOKE_DVX=1`): ok.

**Mərhələ 4 tamamlandı (4a–4d, müstəqil audit, açıq suallar 16.10-da qərarlaşdırılıb), versiya 0.6.0** (16.10.2026). Testlər Windows-da: `npm run typecheck`, `npm test` 128, `npm run test:ui` 17, `npm run test:perf` keçir (500 000 yazılışlı baza: 5 000 e-qaimə + 1 200 avtomatik qaimə ~5,1 s / 10 s; İş masası e-qaimə siqnalları ilə ~0,65 s / 1,5 s). Real Electron (Windows, `MEYAR_SMOKE` + `MEYAR_SMOKE_DVX=1`): təmiz baza və 0.5.0 kodu ilə yaradılmış v9 bazası (alış qaiməsi ilə) — v10-a yeniləndi, qaimə toxunulmaz, bütövlük ok; kabinet pəncərəsi: ixrac gəldi, .exe / 52 MB / kənar ünvanlar rədd, müvəqqəti fayl yox, bağlandıqdan sonra 0 kuki. Push edilməyib.

## 0.6.1 — avtomatik yenilənmə (16.10.2026)

- `electron-updater` 6.8.9 (`src/main/updater.ts`): quraşdırılmış proqram açılanda və hər 4 saatdan bir GitHub release-lərini yoxlayır (sınaq pre-release-ləri daxil), arxa planda endirir, bağlananda quraşdırır; status sətrində "Yeni versiya … hazırdır — İndi yenidən başlat". İnkişafda, smoke testində və `MEYAR_NO_UPDATE=1` ilə söndürülür. Qərar: `docs/QERARLAR.md` 2026-10-16.
- CI release-ə `latest.yml` və blockmap da yüklənir (yoxdursa release yaradılmır). Yük testinin rəqəmləri CI-də annotasiya kimi də çıxır.
- E-qaimə yük testinin həddi GitHub CI maşınında 20 s (orada yazma ~6 dəfə yavaşdır: 14,7 s; adi kompüterdə 2,3 s, hədd 10 s qalır) — istifadəçi qərarı 16.10.2026. SQLite: 64 MB keş, müvəqqəti məlumat yaddaşda (CI-də çıxarış idxalı 34 s → 3,7 s). 0.6.0-ın CI-si yük testində yıxıldı (lokal 100 000 yazılışla keçir; ehtimal: CI maşınında e-qaimə yükləməsi 10 s həddini keçib) — v0.6.0 release-i yaranmayıb. 0.6.1-in CI rəqəmləri annotasiyada görünəcək.
- **Yoxlanmayıb:** real yenilənmə (0.6.1 → növbəti versiya) — ilk dəfə növbəti release çıxanda.

## Real DVX faylları ilə yoxlama (17.10.2026)

İstifadəçinin iki real e-taxes.gov.az ixracı ("Göndərilənlər" 461 və "Gələnlər" 166 e-qaimə, "Qaimələr üzrə"; real məlumat repoya köçürülməyib) ilə oxuyucu və idxal yoxlanıldı; aşkar edilənlər düzəldi:

| Real formatda                                                                   | Əvvəl                                                                    | İndi                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Düzəliş "Tipi" sütununda ("Cari" / "Düzəliş"), növdə yox (satışda 40, alışda 2) | adi e-qaimə kimi — "avtomatik" uyğunluqla ikinci dəfə uçota düşə bilərdi | düzəliş: heç vaxt avtomatik deyil                |
| "Ləğvdən imtina / Təsdiqləndi"                                                  | "imtina" — rədd                                                          | təsdiqlənib (ləğv rədd edilib, qaimə qüvvədədir) |
| "Passiv edilmiş"                                                                | naməlum status                                                           | ləğv edilib                                      |
| "Düzəlişə qaytarıldı"                                                           | naməlum                                                                  | gözləyir                                         |
| VM 163 "dəqiqləşdirilməsi" (adında "Qaytarma istisna olmaqla")                  | qaytarma                                                                 | düzəliş                                          |
| Agent/komitent, emal, ixrac, aksizli yerdəyişmə, VM 177.5 növləri               | adi                                                                      | "digər" — əl ilə                                 |
| Başlıqda şirkətin VÖEN-i ("4600…/…")                                            | oxunmurdu                                                                | oxunur; başqa şirkətin faylı rədd olunur         |

Real fayllarda: 0 oxunmayan sətir, tarix "dd-mm-yyyy", məbləğlər 4 onluqla (ƏDV-nin qəpiyə yuvarlaqlaşdırılması Meyar-ın hesabı ilə eynidir), başlıqdan istiqamət ("Daxil olan / Göndərilən qaimələrin siyahısı") düzgün. Müvəqqəti bazada başdan-sona: 461 + 166 yükləndi (37 ms / 9 ms), təkrar yükləmə 0 yeni, "Passiv" kənara qoyuldu, gözləyənlər "DVX-də gözləyir"də. Real faylda düzəlişin əsas e-qaiməyə istinadı yoxdur — düzəlişlər mühasibə təklif olunur. Testlər uydurma məlumatla real quruluşda (`tests/domain/dvx-fixture.ts`). `npm test` 131.

**0.6.3 — kontragentlərin toplu yaradılması** (QERARLAR 2026-10-17): qutuda "Yeni kontragentləri yarat" — DVX adı və VÖEN ilə, istəyə görə "Əsas" müqavilə ilə. Real fayllarla müvəqqəti bazada: 114 + 58 kontragent və müqavilə, 434 + 128 e-qaimə "Naməlum"dan "Təklif"ə keçdi. Testlər: `npm test` 132, `npm run test:ui` 18.

**0.6.4 — bütün qaiməni toplu bir xidmətə bağlamaq; bazası olmayan e-qaimə "cəlb olunmayan"** (QERARLAR 2026-10-17 §2–§3). Real fayllarla müvəqqəti bazada (kontragentlər + bir xidmət, avtomatik rejim): satış 408 / 434, alış 126 / 128 e-qaimə avtomatik uçota alındı, xəta yoxdur; qalanlar — düzəlişlər (27) və yekunu ƏDV-siz + ƏDV-yə bərabər olmayan 1 alış (avanslı). Testlər: `npm test` 133, `npm run test:ui` 19.

**Hələ yoxlanmayıb:** "Mallar üzrə" real ixracı (sətirlər) — istifadəçidən gözlənilir.

## Açıq məsələlər

- **1C ilə hələ açıq qalanlar:** "Pul vəsaitlərinin hərəkəti maddəsi" subkontosu (bank mərhələsində), qalan hesabların adları, "Ödəniş növü" kitabçasının real 1C-dəki elementləri.
- **Quraşdırıcı:** v0.4.1 CI tərəfindən GitHub Releases-də imzalanmamış sınaq versiyası kimi dərc olunub (`Meyar-Setup-0.4.1.exe`). Köhnə baza (0.3.x, 0.4.0) quraşdırılanda avtomatik yenilənir; Windows-da istifadəçi yoxlamalıdır.
- **Audit:** mərhələ 1-in auditi öz yoxlamamdır; mərhələ 2 müstəqil yoxlayıcıdan keçib; mərhələ 3 — müstəqil audit (2 tur, 4 qüsur düzəldi, 5 açıq sual 15.10-da qərarlaşdırılıb və tətbiq olunub; yuxarıda); mərhələ 4 — müstəqil audit (2 tur, 12 qüsur düzəldi, 5 açıq sual 16.10-da qərarlaşdırılıb və tətbiq olunub; yuxarıda).
- **Windows:** quraşdırma və açılış istifadəçi tərəfindən təsdiqlənməlidir. İmzalanmamış sınaq versiyasıdır.

## Növbəti mərhələlər (istifadəçi təsdiqindən sonra)

2. ~~Qaimələr~~ — hazır (0.4.0, 0.4.1).
3. **Bank:** ~~3a~~, ~~3b~~, ~~3c~~, ~~3d~~, ~~müstəqil audit~~ — hazır (0.5.0). **Qalan:** real bank çıxarışı nümunələri ilə oxuyucunun yoxlanması.
4. **DVX e-qaimələri:** ~~4a~~, ~~4b~~, ~~4c~~, ~~4d~~, ~~müstəqil audit~~ — hazır (0.6.0). **Qalan:** real DVX faylları ilə oxuyucunun yoxlanması (anonimləşdirilmiş nümunələr istifadəçidən), real ASAN İmza / SİMA girişi ilə kabinetin yoxlanması (giriş domenləri, ixracın formatı — .xls olarsa oxuyucu açmır).
5. İdarə paneli, ay bağlanışı (6/7 → 801 → 341), kassa, valyuta yenidən qiymətləndirilməsi (243.02 / 543.02 avansları da daxil).

## Əmrlər

```sh
npm ci
npm run typecheck && npm test && npm run test:ui && npm run build
npm run test:perf                                   # MEYAR_PERF_POSTINGS=500000
MEYAR_DATA_DIR=/tmp/m MEYAR_SMOKE=/tmp/m/smoke.json electron .
WINEDEBUG=-all npx electron-builder --win nsis --x64 --publish never
```
