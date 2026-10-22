# Mərhələ 6 — DVX e-qaimələrinin avtomatik gəlməsi (dizayn)

Status: **təsdiqlənib** (22.10.2026). §11-in cavabları orada və `docs/QERARLAR.md`-də (2026-10-22, mərhələ 6) yazılıb. Fərq: dövr — yalnız açıq dövr (tövsiyə "+ 3 ay" idi).

Əsas: `docs/MERHELE-4-EQAIME.md` (§2 — kabinet səhifəsinin "oxunması" götürülmür, §7 — kabinetə giriş və təhlükəsizlik qaydaları, §11 sual 10 — DVX API), `docs/QERARLAR.md` 2026-10-15 / 2026-10-16 (mərhələ 4; kabinet sessiyası yaddaşdadır, bağlananda silinir), `PROJECT_STATE.md` "Real DVX faylları ilə yoxlama (17.10.2026)".

## 1. Məqsəd və sərhəd

İndi e-qaimə Meyar-a belə gəlir: istifadəçi "DVX kabinetini aç" ilə rəsmi kabinetə daxil olur, Gələnlər / Göndərilənlər → dövr → "Excel-ə ixrac" düyməsini **özü** basır, Meyar endirilən faylı tutub yükləyir. Uçot (uyğunluqlar, avtomatik keçid, statuslar, ziddiyyətlər) artıq avtomatikdir. Əl ilə qalan addım ixracın özüdür: hər istiqamət, hər hesabat növü ("Qaimələr üzrə", "Mallar üzrə") və hər dövr üçün ayrıca.

**Məqsəd:** istifadəçi kabinetə bir dəfə daxil olur (ASAN İmza / SİMA — bunu heç kim onun yerinə edə bilməz). Sonra bir düymə ilə — **"DVX-dən yenilə"** — Meyar həm gələn, həm göndərilən e-qaimələri, onların mal sətirlərini və statuslarını özü alır və indiki idxala verir. Excel yolu ehtiyat kimi qalır.

**Mərhələyə daxildir:**

1. Kabinet sessiyasından istifadə: giriş edildikdən sonra Meyar portalın öz e-qaimə siyahısı sorğularını (§3) əsas prosesdən göndərir. Yalnız oxuma, yalnız siyahıda olan ünvanlar.
2. Kabinetin öz Excel ixracının Meyar tərəfindən istənməsi (§2): eyni fayl, eyni oxuyucu, eyni bir dəfəlik açar (istiqamət + VÖEN + nömrə).
3. Hər iki hesabat ("Qaimələr üzrə" və "Mallar üzrə" — mal sətirləri) və statusların yenilənməsi (açıq dövr).
4. "DVX-dən yenilə" axını: gedişat, ləğv, xəta olanda nə alındığı və Excel-ə keçid; son yeniləmə vaxtı qutuda və İş masasında.
5. Diaqnostika: cavabların **quruluşu** (sahə adları və tipləri, dəyərsiz) faylına yazılması — real cavabla ilk yoxlama üçün.

**Daxil deyil:**

| İş                                                                                 | Mərhələ / səbəb                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| E-qaimənin Meyar-dan DVX-ə **göndərilməsi** (yaratma, imzalama)                    | sonra; ASAN İmza ilə imza lazımdır, səhvin bədəli yüksəkdir (§11 sual 4) |
| Girişin avtomatlaşdırılması (PIN, parol, ASAN İmza təsdiqi)                        | heç vaxt — PIN Meyar-a düşmür (mərhələ 4 §7)                             |
| Arxa planda girişsiz yeniləmə (cədvəllə)                                           | mümkün deyil — sessiya açarı qısa ömürlüdür və diskdə saxlanmır          |
| Kabinet səhifəsinin DOM-undan oxuma (v1.17 kimi)                                   | götürülmür (mərhələ 4 §2)                                                |
| ƏDV bəyannaməsi, e-qaimə aktları, VHF (2020-dən əvvəlki), ƏDV depozit hesabı (VAT) | sonra                                                                    |

## 2. Araşdırma: DVX-in "API"si

