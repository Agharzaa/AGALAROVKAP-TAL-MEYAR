# Mərhələ 11 — satış e-qaiməsinin Meyar-dan DVX-ə göndərilməsi (dizayn)

Status: **təsdiqlənib** (04.11.2026, §11-in bütün tövsiyələri; `docs/QERARLAR.md` 2026-11-04). 11a hazırdır (0.9.31): diaqnostika qaralamaların siyahısını da oxuyur.

Əsas: `docs/MERHELE-6-DVX-AVTOMAT.md` (kabinet sessiyası, sənədləşdirilməmiş interfeys qaydaları, §11 sual 4 — "göndərmə sonra, ayrıca mərhələ"), `docs/MERHELE-4-EQAIME.md` (bir dəfəlik açar, satış qaiməsinin e-qaiməyə bağlanması), `docs/QERARLAR.md` 2026-10-22 (mərhələ 6 §2: JWT yalnız yaddaşda, yalnız `new.e-taxes.gov.az/api/po/…`), 2026-10-25 §18 ("göndərmə — sonra ayrıca mərhələ").

## 1. Məqsəd və sərhəd

İndi satış belə gedir: mühasib Meyar-da satış qaiməsini (SQ-) yazır, sonra **eyni qaiməni** DVX kabinetində əl ilə ikinci dəfə yazıb imzalayır. "DVX-dən yenilə" imzalanmış e-qaiməni gətirir, Meyar onu nömrəyə görə qaiməyə bağlayır. İkinci yazı vaxt aparır və səhvlərə yol açır: məbləğ, ƏDV, VÖEN, tarix fərqlənə bilər.

**Məqsəd:** satış qaiməsində **"DVX-də qaralama yarat"** düyməsi olsun. Meyar kabinetdə həmin qaimənin **qaralamasını** yaradır. Mühasib kabinetdə qaralamanı açır, yoxlayır və **ASAN İmza ilə özü imzalayır**. Sonra adi "DVX-dən yenilə" imzalanmış e-qaiməni gətirir və o, qaiməyə özü bağlanır.

**Mərhələyə daxildir:**

1. Satış qaiməsindən (və seçilmiş bir neçə qaimədən birdən) DVX qaralaması: alıcının VÖEN-i, tarix, sətirlər (ad, kod, ölçü vahidi, miqdar, qiymət, ƏDV-siz məbləğ, ƏDV dərəcəsi, ƏDV), yekun.
2. Göndərmədən **əvvəl** yoxlama: alıcının VÖEN-i (10 rəqəm), şirkət ƏDV ödəyicisidir, qaimə uçotdadır və e-qaiməsi yoxdur, manatdadır, məbləğlər qaimənin öz yazılışı ilə qəpikbəqəpik eynidir.
3. Qaralamanın izlənməsi: qaimədə "DVX-də qaralama — imzanızı gözləyir", sonra "imzalanıb (e-qaimə MT…)". İkinci qaralama yaradılmır.
4. İmzalanmış e-qaimənin qaiməyə **avtomatik bağlanması** (nömrə qaiməyə yazılır; mövcud `eqaime.link` qaydaları ilə).
5. Kabinetdə silinmiş və ya dəyişdirilmiş qaralamanın tanınması (yenidən yaratmağa icazə, fərq xəbərdarlığı).

**Mərhələyə daxil deyil:**

| Nə                                                                      | Niyə                                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **İmzalama** (ASAN İmza / e-imza ilə göndərmə)                          | İmza hüquqi hərəkətdir, telefonda PIN tələb edir; yalnız istifadəçi kabinetdə edir |
| Alış aktı, MTK (mənzil-tikinti) e-qaimələri, avans / qaytarma / düzəliş | Ayrı formalardır; əvvəl adi satış (əsas e-qaimə) işləsin. Düzəliş — §11 sual 4     |
| Valyuta qaimələri                                                       | DVX manatladır; valyuta qaiməsinin manat dəyəri mühasibin qərarıdır                |
| Gələn e-qaimələrin təsdiqi / imtinası                                   | Alıcı tərəfinin hərəkətidir, ayrıca mərhələ                                        |

## 2. Araşdırma: DVX-də qaralama necə yaranır

Portalın açıq JS faylında (`new.e-taxes.gov.az/eportal/static/js/index.*.js`, 04.11.2026-da girişsiz baxılıb) e-qaimə yaratma **iki ayrı addımdır**:

