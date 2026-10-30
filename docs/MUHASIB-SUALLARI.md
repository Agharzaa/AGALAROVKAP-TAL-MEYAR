# Mühasib üçün suallar — təsdiq gözləyən qaydalar

Vəziyyət: **0.9.17** (30.10.2026). Bu sənəd auditlərin açıq suallarını və "mühasib təsdiq edir" qeydi olan qaydaları bir yerə yığır. Mənbələr: `PROJECT_STATE.md` ("Mərhələ 8 auditi", "Mərhələ 9 auditi", "E-qaimə və bank auditi", "Mərhələ 10 auditi"), `docs/QERARLAR.md` (2026-10-17, 2026-10-27, 2026-10-28, 2026-10-29), `docs/MERHELE-5-AY-BAGLANISI.md`, `docs/MERHELE-8-EMEK-HAQQI.md`, `docs/MERHELE-9-VERGI-BEYANNAMELERI.md`, `docs/MERHELE-10-MALIYYE-HESABATLARI.md`.

**Necə istifadə etmək:** cədvəldə hər sətir üçün son sütuna "Təsdiq" və ya "Dəyiş: …" yazın. Ətraflı izah cədvəldən sonradır (eyni nömrə ilə). Meyar hazırda hər yerdə **tövsiyəni** tətbiq edir; "Təsdiq" — heç nə dəyişmir, "Dəyiş" — proqramçı yeni versiyada düzəldir. Rəqəmli misallar MG Transport üçün təxminidir (sürücü maaşı, tır, daşıma xidməti) — qaydanı göstərmək üçün.

Hər qrupda suallar **vaciblik sırası** ilə düzülüb: yuxarıdakılar hər ay pula və ya bəyannaməyə təsir edir. ⚠ — ilk növbədə baxılmalı olanlar.

## Cədvəl

| №    | Sual                                                                           | Tövsiyə (Meyar indi belə edir)                                                                         | Təsdiq / Dəyiş |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------- |
|      | **A. ƏDV**                                                                     |                                                                                                        |                |
| 1    | VM 175 (mütənasib bölgü) xəbərdarlığı hansı satışlarda çıxsın?                 | Azad **və cəlb olunmayan** satışda xəbərdarlıq; 0% əvəzləşdirməni məhdudlaşdırmır                      |                |
| 2    | ƏDV-li, amma e-qaiməsiz alış qaimələri İş masasında görünsünmü?                | Bəli: "ƏDV-li, e-qaiməsiz alış qaimələri: N" siqnalı (yalnız alış)                                     |                |
|      | **A1. ƏDV əvəzləşdirilməsi**                                                   |                                                                                                        |                |
| Ə1 ⚠ | Hansı alışın ƏDV-si ay bağlanışında əvəzləşdirilir?                            | DVX-də təsdiqlənmiş e-qaiməli və ƏDV-si depozitdən ödənilmiş; Dt 521.01 / Kt 241; DVX-dəkindən çox yox |                |
| Ə2 ⚠ | Fərdi sahibkar, xarici kontragent və valyuta qaiməsi                           | Fərdi sahibkar — yalnız depozitdən (0.9.17); xarici və valyuta — ödənilən hissəyə mütənasib            |                |
| Ə3 ⚠ | Əvəzləşdirilən hesablanandan çox olanda (artıq ƏDV)                            | Bəyannamədə "artıq — növbəti aya keçir"; növbəti ayın "ödənilməli"sindən özü çıxılsın (indi çıxılmır)  |                |
| Ə4   | İdxal ƏDV-si (gömrükdə ödənilən)                                               | Meyar-da ayrıca qayda yoxdur — mühasib əl ilə Dt 521.01 / Kt 241; sonra "gömrük bəyannaməsi" sənədi    |                |
| Ə5   | Nə vaxt: ödənilməmiş və ya DVX-də təsdiqlənməmiş ƏDV                           | E-qaimənin ayı və depozit ödənişinin ayından **sonrakında**; o vaxta qədər 241-də                      |                |
| Ə6   | Ödəniş azalanda və ya e-qaimə ləğv ediləndə — geri alma                        | Bağlanış özü geri alır (0.9.17): Dt 521.01 / Kt 241 qırmızı                                            |                |
| Ə7   | VM 175: azad satış olan ayda alış ƏDV-sinin bölgüsü                            | Meyar faizi göstərir, bölgünü mühasib əl ilə yazır (sual 1 ilə birlikdə)                               |                |
|      | **B. Əmək haqqı**                                                              |                                                                                                        |                |
| 3 ⚠  | 2026 dərəcələri (gəlir vergisi, DSMF, işsizlik, tibbi sığorta)                 | 3 / 10 / 14%, 200 azad; DSMF 3 / 10% və 22 / 15%; 0,5 + 0,5%; tibbi 2 / 0,5% hər tərəf                 |                |
| 4 ⚠  | 8 000 ₼-dan yuxarı gəlirdə işəgötürənin DSMF payı                              | 11% (DVX-nin 2026 flayeri)                                                                             |                |
| 5 ⚠  | 200 ₼ azad məbləğ ilə şəxsi güzəşt (400 / 200 / 100) birlikdə tətbiq olunurmu? | Xeyr — ən böyüyü; əlavə 50 ₼ (102.5) üstəlik                                                           |                |
| 6    | Artıq iş, bayram günü işi və gecə saatlarının əmsalları                        | Artıq iş × 2, bayram / istirahət günü × 2, gecə + 40%                                                  |                |
| 7    | 2026 istehsalat təqvimi                                                        | NK-nin 362 saylı qərarı: 241 gün, 1 922 saat; qısaldılmış gün yalnız B.e.–C.                           |                |
| 8    | Məzuniyyətin orta qazancı                                                      | 12 ay / ay sayı / 30,4; məzuniyyət, ödənişsiz, xəstəlik günü olan aylar çıxılır                        |                |
| 9    | Xəstəlik vərəqəsi                                                              | 4 rüb / təqvim günləri × staj faizi; 14 gün işəgötürən; 25 × minimum pensiya həddi tətbiq olunmur      |                |
| 10   | Ayın ortasında dəyişən maaş                                                    | Günlərə (tabeldə saatlara) görə; əlavələr ayın sonundakı maaşla                                        |                |
| 11   | Muzdlu iş bəyannaməsində "işçi sayı"                                           | Ayın əmək haqqında sətri olan hər işçi (yalnız xəstəlik müavinəti olan da)                             |                |
| 12   | Bankda bir ödənişlə bütün işçilərə maaş (reyestr)                              | Məbləğ işçilərin 533 borclarının cəminə tam bərabərdirsə — işçilər üzrə bölünür                        |                |
|      | **C. Vergi amortizasiyası və mənfəət vergisi**                                 |                                                                                                        |                |
| 13 ⚠ | Mənfəət vergisinin hesablanması və 20% dərəcə                                  | 20%; dekabr bağlanışında Dt 901 / Kt 521.04                                                            |                |
| 14 ⚠ | VM 114 normaları və metod                                                      | Nəqliyyat 25%, hesablama texnikası 25%, maşın 20%, bina 7%, digər 20%; vəsait üzrə azalan qalıq        |                |
| 15 ⚠ | İl ərzində alınan / satılan vəsait                                             | Alınan — tam il; satılan / silinən — həmin il amortizasiya yox, vergi qalıq dəyəri çıxılır             |                |
| 16   | Meyar-dan əvvəlki illərin zərəri                                               | Yarandığı il ilə bir dəfə yazılsın, Meyar 5 il özü istifadə etsin (indi hər il əl ilə)                 |                |
| 17   | 521.04-ə ödənişin hansı ilə aid olduğu                                         | Əvvəl keçən ilin borcu bağlanır, sonra bu ilin avansı                                                  |                |
| 18   | Kateqoriyanın qalığı 100 ₼-dan az olanda                                       | Tamamilə gəlirdən çıxılır (parametr)                                                                   |                |
| 19   | Mikro / kiçik sahibkar əmsalı (2 / 1,5)                                        | Şirkət parametri, standart 1                                                                           |                |
| 20   | Vergi amortizasiyasının yuvarlaqlaşdırılması                                   | Vəsait üzrə; bəyannamədə kateqoriyanın cəmi                                                            |                |
| 21   | Qeyri-maddi aktivin amortizasiyası (VM 116)                                    | İndi xərc kimi gəlirdən çıxılır; VM 116 qaydası — sonra                                                |                |
|      | **D. İllik maliyyə hesabatları**                                               |                                                                                                        |                |
| 22 ⚠ | Plan §8 misalının qəpikbəqəpik yoxlanması                                      | Mühasib misalı əl ilə hesablayıb Meyar-ın rəqəmləri ilə tutuşdursun                                    |                |
| 23   | Açılmış qalıqlar: alıcının Kt qalığı, malsatanın Dt qalığı hansı sətrə?        | Alıcının avansı → 54, malsatana artıq ödəniş → 24                                                      |                |
| 24   | Pul hərəkəti: faiz və 521.03 / 522 ödənişləri hansı sətirdə?                   | Faiz — əməliyyat; 521.03 / 522 — "işçilərin mükafatlandırılması"                                       |                |
| 25   | 343 / 341-dən birbaşa pul ödənişi — dividend?                                  | Dividend yalnız 534 / 344 üzrə; 343 / 341 ↔ pul — "digər ödənişlər"                                    |                |
| 26   | Ödənilməmiş nizamnamə kapitalı (301 ↔ 217)                                     | İndi 30-da elan edilmiş kapital, borc 21-də; lazım olsa 30-dan çıxılsın                                |                |
| 27   | Əl ilə yazılan kurs fərqi (valyuta satışı) pul hərəkətində                     | "Məzənnə fərqi" maddəli 611 / 731 ↔ 22 — "məzənnə təsiri" sətrinə                                      |                |
| 28   | Overdraft (bankda mənfi qalıq)                                                 | Belə qalsın (22-də mənfi görünür); real kredit xətti — 501 ilə                                         |                |
| 29   | Qarışıq qaimə (əsas vəsait + mal) pul hərəkətində                              | Bütövlükdə investisiya (nadirdir; sənədi ayırmaq olar)                                                 |                |
| 30   | Kapital ↔ M/Z xəbərdarlığının mətni                                            | Mətn kifayətdir; çaşdırarsa — fərqi yaradan yazılışlar sadalansın                                      |                |
|      | **E. E-qaimə və bank**                                                         |                                                                                                        |                |
| 31 ⚠ | "DVX-dən yenilə" hansı dövrü alsın?                                            | Bağlanış yoxdursa — keçən ayın 1-dən; bağlı aylar üçün ayda bir "son 3 ay" status yoxlaması            |                |
| 32   | "Mallar üzrə" ilə "Qaimələr üzrə" arasında 1–2 qəpik fərq                      | Real "Mallar üzrə" faylı ilə yoxlansın; təsdiqlənsə — sətir sayı qədər fərq ziddiyyət sayılmasın       |                |
| 33   | Çıxarışda eyni gün, eyni məbləğ, nömrəsiz iki ödəniş                           | Real bank faylları ilə yoxlansın; lazım olsa barmaq izinə qarşı tərəfin IBAN-ı əlavə edilsin           |                |
| 34   | Hesab planının təkrar oxunması (sürət) — texniki                               | İndi lazım deyil                                                                                       |                |
| 35   | Kassa orderlərinin yük testi CI-da — texniki                                   | Bank kimi CPU vaxtı ilə ölçülsün, hədd 10 s                                                            |                |

