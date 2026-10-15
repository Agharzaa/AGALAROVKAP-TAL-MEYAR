# Mərhələ 4 — DVX e-qaimələrinin gətirilməsi və uçotu (dizayn)

Status: **təsdiqlənib** (15.10.2026). Açıq suallarda (§11) tövsiyələr qəbul olunub. Qərarlar `docs/QERARLAR.md`-dədir (2026-10-15, mərhələ 4); bu sənəd icra planı kimi qalır. Real DVX faylları istifadəçidən gözlənilir (§11 sual 1).

Əsas: `docs/QERARLAR.md` — "Avtomatik idxalın əsas prinsipi (DVX e-qaimələri və bank)", "Satış və ƏDV", "Alış", "Alış ƏDV-sinin taleyi", "mərhələ 2: qaimələr" (e-qaimə nömrəsi bir dəfə), 2026-10-14 §7 (qayda "təklif" rejimində yaranır), 2026-10-15 §1 (ödənilmiş qaimə ləğv edilmir).

İstifadəçinin tələbi: _"DVX-dan e-qaimələri çəkməyi bacarmalısan, sən uçota almalısan, qarışdırmamalısan, çox işimiz var."_

## 1. Məqsəd və sərhəd

**Mərhələyə daxildir:**

1. **E-qaimələrin gətirilməsi** — iki yol, bir giriş qapısı:
   - e-taxes.gov.az kabinetindən ixrac olunan Excel faylının yüklənməsi (Gələnlər / Göndərilənlər; "Qaimələr üzrə" və "Mallar üzrə" hesabatları);
   - Meyar-ın içində açılan rəsmi DVX kabineti: istifadəçi özü ASAN İmza / SİMA / istifadəçi kodu + parol + PIN ilə daxil olur, kabinetin öz "Excel-ə ixrac" düyməsi ilə endirilən fayl birbaşa eyni idxala düşür. PIN Meyar-da heç yerdə saxlanılmır və oxunmur (§7).
2. **"Gələn e-qaimələr" qutusu** — hər e-qaimə bir dəfə, DVX-in yazdığı kimi saxlanılır; hər biri üç vəziyyətdən birindədir: **avtomatik / təklif / naməlum** (+ "DVX-də gözləyir", "uçota alınıb", "kənara qoyulub").
3. **Uçot** — alınan e-qaimə → alış qaiməsi (AQ-), göndərilən e-qaimə → satış qaiməsi (SQ-). Yalnız mövcud `invoice.save` ilə: yazılışlar, FIFO, avans əvəzləşdirilməsi, bütün yoxlamalar əl ilə daxil edilən qaimədəki kimidir.
4. **Öyrənən uyğunluq xəritəsi** — DVX mal kodu / adı → Meyar nomenklaturası + hesab + xərc maddəsi / gəlir növü + ƏDV taleyi. Mühasibin qərarından yaranır, "təklif" rejimində başlayır, "avtomatik" rejimini yalnız mühasib qoşur.
5. **DVX statusları** — ləğv edilmiş, düzəliş edilmiş, imtina edilmiş, gözləyən e-qaimələr düzgün işlənir; uçotda olan qaimənin DVX-də ləğvi səssiz keçmir.
6. **DVX ↔ uçot tutuşdurması** — dövr üzrə: DVX-də olub uçotda olmayan, uçotda olub DVX-də olmayan e-qaimələr; ƏDV cəmləri (241 / 521.01) DVX ilə.

**Daxil deyil:**

| İş                                                                             | Mərhələ                |
| ------------------------------------------------------------------------------ | ---------------------- |
| E-qaimənin Meyar-dan DVX-ə göndərilməsi (yaradılması, imzalanması)             | sonra                  |
| ƏDV bəyannaməsi, alış/satış kitabı                                             | 5 (ay bağlanışı)       |
| Qaytarma e-qaiməsi, avans e-qaiməsi, aksizli və yol vergili e-qaimələrin uçotu | sonra — indi "naməlum" |
| DVX-in rəsmi API-si (əgər varsa) ilə qoşulma                                   | sonra (§11 sual 10)    |
| Kabinetin səhifəsindən məlumatın "oxunması" (DOM scraping, v1.17 kimi)         | **götürülmür** (§2)    |

## 2. Mövcud və köhnə koddan nə götürülür

