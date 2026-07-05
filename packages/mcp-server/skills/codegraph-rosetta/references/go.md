# Go backends — for developers coming from NestJS

The biggest philosophical jump: Go rejects framework magic entirely. No
decorators, no DI container, no ORM by default, no exceptions. Everything NestJS
does implicitly is explicit code you can read — which is disorienting for a day
and then genuinely pleasant. First identify the router (`go.mod` tells you:
chi, gin, echo, fiber, gorilla/mux, or plain `net/http`).

## Concept translation

| Concept | NestJS | Go | Where it lives here |
| ------- | ------ | -- | ------------------- |
| App bootstrap | `NestFactory` | `func main()` — literally constructs everything and calls `http.ListenAndServe` | `cmd/<name>/main.go` |
| Module | `@Module()` | a **package** (directory); `internal/` = not importable from outside | directory tree |
| Controller | `@Controller()` class | **handler** funcs/methods: `func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request)` (gin: `func (h) Create(c *gin.Context)`) | `internal/handler/` / `api/` |
| Route declaration | decorators | explicit registration: `r.Post("/orders", h.Create)` (chi) / `r.POST("/orders", h.Create)` (gin) — one place lists every route | `routes.go` / router setup in `main.go` |
| Service | `@Injectable()` | plain struct + methods; contract expressed as an **interface** where substitution matters | `internal/service/` |
| DI | IoC container | **manual wiring in main()**: `repo := postgres.NewOrderRepo(db); svc := service.NewOrderService(repo); h := handler.New(svc)` — the whole graph, in order, readable. (google/wire or fx if the repo got fancy) | `main.go` |
| Entity | `@Entity()` | plain struct with tags: `` `json:"id" db:"id"` `` — tags do what decorators did | `internal/model/` / `domain/` |
| Repository | `Repository<T>` | interface (`OrderRepo interface { GetByID(ctx, id) }`) + concrete impl with hand-written SQL (`database/sql`, sqlx, pgx, sqlc-generated) or GORM | `internal/repo/` / `store/` |
| DTO + validation | class-validator | request structs + `go-playground/validator` tags (`validate:"required,email"`), called explicitly | handler package |
| Guard / middleware / interceptor | three concepts | **one concept: middleware** — `func(next http.Handler) http.Handler` wrapping the chain; auth guard = middleware that rejects | `internal/middleware/` |
| Exception filter | `@Catch()` | **there are no exceptions.** Every fallible call returns `err`; handlers map errors to status codes explicitly (often one `respondError` helper or an error-wrapping middleware) | look for the error-response helper |
| Pipe | `ParsePipe` | manual: `strconv.Atoi(chi.URLParam(r, "id"))` | in handlers |
| Config | `ConfigService` | env vars via `os.Getenv`, envconfig, or viper; a `Config` struct built in main | `internal/config/` |
| Background jobs | Bull | **goroutines + channels** for in-process; asynq/machinery/river for Redis-backed queues; `select` + `time.Ticker` for cron | worker packages, or a separate `cmd/worker` binary |
| Events/queues | RabbitMQ module | explicit client libs (segmentio/kafka-go, amqp091-go) — consumers are just goroutines in main | `cmd/` or `internal/consumer/` |
| Tests | Jest | `testing` package, table-driven tests, interfaces + hand-rolled fakes (or gomock/testify) | `_test.go` next to the code |
| OpenAPI | `@nestjs/swagger` | not automatic — swaggo comments, oapi-codegen (spec-first), or absent | check for `docs/` or codegen |

## Mental-model shifts

1. **`main.go` is the composition root, written by hand.** Everything you'd
   learn from Nest module metadata, you learn by reading main() top to bottom.
   Read it FIRST — it's the architecture diagram.
2. **Errors are values.** `if err != nil { return fmt.Errorf("creating order: %w", err) }`
   is the idiom, not noise. There is no throw; nothing propagates unless the
   code passes it up. Find where errors become HTTP status codes — that's the
   repo's "exception filter".
3. **Interfaces are satisfied implicitly and defined by the CONSUMER.** The
   service defines the `OrderRepo` interface it needs; the postgres package
   happens to satisfy it. To find implementations, grep for the method
   signatures, not `implements`.
4. **`context.Context` is the request scope.** First parameter of nearly every
   function: carries deadlines, cancellation, auth claims. It's what request-
   scoped providers were in Nest.
5. **Concurrency is a language feature, not a queue library.** A goroutine +
   channel might be doing what BullMQ did in your stack — cheap to spawn but
   in-process and lost on crash. Check whether "background work" here is durable
   (Redis-backed lib) or best-effort (bare goroutine) before relying on it.
6. **Struct tags are the decorator replacement** — json/db/validate behavior is
   in backtick strings on fields, and typos in them fail silently. Read them.

## Read these files first

1. `cmd/*/main.go` — composition root; note every constructor call.
2. `go.mod` — router, DB layer, queue libs (the framework this repo assembled).
3. The route registration file — complete endpoint inventory in one place.
4. One handler → service → repo chain — layering matches your Nest instincts.
5. `Makefile` / `docker-compose.yml` — how it actually runs.
