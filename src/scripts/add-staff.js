// Usage: npm run staff -- add jo@strongstart.org "Jo Smith" [admin]
//        npm run staff -- remove jo@strongstart.org
//        npm run staff -- list
// Uses TIGER_DATABASE_URL (or PGLITE_DIR) from the environment, same as the server.
import { query, run, close } from '../db.js';
import { addStaff } from '../auth.js';

const [cmd, email, name, role] = process.argv.slice(2);
try {
  if (cmd === 'add' && email) {
    await addStaff(email, name, role || 'staff');
    console.log(`Added ${email}`);
  } else if (cmd === 'remove' && email) {
    const e = email.toLowerCase();
    const r = await run('UPDATE staff SET active=false WHERE lower(email)=$1', [e]);
    await run('DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE lower(email)=$1)', [e]);
    console.log(r.rowCount ? `Deactivated ${email} and ended their sessions` : 'No such staff member');
  } else if (cmd === 'list') {
    console.table(await query('SELECT email, name, role, active, last_login_at FROM staff ORDER BY email'));
  } else {
    console.log('Usage: npm run staff -- add <email> [name] [role] | remove <email> | list');
    process.exitCode = 1;
  }
} finally {
  await close();
}
