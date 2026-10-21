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
2. **521 və 522 — 1C kimi subhesablar** (subkontolar 2026-10-07 gecə bölməsində dəqiqləşdi):
   - 521.01 ƏDV, .02 Əmlak vergisi, .03 Gəlir vergisi, .04 Mənfəət vergisi, .05 Torpaq vergisi, .06 Sanksiyalar, .07 Ödəmə mənbəyindən vergi, .08 Sadələşdirilmiş vergi, .09 Sair vergi və rüsumlar, .10 Yol vergisi, .11 Aksizlər, .12 Mədən vergisi, .13 ƏDV vergi agenti.
   - 522.01 Əmək sazişi üzrə DSMF, 522.02 Xidmət müqaviləsi üzrə DSMF, 522.03 İşsizlikdən sığorta (.1 işçi, .2 işəgötürən), 522.04 İcbari tibbi sığorta (.1 işçi, .2 işəgötürən).
3. **701:** Nomenklatura qrupu → Xərc maddəsi (1C kimi). "Nomenklatura qrupları" yeni kitabçadır. **751 və 631:** Kontragent → Müqavilə qalır.
4. **Valyuta avansları (243.02, 543.02) ay sonu yenidən qiymətləndirilir** (1C kimi, fərq 731 / 611). Yuxarıdakı "valyuta avansları yenidən qiymətləndirilmir" qərarını əvəz edir. Ay bağlanışı mərhələsində həyata keçiriləcək.
5. **211 və 531 qrupdur:** 211.01 / 531.01 manatla, 211.02 / 531.02 valyuta ilə. 243 və 543-də üçüncü subkonto Hesablaşma sənədidir (Kontragent → Müqavilə → Hesablaşma sənədi).
6. **Yeni hesablar:** 222.01–222.04 (yolda olan köçürmələr, valyuta alışı və satışı), 344 Elan edilmiş dividendlər, 422 Digər təxirə salınmış vergi öhdəlikləri, 534 / 534.01 Dividendlər üzrə təsisçilərə borclar.

## 2026-10-07 (gecə) — 1C ilə tutuşdurmanın ikinci hissəsi

### TƏSDİQLƏNDİ

1. **521 və 522 subkontosu 1C kimi hər yerdə.** 1C-dəki "Büdcəyə ödəniş növü (fondlar)" kitabçası ödənişin növünü ayırır (vergi, faiz, maliyyə sanksiyası); vergini/fondu subhesab göstərir. Meyar-da: "Ödəniş növü" kitabçası (başlanğıc: Vergi (haqq), Faiz, Maliyyə sanksiyası — mühasib dəyişə bilər).
   - 521.xx, 522.xx: Ödəniş növü.
   - 521.07: Ödəniş növü → Kontragent. 1C-də üçüncü subkonto İşçi də var, amma Meyar-da subkonto boş qala bilmədiyi üçün götürülmədi (işçinin gəlir vergisi 521.03-dədir).
   - 521.13: Kontragent → Müqavilə → Hesablaşma sənədi (1C kimi, ödəniş növü yoxdur).
   - Qeyd: kitabçanın başlanğıc elementləri standart 1C-yə görədir, real bazada yoxlanılmayıb.
2. **221 1C kimi:** 221.01 Kassa (manatla), 221.02 Əməliyyat kassası, 221.03 Pul sənədləri (manatla), 221.04 Kassa (valyuta ilə), 221.05 Pul sənədləri (valyuta ilə). Kassa subkontosu .01, .02, .04-də.
3. **244 1C kimi:** 244.01 manatla, 244.02 valyuta ilə; subkonto İşçi.
4. **301:** Kontragent → Kapitalda dəyişiklik növü (yeni kitabça; başlanğıc: Nizamnamə kapitalına qoyuluş, Nizamnamə kapitalının azaldılması).
5. **Pul vəsaitlərinin hərəkəti maddəsi:** bank sənədi mərhələsində qərar veriləcək.

### Hələ açıq

- Hesabların qalan adları 1C-dəki adlarla tutuşdurulmalıdır (indi yalnız dəyişən hesabların adları 1C-yə uyğunlaşdırılıb).

## 2026-10-07 (gecə) — mərhələ 2: qaimələr

### TƏSDİQLƏNDİ

1. **Maya dəyəri — FIFO.** Mal satılanda əvvəl gələn partiya əvvəl silinir (Dt 701 / Kt 205). Partiya — malın hər alış sənədi (eyni sənəddə eyni mal cəmlənir). Satış tarixinə qədərki partiyalar və o tarixə qədər silinmiş miqdar götürülür.
2. **Qiymət qaimədə seçilir:** "ƏDV daxildir" bayrağı. Bayraq yoxdursa, qiymət ƏDV-sizdir (e-qaimə kimi) və ƏDV 18% üstə gəlir; varsa, ƏDV 18/118 ilə ayrılır. ƏDV sətir üzrə yuvarlaqlaşdırılır.
3. **Valyuta qaimələri bu mərhələdədir.** Valyuta müqavilədən gəlir, məzənnə (AMB, 4 onluq) qaimədə əl ilə yazılır. Manat məbləği = valyuta məbləği × məzənnə, sətir üzrə.

### İcra qaydaları (koddadır, testlərlə yoxlanılır)

