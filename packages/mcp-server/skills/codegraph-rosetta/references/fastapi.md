# FastAPI — for developers coming from NestJS

Philosophically close to NestJS (typed, DI-flavored, OpenAPI-first) but built
from functions instead of classes. Your instincts about layering transfer; the
syntax for wiring does not.

## Concept translation

| Concept | NestJS | FastAPI | Where it lives here |
| ------- | ------ | ------- | ------------------- |
| App bootstrap | `main.ts` + `NestFactory` | `app = FastAPI()` + uvicorn | `main.py` / `app/main.py` |
| Module | `@Module()` | `APIRouter` — routers group endpoints and are mounted with `app.include_router(router, prefix="/orders")` | `app/routers/` or per-domain packages |
| Controller | controller class | a **module of route functions** on a shared router — no class | `routers/orders.py` |
| Route | `@Get(':id')` | `@router.get("/{id}")` decorator on a function | on each function |
| Route param / query / body | `@Param()`, `@Query()`, `@Body()` | function parameters: path params by name, Pydantic model = body, `Query()`/`Header()` defaults | function signatures |
| DTO + validation | DTO + class-validator | **Pydantic models** — validation, serialization, and OpenAPI schema in one; `response_model=` controls output shape | `schemas.py` |
| Service | `@Injectable()` | plain class or module of functions — convention only, not framework | `services/` if the repo has discipline |
| DI | constructor injection, container | **`Depends()`** — per-request function dependencies, resolved per call, cached within a request; no container, no singletons by default | dependency functions, often `deps.py` |
| Guard | `@UseGuards(JwtGuard)` | a dependency that raises `HTTPException(401)`: `user = Depends(get_current_user)`; router-level via `dependencies=[...]` | `deps.py` / `auth.py` |
| Middleware | `NestMiddleware` | `@app.middleware("http")` or Starlette middleware — global only | `main.py` |
| Interceptor | `NestInterceptor` | no direct equivalent — middleware, or wrap dependencies | — |
| Exception filter | `@Catch()` | `@app.exception_handler(MyError)` | `main.py` |
| Entity / ORM | `@Entity()` TypeORM | not included — SQLAlchemy (most common; look for `DeclarativeBase`), SQLModel, or Tortoise | `models.py` |
| Repository | `Repository<T>` | SQLAlchemy `Session` queries; repos are hand-rolled if present (often `crud.py`) | `crud.py` / `repositories/` |
| Config | `ConfigService` | `pydantic-settings` `BaseSettings` class reading env vars | `config.py` / `settings.py` |
| Background jobs | Bull queues | `BackgroundTasks` (fire-and-forget, in-process) for small stuff; Celery/ARQ/Dramatiq for real queues | check which one — big difference |
| Async | optional | **native and expected** — `async def` endpoints; blocking calls in async routes stall the event loop | everywhere |
| Tests | Jest + Testing module | `pytest` + `TestClient`/`httpx.AsyncClient`; override dependencies with `app.dependency_overrides[dep] = fake` | `tests/` |
| OpenAPI | `@nestjs/swagger` | **automatic** — `/docs` (Swagger UI) and `/openapi.json` for free | built in |

## Mental-model shifts

1. **`Depends()` is your whole DI system, inverted.** Dependencies are functions
   resolved per-request (great for auth, DB sessions), not singletons wired at
   startup. The dependency graph is in function signatures, not module metadata.
   `app.dependency_overrides` replaces Nest's testing-module provider swapping.
2. **Pydantic models are DTO + pipe + swagger decorator fused.** One class does
   validation, transformation, response shaping, and docs. Look at `schemas.py`
   before reading any endpoint — it's the API contract.
3. **The service layer is optional and often absent.** Small FastAPI apps put
   logic straight in route functions. Translate what's there; don't assume a
   `services/` directory exists.
4. **Async is load-bearing.** A synchronous DB call inside `async def` blocks
   every request. When debugging latency, check sync-in-async first — it's the
   framework's classic foot-gun and has no NestJS analogue.
5. **The ORM is a separate decision.** Session lifecycle (who opens/commits the
   SQLAlchemy session — usually a `Depends(get_db)` dependency) is the thing to
   understand before writing any data code.

## Read these files first

1. `main.py` — app creation, router mounting (your module tree), middleware.
2. `deps.py` / wherever `Depends` targets live — auth + DB session = the
   request skeleton.
3. `schemas.py` — the API contract.
4. `models.py` — the domain.
5. One router file end to end — the repo's layering style.
