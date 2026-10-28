# Mərhələ 9 — Vergi bəyannamələrinin rəqəmləri (dizayn)

Status: **təsdiqlənib** (28.10.2026). İstifadəçi əvvəlcədən icazə verdi: "növbəti mərhələlərə özün keç, icazə verirəm". Açıq suallarda tövsiyə seçilib, qərarlar — `docs/QERARLAR.md` 2026-10-28 (mərhələ 9). Mənbələr bir-birinə zidd olan və ya yoxlana bilməyən yerdə qayda parametrdir və **mühasib təsdiq edir**.

Əsas: əvvəlki mərhələlərin "sonra"ya saxladığı vergi işləri — mərhələ 5 §1 ("ƏDV bəyannaməsinin rəsmi forması", "Mənfəət vergisinin hesablanması (901 / 521.04)"), QERARLAR 2026-10-17 §9 (mənfəət vergisi bu mərhələdə hesablanmır), 2026-10-26 §4 (vergi amortizasiyası VM 114 — mənfəət vergisi bəyannaməsi ilə), mərhələ 8 §12 (vergi və fondlar — bəyannamə üçün işçi sayı və baza).

## 1. Məqsəd və sərhəd

İndi Meyar ƏDV-ni, əmək haqqının vergi və fondlarını düzgün hesablayır və yazır, amma bəyannaməni mühasib başqa yerdə (Excel, kağız) yığır: ƏDV icmalı dərəcələr üzrə cəmdir, "Vergi və fondlar" bir aydır, mənfəət vergisi heç hesablanmır, vergi amortizasiyası (VM 114) yoxdur. Mərhələnin məqsədi — üç bəyannamənin **rəqəmlərini** Meyar-ın öz uçotundan çıxarmaq: hər rəqəmin mənbəyi (hesab, sənəd) görünsün, e-taxes.gov.az-da formanı dolduranda mühasib rəqəmi köçürsün, yoxlamalar uyğunsuzluğu əvvəlcədən desin.

**Mərhələyə daxildir:**

1. **ƏDV bəyannaməsi üçün rəqəmlər** (ay): vergi tutulan (18%), sıfır dərəcəli, azad, cəlb olunmayan əməliyyatlar; hesablanmış ƏDV; əvəzləşdirilən ƏDV (növlər üzrə); büdcəyə ödənilməli / növbəti aya keçən; 521.01 ilə tutuşma; 0% / azad / cəlb olunmayan satışların sənəd siyahısı (bəyannamənin əlavələri üçün); DVX ↔ uçot; yoxlamalar (VM 175 mütənasib bölgü, qaiməsiz gəlir).
2. **Muzdlu işlə bağlı bəyannamə üçün rəqəmlər** (rüb, ay-ay): "Muzdlu işlə əlaqədar ödəmə mənbəyində tutulan vergi, məcburi dövlət sosial sığorta, işsizlikdən sığorta və icbari tibbi sığorta haqları bəyannaməsi" (2020-dən vahid forma, rüb bitəndən sonrakı ayın 20-dək). Ay üzrə işçi sayı, hesablanmış gəlir, güzəştlər, vergi tutulan gəlir, gəlir vergisi, DSMF / işsizlik / tibbi baza və haqlar (işçi və işəgötürən); işçi üzrə əlavə (FİN, ad, ay-ay); hesablanmış ↔ 521.03 / 522.xx ↔ köçürülmüş.
3. **DSMF 8 000 ₼-dan yuxarı — işəgötürən 11%** (DVX-nin 2026 flayeri "Muzdlu işçisi olan qeyri-dövlət sektoru bunu bilməlidir!": "1214 manat + 8000 manatdan yuxarı hissənin 11%-i"). 2026 başlanğıc dəstinə üçüncü pillə (mərhələ 8-in QERARLAR §1-də "mühasib təsdiq edənə qədər" saxlanılan sual).
4. **Vergi amortizasiyası (VM 114)**: kateqoriyalar və illik yuxarı normalar (parametr, il üzrə; mühasib normadan aşağı seçə bilər), mikro / kiçik sahibkar əmsalı (2 / 1,5), vəsaitin vergi dəyəri, il sonuna qalıq dəyərə azalan qalıq metodu, satış / silinmə, 100 ₼-dan az qalıq; "Vergi amortizasiyası" hesabatı (il).
5. **Mənfəət vergisi**: illik bəyannamənin rəqəmləri (gəlirlər, gəlirdən çıxılan xərclər, uçot amortizasiyası əvəzinə vergi amortizasiyası, gəlirdən çıxılmayan xərclər, əsas vəsaitin satışının vergi nəticəsi, keçmiş illərin zərəri, vergi tutulan mənfəət, dərəcə 20%, cari ödənişlər, ödənilməli / artıq); **dekabr bağlanışının yeni addımı**: Dt 901 / Kt 521.04 və 901 → 341 (341 → 343-dən əvvəl); M/Z hesabatında "Mənfəət vergisi" və "Xalis mənfəət" sətirləri.

