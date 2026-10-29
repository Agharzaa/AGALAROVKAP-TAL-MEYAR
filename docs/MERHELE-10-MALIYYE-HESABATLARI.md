# Mərhələ 10 — İllik maliyyə hesabatları (dizayn)

Status: **təsdiqlənib** (29.10.2026). İstifadəçi əvvəlcədən icazə verdi ("növbəti mərhələlərə özün keç, icazə verirəm"), növbəti mərhələ kimi illik maliyyə hesabatlarını seçdi: Meyar-da balans hesabatı yoxdur. Açıq suallarda tövsiyə seçilib, qərarlar — `docs/QERARLAR.md` 2026-10-29 (mərhələ 10). Mənbənin birbaşa demədiyi yerdə qayda Meyar-ın qaydasıdır (kodda cədvəl, §5) və **mühasib təsdiq edir**.

Əsas: mərhələ 5d (M/Z, pul vəsaitlərinin hərəkəti), mərhələ 9d (901 / 521.04, dekabrda 341 → 343), 0.9.11 (dövriyyə balansı).

## 0. Mənbə — formalar

Maliyyə Nazirliyinin Kollegiyasının 30.01.2017-ci il tarixli **Q-01** nömrəli qərarı ilə təsdiq edilmiş "Maliyyə Hesabatlarının Beynəlxalq Standartlarına və Kommersiya Təşkilatları üçün Milli Mühasibat Uçotu Standartlarına əsasən mühasibat uçotunun aparılması Qaydaları" (sonrakı dəyişikliklər: Q-05 08.06.2018, Q-09 18.10.2018, Q-14 18.06.2020, Q-22 20.12.2022, Q-10 19.05.2023; [e-qanun.az/framework/34909](https://e-qanun.az/framework/34909), 29.10.2026-da oxundu). Qaydaların 3.1-ci bəndi tam toplunu sayır, formalar əlavələrdədir:

| Əlavə | Forma                                                                                                                                             | Meyar                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1     | Maliyyə vəziyyəti haqqında hesabat (bölmə / maddə №: 1, 10–19; 2, 20–24; 3, 30–34; 4, 40–44; 5, 50–54)                                            | 10a                                |
| 2     | Mənfəət və ya zərər və digər məcmu gəlir haqqında hesabat (iki variant: xərclərin funksiyaları və xarakteri üzrə)                                 | 10b, funksiyalar üzrə variant      |
| 3     | Kapitalda dəyişikliklər haqqında hesabat (sütunlar: nizamnamə kapitalı, emissiya gəliri, geri alınmış, ehtiyatlar, bölüşdürülməmiş mənfəət, cəmi) | 10b                                |
| 4     | Pul vəsaitlərinin hərəkəti haqqında hesabat (dolayı və birbaşa metod)                                                                             | 10c, birbaşa metod                 |
| —     | Əhəmiyyətli uçot siyasətləri və izahedici qeydlər (3.1.5)                                                                                         | daxil deyil (mətn — mühasib yazır) |

**Əsas müşahidə:** formanın maddə nömrələri hesab planının **iki rəqəmli qruplarıdır** (10 — qeyri-maddi aktivlər = 101–109 hesabları; 22 — pul vəsaitləri = 221–224; 34 — bölüşdürülməmiş mənfəət = 341–344; 52 — vergi öhdəlikləri = 521–522 …). M/Z formasında isə sətirlər hesab qrupları ilə adlanır: "60", "61 və 73", "63 və 75", "90", "341". Ona görə Meyar-ın hesabatı formanın sətirlərini **hesab kodunun ilk iki rəqəmi** ilə doldurur; qrup → sətir qaydası mənbənin özündədir. Mənbənin birbaşa demədiyi yalnız üç şeydir: aktiv-passiv hesabların açılması (§5.1), pul hərəkətinin sətirlərə bölgüsü (§5.3) və kapitalda dəyişikliklərin sətirləri (§5.4) — bunlar Meyar-ın qaydasıdır, mühasib təsdiq edir.

KOS üçün MHBS (IFRS for SMEs) ayrıca forma vermir: Q-01-in formaları həm MHBS, həm Milli Standartlar üçün eynidir. MG Transport MMC üçün Q-01 forması götürülür.

## 1. Məqsəd və sərhəd

İndi Meyar dövriyyə balansını, M/Z-ni (aylar üzrə) və pul hərəkətini (maddələr üzrə) verir, amma illik maliyyə hesabatlarının toplusunu mühasib Excel-də yığır. Mərhələnin məqsədi — Q-01 formalarının **rəqəmlərini** il sonuna və əvvəlki il sonuna Meyar-ın öz uçotundan çıxarmaq: hər sətirdə mənbə (hesablar), yoxlamalar hesabatların bir-biri ilə tutuşmasını desin, Excel və çap.

**Mərhələyə daxildir:**

1. **Maliyyə vəziyyəti haqqında hesabat** (balans, Əlavə 1): aktivlər, kapital, öhdəliklər — formanın bütün maddələri, il sonuna və əvvəlki il sonuna; aktiv-passiv hesabların kontragent üzrə açılması.
2. **Mənfəət və ya zərər haqqında hesabat** (Əlavə 2, xərclərin funksiyaları üzrə): mövcud M/Z-nin turnover-lərindən (601 − 602 − 603 − 604, 701, 611, 711, 721, 731, 631 / 751, 901, xalis mənfəət), hesabat ili və əvvəlki il.
3. **Kapitalda dəyişikliklər haqqında hesabat** (Əlavə 3): 30–34 sütunları, iki il.
4. **Pul vəsaitlərinin hərəkəti haqqında hesabat** (Əlavə 4, birbaşa metod): əməliyyat, investisiya, maliyyələşdirmə; ilin əvvəlinə və sonuna qalıq, məzənnə fərqinin təsiri.
5. **Yoxlamalar:** balans tutuşur (aktivlər = kapital + öhdəliklər); dekabr bağlanışı (341 → 343, 901 sıfır); 801 / 901 / 6xx / 7xx il sonuna sıfırdır; pul hərəkətinin son qalığı = balansın 22-ci maddəsi; M/Z-nin xalis mənfəəti = kapitalda dəyişikliklərin "xalis mənfəət" sətri; kapitalda dəyişikliklərin son qalığı = balansın kapitalı.

**Daxil deyil:**

| İş                                                                              | Niyə / nə vaxt                                                                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Uçot siyasətləri və izahedici qeydlər                                           | Mətndir, mühasib yazır. Sonra — qeydlərin rəqəmli cədvəlləri (TTA hərəkəti, debitor yaşı)                                     |
| M/Z-nin "xərclərin xarakteri üzrə" variantı və onun məlumat cədvəli             | Xərc maddəsinin xarakteri (material, işçi heyəti, amortizasiya) kitabçada yoxdur — §11 sual 3                                 |
| Pul hərəkətinin dolayı metodu                                                   | Birbaşa metod Meyar-ın bank / kassa uçotundan dəqiq çıxır; dolayı — sonra                                                     |
| E-uçot (e-accounting) portalına elektron göndərmə                               | Formatı (XML / Excel şablonu) açıq mənbədə yoxlanmadı; rəqəmlər forma maddələri ilə, Excel — mühasib köçürür (mərhələ 9 kimi) |
| Konsolidasiya, qeyri-nəzarət payları, digər məcmu gəlir                         | MG Transport tək şirkətdir; sətirlər formada var, Meyar-da 0                                                                  |
| Təxirə salınmış vergi (MHBS 12)                                                 | Mərhələ 9 kimi — sonra; 16 / 42 maddələri hesab olsa göstərilir                                                               |
| Qısa / uzunmüddətli hissəyə yenidən təsnif (uzunmüddətli kreditin cari hissəsi) | Hesab necə yazılıbsa (401 → 40, 501 → 50); yenidən təsnif mühasibin əl ilə yazılışıdır                                        |
| Hesabatın saxlanması (imzalanmış versiya)                                       | Rəqəmlər hər dəfə uçotdan hesablanır; bağlı il dəyişmir                                                                       |

## 2. Mövcud koddan nə götürülür

| Kod                                                                       | Qərar                                                                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registers` (aylıq qalıqlar, hesab + 3 subkonto)                          | Balans il sonuna registrlərdən (`month <= YYYY-12`), hesab və birinci subkonto üzrə — 100 000 yazılışda millisaniyələr.                                                    |
| `resultTurnovers` (5d, `analytics.ts`)                                    | M/Z-nin MHBS forması eyni turnover-lərdən (bağlanışın 801 yazılışları çıxılır); 901 — `profitLoss`-un sorğusu ilə. İki hesabat fərqli rəqəm verə bilməz.                   |
| `cashFlow` (5d)                                                           | Dəyişmir. Birbaşa metod pul hesablarının **yazılışlarından** qurulur (bank / kassa sətirlərindən yox) — əl ilə əməliyyat və yenidən qiymətləndirmə də yerini tapır (§5.3). |
| `DeclarationView` + `DeclarationPage` (9a, bəyannamələrin ortaq görünüşü) | Hesabatlar eyni görünüşdədir: bölmələr, hər sətirdə mənbə, yoxlamalar yuxarıda, Excel və çap; sətrə iki dəfə klik — hesab kartı. `declaration` sorğusuna 4 yeni növ.       |
| `monthClosed` (9a), ay bağlanışı (5c, 9d)                                 | Yoxlamalar: dekabr bağlanıbmı; 341 → 343, 901 → 341.                                                                                                                       |

## 3. Məlumat modeli

**Sxem dəyişmir (v24).** Hesabatlar saxlanılmır: hər dəfə uçotdan hesablanır. Qaydalar (§5) `src/application/statements-annual.ts`-də adlı cədvəllərdir — mühasib dəyişdirmək istəsə, növbəti versiyada parametrə çevrilir (§11 sual 1).

## 4. Yazılışlar

Yoxdur. Hesabatlar yalnız oxuyur. 341 → 343 və 901 dekabr bağlanışının addımlarıdır (9d).

## 5. Hesablama qaydaları

### 5.1 Maliyyə vəziyyəti haqqında hesabat (il sonuna və əvvəlki il sonuna)

- Hər hesabın il sonuna qalığı (Dt − Kt) **formanın maddəsinə hesab kodunun ilk iki rəqəmi ilə** düşür: 101 → 10, 111 / 112 → 11, 201 / 205 → 20, 211 / 217 → 21, 221–224 → 22, 241 / 242 / 243 / 244 → 24, 301 → 30, 341 / 343 / 344 → 34, 401 → 40, 422 → 42, 501 → 50, 521 / 522 → 52, 531 / 533 / 534 / 538 → 53, 543 → 54. Aktiv maddələrdə Dt qalığı müsbət, kapital və öhdəliklərdə Kt qalığı müsbətdir.
- **Kontr-hesablar** öz maddəsində çıxılır: 112 (yığılmış amortizasiya) 11-ci maddəni azaldır.
- **Aktiv-passiv hesablar** (211, 217, 244, 521, 522, 531, 533, 538 …; 243 aktiv, 543 passivdir — öz maddəsində qalır) **açılmış qalıqla**: birinci subkontosu kontragent və ya işçi olan hesab kontragent / işçi üzrə, qalanları subhesab üzrə. Dt qalığı aktivdə, Kt qalığı öhdəlikdə:
  - öhdəlik hesabının (4xx / 5xx) Dt qalığı → **24** "Sair qısamüddətli aktivlər" (malsatana artıq ödəniş, büdcəyə artıq ödənilmiş vergi), 4xx üçün → **19**;
  - aktiv hesabının Kt qalığı → **54** "Sair qısamüddətli öhdəliklər" (alıcının artıq ödənişi — alınmış avans kimi, 543 də 54-dədir), 22 (overdraft) → **50**, 1xx → **44**.
    Qayda Meyar-ındır (mənbə "qalıqlar açılmış göstərilir" deyir, sətri demir) — mühasib təsdiq edir.
- **Bağlanmamış nəticə:** il sonuna 6xx / 7xx / 801 / 901-də qalıq varsa (dekabr bağlanmayıb), Kt − Dt **34**-ə "bağlanmamış nəticə" kimi əlavə olunur və xəbərdarlıq çıxır. Belə balans həmişə tutuşur, hesabatı ilin ortasında da açmaq olur.
- 0xx (balansdankənar) hesablar sayılmır; kodu tanınmayan qrup (məs. 25x) sinfinin "sair" maddəsinə (19 / 24 / 33 / 44 / 54).
- Bütün maddələr göstərilir (formadakı kimi, sıfır da); mənbə sütununda maddəyə düşən hesablar ("111, 112", "531 Dt qalığı — kontragentlər üzrə").

### 5.2 Mənfəət və ya zərər haqqında hesabat (il və əvvəlki il; xərclərin funksiyaları üzrə)

| Sətir (forma)                                | Mənbə                                           |
| -------------------------------------------- | ----------------------------------------------- |
| 60 Əsas əməliyyat gəlirləri                  | 601 − 602 − 603 − 604 (M/Z-nin "Xalis satış"-ı) |
| 70 Satışın maya dəyəri üzrə xərclər          | 701 (mənfi)                                     |
| Ümumi mənfəət (zərər)                        | cəm                                             |
| 61 Sair əməliyyat gəlirləri                  | 611                                             |
| 71 Kommersiya xərcləri / 72 İnzibati xərclər | 711 / 721                                       |
| 73 Sair əməliyyat xərcləri                   | 731                                             |
| 62 və 74 Fəaliyyətin dayandırılması          | 62x / 74x (hesab yoxdur — 0)                    |
| Əməliyyat mənfəəti (zərəri)                  | cəm                                             |
| 63 və 75 Maliyyə mənfəəti (zərəri)           | 631 − 751 (altında ayrıca: gəlirlər, xərclər)   |
| 64 və 76 Fövqəladə; 81 Asılı müəssisələr     | hesab yoxdur — 0                                |
| Vergiqoymadan əvvəl mənfəət (zərər)          | = M/Z-nin "Vergiqoyulmadan əvvəl mənfəət"-i     |
| 90 Mənfəət vergisi                           | 901 (901 → 341 bağlanışı çıxılır, M/Z kimi)     |
| 341 Hesabat dövründə xalis mənfəət (zərər)   | = M/Z-nin "Xalis mənfəət"-i                     |
| Digər məcmu gəlir; Məcmu gəlir               | 0; = xalis mənfəət                              |

Xərclər mənfi rəqəmlə yazılır (cəmlər toplanaraq alınır). Hesab planına sonradan əlavə olunmuş 6x / 7x qrupları: 6x → 61, 7x → 73.

### 5.3 Pul vəsaitlərinin hərəkəti (birbaşa metod, il və əvvəlki il)

Pul vəsaitləri = **22-ci qrupun bütün hesabları** (221 kassa, 222 yolda olan köçürmələr, 223 bank, 224 ƏDV depoziti) — balansın 22-ci maddəsi ilə eyni. 22 daxilində hərəkət (bankdan kassaya, 222.01 vasitəsilə, depozitə) sayılmır. Qalan hər yazılış (bank, kassa, əl ilə əməliyyat) **qarşı hesabı və istiqaməti ilə** sətrə düşür:

| Sətir                                                    | Daxilolma (Dt 22x)                          | Xaricolma (Kt 22x)                          |
| -------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Malların satışından və xidmətlərdən daxilolmalar         | 211, 543, 60x                               | —                                           |
| Mallar və xidmətlərə görə xaricolmalar                   | —                                           | 531, 243, 20x, 241, 242, 70x–73x            |
| İşçilərin mükafatlandırılması ilə əlaqədar ödənişlər     | —                                           | 533, 522, 521.03                            |
| Mənfəət vergisi ödənişi                                  | —                                           | 521.04                                      |
| Digər vergilərə görə xaricolmalar                        | —                                           | 521-in qalan subhesabları                   |
| Əməliyyat fəaliyyətindən faiz ödənişləri                 | —                                           | 751                                         |
| Digər gəlirlərdən daxilolmalar / digər ödənişlər         | qalan hər şey                               | qalan hər şey                               |
| TTA, QMA, uzunmüddətli aktivlərin satışı / əldə edilməsi | 1xx (17, 18 xaric); **əsas vəsait qaiməsi** | 1xx (17, 18 xaric); **əsas vəsait qaiməsi** |
| Verilmiş borcların qaytarılması / verilmiş borclar       | 17x, 18x, 23x                               | 17x, 18x, 23x                               |
| Səhmlərin (kapitalın) buraxılması                        | 30x, 31x                                    | —                                           |
| Öz səhmlərinin geri alınması                             | —                                           | 32x                                         |
| Borcların alınması / qaytarılması                        | 40x, 50x                                    | 40x, 50x                                    |
| Dividendlər                                              | —                                           | 534, 344, 343, 341                          |
| Xarici valyutaların məzənnələrinin dəyişməsinin təsiri   | yenidən qiymətləndirmə (YQ) yazılışları     | yenidən qiymətləndirmə (YQ) yazılışları     |

**Əsas vəsait qaiməsi:** 211 / 531 / 243 / 543 ilə ödəniş hesablaşma sənədi (3-cü subkonto) üzrə qaiməyə bağlıdır; qaimənin yazılışında 1xx hesabı varsa (113 / 111 alışı, 7c satışı) ödəniş investisiya fəaliyyətidir. Qarışıq qaimə (mal + əsas vəsait) bütövlükdə investisiyadır — nadirdir, sənəddə ayırmaq olar.

İlin əvvəlinə qalıq + əməliyyat + investisiya + maliyyələşdirmə + məzənnə təsiri = ilin sonuna qalıq = balansın 22-ci maddəsi (qəpikbəqəpik, yoxlama). Qayda Meyar-ındır (IAS 7 / forma sətirləri; faiz ödənişi əməliyyat fəaliyyətindədir — formada həm orada, həm maliyyələşdirmədə sətir var) — mühasib təsdiq edir. Mövcud "Pul vəsaitlərinin hərəkəti" (maddələr üzrə, 221 + 223 + 224) dəyişmir.

### 5.4 Kapitalda dəyişikliklər (iki il)

Sütunlar: 30 Ödənilmiş nizamnamə kapitalı, 31 Emissiya gəliri, 32 Geri alınmış kapital, 33 Kapital ehtiyatları (formanın 5 alt sütunu bir sütundur — Meyar-da 33x hesabı yoxdur), 34 Bölüşdürülməmiş mənfəət (bağlanmamış nəticə daxil, §5.1), Cəmi. Hər ilin sətirləri:

- **ilin əvvəlinə qalıq** — balansın əvvəlki il sonuna maddələri;
- **xalis mənfəət (zərər)** (34) — 6xx / 7xx / 8xx / 9xx hesablarının kapitaldan kənar hesablarla ilin yazılışları (= M/Z-nin xalis mənfəəti; fərqlidirsə xəbərdarlıq);
- **mülkiyyətçilərin kapital qoyuluşları** — 30x / 31x-in kapitaldan kənar hesabla yazılışları;
- **dividendlər** — 34x ↔ 534;
- **geri alınmış kapital** — 32x ↔ kapitaldan kənar;
- **kapitalın maddələri arasında köçürmələr** — iki fərqli kapital maddəsi arasında (məs. 343 → 301);
- **sair məcmu gəlir** — 33x ↔ kapitaldan kənar;
- **digər dəyişikliklər (təsnif olunmayıb)** — 34x-in qalan yazılışları (məs. keçmiş ilin səhvinin 343 ilə düzəlişi); yalnız sıfır deyilsə görünür, xəbərdarlıqla: mühasib "uçot siyasətində dəyişikliklər / səhvlər" sətrinə özü köçürür;
- **cəmi dəyişikliklər**, **ilin sonuna qalıq** = balansın kapitalı (yoxlama).

"Uçot siyasətində dəyişikliklər və ya əhəmiyyətli səhvlərlə bağlı düzəlişlər" sətri formadakı kimi göstərilir, Meyar onu 0 yazır (təxmin etmir).

### 5.5 Yoxlamalar (hər hesabatın yuxarısında; bloklamır)

| Yoxlama                                                      | Xəbərdarlıq                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Aktivlər = kapital + öhdəliklər (hər iki tarix)              | fərq (yalnız jurnal ↔ registr pozulubsa mümkündür)                                           |
| Dekabr bağlanıb                                              | "dekabr bağlanmayıb: nəticə 34-də bağlanmamış kimi, mənfəət vergisi və 341 → 343 yazılmayıb" |
| Bağlanışdan sonra 341 = 0, 801 = 0, 901 = 0, 6xx / 7xx = 0   | qalığı olan hesablar                                                                         |
| Pul hərəkətinin son qalığı = balansın 22-ci maddəsi          | fərq                                                                                         |
| M/Z xalis mənfəət = kapitalda dəyişikliklərin xalis mənfəəti | fərq (801-ə və ya 341-ə əl ilə yazılış)                                                      |
| Kapitalda dəyişikliklərin son qalığı = balansın kapitalı     | fərq                                                                                         |
| Kapitalda təsnif olunmamış dəyişiklik                        | məbləğ və hesablar                                                                           |

Balansda ayrıca bölmə "Yoxlamalar" — hər yoxlamanın rəqəmi iki tarix üzrə.

## 6. Hesabatlar və interfeys

- **Hesabatlar → Maliyyə hesabatları** (yeni qrup): "Maliyyə vəziyyəti haqqında hesabat", "Mənfəət və ya zərər (MHBS)", "Kapitalda dəyişikliklər", "Pul vəsaitlərinin hərəkəti (birbaşa)". Mühasibat → Hesabatlar-da balans da görünür.
- Bəyannamələrin səhifəsi (9a): il seçimi, yoxlamalar yuxarıda, bölmələr, sütunlar "Hesabat dövrü (31.12.2026)" və "Əvvəlki dövr (31.12.2025)"; mənbə sütunu; sətrə iki dəfə klik — tək hesabdan gələn maddədə hesab kartı; Excel və çap. Başlıqda şirkətin adı və VÖEN.
- Dizayn — `docs/DIZAYN.md` (mövcud hesabat komponentləri, yeni səth yox).

## 7. Qəbul testləri

| #   | Yoxlama                                                                                                                                      | Növ         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| F1  | §8 misalı: balans qəpikbəqəpik (11, 21, 22, 30, 34, 50, 52, 53; cəmlər 126 500,03), dekabr bağlanışından əvvəl (bağlanmamış nəticə) və sonra | integration |
| F2  | Açılmış qalıq: malsatana artıq ödəniş → 24, alıcının artıq ödənişi → 54, 521 Dt → 24; balans yenə tutuşur                                    | integration |
| F3  | Əvvəlki il sütunu: iki illik uçot, əvvəlki ilin sonu = bu ilin əvvəli; yoxlamalar (341 / 801 / 901, dekabr bağlanmayıb)                      | integration |
| F4  | M/Z MHBS: §8 misalı (60 = 120 000,00, vergiqoymadan əvvəl 71 500,03, 90 = 13 300,00, xalis 58 200,03) — M/Z (5d) ilə eyni                    | integration |
| F5  | Kapitalda dəyişikliklər: kapital qoyuluşu, xalis mənfəət, dividend, 343 → 301 köçürməsi, təsnif olunmamış; son qalıq = balansın kapitalı     | integration |
| F6  | Pul hərəkəti (birbaşa): §8 misalı sətirləri; əsas vəsait qaiməsinin ödənişi investisiyada; YQ → məzənnə təsiri; son = balansın 22-si         | integration |
| F7  | UI: menyudan balans açılır, sətir və mənbə, il dəyişir, Excel; M/Z, kapital, pul hərəkəti açılır                                             | ui          |
| F8  | Perf: dörd hesabat, il, 100 000 yazılış — hər biri ≤ 1 s                                                                                     | perf        |
| F9  | Real bazanın surəti (v13 → v24) ilə dörd hesabat xətasız, balans tutuşur                                                                     | yoxlama     |

## 8. Mühasibin yoxlaması üçün misal (qəpikbəqəpik, 2026 — Meyar-ın ilk ili)

| Tarix        | Əməliyyat                                                                                                    | Yazılış                             | Məbləğ     |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ---------- |
| 15.01.2026   | Təsisçi nizamnamə kapitalını banka ödəyir                                                                    | Dt 223.01 / Kt 301                  | 10 000,00  |
| 01.02.2026   | Qısamüddətli bank krediti                                                                                    | Dt 223.01 / Kt 501                  | 20 000,00  |
| 20.02.2026   | Yük maşını alınır (ƏDV-dən azad), 01.03 istismara (60 ay, 701 "Amortizasiya")                                | Dt 113 / Kt 531.01; 113 → 111       | 50 000,00  |
| 25.02.2026   | Maşının pulu qismən ödənir                                                                                   | Dt 531.01 / Kt 223.01               | 30 000,00  |
| 30.06.2026   | Xidmət satışı (0%)                                                                                           | Dt 211.01 / Kt 601                  | 120 000,00 |
| 15.07.2026   | Alıcı ödəyir                                                                                                 | Dt 223.01 / Kt 211.01               | 100 000,00 |
| 31.07.2026   | İnzibati xidmət (malsatan)                                                                                   | Dt 721 / Kt 531.01                  | 40 000,00  |
| 10.08.2026   | Malsatana ödəniş                                                                                             | Dt 531.01 / Kt 223.01               | 35 000,00  |
| 30.09.2026   | Kredit faizi                                                                                                 | Dt 751 / Kt 223.01                  | 1 000,00   |
| aprel–dekabr | Amortizasiya (ay bağlanışı) 9 × 833,33                                                                       | Dt 701 / Kt 112                     | 7 499,97   |
| 31.12.2026   | Mənfəət vergisi (dekabr bağlanışı): vergi tutulan 120 000 − 41 000,00 − 12 500,00 (VM 114) = 66 500,00 × 20% | Dt 901 / Kt 521.04; Dt 341 / Kt 901 | 13 300,00  |
| 31.12.2026   | Xalis mənfəət                                                                                                | Dt 341 / Kt 343                     | 58 200,03  |

**M/Z (MHBS):** 60 = 120 000,00; 70 = −7 499,97; ümumi mənfəət 112 500,03; 72 = −40 000,00; əməliyyat mənfəəti 72 500,03; 63 və 75 = −1 000,00; vergiqoymadan əvvəl 71 500,03; 90 = −13 300,00; xalis mənfəət 58 200,03.

**Balans 31.12.2026:** 11 = 50 000,00 − 7 499,97 = 42 500,03; 21 = 20 000,00; 22 = 10 000 + 20 000 − 30 000 + 100 000 − 35 000 − 1 000 = 64 000,00; **cəmi aktivlər 126 500,03**. 30 = 10 000,00; 34 = 58 200,03; cəmi kapital 68 200,03; 50 = 20 000,00; 52 = 13 300,00; 53 = 50 000 − 30 000 + 40 000 − 35 000 = 25 000,00; cəmi öhdəliklər 58 300,00; **cəmi kapital və öhdəliklər 126 500,03**. Əvvəlki dövr (31.12.2025) — 0.

**Dekabr bağlanmamış** (yanvar–noyabr bağlı) halda: dekabrın amortizasiyası və mənfəət vergisi hələ yazılmayıb, 343 yoxdur; 341 = 120 000 − 40 000 − 1 000 − 8 × 833,33 = 72 333,36; 11 = 50 000 − 6 666,64 = 43 333,36; 52 = 0; cəmi aktivlər = cəmi kapital və öhdəliklər = 127 333,36. **Heç bir ay bağlanmayıbsa:** amortizasiya yoxdur, 6xx / 7xx-in qalığı 120 000 − 40 000 − 1 000 = 79 000,00 "bağlanmamış nəticə" kimi 34-də; cəmi 134 000,00. Hər iki halda xəbərdarlıq: "dekabr bağlanmayıb".

**Kapitalda dəyişikliklər 2026:** əvvələ 0; xalis mənfəət 58 200,03 (34); kapital qoyuluşu 10 000,00 (30); sona 10 000,00 / 58 200,03 / cəmi 68 200,03 = balansın kapitalı.

**Pul hərəkəti 2026 (birbaşa):** satışdan daxilolmalar 100 000,00; mallar və xidmətlərə xaricolmalar −35 000,00; faiz −1 000,00; əməliyyat fəaliyyətindən xalis 64 000,00. TTA-nın əldə edilməsi −30 000,00 (əsas vəsait qaiməsi); investisiyadan xalis −30 000,00. Kapitalın buraxılması 10 000,00; borcların alınması 20 000,00; maliyyələşdirmədən xalis 30 000,00. Artım 64 000,00; ilin əvvəlinə 0; sonuna 64 000,00 = balansın 22-si.

## 9. İcra ardıcıllığı

1. **10a — Maliyyə vəziyyəti haqqında hesabat və yoxlamalar** (0.9.12): balans, açılmış qalıqlar, bağlanmamış nəticə, yoxlamalar bölməsi, menyu; F1–F3, F7 (balans), F8 (balans).
2. **10b — M/Z (MHBS) və kapitalda dəyişikliklər** (0.9.13): F4, F5, UI, perf.
3. **10c — Pul vəsaitlərinin hərəkəti (birbaşa)** və hesabatlararası yoxlamalar (0.9.14): F6, UI, perf; F9 real baza ilə.
4. **Müstəqil audit** (kodu yazmayan sessiya) — növbəti addım.

## 10. Mövcud hesabatlarla fərqlər (bilərəkdən)

- **Pul hərəkəti:** 5d-nin hesabatı 221 + 223 + 224, bank / kassa sətirlərinin maddəsi üzrə; birbaşa metod 22-ci qrupun hamısı (222 də), qarşı hesab üzrə. 222.01-də il sonuna qalıq (yolda köçürmə) varsa iki hesabatın son qalığı fərqlənir — birbaşa metodunku balansın 22-si ilə tutuşur.
- **M/Z:** eyni rəqəmlər, formanın sətirlərində; aylar yox, iki il.

## 11. Açıq suallar — tövsiyə ilə qərarlaşdırılıb (mühasib təsdiq edir)

1. **Qaydalar kodda, parametr yox.** Qrup → maddə qaydası mənbədən gəlir; açılmış qalığın sətirləri (§5.1) və pul hərəkətinin bölgüsü (§5.3) Meyar-ın qaydasıdır. Tövsiyə (qəbul): kodda adlı cədvəl; mühasib dəyişiklik istəsə, hesab planı formasında "maliyyə hesabatında maddə" sahəsi (sonra).
2. **Açılmış qalığın sətirləri.** Alıcının Kt qalığı 53 (kreditor) yoxsa 54 (sair)? Tövsiyə (qəbul): 54 — alınmış avans kimi (543 də 54-dədir); malsatanın Dt qalığı 24 (243 kimi).
3. **M/Z-nin xarakter üzrə variantı** xərc maddəsinin xarakterini istəyir (material, işçi heyəti, amortizasiya, digər). Tövsiyə: xərc maddəsinə "xarakter" sahəsi — sonra; indi funksiyalar üzrə variant (forma hər ikisinə icazə verir).
4. **Faiz ödənişləri** əməliyyat fəaliyyətindədir (formada sətir var; IAS 7.33 seçim verir). Tövsiyə (qəbul): əməliyyat; mühasib maliyyələşdirməyə köçürmək istəsə — qayda dəyişir.
5. **521.03 və 522 ödənişləri** "işçilərin mükafatlandırılması" sətrindədir (IAS 7.14(d): işçilər adından ödənişlər). Alternativ — "digər vergilər". Tövsiyə (qəbul): işçilər.
6. **Bağlanmamış nəticə 34-də** göstərilir (hesabat ilin ortasında da tutuşsun). Alternativ — dekabr bağlanmayanda hesabatı bağlamaq. Tövsiyə (qəbul): göstərmək + xəbərdarlıq.
7. **E-uçot portalı** (Nazirlər Kabinetinin 11.09.2025 tarixli 262 nömrəli qərarı ilə "E-uçot" informasiya sistemi): formatı yoxlanmadı. Tövsiyə (qəbul): Excel; portalın şablonu istifadəçidən gələndə — ixrac.

Mənbələr: [Maliyyə Nazirliyi, Q-01 (30.01.2017) — MHBS və MMUS üzrə uçot qaydaları, əlavələr 1–4](https://e-qanun.az/framework/34909); [muhasib.az — maliyyə vəziyyəti haqqında hesabat (IAS 1)](https://www.muhasib.az/article.php?cat=2&n=911); [Caspian Legal Center — maliyyə hesabatlarının elektron təqdimatı](https://www.caspianlegalcenter.az/news/more/financial-statements).
