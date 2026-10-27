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
3. **Müstəqil audit** (kodu yazmayan sessiya).

## 11. Açıq suallar (istifadəçi və mühasib)

1. **2026 dərəcələri.** Mənbələr fərqlidir (xüsusilə tibbi sığortanın 2 500 həddi və 8 000-dən yuxarı DSMF). Tövsiyə: §5-dəki dəyərlər başlanğıc kimi, mühasib taxes.gov.az / DSMF ilə təsdiq edir; dəyişsə — yalnız cədvəl.
2. **İşçilər.** MG Transport-da neçə işçi var, neçəsi sürücüdür? Xidmət müqaviləsi ilə işləyən varmı (522.02, gəlir vergisi fərqli)?
3. **Xərc hesabı:** sürücülər → 701 ("Əsas nomenklatura qrupu"), ofis → 721. Uyğundurmu?
4. **Mükafat və tutulmalar** bu mərhələdə sərbəst məbləğ sətirləri kimi kifayətdirmi? (Tövsiyə: bəli.)
5. **Avans** (ayın ortasında ödəniş) varmı? Varsa, 533-də işçinin debet qalığı kimi qalır, ay sonu hesablama ilə bağlanır — ayrıca sənəd lazım deyil.
6. **Məzuniyyət və xəstəlik** 8b-də lazımdırmı, yoxsa sonra? (Tövsiyə: sonra, ilk aylar əl ilə sətir.)

Mənbələr (§5, yoxlanmalı): [Mercans — 2026 dəyişiklikləri](https://mercans.com/resources/statutory-alerts/tazerbaijan-changes-in-tax-rate-and-social-security-rates-1st-january-2026/), [Caspian Legal Center](https://www.caspianlegalcenter.az/insights/more/payrol-taxes-in-azerbaijan), [TaxRavens — sosial ödənişlər 2026](https://taxravens.com/en/azerbaijan/social-contributions-2026), [busy.az kalkulyatoru](https://busy.az/gross-net-calculator?lang=en).
