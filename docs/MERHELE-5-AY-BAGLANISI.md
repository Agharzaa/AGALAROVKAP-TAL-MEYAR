# Mərhələ 5 — Kassa, valyuta məzənnələri, ay bağlanışı, idarə paneli (dizayn)

Status: **təsdiqlənib** (17.10.2026). Açıq suallarda (§11) tövsiyələr qəbul olunub. Qərarlar `docs/QERARLAR.md`-dədir (2026-10-17, mərhələ 5); bu sənəd icra planı kimi qalır.

Əsas: `docs/QERARLAR.md` — "Satış və ƏDV" (ay sonu 601 və 604.1 → 801), "1C-də gördüklərimiz" (ay bağlanışı: 721/731 → 801, 601/611 → 801, 604.1 → 801, 801 → 341; valyuta qalıqlarının yenidən qiymətləndirilməsi 731 / 611), 2026-10-07 axşam §4 (valyuta avansları 243.02 / 543.02 ay sonu yenidən qiymətləndirilir), mərhələ 2 "Məhdudiyyətlər" (dəqiq FIFO ay bağlanışında), 2026-10-14 §5 (öz hesabları arası 222.01), 2026-10-07 gecə §2 (221.01–221.05, kassa subkontosu).

## 1. Məqsəd və sərhəd

**Mərhələyə daxildir:**

1. **Kassa sənədi** — mədaxil orderi (KMO-000001) və məxaric orderi (KXO-000001). Bank sənədinin güzgüsüdür: çoxsətirli, müxabir hesab sərbəst, qaimələrə bölgü, avans, təhtəlhesab (244), storno ilə düzəliş və ləğv. Kassa kitabı (gün üzrə).
2. **Valyuta məzənnələri kitabçası** — AMB-nin rəsmi məzənnəsi tarix üzrə. Sənədlərdə məzənnə buradan özü dolur (dəyişdirmək olar). "AMB-dən yüklə" düyməsi (§11 sual 5).
3. **Ay bağlanışı** — bir sənəd, ayda bir dəfə, addım-addım:
   1. yoxlamalar;
   2. maya dəyərinin (FIFO) dəqiqləşdirilməsi;
   3. valyuta qalıqlarının yenidən qiymətləndirilməsi;
   4. alış ƏDV-sinin əvəzləşdirilməsi (241 → 521.01);
   5. gəlir və xərclərin 801-ə bağlanması;
   6. 801 → 341;
   7. dekabrda — 341 → 343 (il bağlanışı);
   8. dövrün bağlanması (tarix kilidi).

   Hər addımın yazılışı görünür; ay bağlanışı ləğv olunur (storno) və yenidən aparılır.

4. **Hesabatlar və idarə paneli:**
   - Mənfəət və zərər hesabatı (aylar üzrə);
   - Pul vəsaitlərinin hərəkəti hesabatı (bank və kassa sətirlərinin maddələri üzrə);
   - ƏDV icmalı (satış / alış, ay üzrə; bəyannamə üçün cəmlər);
   - İdarə paneli: əsas göstəricilər və 12 ayın dinamikası, hər rəqəmdən hesabata və sənədə keçid.

**Daxil deyil:**

| İş                                                          | Mərhələ             |
| ----------------------------------------------------------- | ------------------- |
| Əmək haqqı hesablanması, 533 / 522 avtomatik                | əməkhaqqı mərhələsi |
| Mənfəət vergisinin hesablanması (901 / 521.04)              | sonra (§11 sual 8)  |
| ƏDV bəyannaməsinin rəsmi forması (XML / e-taxes-ə göndərmə) | sonra               |
| Əsas vəsaitlərin amortizasiyası (112)                       | sonra               |
| Kassa aparatı (NKA) inteqrasiyası                           | sonra               |

## 2. Mövcud koddan nə götürülür

