import bcrypt from "bcryptjs";

/**
 * bcrypt cost for every password a person sets: their own change, an admin
 * creating an account, an admin reset. One constant, so the three cannot
 * drift apart. The seed hashes its demo password at a lower cost for speed.
 */
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}
