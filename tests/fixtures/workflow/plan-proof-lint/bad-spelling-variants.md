<task type="auto">
  <name>Storage proof spelling variants</name>
  <action>Prove exact storage cardinality and inspect complete evidence.</action>
  <verify>
    <automated>
      head -1 evidence.md
      head --lines=1 evidence.md
      test "${count}" -le 3
      [[ "$n" -le 3 ]]
    </automated>
  </verify>
</task>