- Satış: Dt 211.01 / Kt 601 (ƏDV daxil); 18%-də Dt 604.1 / Kt 521.01 (ödəniş növü "Vergi (haqq)"); mal üçün Dt 701 (nomenklatura qrupu, "Satılmış malların maya dəyəri") / Kt 205 (FIFO). Valyuta müqaviləsində 211.02.
- Alış: Dt 721/201/205/113 (ƏDV-siz) / Kt 531.01; ƏDV əvəzləşdirilirsə Dt 241 (kontragent, bu qaimə, dərəcə) / Kt 531.01; maya dəyərinə daxil edilirsə ƏDV hesabın məbləğinə qoşulur. Seçim qaimə üzrə, sətirdə dəyişdirilə bilər. ƏDV ödəyicisi olmayan şirkətdə 18% satış qadağandır, alış ƏDV-si maya dəyərinə gedir.
- Sətrin standart hesabı nomenklaturanın növündən: xidmət → 721, material → 201, mal → 205, əsas vəsait → 113 (satışda əsas vəsait qaimə ilə satılmır). Xərc maddəsi olan hesabda xərc maddəsi məcburidir.
- Avansın avtomatik əvəzləşdirilməsi: qaimə uçota alınanda eyni kontragent + müqavilədə açıq avanslar (543 / 243) ən köhnədən başlayaraq qaimə məbləği qədər əvəzləşir: satışda Dt 543 (avans sənədi) / Kt 211 (bu qaimə), alışda Dt 531 (bu qaimə) / Kt 243 (avans sənədi). Avans qaimə tarixində və bu gün də açıq olmalıdır (bir avans iki dəfə işlənmir).
- Valyuta avansı öz məzənnəsi ilə əvəzləşir (valyuta məbləği ilə ölçülür); qaimə ilə avansın məzənnə fərqi 211.02 / 531.02-də qalır və ay sonu yenidən qiymətləndirmədə (mərhələ 5) bağlanır.
- Nömrə: SQ-000001 (satış), AQ-000001 (alış), boş qalsa avtomatik. E-qaimə seriya + nömrəsi uçotda bir dəfə: satışda şirkət üzrə, alışda malsatan üzrə.
- Düzəliş və ləğv: əl ilə əməliyyat kimi qırmızı storno. Düzəlişdə əvvəlki yazılış əvvəlcə storno edilir, sonra FIFO və avanslar qaiməsiz ledgerə görə yenidən hesablanır.
- Kitabça elementləri rol ilə tapılır (ad dəyişsə də): "Vergi (haqq)", "Satılmış malların maya dəyəri", "Əsas nomenklatura qrupu", "Məhsul satışı", "Xidmət satışı". Rolu Siyahılar bölməsində "Qaimələrdə standart" sahəsi ilə başqa elementə keçirmək olar. Arxivdəki element rol almır; sistem rolu təxminlə başqa elementə vermir.
- Maya dəyəri jurnaldakı real qalıqla tutuşdurulur: malı sıfırlayan silinmə qalan dəyərin hamısını götürür (qəpik qalığı qalmır); hissə-hissə silinmə ən azı 0,01 AZN-dir və həmişə qalan vahidlərə dəyər saxlayır. Sənədlər FIFO ardıcıllığını pozubsa (məs. geriyə tarixlə alış), silinmə qalanın orta dəyəri ilə qiymətləndirilir — mal heç vaxt bloklanmır.
- Mal qalığı: satış tarixinə qalıq çatmalıdır və sonrakı silinmələr üçün də qalıq qalmalıdır. Qaimənin düzəlişi və ya ləğvi heç bir gündə qalığı indikindən aşağı mənfiyə sala bilməz (satılmış malın alışı geri götürülmür); mövcud çatışmazlığı azaldan sənəd həmişə qəbul olunur.
- Avans yalnız qaimənin hələ ödənilməmiş hissəsinə əvəzləşir (qaiməyə bağlı ödənişlər çıxılır).
- Ödəniş qaiməyə yalnız onun kontragenti və müqaviləsi ilə bağlana bilər; ləğv edilmiş qaiməyə yeni ödəniş bağlanmır.

### Məhdudiyyətlər (sonrakı mərhələlər)

- Geriyə tarixlə daxil edilən mal hərəkəti artıq uçotda olan satışların maya dəyərini avtomatik dəyişmir (sonrakılar orta dəyərlə tutuşdurulur); dəqiq FIFO ay bağlanışında (mərhələ 5) yenidən hesablanacaq.
- Malın qaytarılması, əsas vəsaitin satışı, qeyri-rezidentdən ödəmə mənbəyində vergi (521.07) və ƏDV vergi agenti (521.13) avtomatik deyil — hələlik əl ilə əməliyyatla.
- DVX e-qaimələrinin idxalı — mərhələ 4.

## 2026-10-07 (gecə, sonra) — qaimə və pəncərələr üzrə istəklər (0.4.1)

### TƏSDİQLƏNDİ

1. **E-qaimə nömrəsi bir sahədir.** "MT" ayrılmır: `MT2610007` bütöv yazılır (boşluqlar götürülür, böyük hərflə saxlanılır). Bir dəfəlik yoxlama bu tam nömrə üzrədir. Sxem v5 köhnə seriya + nömrəni bir sahəyə birləşdirir (eyni tam nömrə artıq varsa, köhnə qeyd toxunulmaz qalır).
2. **Cədvəllərdə kontragentə az yer.** Siyahıda kontragent sütunu dar və bir sətirlik (uzun ad "…" ilə kəsilir, tam adı üzərinə gələndə görünür); redaktorda kontragent sahəsi digər sahələr qədərdir.
3. **Yazılışları əl ilə düzəltmək olar (1C "Əl ilə düzəliş").** Saxlanmış qaimənin "Yazılışlar" bölməsində bayraq qoyulanda yazılışlar əl ilə əməliyyatdakı kimi cədvəldə dəyişdirilir (hesab, subkonto, miqdar, valyuta, məbləğ, məzmun). Bayraq sənəddə saxlanılır; belə qaimədə sətirlərin dəyişməsi yazılışları yenidən hesablamır. Bayraq götürüləndə yazılışlar yenə qaydalarla qurulur. Düzəliş adi qaydada qırmızı storno ilə gedir; yazılışlar əl ilə əməliyyatın bütün yoxlamalarından keçir (subkonto məcburidir, qrup hesabına yazılmır və s.). Boş "hesablaşma sənədi" bu qaimənin özü deməkdir.
4. **1C kimi pəncərələr.** Hər bölmə (qaimələr, əl ilə əməliyyatlar, hesabatlar, kitabçalar…) və hər sənəd iş sahəsində ayrıca pəncərədə açılır: sürüşdürülür, ölçüsü dəyişdirilir, üst-üstə düşür, kiçildilir, böyüdülür (başlığa iki klik), bağlanır. Aşağıda 1C-dəki kimi pəncərələr paneli var: açıq pəncərələr, "Başlanğıc" (hamısını kiçildir), kaskad, yan-yana, hamısını bağla. Ctrl+Tab növbəti pəncərə, Ctrl+F4 bağla. Pəncərənin ölçüsü və böyüdülmüş olması növünə görə yadda saxlanılır (məs. bütün satış qaimələri).