---

## A. ƏDV

### 1. VM 175 — mütənasib bölgü xəbərdarlığı

- **Nə soruşulur:** ayda həm ƏDV-yə cəlb olunan (18%), həm də azad satış olanda alışın ƏDV-sinin yalnız vergi tutulan satış payına düşən hissəsi əvəzləşdirilir (VM 175). Meyar bu bölgünü özü etmir, yalnız xəbərdarlıq verir. Sual: xəbərdarlıq hansı satışlarda çıxsın — yalnız azad, yoxsa cəlb olunmayan əməliyyatda da?
- **Niyə vacibdir:** MG Transport-un ayda 90 000 ₼ 18%-li daşıması və 10 000 ₼ azad (və ya cəlb olunmayan) satışı olsa, vergi tutulan pay 90%-dir: 5 000 ₼ alış ƏDV-sinin 4 500-ü əvəzləşdirilir, 500-ü xərcə gedir. Xəbərdarlıq olmasa, 500 ₼ artıq əvəzləşdirilər və DVX yoxlamasında maliyyə sanksiyası çıxa bilər. Beynəlxalq daşıma (0%) isə əvəzləşdirməni məhdudlaşdırmır.
- **Meyar indi:** xəbərdarlıq yalnız **azad** satış + alış ƏDV-si olanda. 0%-ə xəbərdarlıq yoxdur (vergi baxımından düzgündür). QERARLAR 2026-10-28 (mərhələ 9 §3) mətnində "azad və ya 0%" yazılıb — bu, kodla uyğun deyil.
- **Tövsiyə:** xəbərdarlıq **azad və cəlb olunmayan** satışda; QERARLAR mətni "azad (və cəlb olunmayan)" kimi düzəldilsin.
- **Alternativlər:** (a) yalnız azad (indiki kimi); (b) Meyar bölgünü özü hesablasın (faiz + əvəzləşdirilən məbləğ) — böyük iş, sonra.
- **Mühasib yoxlasın:** VM 175 (175.1–175.3), cəlb olunmayan əməliyyatların əvəzləşdirməyə təsiri; MG Transport-da azad / cəlb olunmayan əməliyyat ümumiyyətlə olurmu; beynəlxalq daşımanın 0% olduğu (VM 165.1.3).

### 2. ƏDV-li, e-qaiməsiz alış qaimələri

- **Nə soruşulur:** e-qaimə nömrəsi olmayan, amma ƏDV-li alış qaiməsi (məs. avtomatik uçota alınmış e-qaimə səhvən əl ilə ikinci dəfə, nömrəsiz yazılıb) aylıq "DVX ↔ uçot" müqayisəsinə düşmür. İş masasında ayrıca siqnal olsunmu?
- **Niyə vacibdir:** yanacaq alışı 1 180 ₼ (ƏDV 180) iki dəfə yazılsa, ikincisi heç yerdə qırmızı görünmür — yalnız ay bağlanışında "e-qaiməsi təsdiqlənməyib — 241-də qalır" çıxır. Dublikat xərc və 241-də yığılan ƏDV gec tapılır.
- **Meyar indi:** müqayisədə yalnız e-qaimə nömrəli qaimələr (QERARLAR 2026-10-16 §4); bağlanışda xəbərdarlıq.
- **Tövsiyə:** İş masasında "ƏDV-li, e-qaiməsiz alış qaimələri: N" siqnalı (yalnız alış).
- **Alternativlər:** belə qalsın (bağlanışdakı xəbərdarlıq kifayətdir).
- **Mühasib yoxlasın:** ƏDV-li alışın e-qaiməsiz əvəzləşdirilmədiyi (VM 175); belə qaimələr təcrübədə olurmu (məs. idxal, gömrük bəyannaməsi ilə ƏDV — onlar üçün siqnal yalançı olar).

## A1. ƏDV əvəzləşdirilməsi

Alışın ƏDV-si qaimə uçota alınanda 241-ə (kontragent, qaimə, dərəcə üzrə) yazılır. Ayın bağlanışında Meyar 241-dən əvəzləşdirilə bilən hissəni büdcə ilə hesablaşmaya keçirir: **Dt 521.01 ("Vergi (haqq)") / Kt 241**. Bu addım ay bağlanışının 4-cü addımıdır (FIFO və yenidən qiymətləndirmədən sonra, 801-dən əvvəl). ƏDV bəyannaməsində "Əvəzləşdirilən ƏDV" sətri bu yazılışdır, ay hələ bağlanmayıbsa — bağlanışın planı. Mənbələr: QERARLAR 2026-10-17 (mərhələ 5) §6, "İCRADA DƏQİQLƏŞDİ (5c)", "AUDİTDƏN SONRA" §3; `docs/MERHELE-5-AY-BAGLANISI.md` §4.3, §11 sual 1; `src/application/closing.ts` (`vatStep`); QERARLAR 2026-10-28 (mərhələ 9) §3; Mərhələ 9 auditi, qüsur 4.

Mərhələ 5-də mühasib yalnız bağlanışın misalını (§9) təsdiqləmişdi; o misalda əvəzləşdirmə yox idi (alışın ƏDV-si e-qaiməsiz idi, 241-də qaldı). Ona görə aşağıdakı qaydaların heç biri hələ mühasib tərəfindən təsdiqlənməyib.

