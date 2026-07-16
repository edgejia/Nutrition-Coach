<task type="auto">
  <name>Safe production recovery contract proof</name>
  <action>Statically validate the production restore guard and its expected failure counterexample.</action>
  <verify>
    <automated>
      node --import tsx --test tests/integration/production-recovery-rehearsal.test.ts
    </automated>
  </verify>
</task>