| Kod                                                                                                                       | Vəziyyət                                                                                                                                                                                                                                                                                                                                                  | Qərar                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/application/invoices.ts` — `saveInvoice`, `cancelInvoice`, `guardSettlement`, `guardStock`, e-qaimə nömrəsi bir dəfə | işləyir, auditdən keçib                                                                                                                                                                                                                                                                                                                                   | Uçotun **yeganə** yolu. E-qaimə idxalı ayrıca yazılış qurmur.                                                                                                                  |
| `src/application/statements.ts` (mərhələ 3c)                                                                              | barmaq izi, savepoint-lə hər sətir ayrıca, `manual_only`, `auto_note`, "əl ilə daxil edilmiş sənədlə bağla"                                                                                                                                                                                                                                               | Nümunə kimi götürülür; e-qaimə üçün ayrıca modul (`eqaime.ts`).                                                                                                                |
| `src/domain/rules.ts` — `chooseRule` (ən dəqiq qayda, bərabərdə "təklif" üstündür)                                        | işləyir                                                                                                                                                                                                                                                                                                                                                   | Uyğunluq xəritəsinin seçimi eyni prinsiplə (§6.3).                                                                                                                             |
| `src/renderer/sheet-reader.ts`                                                                                            | XLSX/CSV oxuyur                                                                                                                                                                                                                                                                                                                                           | Faylın oxunması üçün istifadə olunur.                                                                                                                                          |
| Köhnə Meyar ERP v1.17.2 (quraşdırılmış `Meyar ERP`, `main.js`): `openLiveTaxPortal`                                       | Daxili pəncərə `new.e-taxes.gov.az/etaxes/`, yalnız e-taxes.gov.az HTTPS ünvanları, `window.open` eyni pəncərədə, `sandbox` + `contextIsolation`. İstifadəçi özü daxil olur; PIN proqrama verilmir.                                                                                                                                                       | **Götürülür** (ünvan siyahısı, pəncərə qaydaları). Fərq: sessiya diskdə saxlanılmır (§7).                                                                                      |
| v1.17 `extractLiveTaxInvoices`, `navigateLiveTaxInvoices`                                                                 | Kabinet səhifəsinin DOM-undan siyahı "oxunur", menyu düymələri mətnə görə "basılır"                                                                                                                                                                                                                                                                       | **Götürülmür.** Portal dəyişəndə səssiz səhv oxuyur; yalnız başlıq (sətirlər yoxdur); istiqaməti səhifədən təxmin edir. Əvəzinə kabinetin öz Excel ixracı tutulur.             |
| v1.17 `importInvoiceRecords`                                                                                              | Hər faylı **yoxlamasız avtomatik uçota alırdı**, bir sətirli qaimə ilə ("idxal edilmiş e-qaimə"), kontragenti avtomatik yaradırdı                                                                                                                                                                                                                         | **Götürülmür** — QERARLAR-ın əsas prinsipinə ziddir. Dublikat açarı (nömrə + VÖEN + istiqamət) və "mövcud sənəd idxalla dəyişdirilmir" qaydası saxlanılır.                     |
| v1.17 sütun adları (`invoiceFromRaw`, `findImportHeaderRow`)                                                              | Real DVX faylından: "Qaimə/Akt növləri", "Seriya", "Nömrə", "VÖEN", "Adı", "Malın ƏDV-siz ümumi dəyəri", "Malın ƏDV məbləği", "Yekun məbləğ", "ƏDV-yə cəlb edilən", "ƏDV-yə cəlb edilməyən", "ƏDV-dən azad olan", "ƏDV-yə 0 dərəcə ilə cəlb edilən", "Aksiz məbləği", "Yol vergisi", "Əsas qeyd", "Əlavə qeyd", "Səbəb", "Avans seriyası/nömrəsi/məbləği" | Oxuyucunun başlanğıc lüğəti. **Real nümunə ilə təsdiqlənməlidir** (§11 sual 1): Masaüstündəki "Elektron qaimə-fakturalar_Gələnlər_Qaimələr üzrə_2026_05_27.xlsx" artıq yoxdur. |

Qeyd: QERARLAR-da xatırlanan v1.12–v1.14 qovluqları Masaüstündə artıq yoxdur; quraşdırılmış v1.17.2 həmin qoşulmanın son versiyasıdır və ona istinad edildi.

## 3. Məlumat modeli (sxem v10)

Cədvəllər mövcud qaydalara tabedir: kompozit `(company_id, id)` xarici açarlar, `DELETE` qadağandır, DVX-in yazdığı sahələr dəyişdirilmir (trigger), `version`, audit jurnalı.

### 3.1 `eq_imports` — bir yüklənmə

| Sahə                                    | Qeyd                                                         |
| --------------------------------------- | ------------------------------------------------------------ |
| `id`, `company_id`                      |                                                              |
| `source`                                | `file` / `portal`                                            |
| `direction`                             | `purchase` (Gələnlər) / `sale` (Göndərilənlər)               |
| `report`                                | `invoices` ("Qaimələr üzrə") / `goods` ("Mallar üzrə")       |
| `file_name`, `file_hash`                | SHA-256                                                      |
| `period_from`, `period_to`              | Fayldakı e-qaimələrin tarix aralığı                          |
| `rows_read`, `added`, `updated`, `same` | Yeni e-qaimə / status və ya sətirləri yenilənən / dəyişməyən |
| `imported_at`, `actor`                  |                                                              |

### 3.2 `eq_documents` — "Gələn e-qaimələr" qutusu (bir e-qaimə = bir sətir)

| Sahə                                                                        | Qeyd                                                                                                                                                      |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direction`                                                                 | `purchase` / `sale`                                                                                                                                       |
| `eq_number`, `eq_key`                                                       | Çap olunduğu kimi (`MT2610007`) və `numberKey` ilə normallaşdırılmış — `invoices.eq_key` ilə eyni funksiya                                                |
| `tax_id`, `name`                                                            | Kontragentin VÖEN-i və adı (alışda satıcı, satışda alıcı)                                                                                                 |
| `date`                                                                      | E-qaimənin tarixi                                                                                                                                         |
| `kind`                                                                      | `main` / `correction` / `return` / `advance` / `other` — "Qaimə/Akt növləri"ndən                                                                          |
| `ref_key`                                                                   | Düzəliş e-qaiməsinin istinad etdiyi əsas e-qaimənin `eq_key`-i                                                                                            |
| `dvx_status`, `status`                                                      | DVX-in yazdığı mətn və normallaşdırılmış: `accepted` / `pending` / `cancelled` / `corrected` / `rejected` / `unknown` (§5)                                |
| `net`, `vat`, `total`                                                       | Faylın yekunları (qəpiklə, tam ədəd)                                                                                                                      |
| `base_18`, `base_0`, `base_exempt`, `base_nontaxable`, `excise`, `road_tax` | ƏDV bazaları və digər vergilər                                                                                                                            |
| `lines`                                                                     | JSON: "Mallar üzrə" hesabatından mal sətirləri (kod, ad, ölçü vahidi, miqdar, qiymət, ƏDV-siz məbləğ, ƏDV dərəcəsi, ƏDV). Yalnız başlıq yüklənibsə — boş. |
| `content_hash`                                                              | DVX sahələrinin həşi: eyni e-qaimə yenidən gələndə dəyişiklik varmı                                                                                       |
| `state`                                                                     | `waiting` / `posted` / `ignored`. "Avtomatik / təklif / naməlum" oxunanda hesablanır, saxlanmır (3c-dəki kimi, köhnəlmir).                                |
| `invoice_id`                                                                | `state = posted` ⇔ doludur (CHECK)                                                                                                                        |
| `manual_only`, `auto_note`, `reason`                                        | Geri qaytarılmış avtomatik uçot artıq yalnız təklif olur; avtomatın niyə keçmədiyi; kənara qoyma səbəbi (məcburi)                                         |
| `first_import_id`, `last_import_id`, `version`                              |                                                                                                                                                           |

