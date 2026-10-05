# Uçot qaydaları və siyasət (Mərhələ A)

Bu sənəd proqramın **hazırda** necə uçot apardığını təsvir edir. Bütün qaydalar `src/domain/posting.ts` faylında deterministik funksiyalardır və testlərlə yoxlanılır. Hesab adları və müxabirləşmələr məhsul spesifikasiyasından götürülüb. Real şirkətdə istifadədən əvvəl mühasib qəbulu tələb olunur.

## Pul, miqdar, yuvarlaqlaşdırma

- **Pul:** qəpiklə tam ədəd kimi saxlanılır. Domain-də `bigint`, bazada `INTEGER`, proseslər arasında `"1234.50"` mətni istifadə olunur. Float heç yerdə işlədilmir.
- **Daxiletmə:** məbləğdə ən çox 2 onluq rəqəm qəbul olunur. Artıq rəqəm xəta verir, səssiz yuvarlaqlaşdırılmır.
- **Miqdar və çevirmə əmsalı:** 6 onluq, vahid qiyməti 4 onluq rəqəm.
- **Sətir məbləği:** `miqdar × qiymət` qəpiyə **bir dəfə** yuvarlaqlaşdırılır (yarım sıfırdan uzağa). Bu, sənəddə yeganə yuvarlaqlaşdırma nöqtəsidir.
- **Vahid çevirməsi:** qutu → ədəd çevirməsi dəqiq olmalıdır. 6 onluqdan artıq nəticə xəta verir.
- **Valyuta:** yalnız AZN. Valyuta modeli (`currencyScale`) ISO dəqiqliyi ilə gələcək üçün hazırdır.

## Hesab planı

Əsas hesablar şirkət yaradılanda yaranır:

| Hesab  | Ad                                            | Analitika             |
| ------ | --------------------------------------------- | --------------------- |
| 111    | TTA-nın dəyəri                                | —                     |
| 113    | TTA ilə bağlı məsrəflərin kapitallaşdırılması | anbar, məhsul, miqdar |
| 201    | Material ehtiyatları                          | anbar, məhsul, miqdar |
| 205    | Mallar                                        | anbar, məhsul, miqdar |
| 211    | Alıcılarla hesablaşmalar                      | kontragent            |
| 221    | Kassa                                         | —                     |
| 223    | Bank hesabları                                | —                     |
| 224.04 | ƏDV depozit hesabı                            | —                     |
| 241    | Alış üzrə ƏDV                                 | —                     |
| 521    | Vergi öhdəlikləri                             | —                     |
| 531    | Malsatanlarla hesablaşmalar                   | kontragent            |
| 545    | Satış üzrə ƏDV                                | —                     |
| 601    | Satış gəliri                                  | —                     |
| 701    | Satışın maya dəyəri                           | —                     |
| 721    | İnzibati xərclər                              | xərc maddəsi          |

Subhesab qaydaları:

- **Harada açılır:** bu mərhələdə yalnız 113, 201, 205, 601 və 721 hesablarına (məsələn `205.01`).
- **Nə götürür:** subhesab əsas hesabın növünü və analitikasını götürür.
- **Hesabatlarda:** subhesab əsas hesaba birləşir.
- **Əsas hesab:** subhesabı olan əsas hesaba birbaşa yazılış edilmir.
- **İşlədilmiş hesab:** yazılışı olan hesab səssizcə qrupa çevrilmir.
- **Xərc növləri:** rabitə, nəqliyyat, yemək və ofis xərcləri 721 üzrə ayrı subhesab deyil, **xərc maddəsi** analitikasıdır. Analitika kitabça elementinin identifikatoru kimi saxlanılır, sərbəst mətn kimi yox.

## Müxabirləşmələr

| Əməliyyat                          | Debet                             | Kredit                       |
| ---------------------------------- | --------------------------------- | ---------------------------- |
| Alış: mal / material / TTA məsrəfi | 205 / 201 / 113 (sətirdə seçilən) | 531 + kontragent             |
| Alış: xidmət                       | 721 + xərc maddəsi                | 531 + kontragent             |
| Alış üzrə ƏDV                      | 241                               | 531                          |
| Satış                              | 211 + kontragent (cəmi)           | 601 (əsas məbləğ), 545 (ƏDV) |
| Satılan malın maya dəyəri          | 701                               | 205 / 201 (orta çəkili)      |
| Daxil olan bank ödənişi            | 223 və ya 224.04                  | 211 + kontragent             |
| Çıxan bank ödənişi                 | 531 + kontragent                  | 223 və ya 224.04             |

Əlavə qaydalar:

- **ƏDV:** məbləğ sənədə uyğun daxil edilir. **18% düyməsi yalnız hesablama köməkçisidir**; heç bir qayda dərəcəni avtomatik tətbiq etmir. Əvəzləşmə hüququ, istisnalar və bəyannamələr bu mərhələdə yoxdur.
- **Nomenklatura kartı:** kartda yalnız ilkin hesab saxlanılır. Faktiki hesab sənəd sətrində seçilir. Kartı dəyişmək köhnə sənədləri yenidən uçota salmır.

## Sənədlərin həyat dövrü

