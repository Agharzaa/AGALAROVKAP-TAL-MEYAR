# Mərhələ 8 — Əmək haqqı (dizayn)

Status: **təsdiqlənib** (27.10.2026; bütün suallarda tövsiyə). Qərarlar — `docs/QERARLAR.md` 2026-10-27.

Əsas: `docs/QERARLAR.md` — "521 və 522 — 1C kimi subhesablar" (522.01, 522.03.1/.2, 522.04.1/.2), 2026-10-07 §9 ("Əmək haqqı hələlik bir sənəddə hər işçi bir sətir; avtomatik bölgü əməkhaqqı mərhələsində"), mərhələ 5 (ay bağlanışı), mərhələ 3 (bank çıxarışında əmək haqqı → 533).

## 1. Məqsəd və sərhəd

İndi əmək haqqı əl ilə əməliyyatla yazılır: mühasib hər işçinin gəlir vergisini, DSMF-ni, işsizlik və tibbi sığortanı özü hesablayır. MG Transport-da sürücülər və ofis işçiləri var, hesablama hər ay təkrarlanır və 2026-dan dərəcələr pilləlidir (gəlir vergisi 3 / 10 / 14%, tibbi sığorta 2 / 0,5%) — əl ilə səhv ehtimalı böyükdür.

**Mərhələyə daxildir:**

1. **İşçilər kitabçası genişlənir** (1C-dəki "Əməkdaşlar"): tabel nömrəsi, FİN, vəzifə, işə qəbul və çıxma tarixi, aylıq əmək haqqı (əmək müqaviləsi üzrə), xərc hesabı (sürücü → 701, ofis → 721), müqavilə növü (əmək müqaviləsi / xidmət müqaviləsi).
2. **Dərəcələr cədvəli** (tarixdən qüvvədə): gəlir vergisi pillələri və 200 manat güzəşti, DSMF (işçi / işəgötürən, 200 manat həddi), işsizlik sığortası, tibbi sığorta (2 500 həddi). Kodda sabit yoxdur: dərəcə dəyişəndə mühasib yeni sətir əlavə edir.
3. **Əmək haqqının hesablanması** (ƏH-000001, ay üzrə bir sənəd): ay seçilir → aktiv işçilər özü dolur (işə qəbul / çıxma ayında iş günlərinə mütənasib), mühasib məbləği, mükafatı, tutulmaları dəyişə bilər. Hər sətirdə gross, tutulmalar, net, işəgötürən payı — qəpiyə qədər.
4. **Ödəniş:** bank və kassa sənədləri ilə (Dt 533 / Kt 223 / 221) — bu artıq var; bank çıxarışında əmək haqqı sətri işçiyə bağlanır.
5. **Ay bağlanışında yoxlama:** ayın əmək haqqı sənədi yoxdursa, aktiv işçisi olan şirkətdə — xəbərdarlıq.
6. **Hesabatlar:** əmək haqqı cədvəli (ay; Excel), işçinin hesablaşma vərəqəsi (çap), 533 üzrə işçilərlə hesablaşmalar (borc / avans), vergi və fondlar üzrə ay cəmi (bəyannamə üçün rəqəmlər).

**Daxil deyil:**

| İş                                                       | Mərhələ      |
| -------------------------------------------------------- | ------------ |
| Məzuniyyət və xəstəlik vərəqəsi (orta əmək haqqı hesabı) | 8b           |
| Tabel (iş saatları, gecə və bayram günləri, artıq iş)    | sonra        |
| Vergi və DSMF bəyannamələrinin faylı (e-taxes formatı)   | sonra        |
| Aliment, icra vərəqəsi tutulmaları                       | sonra        |
| Neft-qaz və dövlət sektoru rejimi (14 / 25%)             | lazım olarsa |

## 2. Mövcud koddan nə götürülür

