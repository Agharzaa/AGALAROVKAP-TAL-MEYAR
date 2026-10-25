# Mərhələ 7 — Əsas vəsaitlər və amortizasiya (dizayn)

Status: **təsdiq gözləyir** (25.10.2026). İstifadəçi mərhələ 7 olaraq "Əsas vəsaitlər"i seçdi. Açıq suallar §11-dədir; cavablardan sonra qərarlar `docs/QERARLAR.md`-yə yazılır və icra başlayır.

Əsas: `docs/QERARLAR.md` — "Alış" (əsas vəsait → 113, istismara verəndə 111), "TƏSDİQLƏNDİ: 205, 201, 111, 113 — subkonto Nomenklatura + miqdar", mərhələ 5 (ay bağlanışı: bir sənəd, addımlar, ləğv), 2026-10-25 §17 auditin tövsiyəsi (avtomatik qaydalar gələcək əsas vəsaitləri 721-ə yaza bilər).

## 1. Məqsəd və sərhəd

İndi əsas vəsait (maşın, avadanlıq) alış qaiməsi ilə 113-ə düşür və orada qalır. İstismara vermə, amortizasiya və silinmə yoxdur. Mühasib bunları əl ilə əməliyyatla yazmalıdır, amortizasiyanı da hər ay özü hesablamalıdır. MG Transport-un əsas aktivi nəqliyyat vasitələridir, ona görə amortizasiya hər ay xərcə düşməlidir.

**Mərhələyə daxildir:**

1. **"Əsas vəsaitlər" kitabçası** (1C-dəki kimi ayrıca siyahı): ad, inventar nömrəsi, qrup (nəqliyyat, maşın və avadanlıq, bina, hesablama texnikası, digər), dövlət nömrəsi / seriya, qeyd.
2. **İstismara vermə sənədi** (ƏV-000001): 113-dən 111-ə keçid. Burada ilkin dəyər, faydalı istifadə müddəti (ay), ləğv dəyəri, amortizasiya üsulu və xərc hesabı (hesab + xərc maddəsi) qeyd olunur. Bir sənəddə bir neçə vəsait ola bilər.
3. **Başlanğıc qalıqlar:** Meyar-dan əvvəl alınmış vəsaitlər üçün ilkin dəyər, yığılmış amortizasiya və qalan müddət. Yazılış Dt 111 / Kt qarşı hesab və Dt qarşı hesab / Kt 112 olur. Qarşı hesabı mühasib seçir (məs. 301), çünki Meyar-da başlanğıc qalıqlar belə yazılır və 000 köməkçi hesabı yoxdur.
4. **Amortizasiya — ay bağlanışının yeni addımı** (FIFO-dan sonra, 6xx / 7xx → 801-dən əvvəl). Yazılış: Dt xərc hesabı (701 / 711 / 721 / 202, xərc maddəsi "Amortizasiya") / Kt 112. Ay bağlanışı ləğv ediləndə bu yazılış da storno olunur, əlavə iş tələb etmir.
5. **Silinmə** (ƏS-000001): Dt 112 / Kt 111 yığılmış amortizasiya qədər; qalıq dəyər Dt 731 (xərc maddəsi "Əsas vəsaitlərin silinməsi") / Kt 111.
6. **Satış:** əsas vəsaitin satış qaiməsi ilə. Gəlir Dt 211 / Kt 611, satışın ƏDV-si Dt 611 / Kt 521.01 (1C sxemi, §11 sual 6), qalıq dəyər silinmə kimi. İndi "satışda əsas vəsait qaimə ilə satılmır" qaydası var; bu qayda dəyişir.
7. **Hesabatlar:**
   - əsas vəsaitlərin siyahısı (dəyər, yığılmış amortizasiya, qalıq dəyər, aylıq amortizasiya, qalan ay);
   - əsas vəsaitin kartı (bütün hərəkətləri);
   - amortizasiya cədvəli (ay üzrə).
8. **E-qaimə qutusu:** alışda "Əsas vəsait" növlü nomenklatura həmişə 113-ə düşür. "Bütün qaimə" uyğunluğu (721) olan kontragentdən gələn e-qaimədə əsas vəsait sətri varsa, avtomatik uçot dayanır və e-qaimə "Təklif"ə düşür (auditin tövsiyəsi).

**Daxil deyil:**

| İş                                                                          | Mərhələ            |
| --------------------------------------------------------------------------- | ------------------ |
| Vergi amortizasiyası (Vergi Məcəlləsi 114: qrup üzrə illik normalar, hovuz) | sonra (§11 sual 2) |
| Yenidən qiymətləndirmə, dəyərsizləşmə (MHBS 16 / 36)                        | sonra              |
| Modernizasiya və təmir kapitallaşması (dəyərin artırılması)                 | sonra (§11 sual 7) |
| Qeyri-maddi aktivlər (101 / 102)                                            | sonra              |
| Lizinq                                                                      | sonra              |
| İnventarizasiya                                                             | sonra              |

