# Spring Boot — for developers coming from NestJS

The easy one: NestJS copied Spring's architecture almost 1:1 (decorators ≈
annotations, same layering, same DI philosophy). Most concepts map directly;
the friction is Java/Kotlin tooling and configuration, not architecture.

## Concept translation

| Concept | NestJS | Spring Boot | Where it lives here |
| ------- | ------ | ----------- | ------------------- |
| App bootstrap | `main.ts` + `NestFactory` | `@SpringBootApplication` class + `main()` | `src/main/java/.../Application.java` |
| Module | `@Module()` | no direct unit — component scan finds everything under the base package; `@Configuration` classes group beans | package structure |
| Controller | `@Controller('orders')` | `@RestController` + `@RequestMapping("/orders")` | `controller/` package |
| Route | `@Get(':id')` | `@GetMapping("/{id}")` | on handler methods |
| Route param / query / body | `@Param()`, `@Query()`, `@Body()` | `@PathVariable`, `@RequestParam`, `@RequestBody` | handler signatures |
| Service | `@Injectable()` | `@Service` | `service/` package |
| DI | constructor injection | identical idiom — constructor injection (`final` fields; Lombok `@RequiredArgsConstructor` generates the constructor) | everywhere |
| Provider token / custom provider | `{ provide, useValue }` | `@Bean` methods in `@Configuration` classes | `config/` package |
| Entity | `@Entity()` (TypeORM) | `@Entity` (JPA/Hibernate) — same annotation, same idea | `entity/`/`model/` package |
| Repository | `Repository<T>` | `interface OrderRepository extends JpaRepository<Order, Long>` — Spring generates the implementation, incl. queries derived from method names (`findByStatusAndUserId`) | `repository/` package |
| DTO + validation | class-validator decorators | Bean Validation: `@Valid` + `@NotNull`/`@Size` on DTO fields (records, usually) | `dto/` package |
| Guard | `@UseGuards()` | Spring Security filter chain + `@PreAuthorize("hasRole('ADMIN')")` | `SecurityConfig`, method annotations |
| Middleware | `NestMiddleware` | servlet `Filter` / `HandlerInterceptor` | `config/` |
| Interceptor | `NestInterceptor` | `HandlerInterceptor` or AOP `@Aspect` | `config/`, `aspect/` |
| Exception filter | `@Catch()` | `@RestControllerAdvice` + `@ExceptionHandler` | `exception/` package |
| Pipe | `ParseUUIDPipe` | converters + `@Valid`; type conversion is mostly automatic | — |
| Config | `ConfigService` | `application.yml` + `@Value("${x}")` or type-safe `@ConfigurationProperties` classes | `src/main/resources/` |
| Background jobs | Bull queues | `@Scheduled(cron=…)` for cron; `@Async`; Spring Kafka/AMQP listeners (`@KafkaListener`, `@RabbitListener`) for queues | listener classes |
| Events (in-process) | `EventEmitter2` | `ApplicationEventPublisher` + `@EventListener` | — |
| Tests | Jest + Testing module | JUnit 5 + `@SpringBootTest` (full context) / `@WebMvcTest` (controller slice) + Mockito | `src/test/java/` |
| OpenAPI | `@nestjs/swagger` | `springdoc-openapi` — auto-generates from annotations | dependency in build file |

## Mental-model shifts

1. **Classpath scanning replaces module wiring.** There's no `imports:` array —
   any `@Component`/`@Service`/`@Repository` under the base package is
   auto-discovered. To find "the module", read the package tree, not a file.
2. **Repositories are interfaces you never implement.** `findByEmailAndActiveTrue`
   is parsed from the method NAME and turned into a query at runtime. Don't hunt
   for the implementation; it doesn't exist in the repo.
3. **Configuration is layered and magical**: `application.yml` <
   `application-{profile}.yml` < env vars < CLI args. When behavior differs per
   environment, check the active profile (`spring.profiles.active`) first.
4. **Spring Security is a filter chain, not per-route guards.** One
   `SecurityFilterChain` bean declares URL rules centrally; `@PreAuthorize` adds
   method-level checks. Read `SecurityConfig` before touching any endpoint.
5. **Hibernate is lazier than TypeORM.** Relations are LAZY by default; touching
   them outside a transaction throws `LazyInitializationException`, and the N+1
   problem hides behind innocent getters. Look for `@Transactional` boundaries
   and `fetch join` queries.
6. **Build tooling is half the learning curve**: `pom.xml` (Maven) or
   `build.gradle` is package.json + tsconfig + scripts in one. Lombok
   annotations (`@Getter`, `@Builder`, `@RequiredArgsConstructor`) generate the
   boilerplate you'd expect to read.

## Read these files first

1. `*Application.java` — base package = component-scan root.
2. `pom.xml`/`build.gradle` — the dependency story (which Spring starters).
3. `application.yml` — DB, profiles, ports, feature flags.
4. `SecurityConfig` (if present) — who can call what.
5. One controller → its service → its repository — the layering is the same as
   your NestJS muscle memory.