**Daxil deyil:**

| İş                                                                                        | Niyə / nə vaxt                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| e-taxes XML / elektron göndərmə                                                           | XML sxemi (XSD) və sətir kodları etibarlı açıq mənbədə yoxlanıla bilmədi (§11 sual 1). Rəqəmlər bölmə adları ilə verilir, Excel-ə çıxır; sətir kodlarını mühasib tutuşdurur. Sonra. |
| Cari vergi ödəmələrinin (mənfəət vergisi avansı, VM 154) hesablanması                     | Ödənişlər bank sənədi ilə 521.04-ə yazılır, bəyannamə onları çıxır; rüblük avansın özünün hesabı — sonra                                                                            |
| Təmir xərclərinin limiti (VM 115), təmsilçilik / ezamiyyət normaları                      | Xərc maddəsinin "gəlirdən çıxılmır" bayrağı və əl ilə düzəliş sətri ilə (§5.3)                                                                                                      |
| Əmlak vergisi, torpaq vergisi, yol vergisi, sadələşdirilmiş vergi                         | Sonra (ayrı bəyannamələr)                                                                                                                                                           |
| Təxirə salınmış vergi (MHBS 12, 422)                                                      | Sonra                                                                                                                                                                               |
| Xidmət müqaviləsi ilə işləyənlər (522.02), muzdlu işlə bağlı olmayan ödəmələr             | Mərhələ 8-də yoxdur — sonra                                                                                                                                                         |
| Neft-qaz və dövlət sektoru dərəcələri                                                     | MG Transport qeyri-dövlət, qeyri-neft sektorudur                                                                                                                                    |
| Vergi amortizasiyasında istifadə olunmayan normanın gələcək illərə keçirilməsi (VM 114.4) | Seçilən norma il üçün yazılır; fərqin uçotu — sonra (§11 sual 5)                                                                                                                    |

## 2. Mövcud koddan nə götürülür

