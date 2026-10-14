# Mərhələ 3 — Bank sənədi və çıxarış idxalı (dizayn)

Status: **təsdiqlənib** (14.10.2026). Açıq suallarda (§10) tövsiyələr qəbul olunub. Qərarlar `docs/QERARLAR.md`-dədir (2026-10-14); bu sənəd icra planı kimi qalır.

Əsas: `docs/QERARLAR.md` — "Bank hesabları", "Bank sənədi", "ƏDV-li ödəniş iki hesaba gəlir", "Avanslar", "Avtomatik idxalın əsas prinsipi", "Böyük həcm və etibarlılıq".

## 1. Məqsəd və sərhəd

**Mərhələyə daxildir:**

1. **Bank sənədi** (daxilolma və məxaric):
   - müxabir hesab bütün hesab planından sərbəst seçilir;
   - sənəd çoxsətirlidir;
   - manat və valyuta ilə işləyir;
   - qaimələrə və avanslara bağlanır;
   - storno ilə düzəliş və ləğv olunur.
2. **ƏDV-li ödənişin 223.01 / 224.04 cütü:** bölgü, cütləşdirmə və 18/118 yoxlaması.
3. **Bank çıxarışının idxalı** (XLSX/CSV):
   - bank hesabı IBAN-a görə tapılır;
   - dublikat yaranmır;
   - hər sətir üç vəziyyətdən birinə düşür (avtomatik / təklif / naməlum);
   - çıxarışın qalığı uçotla tutuşdurulur.
4. **Öyrənən qaydalar:** mühasibin qərarı qaydaya çevrilir, qaydalar görünür və redaktə olunur.

**Daxil deyil:**

| İş                                                   | Mərhələ             |
| ---------------------------------------------------- | ------------------- |
| Kassa sənədləri                                      | 5                   |
| Ay sonu valyuta qiymətləndirməsi                     | 5                   |
| Banklara birbaşa API qoşulması                       | sonra               |
| Ödəniş tapşırığının banka göndərilməsi               | sonra               |
| Əməkhaqqı reyestrinin işçilər üzrə avtomatik bölgüsü | əməkhaqqı mərhələsi |

## 2. Mövcud koddan nə götürülür

| Kod                                                                                                                                                     | Vəziyyət                                           | Qərar                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/statement.ts` — `readStatementTable`, `readStatementDate`, `readStatementAmount`, `readCsv`                                                 | v0.2.0-dan qalıb; v3-də heç yerdə istifadə olunmur | Saxlanılır və genişləndirilir: IBAN, açılış/bağlanış qalığı, valyuta sütunu. Əlavə test yazılır.                                              |
| `classifyStatementLine`                                                                                                                                 | sabit açar sözlərlə təxmin edir                    | Yalnız **ilkin ipucu** kimi qalır: heç vaxt avtomatik uçota salmır. Əsas mexanizm — mühasibin qaydaları (§6).                                 |
| `src/renderer/sheet-reader.ts`, `xlsx.ts`                                                                                                               | var                                                | Faylın oxunması üçün istifadə olunur.                                                                                                         |
| v0.2.0 `statements.ts` — barmaq izi ilə dublikat qoruması, eyni sətrin təkrar sayı                                                                      | tag-da istinad                                     | İdeya götürülür, kod yenidən yazılır (v3 modeli fərqlidir).                                                                                   |
| v0.2.0 `payments.ts` — bölgü cədvəli (`allocations`)                                                                                                    | **götürülmür**                                     | v3-də hesablaşma subkonto ilə aparılır (211 → kontragent → müqavilə → hesablaşma sənədi). Ayrıca bölgü cədvəli ikinci həqiqət mənbəyi olardı. |
| `operations.ts → buildPostings`, `subkonto.ts → checkSideValues`, `stock.ts → openAdvances / settlementBalance`, `domain/invoice.ts → allocateAdvances` | işləyir, testlidir                                 | Bank sənədi bunları təkrar yazmadan istifadə edir.                                                                                            |

## 3. Məlumat modeli (sxem v6)

Cədvəllər mövcud qaydalara tabedir:

- kompozit `(company_id, id)` xarici açarlar;
- `DELETE` qadağandır;
- bağlı dövr trigger-i;
- `version` sahəsi;
- sənəd tarixçəsi.

### 3.1 `bank_documents`

| Sahə                                            | Növ                    | Qeyd                                                                                                    |
| ----------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`, `company_id`                              | TEXT                   |                                                                                                         |
| `direction`                                     | `in` / `out`           | daxilolma / məxaric                                                                                     |
| `number`, `number_key`                          | TEXT                   | Avtomatik nömrə: **BD-000001** (daxilolma), **BX-000001** (məxaric). Şirkət + istiqamət üzrə unikaldır. |
| `date`                                          | TEXT                   |                                                                                                         |
| `bank_account_id`                               | FK → `bank_accounts`   | Uçot hesabı (223.01 / 223.02 / 224.04) və valyuta buradan gəlir. Sənəddə ayrıca saxlanmır.              |
| `currency`, `rate`                              | TEXT, INTEGER          | Valyuta hesabında AMB məzənnəsi, 4 onluq (qaimədəki kimi). Manatda `rate = 1`.                          |
| `amount`, `amount_azn`                          | INTEGER                | Cəmi (sənədin valyutasında və manatla). Sətirlərin cəminə bərabər olmalıdır.                            |
| `bank_reference`                                | TEXT                   | Ödəniş tapşırığının nömrəsi (çıxarışdan).                                                               |
| `counterparty_name`, `counterparty_tax_id`      | TEXT                   | Çıxarışda yazılan kimi. Audit və qaydalar üçündür.                                                      |
| `purpose`                                       | TEXT                   | Ödənişin təyinatı.                                                                                      |
| `pair_id`                                       | TEXT NULL              | ƏDV cütü: 223.01 və 224.04 hissələri bir-birinə bağlanır (§5).                                          |
| `origin`                                        | `manual` / `statement` |                                                                                                         |
| `statement_line_id`, `rule_id`, `rule_version`  | TEXT NULL              | Sənədi hansı çıxarış sətri və hansı qayda yaradıb. Audit izi üçündür.                                   |
| `lines`                                         | TEXT (JSON)            | Saxlanmış sətirlər (qaimədəki model ilə eyni).                                                          |
| `status`, `version`, `created_at`, `updated_at` |                        | `posted` / `cancelled`                                                                                  |

