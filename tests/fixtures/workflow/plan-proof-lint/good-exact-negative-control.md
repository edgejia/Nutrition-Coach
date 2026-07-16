<task type="auto">
  <name>Phase 99 exact per-item proof</name>
  <action>Prove every required marker and reject a missing marker counterexample.</action>
  <verify>
    <automated>
      node --import tsx --test tests/unit/plan-proof-lint.test.ts
      node --import tsx --test tests/unit/plan-proof-lint.test.ts
    </automated>
  </verify>
</task>