**Bir dəfəlik açar:** `UNIQUE(company_id, direction, tax_id, eq_key)`. Satışda şirkət üzrə, alışda malsatan üzrə — `invoices` cədvəlindəki qayda ilə eyni (QERARLAR, mərhələ 2).

**DVX-in yazdığı sahələr dəyişdirilmir** (trigger): nömrə, VÖEN, tarix, məbləğlər. Yalnız `dvx_status`/`status` (DVX-də status dəyişəndə), boş `lines` (sonra "Mallar üzrə" faylı gələndə) və uçot sahələri yenilənir. Status dəyişikliyi `eq_status_history` cədvəlinə yazılır (köhnə → yeni, hansı yüklənmədən, nə vaxt).

### 3.3 `eq_product_map` — öyrənən uyğunluq xəritəsi

| Sahə                                                         | Qeyd                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `direction`                                                  |                                                                                                                           |
| `tax_id`                                                     | Boş = istənilən kontragent                                                                                                |
| `dvx_code`, `name_key`                                       | DVX mal kodu və normallaşdırılmış ad (`searchKey`). İkisi də boş = **bütün qaimə bir sətir** (yalnız xidmət / xərc, §6.2) |
| `unit`                                                       | DVX ölçü vahidi (məlumat üçün; nomenklaturanın vahidi ilə fərqlənirsə — təklif)                                           |
| `product_id`, `account`, `expense_item_id`, `income_type_id` | `invoiceLineInput`-un sahələri                                                                                            |
| `vat_treatment`                                              | Alışda `offset` / `cost`; boş = şirkətin standartı                                                                        |
| `contract_id`                                                | Yalnız başlıq xəritəsində: bu VÖEN-in e-qaimələri hansı müqaviləyə (bir neçə müqavilə olanda)                             |
| `mode`                                                       | `suggest` / `auto`                                                                                                        |
| `uses`, `last_used_at`, `archived`, `version`, tarixçə       | `bank_rules` kimi: silinmir, arxivləşir, dəyişəndə versiya artır                                                          |

### 3.4 Mövcud koda dəyişikliklər

- `invoices`: `origin` (`manual` / `eqaime`) və `eq_document_id` — sənədi hansı e-qaimə yaradıb (audit izi, `bank_documents.statement_line_id` kimi).
- Yeni əmr `invoice.setEq`: əl ilə daxil edilmiş qaiməyə e-qaimə nömrəsini **yazılışlara toxunmadan** yazır (versiya, audit). Satışda əsas yoldur (§6.5).
- `saveInvoice` dəyişmir. `cancelInvoice` e-qaimədən yaranmış qaimənin ləğvində qutudakı sətri `waiting`-ə qaytarır (`manual_only = 1`), 3d-dəki "geri qaytar" kimi.
- Sxem v10 təmiz bazada və 0.5.0 bazasında yoxlanılır (`schema v1 → current`), real Electron yeniləməsi ilə.

## 4. Yazılışlar

**Yeni yazılış qaydası yoxdur.** Hər e-qaimə adi qaimə kimi `invoice.save` ilə uçota alınır (QERARLAR "mərhələ 2" icra qaydaları):

| E-qaimə            | Qaimə | Yazılış                                                                                                                                                             |
| ------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Göndərilən (satış) | SQ-   | Dt 211.01 / Kt 601 (ƏDV daxil); 18%-də Dt 604.1 / Kt 521.01; mal üçün Dt 701 / Kt 205 (FIFO); açıq avans Dt 543 / Kt 211                                            |
| Alınan (alış)      | AQ-   | Dt 205 / 201 / 721 / 113 (ƏDV-siz) / Kt 531.01; ƏDV əvəzləşdirilirsə Dt 241 / Kt 531.01, maya dəyərinə daxil edilirsə hesabın məbləğinə; açıq avans Dt 531 / Kt 243 |

Qaimənin sahələri e-qaimədən belə dolur:

| Qaimə           | Mənbə                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| Tarix           | E-qaimənin tarixi (§11 sual 5)                                                                                 |
| Kontragent      | VÖEN-ə görə (§6.1)                                                                                             |
| Müqavilə        | Kontragentin həmin növdə (alış / satış) yeganə aktiv müqaviləsi; bir neçədirsə — xəritədəki seçim və ya təklif |
| E-qaimə nömrəsi | `eq_number` (bir dəfəlik yoxlama `saveInvoice`-də onsuz da var)                                                |
| Sətirlər        | Mal sətirləri xəritə ilə (§6.2); qiymət ƏDV-siz (`pricesIncludeVat = false`) — e-qaimə kimi                    |
| ƏDV dərəcəsi    | Sətirdən; yalnız başlıq varsa — bazalardan (`base_18`, `base_0`, `base_exempt`, `base_nontaxable`)             |
| Məzmun          | "Əsas qeyd" + "Əlavə qeyd"                                                                                     |

**Məbləğ yoxlaması (QERARLAR: "cəmi = sətirlərin cəmi, ƏDV = 18% yoxlanılır"):**

