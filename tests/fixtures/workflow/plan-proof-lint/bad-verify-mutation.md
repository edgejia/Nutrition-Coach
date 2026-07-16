<task type="auto">
  <name>Historical production migration proof</name>
  <action>Prove that the production migration and generated harness are correct.</action>
  <verify>
    <automated>
      yarn db:migrate
      yarn verify:harness --refresh
    </automated>
  </verify>
</task>