## 2. Mövcud koddan nə götürülür

| Kod                                                          | Qərar                                                                                                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/application/invoices.ts` — `asset` növü → 113           | Dəyişmir. 113-də subkonto Nomenklatura qalır: tikili və quraşdırma məsrəfləri bir vəsaitə hələ bağlı deyil. İstismara vermə sənədi 113-ün nomenklatura qalığını vəsaitin 111-inə keçirir. |
| Ay bağlanışı (`src/application/closing.ts`) — addımlar, ləğv | Amortizasiya yeni addımdır. Eyni tranzaksiyada, eyni storno ilə işləyir.                                                                                                                  |
| Sənəd nüvəsi (nömrə, versiya, storno, tarixçə, bağlı dövr)   | İstismara vermə və silinmə sənədləri eyni qaydalarla işləyir.                                                                                                                             |
| `aggregate` (registrlər)                                     | Siyahı və kart registrlərdən oxunur, jurnal skan edilmir.                                                                                                                                 |

## 3. Məlumat modeli (sxem v15)

- **Yeni subkonto növü `fixedAsset`** ("Əsas vəsaitlər" kitabçası, §11 sual 1). 111 və 112-nin subkontosu Nomenklatura əvəzinə bu olur.
  - 111 miqdarlı qalmır: hər vəsait bir sətirdir.
  - Bazada 111 / 112-də artıq yazılış varsa, miqrasiya onları dəyişmir və mühasibə xəbər verir.
- **`fixed_assets`** (kitabça): `id`, `company_id`, `name`, `inventory_no` (şirkət üzrə unikal, boş qalsa avtomatik İN-000001), `group`, `plate`, `note`, `archived`, `version`.
- **`asset_terms`** — amortizasiyanın şərtləri tarix üzrə: başlama tarixi, ilkin dəyər, ləğv dəyəri, müddət (ay), üsul, xərc hesabı + xərc maddəsi, mənbə sənəd. Şərtlər yalnız sənədlə dəyişir: istismara vermə, başlanğıc qalıq, gələcəkdə modernizasiya.
- **`asset_documents`** — istismara vermə (`commission`), başlanğıc qalıq (`opening`), silinmə (`disposal`). Sətirdə vəsait və onun şərtləri olur. Silmə qadağandır, ləğv storno ilədir, bağlı dövr qorunur.
- Amortizasiya ayrıca cədvəldə saxlanmır. O, ay bağlanışının addımıdır və yazılışları `month_closings` sənədinə aiddir.

## 4. Yazılışlar

### 4.1 İstismara vermə (vəsaitin tarixində)

```
Dt 111 (vəsait)            50 000,00
   Kt 113 (nomenklatura)   50 000,00
```

113-ün həmin nomenklatura üzrə qalığı kifayət etməlidir. Qalıqdan az da keçirmək olar: məsələn, bir alışdan iki maşın. Bu halda miqdar mütənasib keçir.

### 4.2 Amortizasiya (ayın son günü, ay bağlanışı)

- **Üsul:** düz xətt. Aylıq məbləğ = (ilkin dəyər − ləğv dəyəri) / müddət. Hər ay qəpiyə yuvarlaqlaşdırılır.
- **Son ay:** qalanı tam silir, qəpik qalığı qalmır (FIFO-dakı kimi).
- **Başlama:** istismara verildiyi ayın **növbəti** ayından (1C və MHBS praktikası, §11 sual 3).
- **Bitmə:** qalıq dəyər ləğv dəyərinə çatanda və ya silinmə ayında.
- Silinmə ayında amortizasiya hesablanmır.

```
Dt 701 (Əsas nomenklatura qrupu, Amortizasiya)   833,33
   Kt 112 (vəsait)                                833,33
```

### 4.3 Silinmə

```
Dt 112 (vəsait)                              yığılmış amortizasiya
   Kt 111 (vəsait)
Dt 731 (Əsas vəsaitlərin silinməsi)          qalıq dəyər
   Kt 111 (vəsait)
