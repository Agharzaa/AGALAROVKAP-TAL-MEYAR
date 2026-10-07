# Uçot modeli — istifadəçi ilə razılaşdırılmış qərarlar

Kod bu sənədə tabe olur. Hər yeni qərar buraya yazılır.

## 2026-10-07

### Bank hesabları
- 223.01 — manatla bank hesabları; 223.02 — bütün xarici valyutalarla (USD, EUR…) bank hesabları; 224.04 — ƏDV depozit hesabı.
- Konkret bank hesabı ayrıca kitabçadır (subkonto "Bank hesabı"): bank (Kontragentlər kitabçasından seçilir), IBAN, valyuta, bağlı olduğu hesab (223.01 / 223.02 / 224.04).
- Şirkətin bir neçə bank hesabı ola bilər; hamısı öz hesabında subkonto üzrə ayrıca görünür. Çıxarış IBAN-a görə hesabı tapır.
- Valyuta hesablarında hər yazılışda valyuta məbləği və AMB məzənnəsi ilə manat məbləği; məzənnə fərqi.

### Müqavilələr
- Kontragentlərlə hesablaşma və kreditlər müqavilə üzrə aparılır. Bir kontragentlə bir neçə müqavilə (müxtəlif sahələr), bir neçə kredit ola bilər.
- 211 / 531: Kontragent → Müqavilə → Hesablaşma sənədi.
- 501 (qısamüddətli kreditlər; 511 SƏHV idi): Kontragent (bank) → Müqavilə.

### Bank sənədi
- Müxabirləşən hesab bütün hesab planından sərbəst seçilir (211, 531, 501, 343, 721…); "əməliyyat növü" yalnız şablondur, məcburi deyil.
- Subkonto sahələri seçilən hesabın analitikasına görə açılır.
- Bir ödəniş bir neçə sətrə bölünə bilər (məs. kredit: əsas borc 501 + faiz).
- Sistem mühasibin keçirmə qərarlarından öyrənir (VÖEN/təyinat → hesab, subkonto).

### Satış və ƏDV (1C sxemi)
- Satış: Dt 211 / Kt 601 — ƏDV daxil ümumi məbləğ; Dt 604.1 / Kt 521 (subkonto "ƏDV") — ƏDV.
- 601 subkontoları: (1) Gəlir növü — məhsul satışı, xidmət satışı, … (genişlənən kitabça); (2) ƏDV dərəcəsi — 18%, 0%, ƏDV-dən azad, ƏDV-yə cəlb olunmayan.
- 604.1 subkontosu: yalnız ƏDV dərəcəsi (hələlik kifayətdir).
- Gəlir növü və ƏDV dərəcəsi qaimənin hər sətrində seçilir; bir qaimədə qarışıq ola bilər, uçotda qarışmır.
- 0% / azad / cəlb olunmayan satışda 604.1 yazılışı yoxdur, subkonto yenə qeyd olunur.
- Ay sonu 601 və 604.1 → 801.

### Avanslar (211/531-də QALMIR)
- Alınmış avanslar: 543.01 (AZN), 543.02 (valyuta). Verilmiş avanslar: 243.01 (AZN), 243.02 (valyuta). Subkonto: Kontragent → Müqavilə.
- Qaiməsi olmayan daxilolma: Dt 223 / Kt 543. Qismən borc + artıq: Kt 211 (borc qədər) + Kt 543 (qalan).
- Qaimə kəsiləndə avans avtomatik əvəzləşir: Dt 543 / Kt 211 (eyni kontragent + müqavilə).
- Malsatana avans: Dt 243 / Kt 223; alış qaiməsi gələndə Dt 531 / Kt 243.
- Valyuta avansları ödəniş günü məzənnəsi ilə qalır, yenidən qiymətləndirilmir (qeyri-monetar).
- Nəzarət: eyni kontragent + müqavilədə həm 211 debet, həm 543 kredit qalığı varsa — əvəzləşdirilməmiş avans siqnalı.

### ƏDV-li ödəniş iki hesaba gəlir
- ƏDV-li məbləğin əsas hissəsi 223.01-ə, ƏDV hissəsi (18/118) 224.04-ə gəlir — avans da daxil.
- Misal: qaimə 15 000 (ƏDV daxil), ödəniş 18 000 →
  223.01 = 15 254.24 → Kt 211 12 711.86 + Kt 543.01 2 542.38;
  224.04 = 2 745.76 → Kt 211 2 288.14 + Kt 543.01 457.62.