- **Rəsmi açıq API yoxdur.** taxes.gov.az-ın "Elektron qaimə-faktura" səhifəsində yalnız bunlar var: oflayn eFP proqramı, imzalanmış paketin ("adoc" / "edoc") kabinetə yüklənməsi, faylların XML formatı ("e-QM_fayllarin_formati.rar"). ERP-lər üçün veb-xidmət, açar və ya sınaq mühiti göstərilməyib. Gələn e-qaimələrin proqramla alınması üçün heç nə yoxdur.
- **Kommersiya vasitəçiləri var** (məs. vatportal.az: "Auto-download from e-taxes", SAP / 1C ilə). Necə qoşulduqları açıqlanmayıb.
- **Portalın öz sorğuları.** `new.e-taxes.gov.az/eportal` səhifəsi (React) e-qaimə siyahısını brauzerdən JSON sorğuları ilə alır. Sorğular hər kəsə açıq JS faylındadır (22.10.2026-da baxılıb, giriş edilmədən):

| Məqsəd             | Sorğu                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Gələnlər           | `POST /api/po/invoice/public/v2/invoice/find.inbox`                        |
| Göndərilənlər      | `POST /api/po/invoice/public/v2/invoice/find.outbox`                       |
| Mal sətirləri üzrə | `POST /api/po/invoice/public/v1/invoice/find.inbox/byProducts` (outbox)    |
| Bir e-qaimə        | `GET /api/po/invoice/public/v2/invoice/{id}?sourceSystem=…`                |
| Səlahiyyət         | başlıq `x-authorization: Bearer <JWT>`; JWT girişdə cavab başlığında gəlir |
| Səhifələmə         | sorğu gövdəsində `offset`, `maxCount`; filtrlər (tarix, status) gövdədə    |

- **Kabinetin "Excel-ə ixrac" düyməsi faylı serverdə hazırladır:** `POST /api/po/invoice/public/{v1|v2}/invoice/find.{inbox|outbox}/<hesabat növü>` (gövdə — siyahının filtrləri) → faylın id-si → `GET /api/po/filestorage/public/v1/download/{id}?type=lk` → `.xlsx`. Bu, mərhələ 4-də real fayllarla yoxlanmış ixracın eynisidir.

**Əsas yol — Excel ixracının özü.** Meyar JSON-u öz çeviricisi ilə oxumur. Kabinetin düyməsinin göndərdiyi ixrac sorğusunu özü göndərir və gələn `.xlsx`-i mövcud oxuyucuya (`readEqTable`) verir. Oxuyucu, istiqamət və VÖEN qoruması, bir dəfəlik açar, statuslar, "Qaimələr üzrə" / "Mallar üzrə" — hamısı dəyişmir. Riskli yeni hissə yalnız sorğunun özüdür. `find.*` JSON siyahısı yalnız diaqnostika (6a) və səhifə sayının yoxlanması üçündür.

**Nəticə:** bu, DVX-in **sənədləşdirilməmiş daxili** interfeysidir. Portalın özü istifadə etdiyi üçün işləyir, amma DVX onu xəbərsiz dəyişə bilər. Ona görə §6-dakı qaydalar var: tanınmayan cavab heç vaxt "təxmin" edilmir, yeniləmə dayanır və Excel yolu təklif olunur. Gövdənin dəqiq sahələri və cavabın quruluşu yalnız real girişlə görünəcək (6a-nın diaqnostikası).

## 3. Sessiya: açar haradan gəlir

```
"DVX-dən yenilə" (qutuda)
  → sessiya yoxdursa: mövcud kabinet pəncərəsi açılır (mərhələ 4 §7, dəyişməz), istifadəçi özü daxil olur
  → Meyar pəncərənin öz sessiyasında portalın getdiyi sorğulara baxır
      (session.webRequest.onBeforeSendHeaders, yalnız https://new.e-taxes.gov.az/api/po/…):
      portalın göndərdiyi "x-authorization" başlığı yaddaşda saxlanır
  → açar tapılan kimi qutuda "DVX ilə əlaqə var" görünür; Meyar-ın sorğuları kabinet pəncərəsinin
      öz sessiyası ilə gedir (eyni kukilər), ona görə pəncərə yeniləmə bitənədək açıq qalır (kiçildilə bilər)
  → kabinet pəncərəsi bağlananda (və ya Meyar bağlananda, 401 cavabında) açar unudulur
```