## 2026-10-10 — interfeysin dizaynı

### TƏSDİQLƏNDİ

1. **Yaşıl dizayn.** Əsas köhnə Meyar ERP v1.17-nin yaşıl görünüşüdür (istifadəçinin bəyəndiyi son versiyalardan): yuxarıda modullar paneli, tünd yaşıl düymə və cədvəl başlıqları, nanə rəngli iş sahəsi, rəqəmlər monoşriftlə. "Klassik ofis" lent menyusu götürüldü.
2. **Pəncərələr qalır (1C kimi).** Siyahı və hesabatlar böyüdülmüş açılır (tab kimi), sənədlər onların üstündə ayrıca pəncərədə; aşağıda pəncərələr paneli.
3. **(Yeniləndi, 0.4.3) Dizayn sıfırdan, iş qaydası 1C kimi.** 0.4.2-dəki yaşıl görünüş köhnə Meyar ERP-nin surəti kimi rədd edildi. Yeni dizayn: solda bölmələr paneli, bölmənin funksiyaları (sənədlər, yarat, hesabatlar, kitabçalar), forma pəncərələrində 1C əmr paneli ("Uçota al və bağla" Ctrl+Enter, "Uçota al" Ctrl+S, "Dt/Kt yazılışlar", "Ləğv et"), sənəd başlığında etiketlər solda, cari sətir/sahə tunc (sarı) rənglə. Başlanğıc — "İş masası" (iş xəritəsi, diqqət, qalıqlar, son sənədlər).
4. **(0.4.5) Windows 11 dizaynı.** İstifadəçi proqramın Windows şirkəti ilə birlikdə hazırlanmış kimi görünməsini istədi: Fluent 2 (başlıq zolağı, NavigationView, Fluent idarəetmə elementləri və ikonları, Segoe UI Variable), vurğu rəngi #107C41. 1C iş qaydası saxlanılır.
5. **(Yeniləndi, 0.4.6) "Jurnal" dizaynı.** Fluent/Office görünüşü bəyənilmədi. İstifadəçi üç maketdən 2-cini seçdi ("dizayn 2-nin bir az daha yaxşısı"): mühasibat kitabı üslubu (kağız fon, mürəkkəb-göy yazı, göy xətli sətirlər, ikiqat xətlər, qırmızı haşiyə xətti), Inter + Lora şriftləri. Naviqasiya 1C kimi yuxarıda əsas menyudur (açılan menyular), sol panel yoxdur. 1C iş qaydası və pəncərələr saxlanılır.

## 2026-10-14 — mərhələ 3: bank sənədi

İcra planı və əsaslandırma: `docs/MERHELE-3-BANK.md`.

### TƏSDİQLƏNDİ

1. **Bank sənədi** — daxilolma (BD-000001) və məxaric (BX-000001). Bank hesabı kitabçadan seçilir; uçot hesabı (223.01 / 223.02 / 224.04) və valyuta ondan gəlir. Sənəd çoxsətirlidir, müxabir hesab bütün hesab planından sərbəst seçilir. Daxilolma: Dt bank / Kt sətir; məxaric: Dt sətir / Kt bank. Düzəliş və ləğv qırmızı storno ilə.
2. **Qaimələrə avtomatik bölgü:** 211 / 531 sətrində hesablaşma sənədi seçilməyibsə, məbləğ həmin kontragent + müqavilənin açıq qaimələrinə ən köhnədən bölünür; qalan avans olur (543 / 243, hesablaşma sənədi — bu bank sənədi).
3. **ƏDV hissəsi ayrıca sənəddir.** 224.04 sənədi qaimənin yalnız ƏDV payını, 223.xx sənədi yalnız qalan payını bağlayır. Cütləşdirmə və 18/118 yoxlaması (±0,01 AZN, bloklamır) — 3b.
4. **İstifadə olunmuş avans geri götürülmür:** bank sənədinin avansı qaimədə əvəzləşdirilibsə, sənədin düzəlişi və ya ləğvi həmin avansı əks qalığa sala bilməz.
5. **Öz hesabları arasında köçürmə 222.01 vasitəsilə**; 222.01-də qalan qalıq nəzarət siqnalıdır.
6. **Pul vəsaitlərinin hərəkəti maddəsi** subkonto deyil, bank sənədi sətrinin atributudur (223.xx-də yazılış olduğu üçün subkontosu dəyişdirilmir).
7. **Qaydalar:** yeni qayda "təklif" rejimində yaranır; "avtomatik" rejimini yalnız mühasib qoşur.
8. **Bank xidmətləri** 721 (xərc maddəsi "Bank xidmətləri"); **kredit faizi** 751; **vergi ödənişlərinin subhesabı** büdcə təsnifat kodu → subhesab cədvəli ilə (cədvəli mühasib doldurur).
9. **Əmək haqqı** hələlik bir sənəddə hər işçi bir sətir; avtomatik bölgü əməkhaqqı mərhələsində.
10. **Valyuta alışı/satışı** (222.02 / 222.04) şablon kimi bu mərhələdə; məzənnə fərqinin avtomatik hesablanması mərhələ 5-də.

