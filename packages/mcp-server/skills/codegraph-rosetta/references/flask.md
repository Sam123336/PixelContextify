# Flask — for developers coming from NestJS

The opposite philosophy: Flask ships a router and a request context, nothing
else. Every architectural decision NestJS made for you (DI, validation, ORM,
layering) is a per-project choice here — so the reference is the repo itself,
more than the framework.

## Concept translation

| Concept | NestJS | Flask | Where it lives here |
| ------- | ------ | ----- | ------------------- |
| App bootstrap | `NestFactory` | `app = Flask(__name__)`, often wrapped in an **app factory** `create_app()` | `app/__init__.py` |
| Module | `@Module()` | **Blueprint** — `bp = Blueprint('orders', __name__)`, registered with `app.register_blueprint(bp, url_prefix='/orders')` | per-domain packages |
| Controller | controller class | route functions on a blueprint | `views.py` / `routes.py` per blueprint |
| Route | `@Get(':id')` | `@bp.route('/<int:id>', methods=['GET'])` | on functions |
| Body / query access | `@Body()`, `@Query()` | the global-ish `request` proxy: `request.json`, `request.args` — no injection, imported | `from flask import request` |
| DTO + validation | class-validator | not included — marshmallow schemas, or hand-rolled `request.json[...]` checks; Pydantic if added | `schemas.py` if present |
| Service | `@Injectable()` | plain modules/classes if the repo bothered | varies |
| DI | container | **none** — imports and the `current_app` context | — |
| Guard | `@UseGuards()` | decorators: `@login_required` (Flask-Login) / `@jwt_required()` (Flask-JWT-Extended), or `bp.before_request` | on views |
| Middleware | `NestMiddleware` | `@app.before_request` / `@app.after_request` hooks; WSGI middleware for lower level | app factory |
| Exception filter | `@Catch()` | `@app.errorhandler(404)` / `errorhandler(MyError)` | app factory |
| Entity / ORM | `@Entity()` | Flask-SQLAlchemy `db.Model` (Active-Record-ish: `Order.query.filter_by(...)`) | `models.py` |
| Migrations | TypeORM migrations | Flask-Migrate (Alembic): `flask db migrate` / `flask db upgrade` | `migrations/` |
| Config | `ConfigService` | `app.config` dict loaded from a `Config` class / env | `config.py` |
| Background jobs | Bull | Celery (look for `celery_app`), or RQ | `tasks.py` |
| Tests | Jest | `pytest` + `app.test_client()` fixtures | `tests/`, `conftest.py` |
| OpenAPI | `@nestjs/swagger` | not included — flask-smorest/APIFlask if present, often absent entirely | — |

## Mental-model shifts

1. **Extensions ARE the framework.** Real Flask apps are Flask + Flask-SQLAlchemy
   + Flask-Migrate + Flask-Login/JWT + marshmallow + Celery. Read the
   `requirements.txt` extension list first — it tells you which "NestJS built-ins"
   this repo chose and which it went without.
2. **Context globals instead of injection.** `request`, `current_app`, `g`, and
   `session` are magic thread/request-local proxies you import. Nothing about a
   function's signature tells you its dependencies — you find them by reading
   the body. (`g` is the per-request stash, closest thing to request-scoped
   providers.)
3. **The app factory pattern is the composition root.** `create_app()` is where
   blueprints, extensions, and config get wired — the one place that resembles a
   NestJS root module. If the repo does NOT use a factory (module-level `app`),
   expect circular-import workarounds everywhere.
4. **No validation happens unless someone wrote it.** Never assume `request.json`
   was checked. When adding endpoints, match whatever validation idiom the repo
   already uses rather than importing your preferred one.
5. **Structure is convention, not enforcement.** Two Flask repos can be
   organized completely differently. Spend your first 20 minutes mapping THIS
   repo's layout; the table above only tells you the common names.

## Read these files first

1. `app/__init__.py` (`create_app`) — extension + blueprint wiring.
2. `requirements.txt` — which extensions define this app's architecture.
3. `config.py` — environments and secrets handling.
4. The largest blueprint's `views.py` + `models.py` — the house style.
5. `conftest.py` — how they fake the app for tests (their answer to DI overrides).