| Kod                                                               | Qərar                                                                                                                                                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/application/analytics.ts` — `vatOf`, `vatSummary` (5d)       | ƏDV bəyannaməsi eyni registr hesabına əsaslanır (601 / 602 / 603 / 604 dərəcə subkontosu, 241, bağlanışın 521.01 / 241 addımı) — iki hesabat bir-birindən fərqli rəqəm verə bilməz. |
| `eqReconcile` (4c)                                                | DVX ↔ uçot bölməsi.                                                                                                                                                                 |
| `payroll_lines` (8a–8d) — gross, güzəşt, hər haqq, işçi           | Muzdlu iş bəyannaməsi sətirlərdən oxunur (bazalar dərəcələr dəstinin hədləri ilə yenidən hesablanır), məbləğlər 521.03 / 522.xx ilə tutuşdurulur.                                   |
| `payrollTaxes` (8b, "Vergi və fondlar")                           | Dəyişmir; bəyannamə onun rüblük, işçi üzrə genişlənməsidir.                                                                                                                         |
| Əsas vəsaitlər (7a–7c): `fixed_assets.asset_group`, `asset_lines` | Vergi kateqoriyası qrupdan gəlir (nəqliyyat → 25%, bina → 7% …); vergi dəyəri = istismara vermənin ilkin dəyəri; başlanğıc qalıq sənədində vergi qalıq dəyəri ayrıca sahə.          |
| Ay bağlanışı (5c) — addımlar, `closeOut`                          | Dekabrda yeni addım "Mənfəət vergisi" 801 → 341-dən sonra, 341 → 343-dən əvvəl; ləğvdə storno.                                                                                      |
| `profitLoss` (5d)                                                 | 901 sətri və "Xalis mənfəət" əlavə olunur; bağlanışın 901 → 341 yazılışı çıxılır.                                                                                                   |

## 3. Məlumat modeli

- **Sxem v22 (9b):** `payroll_rates`-in 2026 başlanğıc dəstində `dsmfEmployer` hələ ilkin iki pillədirsə (22% / 15%) və həmin şirkətdə gross-u 8 000-dən çox olan uçotdakı əmək haqqı sətri yoxdursa — üçüncü pillə (8 000-dən yuxarı 11%) əlavə olunur. Dəst istifadə olunubsa (8 000-dən yuxarı sətir var) — dəyişmir, audit jurnalına və bəyannamənin yoxlamasına xəbərdarlıq. Yeni bazalar dəsti üç pillə ilə alır.
- **Sxem v23 (9c):**
  - `tax_depreciation_rates(company_id, year, category, rate, PRIMARY KEY(company_id, year, category))` — il üzrə seçilmiş norma (yüzdə birlə, 25% → 2500); yoxdursa — VM 114.3-ün yuxarı norması;
  - `companies.tax_coefficient` — 100 / 150 / 200 (adi / kiçik / mikro sahibkar, VM 114.3-1, 114.3-2);
  - `asset_lines.tax_residual` — başlanğıc qalıq sənədində vəsaitin Meyar-dan əvvəlki vergi qalıq dəyəri (NULL — ilkin dəyər − yığılmış amortizasiya götürülür); istismara vermədə vergi dəyəri = ilkin dəyər.
  - Vergi kateqoriyası vəsaitin qrupundan: `buildings` → bina, tikili, qurğu (7%), `machinery` → maşın və avadanlıq (20%), `computers` → hesablama texnikası (25%), `transport` → nəqliyyat vasitələri (25%), `other` → digər (20%).
- **Sxem v24 (9d):**
  - `items.tax_deductible` (xərc maddəsi; 1 — standart, 0 — "gəlirdən çıxılmır": cərimə, sanksiya, limitdən artıq təmsilçilik və s.);
  - `profit_tax_years(company_id, year, rate, losses, adjustments, updated_at)` — il üzrə dərəcə (2000 = 20%), keçmiş illərin köçürülən zərəri (əl ilə, Meyar-dan əvvəlki illər), düzəlişlər (JSON: [{label, amount}] — mühasibin əlavə gəlir / çıxılmayan xərc sətirləri).
  - Dekabr bağlanışının addımı `profitTax` (yeni `ClosingStepKey`).

Ayrı "bəyannamə sənədi" saxlanılmır: rəqəmlər hər dəfə uçotdan hesablanır (bağlanmış dövrdə dəyişmir). Mənfəət vergisinin yazılışı dekabr bağlanışının içindədir.

## 4. Yazılışlar

Yalnız mənfəət vergisi yazılış yaradır (dekabr bağlanışı, 31.12):

```
Dt 901                         ilin mənfəət vergisi (§5.4)
   Kt 521.04 (Vergi (haqq))
Dt 341                         eyni məbləğ
   Kt 901