| Qayda                              | Necə                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| PIN / parol yenə də Meyar-a düşmür | Səhifəyə skript, preload yoxdur; sahələr oxunmur. Yalnız portalın **özünün** göndərdiyi sorğu başlığı oxunur                        |
| Açar diskdə heç vaxt olmur         | Yalnız əsas prosesin yaddaşında; renderer-ə, loqa, audit jurnalına, diaqnostika faylına düşmür (testlə yoxlanır)                    |
| Açar yalnız bir yerə gedir         | `https://new.e-taxes.gov.az` + siyahıdakı yollar (§2 cədvəli); başqa ünvana, yönləndirməyə (redirect) göndərilmir                   |
| Yalnız oxuma                       | Siyahıda yalnız `find.*` və `GET invoice/{id}`; yazma / imza / silmə sorğuları kod səviyyəsində yoxdur                              |
| Bir şirkət — bir sessiya           | Açar onu alan qutuya (şirkət + pəncərə) bağlıdır; başqa şirkətin qutusu ondan istifadə etmir (mərhələ 4 auditinin 8-ci qüsuru kimi) |
| VÖEN yoxlaması                     | Cavabdakı öz VÖEN (alan / satan tərəf) şirkətin VÖEN-i deyilsə — bütün yeniləmə rədd (Excel-dəki istiqamət qoruması kimi, E3)       |
| Yük                                | Ardıcıl sorğular, səhifə 100 e-qaimə, sorğular arası fasilə; 429 / 5xx — dayanır, alınanlar saxlanır                                |

## 4. Məlumat axını

1. Dövr: bağlanmamış ilk aydan bu günədək (§11 sual 3 — yalnız açıq dövr). Qutuda dəyişmək olar. Bağlı dövrdə DVX statusu dəyişsə, bunu yalnız əl ilə yüklənən fayl və ya dövrü dəyişən yeniləmə göstərər.
2. Hər istiqamət (Gələnlər, Göndərilənlər) × hesabat növü ("Qaimələr üzrə", "Mallar üzrə") üçün kabinetin ixrac sorğusu (§2) → `.xlsx` (50 MB həddi, mərhələ 4 kimi) → `readEqTable` → indiki ilkin baxış və idxal.
3. Hamısı mövcud `eq.import` əmri ilə gedir (yeni mənbə növü `dvx`, `eq_imports.source`): eyni bir dəfəlik açar, eyni status tarixçəsi, eyni ziddiyyət qaydaları. Eyni dövrü əl ilə ixracla da, "DVX-dən yenilə" ilə də yükləmək olar — təkrar yaranmır.
4. Sonra "avtomatik" rejimli uyğunluqlar özü tətbiq olunur (§11 sual 5); qalanlar "Təklif"də.

İxrac sorğusunun gövdəsi (filtrlərin adları, tarix formatı, statuslar) 6a-nın diaqnostikası ilə real girişdən tutulur; ondan əvvəl təxmin edilmir.

## 5. Məlumat modeli (sxem v14)

- `eq_imports.source`: `file` | `dvx` (köhnə qeydlər `file`); `dvx` üçün fayl adı əvəzinə dövr və istiqamət.
- `dvx_syncs` (şirkət üzrə): başlama / bitmə vaxtı, dövr, istiqamət, nəticə (`ok` / `partial` / `failed`), say (yeni, status dəyişən, rədd), xətanın mətni. Açar və cavabın məzmunu yazılmır.
- Yeni cədvəl / sütun DVX sahələrini dəyişmir (mərhələ 4-ün trigger-ləri qüvvədə qalır).

## 6. Səhvlər və etibarlılıq

| Hal                                                    | Davranış                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| İxrac sorğusu rədd olunur və ya gələn fayl Excel deyil | Həmin istiqamət üzrə heç nə yazılmır; mesaj: "DVX sorğusu dəyişib — Excel ixracı ilə davam edin"; diaqnostika təklifi |
| Bir e-qaimə oxunmur (məs. naməlum ölçü vahidi)         | Excel-dəki kimi: e-qaimə bütövlükdə yüklənmir, problem siyahısında adı ilə; digərləri gedir                           |
| 401 / açarın vaxtı bitib                               | Dayanır, alınanlar saxlanır; "Kabinetə yenidən daxil olun"                                                            |
| Şəbəkə, 5xx, 429                                       | 3 dəfə fasilə ilə təkrar, sonra `partial`                                                                             |
| Yarımçıq yeniləmə                                      | Hər səhifə öz tranzaksiyasıdır; təkrar yeniləmə qalanını alır (idempotent)                                            |
| Cəmlərin tutuşması                                     | Hər səhifədə DVX-in göstərdiyi ümumi say ilə alınanlar tutuşdurulur; fərq — `partial` və xəbərdarlıq                  |

## 7. İnterfeys