| Kod                                      | Qərar                                                    |
| ---------------------------------------- | -------------------------------------------------------- |
| `employees` kitabçası (ad, vəzifə, FİN)  | Yeni sahələrlə genişlənir (sxem v17)                     |
| 533 (subkonto İşçi), 521.03, 522.xx      | Dəyişmir                                                 |
| Sənəd nüvəsi (nömrə, storno, bağlı dövr) | Əmək haqqı sənədi eyni qaydalarla                        |
| Bank / kassa sənədləri, çıxarış (→ 533)  | Ödəniş belə qalır; çıxarışda işçi FİN / ad ilə tanınır   |
| Ay bağlanışı                             | Yeni yoxlama; yazılış addımı yoxdur (hesablama sənəddir) |

## 3. Məlumat modeli (sxem v17)

- `employees` + `tab_no`, `hired`, `left`, `salary`, `expense_account`, `expense_sk`, `contract_kind`.
- `payroll_rates` (şirkət üzrə, `valid_from`): JSON pillələr — məs. gəlir vergisi `[{upTo: 2500, rate: 3}, {upTo: 8000, rate: 10}, {rate: 14}]`, güzəşt `{amount: 200, ifIncomeUpTo: 2500}`.
- `payroll_documents` (ay, nömrə, status, versiya), `payroll_lines` (işçi, gross, hər tutulma, net, işəgötürən payları, xərc hesabı). Sətrin hesablaması domendə (`src/domain/payroll.ts`), test edilə bilən saf funksiya.

## 4. Yazılışlar (ayın son günü)

```
Dt 701 / 721 (xərc maddəsi "Əmək haqqı")   Kt 533 (işçi)          gross
Dt 533                                      Kt 521.03              gəlir vergisi
Dt 533                                      Kt 522.01              DSMF — işçi
Dt 533                                      Kt 522.03.1            işsizlik — işçi
Dt 533                                      Kt 522.04.1            tibbi — işçi
Dt 701 / 721 (xərc maddəsi "Sosial sığorta") Kt 522.01             DSMF — işəgötürən
Dt 701 / 721                                Kt 522.03.2            işsizlik — işəgötürən
Dt 701 / 721                                Kt 522.04.2            tibbi — işəgötürən
```

Ödəniş: Dt 533 / Kt 223.01 (bank) və ya 221 (kassa). Vergi və fondların köçürülməsi: Dt 521.03 / 522.xx / Kt 223.01 — bank sənədi ilə (artıq var).

## 5. Hesablama qaydası (2026 dərəcələri — mühasib təsdiq etməlidir)

- **Gəlir vergisi** (qeyri-neft, qeyri-dövlət): aylıq gəlirin 2 500-ə qədər hissəsi 3%, 2 500–8 000 hissəsi 10%, 8 000-dən yuxarısı 14%; gəlir ≤ 2 500 olanda 200 manat vergidən azaddır.
- **DSMF:** işçi — 200-ə qədər 3%, qalanı 10%; işəgötürən — 200-ə qədər 22%, qalanı 15% (8 000-dən yuxarı hissə — §11 sual 1).
- **İşsizlik sığortası:** işçi 0,5%, işəgötürən 0,5%.
- **Tibbi sığorta:** 2 500-ə qədər hissə — işçi 2%, işəgötürən 2%; yuxarısı — 0,5% + 0,5%.
- Hər tutulma ayrıca qəpiyə yuvarlaqlaşdırılır (yarı yuxarı).

## 6. Hesabatlar

| Hesabat                 | Məzmun                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| Əmək haqqı cədvəli      | Ay: işçi, gross, hər tutulma, net, işəgötürən payı, cəmlər; Excel |
| Hesablaşma vərəqəsi     | İşçi × ay: hesablanıb, tutulub, ödənilib, borc; çap               |
| İşçilərlə hesablaşmalar | 533: ayın əvvəli, hesablanıb, ödənilib, son (işçi üzrə)           |
| Vergi və fondlar        | Ay: 521.03, 522.01, 522.03, 522.04 — hesablanıb, köçürülüb, borc  |

