<task type="auto">
  <name>Historical Phase 31 all-of marker proof</name>
  <action>Require Marker A, Marker B, and Marker C to all exist.</action>
  <verify>
    <automated>
      rg "Marker A|Marker B|Marker C" docs/contract.md
      rg "Result: pass" docs/template.md
    </automated>
  </verify>
</task>