| Məqsəd                  | Sorğu (portalın adı)                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Qaralama yaratmaq       | `POST /api/po/invoice/public/v2/invoice` (`CREATE_INVOICE_DRAFT`)                        |
| Çox mallı qaralama      | `POST /api/po/invoice/public/v4/invoice` (`CREATE_INVOICE_DRAFT_BY_MULTIPLE_PRODUCT`)    |
| Qaralamanı dəyişmək     | `…/v2/invoice/{id}` (`UPDATE_INVOICE`)                                                   |
| Qaralamalar siyahısı    | `POST …/v1/invoice/find.draft` (`GET_INVOICE_DRAFT`)                                     |
| Qaralamanı silmək       | `…/v1/common/removeDrafts` (`DELETE_INVOICE_DRAFT`)                                      |
| Seriya / nömrə          | `GET …/v1/generateSerialNumber/…` (`GET_SERIAL_NUMBER`)                                  |
| **İmzalayıb göndərmək** | `POST …/v1/invoice/sign/withAsanImza`, `…/sign/withSignature` — **Meyar istifadə etmir** |
| XML paket yükləmə       | `…/v1/package/upload?type=…`, `…/v1/package/find` (rəsmi "e-QM" fayl formatı)            |

Yəni portal qaralamanı imzadan ayrı saxlayır, kabinetin özündə də "Qaralamalar" siyahısı var. Meyar yalnız qaralama yaradır, oxuyur və öz yaratdığını silir. İmza sorğuları ünvan siyahısına **heç vaxt** düşmür (§6).

**Gövdənin dəqiq sahələri** (alıcı, sətirlər, ölçü vahidinin kodu, malın təsnifat kodu və s.) formanın kodunda qurulur və real nümunəsiz təxmin edilmir. Buna görə 11a-da Meyar əvvəlcə **oxuyur**: mühasib kabinetdə bir qaralamanı əl ilə saxlayır, Meyar onu `find.draft` və qaralamanın öz sorğusu ilə alır. Sonra diaqnostika faylına yalnız **quruluşu** (sahə adları və tipləri, dəyərsiz) yazır, mərhələ 6a-dakı kimi. Meyar-ın qaralaması həmin quruluşla qurulur.

**Alternativ — rəsmi XML paketi.** taxes.gov.az "e-QM" faylının XML formatını dərc edir, kabinetdə "paketdən yükləmə" var. Bu, sənədləşdirilmiş yoldur. Lakin paketin formatı (və paketin də imza tələb edib-etmədiyi) real faylla yoxlanmalıdır. Tövsiyə: əsas yol qaralama sorğusudur — mərhələ 6-nın sessiyası və qaydaları ilə, artıq real DVX-də işləyir. XML paketi ehtiyat yoldur (§11 sual 2).

## 3. Axın

1. Mühasib satış qaiməsini Meyar-da adi qaydada uçota alır (yazılışlar, FIFO, ƏDV 521.01 — dəyişmir).
2. Qaimədə (və ya satış jurnalında seçilmiş qaimələrdə) **"DVX-də qaralama yarat"**. Kabinetə daxil olunmayıbsa, kabinet açılır və girişdən sonra əməliyyat özü davam edir (mərhələ 6 kimi).
3. Meyar §5 yoxlamalarından keçirir, qaralamanı yaradır və DVX-in qaytardığı qaralama id-sini qaimənin yanında saxlayır (`eq_drafts`, §4).
4. Mühasib kabinetin "Qaralamalar" bölməsində qaralamanı açır, yoxlayır və ASAN İmza ilə imzalayır.
5. "DVX-dən yenilə" (Göndərilənlər) imzalanmış e-qaiməni gətirir. Meyar qaralamanın qaiməsinə bağlayır (alıcı VÖEN-i + məbləğ + tarix + qaralama izi; nömrə qaiməyə yazılır). Qaralama "imzalanıb" olur.
6. Qaralama kabinetdə silinibsə və ya imzalanmadan 7 gündən çox qalıbsa — qaimədə və İş masasında xəbərdarlıq. Mühasib qaralamanı yenidən yarada bilər (köhnəsi Meyar-da "silinib" qeyd olunur).

## 4. Məlumat modeli (sxem v27)

`eq_drafts` — hər cəhd bir sətir, silinmir:

