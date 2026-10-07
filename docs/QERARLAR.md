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

- Satış: Dt 211.01 / Kt 601 — ƏDV daxil ümumi məbləğ; Dt 604.1 / Kt 521.01 — ƏDV (e-qaimə kəsiləndə).
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
- ~~Valyuta avansları ödəniş günü məzənnəsi ilə qalır, yenidən qiymətləndirilmir (qeyri-monetar).~~ Dəyişdi (2026-10-07 axşam): 1C kimi ay sonu yenidən qiymətləndirilir.
- Nəzarət: eyni kontragent + müqavilədə həm 211 debet, həm 543 kredit qalığı varsa — əvəzləşdirilməmiş avans siqnalı.

### ƏDV-li ödəniş iki hesaba gəlir

- ƏDV-li məbləğin əsas hissəsi 223.01-ə, ƏDV hissəsi (18/118) 224.04-ə gəlir — avans da daxil.
- Misal: qaimə 15 000 (ƏDV daxil), ödəniş 18 000 →
  223.01 = 15 254.24 → Kt 211.01 12 711.86 + Kt 543.01 2 542.38;
  224.04 = 2 745.76 → Kt 211.01 2 288.14 + Kt 543.01 457.62.
- Hər iki hissə eyni qaiməyə / müqaviləyə bağlanır; sistem 224.04 hissəsinin 18/118-ə uyğunluğunu yoxlayır, fərq varsa xəbərdar edir.

- Avansdan ƏDV öhdəliyi ödəniş anında YARANMIR; yalnız e-qaimə kəsiləndə (Dt 604.1 / Kt 521.01). Avansın 224.04 hissəsi qaimə kəsilənə qədər 543.01-də qalır.

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
- ~~Qaralama subkonto cədvəlinin qalan hissəsi təsdiqlənməlidir~~ — 2026-10-07 (axşam) bölməsində həll olundu; 221, 241, 244, 301 hələ açıqdır (aşağıya bax).

## 2026-10-07 (axşam) — real 1C bazası ilə tutuşdurma

Real 1C bazasına (iş kompüteri, "1C Mühasibat AzStandart 2.0 V1.3", 320 hesab) yalnız oxumaq üçün baxıldı. Real məlumat (adlar, VÖEN, məbləğlər) layihəyə köçürülmədi; yalnız hesab planı, subkontolar və "sənəd növü → Dt/Kt" quruluşu öyrənildi.

### 1C-də gördüklərimiz (istinad üçün)

- 211, 531, 243, 543 qrupdur: .01 manatla, .02 valyuta ilə. Hər birində Kontragent → Müqavilə → Hesablaşma sənədi.
- 521 qrupdur, hər vergi ayrıca subhesabdır; 522 fondlara görə subhesablara bölünür (işçi və işəgötürən payı ayrı).
- 221, 223, 224 subhesablarında ikinci subkonto "Pul vəsaitlərinin hərəkəti maddəsi"dir (yalnız dövriyyə üzrə). Meyar-da hələ yoxdur.
- 241.01: Kontragent → Alınmış hesab-faktura (ƏDV dərəcəsi yoxdur). Ay ərzində "Satınalma kitabı" sənədi ilə Dt 521.01 / Kt 241.01.
- 601: Nomenklatura qrupu → Gəlir maddəsi; ƏDV dərəcəsi yalnız 604.1-dədir. Meyar-da 601 qərarı (Gəlir növü → ƏDV dərəcəsi) qüvvədə qalır.
- Satışın ƏDV-si 1C-də Dt 604.1 / Kt 422, ödəniş gələndə Dt 422 / Kt 521.01 yazılır. Meyar-da belə OLMAYACAQ (aşağıya bax).
- Valyuta alışı: Dt 222.02 / Kt 223.01 → Dt 223.02 / Kt 222.02, fərq Dt 731 / Kt 222.02.
- Dividend: Dt 343 / Kt 344 → Dt 344 / Kt 534.01 → Dt 534.01 / Kt 521.07 (ödəmə mənbəyində vergi) və ödəniş.
- Ay bağlanışı: 721/731 → 801, 601/611 → 801, 604.1 → 801, 801 → 341; valyuta qalıqlarının yenidən qiymətləndirilməsi (731 / 611).

### TƏSDİQLƏNDİ

1. **Satışın ƏDV-si:** e-qaimə kəsiləndə Dt 604.1 / Kt 521.01. 422 bu sxemdə işlənmir.
2. **521 və 522 — 1C kimi subhesablar.** İcra qaydası (təklifdir, yoxlanılmalıdır): subhesab vergini/fondu özü göstərdiyi üçün 1C-dəki "Büdcəyə ödəniş növü" subkontosu təkrarlanmır; yalnız aşağıda göstərilən subhesablarda subkonto var:
   - 521.01 ƏDV, .02 Əmlak vergisi, .03 Gəlir vergisi, .04 Mənfəət vergisi, .05 Torpaq vergisi, .06 Sanksiyalar, .07 Ödəmə mənbəyindən vergi (subkonto: Kontragent), .08 Sadələşdirilmiş vergi, .09 Sair vergi və rüsumlar (subkonto: Vergi növü), .10 Yol vergisi, .11 Aksizlər, .12 Mədən vergisi, .13 ƏDV vergi agenti (Kontragent → Müqavilə → Hesablaşma sənədi).
   - 522.01 Əmək sazişi üzrə DSMF, 522.02 Xidmət müqaviləsi üzrə DSMF, 522.03 İşsizlikdən sığorta (.1 işçi, .2 işəgötürən), 522.04 İcbari tibbi sığorta (.1 işçi, .2 işəgötürən).
3. **701:** Nomenklatura qrupu → Xərc maddəsi (1C kimi). "Nomenklatura qrupları" yeni kitabçadır. **751 və 631:** Kontragent → Müqavilə qalır.
4. **Valyuta avansları (243.02, 543.02) ay sonu yenidən qiymətləndirilir** (1C kimi, fərq 731 / 611). Yuxarıdakı "valyuta avansları yenidən qiymətləndirilmir" qərarını əvəz edir. Ay bağlanışı mərhələsində həyata keçiriləcək.
5. **211 və 531 qrupdur:** 211.01 / 531.01 manatla, 211.02 / 531.02 valyuta ilə. 243 və 543-də üçüncü subkonto Hesablaşma sənədidir (Kontragent → Müqavilə → Hesablaşma sənədi).
6. **Yeni hesablar:** 222.01–222.04 (yolda olan köçürmələr, valyuta alışı və satışı), 344 Elan edilmiş dividendlər, 422 Digər təxirə salınmış vergi öhdəlikləri, 534 / 534.01 Dividendlər üzrə təsisçilərə borclar.

### Hələ açıq

- 221 (1C-də 221.01 manat / 221.04 valyuta subhesabları), 244 (244.01 / 244.02), 301 (ikinci subkonto "Kapitalda dəyişiklik növü") — 1C kimi edilsinmi?
- "Pul vəsaitlərinin hərəkəti maddəsi" subkontosu (yalnız dövriyyə üzrə) lazımdırmı?
- Hesabların qalan adları 1C-dəki adlarla tutuşdurulmalıdır (indi yalnız dəyişən hesabların adları 1C-yə uyğunlaşdırılıb).
