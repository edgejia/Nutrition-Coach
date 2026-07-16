<task type="auto">
  <name>Historical incomplete checkpoint proof</name>
  <action>Prove exactly three checkpoints and all result rows.</action>
  <verify>
    <automated>
      count=$(rg -c '^checkpoint:' artifact.md); test "$count" -le 3
      tail -n 1 artifact.md
    </automated>
  </verify>
</task>
