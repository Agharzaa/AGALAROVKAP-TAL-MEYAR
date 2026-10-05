# Arxitektura

## Qatlar

| Qovluq                      | Məsuliyyət                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/domain`                | Təmiz uçot nüvəsi: pul, miqdar, hesab planı, müxabirləşmə qaydaları, orta maya. I/O yoxdur.            |
| `src/contracts`             | UI ↔ tətbiq müqaviləsi və runtime yoxlama (zod). Pul və miqdar onluq mətndir.                          |
| `src/application`           | Əmrlər və sorğular: tranzaksiya, idempotentlik, versiya, dövr, anbar xronologiyası, audit, hesabatlar. |
| `src/infrastructure/sqlite` | SQLite adapteri, versiyalı miqrasiyalar, tenant və dəyişməzlik triggerləri, backup.                    |
| `src/main`, `src/preload`   | Electron: tək pəncərə, IPC sərhədi, açılış backup-ı, bağlama qoruması.                                 |
| `src/renderer`              | React UI: iş sahəsi, modul və sənəd pəncərələri, dizayn sistemi.                                       |
| `tests/domain`              | Domain unit testləri.                                                                                  |
| `tests/integration`         | Real SQLite üzərində əmr və hesabat testləri.                                                          |
| `tests/ui`                  | jsdom-da React + real Ledger inteqrasiyası.                                                            |
| `scripts`                   | Real Electron sınağı (`electron-smoke.cjs`) və performans ölçməsi (`benchmark.mjs`).                   |

## Asılılıq qaydaları

- **UI:** bazaya birbaşa girmir. Yalnız `window.meyar` körpüsü ilə əmr və sorğu göndərir.
- **Əmrlər:** hamısı `Ledger.execute` vasitəsilə gedir. Hər əmr:
  1. sxemlə yoxlanılır;
  2. idempotentlik açarı ilə təkrara qarşı yoxlanılır;
  3. bir `BEGIN IMMEDIATE` tranzaksiyasında icra olunur.
- **Maliyyə yazılışları:** yalnız domain qaydalarının nəticəsidir (`postInvoice`, `postPayment`, `reverse`). Hər giriş `checkEntry` yoxlamasından keçir: balans, tərəflər, hesabın aktivliyi, tələb olunan analitika.
- **Hesabatlar:** jurnal və bağlantı reyestrindən oxunur, bir oxu tranzaksiyasında. Hesabat öz rəqəmlərini ayrıca saxlamır.

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

- **Yerləşmə:** `%APPDATA%/Meyar/data/meyar.sqlite`; nüsxələr `%APPDATA%/Meyar/backups`. Quraşdırma qovluğundan ayrıdır; uninstall məlumatı silmir.
- **Açılış nüsxəsi:** hər açılışda, miqrasiyadan əvvəl SQLite backup API ilə ardıcıl nüsxə götürülür.
- **Versiya qoruması:** daha yeni sxemli bazanı köhnə proqram açmır.
- **Əl ilə nüsxə:** Parametrlər bölməsindən istənilən qovluğa.
- **Bərpa:** test edilib — nüsxə canlı baza ilə eyni hesabatları qaytarır. Proqram daxilində bərpa pəncərəsi isə **hələ yoxdur**. Əl ilə bərpa qaydası:
  1. Proqramı bağlayın.
  2. `data` qovluğunu kənara köçürün.
  3. Nüsxəni boş `data` qovluğuna `meyar.sqlite` adı ilə qoyun.

## Server rejiminə yol

Domain və application qatları Electron-dan asılı deyil. Server versiyasında eyni `Ledger` PostgreSQL adapteri ilə işləyəcək: kompozit açarlar, RLS, eyni triggerlərin ekvivalentləri. SQLite faylının şəbəkə diskində paylaşılması dəstəklənmir.