- **Qaralama:** maliyyə və anbar təsiri yoxdur. Açıq adlandırılır və uçota alınmış kimi göstərilmir.
- **Uçota alma:** sənəd, jurnal, anbar hərəkəti, tarixçə və audit bir tranzaksiyada yazılır. Hamısı yazılır, ya da heç biri.
- **Düzəliş:** köhnə versiyanın yazılışına **onun öz tarixi ilə** əks yazılış qoyulur, sonra yeni versiya uçota alınır. Uçota alınmış qaimə qaralamaya qaytarılmır.
- **Ləğv:** əks yazılış yaradılır. Nömrə yenidən istifadə edilmir.
- **Jurnal və audit:** sətirlər silinmir və dəyişdirilmir. Bu, verilənlər bazası triggerləri ilə də qorunur.
- **Təkrar sorğu:** hər əmr idempotentlik açarı daşıyır. Eyni açar ikinci yazılış yaratmır, başqa məzmunla eyni açar rədd edilir.
- **Versiya nəzarəti:** düzəliş `expectedVersion` tələb edir. Köhnə versiya ilə edilən düzəliş son məlumatı əvəz etmir.
- **Nömrə unikallığı:** şirkət + istiqamət + kontragent + normallaşdırılmış nömrə üzrə yoxlanır. Boşluqlar və hərf registri nəzərə alınmır; i/ı/İ/I eyni sayılır.

## Bağlı dövr

- **Bloklananlar:** bağlanış tarixi daxil olmaqla yeni yazılış, düzəliş, ləğv, ödəniş bağlantısı və bağlantının açılması. Həm köhnə, həm yeni tarix yoxlanılır.
- **Bağlanış şərtləri:** yalnız keçmiş tarixə qədər bağlanır. Dövrdə qaralama qalıbsa, bağlanış rədd edilir.
- **Yenidən açma:** bu versiyada bağlı dövr açılmır. Bazanın özü bağlanış tarixinin geri çəkilməsinə icazə vermir.

## Ödəniş və qaimə bağlantısı (avans siyasəti)

- **Bank yazılışı:** ödəniş həmişə **tam məbləğlə** kontragentin hesablaşma hesabına yazılır (211 və ya 531).
- **Qaiməyə bağlama:** yalnız hesablaşma analitikasıdır. **Jurnalı dəyişmir.**
- **Bağlanmamış qalıq:** eyni hesabda kontragentin avansıdır. Sonradan istənilən tarixdə qaimələrə bağlana bilər. Bağlama tarixi ödənişdən və qaimədən əvvəl ola bilməz.
- **Hədlər:** bağlanan məbləğ nə qaimənin qalıq borcunu, nə ödənişin bağlanmamış qalığını aşa bilər. Bu, bazada da yoxlanılır.
- **Bağlı qaimə:** dəyişdirilmir və ləğv edilmir. Əvvəl bağlantı səbəb göstərilərək açılır.
- **Ödənişin düzəlişi və ləğvi:** bağlantıları açır. Düzəlişdə bölgü ödəniş tarixi ilə yenidən qurulur.
- **DBC:** 211 və 531 **açıq saldo** ilə göstərilir; debitor və kreditorlar bir-birindən çıxılmır.
- **Açıq sual:** avansların 211/531-dən ayrıca hesablara yenidən təsnifatı mühasiblə razılaşdırılmalıdır. Dövr sonu təsnifat qaydası hələ qurulmayıb.

## Anbar və maya dəyəri

- **Haradadır:** qalıq ayrıca cədvəldə deyil, miqdar uçotu aparılan hesabların (201, 205, 113 və subhesabları) jurnal sətirlərindədir. Anbar reyestri və baş kitab heç vaxt ayrılmır.
- **Maya dəyəri:** şirkət + hesab + anbar + məhsul üzrə **orta çəkili** qayda ilə hesablanır. Silinmə dəyəri `qalığın dəyəri × silinən / qalıq miqdar` düsturu ilə tapılır, qəpiyə yuvarlaqlaşdırılır. Qalığın hamısı silinəndə bütün dəyər silinir və qalıq qalmır.
- **Mənfi qalıq:** bloklanır. Çatışmazlıq olarsa sənədin heç bir hissəsi saxlanmır.
- **Xronologiya:** bir məhsulu onun başqa sənəddəki son hərəkətindən **əvvəlki tarixlə** hərəkət etdirmək olmaz. Bu həm yeni sənədə, həm də sonrakı hərəkəti olan sənədin düzəlişinə/ləğvinə aiddir. Səbəb: geri tarixli hərəkət sonrakı maya dəyərini səssizcə dəyişərdi. Nəzarətli yenidən hesablama sonrakı mərhələdir.
- **FIFO və digər metodlar:** aktiv deyil.

## Hələ olmayanlar (hazır kimi təqdim edilmir)

Qaytarma, anbarlararası transfer, material sərfi (Dt 721 / Kt 201), istismara vermə (Dt 111 / Kt 113) və amortizasiya. Həmçinin kassa, xarici valyuta, əməkhaqqı, vergi bəyannamələri, Excel və bank çıxarışı idxalı, DVX/bank API-ləri. İstifadəçi rolları, başlanğıc qalıqların köçürülməsi və proqram daxilində bərpa da hələ yoxdur.
