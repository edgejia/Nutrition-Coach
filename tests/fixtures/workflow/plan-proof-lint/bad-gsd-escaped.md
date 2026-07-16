<task>
Release proof must establish both required markers.
<verify>
rg -e 'TYPECHECK_OK' -e 'TEST_OK' evidence.txt
count=$(wc -l &lt; evidence.txt); test "$count" &lt; 3
yarn release:check &gt; release.log
</verify>
</task>