```

Sonra 341 → 343 adi qaydada (341-in qalığı artıq xalis mənfəətdir). Vergi sıfırdırsa (zərər, güzəşt) — yazılış yoxdur, addım "vergi yoxdur" deyir. Bağlanışın ləğvi — storno. Cari il ərzində ödənilən avanslar bank sənədi ilə Dt 521.04 / Kt 223 (artıq var).

## 5. Hesablama qaydaları

### 5.1 ƏDV (ay)

| Bölmə                                       | Mənbə                                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vergi tutulan əməliyyatlar 18%: dəyər, ƏDV  | `vatOf`: 601 − 602 / 603 (dərəcə 18), 604 (ƏDV); əsas vəsaitin satışı (611) qaimə sətirlərindən                                                                       |
| Sıfır dərəcə / azad / cəlb olunmayan: dəyər | Eyni, dərəcə subkontosu üzrə; sənəd siyahısı satış qaimələrindən (nömrə, tarix, alıcı, VÖEN, dəyər); qaiməsiz dövriyyə ayrıca sətir                                   |
| Hesablanmış ƏDV                             | 18% bölməsinin ƏDV-si                                                                                                                                                 |
| Alış ƏDV-si (241-ə daxil olan)              | 241-in ayın debet dövriyyəsi                                                                                                                                          |
| Əvəzləşdirilən ƏDV                          | Bağlanışın Dt 521.01 / Kt 241 addımı (DVX-də təsdiqlənmiş, depozitdən ödənilmiş); ay bağlanmayıbsa — "bağlanışdan sonra" xəbərdarlığı və bağlanışın planındakı məbləğ |
| Ödənilməli ƏDV                              | hesablanmış − əvəzləşdirilən; mənfidirsə "artıq — növbəti aya keçir"                                                                                                  |
| 521.01 tutuşması                            | ayın əvvəlinə qalıq + hesablanmış (Kt) − əvəzləşdirilən − köçürülən (Dt bank / depozit) = ayın sonuna qalıq                                                           |
| Yoxlamalar                                  | azad və ya 0% satış + alış ƏDV-si var → VM 175 mütənasib bölgü xəbərdarlığı (vergi tutulan payı göstərilir); DVX ↔ uçot fərqi; ay bağlanmayıb; 241-də gözləyən ƏDV    |

### 5.2 Muzdlu iş (rüb, ay-ay)

Hər ay uçotdakı əmək haqqı sənədinin sətirlərindən (ödəniş tarixi deyil, hesablama ayı — mərhələ 8 kimi):

- işçi sayı (sətri olan işçilər), hesablanmış gəlir (gross + xəstəlik müavinəti), güzəşt (`exemption`), gəlir vergisi tutulan gəlir = gross + xəstəlik − güzəşt, gəlir vergisi;
- DSMF bazası = gross (xəstəlik müavinəti xaric), DSMF işçi / işəgötürən; işsizlik bazası = gross, haqları; tibbi baza = gross, 2 500-dək və yuxarı hissə ayrıca (dəstin hədləri), haqları;
- tutuşma: hər haqqın cəmi = ayın 521.03 / 522.xx-ə əmək haqqı yazılışı ilə Kt dövriyyəsi; köçürülən — Dt dövriyyə; ayın sonuna borc;
- işçi üzrə əlavə: FİN, ad, tabel №, ay-ay gross, vergi, DSMF, işsizlik, tibbi;
- yoxlamalar: FİN-i olmayan işçi; rübün hər hansı ayında əmək haqqı yoxdur; bazada 8 000-dən yuxarı gəlir + dəstdə üçüncü pillə yoxdur.

### 5.3 Vergi amortizasiyası (VM 114, il)

- Vəsaitin vergi dəyəri: istismara vermə — ilkin dəyər; başlanğıc qalıq — `tax_residual` (yoxdursa ilkin − yığılmış).
- Kateqoriya üzrə il sonuna qalıq dəyər = ilin əvvəlinə qalıq + il ərzində istismara verilənlər − il ərzində silinən / satılanların vergi qalıq dəyəri.
- İllik amortizasiya = il sonuna qalıq × norma × əmsal (norma ≤ VM 114.3 yuxarı norması; əmsal 1 / 1,5 / 2), qəpiyə yuvarlaqlaşdırılır. İl ərzində alınan vəsait il sonuna qalığa daxildir (tam il).
- Kateqoriyanın il sonuna qalığı (amortizasiyadan sonra) 100 ₼-dan azdırsa — tamamilə gəlirdən çıxılır (parametr, **mühasib təsdiq edir**).
- Hesablama vəsait üzrə aparılır (kateqoriyanın cəmi = vəsaitlərin cəmi): satılan vəsaitin vergi qalıq dəyəri məlum olsun deyə. Satış ilində vəsaitə amortizasiya yoxdur; satışın vergi nəticəsi = satış qiyməti (ƏDV-siz) − vergi qalıq dəyəri.
- Vergi amortizasiyası uçota yazılmır (mənfəət vergisi bəyannaməsinin rəqəmidir).

### 5.4 Mənfəət vergisi (il)

```
Gəlirlər                     601 − 602 / 603 / 604 + 611 + 631 (M/Z-nin gəlirləri; 611-də əsas vəsaitin satışı xaric)
+ Əsas vəsaitin satışı        satış qiyməti (ƏDV-siz)
− Gəlirdən çıxılan xərclər    7xx (M/Z), xaric: uçot amortizasiyası (xərc maddəsi "Amortizasiya"),
                              əsas vəsaitin silinməsinin qalıq dəyəri ("Əsas vəsaitlərin silinməsi"),
                              "gəlirdən çıxılmır" maddələri
