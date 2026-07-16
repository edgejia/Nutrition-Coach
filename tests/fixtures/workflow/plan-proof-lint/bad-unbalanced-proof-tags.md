<task type="auto">
  <name>Historical malformed proof scope</name>
  <action>Do not treat a superficially executable line as task-scoped proof.</action>
  <verify>
    <automated>rg 'accepted' evidence.md</verify>
  </automated>
</task>
