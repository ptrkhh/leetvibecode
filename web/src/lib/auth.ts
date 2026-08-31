import { compare, hashSync } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./db";

// R45: fixed dummy hash (same cost factor, 10, as register/route.ts's real
// `hash(password, 10)`) so a lookup miss still pays a bcrypt compare.
// Without this, "no such user" answers measurably faster than "wrong
// password" over the network — an account-existence timing oracle even
// though both responses are otherwise identical. Generated once at module
// scope, not per-request.
const DUMMY_HASH = hashSync("no-such-user", 10);

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  // R61: signIn() is TWO sequential HTTP calls -- getProviders() then the
  // credentials POST -- and next-auth's fetchData swallows a fetch failure on
  // the first leg, resolving to null instead of rejecting. _signIn() then does
  // a hard window.location.href to /api/auth/error, so a connection drop there
  // is a NAVIGATION, not a rejection: no .catch() in this codebase can see it.
  // Without an error page configured the user lands on next-auth's stock one,
  // whose entire body is "Error Error <host>" -- no nav, no way back, and in
  // the register case the account has already been created. Pointing it at
  // /login turns that dead end into the app's own page, which is exactly where
  // a user whose account exists needs to be.
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        if (!creds?.email || !creds.password) return null;
        // R47: normalize the lookup the same way register/route.ts normalizes
        // storage, so a user who registered as Foo@Bar.com can log in typing
        // any case of the same address.
        const email = creds.email.trim().toLowerCase();
        const user = await prisma.user.findUnique({ where: { email } });
        const passwordOk = await compare(creds.password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !passwordOk) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => (user ? { ...token, id: user.id } : token),
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, id: token.id as string },
    }),
  },
};