## 7. İnterfeys

- Menyu "Əmək haqqı": İşçilər, Dərəcələr, Əmək haqqının hesablanması, Əmək haqqı cədvəli, Hesablaşma vərəqəsi.
- Sənəd formasında ayı seçəndə sətirlər özü dolur, hər sətirdə tutulmalar canlı hesablanır; cəm sətri; "İşçilərə görə doldur" yenidən doldurur.
- İş masasının "İş xəritəsi"ndə: Əmək haqqının hesablanması → Bank (ödəniş) → Vergilərin köçürülməsi.

## 8. Qəbul testləri

| #   | Yoxlama                                                                                       | Növ         |
| --- | --------------------------------------------------------------------------------------------- | ----------- |
| Ə1  | §9 misalı qəpikbəqəpik (1 000 manat)                                                          | domain      |
| Ə2  | Pillə sərhədləri: 2 500,00 / 2 500,01, 8 000,00 / 8 000,01; 200 güzəşti 2 500-dən yuxarı itir | domain      |
| Ə3  | Sənəd: yazılışlar §4, storno ilə düzəliş və ləğv, bağlı dövr                                  | integration |
| Ə4  | İşə qəbul ayının ortasında — iş günlərinə mütənasib                                           | integration |
| Ə5  | Dərəcə dəyişəndə (yeni `valid_from`) köhnə ay köhnə dərəcə ilə qalır                          | integration |
| Ə6  | Bank çıxarışında əmək haqqı ödənişi işçiyə bağlanır, 533 sıfırlanır                           | integration |
| Ə7  | Ay bağlanışı: aktiv işçi var, sənəd yoxdur — xəbərdarlıq                                      | integration |
| Ə8  | Forma: doldurma, canlı hesablama, cədvəl, Excel                                               | tests/ui    |
| Ə9  | 300 işçi × 12 ay — sənəd ≤ 1 s, cədvəl ≤ 1 s (lokal)                                          | perf        |

## 9. Mühasibin yoxlaması üçün misal (qəpikbəqəpik)

Sürücü, əmək haqqı 1 000,00 ₼, oktyabr 2026, 701:

| Hesablama                             | Məbləğ       |
| ------------------------------------- | ------------ |
| Gəlir vergisi (1 000 − 200) × 3%      | 24,00        |
| DSMF işçi 200 × 3% + 800 × 10%        | 86,00        |
| İşsizlik işçi 0,5%                    | 5,00         |
| Tibbi işçi 2%                         | 20,00        |
| **Ödəniləcək (net)**                  | **865,00**   |
| DSMF işəgötürən 200 × 22% + 800 × 15% | 164,00       |
| İşsizlik işəgötürən 0,5%              | 5,00         |
| Tibbi işəgötürən 2%                   | 20,00        |
| **İşəgötürənin xərci cəmi**           | **1 189,00** |

## 10. İcra ardıcıllığı

1. **8a — işçilər, dərəcələr, hesablama sənədi** (sxem v17, domen, yazılışlar, forma). Testlər: Ə1–Ə5, Ə8. ✅ (0.9.0, 27.10.2026)
2. **8b — ödəniş və hesabatlar** (çıxarışda işçi, cədvəl, vərəqə, hesablaşmalar, bağlanış yoxlaması). Testlər: Ə6, Ə7, Ə9.
3. **Müstəqil audit** (kodu yazmayan sessiya). ✅ (0.9.3, 27.10.2026; PROJECT_STATE "Mərhələ 8 auditi")

## 11. Açıq suallar (istifadəçi və mühasib)