## 2026-10-15 — mərhələ 3 auditinin açıq sualları

İstifadəçi qərarı yoxlayıcıya həvalə etdi ("ən məntiqli və düzgün nədirsə, onu et"). Əsaslandırma: `PROJECT_STATE.md` → "Mərhələ 3 auditi".

### TƏSDİQLƏNDİ

1. **Ödənilmiş qaimə ləğv edilmir və ödənişdən aşağı azaldılmır.** Qaimənin öz hesablaşma açarı (211 / 531) artıq ödənişə düşərsə, sənəd saxlanmır: əvvəlcə ödəniş sənədi düzəldilir. 2026-10-14 §4 (istifadə olunmuş avans geri götürülmür) ilə eyni prinsip.
2. **Fiziki şəxs və xarici kontragent** tam məbləği cari hesaba ödəyəndə qaimə ƏDV daxil tam bağlanır (onların ƏDV depozit hesabı yoxdur). 2026-10-14 §3 hüquqi şəxslər və dövlət təşkilatları üçün qüvvədədir; ƏDV ödəyicisi olmayan hüquqi şəxsin tam ödənişini mühasib qaiməni əl ilə seçib bağlayır.
3. **Başqa sənədlər avtomatik yenidən keçirilmir.** Bir sənədin düzəlişi digər uçotda olan sənədləri səssiz dəyişmir; lazım olanda mühasib onları özü yenidən saxlayır.
4. **Artıq ödənilmiş qaiməyə əl ilə bağlanma** bloklanmır, sənəddə xəbərdarlıq göstərilir.
5. **Bərabər qaydalar:** sətri eyni dəqiqliklə tanıyan, eyni yazılışlı qaydalardan biri "təklif" rejimindədirsə, sətir avtomatik uçota alınmır.

## 2026-10-15 — mərhələ 4: DVX e-qaimələri

İcra planı və əsaslandırma: `docs/MERHELE-4-EQAIME.md`. İstifadəçi dizaynı və §11-dəki tövsiyələri təsdiqlədi.

### TƏSDİQLƏNDİ

1. **Mənbələr:** e-taxes-dən endirilən Excel ("Qaimələr üzrə", "Mallar üzrə"; Gələnlər / Göndərilənlər) və Meyar-ın içində açılan rəsmi DVX kabineti, kabinetin öz Excel ixracı ilə. Kabinetin səhifəsindən məlumat "oxunmur" (v1.17-nin üsulu götürülmür).
2. **PIN və giriş:** istifadəçi rəsmi səhifədə özü daxil olur; Meyar PIN/parolu oxumur, saxlamır, səhifəyə skript yeritmir. Kabinet sessiyası yaddaşda saxlanılır, pəncərə və ya proqram bağlananda silinir.
3. **E-qaimə bir dəfə:** açar istiqamət + kontragentin VÖEN-i + e-qaimə nömrəsi. Eyni faylın təkrar yüklənməsi heç nə dəyişmir; DVX-in yazdığı sahələr dəyişdirilmir, yalnız DVX statusu yenilənir (tarixçə ilə). Eyni e-qaimə fərqli məbləğlə gələrsə — ziddiyyət siqnalı, mövcud qeyd toxunulmaz.
4. **İstiqamət qarışmır:** şirkətin öz VÖEN-i alışda alıcı, satışda satıcı yerində olmalıdır; fayl başlığı seçilən istiqamətə zidd olarsa və ya başqa şirkətin faylıdırsa, fayl rədd olunur.
5. **Uçot yalnız qaimə ilə:** alınan e-qaimə → alış qaiməsi, göndərilən → satış qaiməsi, adi `invoice.save` ilə (yeni yazılış qaydası yoxdur). Üç vəziyyət (avtomatik / təklif / naməlum); kontragent avtomatik yaradılmır; bir neçə müqavilə — təklif; valyuta — təklif.
6. **Uçota yalnız "Təsdiqləndi" və "Sistem tərəfindən təsdiqləndi"** statuslu e-qaimələr alınır; gözləyənlər qutuda gözləyir; tanınmayan status heç vaxt "təsdiqlənib" sayılmır.
7. **DVX-də ləğv / imtina:** uçotda yoxdursa kənara qoyulur; uçotdadırsa — siqnal və bir düymə ilə ləğv təklifi, səssiz storno yoxdur; ödənilmiş qaimə ləğv olunmur.
8. **Düzəliş e-qaiməsi:** əsas qaimə uçotda deyilsə, düzəliş əsas kimi alınır; uçotdadırsa və dövrü açıqdırsa — əsas qaimənin yenilənməsi təklif olunur; bağlı dövrdə — əl ilə. Heç vaxt avtomatik deyil.
9. **Qaimənin tarixi** — e-qaimənin tarixi.
10. **Qaytarma, avans e-qaiməsi, aksiz, yol vergisi** bu mərhələdə "naməlum"dur (əl ilə).
11. **Məbləğ:** Meyar-ın hesabladığı qaimə DVX məbləğlərini qəpikbəqəpik təkrarlamalıdır; qiymət lazım olsa `məbləğ / miqdar` ilə; yenə fərq varsa — təklif.
12. **Uyğunluq xəritəsi** (DVX mal kodu / adı → nomenklatura + hesab): "təklif" rejimində yaranır, standart olaraq "yalnız bu kontragent"; "avtomatik" rejimini yalnız mühasib qoşur. Xidmət / xərc üçün "bütün qaimə bir sətir" uyğunluğu icazəlidir (mal, material, əsas vəsait üçün yox).
13. **Əl ilə yazılmış qaimə:** eyni e-qaimə nömrəlisi varsa ona bağlanır; nömrəsiz uyğun qaimə (eyni kontragent, cəmi, ±5 gün) yalnız təklif kimi — nömrə yazılır, yazılışlar dəyişmir.

