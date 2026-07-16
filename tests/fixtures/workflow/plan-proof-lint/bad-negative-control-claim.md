<task type="auto">
  <name>Historical production restore negative-control prose</name>
  <action>Validate the production restore contract. Negative control: none.</action>
  <verify>
    <automated>
      node scripts/workflow/recovery-contract-check.mjs --mode=static
      echo --negative-control=claimed-but-not-executed
    </automated>
  </verify>
</task>