**Sətir (`lines` JSON):**

| Sahə                  | Qeyd                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ |
| `account`             | Müxabir hesab — istənilən yazıla bilən hesab.                                        |
| `sk[0..2]`            | Hesabın analitikasına görə. Boş hesablaşma sənədi "bu bank sənədi" deməkdir (avans). |
| `amount`, `curAmount` |                                                                                      |
| `settle`              | `auto` / `manual`. `auto` olanda sistem açıq qaimələrə özü bölür (§4.3).             |
| `cashFlowItem`        | Açıq sual 1-ə bağlıdır.                                                              |
| `memo`                |                                                                                      |

Sətirlər niyə JSON-dur? Çünki qaimə də belə saxlanılır və bütün hesabatlar onsuz da jurnaldan qurulur. Sətir üzrə SQL sorğusu lazım olsa (məs. pul hərəkəti hesabatı), ayrıca cədvəl miqrasiya ilə əlavə olunar.

### 3.2 `statement_imports` və `statement_lines`

**`statement_imports`** — bir yüklənmiş fayl:

- `bank_account_id`, fayl adı, faylın SHA-256-sı;
- dövr (ilk / son tarix);
- çıxarışdakı açılış və bağlanış qalığı (varsa);
- yüklənmə vaxtı, istifadəçi.

**`statement_lines`** — çıxarışın hər sətri:

