// Tests for Phase 1 (Partner CRM & EOI) and Phase 2 (Program Setup & Completion Reporting)
import assert from 'node:assert/strict';

delete process.env.TIGER_DATABASE_URL; // in-memory PGlite
delete process.env.PGLITE_DIR;
delete process.env.GEMINI_API_KEY;
delete process.env.CLOUDINARY_URL;
delete process.env.SMTP_HOST;
process.env.REQUIRE_AUTH = '1';
process.env.AUTH_DEV_LOGIN = '1';
process.env.STAFF_ADMIN_EMAILS = 'staff@example.org';

const { app } = await import('../src/server.js');
const { one, close } = await import('../src/db.js');
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;

// Staff login
const login = await fetch(`${base}/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'staff@example.org' })
});
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const getStaff = (u) => fetch(base + u, { headers: { cookie } });
const postStaff = (u, body, method = 'POST') =>
  fetch(base + u, { method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const postPublic = (u, body) =>
  fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const getPublic = (u) =>
  fetch(base + u).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

try {
  // ---- Phase 1: Partner CRM & Expression of Interest ----

  // 1. Public EOI submission
  let eoi = await postPublic('/api/partners/interest', {
    name: 'Cambridge Family Centre',
    contact_name: 'Morgan Smith',
    contact_email: 'morgan@example.org',
    contact_phone: '519-555-9876',
    communities_served: 'Cambridge, North Dumfries',
    notes: 'Planning to launch 3 sessions in early childhood centres'
  });
  assert.equal(eoi.status, 200);
  assert.ok(eoi.body.partnerId > 0);
  const partnerId = eoi.body.partnerId;

  // Verify staff email notification logged
  const eoiMail = await one("SELECT * FROM outbox WHERE subject LIKE '%New Partner Expression of Interest%'");
  assert.ok(eoiMail, 'Notification email sent to staff');
  assert.ok(eoiMail.body.includes('Cambridge Family Centre'));

  // 2. Staff views partner pipeline
  const pipe = await (await getStaff('/api/partners/pipeline')).json();
  assert.equal(pipe.counts.expression_of_interest, 1);
  assert.equal(pipe.total, 1);

  // 3. Staff updates partner stage to 'discovery' and adds PDSA details
  let patch = await postStaff(`/api/partners/${partnerId}`, {
    stage: 'discovery',
    pdsa_status: 'issued',
    pdsa_issued_date: '2026-11-10',
    notes: 'Initial discovery call scheduled for Nov 12.'
  }, 'PATCH');
  assert.equal(patch.status, 200);
  assert.equal(patch.body.stage, 'discovery');
  assert.equal(patch.body.pdsa_status, 'issued');

  // Advance to 'active' -> auto updates pdsa_status to executed if pending
  patch = await postStaff(`/api/partners/${partnerId}`, { stage: 'active', pdsa_status: 'executed' }, 'PATCH');
  assert.equal(patch.status, 200);
  assert.equal(patch.body.stage, 'active');
  assert.equal(patch.body.pdsa_status, 'executed');

  // ---- Phase 2: Program Setup & Order flow with new fields ----

  // 4. Inbound email creates order
  const inb = await postPublic('/api/inbound-email', {
    from: 'Morgan Smith <morgan@example.org>',
    subject: 'Baby Connections kits for Cambridge',
    body: 'We are ready to order kits'
  });
  assert.equal(inb.status, 200);
  const orderToken = inb.body.orderLink.split('/').pop();

  // 5. Link facilitator to partner
  const facRow = await one("SELECT id FROM facilitators WHERE email='morgan@example.org'");
  assert.ok(facRow, 'Facilitator created from inbound email');
  const linkRes = await postStaff(`/api/partners/${partnerId}/facilitators`, { facilitator_id: facRow.id });
  assert.equal(linkRes.status, 200);

  // 6. Submit order form with new Delivery Format, Schedule, and Community fields
  const ordSubmit = await postPublic(`/api/order-form/${orderToken}`, {
    facilitator_name: 'Morgan Smith',
    program: {
      name: 'Cambridge Sprouts Fall',
      location: 'Main Library Room B',
      start_date: '2026-11-15',
      end_date: '2026-12-20',
      projected_participants: 12,
      delivery_format: 'in_person',
      session_schedule: 'Thursdays 10:00 - 11:30 AM',
      community_served: 'Cambridge',
      external_registration_url: 'https://cambridgecentre.example/register'
    },
    items: [{ item: 'Participant Kits', qty: 12 }, { item: 'Facilitator Kits', qty: 1 }],
    shipping_address: '100 Water St, Cambridge ON'
  });
  assert.equal(ordSubmit.status, 200);

  const progRow = await one("SELECT * FROM programs WHERE name='Cambridge Sprouts Fall'");
  assert.ok(progRow, 'Program created in database');
  assert.equal(progRow.partner_id, partnerId, 'Program automatically linked to facilitator partner');
  assert.equal(progRow.delivery_format, 'in_person');
  assert.equal(progRow.session_schedule, 'Thursdays 10:00 - 11:30 AM');
  assert.equal(progRow.community_served, 'Cambridge');

  // 7. Mark order shipped and received
  const orderId = (await one('SELECT id FROM orders WHERE token=$1', [orderToken])).id;
  await postStaff(`/api/orders/${orderId}/ship`, {});
  await fetch(`${base}/received/${orderToken}`);

  // Confirm received email includes completion form link
  const receivedEmail = await one("SELECT body FROM outbox WHERE to_email='morgan@example.org' AND subject='Thanks, kits received'");
  assert.ok(receivedEmail.body.includes(`/complete/${progRow.token}`), 'Email includes completion form link');

  // ---- Phase 2: Program Completion Reporting ----

  // 8. Public fetch completion form data
  const compForm = await getPublic(`/api/programs/${progRow.token}/completion-form`);
  assert.equal(compForm.status, 200);
  assert.equal(compForm.body.program.name, 'Cambridge Sprouts Fall');
  assert.equal(compForm.body.alreadySubmitted, false);
  assert.equal(compForm.body.kitsShipped, 13); // 12 + 1

  // 9. Facilitator submits completion report
  const compSub = await postPublic(`/api/programs/${progRow.token}/completion`, {
    families_served: 11,
    kits_distributed: 11,
    completion_confirmed: true,
    reflections: 'The program was fantastic. Parents engaged actively in sensory play and songs.',
    success_stories: 'One first-time mother said the board book became her baby’s favorite daily activity.',
    challenges: 'Room ventilation was slightly warm during morning sessions.'
  });
  assert.equal(compSub.status, 200);
  assert.ok(compSub.body.ok);

  // 10. Re-submission is rejected with 409
  const compRe = await postPublic(`/api/programs/${progRow.token}/completion`, {
    families_served: 11,
    kits_distributed: 11,
    completion_confirmed: true
  });
  assert.equal(compRe.status, 409, 'Cannot resubmit completion report');

  // 11. Program status in database is now 'completed'
  const updatedProg = await one('SELECT status FROM programs WHERE id=$1', [progRow.id]);
  assert.equal(updatedProg.status, 'completed');

  // 12. Staff retrieves completion report
  const staffComp = await (await getStaff(`/api/programs/${progRow.id}/completion`)).json();
  assert.equal(staffComp.families_served, 11);
  assert.equal(staffComp.kits_distributed, 11);
  assert.ok(staffComp.reflections.includes('sensory play'));

  // 13. Verify dashboard overview counts
  const overview = await (await getStaff('/api/overview')).json();
  assert.equal(overview.partners, 1);
  assert.equal(overview.activePartners, 1);
  assert.equal(overview.completedPrograms, 1);

  // 14. Staff programs list returns partner and completion details
  const progList = await (await getStaff('/api/programs')).json();
  const targetProg = progList.find((p) => p.id === progRow.id);
  assert.ok(targetProg);
  assert.equal(targetProg.partner_name, 'Cambridge Family Centre');
  assert.equal(targetProg.families_served, 11);
  assert.equal(targetProg.kits_distributed, 11);

  // ---- Two-Way Document & CRM Email Messaging ----

  // 15. Staff uploads a PDSA Agreement document for the partner
  const formBoundary = '----WebKitFormBoundaryTest123';
  const fileContent = 'PDSA Agreement: Cambridge Family Centre agrees to deliver Baby Connections in 2026.';
  const multipartBody = `--${formBoundary}\r\nContent-Disposition: form-data; name="files"; filename="PDSA_Agreement_2026.pdf"\r\nContent-Type: application/pdf\r\n\r\n${fileContent}\r\n--${formBoundary}--\r\n`;

  const uploadRes = await fetch(`${base}/api/partners/${partnerId}/documents`, {
    method: 'POST',
    headers: {
      cookie,
      'Content-Type': `multipart/form-data; boundary=${formBoundary}`
    },
    body: multipartBody
  });
  assert.equal(uploadRes.status, 200);
  const uploadJson = await uploadRes.json();
  assert.ok(uploadJson.ok);
  assert.equal(uploadJson.documents.length, 1);
  const docId = uploadJson.documents[0].id;
  assert.equal(uploadJson.documents[0].original_name, 'PDSA_Agreement_2026.pdf');

  // 16. Staff replies to partner via CRM attaching the document
  const replyRes = await postStaff(`/api/partners/${partnerId}/reply`, {
    subject: 'Welcome to Baby Connections - PDSA Agreement Attached',
    body: 'Hi Morgan, please review and sign the attached agreement.',
    stage: 'pdsa_review',
    document_ids: [docId]
  });
  assert.equal(replyRes.status, 200);
  assert.ok(replyRes.body.ok);

  // Verify outgoing email logged in outbox and partner_messages
  const crmOutMail = await one("SELECT * FROM outbox WHERE to_email='morgan@example.org' AND subject LIKE '%PDSA Agreement Attached%'");
  assert.ok(crmOutMail, 'Outbox logged CRM reply');
  assert.ok(crmOutMail.body.includes('PDSA_Agreement_2026.pdf'));
  assert.ok(crmOutMail.body.includes(`/api/partners/${partnerId}/documents/${docId}/download`));

  // 17. Facilitator/Partner replies directly in their email
  const replyInbound = await postPublic('/api/inbound-email', {
    from: 'Morgan Smith <morgan@example.org>',
    subject: 'Re: Welcome to Baby Connections - PDSA Agreement Attached',
    body: 'Thank you! We have reviewed the agreement and are ready to proceed.'
  });
  assert.equal(replyInbound.status, 200);

  // Verify conversation history in CRM contains both staff reply and partner inbound email
  const msgs = await (await getStaff(`/api/partners/${partnerId}/messages`)).json();
  assert.ok(msgs.length >= 2, 'Conversation thread has both outbound and inbound messages');
  const lastMsg = msgs[msgs.length - 1];
  assert.equal(lastMsg.direction, 'inbound');
  assert.equal(lastMsg.from_email, 'morgan@example.org');
  assert.ok(lastMsg.body.includes('reviewed the agreement'));

  // 18. Partner downloads document from the link
  const dlRes = await fetch(`${base}/api/partners/${partnerId}/documents/${docId}/download`);
  assert.equal(dlRes.status, 200);
  const dlText = await dlRes.text();
  assert.equal(dlText, fileContent);

  console.log('All SiTE SOURCE Phase 1 & Phase 2 checks passed successfully!');
} finally {
  server.close();
  await close();
}