− Vergi amortizasiyası        §5.3
− Satılan / silinən əsas vəsaitlərin vergi qalıq dəyəri
± Düzəlişlər                  mühasibin sətirləri
= Vergi tutulan mənfəət (zərər)
− Keçmiş illərin zərəri       Meyar-ın əvvəlki illərinin zərəri + əl ilə yazılan (5 il, VM 121; vergi tutulan mənfəətdən çox yox)
= Vergiyə cəlb olunan mənfəət × 20% = Mənfəət vergisi
− İl ərzində ödənilən         521.04-ün ilin Dt dövriyyəsi (dekabr bağlanışının öz yazılışı xaric)
= Ödənilməli / artıq ödənilib
```

Zərər ilində vergi 0, zərər növbəti illərə keçir (5 il).

## 6. Hesabatlar və interfeys

- **Hesabatlar → Vergi bəyannamələri** (yeni qrup): "ƏDV bəyannaməsi" (ay), "Muzdlu iş bəyannaməsi" (rüb), "Vergi amortizasiyası" (il), "Mənfəət vergisi bəyannaməsi" (il). Əmək haqqı → Hesabatlar-da muzdlu iş, Əsas vəsaitlər menyusunda vergi amortizasiyası da görünür.
- Hər hesabat: bölmələr, sətirdə rəqəm və mənbə ("601 · dövriyyə", "AB-2026-09 · addım 5"), sətrə iki dəfə klik — hesab kartı və ya sənəd; yoxlamalar yuxarıda (bloklamır, xəbər verir); Excel və çap.
- Vergi amortizasiyasının normaları və əmsal, mənfəət vergisinin dərəcəsi, keçmiş zərər və düzəlişlər — hesabatın öz panelində ("Parametrlər"), il üzrə; bağlanmış ilin parametrləri dəyişmir.
- Xərc maddəsinin formasında "Gəlirdən çıxılmır (mənfəət vergisi)" bayrağı.
- Dizayn — `docs/DIZAYN.md` (mövcud hesabat komponentləri; yeni səth yox).

## 7. Qəbul testləri

| #   | Yoxlama                                                                                                                                                        | Növ                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| V1  | ƏDV: 18% / 0% / azad / cəlb olunmayan satışlar, alış ƏDV-si, bağlanışın əvəzləşdirilməsi → bölmələr qəpikbəqəpik; ƏDV icmalı ilə eyni; 521.01 tutuşur          | integration          |
| V2  | ƏDV: əvəzləşdirilən > hesablanmış → "növbəti aya keçir"; azad satış + alış ƏDV-si → VM 175 xəbərdarlığı; 0% siyahısı qaimələrlə                                | integration + ui     |
| V3  | Muzdlu iş: rübün 3 ayı, işçi əlavəsi; cəmlər 521.03 / 522.xx ilə tutuşur; xəstəlik müavinəti gəlir vergisi bazasında, fond bazasında yox; güzəşt               | integration          |
| V4  | DSMF 9 000 ₼: işçi 886,00, işəgötürən 1 324,00 (1 214 + 11% × 1 000); v21 → v22 miqrasiyası (istifadə olunmamış dəst yenilənir, istifadə olunmuş dəyişmir)     | domain + integration |
| V5  | Vergi amortizasiyası: nəqliyyat 50 000 (25%) → 12 500 / 9 375; bina 7%; il ərzində alınan tam il; satış ilində yoxdur, satışın vergi nəticəsi; < 100 ₼ silinir | domain + integration |
| V6  | Mənfəət vergisi: §9 misalı qəpikbəqəpik; zərər ili → 0 və növbəti ilə köçür; "gəlirdən çıxılmır" maddəsi; avanslar çıxılır                                     | domain + integration |
| V7  | Dekabr bağlanışı: 901 / 521.04, 901 → 341, sonra 341 → 343; ləğv storno; M/Z-də "Mənfəət vergisi" və "Xalis mənfəət"                                           | integration + ui     |
| V8  | Perf: ƏDV bəyannaməsi ay, muzdlu iş rüb (300 işçi), mənfəət vergisi il — hər biri ≤ 1 s (100 000 yazılış)                                                      | perf                 |
| V9  | Real bazanın surəti (v13) v14 → v24-ə təmiz keçir                                                                                                              | yoxlama              |

## 8. Mühasibin yoxlaması üçün misal (qəpikbəqəpik)

**Vergi amortizasiyası (2026):** 01.03.2026-da istismara verilən yük maşını 50 000,00 (nəqliyyat, 25%, əmsal 1). 2026 sonuna qalıq 50 000,00 → amortizasiya 12 500,00, 2027-yə qalıq 37 500,00; 2027: 9 375,00. Uçotda (60 ay, aprel–dekabr) 9 × 833,33 = 7 499,97.

**Mənfəət vergisi (2026):** gəlir (601, ƏDV-siz) 120 000,00; xərclər 7xx 80 000,00, bunlardan uçot amortizasiyası 7 499,97 və cərimə ("gəlirdən çıxılmır") 500,00. Gəlirdən çıxılan xərclər = 80 000,00 − 7 499,97 − 500,00 = 72 000,03; vergi amortizasiyası 12 500,00. Vergi tutulan mənfəət = 120 000,00 − 72 000,03 − 12 500,00 = 35 499,97. Vergi 20% = 7 099,99. İl ərzində ödənilən avans 3 000,00 → ödənilməli 4 099,99. Uçotda: Dt 901 / Kt 521.04 7 099,99; Dt 341 / Kt 901 7 099,99; M/Z: vergiqoyulmadan əvvəl 40 000,00, mənfəət vergisi 7 099,99, xalis mənfəət 32 900,01.

## 9. İcra ardıcıllığı

1. **9a — ƏDV bəyannaməsi** (0.9.5): hesabat, sənəd siyahıları, yoxlamalar, Excel / çap; V1, V2.
2. **9b — muzdlu iş bəyannaməsi və DSMF 11%** (0.9.6): sxem v22, rüblük hesabat, işçi əlavəsi; V3, V4.
3. **9c — vergi amortizasiyası** (0.9.7): sxem v23, normalar, əmsal, vəsaitin vergi qalığı, hesabat; V5.
4. **9d — mənfəət vergisi** (0.9.8): sxem v24, "gəlirdən çıxılmır", il parametrləri, bəyannamə, dekabr bağlanışının addımı, M/Z; V6, V7.
5. Perf (V8) hər alt-mərhələdə öz hissəsi; real bazanın surəti (V9) hər miqrasiyada.
6. Müstəqil audit (kodu yazmayan sessiya).

## 10. Açıq suallar — tövsiyə ilə qərarlaşdırılıb

1. **e-taxes XML.** Bəyannamələrin XML sxemi və sətir kodları açıq etibarlı mənbədə yoxdur (e-taxes kabinetin içindədir). Tövsiyə (qəbul): rəqəmlər bölmə adları ilə; XML — sonra, istifadəçi kabinetdən boş forma / XML nümunəsi verəndə.
2. **DSMF 8 000-dən yuxarı.** DVX-nin 2026 flayeri işəgötürən üçün 11% deyir. Tövsiyə (qəbul): üçüncü pillə 11%; istifadə olunmuş dəst dəyişdirilmir. Mühasib təsdiq edir.
3. **Vergi amortizasiyasının metodu.** VM 114.3: "kateqoriyaya aid əsas vəsaitlərin vergi ilinin sonuna balans üzrə qalıq dəyərinə" norma. Bina üçün ayrıca obyekt üzrə qayda, satışda qrupdan çıxan məbləğ (qalıq dəyər yoxsa satış qiyməti) və 100 ₼ həddi mənbələrdə tam yoxlanmadı. Tövsiyə (qəbul): vəsait üzrə azalan qalıq (kateqoriya cəmi eynidir), satışda vəsaitin vergi qalıq dəyəri çıxılır, 100 ₼ — parametr. Mühasib təsdiq edir.
4. **İl ərzində alınan vəsait** il sonuna qalığa tam daxildir (vergi.az, "İlin sonunda alınan əsas vəsaitə amortizasiya hesablamaq olarmı?"). Mühasib təsdiq edir.
5. **Normadan aşağı seçilən amortizasiya** (VM 114.4: fərq gələcək illərə keçə bilər): seçilən norma il üçün yazılır, fərqin keçirilməsi — sonra.
6. **Mənfəət vergisinin yazılışı** — dekabr bağlanışının addımı (illik vergi ilin son günü). Alternativ (ayrıca sənəd) dekabr bağlanışından sonra 341 / 343 qarışıqlığı yaradardı.
7. **Keçmiş illərin zərəri** — 5 il, ilin vergi tutulan mənfəətindən çox olmayaraq (VM 121); Meyar-dan əvvəlki zərər əl ilə. Mühasib təsdiq edir.
8. **Gəlirdən çıxılmayan xərclər** — xərc maddəsinin bayrağı ilə (Meyar özü təxmin etmir); qalanı düzəliş sətri.
9. **Mikro / kiçik sahibkar əmsalı** (VM 114.3-1, 114.3-2: 2 / 1,5) — şirkət parametri, standart 1.

Mənbələr: [DVX — muzdlu işçisi olan qeyri-dövlət sektoru, 2026](https://taxes.gov.az/uploads/2026/flayer/1_12.pdf), [DVX — vergilərin ödənilməsi və bəyannamələrin təqdim edilməsi müddətləri](https://taxes.gov.az/az/page/vergilerin-odenilmesi-ve-beyannamelerin-teqdim-edilmesi-muddetleri), [DVX — vahid bəyannamə](https://www.taxes.gov.az/az/post/1014), [vergi.az — amortizasiya ayırmalarının gəlirdən çıxılması](https://vergi.az/amortizasiya-ayirmalari-gelirden-cixilma/), [vergiler.az — növbəti illərdə nəzərə alınacaq amortizasiya](https://vergiler.az/news/taxes/17955.html), [Vergi Məcəlləsi (e-qanun)](https://e-qanun.az/framework/46948).