1. Faylda sətirlərin cəmi = e-qaimənin yekunu (ƏDV-siz, ƏDV, cəmi).
2. 18% bazanın ƏDV-si = `round(baza × 0,18)` (sətir üzrə yuvarlaqlaşdırma, ±0,01 sətir başına).
3. **Meyar-ın hesabladığı qaimə DVX-in məbləğlərini qəpikbəqəpik təkrarlamalıdır:** hər sətirdə `miqdar × qiymət` = DVX-in ƏDV-siz məbləği və ƏDV = DVX-in ƏDV-si. Qiymət 4 onluqla saxlanılır; təkrarlanmırsa, qiymət `məbləğ / miqdar` ilə yenidən hesablanır, yenə alınmırsa — **təklif**, fərq göstərilir (§11 sual 7).

Yoxlamadan keçməyən e-qaimə heç vaxt avtomatik uçota alınmır.

## 5. DVX statusları ("qarışdırmamaq")

### 5.1 Status → hərəkət

| DVX statusu (normallaşdırılmış)                         | Uçotda hələ yoxdur                                     | Uçotda artıq var                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted` (təsdiqləndi, sistem tərəfindən təsdiqləndi) | üç vəziyyətdən biri (§6)                               | —                                                                                                                                                                                                   |
| `pending` (göndərilib, gözləyir)                        | "DVX-də gözləyir" — uçota alınmır (§11 sual 4)         | Siqnal: "uçotda var, DVX-də hələ təsdiqlənməyib"                                                                                                                                                    |
| `cancelled` (ləğv edilib)                               | "Kənara qoyulub" avtomatik, səbəb "DVX-də ləğv edilib" | **Ziddiyyət** — qırmızı siqnal və bir düymə ilə ləğv (storno) təklifi. Səssiz ləğv **yoxdur** (§11 sual 3). Ödənilmiş qaimə ləğv olunmur (QERARLAR 2026-10-15 §1) — mesaj ödəniş sənədini göstərir. |
| `rejected` (alıcı imtina edib)                          | `cancelled` kimi                                       | `cancelled` kimi                                                                                                                                                                                    |
| `corrected` (düzəliş edilib)                            | Uçota alınmır; düzəliş e-qaiməsini gözləyir            | Düzəliş e-qaiməsi gələndə §5.2                                                                                                                                                                      |
| `unknown`                                               | Naməlum (mətn göstərilir)                              | Siqnal                                                                                                                                                                                              |

Statusların dəqiq mətnləri real fayldan götürüləcək (§11 sual 1); tanınmayan mətn həmişə `unknown`-dır, heç vaxt "təsdiqlənib" sayılmır.

### 5.2 Düzəliş e-qaiməsi (`kind = correction`)

Tövsiyə (§11 sual 2): düzəliş e-qaiməsi **əsas e-qaimənin qaiməsini yeniləyir**, ayrıca qaimə yaratmır:

- əsas qaimə uçotda deyilsə — düzəliş e-qaiməsi əsas kimi uçota alınır, əsas e-qaimə "kənara qoyulur" ("düzəliş ilə əvəz olunub");
- əsas qaimə uçotdadırsa və dövrü açıqdırsa — **təklif**: əsas qaimənin sətirləri düzəlişə görə dəyişdirilir (`invoice.save`, storno + yeni yazılış, adi qoruyucular: anbar, ödəniş, avans); qaimədə hər iki e-qaimə nömrəsi görünür;
- əsas qaimənin dövrü bağlıdırsa — **naməlum**, siqnal: "Düzəliş bağlı dövrə aiddir; açıq dövrdə əl ilə əks yazılışla".

Düzəliş heç vaxt avtomatik tətbiq olunmur.

### 5.3 Təkrar yükləmə

- Eyni fayl ikinci dəfə: heç nə dəyişmir ("0 yeni, 0 yenilənən").
- Üst-üstə düşən dövr: yalnız yeni e-qaimələr əlavə olunur; köhnələrdə yalnız DVX statusu yenilənir.
- Eyni e-qaimə fərqli məbləğlə gələrsə (DVX-də olmamalıdır): mövcud sətir **dəyişdirilmir**, ziddiyyət siqnalı yaranır.
- "Mallar üzrə" faylı "Qaimələr üzrə"dən sonra gəlirsə, boş `lines` doldurulur; sətirlərin cəmi başlığa bərabər deyilsə — doldurulmur, siqnal.

### 5.4 İstiqamət qarışmır

- İstifadəçi faylı yükləyəndə "Gələnlər / Göndərilənlər" seçir; faylın başlığı / vərəq adı ilə tutuşdurulur. Ziddiyyət varsa — fayl qəbul olunmur.
- Faylda həm satıcı, həm alıcı VÖEN-i varsa: şirkətin öz VÖEN-i (`companies.tax_id`) alışda alıcı, satışda satıcı yerində olmalıdır. Başqa şirkətin faylı və ya səhv istiqamət **bütün faylı** rədd edir.
- Faylda e-qaimənin VÖEN-i şirkətin öz VÖEN-idirsə — sətir rədd olunur.

## 6. Üç vəziyyət və öyrənmə

### 6.1 Kontragent və müqavilə

| Hal                                        | Nəticə                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| VÖEN kitabçada var, arxivdə deyil          | tapıldı                                                                                                                           |
| VÖEN yoxdur                                | **Təklif:** "Yeni kontragent" forması VÖEN və adla dolu açılır (növ VÖEN-in son rəqəminə görə ilkin ipucu). Avtomatik yaradılmır. |
| Kontragent arxivdədir                      | təklif                                                                                                                            |
| Növdə (alış / satış) yeganə aktiv müqavilə | tapıldı                                                                                                                           |
| Müqavilə yoxdur                            | təklif ("Müqavilə yarat")                                                                                                         |
| Bir neçə müqavilə                          | Xəritədə bu VÖEN üçün seçilmiş müqavilə varsa — onun rejimi ilə; yoxdursa təklif                                                  |
| Valyuta müqaviləsi                         | təklif (məzənnə lazımdır) — 3d-dəki "valyutada avtomatik uçot yoxdur" qaydası                                                     |

### 6.2 Nomenklatura uyğunluğu

Hər mal sətri üçün xəritədə ən dəqiq uyğunluq axtarılır (§6.3). Tapılmırsa — sətir "naməlum"dur, mühasib seçir.

**Yalnız başlıq varsa** ("Qaimələr üzrə" faylı, sətirlər yoxdur):

- Xəritədə bu VÖEN üçün "bütün qaimə" uyğunluğu varsa (məs. "Azercell → Rabitə xidməti, 721, xərc maddəsi Rabitə") — qaimə ƏDV bazalarına görə 1–4 sətirlə qurulur (18%, 0%, azad, cəlb olunmayan), miqdar 1.
- "Bütün qaimə" uyğunluğu yalnız miqdarsız hesablara (721, 731, 711… — xidmət və xərc) icazəlidir. Mal (205), material (201), əsas vəsait (113) miqdar tələb edir → "Mallar üzrə" faylı gözlənilir (təklif: "mal sətirləri yoxdur").

### 6.3 Ən dəqiq uyğunluq

| Dəqiqlik (yüksəkdən aşağı)           |
| ------------------------------------ |
| VÖEN + DVX kodu + ad                 |
| VÖEN + DVX kodu                      |
| VÖEN + ad                            |
| DVX kodu + ad (istənilən kontragent) |
| DVX kodu (istənilən kontragent)      |

Ad uyğunluğu normallaşdırılmış adın **tam** bərabərliyidir (oxşarlıq yox). Eyni dəqiqlikdə fərqli nəticəli iki uyğunluq — ziddiyyət, təklif. Bərabər uyğunluqlarda "təklif" üstündür (QERARLAR 2026-10-15 §5).

### 6.4 Vəziyyət

| Vəziyyət                   | Nə vaxt                                                                                                                                                                                                                                                                              | Mühasib nə görür                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Avtomatik uçota alındı** | Status `accepted`, növ `main`, manat; kontragent və müqavilə birmənalı; **bütün** sətirlər `auto` uyğunluqla; §4 məbləğ yoxlaması keçir; dövr açıqdır; bu e-qaimə nömrəsi uçotda yoxdur; əl ilə daxil edilmiş uyğun qaimə yoxdur (§6.5); `manual_only = 0`; `invoice.save` uğurludur | Qaimə nömrəsi, istifadə olunan uyğunluqlar. "Geri qaytar" qaiməni ləğv edir (storno), sətir təklifə qayıdır |
| **Təklif**                 | Kontragent, müqavilə və ya ən azı bir sətir məlumdur, amma nəsə təsdiq tələb edir (yeni kontragent / mal adı, bir neçə müqavilə, "təklif" uyğunluğu, məbləğ fərqi, düzəliş e-qaiməsi, əl ilə qaimə ilə uyğunluq…). Səbəb sətirdə yazılır.                                            | Doldurulmuş qaimə forması; Ctrl+Enter ilə uçota alınır                                                      |
| **Naməlum**                | Heç nə tanınmadı, və ya növ dəstəklənmir (qaytarma, avans, aksiz, yol vergisi)                                                                                                                                                                                                       | Kontragent VÖEN-i və DVX sətirləri ilə qismən dolu forma                                                    |

Avtomatik uçot hər e-qaimə üçün **ayrıca savepoint-də** gedir: biri alınmasa (bağlı dövr, anbar qalığı, arxiv element…), digərləri davam edir, səbəb `auto_note`-a yazılır, e-qaimə təklif olur (3d-dəki kimi).

### 6.5 Əl ilə daxil edilmiş qaimə ilə uyğunlaşdırma (ikiqat uçotun qarşısı)

İdxaldan əvvəl uçotda ola bilər:

1. **Eyni e-qaimə nömrəli qaimə** (eyni istiqamət, satışda şirkət, alışda malsatan üzrə) — yeni qaimə yaranmır, sətir həmin qaiməyə bağlanır (`posted`). Məbləğ fərqlidirsə — bağlanır, amma ziddiyyət siqnalı.
2. **Nömrəsiz qaimə:** eyni kontragent + istiqamət + cəmi + tarix (±5 gün, §11 sual 11) — avtomatik **heç vaxt**, təklif: "Bu qaiməyə e-qaimə nömrəsini yaz" (`invoice.setEq`, yazılışlar dəyişmir). Satışda əsas yol budur: mühasib SQ-ni Meyar-da yazır, e-qaiməni DVX-də kəsir, idxal ikisini birləşdirir.

### 6.6 Uyğunluğun yaranması

Mühasib təklif və ya naməlum e-qaiməni uçota alanda, yeni seçilən hər sətir üçün sistem uyğunluq təklif edir: "VÖEN 1234567891 + 'A-95 benzin' → Benzin A-95, 205". Mühasib saxlayır (VÖEN-i "istənilən"ə genişləndirə bilər), düzəldir və ya imtina edir. Yeni uyğunluq **"təklif" rejimində** yaranır; "avtomatik" rejimini yalnız mühasib qoşur (QERARLAR 2026-10-14 §7). Uyğunluqlar "Kitabçalar → E-qaimə uyğunluqları"nda görünür, redaktə olunur, arxivləşir. Hər avtomatik qaimənin auditində "uyğunluq X (vN)" yazılır.

## 7. DVX kabinetinə giriş (PIN / ASAN İmza)

```
"DVX kabinetini aç" (Alış / Satış → Xidmət)
  → ayrıca pəncərə: https://new.e-taxes.gov.az/etaxes/ (rəsmi səhifə, Meyar heç nə dəyişmir)
  → istifadəçi özü daxil olur: ASAN İmza / SİMA / istifadəçi kodu + parol + PIN
  → e-qaimələr → Gələnlər / Göndərilənlər → dövr → kabinetin "Excel-ə ixrac" düyməsi
  → Meyar endirməni tutur: fayl diskə yazılmır, yaddaşda §8-in idxal pəncərəsinə verilir
      (istiqamət açılışda seçilib və faylla tutuşdurulur, §5.4)
  → "Çıxış" və ya pəncərənin bağlanması sessiyanı tam silir
