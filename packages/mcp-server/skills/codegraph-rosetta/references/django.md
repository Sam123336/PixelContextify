# Django — for developers coming from NestJS

## Concept translation

| Concept | NestJS | Django | Where it lives here |
| ------- | ------ | ------ | ------------------- |
| App bootstrap | `main.ts` + `NestFactory` | `manage.py` / `wsgi.py` / `asgi.py` | project package dir |
| Module | `@Module()` class | an **app** (a package with `apps.py`), registered in `INSTALLED_APPS` | `settings.py` |
| Route declaration | `@Controller('x')` + `@Get()` | `urls.py` (`path('x/', view)`) — routing is centralized per app, not decorator-on-handler | `<app>/urls.py`, included from root `urls.py` |
| Controller | controller class methods | **view**: function (`def order_list(request)`) or class (`ListView`, DRF `ViewSet`) | `<app>/views.py` |
| Service | `@Injectable()` class | no built-in layer — logic lives in views, model methods ("fat models"), managers, or a hand-rolled `services.py` | varies — check what this repo does |
| DI | constructor injection, IoC container | **none.** Plain imports and module-level singletons | — |
| Entity | `@Entity()` / `@Table()` class | `models.Model` subclass (Active Record: the model IS the repository — `Order.objects.filter(...)`) | `<app>/models.py` |
| Repository | `Repository<T>` / custom | `Model.objects` (a **manager**); custom managers ≈ custom repositories | `models.py` |
| DTO + validation | DTO class + `class-validator` | DRF **Serializer** (or Django `Form`); Pydantic if using Django Ninja | `<app>/serializers.py` |
| Guard | `@UseGuards(JwtGuard)` | DRF `permission_classes = [IsAuthenticated]`; plain Django: `@login_required` decorator | on the view |
| Middleware | `NestMiddleware` | `MIDDLEWARE` list in settings — global only, no per-route middleware | `settings.py` |
| Interceptor | `NestInterceptor` | closest: middleware, or DRF renderer/pagination hooks; no direct equivalent | — |
| Exception filter | `@Catch()` filter | `handler404`/`handler500`, DRF `exception_handler` setting | root `urls.py` / settings |
| Pipe (transform/validate params) | `ParseUUIDPipe` etc. | URL converters in `path('x/<uuid:id>/')`; serializer validation | `urls.py` |
| Config | `@nestjs/config`, `ConfigService` | `settings.py` module (global import: `from django.conf import settings`) | `settings.py`, often split per-env |
| Background jobs | Bull/BullMQ queues | **Celery** (+ Redis/RabbitMQ broker) — look for `tasks.py`, `@shared_task` | `<app>/tasks.py`, `celery.py` |
| Migrations | TypeORM/sequelize migrations | generated per-app: `python manage.py makemigrations` / `migrate` | `<app>/migrations/` |
| Tests | Jest + `@nestjs/testing` | `pytest` + `pytest-django`, or unittest `TestCase` | `<app>/tests.py` or `tests/` |
| OpenAPI | `@nestjs/swagger` decorators | `drf-spectacular` / `drf-yasg` (DRF), automatic in Django Ninja | settings + decorators |

## Mental-model shifts (the ones that actually bite)

1. **There is no DI container.** Nothing is injected; everything is imported.
   Testability comes from monkeypatching (`unittest.mock.patch`) instead of
   swapping providers. Stop looking for the composition root — `INSTALLED_APPS`
   is the closest thing.
2. **Active Record, not Data Mapper.** The model class is entity + repository +
   query builder in one: `Order.objects.filter(status='paid')`. There's no
   separate repository to inject; queries are legal anywhere, which is why
   discipline about *where* queries happen varies wildly per repo.
3. **Routing is centralized, not decorated.** To find what handles a URL, start
   from root `urls.py` and follow `include()` chains — never grep for the path
   on the handler.
4. **Fat models / thin views is the native idiom.** If you look for a services
   layer and find none, business logic is probably on model methods and
   managers. Don't refactor it to Nest-style layers uninvited.
5. **`settings.py` is global mutable-ish config imported from anywhere** — the
   opposite of scoped `ConfigService` injection. Env-specific behavior is
   usually settings modules (`settings/prod.py`) or `django-environ`.

## Read these files first

1. Root `urls.py` — the route table (your controller inventory).
2. `settings.py` — `INSTALLED_APPS` (module list), `MIDDLEWARE`, database, auth.
3. The biggest app's `models.py` — the domain.
4. Same app's `views.py` + `serializers.py` — request handling style (DRF
   ViewSets? function views?).
5. `tasks.py` / `celery.py` if present — the async story.