- Qutuda (Alış / Satış → "… e-qaimələr (DVX)") yeni düymə **"DVX-dən yenilə"** (F5). Sessiya yoxdursa kabineti açır, giriş olandan sonra yeniləmə özü başlayır. Gedişat: "Gələnlər: 3 / 7 səhifə…", "Ləğv et".
- Qutu başlığında: "Son yeniləmə: 22.10.2026 14:05 — 12 yeni, 3 status dəyişdi" və ya `partial` / `failed` səbəbi.
- İş masası və ay bağlanışının xəbərdarlıqları: "DVX 7 gündən çoxdur yenilənməyib" (yalnız DVX ilə işləyən şirkətdə; §11 sual 6).
- "Excel faylı yüklə" və "DVX kabinetini aç" yerində qalır.
- Diaqnostika (qutuda, "DVX kabinetini aç"ın yanında): "DVX sorğularının quruluşunu saxla" — `Sənədlər\Meyar-DVX-quruluş-<tarix>.json`. İçində kabinetin öz API sorğuları (yol — rəqəmli hissələr `{id}`, metod, cavab kodu və tipi, gövdənin sahə adları və tipləri) və Meyar-ın təkrar etdiyi `find.*` siyahısının cavab quruluşu var. Statusların kodları və sayları da yazılır. Nömrə, VÖEN, ad, məbləğ və açar yazılmır.

## 8. Qəbul testləri

| #   | Ssenari                                                                                                                                                  | Növ                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| D1  | Saxta yerli server (portalın sorğularını təqlid edir): kabinet pəncərəsindən gələn `x-authorization` tutulur, yalnız siyahıdakı yollara göndərilir       | Electron smoke, `tests/domain` |
| D2  | Açar renderer-ə, loqa, audit jurnalına, bazaya, diaqnostika faylına düşmür (bütün çıxışlarda axtarış)                                                    | integration, smoke             |
| D3  | Saxta serverin ixrac sorğusu ilə verdiyi `.xlsx` (real quruluşda uydurma, `tests/domain/dvx-fixture.ts`) əl ilə yüklənən eyni faylla eyni nəticəni verir | integration                    |
| D4  | Eyni dövr: əvvəl Excel, sonra API (və tərsinə) — 0 yeni; status dəyişən e-qaimə — tarixçədə bir qeyd                                                     | integration                    |
| D5  | Sxem dəyişib (sahə yoxdur, tip fərqlidir) — heç nə yazılmır, mesaj; naməlum status — `unknown`, avtomatik keçmir                                         | `tests/domain`, integration    |
| D6  | 401 ortada, 5xx, 429, şəbəkə kəsilir — alınanlar qalır, `partial`, təkrar yeniləmə qalanını alır                                                         | integration (saxta server)     |
| D7  | Başqa şirkətin VÖEN-i cavabda — bütün yeniləmə rədd; iki şirkətin qutusu açıq — açar yalnız birinə                                                       | integration, `tests/ui`        |
| D8  | UI: "DVX-dən yenilə" → giriş → gedişat → yeni e-qaimələr "Təklif"də; son yeniləmə sətri; F5                                                              | `tests/ui`                     |
| D9  | Yük: 5 000 e-qaimə / 50 000 mal sətri saxta serverdən 50 səhifə ilə ≤ 10 s (CI 20 s)                                                                     | `npm run test:perf`            |
| D10 | Real giriş: istifadəçi bir dəfə ASAN İmza ilə daxil olur — diaqnostika faylı, sonra real yeniləmə Excel faylları ilə eyni say və cəmi verir              | istifadəçi (əl ilə)            |

## 9. Mövcud koddan nə götürülür

| Kod                                                    | Qərar                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `src/main/dvx-portal.ts` (pəncərə, yaddaşdakı sessiya) | Dəyişməz qalır; yalnız `webRequest` ilə başlığın tutulması əlavə olunur |
| `src/main/dvx-policy.ts` (ünvan siyahısı)              | API yolları üçün ayrıca, daha dar siyahı                                |
| `src/domain/eqaime.ts` (`readEqTable`, status / növ)   | Dəyişməz: API ixracı eyni Excel faylıdır                                |
| `src/application/eqaime.ts` (idxal, bir dəfəlik açar)  | Dəyişməz; yalnız `source` sütunu                                        |
| `MEYAR_SMOKE_DVX` yerli sınaq serveri                  | Portalın JSON sorğularını da təqlid edir                                |

## 10. İcra ardıcıllığı

