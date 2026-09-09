window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.connectors = function (root) {
  var wrap = document.createElement("div");
  wrap.className = "section";
  wrap.innerHTML = "<h2>Connectors</h2><p class='muted'>One connector per tool surface. Each proves its own undo. A connector never imports another connector.</p>" +
    "<div class='grid grid-2'>" +
    "<div class='card'><h3>Postgres</h3><table class='table'>" +
    "<tr><th>Op</th><th>Capture</th><th>Inverse</th></tr>" +
    "<tr><td class='mono'>UPDATE</td><td>Keyed SELECT before image</td><td>Keyed UPDATE from image</td></tr>" +
    "<tr><td class='mono'>DELETE</td><td>Full rows plus cascade walk</td><td>Ordered INSERT, identity kept</td></tr>" +
    "<tr><td class='mono'>DDL</td><td>Transactional</td><td>ROLLBACK</td></tr></table>" +
    "<p class='muted small'>Drift: a human edit between capture and replay refuses replay and names the change.</p></div>" +
    "<div class='card'><h3>S3 object</h3><table class='table'>" +
    "<tr><th>State</th><th>Class</th><th>Inverse</th></tr>" +
    "<tr><td>Versioning on</td><td><span class='badge-r1'>R1</span></td><td>Remove delete marker, prior version current</td></tr>" +
    "<tr><td>Versioning off</td><td><span class='badge-r3'>R3</span></td><td>None, held with reason</td></tr></table>" +
    "<p class='muted small'>Batch rule: the worst case in a batch is the class of the batch.</p></div></div>" +
    "<div class='card section'><h3>Snapshot boundary</h3>" +
    "<p>References and digests, never payloads. Redaction runs before bytes leave the process. Retention per workspace. Local file or customer bucket.</p>" +
    "<table class='table'><tr><th>Store</th><th>Retention</th></tr>" +
    "<tr><td class='mono'>Postgres before-images</td><td>7 days</td></tr>" +
    "<tr><td class='mono'>S3 markers</td><td>30 days</td></tr>" +
    "<tr><td class='mono'>Temp dev tier file store</td><td>Session only</td></tr></table>" +
    "<p>Field level redaction before bytes leave the process:</p>" +
    "<ul><li class='mono'>tokens</li><li class='mono'>secrets</li><li class='mono'>PII columns</li></ul>" +
    "<p>The bucket belongs to the customer, never to VOID. Not negotiable, even for the first user.</p>" +
    "<p class='muted small'>GDPR: a snapshot of personal data is processing, and a deletion request has to reach it.</p>" +
    "<p class='muted small'>Probing uses the upstream server read tools. VOID holds no standing credentials.</p></div>";
  root.appendChild(wrap);
};