| Sahə                                                                               | Qeyd                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import_id`, `bank_account_id`, `date`, `direction`, `amount`, `currency`          |                                                                                                                                                                                                                                                               |
| `reference`, `counterparty`, `counterparty_tax_id`, `counterparty_iban`, `purpose` |                                                                                                                                                                                                                                                               |
| `fingerprint`                                                                      | `sha256(bank hesabı · tarix · istiqamət · məbləğ · nömrə · VÖEN · təyinat · eyni sətrin təkrar sayı)`. `UNIQUE(company_id, bank_account_id, fingerprint)`. Eyni faylı ikinci dəfə yükləmək heç nə dəyişmir. Eyni gündə iki eyni komissiya isə ikisi də qalır. |
| `state`                                                                            | `new` / `proposed` / `posted` / `ignored`                                                                                                                                                                                                                     |
| `document_id`                                                                      | `state = posted` ⇔ `document_id` doludur (CHECK).                                                                                                                                                                                                             |
| `rule_id`, `proposal` (JSON), `reason`                                             |                                                                                                                                                                                                                                                               |

`ignored` vəziyyəti mühasibin "uçota alınmasın" qərarıdır (səbəb məcburidir, auditə düşür). Sətir silinmir.

### 3.3 `bank_rules`

| Sahə                       | Qeyd                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `direction`                |                                                                                                                                       |
| `bank_account_id`          | NULL = bütün hesablar                                                                                                                 |
| `counterparty_tax_id`      | NULL = istənilən                                                                                                                      |
| `purpose_terms`            | Normallaşdırılmış açar sözlər; hamısı təyinatda olmalıdır.                                                                            |
| `amount_min`, `amount_max` | NULL ola bilər                                                                                                                        |
| `template` (JSON)          | Sətirlərin şablonu: hesab, subkontolar və ya həll qaydası (`partnerByTaxId`, `onlyActiveContract`, `openInvoices`), faiz/sabit bölgü. |
| `mode`                     | `suggest` / `auto`                                                                                                                    |
| `uses`, `last_used_at`     |                                                                                                                                       |
| `active`, `version`        |                                                                                                                                       |

- Qayda dəyişəndə versiyası artır, köhnə versiya tarixçədə qalır.
- Qayda silinmir, arxivləşdirilir.

### 3.4 Mövcud koda dəyişikliklər

- `documentExists` / `checkSideValues`: `bank:<id>` sənəd növü əlavə olunur. Bank sənədi hesablaşma sənədi kimi 243/543-də avans açarı olur.
- `bank_accounts`: dəyişmir. IBAN artıq unikaldır, hesab IBAN-a görə tapılır.
- Sxem v6 təmiz bazada və 0.4.x bazasında yoxlanılır (`schema v1 → current` testi). Real Electron yeniləmə yoxlaması da aparılır.

## 4. Yazılışlar

### 4.1 Ümumi qayda

| Sənəd     | Hər sətir üçün                                                            |
| --------- | ------------------------------------------------------------------------- |
| Daxilolma | Dt 223.xx / 224.04 (bank hesabı) / Kt müxabir hesab (sətrin subkontoları) |
| Məxaric   | Dt müxabir hesab (sətrin subkontoları) / Kt 223.xx / 224.04 (bank hesabı) |

- Hər yazılış `buildPostings` + `checkPostings` + `checkSideValues` yoxlamalarından keçir. Bunlar əl ilə əməliyyatdakı yoxlamaların eynisidir.
- Qrup hesabına yazılmır, subkonto məcburidir, arxiv element seçilmir.
- Sənədin cəmi sətirlərin cəminə bərabər olmalıdır. Uyğun gəlmirsə, sənəd saxlanmır.

### 4.2 Şablonlar ("əməliyyat növü" — məcburi deyil, yalnız sətri doldurur)

| Şablon                 | Daxilolma (Kt)                                             | Məxaric (Dt)                                               |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Alıcıdan ödəniş        | 211.01 / 211.02 (qaimələrə bölgü) + qalığı 543.01 / 543.02 | —                                                          |
| Alıcıya qaytarma       | —                                                          | 543.xx və ya 211.xx                                        |
| Malsatana ödəniş       | —                                                          | 531.01 / 531.02 (qaimələrə bölgü) + qalığı 243.01 / 243.02 |
| Malsatandan qaytarma   | 243.xx və ya 531.xx                                        | —                                                          |
| Kredit                 | 501 (alınması)                                             | 501 (əsas borc) + 751 (faiz) — bir ödəniş iki sətir        |
| Vergi / fond           | 521.xx / 522.xx (qaytarma)                                 | 521.xx / 522.xx, ödəniş növü subkontosu ilə                |
| Əmək haqqı             | —                                                          | 533 (işçi)                                                 |
| Təsisçi                | 301 (kapitala qoyuluş)                                     | 534.01 (dividend)                                          |
| Öz hesabları arasında  | 222.01                                                     | 222.01                                                     |
| Valyuta alışı / satışı | 222.04 → 223.01                                            | 222.02 ← 223.01                                            |
| Bank xidməti           | —                                                          | 721 (xərc maddəsi "Bank xidmətləri") — açıq sual 4         |
| Sair                   | sərbəst                                                    | sərbəst                                                    |

**Öz hesabları arasında köçürmə** həmişə 222.01 vasitəsilə gedir: çıxan hesabda Dt 222.01 / Kt 223.01 (A), gələn hesabda Dt 223.01 (B) / Kt 222.01. Səbəbi: iki hərəkət iki ayrı çıxarışda, bəzən fərqli günlərdə gəlir. Hər biri öz çıxarışından müstəqil uçota alınır. 222.01-də qalıq qalırsa, "yolda qalmış köçürmə" nəzarət siqnalı yaranır (İş masası → Nəzarət).

### 4.3 Qaimələrə avtomatik bölgü (`settle: auto`)

Alıcıdan daxilolma sətri (kontragent + müqavilə məlumdur):

1. Həmin kontragent və müqavilənin açıq qaimələri ən köhnədən başlayaraq götürülür. Qaimənin açıq qalığı = 211 açarı (kontragent, müqavilə, qaimə) üzrə qalıq. Bu, `settlementBalance` funksiyası ilə hesablanır.
2. Hər qaiməyə ödənişin bu bank hesabına düşən payı qədər bağlanır (§5.2).
3. Qalan məbləğ 543.01-ə avans kimi yazılır. Hesablaşma sənədi bu bank sənədinin özüdür.

Malsatana məxaric güzgü kimi işləyir: 531 → qalığı 243.

Mühasib `settle: manual` seçib bölgünü özü yaza bilər: hansı qaiməyə nə qədər. Yoxlamalar eynidir: qaimə həmin kontragentə və müqaviləyə aiddir və ləğv edilməyib. Artıq ödənilmiş qaiməyə bağlanma xəbərdarlıq verir.

### 4.4 Düzəliş və ləğv — avans qoruması (yeni nəzarət)

Bank sənədi düzəldiləndə və ya ləğv olunanda köhnə yazılış storno edilir, yeni yazılış qurulur. Bu, qaimələrdəki qayda ilə eynidir. Amma bir halda düzəliş qadağandır:

> Bu sənədin yaratdığı avans artıq sonrakı qaimə tərəfindən əvəzləşdirilib. Sənədin düzəlişi və ya ləğvi həmin avans açarını (543 / 243, hesablaşma sənədi = bu bank sənədi) əks qalığa salırsa, sənəd saxlanmır.

Mesaj: "Bu avans SQ-000012 qaiməsində əvəzləşdirilib; əvvəlcə qaiməni düzəldin."

Bu qayda `guardStock` ilə eyni məntiqdədir: istifadə olunmuş resurs geri götürülmür.

## 5. ƏDV-li ödənişin 223.01 / 224.04 cütü

### 5.1 Model

Alıcı ödənişi iki ödəniş tapşırığı ilə göndərir: əsas hissə cari hesaba (223.01), ƏDV hissəsi ƏDV depozit hesabına (224.04). Çıxarışda bunlar iki ayrı sətirdir, çox vaxt iki ayrı çıxarışda gəlir. Ona görə:

- **Hər hissə ayrıca bank sənədidir.** Hər biri öz bank hesabında, öz çıxarışı ilə tutuşur.
- İki sənəd `pair_id` ilə cütləşdirilir:
  - əl ilə ("Cütü seç");
  - və ya avtomatik: eyni kontragent (VÖEN), eyni istiqamət, tarix fərqi ≤ 3 gün, bir hissə 223.xx, digəri 224.04. Yalnız bir namizəd varsa, cütləşir; bir neçə namizəd varsa, təklif kimi qalır.

### 5.2 Qaimələrə bölgü ƏDV cütündə

Qaimənin ödənilməli hissəsi iki "səbətə" bölünür:

- **depozit payı** = qaimənin ƏDV-si (manatla);
- **əsas pay** = qaimənin cəmi − ƏDV.

Hər bank sənədi yalnız öz səbətini bağlayır: 224.04 depozit payını, 223.xx əsas payı. Səbətin artıq ödənilmiş hissəsi jurnaldan hesablanır: həmin qaimə açarına müxabir hesabı 224.04 olan yazılışlar və digər yazılışlar ayrıca toplanır.

QERARLAR-dakı misal qəpikbəqəpik belə çıxır:

|                                            |    223.01 |   224.04 |      Cəmi |
| ------------------------------------------ | --------: | -------: | --------: |
| Ödəniş (18 000)                            | 15 254,24 | 2 745,76 | 18 000,00 |
| Qaimə 15 000 (ƏDV 2 288,14) üzrə Kt 211.01 | 12 711,86 | 2 288,14 | 15 000,00 |
| Qalıq Kt 543.01 (avans)                    |  2 542,38 |   457,62 |  3 000,00 |

Avansın 224.04 hissəsi qaimə kəsilənə qədər 543.01-də qalır. ƏDV öhdəliyi yalnız e-qaimədə yaranır (QERARLAR, dəyişmir).

### 5.3 18/118 yoxlaması (bloklamır, xəbərdar edir)

Cüt üçün gözlənilən depozit = `round(cəmi × 18 / 118)`. Misalda: 18 000 × 18 / 118 = 2 745,76 ✓.

Fərq ±0,01 AZN-dən böyükdürsə, sənədin başlığında və İş masası → Nəzarət bölməsində xəbərdarlıq çıxır. Fərq varsa, bu iki halın biridir: ya alıcı ƏDV-ni səhv köçürüb, ya da ödəniş qismən ƏDV-sizdir (0% / azad qaimələr). Sənəd saxlanılır, çünki pul real hərəkətdir.

Cütü olmayan 224.04 daxilolması da nəzarətə düşür: "ƏDV hissəsi var, əsas hissə tapılmadı" və tərsinə.

## 6. Çıxarışın idxalı və öyrənən qaydalar

### 6.1 Axın

```
Fayl (XLSX/CSV)
  → oxu (renderer, sheet-reader + readStatementTable)
      başlıq sətri, sütunlar, IBAN, açılış/bağlanış qalığı, problemli sətirlər
  → ilkin baxış: bank hesabı (IBAN üzrə; tapılmasa — seçim), dövr, sətir sayı, problemlər
  → statement.import əmri (bir tranzaksiya): statement_imports + statement_lines
      dublikat sətirlər barmaq izi ilə atlanır, sayı göstərilir
  → hər yeni sətir üçün qayda mühərriki (§6.3) → üç vəziyyətdən biri
  → "auto" sətirlər: hər biri AYRICA tranzaksiyada bank sənədi kimi uçota alınır
      bir sətrin xətası (bağlı dövr, arxiv kontragent…) digərlərini dayandırmır, o sətir "təklif"ə düşür
  → tutuşdurma (§6.4)