1. **2026 dərəcələri.** Mənbələr fərqlidir (xüsusilə tibbi sığortanın 2 500 həddi və 8 000-dən yuxarı DSMF). Tövsiyə: §5-dəki dəyərlər başlanğıc kimi, mühasib taxes.gov.az / DSMF ilə təsdiq edir; dəyişsə — yalnız cədvəl.
2. **İşçilər.** MG Transport-da neçə işçi var, neçəsi sürücüdür? Xidmət müqaviləsi ilə işləyən varmı (522.02, gəlir vergisi fərqli)?
3. **Xərc hesabı:** sürücülər → 701 ("Əsas nomenklatura qrupu"), ofis → 721. Uyğundurmu?
4. **Mükafat və tutulmalar** bu mərhələdə sərbəst məbləğ sətirləri kimi kifayətdirmi? (Tövsiyə: bəli.)
5. **Avans** (ayın ortasında ödəniş) varmı? Varsa, 533-də işçinin debet qalığı kimi qalır, ay sonu hesablama ilə bağlanır — ayrıca sənəd lazım deyil.
6. **Məzuniyyət və xəstəlik** 8b-də lazımdırmı, yoxsa sonra? (Tövsiyə: sonra, ilk aylar əl ilə sətir.)

Mənbələr (§5, yoxlanmalı): [Mercans — 2026 dəyişiklikləri](https://mercans.com/resources/statutory-alerts/tazerbaijan-changes-in-tax-rate-and-social-security-rates-1st-january-2026/), [Caspian Legal Center](https://www.caspianlegalcenter.az/insights/more/payrol-taxes-in-azerbaijan), [TaxRavens — sosial ödənişlər 2026](https://taxravens.com/en/azerbaijan/social-contributions-2026), [busy.az kalkulyatoru](https://busy.az/gross-net-calculator?lang=en).

## 12. Genişləndirmə: 8b və 8c (27.10.2026)

İstifadəçi: "hamısını, hər detalı düşün — gəlir vergisi güzəştləri, xəstəlik vərəqəsi və s." Mənbələr bir-birinə zidd olan yerlərdə qayda parametrdir (dərəcələr dəstində və ya sənəddə), mühasib təsdiq edir. Bütün qaydalar QERARLAR 2026-10-27 §7–§12-də.

**Vəziyyət:** 8b və 8c hazırdır — 0.9.1 (27.10.2026). Testlər: `tests/domain/payroll.test.ts` (Ə10–Ə12), `tests/integration/payroll-8bc.test.ts` (Ə10–Ə15, bağlanış, v17 → v18), `tests/ui` (8c), perf (Ə9).

### 8b — ödəniş, tutulmalar, hesabatlar

1. **Ödəniş.** Bank / kassa sənədi ilə Dt 533 (işçi) — artıq var. Bank çıxarışında əmək haqqı sətri (`salary`) təyinatdakı FİN və ya ad-soyadla işçiyə bağlanır (533-ün subkontosu); tapılmasa — mühasib seçir.
2. **Başqa tutulmalar** (aliment, icra vərəqəsi, verilmiş avansın / zərərin qaytarılması): sətirdə "Tutulma" — məbləğ, hesab və subkonto (məs. 538 / kontragent + müqavilə, 244 / işçi, 731). Yazılış Dt 533 / Kt seçilən hesab. Gəlir vergisinin və fondların bazasını dəyişmir; ödəniləcəkdən çıxılır.
3. **Hesabatlar:**
   - **Əmək haqqı cədvəli** (ay): işçi × hesablanan, mükafat, məzuniyyət, xəstəlik, hər tutulma, ödəniləcək, işəgötürən payları; cəmlər; Excel.
   - **Hesablaşma vərəqəsi** (işçi × ay): ayın əvvəlinə borc, hesablanıb (növlər üzrə), tutulub, ödənilib (bank / kassa sənədləri), ayın sonuna borc; çap (A5-ə iki).
   - **İşçilərlə hesablaşmalar** (533, dövr): işçi üzrə əvvəl, hesablanıb, ödənilib, son.
   - **Vergi və fondlar** (ay): 521.03, 522.01, 522.03.x, 522.04.x — hesablanıb, köçürülüb (bank), borc; bəyannamə üçün işçi sayı və baza.
4. **Ay bağlanışında yoxlama:** aktiv işçisi (əmək haqqı yazılmış, işləyən) olan şirkətdə ayın uçotdakı əmək haqqı sənədi yoxdursa — xəbərdarlıq.
5. **Perf:** 300 işçi — sənəd ≤ 1 s, cədvəl ≤ 1 s.

### 8c — güzəştlər, məzuniyyət, xəstəlik vərəqəsi

1. **Gəlir vergisi güzəştləri (VM 102)** işçinin kartında, tarixdən-tarixə (sənəd əsasında):
   - kateqoriya → aylıq azad məbləğ: **400** (VM 102.2: Vətən müharibəsi və Milli Qəhrəmanlar, müharibə əlilləri I–II qrup, şəhid ailələri, müharibə veteranları, radiasiya xəstəliyi və s.), **200** (VM 102.3: 61–100% sağlamlıq imkanı məhdud, 18 yaşadək əlil, onlara qulluq edən bir valideyn / qəyyum), **100** (VM 102.4), **50** (VM 102.5, əlavə);
   - 102.7: bir neçə hüquq varsa yalnız ən böyüyü (50 əlavə ilə birlikdə ola bilər);
   - güzəşt yalnız əsas iş yerində (əmək kitabçası olan yerdə) — kartda "Əsas iş yeri" bayrağı;
   - 2026 qaydası (gəlir ≤ 2 500 olanda 200 azad) ilə şəxsi güzəşt **birlikdə tətbiq olunmur — ən böyüyü** (VM 102.7 məntiqi; mühasib təsdiq edir, dəyişsə — dəstin parametri).
2. **Məzuniyyət** (Əmək Məcəlləsi; NK-nin 137 saylı qərarı):
   - sənəd "Məzuniyyət": işçi, başlama / bitmə (təqvim günləri), növ (əsas / əlavə / ödənişsiz);
   - orta aylıq = məzuniyyət ayından əvvəlki 12 tam təqvim ayının əmək haqqı + mükafatları (məzuniyyət və xəstəlik ödənişləri daxil deyil) / 12 (az işləyibsə — işlədiyi tam aylar); günlük = orta aylıq / **30,4**; məbləğ = günlük × təqvim günləri; 0,01-ə yuvarlaqlaşdırılır;
   - ödənişsiz məzuniyyət — yalnız iş günlərini azaldır;
   - məzuniyyət haqqı əmək haqqıdır: gəlir vergisi və bütün fondlar tutulur; başladığı ayın əmək haqqı sənədinə düşür (bütöv məbləğ, 1C-dəki kimi aylara bölünmür — sadəlik üçün; mühasib təsdiq edir);
   - həmin ayda məzuniyyət günlərinə düşən iş günləri üçün maaş hesablanmır (mütənasib azalır).
3. **Xəstəlik vərəqəsi** (NK-nin 189 saylı qərarı, 31 saylı qərarla dəyişiklik, 2026):
   - sənəd "Xəstəlik vərəqəsi": işçi, vərəqənin nömrəsi, başlama / bitmə (təqvim günləri), staj faizi (60 / 80 / 100, mühasib seçir; standart 100), səbəb (ümumi xəstəlik / istehsalat qəzası — işəgötürənin günahı ilə bütün müddət işəgötürəndən);
   - orta günlük qazanc = xəstəlik ayından əvvəlki **4 tam rübün** sığortaya cəlb olunan gəliri / həmin dövrün təqvim günləri (01.05.2026-dan; daha əvvəlki hadisə — 12 ay / iş günləri, köhnə qayda); 6 aydan az sığorta stajı — müavinət yoxdur (xəbərdarlıq, mühasib qərar verir);
   - **ilk 14 təqvim günü işəgötürən ödəyir** — əmək haqqı sənədinə düşür: Dt 701 / 721 ("Xəstəlik vərəqəsi üzrə müavinət") / Kt 533; **gəlir vergisi tutulur, DSMF / işsizlik / tibbi sığorta tutulmur və hesablanmır**;
   - 15-ci gündən — DSMF ödəyir (2026-dan proaktiv, birbaşa işçiyə): Meyar-da yazılış yoxdur, sənəddə məlumat kimi göstərilir;
   - həmin günlər üçün maaş hesablanmır;
   - yuxarı hədd (25 × minimum yaşa görə pensiya, ayda) — dəstin parametri.

### Qəbul testləri (əlavə)

| #   | Yoxlama                                                                                                 | Növ                  |
| --- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| Ə10 | Güzəşt 400 / 200 / 100 / 50, ən böyüyü; 2026-nın 200-ü ilə birlikdə ən böyüyü; əsas iş yeri deyil — yox | domain               |
| Ə11 | Məzuniyyət: 12 ay / 30,4 × gün, az işləyən, mükafat daxil, xəstəlik daxil deyil; ayın maaşı azalır      | domain + integration |
| Ə12 | Xəstəlik: 4 rüb / təqvim günləri × staj faizi, ilk 14 gün işəgötürən, fondsuz, gəlir vergisi ilə        | domain + integration |
| Ə13 | Tutulma (aliment 538): Dt 533 / Kt 538, ödəniləcək azalır, vergi bazası dəyişmir                        | integration          |
| Ə14 | Çıxarışda əmək haqqı sətri FİN ilə işçiyə bağlanır                                                      | integration          |
| Ə15 | Hesablaşma vərəqəsi və cədvəl: borc qəpikbəqəpik (hesablanıb − tutulub − ödənilib)                      | integration + ui     |

## 13. 8d — istehsalat təqvimi, tabel, məzuniyyət hüququ (27.10.2026)

**Vəziyyət:** hazırdır — 0.9.2 (27.10.2026). Testlər: `tests/domain/calendar.test.ts` (Ə16–Ə19), `tests/integration/payroll-8d.test.ts` (Ə16–Ə20, v18 → v19), `tests/ui` (8d).

İstifadəçi: "məzuniyyət və hər şey 1C-dəkindən yaxşı olmalıdır, işçilərin tabeli də." 1C-də olanlardan əlavə Meyar özü edir: məzuniyyətin bitmə tarixi bayramları çıxmaqla özü hesablanır, qalıq günlər hər an görünür, tabel bir düymə ilə sənədlərdən dolur, köhnələn tabel və əmək haqqı bağlanışı saxlayır.

1. **İstehsalat təqvimi** (Əmək haqqı → İstehsalat təqvimi; il üzrə, dəyişdirilə bilər):
   - gün növləri: bayram (Əmək Məcəlləsi 105), köçürülmüş istirahət günü, iş gününə çevrilmiş istirahət günü, bayramqabağı qısaldılmış gün (1 saat az);
   - 2026 dəsti NK-nin 02.12.2025 tarixli 362 saylı qərarı və ƏƏSMN-in istehsalat təqvimi ilə: bayramlar — 1–2 yanvar, 20 yanvar, 8 mart, 20–24 mart (Novruz), 20–21 mart (Ramazan), 9 may, 27–28 may (Qurban), 28 may, 15 iyun, 26 iyun, 8 noyabr, 9 noyabr, 31 dekabr; köçürülmüş istirahət günləri — 9, 25, 26, 27, 30 mart, 11, 29 may, 10 noyabr; qısaldılmış günlər — 19 yanvar, 19 mart, 8 may, 26 may, 25 iyun, 30 dekabr;
   - aylıq norma: iş günləri və saatlar (40 saatlıq həftə); 2026: 241 gün, 1 922 saat;
   - təqvim olmayan il — yalnız şənbə / bazar istirahət (xəbərdarlıqla).
2. **Maaşın mütənasibliyi təqvimlə:** işə qəbul / çıxma, məzuniyyət, xəstəlik — iş günləri təqvimə görə (bayramlar və köçürülmüş günlər iş günü deyil).
3. **Tabel** (TB-2026-10, ayda bir sənəd; işçi × gün):
   - hər gün: kod və saat — İ (iş), E (ezamiyyət — iş kimi), M (məzuniyyət), Ö (ödənişsiz), X (xəstəlik), Q (üzrsüz gəlməmə), B (istirahət / bayram); sətirdə artıq iş və gecə saatları;
   - "Doldur": təqvim + işə qəbul / çıxma + məzuniyyət və xəstəlik sənədləri; mühasib hər xananı dəyişə bilər (kod klaviaturadan);
   - cəmlər: iş günü, saat, norma, bayram günü işlənən saatlar;
   - əmək haqqı tabeldən: maaş × işlənmiş norma saatları / ayın norma saatı; artıq iş — saatlıq × saat × 2; bayram / istirahət günü iş — saatlıq × saat × 2; gecə — saatlıq × saat × 40% (əmsallar dərəcələr dəstində, mühasib təsdiq edir); tabel yoxdursa — təqvimlə (2-ci bənd);
   - sənədlərlə uyğunsuzluq (məzuniyyət / xəstəlik sonradan dəyişib) — tabel "köhnəlib", ay bağlanışı bloklanır;
   - çap / Excel (T-13-ə bənzər forma).
4. **Məzuniyyət — 1C-dən yaxşı:**
   - **müddət bayramsız:** məzuniyyət günləri təqvim günləridir, içinə düşən bayramlar sayılmır və müddət uzanır (Əmək Məcəlləsi); formada "başlama + gün sayı" yazılır, bitmə tarixi özü çıxır;
   - **aylara bölünür:** iki aya düşən məzuniyyətin haqqı günlərə görə hər ayın əmək haqqına düşür (vergi və fondlar həmin ayda);
   - **hüquq və qalıq:** işçinin kartında illik əsas məzuniyyət (21 / 30 / 42 …), əmək stajının başlanğıcı → staja görə əlavə gün (5–10 il: 2, 10–15 il: 4, 15-dən çox: 6) və digər əlavə günlər; iş ili işə qəbul tarixindən; qalıq = iş illəri üzrə hüquq (cari il — keçən aylara mütənasib) − istifadə olunan; formada qalıq görünür, artıq məzuniyyət — xəbərdarlıq;
   - **Məzuniyyət qalıqları** hesabatı (tarixə: işçi, iş ili, hüquq, istifadə, qalıq);
   - **kompensasiya** (işdən çıxanda istifadə olunmamış günlər): sənəd "Məzuniyyət kompensasiyası" — günlər qalıqdan özü dolur, orta günlük məzuniyyətdəki kimi, işdən çıxma ayının əmək haqqına düşür.

### Qəbul testləri (əlavə)

| #   | Yoxlama                                                                                       | Növ                  |
| --- | --------------------------------------------------------------------------------------------- | -------------------- |
| Ə16 | 2026 təqvimi: aylıq iş günləri və saatlar (yanvar 19 / 151, mart 14 / 111, il 241 / 1 922)    | domain               |
| Ə17 | Məzuniyyət martda: 20–24 mart bayramları sayılmır, bitmə uzanır; iki aya bölünür              | domain + integration |
| Ə18 | Tabel: doldurma (bayram, məzuniyyət, xəstəlik), saatla maaş, artıq iş / bayram / gecə ödənişi | integration          |
| Ə19 | Qalıq: 21 + staj, iş illəri, istifadə; kompensasiya qalıqdan                                  | integration          |
| Ə20 | Köhnələn tabel bağlanışı bloklayır; forma: tabel şəbəkəsi, təqvim, qalıq                      | integration + ui     |
