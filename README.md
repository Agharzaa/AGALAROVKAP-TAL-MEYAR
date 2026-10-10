# Meyar

Azərbaycan şirkətləri üçün Windows mühasibat proqramı: qaimələr, ƏDV, bank ödənişləri və onların qaimələrə bölgüsü, anbar (orta maya dəyəri), jurnal və dövriyyə balansı. Bütün uçot yerli SQLite bazasında aparılır.

**Vəziyyət:** 0.3.0 — uçot təməli (subkonto modeli), imzalanmamış sınaq versiyası. Real şirkətdə istifadədən əvvəl mühasib qəbulu və pilot tələb olunur.

## Nə hazırdır (0.3.0)

- **Hesab planı və subkonto:**
  - Razılaşdırılmış hesab planı, hər hesabda 3-ə qədər subkonto (kontragent, müqavilə, hesablaşma sənədi, bank hesabı, nomenklatura, gəlir növü, ƏDV dərəcəsi, vergi növü, fond, işçi, xərc maddəsi, kassa).
  - Miqdar və valyuta uçotu.
  - Yeni hesab və subhesab açmaq olar.
- **Kitabçalar:** kontragentlər və müqavilələr, bank hesabları (IBAN, valyuta, 223.01/223.02/224.04), nomenklatura, işçilər, siyahılar.
- **Əl ilə əməliyyat:**
  - Dt/Kt yazılışları subkontoları ilə; başlanğıc qalıqlar da bununla daxil edilir.
  - Düzəliş və ləğv qırmızı storno ilə aparılır.
  - Klaviatura ilə doldurulur: Ctrl+N yeni sənəd, Ctrl+S saxla.
- **Hesabatlar:**
  - Hesablar və subkontolar üzrə açılan dövriyyə balansı: açıq saldo, süzgəclər, Excel-ə çıxış.
  - Hesab kartı, dəyişiklik tarixçəsi.
- **Nəzarət:**
  - Jurnal və audit dəyişdirilmir; bağlı dövr bazada qorunur.
  - Proqram açılanda bütövlük yoxlaması aparılır.
  - Əvəzləşdirilməmiş avans, mənfi anbar və mənfi pul qalığı üzrə xəbərdarlıq verilir.
  - Avtomatik ehtiyat nüsxə alınır.
- **Sürət:** uçot ayrıca axında işləyir; 500 000 yazılışda dövriyyə balansı 1 saniyədən tez açılır.
- **İnterfeys:** yaşıl Meyar ERP görünüşü — yuxarıda modullar paneli, şirkət, iş dövrü, sürətli axtarış (Ctrl+K), "Yeni sənəd"; 1C kimi pəncərələr (aşağıda pəncərələr paneli; Ctrl+Tab, Ctrl+F4).

Uçot qaydaları: [docs/ACCOUNTING.md](docs/ACCOUNTING.md). Razılaşdırılmış qərarlar: [docs/QERARLAR.md](docs/QERARLAR.md). Cari vəziyyət: [PROJECT_STATE.md](PROJECT_STATE.md).

## Növbəti mərhələlər

2. Satış və alış qaimələri (ƏDV statusu sətirdə, 601/604.1/521, alışda əvəzləşdirmə və ya maya dəyəri, avansların avtomatik əvəzləşdirilməsi).
3. Bank sənədi (sərbəst müxabir hesab, çoxsətirli; 223.01/224.04 cütü; çıxarışın idxalı və öyrənən qaydalar).
4. DVX e-qaimələri (Excel və kabinet).
5. Kassa, ay bağlanışı, valyuta yenidən qiymətləndirilməsi.

## İşə salmaq

Node.js 22.12+ (CI-da 24) və npm lazımdır.

```sh
npm ci
npm start            # Electron runtime-ı quraşdırır, yığır və proqramı açır
```

## Yoxlama

```sh
npm run typecheck
npm test             # domain + real SQLite inteqrasiya testləri (sentyabr misalı qəpikbəqəpik)
npm run test:ui      # React + real uçot nüvəsi (jsdom)
npm run test:perf    # yük testi: MEYAR_PERF_POSTINGS=500000 (standart), hesabat həddləri
npm run build
# Real Electron (worker, preload, IPC): nəticə JSON və ekran şəkli
MEYAR_DATA_DIR=/tmp/m MEYAR_SMOKE=/tmp/m/smoke.json electron .
```
