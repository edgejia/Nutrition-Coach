<task type="auto">
  <name>Node proof grammar escapes</name>
  <verify>
    node --test tests/unit/example.test.ts /tmp/mutator.mjs
    node tests/unit/example.test.ts --test
    node --test --test-reporter=spec tests/unit/example.test.ts
    node --trace-event-categories=node tests/unit/example.test.ts
    node scripts/workflow/assert-count.mjs --fix
  </verify>
</task>
