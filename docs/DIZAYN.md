# Meyar — dizayn sistemi (0.7.1)

Məqsəd: gündə 8+ saat işləyən mühasibin gözü yorulmasın; kiçik (1366×768) və böyük (1920×1080 və daha
böyük) ekranda eyni rahatlıq. İş məntiqi 1C-dəki kimidir (bölmələr yuxarıda, formalar pəncərədə, pəncərə
tabları aşağıda, klaviatura birinci), görünüş isə Meyar-ın özünündür — 1C-nin surəti deyil.

Mənbə: `src/renderer/styles.css` (başlıqdakı tokenlər). Rəylər: mühasib, dizayner, auditor (21.10.2026),
istifadəçinin seçimi — açıq və tünd mövzu, Parametrlərdə seçimlə.

## 1. Parıltı və səthlər (açıq mövzu)

Ağ yoxdur. Səthlər çərçivədən iş sahəsinə doğru təxminən 3 L\* pilləsi ilə açılır; ən açıq böyük səth
cədvəl və paneldir.

| Səth                                           | Rəng      | Parlaqlıq (L) |
| ---------------------------------------------- | --------- | ------------- |
| Çərçivə: başlıq, bölmələr (`--bar`)            | `#d2d0ca` | 63 %          |
| Pəncərə tabları, status (`--desk-2`)           | `#c3c1ba` | 53 %          |
| Masa — pəncərələrin arxası (`--desk`)          | `#c7c5be` | 56 %          |
| Pəncərənin gövdəsi (`--paper`)                 | `#dddcd6` | 71 %          |
| Cədvəl, panel (`--sheet`) — ən açıq böyük səth | `#e4e3de` | 77 %          |
| Sahə (`--field`) — yalnız kiçik sahələr        | `#e8e7e2` | 80 %          |

0.7.0-da kağız `#fffefc` idi (99 %). Tünd mövzu eyni pillələrlə: masa `#181a1c`, pəncərə `#202225`, cədvəl
`#25282b`.

## 2. Kontrast (WCAG, hesablanıb)

| Cüt                                       | Açıq            | Tünd            |
| ----------------------------------------- | --------------- | --------------- |
| Əsas yazı / cədvəl                        | 11.2:1          | 10.6:1          |
| Əsas yazı / cari sətir                    | 10.1:1          | 8.4:1           |
| İkinci dərəcəli yazı / pəncərə            | 5.4:1           | 6.6:1           |
| İpucu / pəncərə                           | 4.8:1           | 5.1:1           |
| Əsas düymə (yazı / petrol)                | 6.1:1           | 5.5:1           |
| Sahə çərçivəsi (qeyri-mətn, ≥ 3:1)        | 3.2:1           | 3.3:1           |
| Uçotda / qaralama / ləğv (yazı, cədvəldə) | 5.5 / 5.2 / 5.6 | 7.2 / 7.8 / 6.3 |

Yazı heç vaxt təmiz qara (və tünd mövzuda təmiz ağ) deyil: 15–21:1 kontrast uzun müddətdə sərtdir,
10–11:1 aydın və rahatdır.

## 3. Yazı

- Şrift: Segoe UI (Windows-un ekran şrifti, ClearType üçün hazırlanıb); Inter yalnız ehtiyat.
- Şkala: 22 (İş masası) / 16 (panel başlığı) / 14 (iş mətni, cədvəl, sahə) / 13 (cədvəl başlığı, ikinci
  dərəcəli) / 12 px (status, kiçik) — 12 px-dən kiçik yazı yoxdur.
- Qalınlıq: 600 başlıq və yekun, 400 məzmun, 500 düymə və menyu. Dövriyyə balansında yalnız hesab kodu
  qalındır, ad adi.
- Rəqəmlər cədvəl rəqəmləridir (tabular) — sütunda düz dayanır. Kursiv yoxdur.

## 4. Ölçülər (4 px şəbəkə)

| Element         | Adi   | Alçaq ekran (≤ 820 px) |
| --------------- | ----- | ---------------------- |
| Düymə, sahə     | 30 px | 28 px                  |
| Cədvəl sətri    | 32 px | 28 px                  |
| Cədvəl başlığı  | 32 px | 30 px                  |
| Bölmələr paneli | 44 px | 40 px                  |
| Pəncərə başlığı | 34 px | 34 px                  |
| Başlıq zolağı   | 40 px | 40 px                  |

Boşluqlar 8 / 12 / 16 px; künclər 3 px (idarəetmə), 5 px (pəncərə, panel).

Ekran miqyası (`src/main/fit-zoom.ts`): 1760 px-ə qədər 100 %; daha geniş pəncərə 0.05 pillə ilə böyüyür,
ən çox 125 % (1920 → 105 %, 2560 → 125 %); 1200 px-dən dar pəncərə 90 %. İstifadəçinin Ctrl + / − miqyası
bunun üstünə vurulur.

## 5. Dərinlik (kölgə)

