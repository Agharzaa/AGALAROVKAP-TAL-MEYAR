# Meyar

Azərbaycan şirkətləri üçün Windows mühasibat proqramı: qaimələr, ƏDV, bank ödənişləri və onların qaimələrə bölgüsü, anbar (orta maya dəyəri), jurnal və dövriyyə balansı. Bütün uçot yerli SQLite bazasında aparılır.

**Vəziyyət:** 0.1.0, imzalanmamış sınaq versiyası. İstehsala hazır deyil; real şirkətdə istifadədən əvvəl mühasib qəbulu və pilot tələb olunur.

## Nə hazırdır

- **Şirkət və kitabçalar:** şirkətlər, VÖEN üzrə kontragentlər, hesab planı və subhesablar, xərc maddələri, anbarlar, ölçü vahidləri, nomenklatura (qutu → ədəd çevirməsi).
- **Qaimələr:** alış və satış; xidmət və mal sətirləri ilə.
  - Sətirdə faktiki hesab seçilir (205/201/113, 721, 601).
  - ƏDV üçün 18% köməkçi düyməsi var.
  - Qaralama, uçota alma, əks yazılışla düzəliş və ləğv.
  - Dt/Kt və T-hesab görünüşü, saxlanmamış dəyişikliklər üçün ilkin baxış.
- **Bank:** 223 və 224.04 hesabları ilə daxil olan və çıxan ödənişlər.
  - Bir ödəniş bir neçə qaiməyə bölünür.
  - Bağlanmamış qalıq avans kimi qalır və sonradan bağlanır.
- **Anbar:** orta çəkili maya dəyəri, satışda 701 yazılışı. Mənfi qalıq və geri tarixli hərəkət bloklanır.
- **Hesabatlar:** dövriyyə balansı (subhesablar birləşir, 211/531 açıq saldo ilə), jurnal, hesab kartı, debitorlar və kreditorlar, anbar qalığı, dəyişiklik tarixçəsi.
- **Nəzarət:**
  - Bağlı dövr.
  - Təkrar sorğuya qarşı qoruma (idempotentlik).
  - Versiya ilə düzəliş: köhnə versiya son məlumatı əvəz etmir.
  - Şirkətlər arası qoruma, bazada da.
  - Açılışda avtomatik və əl ilə ehtiyat nüsxə.
- **Proqram:** tək Windows pəncərəsi, daxili modul və sənəd pəncərələri, Ctrl+K tez keçid.

Uçot qaydaları: [docs/ACCOUNTING.md](docs/ACCOUNTING.md). Quruluş: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Cari vəziyyət: [PROJECT_STATE.md](PROJECT_STATE.md).

## Hələ olmayanlar

İstifadəçi rolları, başlanğıc qalıqlar, Excel və bank çıxarışı idxalı, qaytarma və transfer, material sərfi və istismara vermə sənədləri, kassa. Həmçinin valyuta, amortizasiya, əməkhaqqı, vergi bəyannamələri, DVX və bank API-ləri, imzalı avtomatik yeniləmə, çoxistifadəçili server rejimi.

## İşə salmaq

Node.js 22.12+ (CI-da 24) və npm lazımdır.

```sh
npm ci
npm start            # Electron runtime-ı quraşdırır, yığır və proqramı açır
```

## Yoxlama

```sh
npm run typecheck
npm test             # domain + real SQLite inteqrasiya testləri
npm run test:ui      # React + real uçot nüvəsi (jsdom)
npm run build
npm run runtime:install
electron scripts/electron-smoke.cjs     # real Electron; Linux-da: xvfb-run -a electron --no-sandbox …
node scripts/benchmark.mjs 100000       # performans ölçməsi
```

`electron-smoke.cjs` bunları yoxlayır:

- yığılmış ekran, preload və IPC tək OS pəncərəsində işləyir;
- 1050, 1440 və 1920 piksel endə filtr sahəsi 7%, iş sahəsi qalan hissədir;
- səhifədə üfüqi sürüşmə və kəsilmiş yazı yoxdur;
- qaimə UI-dan saxlananda bazada düzgün Dt/Kt yaranır.

Ekran şəkilləri `screenshots/` qovluğuna yazılır.

## Windows quraşdırıcısı

```sh
npm run dist:win
```

GitHub Actions (`.github/workflows/windows.yml`) Windows-da bütün testləri və real Electron sınağını işlədir, sonra imzalanmamış NSIS quraşdırıcısını artifact kimi saxlayır. Rəqəmsal imza və yayımlanmış release kanalı hələ yoxdur.