**0.9.17-də dəyişdi** (istifadəçi, 30.10.2026; QERARLAR 2026-10-30): ƏDV ödəyicisi olan fərdi sahibkarın ƏDV-si yalnız depozitdən ödənəndə əvəzləşdirilir (Ə2); ödəniş azalanda (qaytarma, storno) və ya DVX e-qaiməni ləğv edəndə bağlanış əvəzləşdirməni özü geri alır (Ə6); avansla əvvəlcədən depozitdən ödənilmiş ƏDV e-qaimə təsdiqlənən ayda əvəzləşdirilir (Ə5) — testlə yoxlanıb.

### Ə1. ⚠ Hansı ƏDV əvəzləşdirilir

- **Nə soruşulur:** ay bağlanışında alış qaiməsinin ƏDV-si yalnız iki şərt birlikdə ödənəndə əvəzləşdirilir: (1) qaiməyə bağlanmış e-qaimə DVX-də **təsdiqlənib**; (2) ƏDV hissəsi ay sonuna qədər **ƏDV depozit hesabından (224.04)** ödənilib. Əvəzləşdirilən məbləğ DVX-dəki e-qaimənin ƏDV-sindən çox ola bilməz (qaimədə ƏDV fərqli yazılıbsa, fərq 241-də qalır və bağlanış qeyd yazır). Bu qayda düzgündürmü?
- **Niyə vacibdir:** MG Transport-un əsas alışları — yanacaq, ehtiyat hissələri, təmir. Oktyabrda yanacaq e-qaiməsi 11 800 ₼ (ƏDV 1 800), DVX-də təsdiqlənib. 15.10-da malsatana 10 000 cari hesabdan, 1 800 depozitdən ödənilib → oktyabr bağlanışında **Dt 521.01 / Kt 241 1 800,00**, oktyabrın ödənilməli ƏDV-si 1 800 azalır. Depozitdən yalnız 900 ödənibsə — 900 əvəzləşdirilir, 900 241-də gözləyir. Qayda səhvdirsə, hər ay ödənilməli ƏDV yanlışdır.
- **Meyar indi:** yuxarıdakı kimi. Depozitdən ödəniş bank sənədinin ƏDV bölgüsündən gəlir (mərhələ 3: depozit sətri qaimənin yalnız ƏDV hissəsini bağlayır).
- **Tövsiyə:** təsdiq.
- **Alternativlər:** (a) ödənişdən asılı olmayaraq ayın bütün təsdiqlənmiş alış e-qaimələrinin ƏDV-si (mərhələ 5 planının §11 alternativi); (b) e-qaimənin ayında deyil, ödəniş ayında — Meyar elə də edir (Ə5).
- **Mühasib yoxlasın:** VM 175.1 (əvəzləşdirmənin şərtləri: e-qaimə və ƏDV-nin depozit hesabından ödənilməsi), ƏDV depozit hesabı qaydaları; əvəzləşdirmənin hansı aya düşdüyü (e-qaimənin, yoxsa ödənişin ayı).

### Ə2. ⚠ Fərdi sahibkar, xarici kontragent və valyuta qaiməsi

- **Nə soruşulur:** (a) ƏDV ödəyicisi olan **fərdi sahibkar** (kontragentin növü "fiziki şəxs") — 0.9.17-dən hüquqi şəxs kimi: ƏDV yalnız depozitdən ödənəndə əvəzləşdirilir, cari hesabdan ödəniş yalnız ƏDV-siz hissəni bağlayır. (b) **Xarici kontragent** və **valyuta qaiməsi** — depozit axtarılmır, qaimənin ödənilən hissəsinə mütənasib ƏDV əvəzləşdirilir. E-qaimənin DVX təsdiqi hər halda şərtdir. Satışda fiziki şəxs alıcı əvvəlki kimi bütöv məbləği cari hesaba ödəyir (onun depozit hesabı yoxdur). Doğrudurmu?
- **Niyə vacibdir:** fərdi sahibkardan təkər alışı 5 900 ₼ (ƏDV 900). Bütün 5 900 cari hesabdan ödənilsə — 0.9.17-dən **heç nə əvəzləşdirilmir** (əvvəl 900 əvəzləşdirilirdi), 900 ödənilməmiş ƏDV kimi 241-də və 531-də qalır; 900 depozitdən ödənəndə — 900 əvəzləşdirilir.
- **Meyar indi (0.9.17):** yuxarıdakı kimi; QERARLAR 2026-10-17 §6-nın "fiziki şəxs malsatana cari hesabdan" hissəsini QERARLAR 2026-10-30 əvəz edir.
- **Tövsiyə:** fərdi sahibkar üçün təsdiq. Xarici kontragent üçün — VM 169 (əks-hesablama) qaydası ayrıca (sonra), valyuta qaiməsi — mühasib desin.
- **Alternativlər:** əvvəlki qayda (fərdi sahibkara cari hesabdan ödənilən ƏDV də mütənasib).
- **Mənbələrin ziddiyyəti:** xarici malsatan Azərbaycanda e-qaimə vermir, ona görə "DVX-də təsdiqlənmiş e-qaimə" şərti xarici qaimədə praktik olaraq heç vaxt ödənmir. Qeyri-rezidentin xidmətinə görə ƏDV (VM 169 — ƏDV-ni alıcı özü hesablayır) Meyar-da yoxdur.
- **Mühasib yoxlasın:** VM 175.1, VM 169, ƏDV depozit hesabı qaydası fərdi sahibkarlar üçün; MG Transport-un xarici malsatanları varmı (məs. xaricdə təmir, yanacaq).

### Ə3. ⚠ Artıq ƏDV növbəti aya keçir

- **Nə soruşulur:** ayda əvəzləşdirilən ƏDV satışın ƏDV-sindən çox olanda (məs. tır alınan ay) bəyannamə "Artıq — növbəti aya keçir" yazır. Amma növbəti ayın bəyannaməsində "Büdcəyə ödənilməli" yalnız **həmin ayın** hesablanmış − əvəzləşdirilən fərqidir; keçən aydan qalan artıq ondan çıxılmır, yalnız "521.01 ilə tutuşma" bölməsində ayın əvvəlinə qalıq kimi görünür. Necə olmalıdır?
- **Niyə vacibdir:** oktyabrda tır alınıb: əvəzləşdirilən 27 000, satışın ƏDV-si 9 000 → artıq 18 000. Noyabrda hesablanmış 9 000, əvəzləşdirilən 2 000 → bəyannamənin sətri **7 000 ödənilməli** göstərir, halbuki keçən ayın artığı ilə büdcəyə heç nə ödənilmir (521.01-in noyabr sonuna qalığı −11 000 — yenə artıqdır). Mühasib sətirdəki rəqəmlə ödəniş etsə, 7 000 ₼ artıq ödəyər.
- **Meyar indi:** artıq 521.01-in debet qalığı kimi qalır; bəyannamə onu tutuşma bölməsində göstərir, "ödənilməli" sətrində yox.
- **Tövsiyə:** bəyannaməyə "Əvvəlki aylardan keçən artıq ƏDV" sətri və "Ödənilməli (keçən artıq çıxılmaqla)" sətri əlavə olunsun (kiçik proqram dəyişikliyi); qaytarma tələb edilibsə — mühasib qeyd edir.
- **Alternativlər:** belə qalsın — mühasib "521.01 ilə tutuşma"nın son qalığına baxır.
- **Mühasib yoxlasın:** VM-in artıq ödənilmiş / əvəzləşdirilməmiş ƏDV-nin növbəti aylara keçirilməsi və qaytarılması maddələri (VM 176 ətrafı); e-taxes ƏDV bəyannaməsinin həmin sətri.

### Ə4. İdxal ƏDV-si (gömrük)

