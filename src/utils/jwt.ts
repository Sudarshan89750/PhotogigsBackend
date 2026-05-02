import jwt from 'jsonwebtoken';
import { config } from '../config';
import { IUserClaims } from '../interfaces/IAuth';

export const signAccessToken = (claims: IUserClaims): string =>
  jwt.sign(claims, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiry as any,
  });

export const signRefreshToken = (userId: string): string =>
  jwt.sign({ userId }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiry as any,
  });

export const verifyAccessToken = (token: string): IUserClaims => {
  try {
    return jwt.verify(token, config.jwt.accessSecret) as IUserClaims;
  } catch {
    throw new Error('Invalid or expired access token');
  }
};

export const verifyRefreshToken = (token: string): { userId: string } => {
  try {
    return jwt.verify(token, config.jwt.refreshSecret) as { userId: string };
  } catch {
    throw new Error('Invalid or expired refresh token');
  }
};