| Kod                                                                                          | Vəziyyət             | Qərar                                                                                                                              |
| -------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/application/bank.ts` — sətirlər, qaimələrə bölgü (`autoSettle`), avans qoruması, storno | auditdən keçib       | Kassa sənədi eyni nüvə ilə yazılır: ümumi "pul sənədi" funksiyaları çıxarılır (təkrar kod yox), bank və kassa ondan istifadə edir. |
| `closePeriod` (`catalog.ts`)                                                                 | yalnız tarix kilidi  | Ay bağlanışının son addımı olur; ayrıca istifadə də qalır.                                                                         |
| `stock.ts` — FIFO (`stockState`, `fifoCost`)                                                 | işləyir              | Ayın dəqiq FIFO hesablaması üçün istifadə olunur (§5.2).                                                                           |
| `reports.ts` — `aggregate` (registrlərdən)                                                   | sürətli              | Bağlanış qalıqları, M/Z, idarə paneli registrlərdən oxunur (jurnal skan edilmir).                                                  |
| `items` kind `cashbox` ("Əsas kassa")                                                        | subkonto, atributsuz | Kassa kitabçasına çevrilir (§3.1). Mövcud id-lər saxlanılır — köhnə yazılışlar etibarlı qalır.                                     |
| Bank / qaimə sənədlərində əl ilə məzənnə                                                     | var                  | Məzənnə kitabçasından özü dolur, əl ilə dəyişmək olar.                                                                             |

## 3. Məlumat modeli (sxem v11)

Cədvəllər mövcud qaydalara tabedir: kompozit `(company_id, id)` xarici açarlar, `DELETE` qadağandır, bağlı dövr trigger-i, `version`, sənəd tarixçəsi.

### 3.1 `cashboxes`

| Sahə                       | Qeyd                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `id`, `company_id`, `name` | Mövcud `items` (kind `cashbox`) elementləri eyni id ilə köçürülür |
| `account`                  | 221.01 (manat), 221.02 (əməliyyat kassası), 221.04 (valyuta)      |
| `currency`                 | 221.04-də valyuta, qalanlarında AZN                               |
| `archived`, `version`      |                                                                   |

### 3.2 `cash_documents`

`bank_documents`-in quruluşu ilə: `direction` (`in` / `out`), `number` (KMO- / KXO-), `date`, `cashbox_id`, `currency`, `rate`, `amount`, `amount_azn`, `counterparty_name` (kimdən / kimə), `basis` (əsas), `lines` (JSON — bank sənədi sətri ilə eyni: hesab, subkontolar, məbləğ, pul hərəkəti maddəsi, məzmun), `status`, `version`.

### 3.3 `currency_rates`

| Sahə                       | Qeyd                                       |
| -------------------------- | ------------------------------------------ |
| `date`, `currency`, `rate` | 4 onluq (1,7000); `UNIQUE(date, currency)` |
| `source`                   | `amb` (yüklənib) / `manual` (əl ilə)       |
| `loaded_at`, `actor`       |                                            |

Məzənnələr şirkətdən asılı deyil (AMB-nin rəsmi rəqəmidir), bütün şirkətlər üçün birdir. Dəyişiklik audit jurnalına yazılır. İstifadə olunmuş məzənnə (yenidən qiymətləndirmədə) dəyişdirilmir — əvvəlcə ay bağlanışı ləğv olunur.

### 3.4 `month_closings`

| Sahə                                    | Qeyd                                      |
| --------------------------------------- | ----------------------------------------- |
| `id`, `company_id`, `month` (`2026-09`) | Şirkət + ay üzrə yeganə aktiv bağlanış    |
| `steps` (JSON)                          | Hər addım: nəticə, cəmlər, xəbərdarlıqlar |
| `rates` (JSON)                          | İstifadə olunan ay sonu məzənnələri       |
| `status`, `version`                     | `posted` / `cancelled`                    |

Hər addım öz yazılışını jurnala `source_type = 'closing'` ilə, ayın son günü tarixi ilə yazır. Mənfəət-zərər hesabatı bağlanış yazılışlarını (5-ci və 6-cı addım) istisna edir — əks halda ay sonu bütün gəlir və xərclər sıfır görünərdi.

## 4. Yazılışlar

### 4.1 Kassa sənədi

| Sənəd         | Hər sətir üçün                       |
| ------------- | ------------------------------------ |
| Mədaxil (KMO) | Dt 221.xx (kassa) / Kt müxabir hesab |
| Məxaric (KXO) | Dt müxabir hesab / Kt 221.xx (kassa) |

Şablonlar (yalnız sətri doldurur):

- alıcıdan nağd ödəniş (211 → qaimələrə bölgü, qalığı 543);
- malsatana nağd ödəniş (531 → bölgü, qalığı 243);
- təhtəlhesab verilməsi və qaytarılması (244.01, işçi);
- əmək haqqı ödənişi (533);
- bankdan nağd pul (222.01, §11 sual 4);
- banka nağd pul (222.01);
- sair.

**Kassa qalığı heç bir gündə mənfi ola bilməz** (§11 sual 3; bank sənədindəki avans qoruması kimi gün-gün yoxlanır).

### 4.2 Valyuta qalıqlarının yenidən qiymətləndirilməsi (ayın son günü)

Bütün valyuta hesablarında, hər subkonto açarı üzrə (221.04, 222.03, 222.04, 223.02, 211.02, 531.02, 243.02, 543.02, 244.02):

```
yeni manat qalığı = valyuta qalığı × AMB məzənnəsi (ayın son günü)
fərq = yeni manat qalığı − uçotdakı manat qalığı
```

| Fərq           | Yazılış (aktiv hesabda)                          | Yazılış (passiv hesabda) |
| -------------- | ------------------------------------------------ | ------------------------ |
| Müsbət (gəlir) | Dt hesab / Kt 611 (gəlir növü "Məzənnə fərqi")   | Dt 731 / Kt hesab        |
| Mənfi (xərc)   | Dt 731 (xərc maddəsi "Məzənnə fərqi") / Kt hesab | Dt hesab / Kt 611        |

- Aktiv-passiv hesablarda (211.02, 531.02) istiqaməti qalığın işarəsi müəyyən edir.
- Valyuta məbləği dəyişmir (yazılışın valyuta məbləği 0-dır).
- Valyuta qalığı sıfır, manat qalığı isə sıfır deyilsə, qalan qəpik də fərq kimi bağlanır.

### 4.3 Alış ƏDV-sinin əvəzləşdirilməsi (§11 sual 1 — mühasibin qərarı lazımdır)

Tövsiyə edilən qayda: ay ərzində ƏDV hissəsi ödənilmiş alış qaimələrinin 241-dəki ƏDV-si:

```
Dt 521.01 (ödəniş növü "Vergi (haqq)") / Kt 241 (kontragent, qaimə, dərəcə)
```

- Mərhələ 3-ün səbət modelindən götürülür: qaimənin ƏDV payını 224.04 bağlayıb. Fiziki şəxs və xarici malsatanın ödənişi isə cari hesabdan gəlir.
- Ödənilməmiş ƏDV 241-də qalır və sonrakı ayın bağlanışında yoxlanır.
- E-qaiməsi olmayan (DVX-də təsdiqlənməmiş) alışın ƏDV-si əvəzləşdirilmir, siyahıda göstərilir.

### 4.4 Gəlir və xərclərin bağlanması

Ayın dövriyyəsi subkonto açarları üzrə sıfırlanır (registrlərdən):

| Hesab                                                   | Yazılış                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| 601, 611, 631 (kredit qalığı)                           | Dt hesab / Kt 801                                             |
| 602, 603, 604.1, 701, 711, 721, 731, 751 (debet qalığı) | Dt 801 / Kt hesab                                             |
| 801 (nəticə)                                            | Mənfəət: Dt 801 / Kt 341; zərər: Dt 341 / Kt 801              |
| Dekabr: 341 (ilin nəticəsi)                             | Mənfəət: Dt 341 / Kt 343; zərər: Dt 343 / Kt 341 (§11 sual 7) |

Bağlanışdan sonra 6xx / 7xx / 801 qalığı sıfırdır. Bu, bağlanışın öz yoxlamasıdır: sıfır deyilsə, bağlanış saxlanmır.

### 4.5 Maya dəyərinin dəqiqləşdirilməsi (FIFO)

Geriyə tarixlə daxil edilmiş alış ayın satışlarının FIFO maya dəyərini dəyişə bilər (mərhələ 2 məhdudiyyəti).

- Ay bağlanışında ayın hər malı üçün FIFO tarix sırası ilə yenidən hesablanır.
- Uçotdakı 701 ilə fərq bir düzəliş yazılışı ilə bağlanır: Dt 701 / Kt 205 və ya əksinə (mal, nomenklatura qrupu üzrə).
- Satış qaimələri yenidən keçirilmir (§11 sual 2) — audit izi və bağlı sənədlər toxunulmaz qalır.

## 5. Ay bağlanışı prosesi

### 5.1 Ardıcıllıq və qaydalar

```
Ay bağlanışı (məs. 2026-09)
  1. Yoxlamalar (bloklayan / xəbərdarlıq)
  2. FIFO dəqiqləşdirilməsi
  3. Valyuta yenidən qiymətləndirilməsi
  4. ƏDV əvəzləşdirilməsi
  5. 6xx / 7xx → 801
  6. 801 → 341   (dekabrda + 341 → 343)
  7. [x] Dövrü bağla (closed_through = 2026-09-30)
