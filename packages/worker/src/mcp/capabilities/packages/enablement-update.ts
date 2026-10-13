import { z } from 'zod'
import { McpCallerError } from '#mcp/caller-error.ts'
import { defineDomainCapability } from '#mcp/capabilities/define-domain-capability.ts'
import { capabilityDomainNames } from '#mcp/capabilities/domain-metadata.ts'
import { requireMcpRequest } from '#mcp/capabilities/meta/require-user.ts'
import {
	credentialCallMapSchema,
	normalizeCredentialCallMap,
} from '#worker/credentials/credential-call-map.ts'
import { updateEnablementCredentialsForCaller } from '#worker/enablements/service.ts'
import { enablementSchema, toEnablementOutput } from './enablement-shared.ts'

export const enablementUpdateCapability = defineDomainCapability(
	capabilityDomainNames.packages,
	{
		name: 'enablementUpdate',
		orgPermission: 'package:execute',
		description:
			'Change which of your credentials your own enablement runs with (ADR 0068). `credentials` picks by need key, as for an invoke; needs you leave out keep their stored credential. Picks are stored as credential ids and audited. Only the enabler can change them; an Owner can only turn the enablement off. A pause on the old credentials lifts, and the next run checks the new ones.',
		keywords: [
			'enablement',
			'credentials',
			'pick',
			'trigger',
			'cron',
			'webhook',
			'subscription',
		],
		readOnly: false,
		idempotent: true,
		destructive: false,
		inputSchema: z.object({
			enablementId: z.string().min(1).describe('Enablement id.'),
			credentials: credentialCallMapSchema.describe(
				'Picks by need key: { KEY: "name" }, { KEY: { name, scope } }, or a list for a multiple need.',
			),
		}),
		outputSchema: z.object({ enablement: enablementSchema }),
		async handler(args, ctx) {
			const credentials = normalizeCredentialCallMap(args.credentials)
			if (!credentials) {
				throw new McpCallerError('credentials must pick at least one need.')
			}
			const enablement = await updateEnablementCredentialsForCaller({
				env: ctx.env,
				request: requireMcpRequest(ctx.callerContext),
				enablementId: args.enablementId,
				credentials,
			})
			return { enablement: toEnablementOutput(enablement) }
		},
	},
)