```

**Təhlükəsizlik qaydaları (koddadır, testlənir):**

| Qayda                          | Necə                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PIN / parol Meyar-a düşmür     | Meyar səhifəyə skript yeritmir, sahələri oxumur və doldurmur; preload yoxdur. PIN yalnız rəsmi səhifəyə yazılır.                                                                                             |
| Sessiya diskdə qalmır          | Yaddaşdakı ayrıca sessiya (`partition` `persist:` olmadan); bağlananda kukilər silinir (§11 sual 8)                                                                                                          |
| Yalnız rəsmi ünvan             | `https://` + `e-taxes.gov.az`, `new.e-taxes.gov.az`, `www.e-taxes.gov.az` (+ ASAN İmza / SİMA giriş domenləri — real girişdə dəqiqləşdiriləcək); qalanı bloklanır, `window.open` eyni pəncərədə (v1.17 kimi) |
| Pəncərə izolyasiyası           | `sandbox`, `contextIsolation`, `nodeIntegration: false`, icazə sorğuları (kamera, bildiriş…) rədd                                                                                                            |
| Yalnız Excel endirməsi tutulur | `.xlsx` / `.xls` / `.csv`, 50 MB-a qədər; başqa endirmələr ləğv olunur                                                                                                                                       |
| Avtomatik "klik" yoxdur        | Meyar kabinetdə menyu basmır, siyahı oxumur (v1.17-nin DOM oxuması götürülmür, §2)                                                                                                                           |