## 2026-10-16 — mərhələ 4 auditinin açıq sualları

İstifadəçi auditin (`PROJECT_STATE.md` → "Mərhələ 4 auditi") 5 açıq sualında tövsiyələrin tətbiqini təsdiqlədi.

### TƏSDİQLƏNDİ

1. **Düzəliş e-qaiməsinin ƏDV dövrü — əsas e-qaimənin dövrü.** Düzəliş uçotda əsasın qaiməsini onun öz tarixində dəyişir; DVX ↔ uçot tutuşdurması da düzəlişi əsasın ayında sayır. Əsas uçotda deyilsə, düzəliş onun yerinə əsasın tarixi ilə uçota alınır. (Mühasib başqa qayda istəsə — "düzəliş öz tarixində" — qaimənin tarixi də düzəlişin tarixi olmalıdır; onda bu bənd dəyişdirilir.)
2. **Bağlı dövrün ziddiyyətləri İş masasında görünür.** Bağlı dövrdə qaimə dəyişdirilmir: mühasib əks yazılışı açıq dövrdə aparır və qutuda "Qəbul et" ilə qeyd yazır (kim, nə vaxt, nə edildi — audit jurnalında). Açıq dövrdə DVX-də ləğv edilmiş qaimə qeydlə yox, ləğvlə bağlanır; fərqli məbləğlə gəlmiş e-qaimə yoxlanıldıqdan sonra qeydlə qəbul edilə bilər. DVX-də yeni dəyişiklik olsa, qəbul ləğv olunur, ziddiyyət yenidən açılır.
3. **İstiqaməti sübut olunmayan fayl** (başlığında "Gələnlər / Göndərilənlər" yoxdur, satıcı və alıcı VÖEN-ləri yoxdur) yalnız ilkin baxışda istifadəçinin açıq təsdiqi ilə yüklənir.
4. **DVX ilə ay üzrə ƏDV müqayisəsinə yalnız e-qaimə nömrəli (və ya e-qaiməyə bağlı) qaimələr düşür.** Nömrəsiz qaimələr (məs. fiziki şəxslərə satış) ayrıca siyahıdadır.
5. **Kabinet endirməsi 50 MB-ı keçən an dayandırılır** — ölçü əvvəlcədən bilinməsə də.

## 2026-10-16 — proqramın avtomatik yenilənməsi

### TƏSDİQLƏNDİ

1. **Proqram özü yenilənir.** Quraşdırılmış Meyar hər açılanda və açıq qaldıqca hər 4 saatdan bir GitHub-dakı layihə release-lərində yeni versiyanı yoxlayır, arxa planda endirir, proqram bağlananda quraşdırır; status sətrində "İndi yenidən başlat" da var. Saxlanmamış sənəd varsa, bağlanma əvvəlcə soruşur.
2. Yeniləmə məlumat bazasına toxunmur: baza istifadəçi qovluğunda qalır, miqrasiyadan əvvəl açılış nüsxəsi alınır, köhnə proqram daha yeni bazanı açmır.
3. İlk dəfə 0.6.1 əl ilə quraşdırılır (0.6.0 və əvvəlkilərdə yeniləyici yoxdur); sonrakı versiyalar özü gəlir. Versiyalar hələ imzalanmamış sınaq versiyalarıdır.

## 2026-10-17 — e-qaimə qutusundan kontragentlərin toplu yaradılması

### TƏSDİQLƏNDİ

1. Qutuda "Yeni kontragentləri yarat" düyməsi: gözləyən, DVX-də təsdiqlənmiş e-qaimələrin kitabçada olmayan VÖEN-ləri DVX-dəki adla yaradılır (VÖEN-in son rəqəmi 2 — fiziki şəxs, qalanı hüquqi şəxs). İstəyə görə aktiv müqaviləsi olmayan hər kontragentə qutunun növündə "Əsas" müqavilə açılır (tarixi — ilk e-qaimənin tarixi; nömrə və tarix sonra düzəldilir). Yalnız mühasibin düyməsi ilə; 2026-10-15 §5-in "kontragent avtomatik yaradılmır" qaydası (idxalda səssiz yaradılmama) qüvvədədir. Ləğv edilmiş e-qaimələrin VÖEN-ləri yaradılmır; mövcud kontragentlərə toxunulmur.
2. **Bütün qaimə — bir xidmət, toplu.** Mal sətirləri olmayan ("Qaimələr üzrə") e-qaimələrin kontragentləri üçün qutuda bir xidmət (və alışda xərc maddəsi) seçilir; hər VÖEN-ə "bütün qaimə" uyğunluğu yazılır (öz uyğunluğu olan VÖEN-ə toxunulmur). Rejimi mühasib seçir ("təklif" və ya "avtomatik").
3. **ƏDV bazası göstərilməyən e-qaimə** (ƏDV ödəyicisi olmayan malsatan — DVX heç bir baza yazmır): ƏDV 0-dırsa, bütün məbləğ "ƏDV-yə cəlb olunmayan"dır; ƏDV varsa, bütün məbləğ 18% kimi yoxlanır.