```

### 4.4 Satış

Satış qaiməsinin "Əsas vəsait" sətri iki şey edir:

- gəlir Dt 211 / Kt 611 ("Əsas vəsaitin satışı" gəlir növü), ƏDV ilə birlikdə;
- həmin tarixdə 4.3-dəki silinmə yazılışları.

Satış tarixində o ayın amortizasiyası hələ hesablanmayıb. Ay bağlanışı satılmış vəsaitə həmin ay amortizasiya hesablamır (§11 sual 3).

## 5. Ay bağlanışında amortizasiya

```
Ay bağlanışı (məs. 2026-11)
  1. Yoxlamalar
  2. FIFO dəqiqləşdirilməsi
  3. Amortizasiya                 ← yeni
  4. Valyuta yenidən qiymətləndirilməsi
  5. ƏDV əvəzləşdirilməsi
  6. 6xx / 7xx → 801
  7. 801 → 341 (dekabrda + 341 → 343)
  8. Dövrü bağla
```

**Yeni yoxlamalar:**

| Yoxlama                                                   | Növ         |
| --------------------------------------------------------- | ----------- |
| 113-də 3 aydan çox qalan qalıq (istismara verilməyib?)    | Xəbərdarlıq |
| Amortizasiyanın xərc hesabı və ya xərc maddəsi arxivdədir | Bloklayır   |
| 112 qalığı 111-dən böyükdür (vəsait üzrə)                 | Bloklayır   |

## 6. Hesabatlar

| Hesabat              | Məzmun                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Əsas vəsaitlər       | Tarixə: inv. nömrə, ad, qrup, ilkin dəyər, yığılmış amortizasiya, qalıq dəyər, aylıq məbləğ, qalan ay; Excel |
| Əsas vəsaitin kartı  | İstismara vermə, aylar üzrə amortizasiya, silinmə / satış; hər sətirdən sənədə keçid                         |
| Amortizasiya cədvəli | Vəsait × ay (il üzrə), cəmlər; gələcək aylar proqnoz kimi (boz)                                              |

Dövriyyə balansında 111 və 112 vəsait üzrə açılır, hesab kartı da eyni qaydada işləyir.

## 7. İnterfeys

- Menyu "Əsas vəsaitlər":
  - Əsas vəsaitlər (siyahı = hesabat);
  - İstismara vermə;
  - Silinmə;
  - Başlanğıc qalıqlar;
  - Amortizasiya cədvəli.
- İş masasının "İş xəritəsi"ndə yeni sətir: Alış qaiməsi (113) → İstismara vermə (111) → Ay bağlanışı (amortizasiya) → Silinmə / Satış.
- İstismara vermə formasında xərc hesabı, xərc maddəsi və müddət qrupa görə özü dolur (§11 sual 4), mühasib dəyişə bilər. Formada ilk ayların amortizasiyası (ilk 3 ay və son ay) əvvəlcədən göstərilir.

## 8. Qəbul testləri

| #   | Yoxlama                                                                                             | Növ         |
| --- | --------------------------------------------------------------------------------------------------- | ----------- |
| Ə1  | Alış (113) → istismara vermə (111): 113 sıfırlanır, 111-də vəsait; 113 qalığından çox keçirmək rədd | integration |
| Ə2  | 60 ay, 50 000: hər ay 833,33, 60-cı ay 833,53; cəmi qəpikbəqəpik 50 000; 61-ci ay heç nə            | integration |
| Ə3  | Ay bağlanışı ləğvi amortizasiyanı storno edir; yenidən bağlanış eyni məbləği verir                  | integration |
| Ə4  | Silinmə: 112 və 111 sıfırlanır, qalıq dəyər 731-də; silinmə ayında amortizasiya yoxdur              | integration |
| Ə5  | Satış qaiməsi: 611 gəlir, ƏDV, silinmə yazılışları; həmin ay amortizasiya yoxdur                    | integration |
| Ə6  | Başlanğıc qalıq: yığılmış amortizasiya və qalan müddət ilə — növbəti ay (qalıq − ləğv) / qalan ay   | integration |
| Ə7  | E-qaimədə əsas vəsait sətri: "bütün qaimə 721" uyğunluğu avtomatik uçota almır, "Təklif"            | integration |
| Ə8  | Forma: istismara vermə, cədvəlin önizləməsi, siyahı və kart, Excel                                  | tests/ui    |
| Ə9  | 200 vəsait × 60 ay ay bağlanışı ≤ 2 s (lokal)                                                       | perf        |

## 9. Mühasibin yoxlaması üçün misal (qəpikbəqəpik)

**Faktlar:**

- Mercedes Actros 59 000,00 ₼-ya alınıb (ƏDV daxil), 12.10.2026.
- İstismara verilib 15.10.2026: müddət 60 ay, ləğv dəyəri 0, xərc 701 "Amortizasiya".

**Yazılışlar:**

| Tarix      | Yazılış                                | Məbləğ                     |
| ---------- | -------------------------------------- | -------------------------- |
| 12.10.2026 | Dt 113 / Kt 531.01; Dt 241 / Kt 531.01 | 50 000,00; 9 000,00        |
| 15.10.2026 | Dt 111 / Kt 113                        | 50 000,00                  |
| 31.10.2026 | Amortizasiya                           | **yoxdur** (növbəti aydan) |
| 30.11.2026 | Dt 701 / Kt 112                        | 833,33                     |
| …          | hər ay                                 | 833,33                     |
| 31.10.2031 | Dt 701 / Kt 112 (60-cı ay)             | 833,53                     |

Yoxlama: 59 × 833,33 + 833,53 = 50 000,00.

## 10. İcra ardıcıllığı

Hər addım ayrıca commit-dir. Hər addımda əvvəl uğursuz test yazılır, hamısı yaşıl qalır, və (icazənizə görə) avtomatik buraxılır.

1. **7a — kitabça və istismara vermə.**
   - sxem v15 (`fixed_assets`, `asset_terms`, `asset_documents`, `fixedAsset` subkontosu);
   - istismara vermə və başlanğıc qalıqlar;
   - siyahı.
   - Testlər: Ə1, Ə6 (yalnız şərtlər), Ə8-in bir hissəsi.
2. **7b — amortizasiya ay bağlanışında.** Addım, yoxlamalar, ləğv, amortizasiya cədvəli, vəsaitin kartı. Testlər: Ə2, Ə3, Ə6, Ə9.
3. **7c — silinmə və satış.** Silinmə sənədi, satış qaiməsində əsas vəsait sətri, e-qaimə qoruması. Testlər: Ə4, Ə5, Ə7.
4. **Müstəqil audit** (kodu yazmayan sessiya), `PROJECT_STATE.md`, `QERARLAR.md`.

## 11. Açıq suallar (istifadəçi və mühasib)

Hər sual üçün tövsiyə verilib. Son qərar sizindir.

1. **111 / 112-nin subkontosu.**
   - Tövsiyə: ayrıca "Əsas vəsaitlər" kitabçası (1C kimi; inventar nömrəsi, dövlət nömrəsi).
   - Alternativ: Nomenklatura qalsın (QERARLAR-dakı indiki qərar). Onda hər maşın ayrıca nomenklatura olur və inventar nömrəsi olmur.
2. **Vergi amortizasiyası.**
   - Tövsiyə: bu mərhələdə yalnız mühasibat (düz xətt).
   - Vergi Məcəlləsinin 114-cü maddəsi üzrə illik normalarla (məs. nəqliyyat 25%, bina 7%) vergi amortizasiyası mənfəət vergisi bəyannaməsi ilə birlikdə sonrakı mərhələdə olsun.
   - Mühasibin təsdiqi lazımdır.
3. **Başlama və bitmə.**
   - Tövsiyə: istismara verildiyi ayın növbəti ayından başlayır, silindiyi / satıldığı ay hesablanmır (1C kimi).
   - Alternativ: istismara verildiyi aydan və gün hesabı ilə.
4. **Qrup üzrə standartlar** (forma özü doldurur, dəyişmək olar):
   - nəqliyyat — 60 ay;
   - maşın və avadanlıq — 60 ay;
   - hesablama texnikası — 36 ay;
   - bina — 240 ay;
   - digər — 60 ay.
     Uyğundurmu?
5. **Amortizasiyanın xərc hesabı MG Transport üçün.**
   - Tövsiyə: daşıma maşınları → 701 (satışın maya dəyəri, "Əsas nomenklatura qrupu", xərc maddəsi "Amortizasiya"), çünki xidmətin maya dəyəridir.
   - Ofis avadanlığı → 721.
   - Alternativ: hamısı 721 (e-qaimələrdə olduğu kimi).
6. **Əsas vəsaitin satışında gəlir.**
   - Tövsiyə: 611 "Sair əməliyyat gəlirləri" (gəlir növü "Əsas vəsaitin satışı"); satışın ƏDV-si 611-dən, 1C sxemi ilə.
   - Alternativ: 601.
   - Mühasibin təsdiqi lazımdır.
7. **Modernizasiya / əsaslı təmir** (dəyərin artırılması) bu mərhələyə lazımdırmı? Tövsiyə: xeyr, sonra.
8. **Mövcud vəsaitlər.**
   - MG Transport-un artıq istifadədə olan maşınları varmı?
   - Varsa, başlanğıc qalıqları siz daxil edirsiniz, yoxsa Excel-dən yükləmə lazımdır? Excel üçün sütunlar: ad, inv. nömrə, dövlət nömrəsi, ilkin dəyər, yığılmış amortizasiya, qalan ay.
   - Tövsiyə: əl ilə forma; 20-dən çoxdursa Excel.
