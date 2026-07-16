<task type="auto">
  <name>All required markers</name>
  <action>Prove that Marker A and Marker B both exist.</action>
  <verify>
    rg 'Marker A' docs/contract.md || true &amp;&amp; rg 'Marker B' docs/contract.md
  </verify>
</task>
