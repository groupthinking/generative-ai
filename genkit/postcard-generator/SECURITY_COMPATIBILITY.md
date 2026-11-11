# Security and Genkit compatibility

Next 15.5.28, Sharp 0.35.5 and PostCSS 8.5.23 are resolved and validated on Node 22. The Genkit packages are aligned on 1.0.4 because the previous manifest required Genkit 1 while its lock resolved 0.9.12. The source uses the Genkit 1 instance, prompt and response APIs; authentication is checked before model execution and lazy telemetry startup. Image/text generation and map prompt behavior remain covered by the flow tests. Firebase server headers are awaited for Next15.

The scoped Jaeger 2.9 propagator override fixes malformed-percent header handling while retaining the existing OpenTelemetry 1 NodeTracerProvider. Actual provider injection/extraction, baggage handling and malformed headers are covered by the regression test. The optional Winston transport build warning remains visible.

## Developer runtime and ZIP dependency repair

The former `npx genkit@latest start` command fails because `genkit` is a runtime library without an executable. The repaired command uses exact `genkit-cli 1.45.0` and `tsx 4.23.15` pins and imports the existing flow module. The runtime, core, Vertex AI, Google Cloud and Ollama packages remain aligned at 1.0.4. The CLI and runtime have separate release versions; actual HTTP discovery and execution through the CLI's RuntimeManager pass the regression tests. This demonstrates the tested integration, not an upstream guarantee for every CLI feature. The original `gemini-2.0-flash` prompt model is explicitly registered through Vertex AI's supported `models` option, without replacing the selected model.

CLI 1.45.0 removes the `extract-zip` dependency introduced by 1.44.1. The complete frozen lock and installed dependency tree no longer contain it. The two high symlink traversal advisories [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) and [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3) are absent from the refreshed audit. Comparing the previous patched-Next candidate and this candidate against the same current advisory service removes those two advisory IDs and adds no new advisory IDs.

The actual UI asset downloader still uses `adm-zip 0.6.1`. Tools-common 1.45.0 now declares `^0.6.1` itself, so the previous scoped override outside its declared 0.5 range is removed. Tests execute the real downloader's cached archive extraction, verify a preexisting symlink cannot overwrite an external file, and exercise malformed compressed input error handling. All three assertions remain intact.

## Zod 4 migration

The postcard lock now resolves official Zod **4.6.7** and `@asteasolutions/zod-to-openapi` **9.1.0**. Genkit runtime 1.0.4 and CLI 1.45.0 are retained. A bare Zod major-version override is insufficient: it breaks legacy function schemas, single-argument records, optional `any`/`unknown` properties and JSON-schema conversion. The migration implements those compatibility boundaries explicitly while using Zod 4 for validation.

`npm ci` runs `scripts/prepare-genkit-zod4.cjs`. Its manifest restricts the migration to 69 reviewed files in four pinned Genkit packages. It verifies every upstream file and every planned replacement before writing, verifies saved results, and accepts an already applied migration. An upstream version or content change fails installation and requires a new review. Production installations that omit the CLI still apply the ten required core changes. The script does not modify package versions, suppress audit findings or change a global module loader.

The scoped adapter preserves missing-value and partial-record behavior. The two CLI callback migrations validate arguments and return values, including asynchronous hooks. The native JSON-schema converter retains descriptions and the existing BigInt/Set JSON representations, including set size limits; unsupported types fail instead of becoming unrestricted schemas. The OpenAPI generator is upgraded with an actual reflection-document regression. Original application source, selected models, authentication ordering, Maps/image/story behavior, telemetry, CLI routing and ZIP extraction remain intact.

Local validation on **2026-11-11 UTC**, Node 22.23.4 / npm 10.9.9:

- Clean frozen installation, full `npm ls --all`, TypeScript, lint and the four-page production build pass.
- All **19 tests** pass: the existing 11 tests plus eight migration regressions covering all 385 exported application/CLI schemas, nested invalid responses, constrained collection early termination, callbacks, evaluator configuration, OpenAPI generation and installation safeguards.
- A separate comparison against the actual previous Zod 3 installation checks **22,168 input cases across 385 exported schemas**. Both direct validation and generated JSON-schema validation agree for every case, including valid and invalid inputs. This is observed coverage of those cases, not a guarantee for all possible inputs.
- The unchanged full `npm audit --audit-level=high` exits **0** with **0 critical / 0 high / 77 moderate / 1 low** affected package records. Moderate and low findings remain; development dependencies are included.