## 2026-10-17 — mərhələ 5: kassa, məzənnələr, ay bağlanışı, idarə paneli

İcra planı: `docs/MERHELE-5-AY-BAGLANISI.md`. İstifadəçi dizaynı və §11 tövsiyələrini təsdiqlədi.

### TƏSDİQLƏNDİ

1. **Kassa sənədi:** mədaxil (KMO-000001) və məxaric (KXO-000001) orderi, bank sənədinin güzgüsü (çoxsətirli, sərbəst müxabir hesab, qaimələrə bölgü, avans, təhtəlhesab, storno). Kassalar ayrıca kitabçadır (hesab 221.01 / 221.02 / 221.04, valyuta); mövcud "kassa" elementləri eyni id ilə köçür.
2. **Kassa qalığı heç bir gündə mənfi ola bilməz** — sənəd saxlanmır.
3. **Bankdan nağd pul və banka nağd pul** 222.01 vasitəsilə iki sənədlə (bank məxarici Dt 222.01 / Kt 223 + kassa mədaxili Dt 221 / Kt 222.01 və əksinə).
4. **Valyuta məzənnələri kitabçası** (AMB, 4 onluq, şirkətlərdən asılı deyil); "AMB-dən yüklə" düyməsi cbar.az-ın rəsmi XML faylından; açılışda avtomatik yükləmə yoxdur. Sənədlərdə məzənnə kitabçadan özü dolur, dəyişdirmək olar.
5. **Yenidən qiymətləndirmə** ayın son günü bütün valyuta hesablarında (221.04, 222.03, 222.04, 223.02, 211.02, 531.02, 243.02, 543.02, 244.02): gəlir 611 (gəlir növü "Məzənnə fərqi"), xərc 731 (xərc maddəsi "Məzənnə fərqi").
6. **Alış ƏDV-sinin əvəzləşdirilməsi:** ay sonu Dt 521.01 / Kt 241 yalnız DVX-də təsdiqlənmiş e-qaiməsi olan və ƏDV hissəsi ödənilmiş (224.04-dən; fiziki şəxs və xarici malsatana cari hesabdan) alış qaimələri üzrə; qalanı 241-də gözləyir.
7. **FIFO dəqiqləşdirilməsi** ay bağlanışında ayrıca düzəliş yazılışı ilə (Dt 701 / Kt 205 və ya əksinə); satış qaimələri yenidən keçirilmir.
8. **Ay bağlanışı:** 6xx / 7xx → 801, 801 → 341, dekabrda 341 → 343; ardıcıl (əvvəlki ay bağlanmadan sonrakı yox), yalnız sonuncu ay ləğv olunur (storno, səbəblə); bütün addımlar bir tranzaksiyada; Mənfəət və zərər hesabatı bağlanış yazılışlarını istisna edir.
9. **Mənfəət vergisi** (901 / 521.04) bu mərhələdə hesablanmır.
10. **Kassa orderləri** standart forma ilə, PDF-ə çap.
11. **İdarə paneli** göstəriciləri: gəlir, mənfəət, pul (bank + kassa), debitor, kreditor, ödənilməli ƏDV, gözləyən e-qaimələr; 12 ayın dinamikası.
12. **Valyuta kassası** (221.04) daxildir.

### İCRADA DƏQİQLƏŞDİ (5a, 0.6.5)

- Kassa orderi qaiməni **bütöv** bağlayır: kassada ƏDV depoziti yoxdur, ona görə ƏDV / əsas hissə bölgüsü (bank sənədindəki kimi) tətbiq olunmur.
- Köçürülən kassanın hesabı onun ən çox işləndiyi 221 hesabıdır (işlənməyibsə 221.01); valyutası 221.04-dəki yazılışlardan götürülür. Kassa, bank hesabı kimi, bir hesaba bağlıdır: başqa 221 hesabında bu kassa ilə yazılış saxlanmır.
- Mənfi qalıq yoxlaması yalnız kassa orderlərinə tətbiq olunur; əl ilə əməliyyatla 221-də yaranan mənfi qalıq İş masasında "Mənfi pul qalığı" kimi göstərilir (ay bağlanışında bloklayır — §8).

### İCRADA DƏQİQLƏŞDİ (5b, 0.6.6)

- **Sənədin məzənnəsi:** valyuta sənədində (bank, kassa, qaimə) məzənnə boş qalarsa kitabçadan götürülür — sənəd tarixinin, yoxdursa son 6 günün (istirahət və bayram günləri) AMB məzənnəsi; daha köhnəsi götürülmür, sənəd saxlanmır. Əl ilə yazılan məzənnə əvəz olunmur.
- **Ay sonu məzənnəsi** eyni qayda ilə: ayın son günü, yoxdursa son 6 gün.
- **Yenidən qiymətləndirmə ayrıca sənəddir** (YQ-2026-09, ayın son günü): bütün valyuta hesablarında (221.04, 221.05, 222.03, 222.04, 223.02, 211.02, 531.02, 243.02, 244.02, 543.02); bir subkonto açarında iki valyuta olarsa bloklanır. Ay bağlanışı onu addım kimi götürür.
- **AMB faylında nominal** (məs. 100 RUB) bölünür: kitabçada 1 vahidin məzənnəsi 4 onluqla saxlanır.

### İCRADA DƏQİQLƏŞDİ (5c, ay bağlanışı)