- Hər iki hissə eyni qaiməyə / müqaviləyə bağlanır; sistem 224.04 hissəsinin 18/118-ə uyğunluğunu yoxlayır, fərq varsa xəbərdar edir.

- Avansdan ƏDV öhdəliyi ödəniş anında YARANMIR; yalnız e-qaimə kəsiləndə (Dt 604.1 / Kt 521). Avansın 224.04 hissəsi qaimə kəsilənə qədər 543.01-də qalır.

### Alış (satışın güzgüsü)
- Hesab sətrə görə: xidmət → 721 (xərc maddəsi); material → 201; mal → 205; əsas vəsait → 113 (istismara verəndə 111).
- Yazılış: Dt 721/201/205/113 (ƏDV-siz məbləğ) + Dt 241 (ƏDV) / Kt 531 (cəmi).
- ƏDV statusu (18%, 0%, azad, cəlb olunmayan) qaimənin hər sətrində seçilir.
- Ödəniş də iki hissə: əsas 223.01-dən, ƏDV 224.04-dən malsatanın depozitinə. Avans → 243.01, qaimə gələndə Dt 531 / Kt 243.01.
- 241-ə ƏDV yalnız e-qaimə alınanda yazılır (avans anında yox).
- TƏSDİQLƏNDİ: 205, 201, 111, 113 — subkonto yalnız Nomenklatura (məhsulun adı) + miqdar. ƏDV statusu bu hesablarda yoxdur; 241 subkontosu + alış reyestrindədir. Anbar subkontosu göstərilmir (lazım olsa sonra).

### Alış ƏDV-sinin taleyi (e-qaimədə seçilir)
- ƏDV statusu alış e-qaiməsində saxlanılır; əlavə seçim: "ƏDV əvəzləşdirilir" və ya "ƏDV maya dəyərinə daxil edilir".
- Əvəzləşdirilir: Dt 205/201/113/721 (ƏDV-siz) + Dt 241 (ƏDV) / Kt 531.
- Maya dəyərinə: Dt 205/201/113/721 (ƏDV daxil cəmi) / Kt 531; 241 yazılmır; vahidin maya dəyəri ƏDV daxil hesablanır.
- Seçim qaimə üzrə edilir, lazım olsa sətirdə dəyişdirilir. Şirkətin standart seçimi parametrlərdə.

### Dövriyyə balansı (hesablar və subkontolar üzrə)
- İstənilən dövr (məs. 01.09.2026–30.09.2026). Sütunlar: əvvələ qalıq Dt/Kt, dövriyyə Dt/Kt, sona qalıq Dt/Kt.
- Hesab → subkonto səviyyələri üzrə açılır (531 → kontragent → müqavilə → qaimə; 223.01 → bank hesabı; 205 → nomenklatura + miqdar).
- 211, 531, 243, 543 açıq saldo ilə (debitor və kreditor bir-birini silmir).
- Süzgəclər: yalnız dövriyyəsi olanlar; yalnız dövr ərzində yaranan (əvvələ qalığı 0, sona qalığı var); hesab / kontragent / müqavilə üzrə.
- Hər rəqəmdən hesab kartına və sənədin özünə keçid. Excel-ə çıxış və çap.

### Avtomatik idxalın əsas prinsipi (DVX e-qaimələri və bank)
- Sistem heç vaxt təxmin edib uçota salmır. Hər idxal sətri üç vəziyyətdən birindədir:
  1. Avtomatik uçota alındı — hər şey mühasibin təsdiqlədiyi qaydalarla birmənalı müəyyəndir və yoxlamalardan keçib;
  2. Təklif — sistem bilir, amma bir şey əl ilə təsdiq tələb edir (yeni kontragent, bir neçə müqavilə, yeni məhsul adı…);
  3. Naməlum — mühasib özü doldurur.
- Hər avtomatik yazılışda hansı qaydanın onu yaratdığı görünür; geri qaytarmaq olar; hamısı audit jurnalındadır.
- Mühasibin hər əl qərarı növbəti dəfə üçün qaydaya çevrilir (VÖEN + məhsul adı → nomenklatura + hesab; VÖEN + təyinat → hesab + subkonto). Qaydalar görünür və redaktə olunur.
- E-qaimə: seriya/nömrə üzrə dublikat yoxdur; DVX-də ləğv/düzəliş əks yazılışla əks olunur; cəmi = sətirlərin cəmi, ƏDV = 18% yoxlanılır; bağlı dövrə yazılmır.