Real girişlə uçdan-uca yoxlamanı yalnız istifadəçi edə bilər (onun ASAN İmzası ilə). Avtomatik testlər pəncərə qaydalarını (ünvan siyahısı, endirmənin tutulması, sessiyanın silinməsi) saxta yerli server ilə yoxlayır.

## 8. Axın və interfeys

### 8.1 Yükləmə axını (3c-dəki kimi)

```
Fayl (fayl seçimi və ya kabinetdən endirmə)
  → oxu (renderer, sheet-reader + readEqFile): başlıq sətri, hesabat növü, istiqamət, problemli sətirlər
  → ilkin baxış: istiqamət, dövr, e-qaimə sayı, yeni / yenilənən / dəyişməyən, rədd olunan sətirlər və səbəbləri
  → eqaime.import əmri (bir tranzaksiya, idempotent): eq_imports + eq_documents + status tarixçəsi
  → hər yeni / statusu dəyişən e-qaimə üçün: avtomatik uçot (§6.4), hər biri ayrıca savepoint-də
  → nəticə: "1 240 e-qaimə: 1 105 avtomatik, 98 təklif, 21 naməlum, 12 DVX-də gözləyir, 4 ziddiyyət"
```

Ağır iş writer worker-də hissə-hissə, irəliləyiş göstəricisi və ləğv düyməsi ilə; cədvəllər virtual.

### 8.2 Menyu

| Bölmə | Sənədlər                     | Xidmət                                       | Kitabçalar           |
| ----- | ---------------------------- | -------------------------------------------- | -------------------- |
| Alış  | Alınan e-qaimələr (qutu)     | E-qaimələrin yüklənməsi (fayl), DVX kabineti | E-qaimə uyğunluqları |
| Satış | Göndərilən e-qaimələr (qutu) | E-qaimələrin yüklənməsi (fayl), DVX kabineti | E-qaimə uyğunluqları |

### 8.3 Qutu pəncərəsi

- Yuxarıda: istiqamət, dövr süzgəci, son yükləmə, "Avtomatik uyğunluqları tətbiq et".
- Tablar: **Avtomatik · Təklif · Naməlum · DVX-də gözləyir · Ziddiyyət · Uçota alınıb · Kənar qoyulub** (hər tabda say və cəmi).
- Sətir: tarix, e-qaimə №, VÖEN, kontragent, ƏDV-siz, ƏDV, cəmi, DVX statusu, səbəb.
- Enter — qaimə forması e-qaimədən dolu açılır; Ctrl+Enter uçota alır və **növbəti sətrə** keçir (mərhələ 3c-də sonraya qalan axın burada edilir). Mühasib siçana toxunmadan bütün qutunu keçə bilməlidir.
- Uçotdan sonra yeni sətirlər üçün "Uyğunluq kimi saxla" paneli.

### 8.4 Qaimə forması

- Başlıqda "DVX: MT2610007 · təsdiqlənib · 15.10.2026 yükləndi" zolağı; e-qaimədən yaranıbsa, qutudakı sətrə keçid.
- Sətirdə DVX-in adı, kodu, miqdarı, məbləği yanında görünür; fərq qırmızı.

### 8.5 İş masası və nəzarət

- İş xəritəsində "E-qaimələr" plitəsi: gözləyən sayı.
- Nəzarət siqnalları: DVX-də ləğv edilib, uçotda var; düzəliş gözləyir; uçotda olan e-qaimə nömrəsi yüklənmiş dövrdə DVX-də tapılmadı; DVX ↔ uçot ƏDV fərqi (241 / 521.01, ay üzrə); eyni e-qaimə fərqli məbləğlə.

## 9. Qəbul testləri (mərhələ bunlarsız bitmiş sayılmır)

