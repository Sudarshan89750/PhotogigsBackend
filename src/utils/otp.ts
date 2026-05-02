import crypto from 'crypto';
import { Container } from 'typedi';
import { RedisService } from '../services/redis.service';

const OTP_TTL_SECONDS = 600; // 10 minutes
const OTP_PREFIX = 'otp:';

export const generateOtp = (): string =>
  crypto.randomInt(100000, 999999).toString();

export const storeOtp = async (email: string, otp: string): Promise<void> => {
  const redis = Container.get(RedisService);
  await redis.set(`${OTP_PREFIX}${email}`, otp, OTP_TTL_SECONDS);
};

export const verifyAndConsumeOtp = async (
  email: string,
  otp: string
): Promise<boolean> => {
  const redis = Container.get(RedisService);
  const stored = await redis.get(`${OTP_PREFIX}${email}`);
  if (!stored || stored !== otp) return false;
  await redis.del(`${OTP_PREFIX}${email}`);
  return true;
};