1 — panel və cədvəl; 2 — arxadakı pəncərə; 3 — aktiv pəncərə; 4 — açılan menyu; 5 — dialoq. Düymə
qabarıqdır (yuxarısı açıq, kölgəsi 1 px), basılanda çökür; sahə çökükdür (daxili 2 px kölgə). Çərçivələr
açıq xətdir; tünd çərçivə yalnız pəncərədə, cədvəl başlığının altında və yekunun üstündə.

## 6. Rəngin mənası

- **Petrol** (`#2c6b6e`, tünddə `#5fb3ad`) — "buradasınız / bunu edin": əsas düymə, açıq bölmə, aktiv
  pəncərə, cari sətrin kənarı, fokus. Ekranda iki-üç yerdən çox deyil.
- Yaşıl, kəhrəba, qırmızı yalnız məna üçündür və həmişə forması ilə: ● uçotda, ○ qaralama, ✕ ləğv edilib;
  ləğv olunmuş sənədin məbləğləri üstündən xətlə. "Dt/Kt" işarəsi qırmızı deyil.

## 7. Komponentlər

- **Cədvəl:** düz başlıq (13/600), sətirlər arasında açıq xətt; sütun xətləri yalnız hesabatlarda və
  sənəd sətirlərində; zebra yoxdur (bir ayırma vasitəsi); cari sətir petrol çaları + 3 px kənar (kənar
  sətrə 4.3:1); yekun sətri 2 px xəttin altında. Dövriyyə balansı məzmun enindədir — rəqəmlər adlardan
  uzaqlaşmır.
- **Düymələr:** əsas — petrol, ağ yazı; adi — qabarıq boz; alət panelində adi düymələr çərçivəsizdir;
  qeyri-aktiv düymə şəffaf və solğundur (aktiv kimi görünmür).
- **Bölmələr:** ikon (18 px) yazının yanında; açıq bölmə pəncərə ilə birləşən tabdır (yuxarıda petrol
  xətt).
- **Pəncərə tabları:** aralarında incə xətt; bağla işarəsi yalnız aktiv və ya üzərinə gəlinən tabda.
- **Ay bağlanışı:** addımlar bir vərəqin sətirləridir; vəziyyət nişandır (yaşıl — hazır, boz — yazılış
  yoxdur, qırmızı — bloklayır).
- **İdarə paneli:** 6 plitə bir sırada, qrafik real enində çəkilir (ay adları 12 px qalır), hündürlüyü
  ən çox 240 px; Y oxu, 3–4 ölçü xətti, sıfır xətti.
- **Ay sahəsi:** "‹ Oktyabr 2026 ›", sistemin dilindən asılı deyil; bağlı aylar qıfıllı.
- **Sənəd forması:** vəziyyət nişanı əmr panelində; ləğv olunmuş sənəddə qırmızı-çalar zolaq; yazılış
  qaydası bir sətrə yığılıb.

## 8. Rəylərdən ayrıca işə qalanlar

Bunlar görünüşdən artıq funksional dəyişiklikdir, ayrıca sessiyada edildi (21.10.2026, testlər "design §8"):

- ~~Ay seçicisi Windows dilində~~ — `MonthInput` (`ui.tsx`): "‹ Oktyabr 2026 ›" sahə kimi çökük qutu; ← / →
  ay, ↓ ilin siyahısı (3 × 4, ox düymələri, PageUp / PageDown il, Esc). Bağlı aylar siyahıda qıfıl və
  `--desk-2` fonla, sahədə qıfılla; ekran oxuyucusu üçün "dövr bağlıdır" mətni. Seçilmiş ay petrol.
- ~~Sənəd formasında vəziyyət nişanı~~ — `ModuleFrame status`: əmr panelinin sağında ● Uçotda / ○ Qaralama
  / ✕ Ləğv edilib (yeni sənəd qaralamadır); ləğv olunmuş sənəddə əmr panelinin altında `--bad-bg` zolağı.
  ~~"Yazılış qaydası" yığılan~~ — `PostingRule` (`<details>`), bağlı açılır.
- ~~Satış siyahısında yekunlar~~ — hamısı manatdırsa bir "Cəmi" sütunu; valyuta varsa "Cəmi" (valyutası
  ilə) və "Cəmi, AZN". Yekun sətri uçotdakılar üzrə ƏDV-siz, ƏDV, cəmi — valyuta olanda manatla.
  ~~Mənfi məbləğ "−" ilə~~ — `money()` və `qty()`.
- ~~Qrafikə ox və ölçü xətləri~~ — Y oxu solda (rəqəmlər "−" ilə), 3–4 incə ölçü xətti (`--rule-soft`),
  sıfır xətti tünd (`--frame`); şkala 1 / 2 / 2,5 / 5 × 10ⁿ addımla, simmetrik deyil.

Hələ qalan: sənəd pəncərəsi 1600 px-dən dar ekranda tam açılsın; status zolağında effektiv miqyas.