| #   | Ssenari                                                                                                                                                                                | Test                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| E1  | Oxuyucu: real (anonimləşdirilmiş) "Qaimələr üzrə" və "Mallar üzrə", Gələnlər və Göndərilənlər; Excel tarix nömrəsi, mətn tarix, vergüllü məbləğ, birləşmiş başlıq hüceyrələri          | `tests/domain`                     |
| E2  | Eyni faylın ikinci yüklənməsi: 0 yeni, 0 yenilənən, uçotda heç nə dəyişmir; üst-üstə düşən dövr yalnız yeniləri əlavə edir                                                             | `tests/integration/eqaime.test.ts` |
| E3  | Səhv istiqamət (Gələnlər faylı "Göndərilənlər" kimi), başqa şirkətin faylı — fayl rədd olunur                                                                                          | integration                        |
| E4  | Eyni nömrə iki fərqli malsatandan — iki ayrı e-qaimə; eyni nömrə eyni malsatandan — bir                                                                                                | integration                        |
| E5  | Avtomatik: bütün şərtlər ödənir → AQ- yaranır, yazılışlar əl ilə daxil edilən eyni qaimə ilə **qəpikbəqəpik** eynidir (Dt 205 + Dt 241 / Kt 531.01; avans əvəzləşməsi daxil)           | integration                        |
| E6  | Satış: SQ- yaranır, Dt 211.01 / Kt 601, Dt 604.1 / Kt 521.01, FIFO maya dəyəri — əl ilə versiya ilə eyni                                                                               | integration                        |
| E7  | Yeni VÖEN → kontragent yaranmır, təklif; bir neçə müqavilə → təklif; "təklif" uyğunluğu → təklif; bərabər iki uyğunluq → təklif                                                        | integration                        |
| E8  | Məbləğ: sətirlər ≠ yekun, 18% ≠ ƏDV, Meyar qəpik fərqi verir — avtomatik yoxdur, fərq göstərilir                                                                                       | integration, `tests/domain`        |
| E9  | Yalnız başlıq: xidmət üçün "bütün qaimə" uyğunluğu ilə 18% + azad bazalar iki sətirlə; mal üçün — təklif "mal sətirləri yoxdur"; sonra "Mallar üzrə" faylı sətirləri doldurur          | integration                        |
| E10 | DVX-də ləğv: uçotda yoxdursa kənara qoyulur; uçotdadırsa ziddiyyət + ləğv təklifi; ödənilmiş qaimə ləğv olunmur                                                                        | integration                        |
| E11 | Düzəliş e-qaiməsi: əsas uçotda deyil / açıq dövrdə / bağlı dövrdə — §5.2-nin üç halı                                                                                                   | integration                        |
| E12 | `pending` uçota alınmır; sonrakı faylda `accepted` olanda avtomatik keçir                                                                                                              | integration                        |
| E13 | Əl ilə daxil edilmiş qaimə: eyni e-qaimə nömrəsi → bağlanır, ikinci qaimə yox; nömrəsiz uyğun qaimə → "nömrəni yaz" təklifi, yazılışlar dəyişmir                                       | integration                        |
| E14 | Geri qaytarma: avtomatik qaimənin ləğvi sətri təklifə qaytarır, `manual_only`; növbəti "tətbiq et" onu yenidən keçirmir                                                                | integration                        |
| E15 | Bir pis e-qaimə (bağlı dövr, anbar qalığı çatmır) digərlərini dayandırmır; səbəb sətirdə                                                                                               | integration                        |
| E16 | Bağlı dövrə yazılmır; DVX sahələri dəyişdirilmir, sətir silinmir (trigger)                                                                                                             | integration                        |
| E17 | Portal pəncərəsi: e-taxes.gov.az xaricində naviqasiya bloklanır, `window.open` eyni pəncərədə, endirmə idxala düşür və diskə yazılmır, bağlananda sessiya silinir (saxta yerli server) | `tests/main`                       |
| E18 | UI: fayl yüklənməsi → təklifin Ctrl+Enter ilə uçotu → növbəti sətir; uyğunluğun saxlanması; ziddiyyət siqnalından qaiməyə keçid                                                        | `tests/ui`                         |
| E19 | Yük: 5 000 e-qaimə / 50 000 mal sətri yüklənir < 10 s (avtomatik uçotla); qutu açılışı < 3 s; DBC/iş masası həddləri dəyişmir                                                          | `tests/perf`                       |
| E20 | Sxem v10: 0.5.0 bazası yenilənir, bütövlük ok; real Electron smoke                                                                                                                     | `schema` testi, `MEYAR_SMOKE`      |

**Audit:** işi yazmayan ayrıca yoxlayıcı ən azı 2 tur keçir; hər qüsur əvvəl uğursuz reqressiya testi (`audit:`), sonra düzəliş.

## 10. İcra ardıcıllığı

Hər addım ayrıca commit-dir və `npm run typecheck && npm test && npm run test:ui` yaşıl saxlayır.

