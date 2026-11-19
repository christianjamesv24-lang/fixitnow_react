import bcrypt from 'bcrypt';
import sequelize from '../config/db.js';
import { User } from '../models/index.js';

async function provisionAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email && !password) {
    console.log('Production admin bootstrap skipped; ADMIN_EMAIL and ADMIN_PASSWORD are not configured.');
    return;
  }
  if (!email || !password) {
    throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD to provision the production admin.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL must be a valid email address.');
  }
  if (password.length < 16) {
    throw new Error('ADMIN_PASSWORD must be at least 16 characters long.');
  }

  const name = (process.env.ADMIN_NAME || 'FixitNow Admin').trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error('ADMIN_NAME must contain between 2 and 120 characters.');
  }

  const existingUser = await User.unscoped().findOne({ where: { email } });
  if (existingUser?.deletedAt) {
    throw new Error('The configured admin email belongs to a deleted account; restore it manually first.');
  }
  if (existingUser) {
    if (existingUser.role !== 'admin') {
      await existingUser.update({ role: 'admin' });
      console.log(`Promoted ${email} to admin.`);
    } else {
      console.log(`Production admin ${email} is already provisioned.`);
    }
    return;
  }

  await User.create({
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
  });
  console.log(`Created production admin ${email}.`);
}

try {
  await sequelize.authenticate();
  await provisionAdmin();
} catch (error) {
  console.error('Production admin provisioning failed:', error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