- E-qaimə mənbələri (üçü də eyni "Gələn e-qaimələr" qutusuna düşür, eyni qaydalar və yoxlamalar): (1) e-taxes-dən endirilən Excel; (2) DVX kabinetinə PIN ilə birbaşa qoşulma; (3) əl ilə daxil etmə.
- PIN/parol proqramda açıq saxlanmır (Windows-un qorunan anbarı və ya hər dəfə istifadəçi özü daxil olur).
- DVX kabinetinə PIN ilə işləyən qoşulma köhnə meyar-erp-desktop versiyalarından birində var idi (bəziləri silinib; Masaüstündə v1.12, v1.13.1, v1.14.0, v1.14.1 qalıb, həmçinin GitHub-da meyar-erp-desktop). Qoşulma məntiqi oradan götürüləcək.
- Format nümunəsi: Masaüstündəki "Elektron qaimə-fakturalar_Gələnlər_Qaimələr üzrə_2026_05_27.xlsx".

### Böyük həcm və etibarlılıq (məcburi tələb)
- Qalıq/dövriyyə registrləri: hesab + subkonto + ay üzrə yekunlar yazılışla eyni tranzaksiyada yenilənir; DBC jurnalı skan etmir. Registr jurnalla mütəmadi tutuşdurulur.
- Ağır iş (idxal, hesabat) interfeysi dondurmur: baza ayrıca işçi axınında; irəliləyiş göstəricisi; ləğv etmək mümkündür; böyük cədvəllər virtual (yalnız görünən sətirlər çəkilir).
- İdxal hissə-hissə: bir pis sətir bütün faylı dayandırmır, "naməlum"a düşür; hər sənəd atomikdir.
- Xəta heç vaxt proqramı çökdürmür: hər xəta aydın mesajla; WAL, tranzaksiyalar, avtomatik gündəlik ehtiyat nüsxə, açılışda bütövlük yoxlaması (jurnal balansı, registr = jurnal).
- Yük testləri CI-da: sintetik şirkət (5 il, ≥1 000 000 jurnal sətri, 200 000+ qaimə). Həddlər: DBC + açılış < 1 san; sənəd açılışı < 200 ms; həddi aşan dəyişiklik qəbul edilmir.
- Model PostgreSQL-ə (çox istifadəçi/server) keçidə hazır saxlanılır.
- Yeni model təmiz bazadan başlayır (indiki baza yalnız sınaq məlumatıdır).

### İş tərzi: dörd rol, hər mərhələ dörd yoxlamadan keçir
1. Baş mühasib — yazılış qaydaları, subkontolar, ƏDV; mərhələ bu sənəddəki misalları qəpikbəqəpik çıxarmalıdır.
2. Auditor — hər rəqəmin mənbəyə qədər izi, silinməzlik, nəzarət yoxlamaları, uyğunsuzluq siqnalları. Audit baxışı işi yazmayan ayrıca yoxlayıcı ilə aparılır.
3. İT developer — arxitektura, testlər, yük testləri və sürət həddləri, xəta dayanıqlığı.
4. UI/UX — mühasibin gündəlik işi: klaviatura ilə sürətli daxiletmə, sıx və oxunaqlı cədvəllər, aydın Azərbaycan terminologiyası, hər ekranda "bu rəqəm haradan gəlir" keçidi; ekran şəkilləri ilə yoxlanılır.

### Növbəti iş günü (2026-10-08)
1. İş kompüterindəki REAL 1C bazasına baxış — yalnız oxumaq, 1C-də heç nə dəyişdirilmir, real məlumat layihəyə/testlərə köçürülmür.
   Yoxlanılacaq: real hesab planı və subhesablar, hesabların subkonto ayarları, 601/604.1/521, 543/243, 223.01/223.02/224.04 praktikada necə işlənir, real DBC, bank və e-qaimə axını.
2. Bu sənəd real bazaya görə dəqiqləşdirilir (fərqlər istifadəçi ilə təsdiqlənir).
3. Sonra kod: mərhələ 1 (hesab planı, subkontolar, kitabçalar, DBC).

### Açıq suallar
- Alışda ƏDV-li / ƏDV-siz / azad ayrımı hansı hesabda subkonto kimi aparılır?
- Qaralama subkonto cədvəlinin qalan hissəsi (201/204/205, 221, 241, 244, 301, 343, 521, 522, 533, 701, 721, 751) təsdiqlənməlidir.