1. **4a — İdxal və qutu.** ✅ Hazır (15.10.2026; real DVX faylı ilə hələ yoxlanmayıb — sintetik formatlar). Sxem v10 (`eq_imports`, `eq_documents`, `eq_status_history`, `eq_product_map`, `invoices.origin / eq_document_id`), oxuyucu, `eqaime.import`, istiqamət qoruması, dublikat və status yeniləməsi, qutu pəncərəsi (avtomatik uçotsuz). Testlər E1–E4, E12 (status hissəsi), E16, E19 (idxal), E20.
2. **4b — Uçot.** ✅ Hazır (15.10.2026). Dəqiqləşmələr: `invoice.setEq` əvəzinə `eqaime.link` (nömrəsiz qaiməyə nömrə yazır, yazılışlara toxunmur); bərabər dəqiqlikdə iki uyğunluq ola bilmir (hər dəqiqlik xəritənin unikal açarıdır); "istənilən kontragent" uyğunluğu yalnız DVX kodu ilə (ad təkcə kifayət deyil); qaimə e-qaiməyə bağlananda tarix, VÖEN, nömrə, cəmi və ƏDV DVX ilə eyni olmalıdır. E-qaimədən qaimə forması, kontragent / müqavilə həlli, məbləğ yoxlaması, əl ilə qaimə ilə uyğunlaşdırma, uyğunluq xəritəsi və kitabçası, avtomatik rejim, geri qaytarma. Testlər E5–E9, E13–E15, E18.
3. **4c — DVX statusları və tutuşdurma.** ✅ Hazır (15.10.2026). Dəqiqləşmələr: düzəliş tətbiq olunan qaimənin e-qaimə nömrəsi düzəlişin nömrəsi olur (qaimə həmişə bir "hakim" e-qaiməyə bağlıdır; əsas e-qaimə "əvəz olunub" səbəbi ilə kənardadır); tutuşdurmada düzəlişlə əvəzlənmiş əsas e-qaimə DVX tərəfində sayılmır; "DVX-də yoxdur" yalnız yüklənmiş DVX dövrləri üçün deyilir. Ləğv / imtina / düzəliş, ziddiyyət tabı, İş masası siqnalları, DVX ↔ uçot (sayı və ƏDV). Testlər E10–E12.
4. **4d — DVX kabineti.** Portal pəncərəsi, endirmənin tutulması, sessiyanın silinməsi. Test E17; real girişi istifadəçi yoxlayır.
5. **Audit, 0.6.0 buraxılışı, `PROJECT_STATE.md` ("Mərhələ 4") və `QERARLAR.md`-nin yenilənməsi.**

## 11. Açıq suallar (istifadəçi və mühasib)

Hər sual üçün tövsiyə verilib. Son qərar sizindir.

1. **Real fayl nümunələri (ən vacib).** Masaüstündəki "Elektron qaimə-fakturalar_Gələnlər_Qaimələr üzrə_2026_05_27.xlsx" artıq yoxdur. Lazımdır: e-taxes-dən **4 fayl** — Gələnlər və Göndərilənlər, hər biri "Qaimələr üzrə" və "Mallar üzrə"; mümkünsə içində ləğv edilmiş, düzəliş və gözləyən e-qaimə olsun.
   - Anonimləşdirmə: adlar, VÖEN-lər və məbləğlər dəyişdirilsin; sütunlar, başlıq bloku, status mətnləri və "Qaimə/Akt növləri" olduğu kimi qalsın.
   - Nümunə olmadan oxuyucu yalnız v1.17-dən götürülmüş sütun adları ilə yazılacaq və bu, testlərdə açıq qeyd olunacaq.
2. **Düzəliş e-qaiməsi.** Tövsiyə: §5.2 — əsas qaimə yenilənir (açıq dövrdə), bağlı dövrdə əl ilə. Alternativ: düzəliş fərqi ayrıca qaimə kimi düzəlişin tarixində. Hansı ƏDV dövrünə düşməsi baxımından mühasibin təsdiqi lazımdır.
3. **DVX-də ləğv edilmiş, uçotda olan qaimə.** Tövsiyə: həmişə təklif (bir düymə), heç vaxt səssiz storno. Alternativ: ödənilməyibsə və dövr açıqdırsa avtomatik ləğv.
4. **Hansı statuslar uçota alınır?** Tövsiyə: yalnız "Təsdiqləndi" və "Sistem tərəfindən təsdiqləndi". Gözləyən (alıcı hələ təsdiqləməyib) — uçota alınmır.
5. **Qaimənin tarixi.** Tövsiyə: e-qaimənin tarixi. Alternativ: malın faktiki daxil olma tarixi (onda hər dəfə əl ilə).
6. **Qaytarma, avans e-qaiməsi, aksiz, yol vergisi.** Tövsiyə: bu mərhələdə "naməlum" (qutuda görünür, əl ilə əməliyyatla). Bunlardan hansı sizdə tez-tez olur?
7. **Qəpik fərqi.** DVX qiyməti çox onluqlu ola bilər; Meyar `miqdar × qiymət`-i qəpiyə yuvarlaqlaşdırır. Tövsiyə: əvvəl qiymət `məbləğ / miqdar` ilə; yenə fərq varsa — təklif. Bu tez-tez olarsa, qaimə sətrinə "DVX məbləği əsasdır" seçimi əlavə edilər (qaimə modelinin genişlənməsi, ayrıca təsdiq).
8. **Kabinet sessiyası.** Tövsiyə: Meyar bağlananda sessiya silinir, hər dəfə ASAN İmza ilə yenidən giriş (~30 san). Alternativ: Windows-un qorunan anbarında saxlanılan sessiya (bir neçə gün girişsiz). PIN heç bir halda saxlanılmır.
9. **"Bütün qaimə bir sətir" uyğunluğu** (kommunal, rabitə, icarə — yalnız xidmət/xərc): təsdiq?
10. **DVX API.** DVX-in ERP-lər üçün rəsmi e-qaimə xidməti (API) sizə məlumdurmu? Varsa, sonrakı mərhələdə kabinet pəncərəsini əvəz edə bilər.
11. **Satışda iş qaydası.** Adətən əvvəl Meyar-da SQ yazılır, sonra DVX-də e-qaimə kəsilir, yoxsa əksinə? Tövsiyə: hər ikisi; nömrəsiz SQ ilə uyğunlaşdırma ±5 gün, eyni kontragent və cəmi ilə, yalnız təklif kimi.
12. **Uyğunluğun genişliyi.** Mühasib uyğunluğu saxlayanda standart: "yalnız bu malsatan" (tövsiyə) yoxsa "istənilən malsatan"?