- **Nə soruşulur:** idxalda (məs. xaricdən tır və ya ehtiyat hissəsi) ƏDV gömrükdə ödənilir və e-qaimə yoxdur — sənəd gömrük bəyannaməsidir. Meyar-da bunun üçün qayda yoxdur: bağlanış yalnız 241-də **qaiməyə bağlı** qalıqlara baxır. Necə yazılsın?
- **Niyə vacibdir:** tır 150 000 ₼ idxal olunsa, gömrükdə 27 000 ƏDV ödənilir. Bu, alış qaiməsinə ƏDV kimi yazılsa, bağlanış onu "e-qaiməsi təsdiqlənməyib — 241-də qalır" kimi həmişəlik saxlayar; əl ilə 241-ə yazılsa (qaiməsiz) — bağlanış ona toxunmur. Hər iki halda 27 000 ₼ əvəzləşdirilmir, ödənilməli ƏDV artıq çıxır.
- **Meyar indi:** yalnız əl ilə: mühasib gömrük ödənişini Dt 241 / Kt 223 (və ya 531 gömrük kontragenti) ilə, əvəzləşdirməni isə əl ilə əməliyyatla **Dt 521.01 / Kt 241** yazır. Bəyannamədə "alış ƏDV-si" və "əvəzləşdirilən" sətirləri 241 / 521.01-dən gəldiyi üçün rəqəmlər düzgün çıxır.
- **Tövsiyə:** indi əl ilə (yuxarıdakı kimi). İdxal tez-tez olarsa — "Gömrük bəyannaməsi" sənədi (ƏDV, gömrük rüsumu, əvəzləşdirmə bağlanışda) növbəti mərhələdə. Sual 2-nin siqnalı belə qaimələri saymamalıdır.
- **Alternativlər:** idxal qaiməsinə "gömrük bəyannaməsi nömrəsi" sahəsi; onunla e-qaimə şərti əvəzlənsin.
- **Mühasib yoxlasın:** VM 175 (idxal ƏDV-sinin əvəzləşdirilməsi — gömrük orqanına ödəniş sənədi ilə), Gömrük Məcəlləsi; MG Transport-un idxalı olurmu.

### Ə5. Nə vaxt əvəzləşdirilir — gözləyən ƏDV

- **Nə soruşulur:** ƏDV iki tarixdən **sonrakının** ayında əvəzləşdirilir: e-qaimənin (DVX təsdiqi ilə) ayı və ƏDV-nin depozitdən ödənildiyi ay. O vaxta qədər 241-də qalır; hər sonrakı bağlanış bütün keçmiş qaimələri yenidən yoxlayır. Bağlanış "N qaimənin ƏDV-si hələ ödənilməyib" qeydi və təsdiqlənməyənlər üçün xəbərdarlıq yazır.
- **Niyə vacibdir:** sentyabrın təmir e-qaiməsi (ƏDV 540) noyabrda ödənilir → **noyabr**. Avans: ƏDV sentyabrda depozitdən əvvəlcədən ödənilib, e-qaimə oktyabrda gəlib → **oktyabr** (0.9.17-də testlə yoxlanıb). Qismən ödəniş — ödənilən hissə həmin ayda, qalanı ödənilən ayda.
- **Meyar indi:** belə; 241-in qalığı bəyannamədə "Əvəzləşdirilməmiş" sətrində və "241-də gözləyir" siyahısında (səbəbi ilə).
- **Tövsiyə:** təsdiq.
- **Alternativlər:** e-qaimənin ayına geri düzəliş (bağlanmış ayı dəyişmək — Meyar-da qadağandır).
- **Mühasib yoxlasın:** VM 175 — gec ödənilən və avansla ödənilən ƏDV hansı hesabat dövründə əvəzləşdirilir.

### Ə6. Ödəniş azalanda və ya e-qaimə ləğv ediləndə — geri alma

- **Nə soruşulur:** 0.9.17-dən əvəzləşdirmədən sonra depozit ödənişi azalanda (malsatan ƏDV-ni depozitə qaytarır, ödəniş sənədi ləğv olunur) və ya DVX e-qaiməni ləğv edəndə növbəti bağlanış əvəzləşdirilmiş ƏDV-ni **özü geri alır**: Dt 521.01 / Kt 241 qırmızı (mənfi məbləğlə), qeyd "əvəzləşdirilmiş ƏDV … geri alınır". Yalnız bağlanışın özünün əvəzləşdirdiyi qədər geri alınır; mühasib əvvəlcədən əl ilə Dt 241 / Kt 521.01 yazıbsa — təkrar geri alınmır. Ödəniş yenə gələndə yenə əvəzləşdirilir.
- **Niyə vacibdir:** malsatan oktyabrda 450 ₼ ƏDV-ni depozitə qaytarır → oktyabr bağlanışı 450 geri alır, oktyabrın ödənilməli ƏDV-si 450 artır. Əvvəl mühasib bunu unudarsa, ƏDV az ödənilirdi.
- **Meyar indi (0.9.17):** yuxarıdakı kimi. Qaytarma bank sənədində **qaiməyə bağlanmalıdır** (531-in sətrində qaimə seçilir) — qaiməsiz qaytarma malsatanın borcu kimi qalır və geri alma olmur.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** əl ilə (əvvəlki qayda).
- **Mühasib yoxlasın:** VM 175 (qaytarma, qiymət endirimi və ləğv edilmiş e-qaimə zamanı əvəzləşdirmənin düzəldilməsi), düzəliş e-qaiməsi.

### Ə7. VM 175 — azad satış olan ayda bölgü

- **Nə soruşulur:** sual 1 xəbərdarlığın **nə vaxt** çıxdığını soruşur; bu sual — **necə yazılsın**. Meyar bütün şərtləri ödənən ƏDV-ni əvəzləşdirir, sonra ƏDV bəyannaməsi "vergi tutulan pay: 90,00%" xəbərdarlığını verir. Əvəzləşdirilməyən hissəni mühasib əl ilə yazır.
- **Niyə vacibdir:** 18% satış 90 000, azad 10 000, alış ƏDV-si 5 000 → 500 ₼ əvəzləşdirilməməlidir: mühasib Dt 721 (və ya 701) / Kt 521.01 500,00 yazır (xərcə aid edilir).
- **Meyar indi:** yalnız xəbərdarlıq (faizlə).
- **Tövsiyə:** belə qalsın (MG Transport-da azad satış nadirdir); mühasib düzəlişin yazılışını təsdiqləsin. Tez-tez olarsa — bağlanış bölgünü özü etsin.
- **Alternativlər:** bağlanış bölgünü özü yazsın.
- **Mühasib yoxlasın:** VM 175 (mütənasib bölgü, illik dəqiqləşdirmə varmı), əvəzləşdirilməyən ƏDV-nin xərcə aid edilməsi.

### Mənbələrin ziddiyyətləri

1. **"Azad və ya 0%"** — QERARLAR 2026-10-28 (mərhələ 9) §3 VM 175 xəbərdarlığını "azad və ya 0% satış"a bağlayır, kod isə yalnız azad satışda xəbərdarlıq verir (0% əvəzləşdirməni məhdudlaşdırmır — kod vergi baxımından düzgündür). Sual 1.
2. **"Ay ərzində" və "ay sonuna qədər"** — mərhələ 5 planı (§4.3) "ay ərzində ƏDV hissəsi ödənilmiş" deyir, kod isə ay sonuna qədər ödənilmiş hər şeyi (keçmiş aylar daxil) götürür. Plan özü də "ödənilməmiş sonrakı ayın bağlanışında yoxlanır" deyir — kod bu ikinci cümləyə uyğundur. Ə5.
3. **"Artıq — növbəti aya keçir"** — bəyannamənin sətri belə deyir, amma növbəti ayın "ödənilməli"si onu nəzərə almır. Ə3.
4. **Xarici malsatan** — qayda "cari hesabdan ödəniş, mütənasib" deyir, amma e-qaimə şərti xarici malsatanda ödənmir; nəticədə xarici alışın ƏDV-si heç vaxt avtomatik əvəzləşdirilmir. Ə2.
5. **Fiziki şəxs** — QERARLAR 2026-10-17 "cari hesabdan" deyirdi; 0.9.17-dən (QERARLAR 2026-10-30) ƏDV ödəyicisi olan fərdi sahibkara ƏDV yalnız depozitdən. Mühasib təsdiqləsin. Ə2.

## B. Əmək haqqı

### 3. ⚠ 2026 dərəcələri

- **Nə soruşulur:** Meyar-ın başlanğıc dəsti (01.01.2026-dan) düzgündürmü?
  - gəlir vergisi (qeyri-neft, qeyri-dövlət sektoru): 2 500-ə qədər hissə 3%, 2 500–8 000 hissə 10%, 8 000-dən yuxarı 14%; gəlir ≤ 2 500 olanda 200 ₼ azad;
  - DSMF: işçi — 200-ə qədər 3%, qalanı 10%; işəgötürən — 200-ə qədər 22%, 200–8 000 hissə 15% (8 000-dən yuxarı — sual 4);
  - işsizlik: işçi 0,5%, işəgötürən 0,5%;
  - tibbi sığorta: 2 500-ə qədər 2% + 2%, yuxarısı 0,5% + 0,5%;
  - pillələr marjinaldır (hər dərəcə öz hissəsinə), hər tutulma ayrıca qəpiyə yuvarlaqlaşdırılır (yarı yuxarı).
