import { credentialRedirectFor } from '#universal/credential-redirects.ts'

type OrgSectionHandler = {
	middleware: Array<never>
	handler: (ctx: {
		request: Request
		params: { orgSlug?: string; rest?: string }
	}) => Promise<Response>
}

/**
 * The old Secrets, Integrations, MCP servers, and Secret providers index pages
 * move to the Credentials list. Their deeper paths (approvals, OAuth
 * authorize) still reach `inner`. Wrap a route only once nothing on the
 * Credentials page links back to its index, or the visit loops.
 */
export function withCredentialIndexRedirect<Handler extends OrgSectionHandler>(
	inner: Handler,
): Handler {
	return {
		...inner,
		async handler(ctx) {
			const location = credentialRedirectFor(new URL(ctx.request.url))
			if (!location) return inner.handler(ctx)
			return new Response(null, {
				status: 302,
				headers: { Location: location, 'Cache-Control': 'private, no-store' },
			})
		},
	}
}
