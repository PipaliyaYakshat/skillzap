import * as jwt from 'jsonwebtoken';
import { addMinutes } from 'date-fns';
import type { UserDocument } from 'src/users/entities/user.entity';

export function generateJwtToken(user: UserDocument): string {
  return jwt.sign({ id: user._id, role: user.role }, 'TOKEN');
}

export const OTPGNARETE = (): number =>
  Math.floor(100000 + Math.random() * 900000);

export const OTP_FUNCTION = {
  getOtpExpiryDate: (): Date => addMinutes(new Date(), 1),
};
