<task type="auto">
  <name>Historical basic-regex alternation bypass</name>
  <action>Require Marker A and Marker B to both exist.</action>
  <verify>
    <automated>
      grep 'Marker A\|Marker B' docs/contract.md
    </automated>
  </verify>
</task>
