<task type="auto">
  <name>All required markers</name>
  <action>Prove that Marker A and Marker B both exist.</action>
  <verify>
    <automated>
      grep -e"Marker A" -e"Marker B" docs/contract.md
      rg -f patterns.txt docs/contract.md
    </automated>
  </verify>
</task>
