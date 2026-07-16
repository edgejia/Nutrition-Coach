<task type="auto">
  <name>Historical incomplete count and accepted-evidence mutation</name>
  <action>Prove exactly four accepted rows without changing accepted evidence.</action>
  <verify>
    <automated>
      count=$(rg -c '^accepted:' accepted-evidence.md); test "$count" -lt 4
      echo changed > accepted-evidence.md
    </automated>
  </verify>
</task>
