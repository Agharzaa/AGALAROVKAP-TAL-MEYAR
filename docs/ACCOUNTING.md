# Uçot modeli (v3 — subkonto modeli)

Bu sənəd proqramın necə uçot apardığını təsvir edir. Qərarların özü və onların tarixçəsi `docs/QERARLAR.md`-dədir; kod hər ikisinə tabedir.

## Pul, miqdar, yuvarlaqlaşdırma

- **Pul:** qəpiklə tam ədəd kimi saxlanılır (`bigint`), interfeysə onluq mətn kimi gedir. Üzən nöqtə heç yerdə istifadə olunmur.
- **Miqdar:** 6 onluq rəqəmlə saxlanılır.
- **Yuvarlaqlaşdırma:** 2 onluqdan artıq yazılan məbləğ yuvarlaqlaşdırılmır, səhv kimi qaytarılır.

## Hesab planı və subkonto

- **Subkonto:** hər hesabda ən çox 3 subkonto var və onların sırası sabitdir. Hesaba yazılan hər yazılış həmin hesabın bütün subkontolarını daşıyır.
- **Hesabat:** hesabatlar subkontolar üzrə açılır.
- **Müqavilə:** müqavilə subkontosu həmişə kontragentdən dərhal sonra gəlir.

| Hesab                                    | Subkonto                                      | Qeyd                                                   |
| ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| 101, 111, 113, 201, 204, 205             | Nomenklatura                                  | miqdar uçotu                                           |
| 211.01 / 211.02, 531.01 / 531.02         | Kontragent → Müqavilə → Hesablaşma sənədi     | aktiv-passiv; .02 valyuta uçotu                        |
| 243.01 / 243.02, 543.01 / 543.02         | Kontragent → Müqavilə → Hesablaşma sənədi     | verilmiş / alınmış avanslar; .02 valyuta uçotu         |
| 217, 538                                 | Kontragent → Müqavilə                         |                                                        |
| 221                                      | Kassa                                         |                                                        |
| 222.01 / 222.03                          | —                                             | yolda olan köçürmələr (manat / valyuta)                |
| 222.02 / 222.04                          | Kontragent → Müqavilə → Hesablaşma sənədi     | valyutanın alınması / satılması (.04 valyuta uçotu)    |
| 223.01 / 223.02                          | Bank hesabı                                   | 223.02 valyuta uçotu                                   |
| 224.04                                   | Bank hesabı                                   | ƏDV depozit hesabı                                     |
| 241                                      | Kontragent → Hesablaşma sənədi → ƏDV dərəcəsi |                                                        |
| 244, 533                                 | İşçi                                          |                                                        |
| 301                                      | Kontragent (təsisçi)                          |                                                        |
| 401, 501, 422                            | Kontragent → Müqavilə                         | kreditlər; 422 digər təxirə salınmış vergi öhdəlikləri |
| 521.01–521.12 (521.07, 521.09 istisna)   | —                                             | subhesab vergi növüdür                                 |
| 521.07                                   | Kontragent                                    | ödəmə mənbəyindən vergi                                |
| 521.09                                   | Vergi növü                                    | sair vergi və rüsumlar                                 |
| 521.13                                   | Kontragent → Müqavilə → Hesablaşma sənədi     | ƏDV vergi agenti                                       |
| 522.01, 522.02, 522.03.1/.2, 522.04.1/.2 | —                                             | DSMF, işsizlik, tibbi sığorta (işçi / işəgötürən)      |
| 601, 602, 603                            | Gəlir növü → ƏDV dərəcəsi                     |                                                        |
| 604.1                                    | ƏDV dərəcəsi                                  | satışın ƏDV-si (Kt 521.01)                             |
| 701                                      | Nomenklatura qrupu → Xərc maddəsi             |                                                        |
| 202, 242, 711, 721, 731                  | Xərc maddəsi                                  |                                                        |
| 631, 751                                 | Kontragent → Müqavilə                         | maliyyə gəlir və xərcləri                              |
| 341, 343, 344, 534.01, 801, 901          | —                                             |                                                        |

Hesab planının qaydaları:

- **Qruplar:** subhesabı olan hesab (211, 222, 223, 224, 243, 521, 522, 531, 534, 543, 604) qrupdur və ona birbaşa yazılış edilmir. Hesabatlarda qrupun subhesabları qrupun üzərinə toplanır.
- **Yeni hesab və subhesab:** mühasib istənilən vaxt aça bilər. Subhesab əsas hesabın növünü, subkontolarını, miqdar və valyuta uçotunu götürür, amma bunları dəyişmək olar.
- **Yazılışı olan hesab:**
  - subkontosu, növü, miqdar və valyuta uçotu dəyişdirilmir;
  - ona subhesab açılmır;
  - qalığı varsa arxivləşdirilmir.

  Bu qaydalar bazada da qorunur.

- **Hesab adları:** 1C AzStandart ilə tutuşdurmadan sonra dəyişən hesablar 1C-dəki adları daşıyır; qalanları hələ işçi adlardır.
- **Köhnə bazaların yenilənməsi (sxem v2):** 0.3.0 bazası açılanda hesab planı yenilənir — yalnız yazılışı olmayan hesab ailələrində; yazılışı olan hesab öz quruluşunu saxlayır, istifadəçinin dəyişdirdiyi ad toxunulmur. Yeniləmədən əvvəl ehtiyat nüsxə alınır, audit jurnalına qeyd düşür.

## Kitabçalar

