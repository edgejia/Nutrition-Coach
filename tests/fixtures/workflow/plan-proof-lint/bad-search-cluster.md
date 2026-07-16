<task type="auto">
  <name>All clustered patterns</name>
  <action>Prove that Marker A and Marker B both exist.</action>
  <verify>
    grep -FneMarker-A -eMarker-B docs/contract.md
  </verify>
</task>