| Sahə                             | Məna                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| `id`, `company_id`               |                                                             |
| `invoice_id`, `invoice_version`  | Hansı qaimədən, onun hansı versiyasından                    |
| `dvx_id`                         | DVX-in qaytardığı qaralama id-si                            |
| `content_hash`                   | Göndərilən gövdənin izi (alıcı, tarix, sətirlər, məbləğlər) |
| `state`                          | `created` / `signed` / `removed` / `failed`                 |
| `eq_document_id`                 | İmzalanandan sonra gələn e-qaimə                            |
| `message`, `created_at`, `actor` | Səbəb (xətada), vaxt, kim                                   |

Göndərilən gövdə özü saxlanmır — qaimədən yenidən qurulur, iz bəs edir.

## 5. Göndərmədən əvvəl yoxlamalar (qadağa, xəbərdarlıq deyil)

- Qaimə uçotdadır (ləğv edilməyib), satışdır, manatdadır; dövrü açıqdır.
- Qaimənin e-qaiməsi yoxdur (nömrəsi boşdur, e-qaiməyə bağlanmayıb) və onun üçün `created` qaralama yoxdur.
- Alıcının VÖEN-i 10 rəqəmdir və şirkətin öz VÖEN-i deyil. Fiziki şəxsə (VÖEN-siz) e-qaimə yaradılmır.
- Şirkət ƏDV ödəyicisidir. Sətirlərin ƏDV dərəcələri DVX-in qəbul etdiyi dəstdədir (18%, 0%, azad, cəlb edilməyən).
- Hər sətrin ƏDV-siz məbləği və ƏDV-si qaimənin saxlanmış sətri ilə eynidir, yekun qaimənin yekunudur. DVX qiyməti başqa yuvarlaqlaşdırırsa, fərq göstərilir və qaralama yaradılmır.
- Malın / xidmətin DVX məhsul kodu və ölçü vahidi məlumdur. Uyğunluq kitabçasından (`eq_product_map`, satış istiqaməti) və ya nomenklaturanın yeni "DVX kodu" sahəsindən götürülür. Yoxdursa — hansı malda olduğu deyilir.

## 6. Təhlükəsizlik və etibarlılıq

- Mərhələ 6-nın bütün qaydaları qalır: JWT yalnız əsas prosesin yaddaşında, yalnız `https://new.e-taxes.gov.az/api/po/…`, `redirect: 'error'`, diaqnostikada dəyər yoxdur.
- Ünvan siyahısı **ayrıca, dar**: yalnız qaralama yaratmaq, öz qaralamasını oxumaq / dəyişmək / silmək və `find.draft`. `sign/*`, `sendBack`, `approve`, paket yükləmə (sual 2 təsdiqlənənədək) — əsas prosesdə **qadağandır** və test ilə qorunur.
- Meyar yalnız öz yaratdığı qaralamanı (id `eq_drafts`-dadır) silə və dəyişə bilər.
- Bir qaimə üçün bir anda bir qaralama. Təkrar basmaq ikincisini yaratmır (əmr açarı + `created` vəziyyəti).
- Cavab tanınmırsa — dayanır, diaqnostika yazılır, mühasibə "qaralama yaradılmadı, kabinetdə əl ilə yazın" deyilir. Heç nə təxmin edilmir.
- Qaralama yarandıqdan sonra qaimə dəyişdirilirsə — xəbərdarlıq: "DVX-dəki qaralama köhnədir: yeniləyin və ya silin". Qaralama özbaşına yenilənmir.

## 7. İnterfeys

- Satış qaiməsinin formasında, əmr panelində: **"DVX-də qaralama yarat"** (yalnız §5 keçəndə aktivdir, keçməyəndə səbəb ipucunda). Yanında vəziyyət: "Qaralama DVX-də · imzanızı gözləyir · 04.11.2026" / "İmzalanıb — e-qaimə MT…".
- Satış jurnalında: seçilmiş qaimələr üçün eyni düymə. Nəticə hər qaimə üçün ayrıca: yaradıldı / səbəb.
- Göndərilən e-qaimələr qutusunda yeni tab: **"Qaralamalar"** (Meyar-ın yaratdığı, hələ imzalanmamış).
- İş masası: "N qaralama DVX-də imzanızı gözləyir (7 gündən çox: M)".

## 8. Qəbul testləri

