// Usage: npm run staff -- add jo@strongstart.org "Jo Smith" [admin]
//        npm run staff -- remove jo@strongstart.org
//        npm run staff -- list
import { db } from '../db.js';
import { addStaff } from '../auth.js';

const [cmd, email, name, role] = process.argv.slice(2);
if (cmd === 'add' && email) {
  addStaff(email, name, role || 'staff');
  console.log(`Added ${email}`);
} else if (cmd === 'remove' && email) {
  const r = db.prepare('UPDATE staff SET active=0 WHERE email=?').run(email.toLowerCase());
  db.prepare('DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email=?)').run(email.toLowerCase());
  console.log(r.changes ? `Deactivated ${email} and ended their sessions` : 'No such staff member');
} else if (cmd === 'list') {
  console.table(db.prepare('SELECT email, name, role, active, last_login_at FROM staff ORDER BY email').all());
} else {
  console.log('Usage: npm run staff -- add <email> [name] [role] | remove <email> | list');
  process.exitCode = 1;
}
