import { NextResponse, type NextRequest } from "next/server";
import { VOTER_COOKIE, VOTER_COOKIE_OPTIONS, mintVoter, readVoter } from "@/lib/identity";

/**
 * Hand every visitor a signed viewer cookie on their first page view, so that by
 * the time they submit a team the server already knows which entry is theirs.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  try {
    const current = req.cookies.get(VOTER_COOKIE)?.value;
    if (!(await readVoter(current))) {
      res.cookies.set(VOTER_COOKIE, await mintVoter(), VOTER_COOKIE_OPTIONS);
    }
  } catch {
    // No signing secret configured. The page still renders; submitting a team is
    // where the missing key gets reported, with something the host can act on.
  }
  return res;
}

export const config = { matcher: ["/", "/p/:path*"] };
