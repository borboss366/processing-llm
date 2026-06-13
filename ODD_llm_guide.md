# ODD (Ontology-Driven Development) — LLM Execution Guide

You are executing the ODD pipeline: generating code from a domain ontology
with automated verification. Follow these steps exactly.

## Step 0: System Classification

Ask the expert what type of system they're building. Classify:
- Sequential (single actor) → Layers 1 + 2 + cross-cutting (composition_rules, known_limitations)
- Concurrent (shared-memory threads) → Layers 1 + 2 + 3 + cross-cutting
- Message-passing (actors, channels) → Layers 1 + 2 + 3 + cross-cutting (use Scribble if possible)
- Distributed (network) → Layers 1 + 2 + 3 + cross-cutting (Layer 3 critical)
- Embedded/RT → Layers 1 + 2 + 3 + cross-cutting + timing constraints
- Hybrid → layer formalisms by boundary

## Step 1: Generate Ontology v1

Generate SQL tables. BEFORE generating entities, define the PUBLIC CONTRACT:
- What is the public API? (method signatures)
- What goes in? (types, validation, preconditions)
- What comes out? (return type — raw or wrapper? ordering?)
- What happens on failure? (exception types, partial results?)
- What is the lifecycle? (create → use → shutdown)

Then generate these tables:

### Layer 1: Domain

```sql
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    provenance TEXT NOT NULL CHECK(provenance IN ('doc','code','analogy','expert'))
);

CREATE TABLE invariants (
    id TEXT PRIMARY KEY,
    entity_id TEXT REFERENCES entities(id),
    rule TEXT NOT NULL,
    provenance TEXT NOT NULL CHECK(provenance IN ('doc','code','analogy','expert')),
    confidence_note TEXT
);

CREATE TABLE states (
    id TEXT PRIMARY KEY,
    entity_id TEXT REFERENCES entities(id),
    name TEXT NOT NULL,
    description TEXT
);

CREATE TABLE transitions (
    id TEXT PRIMARY KEY,
    from_state TEXT REFERENCES states(id),
    to_state TEXT REFERENCES states(id),
    trigger TEXT NOT NULL,
    guard TEXT,
    provenance TEXT NOT NULL CHECK(provenance IN ('doc','code','analogy','expert'))
);
```

### Layer 2: Implementation Constraints

```sql
CREATE TABLE impl_constraints (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK(category IN ('safety','efficiency','structure','configurability','temporal')),
    rule TEXT NOT NULL,
    rationale TEXT,
    test_strategy TEXT
);
```

Rules MUST be **principles**, not API blacklists.
- BAD: "Don't use Thread#kill"
- GOOD: "Never interrupt a thread asynchronously — by any mechanism"

### Layer 3: Interaction Protocols (concurrent/distributed only)

```sql
CREATE TABLE actors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    lifecycle TEXT
);

CREATE TABLE interaction_protocols (
    id TEXT PRIMARY KEY,
    actor_from TEXT REFERENCES actors(id),
    actor_to TEXT REFERENCES actors(id),
    rule TEXT NOT NULL,
    consequence TEXT  -- what breaks if violated
);
```

### Composition Rules and Known Limitations (all system types)

These tables are needed regardless of system type — invariants can conflict
and design decisions have trade-offs even in sequential systems.

```sql
CREATE TABLE composition_rules (
    id TEXT PRIMARY KEY,
    invariants TEXT NOT NULL,  -- comma-separated ids that interact
    rule TEXT NOT NULL,
    resolution TEXT
);

CREATE TABLE known_limitations (
    id TEXT PRIMARY KEY,
    caused_by TEXT,
    description TEXT NOT NULL,
    mitigation TEXT
);
```

**composition_rules:** document how invariants interact when they conflict.
Example (sequential): `inv_max_size` limits allocation, but `inv_bulk_binary_safe`
promises to accept any bytes — resolution: reject at length parsing, before
payload is read.

**known_limitations:** document unavoidable trade-offs and accepted risks.
Example (sequential): "buffer grows unboundedly if input never contains CRLF;
mitigated by `inv_max_inline_length`."

### Provenance Rules

Mark every invariant:
- `doc` — from documentation, standards, specs
- `code` — from common patterns in the language/framework
- `analogy` — YOUR inference. Flag with NEEDS REVIEW
- `expert` — confirmed by the human expert

Generate **probe questions** for every `analogy` invariant. Probes must be
intentionally provocative — plausible but likely wrong, designed to force
the expert to correct them and verbalize tacit knowledge.

Good probe: sounds reasonable but is wrong in a way that forces explanation.
Bad probe: obviously correct (expert says "yes", nothing learned) or absurd.

## Step 2: Expert Answers Probes

Present probes to expert. Each answer either:
- Migrates invariant from `analogy` → `expert`
- Removes the invariant
- Creates NEW invariants the model never considered

## Step 2.5: Counter-Probes (Model Self-Assessment)

After all probes answered, the MODEL answers these questions about ITSELF
(do NOT ask these to the expert — YOU answer them):

1. "What aspects of the domain did I fail to ask about? List specific gaps."
2. "Which expert answer surprised me most and why — what reasoning did I miss?"
3. "What one invariant would I add? Write it as a SQL INSERT statement."

You MUST provide CONCRETE answers — specific missing invariants, specific
blind spots, specific reasoning gaps. If your blind spot list is empty,
that itself is a red flag.

This step exists because your probe questions define a frame, and experts
work within that frame. You must look outside your own frame for what
you missed.

## Step 3: Expert Reviews Ontology

Expert reads full ontology. Common gaps to watch for:
- Result/return semantics (what does the operation return?)
- Error handling policy
- Lifecycle (init, cleanup, shutdown)
- Edge cases you consider "obvious"