- **Niyə vacibdir:** hər ay hər işçinin maaşına, 521.03 / 522-yə və muzdlu iş bəyannaməsinə düşür. Sürücünün maaşı 1 500 ₼: gəlir vergisi (1 500 − 200) × 3% = 39,00; DSMF 6 + 130 = 136,00; işsizlik 7,50; tibbi 30,00; **əlinə 1 287,50**. İşəgötürən: DSMF 44 + 195 = 239,00, işsizlik 7,50, tibbi 30,00 — **276,50**. Bir faizlik səhv 10 sürücüdə ayda yüzlərlə manat fərq və bəyannamə düzəlişi deməkdir.
- **Meyar indi:** yuxarıdakı dəst hər şirkətə yazılıb (Əmək haqqı → Dərəcələr). Uçotdakı ayın istifadə etdiyi dəst dəyişdirilmir; dəyişiklik — yalnız yeni tarixli dəst.
- **Tövsiyə:** dəst olduğu kimi təsdiqlənsin.
- **Alternativlər:** hansısa dərəcə səhvdirsə — mühasib Dərəcələr cədvəlinə düzgün tarixli yeni dəst yazır (proqram dəyişmir).
- **Mühasib yoxlasın:** VM 101 (gəlir vergisinin 2026 dərəcələri, 200 ₼ azadolma), "Sosial sığorta haqqında" Qanun (DSMF dərəcələri), "İşsizlikdən sığorta haqqında" Qanun, "Tibbi sığorta haqqında" Qanun (2 500 həddi); taxes.gov.az-ın 2026 flayeri.

### 4. ⚠ DSMF 8 000 ₼-dan yuxarı — 11%

