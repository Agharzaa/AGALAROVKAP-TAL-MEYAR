# Meyar — layihənin vəziyyəti

Yenilənib: 05.10.2026. Növbəti sessiya buradan davam etməlidir.

## Kontekst

- **Qərar:** istifadəçinin qərarı ilə köhnə MEYAR2 kodu əsas götürülmədi. Meyar sıfırdan yazılır; köhnə layihədən yalnız uçot qaydaları və qəbul ssenariləri spesifikasiya kimi qalıb.
- **Texnologiya:** Electron + React + TypeScript strict + SQLite (`node:sqlite`). Versiyalar `package-lock.json` ilə sabitlənib: Electron 44.5.1, React 19.3, TypeScript 7.0.2, Vite 8.3.2, zod 4.6.5.
- **Dizayn:** istifadəçi köhnə sarı/krem görünüşü bəyənmədi və strukturun da dəyişməsinə icazə verdi. Yeni dizayn sistemi "ledger sheet" adlanır:
  - soyuq kağız fonu, yeganə aksent mürəkkəb-mavidir;
  - sol modul paneli, yuxarıda açıq pəncərə tabları;
  - cəmlər mühasib qayda xətti (ikiqat xətt) ilə bağlanır.
- **Repo:** lokal git, `main` branch-i. GitHub-a push **edilməyib**, çünki istifadəçinin GitHub hesabı Claude-a bağlı deyil (`add_repo`: permission_denied). Yeni repo adı və bağlantı istifadəçidən gözlənilir.
- **MEYAR2-də görülən iş:** ödəniş bölgüsü `feature/bank-settlement` branch-indədir, lokal klonda (`/home/claude/MEYAR2`). Push edilməyib, yeni layihədə istifadə olunmur.

## Hazır (testlə sübut olunub)

| Sahə                                                                                                                                                                          | Sübut                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Domain: pul/miqdar, hesab planı, müxabirləşmə, orta maya                                                                                                                      | `tests/domain` — 10 test                                                                                            |
| SQLite ledger: idempotentlik, versiya, əks yazılış, bağlı dövr, tenant FK, bölgü, anbar xronologiyası, hesabatlar, backup                                                     | `tests/integration` — 21 test                                                                                       |
| UI (jsdom + real Ledger): ilk şirkət, qaimə, 18%, ilkin baxış, düzəliş, bağlama qoruması, server xətası, bank bölgüsü, ikiqat klik, avansın bağlanması, şirkət keçidi, Ctrl+K | `tests/ui` — 6 test                                                                                                 |
| Real Electron (Linux, Xvfb): tək pəncərə; 1050/1440/1920 layout; filtr 7%; kəsilmiş yazı yoxdur; qaimə IPC ilə saxlanır                                                       | `scripts/electron-smoke.cjs` — keçdi                                                                                |
| Performans (Linux konteyner, 100 000 qaimə)                                                                                                                                   | il üzrə satış siyahısı (50 000 sətir) ~0,9 s; ay ~0,07 s; DBC ~1,0 s; kontragent qalıqları ~0,5 s; iş masası ~0,8 s |

Spesifikasiyanın qəbul ssenariləri: 1, 2, 3, 4 (saxlama), 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19 testlə örtülüb.

## Hələ yoxdur / qismən

- **Windows-da yoxlama:** CI workflow yazılıb, lakin Windows-da hələ işə düşməyib (push yoxdur). `.exe` quraşdırıcısı yığılmayıb, birbaşa yükləmə linki yoxdur.
- **Qəbul 5 (atomik idxal) və 13 (qaytarma):** sənəd növü hələ yoxdur.
- **Anbar sənədləri:** transfer, material sərfi (721/201), istismara vermə (111/113), inventarizasiya.
- **Mərhələ B:** rollar və istifadəçilər, başlanğıc qalıqlar, bank çıxarışı idxalı və uyğunlaşdırma, hesab çıxarışı və üzləşmə aktı, proqram daxilində bərpa, Excel/PDF çıxışı və çap.
- **Mərhələ C–F:** imza, yeniləmə, server və PostgreSQL, valyuta, amortizasiya, əməkhaqqı, vergi, DVX.

## Açıq qərarlar (istifadəçi və mühasib üçün)

1. **GitHub:** yeni repo adı (məsələn `Agharzaa/meyar`) və GitHub bağlantısı.
2. **Avanslar:** 211/531-də qalsın, yoxsa dövr sonunda ayrıca hesablara yenidən təsnif olunsun? Hesab kodları mühasiblə təsdiqlənməlidir.
3. **Hesab adları və subhesab icazələri:** hansı hesablar ekspert qəbulundan keçib?

## Növbəti dəqiq addım

1. GitHub bağlanan kimi: repo yaratmaq, `main`-i push etmək, Windows CI nəticəsini və imzalanmamış `.exe` artifact-ı yoxlamaq.
2. Anbar sənədləri: qaytarma (ilkin sənədə bağlı, maya və ƏDV bərpası), transfer, material sərfi, istismara vermə. Testlər: qəbul 13 və xronologiya.
3. Excel qaimə idxalı: sütun xəritəsi, ilkin baxış, atomik tətbiq (qəbul 5) və bank çıxarışı idxalı (CSV/XLSX), avtomatik uyğunlaşdırma təklifləri.

## Əmrlər

```sh
npm ci && npm run runtime:install
npm run typecheck && npm test && npm run test:ui && npm run build
xvfb-run -a ./node_modules/electron/dist/electron --no-sandbox scripts/electron-smoke.cjs   # Linux
```
