import { IUserClaims } from '../interfaces/IAuth';

declare module 'express-serve-static-core' {
  interface Request {
    currentUser?: IUserClaims;
    // FIX #11: requestId attached by correlation middleware
    requestId?: string;
  }
}
