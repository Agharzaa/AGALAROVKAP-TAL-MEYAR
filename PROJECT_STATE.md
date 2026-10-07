# Meyar — layihənin vəziyyəti

Yenilənib: 07.10.2026 (gecə). Növbəti sessiya buradan davam etməlidir.

## Kontekst

- **Məqsəd:** Azərbaycan şirkətləri üçün 1C-dən güclü, avtomatlaşdırılmış masaüstü uçot sistemi. Uçot modeli 1C AZ-ın subkonto modelidir. Avtomatika heç vaxt təxmin etmir: əmin olmadığı yerdə mühasibə saxlayır.
- **Qərarlar:** istifadəçi ilə razılaşdırılmış bütün uçot qərarları `docs/QERARLAR.md`-dədir. Kod onlara tabedir.
- **Texnologiya:** Electron 44.5.1, React 19.3, TypeScript 7 strict, Vite 8, zod 4.6.5, SQLite (`node:sqlite`, WAL). Uçot ayrıca worker thread-lərdə işləyir.
- **Dizayn:** "Klassik ofis" — lent menyu, iş dövrü, pəncərə tabları, status sətri. İstifadəçi üç fərqli konsepsiyadan bunu seçib.
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

## Açıq məsələlər

- **1C ilə hələ açıq qalanlar:** "Pul vəsaitlərinin hərəkəti maddəsi" subkontosu (bank mərhələsində), qalan hesabların adları, "Ödəniş növü" kitabçasının real 1C-dəki elementləri.
- **Quraşdırıcı:** v0.3.1 CI tərəfindən GitHub Releases-də imzalanmamış sınaq versiyası kimi dərc olunub (`Meyar-Setup-0.3.1.exe`). 0.3.0 üzərinə quraşdırılanda baza avtomatik yenilənir; Windows-da istifadəçi yoxlamalıdır.
- **Audit:** mərhələ 1-in auditi öz yoxlamamdır, müstəqil yoxlayıcı deyil.
- **Windows:** quraşdırma və açılış istifadəçi tərəfindən təsdiqlənməlidir. İmzalanmamış sınaq versiyasıdır.

## Növbəti mərhələlər (istifadəçi təsdiqindən sonra)

2. ~~Qaimələr~~ — hazır (0.4.0).
3. Bank sənədi: sərbəst müxabir hesab, çoxsətirli; 223.01/224.04 cütü; çıxarış idxalı və öyrənən qaydalar.
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
