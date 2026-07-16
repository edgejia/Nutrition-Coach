<task type="auto">
  <name>Historical unrelated exact assertion suppression</name>
  <action>Prove both independent result sets are complete.</action>
  <verify>
    <automated>
      node scripts/workflow/assert-count.mjs --exact=2 --set=first
      test "$second_count" -le 3
    </automated>
  </verify>
</task>