- **Ay bağlanışı bir sənəddir** (AB-2026-09, ayın son günü; şirkət + ay üzrə bir sənəd). Hər addım öz yazılışı ilə (`source_type = 'closing'`). Ləğvdən sonra yenidən bağlanış eyni sənədin yeni versiyasıdır.
- **Ardıcıllıq:** ay yalnız bitəndən sonra bağlanır. Əvvəlki ayın sonuna qədər bağlı dövrdən kənarda yazılış varsa (ay bağlanışı və ya "Dövrün bağlanması" ilə bağlanmayıbsa), bu ay bağlanmır. Ayın sonu artıq əl ilə bağlanıbsa, ay bağlanışı üçün əvvəlcə dövr açılır.
- **Ləğv:** yalnız kilid bu ayın sonunda dayanırsa (sonuncu bağlanmış ay). Kilid bağlanışdan əvvəlki tarixə qayıdır, səbəb audit jurnalına yazılır. "Dövrün bağlanması" ilə dövrü uçotdakı ay bağlanışının altına açmaq olmur — əvvəlcə bağlanış ləğv edilir.
- **Bloklayan yoxlamalar:** ayın hər hansı günündə mənfi mal qalığı (miqdar) və ya mənfi kassa qalığı (221, manat və valyuta); ay sonu məzənnəsi yoxdur və ya bir açarda iki valyuta; bağlanan ayın registrləri jurnalla üst-üstə düşmür (bütün bazanın tam yoxlaması Parametrlərdə qalır). Bloklanan bağlanışda heç nə yazılmır.
- **Xəbərdarlıqlar** (İş masasının siqnalları ay sonuna): əvəzləşdirilməmiş avanslar, yolda qalmış köçürmə, cütsüz / 18/118-ə uyğun olmayan ƏDV depoziti (bu ayın sənədləri), DVX: ziddiyyətlər, bu ayın uçota alınmamış e-qaimələri, ay üzrə ƏDV fərqi; e-qaiməsi təsdiqlənməmiş alışın ƏDV-si. "Oxudum" təsdiqi olmadan bağlanmır; oxunmuş xəbərdarlıqlar bağlanışda saxlanılır.
- **FIFO dəqiqləşdirilməsi:** ehtiyat hesablarında (201, 204, 205 — mal subkontolu, miqdarlı) hər malın ay sonu qalığı ciddi FIFO ilə qiymətləndirilir (ən son daxilolmaların dəyəri); uçotdakı dəyərlə fərq bir düzəlişdir — Dt 701 (malın nomenklatura qrupu, "Satılmış malların maya dəyəri") / Kt 20x və ya əksinə; miqdar dəyişmir.
- **Yenidən qiymətləndirmə (YQ-) ayrıca sənəd kimi qalır:** bağlanış onu yoxlayır — yoxdursa və fərq varsa uçota alır, köhnəlibsə yenidən keçirir (storno + yeni), aktualdırsa toxunmur. Ay bağlanışının ləğvi YQ-ni ləğv etmir: o, ayın valyuta qalıqları üçün düzgündür və növbəti bağlanışda yenə yoxlanır.
- **ƏDV əvəzləşdirilməsi:** 241-dəki qalıq qaimə üzrə (yalnız DVX-də təsdiqlənmiş e-qaiməsi qaiməyə bağlanmış alışlar). Hüquqi şəxsin manat qaiməsində — ay sonuna qədər ƏDV depozitindən (224) gələn məbləğ; fiziki şəxs, xarici kontragent və valyuta qaiməsində — ödənilmiş hissəyə mütənasib ƏDV. Əvvəlki əvəzləşdirmələr çıxılır; qalan 241-də gözləyir.
- **6xx / 7xx → 801** ay sonu qalığı ilə (dövriyyə ilə yox), subkonto açarları üzrə: əvvəlki aylar bağlanmayıbsa, onların qalığı da bu bağlanışa düşür. Bağlanışdan sonra 6xx / 7xx / 801 (dekabrda 341 də) sıfır olmalıdır, yoxsa heç nə saxlanmır.
- **Mənfəət və zərər hesabatı** (5d) bağlanış yazılışlarını istisna edəcək; 5c-də bağlanışın 5-ci addımı bağlanışdan əvvəlki qalıqları hesablar üzrə göstərir.

### İCRADA DƏQİQLƏŞDİ (5d, hesabatlar və idarə paneli)

- **Mənfəət və zərər** registrlərdən, aylar üzrə: 601 (gəlir növləri üzrə) − 602 − 603 − 604 = xalis satış; − 701 (xərc maddələri üzrə) = ümumi mənfəət; − 711 − 721 + 611 − 731 = əməliyyat mənfəəti; + 631 − 751 = vergiqoyulmadan əvvəl mənfəət. Ay bağlanışının 801 ilə yazılışları çıxılır; FIFO düzəlişi (701) qalır.
- **Pul vəsaitlərinin hərəkəti:** uçotdakı bank və kassa sənədlərinin sətirləri maddə üzrə (maddəsiz sətirlər "Maddəsiz"); qarşı tərəfi 221 / 223 / 224 olan sətir öz hesabları arasında hərəkətdir və sayılmır (222.01 vasitəsilə köçürmə hər iki tərəfdə görünür). Sənədlərdən kənar hərəkətlər (əl ilə əməliyyat, yenidən qiymətləndirmə) ayrıca sətirdir; əvvələ qalıq + daxilolma − ödəniş + kənar = sona qalıq (221 + 223 + 224) qəpikbəqəpik.
- **ƏDV icmalı** ay üzrə: satış dərəcələr üzrə (601 − 602 − 603, ƏDV-siz) və 604-ün ƏDV-si; alışın ƏDV-si (241-in ay dövriyyəsi), ay bağlanışında əvəzləşdirilən (241 → 521.01), 241-də qalan; ödənilməli = satışın ƏDV-si − əvəzləşdirilən. DVX tərəfi "DVX ↔ uçot" tutuşdurmasının rəqəmləridir.
- **İdarə paneli:** gəlir (xalis satış + sair və maliyyə gəlirləri), mənfəət (M/Z), pul (221 + 223 + 224, ay sonu), debitor (211-də kontragentlər üzrə müsbət qalıqlar), kreditor (531), ödənilməli ƏDV, gözləyən e-qaimələr; 12 ayın gəliri, xərci, mənfəəti və pul qalığı. Plitədən hesabata, M/Z sətrindən hesab kartına, oradan sənədə keçilir.