Hosted checks for the published migration remain a separate requirement. Local results do not establish live provider availability, deployment, an independent review or merge readiness.

## Historical Zod security hold

Before the Zod 4 migration, full security approval was blocked by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). The previous lock resolved Zod 3.25.76 for runtime Genkit/OpenAI and Zod 3.25.67 for CLI 1.45.0, tools-common and telemetry-server. Genkit core 1.44.0, inspected on 2026-11-10, still declares Zod 3. The earlier repair retained Zod 3 because a bare Zod 4 override changed Genkit's schema API and JSON-schema translation contract.

The complete audits on 2026-11-03 report the following package records. The production-only columns are supplementary diagnostics; the full audit remains the security gate.

| Candidate | Full: critical / high / moderate | Production only: critical / high / moderate |
| --- | --- | --- |
| Previous patched-Next candidate, CLI 1.44.1 | 0 / 8 / 86 | 0 / 3 / 67 |
| November 3 patched-Next candidate, CLI 1.45.0 | 0 / 10 / 84 | 0 / 5 / 65 |
| November 3 older-Next prerequisite (historical) | 1 / 12 / 84 | 1 / 7 / 65 |

All six historical audits have zero low findings. These are package records, including propagated parent findings, rather than counts of independent vulnerabilities. Although the ZIP advisories are removed, the full high-package count increases: `@genkit-ai/ai`, `genkit` and the CLI's nested `zod-to-json-schema` are reported as high through the existing Zod advisory, while the `extract-zip` high record is removed. The earlier initial CLI repair had reported 8 high and 63 moderate findings, versus 3 high and 63 moderate before that developer repair. None of these counts establishes security closure. Those historical candidates did not exclude development dependencies, remove developer features or force a Zod 4 override.

The preexisting gRPC override mismatch is corrected with an override scoped to the cloud trace exporter, matching its already installed 1.14.6. The existing global 1.13.6 override remains for the Firebase consumer. That earlier declaration repair left its lockfile and runtime versions unchanged. A clean frozen install and the full `npm ls --all` check passed on both historical candidates. It did not fix their Zod audit findings or establish security readiness.

The postcard-only advisory exception introduced on November 5 is removed. Every application and the browser tools now use the same plain `npm audit --audit-level=high` gate, including development dependencies, with no allowlist. Passing application tests did not waive the Zod finding; the current migration must also pass that unchanged audit gate.

## Historical validation and continuing limits

On November 10, the review repairs pass all 11 postcard tests, TypeScript, lint and a complete four-page production build on Node 22.23.4 / npm 10.9.9. The new telemetry regression first reproduced a permanently cached rejection, then verified shared concurrent attempts, retry after failure and caching after success. Existing flow, authentication, runtime discovery/execution, Jaeger and ZIP assertions remain intact. A local service occupied the IPv6 default reflection port on the validation Mac; the initial runtime tests failed. Running the unchanged tests with IPv4-first Node resolution passed all 11 tests. This environment adjustment is local and is not an application or workflow change. Dependencies were reused from an installation with byte-identical manifest and lock files; a fresh hosted install remains a separate check.

The full November 10 postcard audit exits with failure and reports 0 critical, 10 high, 73 moderate and 0 low affected package records. The unchanged high-severity gate therefore remains blocking. These counts are a dated observation, not a waiver or a claim that no other security issues exist.

On November 3, using Node 22.23.4 with npm 10.9.9, both postcard variants passed frozen installation without manifest/lock changes, all 10 tests, TypeScript, lint, a complete four-page production build and actual PNG optimization at their respective frozen Next/Sharp versions. The initial production builds failed in Next's Google Fonts URL parser; one unchanged retry per candidate passed. No font substitution, mocked font response, skipped build or application change was used to obtain that result. These are historical receipts, not validation of later changes.

The tests use real Genkit schemas, plugins, prompts, reflection and CLI routing, with controlled external provider adapters and temporary CLI settings. They verify authentication ordering, input rejection before adapters, selected models, Maps/prompt/image output, Jaeger handling and ZIP safety. They do not prove downloaded UI rendering, live Maps/Vertex AI/Ollama availability, model quality, cloud authentication or production deployment.

The original Next-only scope finding was resolved by reviewing the seven-file Next closure in separate PR #106. That PR was merged into #109 on November 6. This branch now contains Next 15.5.28 in all three applications: autocal, postcard and wealth. It is no longer an older-Next prerequisite. Publication of the migration must be followed by current hosted validation; neither these historical receipts nor local migration tests authorize a merge or deployment.