- **Kontragent:** VÖEN şirkət daxilində unikaldır. Hüquqi şəxs üçün VÖEN məcburidir; fiziki şəxs, xarici şəxs və dövlət orqanı üçün məcburi deyil.
- **Müqavilə:** kontragentə bağlıdır və nömrə, tarix, növ (satış, alış, kredit, digər) və valyuta daşıyır.
  - Bir kontragentlə istənilən sayda müqavilə ola bilər.
  - Müqavilənin kontragenti dəyişdirilmir; hərəkəti varsa, valyutası da dəyişdirilmir.
- **Bank hesabı:** bank (kontragent), IBAN, valyuta və bağlı olduğu hesabla (223.01 / 223.02 / 224.04) qeyd olunur.
  - Manat hesabı valyuta uçotu olan hesaba, xarici valyuta hesabı isə manat hesabına bağlana bilməz.
  - Hərəkəti olan bank hesabının bağlı olduğu hesab və valyutası dəyişdirilmir.
- **Digər kitabçalar:** nomenklatura, nomenklatura qrupları, işçilər, xərc maddələri, gəlir növləri, vergi növləri, fondlar və kassalar.
- **ƏDV dərəcələri:** qanunla müəyyən olunduğu üçün sabit siyahıdır: 18%, 0%, ƏDV-dən azad, ƏDV-yə cəlb olunmayan.
- **Silinmə:** kitabça elementləri silinmir, arxivləşdirilir. Arxivdəki elementə yeni yazılış edilmir.

## Yazılışlar

- **Yazılışın quruluşu:** hər yazılış Dt/Kt cütüdür. Hər tərəfdə həmin hesabın subkontoları, miqdar uçotu olan hesablarda miqdar, valyuta hesablarında isə valyuta məbləği yazılır. Valyuta bank hesabından və ya müqavilədən götürülür.
- **Subkonto yoxlaması:** hər subkonto dəyəri kitabçada yoxlanılır:
  - element bu şirkətə və düzgün növə aiddir;
  - arxivdə deyil;
  - müqavilə həmin kontragentə aiddir;
  - bank hesabı yazılan hesaba bağlıdır.
- **Hesablaşma sənədi boş qalsa,** sənədin özü yazılır (1C-dəki kimi).
- **Düzəliş və ləğv:** qırmızı storno ilə aparılır, yəni eyni yazılışlar mənfi məbləğlə təkrarlanır. Ləğv edilən sənəd dövriyyəni şişirtmir, dövriyyədən çıxır.
- **Jurnal və audit:** dəyişdirilə və silinə bilməz. Bu, bazanın öz qoruyucuları ilə təmin olunur.

## Qalıqlar, registrlər və hesabatlar

- **Qalıq registri:** hesab × subkonto × ay üzrə yekunlardır. Hər yazılışla eyni tranzaksiyada bazanın trigger-ləri tərəfindən yenilənir.
- **Hesabatların mənbəyi:** hesabatlar jurnalı skan etmir. Registrlərdən və ən çox iki natamam ayın yazılışlarından istifadə edir.
- **Dövriyyə balansı:**
  - istənilən dövr üçün qurulur;
  - hesab → subhesab → subkonto 1 → 2 → 3 ardıcıllığı ilə açılır;
  - qalıqlar açıq saldo ilə göstərilir, yəni ən aşağı subkonto səviyyəsində debitor kreditorla netlənmir;
  - süzgəclər: yalnız dövriyyəsi olanlar, yalnız dövrdə yarananlar, hesablar, kontragent;
  - Excel-ə çıxarılır.
- **Hesab kartı:** hesab (və ya qrup) və subkonto üzrə qurulur: əvvələ qalıq, hər yazılış müxabir hesab və subkontoları ilə, cari qalıq, sona qalıq.
- **Bütövlük yoxlaması:** proqram açılanda ayrıca oxuma bağlantısında işləyir. Jurnaldan yenidən qurulan registrlər saxlanılanlarla sətir-sətir tutuşdurulur, debet və kreditin bərabərliyi yoxlanılır.
- **Başlanğıc səhifəsində nəzarət:**
  - eyni kontragent və müqavilədə həm 211 borcu, həm 543 avansı varsa (və ya 531 ilə 243 üçün eyni vəziyyət) — "əvəzləşdirilməmiş avans";
  - mənfi anbar qalığı;
  - mənfi pul qalığı.

## Dövrün bağlanması

- **Bağlanış:** bağlanış tarixinə qədər (daxil olmaqla) heç nə yazılmır, dəyişdirilmir və ləğv edilmir. Bu qadağa bazada da qorunur.
- **Yenidən açma:** yalnız səbəb yazmaqla mümkündür və audit jurnalına düşür.
- **Ay sonu bağlanış yazılışları** (6/7 → 801 → 341, dekabrda 341 → 343) növbəti mərhələdədir.

## Sürət və etibarlılıq

- **Ayrıca axın:** uçot bazası ayrıca axında (worker thread) işləyir, ona görə uzun hesabat pəncərəni dondurmur.
- **Yük testi:** 500 000 yazılışda (1 000 000 jurnal tərəfi) aşağıdakı həddlər yoxlanılır:

  | Əməliyyat                   | Hədd             |
  | --------------------------- | ---------------- |
  | Dövriyyə balansı            | 1 saniyədən az   |
  | Dövriyyə balansının açılışı | 1 saniyədən az   |
  | Hesab kartı                 | 1 saniyədən az   |
  | Başlanğıc səhifəsi          | 1,5 saniyədən az |

  CI-da 100 000 yazılışla işləyir: `npm run test:perf`.

- **Ehtiyat nüsxə:** hər açılışda avtomatik alınır; son 30 nüsxə saxlanılır.
