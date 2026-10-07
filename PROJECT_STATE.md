# Meyar — layihənin vəziyyəti

Yenilənib: 07.10.2026. Növbəti sessiya buradan davam etməlidir.

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

## Açıq məsələlər

- **Subkonto cədvəli:** 221, 244, 301, 343, 521, 522, 533, 701, 751 təklif olunduğu kimi qurulub — istifadəçi ilə təsdiqlənməlidir.
- **Real 1C bazası:** istifadəçinin iş kompüterindədir. Yalnız oxumaq, heç nə dəyişməmək, real məlumatı layihəyə və testlərə köçürməmək şərti ilə baxılacaq; hesab adları və subkontolar dəqiqləşdiriləcək.
- **Audit:** mərhələ 1-in auditi öz yoxlamamdır, müstəqil yoxlayıcı deyil.
- **Windows:** quraşdırma və açılış istifadəçi tərəfindən təsdiqlənməlidir. İmzalanmamış sınaq versiyasıdır.

## Növbəti mərhələlər (istifadəçi təsdiqindən sonra)

2. Qaimələr: sətir üzrə ƏDV statusu, 601/604.1/521; alışda "əvəzləşdirilir" və ya "maya dəyərinə"; 543/243 avanslarının avtomatik əvəzləşdirilməsi.
3. Bank sənədi: sərbəst müxabir hesab, çoxsətirli; 223.01/224.04 cütü; çıxarış idxalı və öyrənən qaydalar.
4. DVX e-qaimələri: Excel idxalı və kabinetə PIN ilə giriş (köhnə meyar-erp-desktop v1.12–v1.14 kodundan). PIN açıq mətn kimi saxlanılmır.
5. İdarə paneli, ay bağlanışı (6/7 → 801 → 341), kassa, valyuta yenidən qiymətləndirilməsi.

## Əmrlər

```sh
npm ci
npm run typecheck && npm test && npm run test:ui && npm run build
npm run test:perf                                   # MEYAR_PERF_POSTINGS=500000
MEYAR_DATA_DIR=/tmp/m MEYAR_SMOKE=/tmp/m/smoke.json electron .
WINEDEBUG=-all npx electron-builder --win nsis --x64 --publish never
```