```

- **Bütün addımlar bir tranzaksiyadadır:** ya hamısı yazılır, ya heç biri.
- **Əvvəlki ay bağlanmayıbsa, bu ay bağlanmır.** Bağlı dövrə tarixlənmiş sənəd onsuz da yazılmır.
- **Ləğv:** yalnız sonuncu bağlanmış ay ləğv olunur. Ləğvdə bütün addımların yazılışları storno edilir, dövrün kilidi bir ay geri açılır (səbəb məcburidir, audit jurnalına düşür).
- **Yenidən bağlanış:** əvvəlki bağlanış storno edilir, yenisi qurulur (sənəd düzəlişi kimi).

### 5.2 Yoxlamalar

| Yoxlama                                                                        | Növ                     |
| ------------------------------------------------------------------------------ | ----------------------- |
| Ayın son günü üçün valyuta məzənnəsi yoxdur (valyuta qalığı olan valyuta üzrə) | Bloklayır               |
| Mənfi anbar qalığı, mənfi kassa qalığı                                         | Bloklayır               |
| Bütövlük yoxlaması (registr = jurnal) uğursuz                                  | Bloklayır               |
| DVX-də təsdiqlənmiş, uçota alınmamış e-qaimələr (bu ay)                        | Xəbərdarlıq, siyahı ilə |
| DVX ziddiyyətləri, ay üzrə ƏDV fərqi (DVX ↔ uçot)                              | Xəbərdarlıq             |
| Yolda qalmış köçürmə (222.01 / 222.03), cütsüz ƏDV depoziti                    | Xəbərdarlıq             |
| Əvəzləşdirilməmiş avanslar (211 ↔ 543, 531 ↔ 243)                              | Xəbərdarlıq             |

Xəbərdarlıqla bağlanış davam edə bilər. Mühasib "oxudum" təsdiqi verir, bu da bağlanışda saxlanılır.

## 6. Hesabatlar və idarə paneli

| Hesabat                    | Mənbə                                                       | Qeyd                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mənfəət və zərər           | 6xx / 7xx dövriyyəsi, bağlanış yazılışları çıxılmaqla       | Aylar sütunlarda, il cəmi; gəlir növü və xərc maddəsi üzrə açılır                                                                                                 |
| Pul vəsaitlərinin hərəkəti | Bank və kassa sənədlərinin sətirləri (pul hərəkəti maddəsi) | Birbaşa metod; əvvələ / sona qalıq 221 + 223 + 224 ilə tutuşur; maddəsiz məbləğ ayrıca sətirdə                                                                    |
| ƏDV icmalı                 | 604.1 / 521.01, 241, e-qaimələr                             | Satış: 18%, 0%, azad, cəlb olunmayan; alış: əvəzləşdirilən / əvəzləşdirilməmiş; ödənilməli ƏDV                                                                    |
| İdarə paneli               | Registrlər                                                  | Plitələr: ayın gəliri, mənfəəti, pul (bank + kassa), debitor, kreditor, ödənilməli ƏDV, gözləyən e-qaimələr; 12 ayın qrafiki (gəlir / xərc / mənfəət, pul qalığı) |

- İdarə panelində hər rəqəmdən hesabata, oradan sənədə keçmək olur (1C "rasşifrovka").
- Excel-ə çıxış və çap.
- Panel "İş masası"nı əvəz etmir. "Hesabatlar → İdarə paneli" kimi açılır (§11 sual 10).

## 7. İnterfeys

| Bölmə         | Sənədlər        | Yarat                          | Xidmət            | Hesabatlar                               | Kitabçalar                    |
| ------------- | --------------- | ------------------------------ | ----------------- | ---------------------------------------- | ----------------------------- |
| Bank və kassa | Kassa sənədləri | Kassa mədaxili, kassa məxarici | —                 | Kassa kitabı, Pul vəsaitlərinin hərəkəti | Kassalar, Valyuta məzənnələri |
| Mühasibat     | Ay bağlanışları | Ay bağlanışı                   | Dövrün bağlanması | Mənfəət və zərər, ƏDV icmalı             | —                             |
| Hesabatlar    | —               | —                              | —                 | İdarə paneli                             | —                             |

Ay bağlanışı forması:

- yuxarıda ay seçimi və addımların siyahısı (hər birində vəziyyət, cəmlər, "yazılışlar" keçidi);
- xəbərdarlıqlar siyahı ilə, hər birindən sənədə keçid;
- düymələr: "Bağla" (Ctrl+Enter), "Ləğv et".

Kassa sənədi bank sənədinin forması ilə eynidir (klaviatura, şablonlar, Dt/Kt yazılışlar).

## 8. Qəbul testləri

| #   | Ssenari                                                                                                                        | Test                |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| K1  | Kassa mədaxili / məxarici: Dt/Kt, qaimələrə bölgü, avans, təhtəlhesab; storno ilə düzəliş və ləğv                              | integration         |
| K2  | Kassa qalığı heç bir gündə mənfi olmur (geriyə tarixli məxaric də); bağlı dövr                                                 | integration         |
| K3  | Bankdan nağd pul: bank sənədi + kassa mədaxili 222.01 vasitəsilə, 222.01 sıfır                                                 | integration         |
| K4  | Valyuta kassası (221.04): məzənnə kitabçadan, yenidən qiymətləndirmə                                                           | integration         |
| V1  | Məzənnə kitabçası: AMB faylının oxunması (nümunə XML), tarix üzrə axtarış, sənəddə avtomatik dolma                             | domain, integration |
| V2  | Yenidən qiymətləndirmə: 223.02, 211.02, 531.02, 243.02, 543.02 — gəlir / xərc, aktiv / passiv, qəpikbəqəpik misal              | integration         |
| A1  | Sentyabr misalı (QERARLAR) bağlanır: 6xx / 7xx / 801 sıfır, 341 = mənfəət; M/Z hesabatı bağlanışdan əvvəlki rəqəmləri göstərir | integration         |
| A2  | Geriyə tarixli alışdan sonra FIFO dəqiqləşdirilməsi: 701 düzəlişi qəpikbəqəpik                                                 | integration         |
| A3  | ƏDV əvəzləşdirilməsi: depozitdən ödənilmiş hissə 241 → 521.01; ödənilməmiş qalır                                               | integration         |
| A4  | Ardıcıllıq: avqust bağlanmadan sentyabr bağlanmır; yalnız sonuncu ay ləğv olunur; ləğv storno edir və kilidi açır              | integration         |
| A5  | Bloklayan yoxlama (məzənnə yoxdur, mənfi qalıq) bağlanışı dayandırır, heç nə yazılmır                                          | integration         |
| A6  | Dekabr: 341 → 343                                                                                                              | integration         |
| H1  | Pul hərəkəti hesabatı: maddələr üzrə, əvvələ / sona qalıq 221 + 223 + 224 ilə tutuşur                                          | integration         |
| H2  | ƏDV icmalı ay üzrə: DVX tutuşdurması ilə eyni rəqəmlər                                                                         | integration         |
| H3  | İdarə paneli: göstəricilər registrlərlə eyni, rəqəmdən hesabata keçid                                                          | integration, ui     |
| U1  | UI: kassa sənədi klaviatura ilə; ay bağlanışı forması (addımlar, xəbərdarlıq, bağla / ləğv)                                    | ui                  |
| P1  | Yük: 500 000 yazılışlı bazada ay bağlanışı < 10 s; idarə paneli < 1,5 s; M/Z il < 1 s                                          | perf                |
| S1  | Sxem v11: 0.6.x bazası yenilənir (kassa elementləri köçür, köhnə yazılışlar etibarlı), real Electron smoke                     | schema, smoke       |

**Audit:** işi yazmayan ayrıca yoxlayıcı ən azı 2 tur. Tapılan qüsurlar reqressiya testi kimi qalır.

## 9. Mühasibin yoxlaması üçün misal (qəpikbəqəpik)

Bağlanış Sentyabr misalı (QERARLAR) üzərində yoxlanacaq:

- 601 / 604.1 / 701 / 721 dövriyyələri;
- 801-in nəticəsi;
- 341.

Misalın rəqəmləri 5c-də testə yazılır və sizə cədvəl kimi göstərilir — təsdiqinizdən sonra mərhələ bitmiş sayılır.

## 10. İcra ardıcıllığı

Hər addım ayrıca commit-dir, testləri yaşıl saxlayır və (icazənizə görə) avtomatik buraxılır.

1. **5a — Kassa.** ✅ (0.6.5, 17.10.2026) Sxem v11 (`cashboxes`, `cash_documents`), ümumi pul sənədi nüvəsi, KMO/KXO, kassa kitabı, şablonlar, çap forması. Testlər K1–K3, U1-in kassa hissəsi, S1 (0.6.4 bazası, Electron smoke).
2. **5b — Valyuta məzənnələri və yenidən qiymətləndirmə.** `currency_rates`, AMB faylı, sənədlərdə avtomatik məzənnə, yenidən qiymətləndirmə hesabı. Testlər K4, V1, V2.
3. **5c — Ay bağlanışı.** `month_closings`, yoxlamalar, FIFO dəqiqləşdirilməsi, ƏDV əvəzləşdirilməsi, 801 / 341 / 343, dövrün kilidi, ləğv. Testlər A1–A6, P1-in bağlanış hissəsi.
4. **5d — Hesabatlar və idarə paneli.** M/Z, pul hərəkəti, ƏDV icmalı, panel. Testlər H1–H3, P1.
5. **Audit, 0.7.0, `PROJECT_STATE.md` və `QERARLAR.md`.**

## 11. Açıq suallar (istifadəçi və mühasib)

Hər sual üçün tövsiyə verilib. Son qərar sizindir.

1. **Alış ƏDV-sinin əvəzləşdirilməsi (ən vacib).** Hansı ƏDV ayın sonunda 241-dən 521.01-ə keçir?
   - Tövsiyə: yalnız DVX-də təsdiqlənmiş e-qaiməsi olan və ƏDV hissəsi ödənilmiş qaimələrin ƏDV-si. Ödəniş 224.04-dən gəlir; fiziki şəxs və xarici malsatana isə cari hesabdan.
   - Alternativ: ayın bütün təsdiqlənmiş alış e-qaimələrinin ƏDV-si, ödənişdən asılı olmayaraq.
   - Hansı qayda sizin praktikanıza və Vergi Məcəlləsinə uyğundur — mühasibin təsdiqi lazımdır.
2. **FIFO düzəlişi.**
   - Tövsiyə: ay bağlanışında ayrıca düzəliş yazılışı (Dt 701 / Kt 205 və ya əksinə).
   - Alternativ: satış qaimələrinin maya dəyəri yazılışlarını yenidən keçirmək (audit izi mürəkkəbləşir).
3. **Kassa qalığı mənfi ola bilərmi?** Tövsiyə: xeyr, sənəd saxlanmır (1C xəbərdarlıq verir, Meyar bloklayır).
4. **Bankdan nağd pul çıxarılması.**
   - Tövsiyə: iki sənəd 222.01 vasitəsilə (bank məxarici Dt 222.01 / Kt 223; kassa mədaxili Dt 221 / Kt 222.01). Hər biri öz çıxarışı və kassa kitabı ilə tutuşur; 222.01 qalığı nəzarət siqnalıdır.
   - Alternativ: bir sənəd Dt 221 / Kt 223.
5. **AMB məzənnəsi.**
   - Tövsiyə: "AMB-dən yüklə" düyməsi — cbar.az-ın rəsmi gündəlik XML faylından seçilmiş tarix və ya ay üçün.
   - Ay bağlanışında son günün məzənnəsi yoxdursa, yükləməyi təklif edir.
   - Hər açılışda avtomatik yükləmə yoxdur. Onu istəyirsiniz?
6. **Məzənnə fərqi hesabları:** gəlir 611 (gəlir növü "Məzənnə fərqi"), xərc 731 (xərc maddəsi "Məzənnə fərqi") — QERARLAR-dakı 1C sxemi. Təsdiq?
7. **İl bağlanışı:** dekabrın bağlanışında 341 → 343 avtomatik olsun? Tövsiyə: bəli.
8. **Mənfəət vergisi** (901 / 521.04): bu mərhələdə hesablanmır (illik bəyannamə, əl ilə əməliyyat). Sonrakı mərhələyə qalsın?
9. **Kassa orderlərinin çap forması** (KMO / KXO): sizdə istifadə olunan nümunə varmı? Tövsiyə: standart forma, PDF-ə çap.
10. **İdarə paneli:** sizin üçün ən vacib 5–7 göstərici hansılardır? Tövsiyə §6-dakı siyahıdır (gəlir, mənfəət, pul, debitor, kreditor, ödənilməli ƏDV, gözləyən e-qaimələr).
11. **Valyuta kassası** (221.04) istifadə edirsinizmi? Edilmirsə, valyuta kassası sonraya qalar, 5a yalnız manat kassası ilə gedər.