1. **6a — sessiya və diaqnostika.** ✅ Hazır (22.10.2026, 0.7.3; istifadəçinin real diaqnostika faylı gözlənilir). Kabinet sessiyasında portalın API sorğularının qeydi (yaddaşda): açar, yol, gövdənin quruluşu, cavab kodu. Saf qaydalar (`src/main/dvx-api-policy.ts`: API ünvanı, açarın başlıqdan alınması, yolun maskalanması, dəyərsiz quruluş). Yalnız `find.*` siyahısını təkrar edən oxu müştərisi (`src/main/dvx-api.ts`, kabinetin öz sessiyası ilə). Diaqnostika faylı. Saxta serverlə D1, D2. **Bitəndə:** istifadəçi real girişlə (siyahını açıb bir dəfə "Excel-ə ixrac" basaraq) diaqnostika faylını göndərir — D10-un birinci yarısı.
2. **6b — ixracın təkrarı və idxal.** Real quruluş əsasında ixrac sorğusu (dövr, istiqamət, hesabat növü), `.xlsx` → `readEqTable`, sxem v14 (`eq_imports.source`, `dvx_syncs`), xəta / təkrar / 401. D3 (API ixracı = əl ilə ixrac), D4, D5, D6, D7.
3. **6c — "DVX-dən yenilə" axını.** Qutuda düymə, gedişat, ləğv, son yeniləmə, İş masası xəbərdarlığı, yeniləmədən sonra avtomatik uyğunluqlar. D8, D9.
4. **Müstəqil audit** (kodu yazmayan sessiya), D10 — istifadəçi ilə real yeniləmə.

## 11. Açıq suallar (istifadəçi)

**Cavablar (22.10.2026):** 1 — qəbul; 2 — qəbul; 3 — **yalnız açıq dövr**; 5 — bəli, yeniləmədən dərhal sonra; 7 — bəli, istifadəçi diaqnostika faylını göndərəcək. 4 (yalnız oxuma) və 6 (xəbərdarlıq) ayrıca soruşulmayıb: tövsiyə ilə gedilir, 6c-dən əvvəl istifadəçiyə yenidən göstəriləcək.

1. **Sessiya açarının oxunması.** Mərhələ 4 §7 deyir: "sahələr oxunmur, heç nə saxlanmır". Bu mərhələ onu dəyişir: Meyar portalın öz sorğularının başlığından sessiya açarını (JWT) **oxuyur**. Açar yalnız yaddaşda qalır, yalnız e-qaimə siyahısı sorğularına gedir və yeniləmə bitəndə unudulur. PIN və parol əvvəlki kimi oxunmur. Tövsiyə: qəbul.
2. **Sənədləşdirilməmiş interfeys.** DVX bu sorğuları xəbərsiz dəyişə bilər. O gün "DVX-dən yenilə" dayanacaq ("quruluş dəyişib") və Excel ixracı ilə davam ediləcək, düzəliş isə yeni versiya ilə gələcək. Tövsiyə: qəbul. Paralel olaraq 195-1-dən ERP-lər üçün rəsmi qoşulma imkanını soruşmağınız faydalıdır.
3. **Yeniləmənin dövrü.** Tövsiyə: bağlanmamış ilk aydan bu günədək + əvvəlki 3 ay (statuslar və gec təsdiqlər üçün). Alternativ: yalnız açıq dövr.
4. **Göndərmə.** Bu mərhələ yalnız oxuyur. Meyar-ın satış qaiməsindən DVX-də e-qaimə yaratmaq (imzanı siz kabinetdə edirsiniz) ayrıca mərhələ kimi sonra. Tövsiyə: qəbul.
5. **Yeniləmədən sonra avtomatik uyğunluqlar.** Tövsiyə: "avtomatik" rejimli uyğunluqlar yeniləmədən dərhal sonra özü tətbiq olunsun (qalanlar "Təklif"də). Alternativ: mühasib düyməni ayrıca basır (indiki kimi).
6. **"Yenilənməyib" xəbərdarlığı.** Tövsiyə: İş masasında 7 gün, ay bağlanışında — bağlanan ayın sonundan sonra heç yenilənməyibsə. Alternativ: xəbərdarlıq olmasın.
7. **Real yoxlama.** 6a bitəndə bir dəfə kabinetə ASAN İmza ilə daxil olub "DVX cavabının quruluşunu saxla" faylını göndərə bilərsinizmi? Faylda yalnız sahə adları və tiplər olur, rəqəm, ad, VÖEN olmur. Bunsuz 6b-nin sahələri real quruluşla yoxlanmamış qalar.