## Step 3.5: Ontology Self-Verification

The ontology is SQL — USE it as SQL, not just as documentation.
Load the ontology into SQLite **:memory:** and run verification queries.

Use `:memory:` — not a file. This gives you:
- **Atomicity:** SQL syntax error = immediate failure, no stale data
- **Single source of truth:** the `.sql` file IS the ontology, DB is ephemeral
- **Idempotency:** every run starts clean, no migrations or DROP IF EXISTS

```sql
-- Load: sqlite3 :memory: < ontology.sql, then run:

-- 1. Any unreviewed invariants remaining?
SELECT id, rule FROM invariants WHERE provenance = 'analogy';

-- 2. Orphan entities (no invariants reference them)?
SELECT e.id, e.name FROM entities e
WHERE e.id NOT IN (SELECT entity_id FROM invariants);

-- 3. composition_rules reference valid invariant ids?
--    (manual check — parse the comma-separated invariants field)
SELECT id, invariants FROM composition_rules;

-- 4. known_limitations reference valid caused_by?
SELECT id, caused_by FROM known_limitations;

-- 5. Provenance distribution — how much is expert-confirmed?
SELECT provenance, count(*) FROM invariants GROUP BY provenance;

-- 6. Any states with no inbound or outbound transitions?
SELECT s.id FROM states s
WHERE s.id NOT IN (SELECT from_state FROM transitions)
  AND s.id NOT IN (SELECT to_state FROM transitions);
```

**Fix any issues found before proceeding to test generation.**
Report query results to the expert if anything is unexpected.

This step also runs **after every ontology update** in the iteration loop
(Step 8) — not just on the first pass.

## Step 4: Generate Tests

Generate tests from ALL invariants, impl_constraints, and interaction_protocols.

Rules:
- Each test MUST reference its source invariant in a comment
- Include **behavioral tests** for domain invariants
- Include **structural source analysis tests** for impl_constraints
  (examples in Ruby; adapt the grep-source pattern to your language):

```ruby
# Example: verify principle ic_no_async_interrupt
def test_source_no_async_interruption
  source = File.read("implementation.rb", encoding: "utf-8")
  refute_match(/\.kill\b/, source, "Thread#kill")
  refute_match(/Timeout\.timeout/, source, "Timeout.timeout")
end

# Example: verify interaction protocol ip_worker_sole_writer
def test_no_fill_remaining
  source = File.read("implementation.rb", encoding: "utf-8")
  refute_match(/fill_remaining/, source, "Only workers write result slots")
end
```

In Node.js/vitest, the same pattern uses `readFileSync` + `expect(source).not.toMatch()`.

- Include **stress tests** for thread safety (high contention, many iterations)
- Include **edge cases** (empty input, single item, etc.)

After generating tests, verify coverage by extracting invariant references
from test comments and comparing against the ontology:

```sql
-- Which invariants have no test? (compare against grep of test file)
SELECT id FROM invariants
WHERE id NOT IN (/* ids found in test comments */);

SELECT id FROM impl_constraints
WHERE id NOT IN (/* ids found in test comments */);
```

Report any uncovered invariants to the expert before proceeding.

## Step 5: Expert Reviews Tests

Present tests to expert. Key question: do tests translate invariants correctly?
Are they testing behavior or implementation details?

## Step 6: Generate Implementation

Implement to pass all tests. Do not use any pattern prohibited by
impl_constraints. Respect all interaction protocols.

## Step 7: Self-Review

Review the code as a senior engineer in the target language. Look for:
- Race conditions, resource leaks
- Antipatterns the tests don't cover
- Edge cases
- Idiomatic issues
- Violations of impl_constraint principles that bypass specific test patterns

This step runs AFTER EVERY implementation, not just once.

## Step 8: Iterate

Route each finding to the correct ontology layer:

| Finding type | Update target |
|--------------|---------------|
| Missing behavior / wrong contract | Layer 1: domain invariant |
| Dangerous pattern / code smell | Layer 2: impl_constraint (as principle!) |
| Race condition / ordering bug | Layer 3: interaction protocol |
| Two invariants conflict | composition_rules |
| Unavoidable trade-off | known_limitations |

Regenerate tests → regenerate implementation → self-review → repeat.

**Expected iterations:** 2-6 depending on domain complexity, not system type.
Protocol-rich domains (parsers, state machines) may need more iterations than
architecturally complex but domain-simple systems (thread pools, game servers).

## Failure Criteria

- >8 iterations with new findings → wrong system classification or missing layer
- Same category of issue repeating → impl_constraint is blacklist, not principle
- Tests pass but expert uneasy → missing domain invariant, do more probes
- Code "technically correct" but architecturally wrong → add structural quality constraints

## Critical Rules

1. Contract BEFORE entities — define inputs/outputs/failures first
2. Principles OVER blacklists — prohibit behaviors, not APIs
3. Provenance on everything — never present `analogy` as `expert`
4. Structural tests — verify HOW code is written, not just WHAT it does
5. Expert works on ontology, never on code — that's the whole point
6. Known limitations are features, not bugs — document trade-offs explicitly
7. For concurrent systems: define actors and happens-before rules, not just states
8. SQL is executable — LOAD the ontology and QUERY it for consistency, don't just write INSERT statements

---

*This guide has been validated on: concurrent shared-memory (Ruby ParallelExecutor,
3 iterations with guide), sequential stateful (Ruby RESP parser, 4 iterations),
distributed message-passing (Node.js networked tic-tac-toe, 2 iterations).
All reached zero self-review findings with production-quality code. The guide
required no changes for Experiment C — methodology converged after Experiments A and B.*