### AUDİTDƏN SONRA (18.10.2026, mərhələ 5c / 5d auditinin açıq sualları)

1. **Yenidən qiymətləndirmə ay bağlanışının ləğvində qalır** (bağlanış onu keçiribsə, yenidən keçiribsə və ya geri götürübsə də) — YQ ayın valyuta qalıqları üçün düzgündür, növbəti bağlanışda yenə yoxlanır. Dəyişiklik yoxdur.
2. **FIFO düzəlişi malın getdiyi yerə bölünür** (istifadəçi qərarı Meyar-a buraxdı: "ən məntiqlisi"). Hər malın fərqi ayın həmin ehtiyat hesabından məxariclərinin (satış 701, çatışmazlıq 721 / 731, istehsal 202 …) müxabir hesabları və subkontoları üzrə **miqdara mütənasib** bölünür, kumulyativ yuvarlaqlaşdırma ilə (hissələrin cəmi fərqə qəpikbəqəpik bərabərdir). Ləğv olunmuş (storno) məxaric çıxılır; bağlanışın öz yazılışları sayılmır. Başqa miqdarlı ehtiyat hesabına (201, 204, 205 …) köçürülmüş malın payı və ayda məxaric yoxdursa bütün fərq 701-ə gedir: miqdarsız düzəliş o hesabda FIFO layı olmazdı. Addımın xülasəsi mal sayını göstərir ("1 mal üzrə düzəliş").
3. **Əvəzləşdirilmiş ƏDV-nin geri alınması** (ödəniş sonradan azalarsa Dt 241 / Kt 521.01) avtomatik yazılmır — mühasib əl ilə əməliyyatla düzəldir. Dəyişiklik yoxdur.
4. **Bağlanışın DVX ziddiyyəti xəbərdarlığı** İş masası kimi bütün açıq ziddiyyətləri göstərir (ayla məhdud deyil). Dəyişiklik yoxdur.
5. **İdarə panelində "Gözləyən e-qaimələr" plitəsi yoxdur** — istifadəçi: belə məlumat lazım deyil, qaimə sistemdədirsə uçota alınır. Panel 6 plitədir: gəlir, mənfəət, pul, debitor, kreditor, ödənilməli ƏDV (bu bölmədəki §11 və 5d-dəki "gözləyən e-qaimələr" ləğv olunur). İş masasının e-qaimə siqnalları (mərhələ 4) və bağlanışın "bu ayın uçota alınmamış e-qaimələri" xəbərdarlığı dəyişmir.
6. **Ay bağlanışı forması bağlanmamış ilk ayla açılır:** kilidin (bağlı dövrün) sonrakı ilk yazılışının ayı; ondan sonra yazılış yoxdursa kilidin növbəti ayı; heç nə yazılmayıb və kilid yoxdursa iş dövrünün ayı. Ay forma açılanda bir dəfə seçilir — bağlanışdan sonra forma o ayda qalır.

### TƏSDİQLƏNDİ (18.10.2026, §9)

- **Mühasibin qəpikbəqəpik yoxlaması** (`docs/MERHELE-5-AY-BAGLANISI.md` §9): Sentyabr misalının bağlanışı — 601 Kt 15 000,00; 604.1 Dt 2 288,14; 701 Dt 7 000,00; 721 Dt 3,00 → 801; 801-in nəticəsi 5 708,86 (mənfəət) → Dt 801 / Kt 341; sonra 601 / 604 / 701 / 721 / 801 sıfır, 341-in kredit qalığı 5 708,86. FIFO düzəlişi və ƏDV əvəzləşdirilməsi yoxdur (alışın 1 800,00 ƏDV-si əl ilə əməliyyatdır, e-qaiməsi yoxdur, 241-də qalır). İstifadəçi təsdiqlədi (`closing.test.ts` A1, `analytics.test.ts` M/Z).

## 2026-10-21 — Dizayn (0.7.1)

- **Məqsəd:** gündə 8+ saat işdə göz yorulmasın; kiçik və böyük ekranda eyni rahatlıq. Sistem `docs/DIZAYN.md`-dədir, `styles.css` ona tabedir.
- **Ağ səth yoxdur.** Ən açıq böyük səth (cədvəl) 77 % parlaqlıqdır; yazı təmiz qara deyil (11:1). "Jurnal" (0.4.6) və açıq boz variantlar istifadəçiyə "ağ ekran" kimi gəldi.
- **1C-nin surəti deyil.** İş məntiqi 1C kimidir (bölmələr, pəncərələr, tablar, klaviatura); sarı əsas düymə, sarı cari sətir və ikonu yazının üstündə olan iri bölmə paneli kimi 1C əlamətləri yoxdur. Vurğu rəngi Meyar-ın öz petrolu.
- **Açıq və tünd mövzu**, Parametrlər → Görünüş (istifadəçinin seçimi: "ikisi, seçim ilə"); açıq — əsas.
- **Vəziyyət yalnız rənglə göstərilmir:** ● uçotda, ○ qaralama, ✕ ləğv; ləğv olunmuş sənədin məbləğləri üstündən xətlə (auditorun tələbi).
- **Rəy üsulu:** dizayn mühasib, dizayner və auditor baxışı ilə real ekran şəkilləri üzərində yoxlanır.
