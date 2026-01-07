import * as jwt from 'jsonwebtoken';
import { addMinutes } from 'date-fns';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserDocument } from 'src/users/entities/user.entity';

// Keep these as standalone functions for backward compatibility
// They will use default values if ConfigService is not available
export function generateJwtToken(user: UserDocument, secret?: string): string {
  const jwtSecret = secret || process.env.JWT_SECRET || 'TOKEN';
  return jwt.sign({ id: user._id, role: user.role }, jwtSecret);
}

export const OTPGNARETE = (): number =>
  Math.floor(100000 + Math.random() * 900000);

export const OTP_FUNCTION = {
  getOtpExpiryDate: (minutes?: number): Date => {
    const otcExpiresIn = minutes ?? (Number(process.env.OTC_EXPIRES_IN) || 2);
    return addMinutes(new Date(), otcExpiresIn);
  },
};

// Service version that uses ConfigService
@Injectable()
export class UtilsService {
  constructor(private readonly configService: ConfigService) {}

  generateJwtToken(user: UserDocument): string {
    const secret = this.configService.get<string>('JWT_SECRET') ?? 'TOKEN';
    return jwt.sign({ id: user._id, role: user.role }, secret);
  }

  getOtpExpiryDate(): Date {
    const otcExpiresIn =
      Number(this.configService.get<string>('OTC_EXPIRES_IN')) || 2;
    return addMinutes(new Date(), otcExpiresIn);
  }

  generateOtp(): number {
    return OTPGNARETE();
  }
}
