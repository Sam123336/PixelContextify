# Rust backends — for developers coming from NestJS

Two learning curves at once: the web layer (small, learnable in a day) and the
ownership system (the real cost, weeks). The good news: the compiler enforces
what NestJS left to discipline — if it compiles, whole classes of bugs are
gone. Identify the framework from `Cargo.toml`: **axum** (most common now),
**actix-web**, or rocket/warp; and the DB layer: **sqlx** (raw SQL, checked at
compile time), **diesel** (ORM), or **sea-orm** (closest to TypeORM).

## Concept translation

| Concept | NestJS | Rust (axum idioms; actix in parens) | Where it lives here |
| ------- | ------ | ------------------------------------ | ------------------- |
| App bootstrap | `NestFactory` | `#[tokio::main] async fn main()` — builds router + state, binds listener | `src/main.rs` |
| Module | `@Module()` | a **module** (`mod orders;` → `src/orders/` or `orders.rs`); visibility via `pub` | module tree from `main.rs`/`lib.rs` |
| Controller | controller class | handler functions grouped in a module; routers composed with `Router::nest("/orders", orders::router())` (actix: `web::scope("/orders")`) | `src/routes/` / per-domain mods |
| Route | `@Get(':id')` | explicit: `Router::new().route("/{id}", get(get_order))` (actix uses `#[get("/{id}")]` attribute macros — decorator-like) | router functions |
| Param / body extraction | `@Param()`, `@Body()` | **extractors** in the handler signature: `Path<Uuid>`, `Query<Params>`, `Json<CreateOrder>`, `State<AppState>` — closest thing to Nest's parameter decorators | handler signatures |
| DTO + validation | class-validator | structs with `#[derive(Deserialize)]` (serde); validation via `validator` crate derive or manual — NOT automatic beyond types | `dto.rs` / inline |
| Service | `@Injectable()` | plain struct + `impl`; trait when substitution needed | `src/service/` |
| DI | IoC container | **none** — dependencies built in main, shared as `State<Arc<AppState>>` (actix: `web::Data<T>`); AppState holds pool + services | `main.rs` + `state.rs` |
| Entity | `@Entity()` | struct with `#[derive(sqlx::FromRow)]` / diesel schema macros / sea-orm entity derive | `src/models/` / `entity/` |
| Repository | `Repository<T>` | functions/struct over a `PgPool`; sqlx `query_as!` macros are **compile-time checked against the live DB schema** | `src/repo/` |
| Guard | `@UseGuards()` | middleware (tower `Layer` in axum) or a custom **extractor** that rejects — `AuthUser` as a handler parameter IS the guard | `middleware.rs` / `auth.rs` |
| Middleware / interceptor | separate concepts | one concept: tower layers (axum) / actix middleware — logging, CORS, timeouts are `ServiceBuilder` layers | router setup |
| Exception filter | `@Catch()` | **`Result<T, AppError>` + `impl IntoResponse for AppError`** — one central error enum maps every failure to a status code; `?` propagates | `error.rs` — read this file, it's the whole error story |
| Config | `ConfigService` | env vars via `dotenvy` + a `Config` struct (`figment`/`config` crates if fancier) | `config.rs` |
| Background jobs | Bull | `tokio::spawn` for in-process; sidekiq-rs/apalis/faktory for durable queues; cron via `tokio_cron_scheduler` | worker mods or separate binary |
| Async runtime | Node event loop (built in) | **tokio** — explicit dependency; `.await` everywhere; blocking calls need `spawn_blocking` | — |
| Tests | Jest | `#[cfg(test)] mod tests` inline + `tests/` for integration; `tower::ServiceExt::oneshot` to call the router without a socket | next to code |
| OpenAPI | `@nestjs/swagger` | `utoipa` derive macros if present; often absent | check Cargo.toml |

## Mental-model shifts

1. **The type system replaces the framework.** Extractors, `Result`, and traits
   do what guards, filters, and pipes did — but errors surface at compile time.
   Expect to fight the compiler for a week; it is telling you real things.
2. **Ownership shapes the architecture.** Shared state must be `Arc<...>`
   (thread-safe reference counting); mutation needs `Mutex`/`RwLock` or a
   database. "Just store it on the class" doesn't exist. This is why AppState
   looks the way it does.
3. **`error.rs` is the exception-filter, centralized and explicit.** One enum,
   one `IntoResponse` impl, and every handler returns `Result<Json<T>, AppError>`.
   The `?` operator is your exception propagation. Read it before any handler.
4. **sqlx checks your SQL against the actual database at compile time**
   (`query_as!` macros need `DATABASE_URL` or offline metadata at build). Failing
   builds after a schema change is the feature working.
5. **No reflection, no runtime wiring.** Everything a request touches is
   reachable by ctrl-clicking from `main.rs`. Slower to write than Nest;
   dramatically easier to trace.
6. **Async is colored and explicit.** Handlers are `async fn`; calling blocking
   code (heavy CPU, sync IO) without `spawn_blocking` stalls the tokio worker —
   same foot-gun as FastAPI, same fix.

## Read these files first

1. `Cargo.toml` — framework, DB layer, runtime (the stack definition).
2. `src/main.rs` — router composition + AppState construction (composition root).
3. `src/error.rs` — the entire error-handling contract.
4. One handler module end to end — extractor style, state access, layering.
5. `migrations/` + how sqlx/diesel is invoked — the schema workflow.