| #   | Hal                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------ |
| G1  | Uçotdakı satış qaiməsi → qaralamanın gövdəsi (alıcı, tarix, sətirlər, ƏDV) qaimə ilə qəpikbəqəpik eynidir          |
| G2  | VÖEN-siz alıcı, valyuta, ləğv edilmiş qaimə, bağlı dövr, artıq e-qaiməsi olan, kodu olmayan mal — rədd, səbəbi ilə |
| G3  | İkinci basma ikinci qaralama yaratmır; xəta olanda qaralama yaranmamış sayılır                                     |
| G4  | Əsas proses `sign/*`, `sendBack`, `approve` ünvanlarını rədd edir (ünvan siyahısı testi)                           |
| G5  | İmzalanmış e-qaimə "DVX-dən yenilə" ilə gələndə qaiməyə özü bağlanır, ikinci qaimə yaranmır                        |
| G6  | Kabinetdə silinmiş qaralama tanınır, yenidən yaratmağa icazə var; qaralamadan sonra dəyişən qaimə — xəbərdarlıq    |
| G7  | Sxem v26 → v27 köhnə bazada                                                                                        |
| D11 | İstifadəçi ilə real yoxlama: bir qaimə → qaralama → kabinetdə imza → yeniləmə → bağlandı                           |

## 9. Mövcud koddan nə götürülür

`src/main/dvx-api.ts`, `dvx-api-policy.ts` (sessiya, açar, ünvan qaydaları, diaqnostika), `src/renderer/dvx-sync.ts` (girişdən sonra özü davam etmə, bir anda bir əməliyyat), `eqaime-book.ts` (`linkEq`, `check` — bağlanma qaydaları), `eq_product_map` (DVX kodu ↔ nomenklatura; satış üçün tərsinə istifadə), `invoices.ts` (qaimənin saxlanmış sətirləri — gövdənin mənbəyi; yazılışlara toxunulmur).

## 10. İcra ardıcıllığı

1. **11a — quruluşun öyrənilməsi (yalnız oxuma):** `find.draft` və bir qaralamanın oxunması, diaqnostika faylı (dəyərsiz). İstifadəçi kabinetdə bir qaralamanı əl ilə saxlayır, Meyar quruluşu yazır. Sxem dəyişmir.
2. **11b — qaralama:** sxem v27 `eq_drafts`, §5 yoxlamaları, gövdənin qurulması (11a-nın quruluşu ilə), ünvan siyahısı, düymə qaimədə, G1–G4, G7.
3. **11c — izləmə və bağlanma:** "Qaralamalar" tabı, imzalanmışın avtomatik bağlanması, silinmiş / köhnəlmiş qaralama, İş masası, toplu yaratma; G5, G6.
4. **Müstəqil audit**, sonra D11 — istifadəçi ilə real göndərmə.

## 11. Açıq suallar (istifadəçi)

Hər sual üçün tövsiyə verilib, son qərar sizindir.

1. **İmza.** Meyar yalnız qaralama yaradır, imzanı həmişə siz kabinetdə edirsiniz. Tövsiyə: qəbul. Meyar-ın özü ASAN İmza sorğusu göndərməsi texniki cəhətdən mümkündür (telefona PIN sorğusu gəlir), amma səhv göndərilmiş e-qaimənin bədəli yüksəkdir.
2. **Yol.** Tövsiyə: portalın qaralama sorğusu (mərhələ 6-nın yolu, DVX dəyişsə dayanır və deyir). Alternativ: rəsmi XML paketi — sənədləşdirilib, amma formatı və imza tələbi real faylla yoxlanmalıdır.
3. **Seriya / nömrə.** DVX nömrəni imza zamanı özü verir (`generateSerialNumber`). Tövsiyə: Meyar nömrə təklif etmir, imzalanandan sonra DVX-in nömrəsini qaiməyə yazır.
4. **Düzəliş e-qaiməsi.** Uçotdakı qaimə dəyişəndə (məbləğ, sətir) DVX-də düzəliş e-qaiməsi lazımdır. Tövsiyə: bu mərhələdə yox — xəbərdarlıq ("e-qaimə imzalanıb, qaimə dəyişib: kabinetdə düzəliş edin"); düzəlişin qaralaması sonra.
5. **Malın DVX kodu.** Tövsiyə: nomenklaturaya "DVX məhsul kodu" və "DVX ölçü vahidi" sahələri; boşdursa satış uyğunluqlarından götürülür. MG Transport üçün əsasən bir xidmət ("Daşıma xidmətləri") olduğundan bir dəfə yazmaq kifayətdir.
6. **Real yoxlama.** 11a üçün kabinetdə bir qaralamanı əl ilə saxlayıb (imzalamadan) Meyar-da "Quruluşu oxu" basa bilərsinizmi? Faylda yalnız sahə adları və tiplər olur, rəqəm, ad, VÖEN olmur.
