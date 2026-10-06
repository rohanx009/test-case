import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || 'subops-enterprise-jwt-secret-key-2026';

export interface AuthUser {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: 'admin' | 'customer';
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function signJwtToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, uid: user.uid, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export async function getOrCreateUserFromAuth(uid: string, email: string, name: string, preferredRole?: 'admin' | 'customer'): Promise<AuthUser> {
  try {
    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      const u = existing[0];
      return {
        id: u.id,
        uid: u.uid,
        email: u.email,
        name: u.name,
        role: (u.role === 'admin' ? 'admin' : 'customer'),
      };
    }

    // Check if any admin exists yet; if none or email contains admin, make admin
    const allUsers = await db.select().from(users);
    const defaultRole = preferredRole || (allUsers.length === 0 || email.toLowerCase().includes('admin') || email === 'kanaginhalsakshi@gmail.com' ? 'admin' : 'customer');

    const inserted = await db
      .insert(users)
      .values({
        uid,
        email,
        name: name || email.split('@')[0],
        role: defaultRole,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email, updatedAt: new Date() },
      })
      .returning();

    const u = inserted[0];
    return {
      id: u.id,
      uid: u.uid,
      email: u.email,
      name: u.name,
      role: (u.role === 'admin' ? 'admin' : 'customer'),
    };
  } catch (error) {
    console.error('Database user sync failed:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split('Bearer ')[1];

  // 1. Try JWT verification first
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    const dbUsers = await db.select().from(users).where(eq(users.id, decoded.id));
    if (dbUsers.length > 0) {
      const u = dbUsers[0];
      req.user = {
        id: u.id,
        uid: u.uid,
        email: u.email,
        name: u.name,
        role: u.role === 'admin' ? 'admin' : 'customer',
      };
      return next();
    }
    req.user = decoded;
    return next();
  } catch (_jwtErr) {
    // Fallback to Firebase ID Token verification
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const syncedUser = await getOrCreateUserFromAuth(
      decodedToken.uid,
      decodedToken.email || `${decodedToken.uid}@example.com`,
      decodedToken.name || 'Enterprise User'
    );
    req.user = syncedUser;
    return next();
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden: Administrator privileges are required for this action.',
    });
  }
  next();
};
