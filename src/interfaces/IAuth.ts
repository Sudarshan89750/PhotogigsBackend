export interface IUserClaims {
  userId: string;     // PG uuid
  mongoId?: string;   // for profile lookups if needed
  role: 'user' | 'admin';
  status: UserStatus;
  membershipTier: 'free' | 'pro';
}

export type UserStatus =
  | 'pending_otp'
  | 'pending_id'
  | 'pending_approval'
  | 'approved'
  | 'blocked';

export class SignupDto {
  email!: string;
  password!: string;
  firstName!: string;
  lastName!: string;
  phone!: string;
  city!: string;
  state!: string;
  country!: string;
  latitude?: number;
  longitude?: number;
}

export class LoginDto {
  email!: string;
  password!: string;
}

export class VerifyOtpDto {
  email!: string;
  otp!: string;
}

export class RefreshTokenDto {
  refreshToken!: string;
}

export class ResetPasswordDto {
  email!: string;
  otp!: string;
  newPassword!: string;
}

export class RegisterPushTokenDto {
  token!: string;
  deviceId!: string;
}
