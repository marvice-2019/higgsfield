import bcrypt from "bcryptjs";

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