```

- Sətirlər çıxarış pəncərəsində virtual cədvəldə göstərilir. 5 000+ sətirlik fayl interfeysi dondurmamalıdır.
- Ağır iş writer worker-də hissə-hissə gedir, irəliləyiş göstəricisi və ləğv düyməsi ilə.

### 6.2 Üç vəziyyət (QERARLAR-ın əsas prinsipi)

| Vəziyyət                   | Nə vaxt                                                                                                                                                       | Mühasib nə görür                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Avtomatik uçota alındı** | `mode = auto` qaydası tapılıb, bütün subkontolar birmənalı həll olunub, bütün yoxlamalar keçib                                                                | Sənəd nömrəsi, qaydanın adı. "Geri qaytar" düyməsi sənədi ləğv edir (storno), sətir `new` vəziyyətinə qayıdır. |
| **Təklif**                 | `suggest` qaydası və ya ilkin ipucu var, amma nəsə təsdiq tələb edir: yeni kontragent, bir neçə müqavilə, cütün seçimi, ilkin ipucu (`classifyStatementLine`) | Doldurulmuş sənəd forması; Ctrl+Enter ilə uçota alınır                                                         |
| **Naməlum**                | Heç nə tapılmadı                                                                                                                                              | Boş forma, yalnız bank tərəfi doludur                                                                          |

### 6.3 Qayda mühərriki

**1. Uyğun qaydaların seçilməsi.** Qayda bu şərtlərin hamısına uyğun gəlməlidir: istiqamət, bank hesabı (varsa), VÖEN (varsa), təyinatın açar sözlərinin hamısı, məbləğ aralığı (varsa).

**2. Ən dəqiq qaydanın seçilməsi.** Ən dəqiq qayda qalib gəlir:

- VÖEN-li qayda VÖEN-siz qaydadan üstündür;
- çox açar sözlü qayda az açar sözlü qaydadan üstündür;
- konkret bank hesabına bağlı qayda ümumi qaydadan üstündür.

Eyni dəqiqlikdə iki fərqli qayda varsa, sistem seçmir: sətir **təklif** olur və ziddiyyət göstərilir.

**3. Şablonun həlli.** Şablondakı subkontolar belə həll olunur:

| Subkonto                                 | Həll                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Kontragent                               | VÖEN-ə görə (VÖEN yoxdursa, yalnız adın tam uyğunluğu ilə və yalnız **təklif** kimi). Yeni VÖEN → kontragent avtomatik yaradılmır, təklif olur. |
| Müqavilə                                 | Kontragentin həmin növdə yeganə aktiv müqaviləsi (daxilolmada satış, məxaricdə alış, kreditdə kredit). Bir neçə müqavilə varsa → təklif.        |
| Hesablaşma sənədi                        | `openInvoices` (§4.3).                                                                                                                          |
| Sabit dəyər (xərc maddəsi, ödəniş növü…) | Qaydada saxlanılıb; arxivdədirsə → təklif.                                                                                                      |

**4. Qaydanın yaranması.** Mühasib təklif və ya naməlum sətri uçota alanda sistem qayda təklif edir: "Bu VÖEN + bu açar sözlər → bu sətirlər". Mühasib saxlayır, açar sözləri düzəldir və ya imtina edir. Yeni qayda `suggest` rejimində yaranır (açıq sual 2).

**5. Görünmə və iz.** Qaydalar "Bank və kassa → Qaydalar" kitabçasında görünür, redaktə olunur, arxivləşdirilir. Hər avtomatik sənəd `rule_id` + `rule_version` saxlayır. Audit jurnalına "Qayda X (v3) ilə avtomatik uçota alındı" yazılır.

### 6.4 Çıxarışın uçotla tutuşdurulması

Faylda açılış və ya bağlanış qalığı varsa, bank hesabı subkontosu üzrə uçot qalığı ilə müqayisə olunur:

- **açılış qalığı:** dövrün ilk günündən əvvəlki uçot qalığı ilə;
- **bağlanış qalığı:** idxaldan sonrakı uçot qalığı ilə.

Fərq varsa, çıxarış pəncərəsində və Nəzarət bölməsində göstərilir. Ən çox rast gəlinən səbəblər:

- uçota alınmamış sətir;
- əl ilə ikinci dəfə daxil edilmiş ödəniş;
- başqa bank hesabına yazılmış sənəd.

**Əl ilə daxil edilmiş sənədlə uyğunlaşdırma.** Çıxarış sətri ilə eyni bank hesabı + tarix (±2 gün) + məbləğ + istiqamət olan, çıxarışa bağlanmamış əl ilə bank sənədi varsa, sistem yeni sənəd yaratmır. Əvəzində "Bu sənədlə bağla" təklif edir. Belə hal təkrar uçotun əsas mənbəyidir.

## 7. İnterfeys (Jurnal dizaynı, 1C iş qaydası)

**Əsas menyu → "Bank və kassa":**

| Sütun      | Elementlər                      |
| ---------- | ------------------------------- |
| Sənədlər   | Bank sənədləri (jurnal)         |
| Yarat      | Bank daxilolması, Bank məxarici |
| Xidmət     | Bank çıxarışının yüklənməsi     |
| Kitabçalar | Bank hesabları, Qaydalar        |

**Bank sənədi forması:**

- **Başlıq:** bank hesabı, tarix, nömrə, bank sənədinin nömrəsi, kontragent (çıxarışdan), təyinat, valyuta / məzənnə, cəmi.
- **Şablon seçimi:** sətri doldurur.
- **Sətir cədvəli:** hesab, subkontolar hesaba görə açılır, məbləğ, bölgü (`auto` / `manual`), məzmun.
- **ƏDV cütü paneli:** cüt sənəd, 18/118 vəziyyəti.
- **"Dt/Kt yazılışlar" bölməsi:** qaimədəki kimi.
- **Klaviatura:** Ctrl+Enter — uçota al və bağla; Ctrl+S — uçota al.

**Çıxarış pəncərəsi:**

- Yuxarıda: bank hesabı, dövr, açılış/bağlanış qalığı (fayl ↔ uçot).
- Tablar: **Avtomatik · Təklif · Naməlum · Uçota alınıb · Kənar qoyulub** (hər tabda say).
- Seçilmiş sətrin forması sağ paneldə açılır. Ctrl+Enter ilə uçota alınır, növbəti sətrə keçir. Mühasib siçana toxunmadan bütün çıxarışı keçə bilməlidir.

**İş masası:**

- iş xəritəsində "Bank çıxarışı" və "Bank sənədləri" plitələri aktiv olur;
- Nəzarət bölməsinə yeni siqnallar əlavə olunur: yolda qalmış köçürmə (222.01), cütü olmayan ƏDV hissəsi, 18/118 fərqi, çıxarış ↔ uçot fərqi.

## 8. Qəbul testləri (mərhələ bunlarsız bitmiş sayılmır)

| #   | Ssenari                                                                                                                                                                         | Test                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| B1  | Sentyabr misalı əl ilə əməliyyatlar əvəzinə bank sənədləri ilə: cəmlər **43 000 / 65 891,14 / 63 288,14**, 223.01 Kapital **35 251,24** — əvvəlki versiya ilə qəpikbəqəpik eyni | `tests/integration/bank.test.ts` |
| B2  | 18 000 ödəniş, qaimə 15 000: §5.2 cədvəli qəpikbəqəpik                                                                                                                          | integration                      |
| B3  | 18/118 fərqi xəbərdarlıq verir, sənəd saxlanılır; cütsüz 224.04 nəzarətə düşür                                                                                                  | integration                      |
| B4  | Kredit: əsas borc 501 + faiz 751 bir sənəddə                                                                                                                                    | integration                      |
| B5  | Öz hesabları arası: 222.01 iki sənəddən sonra sıfırdır; bir tərəf olanda siqnal var                                                                                             | integration                      |
| B6  | Valyuta: 223.02 USD, məzənnə 1,7000; 211.02 qaiməsinə bölgü valyuta məbləği ilə                                                                                                 | integration                      |
| B7  | Avansı qaimədə istifadə olunmuş bank sənədinin düzəlişi və ləğvi rədd olunur (§4.4)                                                                                             | integration                      |
| B8  | Bağlı dövrə bank sənədi yazılmır, düzəldilmir                                                                                                                                   | integration                      |
| B9  | Eyni faylın ikinci yüklənməsi: 0 yeni sətir; eyni gündə iki eyni komissiya — 2 sətir                                                                                            | integration                      |
| B10 | `auto` qayda: sənəd yaranır, `rule_id` var; "geri qaytar" → storno, sətir `new`                                                                                                 | integration                      |
| B11 | Eyni dəqiqlikdə iki qayda → təklif; yeni VÖEN → kontragent avtomatik yaranmır                                                                                                   | integration                      |
| B12 | Bir pis sətir (bağlı dövr) qalanların uçotunu dayandırmır                                                                                                                       | integration                      |
| B13 | Əl ilə daxil edilmiş ödəniş + eyni çıxarış sətri → ikinci sənəd yaranmır, bağlama təklifi                                                                                       | integration                      |
| B14 | Çıxarış ↔ uçot qalığı fərqi göstərilir                                                                                                                                          | integration                      |
| B15 | Oxuyucu: 3+ real bank formatı (anonimləşdirilmiş), IBAN, qalıqlar, 4 onluq məbləğ, Excel tarix nömrəsi                                                                          | `tests/domain`                   |
| B16 | UI: daxilolma klaviatura ilə, çıxarış yüklənməsi → təklifin Ctrl+Enter ilə uçotu                                                                                                | `tests/ui`                       |
| B17 | Yük: 5 000 sətirlik çıxarış < 10 s (qaydalarla), DBC/iş masası həddləri dəyişmir                                                                                                | `tests/perf`                     |
| B18 | Sxem v6: 0.4.6 bazası yenilənir, bütövlük ok; real Electron smoke (Windows CI)                                                                                                  | `schema` testi, CI               |

**Audit:** mərhələ 2-dəki kimi, işi yazmayan ayrıca yoxlayıcı ən azı 2 tur keçir. Tapılan qüsurlar reqressiya testi kimi qalır.

## 9. İcra ardıcıllığı

Hər addım ayrıca commit-dir və testləri yaşıl saxlayır.

1. **3a — Bank sənədi (əl ilə).**
   - sxem v6, `bank.save` / `bank.cancel`, şablonlar, qaimələrə bölgü, avans qoruması;
   - forma və jurnal;
   - testlər B1–B8, B16-nın birinci hissəsi.
2. **3b — ƏDV cütü və nəzarətlər.**
   - `pair_id`, 18/118 yoxlaması, İş masasında siqnallar;
   - testlər B2–B5.
3. **3c — Çıxarış idxalı.**
   - oxuyucunun genişlənməsi, `statement.import`, çıxarış pəncərəsi, tutuşdurma;
   - testlər B9, B12–B15, B17.
4. **3d — Qaydalar.**
   - mühərrik, qaydanın yaranması, Qaydalar kitabçası, avtomatik rejim, geri qaytarma;
   - testlər B10, B11.
5. **Audit, 0.5.0 buraxılışı, `PROJECT_STATE.md` və `QERARLAR.md`-nin yenilənməsi.**

## 10. Açıq suallar (istifadəçi və mühasib)

Hər sual üçün mühəndis tövsiyəsi verilib. Son qərar sizindir.

1. **"Pul vəsaitlərinin hərəkəti maddəsi"** (1C-də 221/223/224-də ikinci subkonto).
   - Tövsiyə: subkonto **yox**, bank sənədi sətrinin atributu olsun. Hesabat bank sənədlərindən qurulsun.
   - Səbəb: 223.xx-də artıq yazılış var. Yazılışı olan hesabın subkontosu dəyişdirilmir (baza qoruması). Subkonto yolu köhnə və yeni şirkətlərdə fərqli hesab planı yaradardı.
   - Mənfi tərəf: əl ilə əməliyyatla 223-ə yazılan məbləğ hesabatda "maddəsiz" görünəcək.
2. **Qaydanın avtomatik rejimə keçməsi.**
   - Tövsiyə: qayda `suggest` rejimində yaranır. `auto` rejimini yalnız mühasib özü qoşur ("Bu qayda üzrə avtomatik keçir").
   - Alternativ: eyni qayda 3 dəfə dəyişiklik edilmədən təsdiqlənəndə sistem `auto` təklif edir.
   - Sistem heç vaxt öz-özünə `auto` rejiminə keçmir.
3. **18/118 dözümlülüyü:** ±0,01 AZN kifayətdirmi? Yoxsa qəpik fərqi ümumiyyətlə siqnal verməsin?
4. **Bank xidmətləri (komissiya):** 721 "İnzibati xərclər" (xərc maddəsi "Bank xidmətləri") yoxsa 731? 1C bazanızda hansı hesab istifadə olunur?
5. **Kredit faizi:** 751 "Maliyyə xərcləri" (Kontragent → Müqavilə) — təsdiq?
6. **Vergi ödənişlərinin subhesabı:** təyinatdakı büdcə təsnifat koduna görə 521.xx / 522.xx avtomatik seçilsin?
   - Tövsiyə: bəli. Kod → subhesab cədvəli mühasib tərəfindən doldurulur, sonra qayda kimi işləyir.
   - Sizdən lazım olan: istifadə etdiyiniz kodların siyahısı.
7. **Əmək haqqı:** bankdan bir məbləğ (kart layihəsi) çıxır, amma 533-də subkonto İşçidir.
   - Tövsiyə: hələlik bir sənəddə hər işçi bir sətir (əl ilə və ya Excel reyestrindən).
   - Avtomatik bölgü əməkhaqqı mərhələsinə qalır.
8. **Real çıxarış nümunələri:** hansı banklarla işləyirsiniz (Kapital, PAŞA, ABB…)? Hər bankdan bir çıxarış faylı lazımdır.
   - Fayl anonimləşdirilə bilər: adlar, VÖEN və məbləğlər dəyişdirilsin, sütunlar və başlıq bloku qalsın.
   - Nümunə olmadan oxuyucu yalnız sintetik fayllarla yoxlanılacaq. Bu, testlərdə açıq qeyd olunacaq.
9. **Nömrələmə:** BD-000001 / BX-000001 uyğundurmu?
10. **Valyuta alışı/satışı:** 1C sxemi (222.02 / 222.04, fərq 731 / 611) bu mərhələdə şablon kimi verilsin, yoxsa mərhələ 5-ə (valyuta) qalsın?
    - Tövsiyə: şablon indi, məzənnə fərqinin avtomatik hesablanması mərhələ 5-də.
