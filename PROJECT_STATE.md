# Meyar — layihənin vəziyyəti

Yenilənib: 06.10.2026. Növbəti sessiya buradan davam etməlidir.

## Kontekst

- **Qərar:** istifadəçinin qərarı ilə köhnə MEYAR2 kodu əsas götürülmədi. Meyar sıfırdan yazılır; köhnə layihədən yalnız uçot qaydaları və qəbul ssenariləri spesifikasiya kimi qalıb.
- **Texnologiya:** Electron + React + TypeScript strict + SQLite (`node:sqlite`). Versiyalar `package-lock.json` ilə sabitlənib: Electron 44.5.1, React 19.3, TypeScript 7.0.2, Vite 8.3.2, zod 4.6.5.
- **Dizayn:** istifadəçi köhnə sarı/krem görünüşü bəyənmədi və strukturun da dəyişməsinə icazə verdi. Yeni dizayn sistemi "ledger sheet" adlanır:
  - soyuq kağız fonu, yeganə aksent mürəkkəb-mavidir;
  - sol modul paneli, yuxarıda açıq pəncərə tabları;
  - cəmlər mühasib qayda xətti (ikiqat xətt) ilə bağlanır.
- **Repo:** https://github.com/Agharzaa/AGALAROVKAP-TAL-MEYAR, `main` branch-i. `main`-ə push olunanda Windows CI quraşdırıcını yığır, Windows-da səssiz quraşdırıb işə salır və hər paket versiyası üçün bir dəfə GitHub Release (prerelease) kimi dərc edir. Bu sessiyadan Release API-si birbaşa bağlıdır, ona görə release yalnız CI vasitəsilə yaranır.
- **MEYAR2-də görülən iş:** ödəniş bölgüsü `feature/bank-settlement` branch-indədir, lokal klonda (`/home/claude/MEYAR2`). Push edilməyib, yeni layihədə istifadə olunmur.

## Hazır (testlə sübut olunub)

| Sahə                                                                                                                                                                                                                                                                              | Sübut                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Domain: pul/miqdar, hesab planı, müxabirləşmə, orta maya                                                                                                                                                                                                                          | `tests/domain` — 11 test                                                                                            |
| SQLite ledger: idempotentlik, versiya, əks yazılış, bağlı dövr, tenant FK, bölgü, anbar xronologiyası, hesabatlar, backup                                                                                                                                                         | `tests/integration` — 25 test                                                                                       |
| UI (jsdom + real Ledger): ilk şirkət, qaimə, 18%, ilkin baxış, düzəliş, bağlama qoruması, server xətası, bank bölgüsü, ikiqat klik, avansın bağlanması, şirkət keçidi, Ctrl+K                                                                                                     | `tests/ui` — 8 test                                                                                                 |
| Bank (v0.2.0): əməliyyat növləri (hesablaşma, qaytarma, kapital, kredit, vergi, DSMF, əmək haqqı, köçürmə 222, komissiya, digər), baza miqrasiyası v1→v2, çıxarış idxalı (CSV/XLSX, dublikatsız), VÖEN/təyinat üzrə avtomatik tanıma və keçirmə, avansların FIFO əvəzləşdirilməsi | `tests/integration/bank.test.ts`, `tests/ui`                                                                        |
| Real Electron (Linux, Xvfb): tək pəncərə; 1050/1440/1920 layout; filtr 7%; kəsilmiş yazı yoxdur; qaimə IPC ilə saxlanır                                                                                                                                                           | `scripts/electron-smoke.cjs` — keçdi                                                                                |
| Performans (Linux konteyner, 100 000 qaimə)                                                                                                                                                                                                                                       | il üzrə satış siyahısı (50 000 sətir) ~0,9 s; ay ~0,07 s; DBC ~1,0 s; kontragent qalıqları ~0,5 s; iş masası ~0,8 s |

Spesifikasiyanın qəbul ssenariləri: 1, 2, 3, 4 (saxlama), 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19 testlə örtülüb.

## Hələ yoxdur / qismən

- **Windows-da yoxlama:** ilk CI işlərindən ikisini GitHub runner götürmədi ("not acquired"). Biri işlədi və `npm test`-də düşdü: qəbul 16 testi açıq SQLite faylını bağlamadan qovluğu silirdi (Windows-da EPERM). Test düzəldildi (əvvəl bağlanır, sonra silinir). Windows Node-u (Meyar.exe, ELECTRON_RUN_AS_NODE, wine) ilə: 31/31 node testi və 6/6 UI testi keçdi. Real Windows CI nəticəsi hələ gözlənilir.
- **Quraşdırıcı:** `Meyar-Setup-0.2.0.exe` (104 MB, NSIS, x64) Linux-da electron-builder + wine ilə yığıldı. Paketin öz Node-u (Meyar.exe, ELECTRON_RUN_AS_NODE, wine) ilə 36/36 node testi keçdi. Windows-da quraşdırma və açılış hələ istifadəçi tərəfindən təsdiqlənməyib. İmzalanmamış sınaq versiyasıdır. Birbaşa yükləmə (`download` branch-i, SHA-256 `af5d9386…dfc5`): https://github.com/Agharzaa/AGALAROVKAP-TAL-MEYAR/raw/download/Meyar-Setup-0.2.0.exe
- **Qəbul 5 (atomik idxal) və 13 (qaytarma):** sənəd növü hələ yoxdur.
- **Anbar sənədləri:** transfer, material sərfi (721/201), istismara vermə (111/113), inventarizasiya.
- **Mərhələ B:** rollar və istifadəçilər, başlanğıc qalıqlar, bank qalığının çıxarışla üzləşdirilməsi, hesab çıxarışı və üzləşmə aktı, proqram daxilində bərpa, Excel/PDF çıxışı və çap.
- **Mərhələ C–F:** imza, yeniləmə, server və PostgreSQL, valyuta, amortizasiya, əməkhaqqı, vergi, DVX.

## Açıq qərarlar (istifadəçi və mühasib üçün)

1. **Avanslar:** 211/531-də qalsın, yoxsa dövr sonunda ayrıca hesablara yenidən təsnif olunsun? Hesab kodları mühasiblə təsdiqlənməlidir.
2. **Hesab adları və subhesab icazələri:** hansı hesablar ekspert qəbulundan keçib?

## Növbəti dəqiq addım

1. Windows CI nəticəsini yoxlamaq. Keçərsə, `v0.1.0` release linki həqiqətən yaranıbsa istifadəçiyə vermək. Keçməzsə, Windows xətasını düzəltmək.
2. Anbar sənədləri: qaytarma (ilkin sənədə bağlı, maya və ƏDV bərpası), transfer, material sərfi, istismara vermə. Testlər: qəbul 13 və xronologiya.
3. Excel qaimə idxalı: sütun xəritəsi, ilkin baxış, atomik tətbiq (qəbul 5).
4. Kassa (221: MKO/MMO, 222 vasitəsilə bankla köçürmə) və ay bağlanışı (6/7/9 → 801 → 341) — köhnə v1.16 məntiqi bu arxitekturaya köçürülməlidir.
5. Analitik DBC: hesab → kontragent → sənəd üzrə açılış (hesab kartı artıq var).

## Əmrlər

```sh
npm ci && npm run runtime:install
npm run typecheck && npm test && npm run test:ui && npm run build
xvfb-run -a ./node_modules/electron/dist/electron --no-sandbox scripts/electron-smoke.cjs   # Linux
```
