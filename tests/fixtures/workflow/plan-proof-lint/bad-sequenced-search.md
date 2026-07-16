<task type="auto">
  <name>Historical last-command-wins search chain</name>
  <action>Require Marker A and Marker B to both exist.</action>
  <verify>
    <automated>
      rg 'Marker A' docs/contract.md; rg 'Marker B' docs/contract.md
    </automated>
  </verify>
</task>
