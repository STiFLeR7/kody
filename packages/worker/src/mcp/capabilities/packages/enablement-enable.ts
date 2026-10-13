import { z } from 'zod'
import { defineDomainCapability } from '#mcp/capabilities/define-domain-capability.ts'
import { capabilityDomainNames } from '#mcp/capabilities/domain-metadata.ts'
import { requireMcpRequest } from '#mcp/capabilities/meta/require-user.ts'
import {
	credentialCallMapSchema,
	normalizeCredentialCallMap,
} from '#worker/credentials/credential-call-map.ts'
import { enableTriggerForCaller } from '#worker/enablements/service.ts'
import {
	packageIdLookupDescription,
	packageNameLookupDescription,
} from '#worker/package-registry/package-name.ts'
import {
	enablementSchema,
	enablementTriggerKindSchema,
	toEnablementOutput,
} from './enablement-shared.ts'

export const enablementEnableCapability = defineDomainCapability(
	capabilityDomainNames.packages,
	{
		name: 'enablementEnable',
		orgPermission: 'package:execute',
		description:
			'Turn a package trigger (cron job, subscription topic, or minted webhook) on for yourself. Every run then acts as you: your access, your credentials, billed and audited to you. Publishing never turns a trigger on, and nobody can enable one for someone else. Needs package:execute on the package. Optional `credentials` picks which of your credentials fill the package credential needs; they are stored as ids. If you lose access later, the enablement pauses and resumes by itself once access is back.',
		keywords: [
			'enable',
			'enablement',
			'turn on',
			'trigger',
			'cron',
			'job',
			'subscription',
			'webhook',
			'run as me',
		],
		readOnly: false,
		idempotent: false,
		destructive: false,
		inputSchema: z
			.object({
				packageId: z
					.string()
					.min(1)
					.optional()
					.describe(packageIdLookupDescription),
				kodyId: z
					.string()
					.min(1)
					.optional()
					.describe(packageNameLookupDescription),
				triggerKind: enablementTriggerKindSchema,
				triggerName: z
					.string()
					.min(1)
					.describe('Job name, subscription topic, or webhook name.'),
				credentials: credentialCallMapSchema
					.optional()
					.describe(
						'Optional picks for the package credential needs, as for an invoke: { KEY: "name" }, { KEY: { name, scope } }, or a list for a multiple need. Resolved once to credential ids and stored, so runs never switch to a credential added later. Without it, needs with one candidate are stored.',
					),
			})
			.refine((input) => Boolean(input.packageId ?? input.kodyId), {
				message: 'Provide packageId or kodyId.',
				path: ['packageId'],
			}),
		outputSchema: z.object({
			enablement: enablementSchema,
			warnings: z.array(z.string()).optional(),
		}),
		async handler(args, ctx) {
			const { enablement, warnings } = await enableTriggerForCaller({
				env: ctx.env,
				baseUrl: ctx.callerContext.baseUrl,
				request: requireMcpRequest(ctx.callerContext),
				packageIdOrKodyId: args.packageId ?? args.kodyId ?? '',
				kind: args.triggerKind,
				name: args.triggerName,
				credentials: normalizeCredentialCallMap(args.credentials),
			})
			return {
				enablement: toEnablementOutput(enablement),
				...(warnings.length > 0 ? { warnings } : {}),
			}
		},
	},
)