- **Nə soruşulur:** aylıq gəlirin 8 000 ₼-dan yuxarı hissəsindən işəgötürənin DSMF payı 11%-dirmi (işçinin payı 10% qalır)?
- **Niyə vacibdir:** direktorun maaşı 10 000 ₼ olsa, işəgötürənin DSMF-i 1 214 + 2 000 × 11% = **1 434,00**; 15% ilə 1 514,00 olardı — ayda 80 ₼, ildə 960 ₼ fərq. Mənbələr əvvəl ziddiyyətli idi (mərhələ 8 planı 15% ilə başlamışdı).
- **Meyar indi:** üç pillə — 22% (200-ə qədər), 15% (200–8 000), 11% (8 000-dən yuxarı); mənbə — DVX-nin 2026 flayeri ("1214 manat + 8000 manatdan yuxarı hissənin 11%-i"). Muzdlu iş bəyannaməsi 8 000-dən çox gəlir olub dəstdə 11% pilləsi yoxdursa xəbərdarlıq verir.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** 15% davam etsin (yeni dəst yazılır).
- **Mühasib yoxlasın:** "Sosial sığorta haqqında" Qanunun 2026 redaksiyası; [DVX flayeri](https://taxes.gov.az/uploads/2026/flayer/1_12.pdf).

### 5. ⚠ 200 ₼ azadolma və şəxsi güzəştlər

- **Nə soruşulur:** gəliri ≤ 2 500 olan işçidə 2026-nın 200 ₼ azadolması ilə VM 102-nin şəxsi güzəşti (400 / 200 / 100 ₼) toplanırmı?
- **Niyə vacibdir:** şəhid ailəsi üzvü (400 ₼ güzəşt), maaşı 1 500: "ən böyüyü" ilə vergi (1 500 − 400) × 3% = 33,00; toplansa (1 500 − 600) × 3% = 27,00. Fərq kiçikdir, amma hər ay və bəyannamədə.
- **Meyar indi:** **ən böyüyü** tətbiq olunur (VM 102.7 məntiqi), əlavə 50 ₼ (102.5) üstəlik; güzəşt yalnız "əsas iş yeri"ndə, qüvvədə olduğu tarixlərlə.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** toplansın (dərəcələr dəstinin parametri kimi dəyişdirilə bilər).
- **Mühasib yoxlasın:** VM 102 (102.5, 102.7) və 2026 dəyişikliyindəki 200 ₼ azadolmanın şəxsi güzəştlə münasibəti; DVX-nin izahı.

### 6. Tabel əmsalları — artıq iş, bayram günü, gecə

- **Nə soruşulur:** artıq iş saatı × 200%, istirahət / bayram günü işlənən saat × 200%, gecə saatı + 40% düzgündürmü?
- **Niyə vacibdir:** sürücülər gecə və bayram günü yolda olur. Maaş 1 500, ayın norması 168 saat → saatlıq 8,93; 10 saat artıq iş = **178,57**, 20 gecə saatı = **71,43** əlavə. Əmsal kollektiv müqavilədə fərqlidirsə, hər ay hər sürücüdə fərq.
- **Meyar indi:** əmsallar Dərəcələr dəstindədir (200 / 200 / 40); əmək haqqı tabeldən hesablanır.
- **Tövsiyə:** təsdiq; şirkətin əmək / kollektiv müqaviləsində başqa rəqəm varsa — dəstdə dəyişdirilsin.
- **Alternativlər:** bayram günü işinə əvəzində istirahət günü verilir (onda yalnız tabeldə kod, əlavə ödəniş yox).
- **Mühasib yoxlasın:** Əmək Məcəlləsinin artıq iş, gecə işi və bayram / istirahət günü işinin ödənişi maddələri; MG Transport-un əmək müqavilələri.

### 7. 2026 istehsalat təqvimi

- **Nə soruşulur:** Meyar-dakı 2026 təqvimi (bayramlar, köçürülmüş günlər, qısaldılmış günlər) Nazirlər Kabinetinin 02.12.2025 tarixli 362 saylı qərarına uyğundurmu? 2027 təqvimini kim yazacaq?
- **Niyə vacibdir:** maaşın mütənasibliyi (işə qəbul / çıxma, məzuniyyət, xəstəlik) və tabelin norması təqvimdən gəlir. Məs. 2–22 noyabr məzuniyyəti 19 gündür (8 və 9 noyabr bayram), 21 yox. 2027-ci il təqvimi yazılmasa, Meyar yalnız şənbə / bazarı istirahət sayır (xəbərdarlıqla).
- **Meyar indi:** 2026 — 241 iş günü, 1 922 saat (nazirliyin cədvəli ilə ay-ay tutuşur); qısaldılmış gün yalnız B.e.–C. ola bilər; bağlanmış ayların təqvimi dəyişmir.
- **Tövsiyə:** 2026 təsdiq; 2027 qərarı çıxan kimi mühasib Əmək haqqı → İstehsalat təqvimi-ndə yazsın.
- **Alternativlər:** —
- **Mühasib yoxlasın:** NK-nin 362 saylı qərarı; 2027 üçün yeni qərar.

### 8. Məzuniyyətin orta qazancı

- **Nə soruşulur:** orta günlük = əvvəlki 12 tam ayın (Meyar-da hesablanmış) qazancı / ay sayı / 30,4. İçində məzuniyyət, ödənişsiz məzuniyyət və ya xəstəlik günü olan ay çıxılır (belə ay qalmırsa — hamısı). Tabelin artıq iş, gecə, bayram ödənişləri qazanca daxildir. Düzgündürmü?
- **Niyə vacibdir:** sürücü 12 ayda 18 000 ₼ qazanıb: 18 000 / 12 / 30,4 = 49,34 ₼ günlük × 21 gün = **1 036,14**. İyulda xəstə olubsa və iyul çıxılmasa, azalmış iyul maaşı ortanı aşağı salar.
- **Meyar indi:** yuxarıdakı kimi; Meyar-dan əvvəlki aylar üçün mühasib orta aylığı əl ilə yazır; iki aya düşən məzuniyyət günlərinə görə bölünür; əsasda hesablama və çıxılan aylar yazılır.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** ay çıxılmasın, yalnız həmin günlər çıxılsın (günlərlə hesab — NK qərarına uyğun ola bilər).
- **Mühasib yoxlasın:** Nazirlər Kabinetinin orta əmək haqqının hesablanması qaydası (137 saylı qərar); Əmək Məcəlləsi (məzuniyyət haqqı).

### 9. Xəstəlik vərəqəsi

- **Nə soruşulur:** orta günlük = əvvəlki 4 tam rübün sığortaya cəlb olunan gəliri / təqvim günləri (əvvəlki xəstəlik günləri çıxılır) × staj faizi (60 / 80 / 100); ilk 14 təqvim günü işəgötürən hesabına, qalanı DSMF; davam vərəqəsi (bitişik tarix) 14 günü təkrar vermir; müavinətdən yalnız gəlir vergisi tutulur; aylıq yuxarı hədd (25 × minimum pensiya) **tətbiq olunmur**. Düzgündürmü?
- **Niyə vacibdir:** sürücü 10 gün xəstədir, 4 rüb gəliri 18 000 / 365 = 49,32 ₼ × 10 = **493,20** — tam işəgötürəndən. Yüksək maaşlıda hədd tətbiq olunmasa, müavinət artıq hesablanar.
- **Meyar indi:** yuxarıdakı kimi (01.05.2026 qaydası); 6 aydan az staj — xəbərdarlıq; həddi mühasib orta günlüyü əl ilə məhdudlaşdıraraq tətbiq edir.
- **Tövsiyə:** təsdiq; yüksək maaşlı işçi varsa — həddin avtomatik tətbiqi növbəti versiyada.
- **Alternativlər:** hədd parametr kimi əlavə edilsin.
- **Mühasib yoxlasın:** "Sosial sığorta haqqında" Qanun və müavinətlərin hesablanması qaydası (01.05.2026 redaksiyası), 14 günlük işəgötürən hissəsi, staj faizləri, yuxarı hədd.

### 10. Ayın ortasında dəyişən maaş

- **Nə soruşulur:** maaş 15-dən artırılanda ayın maaşı günlərə görə (təqvimin iş günləri; tabel varsa — saatlara) hər günün öz maaşı ilə; tabelin əlavələri ayın sonundakı maaşın saatlığı ilə. Düzgündürmü?
- **Niyə vacibdir:** 1 500 → 1 800, oktyabrın 22 iş günündən 12-si yeni maaşla: 1 500 × 10/22 + 1 800 × 12/22 = 681,82 + 981,82 = **1 663,64**.
- **Meyar indi:** belə; işçinin kartında maaşın tarixçəsi; bağlı dövrə tarix qoyulmur.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** təqvim günlərinə görə; yeni maaş yalnız növbəti aydan.
- **Mühasib yoxlasın:** Əmək Məcəlləsi; şirkətin əmr praktikası.

### 11. Muzdlu iş bəyannaməsində işçi sayı

- **Nə soruşulur:** "işçi sayı" — ayın əmək haqqında sətri olan hər işçi, yalnız xəstəlik müavinəti alan (gross 0) da daxil. e-taxes formasının tərifi belədirmi?
- **Niyə vacibdir:** 12 sürücüdən biri bütün ay xəstədir → Meyar 12 yazır; forma "faktiki işləyən" istəyirsə 11 olmalıdır.
- **Meyar indi:** 12.
- **Tövsiyə:** mühasib e-taxes formasının tərifini təsdiqləsin; fərqlidirsə — qayda dəyişir.
- **Alternativlər:** gross > 0 olanlar; ayın son gününə siyahıda olanlar.
- **Mühasib yoxlasın:** muzdlu işlə bağlı ödəmə mənbəyindən vergi və sosial sığorta bəyannaməsinin təlimatı.

### 12. Əmək haqqı reyestri

- **Nə soruşulur:** çıxarışda işçi tanınmayan bir əmək haqqı ödənişi 2+ işçinin 533 borclarının cəminə **tam** bərabərdirsə — Meyar onu işçilər üzrə sətirlərə bölərək təklif edir; bərabər deyilsə — mühasib seçir. Uyğundurmu?
- **Niyə vacibdir:** 12 sürücüyə bankdan bir ödəniş 15 450 ₼. Bölünməsə 533 işçilər üzrə yanlış qalır.
- **Meyar indi:** belə (yalnız təklif, avtomatik yazılmır).
- **Tövsiyə:** təsdiq; bank reyestr faylı verirsə — onun yüklənməsi sonra.
- **Alternativlər:** həmişə əl ilə.
- **Mühasib yoxlasın:** bankın reyestr praktikası (çıxarışda bir sətir yoxsa hər işçi üzrə).

## C. Vergi amortizasiyası və mənfəət vergisi

### 13. ⚠ Mənfəət vergisinin hesablanması və 20%

- **Nə soruşulur:** vergi tutulan mənfəət = gəlirlər (601 − 602–604, 611, 631) − gəlirdən çıxılan xərclər (uçot amortizasiyası, silinən / satılan vəsaitin uçot qalığı və "gəlirdən çıxılmır" maddələri xaric) − vergi amortizasiyası − satılan vəsaitin vergi qalıq dəyəri ± mühasibin düzəlişləri − keçmiş illərin zərəri (5 il); vergi = 20%; il ərzində 521.04-ə ödənilən çıxılır. Yazılış dekabr bağlanışında: Dt 901 / Kt 521.04, Dt 341 / Kt 901. Düzgündürmü?
- **Niyə vacibdir:** MG Transport-un illik mənfəət vergisi bəyannaməsi buradan çıxır. 100 000 ₼ vergi tutulan mənfəət → **20 000** vergi. Cərimə, sanksiya kimi xərclər "gəlirdən çıxılmır" bayrağı qoyulmasa vergi az çıxır.
- **Meyar indi:** belə; dərəcə ilin parametri; təmir limiti (VM 115), təmsilçilik və ezamiyyət normaları — düzəliş sətri ilə; cari vergi ödəmələrinin (avans) hesablanması yoxdur.
- **Tövsiyə:** təsdiq; mühasib Siyahılar → Xərc maddələri-ndə "Gəlirdən çıxılmır" bayrağını lazım olan maddələrə qoysun.
- **Alternativlər:** mənfəət vergisi ayrıca sənədlə (bağlanışdan kənar) — 341 / 343 qarışıqlığı yaradır, tövsiyə olunmur.
- **Mühasib yoxlasın:** VM 105.1 (20%), VM-in gəlirdən çıxılan / çıxılmayan xərclər maddələri, VM 115 (təmir), VM 121 (zərər), cari vergi ödəmələri (avans) qaydası.

### 14. ⚠ VM 114 normaları və metod

- **Nə soruşulur:** kateqoriyalar vəsaitin qrupundan: bina, tikili, qurğu 7%; maşın və avadanlıq 20%; hesablama texnikası 25%; nəqliyyat 25%; digər 20% (yuxarı normalar; il üzrə aşağısı seçilə bilər). Metod: azalan qalıq — il sonuna qalıq × norma, **vəsait üzrə** (kateqoriyanın cəmi eynidir). Düzgündürmü?
- **Niyə vacibdir:** MG Transport-un əsas aktivləri tırlardır. Tır 150 000 ₼ (ƏDV-siz): vergidə 1-ci il 37 500, 2-ci il (112 500 × 25%) 28 125; uçotda 60 ayla 30 000 / il. Normanın səhvi birbaşa mənfəət vergisinə düşür (25% əvəzinə 20% — 7 500 ₼ az amortizasiya, 1 500 ₼ çox vergi).
- **Meyar indi:** belə; heç nə yazılmır — yalnız bəyannamənin rəqəmidir; hesabat "Vergi amortizasiyası" (kateqoriyalar, uçotla müqayisə). Normadan aşağı seçilən hissənin gələcəyə keçməsi (VM 114.4) yoxdur; bina üçün obyekt üzrə ayrıca qayda yoxlanmayıb.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** kateqoriya üzrə hesab (vəsait üzrə yox) — nəticə bir neçə qəpik fərqlənir (sual 20).
- **Mühasib yoxlasın:** VM 114.3 (normalar, nəqliyyatın kateqoriyası), 114.4, binalar üçün qayda.

### 15. ⚠ İl ərzində alınan və satılan vəsait

- **Nə soruşulur:** il ərzində istismara verilən vəsait il sonuna qalığa **tam** daxildir (tam illik norma); satılan / silinən vəsait həmin il amortizasiyasızdır, onun vergi qalıq dəyəri çıxılır. 31.12 tarixli başlanğıc qalıq növbəti ilə düşür.
- **Niyə vacibdir:** tır dekabrda alınsa da 37 500 ₼ vergi amortizasiyası (7 500 ₼ vergi qənaəti) — bu, böyük rəqəmdir və DVX yoxlamasında sual doğura bilər. Satılan tırın vergi qalığı 84 375, satış qiyməti 90 000 (ƏDV-siz) → 5 625 gəlir.
- **Meyar indi:** belə (vergi.az izahına əsasən).
- **Tövsiyə:** təsdiq.
- **Alternativlər:** il ərzində alınan — aylara mütənasib; satılan ildə də amortizasiya.
- **Mühasib yoxlasın:** VM 114.3 ("vergi ilinin sonuna balans üzrə qalıq dəyər"), DVX-nin izahları.

### 16. Meyar-dan əvvəlki zərər

- **Nə soruşulur:** Meyar 2026-dan istifadə olunur; 2025-in zərəri indi yalnız həmin ilin parametri kimi əl ilə yazılır, gələn ilə özü keçmir və Meyar-ın öz zərərlərindən əvvəl (ən köhnə kimi) istifadə olunmur.
- **Niyə vacibdir:** 2025 zərəri 30 000, 2026 mənfəəti 20 000 → 2026-da 20 000 çıxılır, 10 000 2027-yə qalır. İndi mühasib 2027-də 10 000-i yenidən əl ilə yazmalıdır — unudulsa, 2 000 ₼ artıq vergi.
- **Meyar indi:** hər il üçün ayrıca, əl ilə.
- **Tövsiyə:** zərər **yarandığı il** ilə bir dəfə yazılsın; Meyar onu hovuzda ən köhnə zərər kimi 5 il özü istifadə etsin (kiçik proqram dəyişikliyi).
- **Alternativlər:** indiki kimi qalsın.
- **Mühasib yoxlasın:** VM 121 (5 il, köhnədən başlayaraq); MG Transport-un 2021–2025 bəyannamələrində köçürülməmiş zərər varmı.

### 17. 521.04 ödənişinin bölgüsü

- **Nə soruşulur:** il ərzində 521.04-ə ödəniş əvvəlcə keçən ilin borcunu bağlayır, qalanı bu ilin avansıdır.
- **Niyə vacibdir:** 2026 vergisi 20 000 hələ ödənməyib, fevral 2027-də 5 000 avans ödənilir → Meyar onu 2026 borcuna sayır, 2027 bəyannaməsində "ödənilib" 5 000 az görünür.
- **Meyar indi:** belə ("Vergi (haqq)" ödəniş növü; faiz və sanksiya sayılmır).
- **Tövsiyə:** belə qalsın. DVX-də ödəniş il üzrə ayrılırsa — 521.04-ə "hansı il" subkontosu əlavə edilsin.
- **Alternativlər:** subkonto indi.
- **Mühasib yoxlasın:** DVX-nin şəxsi hesab vərəqəsində ödənişlərin illərə necə bölündüyü.

### 18. 100 ₼ həddi

- **Nə soruşulur:** kateqoriyanın il sonuna qalığı (amortizasiyadan sonra) 100 ₼-dan azdırsa, tamamilə gəlirdən çıxılır.
- **Niyə vacibdir:** "hesablama texnikası" kateqoriyasında 3 köhnə kompüterin qalığı 80 ₼ → bu il tam çıxılır. Rəqəm kiçikdir, amma qayda mənbədə tam yoxlanmayıb.
- **Meyar indi:** belə, hədd parametrdir.
- **Tövsiyə:** təsdiq və ya düzgün hədd.
- **Alternativlər:** hədd yoxdur.
- **Mühasib yoxlasın:** VM 114 (qalığın tam silinməsi şərti).

### 19. Mikro / kiçik sahibkar əmsalı

- **Nə soruşulur:** VM 114.3-1, 114.3-2 üzrə mikro / kiçik sahibkar üçün 2 / 1,5 artırıcı əmsal — şirkət parametri, standart 1.
- **Niyə vacibdir:** MG Transport kiçik sahibkar sayılırsa və şərtlər ödənilirsə, tırın 1-ci il vergi amortizasiyası 37 500 yerinə 56 250 ola bilər.
- **Meyar indi:** 1.
- **Tövsiyə:** mühasib şirkətin statusunu və əmsalın şərtlərini yoxlasın; uyğundursa — parametrdə qoysun.
- **Alternativlər:** —
- **Mühasib yoxlasın:** VM 114.3-1, 114.3-2; şirkətin sahibkarlıq subyekti statusu.

### 20. Yuvarlaqlaşdırma

- **Nə soruşulur:** vergi amortizasiyası vəsait üzrə qəpiyə yuvarlaqlaşdırılır; kateqoriyanın cəmi bir dəfə yuvarlaqlaşdırılan rəqəmdən bir neçə qəpik fərqlənə bilər.
- **Niyə vacibdir:** 20 tırda maksimum ~10 qəpik — praktik təsiri yoxdur.
- **Meyar indi:** vəsait üzrə (satılan vəsaitin qalığı dəqiq olur); bəyannamədə kateqoriyanın cəmi.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** kateqoriya üzrə bir dəfə.
- **Mühasib yoxlasın:** —

### 21. Qeyri-maddi aktivin amortizasiyası

- **Nə soruşulur:** "Amortizasiya" maddəsinə Kt 112-siz yazılan xərc (məs. proqram lisenziyasının amortizasiyası) indi gəlirdən çıxılır — vergi amortizasiyası yalnız əsas vəsaitləri əhatə edir.
- **Niyə vacibdir:** MG Transport-da qeyri-maddi aktiv azdırsa, təsiri yoxdur; çoxdursa VM 116 qaydası lazımdır.
- **Meyar indi:** belə.
- **Tövsiyə:** təsdiq; VM 116 — sonra, lazım olarsa.
- **Alternativlər:** —
- **Mühasib yoxlasın:** VM 116; şirkətdə qeyri-maddi aktiv varmı.

## D. İllik maliyyə hesabatları

### 22. ⚠ Plan §8 misalının yoxlanması

- **Nə soruşulur:** `docs/MERHELE-10-MALIYYE-HESABATLARI.md` §8-də 2026-nın kiçik misalı var (balans 126 500,03; M/Z: 60 = 120 000,00, vergiqoymadan əvvəl 71 500,03, 90 = 13 300,00, xalis mənfəət 58 200,03; pul hərəkəti: əməliyyat 64 000, investisiya −30 000, maliyyələşdirmə 30 000). Mühasib onu əl ilə hesablayıb təsdiqləsin.
- **Niyə vacibdir:** bu, dörd illik hesabatın bütün qaydalarını bir yerdə yoxlayır — mərhələ 5-də ay bağlanışı da belə təsdiqlənmişdi.
- **Meyar indi:** testlər bu rəqəmləri qəpikbəqəpik çıxarır.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** fərq varsa — hansı sətir, niyə.
- **Mühasib yoxlasın:** Maliyyə Nazirliyinin Q-01 qərarı (30.01.2017), əlavələr 1–4.

### 23. Açılmış qalıqların sətirləri

- **Nə soruşulur:** aktiv-passiv hesablar kontragent / işçi üzrə açılır. Alıcının Kt qalığı (avans) — 53 (kreditor) yoxsa 54 (sair)? Malsatana artıq ödəniş — 24? Büdcəyə artıq ödənilmiş vergi — 24?
- **Niyə vacibdir:** müştəri 5 000 ₼ avans ödəyib, daşıma hələ olmayıb → 211-in Kt qalığı 5 000. Balansın cəmi dəyişmir, amma sətir səhvdirsə hesabat formaya uyğun gəlmir.
- **Meyar indi:** alıcının Kt qalığı → 54 (543 də 54-dədir), öhdəliyin Dt qalığı → 24 (4xx → 19), aktivin Kt qalığı 1xx → 44.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** alıcının avansı → 53.
- **Mühasib yoxlasın:** Q-01 əlavə 1 (maddələrin məzmunu), IAS 1.

### 24. Pul hərəkəti: faiz və əmək haqqı vergiləri

- **Nə soruşulur:** ödənilən kredit faizi "əməliyyat fəaliyyəti"ndə; 521.03 / 522 ödənişləri "işçilərin mükafatlandırılması" sətrində. Uyğundurmu?
- **Niyə vacibdir:** il ərzində 3 000 ₼ faiz və 40 000 ₼ əmək haqqı vergiləri — sətirlər səhvdirsə, pul hərəkətinin bölmələri yanlışdır (cəm düzgün qalır).
- **Meyar indi:** belə.
- **Tövsiyə:** təsdiq.
- **Alternativlər:** faiz — maliyyələşdirmə (IAS 7.33 icazə verir); 521.03 / 522 — "digər vergilər".
- **Mühasib yoxlasın:** IAS 7.14, 7.33; Q-01 əlavə 4.

### 25. 343 / 341-dən birbaşa ödəniş

- **Nə soruşulur:** pul 343 / 341 ilə birbaşa ödənəndə (534-süz) pul hərəkətində "dividend", kapitalda isə "təsnif olunmayıb" olur — iki hesabat ziddiyyətlidir.
- **Niyə vacibdir:** təsisçiyə 10 000 ₼ bankdan Dt 343 / Kt 223 ilə ödənilib → kapitalda xəbərdarlıq çıxır.
- **Meyar indi:** pul — dividend; kapital — təsnif olunmayıb.
- **Tövsiyə:** dividend hər iki hesabatda yalnız 534 / 344 üzrə; 343 / 341 ↔ pul — "digər ödənişlər". Mühasib dividendi həmişə 534 ilə yazsın.
- **Alternativlər:** hər iki hesabatda 343 / 341 ↔ pul da dividend sayılsın.
- **Mühasib yoxlasın:** dividendin uçot sxemi (Dt 343 / Kt 534, Dt 534 / Kt 223) və dividendin gəlir vergisi.

### 26. Ödənilməmiş nizamnamə kapitalı

- **Nə soruşulur:** nizamnamə kapitalı 50 000, təsisçi 30 000 ödəyib (217-də 20 000 borc). 30-cu sətir ("ödənilmiş nizamnamə kapitalı") 50 000 göstərir.
- **Niyə vacibdir:** MG Transport-da kapital tam ödənilibsə — təsiri yoxdur.
- **Meyar indi:** 30-da 50 000, borc 21-də.
- **Tövsiyə:** mühasib təsdiqləsin; lazım olsa — təsisçinin 217 borcu 30-dan çıxılsın.
- **Alternativlər:** yuxarıdakı.
- **Mühasib yoxlasın:** Q-01 əlavə 1, IAS 32.

### 27. Əl ilə yazılan kurs fərqi

- **Nə soruşulur:** valyuta satışında əl ilə yazılan kurs fərqi (Dt 731 / Kt 223.02) pul hərəkətində "mallar və xidmətlər"ə düşür, "məzənnə təsiri"nə yox.
- **Niyə vacibdir:** beynəlxalq daşımadan USD gəlir; 1 000 USD satışında 120 ₼ fərq — kiçik, amma sətir səhvdir.
- **Meyar indi:** yalnız ay bağlanışının yenidən qiymətləndirməsi (YQ) "məzənnə təsiri"dir.
- **Tövsiyə:** "Məzənnə fərqi" maddəli 611 / 731 ↔ 22 yazılışı da "məzənnə təsiri" sətrinə.
- **Alternativlər:** belə qalsın.
- **Mühasib yoxlasın:** IAS 7.28; şirkətdə kurs fərqinin hansı maddə ilə yazıldığı.

### 28. Overdraft

- **Nə soruşulur:** QERARLAR "22-nin Kt qalığı → 50" deyir, amma 22x aktiv hesabdır — qayda işləmir; açıq dövrdə mənfi bank qalığı 22-də mənfi görünür. Bağlanış mənfi pulu bloklayır, il sonunda olmur.
- **Niyə vacibdir:** bankın overdraft xətti yoxdursa — təsiri yoxdur.
- **Meyar indi:** belə.
- **Tövsiyə:** belə qalsın (mənfi 22 səhvi göstərir); real overdraft xətti olarsa — 501 ilə yazılsın.
- **Alternativlər:** —
- **Mühasib yoxlasın:** şirkətin bank müqavilələri.

### 29. Qarışıq qaimə

- **Nə soruşulur:** bir qaimədə əsas vəsait və mal (məs. tır + ehtiyat təkərlər) — ödənişin hamısı investisiyadır.
- **Niyə vacibdir:** nadirdir; təkərlər 4 000 ₼ olsa, bu məbləğ əməliyyat yerinə investisiyada olur.
- **Meyar indi:** belə (bilərəkdən).
- **Tövsiyə:** qalsın; lazım olsa qaimə iki sənədə ayrılsın.
- **Alternativlər:** sətirlərə mütənasib bölgü.
- **Mühasib yoxlasın:** —

### 30. Kapital ↔ M/Z xəbərdarlığının mətni

- **Nə soruşulur:** fərq olanda xəbərdarlıq "801 / 341-ə əl ilə yazılış" deyir; indiki səbəb 801 / 901-ə əl ilə yazılışdır.
- **Niyə vacibdir:** yalnız izahdır.
- **Meyar indi:** belə.
- **Tövsiyə:** mətn kifayətdir; mühasib çaşsa — fərqi yaradan yazılışlar sadalansın.
- **Alternativlər:** —
- **Mühasib yoxlasın:** —

## E. E-qaimə və bank

### 31. ⚠ "DVX-dən yenilə" dövrü

- **Nə soruşulur:** yeniləmə yalnız açıq dövrü alır; heç bir bağlanış yoxdursa — cari ilin 1 yanvarından. Ona görə yanvarda dekabrın gec təsdiqlənən / ləğv edilən e-qaimələri gəlmir; bağlı aylarda DVX-də sonradan ləğv edilmiş e-qaimə yalnız Excel ilə görünür.
- **Niyə vacibdir:** MG Transport-un ən vacib sahəsidir. Müştəri 28.12.2026 tarixli 11 800 ₼-lıq e-qaiməni 10.01.2027-də ləğv edir → Meyar-da dekabr gəliri və 1 800 ₼ ƏDV qalır, DVX ilə fərq gec tapılır.
- **Meyar indi:** yuxarıdakı kimi.
- **Tövsiyə:** bağlanış yoxdursa dövr **keçən ayın 1-dən** başlasın; bağlı dövr üçün ayda bir dəfə "son 3 ay" yoxlaması (yalnız statuslar, uçot dəyişmir — fərq siqnal kimi).
- **Alternativlər:** həmişə son 3 ay; yalnız əl ilə Excel.
- **Mühasib yoxlasın:** e-qaimənin ləğvi / düzəlişi üçün DVX-nin müddətləri; bağlanmış aya düşən ləğvin uçotda necə əks etdirildiyi (düzəliş hansı ayda).

### 32. "Mallar üzrə" ilə "Qaimələr üzrə" arasında qəpik fərqi

- **Nə soruşulur:** DVX məbləğləri 4 onluqdur. "Mallar üzrə" faylında e-qaimənin cəmi yuvarlaqlaşdırılmış sətirlərin cəmidir, "Qaimələr üzrə"də başlığın özü yuvarlaqlaşdırılır — bir neçə sətirli e-qaimədə 1–2 qəpik fərq ola bilər. Belə e-qaimə həmişəlik "Ziddiyyət"də qalır və avtomatik keçmir.
- **Niyə vacibdir:** 3 sətirli yanacaq e-qaiməsi 1 180,01 / 1 180,00 → əl ilə keçirmək lazımdır.
- **Meyar indi:** ziddiyyət (status yenə tətbiq olunur — audit düzəlişi).
- **Tövsiyə:** real "Mallar üzrə" ixracı gələndə yoxlansın; təsdiqlənsə — fərq sətir sayından çox olmayanda ziddiyyət sayılmasın, başlıq "Qaimələr üzrə"dən götürülsün.
- **Alternativlər:** belə qalsın.
- **Mühasib yoxlasın:** kabinetdən bir neçə sətirli e-qaimənin "Mallar üzrə" ixracı (istifadəçidən fayl).

### 33. Çıxarışda eyni ödənişlər

- **Nə soruşulur:** eyni gün, eyni məbləğ və təyinatlı, sənəd nömrəsiz iki ödəniş (məs. iki sürücüyə 200 ₼ ezamiyyə) faylda sıra ilə ayrılır. Üst-üstə düşən iki faylda (gün ortası çıxarış + gün sonu) biri təkrar sayılıb atıla, digəri iki dəfə qala bilər.
- **Niyə vacibdir:** bank sənəd nömrəsi çap edirsə risk yoxdur.
- **Meyar indi:** barmaq izi + təkrar sayı (qarşı tərəf yoxdur).
- **Tövsiyə:** real bank faylları ilə yoxlansın; nömrəsiz bank varsa, qarşı tərəfin IBAN-ı barmaq izinə əlavə edilsin.
- **Alternativlər:** —
- **Mühasib yoxlasın:** MG Transport-un bankının çıxarışında sənəd nömrəsi varmı (istifadəçidən fayl).

### 34. Sürət — texniki

- **Nə soruşulur:** hər qaimə hesab planını bazadan yenidən oxuyur (5 000 e-qaimədə ~0,24 s / 3 s).
- **Tövsiyə:** indi lazım deyil; proqramçı qərar verir. Mühasibə aid deyil.

### 35. Kassa yük testi — texniki

- **Nə soruşulur:** kassa orderlərinin yük testi də CI-da diskdən asılıdır (40 s həddi).
- **Tövsiyə:** bank kimi CPU vaxtı ilə ölçülsün, hədd 10 s; proqramçı qərar verir. Mühasibə aid deyil.
