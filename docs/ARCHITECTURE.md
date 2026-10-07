# Arxitektura

## Qatlar

| Qovluq                      | Məsuliyyət                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/domain`                | Təmiz uçot nüvəsi: pul, miqdar, hesab planı və subkonto, Dt/Kt yazılış yoxlaması, storno. I/O yoxdur. |
| `src/contracts`             | UI ↔ tətbiq müqaviləsi və runtime yoxlama (zod). Pul və miqdar onluq mətndir.                         |
| `src/application`           | Əmrlər və sorğular: tranzaksiya, idempotentlik, versiya, dövr, subkonto yoxlaması, audit, hesabatlar. |
| `src/infrastructure/sqlite` | SQLite adapteri, versiyalı miqrasiyalar, tenant və dəyişməzlik triggerləri, backup.                   |
| `src/main`, `src/preload`   | Electron: tək pəncərə, IPC sərhədi, uçot worker-ləri (yazan + yalnız oxuyan), açılış backup-ı.        |
| `src/renderer`              | React UI: iş sahəsi, modul və sənəd pəncərələri, dizayn sistemi.                                      |
| `tests/domain`              | Domain unit testləri.                                                                                 |
| `tests/integration`         | Real SQLite üzərində əmr və hesabat testləri.                                                         |
| `tests/ui`                  | jsdom-da React + real Ledger inteqrasiyası.                                                           |
| `tests/perf`                | Yük testi (standart 500 000 yazılış) və hesabat həddləri.                                             |

## Asılılıq qaydaları

- **UI:** bazaya birbaşa girmir. Yalnız `window.meyar` körpüsü ilə əmr və sorğu göndərir.
- **Əmrlər:** hamısı `Ledger.execute` vasitəsilə gedir. Hər əmr:
  1. sxemlə yoxlanılır;
  2. idempotentlik açarı ilə təkrara qarşı yoxlanılır;
  3. bir `BEGIN IMMEDIATE` tranzaksiyasında icra olunur.
- **Maliyyə yazılışları:** yalnız `Tx.post` ilə yazılır. Hər yazılış `checkPostings` (hesab yazıla biləndir, subkonto sayı, miqdar və valyuta tələbi) və `checkSideValues` (subkonto dəyəri kitabçada, düzgün növdə, arxivdə deyil, müqavilə kontragentə, bank hesabı hesaba aiddir) yoxlamalarından keçir. Düzəliş və ləğv — qırmızı storno.
- **Hesabatlar:** aylıq qalıq registrlərindən (triggerlə eyni tranzaksiyada yenilənir) və natamam ayların yazılışlarından SQL-də hesablanır, bir oxu tranzaksiyasında.
- **Worker-lər:** yazan worker bütün əmr və sorğuları icra edir; bütövlük yoxlaması ayrıca yalnız oxuyan bağlantıda (query_only) işləyir. Pəncərə heç vaxt gözləmir.

## Bütövlük və təhlükəsizlik

- **Şirkət sərhədi:** strukturdur. Uşaq sətir valideyinə `(company_id, id)` kompozit xarici açarı ilə bağlanır. Xidmət qatı keçilsə belə, başqa şirkətin kontragenti, məhsulu, anbarı və ya hesabı istifadə olunmur.
- **Jurnal, audit və sənəd tarixçəsi:** yalnız əlavə olunur. `UPDATE` və `DELETE` triggerlə qadağandır.
- **Bağlı dövr və bağlantı hədləri:** triggerlərlə də yoxlanılır.
- **Electron:** `contextIsolation` və `sandbox` açıq, `nodeIntegration` bağlıdır.
  - IPC yalnız əsas pəncərənin əsas frame-indən və tətbiq URL-indən qəbul olunur.
  - Yeni pəncərə və naviqasiya bloklanır, icazə sorğuları rədd edilir.
  - CSP yalnız yerli resurslara icazə verir.
- **Gözlənilməz xəta:** istifadəçiyə ümumi mesajla qaytarılır. Maliyyə məzmunu xarici telemetriyaya göndərilmir.
- **Lokal administratorun fiziki çıxışı:** baza şifrələnmir. Kompüterə fiziki çıxışı olan administrator faylı oxuya bilər; bunun qarşısı alınmış kimi göstərilmir. Disk şifrələməsi (BitLocker) əməliyyat sisteminin işidir.

## Məlumat və backup

- **Yerləşmə:** `%APPDATA%/Meyar/data/meyar-v3.sqlite` (köhnə `meyar.sqlite` toxunulmaz qalır); nüsxələr `%APPDATA%/Meyar/backups`. Quraşdırma qovluğundan ayrıdır; uninstall məlumatı silmir.
- **Açılış nüsxəsi:** hər açılışda, miqrasiyadan əvvəl SQLite backup API ilə ardıcıl nüsxə götürülür; son 30 nüsxə saxlanılır.
- **Versiya qoruması:** daha yeni sxemli bazanı köhnə proqram açmır.
- **Əl ilə nüsxə:** Parametrlər bölməsindən istənilən qovluğa.
- **Bərpa:** test edilib — nüsxə canlı baza ilə eyni hesabatları qaytarır. Proqram daxilində bərpa pəncərəsi isə **hələ yoxdur**. Əl ilə bərpa qaydası:
  1. Proqramı bağlayın.
  2. `data` qovluğunu kənara köçürün.
  3. Nüsxəni boş `data` qovluğuna `meyar-v3.sqlite` adı ilə qoyun.

## Server rejiminə yol

Domain və application qatları Electron-dan asılı deyil. Server versiyasında eyni `Ledger` PostgreSQL adapteri ilə işləyəcək: kompozit açarlar, RLS, eyni triggerlərin ekvivalentləri. SQLite faylının şəbəkə diskində paylaşılması dəstəklənmir.
