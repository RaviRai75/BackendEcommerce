#!/usr/bin/env node
/**
 * Creates or promotes an administrator.
 *
 * Deliberately a script and not an HTTP endpoint. structure.md security §2 and
 * §23 require that a role can never be granted through a request — if there were
 * a route that could create an admin, that route would be the most attacked part
 * of the application. Running this needs access to the server environment and the
 * database, which is a far higher bar than sending a POST.
 *
 * Usage:
 *   npm run create:admin -- --email=owner@sanchandana.com --name="Sangeetha"
 *
 * The password is read from the ADMIN_PASSWORD environment variable, never from a
 * command-line argument, because arguments appear in shell history and in the
 * process list:
 *
 *   $env:ADMIN_PASSWORD="…"; npm run create:admin -- --email=… --name=…
 *
 * If the account already exists it is promoted rather than duplicated, and its
 * password is left alone unless --reset-password is passed.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { User, UserRole } from '../src/modules/users/user.model.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { authService } from '../src/modules/auth/auth.service.js';
import { SessionRevocationReason } from '../src/modules/auth/session.model.js';
import { passwordSchema, emailSchema, personNameSchema } from '../src/validators/common.js';

function parseArguments(argv) {
  const options = { resetPassword: false };

  for (const argument of argv) {
    if (argument === '--reset-password') {
      options.resetPassword = true;
      continue;
    }
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator === -1) {
      throw new Error(`Unrecognised argument "${argument}"`);
    }
    const key = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (key === 'email') options.email = value;
    else if (key === 'name') options.name = value;
    else throw new Error(`Unknown option "--${key}"`);
  }

  if (!options.email) throw new Error('--email is required');
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  const email = emailSchema.parse(options.email);
  const password = process.env.ADMIN_PASSWORD;

  await connectDatabase();

  const existing = await User.findOne({ email }).select('_id role name');

  if (existing) {
    const updates = { role: UserRole.ADMIN };

    if (options.resetPassword) {
      if (!password) {
        throw new Error('ADMIN_PASSWORD must be set when using --reset-password');
      }
      updates.passwordHash = await hashPassword(passwordSchema.parse(password));
      updates.passwordChangedAt = new Date();
    }

    await User.updateOne({ _id: existing._id }, { $set: updates, $unset: { lockedUntil: 1 } });

    // Promotion changes what every existing token is allowed to do, so those
    // tokens are invalidated rather than silently upgraded.
    await authService.revokeAllSessions(
      existing._id,
      SessionRevocationReason.PASSWORD_CHANGED,
    );

    console.log(`  Promoted ${email} to ADMIN.`);
    if (options.resetPassword) console.log('  Password reset and all sessions revoked.');
    return;
  }

  if (!password) {
    throw new Error(
      'ADMIN_PASSWORD must be set in the environment to create a new administrator',
    );
  }

  const user = await User.create({
    email,
    name: personNameSchema.parse(options.name ?? 'Administrator'),
    passwordHash: await hashPassword(passwordSchema.parse(password)),
    role: UserRole.ADMIN,
    passwordChangedAt: new Date(),
    emailVerifiedAt: new Date(),
  });

  console.log(`  Created administrator ${user.email} in "${env.MONGODB_DB_NAME}".`);
  console.log('  Enable two-factor authentication for this account before launch (§24).');
}

main()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    // Zod errors carry field detail; anything else prints its message.
    console.error('  Failed:', error.issues ? JSON.stringify(error.issues, null, 2) : error.message);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
