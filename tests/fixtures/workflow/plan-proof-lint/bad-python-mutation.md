<task type="auto">
  <name>Historical non-Node mutation bypass</name>
  <action>Inspect accepted planning evidence without changing it.</action>
  <verify>
    <automated>
      python -c "open('.planning/STATE.md', 'w').write('forged')"
    </automated>
  </verify>
</task>
